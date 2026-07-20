# Event Roster MVP Implementation Plan

> **상태: 폐기됨.** 이 계획은 FastAPI Python Worker 전제를 사용하며, Workers Free 번들 한도 검증에 실패했다. 실행하지 말고 [Worker 기반 설계](../specs/2026-07-20-event-roster-worker-design.md)에서 새 계획을 작성한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상반기·하반기 행사마다 사전 명단, 당일 변동, 조직별 집계, 감사 이력, 엑셀 이관·내보내기를 안전하게 운영하는 내부 서비스를 만든다.

**Architecture:** apps/web은 Cloudflare Pages에 정적 배포하는 React SPA이고, apps/api는 Cloudflare Python Worker의 ASGI 어댑터에서 실행되는 FastAPI 모듈형 모놀리스다. 라우터는 HTTP DTO 변환만 하고 application 서비스가 권한·상태·트랜잭션 경계를 맡으며 domain은 순수 규칙, infrastructure는 D1·쿠키·JWT·Worker 환경 접근을 담당한다. D1은 업무 데이터를 저장하지만 원본 엑셀 파일과 셀 원문은 저장하지 않는다.

**Tech Stack:** pnpm 11, Node.js 24.7+, React 19, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, SheetJS xlsx, Vitest, React Testing Library, MSW, Playwright, Python 3.13+, uv, FastAPI, Pydantic, PyJWT HS256, argon2-cffi Argon2id, Cloudflare Python Workers, D1, Wrangler/Pywrangler.

## Global Constraints

- 승인 설계의 기준 문서는 docs/superpowers/specs/2026-07-20-event-roster-design.md 이며, 이 계획은 그 MVP 범위를 바꾸지 않는다.
- 모노레포 패키지 관리자는 pnpm@11.9.0, API 의존성 관리는 uv이며, 호스트의 Python 3.9가 아니라 uv가 만든 Python >=3.13 환경만 사용한다.
- Python Worker는 beta이므로 apps/api/wrangler.toml에 compatibility_flags = ["python_workers"]를 유지하고 FastAPI는 WorkerEntrypoint와 asgi.fetch 경계에서만 Worker API를 만난다.
- Cloudflare Free 한도(요청당 CPU 10ms, 메모리 128MB)를 실제 배포 Worker에서 검증한다. KDF 비용을 낮추거나 원자성을 포기해서 통과시키지 않는다.
- JWT는 HttpOnly, Secure, SameSite=Lax, Path=/ 쿠키에만 넣고 localStorage, sessionStorage, 감사 로그, 애플리케이션 로그, 엑셀에는 절대 저장하지 않는다.
- 웹과 API는 app.<사용자 도메인> 및 api.<사용자 도메인>처럼 같은 registrable domain 아래에 배치한다. Pages 기본 도메인과 workers.dev 조합으로 교차 사이트 쿠키 인증을 만들지 않는다.
- 모든 상태 변경 요청은 정확히 일치하는 Origin, credentials: include, X-CSRF-Token, er_csrf 쿠키, JWT csrf claim 일치를 요구한다.
- 공개 가입, 셀프 비밀번호 복구, 이메일 전송, 체크인, 원본 엑셀 보관, 양방향 엑셀 동기화, 실시간 공동 편집은 만들지 않는다.
- 행사별 참가자 행은 (event_id, participant_id) 하나만 유지한다. 취소는 CANCELLED 상태로 보존하고 재참여는 기존 행을 ACTIVE로 되돌린다.
- 행사 상태는 DRAFT -> PRE_REGISTRATION -> DAY_OF -> CLOSED만 허용하며 CLOSED에서 운영자만 DAY_OF로 재오픈한다. PRE_REGISTRATION으로 되돌리는 전이는 없다.
- 목록과 테이블은 최대 130행을 전체 로드해 필터링한다. 페이지네이션과 가상 스크롤을 만들지 않는다.
- D1 복합 쓰기는 한 번의 db.batch([...])로 수행한다. 문 단위 bind 값 100개 제한은 문 단위 분할로만 해결하고 모든 문은 한 batch 호출에 넣는다.
- CSS 색상·간격·라운드·그림자·활성 상태는 --er-* 토큰으로 정의한다. coursemos-supporter의 디자인 원칙은 참고하되 컴포넌트와 CSS를 복사하지 않는다.
- 모든 커밋 전에 해당 작업의 테스트, 타입 검사, 포맷 또는 정적 검사를 통과시킨다.

---

## Scope and delivery order

인증·행사·명단·엑셀은 동일한 참가자/행사 데이터 경계와 권한 모델을 공유하므로 하나의 MVP로 검증한다. 다만 Python Worker의 보안 해싱·JWT·D1 원자성이 무료 한도에서 성립하는지를 첫 번째 작업으로 분리한다. 그 게이트가 실패하면 두 번째 작업 이후를 시작하지 않고 FastAPI Python Worker와 자체 계정 조합을 유지할지 사용자와 다시 결정한다.

## Canonical contracts

이 절은 뒤 작업이 같은 이름과 타입을 사용하도록 고정한다. 모든 식별자는 UUID 문자열이고 모든 시각은 UTC ISO-8601 문자열이다.

    Role = "OPERATOR" | "ORGANIZATION_MANAGER"
    EventStatus = "DRAFT" | "PRE_REGISTRATION" | "DAY_OF" | "CLOSED"
    Half = "H1" | "H2"
    RosterSource = "PRE_EVENT" | "DAY_OF"
    RosterStatus = "ACTIVE" | "CANCELLED"

    Actor = {
      id: str,
      role: Role,
      organization_ids: frozenset[str],
      session_id: str,
      session_version: int,
      csrf: str
    }

    RosterEntry = {
      id: str,
      event_id: str,
      participant_id: str,
      participant_number: str,
      snapshot_name: str,
      snapshot_organization_id: str,
      snapshot_organization_name: str,
      source: RosterSource,
      status: RosterStatus,
      revision: int,
      updated_at: str,
      updated_by: str
    }

    ApiProblem = {
      code: str,
      message: str,
      request_id: str,
      details: dict[str, object] | None
    }

HTTP API는 /api/v1 접두사를 쓴다. 성공 응답은 각 DTO를 직접 반환하고 실패 응답은 ApiProblem 형식이다. 명단 충돌은 HTTP 409, code = "STALE_REVISION", details.latestEntry, details.changedBy, details.changedAt을 반환한다.

| API | Request | Success result |
| --- | --- | --- |
| POST /auth/login | email, password | CurrentUser, csrfToken 및 쿠키 |
| POST /auth/logout | 없음 | 204 및 세션 폐기 |
| GET /auth/me, GET /auth/csrf | 없음 | CurrentUser 또는 csrfToken |
| GET, POST, PATCH /organizations | Organization DTO | Organization 또는 Organization[] |
| GET, POST, PATCH /users | User DTO | User 또는 User[] |
| POST /users/{id}/password-reset | newPassword | 204 및 세션 폐기 |
| GET, POST, PATCH /participants | 검색·Participant DTO | Participant 또는 Participant[] |
| GET, POST /events | scope 또는 EventCreate | Event 또는 Event[] |
| GET, PATCH /events/{id} | EventUpdate | EventDetail |
| POST /events/{id}/transition | targetStatus | EventDetail |
| GET /events/{id}/summary | 없음 | EventSummary |
| GET, POST /events/{id}/roster | 필터 또는 participantId | RosterList 또는 RosterEntry |
| PATCH /events/{id}/roster/{entryId} | revision, name, organizationId, status | RosterEntry |
| GET /events/{id}/audit-logs | entryId, cursor | AuditLogPage |
| POST /events/{id}/imports/validate | ImportRowInput[] | ImportValidationResult |
| POST /events/{id}/imports/commit | ResolvedImportRow[] | ImportCommitResult |
| GET /events/{id}/export-data | 없음 | EventExportData |

## File structure

    event-roster/
    ├── package.json, pnpm-workspace.yaml, .nvmrc
    ├── docs/
    │   ├── adr/0001-python-worker-capability.md
    │   └── operations/deployment.md
    ├── spikes/python-worker-capability/
    │   ├── entry.py, pyproject.toml, wrangler.toml
    │   └── tests/test_probe_result.py
    ├── apps/
    │   ├── api/
    │   │   ├── entry.py, pyproject.toml, wrangler.toml, migrations/0001_initial_schema.sql
    │   │   ├── scripts/export_openapi.py
    │   │   ├── app/
    │   │   │   ├── main.py, settings.py
    │   │   │   ├── api/deps.py, api/errors.py, api/middleware.py, api/schemas/, api/routers/
    │   │   │   ├── application/auth.py, accounts.py, events.py, roster.py, imports.py, reports.py
    │   │   │   ├── domain/enums.py, models.py, errors.py, policies.py, event_lifecycle.py, aggregation.py
    │   │   │   └── infrastructure/worker_env.py, d1/, security/
    │   │   └── tests/unit/, tests/integration/, tests/runtime/
    │   └── web/
    │       ├── package.json, vite.config.ts, vitest.config.ts, playwright.config.ts, public/_redirects
    │       ├── src/app/, src/components/ui/, src/features/, src/lib/api/, src/styles/, src/test/
    │       └── e2e/
    ├── packages/contracts/
    │   ├── package.json, scripts/generate.mjs, src/schema.d.ts
    └── .github/workflows/ci.yml

### Task 1: Prove the Python Worker security and D1 capability gate

**Files:**
- Create: spikes/python-worker-capability/pyproject.toml
- Create: spikes/python-worker-capability/wrangler.toml
- Create: spikes/python-worker-capability/entry.py
- Create: spikes/python-worker-capability/probe_result.py
- Create: spikes/python-worker-capability/tests/test_probe_result.py
- Create: docs/adr/0001-python-worker-capability.md

**Interfaces:**
- Produces: GET /probe -> { fastapi: true, d1: true }.
- Produces: POST /probe/auth -> { passwordVerified: bool, jwtVerified: bool, rollbackVerified: bool, rows: int, computeMs: float }.
- Produces: validate_probe_result(payload: Mapping[str, object]) -> None.
- Gate: all booleans true, rows 130, computeMs < 10, and deployment bundle succeeds. A failure stops the plan after this task.

- [ ] **Step 1: Write the failing probe-result contract test**

    # spikes/python-worker-capability/tests/test_probe_result.py
    import pytest

    from probe_result import ProbeResultError, validate_probe_result


    def test_accepts_complete_free_tier_probe_result() -> None:
        validate_probe_result(
            {
                "passwordVerified": True,
                "jwtVerified": True,
                "rollbackVerified": True,
                "rows": 130,
                "computeMs": 9.9,
            }
        )


    @pytest.mark.parametrize(
        "payload",
        [
            {"passwordVerified": False, "jwtVerified": True, "rollbackVerified": True, "rows": 130, "computeMs": 1.0},
            {"passwordVerified": True, "jwtVerified": False, "rollbackVerified": True, "rows": 130, "computeMs": 1.0},
            {"passwordVerified": True, "jwtVerified": True, "rollbackVerified": False, "rows": 130, "computeMs": 1.0},
            {"passwordVerified": True, "jwtVerified": True, "rollbackVerified": True, "rows": 129, "computeMs": 1.0},
            {"passwordVerified": True, "jwtVerified": True, "rollbackVerified": True, "rows": 130, "computeMs": 10.0},
        ],
    )
    def test_rejects_incomplete_or_over_budget_result(payload: dict[str, object]) -> None:
        with pytest.raises(ProbeResultError):
            validate_probe_result(payload)

- [ ] **Step 2: Run the test and confirm that it fails**

    Run: cd spikes/python-worker-capability && uv run pytest tests/test_probe_result.py -q
    Expected: FAIL with ModuleNotFoundError: No module named 'probe_result'.

- [ ] **Step 3: Implement the probe, strict verifier, and isolated Worker configuration**

    # spikes/python-worker-capability/pyproject.toml
    [project]
    name = "event-roster-python-worker-capability"
    version = "0.1.0"
    requires-python = ">=3.13"
    dependencies = [
      "argon2-cffi>=23.1,<24",
      "fastapi>=0.115,<1",
      "PyJWT>=2.10,<3",
    ]

    [dependency-groups]
    dev = [
      "pytest>=8.3,<9",
      "workers-py",
      "workers-runtime-sdk",
    ]

    # spikes/python-worker-capability/probe_result.py
    from collections.abc import Mapping


    class ProbeResultError(ValueError):
        pass


    def validate_probe_result(payload: Mapping[str, object]) -> None:
        required_booleans = ("passwordVerified", "jwtVerified", "rollbackVerified")
        if any(payload.get(name) is not True for name in required_booleans):
            raise ProbeResultError("security capability was not verified")
        if payload.get("rows") != 130:
            raise ProbeResultError("130-row D1 batch was not verified")
        compute_ms = payload.get("computeMs")
        if not isinstance(compute_ms, (int, float)) or compute_ms >= 10:
            raise ProbeResultError("Worker CPU budget was not verified")

    # spikes/python-worker-capability/wrangler.toml
    name = "event-roster-python-capability"
    main = "entry.py"
    compatibility_date = "2026-07-20"
    compatibility_flags = ["python_workers"]

    [[d1_databases]]
    binding = "DB"
    database_name = "event-roster-capability"
    database_id = "the UUID printed by: uv run pywrangler d1 create event-roster-capability"

    # spikes/python-worker-capability/entry.py
    from time import perf_counter

    import asgi
    import jwt
    from argon2 import PasswordHasher
    from fastapi import FastAPI, HTTPException, Request
    from workers import WorkerEntrypoint

    app = FastAPI()
    hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)


    @app.get("/probe")
    async def probe(request: Request) -> dict[str, bool]:
        env = request.scope["env"]
        await env.DB.prepare("SELECT 1 AS ok").first()
        return {"fastapi": True, "d1": True}


    @app.post("/probe/auth")
    async def probe_auth(request: Request) -> dict[str, bool | int | float]:
        env = request.scope["env"]
        if request.headers.get("X-Probe-Secret") != env.PROBE_SECRET:
            raise HTTPException(status_code=404)
        started = perf_counter()
        encoded_hash = hasher.hash("probe-password-that-is-not-a-user-password")
        password_verified = hasher.verify(encoded_hash, "probe-password-that-is-not-a-user-password")
        token = jwt.encode(
            {"sub": "probe-user", "sid": "probe-session", "sv": 1, "iss": "event-roster", "aud": "event-roster-api"},
            env.JWT_SECRET,
            algorithm="HS256",
        )
        claims = jwt.decode(token, env.JWT_SECRET, algorithms=["HS256"], issuer="event-roster", audience="event-roster-api")
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS probe_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL CHECK(value != 'FAIL'))").run()
        await env.DB.prepare("DELETE FROM probe_rows").run()
        inserts = [env.DB.prepare("INSERT INTO probe_rows (id, value) VALUES (?, ?)").bind(index, "OK") for index in range(1, 131)]
        await env.DB.batch(inserts)
        try:
            await env.DB.batch(
                [
                    env.DB.prepare("INSERT INTO probe_rows (id, value) VALUES (?, ?)").bind(1001, "OK"),
                    env.DB.prepare("INSERT INTO probe_rows (id, value) VALUES (?, ?)").bind(1002, "FAIL"),
                ]
            )
        except Exception:
            pass
        rollback_row = await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_rows WHERE id IN (?, ?)").bind(1001, 1002).first()
        count_row = await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_rows WHERE value = ?").bind("OK").first()
        return {
            "passwordVerified": bool(password_verified),
            "jwtVerified": claims["sub"] == "probe-user",
            "rollbackVerified": rollback_row["count"] == 0,
            "rows": int(count_row["count"]),
            "computeMs": round((perf_counter() - started) * 1000, 3),
        }


    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request, self.env)

    Copy the UUID printed by the database creation command into the probe configuration. It is account deployment state, not a source-code default. Do not commit JWT_SECRET or PROBE_SECRET.

