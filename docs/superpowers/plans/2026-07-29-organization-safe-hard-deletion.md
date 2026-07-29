# Organization Safe Hard Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an administrative operator to permanently delete only an inactive organization with no assignments, participants, project links, roster history, or expected snapshots, after typing its exact current name.

**Architecture:** Extend the organization detail contract with server-calculated deletion eligibility, then enforce the same conditions again inside the existing D1 guarded atomic mutation before writing an append-only audit row and deleting the organization. Keep API orchestration in `OrganizationDetailPage`, put the danger-zone presentation in a focused controlled component, and carry the one-time success message through browser history state when returning to the organization list.

**Tech Stack:** TypeScript, Zod, Hono, Cloudflare Workers and D1, React, Vitest, Testing Library, Playwright, pnpm 10.28.1

## Global Constraints

- Only an organization with `organizations.is_active = 0` can be permanently deleted.
- All five blocker counts must be zero: `user_organizations`, `participants`, `project_organizations`, `project_roster_entries`, and `project_expected_snapshots`.
- Blocker counts include active, inactive, historical, and closed-project rows; no status filter is allowed.
- Existing `audit_logs` never block deletion and remain append-only after the organization row is gone.
- The confirmation name is compared byte-for-byte with the current stored `organizations.name`; do not trim, case-fold, or Unicode-normalize it.
- Exact Origin, full session, CSRF, and administrative operator authorization are required.
- UI eligibility is advisory; the D1 guarded atomic mutation is authoritative and must repeat every condition.
- Existing `ON DELETE RESTRICT` foreign keys remain the final database defense; no cascade deletion is introduced.
- A successful mutation writes `ORGANIZATION_DELETED` and deletes the organization in the same atomic batch.
- A deleted canonical name may be reused, but the recreated organization receives a new ID.
- There is no D1 migration, recovery UI, grace period, trash view, or forced deletion of referenced data.
- Preserve user-owned untracked files such as `.DS_Store` and `.pnpm-store/`.

---

## File Structure

### Contracts

- `packages/contracts/src/organizations.ts`: deletion request schema and organization deletion eligibility types.
- `packages/contracts/test/contracts.test.ts`: exact-name parsing and public contract type coverage.

### Worker

- `apps/worker/src/db/organizations.ts`: full-history blocker count query and organization detail mapping.
- `apps/worker/src/services/organizations.ts`: preflight checks, guarded atomic deletion, audit payload, and constraint sanitization.
- `apps/worker/src/routes/organizations.ts`: authenticated `DELETE /organizations/:id` route.
- `apps/worker/test/organization-leadership.integration.test.ts`: organization detail eligibility coverage.
- `apps/worker/test/organization-deletion.integration.test.ts`: deletion policy, atomicity, authorization, concurrency, and name reuse.

### Web

- `apps/web/src/lib/api.ts`: optional JSON body support for DELETE requests.
- `apps/web/src/lib/api.test.ts`: DELETE body, headers, and 204 parsing.
- `apps/web/src/features/admin/OrganizationDeletionPanel.tsx`: controlled danger zone and exact-name confirmation dialog.
- `apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx`: isolated danger-zone interaction and accessibility tests.
- `apps/web/src/features/admin/OrganizationDetailPage.tsx`: API mutation, conflict refresh, navigation, and stale-request ownership.
- `apps/web/src/features/admin/OrganizationsPage.tsx`: consume and clear the one-time deletion notice.
- `apps/web/src/features/admin/admin.test.tsx`: page-level mutation, navigation, conflict, and notice tests.
- `apps/web/src/styles/global.css`: danger-zone separation and 360px dialog layout.
- `apps/web/e2e/organization-management.spec.ts`: complete empty-organization deletion and blocked historical-link journey.

---

### Task 1: Define organization deletion contracts

**Files:**
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces: `OrganizationDeletionBlockers`
- Produces: `OrganizationDeletionEligibility`
- Produces: `OrganizationDeleteRequestSchema`
- Produces: `OrganizationDeleteRequest`
- Extends: `OrganizationDetail.deletionEligibility`

- [ ] **Step 1: Write failing contract tests**

Add imports and an organization contract test that fixes the exact request
behavior and public result shape:

```ts
import type {
  OrganizationDeletionBlockers,
  OrganizationDeletionEligibility,
} from "../src";
import {
  OrganizationDeleteRequestSchema,
} from "../src";

it("requires an exact unnormalized organization deletion confirmation", () => {
  expect(
    OrganizationDeleteRequestSchema.parse({
      confirmationName: "황룡사",
    }),
  ).toEqual({ confirmationName: "황룡사" });
  expect(
    OrganizationDeleteRequestSchema.parse({
      confirmationName: "  황룡사  ",
    }),
  ).toEqual({ confirmationName: "  황룡사  " });
  expect(
    OrganizationDeleteRequestSchema.safeParse({
      confirmationName: "황룡사",
      cascade: true,
    }).success,
  ).toBe(false);
  expect(
    OrganizationDeleteRequestSchema.safeParse({
      confirmationName: "",
    }).success,
  ).toBe(false);

  expectTypeOf<OrganizationDeletionBlockers>().toEqualTypeOf<{
    managerAssignments: number;
    participants: number;
    projectLinks: number;
    rosterEntries: number;
    expectedSnapshots: number;
  }>();
  expectTypeOf<OrganizationDeletionEligibility>().toEqualTypeOf<{
    canDelete: boolean;
    blockers: OrganizationDeletionBlockers;
  }>();
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
```

