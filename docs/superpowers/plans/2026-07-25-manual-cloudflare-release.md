# Manual Cloudflare Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions는 코드 검증만 수행하게 하고 Cloudflare Worker 배포와 원격 D1 migration을 로컬 Wrangler 로그인 기반 수동 절차로 전환한다.

**Architecture:** `.github/workflows/ci.yml`은 그대로 유지하고 Cloudflare 운영 권한을 요구하는 두 workflow를 제거한다. 반복 release는 `docs/operations/deployment.md`에 정의된 순서대로 깨끗한 `main` checkout과 로컬 `wrangler login` 세션에서 실행하며, GitHub에는 Cloudflare API Token이나 Account ID를 보관하지 않는다.

**Tech Stack:** GitHub Actions, GitHub CLI, Cloudflare Wrangler 4.112.0, Workers, D1, pnpm 10.28.1, TypeScript 5.9, Vitest 4, Playwright 1.61

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-25-manual-cloudflare-release-design.md`다.
- `.github/workflows/ci.yml`만 유지하며 현재 trigger와 검증 step을 변경하지 않는다.
- GitHub Actions에서 `wrangler deploy`와 원격 D1 명령을 실행하지 않는다.
- GitHub용 Cloudflare API Token은 생성하거나 등록하지 않는다.
- 로컬 Wrangler OAuth 자격 증명을 GitHub, 저장소, 문서 또는 대화에 복사하지 않는다.
- 이미 등록된 GitHub `production/CLOUDFLARE_ACCOUNT_ID` Variable만 제거한다.
- GitHub `production` Environment 자체는 삭제하지 않는다.
- Worker runtime Secret, 사용자 계정, D1 schema, migration 파일과 애플리케이션 코드는 변경하지 않는다.
- 로컬 검증, dry-run, 백업 또는 migration 검증이 실패하면 이후 운영 단계로 진행하지 않는다.
- 문서와 workflow만 변경되므로 이 작업을 완료하기 위해 운영 Worker를 재배포하지 않는다.

---

## File Structure

### Deleted files

- `.github/workflows/deploy-production.yml`
  - `main` push 및 수동 dispatch에서 Worker를 배포하던 GitHub Actions
    entrypoint를 제거한다.
- `.github/workflows/migrate-production.yml`
  - GitHub Runner에서 운영 D1 migration을 실행하던 entrypoint를 제거한다.

### Modified files

- `docs/operations/deployment.md`
  - GitHub Environment Secret/Variable 등록 절차를 제거한다.
  - 깨끗한 `main` 확인, 로컬 검증, pending migration 판단, 배포, smoke,
    기록과 중단 조건을 포함한 반복 수동 release 절차를 추가한다.

### Preserved files

- `.github/workflows/ci.yml`
  - pull request와 `main` push에서 test, check, formatting, Web build, Worker
    dry-run과 E2E만 수행한다.
- `docs/operations/recovery.md`
  - 기존 D1 격리 복원 절차를 그대로 사용한다.
- `apps/web/src/features/admin/admin.test.tsx`
  - 앞선 `96c80b4` 커밋의 비동기 조직 목록 테스트 안정화 변경을 유지한다.

### External configuration

- Remove:
  `production/CLOUDFLARE_ACCOUNT_ID=dadc085d94e111ad3effd04a57b33cb9`
- Do not create: `production/CLOUDFLARE_API_TOKEN`
- Preserve: GitHub `production` Environment

---

### Task 1: GitHub Actions를 검증 전용으로 축소

**Files:**

- Delete: `.github/workflows/deploy-production.yml`
- Delete: `.github/workflows/migrate-production.yml`
- Preserve: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: GitHub `pull_request`, `push.branches: [main]`
- Produces: Cloudflare 자격 증명이 필요 없는 단일 `CI` workflow
- Preserves: `.github/workflows/ci.yml`의 test, check, format, Web build,
  Worker dry-run, E2E 순서

- [ ] **Step 1: workflow 경계 계약이 현재 실패하는지 확인**

Run:

```bash
EVENT_ROSTER_WORKFLOWS="$(
  find .github/workflows -maxdepth 1 -type f -name '*.yml' \
    -exec basename {} \; | sort
)"
printf '%s\n' "$EVENT_ROSTER_WORKFLOWS"
test "$EVENT_ROSTER_WORKFLOWS" = "ci.yml"
```

Expected:

- 출력에 `ci.yml`, `deploy-production.yml`,
  `migrate-production.yml`이 나타난다.
- 마지막 `test`가 exit 1로 실패한다.

- [ ] **Step 2: 운영 Cloudflare workflow 두 개 제거**

Delete these complete files:

```text
.github/workflows/deploy-production.yml
.github/workflows/migrate-production.yml
```

`.github/workflows/ci.yml`은 수정하지 않는다.

- [ ] **Step 3: 단일 CI workflow 계약을 다시 확인**

Run:

```bash
EVENT_ROSTER_WORKFLOWS="$(
  find .github/workflows -maxdepth 1 -type f -name '*.yml' \
    -exec basename {} \; | sort
)"
test "$EVENT_ROSTER_WORKFLOWS" = "ci.yml"
test -z "$(
  rg -l 'CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|d1 migrations apply .*--remote|wrangler deploy$' \
    .github/workflows || true
)"
git diff fa9f1b5 --exit-code -- .github/workflows/ci.yml
```

Expected:

- 세 명령 모두 exit 0이다.
- GitHub Actions에 Cloudflare 인증, 운영 deploy와 원격 migration 참조가
  없다.
- `ci.yml`은 작업 시작 기준 SHA `fa9f1b5`와 동일하다.

- [ ] **Step 4: workflow 삭제 커밋**

```bash
git add .github/workflows/deploy-production.yml \
  .github/workflows/migrate-production.yml
