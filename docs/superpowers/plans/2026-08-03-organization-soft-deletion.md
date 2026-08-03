# Organization Soft Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrative operators to hide and later restore any organization without removing its managers, participants, project links, roster history, snapshots, or audit history.

**Architecture:** Keep `organizations.is_active` as the reusable enabled/disabled switch and add nullable `deleted_at`/`deleted_by` lifecycle metadata. Ordinary reads and selection paths exclude deleted organizations, administrative reads may explicitly include them, and delete/restore writes reuse the existing guarded atomic audit pattern. Historical project summaries and roster rows retain their snapshots and receive an explicit deleted marker.

**Tech Stack:** TypeScript 5.9, React 19, Hono, Zod, Cloudflare Workers, D1/SQLite migrations, Vitest, Testing Library, Playwright, pnpm 10.28.1, Biome.

## Global Constraints

- Use `corepack pnpm@10.28.1`; do not change the locked package manager or add dependencies.
- Keep `사용 중`, `사용 중지`, and `삭제됨` as three distinct lifecycle states.
- Deleting either an active or inactive organization sets `is_active = 0`, `deleted_at`, and `deleted_by` atomically.
- Restoring clears deletion metadata but always leaves `is_active = 0`; reactivation is a separate existing action.
- Only a non-bootstrap administrative `OPERATOR` may delete, restore, include deleted organizations, or open deleted organization detail.
- Delete confirmation must equal the stored organization name byte-for-byte after JSON decoding; do not trim, normalize, or case-fold it.
- Preserve manager assignments, participants, project links, roster entries, expected snapshots, and audit logs during deletion and restoration.
- Deleted organization names remain reserved by the existing `canonical_name` uniqueness boundary.
- Remove the organization hard-delete path and its blocker/eligibility model completely.
- Deleted organizations must not authorize managers or appear in organization/project/participant/import selection paths.
- Historical project summary rows with nonzero expected/add/cancel/final values remain visible and show `삭제됨`; empty deleted memberships stay hidden.
- Historical roster rows keep the stored organization-name snapshot and show `삭제됨`.
- Keep Cloudflare production deployment manual; do not add GitHub deployment credentials or workflows.
- Preserve user-owned untracked files such as `.DS_Store`, `.pnpm-store/`, and ignored brainstorming artifacts.
- Follow TDD for every behavior change: failing focused test, minimal implementation, passing focused test, then commit.

---

## File Structure

### Contracts and stable errors

- Modify `packages/contracts/src/common.ts` to add `ORGANIZATION_NAME_RESERVED`.
- Modify `packages/contracts/src/organizations.ts` first to add deletion metadata, then remove hard-deletion blockers together with the old UI in Task 7.
- Modify `packages/contracts/src/projects.ts` to add `masterIsDeleted` to summary rows.
- Modify `packages/contracts/test/contracts.test.ts` for lifecycle response types and the exact delete confirmation contract.

### D1 and Worker organization lifecycle

- Create `apps/worker/migrations/0007_organization_soft_deletion.sql` for metadata, consistency triggers, and the deleted-list index.
- Create `apps/worker/test/organization-soft-deletion-migration.integration.test.ts` for pre-`0007` row preservation and schema invariants.
- Modify `apps/worker/test/schema.integration.test.ts` for invalid deletion states.
- Modify `apps/worker/src/db/organizations.ts` to separate default and include-deleted list reads and return deletion metadata.
- Modify `apps/worker/src/services/organizations.ts` for list policy, reserved-name errors, guarded soft delete, guarded restore, and deleted-state mutation rejection.
- Modify `apps/worker/src/routes/organizations.ts` for `includeDeleted` parsing and the restore endpoint.
- Modify `apps/worker/src/app.ts` for the stable reserved-name problem.
- Replace hard-delete assertions in `apps/worker/test/organization-deletion.integration.test.ts` with soft-delete, restore, authorization, concurrency, retention, and audit assertions.
- Modify `apps/worker/test/admin.integration.test.ts` and `apps/worker/test/organization-leadership.integration.test.ts` only for deleted-state mutation and assignment containment cases.

### Worker permission and project-history boundaries

- Modify `apps/worker/src/db/auth.ts` so current authorization scope excludes inactive and deleted organization assignments without deleting those assignments.
- Modify `apps/worker/src/db/project-organizations.ts` to expose `masterIsDeleted` and exclude deleted organizations from manager scope.
- Modify `apps/worker/src/db/projects.ts` so organization-manager project visibility excludes deleted organizations explicitly.
- Modify `apps/worker/src/services/project-organizations.ts`, `participants.ts`, `roster.ts`, `bulk-participants.ts`, and `imports.ts` so every organization eligibility query requires `deleted_at IS NULL` in addition to existing active checks.
- Modify `apps/worker/test/project-organizations.integration.test.ts`, `participants.integration.test.ts`, `roster.integration.test.ts`, `imports.integration.test.ts`, and `summary.integration.test.ts` with focused containment and historical-display coverage.

### Web administration and historical display

- Create `apps/web/src/lib/organization-errors.ts` for typed extraction of a deleted-name conflict target.
- Modify `apps/web/src/features/admin/OrganizationsPage.tsx` for the include-deleted filter, deleted badge, and restore guidance on name collision.
- Rewrite `apps/web/src/features/admin/OrganizationDeletionPanel.tsx` as a recoverable delete confirmation without blocker UI.
- Rewrite `apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx` around the new safety copy and submit lock.
- Modify `apps/web/src/features/admin/OrganizationDetailPage.tsx` for deleted read-only detail and restore.
- Modify `apps/web/src/features/admin/admin.test.tsx` for list, collision, delete, read-only, and restore flows.
- Modify `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx` to hide deleted memberships and surface deleted-name conflicts when creating organizations inline.
- Modify `apps/web/src/features/projects/project-detail.test.tsx` and `apps/web/src/features/roster/SummaryCards.tsx` for the `삭제됨` summary badge.
- Modify `apps/web/src/features/roster/ProjectRosterPage.tsx`, `RosterTable.tsx`, and `roster.test.tsx` so snapshot rows show `삭제됨` using deleted membership IDs.
- Modify `apps/web/src/styles/global.css` for deleted badges, read-only detail, filter layout, and collision guidance.

