# CI Deployment Credentials and Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `main` push에서 CI와 Cloudflare 운영 배포가 안정적으로 성공하도록 비동기 조직 테스트를 고치고 GitHub `production` Environment의 Secret/Variable 경계를 올바르게 구성한다.

**Architecture:** 프로덕션 React 코드는 변경하지 않고 실패한 조직 목록 테스트가 API 응답 이후 실제 카드 렌더링을 기다리도록 한다. Cloudflare API 토큰은 GitHub Environment Secret으로 유지하고 비밀이 아닌 Account ID는 Environment Variable로 분리하며, 배포와 migration workflow가 같은 자격 증명 원천을 사용한다. 토큰 값은 사용자가 GitHub의 암호화 입력 경로로 직접 등록하고 자동화는 이름과 실행 결과만 확인한다.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, Testing Library, GitHub Actions, GitHub CLI, Wrangler 4.112.0, pnpm 10.28.1

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-24-ci-deployment-credentials-and-stability-design.md`다.
- `CLOUDFLARE_API_TOKEN`은 GitHub `production` Environment Secret으로만 저장한다.
- `CLOUDFLARE_ACCOUNT_ID`는 GitHub `production` Environment Variable로 저장한다.
- Cloudflare API 토큰 값은 소스, 문서, `.env`, 셸 명령 인자, Actions 로그, 대화에 남기지 않는다.
- 로컬 `wrangler login` OAuth 토큰을 GitHub Actions에 복사하지 않는다.
- Cloudflare API 토큰은 계정 `dadc085d94e111ad3effd04a57b33cb9` 하나와 Worker 배포에 필요한 최소 권한으로 제한한다.
- Worker API, D1 schema, D1 migration, Worker runtime Secret, 사용자 계정 데이터는 변경하지 않는다.
- 프로덕션 React 컴포넌트는 변경하지 않는다.
- 자동화는 GitHub Secret의 이름과 존재만 확인하며 값을 조회하거나 출력하지 않는다.

---

## File Structure

### Modified files

- `apps/web/src/features/admin/admin.test.tsx`
  - 조직 목록 테스트에서 API 응답과 카드 렌더링 사이의 비동기 경계를 결정적으로 재현하고 기다린다.
- `.github/workflows/deploy-production.yml`
  - Cloudflare API 토큰은 `secrets`, Account ID는 `vars`에서 읽는다.
- `.github/workflows/migrate-production.yml`
  - 운영 D1 명령도 동일한 Secret/Variable 경계를 사용한다.
- `docs/operations/deployment.md`
  - GitHub `production` Environment 설정, 토큰 안전선, Actions 검증 절차를 문서화한다.

### External configuration

- GitHub Environment Secret: `production/CLOUDFLARE_API_TOKEN`
- GitHub Environment Variable:
  `production/CLOUDFLARE_ACCOUNT_ID=dadc085d94e111ad3effd04a57b33cb9`

---

### Task 1: 조직 목록 테스트의 비동기 경계 안정화

**Files:**

- Modify: `apps/web/src/features/admin/admin.test.tsx`

**Interfaces:**

- Consumes: 기존 테스트 helper `deferred<T>()`, `OrganizationsPage`,
  `screen.findByRole`
- Produces: 조직 API 응답이 지연되어도 카드 렌더링을 기다리는
  `searches and filters organization summaries` 회귀 테스트
- Preserves: 두 조직 카드의 대표·담당자·프로젝트 assertion과 필터 query
  assertion

- [ ] **Step 1: 기존 flaky 조건을 결정적으로 재현**

`searches and filters organization summaries` 테스트 시작 부분에서 조직
응답을 deferred로 만들고, 기존 즉시 `Response.json` 반환을 deferred
promise로 교체한다.

```tsx
it("searches and filters organization summaries", async () => {
  const organizations = deferred<Response>();
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.includes("/organizations?")) {
      return organizations.promise;
    }
    throw new Error(`unexpected request: ${url}`);
  });
```

`await login()` 뒤 검색 필드가 먼저 표시되고 카드가 아직 없음을 확인한 다음
조직 응답을 resolve한다.

```tsx
  await login();

  expect(await screen.findByLabelText("조직 이름 검색")).toBeVisible();
  expect(screen.getByLabelText("대표 조직장 상태")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "1팀 상세 관리" }),
  ).not.toBeInTheDocument();

  organizations.resolve(
    Response.json([
      {
        id: "org-1",
        name: "1팀",
        isActive: true,
        primaryLeader: null,
        managerCount: 0,
        projectCount: 0,
      },
      {
        id: "org-2",
        name: "2팀",
        isActive: true,
        primaryLeader: { userId: "leader-1", displayName: "김대표" },
        managerCount: 2,
        projectCount: 1,
      },
    ]),
  );
