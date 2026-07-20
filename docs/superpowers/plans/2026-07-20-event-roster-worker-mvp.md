# Event Roster Worker MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers Free에서 실제로 검증된 자체 비밀번호/JWT 인증을 바탕으로, 행사별 사전 명단·당일 변동·집계·감사 이력·엑셀 이관/내보내기를 제공하는 내부 운영 도구를 만든다.

**Architecture:** React/Vite SPA의 빌드 결과를 단일 Hono TypeScript Worker의 Static Assets로 배포하고, 같은 `workers.dev` origin의 `/api/v1/*`만 Worker가 처리한다. D1은 업무·보안·감사 데이터를 저장하며, `packages/contracts`는 런타임 Zod 계약을, `packages/domain`은 DB/HTTP와 무관한 규칙을 제공한다. 구현은 Workers Free capability gate가 통과한 뒤에만 시작한다.

**Tech Stack:** TypeScript strict mode, pnpm workspace, React, Vite, Hono, Zod, Cloudflare Workers Static Assets, D1, Web Crypto, Vitest with `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright, SheetJS `xlsx`.

## Global Constraints

- 승인 기준 문서는 `docs/superpowers/specs/2026-07-20-event-roster-worker-design.md`이며, 이전 FastAPI 계획은 실행하지 않는다.
- 배포는 하나의 `https://event-roster.<account>.workers.dev` Worker다. 별도 Pages, 별도 API origin, CORS, VM, 커스텀 도메인을 만들지 않는다.
- Worker 설정은 신규 프로젝트 권장 형식인 `wrangler.jsonc`를 쓰고 `compatibility_date`는 `2026-07-20`으로 고정한다.
- 실행 보정(2026-07-20 승인): `packageManager`는 Corepack과 Task 15 CI가 유효한 SemVer로 해석하도록 정확한 `pnpm@10.28.1`을 사용한다. `@cloudflare/vitest-pool-workers`는 Vitest `^4.1.0` 및 `cloudflareTest()` Vite plugin과 호환되는 `^0.18.6`을 사용한다. 이전의 `pnpm@10`과 테스트 풀 `^0.10.0`은 사용하지 않는다.
- `apps/web`은 React/Vite 코드만, `apps/worker`는 Hono·D1·Worker 설정만, `packages/domain`은 순수 규칙만, `packages/contracts`는 Zod 계약만 가진다.
- D1 자동 프로비저닝은 Wrangler 4.45 이상에서만 사용한다. 이 기능은 Cloudflare Beta이므로, 첫 배포가 실제 D1 ID를 `wrangler.jsonc`에 기록했는지 확인하고 기록되지 않으면 `wrangler d1 create event-roster --binding DB --update-config`로 명시적으로 바꾼다.
- 정적 자산은 `apps/web/dist`에서 제공하고 `assets.run_worker_first`는 `['/api/*']`만 쓴다. API 외 SPA deep link는 `index.html`로 fallback한다.
- 공개 가입, 자체 이메일 발송, 이메일 OTP, Cloudflare Access, 외부 IdP, 원본 엑셀 저장, 체크인, 실시간 공동 편집은 구현하지 않는다.
- 모든 사용자 계정은 운영자가 만든다. 임시 비밀번호는 CSPRNG로 20자 이상 생성해 한 번만 표시하고, 최초 로그인 후 10분 제한 세션에서 변경하게 한 뒤 모든 세션을 폐기한다.
- 일반 JWT 세션은 8시간 절대 만료이며 `__Host-er_session; HttpOnly; Secure; SameSite=Lax; Path=/` 쿠키만 쓴다. `Domain` 속성·`localStorage`·`sessionStorage`에 인증 정보를 두지 않는다.
- 비밀번호에는 사용자별 128비트 salt, Worker Secret의 pepper, 보안 KDF만 쓴다. 빠른 SHA-256 해시나 보안 기준보다 낮은 비용으로 Free 한도에 맞추는 것은 금지한다.
- capability gate의 합격 기준은 실제 Workers Observability의 `$workers.cpuTimeMs` P95가 각 로그인 시나리오에서 6ms 이하이고 `exceededCpu`가 0건인 것이다. 6ms는 Workers Free의 10ms 한도보다 보수적인 프로젝트 안전 여유다.
- D1에 저장하는 모든 시각은 UTC ISO-8601 문자열, 모든 식별자는 UUID 문자열이다.
- 이메일은 `trim().toLowerCase()`로 정규화해 고유하게 저장한다. 참가자 번호는 `P-` + 대문자 UUID로 생성하며 D1 고유 제약 충돌 시 새 UUID로 한 번 재시도한다.
- 조직 비활성화 뒤에는 새 사용자 연결·참가자 생성·명단 추가·가져오기를 막고, 과거 행사 조회·내보내기는 허용한다. 영향을 받는 조직 담당자 세션은 폐기한다.
- 행사 기본 정보는 운영자가 `DRAFT`와 `PRE_REGISTRATION`에서만 수정할 수 있다. `DAY_OF`와 `CLOSED`에서는 수정하지 않는다.
- 운영자는 현재 `DAY_OF` 행사에 명단 행이 있는 참가자의 조직 이동을 할 수 없다. `CLOSED` 과거 행사는 이동을 막지 않으며 기존 행사 스냅샷을 그대로 보존한다. `PRE_REGISTRATION` 명단 스냅샷만 새 조직으로 갱신한다.
- 가져오기는 운영자만 `PRE_REGISTRATION` 행사에서 실행한다. 같은 행사에 이미 `ACTIVE`인 참가자는 no-op으로 기록하고, `CANCELLED`인 참가자는 명시적으로 재활성화하며, 파일 안 중복은 오류다.
- 조직별 당일 추가는 `source = DAY_OF AND status = ACTIVE` 행 수, 당일 취소는 `source = PRE_EVENT AND status = CANCELLED` 행 수다. 따라서 `final = expected + dayOfAdded - dayOfCancelled`가 성립한다.
- 명단·참가자 현재 행사 스냅샷·감사 이력·이관 실행 기록은 하나의 D1 batch에서 원자적으로 저장한다. 실패 시 어떤 부분 데이터도 남기지 않는다.
- 행사 상태를 전제로 하는 모든 전환·명단·가져오기 write는 읽어 둔 상태만 믿지 않는다. SQL의 `WHERE` 또는 `INSERT … SELECT`에 기대 행사 상태와 `revision`을 함께 넣고, 영향 행 수가 0이면 `STALE_REVISION` 또는 상태 충돌로 처리한다. 상태 전환은 행사 `revision`을 증가시킨다.
- 모든 변경 요청은 정확한 `Origin`과 세션별 `X-ER-CSRF` 헤더를 확인한다. 단, 로그인은 인증 전 요청이므로 Origin만, `GET /auth/csrf`는 CSRF 원문을 발급·회전하지만 업무 데이터를 바꾸지 않는 좁은 bootstrap 예외로 둔다. 이 응답은 `Cache-Control: no-store`이고 CORS를 허용하지 않는다. CSRF 원문은 브라우저 메모리에만 두고 D1에는 해시만 저장한다.
- IP 주소는 저장하지 않는다. 로그인 제한용 값은 별도 Worker Secret `IP_HASH_KEY`로 HMAC-SHA-256 처리한 값만 `login_attempts`와 `security_events`에 저장한다.
- UI는 `coursemos-supporter/docs/design-system.md`의 토큰·프리미티브 원칙을 참고하되, `--er-*` 토큰과 React 컴포넌트를 새로 만든다. 사이드패널 레이아웃이나 코드를 복사하지 않는다.
- 목록은 최대 130행을 한 번에 가져와 클라이언트에서 필터한다. 페이지네이션과 가상 스크롤은 만들지 않는다.
- 각 작업은 실패하는 테스트 작성 → 실패 확인 → 최소 구현 → 통과 확인 → 타입 검사/포맷 검사 → 커밋 순서로 진행한다.

---

## Scope and stop rule

이 MVP는 동일한 인증·D1·도메인 계약을 공유하므로 한 계획으로 유지한다. 단, Task 1은 독립 capability gate다. Task 1이 실패하면 ADR과 spike 결과만 커밋하고 Task 2 이후를 시작하지 않는다. 특히 PBKDF2 반복 횟수를 줄이거나 빠른 해시로 바꾸는 변경은 실패 해결책이 아니다.

## Canonical contracts

이 계약은 이후 모든 작업에서 같은 이름과 타입을 사용한다. 비밀번호, JWT 원문, salt, pepper, CSRF 해시는 어떤 응답 DTO에도 포함하지 않는다.

```ts
export type Role = "OPERATOR" | "ORGANIZATION_MANAGER";
export type SessionKind = "FULL" | "MUST_CHANGE_PASSWORD";
export type EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED";
export type Half = "H1" | "H2";
export type RosterSource = "PRE_EVENT" | "DAY_OF";
export type RosterStatus = "ACTIVE" | "CANCELLED";

export interface Actor {
  id: string;
  role: Role;
  organizationIds: readonly string[];
  sessionId: string;
  sessionVersion: number;
  sessionKind: SessionKind;
}

export interface CurrentSession {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: Role;
    organizationIds: string[];
  };
  sessionKind: SessionKind;
}

export interface RosterEntry {
  id: string;
  eventId: string;
  participantId: string;
  participantNumber: string;
  snapshotName: string;
  snapshotOrganizationId: string;
  snapshotOrganizationName: string;
  source: RosterSource;
  status: RosterStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; displayName: string };
}

export interface ApiProblem {
  code:
    | "AUTHENTICATION_REQUIRED"
    | "FORBIDDEN"
    | "INVALID_CSRF"
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
```

| API | Request | Success result |
| --- | --- | --- |
| `POST /api/v1/bootstrap` | `BootstrapRequest`, `X-ER-Bootstrap-Token` | 최초 운영자와 한 번만 보이는 임시 비밀번호 |
| `POST /api/v1/auth/login` | `LoginRequest` | `CurrentSession`, 세션 쿠키 |
| `GET /api/v1/auth/me`, `GET /api/v1/auth/csrf` | 없음 | `CurrentSession`, `{ csrfToken }` |
| `POST /api/v1/auth/change-password`, `POST /api/v1/auth/logout` | 새 비밀번호, 없음 | `204`, 세션 폐기 |
| `GET/POST/PATCH /api/v1/organizations` | 조직 DTO | 조직 또는 조직 목록 |
| `GET/POST/PATCH /api/v1/users` | 사용자 DTO | 사용자 또는 사용자 목록 |
| `POST /api/v1/users/:id/password-reset` | 없음 | 임시 비밀번호 한 번만 반환 |
| `GET/POST/PATCH /api/v1/participants` | 검색·참가자 DTO | 참가자 또는 참가자 목록 |
| `GET/POST /api/v1/events`, `GET/PATCH /api/v1/events/:id` | 행사 DTO | 행사 또는 행사 목록 |
| `POST /api/v1/events/:id/transition` | `{ targetStatus, revision }` | 행사 상세 |
| `GET/POST /api/v1/events/:id/roster`, `PATCH /api/v1/events/:id/roster/:entryId` | 참가자 ID, revision 포함 수정 명령 | `RosterEntry` 또는 목록 |
| `GET /api/v1/events/:id/summary`, `GET /api/v1/events/:id/audit-logs` | 필터·cursor | `EventSummary`, 감사 이력 페이지 |
| `POST /api/v1/events/:id/imports/validate`, `POST /api/v1/events/:id/imports/commit` | 정규화·해결된 행 | 검증 결과, 확정 결과 |
| `GET /api/v1/events/:id/export-data` | 없음 | 브라우저 `.xlsx` 생성용 데이터 |

## File structure

```text
event-roster/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── spikes/workers-free-capability/
│   ├── src/{index,password,jwt,probe,gate-result}.ts
│   ├── migrations/0001_probe.sql
│   ├── scripts/run-remote-probe.mts
│   └── test/gate-result.test.ts
├── packages/
│   ├── contracts/src/{common,auth,organizations,participants,events,roster,imports,exports,api,index}.ts
│   └── domain/src/{errors,authorization,event-lifecycle,roster,summary,import-validation,index}.ts
├── apps/
│   ├── worker/
│   │   ├── migrations/0001_initial.sql
│   │   ├── src/{index,app,env}.ts
│   │   ├── src/{db,services,routes,middleware,security,http}/
│   │   └── test/
│   └── web/
│       ├── src/{app,components/ui,features,lib,styles}/
│       └── e2e/
├── docs/{adr,operations}/
└── .github/workflows/ci.yml
```

