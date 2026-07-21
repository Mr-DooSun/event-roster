# Event Roster Pragmatic Workers MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers Free + D1 하나로 자체 `login_id`/비밀번호/JWT 인증과 행사별 참가 명단 운영, 당일 변동, 집계, 감사, 브라우저 Excel 이관·내보내기를 제공하는 내부 MVP를 완성한다.

**Architecture:** React/Vite 정적 자산과 Hono API를 하나의 Worker가 같은 `workers.dev` origin에서 제공한다. 인증은 ATS의 검증된 사용 흐름을 기준으로 `bcryptjs` cost 12, 메모리 전용 15분 Access JWT, D1 세션에 연결된 7일 회전형 HttpOnly Refresh Token을 사용한다. 기존 고부하 bcrypt capability 실패는 보존하되, 13명 안팎 운영 인력의 저빈도 로그인이라는 제품 조건과 D1 기반 로그인 제한을 명시적으로 수용한다.

**Tech Stack:** Node 22, pnpm 10.28.1, TypeScript strict, React 19, Vite, Hono, Zod, `bcryptjs`, `jose`, Cloudflare Workers Static Assets/D1, Vitest, `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright, SheetJS `xlsx`, GitHub Actions.

## Global Constraints

- 이 계획은 `2026-07-21-event-roster-workers-bcrypt-mvp.md`의 Task 3 이후를 대체한다. 기존 Task 1·2 코드, ADR 0003, 원격 실패 evidence는 사실 기록으로 보존한다.
- ADR 0003의 고부하 gate FAIL을 PASS로 바꾸지 않는다. 새 ADR은 저빈도 내부 사용 리스크를 별도 결정으로 기록한다.
- Cloudflare Access, 이메일 OTP, 외부 IdP, Google Cloud, Cloud Run, `gcloud`, FastAPI, VM, 별도 Pages origin, 커스텀 도메인을 사용하지 않는다.
- 배포 주소는 Wrangler가 실제 출력한 `https://<worker>.<account>.workers.dev` 하나다. 프론트와 API 모두 같은 origin을 사용하며 CORS를 구성하지 않는다.
- `packageManager`는 정확히 `pnpm@10.28.1`, Node는 `22`, Worker `compatibility_date`는 `2026-07-21`, compatibility flag는 `nodejs_compat`이다.
- 모노레포는 `apps/worker`, `apps/web`, `packages/contracts`, `packages/domain`, `spikes/*`를 유지한다.
- 로그인 ID는 소문자 canonical 값으로 저장하며 `^[a-z][a-z0-9._-]{2,31}$`만 허용한다. 이메일을 로그인 식별자로 쓰지 않는다.
- 비밀번호는 `bcryptjs` cost factor 12를 사용하고 UTF-8 72 bytes 초과 입력을 모든 API/UI/hash/verify 경로에서 거부한다. cost를 낮추거나 빠른 일반 해시로 바꾸지 않는다.
- 고부하 bcrypt 성공을 전제하지 않는다. 로그인·비밀번호 변경·사용자 발급은 자동 재시도하지 않고, Worker 5xx는 `AUTH_TEMPORARILY_UNAVAILABLE`로 표시한다.
- 존재하지 않거나 비활성인 계정도 유효한 cost-12 `DUMMY_BCRYPT_HASH`를 정확히 한 번 비교한다. 단, D1에서 이미 잠긴 login/IP key는 bcrypt 전에 동일한 `RATE_LIMITED` 응답으로 종료한다.
- Access JWT 만료는 900초다. 브라우저 메모리에만 저장하며 localStorage, sessionStorage, IndexedDB, URL, 로그, React Query cache에 저장하지 않는다.
- Refresh Token은 32 CSPRNG bytes base64url 값이고 604800초 후 만료된다. `__Host-er_refresh; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict` 쿠키에만 원문을 두고 D1에는 SHA-256 hash만 저장한다.
- Refresh Token은 사용할 때마다 회전한다. 이미 회전·폐기된 토큰 재사용이 감지되면 같은 session의 모든 refresh token과 session을 폐기한다.
- Access JWT는 `sid`, `sv`, `kind`를 포함한다. 모든 인증 API 요청은 JWT 서명뿐 아니라 D1 session, 사용자 활성 상태, session version을 확인한다.
- 로그인/refresh 응답은 메모리 전용 CSRF 원문을 반환한다. 인증된 모든 mutation은 정확한 `Origin`과 `X-ER-CSRF`를 요구한다. refresh/logout은 HttpOnly cookie 때문에 정확한 `Origin`을 필수로 확인한다.
- 비밀번호 변경, 운영자 재설정, 계정 비활성화, 역할 변경은 대상 사용자의 모든 session/refresh token을 폐기한다.
- 로그인 실패 제한은 HMAC된 canonical login ID와 `CF-Connecting-IP` 각각 15분 5회다. 원본 IP, 비밀번호, JWT, refresh token, CSRF, bcrypt hash는 로그·감사에 남기지 않는다.
- 행사 상태는 `DRAFT → PRE_REGISTRATION → DAY_OF → CLOSED`, 그리고 운영자만 `CLOSED → DAY_OF` 재개를 허용한다.
- `DAY_OF` 진입 시 조직별 예상 수와 활성 사전 명단 snapshot을 고정한다. `CLOSED`에서는 명단 변경을 거부한다.
- 참가자는 `participant_id`, 이름, 조직으로 식별하고 동일 인물을 여러 행사에서 재사용한다. 행사 명단은 참가자 master와 분리한다.
- Excel 원본 파일은 서버에 업로드하거나 보관하지 않는다. 브라우저에서 읽어 정규화 JSON만 API에 보내고, 서버 commit은 130행 전체 성공 또는 전체 rollback이다.
- 모든 상태/revision 변경은 D1 guarded batch로 처리하고 영향 행 0을 성공으로 간주하지 않는다.
- 각 Task는 RED test → RED 확인 → 최소 구현 → GREEN 확인 → 전체 관련 검사 → 커밋 순서를 지킨다.
- 실제 Worker/D1/Secret 생성과 배포는 Task 12에서 사용자의 명시적 승인을 다시 받은 뒤에만 수행한다.