### End-to-end and operations

- Rewrite the hard-deletion scenario in `apps/web/e2e/organization-management.spec.ts` as delete, hidden-list, historical retention, restore-inactive, and reactivation coverage.
- Modify `docs/architecture.md` with the organization deletion overlay and lookup boundary.
- Modify `docs/operations/deployment.md` with the `0007` backup/apply/post-check gate.
- Modify `docs/operations/recovery.md` with the pre-`0007` isolated restore path.

---

### Task 1: Define Organization Deletion Contracts and the D1 Invariant

**Files:**
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/organizations.ts`
- Test: `packages/contracts/test/contracts.test.ts`
- Test fixture: `apps/web/src/app/App.test.tsx`
- Test fixture: `apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx`
- Test fixture: `apps/web/src/features/admin/admin.test.tsx`
- Create: `apps/worker/migrations/0007_organization_soft_deletion.sql`
- Create: `apps/worker/test/organization-soft-deletion-migration.integration.test.ts`
- Modify: `apps/worker/test/schema.integration.test.ts`

**Interfaces:**
- Consumes: existing exact `OrganizationDeleteRequestSchema` and `organizations.canonical_name` uniqueness.
- Produces: `OrganizationSummary.isDeleted: boolean`, `OrganizationSummary.deletedAt: string | null`, `ORGANIZATION_NAME_RESERVED`, and the D1 deletion-state invariant.

- [ ] **Step 1: Write failing contract tests**

Keep the existing deletion-blocker type assertion until Task 7, add lifecycle metadata assertions, and retain the exact-name assertions:

```ts
import type { OrganizationDetail, OrganizationSummary } from "../src";
import { API_PROBLEM_CODES } from "../src";

expectTypeOf<OrganizationSummary>().toMatchTypeOf<{
  isDeleted: boolean;
  deletedAt: string | null;
}>();
expectTypeOf<OrganizationDetail>().toMatchTypeOf<{
  isDeleted: boolean;
  deletedAt: string | null;
}>();
expect(API_PROBLEM_CODES).toContain("ORGANIZATION_NAME_RESERVED");
expect(
  OrganizationDeleteRequestSchema.parse({
    confirmationName: "  황룡사  ",
  }).confirmationName,
).toBe("  황룡사  ");
```

Do not remove `OrganizationDeletionBlockers` or `OrganizationDeletionEligibility` in this task: the existing Web deletion panel still consumes them. Task 7 removes the contract, DB projection, component usage, and tests atomically.

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
```

Expected: FAIL because the deletion metadata and problem code do not exist.

- [ ] **Step 3: Implement the contract changes**

Add `"ORGANIZATION_NAME_RESERVED"` to `API_PROBLEM_CODES` in `common.ts`. In `organizations.ts`, keep the temporary hard-delete compatibility types and add to `OrganizationSummary`:

```ts
export interface OrganizationSummary extends Organization {
  isDeleted: boolean;
  deletedAt: string | null;
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  projectCount: number;
}
```

Keep `OrganizationDeleteRequestSchema` strict and untrimmed.

Add `isDeleted: false` and `deletedAt: null` to ordinary `OrganizationSummary`/`OrganizationDetail` fixture factories in `App.test.tsx`, `OrganizationDeletionPanel.test.tsx`, and `admin.test.tsx`. Do not change their current hard-delete expectations yet; Task 7 rewrites those behaviors after the Worker lifecycle exists.

- [ ] **Step 4: Write failing migration and invariant tests**

