# Cloudflare Production Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `event-roster`를 Cloudflare Workers Free와 새 D1 운영 데이터베이스에 최초 배포하고, 이후 `main` push는 자동 배포하되 D1 migration은 수동 승인으로만 실행되게 한다.

**Architecture:** 프론트 정적 자산과 Hono API를 하나의 `event-roster` Worker에서 같은 `workers.dev` origin으로 제공하고, 운영 데이터는 새 `event-roster` D1 하나에 저장한다. 첫 D1 migration·Secret 등록·운영자 인계는 로컬 Wrangler OAuth 세션으로 완료한 뒤, GitHub `production` environment에 최소 권한 Cloudflare 자격 증명을 넣어 코드 배포와 데이터 migration 워크플로를 분리한다.

**Tech Stack:** Cloudflare Workers, D1, Wrangler 4.112.0, TypeScript, Hono, React/Vite, pnpm 10.28.1, Node.js 22, GitHub Actions `ubuntu-latest`

## Global Constraints

- Cloudflare Account ID는 `dadc085d94e111ad3effd04a57b33cb9`만 사용한다.
- Worker 이름은 `event-roster`, 운영 D1 이름도 `event-roster`, 운영 브랜치는 `main`이다.
- 기존 D1 `event-roster-capability`는 유지하고 운영 binding으로 사용하지 않는다.
- 커스텀 도메인, Cloudflare Pages, Cloudflare Access, Google Cloud, VM, staging 환경을 추가하지 않는다.
- 운영 URL은 첫 배포가 출력한 정확한 HTTPS `workers.dev` origin이며 경로와 마지막 `/`를 포함하지 않는다.
- `main` push는 검증 후 Worker 코드를 자동 배포하지만 D1 migration을 실행하지 않는다.
- D1 migration은 `workflow_dispatch`로만 실행하며, 대상 이름과 `main` commit SHA를 실행자가 확인한다.
- GitHub Actions에는 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`만 저장한다.
- `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `IP_HASH_KEY`, `RECOVERY_CODE_PEPPER`, `BOOTSTRAP_TOKEN`은 Cloudflare Worker Secret으로만 저장한다.
- `BOOTSTRAP_TOKEN`은 최초 운영자 인계와 재로그인 확인 직후 삭제한다.
- Secret, 비밀번호, JWT, CSRF, 복구 코드, D1 export를 Git·로그·명령 인자·Actions artifact에 기록하지 않는다.
- 표준 `ubuntu-latest` runner만 사용하고 larger runner, 유료 Actions, 장기 artifact를 사용하지 않는다.
- 공개 저장소 `Mr-DooSun/event-roster`를 유지하고 GitHub·Cloudflare의 유료 예산은 0으로 유지한다.
- 실제 원격 생성·migration·Secret·배포 작업 직전에는 `wrangler whoami`로 계정을 다시 확인한다.

---

## File Structure

- Create: `.github/workflows/deploy-production.yml` — `main` 검증과 Worker 자동 배포만 담당한다.
- Create: `.github/workflows/migrate-production.yml` — 수동 D1 migration과 사후 무결성 조회만 담당한다.
- Modify: `apps/worker/wrangler.jsonc` — 실제 운영 D1 binding과 확정된 `APP_ORIGIN`을 담는 비밀 없는 운영 설정이다.
- Modify: `docs/operations/deployment.md` — 최초 연결, GitHub environment 구성, 자동 배포 운영 절차를 하나의 runbook으로 정리한다.
- Modify: `docs/operations/monthly-check.md` — 저빈도 서비스의 월간 로그인·사용량·복구 준비 점검을 기록한다.
- Modify: `docs/operations/recovery.md` — 코드 rollback과 D1 migration 실패를 분리한 복구 절차를 명시한다.

### Task 1: Worker 자동 배포 워크플로

**Files:**
- Create: `.github/workflows/deploy-production.yml`
- Reference: `.github/workflows/ci.yml`
- Reference: `.nvmrc`
- Reference: `package.json`

**Interfaces:**
- Consumes: GitHub `production` environment의 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Produces: `main` push 또는 수동 실행 시 검증을 모두 통과한 `event-roster` Worker 배포

