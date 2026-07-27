# Project Organization Exclusion and Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 조직 제외를 업무 데이터 유무에 따른 자동 제거·비활성화로 바꾸고, 개요와 Excel에서 의미 없는 비활성 0명 조직을 숨기면서 과거 집계는 보존한다.

**Architecture:** 프로젝트 조직의 보존 판단을 감사 로그가 아닌 명단·예상 스냅샷으로 한정하고, D1 원자 배치 안에서 hard delete와 soft deactivate를 결정한다. 요약 행에는 프로젝트 연결과 전역 조직의 활성 상태를 포함하고, `@event-roster/domain`의 단일 표시 판정 함수를 Worker와 순수 집계가 공유한다. React는 서버가 정한 요약 행을 그대로 표시하면서 비활성 행에 상태 배지를 붙인다.

**Tech Stack:** TypeScript 5.9, Hono 4, Cloudflare Workers + D1, Zod 4, React 19, Vitest 4, Testing Library, pnpm 10.28.1

## Global Constraints

- 디자인 기준은 `docs/superpowers/specs/2026-07-27-project-organization-exclusion-and-roster-usability-design.md`다.
- 사용자에게 프로젝트 조직의 `비활성화`와 `제거`를 별도 선택지로 노출하지 않는다.
- 활성 연결의 destructive action 문구는 `프로젝트에서 제외`, 비활성 연결의 복구 문구는 `다시 사용`이다.
- 업무 이력은 `project_roster_entries` 또는 `project_expected_snapshots` 존재만 뜻한다. 감사 로그는 업무 이력이 아니다.
- 연결 행을 삭제하거나 비활성화해도 기존 감사 로그는 삭제하지 않는다.
- 업무 이력이 없는 연결은 `PROJECT_ORGANIZATION_REMOVED`, 업무 이력이 있는 연결은 `PROJECT_ORGANIZATION_DEACTIVATED`를 기록한다.
- 제외 시점의 업무 이력 판정, 연결 mutation, 프로젝트 revision 증가, 감사 기록은 하나의 guarded D1 batch에서 원자적으로 처리한다.
- 유효 활성 조직은 프로젝트 연결과 전역 마스터가 모두 활성인 조직이다.
- 유효 활성 조직은 0명이어도 요약에 표시하고, 비활성 조직은 네 집계값 중 하나라도 0이 아닐 때만 표시한다.
- 비활성 0명 조직을 숨기는 규칙은 프로젝트 개요 API와 Excel 집계에 동일하게 적용한다.
- D1 schema와 migration 파일은 변경하지 않는다.
- 외부 패키지를 추가하지 않는다.
- 기존 인증, CSRF, 운영자 권한, 프로젝트 만료·종료, revision 충돌 처리를 유지한다.

---

## File Structure

### Modified files

- `packages/contracts/src/organizations.ts`
  - 프로젝트 조직의 `hasHistory`를 `hasBusinessHistory`로 좁혀 wire 의미를 명확히 한다.
- `packages/contracts/src/projects.ts`
  - `ProjectSummaryOrganization`을 분리하고 `isActive`, `masterIsActive`를 포함한다.
- `packages/domain/src/summary.ts`
  - 요약 행 표시 판정 함수와 상태를 포함한 순수 집계를 제공한다.
- `packages/domain/test/summary.test.ts`
  - 활성 0명, 비활성 0명, 비활성 과거 집계를 검증한다.
- `apps/worker/src/db/project-organizations.ts`
  - 명단·예상 스냅샷만으로 `has_business_history`를 계산한다.
- `apps/worker/src/services/project-organizations.ts`
  - D1 batch 안에서 제거·비활성화와 감사 action을 결정한다.
- `apps/worker/src/services/roster.ts`
  - 조직 활성 상태를 조회하고 공통 표시 판정으로 요약 행을 필터링한다.
- `apps/worker/test/project-organizations.integration.test.ts`
  - 감사만 있는 연결 제거, 업무 이력 보존, 재추가를 통합 검증한다.
- `apps/worker/test/summary.integration.test.ts`
  - 요약 포함·제외 및 합계를 검증한다.
- `apps/worker/test/exports.integration.test.ts`
  - Excel 집계가 요약 표시 규칙을 공유함을 검증한다.
