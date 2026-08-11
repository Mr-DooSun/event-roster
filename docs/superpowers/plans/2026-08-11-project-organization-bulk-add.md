# 프로젝트 조직 일괄 추가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 활성 전역 조직 여러 개를 정보형 grid에서 선택해 하나의 원자적 요청으로 프로젝트에 연결한다.

**Architecture:** `POST /projects/:projectId/organizations/bulk`는 ID 목록과 프로젝트 revision을 받고, 기존 단건 추가와 같은 guarded D1 batch에서 모든 대상의 상태·연결 가능 여부를 검증한 뒤 연결, revision 증가, 조직별 감사 기록을 함께 수행한다. 일반 프로젝트 화면은 `OrganizationSummary` 후보를 검색 가능한 checkbox grid로 렌더링하며, 종료 프로젝트 이력 보정과 신규 조직 생성은 기존 단건 흐름을 유지한다.

**Tech Stack:** TypeScript, React 19, Vitest, Hono, Cloudflare D1, Zod, Biome, pnpm.

## Global Constraints

- 후보는 삭제되지 않은 활성 전역 조직만이며, 이미 활성 연결된 조직은 표시하되 선택할 수 없다.
- 하나의 요청에서 연결·재활성화·프로젝트 revision 증가·조직별 감사 기록은 전부 성공하거나 전부 실패해야 한다.
- bulk 성공 시 project revision은 선택 조직 수와 무관하게 정확히 1 증가한다.
- 새 조직 생성은 기존 `POST /projects/:projectId/organizations` 및 확인 dialog를 유지한다.
- `CLOSED_CORRECTION`은 기존 `OrganizationCombobox` 단건 흐름을 유지한다.
- 후보 카드에는 조직명, 대표 담당자, 연결된 프로젝트 수만 표시한다. 명단 인원은 후보 조직에 정의되지 않으므로 표시하지 않는다.

---

## 파일 구조

- 수정 `packages/contracts/src/organizations.ts`: bulk request·response Zod schema와 TypeScript type을 export한다.
- 수정 `apps/worker/src/routes/project-organizations.ts`: bulk endpoint에 기존 인증·CSRF·운영자 middleware를 적용한다.
- 수정 `apps/worker/src/services/project-organizations.ts`: `addProjectOrganizationsBulk` 서비스의 guard predicate, batch statements, 감사 기록과 오류 변환을 제공한다.
- 수정 `apps/worker/test/project-organizations.integration.test.ts`: HTTP 수준 원자성·권한·감사·revision 회귀 테스트를 추가한다.
- 생성 `apps/web/src/features/projects/ProjectOrganizationBulkPicker.tsx`: 일반 프로젝트의 검색·선택·정보형 grid 접근성을 책임진다.
- 생성 `apps/web/src/features/projects/ProjectOrganizationBulkPicker.test.tsx`: picker의 검색, 선택, disabled 카드와 busy 상태를 단위 테스트한다.
- 수정 `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`: 일반 모드에서 bulk picker와 bulk mutation을 연결하고, correction/new-org 흐름을 보존한다.
- 수정 `apps/web/src/features/projects/ProjectDetailPage.tsx`: 후보 응답을 `OrganizationSummary[]`로 유지해 대표 담당자·프로젝트 수를 picker에 전달한다.
- 수정 `apps/web/src/features/projects/project-detail.test.tsx`: bulk 요청, 성공 초기화 및 stale revision을 패널 수준에서 검증한다.
- 수정 `apps/web/e2e/project-roster.spec.ts`: 브라우저에서 두 후보 조직을 선택해 일괄 추가하는 실제 흐름을 검증한다.
- 수정 `apps/web/src/styles/global.css`: 2열 반응형 카드 grid와 선택·비활성 상태를 정의한다.

### Task 1: Bulk 계약과 Worker 원자적 mutation

**Files:**
- Modify: `packages/contracts/src/organizations.ts:106-145`
- Modify: `apps/worker/src/routes/project-organizations.ts:1-55`
- Modify: `apps/worker/src/services/project-organizations.ts:1-210`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces `AddProjectOrganizationsBulkSchema`, `AddProjectOrganizationsBulk`, `ProjectOrganizationBulkMutationResult`.
- Produces `addProjectOrganizationsBulk(env, actor, projectId, input, now?)` returning `{ organizationIds: string[]; projectRevision: number }`.
- Consumes existing `createOperatorGuard`, `runGuardedAtomic`, `membershipAuditStatement`, `translateMutationFailure` and `requireMutableProject`.