- [ ] **Step 1: 격리 worktree를 만든다**

`superpowers:using-git-worktrees` 스킬을 사용해 `codex/cloudflare-production-delivery` 브랜치용 worktree를 만든다. 이후 모든 파일 변경은 그 worktree에서 수행한다.

Run:

```bash
git status --short --branch
git worktree list
```

Expected: 현재 `main`이 `origin/main`보다 설계 commit 하나 앞서 있고, 추적하지 않는 `.DS_Store`와 `.pnpm-store/`는 그대로 보존된다.

- [ ] **Step 2: 워크플로 부재 검사를 실행해 실패를 확인한다**

Run:

```bash
test -f .github/workflows/deploy-production.yml
```

Expected: exit code `1`.

- [ ] **Step 3: 자동 배포 워크플로를 작성한다**

Create `.github/workflows/deploy-production.yml`:

```yaml
name: Deploy production

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-worker
  cancel-in-progress: true

jobs:
  deploy:
    name: Verify and deploy Worker
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: corepack pnpm@10.28.1 install --frozen-lockfile

      - name: Install Chromium
        run: corepack pnpm@10.28.1 --filter @event-roster/web exec playwright install --with-deps chromium

      - name: Run unit and integration tests
        run: corepack pnpm@10.28.1 test

      - name: Run type checks
        run: corepack pnpm@10.28.1 check

      - name: Check formatting
        run: corepack pnpm@10.28.1 format:check

      - name: Build web assets
        run: corepack pnpm@10.28.1 --filter @event-roster/web build

      - name: Run browser end-to-end tests
        run: corepack pnpm@10.28.1 --filter @event-roster/web run e2e

      - name: Validate Worker bundle
        run: corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run

      - name: Deploy production Worker
        run: corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
```

This workflow deliberately contains no `wrangler d1 migrations` command and uploads no artifact.

- [ ] **Step 4: 정적 안전 검사를 실행한다**

Run:

```bash
test "$(grep -c 'workflow_dispatch' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'branches: \\[main\\]' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'ubuntu-latest' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'timeout-minutes: 30' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'cancel-in-progress: true' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'wrangler deploy$' .github/workflows/deploy-production.yml)" -eq 1
test "$(grep -c 'wrangler d1 migrations' .github/workflows/deploy-production.yml || true)" -eq 0
test "$(grep -c 'upload-artifact' .github/workflows/deploy-production.yml || true)" -eq 0
git diff --check
```

Expected: 모든 명령이 exit code `0`이고 출력이 없다.

- [ ] **Step 5: 로컬 검증을 실행한다**

Run:

```bash
corepack pnpm@10.28.1 install --frozen-lockfile
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: test, typecheck, format, build, Worker dry-run이 모두 exit code `0`; dry-run 출력의 Worker 이름이 `event-roster`이고 gzip bundle이 Workers Free 제한 이하다.

- [ ] **Step 6: 자동 배포 워크플로를 commit한다**

```bash
git add .github/workflows/deploy-production.yml
git commit -m "ci: add production Worker deployment"
```

Expected: commit 하나가 생성되고 사용자 소유의 추적하지 않는 파일은 포함되지 않는다.

### Task 2: 수동 D1 migration 워크플로

**Files:**
- Create: `.github/workflows/migrate-production.yml`
- Reference: `apps/worker/migrations/0001_initial.sql`
- Reference: `apps/worker/migrations/0002_project_model.sql`
- Reference: `apps/worker/migrations/0003_organization_leadership.sql`

**Interfaces:**
- Consumes: `target_database: "event-roster"`, 실행 시점 `main_sha`, `data_state`, 기존 데이터이면 64자리 SHA-256
- Produces: 수동 승인된 remote migration과 `foreign_key_check`·조직 역할 무결성 결과

- [ ] **Step 1: 워크플로 부재 검사를 실행해 실패를 확인한다**

Run:

```bash
test -f .github/workflows/migrate-production.yml
```

Expected: exit code `1`.

- [ ] **Step 2: 수동 migration 워크플로를 작성한다**

Create `.github/workflows/migrate-production.yml`:

```yaml
name: Migrate production D1