Create `organization-soft-deletion-migration.integration.test.ts`. Destructure and validate all seven entries, apply the first six, seed rows, and then apply only the seventh migration:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("preserves organizations while adding nullable deletion metadata", async () => {
  const [m1, m2, m3, m4, m5, m6, organizationSoftDeletion] =
    env.TEST_MIGRATIONS;
  if (!m1 || !m2 || !m3 || !m4 || !m5 || !m6 || !organizationSoftDeletion) {
    throw new Error("expected migrations 0001 through 0007");
  }
  await applyD1Migrations(env.MIGRATION_DB, [m1, m2, m3, m4, m5, m6]);
  await seedMigrationUserAndOrganizations();
  const before = await countOrganizations();
  await applyD1Migrations(env.MIGRATION_DB, [organizationSoftDeletion]);
```

Define `seedMigrationUserAndOrganizations()` in that file with explicit `INSERT INTO users` followed by active and inactive `INSERT INTO organizations` statements using IDs `pre-0007-active` and `pre-0007-inactive`. Close the test with these assertions:

```ts
expect(
  await env.MIGRATION_DB.prepare(
    `SELECT deleted_at, deleted_by FROM organizations
     WHERE id = 'pre-0007-active'`,
  ).first(),
).toEqual({ deleted_at: null, deleted_by: null });
expect(await countOrganizations()).toBe(before);
expect(
  (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
).toEqual([]);
```

Add to `schema.integration.test.ts`:

```ts
await expect(
  env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = '2026-08-03T00:00:00.000Z'
     WHERE id = ?`,
  ).bind(IDS.organization).run(),
).rejects.toThrow(/INVALID_ORGANIZATION_DELETION_STATE/);

await expect(
  env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = '2026-08-03T00:00:00.000Z',
         deleted_by = ?, is_active = 1
     WHERE id = ?`,
  ).bind(IDS.user, IDS.organization).run(),
).rejects.toThrow(/INVALID_ORGANIZATION_DELETION_STATE/);
```

- [ ] **Step 5: Run migration tests and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/organization-soft-deletion-migration.integration.test.ts \
  test/schema.integration.test.ts
```

Expected: FAIL because migration `0007` and its columns/triggers do not exist.

- [ ] **Step 6: Add migration `0007_organization_soft_deletion.sql`**

```sql
ALTER TABLE organizations ADD COLUMN deleted_at TEXT;

ALTER TABLE organizations
ADD COLUMN deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX organizations_deleted_name
ON organizations(deleted_at, name, id);

CREATE TRIGGER organizations_deletion_state_insert
BEFORE INSERT ON organizations
WHEN (
  (NEW.deleted_at IS NULL AND NEW.deleted_by IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.is_active = 0)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ORGANIZATION_DELETION_STATE');
END;

CREATE TRIGGER organizations_deletion_state_update
BEFORE UPDATE OF is_active, deleted_at, deleted_by ON organizations
WHEN (
  (NEW.deleted_at IS NULL AND NEW.deleted_by IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.is_active = 0)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ORGANIZATION_DELETION_STATE');
END;
```

- [ ] **Step 7: Run focused tests and commit**

Run both focused commands from Steps 2 and 5, then `corepack pnpm@10.28.1 --filter @event-roster/web run check`. Expected: all three commands exit 0.

```bash
git add packages/contracts/src/common.ts \
  packages/contracts/src/organizations.ts \
  packages/contracts/test/contracts.test.ts \
  apps/web/src/app/App.test.tsx \
  apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/worker/migrations/0007_organization_soft_deletion.sql \
  apps/worker/test/organization-soft-deletion-migration.integration.test.ts \
  apps/worker/test/schema.integration.test.ts
git commit -m "feat: define organization soft deletion state"
```

---

### Task 2: Add Default-Hidden and Administrative Include-Deleted Reads

**Files:**
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/routes/organizations.ts`
- Test: `apps/worker/test/admin.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 deletion columns and `OrganizationSummary` fields.
- Produces: `OrganizationListFilters.includeDeleted: boolean`, deletion-aware `OrganizationState`, default-hidden list reads, and operator-only include-deleted reads.

- [ ] **Step 1: Write failing list/detail tests**

Add cases to `admin.integration.test.ts` that seed one ordinary organization and one row with valid deletion metadata. Assert:

```ts
const ordinary = await authedRequest(operator, "/api/v1/organizations");
expect(await ordinary.json()).not.toEqual(
  expect.arrayContaining([expect.objectContaining({ id: "deleted-org" })]),
);

const included = await authedRequest(
  operator,
  "/api/v1/organizations?includeDeleted=true",
);
expect(await included.json()).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: "deleted-org",
      isActive: false,
      isDeleted: true,
      deletedAt: "2026-08-03T00:00:00.000Z",
    }),
  ]),
);

expect(
  await authedRequest(manager, "/api/v1/organizations?includeDeleted=true"),
).toHaveProperty("status", 403);
```

Also assert the administrative detail response contains `isDeleted` and `deletedAt`. Keep the temporary `deletionEligibility` assertion until Task 7 so each intermediate commit type-checks.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/admin.integration.test.ts
```

Expected: FAIL because deleted organizations are not filtered and `includeDeleted` is rejected by the strict query schema.

- [ ] **Step 3: Implement deletion-aware organization DB reads**

Change the DB types:

```ts
export interface OrganizationListFilters {
  query: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  leaderStatus: "ALL" | "ASSIGNED" | "UNASSIGNED";
  includeDeleted: boolean;
  visibleOrganizationIds?: string[];
}

export interface OrganizationState {
  id: string;
  name: string;
  canonicalName: string;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
}
```

Select `o.deleted_at` in `ORGANIZATION_SUMMARY_SELECT`, map `isDeleted`/`deletedAt`, and prepend the ordinary predicate:

```ts
if (!filters.includeDeleted) predicates.push("o.deleted_at IS NULL");
```

Select `deleted_at, deleted_by` in `findOrganizationState`. Continue to return the temporary `deletionEligibility` field until Task 7 while loading managers and non-deleted linked projects.

- [ ] **Step 4: Parse and authorize `includeDeleted`**

Extend `OrganizationListQuerySchema`:

```ts
includeDeleted: z.enum(["true", "false"]).default("false")
  .transform((value) => value === "true"),
```

In `getOrganizationSummaries`:

```ts
if (filters.includeDeleted) requireAdministrativeOperator(actor);
if (actor.session.user.role !== "OPERATOR") {
  scopedFilters.visibleOrganizationIds = actor.session.user.organizationIds;
}
```

Keep `getOrganizationDetail` administrative-only so direct deleted-detail URLs are not exposed to managers.

- [ ] **Step 5: Run tests, type-check Worker, and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/admin.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/db/organizations.ts \
  apps/worker/src/services/organizations.ts \
  apps/worker/src/routes/organizations.ts \
  apps/worker/test/admin.integration.test.ts
git commit -m "feat: expose deleted organizations to administrators"
```

Expected: tests and type check exit 0.

---

### Task 3: Replace Hard Delete with Guarded Soft Delete and Restore

**Files:**
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/services/project-organizations.ts`
- Modify: `apps/worker/src/routes/organizations.ts`
- Modify: `apps/worker/src/app.ts`
- Test: `apps/worker/test/organization-deletion.integration.test.ts`
- Test: `apps/worker/test/project-organizations.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 `OrganizationState` and administrative detail reads.
- Produces: `deleteOrganization(...): Promise<void>`, `restoreOrganization(...): Promise<OrganizationDetail>`, `POST /organizations/:id/restore`, and structured `ORGANIZATION_NAME_RESERVED` conflicts.

- [ ] **Step 1: Rewrite deletion tests for the new lifecycle and confirm RED**

Replace hard-delete/blocker expectations with these focused outcomes:

```ts
expect(deleteResponse.status).toBe(204);
expect(
  await env.DB.prepare(
    `SELECT is_active, deleted_at, deleted_by FROM organizations WHERE id = ?`,
  ).bind("blocked-delete").first(),
).toMatchObject({ is_active: 0, deleted_by: operator.userId });
expect(await countReferences("blocked-delete")).toEqual({
  managerAssignments: 1,
  participants: 1,
  projectLinks: 1,
  rosterEntries: 1,
  expectedSnapshots: 1,
});
```

Add active-organization deletion, exact-name mismatch, repeated-delete `409`, restore, repeated-restore `409`, and restoration-to-inactive cases. Assert delete and restore audit payloads:

```ts
expect(audits).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ action: "ORGANIZATION_DELETED" }),
    expect.objectContaining({ action: "ORGANIZATION_RESTORED" }),
  ]),
);
```

Retain the existing exact-origin, CSRF, full-session, and organization-manager denial assertions for both delete and restore. Add a bootstrap denial using the existing test helper:

```ts
await seedUser({
  id: "bootstrap-operator",
  loginId: "bootstrap-operator",
  password: "bootstrap-password-123",
  isBootstrap: true,
});
const bootstrap = await login(
  "bootstrap-operator",
  "bootstrap-password-123",
);
expect(
  await authedRequest(bootstrap, "/api/v1/organizations/blocked-delete", {
    method: "DELETE",
    body: JSON.stringify({ confirmationName: "삭제 차단 조직" }),
  }),
).toHaveProperty("status", 403);
expect(
  await authedRequest(bootstrap, "/api/v1/organizations/blocked-delete/restore", {
    method: "POST",
  }),
).toHaveProperty("status", 403);
```

Retain and adapt the audit-trigger rollback test so a failed `ORGANIZATION_DELETED` insert leaves all deletion metadata `NULL`. Add an analogous restore rollback test.

- [ ] **Step 2: Run the lifecycle test and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-deletion.integration.test.ts
```

Expected: FAIL because active deletion is blocked, referenced organizations are blocked, rows are physically deleted, and restore does not exist.

- [ ] **Step 3: Implement guarded soft deletion**

Remove every blocker check from `deleteOrganization` and remove the physical `DELETE`. Keep the blocker query/projection temporarily for the old detail UI until Task 7. Build the atomic delete with the observed state:

```ts
const now = new Date().toISOString();
const guard = `EXISTS (
  SELECT 1 FROM organizations
  WHERE id = ? AND name = ? AND canonical_name = ?
    AND is_active = ? AND deleted_at IS NULL AND deleted_by IS NULL
)`;

const statements = [
  env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  ).bind(now, actor.session.user.id, now, id),
  organizationAuditStatement(
    env.DB,
    actor.session.user.id,
    "ORGANIZATION_DELETED",
    id,
    now,
    {
      before: { name: current.name, isActive: current.isActive, isDeleted: false },
      after: { name: current.name, isActive: false, isDeleted: true, deletedAt: now },
    },
  ),
];
```

Run these through `runGuardedAtomic` and the existing `createOperatorGuard`. Reject a missing organization with `NOT_FOUND`, an already deleted organization with `CONFLICT`, and an exact-name mismatch with `CONFLICT`.

- [ ] **Step 4: Implement guarded restoration and route**

Add:

```ts
export async function restoreOrganization(
  env: Env,
  actor: Actor,
  id: string,
): Promise<OrganizationDetail> {
  const current = await findOrganizationState(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  if (!current.isDeleted || !current.deletedAt || !current.deletedBy) {
    throw new DomainError("CONFLICT");
  }
  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
        SELECT 1 FROM organizations
        WHERE id = ? AND name = ? AND canonical_name = ? AND is_active = 0
          AND deleted_at = ? AND deleted_by = ?
      )`,
      [
        id,
        current.name,
        current.canonicalName,
        current.deletedAt,
        current.deletedBy,
      ],
    ),
    statements: [
      env.DB.prepare(
        `UPDATE organizations
         SET deleted_at = NULL, deleted_by = NULL, is_active = 0, updated_at = ?
         WHERE id = ? AND is_active = 0 AND deleted_at = ? AND deleted_by = ?`,
      ).bind(now, id, current.deletedAt, current.deletedBy),
      organizationAuditStatement(
        env.DB,
        actor.session.user.id,
        "ORGANIZATION_RESTORED",
        id,
        now,
        {
          before: { name: current.name, isActive: false, isDeleted: true },
          after: { name: current.name, isActive: false, isDeleted: false },
        },
      ),
    ],
    failureCode: "CONFLICT",
  });
  const restored = await findOrganizationDetail(env.DB, id);
  if (!restored) throw new DomainError("INTERNAL_ERROR");
  return restored;
}
```

The concrete update statement is:

```sql
UPDATE organizations
SET deleted_at = NULL, deleted_by = NULL, is_active = 0, updated_at = ?
WHERE id = ? AND is_active = 0 AND deleted_at = ? AND deleted_by = ?
```

Add `POST /organizations/:id/restore` with exact origin, full session, CSRF, and `requireAdministrativeOperator`, returning `c.json(await restoreOrganization(...))`.

- [ ] **Step 5: Return a structured deleted-name conflict**

Add `findOrganizationByCanonicalName` to `db/organizations.ts` or keep the exact select local to the service. Before creation and after a unique-constraint race, classify a deleted match:

```ts
throw new DomainError("ORGANIZATION_NAME_RESERVED", {
  organizationId: existing.id,
});
```

Map it in `apps/worker/src/app.ts`:

```ts
ORGANIZATION_NAME_RESERVED: [
  409,
  "삭제된 동일 이름의 조직이 있습니다.",
],
```

Apply the same classification to inline new-organization creation in `project-organizations.ts`; do not relax `canonical_name` uniqueness.

- [ ] **Step 6: Run lifecycle tests, Worker checks, and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/organization-deletion.integration.test.ts \
  test/project-organizations.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/db/organizations.ts \
  apps/worker/src/services/organizations.ts \
  apps/worker/src/services/project-organizations.ts \
  apps/worker/src/routes/organizations.ts apps/worker/src/app.ts \
  apps/worker/test/organization-deletion.integration.test.ts \
  apps/worker/test/project-organizations.integration.test.ts
git commit -m "feat: soft delete and restore organizations"
```

Expected: focused tests and type check exit 0.

---

### Task 4: Revoke Deleted-Organization Authority and Block Mutations

**Files:**
- Modify: `apps/worker/src/db/auth.ts`
- Modify: `apps/worker/src/db/projects.ts`
- Modify: `apps/worker/src/db/project-organizations.ts`
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/services/project-organizations.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/src/services/bulk-participants.ts`
- Modify: `apps/worker/src/services/imports.ts`
- Test: `apps/worker/test/organization-deletion.integration.test.ts`
- Test: `apps/worker/test/organization-leadership.integration.test.ts`
- Test: `apps/worker/test/participants.integration.test.ts`
- Test: `apps/worker/test/roster.integration.test.ts`
- Test: `apps/worker/test/imports.integration.test.ts`

**Interfaces:**
- Consumes: the deleted state and restore lifecycle from Tasks 1–3.
- Produces: preserved DB assignments with no deleted/inactive organization authorization, and consistent `409`/`403` containment for mutation paths.

- [ ] **Step 1: Write failing authorization and mutation tests**

Create a manager assignment and active project membership, delete the organization as operator, log in again as the manager, then assert:

```ts
expect(managerSession.body.user.organizationIds).not.toContain(organizationId);
expect(
  await authedRequest(managerSession, `/api/v1/projects/${projectId}`),
).toHaveProperty("status", 403);
expect(
  await env.DB.prepare(
    `SELECT 1 FROM user_organizations
     WHERE user_id = ? AND organization_id = ?`,
  ).bind(manager.userId, organizationId).first(),
).not.toBeNull();
```

As operator, assert deleted organization IDs are rejected for project add/reactivate, participant create/move, single roster add, bulk roster add, and import validation/commit. Assert rename, status change, manager assignment/removal, and primary replacement on the deleted organization return `409`.

Restore without reactivation and rerun the manager and mutation assertions; they must remain blocked. Reactivate through `PATCH /organizations/:id` and assert the manager scope and allowed project/roster operation return.

- [ ] **Step 2: Run the focused containment tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/organization-deletion.integration.test.ts \
  test/organization-leadership.integration.test.ts \
  test/participants.integration.test.ts \
  test/roster.integration.test.ts \
  test/imports.integration.test.ts
```

Expected: at least the current authorization claim still includes the deleted assignment, and deleted-state organization mutations are not uniformly rejected.

- [ ] **Step 3: Filter current authorization scope without deleting assignments**

Change `mapUser` in `db/auth.ts`:

```sql
SELECT uo.organization_id
FROM user_organizations uo
JOIN organizations o ON o.id = uo.organization_id
WHERE uo.user_id = ?
  AND o.is_active = 1
  AND o.deleted_at IS NULL
ORDER BY uo.organization_id
```

Add `o.deleted_at IS NULL` beside `o.is_active = 1` in organization-manager project visibility and `listActorProjectOrganizationIds`.

- [ ] **Step 4: Reject administrative mutations of deleted organizations**

At the start of every organization mutation service, use one shared assertion:

```ts
function requireMutableOrganization(
  current: OrganizationState | null,
): asserts current is OrganizationState {
  if (!current) throw new DomainError("NOT_FOUND");
  if (current.isDeleted) throw new DomainError("CONFLICT");
}
```

Call it from rename/status, assign existing/new manager, replace primary, remove manager, and assignable-account lookup. Include `deleted_at IS NULL` in each atomic SQL guard so a deletion racing after the initial read causes `409` and rolls back its audit statement.

- [ ] **Step 5: Add explicit ordinary-flow deletion predicates**

For every existing `o.is_active = 1` or `master_organization.is_active = 1` eligibility query in project organizations, participants, roster, bulk participants, and imports, add the matching `deleted_at IS NULL`. For example:

```sql
AND o.is_active = 1
AND o.deleted_at IS NULL
AND po.is_active = 1
```

Do not add deletion predicates to historical roster/snapshot reads; those rows must remain readable.

- [ ] **Step 6: Run focused tests, Worker checks, and commit**

Run the command from Step 2 and:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/db/auth.ts apps/worker/src/db/projects.ts \
  apps/worker/src/db/project-organizations.ts \
  apps/worker/src/services/organizations.ts \
  apps/worker/src/services/project-organizations.ts \
  apps/worker/src/services/participants.ts apps/worker/src/services/roster.ts \
  apps/worker/src/services/bulk-participants.ts apps/worker/src/services/imports.ts \
  apps/worker/test/organization-deletion.integration.test.ts \
  apps/worker/test/organization-leadership.integration.test.ts \
  apps/worker/test/participants.integration.test.ts \
  apps/worker/test/roster.integration.test.ts apps/worker/test/imports.integration.test.ts
git commit -m "fix: contain deleted organization permissions"
```

Expected: tests and type check exit 0.

---

### Task 5: Preserve and Label Deleted Organizations in Project History

**Files:**
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/src/projects.ts`
- Modify: `apps/worker/src/db/project-organizations.ts`
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `packages/domain/src/summary.ts`
- Test: `packages/domain/test/summary.test.ts`
- Test: `apps/worker/test/summary.integration.test.ts`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/roster/SummaryCards.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`
- Test: `apps/web/src/features/imports/imports.test.tsx`
- Test: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Consumes: deleted metadata and ordinary-flow containment.
- Produces: `ProjectOrganization.masterIsDeleted`, `ProjectSummaryOrganization.masterIsDeleted`, hidden project-management memberships, and deleted badges on retained summary/roster history.

- [ ] **Step 1: Write failing domain and Worker history tests**

Add `masterIsDeleted: true` to a summary fixture with nonzero history and assert it remains included. Add an empty deleted fixture and assert it is excluded:

```ts
expect(shouldIncludeProjectSummaryOrganization({
  isActive: true,
  masterIsActive: false,
  masterIsDeleted: true,
  expected: 1,
  inProgressAdded: 0,
  inProgressCancelled: 0,
  final: 1,
})).toBe(true);

expect(shouldIncludeProjectSummaryOrganization({
  isActive: true,
  masterIsActive: false,
  masterIsDeleted: true,
  expected: 0,
  inProgressAdded: 0,
  inProgressCancelled: 0,
  final: 0,
})).toBe(false);
```

In `summary.integration.test.ts`, delete an organization with a roster/snapshot history and assert its row has `masterIsDeleted: true`; delete an empty linked organization and assert no row is returned.

- [ ] **Step 2: Run domain and Worker summary tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec \
  vitest run test/summary.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/summary.integration.test.ts
```

Expected: FAIL because the contracts and SQL do not expose `masterIsDeleted`.

- [ ] **Step 3: Add deleted flags to project contracts and queries**

Extend both interfaces:

```ts
masterIsDeleted: boolean;
```

Select and map `o.deleted_at IS NOT NULL AS master_is_deleted` in `db/project-organizations.ts`. In the summary SQL select the same expression, add `o.deleted_at` to the `GROUP BY`, and map it to `masterIsDeleted`. Extend `ProjectSummaryInput` with the same boolean while preserving the existing numeric-history inclusion rule.

Add `masterIsDeleted: false` immediately after `masterIsActive` in all ordinary typed fixtures in `project-detail.test.tsx`, `imports.test.tsx`, and `roster.test.tsx`; use `true` only in the new deleted-history cases. This keeps the required contract field explicit rather than weakening it to optional.

Update `organizationMutationResult` to return `masterIsDeleted: false` for non-deleted update/reactivation responses.

- [ ] **Step 4: Write failing Web history-display tests**

In `project-detail.test.tsx`, assert a summary row with `masterIsDeleted: true` shows `삭제됨`, not `비활성`. Assert `ProjectOrganizationsPanel` does not render a membership whose `masterIsDeleted` is true.

In `roster.test.tsx`, provide a roster row whose organization ID matches a deleted membership and assert the organization cell contains the snapshot name plus `삭제됨`.

- [ ] **Step 5: Run Web tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx \
  src/features/roster/roster.test.tsx
```

Expected: FAIL because all non-active masters use the generic inactive badge and roster rows have no deleted marker.

- [ ] **Step 6: Implement Web filtering and badges**

In `SummaryCards.tsx` use precedence:

```tsx
{row.masterIsDeleted ? (
  <span className="er-badge er-badge--deleted">삭제됨</span>
) : !row.isActive || !row.masterIsActive ? (
  <span className="er-badge er-badge--inactive">비활성</span>
) : null}
```

Exclude `membership.masterIsDeleted` from `ProjectOrganizationsPanel` display and selectors. In `ProjectRosterPage`, derive:

```ts
const deletedOrganizationIds = new Set(
  memberships
    .filter((membership) => membership.masterIsDeleted)
    .map((membership) => membership.organizationId),
);
```

Pass the set to `RosterTable`; in its organization cell render the snapshot name and `삭제됨` badge when the row ID is in the set. Do not replace the snapshot name with the current master name.

- [ ] **Step 7: Run focused tests, checks, and commit**

Run Steps 2 and 5, then:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
corepack pnpm@10.28.1 --filter @event-roster/domain run check
corepack pnpm@10.28.1 --filter @event-roster/worker run check
corepack pnpm@10.28.1 --filter @event-roster/web run check
git add packages/contracts/src/organizations.ts packages/contracts/src/projects.ts \
  packages/domain/src/summary.ts packages/domain/test/summary.test.ts \
  apps/worker/src/db/project-organizations.ts apps/worker/src/services/organizations.ts \
  apps/worker/src/services/roster.ts apps/worker/test/summary.integration.test.ts \
  apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/features/imports/imports.test.tsx \
  apps/web/src/features/roster/SummaryCards.tsx \
  apps/web/src/features/roster/ProjectRosterPage.tsx \
  apps/web/src/features/roster/RosterTable.tsx \
  apps/web/src/features/roster/roster.test.tsx
git commit -m "feat: label deleted organization history"
```

Expected: focused tests and all four package checks exit 0.

---

### Task 6: Add Deleted Organization Discovery and Name-Recovery Guidance

**Files:**
- Create: `apps/web/src/lib/organization-errors.ts`
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Test: `apps/web/src/features/admin/admin.test.tsx`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `includeDeleted`, `OrganizationSummary.isDeleted`, and `ORGANIZATION_NAME_RESERVED` with `{ organizationId }`.
- Produces: `getReservedOrganizationId(error: unknown): string | null`, list filter behavior, and navigation to the deleted organization.

- [ ] **Step 1: Write failing list and collision tests**

Assert the default request contains `includeDeleted=false`, toggling `삭제된 조직 보기` sends `includeDeleted=true`, and a deleted card renders `삭제됨`. Simulate this API problem during both list-page and inline project organization creation:

```ts
new ApiError(409, {
  code: "ORGANIZATION_NAME_RESERVED",
  message: "삭제된 동일 이름의 조직이 있습니다.",
  requestId: "request-1",
  details: { organizationId: "deleted-org" },
});
```

Assert the user sees `삭제된 조직 복구하기` linking to `/organizations/deleted-org`.

- [ ] **Step 2: Run focused Web tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/admin/admin.test.tsx \
  src/features/projects/project-detail.test.tsx
```

Expected: FAIL because the filter, deleted state, and structured recovery guidance do not exist.

- [ ] **Step 3: Add the typed error extractor**

Create `organization-errors.ts`:

```ts
import { ApiError } from "./api";

export function getReservedOrganizationId(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem?.code !== "ORGANIZATION_NAME_RESERVED") return null;
  const details = error.problem.details;
  if (!details || typeof details !== "object") return null;
  const id = (details as Record<string, unknown>).organizationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
```

- [ ] **Step 4: Implement list filtering and recovery links**

Add `includeDeleted` state to `OrganizationsPage` and append it to the query string. Render a labeled checkbox/button with the exact accessible name `삭제된 조직 보기`. Use deleted badge precedence over `isActive`.

Store `reservedOrganizationId` separately from generic error text. In both create surfaces, render:

```tsx
<a href={`/organizations/${encodeURIComponent(reservedOrganizationId)}`}>
  삭제된 조직 복구하기
</a>
```

Clear this state when reopening or successfully submitting a form. Never retry creation with a changed name automatically.

- [ ] **Step 5: Add minimal styles, run tests, and commit**

Add the concrete selectors next to the existing inactive badge and organization-card rules, using existing variables from `global.css`:

```css
.er-badge--deleted {
  color: var(--er-color-danger);
  background: var(--er-color-danger-soft);
}

.er-organization-summary-card--deleted {
  border-style: dashed;
  background: var(--er-color-canvas);
}

.er-organization-recovery-link {
  display: inline-flex;
  margin-top: 0.5rem;
}
```

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/admin/admin.test.tsx \
  src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
git add apps/web/src/lib/organization-errors.ts \
  apps/web/src/features/admin/OrganizationsPage.tsx \
  apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: find and recover deleted organizations"
```

Expected: tests and Web type check exit 0.

---

### Task 7: Replace the Hard-Delete UI with Read-Only Delete and Restore Flows

**Files:**
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/src/services/organizations.ts`
- Test: `apps/worker/test/organization-deletion.integration.test.ts`
- Modify: `apps/web/src/features/admin/OrganizationDeletionPanel.tsx`
- Modify: `apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx`
- Modify: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: soft-delete `DELETE`, restore `POST`, and `OrganizationDetail.isDeleted/deletedAt`.
- Produces: exact-name recoverable deletion, deleted-detail read-only rendering, restore-to-inactive UX, and complete removal of `OrganizationDeletionBlockers`, `OrganizationDeletionEligibility`, and `deletionEligibility`.

- [ ] **Step 1: Rewrite focused deletion-panel tests and confirm RED**

Replace blocker and permanent-delete assertions with:

```ts
expect(screen.getByRole("button", { name: "조직 삭제" })).toBeEnabled();
expect(screen.getByText("담당자, 참가자, 프로젝트 기록은 보존됩니다.")).toBeVisible();
expect(screen.getByText("나중에 복구할 수 있습니다.")).toBeVisible();
expect(screen.getByRole("button", { name: "조직 삭제" })).toBeDisabled();
fireEvent.change(screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."), {
  target: { value: organization.name },
});
expect(screen.getByRole("button", { name: "조직 삭제" })).toBeEnabled();
```

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/admin/OrganizationDeletionPanel.test.tsx
```

Expected: FAIL because the component still hides deletion for active organizations and describes an irreversible hard delete.

- [ ] **Step 2: Rewrite `OrganizationDeletionPanel`**

Remove blocker imports, `DeletionBlockerList`, `canDelete`, and the active-only early return. Show the danger-zone trigger for every non-deleted organization. Disable confirmation only when the exact name does not match, another mutation owns the page, or deletion is running. Use the copy from Step 1 and keep the existing double-submit lock and close-while-loading protection.

Return `null` when `organization.isDeleted` because the detail page supplies restore instead.

In the same change, remove `OrganizationDeletionBlockers`, `OrganizationDeletionEligibility`, and `OrganizationDetail.deletionEligibility` from contracts and contract tests. Remove `findOrganizationDeletionBlockers`, `toOrganizationDeletionEligibility`, the blocker subquery call in `findOrganizationDetail`, and their imports from Worker code. Update the Worker lifecycle test to assert the detail response no longer has that property:

```ts
const detail = await (
  await authedRequest(operator, "/api/v1/organizations/org-1")
).json<Record<string, unknown>>();
expect(detail).not.toHaveProperty("deletionEligibility");
```

- [ ] **Step 3: Write failing detail-page delete/read-only/restore tests**

In `admin.test.tsx`, assert:

```ts
expect(mockApi.delete).toHaveBeenCalledWith(
  "/organizations/org-1",
  { confirmationName: "황룡사" },
);
expect(window.location.pathname).toBe("/organizations");
```

For a deleted detail response, assert `삭제됨`, formatted deletion time, and `조직 복구` are present while `이름 저장`, `조직 다시 사용`, `기존 계정 지정`, `새 담당자 발급`, and project membership action buttons are absent. Click restore and assert:

```ts
expect(mockApi.post).toHaveBeenCalledWith("/organizations/org-1/restore");
expect(await screen.findByText("사용 중지")).toBeVisible();
expect(screen.getByRole("button", { name: "조직 다시 사용" })).toBeEnabled();
```

- [ ] **Step 4: Run detail tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/admin/admin.test.tsx
```

Expected: FAIL because deleted detail has no read-only branch or restore operation.

- [ ] **Step 5: Implement detail deletion and restoration**

Keep the existing delete call and navigation but change notices from permanent deletion to `조직을 삭제했습니다.` Add mutation kind `RESTORE` and:

```ts
async function restoreOrganization() {
  if (!organization || mutationOwner.current) return;
  mutationOwner.current = "RESTORE";
  setMutating("RESTORE");
  try {
    const restored = await api.post<OrganizationDetail>(
      `/organizations/${organization.id}/restore`,
    );
    setOrganization(restored);
    setMutationNotice("조직을 사용 중지 상태로 복구했습니다.");
    await reloadAudit();
  } finally {
    mutationOwner.current = null;
    setMutating(null);
  }
}
```

When `organization.isDeleted`, render facts, managers, projects, and audit as read-only; hide all mutation controls except restore. Copy the established project-detail formatter into `OrganizationDetailPage.tsx` with the exact name and implementation below rather than adding a dependency:

```ts
function formatKstDate(value: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
```

- [ ] **Step 6: Run focused tests, Web checks, and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/admin/OrganizationDeletionPanel.test.tsx \
  src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/organization-deletion.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
corepack pnpm@10.28.1 --filter @event-roster/worker run check
corepack pnpm@10.28.1 --filter @event-roster/web run check
git add packages/contracts/src/organizations.ts \
  packages/contracts/test/contracts.test.ts \
  apps/worker/src/db/organizations.ts apps/worker/src/services/organizations.ts \
  apps/worker/test/organization-deletion.integration.test.ts \
  apps/web/src/features/admin/OrganizationDeletionPanel.tsx \
  apps/web/src/features/admin/OrganizationDeletionPanel.test.tsx \
  apps/web/src/features/admin/OrganizationDetailPage.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: add organization delete and restore interface"
```

Expected: focused contract, Worker, and Web tests/checks exit 0, and no hard-deletion blocker symbol remains under `packages/contracts`, `apps/worker/src`, or `apps/web/src`.

---

### Task 8: Prove the Lifecycle End to End and Document Safe Deployment

**Files:**
- Modify: `apps/web/e2e/organization-management.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/recovery.md`

**Interfaces:**
- Consumes: the complete lifecycle from Tasks 1–7.
- Produces: browser-level regression coverage and the manual `0007` deployment/recovery gate.

- [ ] **Step 1: Replace the hard-delete E2E scenario**

Create an organization with a manager, project link, and roster record. Drive the UI through these assertions:

```ts
await page.getByRole("button", { name: "조직 삭제" }).click();
await page.getByLabel("확인을 위해 조직 이름을 입력하세요.").fill(name);
await page.getByRole("dialog").getByRole("button", { name: "조직 삭제" }).click();
await expect(page).toHaveURL(/\/organizations$/);
await expect(page.getByText(name)).toHaveCount(0);
await page.getByRole("checkbox", { name: "삭제된 조직 보기" }).check();
await expect(page.getByText(name)).toBeVisible();
await expect(page.getByText("삭제됨")).toBeVisible();
```

Open deleted detail, verify managers/projects remain visible, restore, verify `사용 중지`, then reactivate and log in as the preserved manager to prove authority returns. Open the historical project and verify the summary/roster deleted badge before restoration.

- [ ] **Step 2: Run the E2E scenario**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  organization-management.spec.ts
```

Expected: PASS with the complete delete/hide/history/restore/reactivate flow.

- [ ] **Step 3: Update architecture and deployment documentation**

Add to `docs/architecture.md`:

```markdown
- 조직 삭제는 `is_active`와 별개인 복구 가능한 수명주기 overlay다.
- 일반 조직 조회와 모든 신규 선택 경로는 `deleted_at IS NULL`을 요구한다.
- 삭제는 연결 데이터를 보존하고 자동으로 비활성화하며, 복구도 비활성 상태로 돌아온다.
- 프로젝트 명단 스냅샷과 유의미한 집계는 삭제 조직을 `삭제됨`으로 표시한다.
```

Add a `0007_organization_soft_deletion.sql` gate to deployment docs. It must record pre/post `organization_count`, require initial `deleted_count = 0`, require `invalid_deletion_state_count = 0`, and require `PRAGMA foreign_key_check` to return zero rows. Use these post-checks:

```sql
SELECT COUNT(*) AS organization_count FROM organizations;
SELECT COUNT(*) AS deleted_count
FROM organizations WHERE deleted_at IS NOT NULL;
SELECT COUNT(*) AS invalid_deletion_state_count
FROM organizations
WHERE ((deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND is_active = 0))
  IS NOT TRUE;
PRAGMA foreign_key_check;
```

Add the matching pre-`0007` isolated restore branch to `recovery.md`; never apply a reverse migration or import over production.

- [ ] **Step 4: Run the complete verification suite**

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web run build
git diff --check
```

Expected: every command exits 0 with zero test, type, format, build, or whitespace failures.

- [ ] **Step 5: Commit the E2E and operational documentation**

```bash
git add apps/web/e2e/organization-management.spec.ts \
  docs/architecture.md docs/operations/deployment.md docs/operations/recovery.md
git commit -m "test: verify organization deletion lifecycle"
```

- [ ] **Step 6: Review commit boundaries and hand off**

```bash
git status --short
git log --oneline --decorate -8
```

Expected: only the user's pre-existing untracked files remain; the feature is represented by focused commits in the task order above. Do not merge, push, migrate remote D1, or deploy until the user explicitly requests those actions after implementation review.
