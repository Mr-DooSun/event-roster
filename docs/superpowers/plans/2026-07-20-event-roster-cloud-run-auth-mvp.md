# Event Roster Cloud Run Auth MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status:** Superseded by 2026-07-21 Workers bcrypt design; no remote Cloud Run gate was run.

**Goal:** D1이 소유한 영문 로그인 ID·권한·JWT 세션과 Cloud Run Argon2id 비밀번호 KDF를 바탕으로, 행사별 사전 명단·당일 변동·집계·감사 이력·엑셀 이관/내보내기를 제공하는 내부 운영 도구를 만든다.

**Architecture:** React/Vite SPA의 빌드 결과를 단일 Hono TypeScript Worker의 Static Assets로 제공하고, 같은 `workers.dev` origin의 `/api/v1/*`만 Worker가 처리한다. Cloud Run FastAPI `password-service`는 서명된 내부 요청의 Argon2id hash/verify만 수행하며, Worker는 D1에 자격 증명 PHC·권한·세션·감사를 저장하고 JWT와 CSRF를 직접 관리한다.

**Tech Stack:** Node 22, pnpm 10.28.1, TypeScript strict, React 19, Vite, Hono, Zod, Cloudflare Workers Static Assets, D1, `jose`, Vitest with `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright, SheetJS `xlsx`, Python 3.13, uv, FastAPI, argon2-cffi, Google Cloud Run, Secret Manager.

## Global Constraints

- 승인 기준은 [Cloud Run 인증 설계](../specs/2026-07-20-event-roster-cloud-run-auth-design.md)와 기존 행사 도메인 설계다. 역사적 Workers PBKDF2 spike·ADR·evidence는 보존하고 재사용하지 않는다.
- 배포 URL은 하나의 `https://event-roster.event-roster.workers.dev` Worker를 사용한다. 브라우저는 Cloud Run URL을 직접 호출하지 않으며, Pages·별도 API origin·CORS·VM·커스텀 도메인을 만들지 않는다.
- Cloud Run은 password-service 한 개만 두며, D1·JWT·사용자 역할·원본 엑셀을 보관하지 않는다. `min-instances=0`, `max-instances=1`, `concurrency=1`, `1 vCPU`, `512 MiB`, request-based billing으로 배포한다.
- `packageManager`는 정확한 `pnpm@10.28.1`, Worker 테스트 풀은 `@cloudflare/vitest-pool-workers@^0.18.6`, Vitest는 `^4.1.0`, Wrangler는 `^4.45.0` 이상을 사용한다.
- `apps/web`은 React/Vite, `apps/worker`는 Hono·D1·Worker, `apps/password-service`는 FastAPI KDF만 가진다. `packages/contracts`는 Zod 런타임 계약, `packages/domain`은 순수 도메인 규칙만 가진다.
- Worker 설정은 `wrangler.jsonc`, `compatibility_date: "2026-07-20"`, `assets.run_worker_first: ["/api/*"]`를 사용한다. SPA deep link는 `index.html` fallback으로 제공한다.
- 모든 계정은 운영자가 만든다. 로그인 ID는 소문자화한 뒤 `^[a-z][a-z0-9._-]{2,31}$`만 허용하며, 이메일을 로그인 ID로 쓰지 않고 발급 뒤 변경하지 않는다.
- Cloud Run은 NFC 정규화 → `PASSWORD_PEPPER` HMAC-SHA-256 → Argon2id(`memory_cost=19456`, `time_cost=2`, `parallelism=1`, `hash_len=32`, `salt_len=16`)를 수행한다. 빠른 해시, PBKDF2 비용 하향, 브라우저 KDF 대체는 금지한다.
- 일반 세션은 8시간 절대 만료 JWT를 `__Host-er_session; HttpOnly; Secure; SameSite=Lax; Path=/` 쿠키에만 둔다. refresh token, `Domain`, `localStorage`, `sessionStorage`에 인증 정보를 두지 않는다.
- 최초 공용 운영자는 첫 개별 `OPERATOR`가 임시 비밀번호를 바꾼 **성공 트랜잭션 안에서만** 비활성화한다. 계정 생성 직후에는 비활성화하지 않는다.
- 32 random bytes 기반 긴급 복구 코드는 화면에 한 번만 보이고 D1에는 HMAC 값만 저장한다. 복구 성공은 기존 코드를 소비하고 새 개별 운영자와 교체 코드를 한 트랜잭션으로 만든다.
- 원문 비밀번호·pepper·JWT 원문·CSRF 원문·복구 코드·원본 엑셀 파일/셀 행렬은 D1, 로그, 감사 로그, 응답 DTO의 비밀 외 필드, 브라우저 영구 저장소에 남기지 않는다. Argon2 PHC는 D1의 `password_credentials.phc`에만 저장하며, 로그·감사 로그·API DTO·브라우저 저장소에는 절대 넣지 않는다.
- 로그인 실패는 ID 존재·계정 비활성·비밀번호 오류를 구별하지 않으며, 존재하지 않는 ID도 Cloud Run에서 dummy Argon2id verify를 한 번 수행한다.
- 로그인과 복구는 HMAC 처리 IP와 action별 키로 15분 동안 5회 실패하면 잠긴다. IP 원문을 저장하지 않는다.
- 모든 D1 시각은 UTC ISO-8601 문자열, 식별자는 UUID 문자열이다. 참가자 번호는 `P-` + 대문자 UUID이며 고유 충돌 시 한 번만 재시도한다.
- `DRAFT → PRE_REGISTRATION → DAY_OF → CLOSED`, `CLOSED → DAY_OF`만 허용한다. `DAY_OF`에서 조직별 예상 인원 snapshot을 고정하고, `CLOSED`는 읽기 전용이다.
- 명단 변경·행사 상태 전환·가져오기는 SQL의 상태와 revision guard를 함께 사용한다. 상태/revision precondition은 `operation_guards`의 `CHECK`를 발생시키는 첫 D1 batch statement로 강제하고, 영향 행 수 0을 성공으로 취급하지 않는다. guard·write·감사·snapshot·import 기록은 하나의 D1 batch로 함께 rollback된다.
- 가져오기는 `PRE_REGISTRATION` 행사에서만 운영자가 실행한다. 원본 workbook은 브라우저 메모리에만 두고, 130행 import 실패 시 참가자·명단·감사·import 기록 모두 남기지 않는다.
- UI는 `coursemos-supporter/docs/design-system.md`의 토큰/프리미티브 원칙만 참조해 `--er-*` 토큰을 새로 만든다. 목록은 최대 130행을 한 번에 내려받아 클라이언트에서 필터한다.
- 각 Task는 실패 테스트 → 실패 확인 → 최소 구현 → 통과 테스트 → 타입/포맷 검사 → 커밋 순서를 지킨다.

---

## Scope and stop rule

Task 1은 실제 Cloud Run에서 보안 KDF가 가능한지 확인하는 독립 capability gate다. 정상 비밀번호·틀린 비밀번호·존재하지 않는 ID가 각각 50회 의미상 맞게 완료되고 warm P95가 1.5초 이하이며, 13개 동시 verify가 모두 8초 안에 성공하고, 잘못된 내부 서명은 Argon2 실행 전에 `401`이어야 PASS다. Task 1이 FAIL이면 evidence와 ADR만 기록하고 Task 2 이후를 시작하지 않는다. Argon2id 파라미터를 OWASP 최소보다 낮춰 통과시키는 것은 실패 해결책이 아니다.

## Canonical contracts

모든 Task는 아래 이름을 그대로 사용한다. 비밀번호, PHC, JWT 원문, pepper, CSRF hash와 recovery code hash는 어떤 API DTO에도 넣지 않는다.

```ts
export type Role = "OPERATOR" | "ORGANIZATION_MANAGER";
export type SessionKind = "FULL" | "MUST_CHANGE_PASSWORD";
export type EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED";
export type Half = "H1" | "H2";
export type RosterSource = "PRE_EVENT" | "DAY_OF";
export type RosterStatus = "ACTIVE" | "CANCELLED";

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

export interface ApiProblem {
  code:
    | "AUTHENTICATION_REQUIRED"
    | "AUTH_SERVICE_UNAVAILABLE"
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
| `POST /api/v1/bootstrap/first-operator` | 로그인한 bootstrap 운영자의 CSRF, 첫 개별 운영자 DTO | 첫 개별 운영자, 단회 임시 비밀번호 |
| `POST /api/v1/auth/login` | `{ loginId, password }` | `CurrentSession`, 세션 쿠키 |
| `GET /api/v1/auth/me`, `GET /api/v1/auth/csrf` | 없음 | `CurrentSession`, `{ csrfToken }` |
| `POST /api/v1/auth/change-password`, `POST /api/v1/auth/logout` | `{ password }`, 없음 | `204`, 세션 폐기 |
| `POST /api/v1/auth/recover` | `{ recoveryCode, loginId, displayName, password }` | 새 운영자, 단회 교체 복구 코드 |
| `GET/POST/PATCH /api/v1/organizations` | 조직 DTO | 조직 또는 목록 |
| `GET/POST/PATCH /api/v1/users` | 사용자 DTO | 사용자 또는 목록, 생성/재설정 시 단회 임시 비밀번호 |
| `POST /api/v1/users/:id/password-reset` | 없음 | 단회 임시 비밀번호 |
| `GET/POST/PATCH /api/v1/participants` | 검색/참가자 DTO | 참가자 또는 목록 |
| `GET/POST/PATCH /api/v1/events`, `POST /api/v1/events/:id/transition` | 행사 DTO, revision | 행사 또는 목록 |
| `GET/POST/PATCH /api/v1/events/:id/roster` | 참가자 ID와 revision 포함 명령 | 명단 또는 목록 |
| `GET /api/v1/events/:id/summary`, `GET /api/v1/events/:id/audit-logs` | 없음, cursor | 집계, 감사 페이지 |
| `POST /api/v1/events/:id/imports/validate` | 정규화된 rows | `eventRevision`을 포함한 검증 결과 |
| `POST /api/v1/events/:id/imports/commit` | `{ expectedEventRevision, rows }` | 확정 결과 |
| `GET /api/v1/events/:id/export-data` | 없음 | 브라우저 xlsx 생성용 JSON |

## File structure

```text
event-roster/
├── apps/
│   ├── password-service/
│   │   ├── src/password_service/{config,signature,kdf,api,main,make_dummy}.py
│   │   ├── tests/{test_signature,test_kdf,test_api}.py
│   │   ├── scripts/{run_remote_probe,assert_evidence}.py
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── worker/
│   │   ├── migrations/0001_initial.sql
│   │   ├── src/{app,index,env}/
│   │   ├── src/{db,services,routes,middleware,security,http}/
│   │   ├── scripts/{prepare-e2e-env,smoke-remote}.mts
│   │   └── test/
│   └── web/
│       ├── src/{app,components/ui,features,lib,styles}/
│       └── e2e/
├── packages/
│   ├── contracts/src/{common,auth,organizations,participants,events,roster,imports,exports,api,index}.ts
│   └── domain/src/{errors,authorization,event-lifecycle,roster,summary,import-validation,index}.ts
├── spikes/
│   └── cloud-run-auth-capability/src/{env,index,kdf-client}.ts
├── docs/{adr,operations,superpowers/evidence}/
└── .github/workflows/ci.yml
```

### Task 1: Build and prove the Cloud Run password-service capability gate

**Files:**
- Create: `apps/password-service/pyproject.toml`
- Create: `apps/password-service/uv.lock`
- Create: `apps/password-service/Dockerfile`
- Create: `apps/password-service/.gcloudignore`
- Create: `apps/password-service/src/password_service/__init__.py`
- Create: `apps/password-service/src/password_service/config.py`
- Create: `apps/password-service/src/password_service/signature.py`
- Create: `apps/password-service/src/password_service/kdf.py`
- Create: `apps/password-service/src/password_service/api.py`
- Create: `apps/password-service/src/password_service/main.py`
- Create: `apps/password-service/src/password_service/make_dummy.py`
- Create: `apps/password-service/tests/conftest.py`
- Create: `apps/password-service/tests/test_signature.py`
- Create: `apps/password-service/tests/test_kdf.py`
- Create: `apps/password-service/tests/test_api.py`
- Create: `apps/password-service/scripts/run_remote_probe.py`
- Create: `apps/password-service/scripts/assert_evidence.py`
- Create: `spikes/cloud-run-auth-capability/{package.json,tsconfig.json,wrangler.jsonc}`
- Create: `spikes/cloud-run-auth-capability/src/{index,kdf-client,env}.ts`
- Create: `spikes/cloud-run-auth-capability/test/kdf-client.test.ts`
- Create: `docs/adr/0002-cloud-run-password-service-capability.md`
- Create: a generated `docs/superpowers/evidence/cloud-run-kdf-${runId}.json` file (only a factual remote run is committed)

**Interfaces:**
- Consumes: `PASSWORD_PEPPER`, `AUTH_KDF_SHARED_SECRET`, `DUMMY_ARGON2_PHC` from Google Secret Manager.
- Produces: `POST /internal/v1/password/hash`, `POST /internal/v1/password/verify`, `GET /healthz`, a temporary token-protected Worker probe, and factual remote capability evidence for the real Worker-to-Cloud-Run path.

- [ ] **Step 1: Write failing KDF, signature, and no-leak tests**

```python
# apps/password-service/tests/test_signature.py
from fastapi.testclient import TestClient