on:
  workflow_dispatch:
    inputs:
      target_database:
        description: Type the exact production D1 name
        required: true
        type: string
      main_sha:
        description: Type the current full 40-character main commit SHA
        required: true
        type: string
      data_state:
        description: Confirm whether the D1 is empty or has an external verified backup
        required: true
        type: choice
        options:
          - initial-empty
          - existing-backed-up
      backup_sha256:
        description: For existing-backed-up, enter the verified 64-character SHA-256
        required: false
        type: string

permissions:
  contents: read

concurrency:
  group: production-d1-migration
  cancel-in-progress: false

jobs:
  migrate:
    name: Apply approved D1 migrations
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      TARGET_DATABASE: ${{ inputs.target_database }}
      CONFIRMED_MAIN_SHA: ${{ inputs.main_sha }}
      DATA_STATE: ${{ inputs.data_state }}
      BACKUP_SHA256: ${{ inputs.backup_sha256 }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: corepack pnpm@10.28.1 install --frozen-lockfile

      - name: Validate explicit approval inputs
        shell: bash
        run: |
          set -euo pipefail
          test "$TARGET_DATABASE" = "event-roster"
          test "$CONFIRMED_MAIN_SHA" = "$(git rev-parse HEAD)"
          case "$DATA_STATE" in
            initial-empty)
              test -z "$BACKUP_SHA256"
              ;;
            existing-backed-up)
              [[ "$BACKUP_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]
              ;;
            *)
              exit 1
              ;;
          esac

      - name: Verify an initial database is empty
        if: inputs.data_state == 'initial-empty'
        shell: bash
        run: |
          set -euo pipefail
          corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --json --command \
            "SELECT COUNT(*) AS application_table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'" \
            > "$RUNNER_TEMP/d1-empty-check.json"
          node --input-type=module -e '
            import { readFileSync } from "node:fs";
            const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
            const rows = Array.isArray(payload) ? payload : [payload];
            const count = rows[0]?.results?.[0]?.application_table_count;
            if (count !== 0) throw new Error(`Expected an empty D1, found ${String(count)} application tables`);
          ' "$RUNNER_TEMP/d1-empty-check.json"

      - name: List pending migrations
        run: corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations list event-roster --remote

      - name: Apply migrations
        run: corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations apply event-roster --remote

      - name: Check foreign keys
        shell: bash
        run: |
          set -euo pipefail
          corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --json --command \
            "PRAGMA foreign_key_check" > "$RUNNER_TEMP/d1-foreign-key-check.json"
          node --input-type=module -e '
            import { readFileSync } from "node:fs";
            const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
            const rows = Array.isArray(payload) ? payload : [payload];
            const violations = rows.flatMap((entry) => entry.results ?? []);
            if (violations.length !== 0) throw new Error(`Found ${violations.length} foreign-key violations`);
          ' "$RUNNER_TEMP/d1-foreign-key-check.json"

      - name: Check organization assignments
        shell: bash
        run: |
          set -euo pipefail
          corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --command \
            "SELECT assignment_role, COUNT(*) AS assignment_count FROM user_organizations GROUP BY assignment_role"
          corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --json --command \
            "SELECT organization_id, COUNT(*) AS primary_count FROM user_organizations WHERE assignment_role = 'PRIMARY_LEADER' GROUP BY organization_id HAVING COUNT(*) > 1" \
            > "$RUNNER_TEMP/d1-primary-leader-check.json"
          node --input-type=module -e '
            import { readFileSync } from "node:fs";
            const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
            const rows = Array.isArray(payload) ? payload : [payload];
            const duplicates = rows.flatMap((entry) => entry.results ?? []);
            if (duplicates.length !== 0) throw new Error(`Found ${duplicates.length} organizations with duplicate primary leaders`);
          ' "$RUNNER_TEMP/d1-primary-leader-check.json"
```

The temporary JSON files remain only in `$RUNNER_TEMP`; no artifact upload step exists.

- [ ] **Step 3: migration 전용 안전 검사를 실행한다**

Run:

```bash
test "$(grep -c 'workflow_dispatch' .github/workflows/migrate-production.yml)" -eq 1
test "$(grep -c '^  push:' .github/workflows/migrate-production.yml || true)" -eq 0
test "$(grep -c '^  pull_request:' .github/workflows/migrate-production.yml || true)" -eq 0
test "$(grep -c 'cancel-in-progress: false' .github/workflows/migrate-production.yml)" -eq 1
test "$(grep -c 'target_database' .github/workflows/migrate-production.yml)" -ge 2
test "$(grep -c 'main_sha' .github/workflows/migrate-production.yml)" -ge 2
test "$(grep -c 'existing-backed-up' .github/workflows/migrate-production.yml)" -ge 2
test "$(grep -c 'upload-artifact' .github/workflows/migrate-production.yml || true)" -eq 0
test "$(grep -c 'wrangler deploy' .github/workflows/migrate-production.yml || true)" -eq 0
git diff --check
```

Expected: 모든 명령이 exit code `0`이고 출력이 없다.

- [ ] **Step 4: migration 워크플로를 commit한다**

```bash
git add .github/workflows/migrate-production.yml
git commit -m "ci: add manual production D1 migrations"
```

Expected: migration workflow만 포함한 commit이 생성된다.

### Task 3: 새 운영 D1 생성과 비밀 없는 Worker 설정

**Files:**
- Modify: `apps/worker/wrangler.jsonc`
- Generated: `apps/worker/worker-configuration.d.ts`

**Interfaces:**
- Consumes: Cloudflare 계정 `dadc085d94e111ad3effd04a57b33cb9`, D1 이름 `event-roster`
- Produces: `DB` binding의 실제 UUID와 첫 배포가 출력한 정확한 `APP_ORIGIN`

- [ ] **Step 1: 원격 계정과 기존 자원을 읽기 전용으로 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler whoami
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 list
```

Expected: 계정 ID가 `dadc085d94e111ad3effd04a57b33cb9`; 기존 `event-roster-capability`는 보이지만 `event-roster` 운영 D1은 아직 없다. 이미 `event-roster`가 있다면 새로 만들지 말고 database ID와 생성 경위를 확인한 뒤 중단한다.

- [ ] **Step 2: 운영 D1을 만들고 설정을 Wrangler로 갱신한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 create event-roster --location apac --binding DB --update-config
```

Expected: 새 D1 이름 `event-roster`와 실제 UUID가 출력되고 `apps/worker/wrangler.jsonc`에 `d1_databases` 배열이 추가된다.

- [ ] **Step 3: binding이 정확한지 검증한다**

Run:

```bash
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const text = readFileSync("apps/worker/wrangler.jsonc", "utf8");
  if (!/"binding"\s*:\s*"DB"/.test(text)) throw new Error("DB binding missing");
  if (!/"database_name"\s*:\s*"event-roster"/.test(text)) throw new Error("production database name missing");
  const match = text.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/);
  if (!match || match[1] === "00000000-0000-0000-0000-000000000000") throw new Error("real production database UUID missing");
  if (text.includes("event-roster-capability")) throw new Error("capability database must not be bound");