- [ ] **Step 4: Run local and real deployment verification**

    Run: cd spikes/python-worker-capability && uv lock && uv run pytest tests/test_probe_result.py -q
    Expected: 6 passed.

    Run: cd spikes/python-worker-capability && uv run pywrangler d1 create event-roster-capability
    Expected: Cloudflare prints a database_id used once in wrangler.toml.

    Run: cd spikes/python-worker-capability && uv run pywrangler secret put JWT_SECRET && uv run pywrangler secret put PROBE_SECRET && uv run pywrangler deploy
    Expected: a deployed Worker URL and no package-bundling error.

    Run: curl -fsS -X POST https://<deployed-capability-worker>/probe/auth -H "X-Probe-Secret: <the secret just entered>"
    Expected: JSON accepted by validate_probe_result: all booleans true, rows 130, computeMs below 10.

    Record package versions, deployment URL, measurement, and pass/fail evidence in docs/adr/0001-python-worker-capability.md. If the result fails, commit only the ADR evidence and stop. Ask the user to choose a different hosting/authentication architecture.

- [ ] **Step 5: Commit the passing capability evidence**

    git add spikes/python-worker-capability docs/adr/0001-python-worker-capability.md
    git commit -m "chore: verify Python Worker capability"

### Task 2: Bootstrap the monorepo and verify both runtime shells

**Files:**
- Create: .nvmrc
- Create: package.json
- Create: pnpm-workspace.yaml
- Create: apps/api/pyproject.toml
- Create: apps/api/wrangler.toml
- Create: apps/api/entry.py
- Create: apps/api/app/__init__.py
- Create: apps/api/app/main.py
- Create: apps/api/tests/unit/test_health.py
- Create: apps/web/package.json
- Create: apps/web/vite.config.ts
- Create: apps/web/vitest.config.ts
- Create: apps/web/index.html
- Create: apps/web/public/_redirects
- Create: apps/web/src/main.tsx
- Create: apps/web/src/app/App.tsx
- Create: apps/web/src/app/App.test.tsx
- Create: apps/web/src/test/setup.ts
- Modify: .gitignore

**Interfaces:**
- Produces: FastAPI app at app.main.app with GET /health -> { "status": "ok" }.
- Produces: Default.fetch(request) -> await asgi.fetch(app, request, self.env).
- Produces: React mount element #root and a testable App component.
- Consumes: a passing Task 1 capability report.

- [ ] **Step 1: Write failing health and React shell tests**

    # apps/api/tests/unit/test_health.py
    from fastapi.testclient import TestClient

    from app.main import app


    def test_health_returns_ok() -> None:
        response = TestClient(app).get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    // apps/web/src/app/App.test.tsx
    import { render, screen } from "@testing-library/react";
    import { App } from "./App";

    test("renders the service name", () => {
      render(<App />);
      expect(screen.getByRole("heading", { name: "행사 참가자 관리" })).toBeInTheDocument();
    });

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/unit/test_health.py -q
    Expected: FAIL with ModuleNotFoundError: No module named 'app'.

    Run: pnpm --dir apps/web test --run src/app/App.test.tsx
    Expected: FAIL because apps/web/package.json does not exist.