### Task 1: Prove the Workers Free capability gate

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `spikes/workers-free-capability/package.json`
- Create: `spikes/workers-free-capability/tsconfig.json`
- Create: `spikes/workers-free-capability/wrangler.jsonc`
- Create: `spikes/workers-free-capability/worker-configuration.d.ts` (generated by `wrangler types`)
- Create: `spikes/workers-free-capability/migrations/0001_probe.sql`
- Create: `spikes/workers-free-capability/src/password.ts`
- Create: `spikes/workers-free-capability/src/jwt.ts`
- Create: `spikes/workers-free-capability/src/probe.ts`
- Create: `spikes/workers-free-capability/src/gate-result.ts`
- Create: `spikes/workers-free-capability/src/index.ts`
- Create: `spikes/workers-free-capability/scripts/run-remote-probe.mts`
- Create: `spikes/workers-free-capability/scripts/assert-capability-evidence.mts`
- Create: `spikes/workers-free-capability/vitest.config.ts`
- Create: `spikes/workers-free-capability/test/gate-result.test.ts`
- Create: `spikes/workers-free-capability/test/password.test.ts`
- Create: `spikes/workers-free-capability/test/jwt.test.ts`
- Create: `spikes/workers-free-capability/test/probe.integration.test.ts`
- Create: `spikes/workers-free-capability/test/setup-d1.ts`
- Create: `spikes/workers-free-capability/test/env.d.ts`
- Create: `docs/adr/0001-workers-free-capability-gate.md`

**Interfaces:**
- Consumes: no previous project code; Worker Secrets `PASSWORD_PEPPER`, `JWT_SIGNING_KEY`, `CAPABILITY_PROBE_SECRET`.
- Produces: `assertCapabilityPass(result: CapabilityResult): void`, a secret-protected remote probe, and an ADR stating measured PASS or FAIL.

```ts
export interface CapabilityResult {
  bundleGzipBytes: number;
  correct50: boolean;
  wrong50: boolean;
  nonexistent50: boolean;
  cpuP95Ms: {
    correct: number;
    wrong: number;
    nonexistent: number;
  };
  exceededCpuCount: number;
  jwtAndRevocation: boolean;
  atomic130RowImport: boolean;
  rollbackClean: boolean;
  concurrentRequestsClean: boolean;
}

export function assertCapabilityPass(result: CapabilityResult): void;
```

- [ ] **Step 0: Bootstrap only the testable workspace shell**

Create the root workspace/configuration files and the spike package manifest, TypeScript config, Wrangler config, Vitest D1 config, empty `migrations/` directory, and generated Worker type declaration needed to execute tests. Use the configuration blocks in Step 3, but do **not** create any `src/*` modules or test subject yet. Run `pnpm install`, run `wrangler types` for the spike, and add the resulting `pnpm-lock.yaml` and generated non-secret type declaration to this task. This is tooling scaffolding only, so the next test failure is a missing product module rather than a missing pnpm project.

- [ ] **Step 1: Write the failing gate-result contract test**

```ts
// spikes/workers-free-capability/test/gate-result.test.ts
import { describe, expect, it } from "vitest";
import { assertCapabilityPass, CapabilityGateError } from "../src/gate-result";

const pass = {
  bundleGzipBytes: 3_145_727,
  correct50: true,
  wrong50: true,
  nonexistent50: true,
  cpuP95Ms: { correct: 6, wrong: 6, nonexistent: 6 },
  exceededCpuCount: 0,
  jwtAndRevocation: true,
  atomic130RowImport: true,
  rollbackClean: true,
  concurrentRequestsClean: true,
};

describe("assertCapabilityPass", () => {
  it("accepts complete evidence within the Free tier gate", () => {
    expect(() => assertCapabilityPass(pass)).not.toThrow();
  });

  it("rejects a CPU result above the 6ms safety target", () => {
    expect(() => assertCapabilityPass({ ...pass, cpuP95Ms: { ...pass.cpuP95Ms, wrong: 6.01 } }))
      .toThrow(CapabilityGateError);
  });

  it("rejects a bundle at or above the 3MiB gzip limit", () => {
    expect(() => assertCapabilityPass({ ...pass, bundleGzipBytes: 3 * 1024 * 1024 }))
      .toThrow(CapabilityGateError);
  });
});
```

```ts
// spikes/workers-free-capability/test/password.test.ts
import { expect, it } from "vitest";
import { KDF_POLICY, createCredential, verifyCredential } from "../src/password";

it("keeps the fixed 600,000-iteration policy and rejects a wrong password", async () => {
  const credential = await createCredential("temporary-password-123", "test-pepper");
  expect(KDF_POLICY).toMatchObject({ algorithm: "PBKDF2-HMAC-SHA-256", iterations: 600_000, saltBytes: 16, hashBytes: 32 });
  await expect(verifyCredential("temporary-password-123", credential, "test-pepper")).resolves.toBe(true);
  await expect(verifyCredential("different-password-123", credential, "test-pepper")).resolves.toBe(false);
});
```

```ts
// spikes/workers-free-capability/test/jwt.test.ts
import { expect, it } from "vitest";
import { issueSessionJwt, verifySessionJwt } from "../src/jwt";

it("rejects a token after its signing key changes", async () => {
  const token = await issueSessionJwt({ sub: "user-1", sid: "session-1", sv: 1, kind: "FULL" }, "test-signing-key", new Date("2026-07-20T00:00:00.000Z"));
  await expect(verifySessionJwt(token, "test-signing-key", new Date("2026-07-20T01:00:00.000Z"))).resolves.toMatchObject({ sub: "user-1", sv: 1 });
  await expect(verifySessionJwt(token, "different-signing-key", new Date("2026-07-20T01:00:00.000Z"))).rejects.toThrow();
});
```

- [ ] **Step 2: Run the test and confirm it fails because the module is absent**

Run: `pnpm --filter @event-roster/workers-free-capability test -- gate-result.test.ts password.test.ts jwt.test.ts`

Expected: FAIL with a module-not-found error for `../src/gate-result`.

- [ ] **Step 3: Add the strict configuration details and minimum gate implementation**

```jsonc
// package.json
{
  "name": "event-roster",
  "private": true,
  "packageManager": "pnpm@10.28.1",
  "scripts": {
    "check": "pnpm -r run check",
    "test": "pnpm -r run test",
    "format:check": "biome check ."
  },
  "devDependencies": { "@biomejs/biome": "^2.0.0" }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "spikes/*"
```

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

```jsonc
// spikes/workers-free-capability/package.json
{
  "name": "@event-roster/workers-free-capability",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "check": "tsc --noEmit && biome check .",
    "types": "wrangler types",
    "probe:remote": "tsx scripts/run-remote-probe.mts",
    "assert:evidence": "tsx scripts/assert-capability-evidence.mts"
  },
  "dependencies": { "hono": "^4.0.0" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.18.6",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.45.0"
  }
}
```

```jsonc
// biome.json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "files": { "ignore": ["**/dist/**", "**/.wrangler/**", "**/playwright-report/**"] },
  "formatter": { "enabled": true },
  "linter": { "enabled": true }
}
```

```ts
// spikes/workers-free-capability/src/gate-result.ts
export class CapabilityGateError extends Error {}

export function assertCapabilityPass(result: CapabilityResult): void {
  if (result.bundleGzipBytes >= 3 * 1024 * 1024) throw new CapabilityGateError("gzip bundle exceeds Workers Free limit");
  if (!result.correct50 || !result.wrong50 || !result.nonexistent50) throw new CapabilityGateError("password scenarios were not verified");
  if (Object.values(result.cpuP95Ms).some((value) => value > 6) || result.exceededCpuCount !== 0) throw new CapabilityGateError("CPU gate failed");
  if (!result.jwtAndRevocation || !result.atomic130RowImport || !result.rollbackClean || !result.concurrentRequestsClean) {
    throw new CapabilityGateError("security or D1 evidence is incomplete");
  }
}
```

Create `spikes/workers-free-capability/wrangler.jsonc` with `name: "event-roster-capability"`, `main: "./src/index.ts"`, `workers_dev: true`, `compatibility_date: "2026-07-20"`, Observability `enabled` and `head_sampling_rate: 1`, and one `DB` D1 binding using `migrations_dir: "./migrations"`. `vitest.config.ts` must use `cloudflareTest`, `readD1Migrations`, and `applyD1Migrations` in `test/setup-d1.ts`, just as Task 2 does, so `probe.integration.test.ts` runs against a fresh local D1 database rather than a mocked object.

Implement `derivePassword()` with `PBKDF2-HMAC-SHA-256`, 600,000 iterations, a 16-byte random salt, HMAC-SHA-256 of the NFC-normalized password using `PASSWORD_PEPPER` as the PBKDF2 input, and a 32-byte derived value. Implement HMAC-SHA-256 JWT signing/verification with `sub`, `sid`, `sv`, `kind`, `iat`, `exp` claims. The probe must use a secret header and must reject requests without an exact `X-ER-Capability-Secret` match; a missing configured secret is always a rejection, never an `undefined === undefined` pass.

Use this probe response shape so the remote driver can verify behavior without measuring CPU in application code:

```ts
type ProbeResponse = {
  scenario: "correct" | "wrong" | "nonexistent" | "jwt-revocation" | "atomic" | "rollback";
  scenarioPassed: boolean;
  passwordVerified?: boolean;
  jwtVerified?: boolean;
  revokedJwtRejected?: boolean;
  changedPasswordRevokedBothSessions?: boolean;
  committedRows?: number;
  rollbackRows?: number;
};
```

- [ ] **Step 4: Add D1 probe migration and remote driver**

```sql
-- spikes/workers-free-capability/migrations/0001_probe.sql
CREATE TABLE probe_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE probe_participants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  participant_number TEXT NOT NULL,
  UNIQUE(run_id, participant_number)
);
CREATE TABLE probe_roster_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  participant_number TEXT NOT NULL,
  UNIQUE(run_id, participant_number)
);
CREATE TABLE probe_audit_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  action TEXT NOT NULL
);
CREATE TABLE probe_import_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL
);
CREATE TABLE probe_users (
  id TEXT PRIMARY KEY,
  session_version INTEGER NOT NULL
);
CREATE TABLE probe_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES probe_users(id),
  session_version INTEGER NOT NULL,
  revoked_at TEXT
);
```

`runAtomicProbe()` must submit one `env.DB.batch(statements)` containing one run, 130 new participants, 130 roster entries, 130 audit rows, and one import run—the maximum all-`CREATE` import shape, not merely a roster-only import. `runRollbackProbe()` must submit one batch that inserts a run and then repeats the same primary key; it passes only if the caught error is followed by zero rows for that run in all five probe tables. `probe.integration.test.ts` must prove both behaviors against local D1 and reset probe tables in `beforeEach`, because tests within the same Worker Vitest file share local storage. The `jwt-revocation` scenario must issue two sessions, simulate the initial-password change by increasing the user/session version and revoking both persisted sessions, then prove both old JWTs are rejected by the same D1-backed logic planned for Task 6. `run-remote-probe.mts` must generate a UUID run ID, send it in every probe URL, make 50 sequential requests for each password scenario, then send one `jwt-revocation`, one `atomic`, and one `rollback` request before making 13 concurrent valid requests. It writes status-only JSON evidence to `docs/superpowers/evidence/<run-id>.json`. Correct requests pass only when `passwordVerified === true`; wrong and nonexistent requests pass only when `passwordVerified === false`; the JWT response must have `jwtVerified === true`, `revokedJwtRejected === true`, and `changedPasswordRevokedBothSessions === true`; the atomic response must report all inserted rows; the rollback response must report zero remaining rows; every response must have `scenarioPassed === true`. `assert-capability-evidence.mts` must reject any missing scenario count, non-200 result, scenario mismatch, missing JWT/revocation proof, failed atomic result, or failed rollback result.

- [ ] **Step 5: Run local tests, type checks, and the dry-run bundle check**

Run: `pnpm install`

Run: `pnpm --filter @event-roster/workers-free-capability test`

Expected: PASS.

Run: `pnpm --filter @event-roster/workers-free-capability run check`

Expected: PASS with no TypeScript or Biome errors.

Run: `pnpm --filter @event-roster/workers-free-capability exec wrangler deploy --dry-run --outdir .wrangler/bundle`

Expected: output contains `Total Upload:` and `gzip:` below `3 MiB`.

- [ ] **Step 6: Run the required remote Free-tier evidence collection**