'
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 list
```

Expected: 검증 script가 exit code `0`; D1 목록에 서로 다른 `event-roster`와 `event-roster-capability`가 보인다.

- [ ] **Step 4: 신규 빈 D1에 migration을 적용한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations list event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --command "PRAGMA foreign_key_check"
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --command "SELECT name FROM d1_migrations ORDER BY id"
```

Expected: `0001_initial.sql`, `0002_project_model.sql`, `0003_organization_leadership.sql`이 모두 적용된다; `PRAGMA foreign_key_check`는 행을 반환하지 않는다; 마지막 조회가 migration 세 개를 순서대로 반환한다.

- [ ] **Step 5: 운영 Worker Secret 5개를 대화형으로 등록한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run secrets:remote
```

Expected: 실행자가 정확히 `event-roster`를 확인한 후 Secret 다섯 개가 등록되고, bootstrap token만 Git에서 제외된 `apps/worker/.bootstrap-token.tmp` mode `0600` 파일에 남는다. Secret 값은 터미널에 출력되지 않는다.

- [ ] **Step 6: Web을 빌드하고 첫 Worker를 수동 배포한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
```

Expected: 배포 성공과 정확한 HTTPS `workers.dev` URL이 출력된다. 출력된 origin을 대화형 셸 변수에 입력하되 Git에 쓰기 전에는 경로, query, fragment, 마지막 `/`가 없는지 확인한다.