```

카드 조회는 아직 기존 동기 `getByRole`을 유지한다.

```tsx
  const firstCard = screen
    .getByRole("link", { name: "1팀 상세 관리" })
    .closest(".er-organization-summary-card");
```

- [ ] **Step 2: focused test에서 RED 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/admin/admin.test.tsx \
  -t "searches and filters organization summaries"
```

Expected:

- 검색 필드와 스켈레톤은 렌더링된다.
- deferred 응답을 resolve한 직후 React가 아직 카드 commit을 끝내지 않아
  `getByRole("link", { name: "1팀 상세 관리" })`가 FAIL한다.
- 실패 위치는 `apps/web/src/features/admin/admin.test.tsx`의 동기 카드
  lookup이다.

- [ ] **Step 3: 실제 UI 준비 조건을 비동기로 기다리도록 최소 수정**

첫 번째 카드 링크를 `findByRole`로 기다린 뒤 같은 render commit에서 생기는
두 번째 카드는 동기 조회한다.

```tsx
  const firstCard = (
    await screen.findByRole("link", { name: "1팀 상세 관리" })
  ).closest(".er-organization-summary-card");
  const secondCard = screen
    .getByRole("link", { name: "2팀 상세 관리" })
    .closest(".er-organization-summary-card");
```

마지막 href assertion은 이미 찾은 첫 번째 링크를 재사용해 불필요한 전역
query를 제거한다.

```tsx
  expect(
    within(firstCard as HTMLElement).getByRole("link", {
      name: "1팀 상세 관리",
    }),
  ).toHaveAttribute("href", "/organizations/org-1");
```

나머지 카드 scoped assertion과 필터 form submit/query assertion은 그대로
유지한다.

- [ ] **Step 4: focused test와 Web 전체 테스트로 GREEN 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/admin/admin.test.tsx \
  -t "searches and filters organization summaries"
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected:

- focused test PASS
- Web 14 test files와 210 tests 이상 PASS
- Web 및 E2E TypeScript check PASS

- [ ] **Step 5: Task 1 커밋**

```bash
git add apps/web/src/features/admin/admin.test.tsx
git commit -m "test: wait for organization summaries to load"
```

---

### Task 2: GitHub Actions 자격 증명 원천 정렬과 runbook 갱신

**Files:**

- Modify: `.github/workflows/deploy-production.yml`
- Modify: `.github/workflows/migrate-production.yml`
- Modify: `docs/operations/deployment.md`

**Interfaces:**

- Consumes:
  - `secrets.CLOUDFLARE_API_TOKEN`
  - `vars.CLOUDFLARE_ACCOUNT_ID`
- Produces:
  - deploy workflow의 job-level Cloudflare environment
  - migration workflow의 remote D1 step-level Cloudflare environment
  - Secret 값을 포함하지 않는 운영 설정 절차
- Preserves: `production` Environment, workflow permissions, concurrency,
  D1 승인 guard, test/check/build/E2E/dry-run/deploy 순서

- [ ] **Step 1: 현재 잘못된 Account ID 원천을 검출하는 RED 검사**

Run:

```bash
test "$(rg -c 'secrets\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/deploy-production.yml)" -eq 0
test "$(rg -c 'secrets\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/migrate-production.yml)" -eq 0
```

Expected:

- 첫 명령은 현재 1개를 찾아 FAIL
- 두 번째 명령은 현재 5개를 찾아 FAIL
- API token reference는 변경 대상이 아니므로 이 단계에서 검사하지 않는다.

- [ ] **Step 2: deploy workflow를 Environment Variable 원천으로 변경**

`.github/workflows/deploy-production.yml`의 job-level `env`를 다음과 같이
변경한다.

```yaml
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

다른 workflow step이나 권한은 변경하지 않는다.

- [ ] **Step 3: migration workflow의 다섯 remote D1 step을 같은 원천으로 변경**

`.github/workflows/migrate-production.yml`의 다음 step 각각에서
`CLOUDFLARE_ACCOUNT_ID`만 `vars`로 바꾼다.

- `Verify an initial database is empty`
- `List pending migrations`
- `Apply migrations`
- `Check foreign keys`
- `Check organization assignments`

각 step의 최종 environment는 다음과 같다.

```yaml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

D1 command, 입력 guard, 임시 JSON 경로, 검증 JavaScript는 변경하지 않는다.

- [ ] **Step 4: 배포 runbook에 GitHub Actions 운영 자격 증명 절차 추가**

`docs/operations/deployment.md` 끝에 다음 섹션을 추가한다.

````markdown
## 7. GitHub Actions 운영 배포

