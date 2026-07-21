# Event Roster Workers bcrypt MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Worker + D1만으로 bcrypt cost 12 자체 계정 로그인, 행사별 명단·당일 변동·집계·감사·브라우저 Excel 이관/내보내기를 제공하는 내부 운영 도구를 완성한다.

**Architecture:** React/Vite 빌드 결과는 하나의 Hono TypeScript Worker Static Assets로 제공하고, 같은 `workers.dev` origin의 `/api/v1/*`는 Worker가 D1과 함께 처리한다. Worker는 `bcryptjs` cost 12로 임시/일반 비밀번호를 해싱·검증하고, 8시간 `__Host-er_session` JWT와 D1 세션으로 즉시 폐기를 구현한다. bcrypt가 이 실제 Cloudflare runtime에서 안전하게 동작하는지는 앱 코드보다 먼저 단기 capability Worker로 사실 검증한다.

**Tech Stack:** Node 22, pnpm 10.28.1, TypeScript strict, React 19, Vite, Hono, Zod, `bcryptjs`, `jose`, Cloudflare Workers Static Assets/D1, Vitest with `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright, SheetJS `xlsx`, GitHub Actions.

## Global Constraints

- 승인 기준은 [Workers bcrypt 인증 설계](../specs/2026-07-21-event-roster-workers-bcrypt-auth-design.md)와 기존 행사 도메인 설계다.
- Google Cloud, Cloud Run, `gcloud`, FastAPI, Python runtime, Secret Manager, Cloudflare Access, OTP, 외부 IdP는 사용하지 않는다.
- 역사적 `spikes/workers-free-capability`, ADR 0001, 그 factual evidence는 보존하고 수정·삭제·재사용하지 않는다.
- 기존 Cloud Run 로컬 harness와 ADR 0002/Cloud Run 계획은 새 bcrypt capability code를 만들기 전에 정확히 제거하거나 `Superseded`로 표시한다. Cloud Run evidence가 없으므로 사실 PASS/FAIL을 기록하지 않는다.
- 배포 URL은 하나의 `https://<worker-name>.<account-workers-subdomain>.workers.dev` Worker다. 사용자가 현재 제시한 예상 URL은 `https://event-roster.event-roster.workers.dev`지만, 실제 배포 출력으로 확정한 URL만 `APP_ORIGIN`·smoke URL에 쓴다. Pages·별도 API origin·CORS·VM·커스텀 도메인은 만들지 않는다.
- `packageManager`는 정확히 `pnpm@10.28.1`, Node는 `22`, Worker는 `compatibility_date: "2026-07-21"`와 `nodejs_compat`을 사용한다.
- 기존 `pnpm-workspace.yaml`의 `apps/*`, `packages/*`, `spikes/*`, 그리고 `allowBuilds`를 보존한다. capability package를 추가할 때 이 workspace 파일을 덮어쓰지 않는다.
- `apps/web`은 React/Vite, `apps/worker`는 Hono/D1/Worker, `packages/contracts`는 Zod 런타임 계약, `packages/domain`은 순수 도메인 규칙만 가진다.
- 모든 계정은 운영자가 만든다. 로그인 ID는 소문자화 뒤 `^[a-z][a-z0-9._-]{2,31}$`만 허용하고 이메일은 로그인 ID로 쓰지 않는다.
- 새 비밀번호·임시 비밀번호는 `bcryptjs` cost factor `12`로 해싱한다. cost를 낮춰 capability gate를 통과시키는 것은 실패 해결책이 아니다.
- 모든 비밀번호 입력은 UTF-8 기준 72 byte 이하여야 한다. `bcryptjs`의 72-byte truncation을 허용하지 않으며, 계약·UI·`hash()`·`verify()`에서 같은 검사를 수행한다.
- D1에는 `algorithm='bcrypt'`와 bcrypt hash만 저장한다. 원문 비밀번호·salt 원문·JWT 원문·CSRF 원문·복구 코드 원문·bcrypt hash·Worker secrets는 로그, 감사 로그, 일반 DTO, 브라우저 영구 저장소에 남기지 않는다. 단, CSRF 원문은 `/auth/csrf`의 `no-store` 응답에서 provider 메모리로만 전달하고, bootstrap/사용자 발급·재설정/복구의 단회 임시 비밀번호 또는 복구 코드는 `no-store` 응답과 화면 메모리에서 한 번만 전달할 수 있다. 이 예외값도 Query cache·로그·감사에는 남기지 않는다.
- 아직 잠기지 않은 존재하지 않거나 비활성인 사용자는 cost 12 `DUMMY_BCRYPT_HASH`에 대해 정확히 한 번 bcrypt compare를 수행한다. 이미 login ID/IP key가 잠긴 요청은 알려진 사용자·없는 사용자 모두 동일한 401로 비교 없이 거부해 rate limit이 bcrypt CPU 비용도 제한한다. secret이 없거나 hash cost가 12가 아니면 Worker는 fail closed 한다.
- 일반 세션은 8시간 절대 만료 JWT를 `__Host-er_session; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax` 쿠키에만 둔다. refresh token, `Domain`, `localStorage`, `sessionStorage`의 인증 정보는 금지한다.
- 최초 공용 bootstrap 운영자는 one-time handoff로 생성된 **정확히 그 첫 개별 `OPERATOR`** 가 임시 비밀번호를 바꾸는 성공 transaction 안에서만 비활성화한다. 같은 transaction에서 모든 bootstrap 세션을 폐기한다.
- 32 random byte 긴급 복구 코드는 화면에 한 번만 보이고 D1에는 `RECOVERY_CODE_PEPPER` HMAC만 저장한다.
- 로그인과 복구는 HMAC 처리 IP/action key 별 15분 5회 실패에서 잠긴다. IP는 Cloudflare가 제공한 `CF-Connecting-IP`만 사용하고, 임의의 `X-Forwarded-For` 등 클라이언트 헤더는 신뢰하지 않는다. IP 원문은 저장하지 않는다.
- D1 시각은 UTC ISO-8601 문자열, 식별자는 UUID 문자열, 참가자 번호는 `P-` + 대문자 UUID이며 충돌 시 한 번만 재시도한다.
- 행사 전이는 `DRAFT → PRE_REGISTRATION → DAY_OF → CLOSED`, `CLOSED → DAY_OF`만 허용한다. DAY_OF에서 조직별 예상 인원 및 활성 사전명단 membership snapshot을 고정하고 CLOSED는 읽기 전용이다.
- 상태/revision precondition은 `operation_guards`의 false-is-error 첫 batch statement로 강제한다. guard·write·audit·snapshot·import는 한 D1 batch에서 rollback되어야 하며 영향 행 수 0은 성공이 아니다.
- 원본 workbook/파일/셀 행렬은 브라우저 메모리에만 두고, import 130행이 하나라도 실패하면 D1 참가자·명단·감사·import record는 하나도 남지 않는다.
- UI는 `coursemos-supporter/docs/design-system.md`의 토큰/프리미티브 원칙만 참고하고 `--er-*` 토큰을 새로 만든다. 목록은 최대 130행을 한 번에 받고 클라이언트에서 필터한다.
- 배포 Worker의 Wrangler config는 `secrets.required`에 영구 필수 `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `IP_HASH_KEY`, `RECOVERY_CODE_PEPPER`만 선언하고 `wrangler types`로 binding types를 생성한다. smoke 뒤 삭제할 optional `BOOTSTRAP_TOKEN`은 여기에 넣지 않는다.
- 각 구현 Task는 실패 테스트 → 실패 확인 → 최소 구현 → 통과 테스트 → 타입/포맷 검사 → 커밋 순서를 지킨다.

## Scope and stop rule

Task 2는 실제 Workers bcrypt capability gate다. cost 12 bcrypt의 hash·정상 verify·틀린 verify·dummy verify가 각각 warm-up 뒤 50회 의미상 맞게 완료되고 각 warm P95가 1,500 ms 이하이며, 정상 verify와 hash 각각 13개 동시 요청이 모두 8초 안에 성공해야 한다. head sampling 100% Observability가 run ID의 실제 요청 수를 빠짐없이 보여야 하고, 모든 invocation의 `cpuTimeMs <= 10`, `exceededCpu`·OOM·5xx가 0이어야 PASS다. Task 2가 FAIL이면 factual evidence와 ADR만 커밋하고 Task 3 이후를 시작하지 않는다. Task 16의 별도 remote D1 import gate도 PASS하기 전에는 실제 운영 D1을 만들거나 bootstrap하지 않는다.

## Canonical contracts

모든 Task는 아래 이름을 그대로 사용한다. bcrypt hash, JWT 원문, CSRF 원문, recovery HMAC은 API DTO에 넣지 않는다.

```ts
export type Role = "OPERATOR" | "ORGANIZATION_MANAGER";
export type SessionKind = "FULL" | "MUST_CHANGE_PASSWORD";
export type EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED";
export type Half = "H1" | "H2";
export type RosterSource = "PRE_EVENT" | "DAY_OF";
export type RosterStatus = "ACTIVE" | "CANCELLED";

export interface Env {
  DB: D1Database;
  APP_ORIGIN: string;
  JWT_SIGNING_KEY: string;
  DUMMY_BCRYPT_HASH: string;
  IP_HASH_KEY: string;
  BOOTSTRAP_TOKEN?: string;
  RECOVERY_CODE_PEPPER: string;
}

export interface PasswordHasher {
  assertPasswordWithinBcryptLimit(password: string): void;
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
  assertPolicyHash(passwordHash: string): void;
}

export interface AppDependencies {
  passwordHasher: PasswordHasher;
  now(): Date;
  randomBytes(length: number): Uint8Array;
}

export interface Actor {
  id: string;
  loginId: string;
  role: Role;
  organizationIds: readonly string[];
  sessionId: string;
  sessionVersion: number;
  sessionKind: SessionKind;
  isBootstrap: boolean;
}