Expected: FAIL because the deletion schema and eligibility types do not exist.

- [ ] **Step 3: Add the exact public contracts**

Add to `packages/contracts/src/organizations.ts`:

```ts
export interface OrganizationDeletionBlockers {
  managerAssignments: number;
  participants: number;
  projectLinks: number;
  rosterEntries: number;
  expectedSnapshots: number;
}

export interface OrganizationDeletionEligibility {
  canDelete: boolean;
  blockers: OrganizationDeletionBlockers;
}

export interface OrganizationDetail extends OrganizationSummary {
  managers: OrganizationManager[];
  projects: OrganizationProject[];
  deletionEligibility: OrganizationDeletionEligibility;
}

export const OrganizationDeleteRequestSchema = z
  .object({
    confirmationName: z.string().min(1).max(100),
  })
  .strict();

export type OrganizationDeleteRequest = z.infer<
  typeof OrganizationDeleteRequestSchema
>;
```

Do not add `.trim()` to `confirmationName`. Keep the existing root barrel
export through `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contract tests and type checking**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/organizations.ts \
  packages/contracts/test/contracts.test.ts
git commit -m "feat: define organization deletion contracts"
```

---

### Task 2: Calculate full-history deletion eligibility

**Files:**
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/test/organization-leadership.integration.test.ts`

**Interfaces:**
- Consumes: `OrganizationDeletionBlockers`
- Consumes: `OrganizationDeletionEligibility`
- Produces: `findOrganizationDeletionBlockers(db, organizationId)`
- Produces: `toOrganizationDeletionEligibility(isActive, blockers)`
- Extends: `findOrganizationDetail` with `deletionEligibility`

- [ ] **Step 1: Write failing detail eligibility tests**

Extend the complete-detail test so the existing organization proves that
assignments and project links are counted:

```ts
expect(await detail.json()).toMatchObject({
  id: "org-1",
  deletionEligibility: {
    canDelete: false,
    blockers: {
      managerAssignments: 3,
      participants: 0,
      projectLinks: 2,
      rosterEntries: 0,
      expectedSnapshots: 0,
    },
  },
});
```

Add a test for an inactive empty organization and a full-history organization:

```ts
it("reports exact full-history organization deletion blockers", async () => {
  const operator = await seedOperator();
  await seedOrganization("empty-inactive", "빈 조직", false);
  await seedOrganization("history-inactive", "이력 조직", false);
  const now = "2026-07-29T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason)
       VALUES ('closed-delete-check', '종료 이력', 'CLOSED', 0, ?, ?, ?, ?, ?, 'MANUAL')`,
    ).bind(operator.userId, now, now, now, operator.userId),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, deactivated_at,
        added_by, updated_by)
       VALUES ('closed-delete-check', 'history-inactive', 0, ?, ?, ?, ?)`,
    ).bind(now, now, operator.userId, operator.userId),
  ]);

  const empty = await (
    await authedRequest(
      operator,
      "/api/v1/organizations/empty-inactive",
    )
  ).json<OrganizationDetail>();
  expect(empty.deletionEligibility).toEqual({
    canDelete: true,
    blockers: {
      managerAssignments: 0,
      participants: 0,
      projectLinks: 0,
      rosterEntries: 0,
      expectedSnapshots: 0,
    },
  });

  const history = await (
    await authedRequest(
      operator,
      "/api/v1/organizations/history-inactive",
    )
  ).json<OrganizationDetail>();
  expect(history.deletionEligibility.canDelete).toBe(false);
  expect(history.deletionEligibility.blockers.projectLinks).toBe(1);
});
```

- [ ] **Step 2: Run the focused Worker test and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-leadership.integration.test.ts
```

Expected: FAIL because `deletionEligibility` is absent.

- [ ] **Step 3: Add the focused blocker query**

In `apps/worker/src/db/organizations.ts`, add:

```ts
export async function findOrganizationDeletionBlockers(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationDeletionBlockers> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_organizations
          WHERE organization_id = ?) AS manager_assignments,
         (SELECT COUNT(*) FROM participants
          WHERE organization_id = ?) AS participants,
         (SELECT COUNT(*) FROM project_organizations
          WHERE organization_id = ?) AS project_links,
         (SELECT COUNT(*) FROM project_roster_entries
          WHERE organization_id = ?) AS roster_entries,
         (SELECT COUNT(*) FROM project_expected_snapshots
          WHERE organization_id = ?) AS expected_snapshots`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
    )
    .first<{
      manager_assignments: number;
      participants: number;
      project_links: number;
      roster_entries: number;
      expected_snapshots: number;
    }>();
  if (!row) {
    throw new Error("organization deletion blocker query returned no row");
  }
  return {
    managerAssignments: row.manager_assignments,
    participants: row.participants,
    projectLinks: row.project_links,
    rosterEntries: row.roster_entries,
    expectedSnapshots: row.expected_snapshots,
  };
}