- [ ] **Step 1: Add a failing contract test for empty and duplicate bulk organization IDs**

```ts
expect(() =>
  AddProjectOrganizationsBulkSchema.parse({
    organizationIds: ["org-1", "org-1"],
    expectedProjectRevision: 3,
  }),
).toThrow();
expect(() =>
  AddProjectOrganizationsBulkSchema.parse({
    organizationIds: [],
    expectedProjectRevision: 3,
  }),
).toThrow();
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm --filter @event-roster/contracts test -- contracts.test.ts`

Expected: FAIL because `AddProjectOrganizationsBulkSchema` is not exported.

- [ ] **Step 3: Define the exact bulk contract**

Add beside `AddProjectOrganizationSchema`:

```ts
export const AddProjectOrganizationsBulkSchema = z
  .object({
    organizationIds: z.array(OrganizationIdSchema).min(1).max(100),
    expectedProjectRevision: ExpectedProjectRevisionSchema,
  })
  .strict()
  .refine(
    (value) => new Set(value.organizationIds).size === value.organizationIds.length,
    { path: ["organizationIds"], message: "organizationIds must be unique" },
  );
export type AddProjectOrganizationsBulk = z.infer<
  typeof AddProjectOrganizationsBulkSchema
>;
export interface ProjectOrganizationBulkMutationResult {
  organizationIds: string[];
  projectRevision: number;
}
```

- [ ] **Step 4: Implement the bulk service and route**

Import the new contract types and implement `addProjectOrganizationsBulk`. Build a guard predicate that requires the current project revision and `NOT EXISTS` for every requested active membership, and requires each organization to be active and not deleted. Generate one upsert statement and one `membershipAuditStatement` per ID. Detect the prior inactive state before building statements so each audit action is correct. Add one project revision update statement:

```ts
env.DB.prepare(
  `UPDATE projects SET revision = revision + 1, updated_at = ?
   WHERE id = ? AND revision = ?`,
).bind(timestamp, projectId, input.expectedProjectRevision);
```

Use one `runGuardedAtomic` call; on failure call `translateMutationFailure(env, projectId, input.expectedProjectRevision, now, error)`. Return the input IDs in request order and `expectedProjectRevision + 1`.

Register the route before `/:organizationId` routes:

```ts
projectOrganizationRoutes.post("/projects/:projectId/organizations/bulk", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = AddProjectOrganizationsBulkSchema.parse(await c.req.json());
  return c.json(await addProjectOrganizationsBulk(c.env, actor, c.req.param("projectId"), input));
});
```

- [ ] **Step 5: Run contract, Worker type, and formatting checks**

Run: `pnpm --filter @event-roster/contracts test -- contracts.test.ts && pnpm --filter @event-roster/worker check && pnpm exec biome check packages/contracts/src/organizations.ts apps/worker/src/routes/project-organizations.ts apps/worker/src/services/project-organizations.ts`

Expected: PASS.

- [ ] **Step 6: Commit the backend contract slice**

```bash
git add packages/contracts/src/organizations.ts packages/contracts/test/contracts.test.ts apps/worker/src/routes/project-organizations.ts apps/worker/src/services/project-organizations.ts
git commit -m "feat: add atomic bulk project organization endpoint"
```

### Task 2: Worker integration coverage for atomicity and audit

**Files:**
- Modify: `apps/worker/test/project-organizations.integration.test.ts`

**Interfaces:**
- Consumes `POST /api/v1/projects/:projectId/organizations/bulk` with `AddProjectOrganizationsBulk`.
- Verifies `ProjectOrganizationBulkMutationResult` and persisted `project_organizations`, `projects`, and `audit_logs` state.

- [ ] **Step 1: Write failing HTTP integration tests**

Add tests that seed two active organizations and assert a bulk request returns 200 with both ordered IDs and one revision increase. Query D1 after the request and assert two active links and exactly two `PROJECT_ORGANIZATION_ADDED` audits.

Add a test that makes one requested organization inactive before the request:

```ts
await env.DB.prepare("UPDATE organizations SET is_active = 0 WHERE id = ?")
  .bind(inactive.id).run();
const response = await authedRequest(operator, path, {
  method: "POST",
  body: JSON.stringify({ organizationIds: [active.id, inactive.id], expectedProjectRevision: project.revision }),
});
expect(response.status).toBe(409);
expect(await countProjectLinks(project.id)).toBe(0);
expect(await projectRevision(project.id)).toBe(project.revision);
```

Also cover reactivation plus new add in one request (audit actions are one `REACTIVATED`, one `ADDED`), duplicate request IDs rejected with 400, an already active membership returning 409 without adding other IDs, stale revision returning `STALE_REVISION`, and a non-operator returning the existing authorization status.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter @event-roster/worker test -- project-organizations.integration.test.ts`

Expected: FAIL until Task 1’s endpoint and atomic implementation exist.

- [ ] **Step 3: Make test helpers local and explicit**

Add small local helpers in the test file rather than sharing hidden state:

```ts
async function projectRevision(projectId: string) {
  return (await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
    .bind(projectId).first<{ revision: number }>())?.revision;
}
async function countProjectLinks(projectId: string) {
  return (await env.DB.prepare("SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ?")
    .bind(projectId).first<{ count: number }>())?.count;
}
```

Use these helpers in the rollback assertions so every test proves that no partial link and no revision update occurred.

- [ ] **Step 4: Run the focused Worker integration test**

Run: `pnpm --filter @event-roster/worker test -- project-organizations.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the atomicity coverage**

```bash
git add apps/worker/test/project-organizations.integration.test.ts
git commit -m "test: cover bulk project organization atomicity"
```

### Task 3: Information-grid picker component

**Files:**
- Create: `apps/web/src/features/projects/ProjectOrganizationBulkPicker.tsx`
- Create: `apps/web/src/features/projects/ProjectOrganizationBulkPicker.test.tsx`
- Modify: `apps/web/src/styles/global.css:613-700,1050-1145`

**Interfaces:**
- Consumes `OrganizationSummary[]`, `linkedOrganizationIds: ReadonlySet<string>`, `selectedOrganizationIds: ReadonlySet<string>`, `disabled`, and `onSelectionChange(next: string[])`.
- Produces an accessible `조직 이름 검색` input and checkbox cards with `선택한 N개 조직 추가` supplied by the parent button.

- [ ] **Step 1: Write failing picker tests**

Render active summaries including a linked one and assert:

```tsx
expect(screen.getByRole("checkbox", { name: "관문사" })).toBeEnabled();
expect(screen.getByRole("checkbox", { name: "금룡사" })).toBeDisabled();
expect(screen.getByText("대표 미지정")).toBeVisible();
expect(screen.getByText("연결 프로젝트 3개")).toBeVisible();
```

Then type a canonical-name fragment, assert only matching cards remain, click an enabled checkbox, and assert `onSelectionChange(["org-1"])`. Add a busy test proving both input and enabled checkboxes become disabled.

- [ ] **Step 2: Run the new component test to verify it fails**

Run: `pnpm --filter @event-roster/web test -- ProjectOrganizationBulkPicker.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused picker**

Use local `query` state and `canonicalizeOrganizationInput`. Filter only `organization.isActive && !organization.isDeleted`; keep linked matching organizations in the result with disabled checkboxes. Render each card as a labelled checkbox and semantic facts:

```tsx
<label className="er-project-organization-candidate" data-linked={linked || undefined}>
  <input type="checkbox" aria-label={organization.name} checked={selected} disabled={disabled || linked}
    onChange={() => onSelectionChange(selected ? selectedIds.filter((id) => id !== organization.id) : [...selectedIds, organization.id])} />
  <span>{organization.name}</span>
  <dl><div><dt>대표 담당자</dt><dd>{organization.primaryLeader?.displayName ?? "대표 미지정"}</dd></div><div><dt>연결 프로젝트</dt><dd>{organization.projectCount}개</dd></div></dl>
  {linked ? <span className="er-muted">이미 추가됨</span> : null}