- `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
  - 제외 확인 dialog와 단일 업무 action을 제공한다.
- `apps/web/src/features/roster/SummaryCards.tsx`
  - 보존된 비활성 조직에 상태 배지를 표시한다.
- `apps/web/src/features/projects/project-detail.test.tsx`
  - 프로젝트 조직 확인 흐름과 비활성 요약 표시를 검증한다.
- `apps/web/src/features/roster/roster.test.tsx`
- `apps/web/src/features/imports/imports.test.tsx`
- `apps/worker/test/support` 아래 관련 fixture
  - `hasBusinessHistory` 및 확장된 요약 계약으로 fixture를 갱신한다.

---

### Task 1: Business-History-Based Project Organization Exclusion

**Files:**

- Modify: `packages/contracts/src/organizations.ts:122-134`
- Modify: `apps/worker/src/db/project-organizations.ts:3-56,130-149`
- Modify: `apps/worker/src/services/project-organizations.ts:70-84,217-345,426-443`
- Modify: `apps/worker/test/project-organizations.integration.test.ts`
- Modify: all TypeScript test fixtures returned by `rg -l "hasHistory" apps packages`

**Interfaces:**

- Consumes: `project_roster_entries(project_id, organization_id)`, `project_expected_snapshots(project_id, organization_id)`, existing project revision guard
- Produces:

```ts
export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasBusinessHistory: boolean;
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  rosterCount: number;
}
```

- Preserves: `PATCH /api/v1/projects/:projectId/organizations/:organizationId` request and response envelope

- [ ] **Step 1: 계약 이름 변경과 제거 정책의 실패 테스트를 작성한다**

In `packages/contracts/src/organizations.ts`, change only the interface field:

```ts
export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasBusinessHistory: boolean;
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  rosterCount: number;
}
```

In `apps/worker/test/project-organizations.integration.test.ts`, replace the test named
`treats membership audit rows as history and deletes only a truly audit-free fixture`
with a test that uses the public add endpoint and proves its automatically written audit
does not prevent removal:

```ts
it("removes an audit-only membership and can add and remove it again", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization("org-audit-only", "감사 전용 조직");
  const project = await seedProject(operator);
  const linked = await linkProjectOrganization(
    operator,
    project.id,
    organization.id,
    project.revision,
  );

  const listed = await (
    await authedRequest(
      operator,
      `/api/v1/projects/${project.id}/organizations`,
    )
  ).json<Array<{
    organizationId: string;
    hasBusinessHistory: boolean;
  }>>();
  expect(listed).toEqual([
    expect.objectContaining({
      organizationId: organization.id,
      hasBusinessHistory: false,
    }),
  ]);

  const removed = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: linked.projectRevision,
      }),
    },
  );
  const removedBody = await removed.json<{ projectRevision: number }>();
  expect(removed.status).toBe(200);
  expect(
    await env.DB.prepare(
      `SELECT 1 FROM project_organizations
       WHERE project_id = ? AND organization_id = ?`,
    )
      .bind(project.id, organization.id)
      .first(),
  ).toBeNull();

  const relinked = await linkProjectOrganization(
    operator,
    project.id,
    organization.id,
    removedBody.projectRevision,
  );
  const removedAgain = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: relinked.projectRevision,
      }),
    },
  );
  expect(removedAgain.status).toBe(200);
  expect(
    (
      await env.DB.prepare(
        `SELECT action FROM audit_logs
         WHERE entity_type = 'PROJECT_ORGANIZATION'
           AND entity_id = ?
         ORDER BY rowid`,
      )
        .bind(`${project.id}:${organization.id}`)
        .all<{ action: string }>()
    ).results.map((row) => row.action),
  ).toEqual([
    "PROJECT_ORGANIZATION_ADDED",
    "PROJECT_ORGANIZATION_REMOVED",
    "PROJECT_ORGANIZATION_ADDED",
    "PROJECT_ORGANIZATION_REMOVED",
  ]);
});
```

Keep the existing snapshot-backed test near the `expected_count` fixture, but change
its response assertion to:

```ts
expect(await disabled.json()).toMatchObject({
  organization: {
    organizationId: organization.id,
    isActive: false,
    hasBusinessHistory: true,
  },
});
```

Also assert that its last membership audit remains
`PROJECT_ORGANIZATION_DEACTIVATED`.

- [ ] **Step 2: focused Worker test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/project-organizations.integration.test.ts
```