- [ ] **Step 7: 출력된 origin을 운영 설정에 반영한다**

Run:

```bash
printf '%s' '첫 배포가 출력한 정확한 HTTPS workers.dev origin: '
IFS= read -r EVENT_ROSTER_APP_ORIGIN
EVENT_ROSTER_APP_ORIGIN="$EVENT_ROSTER_APP_ORIGIN" node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const path = "apps/worker/wrangler.jsonc";
  const origin = process.env.EVENT_ROSTER_APP_ORIGIN;
  if (!origin) throw new Error("origin is required");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".workers.dev") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    origin.endsWith("/")
  ) throw new Error("exact workers.dev origin is required");
  const text = readFileSync(path, "utf8");
  const next = text.replace(
    /(\s*"triggers"\s*:)/,
    `\n  "vars": { "APP_ORIGIN": ${JSON.stringify(origin)} },$1`,
  );
  if (next === text || (next.match(/"APP_ORIGIN"/g) ?? []).length !== 1) {
    throw new Error("failed to insert APP_ORIGIN exactly once");
  }
  writeFileSync(path, next);
'
corepack pnpm@10.28.1 --filter @event-roster/worker run types
corepack pnpm@10.28.1 --filter @event-roster/worker run check
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
```

Expected: `APP_ORIGIN`이 정확히 한 번 추가되고 타입 생성·check·dry-run·두 번째 배포가 모두 성공한다.

- [ ] **Step 8: 운영 설정을 commit한다**

```bash
git add apps/worker/wrangler.jsonc apps/worker/worker-configuration.d.ts
git commit -m "chore: bind production Cloudflare resources"
```

Expected: 실제 D1 UUID와 비밀이 아닌 `APP_ORIGIN`만 commit되며 `.bootstrap-token.tmp`는 포함되지 않는다.

### Task 4: 최초 운영자 인계와 bootstrap 폐기

**Files:**
- Read: `apps/worker/scripts/bootstrap-remote.mts`
- Read: `apps/worker/scripts/smoke-remote.mts`
- Temporary ignored file: `apps/worker/.bootstrap-token.tmp`

**Interfaces:**
- Consumes: Task 3의 확정된 `workers.dev` origin과 임시 `BOOTSTRAP_TOKEN`
- Produces: 비-bootstrap 영문 로그인 ID 운영자, 변경된 비밀번호, 폐기된 bootstrap route

- [ ] **Step 1: bootstrap helper를 대화형으로 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run bootstrap:remote
```

Expected: 사용자가 정확한 운영 origin, 초기 영문 로그인 ID, 표시 이름, 숨김 비밀번호를 입력한다; bootstrap이 `201`로 성공하고 임시 token 파일이 삭제된다. 초기 비밀번호와 응답의 민감값은 로그에 남지 않는다.

- [ ] **Step 2: 브라우저에서 운영자 인계를 완료한다**

정확한 운영 URL을 브라우저로 열어 bootstrap 계정으로 로그인한다. 계정 화면에서 별도의 영문 로그인 ID 운영자를 한 명 만들고, 생성된 임시 비밀번호를 즉시 변경한 뒤 명시적으로 로그아웃하고 새 비밀번호로 다시 로그인한다.

Expected:

- bootstrap 공용 계정은 다른 계정 생성 이후 로그인할 수 없다.
- 새 운영자는 비밀번호 변경 후 로그아웃되고 새 비밀번호로 재로그인할 수 있다.
- 운영자에게만 `조직 관리`가 보인다.
- 비밀번호와 복구 코드는 승인된 오프라인 저장소에만 기록된다.

- [ ] **Step 3: bootstrap Secret을 영구 삭제한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler secret delete BOOTSTRAP_TOKEN
test ! -e apps/worker/.bootstrap-token.tmp
```

Expected: Wrangler가 Secret 삭제를 확인하고 임시 파일이 존재하지 않는다.