`main` push는 `CI`와 `Deploy production`을 각각 실행한다. 두 workflow는
동일한 커밋을 검증하지만, 실제 Worker 배포는 `Deploy production`만
수행한다.

GitHub 저장소의 `production` Environment에 다음 두 항목을 등록한다.

- Secret `CLOUDFLARE_API_TOKEN`: Cloudflare 계정 하나와 Worker 편집에
  필요한 최소 권한으로 생성한 API 토큰
- Variable `CLOUDFLARE_ACCOUNT_ID`:
  `dadc085d94e111ad3effd04a57b33cb9`

API 토큰은 저장소 파일, `.env`, 문서, 대화, 셸 명령 인자에 넣지 않는다.
로컬 `wrangler login` OAuth 토큰도 복사하지 않는다. GitHub
`production` Environment의 Secret 입력 화면이나 다음 GitHub CLI의
대화형 표준 입력만 사용한다.

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
```

명령이 값을 요청하면 토큰을 직접 붙여넣고 입력을 종료한다. 토큰 값을
`--body` 인자에 쓰거나 셸 변수로 출력하지 않는다. Account ID는 비밀이
아니므로 다음 명령으로 Variable에 등록한다.

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID \
  --env production \
  --body dadc085d94e111ad3effd04a57b33cb9
```

등록 뒤 값 대신 이름과 존재만 확인한다.

```bash
gh secret list --env production
gh variable list --env production
```

`gh secret list`에는 `CLOUDFLARE_API_TOKEN` 이름만 보여야 한다. Variable
목록에는 `CLOUDFLARE_ACCOUNT_ID`가 위 계정 ID로 표시되어야 한다.

`main` push 뒤 두 workflow를 확인한다.

```bash
gh run list --branch main --limit 4 \
  --json databaseId,workflowName,headSha,status,conclusion,url
```

`CI`와 `Deploy production`은 같은 최신 `main` SHA에서 `success`여야 한다.
실패하면 값을 출력하지 말고 실패 step과 Secret/Variable 이름 존재 여부만
확인한다.
````

- [ ] **Step 5: workflow 계약과 문서의 GREEN 검사**

Run:

```bash
test "$(rg -c 'vars\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/deploy-production.yml)" -eq 1
test "$(rg -c 'vars\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/migrate-production.yml)" -eq 5
test "$(rg -c 'secrets\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/deploy-production.yml || true)" -eq 0
test "$(rg -c 'secrets\\.CLOUDFLARE_ACCOUNT_ID' \
  .github/workflows/migrate-production.yml || true)" -eq 0
test "$(rg -c 'secrets\\.CLOUDFLARE_API_TOKEN' \
  .github/workflows/deploy-production.yml)" -eq 1
test "$(rg -c 'secrets\\.CLOUDFLARE_API_TOKEN' \
  .github/workflows/migrate-production.yml)" -eq 5
rg -n 'GitHub Actions 운영 배포|gh secret set CLOUDFLARE_API_TOKEN|gh variable set CLOUDFLARE_ACCOUNT_ID' \
  docs/operations/deployment.md
```

Expected:

- deploy workflow에 Account ID Variable 1개
- migration workflow에 Account ID Variable 5개
- Account ID Secret reference 0개
- API token Secret reference는 deploy 1개, migration 5개로 보존
- runbook의 안전한 등록 명령 3개가 모두 검색됨

- [ ] **Step 6: 전체 정적 검사와 dry-run**

Run:

```bash
corepack pnpm@10.28.1 check
git ls-files -z | xargs -0 \
  corepack pnpm@10.28.1 exec biome check --no-errors-on-unmatched
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
git diff --check
```

Expected:

- monorepo TypeScript checks PASS
- tracked-file Biome 0 errors
- Web production build PASS
- Worker dry-run exit code 0과 `event-roster` D1 binding 확인
- whitespace errors 0

- [ ] **Step 7: Task 2 커밋**

```bash
git add \
  .github/workflows/deploy-production.yml \
  .github/workflows/migrate-production.yml \
  docs/operations/deployment.md
git commit -m "ci: separate Cloudflare secret and account variable"
```

---

### Task 3: GitHub Environment 등록과 운영 Actions 검증

**Files:**

- No repository file changes

**Interfaces:**

- Consumes:
  - 사용자가 Cloudflare에서 생성한 최소 권한 API token
  - Account ID `dadc085d94e111ad3effd04a57b33cb9`
  - `production` Environment를 참조하는 두 workflow
- Produces:
  - Environment Secret `CLOUDFLARE_API_TOKEN`
  - Environment Variable `CLOUDFLARE_ACCOUNT_ID`
  - 동일한 최신 `main` SHA의 성공한 `CI`와 `Deploy production`