export function toOrganizationDeletionEligibility(
  isActive: boolean,
  blockers: OrganizationDeletionBlockers,
): OrganizationDeletionEligibility {
  return {
    canDelete:
      !isActive && Object.values(blockers).every((count) => count === 0),
    blockers,
  };
}
```

Import the two contract types. The count query contains no active or
project-status predicate.

- [ ] **Step 4: Attach eligibility only to detail reads**

Add the blocker query to the existing detail-only `Promise.all`:

```ts
const [managerResult, projectResult, blockers] = await Promise.all([
  // existing manager query
  // existing project query
  findOrganizationDeletionBlockers(db, organizationId),
]);

const summary = mapSummary(summaryRow);
return {
  ...summary,
  managers: managerResult.results.map((row) => ({
    userId: row.user_id,
    loginId: row.login_id,
    displayName: row.display_name,
    isActive: row.is_active === 1,
    assignmentRole: row.assignment_role,
    assignedAt: row.assigned_at,
  })),
  projects: projectResult.results.map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    projectStatus: row.project_status,
    membershipIsActive: row.membership_is_active === 1,
  })),
  deletionEligibility: toOrganizationDeletionEligibility(
    summary.isActive,
    blockers,
  ),
};
```

Do not add blocker subqueries to `ORGANIZATION_SUMMARY_SELECT`; organization
list performance and response shape stay unchanged.

- [ ] **Step 5: Run focused tests and Worker check**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-leadership.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: both commands PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/db/organizations.ts \
  apps/worker/test/organization-leadership.integration.test.ts
git commit -m "feat: report organization deletion eligibility"
```

---

### Task 3: Enforce guarded atomic organization deletion

**Files:**
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/routes/organizations.ts`
- Create: `apps/worker/test/organization-deletion.integration.test.ts`

**Interfaces:**
- Consumes: `OrganizationDeleteRequest`
- Consumes: `findOrganizationDeletionBlockers`
- Consumes: `toOrganizationDeletionEligibility`
- Produces: `deleteOrganization(env, actor, id, input): Promise<void>`
- Produces: `DELETE /api/v1/organizations/:id`

- [ ] **Step 1: Write failing authorization and precondition tests**

Create `organization-deletion.integration.test.ts` with `beforeEach(resetAuthState)`
and tests for the route contract:

```ts
it("requires an administrative full session, exact origin, and csrf", async () => {
  const operator = await seedOperator();
  await seedOrganization("manager-scope", "담당 범위 조직");
  const manager = await seedManager("manager-scope");
  await seedOrganization("delete-auth", "삭제 권한 조직", false);

  const missingCsrf = await apiRequest(
    "/api/v1/organizations/delete-auth",
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${operator.auth.body.accessToken}`,
        "X-ER-CSRF": "",
      },
      body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
    },
  );
  expect(missingCsrf.status).toBe(403);

  expect(
    (
      await authedRequest(
        manager,
        "/api/v1/organizations/delete-auth",
        {
          method: "DELETE",
          body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
        },
      )
    ).status,
  ).toBe(403);
});

it("rejects active organizations and mismatched exact names", async () => {
  const operator = await seedOperator();
  await seedOrganization("active-delete", "활성 삭제 조직", true);
  await seedOrganization("name-delete", "정확한 이름", false);

  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/active-delete",
        {
          method: "DELETE",
          body: JSON.stringify({ confirmationName: "활성 삭제 조직" }),
        },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/name-delete",
        {
          method: "DELETE",
          body: JSON.stringify({ confirmationName: " 정확한 이름 " }),
        },
      )
    ).status,
  ).toBe(409);
});
```

Import and use the existing `seedManager` helper. Add assertions in the same
test for an evil `Origin` and a `MUST_CHANGE_PASSWORD` operator session; both
must return 403 before the service runs.

Use the existing auth helpers for those two cases:

```ts
const evilOrigin = await apiRequest(
  "/api/v1/organizations/delete-auth",
  {
    method: "DELETE",
    headers: {
      ...authenticatedHeaders(operator),
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
  },
);
expect(evilOrigin.status).toBe(403);

await seedUser({
  id: "must-change-operator",
  loginId: "must-change-op",
  password: "temporary-password-123",
  mustChange: true,
});
const mustChange = await login(
  "must-change-op",
  "temporary-password-123",
);
expect(
  (
    await authedRequest(
      mustChange,
      "/api/v1/organizations/delete-auth",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
      },
    )
  ).status,
).toBe(403);
```

- [ ] **Step 2: Write failing blocker, stale-view, and atomicity tests**

Add a fixture that creates one inactive organization with all five blocker
types. Roster and expected rows may share their required project and
participant; assert every returned count instead of pretending the foreign
keys allow those rows independently:

```ts
async function seedOrganizationWithEveryDeletionBlocker() {
  const operator = await seedOperator();
  await seedOrganization("blocked-delete", "삭제 차단 조직", false);
  await seedManager("blocked-delete");
  const project = await seedProject(operator, {
    name: "삭제 차단 이력",
  });
  const now = "2026-07-29T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('blocked-participant', 'P-BLOCKED', '차단 참가자',
               'blocked-delete', 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, deactivated_at,
        added_by, updated_by)
       VALUES (?, 'blocked-delete', 0, ?, ?, ?, ?)`,
    ).bind(
      project.id,
      now,
      now,
      operator.userId,
      operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot,
        source, status, was_expected_at_start, revision,
        created_by, updated_by, created_at, updated_at)
       VALUES ('blocked-roster', ?, 'blocked-participant', 'blocked-delete',
               '차단 참가자', '삭제 차단 조직', 'STUDENT', 'M1',
               'PRE_REGISTRATION', 'CANCELLED', 0, 0, ?, ?, ?, ?)`,
    ).bind(
      project.id,
      operator.userId,
      operator.userId,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'blocked-delete', 1, ?)`,
    ).bind(project.id, now),
  ]);

  return { operator, project };
}