def test_rejects_bad_signature_before_running_argon2(client: TestClient, kdf_spy) -> None:
    response = client.post(
        "/internal/v1/password/hash",
        content=b'{"password":"temporary-password-123"}',
        headers={"content-type": "application/json", "x-er-kdf-timestamp": "0"},
    )
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0

def test_rejects_missing_or_unknown_key_id_before_running_argon2(client: TestClient, kdf_spy, signed_headers) -> None:
    body = b'{"password":"temporary-password-123"}'
    headers = signed_headers("POST", "/internal/v1/password/hash", body)
    headers["x-er-kdf-key-id"] = "v2"
    response = client.post("/internal/v1/password/hash", content=body, headers=headers)
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0

# apps/password-service/tests/test_kdf.py
def test_argon2id_uses_nfc_and_only_verifies_the_original_password(kdf) -> None:
    phc = kdf.hash("cafe\u0301-password-123")
    assert phc.startswith("$argon2id$")  # standard Argon2 PHC prefix
    assert kdf.verify("café-password-123", phc) is True
    assert kdf.verify("different-password-123", phc) is False

# apps/password-service/tests/test_api.py
def test_validation_error_never_echoes_password(client: TestClient, signed_headers) -> None:
    body = b'{"password":"short"}'
    response = client.post("/internal/v1/password/hash", content=body, headers=signed_headers("POST", "/internal/v1/password/hash", body))
    assert response.status_code == 422
    assert "short" not in response.text
```

- [ ] **Step 2: Create the Python package shell and confirm the tests fail for missing modules**

```toml
# apps/password-service/pyproject.toml
[project]
name = "event-roster-password-service"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
  "argon2-cffi>=23.1,<26",
  "fastapi>=0.115,<1",
  "uvicorn[standard]>=0.30,<1",
]

[dependency-groups]
dev = ["httpx>=0.28,<1", "pytest>=8,<9", "ruff>=0.8,<1"]

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/password_service"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py313"
```

Before dependency sync, create the empty package marker `apps/password-service/src/password_service/__init__.py`; this lets hatchling install the `src/` project while the deliberately missing KDF/signature/API modules still make tests fail. Create the probe package with name `@event-roster/cloud-run-auth-capability`, scripts `test`, `check`, and `deploy`, and only `hono`, `zod`, `wrangler`, `vitest`, and TypeScript dependencies. Its `wrangler.jsonc` uses Worker name `event-roster-cloud-run-auth-capability`, `workers_dev: true`, the current compatibility date, and no D1/assets binding.

Run: `uv --directory apps/password-service sync --all-groups && pnpm install && uv --directory apps/password-service run pytest && pnpm --filter @event-roster/cloud-run-auth-capability test`

Expected: FAIL because the Python modules and Worker probe entrypoint do not exist.

```gitignore
# apps/password-service/.gcloudignore
.gcloudignore
.git
.gitignore
.env
.env.*
.venv/
__pycache__/
*.py[cod]
tests/
```

- [ ] **Step 3: Implement the signed Argon2id service without request-body logging**

```python
# apps/password-service/src/password_service/kdf.py
from __future__ import annotations

import base64
import hashlib
import hmac
import unicodedata
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError


class PasswordKdf:
    def __init__(self, pepper: str) -> None:
        self._pepper = pepper.encode("utf-8")
        self._hasher = PasswordHasher(
            time_cost=2,
            memory_cost=19_456,
            parallelism=1,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )

    def _prepared(self, password: str) -> str:
        normalized = unicodedata.normalize("NFC", password).encode("utf-8")
        digest = hmac.new(self._pepper, normalized, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode("ascii")

    def hash(self, password: str) -> str:
        return self._hasher.hash(self._prepared(password))

    def verify(self, password: str, phc: str) -> bool:
        try:
            return self._hasher.verify(phc, self._prepared(password))
        except (InvalidHashError, VerificationError):
            return False
```

```python
# apps/password-service/src/password_service/signature.py
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from fastapi import HTTPException, Request


def _message(method: str, path: str, timestamp: str, body_digest: str) -> bytes:
    return f"v1\\n{timestamp}\\n{method}\\n{path}\\n{body_digest}".encode("utf-8")


async def require_worker_signature(request: Request, secret: str) -> bytes:
    if request.headers.get("x-er-kdf-key-id") != "v1":
        raise HTTPException(status_code=401, detail="unauthorized")
    claimed_length = request.headers.get("content-length")
    if claimed_length is not None:
        try:
            if int(claimed_length) > 4_096:
                raise HTTPException(status_code=413, detail="payload_too_large")
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid_request") from error
    body = await request.body()
    if len(body) > 4_096:
        raise HTTPException(status_code=413, detail="payload_too_large")
    timestamp = request.headers.get("x-er-kdf-timestamp", "")
    claimed_digest = request.headers.get("x-er-kdf-body-sha256", "")
    supplied = request.headers.get("x-er-kdf-signature", "")
    try:
        current = int(time.time())
        supplied_time = int(timestamp)
    except ValueError as error:
        raise HTTPException(status_code=401, detail="unauthorized") from error
    actual_digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode("ascii")
    expected = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), _message(request.method, request.url.path, timestamp, actual_digest), hashlib.sha256).digest(),
    ).rstrip(b"=").decode("ascii")
    if abs(current - supplied_time) > 60 or not hmac.compare_digest(claimed_digest, actual_digest) or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    return body
```

Implement `Settings.from_environment()` to fail at startup when any of the three secrets is absent or empty. Route handlers must accept `request: Request`, reject bodies above 4 KiB, call `require_worker_signature()` over the raw bytes before `json.loads()`, then validate the decoded mapping explicitly. Do not declare a typed FastAPI `Body` parameter on these routes: that would parse JSON before the signature check. Replace FastAPI's request-validation handler with `{ "code": "VALIDATION_FAILED" }`, and choose the configured dummy PHC whenever `phc` is absent or invalid. `main.py` exposes `/healthz` without KDF and the two signed routes. `make_dummy.py` reads `PASSWORD_PEPPER`, hashes the fixed input `event-roster-dummy-account-v1`, and writes only the PHC to stdout for Secret Manager provisioning.

```python
# apps/password-service/src/password_service/api.py (route shape)
@router.post("/internal/v1/password/hash")
async def hash_password(request: Request, settings: Settings = Depends(get_settings)) -> HashResponse:
    raw = await require_worker_signature(request, settings.auth_kdf_shared_secret)
    payload = decode_password_payload(raw)  # json.loads after signature; raises generic 422 only
    return HashResponse(kdfVersion=1, phc=PasswordKdf(settings.password_pepper).hash(payload.password))
```

```dockerfile
# apps/password-service/Dockerfile
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY src /app/src
RUN pip install --no-cache-dir "uv>=0.6,<1" && uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8080
CMD ["sh", "-c", "uvicorn password_service.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
```

- [ ] **Step 4: Run local tests, lint, and create the temporary Worker-mediated probe**

Create `spikes/cloud-run-auth-capability` as a short-lived Cloudflare Worker. It has only three secrets: `PASSWORD_SERVICE_URL`, `AUTH_KDF_SHARED_SECRET`, and `CAPABILITY_PROBE_TOKEN`; no D1 binding and no static assets. It accepts `POST /probe` only when `X-ER-Probe-Token` equals the secret in a constant-time comparison, forwards `hash`, `verify`, `verifyDummy`, and intentionally corrupted-signature operations through its Web-Crypto KDF client, and returns a generic 404 for any other request. It must never log a request body, PHC, password, or either secret.

```ts
// spikes/cloud-run-auth-capability/src/index.ts (essential route shape)
import { z } from "zod";

const ProbeRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("hash"), password: z.string().min(12).max(128) }),
  z.object({ operation: z.literal("verify"), password: z.string().min(12).max(128), phc: z.string().min(1) }),
  z.object({ operation: z.literal("verifyDummy"), password: z.string().min(12).max(128) }),
  z.object({ operation: z.literal("corruptSignature"), password: z.string().min(12).max(128) }),
]);

app.post("/probe", async (c) => {
  if (!await constantTimeEqualUtf8(c.req.header("X-ER-Probe-Token") ?? "", c.env.CAPABILITY_PROBE_TOKEN)) {
    return c.notFound();
  }
  const input = ProbeRequestSchema.parse(await c.req.json());
  const result = await createPasswordServiceClient(c.env).execute(input);
  return c.json(result);
});
```

The spike client builds the exact `v1` HMAC message from raw UTF-8 JSON bytes, uses `redirect: "error"`, and aborts after 8 seconds, matching the production Task 5 contract. Its unit tests verify a correct base64url digest/signature, a corrupt-signature path, timeout handling, and that the request token is never forwarded to Cloud Run. `run_remote_probe.py` fails closed unless `CAPABILITY_PROBE_URL` and `CAPABILITY_PROBE_TOKEN` are present in its process environment, then calls this Worker probe rather than Cloud Run directly: it generates one correct PHC through `hash`, issues 50 sequential correct `verify` calls, 50 wrong-password calls, 50 missing-PHC dummy calls, one corrupt-signature call, and 13 concurrent correct verifies. It writes only `runId`, timestamp, status lists, boolean semantics, milliseconds, P95, and the probe URL to a generated `docs/superpowers/evidence/cloud-run-kdf-${runId}.json` path; it must never write password, PHC, headers, or secrets. It prints that exact evidence path on completion.

Run: `uv --directory apps/password-service run pytest && uv --directory apps/password-service run ruff check src tests scripts && pnpm --dir spikes/cloud-run-auth-capability test`

Expected: PASS.

Run: `uv --directory apps/password-service run python -m password_service.make_dummy` with a non-production `PASSWORD_PEPPER`.

Expected: one PHC string with the `$argon2id$` prefix and no plaintext password.

- [ ] **Step 5: Deploy the capability service, run the factual gate, and stop on failure**

Create a dedicated Cloud Run service account, give it only Secret Accessor on the three password-service secrets, and deploy source with the approved limits. Do not place secret values in shell history, source, or evidence. Set `GCP_PROJECT` once from the active gcloud configuration and use only the three literal secret names below; secret values are entered through a no-echo prompt and immediately unset.

```bash
export GCP_PROJECT="$(gcloud config get-value project)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
gcloud iam service-accounts create event-roster-password-service
gcloud secrets create PASSWORD_PEPPER --replication-policy=automatic
gcloud secrets create AUTH_KDF_SHARED_SECRET --replication-policy=automatic
gcloud secrets create DUMMY_ARGON2_PHC --replication-policy=automatic
gcloud secrets add-iam-policy-binding PASSWORD_PEPPER --member="serviceAccount:event-roster-password-service@${GCP_PROJECT}.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding AUTH_KDF_SHARED_SECRET --member="serviceAccount:event-roster-password-service@${GCP_PROJECT}.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding DUMMY_ARGON2_PHC --member="serviceAccount:event-roster-password-service@${GCP_PROJECT}.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

Before deployment, add version 1 for the three secrets. Use `read -rs`, pipe each value to `gcloud secrets versions add … --data-file=-`, and generate the dummy PHC with `python -m password_service.make_dummy` rather than inventing a value. Keep `AUTH_KDF_SHARED_SECRET` only in this current shell until the temporary probe Worker receives the same value; all other secret variables are immediately unset. This is an operator-run, no-echo action and its output must not be captured in the terminal transcript or docs.

```bash
read -rs PASSWORD_PEPPER; printf '\n'
export PASSWORD_PEPPER
printf %s "$PASSWORD_PEPPER" | gcloud secrets versions add PASSWORD_PEPPER --data-file=-
uv --directory apps/password-service run python -m password_service.make_dummy | gcloud secrets versions add DUMMY_ARGON2_PHC --data-file=-
unset PASSWORD_PEPPER
read -rs AUTH_KDF_SHARED_SECRET; printf '\n'
printf %s "$AUTH_KDF_SHARED_SECRET" | gcloud secrets versions add AUTH_KDF_SHARED_SECRET --data-file=-
```

Deploy only after all three version-1 secrets exist. From `apps/password-service/`, run `gcloud meta list-files-for-upload | rg '\.env'`; it must produce no output, proving `.env.e2e` and every `.env.*` file are absent before the source deployment. Run the following deployment command from that same `apps/password-service/` directory, then return to the repository root before deploying the temporary Worker:

```bash
gcloud run deploy event-roster-password-service \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --service-account event-roster-password-service@${GCP_PROJECT}.iam.gserviceaccount.com \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 10s \
  --set-secrets PASSWORD_PEPPER=PASSWORD_PEPPER:1,AUTH_KDF_SHARED_SECRET=AUTH_KDF_SHARED_SECRET:1,DUMMY_ARGON2_PHC=DUMMY_ARGON2_PHC:1
```