Expected:

- the audit-only membership remains with `is_active=0`, so the row-null assertion FAIL
- the response still exposes `hasHistory`, so `hasBusinessHistory` assertions FAIL
- the second link records `PROJECT_ORGANIZATION_REACTIVATED`, so the action sequence FAIL

- [ ] **Step 3: D1 read model을 업무 이력 의미로 변경한다**

In `apps/worker/src/db/project-organizations.ts`, rename the row property:

```ts
interface ProjectOrganizationRow {
  organization_id: string;
  name: string;
  is_active: number;
  master_is_active: number;
  active_project_count: number;
  has_business_history: number;
  primary_user_id: string | null;
  primary_display_name: string | null;
  manager_count: number;
  roster_count: number;
}
```

Replace the existing `has_history` expression with:

```sql
EXISTS (
  SELECT 1 FROM project_roster_entries roster
  WHERE roster.project_id = po.project_id
    AND roster.organization_id = po.organization_id
  UNION ALL
  SELECT 1 FROM project_expected_snapshots snapshot
  WHERE snapshot.project_id = po.project_id
    AND snapshot.organization_id = po.organization_id
) AS has_business_history
```

Change the mapper property to:

```ts
hasBusinessHistory: row.has_business_history === 1,
```

Do not query `audit_logs` from this read model.

- [ ] **Step 4: 재추가 action을 현재 연결 행 존재 여부로만 결정한다**

In `addProjectOrganization`, remove `priorAudit` and use:

```ts
const created = !current;
const action = created
  ? "PROJECT_ORGANIZATION_ADDED"
  : "PROJECT_ORGANIZATION_REACTIVATED";
```

Delete the unused `hasPriorMembershipAudit` function. This makes a physically removed
connection a new `ADDED` connection while an existing inactive row remains a
`REACTIVATED` connection.

- [ ] **Step 5: 원자 배치 안에서 hard delete와 soft deactivate를 결정한다**

In `setProjectOrganizationActive`, replace `historyPredicate`,
`membershipPredicate`, the single `mutation`, and pre-read `action` with one
business-history predicate:

```ts
const businessHistoryPredicate = `(
  EXISTS (
    SELECT 1 FROM project_roster_entries roster
    WHERE roster.project_id = project_organizations.project_id
      AND roster.organization_id = project_organizations.organization_id
  ) OR EXISTS (
    SELECT 1 FROM project_expected_snapshots snapshot
    WHERE snapshot.project_id = project_organizations.project_id
      AND snapshot.organization_id = project_organizations.organization_id
  )
)`;
const activeMembershipPredicate =
  "project_id = ? AND organization_id = ? AND is_active = 1";
```

Create the audit statement before either membership mutation so its `CASE` observes
the pre-mutation row:

```ts
const conditionalAudit = env.DB.prepare(
  `INSERT INTO audit_logs
   (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
   SELECT ?, ?,
     CASE WHEN ${businessHistoryPredicate}
       THEN 'PROJECT_ORGANIZATION_DEACTIVATED'
       ELSE 'PROJECT_ORGANIZATION_REMOVED'
     END,
     'PROJECT_ORGANIZATION', ?, ?, ?
   FROM project_organizations
   WHERE ${activeMembershipPredicate}`,
).bind(
  crypto.randomUUID(),
  actor.session.user.id,
  membershipEntityId(projectId, organizationId),
  timestamp,
  JSON.stringify({ projectId, organizationId }),
  projectId,
  organizationId,
);
```

Use both mutually exclusive mutations in the same guarded batch:

```ts
const deactivateWithHistory = env.DB.prepare(
  `UPDATE project_organizations
   SET is_active = 0, deactivated_at = ?, updated_by = ?
   WHERE ${activeMembershipPredicate}
     AND ${businessHistoryPredicate}`,
).bind(
  timestamp,
  actor.session.user.id,
  projectId,
  organizationId,
);

const removeWithoutHistory = env.DB.prepare(
  `DELETE FROM project_organizations
   WHERE ${activeMembershipPredicate}
     AND NOT ${businessHistoryPredicate}`,
).bind(projectId, organizationId);
```

The guard must require only the mutable project and active membership:

```sql
EXISTS (
  SELECT 1 FROM projects
  WHERE id = ? AND revision = ?
    AND status <> 'CLOSED'
    AND (end_date IS NULL OR end_date >= ?)
) AND EXISTS (
  SELECT 1 FROM project_organizations
  WHERE project_id = ? AND organization_id = ? AND is_active = 1
)
```

Order batch statements exactly as:

```ts
statements: [
  conditionalAudit,
  deactivateWithHistory,
  removeWithoutHistory,
  env.DB.prepare(
    `UPDATE projects
     SET revision = revision + 1, updated_at = ?
     WHERE id = ? AND revision = ?`,
  ).bind(timestamp, projectId, input.expectedProjectRevision),
],
```

This ordering lets a membership with business history deactivate and a membership
without it delete in the same atomic decision. Keep the existing post-batch lookup
and deleted-row fallback, but rename its field through `current`.

- [ ] **Step 6: 모든 fixture를 새 계약 이름으로 갱신한다**

Run:

```bash
rg -l "hasHistory" apps packages
```

For every TypeScript fixture and assertion returned by the command, replace the
property name with `hasBusinessHistory`. Do not change prose that describes general
audit history. Confirm removal with:

```bash
rg -n "hasHistory" apps packages
```

Expected: no matches.

- [ ] **Step 7: focused tests와 package checks를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/project-organizations.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
corepack pnpm@10.28.1 --filter @event-roster/worker run check
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: focused integration tests PASS and all three checks exit `0`.

- [ ] **Step 8: Task 1을 commit한다**

```bash
git add \
  packages/contracts/src/organizations.ts \
  apps/worker/src/db/project-organizations.ts \
  apps/worker/src/services/project-organizations.ts \
  apps/worker/test/project-organizations.integration.test.ts \
  apps/web/src/features/imports/imports.test.tsx \
  apps/web/src/features/roster/roster.test.tsx \
  apps/web/src/features/projects/project-detail.test.tsx
git commit -m "feat: exclude project organizations by business history"
```

Before committing, verify `git diff --cached --name-only` contains only the
`hasBusinessHistory` contract/fixture migration and project-organization behavior.

---

### Task 2: Shared Inactive-Organization Summary Policy

**Files:**

- Modify: `packages/contracts/src/projects.ts:75-91`
- Modify: `packages/domain/src/summary.ts`
- Modify: `packages/domain/test/summary.test.ts`
- Modify: `apps/worker/src/services/roster.ts:358-431`
- Modify: `apps/worker/test/summary.integration.test.ts`
- Modify: `apps/worker/test/exports.integration.test.ts`
- Modify: `apps/web/src/features/roster/SummaryCards.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**

- Produces:

```ts
export interface ProjectSummaryOrganization {
  organizationId: string;
  organizationName: string;
  isActive: boolean;
  masterIsActive: boolean;
  expected: number;
  inProgressAdded: number;
  inProgressCancelled: number;
  final: number;
  delta: number;
}

export function shouldIncludeProjectSummaryOrganization(
  organization: Pick<
    ProjectSummaryOrganization,
    | "isActive"
    | "masterIsActive"
    | "expected"
    | "inProgressAdded"
    | "inProgressCancelled"
    | "final"
  >,
): boolean;
```

- Consumes: Task 1's project and master active flags from D1
- Preserves: `ProjectSummary` totals and export sheet column names

- [ ] **Step 1: 순수 포함 규칙과 계약의 실패 테스트를 작성한다**

In `packages/contracts/src/projects.ts`, introduce the interface and use it:

```ts
export interface ProjectSummaryOrganization {
  organizationId: string;
  organizationName: string;
  isActive: boolean;
  masterIsActive: boolean;
  expected: number;
  inProgressAdded: number;
  inProgressCancelled: number;
  final: number;
  delta: number;
}

export interface ProjectSummary {
  projectId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: ProjectSummaryOrganization[];
}
```

Replace `packages/domain/test/summary.test.ts` with three focused cases. Use this
shared builder:

```ts
function organization(
  organizationId: string,
  organizationName: string,
  overrides: Partial<{
    isActive: boolean;
    masterIsActive: boolean;
  }> = {},
) {
  return {
    organizationId,
    organizationName,
    isActive: true,
    masterIsActive: true,
    ...overrides,
  };
}
```

Keep the existing count scenario but add active flags to both input organizations
and expected rows. Add:

```ts
it("keeps an active zero-count organization", () => {
  const summary = calculateProjectSummary({
    projectId: "project-1",
    organizations: [organization("org-active", "활성 조직")],
    expectedSnapshots: [],
    rosterEntries: [],
  });

  expect(summary.organizations).toEqual([
    expect.objectContaining({
      organizationId: "org-active",
      isActive: true,
      masterIsActive: true,
      expected: 0,
      final: 0,
    }),
  ]);
});

it("hides inactive zero-count organizations but preserves inactive history", () => {
  const summary = calculateProjectSummary({
    projectId: "project-1",
    organizations: [
      organization("org-empty", "빈 비활성", { isActive: false }),
      organization("org-history", "이력 비활성", {
        masterIsActive: false,
      }),
    ],
    expectedSnapshots: [
      { organizationId: "org-history", expectedCount: 2 },
    ],
    rosterEntries: [],
  });

  expect(summary).toMatchObject({
    expectedTotal: 2,
    finalTotal: 0,
    deltaTotal: -2,
    organizations: [
      {
        organizationId: "org-history",
        organizationName: "이력 비활성",
        isActive: true,
        masterIsActive: false,
        expected: 2,
        final: 0,
        delta: -2,
      },
    ],
  });
});
```

- [ ] **Step 2: domain test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run \
  test/summary.test.ts
```

Expected: `calculateProjectSummary` returns the inactive zero row and does not yet
provide a shared inclusion function.

- [ ] **Step 3: 공통 표시 판정과 순수 집계를 구현한다**

In `packages/domain/src/summary.ts`, import `ProjectSummaryOrganization`, extend
`ProjectSummaryInput.organizations` with `isActive` and `masterIsActive`, and add:

```ts
export function shouldIncludeProjectSummaryOrganization(
  organization: Pick<
    ProjectSummaryOrganization,
    | "isActive"
    | "masterIsActive"
    | "expected"
    | "inProgressAdded"
    | "inProgressCancelled"
    | "final"
  >,
): boolean {
  if (organization.isActive && organization.masterIsActive) return true;
  return (
    organization.expected !== 0 ||
    organization.inProgressAdded !== 0 ||
    organization.inProgressCancelled !== 0 ||
    organization.final !== 0
  );
}
```

Replace the organization mapping with this complete mapping and filter before
calculating totals:

```ts
const organizations = input.organizations
  .map((organization) => {
    const entries = input.rosterEntries.filter(
      (entry) => entry.organizationId === organization.organizationId,
    );
    const expected =
      expectedByOrganization.get(organization.organizationId) ?? 0;
    const inProgressAdded = entries.filter(
      (entry) =>
        entry.source === "IN_PROGRESS" && entry.status === "ACTIVE",
    ).length;
    const inProgressCancelled = entries.filter(
      (entry) =>
        entry.source === "PRE_REGISTRATION" &&
        entry.status === "CANCELLED",
    ).length;
    const final = entries.filter(
      (entry) => entry.status === "ACTIVE",
    ).length;

    return {
      ...organization,
      expected,
      inProgressAdded,
      inProgressCancelled,
      final,
      delta: final - expected,
    };
  })
  .filter(shouldIncludeProjectSummaryOrganization);
```

- [ ] **Step 4: Worker summary와 export의 실패 통합 테스트를 추가한다**

In `apps/worker/test/summary.integration.test.ts`, add a test that creates three
project organizations:

```ts
it("hides inactive zero rows and preserves inactive rows with historical counts", async () => {
  const fixture = await setupPreRegistration();
  const now = "2026-07-21T00:00:00.000Z";
  await seedOrganization("org-empty-inactive", "빈 비활성");
  await seedOrganization("org-history-inactive", "이력 비활성");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-empty-inactive', 0, ?, ?, ?)`,
    ).bind(fixture.project.id, now, fixture.operator.userId, fixture.operator.userId),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-history-inactive', 0, ?, ?, ?)`,
    ).bind(fixture.project.id, now, fixture.operator.userId, fixture.operator.userId),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'org-history-inactive', 3, ?)`,
    ).bind(fixture.project.id, now),
  ]);
  await env.DB.prepare(
    `UPDATE projects SET status = 'IN_PROGRESS' WHERE id = ?`,
  )
    .bind(fixture.project.id)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  const body = await response.json<{
    expectedTotal: number;
    organizations: Array<{
      organizationId: string;
      isActive: boolean;
      masterIsActive: boolean;
      expected: number;
    }>;
  }>();

  expect(body.organizations.map((row) => row.organizationId)).toEqual([
    "org-1",
    "org-history-inactive",
  ]);
  expect(body.organizations[1]).toMatchObject({
    organizationId: "org-history-inactive",
    isActive: false,
    masterIsActive: true,
    expected: 3,
  });
  expect(body.expectedTotal).toBe(3);
});
```