const { operator } =
  await seedOrganizationWithEveryDeletionBlocker();
const detail = await (
  await authedRequest(
    operator,
    "/api/v1/organizations/blocked-delete",
  )
).json<OrganizationDetail>();
const deleteResponse = await authedRequest(
  operator,
  "/api/v1/organizations/blocked-delete",
  {
    method: "DELETE",
    body: JSON.stringify({ confirmationName: "삭제 차단 조직" }),
  },
);

expect(detail.deletionEligibility.blockers).toEqual({
  managerAssignments: 1,
  participants: 1,
  projectLinks: 1,
  rosterEntries: 1,
  expectedSnapshots: 1,
});
expect(deleteResponse.status).toBe(409);
expect(
  await env.DB.prepare(
    "SELECT id FROM organizations WHERE id = 'blocked-delete'",
  ).first(),
).not.toBeNull();
```

Prove stale UI safety by reading `canDelete: true`, then inserting a project
and `project_organizations` row before DELETE. Expect 409 and the organization
to remain.

Prove audit atomicity with an insert-failure trigger:

```ts
await env.DB.prepare(
  `CREATE TRIGGER fail_organization_delete_audit
   BEFORE INSERT ON audit_logs
   WHEN NEW.action = 'ORGANIZATION_DELETED'
   BEGIN
     SELECT RAISE(ABORT, 'AUDIT_INSERT_FAILED');
   END`,
).run();
try {
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/audit-failure-delete",
    {
      method: "DELETE",
      body: JSON.stringify({
        confirmationName: "감사 실패 조직",
      }),
    },
  );
  expect(response.status).toBe(500);
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'audit-failure-delete'",
    ).first(),
  ).not.toBeNull();
} finally {
  await env.DB.prepare(
    "DROP TRIGGER IF EXISTS fail_organization_delete_audit",
  ).run();
}
```

- [ ] **Step 3: Write failing success, audit, and name-reuse tests**

```ts
it("atomically audits and deletes an inactive empty organization", async () => {
  const operator = await seedOperator();
  await seedOrganization("empty-delete", "재사용 이름", false);

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/empty-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "재사용 이름" }),
    },
  );
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'empty-delete'",
    ).first(),
  ).toBeNull();
  expect(
    (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);

  const audit = await env.DB.prepare(
    `SELECT actor_user_id, details_json FROM audit_logs
     WHERE action = 'ORGANIZATION_DELETED'
       AND entity_type = 'ORGANIZATION'
       AND entity_id = 'empty-delete'`,
  ).first<{ actor_user_id: string; details_json: string }>();
  expect(audit?.actor_user_id).toBe(operator.userId);
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    before: { name: "재사용 이름", isActive: false },
    after: { name: null, isActive: null },
    deletionEligibility: {
      managerAssignments: 0,
      participants: 0,
      projectLinks: 0,
      rosterEntries: 0,
      expectedSnapshots: 0,
    },
  });

  const recreated = await authedRequest(
    operator,
    "/api/v1/organizations",
    {
      method: "POST",
      body: JSON.stringify({ name: "재사용 이름" }),
    },
  );
  expect(recreated.status).toBe(201);
  expect((await recreated.json<{ id: string }>()).id).not.toBe(
    "empty-delete",
  );
});
```

Also assert a second DELETE returns 404.

- [ ] **Step 4: Run focused Worker tests and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-deletion.integration.test.ts
```

Expected: FAIL because the DELETE route and service do not exist.

- [ ] **Step 5: Implement the service preflight and atomic guard**

Add this public service signature:

```ts
export async function deleteOrganization(
  env: Env,
  actor: Actor,
  id: string,
  input: OrganizationDeleteRequest,
): Promise<void>
```

Load current state and blockers first:

```ts
const current = await findOrganizationState(env.DB, id);
if (!current) throw new DomainError("NOT_FOUND");
if (current.name !== input.confirmationName) {
  throw new DomainError("CONFLICT");
}
const blockers = await findOrganizationDeletionBlockers(env.DB, id);
if (!toOrganizationDeletionEligibility(current.isActive, blockers).canDelete) {
  throw new DomainError("CONFLICT");
}
```

Build the authoritative guard without any active/history filters:

```ts
const deleteGuard = `EXISTS (
    SELECT 1 FROM organizations
    WHERE id = ? AND name = ? AND is_active = 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_organizations WHERE organization_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM participants WHERE organization_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM project_organizations WHERE organization_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM project_roster_entries WHERE organization_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM project_expected_snapshots WHERE organization_id = ?
  )`;
```

Pass bindings in this exact order:

```ts
[
  id,
  current.name,
  id,
  id,
  id,
  id,
  id,
]
```

The guarded batch statements are:

```ts
[
  organizationAuditStatement(
    env.DB,
    actor.session.user.id,
    "ORGANIZATION_DELETED",
    id,
    now,
    {
      before: { name: current.name, isActive: false },
      after: { name: null, isActive: null },
      deletionEligibility: blockers,
    },
  ),
  env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(id),
]
```

Use `createOperatorGuard`, `runGuardedAtomic`, and `failureCode: "CONFLICT"`.
Map only a D1 foreign-key constraint raised by the DELETE to
`DomainError("CONFLICT")`; leave the injected audit failure and unrelated
errors as internal errors so atomicity failures are observable.

- [ ] **Step 6: Add the authenticated route**

Import the request schema and service, then add after manager-assignment
DELETE and before the generic PATCH route:

```ts
organizationRoutes.delete("/organizations/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationDeleteRequestSchema.parse(await c.req.json());
  await deleteOrganization(c.env, actor, c.req.param("id"), input);
  return c.body(null, 204);
});
```

Do not weaken or reorder the auth checks.

- [ ] **Step 7: Run focused and adjacent Worker tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-deletion.integration.test.ts \
  test/organization-leadership.integration.test.ts \
  test/project-organizations.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: all commands PASS and `PRAGMA foreign_key_check` assertions return
no rows.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/services/organizations.ts \
  apps/worker/src/routes/organizations.ts \
  apps/worker/test/organization-deletion.integration.test.ts
git commit -m "feat: safely delete empty organizations"
```

---

### Task 4: Build the controlled danger-zone component

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/api.test.ts`
- Create: `apps/web/src/features/admin/OrganizationDeletionPanel.tsx`
- Create: `apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Produces: `api.delete<T>(path, body?)`
- Produces: `OrganizationDeletionPanel`
- Consumes: `OrganizationDetail.deletionEligibility`

- [ ] **Step 1: Write a failing API client DELETE-body test**

Create `apps/web/src/lib/api.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { createApiClient } from "./api";

it("sends an optional json body and csrf header with DELETE", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    getAuth: () => ({
      accessToken: "access",
      csrfToken: "csrf",
      session: {
        sessionKind: "FULL",
        user: {
          id: "operator",
          loginId: "operator",
          displayName: "운영자",
          role: "OPERATOR",
          organizationIds: [],
          isBootstrap: false,
        },
      },
    }),
    refresh: async () => null,
  });

  await client.delete("/organizations/org-1", {
    confirmationName: "황룡사",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/organizations/org-1",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "황룡사" }),
      headers: expect.any(Headers),
    }),
  );
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("X-ER-CSRF")).toBe("csrf");
});
```

Keep the existing no-body manager deletion behavior covered:

```ts
await client.delete("/organizations/org-1/managers/user-1");
expect(fetchMock).toHaveBeenLastCalledWith(
  "/api/v1/organizations/org-1/managers/user-1",
  expect.not.objectContaining({ body: expect.anything() }),
);
```

- [ ] **Step 2: Run the API client test and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/lib/api.test.ts
```

Expected: FAIL because `delete` accepts no body.

- [ ] **Step 3: Implement optional DELETE JSON bodies**

Change only the delete helper:

```ts
delete: <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "DELETE",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
```

The common `send` function will add JSON and CSRF headers only when a body and
authenticated mutation are present.

- [ ] **Step 4: Write failing danger-zone component tests**

Define a controlled component interface:

```ts
export interface OrganizationDeletionPanelProps {
  organization: OrganizationDetail;
  dialogOpen: boolean;
  confirmationName: string;
  deleting: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: () => void;
  onConfirmationNameChange: (value: string) => void;
  onConfirm: () => void;
}
```

Define complete, compile-safe fixtures before the tests:

```ts
const emptyBlockers: OrganizationDeletionBlockers = {
  managerAssignments: 0,
  participants: 0,
  projectLinks: 0,
  rosterEntries: 0,
  expectedSnapshots: 0,
};

function organization(
  overrides: Partial<OrganizationDetail> = {},
): OrganizationDetail {
  return {
    id: "org-1",
    name: "황룡사",
    isActive: false,
    primaryLeader: null,
    managerCount: 0,
    projectCount: 0,
    managers: [],
    projects: [],
    deletionEligibility: {
      canDelete: true,
      blockers: emptyBlockers,
    },
    ...overrides,
  };
}

const onClose = vi.fn();
const onConfirmationNameChange = vi.fn();
const controlledProps = {
  dialogOpen: false,
  confirmationName: "",
  deleting: false,
  error: null,
  onOpen: vi.fn(),
  onClose,
  onConfirmationNameChange,
  onConfirm: vi.fn(),
};
```

Test these exact behaviors:

```ts
it("hides the danger zone for an active organization", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({ isActive: true })}
      {...controlledProps}
    />,
  );
  expect(
    screen.queryByRole("region", { name: "위험 구역" }),
  ).not.toBeInTheDocument();
});

it("shows only positive blockers and disables permanent deletion", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({
        isActive: false,
        deletionEligibility: {
          canDelete: false,
          blockers: {
            managerAssignments: 0,
            participants: 3,
            projectLinks: 2,
            rosterEntries: 0,
            expectedSnapshots: 1,
          },
        },
      })}
      {...controlledProps}
    />,
  );
  expect(screen.getByText("참가자 3명")).toBeVisible();
  expect(screen.getByText("프로젝트 연결 이력 2건")).toBeVisible();
  expect(screen.getByText("예상 인원 기록 1건")).toBeVisible();
  expect(screen.queryByText("담당자 배정 0건")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "조직 영구 삭제" }),
  ).toBeDisabled();
});

it("requires the exact current name and locks the dialog while deleting", () => {
  const onConfirm = vi.fn();
  const eligibleOrganization = organization({
    id: "org-1",
    name: "황룡사",
    isActive: false,
    deletionEligibility: {
      canDelete: true,
      blockers: {
        managerAssignments: 0,
        participants: 0,
        projectLinks: 0,
        rosterEntries: 0,
        expectedSnapshots: 0,
      },
    },
  });
  const { rerender } = render(
    <OrganizationDeletionPanel
      organization={eligibleOrganization}
      dialogOpen
      confirmationName=""
      deleting={false}
      error={null}
      onOpen={vi.fn()}
      onClose={onClose}
      onConfirmationNameChange={onConfirmationNameChange}
      onConfirm={onConfirm}
    />,
  );
  const dialog = screen.getByRole("dialog", {
    name: "조직 영구 삭제",
  });
  expect(
    dialog.getByRole("button", { name: "조직 영구 삭제" }),
  ).toBeDisabled();

  fireEvent.change(
    screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."),
    { target: { value: " 황룡사 " } },
  );
  expect(onConfirmationNameChange).toHaveBeenCalledWith(" 황룡사 ");

  rerender(
    <OrganizationDeletionPanel
      organization={eligibleOrganization}
      dialogOpen
      confirmationName="황룡사"
      deleting
      error={null}
      onOpen={vi.fn()}
      onClose={onClose}
      onConfirmationNameChange={onConfirmationNameChange}
      onConfirm={onConfirm}
    />,
  );
  const pendingDialog = screen.getByRole("dialog", {
    name: "조직 영구 삭제",
  });
  expect(
    pendingDialog.getByRole("button", { name: "삭제 중…" }),
  ).toBeDisabled();
  expect(pendingDialog.getByRole("button", { name: "닫기" })).toBeDisabled();
  fireEvent.keyDown(pendingDialog, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});
```

Also test error text, long-name wrapping class, dialog focus return, and
`onConfirm` firing once when the exact name is present and not deleting.

- [ ] **Step 5: Run the component test and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/admin/OrganizationDeletionPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the controlled panel**

The component returns `null` for active organizations. For inactive
organizations render:

```tsx
<section
  className="er-danger-zone"
  aria-label="위험 구역"
>
  <h2>위험 구역</h2>
  {organization.deletionEligibility.canDelete ? (
    <>
      <p>이 조직은 연결된 데이터가 없어 영구 삭제할 수 있습니다.</p>
      <Button type="button" variant="danger" onClick={onOpen}>
        조직 영구 삭제
      </Button>
    </>
  ) : (
    <>
      <p>
        이 조직에는 보존해야 할 연결 데이터가 있어 삭제할 수 없습니다.
      </p>
      <ul className="er-danger-zone__blockers">
        {(
          Object.keys(BLOCKER_LABELS) as Array<
            keyof OrganizationDeletionBlockers
          >
        )
          .filter(
            (key) => organization.deletionEligibility.blockers[key] > 0,
          )
          .map((key) => {
            const [label, unit] = BLOCKER_LABELS[key];
            const count = organization.deletionEligibility.blockers[key];
            return (
              <li key={key}>
                {label} {count}
                {unit}
              </li>
            );
          })}
      </ul>
      <p>사용 중지 상태로 유지하면 기존 기록은 보존됩니다.</p>
      <Button type="button" variant="danger" disabled>
        조직 영구 삭제
      </Button>
    </>
  )}
</section>
```

Use a label map with these exact copies:

```ts
const BLOCKER_LABELS = {
  managerAssignments: ["담당자 배정", "건"],
  participants: ["참가자", "명"],
  projectLinks: ["프로젝트 연결 이력", "건"],
  rosterEntries: ["참가 명단 이력", "건"],
  expectedSnapshots: ["예상 인원 기록", "건"],
} as const;
```

When `dialogOpen`, use `Dialog` with `hideDefaultCloseAction`. Pass an
`onClose` callback that calls the parent only when `deleting === false`.
The final button is disabled unless:

```ts
confirmationName === organization.name && !deleting
```

- [ ] **Step 7: Add danger-zone and mobile styles**

Add focused classes:

```css
.er-danger-zone {
  display: grid;
  gap: var(--er-space-4);
  padding: var(--er-space-6);
  border: 1px solid var(--er-color-danger);
  border-radius: var(--er-radius-md);
  background: var(--er-color-surface);
}
.er-danger-zone h2 {
  color: var(--er-color-danger);
  margin: 0;
}
.er-danger-zone__target {
  overflow-wrap: anywhere;
}
.er-danger-zone__blockers {
  display: grid;
  gap: var(--er-space-2);
  margin: 0;
  padding-left: var(--er-space-5);
}
```

At `max-width: 36rem`, make the deletion dialog actions stretch vertically
and ensure both buttons use the full available width.