</label>
```

Style `.er-project-organization-candidate-grid` as two columns, collapse to one column at `max-width: 60rem`, and distinguish checked and `data-linked` cards without relying on color alone.

- [ ] **Step 4: Run component tests, web type check, and formatter**

Run: `pnpm --filter @event-roster/web test -- ProjectOrganizationBulkPicker.test.tsx && pnpm --filter @event-roster/web check && pnpm exec biome check apps/web/src/features/projects/ProjectOrganizationBulkPicker.tsx apps/web/src/features/projects/ProjectOrganizationBulkPicker.test.tsx apps/web/src/styles/global.css`

Expected: PASS.

- [ ] **Step 5: Commit the picker slice**

```bash
git add apps/web/src/features/projects/ProjectOrganizationBulkPicker.tsx apps/web/src/features/projects/ProjectOrganizationBulkPicker.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add project organization bulk picker"
```

### Task 4: Wire ordinary project UI without regressing correction and new-org flows

**Files:**
- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx:1-160,270-300`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx:1-350`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx:500-1050,fixtures`

**Interfaces:**
- Consumes Task 1 bulk endpoint and Task 3 picker.
- `ProjectOrganizationsPanel` receives `OrganizationSummary[]` in ordinary mode and `ClosedProjectCorrectionCandidateOrganization[]` in correction mode.
- Produces `POST /projects/:projectId/organizations/bulk` payload `{ organizationIds, expectedProjectRevision }`.

- [ ] **Step 1: Write failing panel tests for the normal flow and regression tests for correction**

Update ordinary organization fixture candidates to `OrganizationSummary` values. Add a test that selects `org-1` and `org-2`, clicks `선택한 2개 조직 추가`, and asserts:

```ts
expect(mockApi.post).toHaveBeenCalledWith(
  "/projects/project-1/organizations/bulk",
  { organizationIds: ["org-1", "org-2"], expectedProjectRevision: 7 },
);
```

Resolve `{ organizationIds: ["org-1", "org-2"], projectRevision: 8 }`, assert `onChanged` is called and the button returns to `선택한 0개 조직 추가`. Add `STALE_REVISION` rejection coverage that reloads and clears the selection. Retain existing tests proving `CLOSED_CORRECTION` still renders `조직 이름 검색 또는 입력` and can create/add one organization.

- [ ] **Step 2: Run the focused web tests to verify they fail**

Run: `pnpm --filter @event-roster/web test -- project-detail.test.tsx`

Expected: FAIL because the panel still posts to the single-organization endpoint.

- [ ] **Step 3: Wire summary candidates and bulk mutation**

In `ProjectDetailPage`, replace the `Organization[]` state and GET generic with `OrganizationSummary[]`; the existing `/organizations` response already supplies this data. In `ProjectOrganizationsPanel`, keep the current combobox + confirmation dialog only when `correctionMode` is true. In ordinary mode, use `ProjectOrganizationBulkPicker`, store `selectedOrganizationIds`, and call:

```ts
api.post<ProjectOrganizationBulkMutationResult>(`${organizationPath}/bulk`, {
  organizationIds: selectedOrganizationIds,
  expectedProjectRevision: observedProjectRevision,
});
```

Extend the existing `mutate` helper (or add a small bulk-specific helper) to set the returned revision, clear selected IDs only after success, then call `onChanged`. On `STALE_REVISION`, clear selection before `onChanged` and preserve the existing Korean latest-data message. Do not change `confirmCreate`, `setActive`, or the correction path.

- [ ] **Step 4: Run focused tests and the full web suite**

Run: `pnpm --filter @event-roster/web test -- project-detail.test.tsx && pnpm --filter @event-roster/web test && pnpm --filter @event-roster/web check`

Expected: PASS.

- [ ] **Step 5: Commit UI integration**

```bash
git add apps/web/src/features/projects/ProjectDetailPage.tsx apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/projects/project-detail.test.tsx
git commit -m "feat: connect bulk organization add to project detail"
```

### Task 5: Whole-repository verification

**Files:**
- Modify only files required by failures found in this verification task.

**Interfaces:**
- Consumes all completed bulk API, picker, and integration contracts.
- Produces verified build, type checks, tests, and formatting evidence.

- [ ] **Step 1: Run repository checks**

Run: `pnpm check && pnpm test && pnpm format:check`

Expected: PASS.

- [ ] **Step 2: Add and run the browser bulk-add regression**

Add this scenario to `apps/web/e2e/project-roster.spec.ts`: open a mutable project's `조직` tab, check two visible candidate cards, click `선택한 2개 조직 추가`, and assert both organization names appear under `프로젝트 조직`. Seed the candidates with distinct names and wait for the button's request to finish before asserting.

Run: `pnpm --filter @event-roster/web e2e -- project-roster.spec.ts`

Expected: PASS.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; no unrelated files staged or modified.