- [ ] **Step 4: 삭제된 bootstrap route와 기본 인증 smoke를 확인한다**

운영 URL, 새 운영자 로그인 ID, 비밀번호를 shell history에 남기지 않도록 현재 셸에서 대화형으로 입력한다.

Run:

```bash
printf '%s' '운영 HTTPS origin: '
IFS= read -r SMOKE_BASE_URL
printf '%s' '새 운영자 영문 로그인 ID: '
IFS= read -r SMOKE_LOGIN_ID
printf '%s' '새 운영자 비밀번호: '
stty -echo
IFS= read -r SMOKE_PASSWORD
stty echo
printf '\n'
export SMOKE_BASE_URL SMOKE_LOGIN_ID SMOKE_PASSWORD
corepack pnpm@10.28.1 --filter @event-roster/worker run smoke:remote
unset SMOKE_BASE_URL SMOKE_LOGIN_ID SMOKE_PASSWORD
```

Expected: `Remote low-frequency smoke passed.`; 올바른 로그인, 잘못된 비밀번호, 없는 ID, refresh rotation, logout 폐기가 모두 검증된다.

### Task 5: GitHub production environment와 자동 배포 활성화

**Files:**
- Uses: `.github/workflows/deploy-production.yml`
- Uses: `.github/workflows/migrate-production.yml`

**Interfaces:**
- Consumes: 최소 권한 Cloudflare API token, Account ID `dadc085d94e111ad3effd04a57b33cb9`
- Produces: GitHub `production` environment와 `main` 자동 배포

- [ ] **Step 1: Cloudflare API token을 최소 권한으로 발급한다**

Cloudflare Dashboard의 API Tokens에서 전용 token을 만든다.

Exact permissions:

- Account / Workers Scripts / Edit
- Account / D1 / Edit
- Account Resources / Include / `Shread.gpt.2001@gmail.com's Account`

Expected: token은 생성 화면에서 한 번만 확인하며 파일, clipboard 기록 문서, shell history에 저장하지 않는다. 로컬 Wrangler OAuth token은 재사용하지 않는다.

- [ ] **Step 2: GitHub `production` environment를 만든다**

Run:

```bash
gh api --method PUT repos/Mr-DooSun/event-roster/environments/production
```

Expected: HTTP 성공 응답에 environment 이름 `production`이 포함된다.

- [ ] **Step 3: GitHub environment secrets를 대화형으로 등록한다**

Run:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production --repo Mr-DooSun/event-roster
printf '%s' 'dadc085d94e111ad3effd04a57b33cb9' | gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo Mr-DooSun/event-roster
gh secret list --env production --repo Mr-DooSun/event-roster
```

Expected: 첫 명령은 token을 숨김 입력으로 받고, 목록에는 이름이 정확히 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`인 두 Secret만 보인다. 값은 표시되지 않는다.

- [ ] **Step 4: feature branch 전체를 검증한다**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
git diff --check
git status --short
```

Expected: 모든 검증이 성공하고 status에는 의도한 commit 외 사용자 소유 파일이 staging되지 않는다.

- [ ] **Step 5: `main`에 로컬 병합하고 push해 자동 배포를 시작한다**

`superpowers:finishing-a-development-branch`와 `superpowers:verification-before-completion`을 사용한다. 사용자 요청이 이미 로컬 병합과 push를 승인한 실행 세션이면 다음 명령을 사용한다.

Run from the primary checkout:

```bash
git switch main
git merge --ff-only codex/cloudflare-production-delivery
git push origin main
```

Expected: fast-forward merge와 push가 성공하고 `Deploy production` workflow가 자동 시작된다.

- [ ] **Step 6: 자동 배포 실행을 끝까지 확인한다**

Run:

```bash
gh run list --workflow deploy-production.yml --branch main --limit 1
gh run watch "$(gh run list --workflow deploy-production.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: `Verify and deploy Worker` job의 test, check, format, build, E2E, dry-run, deploy 단계가 모두 성공한다.

- [ ] **Step 7: 수동 migration workflow의 입력 guard만 검증한다**