- [ ] **Step 3: Implement the smallest runnable workspace**

    # .nvmrc
    24.7.0

    # pnpm-workspace.yaml
    packages:
      - apps/*
      - packages/*

    # package.json
    {
      "name": "event-roster",
      "private": true,
      "packageManager": "pnpm@11.9.0",
      "engines": {
        "node": ">=24.7.0",
        "pnpm": ">=11.9.0"
      },
      "scripts": {
        "check": "pnpm -r check && cd apps/api && uv run pytest",
        "dev:web": "pnpm --filter @event-roster/web dev",
        "dev:api": "cd apps/api && uv run pywrangler dev",
        "test:web": "pnpm --filter @event-roster/web test --run",
        "test:api": "cd apps/api && uv run pytest"
      }
    }

    # apps/api/pyproject.toml
    [project]
    name = "event-roster-api"
    version = "0.1.0"
    requires-python = ">=3.13"
    dependencies = [
      "argon2-cffi>=23.1,<24",
      "email-validator>=2.2,<3",
      "fastapi>=0.115,<1",
      "PyJWT>=2.10,<3",
      "pydantic>=2.9,<3",
    ]

    [dependency-groups]
    dev = [
      "httpx>=0.27,<1",
      "pytest>=8.3,<9",
      "workers-py",
      "workers-runtime-sdk",
    ]

    [tool.pytest.ini_options]
    pythonpath = ["."]
    testpaths = ["tests"]

    # apps/api/wrangler.toml
    name = "event-roster-api"
    main = "entry.py"
    compatibility_date = "2026-07-20"
    compatibility_flags = ["python_workers"]

    [[d1_databases]]
    binding = "DB"
    database_name = "event-roster-db"
    database_id = "the UUID printed by: uv run pywrangler d1 create event-roster-db"

    # apps/api/app/main.py
    from fastapi import FastAPI

    app = FastAPI(title="Event Roster API", version="0.1.0")


    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # apps/api/entry.py
    import asgi
    from workers import WorkerEntrypoint

    from app.main import app


    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request, self.env)

    # apps/web/package.json
    {
      "name": "@event-roster/web",
      "private": true,
      "version": "0.1.0",
      "type": "module",
      "scripts": {
        "dev": "vite",
        "build": "tsc -b && vite build",
        "check": "tsc -b",
        "test": "vitest"
      },
      "dependencies": {
        "@tanstack/react-query": "^5.66.0",
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "react-hook-form": "^7.54.0",
        "react-router-dom": "^7.1.0",
        "xlsx": "^0.18.5",
        "zod": "^3.24.0"
      },
      "devDependencies": {
        "@testing-library/jest-dom": "^6.6.0",
        "@testing-library/react": "^16.2.0",
        "@testing-library/user-event": "^14.6.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.4.0",
      "jsdom": "^26.0.0",
      "msw": "^2.7.0",
      "typescript": "^5.7.0",
        "vite": "^6.0.0",
        "vitest": "^3.0.0"
      }
    }

    // apps/web/src/app/App.tsx
    export function App() {
      return <h1>행사 참가자 관리</h1>;
    }

    // apps/web/src/main.tsx
    import { StrictMode } from "react";
    import { createRoot } from "react-dom/client";
    import { App } from "./app/App";

    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    # apps/web/public/_redirects
    /* /index.html 200

    Create vitest.config.ts with jsdom environment and src/test/setup.ts importing @testing-library/jest-dom/vitest. Add node_modules, apps/web/dist, apps/api/.venv, .wrangler, and .dev.vars to .gitignore. Copy the Cloudflare-created production D1 UUID into apps/api/wrangler.toml without placing secrets in source control.

- [ ] **Step 4: Run the runtime checks**

    Run: pnpm install --frozen-lockfile=false && cd apps/api && uv lock && uv run pytest tests/unit/test_health.py -q
    Expected: 1 passed.

    Run: pnpm --dir apps/web test --run src/app/App.test.tsx && pnpm --dir apps/web build
    Expected: 1 passed and Vite reports a successful production build.

    Run: cd apps/api && uv run pywrangler dev
    Expected: the local Worker starts and GET /health returns {"status":"ok"}.

- [ ] **Step 5: Commit the baseline**

    git add .nvmrc package.json pnpm-workspace.yaml pnpm-lock.yaml .gitignore apps/api apps/web
    git commit -m "chore: bootstrap event roster monorepo"

### Task 3: Create the D1 schema and typed infrastructure boundary

**Files:**
- Create: apps/api/migrations/0001_initial_schema.sql
- Create: apps/api/app/infrastructure/worker_env.py
- Create: apps/api/app/infrastructure/d1/gateway.py
- Create: apps/api/tests/integration/test_schema.py
- Create: apps/api/tests/integration/test_gateway_contract.py

**Interfaces:**
- Produces: get_db(request: Request) -> object, returning request.scope["env"].DB and never a global Worker environment.
- Produces: D1Gateway.batch(statements: Sequence[object]) -> list[object].
- Produces: D1Gateway.first(sql: str, params: Sequence[object]) -> Mapping[str, object] | None.
- Produces: all tables named in the File structure data layer.

- [ ] **Step 1: Write failing schema invariants**

    # apps/api/tests/integration/test_schema.py
    import sqlite3
    from pathlib import Path

    import pytest

    SCHEMA = Path("migrations/0001_initial_schema.sql").read_text()


    def database() -> sqlite3.Connection:
        connection = sqlite3.connect(":memory:")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA)
        return connection


    def test_rejects_two_events_for_one_year_and_half() -> None:
        connection = database()
        connection.execute(
            "INSERT INTO events (id, title, year, half, event_date, status, status_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("event-1", "2026 상반기 행사", 2026, "H1", "2026-06-01", "DRAFT", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO events (id, title, year, half, event_date, status, status_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("event-2", "중복", 2026, "H1", "2026-06-02", "DRAFT", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
            )


    def test_preserves_one_roster_row_per_participant_per_event() -> None:
        connection = database()
        connection.executescript(
            "INSERT INTO organizations VALUES ('org-1', '개발팀', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
            "INSERT INTO users VALUES ('user-1', 'operator@example.test', '운영자', 'OPERATOR', 'hash', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
            "INSERT INTO participants VALUES ('person-1', 'P-000000000001', '홍길동', '홍길동', 'org-1', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
            "INSERT INTO events VALUES ('event-1', '행사', 2026, 'H1', '2026-06-01', NULL, 'PRE_REGISTRATION', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
            "INSERT INTO event_roster_entries VALUES ('entry-1', 'event-1', 'person-1', '홍길동', 'org-1', '개발팀', 'PRE_EVENT', 'ACTIVE', 1, 'user-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO event_roster_entries VALUES ('entry-2', 'event-1', 'person-1', '홍길동', 'org-1', '개발팀', 'PRE_EVENT', 'ACTIVE', 1, 'user-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
            )

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/integration/test_schema.py -q
    Expected: FAIL with FileNotFoundError for migrations/0001_initial_schema.sql.

- [ ] **Step 3: Implement the complete schema and narrow D1 access helper**

    # apps/api/migrations/0001_initial_schema.sql
    PRAGMA foreign_keys = ON;

    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'ORGANIZATION_MANAGER')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE user_organizations (
      user_id TEXT NOT NULL REFERENCES users(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, organization_id)
    );

    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      session_version INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX auth_sessions_active_by_user ON auth_sessions(user_id, revoked_at, expires_at);

    CREATE TABLE login_rate_limits (
      key_kind TEXT NOT NULL CHECK (key_kind IN ('IP', 'EMAIL')),
      key_hash TEXT NOT NULL,
      window_started_at TEXT NOT NULL,
      failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
      blocked_until TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (key_kind, key_hash)
    );

    CREATE TABLE security_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      event_type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE participants (
      id TEXT PRIMARY KEY,
      participant_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX participants_search ON participants(organization_id, normalized_name, is_active);

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
      half TEXT NOT NULL CHECK (half IN ('H1', 'H2')),
      event_date TEXT NOT NULL,
      venue TEXT,
      status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PRE_REGISTRATION', 'DAY_OF', 'CLOSED')),
      status_changed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (year, half)
    );

    CREATE TABLE event_roster_entries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      snapshot_name TEXT NOT NULL,
      snapshot_organization_id TEXT NOT NULL REFERENCES organizations(id),
      snapshot_organization_name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('PRE_EVENT', 'DAY_OF')),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (event_id, participant_id)
    );
    CREATE INDEX roster_by_event_filter ON event_roster_entries(event_id, snapshot_organization_id, status, snapshot_name);

    CREATE TABLE event_expected_snapshots (
      event_id TEXT NOT NULL REFERENCES events(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      organization_name TEXT NOT NULL,
      expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
      captured_at TEXT NOT NULL,
      PRIMARY KEY (event_id, organization_id)
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      roster_entry_id TEXT REFERENCES event_roster_entries(id),
      organization_id TEXT REFERENCES organizations(id),
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX audit_logs_event_organization_time ON audit_logs(event_id, organization_id, created_at DESC);

    CREATE TABLE import_runs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      actor_id TEXT NOT NULL REFERENCES users(id),
      total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
      created_count INTEGER NOT NULL CHECK (created_count >= 0),
      reactivated_count INTEGER NOT NULL CHECK (reactivated_count >= 0),
      error_count INTEGER NOT NULL CHECK (error_count = 0),
      committed_at TEXT NOT NULL
    );

    # apps/api/app/infrastructure/worker_env.py
    from fastapi import Request


    def get_db(request: Request):
        return request.scope["env"].DB

    # apps/api/app/infrastructure/d1/gateway.py
    from collections.abc import Mapping, Sequence
    from typing import Any


    class D1Gateway:
        def __init__(self, db: Any) -> None:
            self._db = db

        async def first(self, sql: str, params: Sequence[object] = ()) -> Mapping[str, object] | None:
            return await self._db.prepare(sql).bind(*params).first()

        async def batch(self, statements: Sequence[object]) -> list[object]:
            return list(await self._db.batch(list(statements)))

    # apps/api/tests/integration/test_gateway_contract.py
    import inspect

    from app.infrastructure.d1.gateway import D1Gateway


    def test_gateway_exposes_one_async_batch_boundary() -> None:
        assert inspect.iscoroutinefunction(D1Gateway.first)
        assert inspect.iscoroutinefunction(D1Gateway.batch)

- [ ] **Step 4: Run schema and gateway tests**

    Run: cd apps/api && uv run pytest tests/integration/test_schema.py -q
    Expected: schema invariant tests pass.

    Run: cd apps/api && uv run pywrangler d1 migrations apply event-roster-db --local
    Expected: migration 0001_initial_schema.sql applied to local D1.

- [ ] **Step 5: Commit the persistent data boundary**

    git add apps/api/migrations apps/api/app/infrastructure apps/api/tests/integration
    git commit -m "feat: add D1 roster schema"

### Task 4: Encode pure lifecycle, authorization, and aggregation rules

**Files:**
- Create: apps/api/app/domain/enums.py
- Create: apps/api/app/domain/models.py
- Create: apps/api/app/domain/errors.py
- Create: apps/api/app/domain/policies.py
- Create: apps/api/app/domain/event_lifecycle.py
- Create: apps/api/app/domain/aggregation.py
- Create: apps/api/tests/unit/domain/test_event_lifecycle.py
- Create: apps/api/tests/unit/domain/test_policies.py
- Create: apps/api/tests/unit/domain/test_aggregation.py

**Interfaces:**
- Produces: require_operator(actor: Actor) -> None, require_organization_access(actor: Actor, organization_id: str) -> None, and ensure_event_is_mutable(event: Event) -> None.
- Produces: transition_event(event: Event, target: EventStatus, now: datetime) -> EventStatus.
- Produces: expected_count(status, entries, snapshots, organization_id) -> int and calculate_summary(status, entries, snapshots) -> EventSummary.
- Produces: DomainError subclasses Forbidden, InvalidTransition, ClosedEvent, StaleRevision.

- [ ] **Step 1: Write failing lifecycle and authorization tests**

    # apps/api/tests/unit/domain/test_event_lifecycle.py
    from datetime import datetime, timezone

    import pytest

    from app.domain.enums import EventStatus
    from app.domain.errors import InvalidTransition
    from app.domain.event_lifecycle import transition_event
    from app.domain.models import Event


    def event(status: EventStatus) -> Event:
        return Event("event-1", "행사", 2026, "H1", "2026-06-01", None, status, "2026-01-01T00:00:00Z")


    def test_allows_only_forward_lifecycle_and_reopen() -> None:
        now = datetime(2026, 6, 1, tzinfo=timezone.utc)
        assert transition_event(event(EventStatus.DRAFT), EventStatus.PRE_REGISTRATION, now) is EventStatus.PRE_REGISTRATION
        assert transition_event(event(EventStatus.PRE_REGISTRATION), EventStatus.DAY_OF, now) is EventStatus.DAY_OF
        assert transition_event(event(EventStatus.DAY_OF), EventStatus.CLOSED, now) is EventStatus.CLOSED
        assert transition_event(event(EventStatus.CLOSED), EventStatus.DAY_OF, now) is EventStatus.DAY_OF


    def test_rejects_return_to_pre_registration() -> None:
        with pytest.raises(InvalidTransition):
            transition_event(event(EventStatus.DAY_OF), EventStatus.PRE_REGISTRATION, datetime.now(timezone.utc))

    # apps/api/tests/unit/domain/test_policies.py
    import pytest

    from app.domain.enums import Role
    from app.domain.errors import Forbidden
    from app.domain.models import Actor
    from app.domain.policies import require_organization_access, require_operator


    def test_organization_manager_cannot_cross_boundary() -> None:
        actor = Actor("user-1", Role.ORGANIZATION_MANAGER, frozenset({"org-1"}), "session-1", 1, "csrf")
        with pytest.raises(Forbidden):
            require_organization_access(actor, "org-2")
        with pytest.raises(Forbidden):
            require_operator(actor)

    # apps/api/tests/unit/domain/test_aggregation.py
    from app.domain.aggregation import calculate_summary
    from app.domain.enums import EventStatus, RosterSource, RosterStatus
    from app.domain.models import ExpectedSnapshot, RosterEntry


    def test_day_of_uses_snapshot_expected_and_active_final() -> None:
        entries = [
            RosterEntry("r1", "e1", "p1", "org-1", RosterSource.PRE_EVENT, RosterStatus.CANCELLED),
            RosterEntry("r2", "e1", "p2", "org-1", RosterSource.DAY_OF, RosterStatus.ACTIVE),
        ]
        snapshots = [ExpectedSnapshot("e1", "org-1", 1)]
        assert calculate_summary(EventStatus.DAY_OF, entries, snapshots).expected_total == 1
        assert calculate_summary(EventStatus.DAY_OF, entries, snapshots).final_total == 1

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/unit/domain -q
    Expected: FAIL with ModuleNotFoundError: No module named 'app.domain.enums'.

- [ ] **Step 3: Implement pure domain objects and functions**

    # apps/api/app/domain/enums.py
    from enum import StrEnum


    class Role(StrEnum):
        OPERATOR = "OPERATOR"
        ORGANIZATION_MANAGER = "ORGANIZATION_MANAGER"


    class EventStatus(StrEnum):
        DRAFT = "DRAFT"
        PRE_REGISTRATION = "PRE_REGISTRATION"
        DAY_OF = "DAY_OF"
        CLOSED = "CLOSED"


    class RosterSource(StrEnum):
        PRE_EVENT = "PRE_EVENT"
        DAY_OF = "DAY_OF"


    class RosterStatus(StrEnum):
        ACTIVE = "ACTIVE"
        CANCELLED = "CANCELLED"

    # apps/api/app/domain/models.py
    from dataclasses import dataclass
    from typing import FrozenSet

    from .enums import EventStatus, RosterSource, RosterStatus, Role


    @dataclass(frozen=True)
    class Actor:
        id: str
        role: Role
        organization_ids: FrozenSet[str]
        session_id: str
        session_version: int
        csrf: str


    @dataclass(frozen=True)
    class Event:
        id: str
        title: str
        year: int
        half: str
        event_date: str
        venue: str | None
        status: EventStatus
        status_changed_at: str


    @dataclass(frozen=True)
    class RosterEntry:
        id: str
        event_id: str
        participant_id: str
        snapshot_organization_id: str
        source: RosterSource
        status: RosterStatus


    @dataclass(frozen=True)
    class ExpectedSnapshot:
        event_id: str
        organization_id: str
        expected_count: int


    @dataclass(frozen=True)
    class EventSummary:
        expected_total: int
        final_total: int
        delta_total: int

    # apps/api/app/domain/errors.py
    class DomainError(Exception):
        code = "DOMAIN_ERROR"


    class Forbidden(DomainError):
        code = "FORBIDDEN"


    class InvalidTransition(DomainError):
        code = "INVALID_TRANSITION"


    class ClosedEvent(DomainError):
        code = "EVENT_CLOSED"


    class StaleRevision(DomainError):
        code = "STALE_REVISION"

    # apps/api/app/domain/policies.py
    from .enums import EventStatus, Role
    from .errors import ClosedEvent, Forbidden
    from .models import Actor, Event


    def require_operator(actor: Actor) -> None:
        if actor.role is not Role.OPERATOR:
            raise Forbidden("operator role is required")


    def require_organization_access(actor: Actor, organization_id: str) -> None:
        if actor.role is not Role.OPERATOR and organization_id not in actor.organization_ids:
            raise Forbidden("organization access is denied")


    def ensure_event_is_mutable(event: Event) -> None:
        if event.status is EventStatus.CLOSED:
            raise ClosedEvent("closed event is read-only")

    # apps/api/app/domain/event_lifecycle.py
    from .enums import EventStatus
    from .errors import InvalidTransition
    from .models import Event

    ALLOWED_TRANSITIONS = {
        EventStatus.DRAFT: {EventStatus.PRE_REGISTRATION},
        EventStatus.PRE_REGISTRATION: {EventStatus.DAY_OF},
        EventStatus.DAY_OF: {EventStatus.CLOSED},
        EventStatus.CLOSED: {EventStatus.DAY_OF},
    }


    def transition_event(event: Event, target: EventStatus, now) -> EventStatus:
        if target not in ALLOWED_TRANSITIONS[event.status]:
            raise InvalidTransition(str(event.status) + " cannot become " + str(target))
        return target

    # apps/api/app/domain/aggregation.py
    from .enums import EventStatus, RosterSource, RosterStatus
    from .models import EventSummary


    def expected_count(status, entries, snapshots, organization_id=None) -> int:
        if status is EventStatus.PRE_REGISTRATION:
            return sum(
                entry.status is RosterStatus.ACTIVE
                and entry.source is RosterSource.PRE_EVENT
                and (organization_id is None or entry.snapshot_organization_id == organization_id)
                for entry in entries
            )
        return sum(snapshot.expected_count for snapshot in snapshots if organization_id is None or snapshot.organization_id == organization_id)


    def calculate_summary(status, entries, snapshots) -> EventSummary:
        expected_total = expected_count(status, entries, snapshots)
        final_total = sum(entry.status is RosterStatus.ACTIVE for entry in entries)
        return EventSummary(expected_total, final_total, final_total - expected_total)

- [ ] **Step 4: Run all pure-domain tests**

    Run: cd apps/api && uv run pytest tests/unit/domain -q
    Expected: lifecycle, organization-boundary, snapshot, and total-count tests pass.

- [ ] **Step 5: Commit the domain rules**

    git add apps/api/app/domain apps/api/tests/unit/domain
    git commit -m "feat: add event roster domain rules"

### Task 5: Add session-backed authentication, CSRF, and security logging

**Files:**
- Create: apps/api/app/settings.py
- Create: apps/api/app/infrastructure/security/password.py
- Create: apps/api/app/infrastructure/security/jwt.py
- Create: apps/api/app/infrastructure/security/cookies.py
- Create: apps/api/app/infrastructure/security/csrf.py
- Create: apps/api/app/infrastructure/security/rate_limit.py
- Create: apps/api/app/infrastructure/d1/auth_store.py
- Create: apps/api/app/application/auth.py
- Create: apps/api/app/api/deps.py
- Create: apps/api/app/api/middleware.py
- Create: apps/api/app/api/routers/auth.py
- Create: apps/api/tests/conftest.py
- Create: apps/api/tests/unit/security/test_jwt.py
- Create: apps/api/tests/integration/test_auth_flow.py
- Modify: apps/api/app/main.py

**Interfaces:**
- Produces: hash_password(plain_password: str) -> str and verify_password(plain_password: str, encoded_hash: str) -> bool using Task 1 Argon2id parameters.
- Produces: issue_access_token(actor: Actor, secret: str, now: datetime) -> str and load_access_claims(token: str, secret: str, now: datetime) -> AccessClaims.
- Produces: get_current_actor(request: Request) -> Actor and require_csrf(request: Request, actor: Actor) -> None.
- Produces: POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me, GET /api/v1/auth/csrf, POST /api/v1/internal/bootstrap.
- Consumes: auth_sessions, login_rate_limits, security_events, D1Gateway, Role, Actor.

- [ ] **Step 1: Write failing security and end-to-end auth tests**

    # apps/api/tests/unit/security/test_jwt.py
    from datetime import datetime, timezone

    import jwt
    import pytest

    from app.infrastructure.security.jwt import load_access_claims


    def test_rejects_a_token_with_an_unapproved_algorithm() -> None:
        token = jwt.encode(
            {"sub": "user-1", "sid": "session-1", "sv": 1, "csrf": "csrf", "iat": 1, "exp": 9999999999, "iss": "event-roster", "aud": "event-roster-api"},
            key="",
            algorithm="none",
        )
        with pytest.raises(Exception):
            load_access_claims(token, "secret", datetime.now(timezone.utc))

    # apps/api/tests/integration/test_auth_flow.py
    def test_logout_revokes_the_cookie_session(client, seeded_operator) -> None:
        login = client.post("/api/v1/auth/login", json={"email": seeded_operator.email, "password": seeded_operator.password})
        assert login.status_code == 200
        assert login.cookies.get("er_session")
        csrf = login.json()["csrfToken"]
        logout = client.post("/api/v1/auth/logout", headers={"Origin": "https://app.example.test", "X-CSRF-Token": csrf})
        assert logout.status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401


    def test_rejects_cross_origin_state_change(client, seeded_operator) -> None:
        login = client.post("/api/v1/auth/login", json={"email": seeded_operator.email, "password": seeded_operator.password})
        response = client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://attacker.example", "X-CSRF-Token": login.json()["csrfToken"]},
        )
        assert response.status_code == 403

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/unit/security/test_jwt.py tests/integration/test_auth_flow.py -q
    Expected: FAIL because security modules and auth routes do not exist.

- [ ] **Step 3: Implement token, cookie, session, rate-limit, and route behavior**

    # apps/api/app/infrastructure/security/password.py
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError

    hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)


    def hash_password(plain_password: str) -> str:
        return hasher.hash(plain_password)


    def verify_password(plain_password: str, encoded_hash: str) -> bool:
        try:
            return hasher.verify(encoded_hash, plain_password)
        except VerifyMismatchError:
            return False

    # apps/api/app/infrastructure/security/jwt.py
    from dataclasses import dataclass
    from datetime import datetime, timedelta

    import jwt

    ISSUER = "event-roster"
    AUDIENCE = "event-roster-api"
    ACCESS_TTL = timedelta(minutes=30)


    @dataclass(frozen=True)
    class AccessClaims:
        user_id: str
        session_id: str
        session_version: int
        csrf: str


    def issue_access_token(actor, secret: str, now: datetime) -> str:
        return jwt.encode(
            {
                "sub": actor.id,
                "sid": actor.session_id,
                "sv": actor.session_version,
                "csrf": actor.csrf,
                "iat": now,
                "exp": now + ACCESS_TTL,
                "iss": ISSUER,
                "aud": AUDIENCE,
            },
            secret,
            algorithm="HS256",
        )


    def load_access_claims(token: str, secret: str, now: datetime) -> AccessClaims:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["sub", "sid", "sv", "csrf", "iat", "exp", "iss", "aud"]},
            current_time=now,
        )
        return AccessClaims(str(claims["sub"]), str(claims["sid"]), int(claims["sv"]), str(claims["csrf"]))

    # apps/api/app/infrastructure/security/cookies.py
    from fastapi import Response


    def set_auth_cookies(response: Response, token: str, csrf: str, secure: bool) -> None:
        response.set_cookie("er_session", token, httponly=True, secure=secure, samesite="lax", path="/", max_age=1800)
        response.set_cookie("er_csrf", csrf, httponly=False, secure=secure, samesite="lax", path="/", max_age=1800)


    def clear_auth_cookies(response: Response, secure: bool) -> None:
        response.delete_cookie("er_session", path="/", secure=secure, httponly=True, samesite="lax")
        response.delete_cookie("er_csrf", path="/", secure=secure, httponly=False, samesite="lax")

    # apps/api/app/settings.py
    from dataclasses import dataclass

    from fastapi import Request


    @dataclass(frozen=True)
    class RequestSettings:
        jwt_secret: str
        rate_limit_secret: str
        bootstrap_secret: str | None
        web_origin: str
        secure_cookies: bool


    def get_request_settings(request: Request) -> RequestSettings:
        env = request.scope["env"]
        return RequestSettings(
            jwt_secret=str(env.JWT_SECRET),
            rate_limit_secret=str(env.RATE_LIMIT_SECRET),
            bootstrap_secret=str(env.BOOTSTRAP_SECRET) if hasattr(env, "BOOTSTRAP_SECRET") else None,
            web_origin=str(env.WEB_ORIGIN),
            secure_cookies=str(env.ENVIRONMENT) != "development",
        )

    # apps/api/app/infrastructure/security/csrf.py
    from fastapi import HTTPException, Request


    def require_csrf(request: Request, actor, web_origin: str) -> None:
        if request.headers.get("origin") != web_origin:
            raise HTTPException(status_code=403, detail="origin is not allowed")
        header = request.headers.get("X-CSRF-Token")
        cookie = request.cookies.get("er_csrf")
        if header is None or header != cookie or header != actor.csrf:
            raise HTTPException(status_code=403, detail="csrf token is invalid")

    # apps/api/app/api/deps.py
    from fastapi import HTTPException, Request

    from app.infrastructure.security.csrf import require_csrf
    from app.infrastructure.security.jwt import load_access_claims
    from app.infrastructure.worker_env import get_db
    from app.settings import get_request_settings


    async def get_current_actor(request: Request):
        token = request.cookies.get("er_session")
        if token is None:
            raise HTTPException(status_code=401, detail="authentication is required")
        settings = get_request_settings(request)
        claims = load_access_claims(token, settings.jwt_secret, utc_now())
        actor = await AuthStore(get_db(request)).load_active_actor(claims)
        if actor is None:
            raise HTTPException(status_code=401, detail="authentication is required")
        return actor


    async def require_mutation_actor(request: Request):
        actor = await get_current_actor(request)
        require_csrf(request, actor, get_request_settings(request).web_origin)
        return actor

    # apps/api/app/api/middleware.py
    from fastapi import Request, Response

    from app.settings import get_request_settings


    async def same_site_cors(request: Request, call_next):
        origin = request.headers.get("origin")
        allowed_origin = get_request_settings(request).web_origin
        if request.method == "OPTIONS" and origin == allowed_origin:
            return Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": allowed_origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Methods": "GET, POST, PATCH",
                    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
                },
            )
        response = await call_next(request)
        if origin == allowed_origin:
            response.headers["Access-Control-Allow-Origin"] = allowed_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
        return response

    AuthStore loads the session, user, and user_organizations rows after JWT decoding. It rejects revoked or expired sessions, inactive users, and mismatched session_version. It returns Actor with the stored Role and stored organization IDs; it never trusts a role from the cookie claim. Normalize login email with strip().lower(), HMAC the raw IP and normalized email with RATE_LIMIT_SECRET, and block five failures in a rolling 15-minute window. Failed login and denied cross-organization access create security_events metadata with the request ID and hashed limiter keys only.

    POST /api/v1/internal/bootstrap accepts X-Bootstrap-Secret only when the Worker secret matches and users is empty. It creates the first OPERATOR and returns 204; every later call returns 404. After the first login the deployment runbook removes BOOTSTRAP_SECRET. It is an operational bootstrap, not a public signup route.

    Register same_site_cors as the FastAPI HTTP middleware. It reads WEB_ORIGIN from request.scope["env"], so it works in a Python Worker where Worker environment bindings must not be read as process globals. Development may set secure=False only with ENVIRONMENT="development"; deployed environments always use Secure cookies. tests/conftest.py supplies a request-scope env and a local D1-compatible gateway, applies the SQL migration, and seeds the fixture accounts used by the integration tests.

- [ ] **Step 4: Run security verification**

    Run: cd apps/api && uv run pytest tests/unit/security tests/integration/test_auth_flow.py -q
    Expected: algorithm, expiry, issuer, audience, revoked-session, logout, exact-Origin, CSRF, throttle, and password-reset tests pass.

    Run: cd apps/api && uv run pywrangler dev
    Expected: login response has HttpOnly er_session and non-HttpOnly er_csrf cookies; JSON contains only csrfToken and public user data.

- [ ] **Step 5: Commit authentication as an independently reviewable unit**

    git add apps/api/app/settings.py apps/api/app/infrastructure/security apps/api/app/infrastructure/d1/auth_store.py apps/api/app/application/auth.py apps/api/app/api apps/api/app/main.py apps/api/tests
    git commit -m "feat: add session backed authentication"

### Task 6: Implement operator administration and participant master records

**Files:**
- Create: apps/api/app/api/schemas/admin.py
- Create: apps/api/app/api/schemas/participants.py
- Create: apps/api/app/api/routers/organizations.py
- Create: apps/api/app/api/routers/users.py
- Create: apps/api/app/api/routers/participants.py
- Create: apps/api/app/application/accounts.py
- Create: apps/api/app/application/participants.py
- Create: apps/api/app/infrastructure/d1/admin_store.py
- Create: apps/api/app/infrastructure/d1/participant_store.py
- Create: apps/api/tests/integration/test_administration.py
- Create: apps/api/tests/integration/test_participants.py
- Modify: apps/api/app/main.py

**Interfaces:**
- Produces: Organization { id, name, isActive }, User { id, email, displayName, role, organizationIds, isActive }, Participant { id, participantNumber, name, organizationId, organizationName, isActive }.
- Produces: create_participant(actor, name, organization_id) -> Participant and update_participant(actor, participant_id, name, organization_id) -> Participant.
- Rule: ORGANIZATION_MANAGER creates/searches only records in linked organizations and corrects only a same-organization participant name. Only OPERATOR changes participant organization.
- Rule: POST /users/{id}/password-reset increments session_version and revokes all auth_sessions for that user in one D1 batch.

- [ ] **Step 1: Write failing administration and participant permission tests**

    # apps/api/tests/integration/test_participants.py
    def test_manager_cannot_transfer_participant(client, manager_token, participant_in_org_1) -> None:
        response = client.patch(
            "/api/v1/participants/" + participant_in_org_1.id,
            json={"organizationId": "org-2"},
            headers=manager_token.headers,
        )
        assert response.status_code == 403


    def test_operator_transfer_preserves_closed_snapshot(client, operator_token, participant_in_org_1, closed_entry) -> None:
        response = client.patch(
            "/api/v1/participants/" + participant_in_org_1.id,
            json={"organizationId": "org-2"},
            headers=operator_token.headers,
        )
        assert response.status_code == 200
        rows = client.get("/api/v1/events/" + closed_entry.event_id + "/roster").json()["entries"]
        assert rows[0]["organizationName"] == "조직 1"

    # apps/api/tests/integration/test_administration.py
    def test_password_reset_revokes_all_user_sessions(client, operator_token, managed_user) -> None:
        response = client.post(
            "/api/v1/users/" + managed_user.id + "/password-reset",
            json={"newPassword": "N3w-Strong-Password!"},
            headers=operator_token.headers,
        )
        assert response.status_code == 204
        assert client.get("/api/v1/auth/me", cookies=managed_user.old_cookie).status_code == 401

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/integration/test_administration.py tests/integration/test_participants.py -q
    Expected: FAIL because administration and participant routers are not registered.

- [ ] **Step 3: Implement administration and master-data use cases**

    # apps/api/app/application/participants.py
    from uuid import uuid4

    from app.domain.policies import require_operator, require_organization_access


    def new_participant_number() -> str:
        return "P-" + uuid4().hex[:12].upper()


    async def assert_participant_update_allowed(actor, current_organization_id: str, next_organization_id: str | None) -> None:
        require_organization_access(actor, current_organization_id)
        if next_organization_id is not None and next_organization_id != current_organization_id:
            require_operator(actor)

    # apps/api/app/api/routers/participants.py
    @router.get("/participants")
    async def search_participants(query: str, organization_id: str | None, actor = Depends(get_current_actor)):
        return await participant_service.search(actor, query, organization_id)


    @router.post("/participants", status_code=201)
    async def create_participant(payload: ParticipantCreate, actor = Depends(require_mutation_actor)):
        return await participant_service.create(actor, payload)


    @router.patch("/participants/{participant_id}")
    async def update_participant(participant_id: str, payload: ParticipantUpdate, actor = Depends(require_mutation_actor)):
        return await participant_service.update(actor, participant_id, payload)

    Use Pydantic constraints for trimmed nonempty names, valid email, a 12-character-or-longer reset password, and explicit Role values. User create/update and organization create/update require OPERATOR. User organization assignments replace atomically with the user mutation. Participant records retry new_participant_number() on a UNIQUE collision at most three times. Master changes never update CLOSED roster snapshots.

- [ ] **Step 4: Run administration and master-data tests**

    Run: cd apps/api && uv run pytest tests/integration/test_administration.py tests/integration/test_participants.py -q
    Expected: operator CRUD, linked-organization checks, session revocation, participant number generation, and closed-snapshot preservation tests pass.

- [ ] **Step 5: Commit administration and participant foundations**

    git add apps/api/app/api apps/api/app/application apps/api/app/infrastructure/d1 apps/api/tests/integration
    git commit -m "feat: add organization and participant administration"

### Task 7: Implement event creation, lifecycle transitions, and expected snapshots

**Files:**
- Create: apps/api/app/api/schemas/events.py
- Create: apps/api/app/api/routers/events.py
- Create: apps/api/app/application/events.py
- Create: apps/api/app/infrastructure/d1/event_store.py
- Create: apps/api/tests/integration/test_events.py
- Modify: apps/api/app/main.py

**Interfaces:**
- Produces: POST /events, GET /events?scope=active|past, GET /events/{id}, PATCH /events/{id}, POST /events/{id}/transition.
- Produces: transition_to_day_of(event_id, actor) -> Event, which writes one expected snapshot per organization from active PRE_EVENT rows.
- Rule: only OPERATOR creates, edits, transitions, closes, and reopens events; only DRAFT has editable basic event fields.
- Rule: first DAY_OF transition creates snapshots; CLOSED -> DAY_OF preserves them and emits EVENT_REOPENED.

- [ ] **Step 1: Write failing event workflow tests**

    # apps/api/tests/integration/test_events.py
    def test_day_of_transition_freezes_pre_event_counts(client, operator_token, pre_registered_event, entries_for_org_1) -> None:
        transition = client.post(
            "/api/v1/events/" + pre_registered_event.id + "/transition",
            json={"targetStatus": "DAY_OF"},
            headers=operator_token.headers,
        )
        assert transition.status_code == 200
        summary = client.get("/api/v1/events/" + pre_registered_event.id + "/summary").json()
        assert summary["organizations"][0]["expectedCount"] == len(entries_for_org_1)


    def test_reopen_keeps_original_expected_snapshot(client, operator_token, closed_event) -> None:
        before = client.get("/api/v1/events/" + closed_event.id + "/summary").json()["expectedTotal"]
        response = client.post(
            "/api/v1/events/" + closed_event.id + "/transition",
            json={"targetStatus": "DAY_OF"},
            headers=operator_token.headers,
        )
        assert response.status_code == 200
        assert client.get("/api/v1/events/" + closed_event.id + "/summary").json()["expectedTotal"] == before

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/integration/test_events.py -q
    Expected: FAIL with 404 because /api/v1/events routes are absent.

- [ ] **Step 3: Implement event services and snapshot-safe transition SQL**

    # apps/api/app/application/events.py
    from datetime import datetime


    def parse_utc(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))


    async def transition_to_day_of(store, event_id: str, actor, now: str):
        event = await store.get_event(event_id)
        require_operator(actor)
        transition_event(event, EventStatus.DAY_OF, parse_utc(now))
        if event.status is EventStatus.PRE_REGISTRATION:
            statements = [
                store.update_event_status_statement(event_id, "DAY_OF", now),
                store.capture_expected_snapshot_statement(event_id, now),
                store.audit_statement(event_id, None, None, actor.id, "EVENT_TRANSITIONED", event.status, "DAY_OF", now),
            ]
        else:
            statements = [
                store.update_event_status_statement(event_id, "DAY_OF", now),
                store.audit_statement(event_id, None, None, actor.id, "EVENT_REOPENED", event.status, "DAY_OF", now),
            ]
        await store.batch(statements)
        return await store.get_event(event_id)

    # apps/api/app/infrastructure/d1/event_store.py
    def capture_expected_snapshot_statement(self, event_id: str, captured_at: str):
        return self.db.prepare(
            "INSERT INTO event_expected_snapshots (event_id, organization_id, organization_name, expected_count, captured_at) "
            "SELECT event_id, snapshot_organization_id, snapshot_organization_name, COUNT(*), ? "
            "FROM event_roster_entries WHERE event_id = ? AND source = 'PRE_EVENT' AND status = 'ACTIVE' "
            "GROUP BY event_id, snapshot_organization_id, snapshot_organization_name"
        ).bind(captured_at, event_id)

    Return active events for DRAFT, PRE_REGISTRATION, DAY_OF and past events for CLOSED. Enforce UNIQUE(year, half) as HTTP 409 code EVENT_PERIOD_EXISTS. Default title is the supplied year plus " 상반기 행사" for H1 or " 하반기 행사" for H2 when no title is supplied. CLOSED -> DAY_OF never calls capture_expected_snapshot_statement.

- [ ] **Step 4: Run event API tests**

    Run: cd apps/api && uv run pytest tests/integration/test_events.py -q
    Expected: create, unique half, forward transition, snapshot, close, reopen, and manager-denial tests pass.

- [ ] **Step 5: Commit the event lifecycle API**

    git add apps/api/app/api/schemas/events.py apps/api/app/api/routers/events.py apps/api/app/application/events.py apps/api/app/infrastructure/d1/event_store.py apps/api/app/main.py apps/api/tests/integration/test_events.py
    git commit -m "feat: add event lifecycle management"

### Task 8: Implement roster changes, revision conflicts, audit logs, and summaries

**Files:**
- Create: apps/api/app/api/schemas/roster.py
- Create: apps/api/app/api/schemas/audit.py
- Create: apps/api/app/api/routers/roster.py
- Create: apps/api/app/api/routers/audit.py
- Create: apps/api/app/application/roster.py
- Create: apps/api/app/infrastructure/d1/roster_store.py
- Create: apps/api/tests/integration/test_roster.py
- Create: apps/api/tests/integration/test_roster_concurrency.py
- Create: apps/api/tests/integration/test_audit.py
- Modify: apps/api/app/main.py

**Interfaces:**
- Produces: GET, POST /events/{event_id}/roster; PATCH /events/{event_id}/roster/{entry_id}; GET /events/{event_id}/summary; GET /events/{event_id}/audit-logs.
- Produces: update_roster_entry(event_id, entry_id, revision, patch, actor) -> RosterEntry.
- Produces: RosterEntryRecord from store.get_entry with id, event_id, participant_id, snapshot_name, snapshot_organization_id, snapshot_organization_name, source, status, revision, updated_at.
- Produces: audit actions ROSTER_ADDED, ROSTER_UPDATED, ROSTER_CANCELLED, ROSTER_REACTIVATED, EVENT_TRANSITIONED, EVENT_REOPENED, IMPORT_COMMITTED.
- Rule: added in PRE_REGISTRATION means source PRE_EVENT; added in DAY_OF means source DAY_OF; source never changes on cancellation or reactivation.
- Rule: CLOSED rejects mutations with 409 EVENT_CLOSED; managers cannot access another organization’s rows or audit records.

- [ ] **Step 1: Write failing roster, audit, and stale-revision tests**

    # apps/api/tests/integration/test_roster_concurrency.py
    def test_second_write_with_same_revision_gets_latest_without_audit(client, operator_token, active_entry) -> None:
        first = client.patch(
            "/api/v1/events/" + active_entry.event_id + "/roster/" + active_entry.id,
            json={"revision": active_entry.revision, "name": "수정 이름"},
            headers=operator_token.headers,
        )
        assert first.status_code == 200
        second = client.patch(
            "/api/v1/events/" + active_entry.event_id + "/roster/" + active_entry.id,
            json={"revision": active_entry.revision, "name": "늦은 수정"},
            headers=operator_token.headers,
        )
        assert second.status_code == 409
        assert second.json()["code"] == "STALE_REVISION"
        assert second.json()["details"]["latestEntry"]["revision"] == active_entry.revision + 1
        assert client.get("/api/v1/events/" + active_entry.event_id + "/audit-logs").json()["total"] == 1

    # apps/api/tests/integration/test_roster.py
    def test_cancellation_preserves_row_and_reactivation_reuses_it(client, operator_token, active_entry) -> None:
        cancel = client.patch(
            "/api/v1/events/" + active_entry.event_id + "/roster/" + active_entry.id,
            json={"revision": active_entry.revision, "status": "CANCELLED"},
            headers=operator_token.headers,
        )
        assert cancel.status_code == 200
        reactivate = client.patch(
            "/api/v1/events/" + active_entry.event_id + "/roster/" + active_entry.id,
            json={"revision": cancel.json()["revision"], "status": "ACTIVE"},
            headers=operator_token.headers,
        )
        assert reactivate.status_code == 200
        rows = client.get("/api/v1/events/" + active_entry.event_id + "/roster").json()["entries"]
        assert [row["id"] for row in rows].count(active_entry.id) == 1

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/integration/test_roster.py tests/integration/test_roster_concurrency.py tests/integration/test_audit.py -q
    Expected: FAIL with 404 because roster and audit endpoints do not exist.

- [ ] **Step 3: Implement conditional row updates and same-batch audit inserts**

    # apps/api/app/infrastructure/d1/roster_store.py
    from uuid import uuid4


    def new_uuid() -> str:
        return str(uuid4())


    def update_entry_statements(self, entry_id, event_id, expected_revision, snapshot_name, snapshot_organization_id, snapshot_organization_name, status, actor_id, now, before_json, after_json, action):
        update = self.db.prepare(
            "UPDATE event_roster_entries SET snapshot_name = ?, snapshot_organization_id = ?, snapshot_organization_name = ?, status = ?, revision = revision + 1, updated_by_user_id = ?, updated_at = ? "
            "WHERE id = ? AND event_id = ? AND revision = ?"
        ).bind(snapshot_name, snapshot_organization_id, snapshot_organization_name, status, actor_id, now, entry_id, event_id, expected_revision)
        audit = self.db.prepare(
            "INSERT INTO audit_logs (id, event_id, roster_entry_id, organization_id, actor_id, action, before_json, after_json, created_at) "
            "SELECT ?, event_id, id, snapshot_organization_id, ?, ?, ?, ?, ? "
            "FROM event_roster_entries WHERE id = ? AND event_id = ? AND revision = ?"
        ).bind(new_uuid(), actor_id, action, before_json, after_json, now, entry_id, event_id, expected_revision + 1)
        return [update, audit]

    # apps/api/app/application/roster.py
    import json
    from dataclasses import dataclass


    @dataclass(frozen=True)
    class RosterPatch:
        name: str | None = None
        organization_id: str | None = None
        status: str | None = None


    def audit_snapshot(entry, name: str, organization_id: str, organization_name: str, status: str) -> str:
        return json.dumps(
            {
                "entryId": entry.id,
                "name": name,
                "organizationId": organization_id,
                "organizationName": organization_name,
                "source": entry.source,
                "status": status,
                "revision": entry.revision,
            },
            ensure_ascii=False,
            sort_keys=True,
        )


    def action_for(previous_status: str, next_status: str, name_changed: bool) -> str:
        if previous_status == "ACTIVE" and next_status == "CANCELLED":
            return "ROSTER_CANCELLED"
        if previous_status == "CANCELLED" and next_status == "ACTIVE":
            return "ROSTER_REACTIVATED"
        if name_changed:
            return "ROSTER_UPDATED"
        return "ROSTER_UPDATED"


    async def update_roster_entry(store, event_id, entry_id, revision, patch, actor, now):
        current = await store.get_entry(event_id, entry_id)
        ensure_event_is_mutable(await store.get_event(event_id))
        require_organization_access(actor, current.snapshot_organization_id)
        next_name = patch.name if patch.name is not None else current.snapshot_name
        next_status = patch.status if patch.status is not None else current.status
        next_organization_id = current.snapshot_organization_id
        next_organization_name = current.snapshot_organization_name
        if patch.organization_id is not None:
            require_operator(actor)
            organization = await store.get_organization(patch.organization_id)
            next_organization_id = organization.id
            next_organization_name = organization.name
        statements = store.update_entry_statements(
            entry_id,
            event_id,
            revision,
            next_name,
            next_organization_id,
            next_organization_name,
            next_status,
            actor.id,
            now,
            audit_snapshot(current, current.snapshot_name, current.snapshot_organization_id, current.snapshot_organization_name, current.status),
            audit_snapshot(current, next_name, next_organization_id, next_organization_name, next_status),
            action_for(current.status, next_status, patch.name is not None),
        )
        if patch.name is not None:
            statements.append(store.update_participant_name_statement(current.participant_id, next_name, now))
        if patch.organization_id is not None:
            statements.append(store.update_participant_organization_statement(current.participant_id, next_organization_id, now))
        results = await store.batch(statements)
        if results[0].meta.changes != 1:
            raise StaleRevision(await store.get_entry(event_id, entry_id))
        return await store.get_entry(event_id, entry_id)

    update_participant_name_statement and update_participant_organization_statement are conditional UPDATE statements in the same batch as update_entry_statements. The roster UPDATE changes only event_id’s snapshot; it never targets a CLOSED event or another event snapshot. POST roster uses INSERT ON CONFLICT(event_id, participant_id) DO UPDATE so a cancelled row becomes ACTIVE without creating another row. Summary uses dynamic active PRE_EVENT entries only in PRE_REGISTRATION and expected snapshots after DAY_OF.

- [ ] **Step 4: Run roster and audit tests**

    Run: cd apps/api && uv run pytest tests/integration/test_roster.py tests/integration/test_roster_concurrency.py tests/integration/test_audit.py -q
    Expected: add, update, cancel, reactivate, cross-organization denial, 409 conflict, audit append-only, summary, and closed-event rejection tests pass.

- [ ] **Step 5: Commit roster operations**

    git add apps/api/app/api/schemas/roster.py apps/api/app/api/schemas/audit.py apps/api/app/api/routers apps/api/app/application/roster.py apps/api/app/infrastructure/d1/roster_store.py apps/api/app/main.py apps/api/tests/integration
    git commit -m "feat: add roster operations and audit trail"

### Task 9: Add stateless import validation, atomic commit, and export-data reporting

**Files:**
- Create: apps/api/app/api/schemas/imports.py
- Create: apps/api/app/api/schemas/reports.py
- Create: apps/api/app/api/routers/imports.py
- Create: apps/api/app/api/routers/reports.py
- Create: apps/api/app/application/imports.py
- Create: apps/api/app/application/reports.py
- Create: apps/api/app/infrastructure/d1/import_store.py
- Create: apps/api/tests/integration/test_imports.py
- Create: apps/api/tests/integration/test_reports.py
- Modify: apps/api/app/main.py

**Interfaces:**
- Produces: ImportRowInput { rowNumber, name, organizationId, participantId | null, resolution: "CREATE" | "USE_EXISTING" }.
- Produces: ImportValidationResult { rows: ImportRowInput[], errors: ImportRowError[] }, where each error has rowNumber, code, message, candidateParticipants.
- Produces: POST /events/{id}/imports/validate and POST /events/{id}/imports/commit.
- Produces: EventExportData { event, roster: RosterEntry[], summary: OrganizationSummary[] }.
- Rule: imports operate in PRE_REGISTRATION and DAY_OF, infer source from the current event state, reject CLOSED, and never receive multipart file data.

- [ ] **Step 1: Write failing all-or-nothing import and report tests**

    # apps/api/tests/integration/test_imports.py
    def test_one_invalid_row_rolls_back_entire_import(client, operator_token, pre_registration_event) -> None:
        response = client.post(
            "/api/v1/events/" + pre_registration_event.id + "/imports/commit",
            json={"rows": [
                {"rowNumber": 2, "name": "가", "organizationId": "org-1", "participantId": None, "resolution": "CREATE"},
                {"rowNumber": 3, "name": "", "organizationId": "org-1", "participantId": None, "resolution": "CREATE"},
            ]},
            headers=operator_token.headers,
        )
        assert response.status_code == 422
        assert client.get("/api/v1/events/" + pre_registration_event.id + "/roster").json()["entries"] == []


    def test_130_valid_rows_commit_as_one_import_run(client, operator_token, pre_registration_event) -> None:
        rows = [
            {"rowNumber": index + 2, "name": "참가자 " + str(index), "organizationId": "org-1", "participantId": None, "resolution": "CREATE"}
            for index in range(130)
        ]
        response = client.post("/api/v1/events/" + pre_registration_event.id + "/imports/commit", json={"rows": rows}, headers=operator_token.headers)
        assert response.status_code == 201
        assert response.json()["totalRows"] == 130
        assert len(client.get("/api/v1/events/" + pre_registration_event.id + "/roster").json()["entries"]) == 130

    # apps/api/tests/integration/test_reports.py
    def test_export_data_has_full_roster_and_summary(client, operator_token, day_of_event) -> None:
        response = client.get("/api/v1/events/" + day_of_event.id + "/export-data", headers=operator_token.headers)
        assert response.status_code == 200
        assert {"event", "roster", "summary"} <= response.json().keys()

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: cd apps/api && uv run pytest tests/integration/test_imports.py tests/integration/test_reports.py -q
    Expected: FAIL with 404 because import and export-data routes are absent.

- [ ] **Step 3: Implement validation-before-write and one-batch commit**

    # apps/api/app/api/schemas/imports.py
    from enum import StrEnum

    from pydantic import BaseModel, ConfigDict, Field


    class ImportResolution(StrEnum):
        CREATE = "CREATE"
        USE_EXISTING = "USE_EXISTING"


    class ImportRowInput(BaseModel):
        model_config = ConfigDict(populate_by_name=True)
        row_number: int = Field(alias="rowNumber", ge=2)
        name: str
        organization_id: str = Field(alias="organizationId")
        participant_id: str | None = Field(alias="participantId")
        resolution: ImportResolution


    class ImportRowError(BaseModel):
        row_number: int = Field(alias="rowNumber")
        code: str
        message: str
        candidate_participants: list[dict[str, str]] = Field(alias="candidateParticipants", default_factory=list)


    class ImportValidationResult(BaseModel):
        rows: list[ImportRowInput]
        errors: list[ImportRowError]

    # apps/api/app/application/imports.py
    from app.api.schemas.imports import ImportRowError, ImportRowInput, ImportValidationResult
    from app.domain.errors import DomainError
    from app.domain.policies import ensure_event_is_mutable, require_organization_access


    class ImportValidationFailed(DomainError):
        code = "IMPORT_VALIDATION_FAILED"

        def __init__(self, errors: list[ImportRowError]) -> None:
            self.errors = errors


    def import_error(row_number: int, code: str, message: str) -> ImportRowError:
        return ImportRowError(rowNumber=row_number, code=code, message=message)


    async def assert_import_organization_allowed(actor, organization_id: str) -> None:
        require_organization_access(actor, organization_id)


    async def validate_import_rows(store, event_id, actor, rows):
        event = await store.get_event(event_id)
        ensure_event_is_mutable(event)
        errors = []
        seen = set()
        for row in rows:
            normalized_name = row.name.strip()
            key = (normalized_name.casefold(), row.organization_id, row.participant_id)
            if not normalized_name:
                errors.append(import_error(row.row_number, "REQUIRED_NAME", "이름은 필수입니다"))
            if key in seen:
                errors.append(import_error(row.row_number, "DUPLICATE_ROW", "같은 참가자 행이 중복되었습니다"))
            seen.add(key)
            await assert_import_organization_allowed(actor, row.organization_id)
            errors.extend(await store.candidate_errors(row))
        return ImportValidationResult(rows=rows, errors=errors)


    async def commit_import_rows(store, event_id, actor, rows, now):
        validation = await validate_import_rows(store, event_id, actor, rows)
        if validation.errors:
            raise ImportValidationFailed(validation.errors)
        await store.batch(store.build_import_statements(event_id, actor, rows, now))
        return await store.get_import_commit_result(event_id, actor.id, now)

    Each client row retains original rowNumber. candidate_errors reports UNKNOWN_ORGANIZATION, AMBIGUOUS_PARTICIPANT, DUPLICATE_ROW, and organization scope failures. CREATE makes participant and roster data; USE_EXISTING requires the selected participantId. Build participant, roster, audit, and import_runs SQL in subgroups whose individual statements use fewer than 100 parameters, then concatenate every subgroup into the one list passed to one D1Gateway.batch call. A UNIQUE failure or audit/import-run failure rolls back every participant and roster write. Report queries return unfiltered event data with organizationId, organizationName, expectedCount, dayAdditions, dayCancellations, finalCount, and delta.

- [ ] **Step 4: Run import and report tests**

    Run: cd apps/api && uv run pytest tests/integration/test_imports.py tests/integration/test_reports.py -q
    Expected: ambiguous candidate, unknown organization, manager scope, 130-row success, one-row rollback, import metadata, and complete report-data tests pass.

- [ ] **Step 5: Commit import and reporting APIs**

    git add apps/api/app/api/schemas/imports.py apps/api/app/api/schemas/reports.py apps/api/app/api/routers/imports.py apps/api/app/api/routers/reports.py apps/api/app/application/imports.py apps/api/app/application/reports.py apps/api/app/infrastructure/d1/import_store.py apps/api/app/main.py apps/api/tests/integration
    git commit -m "feat: add roster import and export data"

### Task 10: Generate the shared OpenAPI contract before feature UI

**Files:**
- Create: apps/api/scripts/export_openapi.py
- Create: apps/api/tests/integration/test_openapi_contract.py
- Create: packages/contracts/package.json
- Create: packages/contracts/scripts/generate.mjs
- Create: packages/contracts/src/schema.d.ts
- Create: packages/contracts/tsconfig.json
- Modify: package.json

**Interfaces:**
- Produces: @event-roster/contracts exporting generated paths and components types from packages/contracts/src/schema.d.ts.
- Produces: pnpm --filter @event-roster/contracts generate, generating API types from apps/api/openapi.json.
- Rule: frontend feature code imports generated request/response types rather than defining duplicate API DTOs.

- [ ] **Step 1: Write the failing OpenAPI coverage test**

    # apps/api/tests/integration/test_openapi_contract.py
    from app.main import app


    def test_openapi_exposes_every_frontend_resource() -> None:
        paths = app.openapi()["paths"]
        assert "/api/v1/auth/login" in paths
        assert "/api/v1/events/{event_id}/roster/{entry_id}" in paths
        assert "/api/v1/events/{event_id}/imports/commit" in paths
        assert "/api/v1/events/{event_id}/export-data" in paths

- [ ] **Step 2: Run the test and confirm that it fails**

    Run: cd apps/api && uv run pytest tests/integration/test_openapi_contract.py -q
    Expected: FAIL until every router has documented /api/v1 prefix and response schema.

- [ ] **Step 3: Implement deterministic schema export and TypeScript generation**

    # apps/api/scripts/export_openapi.py
    import json
    from pathlib import Path

    from app.main import app

    Path("openapi.json").write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    // packages/contracts/package.json
    {
      "name": "@event-roster/contracts",
      "private": true,
      "version": "0.1.0",
      "type": "module",
      "types": "./src/schema.d.ts",
      "scripts": {
        "generate": "node scripts/generate.mjs",
        "check": "tsc --noEmit"
      },
      "devDependencies": {
        "openapi-typescript": "^7.6.0",
        "typescript": "^5.7.0"
      }
    }

    // packages/contracts/scripts/generate.mjs
    import { execFileSync } from "node:child_process";
    import { resolve } from "node:path";

    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const apiDirectory = resolve(repositoryRoot, "apps/api");
    execFileSync("uv", ["run", "python", "scripts/export_openapi.py"], { cwd: apiDirectory, stdio: "inherit" });
    execFileSync(
      "pnpm",
      ["exec", "openapi-typescript", resolve(apiDirectory, "openapi.json"), "-o", resolve(repositoryRoot, "packages/contracts/src/schema.d.ts")],
      { cwd: repositoryRoot, stdio: "inherit" },
    );

    Update the root check script so contract generation occurs before TypeScript checks, then run git diff --exit-code against schema.d.ts. The generated file remains versioned and is never manually edited.

- [ ] **Step 4: Generate and verify the contract**

    Run: cd apps/api && uv run pytest tests/integration/test_openapi_contract.py -q
    Expected: 1 passed.

    Run: pnpm --filter @event-roster/contracts generate && pnpm --filter @event-roster/contracts check && git diff --exit-code -- packages/contracts/src/schema.d.ts
    Expected: generation succeeds, TypeScript passes, and a second generation leaves no diff.

- [ ] **Step 5: Commit the contract boundary**

    git add apps/api/scripts/export_openapi.py apps/api/openapi.json apps/api/tests/integration/test_openapi_contract.py packages/contracts package.json pnpm-lock.yaml
    git commit -m "feat: generate shared API contracts"

### Task 11: Build the web foundation, design primitives, and cookie-authenticated shell

**Files:**
- Create: apps/web/src/styles/tokens.css
- Create: apps/web/src/styles/global.css
- Create: apps/web/src/components/ui/Button.tsx
- Create: apps/web/src/components/ui/Badge.tsx
- Create: apps/web/src/components/ui/Dialog.tsx
- Create: apps/web/src/components/ui/Table.tsx
- Create: apps/web/src/components/ui/EmptyState.tsx
- Create: apps/web/src/components/ui/Progress.tsx
- Create: apps/web/src/components/ui/Toast.tsx
- Create: apps/web/src/lib/api/client.ts
- Create: apps/web/src/lib/api/csrf.ts
- Create: apps/web/src/lib/api/problem.ts
- Create: apps/web/src/app/providers.tsx
- Create: apps/web/src/app/router.tsx
- Create: apps/web/src/app/RequireAuth.tsx
- Create: apps/web/src/app/AppShell.tsx
- Create: apps/web/src/features/auth/LoginPage.tsx
- Create: apps/web/src/features/auth/useSession.ts
- Create: apps/web/src/test/server.ts
- Create: apps/web/src/test/render.tsx
- Create: apps/web/src/features/auth/LoginPage.test.tsx
- Modify: apps/web/src/main.tsx

**Interfaces:**
- Produces: apiRequest<T>(path: string, init?: RequestInit) -> Promise<T>, always using credentials: "include".
- Produces: setCsrfToken(token: string), getCsrfToken(), clearCsrfToken(); this token is module memory only.
- Produces: RequireAuth redirecting 401 users to /login and AppShell with role-aware navigation.
- Produces: semantic button, dialog, table, status badge, progress, empty state, and toast primitives.
- Consumes: generated contracts and /auth endpoints from Task 10.

- [ ] **Step 1: Write failing browser-shell tests**

    // apps/web/src/features/auth/LoginPage.test.tsx
    import { http, HttpResponse } from "msw";
    import { screen } from "@testing-library/react";
    import userEvent from "@testing-library/user-event";
    import { LoginPage } from "./LoginPage";
    import { renderWithProviders } from "../../test/render";
    import { server } from "../../test/server";

    test("keeps the JWT out of browser storage and sends credentialed login", async () => {
      let credentialMode: RequestCredentials | undefined;
      server.use(
        http.post("/api/v1/auth/login", ({ request }) => {
          credentialMode = request.credentials;
          return HttpResponse.json({ user: { id: "u1", displayName: "운영자", role: "OPERATOR" }, csrfToken: "csrf-value" });
        }),
      );
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />);
      await user.type(screen.getByLabelText("이메일"), "operator@example.test");
      await user.type(screen.getByLabelText("비밀번호"), "Strong-Password!");
      await user.click(screen.getByRole("button", { name: "로그인" }));
      expect(credentialMode).toBe("include");
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

- [ ] **Step 2: Run the test and confirm that it fails**

    Run: pnpm --dir apps/web test --run src/features/auth/LoginPage.test.tsx
    Expected: FAIL because auth feature and API client are absent.

- [ ] **Step 3: Implement tokens, primitives, typed client, and auth routing**

    /* apps/web/src/styles/tokens.css */
    :root {
      --er-color-bg: #f7f8fb;
      --er-color-surface: #ffffff;
      --er-color-text: #172033;
      --er-color-muted: #667085;
      --er-color-primary: #3659e3;
      --er-color-danger: #c9362b;
      --er-space-1: 0.25rem;
      --er-space-2: 0.5rem;
      --er-space-3: 0.75rem;
      --er-space-4: 1rem;
      --er-radius-sm: 0.375rem;
      --er-radius-md: 0.625rem;
      --er-shadow-panel: 0 8px 24px rgb(23 32 51 / 12%);
    }

    // apps/web/src/lib/api/csrf.ts
    let csrfToken: string | null = null;

    export function setCsrfToken(token: string): void {
      csrfToken = token;
    }

    export function getCsrfToken(): string | null {
      return csrfToken;
    }

    export function clearCsrfToken(): void {
      csrfToken = null;
    }

    // apps/web/src/lib/api/client.ts
    import { getCsrfToken } from "./csrf";
    import { toApiProblem } from "./problem";

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

    export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers);
      if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
        headers.set("X-CSRF-Token", getCsrfToken() ?? "");
      }
      const response = await fetch(apiBaseUrl + path, { ...init, headers, credentials: "include" });
      if (!response.ok) throw await toApiProblem(response);
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    }

    // apps/web/src/components/ui/Button.tsx
    import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

    export function Button({ children, type = "button", ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
      return <button type={type} {...props}>{children}</button>;
    }

    Implement Badge as a span with data-tone. Implement Dialog with a native dialog element, showModal(), close(), Escape close, and focus restoration. Implement Table as a semantic table wrapper, EmptyState as a labelled section, Progress as a progress element, and Toast as aria-live="polite". AppProviders contains QueryClientProvider and BrowserRouter. useSession calls GET /auth/me followed by GET /auth/csrf after a valid session. Login stores only csrfToken in module memory. Logout clears it and removes React Query data.

- [ ] **Step 4: Run UI, type, and build checks**

    Run: pnpm --dir apps/web test --run src/features/auth/LoginPage.test.tsx && pnpm --dir apps/web check && pnpm --dir apps/web build
    Expected: login, 401 redirect, dialog accessibility, disabled button, empty state, and token-storage tests pass; typecheck and build pass.

- [ ] **Step 5: Commit the web platform**

    git add apps/web/src apps/web/package.json apps/web/vite.config.ts apps/web/vitest.config.ts pnpm-lock.yaml
    git commit -m "feat: add authenticated web foundation"

### Task 12: Build event dashboard, creation flow, and lifecycle controls

**Files:**
- Create: apps/web/src/features/events/api.ts
- Create: apps/web/src/features/events/EventListPage.tsx
- Create: apps/web/src/features/events/EventCreateDialog.tsx
- Create: apps/web/src/features/events/EventHeader.tsx
- Create: apps/web/src/features/events/EventLifecycleActions.tsx
- Create: apps/web/src/features/events/EventSummary.tsx
- Create: apps/web/src/features/events/PastEventsPage.tsx
- Create: apps/web/src/features/events/EventListPage.test.tsx
- Create: apps/web/src/features/events/EventLifecycleActions.test.tsx
- Modify: apps/web/src/app/router.tsx

**Interfaces:**
- Produces: /events active list, /events/past closed list, /events/:eventId console route.
- Produces: EventHeader receiving EventDetail and controls state transitions only for OPERATOR.
- Consumes: GET/POST /events, GET /events/{id}, POST /events/{id}/transition, GET /events/{id}/summary.
- Rule: closed event UI is read-only and retains summary, audit, and export actions.

- [ ] **Step 1: Write failing lifecycle visibility tests**

    // apps/web/src/features/events/EventLifecycleActions.test.tsx
    import { screen } from "@testing-library/react";
    import { EventLifecycleActions } from "./EventLifecycleActions";
    import { renderWithProviders } from "../../test/render";

    test("shows valid operator transition for a pre-registration event", () => {
      renderWithProviders(
        <EventLifecycleActions event={{ id: "e1", status: "PRE_REGISTRATION" }} currentUser={{ role: "OPERATOR" }} />,
      );
      expect(screen.getByRole("button", { name: "당일 운영 시작" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "마감" })).not.toBeInTheDocument();
    });


    test("does not expose lifecycle controls to an organization manager", () => {
      renderWithProviders(
        <EventLifecycleActions event={{ id: "e1", status: "PRE_REGISTRATION" }} currentUser={{ role: "ORGANIZATION_MANAGER" }} />,
      );
      expect(screen.queryByRole("button", { name: "당일 운영 시작" })).not.toBeInTheDocument();
    });

- [ ] **Step 2: Run the test and confirm that it fails**

    Run: pnpm --dir apps/web test --run src/features/events/EventLifecycleActions.test.tsx
    Expected: FAIL because events feature does not exist.

- [ ] **Step 3: Implement event routes and focused dashboard components**

    // apps/web/src/features/events/EventLifecycleActions.tsx
    import { Button } from "../../components/ui/Button";

    const nextAction = {
      DRAFT: { targetStatus: "PRE_REGISTRATION", label: "사전 등록 시작" },
      PRE_REGISTRATION: { targetStatus: "DAY_OF", label: "당일 운영 시작" },
      DAY_OF: { targetStatus: "CLOSED", label: "마감" },
      CLOSED: { targetStatus: "DAY_OF", label: "당일 운영으로 재오픈" },
    } as const;

    export function EventLifecycleActions({ event, currentUser, onTransition }: {
      event: { id: string; status: keyof typeof nextAction };
      currentUser: { role: string };
      onTransition?: (targetStatus: string) => void;
    }) {
      if (currentUser.role !== "OPERATOR") return null;
      const action = nextAction[event.status];
      return <Button onClick={() => onTransition?.(action.targetStatus)}>{action.label}</Button>;
    }

    Use TanStack Query keys ["events", "active"], ["events", "past"], ["event", eventId], and ["event-summary", eventId]. Invalidate affected keys only after a successful create or transition. EventCreateDialog validates year 2020–2100, H1/H2, title, event date, and optional venue. EventSummary renders expected, final, and signed delta from the server; it does not recompute from a possibly filtered list. PastEventsPage fetches scope=past and links to the same console in read-only mode.

- [ ] **Step 4: Run event UI tests**

    Run: pnpm --dir apps/web test --run src/features/events/EventListPage.test.tsx src/features/events/EventLifecycleActions.test.tsx
    Expected: operator-only create/transition controls, state label, empty state, API error state, active/past separation, and server metric tests pass.

- [ ] **Step 5: Commit event management UI**

    git add apps/web/src/features/events apps/web/src/app/router.tsx
    git commit -m "feat: add event dashboard and lifecycle controls"

### Task 13: Build the hybrid roster console and responsive read-only presentation

**Files:**
- Create: apps/web/src/features/roster/api.ts
- Create: apps/web/src/features/roster/filters.ts
- Create: apps/web/src/features/roster/RosterWorkspace.tsx
- Create: apps/web/src/features/roster/RosterToolbar.tsx
- Create: apps/web/src/features/roster/RosterTable.tsx
- Create: apps/web/src/features/roster/RosterMobileList.tsx
- Create: apps/web/src/features/roster/RosterDetailsPanel.tsx
- Create: apps/web/src/features/roster/RosterTable.test.tsx
- Create: apps/web/src/features/roster/RosterWorkspace.test.tsx
- Modify: apps/web/src/app/router.tsx

**Interfaces:**
- Produces: EventConsolePage composition of EventHeader, EventSummary, RosterWorkspace, details panel, audit, import, export.
- Produces: filterRoster(entries, { query, organizationId, status }) -> RosterEntry[].
- Consumes: GET /events/{id}/roster and GET /events/{id}/summary.
- Rule: desktop uses one semantic table with fixed header and no pagination; at CSS 960px the same data uses a read-focused card list.

- [ ] **Step 1: Write failing table and filtering tests**

    // apps/web/src/features/roster/RosterTable.test.tsx
    import { screen } from "@testing-library/react";
    import { RosterTable } from "./RosterTable";
    import { renderWithProviders } from "../../test/render";

    test("renders all 130 entries without pagination controls", () => {
      const entries = Array.from({ length: 130 }, (_, index) => ({
        id: String(index),
        name: "참가자 " + index,
        organizationName: "개발팀",
        status: "ACTIVE",
        source: "PRE_EVENT",
        updatedAt: "2026-01-01T00:00:00Z",
      }));
      renderWithProviders(<RosterTable entries={entries} selectedEntryId={null} onSelect={() => undefined} />);
      expect(screen.getAllByRole("row")).toHaveLength(131);
      expect(screen.queryByRole("button", { name: /다음 페이지/ })).not.toBeInTheDocument();
    });

    // apps/web/src/features/roster/RosterWorkspace.test.tsx
    import { filterRoster } from "./filters";

    test("filters by case-insensitive name, organization, and status", () => {
      const result = filterRoster(
        [{ id: "1", name: "홍길동", organizationId: "org-1", status: "ACTIVE" }],
        { query: "길동", organizationId: "org-1", status: "ACTIVE" },
      );
      expect(result).toHaveLength(1);
    });

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: pnpm --dir apps/web test --run src/features/roster/RosterTable.test.tsx src/features/roster/RosterWorkspace.test.tsx
    Expected: FAIL because roster components and filters are absent.

- [ ] **Step 3: Implement local filters and adaptive presentation**

    // apps/web/src/features/roster/filters.ts
    export function filterRoster<T extends { name: string; organizationId: string; status: string }>(
      entries: T[],
      filters: { query: string; organizationId: string; status: string },
    ): T[] {
      const query = filters.query.trim().toLocaleLowerCase("ko-KR");
      return entries.filter((entry) =>
        (!query || entry.name.toLocaleLowerCase("ko-KR").includes(query)) &&
        (!filters.organizationId || entry.organizationId === filters.organizationId) &&
        (!filters.status || entry.status === filters.status),
      );
    }

    // apps/web/src/features/roster/RosterTable.tsx
    export function RosterTable({ entries, selectedEntryId, onSelect }: {
      entries: Array<{ id: string; name: string; organizationName: string; status: string; source: string; updatedAt: string }>;
      selectedEntryId: string | null;
      onSelect: (entryId: string) => void;
    }) {
      return (
        <table>
          <thead><tr><th>이름</th><th>조직</th><th>상태</th><th>등록 출처</th><th>최종 수정</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id} aria-selected={selectedEntryId === entry.id} onClick={() => onSelect(entry.id)}><td>{entry.name}</td><td>{entry.organizationName}</td><td>{entry.status}</td><td>{entry.source}</td><td>{entry.updatedAt}</td></tr>)}</tbody>
        </table>
      );
    }

    Keep selected row identity in URL query entry. RosterToolbar owns query, organization, and status state. RosterWorkspace fetches all event entries once and applies filterRoster after the response. RosterDetailsPanel is read-only in this task and renders selected row plus a dedicated region for recent audit history. CSS uses sticky table header, a main-table plus 22rem right panel grid, and RosterMobileList below 960px.