- [ ] **Step 8: Run focused Web tests and check**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/lib/api.test.ts \
  src/features/admin/OrganizationDeletionPanel.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: all commands PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/api.ts \
  apps/web/src/lib/api.test.ts \
  apps/web/src/features/admin/OrganizationDeletionPanel.tsx \
  apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: add organization deletion danger zone"
```

---

### Task 5: Integrate deletion flow, navigation notice, and E2E

**Files:**
- Modify: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/e2e/organization-management.spec.ts`

**Interfaces:**
- Consumes: `OrganizationDeletionPanel`
- Consumes: `api.delete(path, body)`
- Produces: page-level delete state, conflict refresh, and one-time organization notice

- [ ] **Step 1: Write failing page integration tests**

Add reusable detail fixtures that always include `deletionEligibility`.
Existing fixtures must be updated explicitly rather than giving the production
component a fallback.

Cover active, blocked, and eligible detail states:

```ts
expect(
  screen.queryByRole("region", { name: "위험 구역" }),
).not.toBeInTheDocument();

expect(
  await screen.findByRole("region", { name: "위험 구역" }),
).toHaveTextContent("프로젝트 연결 이력 2건");
```

For successful deletion, mock detail, audit, and 204 DELETE responses:

```ts
fireEvent.click(
  await screen.findByRole("button", { name: "조직 영구 삭제" }),
);
fireEvent.change(
  screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."),
  { target: { value: "빈 조직" } },
);
fireEvent.click(
  screen
    .getByRole("dialog", { name: "조직 영구 삭제" })
    .getByRole("button", { name: "조직 영구 삭제" }),
);

await waitFor(() =>
  expect(window.location.pathname).toBe("/organizations"),
);
expect(fetchMock).toHaveBeenCalledWith(
  "/api/v1/organizations/org-empty",
  expect.objectContaining({
    method: "DELETE",
    body: JSON.stringify({ confirmationName: "빈 조직" }),
  }),
);
```

Fire the confirm action twice within one render turn and assert only one
DELETE request. This fixes the `useRef` duplicate-submission guard, not only
the later disabled rendering.

Add 409 coverage:

```ts
expect(await screen.findByRole("dialog")).toBeVisible();
expect(
  screen.getByText(
    "다른 관리 변경이 반영되어 최신 삭제 가능 상태를 불러왔습니다.",
  ),
).toBeVisible();
expect(
  screen.getByText("프로젝트 연결 이력 1건"),
).toBeVisible();
expect(
  screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."),
).toHaveValue("");
```

Also cover:

- generic failure preserves the modal and typed value;
- 404 navigates to the list with an already-deleted notice;
- opening the detail URL of an organization that was already deleted also
  returns to the list with that notice;
- pending deletion ignores Escape and close;
- a response for a previous `organizationId` does not navigate or update the
  new page.

- [ ] **Step 2: Write a failing one-time list notice test**

Set browser history state before rendering `OrganizationsPage`:

```ts
window.history.replaceState(
  { organizationNotice: "조직 “빈 조직”을 영구 삭제했습니다." },
  "",
  "/organizations",
);
render(
  <AuthProvider restoreOnMount={false}>
    <Gate>
      <OrganizationsPage />
    </Gate>
  </AuthProvider>,
);
await login();

expect(
  await screen.findByText("조직 “빈 조직”을 영구 삭제했습니다."),
).toBeVisible();
expect(window.history.state?.organizationNotice).toBeUndefined();
```

Unmount and render again; the notice must not appear twice.

- [ ] **Step 3: Write the failing Playwright journey**

Add a final organization-management test named
`operator safely deletes only an inactive empty organization`.

The happy path must:

1. log in as the operator;
2. create `E2E 삭제 조직`;
3. open its detail and use `조직 사용 중지`;
4. verify the danger zone appears;
5. type ` E2E 삭제 조직 ` and assert the final button remains disabled;
6. type `E2E 삭제 조직`, delete, and see the one-time list notice;
7. verify the old detail URL returns to the list or shows no organization;
8. recreate `E2E 삭제 조직` and verify its detail URL is different.

The blocked path must create `E2E 삭제 차단 조직`, add it to
`data.projectId` through the project organization UI, globally deactivate it,
and verify:

```ts
await expect(
  page.getByText("프로젝트 연결 이력 1건"),
).toBeVisible();
await expect(
  page.getByRole("button", { name: "조직 영구 삭제" }),
).toBeDisabled();
```

Do not deactivate or delete the shared `E2E 1팀` fixture because later E2E
files depend on it.

- [ ] **Step 4: Run page tests and focused E2E to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  --grep "operator safely deletes only an inactive empty organization"
```

Expected: unit tests FAIL because the page has no deletion orchestration; the
E2E test FAILS before the danger zone exists. If the package script does not
forward `-- --grep`, rerun with:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  playwright test --grep \
  "operator safely deletes only an inactive empty organization"
```

- [ ] **Step 5: Add page-level mutation ownership**

Extend mutation state:

```ts
const [mutating, setMutating] = useState<
  "RENAME" | "STATUS" | "DELETE" | null
>(null);
const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
const [deleteError, setDeleteError] = useState<string | null>(null);
const deleteRequestInFlight = useRef(false);
```

Reset these fields when `organizationId` changes. Render the controlled panel
after the audit region so the danger zone is the final detail section.