Deploy the temporary probe Worker after the Cloud Run service. Set its Cloud Run URL, KDF shared secret, and a fresh probe-only random token as Worker secrets without putting values in command arguments or history, then deploy it. Keep the probe token only in the current shell long enough to run the probe. Do not reuse `CAPABILITY_PROBE_TOKEN` in the application Worker; delete the probe Worker after the gate result has been committed.

```bash
export PASSWORD_SERVICE_URL="$(gcloud run services describe event-roster-password-service --region asia-northeast3 --format='value(status.url)')"
printf %s "$PASSWORD_SERVICE_URL" | pnpm --dir spikes/cloud-run-auth-capability exec wrangler secret put PASSWORD_SERVICE_URL
unset PASSWORD_SERVICE_URL
printf %s "$AUTH_KDF_SHARED_SECRET" | pnpm --dir spikes/cloud-run-auth-capability exec wrangler secret put AUTH_KDF_SHARED_SECRET
unset AUTH_KDF_SHARED_SECRET
read -rs CAPABILITY_PROBE_TOKEN; printf '\n'
export CAPABILITY_PROBE_TOKEN
printf %s "$CAPABILITY_PROBE_TOKEN" | pnpm --dir spikes/cloud-run-auth-capability exec wrangler secret put CAPABILITY_PROBE_TOKEN
pnpm --dir spikes/cloud-run-auth-capability exec wrangler deploy
export CAPABILITY_PROBE_URL=https://event-roster-cloud-run-auth-capability.event-roster.workers.dev
```

Run the factual probe with the deployed Worker URL obtained from Wrangler, then remove the probe token from the shell:

```bash
uv --directory apps/password-service run python scripts/run_remote_probe.py
unset CAPABILITY_PROBE_TOKEN
unset CAPABILITY_PROBE_URL
```

Run: `uv --directory apps/password-service run python scripts/assert_evidence.py --latest`

Expected: 50/50/50 semantic responses, all 13 concurrent responses successful within 8 seconds, unsigned request `401`, and each warm scenario P95 `<= 1500` milliseconds. Record the exact service revision, settings, client P95, and result in `docs/adr/0002-cloud-run-password-service-capability.md`. If any assertion fails, commit only Task 1 files/evidence/ADR with `docs: record Cloud Run password capability failure`, delete the temporary probe Worker with the command below, and stop. If all assertions pass, stage the exact evidence file path printed by the probe and commit:

```bash
git add apps/password-service spikes/cloud-run-auth-capability docs/adr/0002-cloud-run-password-service-capability.md docs/superpowers/evidence package.json pnpm-lock.yaml
git commit -m "feat: prove Cloud Run password capability"
pnpm --dir spikes/cloud-run-auth-capability exec wrangler delete --force
```

Expected after deletion: the probe URL no longer serves a successful `/probe` response; preserve the committed evidence/ADR, not the temporary Worker.

### Task 2: Build the monorepo shell and same-origin Worker delivery

**Files:**
- Create: `.nvmrc`
- Modify: `.gitignore`
- Create: `apps/worker/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.ts,worker-configuration.d.ts}`
- Create: `apps/worker/{migrations/.gitkeep,src/env.ts,src/index.ts,src/app.ts,src/routes/health.ts}`
- Create: `apps/worker/test/{setup-d1.ts,env.d.ts,health.integration.test.ts}`
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`
- Create: `apps/web/{src/main.tsx,src/app/App.tsx,src/app/App.test.tsx,test/setup.ts}`

**Interfaces:**
- Consumes: PASS ADR from Task 1.
- Produces: `GET /api/v1/health -> { status: "ok" }`, Static Assets same-origin routing, and a React root.

- [ ] **Step 1: Write failing Worker and React smoke tests**

```ts
// apps/worker/test/health.integration.test.ts
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("returns JSON from the same-origin health endpoint", async () => {
  const response = await exports.default.fetch("https://example.test/api/v1/health");
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

- [ ] **Step 2: Bootstrap package configuration and prove the missing entrypoints fail**

Set `.nvmrc` to `22`. Create manifests with `hono`, `zod`, `jose`, Worker Vitest/Wrangler dependencies; React, React Router, TanStack Query, React Hook Form, Zod, Testing Library, Vite/Vitest dependencies; and the scripts `test`, `check`, `build`, `dev`, `types`, `deploy`. Add `node_modules`, `apps/worker/.wrangler`, `apps/worker/.dev.vars`, `apps/password-service/.env*`, and generated E2E state to `.gitignore`.

Run: `pnpm install && pnpm --filter @event-roster/worker test -- health.integration.test.ts`

Expected: FAIL because the Worker entrypoint is absent.

Run: `pnpm --filter @event-roster/web test -- App.test.tsx`

Expected: FAIL because `App` is absent.

- [ ] **Step 3: Implement the shell and Worker configuration**

```jsonc
// apps/worker/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "event-roster",
  "main": "./src/index.ts",
  "compatibility_date": "2026-07-20",
  "workers_dev": true,
  "vars": {
    "APP_ORIGIN": "https://event-roster.event-roster.workers.dev"
  },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
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

```tsx
// apps/web/src/app/App.tsx
export function App() {
  return <main><h1>행사 참가자 명단</h1></main>;
}
```

Use `cloudflareTest()` with `readD1Migrations()` in `apps/worker/vitest.config.ts`; `setup-d1.ts` calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. The all-zero D1 UUID is an explicit local/test placeholder only; Task 15's `wrangler d1 create event-roster --binding DB --update-config` must replace it before any remote migration/deploy. Keep `PASSWORD_SERVICE_URL` as a local test binding only until Task 5 adds the production binding.

- [ ] **Step 4: Verify delivery behavior and commit the shell**

Run: `pnpm --filter @event-roster/worker test && pnpm --filter @event-roster/web test && pnpm --filter @event-roster/web build && pnpm --filter @event-roster/worker run check && pnpm --filter @event-roster/web run check`

Expected: PASS.

Run: `pnpm --filter @event-roster/worker exec wrangler dev --local --port 8787`

Expected: `/api/v1/health` returns JSON and `/events/example` returns SPA HTML. Check both manually because Worker Vitest exports do not exercise Static Assets routing.

```bash
git add .nvmrc .gitignore apps/worker apps/web package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat: add Worker and web application shell"
```

### Task 3: Define shared contracts and pure domain rules

**Files:**
- Create: `packages/contracts/{package.json,tsconfig.json,src/{common,auth,organizations,participants,events,roster,imports,exports,api,index}.ts,test/contracts.test.ts}`
- Create: `packages/domain/{package.json,tsconfig.json,src/{errors,authorization,event-lifecycle,roster,summary,import-validation,index}.ts,test/{authorization,event-lifecycle,roster,summary,import-validation}.test.ts}`
- Modify: `apps/worker/package.json`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: canonical contracts above.
- Produces: Zod schemas and pure functions `assertOrganizationWriteAccess`, `assertEventTransition`, `assertRosterWritable`, `assertFreshRevision`, `buildEventSummary`, and `validateNormalizedImportRows`.

- [ ] **Step 1: Write failing contract and domain tests**

```ts
// packages/contracts/test/contracts.test.ts
import { expect, it } from "vitest";
import { LoginRequestSchema, LoginIdSchema } from "../src/auth";

it("canonicalizes only approved English login IDs", () => {
  expect(LoginIdSchema.parse("MinSu.Kim")).toBe("minsu.kim");
  expect(() => LoginRequestSchema.parse({ loginId: "한글", password: "temporary-password-123" })).toThrow();
});

// packages/domain/test/summary.test.ts
import { expect, it } from "vitest";
import { buildEventSummary } from "../src/summary";

it("uses active day-of rows and cancelled pre-event rows as net deltas", () => {
  expect(buildEventSummary("event-1", [{ organizationId: "org-1", organizationName: "개발팀", expected: 5, dayOfAdded: 2, dayOfCancelled: 1 }]))
    .toMatchObject({ expectedTotal: 5, finalTotal: 6, deltaTotal: 1 });
});
```

- [ ] **Step 2: Run the shared tests and confirm they fail before modules exist**

Run: `pnpm --filter @event-roster/contracts test && pnpm --filter @event-roster/domain test`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement all runtime schemas and DB-free rules**

```ts
// packages/contracts/src/auth.ts
import { z } from "zod";

export const LoginIdSchema = z.string().trim().transform((value) => value.toLowerCase()).pipe(
  z.string().regex(/^[a-z][a-z0-9._-]{2,31}$/),
);
export const PasswordSchema = z.string().min(12).max(128);
export const LoginRequestSchema = z.object({ loginId: LoginIdSchema, password: PasswordSchema });
export const RecoveryRequestSchema = z.object({
  recoveryCode: z.string().min(40).max(128),
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(80),
  password: PasswordSchema,
});

export const BootstrapRequestSchema = z.object({
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(80),
});
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;

export interface RequestMeta {
  ipHashInput: string;
  requestId: string;
  origin: string | null;
}

export const RosterCreateSchema = z.object({ participantId: z.string().uuid(), revision: z.number().int().positive() });
export const RosterUpdateSchema = z.object({ status: z.enum(["ACTIVE", "CANCELLED"]), revision: z.number().int().positive() });
export type RosterCreate = z.infer<typeof RosterCreateSchema>;
export type RosterUpdate = z.infer<typeof RosterUpdateSchema>;
export interface RosterEntry { id: string; eventId: string; participantId: string; source: RosterSource; status: RosterStatus; revision: number; }
export interface ImportRowInput { rowNumber: number; name: string; organizationName: string; participantNumber?: string; }
export interface ResolvedImportRow { rowNumber: number; name: string; organizationId: string; participantNumber?: string; participantId?: string; }
export interface ImportIssue { rowNumber: number; code: string; message: string; }
export const ImportRowInputSchema = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  organizationName: z.string().trim().min(1).max(80),
  participantNumber: z.string().trim().min(1).max(80).optional(),
});
export const ResolvedImportRowSchema = ImportRowInputSchema.extend({
  organizationId: z.string().uuid(),
  participantId: z.string().uuid().optional(),
});
export const ImportCommitRequestSchema = z.object({
  expectedEventRevision: z.number().int().positive(),
  rows: z.array(ResolvedImportRowSchema).min(1).max(130),
});
export interface ImportValidationResult { eventRevision: number; resolvedRows: ResolvedImportRow[]; issues: ImportIssue[]; }
export interface ImportCommitResult { receivedRows: number; createdRows: number; reactivatedRows: number; unchangedRows: number; }
```

```ts
// packages/domain/src/event-lifecycle.ts
const allowed = {
  DRAFT: ["PRE_REGISTRATION"],
  PRE_REGISTRATION: ["DAY_OF"],
  DAY_OF: ["CLOSED"],
  CLOSED: ["DAY_OF"],
} as const;

export function assertEventTransition(current: keyof typeof allowed, target: string): void {
  if (!allowed[current].includes(target as never)) throw new DomainError("INVALID_TRANSITION");
}
```

Define Zod request/response schemas for every API table above. `source`, audit actor, snapshot counts, and password PHC are never client writable. Event and roster write schemas require positive `revision`; import validation input is normalized `{ rowNumber, name, organizationName }`, `ImportValidationResult` returns a positive `eventRevision`, and `ImportCommitRequestSchema` requires `{ expectedEventRevision: positive int, rows }`; `UserCreateSchema` uses `loginId`, never email. `packages/contracts` owns `zod`; `packages/domain` depends only on `@event-roster/contracts: workspace:*` and imports no React, Hono, D1, Web Crypto, or Cloud Run code.

- [ ] **Step 4: Run focused contract/rule tests and commit**

Run: `pnpm --filter @event-roster/contracts test && pnpm --filter @event-roster/domain test && pnpm --filter @event-roster/contracts run check && pnpm --filter @event-roster/domain run check`

Expected: PASS.

```bash
git add packages/contracts packages/domain apps/worker/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add event roster contracts and domain rules"
```

### Task 4: Create the revised D1 schema and atomic integration-test foundation

**Files:**
- Create: `apps/worker/migrations/0001_initial.sql`
- Create: `apps/worker/src/db/atomic.ts`
- Create: `apps/worker/src/db/rows.ts`
- Create: `apps/worker/test/support/{ids,http}.ts`
- Create: `apps/worker/test/{schema,atomic}.integration.test.ts`
- Modify: `apps/worker/vitest.config.ts`

**Interfaces:**
- Consumes: shared enums/contracts from Task 3.
- Produces: the complete D1 schema, append-only security/audit tables, and `runGuardedAtomic()` for every state/revision-sensitive write.

- [ ] **Step 1: Write failing schema and rollback tests**

```ts
// apps/worker/test/support/ids.ts
export function testIds() {
  return {
    user1: crypto.randomUUID(),
    event1: crypto.randomUUID(),
    event2: crypto.randomUUID(),
  };
}

// apps/worker/test/schema.integration.test.ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { testIds } from "./support/ids";