git commit -m "ci: keep GitHub Actions verification only"
```

Expected:

- 커밋에는 두 workflow 삭제만 포함된다.

---

### Task 2: 반복 수동 Cloudflare release 매뉴얼 작성

**Files:**

- Modify: `docs/operations/deployment.md`
- Reference: `docs/operations/recovery.md`

**Interfaces:**

- Consumes: 깨끗한 로컬 `main`, `wrangler login` OAuth 세션, D1
  `event-roster`, Worker `event-roster`
- Produces: 운영자가 그대로 순서대로 실행할 수 있는 `## 7. 반복 수동
  release` 체크리스트
- Preserves: 초기 D1 생성, runtime Secret 등록, 첫 배포, bootstrap 인계와
  기존 저빈도 smoke 절차

- [ ] **Step 1: 수동 release 문서 계약이 현재 실패하는지 확인**

Run:

```bash
rg -n '^## 7\. 반복 수동 release$' docs/operations/deployment.md
! rg -n 'GitHub Actions 운영 배포|gh secret set CLOUDFLARE_API_TOKEN|gh variable set CLOUDFLARE_ACCOUNT_ID' \
  docs/operations/deployment.md
```

Expected:

- 첫 번째 명령은 새 heading이 없어 exit 1이다.
- 현재 문서에는 GitHub Actions 배포와 Secret/Variable 등록 명령이 있어
  두 번째 계약도 실패한다.

- [ ] **Step 2: GitHub Actions 배포 섹션을 반복 수동 release로 교체**

`docs/operations/deployment.md`의 기존
`## 7. GitHub Actions 운영 배포`부터 파일 끝까지를 다음 내용으로
교체한다.

````markdown
## 7. 반복 수동 release

운영 변경은 자동 배포하지 않는다. 아래 절차는 저장소의 깨끗한 `main`
checkout과 `wrangler login`으로 인증된 운영자 로컬 환경에서만 실행한다.
GitHub Actions에는 Cloudflare API Token과 Account ID를 등록하지 않는다.

### 7.1 대상 커밋과 계정 확인

```bash
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git rev-parse HEAD
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler whoami
```

현재 SHA와 Wrangler가 표시한 Cloudflare 계정이 배포 대상인지 확인한다.
하나라도 다르거나 작업 트리가 깨끗하지 않으면 중단한다.

### 7.2 로컬 검증

```bash
corepack pnpm@10.28.1 install --frozen-lockfile
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

모든 명령이 exit 0일 때만 다음 단계로 진행한다.

### 7.3 pending D1 migration 판단

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations list event-roster --remote
```

pending migration이 없으면 7.4로 이동한다. pending migration이 있으면 해당
migration의 승인된 사전·사후 검증 절차가 문서화되어 있어야 한다. 기존
데이터가 있는 D1은 2절의 저장소 밖 export·checksum 검증을 먼저 수행한다.
승인된 검증 절차나 확인된 백업 중 하나라도 없으면 migration과 배포를
중단한다.

승인과 백업이 모두 확인된 경우에만 적용한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

foreign key 검사는 행을 반환하지 않아야 한다. migration별 사후 검증도 모두
통과해야 한다. 실패하면 Worker를 배포하지 말고
[복구 절차](recovery.md)의 격리 복원을 따른다.

### 7.4 Worker 배포와 확인

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
curl --fail --silent --show-error \
  https://event-roster.event-roster.workers.dev/api/v1/health
curl --fail --silent --show-error --head \
  https://event-roster.event-roster.workers.dev/