export interface CurrentSession {
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

export interface SessionClaims {
  sub: string;
  sid: string;
  sv: number;
  kind: SessionKind;
  iss: "event-roster";
  aud: "event-roster-web";
  iat: number;
  exp: number;
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

export interface ImportResolution {
  rowNumber: number;
  participantId: string;
}

export interface NormalizedImportRow {
  rowNumber: number;
  name: string;
  organizationName: string;
  /** Required only when validate returned multiple candidate participants. */
  resolvedParticipantId?: string;
}

export interface ApiProblem {
  code:
    | "AUTHENTICATION_REQUIRED"
    | "FORBIDDEN"
    | "INVALID_CSRF"
    | "INVALID_RECOVERY_CODE"
    | "INVALID_TRANSITION"
    | "EVENT_CLOSED"
    | "STALE_REVISION"
    | "VALIDATION_FAILED"
    | "RATE_LIMITED"
    | "NOT_FOUND"
    | "INTERNAL_ERROR";
  message: string;
  requestId: string;
  details?: unknown;
}
```

| API | Request | Success result |
| --- | --- | --- |
| `POST /api/v1/bootstrap` | `BootstrapRequest`, `X-ER-Bootstrap-Token` | bootstrap 사용자, 임시 비밀번호, 단회 복구 코드 |
| `POST /api/v1/bootstrap/first-operator` | bootstrap FULL 세션 CSRF, 첫 운영자 DTO | 첫 개별 운영자, 단회 임시 비밀번호 |
| `POST /api/v1/auth/login` | `{ loginId, password }` | `CurrentSession`, 세션 쿠키 |
| `GET /api/v1/auth/me` | 없음 | `CurrentSession` |
| `GET /api/v1/auth/csrf` | 인증 쿠키, 정확한 `Origin` | 회전된 `{ csrfToken }` |
| `POST /api/v1/auth/change-password`, `POST /api/v1/auth/logout` | `{ password }`, 없음 | `204` |
| `POST /api/v1/auth/recover` | `{ recoveryCode, loginId, displayName, password }` | 새 운영자, 단회 교체 복구 코드 |
| `GET/POST/PATCH /api/v1/organizations` | 조직 DTO | 조직 또는 목록 |
| `GET/POST/PATCH /api/v1/users` | 사용자 DTO | 사용자 또는 목록, 생성/재설정 시 단회 임시 비밀번호 |
| `GET/POST/PATCH /api/v1/participants` | 검색/참가자 DTO | 참가자 또는 목록 |
| `GET/POST/PATCH /api/v1/events`, `POST /api/v1/events/:id/transition` | 행사 DTO, revision | 행사 또는 목록 |
| `GET/POST/PATCH /api/v1/events/:id/roster` | 참가자 ID와 revision 명령 | 명단 또는 목록 |
| `GET /api/v1/events/:id/summary`, `GET /api/v1/events/:id/audit-logs` | 없음, cursor | 집계, 감사 페이지 |
| `POST /api/v1/events/:id/imports/validate` | 정규화된 rows | `eventRevision`, 행별 issue/candidate 목록 |
| `POST /api/v1/events/:id/imports/commit` | `{ expectedEventRevision, rows: NormalizedImportRow[] }` | 확정 결과 |
| `GET /api/v1/events/:id/export-data` | 없음 | 브라우저 xlsx 생성용 JSON |

## Target file structure

```text
event-roster/
├── pnpm-workspace.yaml
├── apps/
│   ├── worker/
│   │   ├── migrations/0001_initial.sql
│   │   ├── src/{app,index,env}/
│   │   ├── src/{db,services,routes,middleware,security,http}/
│   │   ├── scripts/{prepare-e2e-env,generate-dummy-bcrypt,smoke-remote}.mts
│   │   └── test/
│   └── web/
│       ├── src/{app,components/ui,features,lib,styles}/
│       └── e2e/
├── packages/
│   ├── contracts/src/{common,auth,organizations,participants,events,roster,imports,exports,api,index}.ts
│   └── domain/src/{errors,authorization,event-lifecycle,roster,summary,import-validation,index}.ts
├── spikes/
│   ├── workers-free-capability/          # historical; never modify
│   └── workers-bcrypt-capability/
│       ├── src/{env,index,password,evidence}.ts
│       ├── scripts/{generate-dummy,run-remote-probe,assert-evidence}.mts
│       └── test/
├── docs/{adr,operations,superpowers/evidence}/
└── .github/workflows/ci.yml
```

### Task 1: Replace the obsolete Cloud Run harness with a local bcrypt capability harness

**Files:**
- Delete: `apps/password-service/`
- Delete: `spikes/cloud-run-auth-capability/`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/adr/0002-cloud-run-password-service-capability.md`
- Modify: `docs/superpowers/plans/2026-07-20-event-roster-cloud-run-auth-mvp.md`
- Modify: `docs/superpowers/specs/2026-07-20-event-roster-cloud-run-auth-design.md`
- Create: `spikes/workers-bcrypt-capability/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.ts,worker-configuration.d.ts}`
- Create: `spikes/workers-bcrypt-capability/src/{env,index,password,evidence}.ts`
- Create: `spikes/workers-bcrypt-capability/scripts/{generate-dummy,run-remote-probe,assert-evidence}.mts`
- Create: `spikes/workers-bcrypt-capability/test/{password,index,evidence}.test.ts`
- Create: `docs/adr/0003-workers-bcrypt-capability-gate.md`

**Interfaces:**
- Consumes: only `DUMMY_BCRYPT_HASH` and `CAPABILITY_PROBE_TOKEN` as Worker secrets.
- Produces: a disposable `POST /probe?run=<uuid>` Worker endpoint and a nonsecret factual evidence format for Task 2.

- [ ] **Step 1: Verify and remove only superseded local Cloud Run files**

Run these read-only commands first. They must list exactly the generated Cloud Run harness and no historical PBKDF2 files:

```bash
git ls-files apps/password-service
git ls-files spikes/cloud-run-auth-capability
git ls-files spikes/workers-free-capability docs/adr/0001-workers-free-capability-gate.md
```

Expected: the first two lists are Cloud Run files; the third contains historical files that must remain. Then remove exactly the first two paths with `git rm -r apps/password-service` and `git rm -r spikes/cloud-run-auth-capability`. Make only these status edits, without altering factual content:

- ADR 0002: replace `- Status: Pending remote verification` with `- Status: Superseded by 2026-07-21 Workers bcrypt design; no remote Cloud Run gate was run.`
- old design: replace the `**상태:**` value with `Superseded by 2026-07-21 Workers bcrypt design; no remote Cloud Run gate was run.`
- old plan: insert `> **Status:** Superseded by 2026-07-21 Workers bcrypt design; no remote Cloud Run gate was run.` directly below its agentic-workers note.

- [ ] **Step 2: Preserve the existing workspace and create the test runner skeleton, then write failing bcrypt probe tests**

First read the existing `pnpm-workspace.yaml` and confirm it already includes `spikes/*` and retains its `allowBuilds` map. Do not replace it. Create the capability package manifest with package name `@event-roster/workers-bcrypt-capability`, scripts `test`, `check` (`tsc --noEmit`), and `generate:dummy` (`tsx scripts/generate-dummy.mts`); add runtime dependencies `bcryptjs`, `hono`, and `zod`, plus dev dependencies `@cloudflare/vitest-pool-workers`, `tsx`, `typescript`, `vitest@^4.1.0`, and `wrangler`. Its `tsconfig.json` is strict, uses `moduleResolution: "Bundler"`, `lib: ["ES2023", "WebWorker"]`, and `esModuleInterop: true` for the bcrypt default import. Keep every version range in this package consistent with the versions later selected for the Worker shell. `vitest.config.ts` uses the Worker runtime, not Node:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
```

Run `corepack pnpm install` once the manifests exist. The tests below must then fail only because the intended source modules/routes do not exist.

```ts
// spikes/workers-bcrypt-capability/test/password.test.ts
import { expect, it } from "vitest";
import { BCRYPT_COST, assertCostTwelveHash, hashPassword, verifyPassword } from "../src/password";

it("creates a cost-12 bcrypt hash that verifies only the original password", async () => {
  const hash = await hashPassword("temporary-password-123");
  expect(BCRYPT_COST).toBe(12);
  expect(assertCostTwelveHash(hash)).toBeUndefined();
  await expect(verifyPassword("temporary-password-123", hash)).resolves.toBe(true);
  await expect(verifyPassword("different-password-123", hash)).resolves.toBe(false);
});

it("rejects a bcrypt hash with a different cost", () => {
  expect(() => assertCostTwelveHash("$2b$10$abcdefghijklmnopqrstuu5Lo0g67Ci6lM/AJwT0cAWVf4q.MQxPUu")).toThrow();
});
```

```ts
// spikes/workers-bcrypt-capability/test/index.test.ts
import { expect, it, vi } from "vitest";
import { createProbeApp } from "../src/index";

it("returns 404 for a wrong probe token without running bcrypt", async () => {
  const passwordSpy = {
    hash: vi.fn(),
    verify: vi.fn(),
    assertCostTwelveHash: vi.fn(),
  };
  const app = createProbeApp(
    { DUMMY_BCRYPT_HASH: "$2b$12$abcdefghijklmnopqrstuu5Lo0g67Ci6lM/AJwT0cAWVf4q.MQxPUu", CAPABILITY_PROBE_TOKEN: "probe-token" },
    { password: passwordSpy },
  );
  const response = await app.request("https://probe.test/probe", {
    method: "POST",
    headers: { "content-type": "application/json", "X-ER-Probe-Token": "wrong" },
    body: JSON.stringify({ operation: "dummy" }),
  });
  expect(response.status).toBe(404);
  expect(passwordSpy.verify).not.toHaveBeenCalled();
});
```

The intentionally nonexistent module in the RED state makes this test fail to import first. `createProbeApp(env, { password })` is the test seam; the default Worker export creates the app with the real bcrypt hasher.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `corepack pnpm --filter @event-roster/workers-bcrypt-capability test -- password.test.ts index.test.ts`

Expected: FAIL with missing `src/password` and Worker entrypoint modules.

- [ ] **Step 4: Implement the disposable Worker without D1 or assets**

```ts
// spikes/workers-bcrypt-capability/src/password.ts
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

export function assertCostTwelveHash(passwordHash: string): void {
  if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    throw new Error("invalid_bcrypt_policy_hash");
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  assertCostTwelveHash(passwordHash);
  return bcrypt.compare(password, passwordHash);
}
```

Define `CapabilityEnv` as exactly `{ DUMMY_BCRYPT_HASH: string; CAPABILITY_PROBE_TOKEN: string }`. At each request, validate the dummy hash cost before accepting the token. Implement `constantTimeEqualUtf8(left, right)` by returning false for different UTF-8 byte lengths and otherwise XORing every byte before a single equality decision; return generic 404 for token or route failure.

Validate a discriminated Zod union with only `hash`, `correct`, `wrong`, and `dummy` operations. The body contains only `{ operation }`; it never accepts or returns a password or bcrypt hash. `hash` hashes the fixed ASCII test input `event-roster-dummy-account-v1`, validates cost 12 internally, then returns only `{ hashed: true }`. `correct`, `wrong`, and `dummy` respectively compare fixed inputs with `env.DUMMY_BCRYPT_HASH` and return only `{ verified: true }`, `{ verified: false }`, `{ verified: false }`. The raw hash stays inside the Worker throughout. Require a UUID `run` query parameter at `POST /probe?run=<uuid>` so the remote invocation logs can be correlated without storing a secret.

`wrangler.jsonc` must have Worker name `event-roster-bcrypt-capability`, `workers_dev: true`, `compatibility_date: "2026-07-21"`, `compatibility_flags: ["nodejs_compat"]`, `observability: { enabled: true, head_sampling_rate: 1 }`, and no D1/assets binding. It declares both temporary secrets in `secrets.required`, then `wrangler types` generates `worker-configuration.d.ts`. `generate-dummy.mts` hashes exactly `event-roster-dummy-account-v1` and writes only a cost-12 bcrypt hash to stdout. The remote driver records only allowed timing/status/boolean/operation fields and never reads a raw hash from a response.

- [ ] **Step 5: Add failing evidence-validator tests, then implement fail-closed evidence**

```ts
// spikes/workers-bcrypt-capability/test/evidence.test.ts
it("rejects missing attempts instead of padding them with zero milliseconds", () => {
  expect(() => assertCapabilityPass(partialEvidence)).toThrow("correct count");
});

it("accepts exactly 3 warm-ups plus 50 hash/correct/wrong/dummy and 13+13 concurrent semantic attempts", () => {
  expect(() => assertCapabilityPass(passingEvidence)).not.toThrow();
});
```

Run: `corepack pnpm --filter @event-roster/workers-bcrypt-capability test -- evidence.test.ts`

Expected: FAIL because `assertCapabilityPass` does not exist.

Implement `src/evidence.ts` to require exactly three unmeasured warm-ups for each sequential operation, then exactly 50 `hash=true`, 50 `correct=true`, 50 `wrong=false`, and 50 `dummy=false` measured attempts; it also requires exactly 13 concurrent correct `true` and 13 concurrent hash `true` attempts. Require finite non-negative milliseconds, each sequential P95 `<= 1500`, every concurrent attempt `<= 8000`, and no non-2xx status. The driver must make exactly 238 HTTP requests (`12 warm-ups + 200 measured sequential + 26 concurrent`) without retries, use one UUID run ID in every URL, and write an evidence document even after HTTP/transport failures; it must preserve only actual attempts and never pad missing attempts. `assert-evidence.mts --latest` must fail closed for partial/failing evidence.

- [ ] **Step 6: Verify local harness and commit**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @event-roster/workers-bcrypt-capability test
corepack pnpm --filter @event-roster/workers-bcrypt-capability run check
corepack pnpm exec biome check spikes/workers-bcrypt-capability
```

Expected: PASS. Confirm `git status --short` contains no deleted historical PBKDF2 path and no generated hash/evidence. Commit:

```bash
git add -u apps/password-service spikes/cloud-run-auth-capability docs/adr/0002-cloud-run-password-service-capability.md docs/superpowers/plans/2026-07-20-event-roster-cloud-run-auth-mvp.md docs/superpowers/specs/2026-07-20-event-roster-cloud-run-auth-design.md
git add spikes/workers-bcrypt-capability docs/adr/0003-workers-bcrypt-capability-gate.md pnpm-lock.yaml
git commit -m "chore: replace Cloud Run auth harness with bcrypt gate"
```

### Task 2: Deploy and decide the factual Workers bcrypt capability gate

**Files:**
- Modify: `docs/adr/0003-workers-bcrypt-capability-gate.md`
- Create: `docs/superpowers/evidence/workers-bcrypt-${runId}.json` only after a real remote run

**Interfaces:**
- Consumes: Task 1 temporary Worker and interactive `DUMMY_BCRYPT_HASH`, `CAPABILITY_PROBE_TOKEN` secrets.
- Produces: a factual PASS/FAIL decision that gates every remaining Task.

- [ ] **Step 1: Confirm Cloudflare authority before external changes**

Run: `corepack pnpm --dir spikes/workers-bcrypt-capability exec wrangler whoami`

Expected: the intended Cloudflare account. If it is unauthenticated, the account differs, or the user has not authorized a temporary remote Worker and two Worker Secrets, stop and ask before continuing. Do not create a D1 database in this task.

- [ ] **Step 2: Create nonpersistent probe secrets without terminal disclosure**

Generate the dummy hash into Wrangler stdin only:

```bash
corepack pnpm --dir spikes/workers-bcrypt-capability exec tsx scripts/generate-dummy.mts | corepack pnpm --dir spikes/workers-bcrypt-capability exec wrangler secret put DUMMY_BCRYPT_HASH
```

For a probe token, use a no-echo operator prompt and retain it only in the current shell:

```bash
read -rs CAPABILITY_PROBE_TOKEN; printf '\n'
export CAPABILITY_PROBE_TOKEN
printf %s "$CAPABILITY_PROBE_TOKEN" | corepack pnpm --dir spikes/workers-bcrypt-capability exec wrangler secret put CAPABILITY_PROBE_TOKEN
```

Never paste either value into a command argument, file, evidence, log, or Git commit.

- [ ] **Step 3: Deploy the temporary Worker and run the factual probe**

Run:

```bash
corepack pnpm --dir spikes/workers-bcrypt-capability exec wrangler deploy
# Copy only the exact https://... URL printed by the deploy command; do not construct it from an assumed account subdomain.
read -r CAPABILITY_PROBE_URL
export CAPABILITY_PROBE_URL
corepack pnpm --dir spikes/workers-bcrypt-capability exec tsx scripts/run-remote-probe.mts
unset CAPABILITY_PROBE_TOKEN
unset CAPABILITY_PROBE_URL
```

After `wrangler deploy` prints the temporary Worker URL, paste that URL into the no-echo-free `read` prompt above; it is nonsecret. Expected: the driver prints exactly one evidence path and never prints a password, bcrypt hash, token, or secret. It must call the temporary Worker rather than a browser or local endpoint.

- [ ] **Step 4: Assert evidence and inspect Worker Observability**

Run: `corepack pnpm --dir spikes/workers-bcrypt-capability exec tsx scripts/assert-evidence.mts --latest`

Expected PASS only when all 50 hash/correct/wrong/dummy semantic attempts and 13+13 concurrent attempts meet the global stop rule. In the Cloudflare dashboard, wait for the 100%-sampled invocation events, filter the temporary Worker by the evidence `run` UUID/time window, and verify exactly 238 invocation events are present. Record the event count, every event's `cpuTimeMs` maximum, and counts of 5xx, `exceededCpu`, and OOM outcomes. Missing, delayed beyond the documented dashboard refresh window, or partially sampled events are a FAIL—not evidence of zero errors. Do not record raw request bodies or headers.

- [ ] **Step 5: Record factual decision, clean temporary resources, and stop correctly**

Update ADR 0003 with actual Worker version, deploy-printed URL, evidence path, per-operation P95 values, exact expected/observed event counts, maximum `cpuTimeMs`, observability counts, and PASS or FAIL. If assertion or Observability fails, commit only ADR/evidence with `docs: record Workers bcrypt capability failure`, delete the temporary Worker, and stop this plan. If all conditions pass, commit with `feat: prove Workers bcrypt capability`, then delete the temporary Worker:

```bash
git add docs/adr/0003-workers-bcrypt-capability-gate.md docs/superpowers/evidence/workers-bcrypt-*.json
git commit -m "feat: prove Workers bcrypt capability"
corepack pnpm --dir spikes/workers-bcrypt-capability exec wrangler delete --force
```

Expected after deletion: `/probe` is no longer a successful remote endpoint. Preserve the committed factual evidence and ADR.

### Task 3: Build the monorepo shell and same-origin Worker delivery

**Files:**
- Create: `.nvmrc`
- Modify: `.gitignore`
- Create: `apps/worker/{package.json,tsconfig.json,wrangler.jsonc,wrangler.test.jsonc,vitest.config.ts,worker-configuration.d.ts}`
- Create: `apps/worker/{migrations/.gitkeep,src/env.ts,src/index.ts,src/app.ts,src/routes/health.ts}`
- Create: `apps/worker/test/{tsconfig.json,setup-d1.ts,env.d.ts,health.integration.test.ts}`
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`
- Create: `apps/web/{src/main.tsx,src/app/App.tsx,src/app/App.test.tsx,test/setup.ts}`

**Interfaces:**
- Consumes: PASS ADR 0003.
- Produces: `GET /api/v1/health -> { status: "ok" }`, same-origin Static Assets routing, and a React root.

- [ ] **Step 1: Write failing Worker and React smoke tests**

```ts
// apps/worker/test/health.integration.test.ts
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("returns JSON from the same-origin health endpoint", async () => {
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

it("renders the service shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "행사 참가자 명단" })).toBeVisible();
});
```

- [ ] **Step 2: Configure packages and verify RED**

Set `.nvmrc` to `22`. Add `hono`, `zod`, `jose`, `@cloudflare/vitest-pool-workers`, `wrangler`, React, React Router, TanStack Query, React Hook Form, Testing Library, Vite, `vitest@^4.1.0`, and TypeScript to the correct workspace package only. Worker TypeScript is strict with Bundler resolution, WebWorker lib, and `esModuleInterop: true`; Task 6 adds `bcryptjs` to the Worker package. Add `apps/worker/.wrangler`, `apps/worker/.dev.vars`, E2E secrets/state, Python caches, and Playwright artifacts to `.gitignore`.

Run:

```bash
corepack pnpm install
corepack pnpm --filter @event-roster/worker test -- health.integration.test.ts
corepack pnpm --filter @event-roster/web test -- App.test.tsx
```

Expected: both FAIL because the Worker and `App` entrypoints do not exist.

- [ ] **Step 3: Implement shell configuration and entrypoints**

```jsonc
// apps/worker/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "event-roster",
  "main": "./src/index.ts",
  "compatibility_date": "2026-07-21",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  // This initial value is the user-provided expected URL. Task 16 must compare it to deploy output before bootstrap.
  "vars": { "APP_ORIGIN": "https://event-roster.event-roster.workers.dev" },
  "assets": {
    "directory": "../web/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "event-roster",
    "database_id": "00000000-0000-0000-0000-000000000000",
    "migrations_dir": "./migrations"
  }]
}
```

Create a separate `apps/worker/wrangler.test.jsonc` with the same `main`, compatibility date/flags, and test-only zero-ID D1 binding, but **no `assets` block** and `vars.APP_ORIGIN = "https://event-roster.test"`. It never deploys. This keeps Miniflare integration tests independent of a not-yet-built `apps/web/dist`, while the production config remains the source for `wrangler types` and real assets.

```ts
// apps/worker/src/app.ts
import { Hono } from "hono";
import type { Env } from "./env";
import { health } from "./routes/health";

export function createApp() {
  return new Hono<{ Bindings: Env }>().route("/api/v1/health", health);
}
```

```ts
// apps/worker/src/routes/health.ts
import { Hono } from "hono";
export const health = new Hono().get("/", (c) => c.json({ status: "ok" as const }));
```

Use `cloudflareTest()` and `readD1Migrations()` with this exact migration setup; do not rely on one test file's D1 rows in another test file:

```ts
// apps/worker/vitest.config.ts
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    })],
    test: { setupFiles: ["./test/setup-d1.ts"] },
  };
});
```

```jsonc
// apps/worker/test/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": ["@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