## Canonical Interfaces

```ts
export type Role = "OPERATOR" | "ORGANIZATION_MANAGER";
export type SessionKind = "FULL" | "MUST_CHANGE_PASSWORD";
export type EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED";
export type Half = "H1" | "H2";
export type RosterSource = "PRE_EVENT" | "DAY_OF";
export type RosterStatus = "ACTIVE" | "CANCELLED";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  JWT_SIGNING_KEY: string;
  DUMMY_BCRYPT_HASH: string;
  IP_HASH_KEY: string;
  RECOVERY_CODE_PEPPER: string;
  BOOTSTRAP_TOKEN?: string;
}

export interface AccessClaims {
  sub: string;
  sid: string;
  sv: number;
  kind: SessionKind;
  iss: "event-roster";
  aud: "event-roster-web";
  iat: number;
  exp: number;
}

export interface AuthSessionView {
  user: {
    id: string;
    loginId: string;
    displayName: string;
    role: Role;
    organizationIds: string[];
    isBootstrap: boolean;
  };
  sessionKind: SessionKind;
}

export interface AuthSuccess {
  accessToken: string;
  csrfToken: string;
  session: AuthSessionView;
}

export interface ApiProblem {
  code:
    | "AUTHENTICATION_REQUIRED"
    | "AUTH_TEMPORARILY_UNAVAILABLE"
    | "FORBIDDEN"
    | "INVALID_CSRF"
    | "INVALID_RECOVERY_CODE"
    | "INVALID_TRANSITION"
    | "EVENT_CLOSED"
    | "STALE_REVISION"
    | "VALIDATION_FAILED"
    | "RATE_LIMITED"
    | "NOT_FOUND"
    | "CONFLICT"
    | "INTERNAL_ERROR";
  message: string;
  requestId: string;
  details?: unknown;
}

export interface EventSummary {
  eventId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    expected: number;
    dayOfAdded: number;
    dayOfCancelled: number;
    final: number;
    delta: number;
  }>;
}

export interface NormalizedImportRow {
  rowNumber: number;
  name: string;
  organizationName: string;
  resolvedParticipantId?: string;
}
```

## Target File Structure

```text
event-roster/
├── apps/
│   ├── worker/
│   │   ├── migrations/0001_initial.sql
│   │   ├── src/{app,index,env}.ts
│   │   ├── src/auth/{password,access-token,refresh-token,csrf,rate-limit}.ts
│   │   ├── src/db/{atomic,auth,admin,events,roster,imports}.ts
│   │   ├── src/services/{bootstrap,auth,recovery,admin,events,roster,imports}.ts
│   │   ├── src/routes/{auth,bootstrap,organizations,users,events,participants,roster,imports}.ts
│   │   ├── src/middleware/{authentication,authorization,csrf}.ts
│   │   ├── src/http/{problem,origin,request-context}.ts
│   │   ├── scripts/{prepare-e2e-env,generate-dummy-bcrypt,smoke-remote}.mts
│   │   └── test/
│   └── web/
│       ├── src/app/
│       ├── src/components/ui/
│       ├── src/features/{auth,admin,events,roster,imports}/
│       ├── src/lib/{api,auth-session,excel}.ts
│       ├── src/styles/
│       └── e2e/
├── packages/
│   ├── contracts/src/
│   └── domain/src/
├── docs/{adr,operations,superpowers}/
└── .github/workflows/ci.yml
```

---

### Task 1: Record the pragmatic auth decision and create the same-origin monorepo shell

**Files:**
- Create: `docs/adr/0004-workers-free-pragmatic-auth.md`
- Create: `.nvmrc`
- Create: `apps/worker/{package.json,tsconfig.json,wrangler.jsonc,wrangler.test.jsonc,vitest.config.ts}`
- Create: `apps/worker/src/{env,index,app}.ts`
- Create: `apps/worker/src/routes/health.ts`
- Create: `apps/worker/test/health.integration.test.ts`
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`
- Create: `apps/web/src/{main.tsx,app/App.tsx,app/App.test.tsx}`
- Modify: `package.json`, `.gitignore`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: committed ADR 0003 and its failure evidence.
- Produces: `GET /api/v1/health -> { status: "ok" }`, same-origin Static Assets, React root, and ADR 0004 risk decision.

- [ ] **Step 1: Write Worker and web RED smoke tests**

```ts
// apps/worker/test/health.integration.test.ts
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves the health API from the Worker origin", async () => {
  const response = await exports.default.fetch("https://event-roster.test/api/v1/health");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
```

```tsx
// apps/web/src/app/App.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the application name", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "행사 참가자 명단" })).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 test`

Expected: FAIL because `apps/worker`, `apps/web`, and their modules do not exist.

- [ ] **Step 3: Implement the shell and ADR**

```ts
// apps/worker/src/app.ts
import { Hono } from "hono";
import type { Env } from "./env";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
```

```ts
// apps/worker/src/index.ts
import { createApp } from "./app";
export default createApp();
```