1. Create a separate D1 database named `event-roster-capability` and put its actual ID in `spikes/workers-free-capability/wrangler.jsonc`.
2. Apply the probe migration remotely with `pnpm --filter @event-roster/workers-free-capability exec wrangler d1 migrations apply event-roster-capability --remote`.
3. Set the three Worker Secrets with `wrangler secret put`; never place their values in a file or shell history.
4. Deploy the probe with `pnpm --filter @event-roster/workers-free-capability exec wrangler deploy`.
5. Set the non-secret URL normally, then enter the probe secret without echoing or putting it on the command line (for example, `read -rs CAPABILITY_PROBE_SECRET` in zsh, followed by `export CAPABILITY_PROBE_SECRET`), run `pnpm --filter @event-roster/workers-free-capability run probe:remote`, run `pnpm --filter @event-roster/workers-free-capability run assert:evidence`, and `unset CAPABILITY_PROBE_SECRET`.
6. In Workers Observability Query Builder, filter requests by the run ID emitted by the driver and inspect `$workers.cpuTimeMs` P95 separately for `correct`, `wrong`, and `nonexistent`. Transcribe the three values into `CapabilityResult.cpuP95Ms`, record them in the ADR, and verify every value is at most 6ms and outcomes contain zero `exceededCpu` events.

`performance.now()` and response duration are not evidence for this gate; CPU timing must come from Workers Observability.

- [ ] **Step 7: Record the factual ADR result and stop or continue**

Write `docs/adr/0001-workers-free-capability-gate.md` with the dry-run gzip size, 50-request scenario results, 13-request concurrency result, Observability CPU P95 values, rollback result, date, Worker version, and the final `PASS` or `FAIL` outcome.

If any required value fails, stage the same paths shown below and commit with `git commit -m "docs: record Workers Free capability failure"`, stop here, and ask the user to choose Access/external IdP/Workers Paid. Do not begin Task 2.

If all values pass, commit using:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json pnpm-lock.yaml spikes/workers-free-capability docs/adr/0001-workers-free-capability-gate.md docs/superpowers/evidence
git commit -m "chore: prove Workers Free capability gate"
```

### Task 2: Build the monorepo shell and same-origin Worker delivery

**Files:**
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/wrangler.jsonc`
- Create: `apps/worker/worker-configuration.d.ts` (generated by `wrangler types`)
- Create: `apps/worker/migrations/.gitkeep`
- Create: `apps/worker/src/env.ts`
- Create: `apps/worker/src/app.ts`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/routes/health.ts`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/test/setup-d1.ts`
- Create: `apps/worker/test/env.d.ts`
- Create: `apps/worker/test/health.integration.test.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/App.test.tsx`
- Create: `apps/web/test/setup.ts`

**Interfaces:**
- Consumes: Task 1 passed ADR.
- Produces: `GET /api/v1/health -> { status: "ok" }`, a React root, and a Worker config that sends only `/api/*` to Hono first.

Set `.nvmrc` to `22` so `import.meta.dirname`, current Vite tooling, and the Node-side test scripts use one supported runtime.

- [ ] **Step 0: Bootstrap the Worker/web test harness without application modules**

Create the package manifests, TypeScript/Vitest configuration, Worker type declarations, empty migration directory, and test setup listed below; install dependencies and run `pnpm --filter @event-roster/worker run types`. Do not create `src/index.ts`, `src/app.ts`, `src/routes/health.ts`, `src/main.tsx`, or `App.tsx` yet. This makes the Step 2 failures attributable to the absent Worker/React modules, not to an absent workspace package, DOM runtime, or Worker binding types.

- [ ] **Step 1: Write failing Worker and React smoke tests**

```ts
// apps/worker/test/health.integration.test.ts
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("returns JSON from the same-origin health endpoint", async () => {
  const response = await exports.default.fetch("https://example.test/api/v1/health");
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

- [ ] **Step 2: Run the smoke tests and confirm they fail before implementation**

Run: `pnpm --filter @event-roster/worker test -- health.integration.test.ts`

Expected: FAIL because the Worker entrypoint does not exist.

Run: `pnpm --filter @event-roster/web test -- App.test.tsx`

Expected: FAIL because `App` does not exist.

- [ ] **Step 3: Create the Worker, Static Assets, and React shell**

Create package manifests with these scripts and dependencies; pin exact resolved versions through `pnpm-lock.yaml`.

```jsonc
// apps/worker/package.json
{
  "name": "@event-roster/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "check": "tsc --noEmit && biome check src test",
    "types": "wrangler types",
    "dev": "wrangler dev --local",
    "deploy": "wrangler deploy"
  },
  "dependencies": { "hono": "^4.0.0" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.18.6",
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.45.0"
  }
}
```

```jsonc
// apps/web/package.json
{
  "name": "@event-roster/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "check": "tsc --noEmit && biome check src"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.0.0",
    "vite": "^7.0.0",
    "vitest": "^4.1.0"
  }
}
```

```ts
// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

```ts
// apps/web/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

```jsonc
// apps/worker/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"]
}
```

```jsonc
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "vite.config.ts", "vitest.config.ts"]
}
```

```jsonc
// apps/worker/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "event-roster",
  "main": "./src/index.ts",
  "compatibility_date": "2026-07-20",
  "workers_dev": true,
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "assets": {
    "directory": "../web/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "event-roster",
      "migrations_dir": "./migrations"
    }
  ]
}
```

The intentionally omitted `database_id` uses Wrangler automatic D1 provisioning, which requires the locked Wrangler version to be at least 4.45. The first successful production deploy should write the real non-secret ID back into this file; if it does not, use `wrangler d1 create event-roster --binding DB --update-config` and commit the generated ID in the deployment task.

```ts
// apps/worker/src/env.ts
export interface Env {
  DB: D1Database;
}
```

```ts
// apps/worker/src/app.ts
import { Hono } from "hono";
import type { Env } from "./env";
import { health } from "./routes/health";

export const app = new Hono<{ Bindings: Env }>();
app.route("/api/v1/health", health);
```

```ts
// apps/worker/src/routes/health.ts
import { Hono } from "hono";
export const health = new Hono().get("/", (c) => c.json({ status: "ok" as const }));
```

```ts
// apps/worker/src/index.ts
import { app } from "./app";
export default app;
```

```tsx
// apps/web/src/app/App.tsx
export function App() {
  return <main><h1>행사 참가자 명단</h1></main>;
}
```

- [ ] **Step 4: Configure Worker D1 tests and run local delivery checks**

```ts
// apps/worker/test/setup-d1.ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

```ts
// apps/worker/vitest.config.ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, APP_ORIGIN: "http://127.0.0.1:8787" } },
    })],
    test: { setupFiles: ["./test/setup-d1.ts"] },
  };
});
```

Use local D1 for day-to-day tests; do not use `wrangler dev --remote` without a separate preview database. Do not rely on the Vitest pool's automatic `nodejs_compat` injection: Worker source must use only APIs enabled by `wrangler.jsonc`.

Generate and commit `worker-configuration.d.ts` through `wrangler types`; `test/env.d.ts` must augment the Worker test environment with `TEST_MIGRATIONS` and `APP_ORIGIN` so `env.DB`/`env.TEST_MIGRATIONS` type-check without ad-hoc casts. Re-run the types command whenever bindings change.

Run: `pnpm --filter @event-roster/worker test && pnpm --filter @event-roster/web test`

Expected: PASS.

Run: `pnpm --filter @event-roster/web build && pnpm --filter @event-roster/worker exec wrangler dev --local --port 8787`

Expected: `GET /events/example` returns the SPA HTML and `GET /api/v1/health` returns `{"status":"ok"}`. Verify these two paths manually because `exports.default.fetch()` does not exercise Static Assets routing.

- [ ] **Step 5: Type-check, format-check, and commit the shell**

Run: `pnpm --filter @event-roster/worker run check && pnpm --filter @event-roster/web run check && pnpm format:check`

Expected: PASS.

```bash
git add .nvmrc .gitignore apps/worker apps/web pnpm-lock.yaml
git commit -m "feat: add Worker and web application shell"
```

### Task 3: Define shared contracts and pure domain rules

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/web/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/organizations.ts`
- Create: `packages/contracts/src/participants.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/roster.ts`
- Create: `packages/contracts/src/imports.ts`
- Create: `packages/contracts/src/exports.ts`
- Create: `packages/contracts/src/api.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/contracts.test.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/authorization.ts`
- Create: `packages/domain/src/event-lifecycle.ts`
- Create: `packages/domain/src/roster.ts`
- Create: `packages/domain/src/summary.ts`
- Create: `packages/domain/src/import-validation.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/authorization.test.ts`
- Create: `packages/domain/test/event-lifecycle.test.ts`
- Create: `packages/domain/test/roster.test.ts`
- Create: `packages/domain/test/summary.test.ts`
- Create: `packages/domain/test/import-validation.test.ts`

**Interfaces:**
- Consumes: the canonical contracts in this plan.
- Produces: runtime Zod schemas and pure functions `assertOrganizationWriteAccess`, `assertEventTransition`, `assertRosterWritable`, `assertFreshRevision`, `buildEventSummary`, and `validateNormalizedImportRows`.

- [ ] **Step 0: Bootstrap package manifests and test runners only**

Create the two package manifests and `tsconfig.json` files with `test`/`check` scripts, install their declared dependencies, and add only empty `src/`/`test/` directories. Do not create contract/domain modules. This lets the next command execute Vitest and fail for the intended missing module. Include the resulting `pnpm-lock.yaml` in the Task 3 commit.

- [ ] **Step 1: Write failing contract and domain tests**

```ts
// packages/domain/test/event-lifecycle.test.ts
import { expect, it } from "vitest";
import { assertEventTransition, DomainError } from "../src/event-lifecycle";

it("allows only the approved lifecycle transitions", () => {
  expect(() => assertEventTransition("DRAFT", "PRE_REGISTRATION")).not.toThrow();
  expect(() => assertEventTransition("CLOSED", "DAY_OF")).not.toThrow();
  expect(() => assertEventTransition("DAY_OF", "PRE_REGISTRATION")).toThrow(DomainError);
});
```

```ts
// packages/domain/test/summary.test.ts
import { expect, it } from "vitest";
import { buildEventSummary } from "../src/summary";

it("uses active day-of rows and cancelled pre-event rows as net deltas", () => {
  expect(buildEventSummary("event-1", [{ organizationId: "org-1", expected: 5, dayOfAdded: 2, dayOfCancelled: 1 }]))
    .toMatchObject({ expectedTotal: 5, finalTotal: 6, deltaTotal: 1 });
});
```

- [ ] **Step 2: Run the tests and confirm they fail before product modules exist**

Run: `pnpm --filter @event-roster/domain test`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement schemas and domain functions without Worker or D1 imports**

```ts
// packages/domain/src/event-lifecycle.ts
const allowed: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ["PRE_REGISTRATION"],
  PRE_REGISTRATION: ["DAY_OF"],
  DAY_OF: ["CLOSED"],
  CLOSED: ["DAY_OF"],
};