- [ ] **Step 4: Run roster presentation tests**

    Run: pnpm --dir apps/web test --run src/features/roster/RosterTable.test.tsx src/features/roster/RosterWorkspace.test.tsx
    Expected: 130-row table, client filter, selected-row URL, empty/loading/error, and mobile-list tests pass.

- [ ] **Step 5: Commit the roster console presentation**

    git add apps/web/src/features/roster apps/web/src/app/router.tsx
    git commit -m "feat: add roster console"

### Task 14: Add participant selection, roster mutation, conflict resolution, and audit UX

**Files:**
- Create: apps/web/src/features/participants/ParticipantPicker.tsx
- Create: apps/web/src/features/participants/ParticipantCreateForm.tsx
- Create: apps/web/src/features/roster/RosterEntryForm.tsx
- Create: apps/web/src/features/roster/CancelEntryDialog.tsx
- Create: apps/web/src/features/roster/ConflictDialog.tsx
- Create: apps/web/src/features/audit-log/RecentAuditList.tsx
- Create: apps/web/src/features/audit-log/AuditLogPage.tsx
- Create: apps/web/src/features/roster/ConflictDialog.test.tsx
- Create: apps/web/src/features/roster/RosterEntryForm.test.tsx
- Modify: apps/web/src/features/roster/RosterDetailsPanel.tsx
- Modify: apps/web/src/features/roster/api.ts