Add the missing imports:

```ts
import { env } from "cloudflare:workers";
import { authedRequest, seedOrganization } from "./support/admin";
```

In `apps/worker/test/exports.integration.test.ts`, add:

```ts
it("uses the same inactive-organization visibility rule for export summaries", async () => {
  const fixture = await setupPreRegistration();
  const now = "2026-07-21T00:00:00.000Z";
  await seedOrganization("org-export-empty", "내보내기 빈 비활성");
  await env.DB.prepare(
    `INSERT INTO project_organizations
     (project_id, organization_id, is_active, added_at, added_by, updated_by)
     VALUES (?, 'org-export-empty', 0, ?, ?, ?)`,
  )
    .bind(fixture.project.id, now, fixture.operator.userId, fixture.operator.userId)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/exports/roster`,
  );
  const body = await response.json<{ 집계: Array<{ 조직: string }> }>();

  expect(body.집계.map((row) => row.조직)).toEqual(["1팀"]);
});
```

- [ ] **Step 5: Worker summary test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/summary.integration.test.ts \
  test/exports.integration.test.ts
```

Expected: summary includes `org-empty-inactive` and response rows lack
`isActive`/`masterIsActive`.

- [ ] **Step 6: Worker SQL과 mapping에 활성 상태 및 공통 필터를 적용한다**