export function assertEventTransition(current: EventStatus, target: EventStatus): void {
  if (!allowed[current].includes(target)) throw new DomainError("INVALID_TRANSITION");
}
```

```ts
// packages/domain/src/authorization.ts
export function assertOrganizationWriteAccess(actor: Actor, organizationId: string): void {
  if (actor.role === "OPERATOR") return;
  if (!actor.organizationIds.includes(organizationId)) throw new DomainError("FORBIDDEN");
}
```

Define all request schemas in `packages/contracts` with Zod, including `LoginRequest`, `ChangePasswordRequest`, `EventCreate`, `EventPatch`, `EventTransition`, `RosterUpdate`, `ImportRowInput`, `ResolvedImportRow`, `EventExportData`, and `ApiProblem`. `EventPatch`, `EventTransition`, and `RosterUpdate` must require a positive integer `revision`; `source` must not be client writable.

Both package manifests must expose `test: vitest run` and `check: tsc --noEmit && biome check src test`. `@event-roster/contracts` owns the `zod` runtime dependency; `@event-roster/domain` depends only on `@event-roster/contracts: workspace:*`. Add `@event-roster/contracts: workspace:*` and `@event-roster/domain: workspace:*` only where Worker or web code consumes them. Neither shared package may depend on Hono, React, D1, or Worker runtime types.

- [ ] **Step 4: Run focused tests and package type checks**

Run: `pnpm --filter @event-roster/contracts test && pnpm --filter @event-roster/domain test`

Expected: PASS.

Run: `pnpm --filter @event-roster/contracts run check && pnpm --filter @event-roster/domain run check`

Expected: PASS.

- [ ] **Step 5: Commit contracts and rules**

```bash
git add packages/contracts packages/domain apps/worker/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add event roster contracts and domain rules"
```

### Task 4: Create the D1 schema and integration-test foundation

**Files:**
- Create: `apps/worker/migrations/0001_initial.sql`
- Create: `apps/worker/src/db/atomic.ts`
- Create: `apps/worker/src/db/rows.ts`
- Create: `apps/worker/test/support/seed.ts`
- Create: `apps/worker/test/support/http.ts`
- Create: `apps/worker/test/schema.integration.test.ts`
- Create: `apps/worker/test/atomic.integration.test.ts`
- Modify: `apps/worker/vitest.config.ts`

**Interfaces:**
- Consumes: `Actor`, enum schemas, and domain rules from Task 3.
- Produces: the complete D1 schema and `runAtomic(db: D1Database, statements: readonly D1PreparedStatement[]): Promise<D1Result[]>`.

- [ ] **Step 1: Write failing schema constraints and rollback tests**

```ts
// apps/worker/test/schema.integration.test.ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("rejects a duplicate year and half", async () => {
  await env.DB.prepare("INSERT INTO events (id,title,year,half,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)")
    .bind("e-1", "2026 상반기 행사", 2026, "H1", "DRAFT", "2026-07-20T00:00:00.000Z").run();
  await expect(env.DB.prepare("INSERT INTO events (id,title,year,half,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)")
    .bind("e-2", "중복", 2026, "H1", "DRAFT", "2026-07-20T00:00:00.000Z").run()).rejects.toThrow();
});
```

```ts
// apps/worker/test/atomic.integration.test.ts
it("leaves no roster or audit rows when a batch statement fails", async () => {
  await expect(runAtomic(env.DB, failingStatements)).rejects.toThrow();
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ?1").bind("event-1").first<{ count: number }>())?.count).toBe(0);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE event_id = ?1").bind("event-1").first<{ count: number }>())?.count).toBe(0);
});
```

- [ ] **Step 2: Run the integration tests and confirm they fail before the migration exists**

Run: `pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts`

Expected: FAIL because required tables and `runAtomic` do not exist.

- [ ] **Step 3: Add the full schema and the narrow D1 batch helper**

Create exactly these tables: `organizations`, `users`, `user_organizations`, `password_credentials`, `auth_sessions`, `login_attempts`, `security_events`, `bootstrap_locks`, `participants`, `events`, `event_roster_entries`, `event_expected_snapshots`, `audit_logs`, and `import_runs`.

The migration must enforce `users.email_normalized` unique, `participants.participant_number` unique, `events(year, half)` unique, `event_roster_entries(event_id, participant_id)` unique, enum `CHECK` constraints, positive `revision`, and foreign keys. Store audit before/after values as JSON text. Add indexes for roster event/status/organization filtering, audit event/created time, session ID/expiry, and normalized email lookup.

Use these exact column boundaries in `0001_initial.sql`:

| Table | Required columns and constraints |
| --- | --- |
| `organizations` | `id TEXT PRIMARY KEY`, `name TEXT NOT NULL UNIQUE`, `is_active INTEGER NOT NULL CHECK(is_active IN (0,1))`, `created_at`, `updated_at` |
| `users` | `id TEXT PRIMARY KEY`, `email_normalized TEXT NOT NULL UNIQUE`, `display_name TEXT NOT NULL`, `role TEXT NOT NULL CHECK(role IN ('OPERATOR','ORGANIZATION_MANAGER'))`, `is_active INTEGER NOT NULL`, `session_version INTEGER NOT NULL DEFAULT 1`, timestamps |
| `user_organizations` | `user_id`, `organization_id`, composite primary key, both foreign keys |
| `password_credentials` | `user_id TEXT PRIMARY KEY`, `kdf_version INTEGER`, `iterations INTEGER`, `salt_base64 TEXT`, `hash_base64 TEXT`, `pepper_version INTEGER`, `must_change_password INTEGER NOT NULL`, `changed_at` |
| `auth_sessions` | `id TEXT PRIMARY KEY`, `user_id`, `csrf_hash TEXT NOT NULL`, `kind TEXT CHECK(kind IN ('FULL','MUST_CHANGE_PASSWORD'))`, `issued_at`, `expires_at`, nullable `revoked_at` |
| `login_attempts` | `id TEXT PRIMARY KEY`, `email_normalized TEXT NOT NULL`, HMACed `ip_hash TEXT NOT NULL`, `outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','FAILURE'))`, `occurred_at TEXT NOT NULL`; index `(email_normalized, occurred_at)` and `(ip_hash, occurred_at)`. The outcome is required to calculate consecutive failures correctly. |
| `security_events` | `id TEXT PRIMARY KEY`, nullable `user_id`, `event_type TEXT NOT NULL`, nullable `ip_hash`, `request_id TEXT NOT NULL`, `created_at TEXT NOT NULL`; no credential columns |
| `bootstrap_locks` | singleton `id TEXT PRIMARY KEY CHECK(id = 'first-operator')`, `claimed_at TEXT NOT NULL`; an insert collision maps to first-operator bootstrap conflict |
| `participants` | `id TEXT PRIMARY KEY`, `participant_number TEXT NOT NULL UNIQUE`, `name TEXT NOT NULL`, `organization_id`, `is_active INTEGER NOT NULL`, timestamps |
| `events` | `id TEXT PRIMARY KEY`, `title TEXT NOT NULL`, `year INTEGER NOT NULL`, `half TEXT NOT NULL CHECK(half IN ('H1','H2'))`, nullable `event_date`, nullable `place`, `status TEXT NOT NULL CHECK(status IN ('DRAFT','PRE_REGISTRATION','DAY_OF','CLOSED'))`, `status_changed_at TEXT NOT NULL`, `revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)`, timestamps, `UNIQUE(year, half)` |
| `event_roster_entries` | `id TEXT PRIMARY KEY`, `event_id`, `participant_id`, `participant_number TEXT NOT NULL`, `snapshot_name TEXT NOT NULL`, snapshot organization ID/name, `source TEXT CHECK(source IN ('PRE_EVENT','DAY_OF'))`, `status TEXT CHECK(status IN ('ACTIVE','CANCELLED'))`, `revision INTEGER NOT NULL CHECK(revision > 0)`, `created_at`, `updated_at`, `updated_by_user_id TEXT NOT NULL REFERENCES users(id)`, and `UNIQUE(event_id, participant_id)` |
| `event_expected_snapshots` | `event_id`, `organization_id`, `organization_name`, `expected_count INTEGER NOT NULL CHECK(expected_count >= 0)`, `captured_at`, composite primary key `(event_id, organization_id)` |
| `audit_logs` | `id TEXT PRIMARY KEY`, nullable `actor_user_id`, nullable `event_id`, nullable `roster_entry_id`, `entity_type`, `action`, nullable `before_json`, nullable `after_json`, `created_at` |
| `import_runs` | `id TEXT PRIMARY KEY`, `event_id`, `actor_user_id`, `received_rows`, `created_rows`, `reactivated_rows`, `unchanged_rows`, `error_rows`, `committed_at`; all count columns non-negative |

Add `BEFORE UPDATE` and `BEFORE DELETE` triggers for both `audit_logs` and `security_events` that execute `SELECT RAISE(ABORT, 'append-only')`; add an integration assertion that each trigger rejects the mutation. `test/support/http.ts` owns only generic request/cookie helpers; domain-specific login helpers are added in Task 6 after authentication exists. Although the Workers Vitest pool isolates storage by test file, tests within a file share it: `seed.ts` must provide an FK-safe `resetDatabase()` and every integration suite must call it in `beforeEach` before seeding its own fixtures.

```ts
// apps/worker/src/db/atomic.ts
export async function runAtomic(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<D1Result[]> {
  return db.batch([...statements]);
}
```

Keep SQL construction in focused `db/*.ts` modules. Services perform any post-write reads explicitly after the batch; only the write set is promised atomic. Do not create a generic repository abstraction.

- [ ] **Step 4: Run integration tests with migration isolation**

Run: `pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts`

Expected: PASS. Confirm an intentionally duplicated key causes both the attempted roster and audit rows to remain absent.

- [ ] **Step 5: Run checks and commit the persistence layer**

Run: `pnpm --filter @event-roster/worker run check && pnpm format:check`

Expected: PASS.

```bash
git add apps/worker/migrations apps/worker/src/db apps/worker/test apps/worker/vitest.config.ts
git commit -m "feat: add D1 event roster schema"
```

### Task 5: Implement cryptographic primitives and first-operator bootstrap

**Files:**
- Modify: `apps/worker/src/env.ts`
- Create: `apps/worker/src/http/problem.ts`
- Create: `apps/worker/src/http/request-context.ts`
- Create: `apps/worker/src/http/origin.ts`
- Create: `apps/worker/src/security/password.ts`
- Create: `apps/worker/src/security/jwt.ts`
- Create: `apps/worker/src/security/cookies.ts`
- Create: `apps/worker/src/security/csrf.ts`
- Create: `apps/worker/src/db/auth.ts`
- Create: `apps/worker/src/services/bootstrap.ts`
- Create: `apps/worker/src/routes/bootstrap.ts`
- Create: `apps/worker/test/security/password.test.ts`
- Create: `apps/worker/test/security/jwt.test.ts`
- Create: `apps/worker/test/security/cookies.test.ts`
- Create: `apps/worker/test/support/env.ts`
- Create: `apps/worker/test/bootstrap.integration.test.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/wrangler.jsonc`
- Modify: `apps/worker/worker-configuration.d.ts` (regenerated)

**Interfaces:**
- Consumes: passed Task 1 ADR, D1 schema from Task 4, `Role` and auth schemas from Task 3.
- Produces: password and JWT primitives, `createSessionCookie`, `createCsrfToken`, `bootstrapFirstOperator`, and a bootstrap route that can run only while `users` is empty.

```ts
export const KDF_POLICY = {
  version: 1,
  algorithm: "PBKDF2-HMAC-SHA-256",
  iterations: 600_000,
  saltBytes: 16,
  hashBytes: 32,
} as const;

export interface StoredCredential {
  kdfVersion: number;
  iterations: number;
  saltBase64: string;
  hashBase64: string;
  mustChangePassword: boolean;
}

export async function createCredential(password: string, env: Env): Promise<StoredCredential>;
export async function verifyCredential(password: string, credential: StoredCredential, env: Env): Promise<boolean>;
export async function issueSessionJwt(claims: SessionClaims, env: Env): Promise<string>;
export async function verifySessionJwt(token: string, env: Env): Promise<SessionClaims>;
export async function bootstrapFirstOperator(input: BootstrapRequest, env: Env): Promise<{ user: User; temporaryPassword: string }>;
```

- [ ] **Step 1: Write failing security and bootstrap tests**

```ts
// apps/worker/test/security/password.test.ts
import { expect, it } from "vitest";
import { createCredential, verifyCredential } from "../../src/security/password";

it("uses distinct salts and verifies only the original NFC-normalized password", async () => {
  const one = await createCredential("비밀번호-123456", testEnv);
  const two = await createCredential("비밀번호-123456", testEnv);
  expect(one.saltBase64).not.toBe(two.saltBase64);
  await expect(verifyCredential("비밀번호-123456", one, testEnv)).resolves.toBe(true);
  await expect(verifyCredential("다른-비밀번호", one, testEnv)).resolves.toBe(false);
});
```

```ts
// apps/worker/test/security/cookies.test.ts
it("creates a host-only secure session cookie", () => {
  expect(createSessionCookie("signed.jwt", new Date("2026-07-20T08:00:00.000Z")))
    .toContain("__Host-er_session=signed.jwt; Path=/; HttpOnly; Secure; SameSite=Lax");
});
```

```ts
// apps/worker/test/bootstrap.integration.test.ts
it("creates exactly one first operator and never returns the stored credential", async () => {
  const first = await requestBootstrap({ email: "owner@example.com", displayName: "운영자" });
  expect(first.status).toBe(201);
  expect((await first.json()).temporaryPassword).toHaveLength(20);
  const second = await requestBootstrap({ email: "other@example.com", displayName: "다른 운영자" });
  expect(second.status).toBe(409);
});
```

- [ ] **Step 2: Run tests and confirm the missing security modules fail**

Run: `pnpm --filter @event-roster/worker test -- password.test.ts cookies.test.ts bootstrap.integration.test.ts`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement the passed KDF policy, JWT, cookies, CSRF, and problem handler**

Implement the exact `KDF_POLICY` that passed Task 1. Normalize passwords with `password.normalize("NFC")`, reject lengths outside 12–128 characters, generate salt with `crypto.getRandomValues`, HMAC the normalized password with `PASSWORD_PEPPER`, then use PBKDF2 over that HMAC. Compare derived byte arrays with a constant-time comparison.

`SessionClaims` must be:

```ts
export interface SessionClaims {
  sub: string;
  sid: string;
  sv: number;
  kind: "FULL" | "MUST_CHANGE_PASSWORD";
  iss: "event-roster";
  aud: "event-roster-web";
  iat: number;
  exp: number;
}
```

Use HS256 over base64url JSON. Reject malformed, altered, expired, wrong-issuer, and wrong-audience tokens. `FULL` expires in 8 hours and `MUST_CHANGE_PASSWORD` in 10 minutes.

Implement `createCsrfToken()` as 32 random bytes encoded base64url and store only SHA-256 of its raw value in `auth_sessions.csrf_hash`. `apps/worker/src/http/problem.ts` must convert known domain/auth errors to the canonical `ApiProblem` JSON and assign `crypto.randomUUID()` request IDs.

Add `APP_ORIGIN` as a non-secret Worker binding equal to the exact production `workers.dev` URL and mirror it in the local test binding. Store `BOOTSTRAP_TOKEN`, `PASSWORD_PEPPER`, `JWT_SIGNING_KEY`, and the distinct `IP_HASH_KEY` only as Worker Secrets. `test/support/env.ts` provides explicitly non-production test values for unit tests; it must never be imported by deployed Worker code.

- [ ] **Step 4: Implement and protect the bootstrap route**

```ts
// apps/worker/src/routes/bootstrap.ts
export const bootstrap = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const configuredToken = c.env.BOOTSTRAP_TOKEN;
  const suppliedToken = c.req.header("X-ER-Bootstrap-Token");
  if (!configuredToken || !suppliedToken || !constantTimeEqualUtf8(suppliedToken, configuredToken)) return c.notFound();
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const result = await bootstrapFirstOperator(BootstrapRequestSchema.parse(await c.req.json()), c.env);
  return c.json(result, 201);
});
```

`constantTimeEqualUtf8()` must first reject unequal byte lengths and otherwise compare every byte without an early return. Missing `BOOTSTRAP_TOKEN` is always a `404`, so deleting the secret disables the route rather than allowing an `undefined === undefined` request. `bootstrapFirstOperator` must be race-safe: its first batch statement conditionally inserts the singleton `bootstrap_locks('first-operator')` only when `users` is empty; a pre-existing lock or an existing user maps to conflict. It inspects the first statement's `meta.changes` and maps a zero count or unique-lock constraint error to `409`. The same batch then inserts the active `OPERATOR`, a `password_credentials` row with `must_change_password = 1`, and a `security_events` row only if that lock was acquired. This makes two simultaneous valid bootstrap requests yield exactly one initial operator. It returns only `{ user, temporaryPassword }`; the temporary password is never written to D1 or an audit event. Add both a deleted-secret regression test (`404`) and a concurrency regression test that issues two bootstrap requests in parallel and asserts one `201`, one conflict, and exactly one user.

- [ ] **Step 5: Run security and bootstrap verification**

Run: `pnpm --filter @event-roster/worker test -- password.test.ts jwt.test.ts cookies.test.ts bootstrap.integration.test.ts`

Expected: PASS, including altered/expired JWT rejection and second-bootstrap rejection.

Run: `pnpm --filter @event-roster/worker run types && pnpm --filter @event-roster/worker run check && pnpm format:check`

Expected: PASS.

- [ ] **Step 6: Commit security primitives and bootstrap**

```bash
git add apps/worker/src/env.ts apps/worker/src/http apps/worker/src/security apps/worker/src/db/auth.ts apps/worker/src/services/bootstrap.ts apps/worker/src/routes/bootstrap.ts apps/worker/test apps/worker/wrangler.jsonc apps/worker/worker-configuration.d.ts
git commit -m "feat: add Worker security primitives and bootstrap"
```

### Task 6: Add session authentication, CSRF, and login throttling