**Interfaces:**
- Produces: PATCH /events/{eventId}/roster/{entryId} request with revision from selected RosterEntry.
- Produces: ConflictDialog { latestEntry, changedBy, changedAt, onReload, onEditLatest } for ApiProblem code STALE_REVISION.
- Produces: ParticipantPicker search scoped to current user allowed organizations and ParticipantCreateForm for permitted new master records.
- Rule: successful mutation invalidates ["roster", eventId], ["event-summary", eventId], and ["audit", eventId]; mutation failure preserves current form input.

- [ ] **Step 1: Write failing conflict and mutation tests**

    // apps/web/src/features/roster/ConflictDialog.test.tsx
    import { screen } from "@testing-library/react";
    import userEvent from "@testing-library/user-event";
    import { vi } from "vitest";
    import { ConflictDialog } from "./ConflictDialog";
    import { renderWithProviders } from "../../test/render";

    test("shows current writer and opens latest entry for explicit retry", async () => {
      const onEditLatest = vi.fn();
      renderWithProviders(<ConflictDialog latestEntry={{ id: "e1", revision: 4, name: "최신 이름" }} changedBy="운영자" changedAt="2026-06-01T09:00:00Z" onReload={vi.fn()} onEditLatest={onEditLatest} />);
      expect(screen.getByText("운영자")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "최신 내용으로 다시 편집" }));
      expect(onEditLatest).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    });

    // apps/web/src/features/roster/RosterEntryForm.test.tsx
    test("sends current revision and never retries stale mutation automatically", async () => {
      const request = vi.fn().mockRejectedValue({
        code: "STALE_REVISION",
        details: { latestEntry: { id: "e1", revision: 2 }, changedBy: "다른 담당자", changedAt: "2026-06-01T09:00:00Z" },
      });
      renderWithProviders(<RosterEntryForm entry={{ id: "e1", revision: 1, name: "기존" }} request={request} />);
      await userEvent.click(screen.getByRole("button", { name: "저장" }));
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
      expect(screen.getByText("다른 담당자")).toBeInTheDocument();
    });

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: pnpm --dir apps/web test --run src/features/roster/ConflictDialog.test.tsx src/features/roster/RosterEntryForm.test.tsx
    Expected: FAIL because mutation and conflict components are absent.