- Preserves: Secret 값 비공개, 기존 Worker/D1/runtime secrets/data

- [ ] **Step 1: Cloudflare API token을 최소 권한으로 생성**

Cloudflare Dashboard의 API Tokens에서 `Edit Cloudflare Workers` 템플릿을
기준으로 토큰을 생성한다. Account Resources는
`Shread.gpt.2001@gmail.com's Account` 하나로 제한한다.

토큰은 생성 직후 한 번만 표시된다. 채팅, 문서, 메모 파일, `.env`, 셸 명령
인자에 복사하지 않는다. 바로 다음 GitHub Environment Secret 입력에
사용한다.

- [ ] **Step 2: API token을 암호화된 Environment Secret으로 등록**

저장소 루트의 사용자 터미널에서 다음 명령을 실행한다.

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
```

Expected:

- GitHub CLI가 Secret 값을 대화형 표준 입력으로 요청
- 사용자가 토큰을 직접 붙여넣어 등록
- 명령 exit code 0
- 터미널 히스토리에 토큰 값 없음

Agent는 토큰을 요청하거나 읽거나 출력하지 않는다.

- [ ] **Step 3: Account ID Environment Variable 등록**

Run:

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID \
  --env production \
  --body dadc085d94e111ad3effd04a57b33cb9
```

Expected: exit code 0.

- [ ] **Step 4: 이름과 Variable 값만 확인**

Run:

```bash
gh secret list --env production
gh variable list --env production
```

Expected:

- Secret 목록에 `CLOUDFLARE_API_TOKEN` 존재
- Secret 값은 출력되지 않음
- Variable 목록의 `CLOUDFLARE_ACCOUNT_ID`가
  `dadc085d94e111ad3effd04a57b33cb9`

- [ ] **Step 5: 기능 브랜치를 `main`에 통합하고 push**

`superpowers:finishing-a-development-branch`로 Task 1과 Task 2의
커밋을 `main`에 로컬 병합한다. 병합된 `main`에서 `corepack
pnpm@10.28.1 test`를 다시 실행해 전체 PASS를 확인한 뒤 push한다.

Expected:

- `origin/main`이 Task 1과 Task 2 커밋을 포함
- push로 `CI`와 `Deploy production` 두 workflow 시작

- [ ] **Step 6: 두 workflow를 완료까지 감시**

Run:

```bash
gh run list --branch main --limit 4 \
  --json databaseId,workflowName,headSha,status,conclusion,url
```

최신 두 실행의 ID를 별도 변수로 읽고 완료까지 감시한다.

```bash
EVENT_ROSTER_CI_RUN_ID="$(
  gh run list \
    --workflow ci.yml \
    --branch main \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"
EVENT_ROSTER_DEPLOY_RUN_ID="$(
  gh run list \
    --workflow deploy-production.yml \
    --branch main \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"
test -n "$EVENT_ROSTER_CI_RUN_ID"
test -n "$EVENT_ROSTER_DEPLOY_RUN_ID"
gh run watch "$EVENT_ROSTER_CI_RUN_ID" --exit-status
gh run watch "$EVENT_ROSTER_DEPLOY_RUN_ID" --exit-status
```

Expected:

- 두 run의 `headSha`가 최신 `main` SHA와 동일
- CI의 test, check, format, build, dry-run, E2E 단계 PASS
- Deploy production의 test, check, format, build, E2E, dry-run,
  deploy 단계 PASS

- [ ] **Step 7: 운영 Worker 응답 확인**

Run:

```bash
curl -fsS \
  https://event-roster.event-roster.workers.dev/api/v1/health
curl -fsSI \
  https://event-roster.event-roster.workers.dev/
```

Expected:

- health body `{"status":"ok"}`
- SPA HTTPS status `200`

- [ ] **Step 8: 최종 상태 확인**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
gh run list --branch main --limit 4 \
  --json workflowName,headSha,status,conclusion,url
```

Expected:

- `main...origin/main` 동기화
- 기존 미추적 `.DS_Store`, `.pnpm-store`만 그대로 남음
- `HEAD`와 `origin/main` SHA 동일
- 최신 `CI`와 `Deploy production` 모두 `success`

---

## Final Verification

- [ ] `corepack pnpm@10.28.1 test`
- [ ] `corepack pnpm@10.28.1 check`
- [ ] tracked-file Biome 검사
- [ ] Web production build
- [ ] Worker deploy dry-run
- [ ] 최신 `main` SHA의 GitHub `CI` success
- [ ] 최신 `main` SHA의 GitHub `Deploy production` success
- [ ] 운영 health `{"status":"ok"}`
- [ ] 운영 SPA HTTPS `200`
- [ ] Secret 값이 Git, 문서, 로그, 대화에 없음