**Files:**
- Create: `apps/worker/src/services/auth.ts`
- Create: `apps/worker/src/middleware/authentication.ts`
- Create: `apps/worker/src/middleware/require-full-session.ts`
- Create: `apps/worker/src/middleware/csrf.ts`
- Create: `apps/worker/src/routes/auth.ts`
- Create: `apps/worker/test/support/auth.ts`
- Create: `apps/worker/test/auth.integration.test.ts`
- Modify: `apps/worker/src/db/auth.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: `createCredential`, `verifyCredential`, JWT/cookie/CSRF primitives from Task 5 and `Actor` from Task 3.
- Produces: `login`, `currentSession`, `rotateCsrf`, `changeInitialPassword`, `logout`, `requireActor`, and `requireFullSession`.

```ts
export async function login(input: LoginRequest, meta: RequestMeta, env: Env): Promise<{ session: CurrentSession; cookie: string }>;
export async function currentSession(token: string, env: Env): Promise<Actor>;
export async function rotateCsrf(sessionId: string, env: Env): Promise<string>;
export async function changeInitialPassword(actor: Actor, newPassword: string, env: Env): Promise<void>;
export async function logout(sessionId: string, env: Env): Promise<void>;
```

- [ ] **Step 1: Write failing authentication integration tests**

```ts
// apps/worker/test/auth.integration.test.ts
it("returns the same invalid-credential problem for wrong and unknown email", async () => {
  const wrong = await loginRequest({ email: "manager@example.com", password: "wrong-password-123" });
  const unknown = await loginRequest({ email: "nobody@example.com", password: "wrong-password-123" });
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(await unknown.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
});

it("permits a must-change session only to obtain CSRF and change password", async () => {
  const cookie = await loginAsTemporaryUser();
  expect((await authenticatedGet("/api/v1/events", cookie)).status).toBe(403);
  const csrf = await authenticatedGet("/api/v1/auth/csrf", cookie);
  expect(csrf.status).toBe(200);
});

it("revokes all sessions after initial password change", async () => {
  const first = await loginAsTemporaryUser();
  const second = await loginAsTemporaryUser();
  await changePassword(first);
  expect((await authenticatedGet("/api/v1/auth/me", first)).status).toBe(401);
  expect((await authenticatedGet("/api/v1/auth/me", second)).status).toBe(401);
});
```

- [ ] **Step 2: Run the integration test and confirm routes are unavailable**

Run: `pnpm --filter @event-roster/worker test -- auth.integration.test.ts`

Expected: FAIL because `/api/v1/auth/*` routes do not exist.

- [ ] **Step 3: Implement login, middleware, and exact CSRF rules**

`POST /auth/login` requires an exact `Origin` but no CSRF header because it creates no pre-existing authenticated action. It normalizes the email, records each attempt with `SUCCESS` or `FAILURE`, enforces account lock from the five most recent consecutive `FAILURE` outcomes within 15 minutes, enforces the IP-HMAC limit of 20 attempts / 15 minutes, and executes the same KDF path using a fixed dummy credential for absent users. It creates `MUST_CHANGE_PASSWORD` or `FULL` sessions with a fresh CSRF hash (the initial raw value is discarded and the first `/auth/csrf` call rotates it), then emits `security_events` without credentials. `test/support/auth.ts` adds the shared login, cookie, CSRF, and authenticated-request helpers used by Tasks 7–10.

`currentSession` verifies the JWT signature and claims, the persisted session ID/kind/expiry/revocation, the user `is_active` flag and `session_version`, then loads the user's currently active organization IDs from D1 rather than trusting a role/organization claim from an old JWT. `GET /auth/csrf` accepts both session kinds, rotates the CSRF value, stores its hash, returns `{ csrfToken }` with `Cache-Control: no-store`, and sends no CORS headers; it is the documented narrow token-bootstrap exception to the mutation rule. `POST /auth/change-password` requires a must-change session, exact Origin, and matching `X-ER-CSRF`; it increments `users.session_version`, revokes every active session for the user, inserts a security event, then clears the session cookie. `POST /auth/logout` uses the same Origin/CSRF checks and revokes only the current session.

All business routes use `requireActor`; routes except `GET /auth/me`, `GET /auth/csrf`, `POST /auth/change-password`, and `POST /auth/logout` also use `requireFullSession`.

The authorization/error middleware must persist a credential-free `security_events` record for every organization-scope `FORBIDDEN` response before returning `403`. Add an integration assertion that a manager's cross-organization roster/admin request produces one such event without exposing request credentials or CSRF values.

- [ ] **Step 4: Add regression tests for throttling and CSRF**

```ts
it("locks an account after five failures and rejects a missing CSRF header", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await loginRequest({ email: "manager@example.com", password: "wrong-password-123" });
  }
  expect((await loginRequest({ email: "manager@example.com", password: "correct-password-123" })).status).toBe(429);
  expect((await authenticatedPost("/api/v1/auth/logout", validCookie, {})).status).toBe(403);
});
```

- [ ] **Step 5: Run authentication verification and commit**

Run: `pnpm --filter @event-roster/worker test -- auth.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS.

```bash
git add apps/worker/src/services/auth.ts apps/worker/src/middleware apps/worker/src/routes/auth.ts apps/worker/src/db/auth.ts apps/worker/src/app.ts apps/worker/test/auth.integration.test.ts
git commit -m "feat: add session authentication and CSRF protection"
```

### Task 7: Build operator organization and account management APIs

**Files:**
- Create: `apps/worker/src/db/admin.ts`
- Create: `apps/worker/src/services/admin.ts`
- Create: `apps/worker/src/routes/organizations.ts`
- Create: `apps/worker/src/routes/users.ts`
- Create: `apps/worker/test/admin.integration.test.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/src/middleware/require-full-session.ts`

**Interfaces:**
- Consumes: `requireFullSession`, `Actor`, temporary credential creator, D1 schema, and role rules.
- Produces: operator-only organization and user APIs, one-display temporary password responses, and session invalidation on access changes.

```ts
export async function createOrganization(actor: Actor, input: OrganizationCreate, env: Env): Promise<Organization>;
export async function createUser(actor: Actor, input: UserCreate, env: Env): Promise<{ user: User; temporaryPassword: string }>;
export async function resetUserPassword(actor: Actor, userId: string, env: Env): Promise<{ temporaryPassword: string }>;
export async function setUserAccess(actor: Actor, userId: string, input: UserAccessPatch, env: Env): Promise<User>;
```

- [ ] **Step 1: Write failing operator and organization-scope tests**

```ts
// apps/worker/test/admin.integration.test.ts
it("allows only operators to create an organization and a manager", async () => {
  expect((await postAsManager("/api/v1/organizations", { name: "개발팀" })).status).toBe(403);
  const created = await postAsOperator("/api/v1/organizations", { name: "개발팀" });
  expect(created.status).toBe(201);
});

it("shows a generated temporary password once and invalidates changed user sessions", async () => {
  const response = await postAsOperator("/api/v1/users", { email: "manager@example.com", displayName: "조직 담당자", role: "ORGANIZATION_MANAGER", organizationIds: [orgId] });
  const body = await response.json();
  expect(body.temporaryPassword).toHaveLength(20);
  expect(body.user).not.toHaveProperty("passwordHash");
});
```

- [ ] **Step 2: Run the admin test and confirm it fails before routes are added**

Run: `pnpm --filter @event-roster/worker test -- admin.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement organizations, users, activation, and password resets**

Require an `OPERATOR` actor for every route. Creating or resetting a user generates a new 20-character temporary password, creates/updates `password_credentials.must_change_password = 1`, increments `session_version`, revokes active sessions, and records a security event. Return the raw temporary password only in the successful mutation response.

An organization `PATCH { isActive: false }` must reject future links and roster writes for that organization, retain history, increment `session_version` and revoke every active session for every manager assigned to that organization so their active-organization scope is reloaded on the next login. A user `PATCH { isActive: false }`, role change, or organization-link change must likewise increment the affected user session version and revoke every active session before returning.

- [ ] **Step 4: Run access-change regression tests**

```ts
it("rejects a previous manager cookie after the operator removes its organization link", async () => {
  const cookie = await loginAsManager();
  await patchAsOperator(`/api/v1/users/${managerId}`, { organizationIds: [] });
  expect((await authenticatedGet("/api/v1/auth/me", cookie)).status).toBe(401);
});

it("rejects an existing cookie after the operator deactivates that user", async () => {
  const cookie = await loginAsManager();
  await patchAsOperator(`/api/v1/users/${managerId}`, { isActive: false });
  expect((await authenticatedGet("/api/v1/auth/me", cookie)).status).toBe(401);
});
```

Run: `pnpm --filter @event-roster/worker test -- admin.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit administration APIs**

```bash
git add apps/worker/src/db/admin.ts apps/worker/src/services/admin.ts apps/worker/src/routes/organizations.ts apps/worker/src/routes/users.ts apps/worker/src/middleware apps/worker/src/app.ts apps/worker/test/admin.integration.test.ts
git commit -m "feat: add organization and account administration"
```

### Task 8: Implement event lifecycle and participant master APIs

**Files:**
- Create: `apps/worker/src/db/audit.ts`
- Create: `apps/worker/src/db/events.ts`
- Create: `apps/worker/src/db/participants.ts`
- Create: `apps/worker/src/services/events.ts`
- Create: `apps/worker/src/services/participants.ts`
- Create: `apps/worker/src/routes/events.ts`
- Create: `apps/worker/src/routes/participants.ts`
- Create: `apps/worker/test/events.integration.test.ts`
- Create: `apps/worker/test/participants.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: lifecycle and authorization functions from Task 3, D1 transaction helper, authenticated actor.
- Produces: event CRUD/lifecycle routes and participant search/create/update routes.

```ts
export async function createEvent(actor: Actor, input: EventCreate, env: Env): Promise<Event>;
export async function transitionEvent(actor: Actor, eventId: string, target: EventStatus, revision: number, env: Env): Promise<Event>;
export async function searchParticipants(actor: Actor, query: string, organizationId?: string, env: Env): Promise<Participant[]>;
export async function updateParticipant(actor: Actor, participantId: string, input: ParticipantPatch, env: Env): Promise<Participant>;
```

- [ ] **Step 1: Write failing event transition and participant-scope tests**

```ts
// apps/worker/test/events.integration.test.ts
it("creates an H1 event once and snapshots expected counts exactly on DAY_OF", async () => {
  await postAsOperator("/api/v1/events", { title: "2026 상반기 행사", year: 2026, half: "H1", eventDate: "2026-06-20" });
  expect((await postAsOperator(`/api/v1/events/${eventId}/transition`, { targetStatus: "DAY_OF", revision: 1 })).status).toBe(409);
  await postAsOperator(`/api/v1/events/${eventId}/transition`, { targetStatus: "PRE_REGISTRATION", revision: 1 });
  expect((await postAsOperator(`/api/v1/events/${eventId}/transition`, { targetStatus: "DAY_OF", revision: 2 })).status).toBe(200);
});
```

```ts
// apps/worker/test/participants.integration.test.ts
it("prevents a manager from moving a participant and prevents an active day-of organization move", async () => {
  expect((await patchAsManager(`/api/v1/participants/${participantId}`, { organizationId: otherOrgId })).status).toBe(403);
  expect((await patchAsOperator(`/api/v1/participants/${participantId}`, { organizationId: otherOrgId })).status).toBe(409);
});
```

- [ ] **Step 2: Run the tests and confirm event and participant endpoints are absent**

Run: `pnpm --filter @event-roster/worker test -- events.integration.test.ts participants.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement lifecycle, snapshots, and participant rules**

Event creation creates `DRAFT` and initializes `status_changed_at`; only an operator can edit title/date/place in `DRAFT` or `PRE_REGISTRATION`. Every patch and transition carries the visible event revision. `transitionEvent` uses `assertEventTransition` and changes state with `UPDATE events ... WHERE id = ? AND status = ? AND revision = ?`; it updates `status_changed_at`, increments `revision`, and returns a stale-state conflict if the update changed no row. Transition to `DAY_OF` writes the guarded event transition, every expected snapshot, and an audit row in one batch; each snapshot/audit statement is itself derived from the expected post-transition event row so a failed state guard creates no orphan records. Transition from `CLOSED` to `DAY_OF` preserves existing snapshots and records `EVENT_REOPENED`.

Participant search is organization-scoped for managers. A manager can create an active participant for an assigned active organization and correct only its name. An operator can change organization only when no active `DAY_OF` roster row references the participant; `CLOSED` rows never block a later master-data move. A permitted name or organization change updates the participant master, every affected `PRE_REGISTRATION` roster snapshot, and corresponding audit rows in one D1 batch; it never rewrites a `DAY_OF` or `CLOSED` snapshot. Add a regression that permits a move after close while preserving the historical organization snapshot. Generate `P-${crypto.randomUUID().toUpperCase()}` and retry one time on its unique constraint collision.

- [ ] **Step 4: Run lifecycle and participant regression tests**

Add and run tests for duplicate `(year, half)`, stale event transition revision, forbidden `PRE_REGISTRATION` rollback, closed-event metadata edit, organization deactivation, and snapshot preservation after re-open.

Run: `pnpm --filter @event-roster/worker test -- events.integration.test.ts participants.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit event and participant APIs**

```bash
git add apps/worker/src/db/audit.ts apps/worker/src/db/events.ts apps/worker/src/db/participants.ts apps/worker/src/services/events.ts apps/worker/src/services/participants.ts apps/worker/src/routes/events.ts apps/worker/src/routes/participants.ts apps/worker/src/app.ts apps/worker/test/events.integration.test.ts apps/worker/test/participants.integration.test.ts
git commit -m "feat: add event lifecycle and participant master"
```

### Task 9: Implement roster changes, summaries, and audit history

**Files:**
- Create: `apps/worker/src/db/roster.ts`
- Create: `apps/worker/src/db/reports.ts`
- Create: `apps/worker/src/services/roster.ts`
- Create: `apps/worker/src/services/reports.ts`
- Create: `apps/worker/src/routes/roster.ts`
- Create: `apps/worker/src/routes/reports.ts`
- Create: `apps/worker/test/roster.integration.test.ts`
- Create: `apps/worker/test/reports.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: event/participant services, `RosterEntry`, `EventSummary`, `assertRosterWritable`, `assertFreshRevision`.
- Produces: roster list/add/patch, summary, and cursor-based audit history APIs.

```ts
export async function listRoster(actor: Actor, eventId: string, filters: RosterFilters, env: Env): Promise<RosterEntry[]>;
export async function addRosterEntry(actor: Actor, eventId: string, participantId: string, env: Env): Promise<RosterEntry>;
export async function updateRosterEntry(actor: Actor, eventId: string, entryId: string, command: RosterUpdate, env: Env): Promise<RosterEntry>;
export async function getSummary(actor: Actor, eventId: string, env: Env): Promise<EventSummary>;
```

- [ ] **Step 1: Write failing roster behavior tests**

```ts
// apps/worker/test/roster.integration.test.ts
it("derives source from event state and preserves a cancelled row", async () => {
  await moveEventTo("PRE_REGISTRATION");
  const pre = await postAsManager(`/api/v1/events/${eventId}/roster`, { participantId });
  expect((await pre.json()).source).toBe("PRE_EVENT");
  await moveEventTo("DAY_OF");
  const cancelled = await patchAsManager(`/api/v1/events/${eventId}/roster/${entryId}`, { revision: 1, status: "CANCELLED" });
  expect((await cancelled.json()).status).toBe("CANCELLED");
  expect(await countRows("event_roster_entries", "id", entryId)).toBe(1);
});

it("returns the latest entry details for a stale revision", async () => {
  const response = await patchAsManager(`/api/v1/events/${eventId}/roster/${entryId}`, { revision: 1, status: "CANCELLED" });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "STALE_REVISION", details: { latestEntry: expect.any(Object), changedBy: expect.any(Object), changedAt: expect.any(String) } });
});
```

- [ ] **Step 2: Run the roster tests and confirm routes are unavailable**

Run: `pnpm --filter @event-roster/worker test -- roster.integration.test.ts reports.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement scoped roster writes and audit batches**

`addRosterEntry` accepts only an existing participant, verifies the actor can write the participant organization, and derives `PRE_EVENT` in `PRE_REGISTRATION` or `DAY_OF` in `DAY_OF`; callers never send `source`. Its roster insert is an `INSERT … SELECT` guarded by the expected event status and revision, and it checks the affected row count before creating dependent audit/snapshot rows. It rejects a duplicate active row. A cancelled row is reactivated only through `PATCH` with the current revision.

`updateRosterEntry` requires exact row revision and includes the expected writable event state/revision in every write predicate. It writes the roster mutation, any allowed participant-name correction and current event snapshot update, and a JSON before/after `audit_logs` row in one D1 batch. If the state/revision guard affects no row, it re-reads the event and returns `EVENT_CLOSED`, `INVALID_TRANSITION`, or `STALE_REVISION` rather than writing a stale mutation. Managers cannot update a row outside an assigned organization.

`getSummary` uses the fixed snapshot after `DAY_OF`; before that, expected and final both equal active pre-event rows. After `DAY_OF`, compute `dayOfAdded` and `dayOfCancelled` exactly as the global constraints define. Audit history returns 50 rows ordered by `(created_at DESC, id DESC)` and accepts a cursor composed of the last row timestamp and ID. Managers may receive only audit rows joined to roster entries in their assigned organizations; event-level audit rows without an organization scope remain operator-only.

- [ ] **Step 4: Run summary, authorization, reactivation, and conflict tests**

```ts
// apps/worker/test/reports.integration.test.ts
it("keeps expected fixed while day-of net changes update final", async () => {
  const summary = await getAsOperator(`/api/v1/events/${eventId}/summary`);
  expect(await summary.json()).toMatchObject({ expectedTotal: 5, finalTotal: 6, deltaTotal: 1 });
});
```

Run: `pnpm --filter @event-roster/worker test -- roster.integration.test.ts reports.integration.test.ts`

Expected: PASS.

Add a `Promise.all` regression that races a `DAY_OF` transition against a pre-event roster add. It must leave either a snapshot that contains the added entry or no added pre-event entry; an entry that escaped the expected snapshot is a test failure.

- [ ] **Step 5: Commit roster and reporting APIs**

```bash
git add apps/worker/src/db/roster.ts apps/worker/src/db/reports.ts apps/worker/src/services/roster.ts apps/worker/src/services/reports.ts apps/worker/src/routes/roster.ts apps/worker/src/routes/reports.ts apps/worker/src/app.ts apps/worker/test/roster.integration.test.ts apps/worker/test/reports.integration.test.ts
git commit -m "feat: add roster operations and event summaries"
```

### Task 10: Implement Excel import validation, atomic commit, and export-data APIs

**Files:**
- Create: `apps/worker/src/db/imports.ts`
- Create: `apps/worker/src/services/imports.ts`
- Create: `apps/worker/src/services/exports.ts`
- Create: `apps/worker/src/routes/imports.ts`
- Create: `apps/worker/src/routes/exports.ts`
- Create: `apps/worker/test/imports.integration.test.ts`
- Create: `apps/worker/test/exports.integration.test.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `packages/contracts/src/imports.ts`
- Modify: `packages/contracts/src/exports.ts`

**Interfaces:**
- Consumes: participant/roster services and `runAtomic` from Tasks 8–9.
- Produces: validate/commit import APIs and an event-scoped `EventExportData` DTO.

```ts
export type ImportResolution =
  | { kind: "CREATE"; name: string; organizationId: string }
  | { kind: "USE_EXISTING"; participantId: string }
  | { kind: "REACTIVATE"; participantId: string };

export interface ImportRowInput {
  rowNumber: number;
  name: string;
  organizationName: string;
}

export interface ResolvedImportRow extends ImportRowInput {
  resolution: ImportResolution;
}

export async function validateImport(actor: Actor, eventId: string, rows: ImportRowInput[], env: Env): Promise<ImportValidationResult>;
export async function commitImport(actor: Actor, eventId: string, rows: ResolvedImportRow[], env: Env): Promise<ImportCommitResult>;
export async function getEventExportData(actor: Actor, eventId: string, env: Env): Promise<EventExportData>;
```

- [ ] **Step 1: Write failing validate/commit/export tests**

```ts
// apps/worker/test/imports.integration.test.ts
it("reports unknown organizations and duplicate input without saving anything", async () => {
  const response = await postAsOperator(`/api/v1/events/${eventId}/imports/validate`, [
    { rowNumber: 2, name: "김참가", organizationName: "없는 조직" },
    { rowNumber: 3, name: "김참가", organizationName: "없는 조직" },
  ]);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ rowNumber: 2 })]) });
  expect(await countRows("participants")).toBe(0);
});

it("rolls back every participant, roster, audit, and import row when one resolved input is invalid", async () => {
  const response = await postAsOperator(`/api/v1/events/${eventId}/imports/commit`, invalidResolvedRows);
  expect(response.status).toBe(422);
  expect(await countRows("participants")).toBe(0);
  expect(await countRows("event_roster_entries")).toBe(0);
  expect(await countRows("audit_logs")).toBe(0);
  expect(await countRows("import_runs")).toBe(0);
});
```

```ts
// apps/worker/test/exports.integration.test.ts
it("returns only the selected event roster and organization summary", async () => {
  const response = await getAsOperator(`/api/v1/events/${eventId}/export-data`);
  const body = await response.json();
  expect(body.roster).toHaveLength(1);
  expect(body).not.toHaveProperty("passwordHash");
  expect(body).not.toHaveProperty("originalWorkbook");
});
```

- [ ] **Step 2: Run the tests and confirm the import/export routes fail first**

Run: `pnpm --filter @event-roster/worker test -- imports.integration.test.ts exports.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement server-side validation and all-or-nothing commit**

`validateImport` requires a full-session operator and a `PRE_REGISTRATION` event. It does not create rows. It trims and NFC-normalizes names, resolves organization names against active organizations, rejects input duplicates by `(normalizedName, organizationId)`, and returns either one exact active participant candidate, a `CREATE` suggestion, or multiple candidate IDs requiring user selection.

`commitImport` repeats every authorization, event-state, organization, duplicate, and candidate validation. It captures the expected `PRE_REGISTRATION` event revision, and every participant/roster/audit/import statement in its one batch is conditionally derived from the same still-`PRE_REGISTRATION` event row. If the guarded import write changes no expected rows, it returns a status/revision conflict and rolls back the entire import. It accepts active matching rows as `unchanged`, applies `REACTIVATE` only to an existing cancelled row, and creates a participant only for `CREATE`. One batch inserts all required participant rows, pre-event roster rows, audit logs, and exactly one `import_runs` record. `import_runs` stores received, created, reactivated, unchanged, and error counts; it never stores file bytes or cell source values.

`getEventExportData` uses the same scope checks as summary/audit and returns only:

```ts
type EventExportData = {
  event: { id: string; title: string; year: number; half: Half };
  roster: Array<{ participantNumber: string; name: string; organizationName: string; source: RosterSource; status: RosterStatus; updatedAt: string }>;
  summary: EventSummary;
};
```

- [ ] **Step 4: Add 130-row and reactivation regression tests**

```ts
it("commits 130 valid rows once and treats a cancelled matching row as an explicit reactivation", async () => {
  expect((await postAsOperator(`/api/v1/events/${eventId}/imports/commit`, oneHundredThirtyResolvedRows)).status).toBe(201);
  expect(await countRows("event_roster_entries")).toBe(130);
  expect((await postAsOperator(`/api/v1/events/${eventId}/imports/commit`, [cancelledResolution])).status).toBe(201);
});
```

Add a `Promise.all` regression that races a `DAY_OF` transition against a 130-row `commit` request. The final database state must be either a complete pre-event import included in the expected snapshot or a complete rejected import with zero participant/roster/audit/import rows from that request; partial or unsnapshotted rows fail the test.

Run: `pnpm --filter @event-roster/worker test -- imports.integration.test.ts exports.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit import and export APIs**

```bash
git add apps/worker/src/db/imports.ts apps/worker/src/services/imports.ts apps/worker/src/services/exports.ts apps/worker/src/routes/imports.ts apps/worker/src/routes/exports.ts apps/worker/src/app.ts apps/worker/test/imports.integration.test.ts apps/worker/test/exports.integration.test.ts packages/contracts/src/imports.ts packages/contracts/src/exports.ts
git commit -m "feat: add atomic roster import and export data"
```

### Task 11: Build the React foundation, design tokens, and own-login flow

**Files:**
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/SessionProvider.tsx`
- Create: `apps/web/src/app/RequireSession.tsx`
- Create: `apps/web/src/lib/api/client.ts`
- Create: `apps/web/src/lib/api/problem.ts`
- Create: `apps/web/src/lib/api/csrf.ts`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/components/ui/Button.tsx`
- Create: `apps/web/src/components/ui/Badge.tsx`
- Create: `apps/web/src/components/ui/Dialog.tsx`
- Create: `apps/web/src/components/ui/Tabs.tsx`
- Create: `apps/web/src/components/ui/Table.tsx`
- Create: `apps/web/src/components/ui/EmptyState.tsx`
- Create: `apps/web/src/components/ui/Progress.tsx`
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/ChangePasswordPage.tsx`
- Create: `apps/web/src/features/auth/auth.test.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: API contracts and auth endpoints from Tasks 3 and 6.
- Produces: in-memory CSRF client, session-aware routing, the initial password-change-only user experience, and reusable `--er-*` UI primitives.

```ts
export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export function useSession(): {
  session: CurrentSession | null;
  refresh(): Promise<void>;
  logout(): Promise<void>;
};
```

- [ ] **Step 1: Write failing browser tests for no token persistence and forced password change**

```tsx
// apps/web/src/features/auth/auth.test.tsx
it("sends credentials to the login API without storing a token in web storage", async () => {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("이메일"), "manager@example.com");
  await userEvent.type(screen.getByLabelText("비밀번호"), "temporary-password-123");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});

it("routes a must-change session only to the password-change page", async () => {
  mockCurrentSession({ sessionKind: "MUST_CHANGE_PASSWORD" });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "새 비밀번호 설정" })).toBeVisible();
});
```

- [ ] **Step 2: Run the browser tests and confirm required components do not exist**

Run: `pnpm --filter @event-roster/web test -- auth.test.tsx`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement same-origin API client, session provider, and tokens**

`ApiClient` must call `fetch(path, { credentials: "same-origin" })`. `SessionProvider` first requests `/api/v1/auth/me`; when authenticated, its dedicated `fetchCsrf()` requests `GET /api/v1/auth/csrf` and retains the raw token only in React state. `post` and `patch` include `X-ER-CSRF`; `get` does not. A 401 clears only in-memory session/CSRF state and routes to `/login`.

Define `--er-color-*`, `--er-space-*`, `--er-radius-*`, `--er-shadow-*`, and `--er-font-weight-*` in `tokens.css`. Implement primitives with accessible native elements, visible focus styles, disabled states, and no hard-coded visual values outside tokens.

`LoginPage` uses an email input, a password input, and one generic failure message. `ChangePasswordPage` requires password/confirmation, posts to `/auth/change-password`, clears provider state on 204, and routes back to `/login` with “새 비밀번호로 다시 로그인하세요.”

- [ ] **Step 4: Run UI tests, type checks, and a production build**

Run: `pnpm --filter @event-roster/web test -- auth.test.tsx && pnpm --filter @event-roster/web run check && pnpm --filter @event-roster/web build`

Expected: PASS.

- [ ] **Step 5: Commit the web foundation**

```bash
git add apps/web/src/app apps/web/src/lib apps/web/src/styles apps/web/src/components/ui apps/web/src/features/auth apps/web/src/main.tsx apps/web/package.json
git commit -m "feat: add web session foundation and login flow"
```

### Task 12: Build organization, user, and event management screens

**Files:**
- Create: `apps/web/src/features/events/EventListPage.tsx`
- Create: `apps/web/src/features/events/EventForm.tsx`
- Create: `apps/web/src/features/events/EventTransitionDialog.tsx`
- Create: `apps/web/src/features/events/events.test.tsx`
- Create: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Create: `apps/web/src/features/admin/UsersPage.tsx`
- Create: `apps/web/src/features/admin/TemporaryPasswordDialog.tsx`
- Create: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: operator APIs from Tasks 7–8 and UI primitives from Task 11.
- Produces: operator-only user/organization controls and event list/create/edit/transition workflow.

- [ ] **Step 1: Write failing operator-screen tests**

```tsx
// apps/web/src/features/admin/admin.test.tsx
it("shows a generated temporary password once and erases it when the dialog closes", async () => {
  mockApi.post.mockResolvedValueOnce({ user: manager, temporaryPassword: "abcdefghijklmnopqrst" });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole("button", { name: "조직 담당자 추가" }));
  expect(await screen.findByText("abcdefghijklmnopqrst")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("abcdefghijklmnopqrst")).not.toBeInTheDocument();
});
```

```tsx
// apps/web/src/features/events/events.test.tsx
it("disables event metadata editing in DAY_OF and shows reopen only for CLOSED", () => {
  render(<EventForm event={{ ...event, status: "DAY_OF" }} />);
  expect(screen.getByLabelText("행사명")).toBeDisabled();
});
```

- [ ] **Step 2: Run the tests and confirm management screens are absent**

Run: `pnpm --filter @event-roster/web test -- admin.test.tsx events.test.tsx`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement role-aware management and event screens**

Render administration navigation only for `OPERATOR`. The organization page creates, activates, and deactivates organizations; the users page creates users, changes roles/organization assignments, resets temporary passwords, and shows raw temporary passwords only in `TemporaryPasswordDialog` local state.

The event list separates active events from `지난 행사`. `EventForm` submits create/patch only for `DRAFT` and `PRE_REGISTRATION`, retaining and sending the server event revision; a stale event conflict reloads the latest event before allowing retry. `EventTransitionDialog` likewise sends the current revision, explains that `DAY_OF` captures the expected snapshot and that reopen preserves it. Organization managers see only events and summaries allowed by their role and never administration navigation.

- [ ] **Step 4: Run management screen tests**

Run: `pnpm --filter @event-roster/web test -- admin.test.tsx events.test.tsx && pnpm --filter @event-roster/web run check`

Expected: PASS.

- [ ] **Step 5: Commit management screens**

```bash
git add apps/web/src/features/admin apps/web/src/features/events apps/web/src/app/router.tsx apps/web/src/app/App.tsx
git commit -m "feat: add event and account management screens"
```

### Task 13: Build the event roster operating console

**Files:**
- Create: `apps/web/src/features/roster/RosterConsolePage.tsx`
- Create: `apps/web/src/features/roster/RosterTable.tsx`
- Create: `apps/web/src/features/roster/RosterFilters.tsx`
- Create: `apps/web/src/features/roster/RosterEditorPanel.tsx`
- Create: `apps/web/src/features/roster/RosterConflictDialog.tsx`
- Create: `apps/web/src/features/roster/AuditLogPanel.tsx`
- Create: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: roster, report, audit APIs from Task 9 and UI primitives from Task 11.
- Produces: dense 130-row console with summaries, scoped edits, conflict recovery, and audit panel.

- [ ] **Step 1: Write failing operating-console tests**

```tsx
// apps/web/src/features/roster/roster.test.tsx
it("filters the already loaded roster without pagination", async () => {
  mockRoster(Array.from({ length: 130 }, (_, index) => rosterEntry(`참가자${index}`)));
  render(<RosterConsolePage />);
  await userEvent.type(screen.getByLabelText("이름 검색"), "참가자42");
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

it("opens a conflict dialog with refresh and merge choices for STALE_REVISION", async () => {
  mockPatchProblem({ code: "STALE_REVISION", details: { latestEntry: latest, changedBy: actor, changedAt: "2026-07-20T00:00:00.000Z" } });
  render(<RosterEditorPanel entry={entry} />);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("dialog", { name: "동시 수정 충돌" })).toBeVisible();
});
```

- [ ] **Step 2: Run the roster UI test and confirm components are absent**

Run: `pnpm --filter @event-roster/web test -- roster.test.tsx`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement table-first console behavior**

Fetch roster, summary, and first audit page for the selected event. Render overall expected/final/delta and organization summaries above a fixed-header table. Keep all 130 fetched rows in memory and filter by normalized name, organization, and status; do not add pagination or virtualization.

`RosterEditorPanel` adds an existing/new participant, changes status, and performs allowed name correction. It is disabled in `CLOSED`. A `STALE_REVISION` problem opens `RosterConflictDialog` with the server’s latest entry, actor, timestamp, and explicit “최신 값으로 새로고침” / “내 변경 다시 적용” actions. At narrow widths the table becomes read-only participant cards while edits remain available in the panel.

- [ ] **Step 4: Run console tests and verify accessibility states**

Run: `pnpm --filter @event-roster/web test -- roster.test.tsx && pnpm --filter @event-roster/web run check`

Expected: PASS. Confirm closed-event buttons are disabled and organization managers cannot see other-organization rows.

- [ ] **Step 5: Commit the operating console**

```bash
git add apps/web/src/features/roster apps/web/src/app/router.tsx
git commit -m "feat: add event roster operating console"
```

### Task 14: Add browser-only Excel import and export UI

**Files:**
- Create: `apps/web/src/features/imports/ImportPage.tsx`
- Create: `apps/web/src/features/imports/workbook.ts`
- Create: `apps/web/src/features/imports/ColumnMappingStep.tsx`
- Create: `apps/web/src/features/imports/ValidationReviewStep.tsx`
- Create: `apps/web/src/features/imports/imports.test.tsx`
- Create: `apps/web/src/features/exports/downloadWorkbook.ts`
- Create: `apps/web/src/features/exports/ExportButton.tsx`
- Create: `apps/web/src/features/exports/exports.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: import/export contracts from Task 10 and the `xlsx` browser package.
- Produces: four-stage in-memory import UI and two-sheet `.xlsx` download without uploading raw file bytes.

```ts
export function parseWorkbook(file: File): Promise<{ sheets: string[]; rowsBySheet: Record<string, string[][]> }>;
export function normalizeMappedRows(rows: string[][], mapping: { nameColumn: number; organizationColumn: number }): ImportRowInput[];
export function downloadEventWorkbook(data: EventExportData): void;
```

- [ ] **Step 1: Write failing workbook and import-flow tests**

```ts
// apps/web/src/features/imports/imports.test.tsx
it("does not call the API until all validation issues are resolved", async () => {
  render(<ImportPage eventId="event-1" />);
  await selectWorkbookWithUnknownOrganization();
  expect(screen.getByText("오류를 모두 해결해야 확정할 수 있습니다.")).toBeVisible();
  expect(mockApi.post).not.toHaveBeenCalledWith("/api/v1/events/event-1/imports/commit", expect.anything());
});
```

```ts
// apps/web/src/features/exports/exports.test.ts
it("creates roster and summary sheets from API data", () => {
  const workbook = buildEventWorkbook(exportData);
  expect(workbook.SheetNames).toEqual(["명단", "집계"]);
});
```

- [ ] **Step 2: Run the tests and confirm workbook helpers are absent**

Run: `pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement browser-only Excel parsing and four stages**

Use SheetJS `XLSX.read(await file.arrayBuffer())` only in `workbook.ts`; never send `File`, `ArrayBuffer`, worksheet XML, or cell source text to the Worker. The stages are: file/sheet selection, name/organization column mapping and preview, validation/candidate resolution, and one all-or-nothing commit. The UI calls `/imports/validate` with normalized JSON rows and `/imports/commit` only when `valid === true` and every ambiguous candidate has a resolution.

Add `xlsx` to `@event-roster/web` dependencies only; `apps/worker` and every shared package must remain free of SheetJS imports.

Run `pnpm install` immediately after changing `apps/web/package.json` so the checked-in `pnpm-lock.yaml` pins the browser-only SheetJS dependency.

Display row number, reason, and corrective action for every issue. Keep the selected file and parsed rows in component memory; clear them on cancel, successful commit, and route leave. Render the import route only for operators and `PRE_REGISTRATION` events.

`downloadEventWorkbook` builds exactly `명단` and `집계` sheets from `EventExportData`, calls `XLSX.writeFile`, and includes no raw upload data.

- [ ] **Step 4: Run browser Excel tests and build**

Run: `pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts && pnpm --filter @event-roster/web build`

Expected: PASS.

- [ ] **Step 5: Commit import and export UI**

```bash
git add apps/web/src/features/imports apps/web/src/features/exports apps/web/src/app/router.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add browser Excel import and export"
```

### Task 15: Finish end-to-end coverage, CI, deployment, and recovery operations

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`
- Create: `apps/web/e2e/event-roster.spec.ts`
- Create: `apps/web/e2e/import-export.spec.ts`
- Create: `apps/web/e2e/global-setup.ts`
- Create: `apps/web/e2e/global-teardown.ts`
- Create: `apps/web/e2e/fixtures/create-workbooks.mts`
- Create: `apps/worker/scripts/prepare-e2e-env.mts`
- Create: `apps/worker/scripts/smoke-remote.mts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/recovery.md`
- Modify: `README.md`
- Modify: `apps/worker/wrangler.jsonc`
- Modify: `apps/worker/package.json`
- Modify: `apps/web/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all completed APIs, UI features, Worker config, and capability-gate ADR.
- Produces: repeatable CI, local E2E, controlled production setup, remote smoke test, and recovery instructions.

- [ ] **Step 1: Write failing end-to-end scenarios**

```ts
// apps/web/e2e/event-roster.spec.ts
import { expect, test } from "@playwright/test";

test("operator snapshots pre-event numbers and resolves a day-of cancellation", async ({ page }) => {
  await loginAsOperator(page);
  await createPreRegistrationEvent(page);
  await addFiveParticipants(page);
  await page.getByRole("button", { name: "당일 운영으로 전환" }).click();
  await cancelFirstParticipant(page);
  await expect(page.getByTestId("final-total")).toHaveText("4");
  await expect(page.getByTestId("expected-total")).toHaveText("5");
});
```

```ts
// apps/web/e2e/import-export.spec.ts
test("operator imports 130 mapped rows and downloads two-sheet export", async ({ page }) => {
  await loginAsOperator(page);
  await openImportForPreRegistrationEvent(page);
  await chooseFixtureWorkbook(page, "130-participants.xlsx");
  await resolveAllRows(page);
  await expect(page.getByText("130개 행을 확정했습니다.")).toBeVisible();
  const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "엑셀 내보내기" }).click()]);
  expect(download[0].suggestedFilename()).toContain("명단");
});
```

- [ ] **Step 2: Run E2E tests and confirm they fail until fixtures and flows exist**

Run: `pnpm --filter @event-roster/web exec playwright test`

Expected: FAIL because the fixture, bootstrap setup, or user flows are not yet configured.

- [ ] **Step 3: Add fixture setup, CI, remote smoke, and operations docs**

The Playwright global setup must call the secret-protected bootstrap route only in a local Miniflare/dev environment, then create fixtures through authenticated API calls. It must never put production bootstrap tokens in source control. `prepare-e2e-env.mts` must validate that its only persistence target is `apps/worker/.wrangler/e2e-state`, clear that exact ignored directory before each run, generate CSPRNG non-production values for `BOOTSTRAP_TOKEN`, `PASSWORD_PEPPER`, `JWT_SIGNING_KEY`, `IP_HASH_KEY`, and `APP_ORIGIN=http://127.0.0.1:8787`; it writes the Worker values to ignored `apps/worker/.dev.vars` and writes only the local bootstrap token to ignored `apps/web/e2e/.local-e2e-env.json`. Apply migrations to the same persistence directory before starting the server. `global-setup.ts` generates the 130-row workbook, reads that local file, sends an `Origin: http://127.0.0.1:8787` header, and creates fixtures. `global-teardown.ts` removes generated workbook/secrets only; the next run's prepare script is the authoritative D1-state cleanup.

`create-workbooks.mts` must generate `apps/web/e2e/fixtures/130-participants.xlsx` from 130 `{ name, organization }` rows at test time; do not commit a binary workbook. `playwright.config.ts` must use this local server command and health URL:

```ts
webServer: {
  command: "pnpm --filter @event-roster/worker run prepare:e2e-env && pnpm --filter @event-roster/worker exec wrangler d1 migrations apply event-roster --local --persist-to .wrangler/e2e-state && pnpm --filter @event-roster/web build && pnpm --filter @event-roster/worker exec wrangler dev --local --persist-to .wrangler/e2e-state --port 8787",
  url: "http://127.0.0.1:8787/api/v1/health",
  reuseExistingServer: !process.env.CI,
}
```

Set `workers: 1` and `fullyParallel: false` in Playwright because every E2E spec deliberately shares this one local D1 database.

Add `@playwright/test` and `@types/node` to the web dev dependencies, add `tsx` to the Worker dev dependencies for its local/remote scripts, add the `prepare:e2e-env` script, then run `pnpm install`. Keep generated `.dev.vars`, `.local-e2e-env.json`, `.wrangler/e2e-state`, and `apps/web/e2e/fixtures/*.xlsx` ignored while allowing only an explicitly non-secret `.dev.vars.example` template if useful.

`smoke-remote.mts` accepts `APP_URL`, `SMOKE_BOOTSTRAP_TOKEN`, and a one-time test email. It sends `Origin: APP_URL` for bootstrap and login, verifies `/api/v1/health` JSON, SPA deep-link HTML, bootstrap availability only on an empty target, login response cookie flags, and `/auth/me`. It must print request IDs and status codes but never passwords, tokens, or secrets.

CI must run this exact sequence on pull requests:

The workflow first uses `actions/checkout`, `actions/setup-node` with `node-version-file: .nvmrc`, enables Corepack, and configures pnpm cache. It uses only generated local E2E secrets and never defines Cloudflare production credentials.

```bash
pnpm install --frozen-lockfile
pnpm --filter @event-roster/worker exec wrangler types --check
pnpm format:check
pnpm --filter @event-roster/contracts test
pnpm --filter @event-roster/domain test
pnpm --filter @event-roster/worker test
pnpm --filter @event-roster/web test
pnpm --filter @event-roster/web build
pnpm --filter @event-roster/worker exec wrangler deploy --dry-run --outdir .wrangler/bundle
pnpm --filter @event-roster/web exec playwright install --with-deps chromium
pnpm --filter @event-roster/web exec playwright test
```

`docs/operations/deployment.md` must document this exact safe order: set the known `workers.dev` URL as the committed non-secret `APP_ORIGIN` binding; deploy once to auto-provision and link D1; verify that `database_id` was written back (or run `wrangler d1 create event-roster --binding DB --update-config`); apply remote migrations; set random `PASSWORD_PEPPER`, `JWT_SIGNING_KEY`, `IP_HASH_KEY`, and `BOOTSTRAP_TOKEN` as Worker Secrets; run the first-user smoke; delete `BOOTSTRAP_TOKEN`; then commit the generated non-secret D1 ID. It must never call bootstrap before the migration and secrets are ready. `docs/operations/recovery.md` must require an export before a bulk import and immediately after event close. An export-based re-import is supported only by creating a new `PRE_REGISTRATION` event; reopening a `CLOSED` event returns it to `DAY_OF` and permits only audited manual roster changes, never an import. Never edit D1 by hand.

- [ ] **Step 4: Run full local verification and a real deployment smoke test**

Run: `pnpm test && pnpm check && pnpm format:check`

Expected: PASS.

Run: `pnpm --filter @event-roster/worker run types && pnpm --filter @event-roster/worker exec wrangler types --check`

Expected: PASS; the generated Worker binding declaration is current before deployment.

Run: `pnpm --filter @event-roster/web build && pnpm --filter @event-roster/worker exec wrangler deploy --dry-run --outdir .wrangler/bundle`

Expected: gzip Worker bundle below 3MiB and static asset count below 20,000.

After the initial deploy has provisioned D1, its migration is applied, and the real secrets are set, run:

```bash
export APP_URL=https://event-roster.<account>.workers.dev
read -rs SMOKE_BOOTSTRAP_TOKEN
export SMOKE_BOOTSTRAP_TOKEN
pnpm --filter @event-roster/worker run smoke:remote
unset SMOKE_BOOTSTRAP_TOKEN
```

Expected: health API, SPA deep link, initial operator bootstrap, login, and authenticated `/auth/me` all succeed. Delete `BOOTSTRAP_TOKEN` only after this smoke test has produced evidence.

- [ ] **Step 5: Commit delivery tooling and documentation**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/worker/scripts apps/worker/package.json apps/web/package.json pnpm-lock.yaml .github/workflows/ci.yml docs/operations README.md apps/worker/wrangler.jsonc apps/worker/worker-configuration.d.ts .gitignore
git commit -m "chore: add event roster delivery verification"
```

## Plan self-review checklist

- [x] FastAPI/Python Worker, Pages/Workers cross-origin cookies, VM, Cloudflare Access, email OTP, and raw Excel retention are not included.
- [x] Task 1 blocks every MVP task on actual gzip, D1, JWT/session, KDF, concurrency, and Observability CPU evidence.
- [x] Roles, event lifecycle, roster snapshots, cancellation preservation, revision conflicts, append-only audit logs, browser Excel, and recovery export each map to at least one task.
- [x] Every API operation has a contract owner in `packages/contracts`, a Worker implementation task, and a UI or operational consumer task.
- [x] Session creation, password change, CSRF, logout, user deactivation, role/organization changes, and initial bootstrap all have explicit invalidation behavior.
- [x] Import policy, day-of aggregate formula, organization moves, metadata edit states, organization deactivation, participant-number generation, and initial operator creation are explicit rather than implicit.
- [x] Bootstrap is disabled when its secret is absent, has a database singleton lock, and has deleted-secret/concurrent-request tests.
- [x] Event transition, roster, and import writes carry a database state/revision guard and each has a race regression test.
- [x] Package bootstrap, generated Worker types, local D1 migration state, browser test runtime, E2E test secrets, and lockfile updates are planned before their tests execute.

## Execution handoff

Start with Task 1 only. If its ADR result is `FAIL`, stop and return to the user; do not begin Task 2.

If the ADR result is `PASS`, execute Tasks 2–15 in order. Use a fresh worktree created through `superpowers:using-git-worktrees` before implementation.