- [ ] **Step 3: Implement explicit edit actions and audit refresh**

    // apps/web/src/features/roster/ConflictDialog.tsx
    import { Button } from "../../components/ui/Button";

    export function ConflictDialog({ latestEntry, changedBy, changedAt, onReload, onEditLatest }: {
      latestEntry: { id: string; revision: number; name: string };
      changedBy: string;
      changedAt: string;
      onReload: () => void;
      onEditLatest: (entry: { id: string; revision: number; name: string }) => void;
    }) {
      return (
        <section role="alertdialog" aria-label="동시 수정 충돌">
          <p>{changedBy}님이 {changedAt}에 먼저 저장했습니다.</p>
          <Button onClick={onReload}>새로고침</Button>
          <Button onClick={() => onEditLatest(latestEntry)}>최신 내용으로 다시 편집</Button>
        </section>
      );
    }

    // apps/web/src/features/roster/api.ts
    export async function patchRosterEntry(eventId: string, entryId: string, payload: {
      revision: number;
      name?: string;
      organizationId?: string;
      status?: "ACTIVE" | "CANCELLED";
    }) {
      return apiRequest("/api/v1/events/" + eventId + "/roster/" + entryId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    RosterEntryForm uses React Hook Form and Zod to require a nonempty name and one status. CancelEntryDialog confirms before sending CANCELLED; the same PATCH endpoint reactivates with ACTIVE. Hide all edit affordances when event.status is CLOSED. ParticipantPicker queries after two input characters. ParticipantCreateForm sends the selected organizationId, retains values on a 403, and does not claim success. RecentAuditList requests the selected entry’s audit slice and shows actor, timestamp, action, before, after. Organization transfer controls render only for OPERATOR.

- [ ] **Step 4: Run roster mutation and audit UI tests**

    Run: pnpm --dir apps/web test --run src/features/roster/ConflictDialog.test.tsx src/features/roster/RosterEntryForm.test.tsx
    Expected: revision forwarding, no automatic retry, explicit conflict choices, cancel/reactivate, role-aware participant controls, audit refresh, and closed read-only tests pass.

- [ ] **Step 5: Commit interactive roster controls**

    git add apps/web/src/features/participants apps/web/src/features/roster apps/web/src/features/audit-log
    git commit -m "feat: add roster editing and conflict handling"

### Task 15: Implement browser-only Excel import and export

**Files:**
- Create: apps/web/src/features/import/workbook.ts
- Create: apps/web/src/features/import/normalize.ts
- Create: apps/web/src/features/import/validation.ts
- Create: apps/web/src/features/import/ImportWizard.tsx
- Create: apps/web/src/features/import/SheetStep.tsx
- Create: apps/web/src/features/import/MappingStep.tsx
- Create: apps/web/src/features/import/ReviewStep.tsx
- Create: apps/web/src/features/import/ConfirmStep.tsx
- Create: apps/web/src/features/import/ImportWizard.test.tsx
- Create: apps/web/src/features/export/buildWorkbook.ts
- Create: apps/web/src/features/export/downloadExport.ts
- Create: apps/web/src/features/export/ExportButton.tsx
- Create: apps/web/src/features/export/buildWorkbook.test.ts
- Modify: apps/web/src/app/router.tsx

**Interfaces:**
- Produces: readWorkbook(file: File) -> Promise<{ sheets: string[]; rowsBySheet: Record<string, unknown[][]> }>.
- Produces: normalizeRows(rows, mapping, organizations) -> ImportRowInput[] with original rowNumber.
- Produces: /events/:eventId/import four-step focused route sending only JSON rows to validate and commit endpoints.
- Produces: buildWorkbook(EventExportData) -> XLSX.WorkBook with 명단 and 집계.
- Rule: File and ArrayBuffer stay in component memory. No API request, browser persistent store, or D1 column contains raw file bytes or source cell matrix.

- [ ] **Step 1: Write failing import and export tests**

    // apps/web/src/features/import/ImportWizard.test.tsx
    import { screen } from "@testing-library/react";
    import userEvent from "@testing-library/user-event";
    import { ImportWizard } from "./ImportWizard";
    import { renderWithProviders } from "../../test/render";

    test("keeps confirm disabled while one mapped row has an error", async () => {
      renderWithProviders(<ImportWizard eventId="event-1" organizations={[{ id: "org-1", name: "개발팀" }]} />);
      await userEvent.upload(
        screen.getByLabelText("엑셀 파일"),
        new File(["content"], "roster.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      expect(screen.getByRole("button", { name: "전체 확정" })).toBeDisabled();
    });

    // apps/web/src/features/export/buildWorkbook.test.ts
    import * as XLSX from "xlsx";
    import { buildWorkbook } from "./buildWorkbook";

    test("creates roster and summary sheets with required headers", () => {
      const workbook = buildWorkbook({
        event: { title: "2026 상반기 행사" },
        roster: [{ participantNumber: "P-1", name: "홍길동", organizationName: "개발팀", source: "PRE_EVENT", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" }],
        summary: [{ organizationName: "개발팀", expectedCount: 1, dayAdditions: 0, dayCancellations: 0, finalCount: 1 }],
      });
      expect(workbook.SheetNames).toEqual(["명단", "집계"]);
      expect(XLSX.utils.sheet_to_json(workbook.Sheets["명단"], { header: 1 })[0]).toEqual(["참가자 번호", "이름", "행사 당시 조직", "등록 출처", "상태", "최종 수정 시각"]);
    });

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: pnpm --dir apps/web test --run src/features/import/ImportWizard.test.tsx src/features/export/buildWorkbook.test.ts
    Expected: FAIL because import and export modules are absent.

- [ ] **Step 3: Implement four-step import and deterministic workbook output**

    // apps/web/src/features/import/normalize.ts
    export function normalizeRows(
      rows: unknown[][],
      mapping: { nameColumn: number; organizationColumn: number },
      organizations: Array<{ id: string; name: string }>,
    ) {
      const organizationByName = new Map(organizations.map((organization) => [organization.name.trim(), organization.id]));
      return rows.slice(1).map((row, index) => {
        const name = String(row[mapping.nameColumn] ?? "").trim();
        const organizationName = String(row[mapping.organizationColumn] ?? "").trim();
        return {
          rowNumber: index + 2,
          name,
          organizationId: organizationByName.get(organizationName) ?? "",
          participantId: null,
          resolution: "CREATE" as const,
        };
      });
    }

    // apps/web/src/features/export/buildWorkbook.ts
    import * as XLSX from "xlsx";

    export function buildWorkbook(data: {
      event: { title: string };
      roster: Array<{ participantNumber: string; name: string; organizationName: string; source: string; status: string; updatedAt: string }>;
      summary: Array<{ organizationName: string; expectedCount: number; dayAdditions: number; dayCancellations: number; finalCount: number }>;
    }): XLSX.WorkBook {
      const rosterRows = [
        ["참가자 번호", "이름", "행사 당시 조직", "등록 출처", "상태", "최종 수정 시각"],
        ...data.roster.map((row) => [row.participantNumber, row.name, row.organizationName, row.source, row.status, row.updatedAt]),
      ];
      const summaryRows = [
        ["조직", "사전 예상", "당일 추가", "당일 취소", "최종 유효 인원"],
        ...data.summary.map((row) => [row.organizationName, row.expectedCount, row.dayAdditions, row.dayCancellations, row.finalCount]),
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rosterRows), "명단");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "집계");
      return workbook;
    }

    SheetStep reads File.arrayBuffer() and XLSX.read(buffer, { type: "array" }). MappingStep requires distinct name and organization columns and previews five rows. ReviewStep displays local empty-name, unknown-organization, duplicate-row, and API ambiguous-candidate errors with original rowNumber. The user resolves ambiguous candidates by selecting an existing participant or CREATE. ConfirmStep sends validate, enables 전체 확정 only when errors is empty, then sends commit. It clears File, ArrayBuffer, and parsed matrix on cancel, success, or route unmount. ExportButton fetches event-wide export-data, calls buildWorkbook, then XLSX.writeFile(workbook, data.event.title + ".xlsx").

- [ ] **Step 4: Run import/export checks**

    Run: pnpm --dir apps/web test --run src/features/import/ImportWizard.test.tsx src/features/export/buildWorkbook.test.ts && pnpm --dir apps/web check
    Expected: mapping, local/API error display, disabled confirm, JSON-only request, candidate resolution, 명단/집계 headers, and full-event export tests pass.

- [ ] **Step 5: Commit Excel workflows**

    git add apps/web/src/features/import apps/web/src/features/export apps/web/src/app/router.tsx
    git commit -m "feat: add browser Excel import and export"

### Task 16: Build operator administration and archived-event web screens

**Files:**
- Create: apps/web/src/features/admin/OrganizationsPage.tsx
- Create: apps/web/src/features/admin/UsersPage.tsx
- Create: apps/web/src/features/admin/OrganizationForm.tsx
- Create: apps/web/src/features/admin/UserForm.tsx
- Create: apps/web/src/features/admin/PasswordResetDialog.tsx
- Create: apps/web/src/features/admin/AdminRoutes.test.tsx
- Modify: apps/web/src/app/AppShell.tsx
- Modify: apps/web/src/app/router.tsx
- Modify: apps/web/src/features/events/PastEventsPage.tsx

**Interfaces:**
- Produces: /admin/organizations and /admin/users routes visible only to OPERATOR.
- Produces: PasswordResetDialog requiring fresh password confirmation and calling POST /users/{id}/password-reset.
- Consumes: administration endpoints from Task 6 and past event routes from Task 12.
- Rule: non-operators see no admin navigation; direct /admin resolves to an accessible 403 page.

- [ ] **Step 1: Write failing role-gated UI tests**

    // apps/web/src/features/admin/AdminRoutes.test.tsx
    import { screen } from "@testing-library/react";
    import { renderWithProviders } from "../../test/render";
    import { AppShell } from "../../app/AppShell";

    test("hides administration navigation for organization managers", () => {
      renderWithProviders(<AppShell currentUser={{ displayName: "담당자", role: "ORGANIZATION_MANAGER" }}><div>내용</div></AppShell>);
      expect(screen.queryByRole("link", { name: "조직 관리" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "사용자 관리" })).not.toBeInTheDocument();
    });


    test("shows administration navigation for operators", () => {
      renderWithProviders(<AppShell currentUser={{ displayName: "운영자", role: "OPERATOR" }}><div>내용</div></AppShell>);
      expect(screen.getByRole("link", { name: "조직 관리" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "사용자 관리" })).toBeInTheDocument();
    });

- [ ] **Step 2: Run the test and confirm that it fails**

    Run: pnpm --dir apps/web test --run src/features/admin/AdminRoutes.test.tsx
    Expected: FAIL because admin navigation and screens are absent.

- [ ] **Step 3: Implement admin forms and read-only archive cues**

    // apps/web/src/app/AppShell.tsx
    import { Link } from "react-router-dom";

    export function AppShell({ currentUser, children }: {
      currentUser: { displayName: string; role: string };
      children: React.ReactNode;
    }) {
      return (
        <div>
          <nav aria-label="주요 메뉴">
            <Link to="/events">행사</Link>
            <Link to="/events/past">지난 행사</Link>
            {currentUser.role === "OPERATOR" && <Link to="/admin/organizations">조직 관리</Link>}
            {currentUser.role === "OPERATOR" && <Link to="/admin/users">사용자 관리</Link>}
          </nav>
          <main>{children}</main>
        </div>
      );
    }

    OrganizationsPage uses organizations query and modal create/edit form. UsersPage displays email, display name, role, linked organizations, active state, and a password reset control. UserForm renders multi-organization assignment only for ORGANIZATION_MANAGER and never displays password hashes or active session data. PasswordResetDialog requires matching confirmation, sends only newPassword, and displays completion text that all sessions were signed out. PastEventsPage labels CLOSED records 읽기 전용, removes roster edit controls, and retains summary, audit, and ExportButton.

- [ ] **Step 4: Run administrator and archive tests**

    Run: pnpm --dir apps/web test --run src/features/admin/AdminRoutes.test.tsx src/features/events/EventListPage.test.tsx
    Expected: role gating, form validation, reset feedback, direct 403 route, and closed-event read-only tests pass.

- [ ] **Step 5: Commit administration web screens**

    git add apps/web/src/features/admin apps/web/src/app/AppShell.tsx apps/web/src/app/router.tsx apps/web/src/features/events/PastEventsPage.tsx
    git commit -m "feat: add administration screens"

### Task 17: Verify acceptance flows, CI, and Cloudflare deployment operations

**Files:**
- Create: apps/web/e2e/event-lifecycle.spec.ts
- Create: apps/web/e2e/roster-conflict.spec.ts
- Create: apps/web/e2e/import-export.spec.ts
- Create: apps/web/e2e/authorization.spec.ts
- Create: apps/web/playwright.config.ts
- Create: .github/workflows/ci.yml
- Create: docs/operations/deployment.md
- Modify: apps/web/package.json
- Modify: README.md

**Interfaces:**
- Produces: pnpm --dir apps/web e2e, pnpm check, and cd apps/api && uv run pytest as repeatable quality gates.
- Produces: a runbook for same-site domains, Pages build configuration, Worker secrets, D1 migrations, bootstrap, backup/export, reopen, and rollback.
- Consumes: all previous APIs and UI routes.
- Rule: remote deployment commands needing Cloudflare authentication, a D1 database, secrets, or custom domain run only after user authorizes that external state change.

- [ ] **Step 1: Write failing browser acceptance tests**

    // apps/web/e2e/roster-conflict.spec.ts
    import { expect, test } from "@playwright/test";

    test("requires explicit choice after stale roster revision", async ({ page }) => {
      await page.goto("/events/event-1?entry=entry-1");
      await page.getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("alertdialog", { name: "동시 수정 충돌" })).toBeVisible();
      await expect(page.getByRole("button", { name: "최신 내용으로 다시 편집" })).toBeVisible();
    });

    // apps/web/e2e/import-export.spec.ts
    import { expect, test } from "@playwright/test";

    test("blocks invalid import and downloads two-sheet export", async ({ page }) => {
      await page.goto("/events/event-1/import");
      await expect(page.getByRole("button", { name: "전체 확정" })).toBeDisabled();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "엑셀 내보내기" }).click();
      expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
    });

- [ ] **Step 2: Run the tests and confirm that they fail**

    Run: pnpm --dir apps/web exec playwright test
    Expected: FAIL because Playwright configuration and route fixtures are absent.

- [ ] **Step 3: Implement CI, route-backed acceptance fixtures, and operations documentation**

    // apps/web/playwright.config.ts
    import { defineConfig } from "@playwright/test";

    export default defineConfig({
      testDir: "./e2e",
      use: { baseURL: "http://127.0.0.1:4173" },
      webServer: {
        command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173",
        port: 4173,
        reuseExistingServer: true,
      },
    });

    # .github/workflows/ci.yml
    name: CI
    on:
      push:
      pull_request:
    jobs:
      verify:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: pnpm/action-setup@v4
            with:
              version: 11.9.0
          - uses: actions/setup-node@v4
            with:
              node-version: 24.7.0
              cache: pnpm
          - uses: astral-sh/setup-uv@v5
          - run: pnpm install --frozen-lockfile
          - run: cd apps/api && uv sync --all-groups
          - run: pnpm check
          - run: pnpm --dir apps/web exec playwright install --with-deps chromium
          - run: pnpm --dir apps/web exec playwright test

    // apps/web/package.json additions
    {
      "scripts": {
        "e2e": "playwright test"
      },
      "devDependencies": {
        "@playwright/test": "^1.52.0"
      }
    }

    Each Playwright spec uses page.route for API response fixtures; FastAPI integration tests remain responsible for actual authorization and database behavior. event-lifecycle.spec covers create, DRAFT -> PRE_REGISTRATION -> DAY_OF -> CLOSED, and reopen. authorization.spec covers organization-manager navigation and API 403 visual state. import-export.spec creates a small XLSX buffer in the browser, verifies an error blocks commit, then inspects downloaded workbook sheet names with SheetJS.

    deployment.md must require these outcomes: create D1 event-roster-db and put its generated UUID into the tracked binding; set JWT_SECRET, RATE_LIMIT_SECRET, temporary BOOTSTRAP_SECRET, and exact WEB_ORIGIN; apply migrations with uv run pywrangler d1 migrations apply event-roster-db --remote before API deploy; deploy API with uv run pywrangler deploy; deploy Pages from apps/web; map api.<domain> and app.<domain> under one registrable domain; set VITE_API_BASE_URL at Pages build time; verify credentialed GET /auth/me and mutation preflight; use bootstrap once then remove BOOTSTRAP_SECRET; retain event exports outside the service as operational backups; perform database migrations append-only and roll back code only after schema compatibility review.

- [ ] **Step 4: Run complete verification**

    Run: pnpm check
    Expected: contracts, web typecheck, web unit tests, and API unit/integration tests pass.

    Run: pnpm --dir apps/web exec playwright test
    Expected: lifecycle, authorization, stale revision, invalid import, and XLSX download acceptance tests pass.

    Run: git diff --check && git status --short
    Expected: no whitespace errors; only intentionally staged files remain before final commit.

- [ ] **Step 5: Commit operational readiness**

    git add apps/web/e2e apps/web/playwright.config.ts .github/workflows/ci.yml docs/operations/deployment.md apps/web/package.json README.md pnpm-lock.yaml
    git commit -m "chore: add deployment and acceptance checks"

## Coverage check

| Approved requirement | Implementing tasks |
| --- | --- |
| Worker Free compatibility, FastAPI, D1, secure own accounts | 1, 2, 3, 5, 17 |
| Operator and organization-manager roles | 4, 5, 6, 8, 11, 16, 17 |
| H1/H2 event creation, lifecycle, close, reopen | 4, 7, 12, 17 |
| Reusable participant master and immutable historical snapshots | 3, 6, 8 |
| Pre-event expected snapshots and day-of final counts | 4, 7, 8, 12, 13 |
| Add, cancel, edit, reactivate, optimistic locking | 8, 13, 14, 17 |
| Append-only audit and security logging | 3, 5, 8, 9, 14 |
| Client-only Excel import with all-or-nothing commit | 9, 15, 17 |
| Event-wide Excel export with 명단 and 집계 sheets | 9, 15, 16, 17 |
| Hybrid console, 130-row full table, responsive cards | 11, 12, 13, 14 |
| Cloudflare Pages/Worker deployment and same-site cookie posture | 5, 11, 17 |

## Final implementation verification checklist

- Task 1 records a real deployed pass before any production feature task begins.
- API mutation tests assert exact 403, 409, or 422 behavior and show no forbidden partial record.
- Frontend mutation tests use generated contract types and credentialed fetch.
- One operator can create an H1 event, a manager edits only its organization, and a stale editor resolves a conflict explicitly.
- A 130-row import either creates participants, roster, audits, and import run together or leaves every one unchanged.
- A CLOSED event remains viewable, auditable, and exportable while refusing edits.
- No raw password, JWT, uploaded Excel file, or original Excel cell matrix appears in D1, application logs, audit logs, frontend persistent storage, or export output.