```

health 응답은 `{"status":"ok"}`이고 SPA 요청은 HTTP 200이어야 한다. 이어
6절의 `smoke:remote`를 한 번 실행한다. 하나라도 실패하면 성공으로 기록하지
않고 Worker 로그와 Wrangler 배포 이력을 확인한다.

### 7.5 운영 기록

다음 항목만 접근 제한된 운영 기록에 남긴다.

- `git rev-parse HEAD`의 전체 40자 SHA
- 배포 시작·종료 시각
- `https://event-roster.event-roster.workers.dev`
- migration 적용 여부와 검증 결과
- health, SPA와 smoke 결과
- 실패한 경우 중단 단계와 복구 여부

OAuth token, runtime Secret, 로그인 비밀번호, JWT, refresh token과 D1
백업 내용은 기록하지 않는다.
````

- [ ] **Step 3: 문서 계약과 안전선을 검증**

Run:

```bash
test "$(rg -c '^## 7\. 반복 수동 release$' docs/operations/deployment.md)" -eq 1
test "$(rg -c '^### 7\.[1-5] ' docs/operations/deployment.md)" -eq 5
! rg -n 'GitHub Actions 운영 배포|gh secret set CLOUDFLARE_API_TOKEN|gh variable set CLOUDFLARE_ACCOUNT_ID' \
  docs/operations/deployment.md
rg -n 'wrangler whoami|wrangler deploy --dry-run|d1 migrations list event-roster --remote|d1 migrations apply event-roster --remote|PRAGMA foreign_key_check|wrangler deploy|smoke:remote|recovery\.md' \
  docs/operations/deployment.md
git diff --check
```

Expected:

- 반복 release heading은 1개, 하위 단계는 5개다.
- GitHub 자격 증명 등록 안내는 0개다.
- 계정 확인, 검증, migration 판단·적용, 무결성 검사, deploy, smoke와 복구
  참조가 모두 검색된다.
- whitespace 오류가 없다.

- [ ] **Step 4: 운영 문서 커밋**

```bash
git add docs/operations/deployment.md
git commit -m "docs: document local Cloudflare releases"
```

Expected:

- 커밋에는 `docs/operations/deployment.md`만 포함된다.

---

### Task 3: GitHub 외부 설정 정리와 전체 검증

**Files:**

- Verify: `.github/workflows/ci.yml`
- Verify: `apps/web/src/features/admin/admin.test.tsx`
- Verify: repository tracked files

**Interfaces:**

- Consumes: GitHub `production` Environment, GitHub CLI 로그인, 로컬
  dependencies
- Produces: Cloudflare Account ID Variable이 없는 GitHub Environment와
  검증을 통과한 feature branch
- Preserves: GitHub `production` Environment와 모든 다른 Secret/Variable

- [ ] **Step 1: 제거 대상 Variable과 API Token 부재를 이름만으로 확인**

Run:

```bash
gh variable list --env production
gh secret list --env production
```

Expected:

- Variable 목록에 `CLOUDFLARE_ACCOUNT_ID`가 있다.
- Secret 목록에 `CLOUDFLARE_API_TOKEN`이 없다.
- Secret 값은 조회하거나 출력하지 않는다.

- [ ] **Step 2: Account ID Variable 하나만 제거**

Run:

```bash
gh variable delete CLOUDFLARE_ACCOUNT_ID --env production
```

Expected:

- 명령이 exit 0이다.
- GitHub `production` Environment 자체와 다른 설정은 변경하지 않는다.

- [ ] **Step 3: 외부 설정 정리를 확인**

Run:

```bash
! gh variable list --env production |
  rg '^CLOUDFLARE_ACCOUNT_ID([[:space:]]|$)'
! gh secret list --env production |
  rg '^CLOUDFLARE_API_TOKEN([[:space:]]|$)'
```

Expected:

- 두 명령 모두 exit 0이다.
- 자동 배포용 Account ID와 API Token 이름이 없다.

- [ ] **Step 4: 정적 release 경계 검증**

Run:

```bash
test "$(
  find .github/workflows -maxdepth 1 -type f -name '*.yml' \
    -exec basename {} \; | sort
)" = "ci.yml"
test -z "$(
  rg -l 'CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID' \
    .github/workflows docs/operations || true
)"
git diff fa9f1b5 --exit-code -- .github/workflows/ci.yml
git diff --check
```

Expected:

- GitHub Actions workflow는 `ci.yml` 하나다.
- 활성 workflow와 운영 문서에는 자동 배포용 Cloudflare 자격 증명 참조가
  없다.
- CI workflow는 기준 SHA와 동일하다.
- whitespace 오류가 없다.