Change `loadDetail` to distinguish `ApiError` 404 from other failures. If the
current request still owns the page, navigate to the organization list with
`요청한 조직은 이미 삭제됐거나 찾을 수 없습니다.` instead of rendering the
generic retry state. This also makes an old bookmarked detail URL safe after
successful deletion.

Implement one navigation helper inside this page:

```ts
function navigateToOrganizationList(organizationNotice: string) {
  const state = { organizationNotice };
  window.history.pushState(state, "", "/organizations");
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}
```

- [ ] **Step 6: Implement delete success and conflict handling**

The mutation starts with the synchronous ref guard:

```ts
if (!organization || deleteRequestInFlight.current) return;
deleteRequestInFlight.current = true;
const requestedOrganizationId = organizationId;
const deletedName = organization.name;
setMutating("DELETE");
setDeleteError(null);
```

Call:

```ts
await api.delete(
  `/organizations/${encodeURIComponent(requestedOrganizationId)}`,
  { confirmationName: deleteConfirmationName },
);
```

Before every state write or navigation, require:

```ts
instanceActive.current &&
activeOrganizationId.current === requestedOrganizationId
```

On success:

```ts
navigateToOrganizationList(
  `조직 “${deletedName}”을 영구 삭제했습니다.`,
);
```

On `409`:

```ts
const reloaded = await loadDetail();
setDeleteConfirmationName("");
setDeleteError(
  reloaded
    ? "다른 관리 변경이 반영되어 최신 삭제 가능 상태를 불러왔습니다."
    : "삭제 조건이 변경됐지만 최신 조직 정보를 불러오지 못했습니다.",
);
```

Keep the modal open. On `404`, navigate with:

```text
요청한 조직은 이미 삭제됐거나 찾을 수 없습니다.
```

On other errors, keep the exact typed value and show:

```text
조직을 영구 삭제하지 못했습니다.
```

In `finally`, clear the ref and mutation state only if the request still owns
the current page. While deleting, status and rename controls remain disabled.

- [ ] **Step 7: Consume the one-time list notice**

In `OrganizationsPage`, initialize notice state through a pure local helper:

```ts
function consumeOrganizationNotice(): string | null {
  const state = window.history.state;
  if (
    typeof state !== "object" ||
    state === null ||
    !("organizationNotice" in state) ||
    typeof state.organizationNotice !== "string"
  ) {
    return null;
  }
  const mutableState = { ...state } as Record<string, unknown>;
  const organizationNotice = mutableState.organizationNotice as string;
  delete mutableState.organizationNotice;
  window.history.replaceState(
    Object.keys(mutableState).length > 0 ? mutableState : null,
    "",
    window.location.href,
  );
  return organizationNotice;
}
```

Render the returned value once through `StatusMessage`. Do not put the deleted
name in the URL or persistent storage.

- [ ] **Step 8: Run focused unit and E2E tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/lib/api.test.ts \
  src/features/admin/OrganizationDeletionPanel.test.tsx \
  src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  playwright test --grep \
  "operator safely deletes only an inactive empty organization"
```

Expected: all commands PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/admin/OrganizationDetailPage.tsx \
  apps/web/src/features/admin/OrganizationsPage.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/e2e/organization-management.spec.ts
git commit -m "feat: complete safe organization deletion flow"
```

---

### Task 6: Full verification and deployment readiness

**Files:**
- Verify only; no production deployment in this task

**Interfaces:**
- Consumes: completed contracts, Worker deletion API, Web flow, and E2E
- Produces: merge-ready verification evidence

- [ ] **Step 1: Run formatting and type checks**

```bash
corepack pnpm@10.28.1 run format:check
corepack pnpm@10.28.1 run check
```

Expected: both commands exit 0.

- [ ] **Step 2: Run the complete test suite**

```bash
corepack pnpm@10.28.1 run test
```

Expected: all workspace tests PASS. Wrangler-based tests may require a
sandbox-external localhost/log-writing approval; an EPERM environment failure
is not a product failure and must be rerun with the narrow approval.

- [ ] **Step 3: Build and run all E2E tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run build
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: production build and every Playwright test PASS.

- [ ] **Step 4: Verify the Worker bundle without deploying**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
```

Expected: bindings and assets are recognized and Wrangler exits after
`--dry-run` without a production deployment.

- [ ] **Step 5: Inspect the final diff and workspace**

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: no whitespace errors; only intended tracked implementation files are
present; user-owned `.DS_Store`, `.pnpm-store/`, and other pre-existing
untracked files remain untouched.

---

## Production Rollout Handoff

Production rollout happens only after task review, final branch review,
integration into `main`, push, and an explicit user request to deploy.

Because there is no migration:

1. create and checksum the normal external D1 pre-deploy backup;
2. confirm `wrangler d1 migrations list event-roster --remote` has no
   unexpected pending migrations;
3. build Web assets from the pushed `main` SHA;
4. deploy the Worker with the existing authenticated local Wrangler flow;
5. verify `/api/v1/health`, HTTPS root, and authenticated organization detail;
6. use a newly created temporary inactive empty organization for a destructive
   production smoke only when the user explicitly authorizes that data change;
7. otherwise verify eligibility, blocker copy, and the name-confirmation modal
   without pressing the final delete button;
8. record Git SHA, Worker version ID, backup checksum, smoke result, and whether
   destructive smoke was skipped.