In `apps/worker/src/services/roster.ts`, add:

```ts
import {
  DomainError,
  shouldIncludeProjectSummaryOrganization,
  toKstDate,
} from "@event-roster/domain";
```

Extend the summary SELECT and GROUP BY:

```sql
SELECT po.organization_id, o.name AS organization_name,
  po.is_active, o.is_active AS master_is_active,
  CASE WHEN p.status = 'PRE_REGISTRATION' THEN
    SUM(CASE WHEN r.source = 'PRE_REGISTRATION' AND r.status = 'ACTIVE'
             THEN 1 ELSE 0 END)
    ELSE COALESCE(s.expected_count, 0)
  END AS expected,
  SUM(CASE WHEN r.source = 'IN_PROGRESS' AND r.status = 'ACTIVE'
           THEN 1 ELSE 0 END) AS in_progress_added,
  SUM(CASE WHEN r.source = 'PRE_REGISTRATION' AND r.status = 'CANCELLED'
                 AND r.was_expected_at_start = 1
           THEN 1 ELSE 0 END) AS in_progress_cancelled,
  SUM(CASE WHEN r.status = 'ACTIVE' THEN 1 ELSE 0 END) AS final
FROM projects p
JOIN project_organizations po ON po.project_id = p.id
JOIN organizations o ON o.id = po.organization_id
LEFT JOIN project_expected_snapshots s
  ON s.project_id = p.id AND s.organization_id = po.organization_id
LEFT JOIN project_roster_entries r
  ON r.project_id = p.id AND r.organization_id = po.organization_id
WHERE p.id = ?
GROUP BY po.organization_id, o.name, po.is_active, o.is_active,
         p.status, s.expected_count
ORDER BY o.name, po.organization_id
```

Keep the existing `${scopeSql}` suffix immediately after `WHERE p.id = ?`.
Extend the row type:

```ts
is_active: number;
master_is_active: number;
```

Map and filter:

```ts
const organizations = rows
  .map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    isActive: row.is_active === 1,
    masterIsActive: row.master_is_active === 1,
    expected: row.expected,
    inProgressAdded: row.in_progress_added,
    inProgressCancelled: row.in_progress_cancelled,
    final: row.final,
    delta: row.final - row.expected,
  }))
  .filter(shouldIncludeProjectSummaryOrganization);
```

Keep total calculation after this filter. `getExportData` already calls
`getSummary`, so do not add a second export-only predicate.

- [ ] **Step 7: 비활성 배지의 실패 React test를 작성한다**