- [ ] **Step 5: 전체 test와 check 실행**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
```

Expected:

- contracts, capability, domain, Web, Worker 전체 test가 통과한다.
- TypeScript와 E2E TypeScript check가 통과한다.
- Biome가 추적 프로젝트 파일에서 오류를 반환하지 않는다.

- [ ] **Step 6: build와 로컬 Worker bundle 검증**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
```

Expected:

- Web production build가 exit 0이다.
- Wrangler dry-run이 exit 0이며 `env.DB (event-roster)` binding을 표시한다.
- 실제 Worker deploy와 원격 D1 mutation은 실행하지 않는다.

- [ ] **Step 7: 최종 branch 검토**

Use `superpowers:requesting-code-review` to review:

```text
Base: fa9f1b5
Head: current codex/ci-deployment-recovery HEAD
Requirements:
- retain the async organization-list test fix
- keep only CI in GitHub Actions
- document local manual release
- remove active GitHub Cloudflare credential references
- do not change application runtime behavior or D1 schema
```

Expected:

- Critical 또는 Important finding이 없다.
- finding이 있으면 수정 후 Steps 4-6을 다시 실행하고 별도 fix commit을
  만든다.

---

### Task 4: 통합 후 CI 확인

**Files:**

- Verify: merged `main`
- External: GitHub Actions `CI`
- External: `https://event-roster.event-roster.workers.dev`

**Interfaces:**

- Consumes: 검증과 review를 통과한 `codex/ci-deployment-recovery`
- Produces: 원격 `main`과 동일한 로컬 `main`, 성공한 단일 `CI` run
- Preserves: 현재 배포된 Worker version과 D1 데이터

- [ ] **Step 1: 완료 방식 선택**

Use `superpowers:finishing-a-development-branch` and present its integration
options. 로컬 `main` 병합과 push를 선택한 경우에만 다음 단계로 진행한다.

- [ ] **Step 2: 로컬 `main`에 병합**

Run from `/Users/coursemos/develop/event-roster`:

```bash
git status --short --branch
git switch main
git merge --no-ff codex/ci-deployment-recovery
```

Expected:

- 기존 사용자 untracked 파일은 변경하거나 stage하지 않는다.
- merge conflict가 없다.
- merge commit에 비동기 테스트 안정화, 자동 배포 workflow 제거와 관련
  문서만 포함된다.

- [ ] **Step 3: 병합된 `main`을 재검증**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
git diff --check HEAD^ HEAD
```

Expected:

- 모든 test, check, build와 dry-run이 exit 0이다.
- merge commit에 whitespace 오류가 없다.

- [ ] **Step 4: `main` push**

```bash
git push origin main
```

Expected:

- push가 성공하고 `origin/main`이 로컬 `main`과 같은 SHA다.
- `Deploy production`과 `Migrate production D1`은 새 run을 만들지 않는다.

- [ ] **Step 5: 최신 CI run 확인**

```bash
EVENT_ROSTER_MAIN_SHA="$(git rev-parse HEAD)"
gh run list --branch main --limit 5 \
  --json databaseId,workflowName,headSha,status,conclusion,url
EVENT_ROSTER_CI_RUN_ID="$(
  gh run list --workflow CI --branch main --limit 1 \
    --json databaseId --jq '.[0].databaseId'
)"
EVENT_ROSTER_CI_HEAD_SHA="$(
  gh run list --workflow CI --branch main --limit 1 \
    --json headSha --jq '.[0].headSha'
)"
test "$EVENT_ROSTER_CI_HEAD_SHA" = "$EVENT_ROSTER_MAIN_SHA"
test -n "$EVENT_ROSTER_CI_RUN_ID"
gh run watch "$EVENT_ROSTER_CI_RUN_ID" --exit-status
```

Expected:

- 최신 `CI`의 `headSha`가 `$EVENT_ROSTER_MAIN_SHA`와 같다.
- `CI`가 `success`로 끝난다.
- 같은 SHA에서 새 `Deploy production` 또는 `Migrate production D1`
  run이 없다.

- [ ] **Step 6: 운영 서비스 비변경 smoke**

```bash
curl --fail --silent --show-error \
  https://event-roster.event-roster.workers.dev/api/v1/health
curl --fail --silent --show-error --head \
  https://event-roster.event-roster.workers.dev/
```

Expected:

- health 응답은 `{"status":"ok"}`다.
- SPA 응답은 HTTP 200이다.
- 이 확인 과정에서 Worker를 재배포하지 않는다.

- [ ] **Step 7: feature worktree 정리**

`superpowers:finishing-a-development-branch`의 cleanup 절차에 따라 성공적으로
병합·push된 worktree와 feature branch만 제거한다. 사용자 소유 untracked
파일과 다른 worktree는 삭제하지 않는다.