실제 pending migration이 없으므로 migration을 재적용하지 않는다. GitHub Actions 화면에서 `Migrate production D1`이 수동 실행 전용이고 네 입력 필드가 보이는지 확인한다. 잘못된 `target_database` 또는 잘못된 SHA로 실행하는 파괴 없는 negative test는 `Validate explicit approval inputs` 단계에서 실패해야 한다.

Expected: `main` push로 migration workflow가 실행되지 않고, 잘못된 입력 실행은 migration 단계 전에 실패한다.

### Task 6: 운영 문서와 최종 운영 smoke

**Files:**
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/monthly-check.md`
- Modify: `docs/operations/recovery.md`

**Interfaces:**
- Consumes: 확정된 운영 URL, Worker/D1/GitHub workflow 운영 방식
- Produces: 다른 운영자가 그대로 따라 할 수 있는 배포·월간 점검·복구 runbook

- [ ] **Step 0: primary checkout의 동기화된 `main`에서 시작한다**

Run:

```bash
cd /Users/coursemos/develop/event-roster
git switch main
git pull --ff-only origin main
```

Expected: Task 5에서 push한 자동 배포·migration workflow와 운영 Worker 설정을 포함한 `main`이며 `Already up to date.`가 출력된다.

- [ ] **Step 1: 문서의 누락 상태를 확인한다**

Run:

```bash
grep -n 'deploy-production.yml' docs/operations/deployment.md
grep -n 'migrate-production.yml' docs/operations/deployment.md
grep -n 'GitHub Actions' docs/operations/monthly-check.md
grep -n 'Worker version' docs/operations/recovery.md
```

Expected: 최소 한 명령이 exit code `1`; 자동 배포 운영 절차가 아직 완전하지 않다.

- [ ] **Step 2: 배포 runbook에 자동 배포 절차를 추가한다**

Append these exact operational rules to `docs/operations/deployment.md` under a new `## GitHub Actions 운영 배포` section:

```markdown
## GitHub Actions 운영 배포

- `main` push는 `.github/workflows/deploy-production.yml`을 실행한다.
- 자동 배포는 test, typecheck, format, Web build, browser E2E, Worker dry-run이 모두 성공한 뒤에만 `event-roster` Worker를 배포한다.
- 자동 배포는 D1 migration을 실행하지 않는다.
- D1 schema 변경은 저장소 밖 mode 0700 디렉터리에 export와 SHA-256을 확보한 뒤 `.github/workflows/migrate-production.yml`을 수동 실행한다.
- migration 실행자는 대상 이름 `event-roster`, 현재 `main`의 40자리 SHA, 데이터 상태를 직접 입력한다.
- GitHub에는 Cloudflare API token과 Account ID만 두고 애플리케이션 Secret은 Cloudflare Worker Secret으로만 관리한다.
- D1 export와 점검 JSON을 Actions artifact로 올리지 않는다.
- workflow 실패 시 동일 commit을 반복 배포하지 말고 실패한 검증 또는 Cloudflare 오류를 먼저 해결한다.
```

Also replace any first-deploy URL notation in the final-state section with the exact committed `APP_ORIGIN` value read from `apps/worker/wrangler.jsonc`.

- [ ] **Step 3: 월간 점검 문서에 무료 사용량과 자동 배포 확인을 추가한다**

Add these checklist items to `docs/operations/monthly-check.md`:

```markdown
- [ ] GitHub 저장소가 public이고 최근 workflow가 `ubuntu-latest` 표준 runner만 사용했는지 확인한다.
- [ ] GitHub Actions budget과 Cloudflare Workers/D1 사용량에 유료 청구 또는 초과 경고가 없는지 확인한다.
- [ ] 운영 URL에서 새 운영자 계정 로그인·명시적 로그아웃·재로그인을 확인한다.
- [ ] Cloudflare Worker Trigger에 `0 15 * * *` Cron 하나만 있는지 확인한다.
- [ ] 저장소 밖 최신 D1 백업의 SHA-256을 재검증하고 격리 D1 복원 절차를 읽어 실행 가능성을 확인한다.
- [ ] `BOOTSTRAP_TOKEN`이 Worker Secret 목록에 다시 생기지 않았는지 확인한다.
```