In `apps/web/src/features/projects/project-detail.test.tsx`, make the overview
summary fixture return one inactive historical row:

```ts
{
  projectId: "project-1",
  expectedTotal: 2,
  finalTotal: 1,
  deltaTotal: -1,
  organizations: [
    {
      organizationId: "org-history",
      organizationName: "과거 조직",
      isActive: false,
      masterIsActive: true,
      expected: 2,
      inProgressAdded: 0,
      inProgressCancelled: 1,
      final: 1,
      delta: -1,
    },
  ],
}
```

Assert:

```ts
const row = screen.getByText("과거 조직").closest("tr");
expect(row).not.toBeNull();
expect(within(row as HTMLElement).getByText("비활성")).toHaveClass(
  "er-badge--inactive",
);
```

Update any non-empty `ProjectSummary` fixture in
`apps/web/src/features/roster/roster.test.tsx` to include:

```ts
isActive: true,
masterIsActive: true,
```

- [ ] **Step 8: React test를 실행해 RED를 확인하고 배지를 구현한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx \
  src/features/roster/roster.test.tsx
```

Expected: `비활성` badge assertion FAIL before the component change.

In `apps/web/src/features/roster/SummaryCards.tsx`, import no new component and
render the existing badge class beside the name:

```tsx
<td>
  <span className="er-table-organization">
    <span>{row.organizationName}</span>
    {!row.isActive || !row.masterIsActive ? (
      <span className="er-badge er-badge--inactive">비활성</span>
    ) : null}
  </span>
</td>
```

In `apps/web/src/styles/global.css`, add:

```css
.er-table-organization {
  display: inline-flex;
  align-items: center;
  gap: var(--er-space-2);
}
```

- [ ] **Step 9: Task 2 focused tests와 checks를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run \
  test/summary.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/summary.integration.test.ts \
  test/exports.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx \
  src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
corepack pnpm@10.28.1 --filter @event-roster/domain run check
corepack pnpm@10.28.1 --filter @event-roster/worker run check
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: all focused tests PASS and all package checks exit `0`.

- [ ] **Step 10: Task 2를 commit한다**

```bash
git add \
  packages/contracts/src/projects.ts \
  packages/domain/src/summary.ts \
  packages/domain/test/summary.test.ts \
  apps/worker/src/services/roster.ts \
  apps/worker/test/summary.integration.test.ts \
  apps/worker/test/exports.integration.test.ts \
  apps/web/src/features/roster/SummaryCards.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/features/roster/roster.test.tsx \
  apps/web/src/styles/global.css
git commit -m "fix: hide empty inactive organizations from summaries"
```

---

### Task 3: Single Project-Exclusion Confirmation Flow

**Files:**

- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`

**Interfaces:**

- Consumes: Task 1's `ProjectOrganization.hasBusinessHistory`
- Produces: one `프로젝트에서 제외` action whose confirmation copy explains the server-selected storage result
- Preserves: existing `setActive(membership, true)` reactivation request and revision chaining

- [ ] **Step 1: 확인 dialog와 단일 action의 실패 테스트를 작성한다**

In the existing project-organization panel tests, replace the direct
`사용 중지` click expectation with:

```ts
fireEvent.click(
  screen.getByRole("button", { name: "프로젝트에서 제외" }),
);
const dialog = screen.getByRole("dialog", { name: "프로젝트 조직 제외" });
expect(
  within(dialog).getByText(
    "이 조직을 프로젝트에서 제외할까요? 다시 추가할 수 있습니다.",
  ),
).toBeVisible();
expect(mockApi.patch).not.toHaveBeenCalled();

fireEvent.click(
  within(dialog).getByRole("button", { name: "제외하기" }),
);
await waitFor(() =>
  expect(mockApi.patch).toHaveBeenCalledWith(
    "/projects/project-1/organizations/org-1",
    { isActive: false, expectedProjectRevision: 7 },
  ),
);
```

Use `organizationMembership({ hasBusinessHistory: false })` for that test.
Add a second copy test:

```ts
it("explains preservation when excluding an organization with business history", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[
        organizationMembership({ hasBusinessHistory: true }),
      ]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "프로젝트에서 제외" }),
  );
  expect(
    screen.getByText(
      "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다.",
    ),
  ).toBeVisible();
});
```

Keep the reactivation half of the revision-chain test and continue to assert
`다시 사용` sends `{ isActive: true, expectedProjectRevision: 8 }`.

