# CI E2E Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 UI와 E2E를 일치시키고 참가자 추가 대화상자의 클릭 겹침 및 CI 로컬 TLS 잡음을 제거해 전체 CI를 통과시킨다.

**Architecture:** 반복되는 조직 선택과 명단 필터 상호작용은 Playwright 지원 함수로 캡슐화한다. 새 참가자 폼은 편집 내용을 담는 스크롤 영역과 최종 액션 영역을 DOM과 CSS에서 분리하며, 로컬 E2E 서버는 HTTP로 통일한다.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Wrangler/Cloudflare Workers, pnpm

## Global Constraints

- 운영 HTTPS 및 현재 조직 선택·표 헤더 필터 UX는 변경하지 않는다.
- UI 동작 변경은 회귀 테스트를 먼저 실패시킨 뒤 최소 구현으로 통과시킨다.
- 최종 판단은 로컬 CI 전체 명령과 GitHub Actions 결과를 기준으로 한다.

---

### Task 1: 새 참가자 대화상자 스크롤 경계

**Files:**
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `BulkParticipantRowsField`, `.er-dialog-form--roster-compact`
- Produces: `.er-bulk-participant-editor` 스크롤 영역과 별도의 `.er-dialog-actions`

- [ ] **Step 1: 구조 회귀 테스트를 먼저 추가한다**

`uses compact bulk participant layout for new mode`에서 참가자 추가 버튼의 가장 가까운 `.er-bulk-participant-editor`가 존재하고, 해당 영역이 최종 `.er-dialog-actions`를 포함하지 않는다고 검증한다.

- [ ] **Step 2: 테스트가 현재 구조에서 실패하는지 확인한다**

Run: `corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "uses compact bulk participant layout"`
Expected: `.er-bulk-participant-editor`가 없어 FAIL.

- [ ] **Step 3: 최소 DOM/CSS 변경을 구현한다**

`ParticipantDialog`의 새 참가자 모드에서 `BulkParticipantRowsField`를 `<div className="er-bulk-participant-editor">`로 감싼다. CSS는 이 영역에 `min-height: 0; overflow-y: auto; padding-right: var(--er-space-1);`를 적용하고 폼의 하단 액션은 스크롤 영역 밖에 유지한다.

- [ ] **Step 4: 컴포넌트 테스트를 통과시킨다**

Run: `corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx`
Expected: PASS.

- [ ] **Step 5: 변경을 커밋한다**

```bash
git add apps/web/src/features/roster/roster.test.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/styles/global.css
git commit -m "fix: keep participant editor clear of dialog actions"
```

### Task 2: 현재 UI용 Playwright 상호작용

**Files:**
- Modify: `apps/web/e2e/support.ts`
- Modify: `apps/web/e2e/project-roster.spec.ts`
- Modify: `apps/web/e2e/organization-management.spec.ts`
- Modify: `apps/web/e2e/project-deletion.spec.ts`
- Modify: `apps/web/e2e/import-export.spec.ts`

**Interfaces:**
- Produces: `addProjectOrganizations(page: Page, names: readonly string[])`
- Produces: `selectRosterFilter(page: Page, label: string, value: string)`

- [ ] **Step 1: 조직 선택 도우미를 작성하고 기존 직접 체크 호출을 교체한다**

도우미는 `조직 선택 추가` 버튼을 누르고 같은 이름의 대화상자 내부 체크박스를 선택한 뒤 `선택한 ${names.length}개 조직 추가`를 누른다. 세 조직 관련 E2E 시나리오의 페이지 직접 체크를 이 도우미로 교체한다.

- [ ] **Step 2: 필터 도우미를 작성하고 이전 상단 셀렉트 호출을 교체한다**

도우미는 `${label} 필터` 버튼을 누르고 `${label} 필터 메뉴` 대화상자 안의 동일 aria-label 셀렉트에 `value`를 선택한다. 참가자 구분과 학년 필터 시나리오를 이 흐름으로 교체한다.

- [ ] **Step 3: 영향받은 E2E만 실행한다**

Run: `corepack pnpm --filter @event-roster/web exec playwright test e2e/project-roster.spec.ts e2e/organization-management.spec.ts e2e/project-deletion.spec.ts e2e/import-export.spec.ts`
Expected: UI selector 관련 timeout이 사라진다. 대화상자 겹침은 Task 1 구현으로 클릭 가능하다.

- [ ] **Step 4: 변경을 커밋한다**

```bash
git add apps/web/e2e
git commit -m "test: align E2E flows with current project UI"
```

### Task 3: 로컬 E2E HTTP 통일

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/scripts/prepare-e2e-env.mts`
- Modify: `apps/web/playwright.config.ts`

**Interfaces:**
- Produces: 로컬 전용 `http://127.0.0.1:8787` origin

- [ ] **Step 1: 모든 E2E origin을 HTTP로 변경한다**

`prepare-e2e-env.mts`의 `baseUrl`, Playwright `baseURL` 및 `webServer.url`을 HTTP로 바꾸고 `e2e:serve`의 `--local-protocol https`를 `--local-protocol http`로 바꾼다. `ignoreHTTPSErrors`는 불필요하므로 Playwright 설정과 API 컨텍스트에서 제거한다.

- [ ] **Step 2: 전체 E2E를 실행해 TLS 로그와 실패를 확인한다**

Run: `corepack pnpm --filter @event-roster/web run e2e`
Expected: 14 tests PASS, `SSLV3_ALERT_CERTIFICATE_UNKNOWN` 없음.

- [ ] **Step 3: 변경을 커밋한다**

```bash
git add apps/worker/package.json apps/worker/scripts/prepare-e2e-env.mts apps/web/playwright.config.ts apps/web/e2e
git commit -m "test: use HTTP for isolated local E2E"
```

### Task 4: 전체 CI 검증과 원격 확인

**Files:**
- Verify only: repository-wide scripts and `.github/workflows/ci.yml`

- [ ] **Step 1: 로컬 CI 단계 전체를 순서대로 실행한다**

```bash
corepack pnpm test
corepack pnpm check
corepack pnpm format:check
corepack pnpm --filter @event-roster/web build
corepack pnpm --filter @event-roster/worker exec wrangler deploy --dry-run
corepack pnpm --filter @event-roster/web run e2e
```

Expected: 모든 명령 exit 0.

- [ ] **Step 2: 작업 트리와 커밋을 확인하고 main을 푸시한다**

```bash
git diff --check
git status --short
git push origin main
```

- [ ] **Step 3: GitHub Actions를 완료까지 확인한다**

```bash
gh run list --branch main --limit 1
gh run watch <run-id> --exit-status
```

Expected: `CI` workflow conclusion `success`.