```ts
// apps/worker/test/setup-d1.ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

The zero D1 UUID is test-only and Task 16 replaces the production-config value before any remote deploy.

Run `corepack pnpm --dir apps/worker exec wrangler types` after saving `wrangler.jsonc` and commit its generated `worker-configuration.d.ts`; `src/env.ts` must re-export/use that binding shape rather than duplicate a divergent `Env` declaration.

For Worker integration tests that exercise an Origin-checked mutation, use `https://event-roster.test` as both request URL and `Origin` header so it matches the isolated test binding; this is a local Miniflare request, not a remote call. Do not weaken the exact-origin middleware merely to use arbitrary origins in tests.

- [ ] **Step 4: Verify and commit the shell**

Run:

```bash
corepack pnpm --filter @event-roster/worker test
corepack pnpm --filter @event-roster/web test
corepack pnpm --filter @event-roster/web build
corepack pnpm --filter @event-roster/worker run check
corepack pnpm --filter @event-roster/web run check
```

Expected: PASS. Build the web package first, then manually run `corepack pnpm --dir apps/worker exec wrangler dev --port 8787`; verify `/api/v1/health` returns `200` JSON and `/events/example` returns `200` SPA HTML. This manual assertion is required because `exports.default.fetch()` does not exercise Static Assets routing. Commit `feat: add Worker and web application shell`.