- [ ] **Step 2: focused React test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx
```

Expected: no `프로젝트에서 제외` button or confirmation dialog exists.

- [ ] **Step 3: pending exclusion state와 confirmation dialog를 구현한다**

In `ProjectOrganizationsPanel`, add:

```ts
const [pendingExclusion, setPendingExclusion] =
  useState<ProjectOrganization | null>(null);
```

Change `OrganizationMembershipRow` props from `onSetActive` to:

```ts
onExclude: () => void;
onReactivate: () => Promise<boolean>;
```

Render the row action as:

```tsx
{membership.isActive ? (
  <Button
    type="button"
    variant="danger"
    disabled={busy}
    onClick={onExclude}
  >
    프로젝트에서 제외
  </Button>
) : (
  <Button
    type="button"
    variant="secondary"
    loading={loading}
    loadingText="변경 중…"
    disabled={busy || !membership.masterIsActive}
    onClick={() => void onReactivate()}
  >
    다시 사용
  </Button>
)}
```

Pass callbacks from the list:

```tsx
onExclude={() => setPendingExclusion(membership)}
onReactivate={() => setActive(membership, true)}
```

After the new-organization confirmation, render:

```ts
async function confirmExclusion() {
  if (!pendingExclusion) return;
  const changed = await setActive(pendingExclusion, false);
  if (changed) setPendingExclusion(null);
}
```

```tsx
{canMutateMemberships && pendingExclusion ? (
  <Dialog
    title="프로젝트 조직 제외"
    hideDefaultCloseAction
    onClose={() => {
      if (!busy) setPendingExclusion(null);
    }}
  >
    <p>
      {pendingExclusion.hasBusinessHistory
        ? "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다."
        : "이 조직을 프로젝트에서 제외할까요? 다시 추가할 수 있습니다."}
    </p>
    <div className="er-dialog-actions">
      <Button
        type="button"
        disabled={busy}
        onClick={() => setPendingExclusion(null)}
      >
        취소
      </Button>
      <Button
        type="button"
        variant="danger"
        loading={
          busyAction === `TOGGLE:${pendingExclusion.organizationId}`
        }
        loadingText="제외 중…"
        disabled={busy}
        onClick={() => void confirmExclusion()}
      >
        제외하기
      </Button>
    </div>
  </Dialog>
) : null}
```

Change `setActive` to return the boolean result from `mutate`:

```ts
async function setActive(
  membership: ProjectOrganization,
  active: boolean,
) {
  return mutate(`TOGGLE:${membership.organizationId}`, () =>
    api.patch<ProjectOrganizationMutationResult>(
      `/projects/${projectId}/organizations/${membership.organizationId}`,
      {
        isActive: active,
        expectedProjectRevision: observedProjectRevision,
      },
    ),
  );
}
```

`confirmExclusion` clears the state only when `mutate` returns `true`, so a generic
failure preserves the dialog and its context.

- [ ] **Step 4: focused test와 Web check를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: project-detail tests PASS and Web check exits `0`.

- [ ] **Step 5: Task 3을 commit한다**

```bash
git add \
  apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/projects/project-detail.test.tsx
git commit -m "feat: confirm project organization exclusion"
```

---

### Task 4: Plan-Wide Verification

**Files:**

- Verify only; no planned source file changes

**Interfaces:**

- Consumes: Tasks 1–3
- Produces: evidence that contracts, domain, Worker, web, export, and formatting agree

- [ ] **Step 1: stale contract names와 accidental schema changes를 검사한다**

Run:

```bash
rg -n "hasHistory" apps packages
git diff main -- apps/worker/migrations
```

Expected: no `hasHistory` matches and no migration diff.

- [ ] **Step 2: 전체 정적 검사와 테스트를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 run format:check
corepack pnpm@10.28.1 run check
corepack pnpm@10.28.1 run test
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Worker production configuration dry-run을 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy \
  --dry-run
```

Expected: Worker bundle builds successfully without changing Cloudflare state.

- [ ] **Step 4: 실패가 있으면 소유 Task로 되돌아간다**

The verification commands are read-only. If one fails, return to the task that owns
the failing file, add a focused regression assertion, implement the smallest fix,
rerun that task's commands, and amend only that task's commit. Do not create an empty
verification commit.