it("rejects duplicate canonical login IDs and event year/half", async () => {
  const ids = testIds();
  await env.DB.prepare("INSERT INTO users (id,login_id,login_id_canonical,display_name,role,is_active,is_bootstrap,session_version,created_at,updated_at) VALUES (?1,?2,?3,?4,'OPERATOR',1,0,1,?5,?5)")
    .bind(ids.user1, "minsu", "minsu", "민수", "2026-07-20T00:00:00.000Z").run();
  await expect(env.DB.prepare("INSERT INTO users (id,login_id,login_id_canonical,display_name,role,is_active,is_bootstrap,session_version,created_at,updated_at) VALUES (?1,?2,?3,?4,'OPERATOR',1,0,1,?5,?5)")
    .bind("u-2", "MinSu", "minsu", "다른 민수", "2026-07-20T00:00:00.000Z").run()).rejects.toThrow();
  await env.DB.prepare("INSERT INTO events (id,title,year,half,status,revision,created_at,updated_at) VALUES (?1,?2,2026,'H1','DRAFT',1,?3,?3)")
    .bind(ids.event1, "상반기 행사", "2026-07-20T00:00:00.000Z").run();
  await expect(env.DB.prepare("INSERT INTO events (id,title,year,half,status,revision,created_at,updated_at) VALUES (?1,?2,2026,'H1','DRAFT',1,?3,?3)")
    .bind(ids.event2, "중복 행사", "2026-07-20T00:00:00.000Z").run()).rejects.toThrow();
});
```

```ts
// apps/worker/test/atomic.integration.test.ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { runGuardedAtomic } from "../src/db/atomic";

it("rolls back an earlier audit insert when a later statement violates a constraint", async () => {
  const operationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  const guard = env.DB.prepare("INSERT INTO operation_guards (id,ok) VALUES (?1,1)").bind(operationId);
  const statements = [
    env.DB.prepare("INSERT INTO audit_logs (id,entity,action,created_at) VALUES (?1,'event','TEST',?2)").bind(auditId, now),
    env.DB.prepare("INSERT INTO audit_logs (id,entity,action,created_at) VALUES (?1,'event','TEST',?2)").bind(auditId, now),
  ];
  await expect(runGuardedAtomic(env.DB, { operationId, guard, statements, guardProblem: "STALE_REVISION" })).rejects.toThrow();
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE id=?1").bind(auditId).first<{ count: number }>())?.count).toBe(0);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM operation_guards WHERE id=?1").bind(operationId).first<{ count: number }>())?.count).toBe(0);
});
```

- [ ] **Step 2: Run the integration suites before the migration exists**

Run: `pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts`

Expected: FAIL because the tables and `runGuardedAtomic` do not exist.

- [ ] **Step 3: Add the complete schema with the Cloud Run credential model**

Create these tables in one append-only initial migration. Every foreign key uses `ON DELETE RESTRICT`; boolean values are `INTEGER CHECK(value IN (0,1))`; timestamps are `TEXT NOT NULL` except nullable revoke/use fields.

| Table | Required columns/constraints |
| --- | --- |
| `organizations` | `id`, unique `name`, `is_active`, created/updated timestamps |
| `users` | `id`, `login_id`, unique `login_id_canonical`, `display_name`, role check, `is_active`, `is_bootstrap`, positive `session_version`, timestamps |
| `user_organizations` | `(user_id, organization_id)` composite key |
| `password_credentials` | `user_id` primary key, positive `kdf_version`, `phc`, `must_change_password`, `changed_at` |
| `auth_sessions` | `id`, `user_id`, `session_version`, `csrf_hash`, `kind` check, issued/expiry/revoked timestamps |
| `login_attempts` | `id`, `action` check (`LOGIN`,`RECOVERY`), `key_hash`, `ip_hash`, `outcome` check (`SUCCESS`,`FAILURE`), `occurred_at`; indexes on `(action,key_hash,occurred_at)` and `(action,ip_hash,occurred_at)` |
| `security_events` | `id`, nullable `user_id`, `event_type`, nullable `ip_hash`, `request_id`, `created_at`; append-only triggers |
| `bootstrap_locks` | singleton `id = 'first-operator'`, `claimed_at` |
| `recovery_codes` | `id`, unique `code_hmac`, `is_active`, nullable `used_at`, `replaced_by_id`, `created_at`; partial unique index for one active code |
| `operation_guards` | ephemeral `id` primary key and `ok INTEGER NOT NULL CHECK(ok=1)`; it is inserted as the first statement and deleted as the last statement of a guarded D1 batch |
| `participants` | `id`, unique `participant_number`, `name`, nullable `organization_id`, `is_active`, timestamps |
| `events` | `id`, `title`, `year`, `half` check, optional date/place, status check, positive `revision`, timestamps, unique `(year,half)` |
| `event_roster_entries` | `id`, event/participant IDs, participant/name/organization snapshots, source/status checks, positive revision, actor/timestamps, unique `(event_id,participant_id)` |
| `event_expected_snapshots` | `(event_id, organization_id)` primary key, snapshot name/count/captured time |
| `audit_logs` | `id`, nullable actor/event/roster IDs, entity/action, nullable before/after JSON, `created_at`; append-only triggers |
| `import_runs` | `id`, event/actor IDs, non-negative received/created/reactivated/unchanged/error counts, nullable `committed_at` |

Create indexes for canonical login lookup, active sessions by user, roster event/status/organization lookup, audit event/time, and import event/time. Add both `BEFORE UPDATE` and `BEFORE DELETE` triggers for `audit_logs` and `security_events` that execute `SELECT RAISE(ABORT, 'append-only')`.

```ts
// apps/worker/src/db/atomic.ts
import type { ApiProblem } from "@event-roster/contracts";

export class OperationGuardError extends Error {
  constructor(readonly code: ApiProblem["code"]) {
    super(code);
  }
}