### Task 4: Define shared contracts and pure domain rules

**Files:**
- Create: `packages/contracts/{package.json,tsconfig.json,src/{common,auth,organizations,participants,events,roster,imports,exports,api,index}.ts,test/contracts.test.ts}`
- Create: `packages/domain/{package.json,tsconfig.json,src/{errors,authorization,event-lifecycle,roster,summary,import-validation,index}.ts,test/{authorization,event-lifecycle,roster,summary,import-validation}.test.ts}`
- Modify: `apps/worker/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: Zod schemas plus `assertOrganizationWriteAccess`, `assertEventTransition`, `assertRosterWritable`, `assertFreshRevision`, `buildEventSummary`, and `validateNormalizedImportRows`.

- [ ] **Step 1: Write contract and domain RED tests**

```ts
// packages/contracts/test/contracts.test.ts
import { expect, it } from "vitest";
import { LoginIdSchema, LoginRequestSchema } from "../src/auth";

it("canonicalizes only approved English login IDs", () => {
  expect(LoginIdSchema.parse("MinSu.Kim")).toBe("minsu.kim");
  expect(() => LoginRequestSchema.parse({ loginId: "한글", password: "temporary-password-123" })).toThrow();
});
```

```ts
// packages/domain/test/summary.test.ts
import { expect, it } from "vitest";
import { buildEventSummary } from "../src/summary";