`wrangler.jsonc`의 Worker name은 `event-roster`, `workers_dev`는 `true`, Static Assets binding은 `ASSETS`, API 우선 실행은 `run_worker_first: ["/api/*"]`로 고정한다. ADR 0004에는 다음을 사실대로 기록한다: ADR 0003 stress gate는 FAIL이며 삭제·변경하지 않음, ATS와 동일 계열의 bcrypt cost 12를 저빈도 내부 로그인에 사용함, 자동 재시도 금지, D1 rate limiting, 운영 전 smoke와 Observability 확인, Free runtime에서 간헐적 5xx 가능성을 수용함.

- [ ] **Step 4: Verify GREEN and configuration**

Run: `corepack pnpm@10.28.1 install && corepack pnpm@10.28.1 test && corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run`

Expected: Worker and web smoke tests PASS; dry run reports one Worker bundle and the web asset directory without remote changes.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-lock.yaml apps docs/adr/0004-workers-free-pragmatic-auth.md
git commit -m "chore: scaffold pragmatic Workers MVP"
```

### Task 2: Define shared contracts and pure event-domain rules

**Files:**
- Create: `packages/contracts/{package.json,tsconfig.json,src/{auth,common,events,organizations,participants,roster,imports,index}.ts}`
- Create: `packages/contracts/test/contracts.test.ts`
- Create: `packages/domain/{package.json,tsconfig.json,src/{errors,event-lifecycle,summary,import-validation,index}.ts}`
- Create: `packages/domain/test/{event-lifecycle,summary,import-validation}.test.ts`

**Interfaces:**
- Produces: the canonical types in this plan, Zod DTO schemas, `transitionEvent()`, `calculateEventSummary()`, and `validateNormalizedRows()`.

- [ ] **Step 1: Write contract and domain RED tests**

```ts
it("accepts only canonical login IDs", () => {
  expect(LoginIdSchema.safeParse("manager-01").success).toBe(true);
  expect(LoginIdSchema.safeParse("Manager 01").success).toBe(false);
});

it("allows only the approved event transitions", () => {
  expect(transitionEvent("DRAFT", "PRE_REGISTRATION", "OPERATOR")).toBe("PRE_REGISTRATION");
  expect(() => transitionEvent("CLOSED", "DRAFT", "OPERATOR")).toThrowError("INVALID_TRANSITION");
  expect(() => transitionEvent("CLOSED", "DAY_OF", "ORGANIZATION_MANAGER")).toThrowError("FORBIDDEN");
});

it("computes expected and final totals from snapshot/source/status", () => {
  expect(calculateEventSummary(summaryFixture)).toEqual(expectedSummary);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/contracts test && corepack pnpm@10.28.1 --filter @event-roster/domain test`

Expected: FAIL because schemas and domain functions are absent.

- [ ] **Step 3: Implement contracts and pure rules**

```ts
export const LoginIdSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,31}$/);
export const PasswordSchema = z.string().min(10).refine(
  (value) => new TextEncoder().encode(value).byteLength <= 72,
  "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.",
);
export const EventStatusSchema = z.enum(["DRAFT", "PRE_REGISTRATION", "DAY_OF", "CLOSED"]);
export const HalfSchema = z.enum(["H1", "H2"]);
```

`transitionEvent`는 Global Constraints의 상태 그래프를 그대로 구현한다. `calculateEventSummary`는 DAY_OF snapshot을 expected로 사용하고 ACTIVE roster만 final에 포함한다. `validateNormalizedRows`는 1~130행, 비어 있지 않은 이름/조직, 파일 내 중복을 검사하며 D1을 호출하지 않는다.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/contracts test && corepack pnpm@10.28.1 --filter @event-roster/domain test && corepack pnpm@10.28.1 check`

Expected: all contract/domain tests and strict TypeScript checks PASS.

- [ ] **Step 5: Commit**

```bash
git add packages pnpm-lock.yaml
git commit -m "feat: define roster contracts and domain rules"
```

### Task 3: Create the D1 schema and guarded atomic foundation

**Files:**
- Create: `apps/worker/migrations/0001_initial.sql`
- Create: `apps/worker/src/db/{atomic,rows}.ts`
- Create: `apps/worker/test/{schema,atomic}.integration.test.ts`
- Create: `apps/worker/test/support/{ids,database}.ts`
- Modify: `apps/worker/vitest.config.ts`

**Interfaces:**
- Produces: all MVP tables and `runGuardedAtomic(db, input): Promise<D1Result[]>`.

- [ ] **Step 1: Write schema and rollback RED tests**

```ts
it("rejects duplicate canonical login IDs and event year/half", async () => {
  await insertUser({ loginId: "minsu", canonical: "minsu" });
  await expect(insertUser({ loginId: "MinSu", canonical: "minsu" })).rejects.toThrow();
  await insertEvent({ year: 2026, half: "H1" });
  await expect(insertEvent({ year: 2026, half: "H1" })).rejects.toThrow();
});

it("rolls back every statement when the guard is false", async () => {
  await expect(runGuardedAtomic(env.DB, falseGuardFixture())).rejects.toThrowError("STALE_REVISION");
  expect(await countRows("audit_logs")).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts`

Expected: FAIL because the migration and atomic helper are absent.

- [ ] **Step 3: Implement migration and guard helper**

Create `organizations`, `users`, `user_organizations`, `password_credentials`, `auth_sessions`, `refresh_tokens`, `login_attempts`, `security_events`, `bootstrap_locks`, `recovery_codes`, `operation_guards`, `participants`, `events`, `event_roster_entries`, `event_expected_snapshots`, `audit_logs`, and `import_runs`.

```sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('FULL','MUST_CHANGE_PASSWORD')),
  csrf_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  replaced_by_id TEXT REFERENCES refresh_tokens(id) ON DELETE RESTRICT
);
```