export async function runGuardedAtomic(
  db: D1Database,
  input: {
    operationId: string;
    guard: D1PreparedStatement;
    statements: readonly D1PreparedStatement[];
    guardProblem: ApiProblem["code"];
  },
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

For every mutation whose status/revision/existence precondition matters, generate an operation UUID and make `guard` the first statement in the same batch:

```ts
const guard = db.prepare(`
  INSERT INTO operation_guards (id, ok)
  VALUES (?1, CASE WHEN EXISTS (
    SELECT 1 FROM events
    WHERE id=?2 AND revision=?3 AND status='PRE_REGISTRATION'
  ) THEN 1 ELSE 0 END)
`).bind(operationId, eventId, expectedRevision);
```

Create a `BEFORE INSERT` trigger on `operation_guards` that executes `SELECT RAISE(ABORT, 'operation_guard_rejected')` when `NEW.ok <> 1`. Together with `CHECK(ok=1)`, this makes a false predicate a recognizable SQLite constraint failure, so `DB.batch()` rolls back the guard, domain write, snapshot/import/audit/security rows together. `runGuardedAtomic()` maps only that known failure to the route's supplied `STALE_REVISION`, `INVALID_TRANSITION`, `EVENT_CLOSED`, or `INVALID_RECOVERY_CODE` problem; do not treat a zero-row `UPDATE` as a successful transaction. Every later write in the batch also includes `WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id=?1)` as defense in depth.

Do not implement `resetDatabase()` and never delete append-only rows in tests. Keep Worker Vitest's default isolated storage per test file, put singleton bootstrap/recovery lifecycles in their own file, and have each ordinary test create UUID-scoped records with `testIds()` and query only those IDs. This preserves production append-only triggers while avoiding inter-test cleanup.

- [ ] **Step 4: Verify schema constraints, append-only triggers, and D1 batch rollback**

Add tests that reject updates/deletes of audit/security rows, reject a second active recovery code, and show both a duplicate constraint and a false operation guard leave no roster, event revision, snapshot, import, audit, or security rows from earlier batch statements.

Run: `pnpm --filter @event-roster/worker test -- schema.integration.test.ts atomic.integration.test.ts && pnpm --filter @event-roster/worker run check && pnpm format:check`

Expected: PASS.

```bash
git add apps/worker/migrations apps/worker/src/db apps/worker/test apps/worker/vitest.config.ts
git commit -m "feat: add D1 event roster schema"
```

### Task 5: Add Worker JWT, CSRF, and signed Cloud Run KDF client primitives

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/src/{app,index}.ts`
- Create: `apps/worker/src/http/{problem,request-context,origin}.ts`
- Create: `apps/worker/src/security/{base64url,jwt,cookies,csrf,constant-time,kdf-client,temporary-password}.ts`
- Create: `apps/worker/test/security/{jwt,cookies,csrf,kdf-client,temporary-password}.test.ts`
- Create: `apps/worker/test/support/env.ts`
- Modify: `apps/worker/worker-configuration.d.ts`

**Interfaces:**
- Consumes: `/internal/v1/password/*` contract from Task 1 and `SessionClaims` from Task 3.
- Produces: `issueSessionJwt`, `verifySessionJwt`, `createCsrfToken`, `createSessionCookie`, `PasswordServiceClient`, and no-secret `ApiProblem` handling.

```ts
export interface Env {
  DB: D1Database;
  APP_ORIGIN: string;
  PASSWORD_SERVICE_URL: string;
  JWT_SIGNING_KEY: string;
  AUTH_KDF_SHARED_SECRET: string;
  IP_HASH_KEY: string;
  BOOTSTRAP_TOKEN?: string;
  RECOVERY_CODE_PEPPER: string;
}

export interface PasswordServiceClient {
  hash(password: string): Promise<{ kdfVersion: number; phc: string }>;
  verify(password: string, phc?: string): Promise<boolean>;
}

export interface AppDependencies {
  passwordServiceFor(env: Env): PasswordServiceClient;
  now(): Date;
  randomBytes(length: number): Uint8Array;
}

export function createApp(overrides?: Partial<AppDependencies>): Hono<{ Bindings: Env }>;
```

- [ ] **Step 1: Write failing security and KDF-client tests**

```ts
// apps/worker/test/security/kdf-client.test.ts
import { expect, it, vi } from "vitest";
import { PasswordServiceError, createPasswordServiceClient } from "../../src/security/kdf-client";

it("signs exact JSON bytes and refuses redirect or service errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("redirect", { status: 302, headers: { location: "https://elsewhere.test" } }));
  const client = createPasswordServiceClient(testEnv, fetcher);
  await expect(client.hash("temporary-password-123")).rejects.toBeInstanceOf(PasswordServiceError);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
});

// apps/worker/test/security/csrf.test.ts
it("hashes but does not return the stored CSRF representation", async () => {
  const token = createCsrfToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(await hashCsrfToken(token)).not.toBe(token);
});

it("injects a mock password service instead of making a network call in Worker integration tests", async () => {
  const app = createApp({ passwordServiceFor: () => passwordServiceMock });
  await app.request("https://example.test/api/v1/auth/login", loginRequestInit);
  expect(passwordServiceMock.verify).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the primitive tests before implementations exist**

Run: `pnpm --filter @event-roster/worker test -- jwt.test.ts cookies.test.ts csrf.test.ts kdf-client.test.ts temporary-password.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement defensive Worker primitives**

Use `jose` HS256 to sign/verify only the canonical `SessionClaims`; reject bad issuer, audience, expiry, malformed claims, and altered signatures. `FULL` expires after 8 hours; `MUST_CHANGE_PASSWORD` after 10 minutes. `createSessionCookie()` must emit exactly `__Host-er_session=<jwt>; Path=/; HttpOnly; Secure; SameSite=Lax` and clear it with `Max-Age=0`.

```ts
// apps/worker/src/security/kdf-client.ts
export function createPasswordServiceClient(env: Env, fetcher: typeof fetch = fetch): PasswordServiceClient {
  async function call(path: "/internal/v1/password/hash" | "/internal/v1/password/verify", payload: unknown) {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = await base64urlSha256(body);
    const signature = await hmacBase64url(
      env.AUTH_KDF_SHARED_SECRET,
      `v1\n${timestamp}\nPOST\n${path}\n${digest}`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(`${env.PASSWORD_SERVICE_URL}${path}`, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-er-kdf-key-id": "v1",
          "x-er-kdf-timestamp": timestamp,
          "x-er-kdf-body-sha256": digest,
          "x-er-kdf-signature": signature,
        },
        body,
      });
      if (!response.ok) throw new PasswordServiceError(response.status);
      return response.json() as Promise<unknown>;
    } catch (error) {
      throw error instanceof PasswordServiceError ? error : new PasswordServiceError(503);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async hash(password) {
      const result = await call("/internal/v1/password/hash", { password });
      if (!isHashResult(result)) throw new PasswordServiceError(502);
      return result;
    },
    async verify(password, phc) {
      const result = await call("/internal/v1/password/verify", { password, phc });
      if (!isVerifyResult(result)) throw new PasswordServiceError(502);
      return result.verified;
    },
  };
}
```

Define `isHashResult(value): value is { kdfVersion: number; phc: string }` and `isVerifyResult(value): value is { verified: boolean }` as strict runtime guards: both reject extra malformed/non-string shapes and `kdfVersion` must be the supported integer. `base64urlSha256`, `hmacBase64url`, and `constantTimeEqualUtf8` must use Web Crypto and no Node API. `problem.ts` maps `PasswordServiceError` to `503 AUTH_SERVICE_UNAVAILABLE` with a request ID and never includes the upstream body or exception text. `origin.ts` rejects any mutation whose `Origin` is not exactly `APP_ORIGIN`.

Refactor `app.ts` to export `createApp(overrides = {})`. Its production defaults are `passwordServiceFor: (env) => createPasswordServiceClient(env)`, `now: () => new Date()`, and `randomBytes: crypto.getRandomValues`; `index.ts` exports `createApp()` only. All auth/bootstrap/recovery services receive these dependencies instead of importing `fetch` or `createPasswordServiceClient` directly. `apps/worker/test/support/auth.ts` defines one deterministic `passwordServiceMock` (`hash` and `verify` Vitest fns), fixed clock, deterministic bytes, and `createTestApp()` that passes them into `createApp`. Reset mock calls in each test; no Worker integration test may use a real `PASSWORD_SERVICE_URL` or network fetch.

- [ ] **Step 4: Run primitive verification and regenerate Worker bindings**

Run: `pnpm --filter @event-roster/worker test -- jwt.test.ts cookies.test.ts csrf.test.ts kdf-client.test.ts temporary-password.test.ts && pnpm --filter @event-roster/worker run types && pnpm --filter @event-roster/worker run check`

Expected: PASS. The test must prove that a timeout, 401, 5xx, malformed JSON, and redirect cannot produce a successful hash/verify result.

```bash
git add apps/worker/package.json apps/worker/src/env.ts apps/worker/src/http apps/worker/src/security apps/worker/test/security apps/worker/test/support/env.ts apps/worker/worker-configuration.d.ts pnpm-lock.yaml
git commit -m "feat: add Worker session and password service primitives"
```

### Task 6: Implement bootstrap handoff, login, session revocation, and recovery code flows

**Files:**
- Create: `apps/worker/src/db/auth.ts`
- Create: `apps/worker/src/services/{bootstrap,auth,recovery}.ts`
- Create: `apps/worker/src/middleware/{authentication,require-full-session,csrf}.ts`
- Create: `apps/worker/src/routes/{bootstrap,auth}.ts`
- Create: `apps/worker/test/support/auth.ts`
- Create: `apps/worker/test/{bootstrap,auth,recovery}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: D1 schema, Worker security primitives, `LoginRequestSchema`, `RecoveryRequestSchema`, and `Actor`.
- Produces: first bootstrap, bootstrap-only first-individual handoff, login, `/auth/me`, `/auth/csrf`, password change, logout, recovery, and `requireActor`/`requireFullSession` middleware.

```ts
export async function bootstrapFirstOperator(
  input: { loginId: string; displayName: string },
  env: Env,
): Promise<{ user: CurrentSession["user"]; temporaryPassword: string; recoveryCode: string }>;
export async function createFirstIndividualOperator(
  actor: Actor,
  input: { loginId: string; displayName: string },
  env: Env,
): Promise<{ user: CurrentSession["user"]; temporaryPassword: string }>;
export async function login(input: { loginId: string; password: string }, meta: RequestMeta, env: Env): Promise<{ session: CurrentSession; cookie: string; csrfToken: string }>;
export async function currentSession(token: string, env: Env): Promise<Actor>;
export async function changeInitialPassword(actor: Actor, password: string, env: Env): Promise<void>;
export async function recoverOperator(input: RecoveryRequest, meta: RequestMeta, env: Env): Promise<{ user: CurrentSession["user"]; recoveryCode: string }>;
```

- [ ] **Step 1: Write failing lifecycle and enumeration-resistance integration tests**

```ts
// apps/worker/test/bootstrap.integration.test.ts
it("keeps bootstrap active until the first individual operator changes its password", async () => {
  const created = await requestBootstrap({ loginId: "shared-admin", displayName: "공용 운영자" });
  const sharedTemporary = await loginWithCredentials("shared-admin", created.temporaryPassword);
  expect(sharedTemporary.sessionKind).toBe("MUST_CHANGE_PASSWORD");
  await changePassword(sharedTemporary, "shared-permanent-password-123");
  const shared = await loginWithCredentials("shared-admin", "shared-permanent-password-123");
  const individual = await postFirstIndividualOperator(shared, { loginId: "minsu", displayName: "민수" });
  expect((await loginRequest({ loginId: "shared-admin", password: "shared-permanent-password-123" })).status).toBe(200);
  const individualTemporary = await loginWithCredentials("minsu", individual.temporaryPassword);
  await changePassword(individualTemporary, "individual-permanent-password-123");
  expect((await loginRequest({ loginId: "shared-admin", password: "shared-permanent-password-123" })).status).toBe(401);
});

// apps/worker/test/auth.integration.test.ts
it("returns identical failure semantics for wrong and unknown login IDs while calling KDF once", async () => {
  const wrong = await loginRequest({ loginId: "manager", password: "wrong-password-123" });
  const unknown = await loginRequest({ loginId: "nobody", password: "wrong-password-123" });
  expect(wrong.status).toBe(401);
  expect(unknown.status).toBe(401);
  expect(await wrong.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(await unknown.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(passwordServiceMock.verify).toHaveBeenCalledTimes(2);
});

// apps/worker/test/recovery.integration.test.ts
it("consumes a recovery code once and creates a must-change operator plus a replacement code", async () => {
  const [first, second] = await Promise.all([
    recoverRequest({ recoveryCode, loginId: "recovered-admin", displayName: "복구 운영자", password: "temporary-password-123" }),
    recoverRequest({ recoveryCode, loginId: "another-admin", displayName: "다른 운영자", password: "temporary-password-123" }),
  ]);
  expect([first.status, second.status].sort()).toEqual([201, 401]);
  expect(await countNonBootstrapOperators()).toBe(1);
  expect(await countActiveRecoveryCodes()).toBe(1);
});

it("creates no user, credential, replacement code, or security event for an invalid recovery code", async () => {
  const before = await recoveryRelatedRowCounts();
  const response = await recoverRequest({ recoveryCode: "invalid-recovery-code", loginId: "nobody", displayName: "없음", password: "temporary-password-123" });
  expect(response.status).toBe(401);
  expect(await recoveryRelatedRowCounts()).toEqual(before);
});
```

- [ ] **Step 2: Run the auth lifecycle tests before routes exist**

Run: `pnpm --filter @event-roster/worker test -- bootstrap.integration.test.ts auth.integration.test.ts recovery.integration.test.ts`

Expected: FAIL with 404 or missing-module errors.

- [ ] **Step 3: Implement exact authentication and handoff behavior**

`bootstrapFirstOperator()` first calls `PasswordServiceClient.hash()` with a CSPRNG 20-character temporary password, then uses `runGuardedAtomic()` to conditionally claim `bootstrap_locks('first-operator')`, insert an active `OPERATOR` with `is_bootstrap=1`, insert its PHC with `must_change_password=1`, insert a single active recovery code HMAC, and append a security event. The route requires exact Origin and exact constant-time `X-ER-Bootstrap-Token`; missing/empty `BOOTSTRAP_TOKEN` returns `404`. It returns no cookie, and its one-time temporary password/recovery-code response has `Cache-Control: no-store`. Two parallel calls must yield exactly one `201` and one `409`.

`createFirstIndividualOperator()` is the only account-creation route available before Task 7. It requires a `FULL`, active `is_bootstrap=1` `OPERATOR` session plus exact Origin and `X-ER-CSRF`; it rejects a second first-operator attempt. It creates the CSPRNG temporary password/Cloud Run PHC first, then executes a guarded batch whose predicate is “this bootstrap actor is still active and no non-bootstrap `OPERATOR` exists.” The batch inserts one `is_bootstrap=0`, `OPERATOR`, `must_change_password=1` user, credential, security event, and audit entry. It returns the temporary password once with `Cache-Control: no-store`. The client must complete the path bootstrap creation → temporary login → bootstrap password change/logout → full bootstrap login → first individual creation; it cannot call `/api/v1/users` until Task 7 and post-handoff.

`login()` does all of the following in this order: canonicalizes `loginId`; checks a 15-minute five-failure lock for HMAC(`IP_HASH_KEY`, `LOGIN\n<loginId>`) and HMAC(`IP_HASH_KEY`, `LOGIN\n<ip>`); loads the user/PHC; calls `PasswordServiceClient.verify(password, phc)` even for missing or inactive users; records a credential-free success/failure attempt; returns the same `401 AUTHENTICATION_REQUIRED` for every invalid credential state; and only then creates a D1 `auth_sessions` row plus HS256 JWT/cookie/CSRF token for a valid active user. A successful response includes `Cache-Control: no-store`. A KDF client error returns `503 AUTH_SERVICE_UNAVAILABLE` and never issues a cookie.

`currentSession()` verifies JWT cryptography, session ID/version/kind/expiry/revocation, user activity, and current organization links. It never trusts a role or organization from a JWT claim. `GET /api/v1/auth/csrf` rotates the 32-byte CSRF token, stores only its SHA-256 hash, returns `{ csrfToken }` with `Cache-Control: no-store`, and accepts either session kind. The React client keeps this token only in memory and sends it in `X-ER-CSRF`; no CSRF cookie exists.

`changeInitialPassword()` calls KDF hash first, then uses a guard for the current active user/session version to atomically replace the caller PHC, increment `session_version`, revoke all caller sessions, and append a security event. It deactivates every bootstrap user and revokes their sessions in the same batch **only** when the incoming session is `MUST_CHANGE_PASSWORD`, the caller is a non-bootstrap `OPERATOR`, and an active bootstrap user remains; an ordinary later FULL-session password change must never trigger handoff. The HTTP response clears the current cookie and returns `204` so every password change requires a fresh login.

`recoverOperator()` rate-limits HMAC(`IP_HASH_KEY`, `RECOVERY\n<ip>`), hashes the supplied password, HMACs the code with `RECOVERY_CODE_PEPPER`, and creates an operation UUID. Its `runGuardedAtomic()` first statement inserts the operation guard only when that exact code is active. The guarded sequence then (1) updates that code to inactive with `used_at` and its generated `replaced_by_id`, (2) inserts the replacement active code, (3) inserts the generated non-bootstrap `OPERATOR` with `must_change_password=1`, (4) inserts its PHC, and (5) inserts the security event; every insert is `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id=?1)`. The final guard deletion commits only after all five writes succeed. A false/used-code guard rolls back every row and maps to the same `401 INVALID_RECOVERY_CODE`; the result metadata must show exactly one inserted user before returning `201`. Concurrent use of one code must yield exactly one `201`, one `401`, one new user, and one active replacement code. It returns only the new user and replacement raw code with `Cache-Control: no-store`; it never reactivates a bootstrap user. The recovery-created operator follows the same first-change handoff rule.

Attach routes exactly as follows:

```ts
app.route("/api/v1/bootstrap", bootstrap);
app.route("/api/v1/auth", auth);
```

`POST /login` checks exact Origin but no CSRF. `POST /bootstrap/first-operator` requires a `FULL` bootstrap session and CSRF. Every other authenticated mutation, including logout and recovery when an Origin exists, calls `assertExactOrigin()`; `POST /auth/recover` is unauthenticated but is still same-origin-only and rate-limited. `MUST_CHANGE_PASSWORD` sessions may use only `/auth/me`, `/auth/csrf`, `/auth/change-password`, and `/auth/logout`.

- [ ] **Step 4: Add session invalidation, CSRF, throttling, and KDF-outage regressions**

```ts
it("rejects a missing X-ER-CSRF and revokes every old JWT after password change", async () => {
  const first = await loginAsTemporaryUser();
  const second = await loginAsTemporaryUser();
  expect((await authenticatedPost("/api/v1/auth/logout", first.cookie, {})).status).toBe(403);
  await authenticatedPost("/api/v1/auth/change-password", first.cookie, { password: "new-password-123" }, first.csrfToken);
  expect((await authenticatedGet("/api/v1/auth/me", first.cookie)).status).toBe(401);
  expect((await authenticatedGet("/api/v1/auth/me", second.cookie)).status).toBe(401);
});

it("returns 503 and no Set-Cookie when the KDF service is unavailable", async () => {
  passwordServiceMock.verify.mockRejectedValueOnce(new PasswordServiceError(503));
  const response = await loginRequest({ loginId: "manager", password: "temporary-password-123" });
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("marks all CSRF or one-time-secret responses as no-store", async () => {
  expect((await rawBootstrapRequest({ loginId: "shared-admin", displayName: "공용 운영자" })).headers.get("cache-control")).toBe("no-store");
  expect((await rawLoginRequest({ loginId: "shared-admin", password: "temporary-password-123" })).headers.get("cache-control")).toBe("no-store");
  expect((await rawRecoveryRequest(validRecoveryInput)).headers.get("cache-control")).toBe("no-store");
});
```

Run: `pnpm --filter @event-roster/worker test -- bootstrap.integration.test.ts auth.integration.test.ts recovery.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS, including five-failure lock, successful-login reset, deleted bootstrap secret, concurrent bootstrap, invalid CSRF, and password-service 503 tests.

```bash
git add apps/worker/src/db/auth.ts apps/worker/src/services apps/worker/src/middleware apps/worker/src/routes apps/worker/src/app.ts apps/worker/test/support/auth.ts apps/worker/test/bootstrap.integration.test.ts apps/worker/test/auth.integration.test.ts apps/worker/test/recovery.integration.test.ts
git commit -m "feat: add account handoff and session authentication"
```

### Task 7: Build operator organization and account administration APIs

**Files:**
- Create: `apps/worker/src/db/admin.ts`
- Create: `apps/worker/src/services/admin.ts`
- Create: `apps/worker/src/routes/{organizations,users}.ts`
- Create: `apps/worker/test/admin.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: `requireFullSession`, `Actor`, KDF client, D1 schema, and organization authorization rules.
- Produces: operator-only organization/user APIs and one-display temporary credentials.

- [ ] **Step 1: Write failing administration tests**

```ts
// apps/worker/test/admin.integration.test.ts
it("allows only a non-bootstrap operator to issue English login IDs", async () => {
  expect((await postAsManager("/api/v1/users", { loginId: "manager2", displayName: "담당자", role: "ORGANIZATION_MANAGER", organizationIds: [] })).status).toBe(403);
  expect((await postAsBootstrap("/api/v1/users", { loginId: "manager2", displayName: "담당자", role: "ORGANIZATION_MANAGER", organizationIds: [] })).status).toBe(403);
  const response = await postAsOperator("/api/v1/users", { loginId: "manager2", displayName: "담당자", role: "ORGANIZATION_MANAGER", organizationIds: [orgId] });
  expect(response.status).toBe(201);
  expect((await response.json()).temporaryPassword).toHaveLength(20);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("invalidates a manager session when its organization assignment changes", async () => {
  const session = await loginAsManager();
  await patchAsOperator(`/api/v1/users/${managerId}`, { organizationIds: [] });
  expect((await authenticatedGet("/api/v1/auth/me", session.cookie)).status).toBe(401);
});
```

- [ ] **Step 2: Run the administration tests before API modules exist**

Run: `pnpm --filter @event-roster/worker test -- admin.integration.test.ts`

Expected: FAIL with unavailable routes.

- [ ] **Step 3: Implement organization/user lifecycle and password resets**

Every route requires a `FULL` non-bootstrap `OPERATOR`, except bootstrap's narrow first-individual-operator creation route in Task 6. `createUser()` validates the canonical login ID, creates a CSPRNG 20-character temporary password, gets its PHC from Cloud Run, inserts the user/organization links/credential/security event atomically, and returns raw temporary password only in the successful response. It never returns PHC.

`resetUserPassword()` creates a new temporary password and PHC, sets `must_change_password=1`, increments the target session version, revokes all target sessions, and logs the reset. Both successful `POST /users` and `POST /users/:id/password-reset` responses contain a one-time temporary password only in the JSON body and set `Cache-Control: no-store`; no list or PATCH response contains it. User deactivation, role change, and organization-link replacement use the same version/revocation transaction. Organization deactivation blocks new links, participant creation, roster additions, and imports for that organization while retaining historical views/exports; it revokes sessions of assigned managers.

Add list endpoints that return no credential/session/recovery fields. A bootstrap actor may only create the first non-bootstrap `OPERATOR`; it cannot create organizations, managers, or a second account before handoff.

- [ ] **Step 4: Run access-change regression tests and commit**

Add assertions for duplicate login ID `409`, password-reset `Cache-Control: no-store`, organization deactivation blocking new participant/import writes, deactivated user rejecting an old cookie, role change revoking all old sessions, and user list never including PHC or temporary passwords.

Run: `pnpm --filter @event-roster/worker test -- admin.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS.

```bash
git add apps/worker/src/db/admin.ts apps/worker/src/services/admin.ts apps/worker/src/routes/organizations.ts apps/worker/src/routes/users.ts apps/worker/src/app.ts apps/worker/test/admin.integration.test.ts
git commit -m "feat: add organization and account administration"
```

### Task 8: Implement event lifecycle and participant master APIs

**Files:**
- Create: `apps/worker/src/db/{audit,events,participants}.ts`
- Create: `apps/worker/src/services/{events,participants}.ts`
- Create: `apps/worker/src/routes/{events,participants}.ts`
- Create: `apps/worker/test/{events,participants}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: `Actor`, event lifecycle/domain authorization, atomic D1 helper.
- Produces: event CRUD/lifecycle and participant master search/create/update APIs.

- [ ] **Step 1: Write failing event and participant scope tests**

```ts
// apps/worker/test/events.integration.test.ts
it("allows only approved lifecycle transitions and freezes expected snapshots on DAY_OF", async () => {
  const event = await createEventAsOperator({ title: "2026 상반기 행사", year: 2026, half: "H1" });
  expect((await transitionAsOperator(event.id, "DAY_OF", event.revision)).status).toBe(409);
  const pre = await transitionAsOperator(event.id, "PRE_REGISTRATION", event.revision);
  const dayOf = await transitionAsOperator(event.id, "DAY_OF", (await pre.json()).revision);
  expect(dayOf.status).toBe(200);
  expect(await expectedSnapshotCount(event.id)).toBeGreaterThanOrEqual(0);
});

// apps/worker/test/participants.integration.test.ts
it("prevents a manager from creating a participant for another organization", async () => {
  expect((await postAsManager("/api/v1/participants", { name: "참가자", organizationId: otherOrganizationId })).status).toBe(403);
});
```

- [ ] **Step 2: Run tests and confirm routes fail before implementation**

Run: `pnpm --filter @event-roster/worker test -- events.integration.test.ts participants.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement state/revision-guarded events and reusable participants**

`POST /events` requires `OPERATOR`, enforces unique `(year, half)`, and starts `DRAFT`. Metadata `PATCH` is allowed only in `DRAFT`/`PRE_REGISTRATION` with current revision. Every PATCH/transition calls `runGuardedAtomic()` with an event predicate covering id, expected revision, and allowed current status before it updates metadata/revision or writes audit/snapshots. Transition `PRE_REGISTRATION → DAY_OF` inserts the complete organization expected-count snapshot and increments revision in that same guarded batch; a false guard writes neither snapshot nor audit row. `CLOSED → DAY_OF` preserves the original snapshot and permits only audited manual roster operations afterward. `DAY_OF`/`CLOSED` metadata is immutable.

Participants store global participant number/name/current organization. Operators can manage all fields and are the only role allowed to move a participant between organizations. An organization manager may create or edit a participant name only within one of their linked active organizations; any submitted `organizationId` change from that role is rejected with `403`. Moving a participant with a current `DAY_OF` roster row is rejected; an operator move during `PRE_REGISTRATION` updates the relevant roster snapshot, while closed-event rows retain historical snapshot values. Generate `P-${crypto.randomUUID().toUpperCase()}` and retry once after a unique collision.

- [ ] **Step 4: Verify state conflicts and commit**

Add tests for duplicate H1 event, stale revision `409` with no revision/audit/snapshot change, closed event metadata rejection with no audit change, organization inactive rejection, participant number retry, organization-manager name update within scope, organization-manager organization-move `403`, DAY_OF organization move rejection, and preserved closed snapshots.

Run: `pnpm --filter @event-roster/worker test -- events.integration.test.ts participants.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS.

```bash
git add apps/worker/src/db/audit.ts apps/worker/src/db/events.ts apps/worker/src/db/participants.ts apps/worker/src/services/events.ts apps/worker/src/services/participants.ts apps/worker/src/routes/events.ts apps/worker/src/routes/participants.ts apps/worker/src/app.ts apps/worker/test/events.integration.test.ts apps/worker/test/participants.integration.test.ts
git commit -m "feat: add event and participant APIs"
```

### Task 9: Implement roster mutations, summaries, optimistic conflicts, and audit history

**Files:**
- Create: `apps/worker/src/db/{roster,reports}.ts`
- Create: `apps/worker/src/services/{roster,reports}.ts`
- Create: `apps/worker/src/routes/{roster,reports}.ts`
- Create: `apps/worker/test/{roster,reports}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: event/participant APIs, `assertRosterWritable`, `buildEventSummary`, atomic helper, authenticated actor.
- Produces: roster create/update/list, organization/overall summary, and audit-log endpoints.

```ts
export async function addRosterEntry(actor: Actor, eventId: string, input: RosterCreate, env: Env): Promise<RosterEntry>;
export async function updateRosterEntry(actor: Actor, eventId: string, entryId: string, input: RosterUpdate, env: Env): Promise<RosterEntry>;
export async function getEventSummary(actor: Actor, eventId: string, env: Env): Promise<EventSummary>;
```

- [ ] **Step 1: Write failing roster invariant and summary tests**

```ts
// apps/worker/test/roster.integration.test.ts
it("preserves cancelled pre-event rows and counts a DAY_OF addition separately", async () => {
  const preEntry = await addPreEventParticipant(eventId, participantId);
  await updateRosterAsOperator(eventId, preEntry.id, { status: "CANCELLED", revision: preEntry.revision });
  await addDayOfParticipant(eventId, anotherParticipantId);
  const summary = await getSummaryAsOperator(eventId);
  expect(summary).toMatchObject({ expectedTotal: 1, finalTotal: 1, deltaTotal: 0 });
  expect(await rosterHistory(eventId, participantId)).toHaveLength(1);
});

it("returns the current row in a STALE_REVISION problem", async () => {
  const first = await addPreEventParticipant(eventId, participantId);
  await updateRosterAsOperator(eventId, first.id, { status: "CANCELLED", revision: first.revision });
  const stale = await updateRosterAsOperator(eventId, first.id, { status: "ACTIVE", revision: first.revision });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "STALE_REVISION", details: { latestEntry: { id: first.id } } });
});
```

- [ ] **Step 2: Run the roster tests before routes exist**

Run: `pnpm --filter @event-roster/worker test -- roster.integration.test.ts reports.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement state-aware writes and append-only audit rows**

`POST /events/:id/roster` accepts an existing participant or a validated new participant. It creates `PRE_EVENT` active rows only in `PRE_REGISTRATION`; in `DAY_OF`, it creates only `DAY_OF` active rows. Every create/update builds a `runGuardedAtomic()` predicate covering actor scope, active organization, event status/revision, and (for PATCH) current entry revision before it writes the roster row, event revision, or audit row. A false entry-revision guard returns `STALE_REVISION` with a sanitized `latestEntry`; it must not append audit or increment an event revision.

Pre-event cancellation changes `status` to `CANCELLED` but never deletes a row. A day-of participant can be cancelled only by a documented roster update action; the aggregate formula is always `final = expected + active DAY_OF rows - cancelled PRE_EVENT rows`. Every successful mutation writes the roster snapshot, audit before/after JSON, and relevant event revision update in one `DB.batch()`.

`GET /summary` builds all totals in SQL then calls the pure `buildEventSummary()` helper. `GET /audit-logs` returns a cursor page ordered by `(created_at, id)` and filters a manager to its organization snapshots. No audit endpoint returns credentials, IP hashes, CSRF hashes, or recovery data.

- [ ] **Step 4: Verify authorization, state guards, and aggregation**

Add tests for manager cross-organization `403` with one credential-free security event, CLOSED write rejection, duplicate event/participant roster row conflict, cancelled row reactivation through import-compatible service, Day Of source restriction, stale event revision, and all organization-level summary values.

Run: `pnpm --filter @event-roster/worker test -- roster.integration.test.ts reports.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS.

```bash
git add apps/worker/src/db/roster.ts apps/worker/src/db/reports.ts apps/worker/src/services/roster.ts apps/worker/src/services/reports.ts apps/worker/src/routes/roster.ts apps/worker/src/routes/reports.ts apps/worker/src/app.ts apps/worker/test/roster.integration.test.ts apps/worker/test/reports.integration.test.ts
git commit -m "feat: add roster summaries and audit history"
```

### Task 10: Implement Excel import validation, atomic commit, and export-data APIs

**Files:**
- Create: `apps/worker/src/db/imports.ts`
- Create: `apps/worker/src/services/imports.ts`
- Create: `apps/worker/src/routes/{imports,exports}.ts`
- Create: `apps/worker/test/{imports,exports}.integration.test.ts`
- Modify: `apps/worker/src/app.ts`

**Interfaces:**
- Consumes: import schemas/domain validation, participant/roster services, atomic helper, full operator actor.
- Produces: normalized JSON validation, all-or-nothing commit, and data-only export API.

```ts
export async function validateImport(actor: Actor, eventId: string, rows: readonly ImportRowInput[], env: Env): Promise<ImportValidationResult>;
export async function commitImport(actor: Actor, eventId: string, expectedEventRevision: number, rows: readonly ResolvedImportRow[], env: Env): Promise<ImportCommitResult>;
export async function buildEventExport(actor: Actor, eventId: string, env: Env): Promise<EventExportData>;
```

- [ ] **Step 1: Write failing import/rollback and export-shape tests**

```ts
// apps/worker/test/imports.integration.test.ts
it("rolls back all 130 rows, audit rows, and import run when one row conflicts", async () => {
  const rows = makeResolvedRows(130);
  rows[129] = { ...rows[129], participantNumber: rows[0].participantNumber };
  const validation = await validateImportAsOperator(eventId, rows);
  const response = await commitImportAsOperator(eventId, { expectedEventRevision: validation.eventRevision, rows });
  expect(response.status).toBe(422);
  expect(await countRowsForEvent(eventId)).toBe(0);
  expect(await countAuditRowsForEvent(eventId)).toBe(0);
  expect(await countImportRunsForEvent(eventId)).toBe(0);
});

it("does not write any import-related row when the validated event revision is stale", async () => {
  const validation = await validateImportAsOperator(eventId, makeResolvedRows(2));
  await transitionOrEditEventToAdvanceRevision(eventId);
  const response = await commitImportAsOperator(eventId, { expectedEventRevision: validation.eventRevision, rows: validation.resolvedRows });
  expect(response.status).toBe(409);
  expect(await countRowsForEvent(eventId)).toBe(0);
  expect(await countAuditRowsForEvent(eventId)).toBe(0);
  expect(await countImportRunsForEvent(eventId)).toBe(0);
});

// apps/worker/test/exports.integration.test.ts
it("returns data for roster and organization summary sheets without source workbook bytes", async () => {
  const response = await getExportAsOperator(eventId);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ roster: expect.any(Array), summary: expect.any(Array) });
});
```

- [ ] **Step 2: Run tests and confirm import/export routes are absent**

Run: `pnpm --filter @event-roster/worker test -- imports.integration.test.ts exports.integration.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement four-stage import server contracts and one batch commit**

`POST /imports/validate` accepts only normalized row JSON from the browser, validates 1–130 nonempty names and organization names, detects in-file duplicate participant identity, resolves organization/participant candidates, and returns per-row errors/ambiguities plus the current positive `eventRevision`, without creating a D1 `import_runs` row. Only full operators may call it for `PRE_REGISTRATION` events.

`POST /imports/commit` accepts `ImportCommitRequestSchema`, revalidates every row, and calls `runGuardedAtomic()` with the supplied `expectedEventRevision` and `PRE_REGISTRATION` status before its first participant/roster write. It creates missing participants, creates missing pre-event roster rows, reactivates matching cancelled rows, records unchanged active rows, creates one `import_runs` record, and writes all audit rows in the guarded batch. A changed event state/revision returns `409 STALE_REVISION` and leaves zero participant, roster, audit, or import-run rows. It returns `{ receivedRows, createdRows, reactivatedRows, unchangedRows }` and never accepts an uploaded file, `ArrayBuffer`, workbook XML, or raw cell matrix.

`GET /export-data` produces stable JSON `roster` and `summary` arrays sorted by organization/name/participant number. It includes closed historical snapshots and no source upload data.

- [ ] **Step 4: Verify import policy and commit**

Add tests for unknown organization, duplicate file row, ambiguous participant resolution, inactive organization, non-operator rejection, `DAY_OF` rejection, cancelled row reactivation, already-active no-op, a stale `expectedEventRevision` returning `409` with zero participant/roster/audit/import-run rows, and two-sheet export DTO ordering.

Run: `pnpm --filter @event-roster/worker test -- imports.integration.test.ts exports.integration.test.ts && pnpm --filter @event-roster/worker run check`

Expected: PASS.

```bash
git add apps/worker/src/db/imports.ts apps/worker/src/services/imports.ts apps/worker/src/routes/imports.ts apps/worker/src/routes/exports.ts apps/worker/src/app.ts apps/worker/test/imports.integration.test.ts apps/worker/test/exports.integration.test.ts
git commit -m "feat: add atomic roster import and export data"
```

### Task 11: Build the React design foundation and custom-login flows

**Files:**
- Create: `apps/web/src/styles/{tokens,global}.css`
- Create: `apps/web/src/components/ui/{Button,Card,Dialog,TextInput,StatusMessage}.tsx`
- Create: `apps/web/src/lib/{api,csrf,session}.ts`
- Create: `apps/web/src/app/{router,AppShell}.tsx`
- Create: `apps/web/src/features/auth/{AuthProvider,LoginPage,ChangePasswordPage,RecoveryPage,BootstrapHandoffPage,auth.test}.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: Task 6 session/auth endpoints and `CurrentSession` contracts.
- Produces: same-origin credentialed client, in-memory CSRF/session context, login/change/recovery routes, and reusable `--er-*` UI primitives.

- [ ] **Step 1: Write failing browser tests for no token persistence and account handoff UI**

```tsx
// apps/web/src/features/auth/auth.test.tsx
it("submits a login ID, stores CSRF only in provider memory, and never writes tokens to storage", async () => {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText("로그인 ID"), "minsu.kim");
  await userEvent.type(screen.getByLabelText("비밀번호"), "temporary-password-123");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(await screen.findByText("새 비밀번호를 설정하세요.")).toBeVisible();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("erases a replacement recovery code when its dialog is closed", async () => {
  render(<RecoveryPage />);
  await submitValidRecovery();
  expect(await screen.findByText(/복구 코드를 안전한 곳에 보관/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText(/복구 코드를 안전한 곳에 보관/)).not.toBeInTheDocument();
});

it("forces a full bootstrap session through first-operator handoff and clears its one-time password on close", async () => {
  mockSession({ user: { ...sharedBootstrapUser, isBootstrap: true }, sessionKind: "FULL" });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "첫 개별 운영자 만들기" })).toBeVisible();
  await submitFirstIndividualOperator({ loginId: "minsu", displayName: "민수" });
  expect(await screen.findByText(/임시 비밀번호/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText(/임시 비밀번호/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the browser tests and confirm auth modules are absent**

Run: `pnpm --filter @event-roster/web test -- auth.test.tsx`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement focused tokens, API client, and auth routes**

Define `--er-color-*`, `--er-space-*`, `--er-radius-*`, `--er-shadow-*`, and `--er-font-weight-*` in `tokens.css`; components must consume tokens rather than literal per-component colors/radii. `api.ts` always uses relative `/api/v1`, `credentials: "include"`, JSON content type, and attaches `X-ER-CSRF` only after `AuthProvider` receives it from login or `/auth/csrf`. It converts `ApiProblem` JSON into typed client errors and never stores raw password, JWT, or recovery code.

`LoginPage` renders the field label `로그인 ID`, generic invalid-credential copy, and a link to `RecoveryPage`. `ChangePasswordPage` is the only route available for `MUST_CHANGE_PASSWORD`; it requires confirmation, calls `/auth/change-password`, clears provider memory on `204`, and returns to login with `새 비밀번호로 다시 로그인하세요.` `RecoveryPage` requests a new account and one replacement code, displays it in dialog-local state only, and clears it on close/unmount. `BootstrapHandoffPage` is the only route for a `FULL` session whose `session.user.isBootstrap` is true: it calls `POST /api/v1/bootstrap/first-operator` with in-memory CSRF, shows the returned temporary password in dialog-local state once, and clears it on close/unmount. Route guards redirect inactive/no-session users to `/login`, MUST_CHANGE sessions to `/change-password`, bootstrap FULL sessions to `/bootstrap-handoff`, and only non-bootstrap FULL sessions to `/events`.

- [ ] **Step 4: Run auth/UI checks and commit**

Run: `pnpm --filter @event-roster/web test -- auth.test.tsx && pnpm --filter @event-roster/web run check && pnpm --filter @event-roster/web build`

Expected: PASS.

```bash
git add apps/web/src/styles apps/web/src/components/ui apps/web/src/lib apps/web/src/app apps/web/src/features/auth apps/web/src/main.tsx apps/web/src/app/App.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add custom login and design foundation"
```

### Task 12: Build organization, account, and event management screens

**Files:**
- Create: `apps/web/src/features/admin/{OrganizationsPage,UsersPage,UserForm,TemporaryPasswordDialog,admin}.test.tsx`
- Create: `apps/web/src/features/events/{EventsPage,EventForm,EventTransitionDialog,events}.test.tsx`
- Modify: `apps/web/src/app/{router,AppShell}.tsx`

**Interfaces:**
- Consumes: organization/user/event APIs and UI primitives.
- Produces: operator-only management screens, temporary password local dialog, and event lifecycle UI.

- [ ] **Step 1: Write failing management-screen tests**

```tsx
// apps/web/src/features/admin/admin.test.tsx
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

// apps/web/src/features/events/events.test.tsx
it("disables metadata editing in DAY_OF and retains reopen only for CLOSED", () => {
  render(<EventForm event={{ ...event, status: "DAY_OF" }} />);
  expect(screen.getByLabelText("행사명")).toBeDisabled();
});
```

- [ ] **Step 2: Run the management tests before components exist**

Run: `pnpm --filter @event-roster/web test -- admin.test.tsx events.test.tsx`

Expected: FAIL with missing-module errors.

- [ ] **Step 3: Implement role-aware management pages**

Only a non-bootstrap `OPERATOR` sees administration navigation. `UsersPage` lists login ID, display name, role, linked organizations, active state, and reset action; it never displays PHC, sessions, recovery codes, or a bootstrap reactivation action. `UserForm` validates lowercase login ID before submit and supports organization assignment only for `ORGANIZATION_MANAGER`. `TemporaryPasswordDialog` keeps the returned raw value in component state, warns that it is displayed once, and clears state on close/unmount. A bootstrap session cannot bypass `BootstrapHandoffPage` to reach `UsersPage`.

`OrganizationsPage` creates, activates, and deactivates organizations with the server's error copy. `EventsPage` separates current events from past `CLOSED` events. `EventForm` sends current revision on edit; `EventTransitionDialog` explains snapshot capture on DAY_OF and preservation on CLOSED reopening. A `STALE_REVISION` response refetches the current event before an explicit retry. Managers get only permitted event/summary navigation and no administration controls.

- [ ] **Step 4: Verify screen behavior and commit**

Add tests for manager navigation hiding, invalid Korean login ID client error, disabled metadata in DAY_OF/CLOSED, H1/H2 duplicate error display, transition revision reload, and no temporary password in React Query cache after dialog close.

Run: `pnpm --filter @event-roster/web test -- admin.test.tsx events.test.tsx && pnpm --filter @event-roster/web run check`

Expected: PASS.

```bash
git add apps/web/src/features/admin apps/web/src/features/events apps/web/src/app/router.tsx apps/web/src/app/AppShell.tsx
git commit -m "feat: add event and account management screens"
```

### Task 13: Build the event roster operating console

**Files:**
- Create: `apps/web/src/features/roster/{RosterConsolePage,RosterTable,RosterFilters,RosterEditorPanel,RosterConflictDialog,AuditLogPanel,roster}.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: roster, summary, audit APIs and current session role.
- Produces: 130-row table-first console, scoped edits, conflict resolution, and audit view.

- [ ] **Step 1: Write failing console behavior tests**

```tsx
// apps/web/src/features/roster/roster.test.tsx
it("filters all loaded rows locally without pagination", async () => {
  mockRoster(Array.from({ length: 130 }, (_, index) => rosterEntry(`참가자${index}`)));
  render(<RosterConsolePage eventId="event-1" />);
  await userEvent.type(screen.getByLabelText("이름 검색"), "참가자42");
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

it("opens a conflict dialog for a stale roster update", async () => {
  mockApi.patch.mockRejectedValueOnce(problem("STALE_REVISION", { latestEntry, changedBy: actor, changedAt: "2026-07-20T00:00:00.000Z" }));
  render(<RosterEditorPanel eventId="event-1" entry={entry} />);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("dialog", { name: "동시 수정 충돌" })).toBeVisible();
});
```

- [ ] **Step 2: Run the console test before components exist**

Run: `pnpm --filter @event-roster/web test -- roster.test.tsx`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement dense, state-aware roster operations**

Fetch roster, summary, and first audit page together for the chosen event. Above the table render expected/final/delta totals and per-organization cards. `RosterFilters` filters in memory by NFC-normalized name, organization, and active/cancelled state. Do not add pagination or virtualization.

`RosterEditorPanel` can add an existing/new participant, adjust permitted name fields, and cancel/reactivate according to server status rules. It is disabled in CLOSED and labels day-of actions separately. `RosterConflictDialog` shows sanitized server latest row, actor display name, timestamp, and only two explicit actions: `최신 값으로 새로고침` and `내 변경 다시 적용`. `AuditLogPanel` pages cursor results without credentials. At narrow widths render participant cards as a read-only table alternative while retaining edits in the panel.

- [ ] **Step 4: Verify console access and commit**

Add tests for CLOSED disabled edit controls, manager no cross-organization rows, DAY_OF labels, expected/final aggregate formula, audit redaction, and local filters retaining the complete loaded response.

Run: `pnpm --filter @event-roster/web test -- roster.test.tsx && pnpm --filter @event-roster/web run check`

Expected: PASS.

```bash
git add apps/web/src/features/roster apps/web/src/app/router.tsx
git commit -m "feat: add event roster operating console"
```

### Task 14: Add browser-only Excel import and export UI

**Files:**
- Create: `apps/web/src/features/imports/{ImportPage,workbook,ColumnMappingStep,ValidationReviewStep,imports}.test.tsx`
- Create: `apps/web/src/features/exports/{downloadWorkbook,ExportButton,exports}.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: Task 10 JSON import/export contracts and SheetJS in the browser package only.
- Produces: in-memory workbook parse/review/commit flow and two-sheet `.xlsx` download.

- [ ] **Step 1: Write failing import/export UI tests**

```tsx
// apps/web/src/features/imports/imports.test.tsx
it("does not commit until every validation issue is resolved", async () => {
  render(<ImportPage eventId="event-1" />);
  await selectWorkbookWithUnknownOrganization();
  expect(await screen.findByText("오류를 모두 해결해야 확정할 수 있습니다.")).toBeVisible();
  expect(mockApi.post).not.toHaveBeenCalledWith("/events/event-1/imports/commit", expect.anything());
});

// apps/web/src/features/exports/exports.test.ts
it("creates roster and summary sheets only from export DTO data", () => {
  const workbook = buildEventWorkbook(exportData);
  expect(workbook.SheetNames).toEqual(["명단", "집계"]);
});
```

- [ ] **Step 2: Run the import/export tests before helpers exist**

Run: `pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement browser-only workbook handling**

Add `xlsx` only to `@event-roster/web`. `workbook.ts` calls `XLSX.read(await file.arrayBuffer())`, returns sheet names and string matrix previews, and never sends `File`, `ArrayBuffer`, XML, or original cells to the Worker. The UI stages are: sheet selection, name/organization column mapping, server validation plus ambiguity resolution, then one all-or-nothing commit. Clear file/rows from component memory on cancel, successful commit, and route leave.

`ImportPage` is visible only to full operators for a PRE_REGISTRATION event. `ValidationReviewStep` renders row number/reason/corrective action for every issue and permits commit only when server result is valid and every ambiguous candidate has a selection; it keeps the validation result's `eventRevision` in component memory and sends it as `expectedEventRevision` on commit. `downloadWorkbook.ts` builds exactly `명단` and `집계` sheets from `EventExportData`, calls `XLSX.writeFile`, and includes no source workbook data.

- [ ] **Step 4: Verify browser Excel behavior and commit**

Run: `pnpm install && pnpm --filter @event-roster/web test -- imports.test.tsx exports.test.ts && pnpm --filter @event-roster/web build && pnpm --filter @event-roster/web run check`

Expected: PASS.

```bash
git add apps/web/src/features/imports apps/web/src/features/exports apps/web/src/app/router.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add browser Excel import and export"
```

### Task 15: Add local E2E, CI, Cloud Run/Workers deployment, and recovery operations

**Files:**
- Create: `apps/web/{playwright.config.ts,e2e/{auth,event-roster,import-export,global-setup,global-teardown}.ts,e2e/fixtures/create-workbook.mts}`
- Create: `apps/worker/scripts/{prepare-e2e-env,smoke-remote}.mts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/operations/{deployment,recovery}.md`
- Modify: `README.md`
- Modify: `apps/worker/{package.json,wrangler.jsonc,worker-configuration.d.ts}`
- Modify: `apps/web/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: every API/UI module, Cloud Run service from Task 1, D1 migration, and deployment secrets.
- Produces: repeatable local E2E, no-production-secret CI, factual deployment smoke, budget/recovery runbooks.

- [ ] **Step 1: Write failing E2E scenarios**

```ts
// apps/web/e2e/auth.spec.ts
import { expect, test } from "@playwright/test";

test("temporary-password user changes password, is logged out, and shared bootstrap remains disabled", async ({ page }) => {
  await loginAsFixtureTemporaryUser(page);
  await expect(page.getByText("새 비밀번호를 설정하세요.")).toBeVisible();
  await changePassword(page, "new-operator-password-123");
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  await loginWithCredentials(page, fixtureTemporaryUser.loginId, "new-operator-password-123");
  await expectSharedBootstrapLoginToFail(page);
});

// apps/web/e2e/import-export.spec.ts
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

- [ ] **Step 2: Run E2E through the package entrypoint and confirm it fails before fixtures/setup exist**

Run: `pnpm --filter @event-roster/web run e2e`

Expected: FAIL because the local password service, Worker secrets, fixture workbook, and test routes are not configured.

- [ ] **Step 3: Implement isolated local E2E and CI**

`prepare-e2e-env.mts` may write only ignored `apps/worker/.dev.vars`, `apps/password-service/.env.e2e`, `apps/worker/.wrangler/e2e-state`, and `apps/web/e2e/.local-e2e-env.json`. Before creating secrets, it resolves the exact `apps/worker/.wrangler/e2e-state` path, asserts that it is the E2E-only state directory, removes only that directory, and launches `pnpm exec wrangler d1 migrations apply event-roster --local --persist-to .wrangler/e2e-state` with `cwd` explicitly set to the Worker package root. This gives every E2E run an empty migrated D1 that uses the same persisted path as `wrangler dev`; it must never remove another `.wrangler` directory or any remote D1. It then generates CSPRNG non-production `JWT_SIGNING_KEY`, `AUTH_KDF_SHARED_SECRET`, `PASSWORD_PEPPER`, `IP_HASH_KEY`, `BOOTSTRAP_TOKEN`, and `RECOVERY_CODE_PEPPER`; invokes `uv --directory apps/password-service run python -m password_service.make_dummy` with the test pepper; and writes `PASSWORD_SERVICE_URL=http://127.0.0.1:8790` plus `APP_ORIGIN=http://127.0.0.1:8787` only to local env files.

Add the web package script `"e2e": "pnpm --filter @event-roster/worker run prepare:e2e-env && pnpm --filter @event-roster/web run build && playwright test"`. That script prepares every ignored local secret file and builds static assets before Playwright starts either `webServer`; the server commands must not generate or replace secrets themselves. `playwright.config.ts` imports `resolve` from `node:path`, then starts the password service before Wrangler with explicit package working directories and one Worker/D1 state:

```ts
webServer: [
  { command: "uv run uvicorn password_service.main:app --env-file .env.e2e --host 127.0.0.1 --port 8790", cwd: resolve(__dirname, "../password-service"), url: "http://127.0.0.1:8790/healthz", reuseExistingServer: false },
  { command: "pnpm exec wrangler dev --local --persist-to .wrangler/e2e-state --port 8787", cwd: resolve(__dirname, "../worker"), url: "http://127.0.0.1:8787/api/v1/health", reuseExistingServer: false },
],
workers: 1,
fullyParallel: false,
```

`global-setup.ts` is the single owner of empty-D1 initialization: it reads only the ignored bootstrap token, creates the shared bootstrap user, changes its initial password, logs in as a FULL bootstrap session, creates the first individual operator, changes that user's temporary password to complete handoff, then creates the fixture temporary user, organization, event, and a generated 130-row xlsx through real authenticated API calls. It writes only test-only IDs/credentials to the ignored local E2E state. Every Playwright spec starts from that completed fixture; no spec calls the bootstrap endpoint or relies on spec order. `global-teardown.ts` deletes generated workbook/secrets. CI installs uv, runs the Python service tests/lint, all package tests/checks, a Worker gzip dry-run, and Playwright; it never sets Cloudflare/GCP production credentials.

```bash
pnpm install --frozen-lockfile
pnpm --filter @event-roster/web exec playwright install --with-deps chromium
uv --directory apps/password-service sync --all-groups --frozen
uv --directory apps/password-service run pytest
uv --directory apps/password-service run ruff check src tests scripts
pnpm format:check
pnpm --filter @event-roster/contracts test
pnpm --filter @event-roster/domain test
pnpm --filter @event-roster/worker run types
pnpm --filter @event-roster/worker test
pnpm --filter @event-roster/web test
pnpm --filter @event-roster/web build
pnpm --filter @event-roster/worker exec wrangler deploy --dry-run --outdir .wrangler/bundle
pnpm --filter @event-roster/web run e2e
```

- [ ] **Step 4: Write deployment, smoke, budget, and recovery runbooks**

`docs/operations/deployment.md` must use this order: create a GCP project with billing; enable Cloud Run/Cloud Build/Secret Manager; create the dedicated runtime service account; create version-pinned `PASSWORD_PEPPER`, `AUTH_KDF_SHARED_SECRET`, and `DUMMY_ARGON2_PHC` secrets; grant only that account Secret Accessor; deploy Cloud Run in `asia-northeast3` with the Task 1 limits; run and archive the factual capability probe; explicitly create/link D1 with `wrangler d1 create event-roster --binding DB --update-config`; apply remote migration; configure Worker vars and secrets; build web assets; deploy Worker; run the one-time bootstrap smoke; display and store the recovery code offline; delete `BOOTSTRAP_TOKEN`; commit only non-secret D1/URL configuration.

The committed production `apps/worker/wrangler.jsonc` always has this non-secret origin var:

```jsonc
"vars": {
  "APP_ORIGIN": "https://event-roster.event-roster.workers.dev"
}
```

After Task 1, add non-secret `vars.PASSWORD_SERVICE_URL` to that same object using the exact HTTPS URL emitted by `gcloud run services describe event-roster-password-service`; verify it matches the Task 1 ADR before committing. Never put a secret in `vars`. Set each Worker secret interactively, then remove the bootstrap secret only after successful smoke:

```bash
pnpm --dir apps/worker exec wrangler secret put JWT_SIGNING_KEY
pnpm --dir apps/worker exec wrangler secret put AUTH_KDF_SHARED_SECRET
pnpm --dir apps/worker exec wrangler secret put IP_HASH_KEY
pnpm --dir apps/worker exec wrangler secret put BOOTSTRAP_TOKEN
pnpm --dir apps/worker exec wrangler secret put RECOVERY_CODE_PEPPER
pnpm --dir apps/worker exec wrangler deploy
# Run smoke-remote successfully against the empty production D1 before this final command.
pnpm --dir apps/worker exec wrangler secret delete BOOTSTRAP_TOKEN
```

`smoke-remote.mts` accepts `APP_URL`, `SMOKE_BOOTSTRAP_TOKEN`, `SMOKE_BOOTSTRAP_LOGIN_ID`, `SMOKE_FIRST_OPERATOR_LOGIN_ID`, and interactively supplied replacement passwords for both accounts. It sends exact Origin, stores generated temporary passwords only in process memory, completes bootstrap → initial password change/logout → FULL bootstrap login → first-individual creation → individual initial password change/logout, verifies shared bootstrap login now fails, checks cookie flags and SPA deep link, prints only status/request IDs, and prints the one-time recovery code once for offline recording. It refuses to run if bootstrap returns non-201 or the first-operator route does not return 201.

`docs/operations/recovery.md` requires a data export before bulk import and immediately after event close; forbids direct D1 edits; documents single-use recovery code operation; documents that replacing `PASSWORD_PEPPER` invalidates prior credential verification and requires global password reset via recovery; and states that Cloud Run is public at network level but accepts only Worker HMAC, whose timestamp check is not a replay-proof network boundary. It also requires a GCP Budget alert and Cloud Run `max-instances=1`; alerts are not a spending hard cap.

- [ ] **Step 5: Run full verification, production smoke, and commit delivery tooling**

Run: `pnpm test && pnpm check && pnpm format:check && uv --directory apps/password-service run pytest && uv --directory apps/password-service run ruff check src tests scripts`

Expected: PASS.

Run: `pnpm --filter @event-roster/web build && pnpm --filter @event-roster/worker exec wrangler deploy --dry-run --outdir .wrangler/bundle`

Expected: Worker gzip below 3 MiB and static assets below 20,000 files.

After the user authorizes Google Cloud/Cloudflare deployment and has interactively supplied secrets, run `smoke:remote` once against the empty production D1. Verify bootstrap, handoff readiness, login, CSRF, SPA deep link, and authenticated `/auth/me`; then delete `BOOTSTRAP_TOKEN` before ordinary use.

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/worker/scripts apps/worker/package.json apps/worker/wrangler.jsonc apps/worker/worker-configuration.d.ts apps/web/package.json pnpm-lock.yaml .github/workflows/ci.yml docs/operations README.md .gitignore
git commit -m "chore: add delivery verification and runbooks"
```

## Plan self-review checklist

- [x] Cloud Run KDF capability is an explicit factual stop gate; prior Workers PBKDF2 failure is preserved rather than masked.
- [x] Every custom-password path stores only Argon2id PHC in D1, calls the signed Cloud Run service, and has no JWT-only shortcut.
- [x] `login_id`, bootstrap handoff, one-time recovery, session revocation, KDF outage, CSRF, rate limits, and non-enumerating login errors each map to code and tests.
- [x] Event lifecycle, snapshots, organization scope, roster source/status accounting, optimistic conflict handling, audit append-only rules, atomic imports, and two-sheet exports each map to an API and UI task.
- [x] Every state/revision-sensitive D1 mutation uses a false-is-error operation guard, so stale/status failures cannot commit audit, snapshot, roster, import, or recovery side effects.
- [x] Bootstrap handoff has an executable API/UI/E2E path, while recovery-code consumption, one-time-secret cache headers, and append-only test isolation have focused regression coverage.
- [x] Browser Excel stays client-side and tokens/passwords/recovery codes never use persistent browser storage.
- [x] E2E uses local password-service secrets only; CI has no Cloudflare/GCP production credentials; production deployment/configuration names the exact Worker vars, secrets, validation order, and Bootstrap-token deletion point.
- [x] The plan does not include Firebase, Supabase, Cloudflare Access, OTP, public signup, refresh tokens, original Excel retention, check-in, real-time editing, VM hosting, Pages, or cross-origin browser cookies.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-20-event-roster-cloud-run-auth-mvp.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