it("uses SQL-authoritative active roster count for final, not a derived cancellation formula", () => {
  expect(buildEventSummary("event-1", [{ organizationId: "org-1", organizationName: "개발팀", expected: 5, final: 6, dayOfAdded: 2, dayOfCancelled: 1 }]))
    .toMatchObject({ expectedTotal: 5, finalTotal: 6, deltaTotal: 1 });
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/contracts test && corepack pnpm --filter @event-roster/domain test`

Expected: FAIL with missing package/module errors.

- [ ] **Step 3: Implement schemas and DB-free rules**

```ts
// packages/contracts/src/auth.ts
import { z } from "zod";

export const LoginIdSchema = z.string().trim().transform((value) => value.toLowerCase()).pipe(
  z.string().regex(/^[a-z][a-z0-9._-]{2,31}$/),
);
const BCRYPT_MAX_PASSWORD_BYTES = 72;
export const PasswordSchema = z.string().min(12).max(128).superRefine((value, context) => {
  if (new TextEncoder().encode(value).byteLength > BCRYPT_MAX_PASSWORD_BYTES) {
    context.addIssue({ code: "custom", message: "비밀번호는 UTF-8 기준 72 byte 이하여야 합니다." });
  }
});
export const LoginRequestSchema = z.object({ loginId: LoginIdSchema, password: PasswordSchema });
export const RecoveryRequestSchema = z.object({
  recoveryCode: z.string().min(40).max(128),
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(80),
  password: PasswordSchema,
});
```

Add RED/green tests for exactly 72 bytes and rejection at 73 bytes using ASCII, Korean, and emoji input; the browser must display the same validation message before a request is sent. Define every API request/response schema in the canonical table. User schemas use `loginId`, never email; password hashes, source/status controlled fields, snapshots, and audit actors are never client writable. `packages/domain` may depend only on `@event-roster/contracts` and imports no Hono, D1, React, bcrypt, or Worker API.

For imports, `validate` returns for each ambiguous row a stable candidate list `{ participantId, participantNumber, name, organizationName }`. The client may put `resolvedParticipantId` only on that row in a later validate/commit request. `commit` re-resolves it from D1 and rejects if it is not one of the current candidate rows with the requested normalized name/organization; it never trusts a client-supplied participant ID as a general write target. Nonambiguous existing rows and new rows must omit `resolvedParticipantId`.

Both workspace manifests expose only `./src/index.ts` through `exports` and use TypeScript `moduleResolution: "Bundler"`; `@event-roster/domain` declares `@event-roster/contracts` as `workspace:*`. The Worker and web package manifests consume those workspace packages through `workspace:*`, never copied schema files or relative imports across package boundaries.

- [ ] **Step 4: Verify contracts and commit**

Run: `corepack pnpm --filter @event-roster/contracts test && corepack pnpm --filter @event-roster/domain test && corepack pnpm --filter @event-roster/contracts run check && corepack pnpm --filter @event-roster/domain run check`

Expected: PASS. Commit `feat: add event roster contracts and domain rules`.

### Task 5: Create the D1 schema and guarded atomic-test foundation

**Files:**
- Create: `apps/worker/migrations/0001_initial.sql`
- Create: `apps/worker/src/db/{atomic,rows}.ts`
- Create: `apps/worker/test/support/{ids,http}.ts`
- Create: `apps/worker/test/{schema,atomic}.integration.test.ts`
- Modify: `apps/worker/vitest.config.ts`

**Interfaces:**
- Produces: bcrypt credential schema, append-only audit/security tables, and `runGuardedAtomic()` for all state/revision-sensitive writes.

- [ ] **Step 1: Write schema and rollback RED tests**

```ts
// apps/worker/test/schema.integration.test.ts
it("rejects duplicate canonical login IDs and event year/half", async () => {
  const ids = testIds();
  await env.DB.prepare("INSERT INTO users (id,login_id,login_id_canonical,display_name,role,is_active,is_bootstrap,session_version,created_at,updated_at) VALUES (?1,'minsu','minsu','민수','OPERATOR',1,0,1,?2,?2)")
    .bind(ids.user1, now).run();
  await expect(env.DB.prepare("INSERT INTO users (id,login_id,login_id_canonical,display_name,role,is_active,is_bootstrap,session_version,created_at,updated_at) VALUES (?1,'MinSu','minsu','다른 민수','OPERATOR',1,0,1,?2,?2)")
    .bind(crypto.randomUUID(), now).run()).rejects.toThrow();
});
```

```ts
// apps/worker/test/atomic.integration.test.ts
it("rolls back an earlier audit insert when a later statement violates a constraint", async () => {
  const operationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = "2026-07-21T00:00:00.000Z";
  await expect(runGuardedAtomic(env.DB, {
    operationId,
    guard: env.DB.prepare("INSERT INTO operation_guards (id,ok) VALUES (?1,1)").bind(operationId),
    statements: [
      env.DB.prepare("INSERT INTO audit_logs (id,entity,action,created_at) VALUES (?1,'event','TEST',?2)").bind(auditId, now),
      env.DB.prepare("INSERT INTO audit_logs (id,entity,action,created_at) VALUES (?1,'event','TEST',?2)").bind(auditId, now),
    ],
    guardProblem: "STALE_REVISION",
  })).rejects.toThrow();
  expect((await env.DB.prepare("SELECT COUNT(*) count FROM audit_logs WHERE id=?1").bind(auditId).first<{ count: number }>())?.count).toBe(0);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts`

Expected: FAIL because schema and `runGuardedAtomic` are absent.

- [ ] **Step 3: Implement the complete initial migration and guard helper**

Create `organizations`, `users`, `user_organizations`, `password_credentials`, `auth_sessions`, `login_attempts`, `security_events`, `bootstrap_locks`, `recovery_codes`, `operation_guards`, `participants`, `events`, `event_roster_entries`, `event_expected_snapshots`, `audit_logs`, and `import_runs`. Every FK uses `ON DELETE RESTRICT`; booleans are `INTEGER CHECK(value IN (0,1))`; all IDs are TEXT UUIDs.

`bootstrap_locks` is a singleton and includes nullable `handoff_user_id REFERENCES users(id)` plus `handoff_claimed_at`; this is the sole authority for the exact user allowed to disable bootstrap. `event_roster_entries` stores immutable-at-close participant/organization display snapshots and `was_expected_at_day_of INTEGER NOT NULL DEFAULT 0`. At PRE_REGISTRATION→DAY_OF, the batch sets this flag only on then-ACTIVE PRE_EVENT entries while writing organization expected-count snapshots; a pre-event row canceled before the transition remains `0`.

`auth_sessions` includes `id`, `user_id`, `session_version`, `kind`, `csrf_hash`, `issued_at`, `expires_at`, and nullable `revoked_at`; `csrf_hash` is a 64-character SHA-256 hex/base64url digest, never a raw token. `login_attempts` includes an action enum, HMACed login/IP key, outcome, and timestamp; it never stores an IP or password field.

`password_credentials` must be:

```sql
CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  algorithm TEXT NOT NULL CHECK(algorithm = 'bcrypt'),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL CHECK(must_change_password IN (0,1)),
  changed_at TEXT NOT NULL
);
```

`operation_guards` has `id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1)` and a BEFORE INSERT trigger that raises `operation_guard_rejected` if `NEW.ok <> 1`. Add BEFORE UPDATE and BEFORE DELETE append-only triggers to `audit_logs` and `security_events` that raise `append-only`.

Do not implement a false guard as `INSERT ... SELECT ... WHERE predicate`: a false predicate would insert no row and D1 would treat the batch as successful. Each service instead builds its **first** batch statement in this shape, with all values bound:

```sql
INSERT INTO operation_guards (id, ok)
VALUES (
  ?1,
  CASE WHEN EXISTS (
    SELECT 1 FROM events
    WHERE id = ?2 AND revision = ?3 AND status IN ('PRE_REGISTRATION', 'DAY_OF')
  ) THEN 1 ELSE 0 END
);
```

For each domain operation, replace the inner `EXISTS` predicate with its exact actor/scope/status/revision condition. The trigger aborts `ok=0`, so a false precondition is a first-statement error rather than a zero-row success. Expose a small `makeGuardStatement()` factory only if it can bind values; never concatenate client values into SQL.

```ts
// apps/worker/src/db/atomic.ts
export async function runGuardedAtomic(
  db: D1Database,
  input: { operationId: string; guard: D1PreparedStatement; statements: readonly D1PreparedStatement[]; guardProblem: ApiProblem["code"] },
): Promise<D1Result[]> {
  try {
    return await db.batch([
      input.guard,
      ...input.statements,
      db.prepare("DELETE FROM operation_guards WHERE id=?1").bind(input.operationId),
    ]);
  } catch (error) {
    if (String(error).includes("operation_guard_rejected")) throw new OperationGuardError(input.guardProblem);
    throw error;
  }
}
```

Every later write in a guarded batch must include `WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id=?1)`. Tests use isolated Worker storage and UUID-scoped rows; no test may delete audit/security data. Add a RED regression that uses `CASE WHEN 0 THEN 1 ELSE 0 END` after writing an audit row in the same batch and proves both the guard and audit insert roll back.

- [ ] **Step 4: Verify and commit**

Add tests for audit/security update/delete rejection, one active recovery code, singleton handoff user, expected-at-DAY_OF flag behavior, false guard rollback of earlier audit/snapshot/import writes, and bcrypt credential algorithm constraint. Run `corepack pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts && corepack pnpm --filter @event-roster/worker run check && corepack pnpm format:check`.

Expected: PASS. Commit `feat: add D1 event roster schema`.

### Task 6: Add bcrypt, JWT, cookie, CSRF, and HTTP security primitives

**Files:**
- Modify: `apps/worker/{package.json,wrangler.jsonc,worker-configuration.d.ts}`, `apps/worker/src/{env,app,index}.ts`
- Create: `apps/worker/src/http/{problem,request-context,origin}.ts`
- Create: `apps/worker/src/security/{bcrypt,jwt,cookies,csrf,constant-time,temporary-password,base64url}.ts`
- Create: `apps/worker/test/security/{bcrypt,jwt,cookies,csrf,temporary-password}.test.ts`
- Create: `apps/worker/test/support/auth.ts`

**Interfaces:**
- Produces: `BcryptPasswordHasher`, `issueSessionJwt`, `verifySessionJwt`, `createCsrfToken`, `createSessionCookie`, and `createApp(overrides?: Partial<AppDependencies>)`.

- [ ] **Step 1: Write primitive RED tests**

```ts
// apps/worker/test/security/bcrypt.test.ts
it("uses only cost-12 hashes and rejects a dummy hash at another cost", async () => {
  const hasher = new BcryptPasswordHasher();
  const passwordHash = await hasher.hash("temporary-password-123");
  expect(await hasher.verify("temporary-password-123", passwordHash)).toBe(true);
  expect(() => hasher.assertPolicyHash("$2b$10$abcdefghijklmnopqrstuu5Lo0g67Ci6lM/AJwT0cAWVf4q.MQxPUu")).toThrow();
});

it("rejects a 73-byte UTF-8 password before bcrypt can truncate it", async () => {
  const hasher = new BcryptPasswordHasher();
  const seventyTwoBytes = "가".repeat(24); // 72 bytes in UTF-8
  expect(() => hasher.assertPasswordWithinBcryptLimit(seventyTwoBytes)).not.toThrow();
  expect(() => hasher.assertPasswordWithinBcryptLimit(`${seventyTwoBytes}a`)).toThrow();
  expect(() => hasher.assertPasswordWithinBcryptLimit("😀".repeat(18))).not.toThrow();
  expect(() => hasher.assertPasswordWithinBcryptLimit("😀".repeat(19))).toThrow();
});

it("does not use a real bcrypt function in auth integration tests", async () => {
  const app = createTestApp();
  await app.request("https://example.test/api/v1/auth/login", loginRequestInit);
  expect(passwordHasherMock.verify).toHaveBeenCalledOnce();
});
```

```ts
// apps/worker/test/security/cookies.test.ts
it("creates only the host-prefixed eight-hour session cookie", () => {
  expect(createSessionCookie("signed-token")).toBe("__Host-er_session=signed-token; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax");
  expect(clearSessionCookie()).toBe("__Host-er_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- bcrypt.test.ts jwt.test.ts cookies.test.ts csrf.test.ts temporary-password.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement minimal defensive primitives**

```ts
// apps/worker/src/security/bcrypt.ts
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

export class BcryptPasswordHasher implements PasswordHasher {
  assertPasswordWithinBcryptLimit(password: string): void {
    if (bcrypt.truncates(password)) throw new Error("password_exceeds_bcrypt_limit");
  }
  assertPolicyHash(passwordHash: string): void {
    if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw new Error("invalid_bcrypt_policy_hash");
  }
  async hash(password: string): Promise<string> {
    this.assertPasswordWithinBcryptLimit(password);
    return bcrypt.hash(password, BCRYPT_COST);
  }
  async verify(password: string, passwordHash: string): Promise<boolean> {
    this.assertPasswordWithinBcryptLimit(password);
    this.assertPolicyHash(passwordHash);
    return bcrypt.compare(password, passwordHash);
  }
}
```

Add to production `wrangler.jsonc` exactly:

```jsonc
"secrets": {
  "required": ["JWT_SIGNING_KEY", "DUMMY_BCRYPT_HASH", "IP_HASH_KEY", "RECOVERY_CODE_PEPPER"]
}
```

Then regenerate, never hand-edit, `worker-configuration.d.ts`. `BOOTSTRAP_TOKEN` remains optional in the handwritten application-level env type because it is intentionally deleted after smoke. Unit/auth integration tests invoke `createApp()` with a fake hasher and explicit in-memory test bindings; they do not need or embed production secret values.

Use `jose` HS256 and reject altered signature, issuer, audience, malformed claims, expiry, and wrong `kind`. FULL JWT and cookie expire in 8 hours; MUST_CHANGE_PASSWORD expires in 10 minutes. `problem.ts` never returns caught exception text. `request-context.ts` accepts only `CF-Connecting-IP`, HMACs it with `IP_HASH_KEY` before any storage, and uses one explicit documented fallback bucket when the header is absent; it never reads `X-Forwarded-For`. `origin.ts` rejects every mutation—and `GET /auth/csrf`, because it rotates state—with Origin not exactly `APP_ORIGIN`.

`csrf.ts` creates 32 random bytes encoded as base64url, stores only `SHA-256(rawToken)` in the current `auth_sessions.csrf_hash`, and compares the SHA-256 of `X-ER-CSRF` against that session's stored digest with XOR constant-time bytes. `GET /auth/csrf` requires an authenticated session plus exact Origin, atomically rotates the stored digest, then returns the new raw token with `Cache-Control: no-store`; raw CSRF is never put in JWT, logs, or browser storage. Add tests for session A token rejected by session B, rotation invalidating prior token, missing/mismatched Origin, and no raw token in D1 rows.

`createApp` production defaults to `new BcryptPasswordHasher()`, current time, and Web Crypto CSPRNG; tests inject a deterministic `PasswordHasher` fake that mirrors byte-limit/hash/verify semantics and records calls.

- [ ] **Step 4: Verify primitives and commit**

Run: `corepack pnpm --dir apps/worker exec wrangler types && corepack pnpm --filter @event-roster/worker test -- bcrypt.test.ts jwt.test.ts cookies.test.ts csrf.test.ts temporary-password.test.ts && corepack pnpm --filter @event-roster/worker run types && corepack pnpm --filter @event-roster/worker run check`

Expected: PASS. Commit `feat: add Worker bcrypt session primitives`.

### Task 7: Implement bootstrap handoff, login, revocation, and recovery

**Files:**
- Create: `apps/worker/src/db/auth.ts`
- Create: `apps/worker/src/services/{bootstrap,auth,recovery}.ts`
- Create: `apps/worker/src/middleware/{authentication,require-full-session,csrf}.ts`
- Create: `apps/worker/src/routes/{bootstrap,auth}.ts`
- Create: `apps/worker/test/{bootstrap,auth,recovery}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`, `apps/worker/test/support/auth.ts`

**Interfaces:**
- Produces: `bootstrapFirstOperator`, `createFirstIndividualOperator`, `login`, `currentSession`, `changeInitialPassword`, `recoverOperator`, `requireActor`, and `requireFullSession`.

- [ ] **Step 1: Write lifecycle and enumeration RED tests**

```ts
it("keeps bootstrap active until the first individual operator changes its password", async () => {
  const bootstrap = await requestBootstrap({ loginId: "shared-admin", displayName: "공용 운영자" });
  const sharedTemporary = await loginWithCredentials("shared-admin", bootstrap.temporaryPassword);
  await changePassword(sharedTemporary, "shared-permanent-password-123");
  const sharedFull = await loginWithCredentials("shared-admin", "shared-permanent-password-123");
  const individual = await postFirstIndividualOperator(sharedFull, { loginId: "minsu", displayName: "민수" });
  expect((await loginRequest({ loginId: "shared-admin", password: "shared-permanent-password-123" })).status).toBe(200);
  await changePassword(await loginWithCredentials("minsu", individual.temporaryPassword), "individual-permanent-password-123");
  expect((await loginRequest({ loginId: "shared-admin", password: "shared-permanent-password-123" })).status).toBe(401);
  expect((await currentSession(sharedFull)).status).toBe(401);
});

it("claims the first-individual handoff exactly once under a race", async () => {
  const bootstrapFull = await makeBootstrapFullSession();
  const [first, second] = await Promise.all([
    postFirstIndividualOperator(bootstrapFull, { loginId: "minsu", displayName: "민수" }),
    postFirstIndividualOperator(bootstrapFull, { loginId: "jisu", displayName: "지수" }),
  ]);
  expect([first.status, second.status].sort()).toEqual([201, 409]);
  expect(await countHandoffUsers()).toBe(1);
});

it("returns the same failure for wrong and unknown login IDs while verifying bcrypt once each", async () => {
  expect((await loginRequest({ loginId: "manager", password: "wrong-password-123" })).status).toBe(401);
  expect((await loginRequest({ loginId: "nobody", password: "wrong-password-123" })).status).toBe(401);
  expect(passwordHasherMock.verify).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- bootstrap.integration.test.ts auth.integration.test.ts recovery.integration.test.ts`

Expected: FAIL with missing routes/modules.

- [ ] **Step 3: Implement exact auth and recovery behavior**

`bootstrapFirstOperator` makes a 20-character CSPRNG temporary password, bcrypt hashes it before D1, then uses `runGuardedAtomic` to claim singleton bootstrap lock, insert bootstrap OPERATOR/credential, create one active recovery-code HMAC, and append a credential-free security event. It requires exact Origin and constant-time bootstrap token; it returns no cookie and `Cache-Control: no-store`.

`createFirstIndividualOperator` is a separate one-time guarded handoff: after hashing its generated temporary password, its first batch statement requires the authenticated active bootstrap user and a `bootstrap_locks.handoff_user_id IS NULL` row. The same batch inserts exactly one non-bootstrap OPERATOR/credential, writes that inserted UUID to `handoff_user_id`, and writes an audit/security event. A race has exactly one 201 and one 409 with no second user. It does **not** disable the bootstrap account yet.

`login` canonicalizes ID, obtains its source IP only through `request-context.ts`, and creates/queries the same HMAC login-ID/IP rate key for known and unknown IDs. It returns the same generic 401 for an already locked key **without** bcrypt. Otherwise it loads the active user's hash or `env.DUMMY_BCRYPT_HASH`, calls `passwordHasher.verify()` exactly once, records a credential-free attempt, and returns generic 401 for every invalid state. A valid active user creates a D1 session/JWT/cookie/CSRF. Validate `env.DUMMY_BCRYPT_HASH` through `passwordHasher.assertPolicyHash` before it is used; invalid configuration must fail closed.

`requireActor`/`currentSession` validates JWT signature/claims, finds the `auth_sessions` row, rejects revoked/expired rows, requires matching `users.session_version`, active user, and current user-organization links, then derives the actor from D1 rather than JWT role data. `logout` requires the current session's exact Origin/CSRF, revokes that session, clears the host cookie, and returns `Cache-Control: no-store`; a stale cookie receives generic authentication failure without exposing whether it referred to a real session.

`changeInitialPassword` requires its current session's CSRF, hashes first, then guarded-atomically replaces hash, increments session version, revokes sessions, and emits a security event. It disables all bootstrap accounts and revokes **every** bootstrap `auth_sessions` row only when `caller.id = bootstrap_locks.handoff_user_id`, caller is non-bootstrap MUST_CHANGE_PASSWORD OPERATOR, and bootstrap is still active. A recovery-created or ordinary MUST_CHANGE user never matches this handoff ID and cannot disable bootstrap. Every change-password response clears the cookie and returns 204.

`recoverOperator` creates/queries an action/IP rate key and returns generic 401 without hashing when already locked. Otherwise it HMACs the recovery code and first verifies that an active row exists; because the code is 32 CSPRNG bytes this precheck is not a feasible oracle. Only then does it bcrypt-hash the supplied password **before** the guarded D1 write. The batch consumes the active code, inserts a replacement active code, new non-bootstrap MUST_CHANGE OPERATOR, bcrypt credential, and security event. Invalid code records a credential-free failure and generic 401; successful recovery resets its rate state. Concurrent use produces exactly one 201 and one 401; false guard writes nothing. All temporary-password/recovery/CSRF/login responses set `Cache-Control: no-store`.

- [ ] **Step 4: Add regressions, verify, and commit**

Add tests for missing/rotated CSRF, `CF-Connecting-IP` HMAC behavior and ignored `X-Forwarded-For`, 5-failure login lock (the sixth known and unknown-ID request each returns identical 401 without a bcrypt call), successful login reset, 5-failure recovery lock without bcrypt, successful recovery reset, concurrent bootstrap, concurrent one-time handoff (one 201/one 409), recovery-created MUST_CHANGE not disabling bootstrap, bootstrap FULL JWT immediate 401 after handoff password change, invalid recovery zero residual rows, one-use recovery race, deleted bootstrap token 404, revoked/expired/session-version-mismatched JWT rejection, logout cookie clearing, old JWT rejection after password change, and no `Set-Cookie` on bcrypt configuration failure. Run focused suites and `corepack pnpm --filter @event-roster/worker run check`.

Expected: PASS. Commit `feat: add account handoff and session authentication`.

### Task 8: Build operator organization and account administration APIs

**Files:**
- Create: `apps/worker/src/db/admin.ts`, `apps/worker/src/services/admin.ts`
- Create: `apps/worker/src/routes/{organizations,users}.ts`
- Create: `apps/worker/test/admin.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: full non-bootstrap OPERATOR actor, bcrypt hasher, D1 schema, organization rules.
- Produces: organization/user lifecycle APIs and one-display temporary password responses.

- [ ] **Step 1: Write administration RED tests**

```ts
it("allows only a non-bootstrap operator to issue English login IDs", async () => {
  expect((await postAsManager("/api/v1/users", managerInput)).status).toBe(403);
  expect((await postAsBootstrap("/api/v1/users", managerInput)).status).toBe(403);
  const response = await postAsOperator("/api/v1/users", { ...managerInput, loginId: "manager2", organizationIds: [orgId] });
  expect(response.status).toBe(201);
  expect((await response.json()).temporaryPassword).toHaveLength(20);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- admin.integration.test.ts`

Expected: FAIL with unavailable routes.

- [ ] **Step 3: Implement user/organization lifecycle**

All routes require FULL non-bootstrap OPERATOR. `createUser` validates login ID, generates 20-char temporary password, hashes before a guarded D1 batch, inserts links/credential/security event, and returns raw temporary password only on 201 with no-store. `resetUserPassword` rehashes, marks MUST_CHANGE, increments target session version, revokes sessions, and audits without hash. Deactivation/role/link changes revoke target sessions. Organization deactivation blocks new links, participant creation, roster additions, and import for that organization while historical reads remain available.

- [ ] **Step 4: Verify and commit**

Add duplicate login 409, reset no-store, list redaction, role/link/deactivation session revocation, and inactive organization write rejection tests. Run suite/check, expect PASS, commit `feat: add organization and account administration`.

### Task 9: Implement event lifecycle and participant master APIs

**Files:**
- Create: `apps/worker/src/db/{audit,events,participants}.ts`
- Create: `apps/worker/src/services/{events,participants}.ts`
- Create: `apps/worker/src/routes/{events,participants}.ts`
- Create: `apps/worker/test/{events,participants}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: state/revision-guarded event CRUD/lifecycle and reusable participant master APIs.

- [ ] **Step 1: Write event/participant RED tests**

```ts
it("allows only approved transitions and freezes expected snapshots on DAY_OF", async () => {
  const event = await createEventAsOperator({ title: "2026 상반기 행사", year: 2026, half: "H1" });
  expect((await transitionAsOperator(event.id, "DAY_OF", event.revision)).status).toBe(409);
  const pre = await transitionAsOperator(event.id, "PRE_REGISTRATION", event.revision);
  const dayOf = await transitionAsOperator(event.id, "DAY_OF", (await pre.json()).revision);
  expect(dayOf.status).toBe(200);
  expect(await expectedSnapshotCount(event.id)).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- events.integration.test.ts participants.integration.test.ts`

Expected: FAIL with 404/missing module.

- [ ] **Step 3: Implement lifecycle and scope rules**

Event create requires OPERATOR and unique `(year, half)`; metadata PATCH is DRAFT/PRE_REGISTRATION only and all event writes have a guarded id/revision/status predicate. PRE_REGISTRATION→DAY_OF creates the complete organization expected-count snapshot, marks then-ACTIVE PRE_EVENT entries `was_expected_at_day_of=1`, and writes revision/audit in one batch. CLOSED→DAY_OF preserves those snapshots and flags.

Operators manage every participant field. Managers may create/edit names only in their linked active organizations and cannot move organization. Generate `P-${crypto.randomUUID().toUpperCase()}` and retry exactly once on unique collision. A PRE_REGISTRATION participant name/organization change updates the master plus every matching open roster snapshot, affected event revision, and audit atomically; a DAY_OF name correction updates its current roster snapshot/audit but organization move is rejected when that participant is on a DAY_OF roster. CLOSED roster snapshots are never changed. The transaction must be no-write on stale revision or scope failure.

- [ ] **Step 4: Verify and commit**

Add duplicate half, stale no-write, closed immutable, inactive organization, participant retry, manager scope, PRE_REGISTRATION snapshot propagation, DAY_OF name propagation, DAY_OF organization-move rejection, and closed snapshot preservation tests. Run suite/check; expected PASS. Commit `feat: add event and participant APIs`.

### Task 10: Implement roster mutations, summaries, conflicts, and audit history

**Files:**
- Create: `apps/worker/src/db/{roster,reports}.ts`
- Create: `apps/worker/src/services/{roster,reports}.ts`
- Create: `apps/worker/src/routes/{roster,reports}.ts`
- Create: `apps/worker/test/{roster,reports}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: roster create/update/list, `getEventSummary`, cursor audit logs, sanitized stale conflict details.

- [ ] **Step 1: Write roster RED tests**

```ts
it("preserves cancelled pre-event rows and counts a DAY_OF addition separately", async () => {
  const pre = await addPreEventParticipant(eventId, participantId);
  await transitionEventToDayOf(eventId); // freezes expected=1 and marks this row as expected
  await updateRosterAsOperator(eventId, pre.id, { status: "CANCELLED", revision: pre.revision });
  await addDayOfParticipant(eventId, anotherParticipantId);
  expect(await getSummaryAsOperator(eventId)).toMatchObject({ expectedTotal: 1, finalTotal: 1, deltaTotal: 0, organizations: [{ dayOfAdded: 1, dayOfCancelled: 1 }] });
  expect(await rosterHistory(eventId, participantId)).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- roster.integration.test.ts reports.integration.test.ts`

Expected: FAIL with unavailable routes.

- [ ] **Step 3: Implement guarded roster/audit operations**

PRE_REGISTRATION creates PRE_EVENT active rows; DAY_OF creates DAY_OF active rows. Every create/update guard includes actor organization scope, active organization, event status/revision, and entry revision where relevant. A stale entry returns `STALE_REVISION` with sanitized current row and writes no audit/revision. Cancellations only change status; no roster delete route exists. Per organization, SQL is authoritative: `expected` comes from the DAY_OF organization snapshot, `final` is `COUNT(*)` of every ACTIVE roster entry, and `delta = final - expected`. `dayOfAdded` is active DAY_OF entries; `dayOfCancelled` is CANCELLED PRE_EVENT entries whose `was_expected_at_day_of=1`, so a cancellation before the transition is never subtracted twice. Every success writes roster snapshot/audit/event revision atomically. Summary passes those SQL totals to `buildEventSummary`; manager audit pages filter organization snapshots and never expose security credentials/IP/CSRF/recovery fields.

- [ ] **Step 4: Verify and commit**

Add CLOSED rejection, duplicate row conflict, manager cross-org 403, stale no-write, import-compatible reactivation, DAY_OF source restriction, and organization summary tests. Run suite/check; expected PASS. Commit `feat: add roster summaries and audit history`.

### Task 11: Implement Excel validation, atomic commit, and export-data APIs

**Files:**
- Create: `apps/worker/src/db/imports.ts`, `apps/worker/src/services/imports.ts`
- Create: `apps/worker/src/routes/{imports,exports}.ts`
- Create: `apps/worker/test/{imports,exports}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Produces: normalized JSON validation, all-or-nothing import commit, `EventExportData` JSON.

- [ ] **Step 1: Write import/export RED tests**

```ts
it("leaves all 130 rows, audit rows, and import run absent when one row conflicts", async () => {
  const rows = makeResolvedRows(130);
  rows[129] = { ...rows[129], name: rows[0].name, organizationName: rows[0].organizationName };
  const validation = await validateImportAsOperator(eventId, rows);
  const response = await commitImportAsOperator(eventId, { expectedEventRevision: validation.eventRevision, rows });
  expect(response.status).toBe(422);
  expect(await countRowsForEvent(eventId)).toBe(0);
  expect(await countAuditRowsForEvent(eventId)).toBe(0);
  expect(await countImportRunsForEvent(eventId)).toBe(0);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/worker test -- imports.integration.test.ts exports.integration.test.ts`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement four-stage server contract**

Validate accepts only 1–130 normalized `{ rowNumber, name, organizationName, resolvedParticipantId? }` rows, detects in-file duplicate identity, resolves candidates, returns issues/candidate lists plus current positive revision, and creates no import row. For an ambiguous candidate set, the UI must submit a selected `resolvedParticipantId` on that exact row; validate and commit both re-check that ID against current D1 candidates and reject stale/foreign selections. Only full OPERATOR at PRE_REGISTRATION can validate/commit. Commit revalidates rows and uses expected event revision/status guard before any participant/roster write; it creates missing participants/rows, reactivates cancelled matching rows, records unchanged active rows, one import run, and all audits in one batch. It accepts no `File`, `ArrayBuffer`, workbook XML, or raw cell matrix. Export returns stable organization/name/participant-number sorted roster/summary arrays and no source upload data.

- [ ] **Step 4: Verify and commit**

Add unknown/inactive organization, duplicate file row, ambiguity requiring a resolution, accepted candidate resolution, stale/foreign candidate rejection, role/DAY_OF rejection, reactivation/no-op, stale expected revision zero-write, and exact export ordering tests. Run suite/check; expected PASS. Commit `feat: add atomic roster import and export data`.

### Task 12: Build the React design foundation and bcrypt login flows

**Files:**
- Create: `apps/web/src/styles/{tokens,global}.css`
- Create: `apps/web/src/components/ui/{Button,Card,Dialog,TextInput,StatusMessage}.tsx`
- Create: `apps/web/src/lib/{api,csrf,session}.ts`
- Create: `apps/web/src/app/{router,AppShell}.tsx`
- Create: `apps/web/src/features/auth/{AuthProvider,LoginPage,ChangePasswordPage,RecoveryPage,BootstrapHandoffPage,auth.test}.tsx`
- Modify: `apps/web/src/{main.tsx,app/App.tsx,package.json}`

**Interfaces:**
- Consumes: Task 7 auth endpoints and `CurrentSession`.
- Produces: same-origin credentialed client, in-memory CSRF/session provider, no token persistence.

- [ ] **Step 1: Write auth UI RED tests**

```tsx
it("stores CSRF only in provider memory and never writes tokens to storage", async () => {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("로그인 ID"), "minsu.kim");
  await userEvent.type(screen.getByLabelText("비밀번호"), "temporary-password-123");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(await screen.findByText("새 비밀번호를 설정하세요.")).toBeVisible();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("forces a bootstrap FULL session through first-operator handoff", async () => {
  mockSession({ user: { ...sharedBootstrapUser, isBootstrap: true }, sessionKind: "FULL" });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "첫 개별 운영자 만들기" })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/web test -- auth.test.tsx`

Expected: FAIL with missing auth modules.

- [ ] **Step 3: Implement tokens, API client, and route guards**

Define `--er-color-*`, `--er-space-*`, `--er-radius-*`, `--er-shadow-*`, `--er-font-weight-*`; all UI primitives consume these tokens. `api.ts` uses relative `/api/v1`, `credentials: "include"`, JSON content, and adds `X-ER-CSRF` only from provider memory. It never stores password, bcrypt hash, JWT, recovery code, or temporary password.

`LoginPage` has `로그인 ID`, generic invalid-credential copy, and recovery link. Login, change-password, recovery, bootstrap handoff, and user reset forms all use the shared 72-byte UTF-8 password schema and show its Korean validation message before submit. `ChangePasswordPage` is the only MUST_CHANGE route, clears provider memory after 204, and shows `새 비밀번호로 다시 로그인하세요.` `RecoveryPage` and `BootstrapHandoffPage` keep one-time values only in dialog state and clear them on close/unmount. Guards route no session to `/login`, MUST_CHANGE to `/change-password`, bootstrap FULL to `/bootstrap-handoff`, and ordinary FULL to `/events`.

- [ ] **Step 4: Verify and commit**

Run: `corepack pnpm --filter @event-roster/web test -- auth.test.tsx && corepack pnpm --filter @event-roster/web run check && corepack pnpm --filter @event-roster/web build`

Expected: PASS. Commit `feat: add custom bcrypt login and design foundation`.

### Task 13: Build organization, account, and event management screens

**Files:**
- Create: `apps/web/src/features/admin/{OrganizationsPage,UsersPage,UserForm,TemporaryPasswordDialog,admin}.test.tsx`
- Create: `apps/web/src/features/events/{EventsPage,EventForm,EventTransitionDialog,events}.test.tsx`
- Modify: `apps/web/src/app/{router,AppShell}.tsx`

**Interfaces:**
- Consumes: organization/user/event APIs and Task 12 UI primitives.
- Produces: operator administration and event lifecycle screens.

- [ ] **Step 1: Write management RED tests**

```tsx
it("shows a generated password once and removes it on dialog close", async () => {
  mockApi.post.mockResolvedValueOnce({ user: manager, temporaryPassword: "abcdefghjkmnpqrstuvw" });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole("button", { name: "사용자 추가" }));
  await userEvent.type(screen.getByLabelText("로그인 ID"), "manager-02");
  await userEvent.click(screen.getByRole("button", { name: "발급" }));
  expect(await screen.findByText("abcdefghjkmnpqrstuvw")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("abcdefghjkmnpqrstuvw")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/web test -- admin.test.tsx events.test.tsx`

Expected: FAIL with missing components.

- [ ] **Step 3: Implement role/state-aware screens**

Only non-bootstrap OPERATOR sees administration navigation. User list contains login ID, display name, role, linked organizations, active status, reset action; never bcrypt hash, sessions, recovery code, or bootstrap reactivation. Login ID client validation follows canonical regex. For create/reset mutations, immediately split the one-time `temporaryPassword` out of the response into dialog state, call `mutation.reset()` on dialog close/unmount, and use `gcTime: 0`; do not place that response in a query cache. `TemporaryPasswordDialog` clears state on close/unmount. Event pages split current and CLOSED events; metadata is disabled DAY_OF/CLOSED, uses revision, and refetches before an explicit stale retry. Managers never see administration navigation.

- [ ] **Step 4: Verify and commit**

Add manager navigation, Korean ID validation, disabled metadata, duplicate half error, stale reload, and React Query temporary-secret redaction tests. Run web suite/check; expected PASS. Commit `feat: add event and account management screens`.

### Task 14: Build the event roster operating console

**Files:**
- Create: `apps/web/src/features/roster/{RosterConsolePage,RosterTable,RosterFilters,RosterEditorPanel,RosterConflictDialog,AuditLogPanel,roster}.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: Task 10 roster/summary/audit APIs and current session scope.
- Produces: 130-row table-first console with local filters and conflict recovery.

- [ ] **Step 1: Write console RED tests**

```tsx
it("filters all loaded rows locally without pagination", async () => {
  mockRoster(Array.from({ length: 130 }, (_, index) => rosterEntry(`참가자${index}`)));
  render(<RosterConsolePage eventId="event-1" />);
  await userEvent.type(screen.getByLabelText("이름 검색"), "참가자42");
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

it("opens a conflict dialog for a stale roster update", async () => {
  mockApi.patch.mockRejectedValueOnce(problem("STALE_REVISION", { latestEntry, changedBy: actor, changedAt: "2026-07-21T00:00:00.000Z" }));
  render(<RosterEditorPanel eventId="event-1" entry={entry} />);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("dialog", { name: "동시 수정 충돌" })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/web test -- roster.test.tsx`

Expected: FAIL with missing console modules.

- [ ] **Step 3: Implement dense state-aware operations**

Fetch roster, summary, first audit page together. Render expected/final/delta totals plus per-organization cards above the table. Filter all loaded rows by NFC-normalized name, organization, ACTIVE/CANCELLED without pagination/virtualization. Editor can add existing/new participant, correct permitted names, cancel/reactivate by server state, labels DAY_OF actions, and disables editing CLOSED. Conflict dialog displays sanitized latest row/actor/time and only `최신 값으로 새로고침` or `내 변경 다시 적용`. Audit cursor pages carry no credential data. Narrow layout shows read-only cards but leaves edits in editor panel.

- [ ] **Step 4: Verify and commit**

Add CLOSED disabled, manager scope, DAY_OF labels, aggregate formula, audit redaction, and filter completeness tests. Run web suite/check; expected PASS. Commit `feat: add event roster operating console`.

### Task 15: Add browser-only Excel import and export UI

**Files:**
- Create: `apps/web/src/features/imports/{ImportPage,workbook,ColumnMappingStep,ValidationReviewStep,imports}.test.tsx`
- Create: `apps/web/src/features/exports/{downloadWorkbook,ExportButton,exports}.test.ts`
- Modify: `apps/web/package.json`, `apps/web/src/app/router.tsx`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 11 JSON contracts and SheetJS only in the web package.
- Produces: in-memory workbook review/commit and two-sheet `.xlsx` download.

- [ ] **Step 1: Write import/export RED tests**

```tsx
it("does not commit until every validation issue is resolved", async () => {
  render(<ImportPage eventId="event-1" />);
  await selectWorkbookWithUnknownOrganization();
  expect(await screen.findByText("오류를 모두 해결해야 확정할 수 있습니다.")).toBeVisible();
  expect(mockApi.post).not.toHaveBeenCalledWith("/events/event-1/imports/commit", expect.anything());
});
```

```ts
it("creates roster and summary sheets only from export DTO data", () => {
  expect(buildEventWorkbook(exportData).SheetNames).toEqual(["명단", "집계"]);
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement browser-only workbook flow**

Add `xlsx` only to `@event-roster/web`. Read files with `XLSX.read(await file.arrayBuffer())`, render sheet names/string previews, and never send a File, ArrayBuffer, XML, source cells, password, or auth token to Worker. Stages are sheet selection, column mapping, server validation, ambiguous-row candidate selection, revalidation, then all-or-nothing commit. The selection writes only `resolvedParticipantId` to its matching normalized row; after the server revalidates candidates, no unresolved/stale candidate can be committed. Clear file/rows on cancel, successful commit, and route leave. Commit includes server-returned `eventRevision` as `expectedEventRevision`. `downloadWorkbook.ts` creates exactly `명단` and `집계` from `EventExportData` and calls `XLSX.writeFile`.

- [ ] **Step 4: Verify and commit**

Add a UI test that an ambiguous row cannot proceed until a candidate is selected, sends `resolvedParticipantId` only for that row, and returns to selection if server revalidation rejects it. Run: `corepack pnpm install && corepack pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts && corepack pnpm --filter @event-roster/web build && corepack pnpm --filter @event-roster/web run check`

Expected: PASS. Commit `feat: add browser Excel import and export`.

### Task 16: Add isolated E2E, CI, Cloudflare deployment, and recovery operations

**Files:**
- Create: `apps/web/{playwright.config.ts,e2e/{auth,event-roster,import-export,global-setup,global-teardown}.ts,e2e/fixtures/create-workbook.mts}`
- Create: `apps/worker/scripts/{prepare-e2e-env,generate-dummy-bcrypt,create-import-gate-config,run-remote-import-gate,smoke-remote}.mts`
- Create: `apps/worker/wrangler.e2e.jsonc`
- Create: `.github/workflows/ci.yml`, `docs/adr/0004-workers-d1-import-capability-gate.md`, `docs/operations/{deployment,recovery}.md`
- Modify: `README.md`, `apps/worker/{package.json,wrangler.jsonc,worker-configuration.d.ts}`, `apps/web/package.json`, `.gitignore`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: every API/UI module, PASS ADR 0003, D1 migration.
- Produces: repeatable local E2E, no-production-secret CI, a factual 130-row remote D1 import gate, and Cloudflare-only deployment/recovery runbooks.

- [ ] **Step 1: Write E2E RED scenarios**

```ts
test("temporary-password user changes password, is logged out, and shared bootstrap remains disabled", async ({ page }) => {
  await loginAsFixtureTemporaryUser(page);
  await expect(page.getByText("새 비밀번호를 설정하세요.")).toBeVisible();
  await changePassword(page, "new-operator-password-123");
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  await loginWithCredentials(page, fixtureTemporaryUser.loginId, "new-operator-password-123");
  await expectSharedBootstrapLoginToFail(page);
});

test("operator imports 130 rows and downloads two-sheet export", async ({ page }) => {
  await loginAsOperator(page);
  await openPreRegistrationImport(page);
  await chooseGeneratedWorkbook(page, "130-participants.xlsx");
  await resolveAllRows(page);
  await expect(page.getByText("130개 행을 확정했습니다.")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "엑셀 내보내기" }).click()]);
  expect(download.suggestedFilename()).toContain("명단");
});
```

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm --filter @event-roster/web run e2e`

Expected: FAIL because E2E secret/state preparation and fixtures do not exist.

- [ ] **Step 3: Implement isolated local E2E and CI**

`wrangler.e2e.jsonc` is a tracked local-only clone of the production Worker shape: it has the same main/assets/D1 migration settings, `vars.APP_ORIGIN = "https://localhost:8787"`, zero local D1 ID, and `secrets.required` including the four permanent secrets **plus** local-only `BOOTSTRAP_TOKEN`. It must never be deployed. This separate config is required because once production `secrets.required` is defined, Wrangler ignores extra `.dev.vars` keys and cannot safely use `.dev.vars` to override `APP_ORIGIN` or inject optional bootstrap access.

`prepare-e2e-env.mts` may write only ignored `apps/worker/.dev.vars`, `apps/worker/.wrangler/e2e-state`, and `apps/web/e2e/.local-e2e-env.json`. It resolves and removes only the exact E2E state directory, applies `wrangler d1 migrations apply event-roster --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e-state` with Worker cwd, then creates CSPRNG nonproduction `JWT_SIGNING_KEY`, `IP_HASH_KEY`, `BOOTSTRAP_TOKEN`, and `RECOVERY_CODE_PEPPER`. It invokes `generate-dummy-bcrypt.mts` to create the cost-12 `DUMMY_BCRYPT_HASH`. Never write a plaintext password/hash to committed files.

Playwright's `webServer.command` first runs `corepack pnpm --dir apps/web build`, then starts only `corepack pnpm --dir apps/worker exec wrangler dev --config wrangler.e2e.jsonc --local-protocol=https --ip localhost --persist-to .wrangler/e2e-state --port 8787`; Playwright uses `baseURL: "https://localhost:8787"`, `ignoreHTTPSErrors: true`, `reuseExistingServer: false`, `workers: 1`, `fullyParallel: false`. Global setup owns empty-D1 bootstrap, shared bootstrap password change, first individual handoff, fixture org/event/temporary user, and generated 130-row workbook; specs do not bootstrap or depend on order. CI uses no Cloudflare credentials: it first prepares ephemeral local test secrets, then runs frozen install, format, contract/domain/Worker/web tests, build, local bundle-only `wrangler deploy --dry-run`, and Playwright. That CI dry run is not evidence that remote required secrets exist; the live deploy performs that validation.

- [ ] **Step 4: Prove the 130-row D1 import path in a disposable remote Worker/D1 pair**

This is a second factual gate. It uses the finished application artifact but never the eventual production D1. Before any external change, run `wrangler whoami`, show the temporary resource names `event-roster-import-capability` and `event-roster-import-capability-db`, and obtain user authority for one disposable Worker, one disposable D1 database, and five interactive secrets.

`create-import-gate-config.mts` writes only an ignored `.wrangler/import-capability/wrangler.jsonc` from the committed production config, with Worker name `event-roster-import-capability`, the temporary D1 ID, Observability `enabled/head_sampling_rate: 1`, and a temporary expected `APP_ORIGIN`. It declares the four permanent secrets as required and keeps `BOOTSTRAP_TOKEN` optional. Build web assets before this deploy. After the first temporary deploy, use the exact printed Worker URL; if it differs from the temporary config origin, rewrite only the ignored temp config and redeploy before issuing any API request.

Set `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `IP_HASH_KEY`, `RECOVERY_CODE_PEPPER`, and a short-lived `BOOTSTRAP_TOKEN` interactively on the temporary Worker. `run-remote-import-gate.mts` uses that exact URL/origin and a nonsecret UUID gate run ID. It must perform the real API flow: bootstrap → bootstrap password change/logout → first individual operator creation/change/logout → event/organization setup → validate and commit 130 valid normalized rows → verify 130 active roster rows, one import run, expected audit count, and export ordering → submit a separately prepared invalid 130-row import and verify its failure leaves the previous roster/import/audit counts unchanged. It must not print credentials, hashes, CSRF values, or recovery codes.

Record a factual evidence JSON under `docs/superpowers/evidence/workers-d1-import-${runId}.json`: temporary Worker/D1 IDs and URL, code revision, expected/actual row and audit counts, HTTP statuses, elapsed milliseconds, and invocation-log metrics for the validate/commit time window. PASS requires both success and rejected-import invariants, no 5xx/1102/OOM/`exceededCpu`, and every relevant 100%-sampled invocation `cpuTimeMs <= 10`. If logs are incomplete/unavailable, treat the gate as FAIL; do not infer zero errors. Update ADR 0004 with PASS/FAIL, commit only evidence/ADR on failure, then delete the temporary Worker and temporary D1 and stop before creating production resources. On PASS, commit `feat: prove Workers D1 import capability`, delete both temporary resources, then continue.

- [ ] **Step 5: Write Cloudflare-only deployment and recovery runbooks**

`docs/operations/deployment.md` must order: authenticate Wrangler; verify ADR 0003 and ADR 0004 PASS; `wrangler d1 create event-roster --binding DB --update-config`; run the exact remote migration command `wrangler d1 migrations apply event-roster --remote`; set `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `IP_HASH_KEY`, `RECOVERY_CODE_PEPPER`, `BOOTSTRAP_TOKEN` via interactive `wrangler secret put`; build web; deploy Worker; reconcile `APP_ORIGIN` to the exact deploy-printed URL; if it changed, update the committed config, run `wrangler types` and checks, then redeploy before any bootstrap request; run bootstrap smoke; record recovery code offline; delete `BOOTSTRAP_TOKEN`. It must state no Google Cloud, Cloud Run, or `gcloud` is used.

`smoke-remote.mts` accepts the deploy-printed `APP_URL`, bootstrap token/login IDs, and interactive replacement passwords; it performs bootstrap → bootstrap password change/logout → FULL bootstrap login → first individual creation → individual password change/logout → bootstrap rejection, then checks cookie flags including `Max-Age=28800`, `/auth/me`, and SPA deep link. It prints only status/request IDs and the one-time recovery code once. `recovery.md` requires export before bulk import/after close, forbids direct D1 edits, documents recovery-code use, and requires checking Workers usage/Observability before each event.

- [ ] **Step 6: Verify, deploy only with authority, and commit**

Run:

```bash
corepack pnpm test
corepack pnpm check
corepack pnpm format:check
corepack pnpm --filter @event-roster/web build
corepack pnpm --filter @event-roster/worker exec wrangler deploy --dry-run --outdir .wrangler/bundle
corepack pnpm --filter @event-roster/web run e2e
```

Expected: PASS; Worker gzip is below 3 MiB and static assets below 20,000 files. Only after the user authorizes the real Cloudflare account and supplies secrets interactively, create the production D1 **after** ADR 0004 PASS, deploy, compare the printed URL with committed `APP_ORIGIN`, redeploy if needed, run `smoke-remote`, then delete `BOOTSTRAP_TOKEN`. Commit `chore: add Cloudflare delivery verification and runbooks`.

## Plan self-review checklist

- [x] Cloud Run, `gcloud`, FastAPI, and their local harness are explicitly removed/superseded without altering factual PBKDF2 history.
- [x] bcryptjs cost 12, UTF-8 72-byte rejection, no raw hash probe response, exact dummy hash policy, non-enumerating/rate-limited login, D1 session revocation, no refresh token, session-bound CSRF, one-time bootstrap handoff, and one-time recovery all map to implementation/test tasks.
- [x] The actual Workers bcrypt capability gate measures hash and verify, requires 100% correlated invocation evidence and the Workers Free 10 ms CPU constraint before any Worker/Web/D1 MVP task.
- [x] Production `secrets.required`/generated binding types, optional deleted bootstrap token, deploy-printed origin reconciliation, asset-free Miniflare config, and HTTPS local E2E are explicit.
- [x] Event lifecycle, organization scope, open-roster snapshot propagation, authoritative final counts, guarded atomic writes, candidate-resolved all-or-nothing import, export data, and browser-only Excel each map to a task.
- [x] UI keeps credentials and one-time values out of persistent browser storage and uses the approved design-token approach.
- [x] A disposable remote D1 import gate proves 130-row success/rejection before production D1 creation; E2E/CI uses local ignored secrets only; production is Cloudflare-only and deletes bootstrap access after smoke.