`operation_guards.ok`는 `CHECK(ok=1)`과 abort trigger를 가진다. guarded batch의 첫 statement가 status/revision/actor predicate를 `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END`로 평가하고, 마지막 statement가 guard를 삭제한다. `audit_logs`와 `security_events`는 UPDATE/DELETE abort trigger로 append-only를 강제한다.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/worker run check`

Expected: uniqueness, FK, append-only, false-guard rollback tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/migrations apps/worker/src/db apps/worker/test
git commit -m "feat: add D1 schema and atomic guards"
```

### Task 4: Implement bcrypt, Access JWT, rotating refresh, CSRF, and rate-limit primitives

**Files:**
- Create: `apps/worker/src/auth/{password,access-token,refresh-token,csrf,rate-limit}.ts`
- Create: `apps/worker/src/http/{problem,origin,request-context}.ts`
- Create: `apps/worker/test/auth/{password,access-token,refresh-token,csrf,rate-limit}.test.ts`
- Modify: `apps/worker/{package.json,wrangler.jsonc}`, `apps/worker/src/env.ts`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `BcryptPasswordHasher`, `issueAccessToken`, `verifyAccessToken`, `createRefreshToken`, `hashRefreshToken`, `createRefreshCookie`, `createCsrfToken`, `assertExactOrigin`, and HMAC rate-limit keys.

- [ ] **Step 1: Write security primitive RED tests**

```ts
it("uses cost 12 and rejects bcrypt truncation", async () => {
  const hasher = new BcryptPasswordHasher();
  const hash = await hasher.hash("temporary-password-123");
  expect(hash.startsWith("$2b$12$")).toBe(true);
  await expect(hasher.hash(`${"가".repeat(24)}a`)).rejects.toThrow("PASSWORD_TOO_LONG");
});

it("issues a 15-minute access JWT with session claims", async () => {
  const token = await issueAccessToken(claimFixture, signingKey, epoch);
  const claims = await verifyAccessToken(token, signingKey, epoch.plusSeconds(899));
  expect(claims).toMatchObject({ sid: claimFixture.sid, sv: 3, kind: "FULL" });
  await expect(verifyAccessToken(token, signingKey, epoch.plusSeconds(901))).rejects.toThrow();
});

it("creates only the host refresh cookie", () => {
  expect(createRefreshCookie("raw-token")).toBe("__Host-er_refresh=raw-token; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict");
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- test/auth`

Expected: FAIL because auth primitive modules are absent.

- [ ] **Step 3: Implement defensive primitives**

```ts
export class BcryptPasswordHasher {
  async hash(password: string): Promise<string> {
    if (bcrypt.truncates(password)) throw new AuthPrimitiveError("PASSWORD_TOO_LONG");
    return bcrypt.hash(password, 12);
  }
  async verify(password: string, hash: string): Promise<boolean> {
    if (bcrypt.truncates(password)) throw new AuthPrimitiveError("PASSWORD_TOO_LONG");
    if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hash)) throw new AuthPrimitiveError("INVALID_POLICY_HASH");
    return bcrypt.compare(password, hash);
  }
}

export function createRefreshToken(randomBytes: (n: number) => Uint8Array): string {
  return encodeBase64Url(randomBytes(32));
}

export async function hashRefreshToken(raw: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
}
```

Use `jose` HS256 with fixed issuer/audience and exact claim validation. CSRF is 32 CSPRNG bytes; D1 stores SHA-256 only. Request context trusts only `CF-Connecting-IP`, HMACs login/IP action keys with `IP_HASH_KEY`, and never reads `X-Forwarded-For`. `wrangler.jsonc` requires `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `IP_HASH_KEY`, and `RECOVERY_CODE_PEPPER`; `BOOTSTRAP_TOKEN` remains optional and is deleted after bootstrap.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- test/auth && corepack pnpm@10.28.1 --filter @event-roster/worker run check && corepack pnpm@10.28.1 --dir apps/worker exec wrangler types`

Expected: all primitive tests and strict types PASS; generated bindings contain the four required secret names and no secret values.

- [ ] **Step 5: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat: add pragmatic Worker auth primitives"
```

### Task 5: Implement bootstrap, login, refresh rotation, logout, password change, and recovery

**Files:**
- Create: `apps/worker/src/db/auth.ts`
- Create: `apps/worker/src/services/{bootstrap,auth,recovery}.ts`
- Create: `apps/worker/src/routes/{bootstrap,auth}.ts`
- Create: `apps/worker/src/middleware/{authentication,authorization,csrf}.ts`
- Create: `apps/worker/test/{bootstrap,auth,recovery}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: `POST /api/v1/bootstrap`, `/bootstrap/first-operator`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/recover`; `requireActor()` and `requireFullSession()`.

- [ ] **Step 1: Write auth lifecycle RED tests**

```ts
it("rotates refresh tokens and revokes the family on reuse", async () => {
  const login = await loginWithCredentials("manager", "password-1234");
  const firstRefresh = login.refreshCookie;
  const rotated = await refreshWithCookie(firstRefresh);
  expect(rotated.status).toBe(200);
  expect(rotated.refreshCookie).not.toBe(firstRefresh);
  expect((await refreshWithCookie(firstRefresh)).status).toBe(401);
  expect((await refreshWithCookie(rotated.refreshCookie)).status).toBe(401);
});

it("returns the same invalid-credential result for wrong and unknown IDs", async () => {
  const wrong = await loginRequest("manager", "wrong-password");
  const unknown = await loginRequest("nobody", "wrong-password");
  expect([wrong.status, unknown.status]).toEqual([401, 401]);
  expect(await wrong.json()).toEqual(await unknown.json());
  expect(passwordHasher.verify).toHaveBeenCalledTimes(2);
});