- [ ] **Step 4: 복구 문서에 코드와 데이터 실패를 분리해 추가한다**

Add this decision rule to `docs/operations/recovery.md`:

```markdown
## GitHub Actions 배포 실패

- test, typecheck, format, build, E2E, dry-run 실패는 원격 Worker를 변경하지 않으므로 코드 수정 후 새 commit으로 다시 실행한다.
- Worker deploy 뒤 애플리케이션 smoke가 실패하면 Cloudflare의 직전 정상 Worker version으로 rollback한다.
- D1 migration 실패에는 Worker 재배포나 binding 변경을 사용하지 않는다. migration 실행을 중단하고 검증된 저장소 밖 export를 새 격리 D1에 복원해 무결성을 확인한다.
- 운영 D1을 직접 삭제하거나 `event-roster-capability`로 binding을 바꾸지 않는다.
```

- [ ] **Step 5: 문서와 구현의 일치를 검증한다**

Run:

```bash
grep -n 'deploy-production.yml' docs/operations/deployment.md
grep -n 'migrate-production.yml' docs/operations/deployment.md
grep -n 'ubuntu-latest' docs/operations/monthly-check.md
grep -n 'BOOTSTRAP_TOKEN' docs/operations/monthly-check.md
grep -n 'D1 migration 실패' docs/operations/recovery.md
git diff --check
```

Expected: 모든 grep이 해당 새 규칙을 한 번 이상 출력하고 `git diff --check`가 성공한다.

- [ ] **Step 6: 운영 문서를 commit하고 push한다**

```bash
git add docs/operations/deployment.md docs/operations/monthly-check.md docs/operations/recovery.md
git commit -m "docs: document automated production operations"
git push origin main
```

Expected: 문서 commit이 `main`에 push되고 자동 배포 workflow가 다시 성공한다.

- [ ] **Step 7: 최종 API와 역할 흐름을 smoke test한다**

정확한 운영 URL에서 다음을 순서대로 수행한다.

1. 새 운영자로 로그인한다.
2. 프로젝트 하나와 조직 하나를 만든다.
3. 조직 대표 한 명과 추가 관리자 한 명을 배정한다.
4. 조직 대표 계정으로 `PRE_REGISTRATION` 참가자 한 명을 추가한다.
5. 프로젝트를 `IN_PROGRESS`로 전환하고 조직 대표에게 명단이 읽기 전용인지 확인한다.
6. 운영자로 참가자 변경과 감사 이력을 확인한다.
7. 테스트 데이터는 감사 이력을 보존하는 정상 UI 작업으로 비활성화하거나 명확히 `운영 배포 smoke`라고 이름을 남긴다.

Expected: 운영자는 전체 조직·사용자·프로젝트를 관리하고, 조직 대표/추가 관리자는 배정 조직의 사전 명단만 수정하며, 진행 중에는 읽기 전용이고 모든 변경 감사 이력이 남는다.

- [ ] **Step 8: 최종 원격·비용·Secret 상태를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deployments list
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 list
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler secret list
gh run list --workflow deploy-production.yml --branch main --limit 3
gh secret list --env production --repo Mr-DooSun/event-roster
git status --short --branch
```

Expected:

- 최신 Worker deployment가 최종 `main` SHA와 일치한다.
- 운영 D1 `event-roster`가 실제 binding UUID로 존재한다.
- Worker Secret 목록에 네 영구 Secret만 있고 `BOOTSTRAP_TOKEN`은 없다.
- GitHub environment에는 Cloudflare credential 두 개만 있다.
- 최근 자동 배포가 성공했다.
- branch가 `main...origin/main`으로 동기화되어 있고 사용자 소유 untracked 파일만 남는다.

- [ ] **Step 9: 완료 근거를 기록한다**

완료 응답에는 정확한 운영 HTTPS URL, 배포된 commit SHA, 성공한 GitHub Actions run URL, D1 이름, bootstrap 삭제 확인, smoke 결과, 무료 runner/Free plan 상태를 포함한다. Secret 값, 로그인 ID, 비밀번호, 복구 코드, D1 UUID는 응답에 포함하지 않는다.