it("revokes every session after password change", async () => {
  const first = await loginWithCredentials("manager", "password-1234");
  const second = await loginWithCredentials("manager", "password-1234");
  await changePassword(first, "new-password-1234");
  expect((await authenticatedMe(first.accessToken)).status).toBe(401);
  expect((await authenticatedMe(second.accessToken)).status).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- auth.integration.test.ts bootstrap.integration.test.ts recovery.integration.test.ts`

Expected: FAIL because routes and services are absent.

- [ ] **Step 3: Implement the lifecycle**

Login order is fixed: canonicalize ID → query HMAC rate keys → return `RATE_LIMITED` before bcrypt when locked → load active user or dummy hash → exactly one compare → record result → on success insert `auth_sessions` and first `refresh_tokens` row → issue 15-minute Access JWT, CSRF raw value, refresh cookie. A catchable bcrypt exception returns `503 AUTH_TEMPORARILY_UNAVAILABLE` without cookie or automatic retry. A platform-enforced CPU termination may bypass application error handling; the client still treats the resulting 5xx as unavailable and never retries automatically.

Refresh order is fixed: exact Origin → hash cookie → load token including rotated/revoked rows → on reuse revoke session and every token → otherwise guarded batch marks old token rotated and inserts replacement → rotate CSRF digest → return `AuthSuccess` and replacement cookie. Logout uses exact Origin and cookie, revokes session/tokens, and clears the cookie.

```ts
export async function issueAuthSuccess(input: IssueAuthInput): Promise<IssueAuthResult> {
  const rawRefresh = createRefreshToken(input.randomBytes);
  const rawCsrf = createCsrfToken(input.randomBytes);
  const session = await input.repository.createSession({
    user: input.user,
    kind: input.kind,
    refreshHash: await hashRefreshToken(rawRefresh),
    csrfHash: await hashCsrfToken(rawCsrf),
    now: input.now,
  });
  return {
    body: {
      accessToken: await issueAccessToken(session.claims, input.signingKey, input.now),
      csrfToken: rawCsrf,
      session: session.view,
    },
    refreshCookie: createRefreshCookie(rawRefresh),
  };
}
```

Bootstrap handoff remains one-time: shared bootstrap stays active until the first individual OPERATOR changes the generated temporary password; that transaction disables bootstrap and revokes bootstrap sessions. Recovery codes are 32 random bytes shown once and stored as peppered HMAC. Every one-time value response has `Cache-Control: no-store`.

- [ ] **Step 4: Verify GREEN and regressions**

Add tests for five-failure D1 lock before bcrypt, success reset, invalid dummy hash fail-closed, no token in logs/DB, refresh expiry, refresh replay, concurrent refresh one-success/one-family-revocation, exact Origin, CSRF mismatch, MUST_CHANGE route restrictions, bootstrap race, recovery-code race, and no automatic retry after bcrypt 503.

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- auth.integration.test.ts bootstrap.integration.test.ts recovery.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/worker run check`

Expected: focused integration tests and strict check PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/test
git commit -m "feat: add rotating JWT account lifecycle"
```

### Task 6: Build organization, account, event, and participant APIs

**Files:**
- Create: `apps/worker/src/db/{admin,events}.ts`
- Create: `apps/worker/src/services/{admin,events}.ts`
- Create: `apps/worker/src/routes/{organizations,users,events,participants}.ts`
- Create: `apps/worker/test/{admin,events,participants}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: organization/user CRUD, event lifecycle, participant master APIs, and session revocation after account changes.

- [ ] **Step 1: Write administration/domain RED tests**

```ts
it("returns a generated temporary password once without persisting plaintext", async () => {
  const response = await operatorPost("/api/v1/users", userFixture);
  expect(response.status).toBe(201);
  const body = await response.json<{ temporaryPassword: string }>();
  expect(body.temporaryPassword).toHaveLength(20);
  expect(await findRawValueInDatabase(body.temporaryPassword)).toBe(false);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("freezes expected snapshots on DAY_OF transition", async () => {
  const response = await transitionEventRequest(event.id, "DAY_OF", event.revision);
  expect(response.status).toBe(200);
  expect(await expectedSnapshot(event.id, organization.id)).toEqual({ expected: 70 });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- admin.integration.test.ts events.integration.test.ts participants.integration.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement scoped administration and lifecycle**

OPERATOR manages all organizations/users/events. ORGANIZATION_MANAGER reads and edits only linked organizations' participants and PRE_REGISTRATION roster data. User create/reset hashes a 20-character temporary password before guarded D1 writes, sets MUST_CHANGE, and returns plaintext once. Role/link/active changes increment `session_version` and revoke sessions.

Event create enforces unique `(year, half)`. Transition uses `expectedRevision`; DAY_OF creates expected snapshot in the same guarded batch; CLOSED rejects every roster mutation; reopen increments revision and preserves historical audit/snapshot records.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- admin.integration.test.ts events.integration.test.ts participants.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/worker run check`

Expected: role scope, stale revision, inactive organization, session revocation, transition, and snapshot tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/test
git commit -m "feat: add event and account administration"
```

### Task 7: Implement roster mutations, summaries, conflicts, and audit history

**Files:**
- Create: `apps/worker/src/db/roster.ts`
- Create: `apps/worker/src/services/roster.ts`
- Create: `apps/worker/src/routes/roster.ts`
- Create: `apps/worker/test/{roster,summary,audit}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: event roster list/add/edit/cancel/reactivate, `GET /summary`, and cursor audit history.

- [ ] **Step 1: Write roster RED tests**

```ts
it("counts pre-event cancellation and day-of addition independently", async () => {
  await enterDayOfWithExpectedCount(100);
  await cancelPreEventParticipant(preEventParticipant.id);
  await addDayOfParticipant(dayOfParticipant.id);
  expect(await getSummary()).toMatchObject({ expectedTotal: 100, finalTotal: 100, deltaTotal: 0 });
});

it("rolls back audit when expected revision is stale", async () => {
  const before = await auditCount(event.id);
  expect((await addRosterEntry({ expectedRevision: event.revision - 1 })).status).toBe(409);
  expect(await auditCount(event.id)).toBe(before);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- roster.integration.test.ts summary.integration.test.ts audit.integration.test.ts`

Expected: FAIL because roster services are absent.

- [ ] **Step 3: Implement roster rules**

Every mutation includes actor scope, event status, organization activity, and revision in the first guard. PRE_REGISTRATION additions use source `PRE_EVENT`; DAY_OF additions use `DAY_OF`; cancellation retains the row and changes status. Re-adding a cancelled row reactivates it without creating a duplicate. Mutation, event revision increment, immutable display snapshot, and append-only audit record share one batch.

Summary uses frozen expected snapshots and active rows only. Audit pagination sorts `(created_at DESC, id DESC)` and returns an opaque base64url cursor containing only those two values.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- roster.integration.test.ts summary.integration.test.ts audit.integration.test.ts`

Expected: source/status accounting, scope, conflict, reopen, append-only, pagination tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/test
git commit -m "feat: add roster operations and summaries"
```

### Task 8: Implement bounded Excel validation, atomic commit, and export-data APIs

**Files:**
- Create: `apps/worker/src/db/imports.ts`
- Create: `apps/worker/src/services/imports.ts`
- Create: `apps/worker/src/routes/imports.ts`
- Create: `apps/worker/test/{imports,import-budget,exports}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: `/events/:id/imports/validate`, `/imports/commit`, `/export-data`, and `buildImportQueryPlan()`.

- [ ] **Step 1: Write import RED tests**

```ts
it("commits 130 valid rows atomically within the D1 budget", async () => {
  const plan = buildImportQueryPlan(validRows(130));
  expect(plan.queryCount).toBeLessThanOrEqual(31);
  expect(Math.max(...plan.bindingCounts)).toBeLessThanOrEqual(100);
  const response = await commitImport(plan.rows, event.revision);
  expect(response.status).toBe(201);
  expect(await activeRosterCount(event.id)).toBe(130);
});

it("leaves no rows when one import row is invalid", async () => {
  const response = await commitImport(rowsWithOneUnknownOrganization(), event.revision);
  expect(response.status).toBe(422);
  expect(await activeRosterCount(event.id)).toBe(0);
  expect(await importRunCount(event.id)).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- imports.integration.test.ts import-budget.integration.test.ts exports.integration.test.ts`

Expected: FAIL because import planner/routes are absent.

- [ ] **Step 3: Implement bounded set-based import/export**

Validation accepts normalized JSON only, performs set reads for organizations/participants/current roster, and returns row issues plus candidate participant IDs. Commit requires the server-returned `eventRevision` and resolved candidates. It uses three pre-batch reads and one guarded `db.batch()` with chunked parameter-bound `VALUES`; it never calls D1 once per row and never interpolates client values into SQL.

At 130 all-new rows, planner caps participant and roster chunks at 16 rows and audit chunks at 24 rows, yielding at most 31 D1 statements and 100 bindings per statement. Export JSON contains deterministic `명단` and `집계` arrays; it contains no auth/security fields.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- imports.integration.test.ts import-budget.integration.test.ts exports.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/worker run check`

Expected: 130-row success, invalid rollback, ambiguity resolution, stale revision, role/status, query/binding budget, export ordering tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src apps/worker/test
git commit -m "feat: add atomic roster import and export data"
```

### Task 9: Build the React design system and ATS-style authentication UI

**Files:**
- Create: `apps/web/src/styles/{tokens,global}.css`
- Create: `apps/web/src/components/ui/{Button,Card,Dialog,TextInput,StatusMessage}.tsx`
- Create: `apps/web/src/lib/{api,auth-session}.ts`
- Create: `apps/web/src/features/auth/{AuthProvider,LoginPage,ChangePasswordPage,RecoveryPage,BootstrapHandoffPage,auth.test}.tsx`
- Create: `apps/web/src/app/{router,AppShell}.tsx`
- Modify: `apps/web/src/{main.tsx,app/App.tsx}`

**Interfaces:**
- Consumes: Task 5 auth endpoints and `AuthSuccess`.
- Produces: memory-only Access JWT/CSRF provider, automatic single refresh on app start/401, and protected route guards.

- [ ] **Step 1: Write auth UI RED tests**

```tsx
it("keeps access and CSRF tokens only in memory", async () => {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("로그인 ID"), "manager-01");
  await userEvent.type(screen.getByLabelText("비밀번호"), "temporary-password-123");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(await screen.findByText("새 비밀번호를 설정하세요.")).toBeVisible();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("does not retry a temporarily unavailable login", async () => {
  mockLogin503();
  render(<LoginPage />);
  await submitCredentials();
  expect(await screen.findByText("잠시 후 다시 로그인해 주세요.")).toBeVisible();
  expect(loginMock).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- auth.test.tsx`

Expected: FAIL because auth UI/provider are absent.

- [ ] **Step 3: Implement provider, API client, and route guards**

`AuthProvider` stores `accessToken`, `csrfToken`, and session only in React state. App start calls `POST /api/v1/auth/refresh` once with `credentials: "include"`; a successful response populates memory. API calls attach `Authorization: Bearer <accessToken>`; mutations also attach `X-ER-CSRF`. One 401 may trigger one refresh guarded by a shared in-flight promise, then retry the original API request once. Login 503 and mutation 5xx are never automatically retried.

Logout calls cookie-based `/auth/logout`, clears state even on network failure, and redirects to `/login`. MUST_CHANGE users can reach only password-change/logout. UI password validation uses the shared 72-byte schema. Design tokens use a new `--er-*` namespace while referencing only the principles in `/Users/coursemos/develop/coursemos-supporter/docs/design-system.md`.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- auth.test.tsx && corepack pnpm@10.28.1 --filter @event-roster/web run check && corepack pnpm@10.28.1 --filter @event-roster/web build`

Expected: auth UI tests, strict check, and production build PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add JWT login and design foundation"
```

### Task 10: Build administration, event, and roster operating screens

**Files:**
- Create: `apps/web/src/features/admin/{OrganizationsPage,UsersPage,UserForm,TemporaryPasswordDialog,admin.test}.tsx`
- Create: `apps/web/src/features/events/{EventsPage,EventForm,EventTransitionDialog,events.test}.tsx`
- Create: `apps/web/src/features/roster/{RosterPage,RosterTable,ParticipantDialog,SummaryCards,AuditPanel,roster.test}.tsx`
- Modify: `apps/web/src/app/{router,AppShell}.tsx`

**Interfaces:**
- Consumes: Tasks 6·7 APIs and Task 9 UI/auth primitives.
- Produces: role-aware management and event-day operating console.

- [ ] **Step 1: Write screen RED tests**

```tsx
it("shows a generated password once and removes it after close", async () => {
  mockUserCreate({ temporaryPassword: "abcdefghjkmnpqrstuvw" });
  render(<UsersPage />);
  await createUserThroughForm();
  expect(await screen.findByText("abcdefghjkmnpqrstuvw")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("abcdefghjkmnpqrstuvw")).not.toBeInTheDocument();
});

it("updates expected and actual totals after a day-of cancellation", async () => {
  render(<RosterPage eventId="event-1" />);
  await cancelRosterRow("박민수");
  expect(await screen.findByText("실제 99명")).toBeVisible();
  expect(screen.getByText("예상 100명")).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- admin.test.tsx events.test.tsx roster.test.tsx`

Expected: FAIL because screen components are absent.

- [ ] **Step 3: Implement role/status-aware screens**

OPERATOR navigation exposes organizations, users, events, roster, audit. ORGANIZATION_MANAGER sees linked organization rows only and no account/event transition controls. Roster table receives at most 130 rows once and filters client-side. Every mutation sends the current event revision; `STALE_REVISION` reloads server data and displays a conflict message without replaying the mutation.

Temporary password/recovery values exist only in dialog state and are cleared on close/unmount. CLOSED displays read-only controls. Summary cards display expected, actual, delta, and organization breakdown from server response.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- admin.test.tsx events.test.tsx roster.test.tsx && corepack pnpm@10.28.1 --filter @event-roster/web run check`

Expected: role visibility, state controls, one-time values, conflict, summary tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: add event roster operating console"
```

### Task 11: Add browser-only Excel import and export UI

**Files:**
- Create: `apps/web/src/lib/excel/{read-workbook,download-workbook}.ts`
- Create: `apps/web/src/features/imports/{ImportWizard,ColumnMapping,ValidationTable,CandidatePicker,imports.test}.tsx`
- Create: `apps/web/src/features/imports/export.test.ts`
- Modify: `apps/web/package.json`, `apps/web/src/app/router.tsx`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 8 normalized import/export APIs.
- Produces: client-only workbook parsing, explicit mapping/validation/commit, and two-sheet download.

- [ ] **Step 1: Write Excel UI RED tests**

```tsx
it("never sends the source workbook to the Worker", async () => {
  const file = workbookFixture([{ 이름: "박민수", 조직: "1팀" }]);
  render(<ImportWizard eventId="event-1" />);
  await selectWorkbook(file);
  await mapColumns({ name: "이름", organization: "조직" });
  await validateRows();
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining("/validate"), {
    rows: [{ rowNumber: 2, name: "박민수", organizationName: "1팀" }],
  });
  expect(JSON.stringify(api.post.mock.calls)).not.toContain(file.name);
});

it("creates exactly roster and summary sheets", async () => {
  const workbook = buildExportWorkbook(exportFixture);
  expect(workbook.SheetNames).toEqual(["명단", "집계"]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- imports.test.tsx export.test.ts`

Expected: FAIL because Excel modules are absent.

- [ ] **Step 3: Implement browser-only workbook flow**

Add `xlsx` only to `apps/web`. Read `await file.arrayBuffer()` in the browser, keep File/ArrayBuffer/source cell matrices in component memory, and send only `NormalizedImportRow[]`. Stages are sheet selection → column mapping → server validation → ambiguous participant resolution → revalidation → atomic commit. Cancel, successful commit, and route leave clear all workbook memory.

`download-workbook.ts` consumes export JSON, creates exactly `명단` and `집계`, and calls `XLSX.writeFile`. It does not call the Worker with generated workbook bytes.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm@10.28.1 install && corepack pnpm@10.28.1 --filter @event-roster/web test -- imports.test.tsx export.test.ts && corepack pnpm@10.28.1 --filter @event-roster/web build`

Expected: workbook-memory, mapping, ambiguity, atomic commit, two-sheet export tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add browser Excel workflows"
```

### Task 12: Add local E2E, CI, low-frequency remote smoke, and Cloudflare runbooks

**Files:**
- Create: `apps/web/{playwright.config.ts,e2e/{auth,event-roster,import-export}.spec.ts,e2e/global-setup.ts}`
- Create: `apps/worker/{wrangler.e2e.jsonc,scripts/{prepare-e2e-env,generate-dummy-bcrypt,smoke-remote}.mts}`
- Create: `.github/workflows/ci.yml`
- Create: `docs/operations/{deployment,recovery,monthly-check}.md`
- Modify: `README.md`, `.gitignore`, `apps/worker/package.json`, `apps/web/package.json`

**Interfaces:**
- Consumes: the complete local application.
- Produces: isolated E2E, credential-free CI, manual production deployment steps, and a three-login low-frequency remote smoke.

- [ ] **Step 1: Write E2E RED scenarios**

```ts
test("temporary user changes password, is logged out, and logs in again", async ({ page }) => {
  await login(page, fixture.loginId, fixture.temporaryPassword);
  await expect(page.getByText("새 비밀번호를 설정하세요.")).toBeVisible();
  await changePassword(page, "new-password-1234");
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  await login(page, fixture.loginId, "new-password-1234");
  await expect(page.getByText("행사 목록")).toBeVisible();
});

test("imports 130 rows and downloads two-sheet Excel", async ({ page }) => {
  await loginAsOperator(page);
  await importWorkbook(page, "130-participants.xlsx");
  await expect(page.getByText("130개 행을 확정했습니다.")).toBeVisible();
  const download = await exportWorkbook(page);
  expect(download.suggestedFilename()).toContain("명단");
});
```

- [ ] **Step 2: Run E2E to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web run e2e`

Expected: FAIL because local E2E state preparation and fixtures are absent.

- [ ] **Step 3: Implement isolated E2E and CI**

`prepare-e2e-env.mts` writes only ignored `apps/worker/.dev.vars`, `apps/worker/.wrangler/e2e-state`, and `apps/web/e2e/.local-e2e-env.json`. It generates nonproduction secrets and cost-12 dummy hash, applies migrations to the exact local persist directory, and never prints secret values. Playwright uses HTTPS localhost, one worker, no existing server reuse, and global setup creates bootstrap/operator/org/event fixtures.

CI runs frozen install, format, strict types, unit/integration tests, web build, Worker dry-run bundle, and Playwright without Cloudflare credentials.

- [ ] **Step 4: Implement the low-frequency remote smoke and runbooks**

`smoke-remote.mts` performs exactly one correct login, one wrong-password login, and one unknown-ID login sequentially with a two-second delay between attempts; it does not retry. It decodes the nonsecret JWT claims to assert `exp - iat = 900`, checks correct status/response semantics, refresh cookie flags, one refresh rotation, logout revocation, and absence of raw credentials in its output. Any 5xx is a smoke FAIL recorded in the deployment log, but does not rewrite ADR 0003.

`deployment.md` requires: `wrangler whoami` → explicit user approval → create D1 → apply remote migration → set five secrets interactively → build → deploy → reconcile the exact printed URL into `APP_ORIGIN` → redeploy → bootstrap → delete `BOOTSTRAP_TOKEN` → run low-frequency smoke → inspect Workers errors/CPU. It must never create production D1 or secrets before approval.

`recovery.md` documents offline recovery-code storage, operator recreation, refresh-session revocation, and backup/export restoration. `monthly-check.md` covers Cloudflare security updates, D1 export/restore drill, secret inventory, and Workers error/CPU review.

- [ ] **Step 5: Verify the complete local deliverable**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: every command exits 0; unit/integration/E2E suites PASS; bundle remains within Workers Free limits; no remote resource is created by verification.

- [ ] **Step 6: Commit local delivery assets**

```bash
git add .github README.md .gitignore apps docs/operations
git commit -m "chore: add Cloudflare delivery verification"
```

- [ ] **Step 7: Deploy only after renewed authority**

Run the exact `docs/operations/deployment.md` sequence only after the user confirms the Cloudflare account and approves one production Worker, one D1 database, and five Worker Secrets. Expected: exact `workers.dev` URL serves the SPA/API, bootstrap token is deleted, low-frequency smoke passes, and no credential/token/hash appears in terminal or Git.

## Plan Self-Review

- [x] Spec coverage: 자체 login ID, bcrypt cost 12, 15분 메모리 Access JWT, 7일 회전 Refresh cookie, D1 revocation/rate limit, bootstrap handoff, 행사/조직/참가자/명단/집계/감사, Excel, E2E/CI/deploy가 각각 Task에 매핑된다.
- [x] Historical consistency: ADR 0003과 실패 evidence를 보존하며 새 ADR 0004가 저빈도 운영 리스크 수용을 별도 기록한다.
- [x] Security consistency: JWT 원문은 메모리만, refresh 원문은 HttpOnly cookie만, CSRF 원문은 메모리만, D1에는 session/refresh/CSRF hash만 저장한다.
- [x] Rotation consistency: login은 session+첫 refresh, refresh는 기존 token 회전+교체 token, replay는 session family 전체 폐기, logout/password/account changes는 session 전체 폐기다.
- [x] Platform consistency: 하나의 same-origin Worker/D1, no CORS/Pages/Access/OTP/Google Cloud, production resource는 Task 12 승인 전 생성하지 않는다.
- [x] Placeholder scan: 금지된 미결정 표기 없이 모든 단계에 정확한 파일·명령·기대 결과가 있다.
- [x] Type consistency: `AccessClaims`, `AuthSuccess`, `AuthSessionView`, `ApiProblem`, `EventSummary`, `NormalizedImportRow` 이름이 모든 Task에서 동일하다.
