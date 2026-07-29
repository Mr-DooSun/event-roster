# Project Soft Deletion and Organization Exclusion Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide excluded project organizations from active work while allowing reactivation, and let operators soft-delete and restore closed projects without losing roster, organization, summary, or audit data.

**Architecture:** Keep the existing project business statuses and add nullable deletion metadata in D1. Make ordinary project lookup exclude deleted rows by default, expose explicit operator-only include-deleted reads, and perform delete/restore with the existing guarded atomic/revision pattern. Keep project-organization storage semantics unchanged while deriving a visible active-membership list in the Web UI and allowing inactive memberships to be selected for reactivation.

**Tech Stack:** TypeScript 5.9, React 19, Hono, Zod, Cloudflare Workers, D1/SQLite migrations, Vitest, Testing Library, Playwright, pnpm 10.28.1, Biome.

## Global Constraints

- Use `corepack pnpm@10.28.1`; do not change the locked package manager or add dependencies.
- Preserve `PRE_REGISTRATION`, `IN_PROGRESS`, and `CLOSED`; deletion is metadata, not a fourth business status.
- Only a non-bootstrap `OPERATOR` may delete, include deleted projects, open deleted detail, or restore.
- Only a non-deleted `CLOSED` project may be soft-deleted.
- Delete confirmation must equal the stored project name byte-for-byte after JSON decoding; do not trim, normalize, or case-fold it.
- Soft deletion preserves roster entries, expected snapshots, project-organization links, import runs, and audit logs.
- Restore always returns the project as `CLOSED`; it never resumes the project.
- Ordinary project and child-resource reads treat a deleted project as `NOT_FOUND`.
- Project-organization exclusion keeps the existing delete-without-history/deactivate-with-history storage rule.
- Active project organization UI shows only `membership.isActive && membership.masterIsActive`.
- A previously excluded membership must be selectable again and reactivated through the existing add endpoint.
- All delete, restore, exclusion, and reactivation writes use expected revision checks and atomic audit writes.
- Keep Cloudflare production deployment manual; do not add GitHub deployment credentials or workflows.
- Preserve user-owned untracked files such as `.DS_Store`, `.pnpm-store/`, and ignored brainstorming artifacts.
- Follow TDD for every behavior change: failing focused test, minimal implementation, passing focused test, then commit.

---

## File Structure

### Contracts and errors

- Modify `packages/contracts/src/common.ts` for `PROJECT_NOT_CLOSED` and `CONFIRMATION_MISMATCH`.
- Modify `packages/contracts/src/projects.ts` for deletion metadata and request schemas.
- Modify `packages/contracts/test/contracts.test.ts` for exact confirmation and restore contracts.

### D1 and Worker

- Create `apps/worker/migrations/0006_project_soft_deletion.sql` for deletion metadata, consistency triggers, and list index.
- Create `apps/worker/test/project-soft-deletion-migration.integration.test.ts` for legacy-row preservation and schema invariants.
- Modify `apps/worker/src/db/projects.ts` to separate ordinary and include-deleted lookup and list options.
- Modify `apps/worker/src/services/project-expiration.ts` so Cron ignores deleted projects.
- Modify `apps/worker/src/services/projects.ts` for operator list/detail policy and guarded delete/restore.
- Modify `apps/worker/src/services/project-organizations.ts` so mutation guards reject deleted projects.
- Modify `apps/worker/src/services/participants.ts` so mutation guards reject deleted projects.
- Modify `apps/worker/src/services/roster.ts` so roster/summary guards and reads reject deleted projects.
- Modify `apps/worker/src/services/imports.ts` so import guards reject deleted projects.
- Modify `apps/worker/src/db/organizations.ts` so deleted-project links do not count as active projects.
- Modify `apps/worker/src/routes/projects.ts` for query parsing and lifecycle endpoints.
- Modify `apps/worker/src/app.ts` for stable HTTP problem mappings.
- Modify `apps/worker/test/projects.integration.test.ts` for lifecycle, permissions, concurrency, and containment.
- Modify child-resource integration tests only where a missing containment assertion is found during the raw-project-query audit.

### Web

- Modify `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx` to render active memberships and make inactive memberships selectable again.
- Modify `apps/web/src/features/projects/project-detail.test.tsx` for exclusion and reactivation behavior.
- Modify `apps/web/src/features/projects/ProjectsPage.tsx` for the operator include-deleted filter.
- Modify `apps/web/src/features/projects/ProjectCard.tsx` for deleted badge/style/link.
- Modify `apps/web/src/features/projects/projects.test.tsx` for list/filter/card behavior.
- Create `apps/web/src/features/projects/ProjectDeletionDialog.tsx` as the focused exact-name destructive confirmation unit.
- Create `apps/web/src/features/projects/ProjectDeletionDialog.test.tsx` for dialog safety and submission locking.
- Modify `apps/web/src/features/projects/ProjectDetailPage.tsx` for deleted read-only detail, delete, restore, and navigation.
- Modify `apps/web/src/app/AppShell.tsx` so query-string navigation rerenders and deleted detail links retain `includeDeleted=true`.
- Modify `apps/web/src/styles/global.css` for deleted cards/detail and lifecycle action layout.

### End-to-end and operations

- Create `apps/web/e2e/project-deletion.spec.ts` for exclusion, delete, hidden-list, include-deleted, and restore flows.
- Modify `docs/operations/deployment.md` with the `0006` backup/apply/post-check gate.
- Modify `docs/operations/recovery.md` with a pre-`0006` isolated restore path.
- Modify `docs/architecture.md` with soft-deletion and ordinary lookup boundaries.

---

### Task 1: Define Project Deletion Contracts and Stable Errors

**Files:**
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/projects.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consumes: existing `Project`, `ApiProblemCode`, and nonnegative revision conventions.
- Produces: `DeleteProjectRequestSchema`, `DeleteProjectRequest`, `RestoreProjectRequestSchema`, `RestoreProjectRequest`, and `Project.isDeleted`/`Project.deletedAt`.

- [ ] **Step 1: Write failing contract tests**

Add exact assertions to `packages/contracts/test/contracts.test.ts`:

```ts
import {
  DeleteProjectRequestSchema,
  RestoreProjectRequestSchema,
} from "../src/projects";

it("keeps project delete confirmation exact and validates revisions", () => {
  expect(
    DeleteProjectRequestSchema.parse({
      confirmationName: "1회 수련 법회",
      expectedRevision: 7,
    }),
  ).toEqual({
    confirmationName: "1회 수련 법회",
    expectedRevision: 7,
  });
  expect(
    DeleteProjectRequestSchema.parse({
      confirmationName: " 1회 수련 법회 ",
      expectedRevision: 7,
    }).confirmationName,
  ).toBe(" 1회 수련 법회 ");
  expect(() =>
    DeleteProjectRequestSchema.parse({
      confirmationName: "",
      expectedRevision: 7,
    }),
  ).toThrow();
  expect(() =>
    RestoreProjectRequestSchema.parse({ expectedRevision: -1 }),
  ).toThrow();
});
```

Extend the existing `Project` fixture expectation with:

```ts
expect(project).toMatchObject({
  isDeleted: false,
  deletedAt: null,
});
```

- [ ] **Step 2: Run the focused contract test and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
```

Expected: FAIL because the new schemas and `Project` fields do not exist.

- [ ] **Step 3: Implement the contract additions**

Append problem codes in `packages/contracts/src/common.ts`:

```ts
"PROJECT_NOT_CLOSED",
"CONFIRMATION_MISMATCH",
```

Add to `packages/contracts/src/projects.ts`:

```ts
export const DeleteProjectRequestSchema = z.object({
  confirmationName: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
});
export type DeleteProjectRequest = z.infer<
  typeof DeleteProjectRequestSchema
>;

export const RestoreProjectRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});
export type RestoreProjectRequest = z.infer<
  typeof RestoreProjectRequestSchema
>;
```

Extend `Project`:

```ts
isDeleted: boolean;
deletedAt: string | null;
```

Do not expose `deletedBy` or `deletedRevision` in the public contract.

- [ ] **Step 4: Run contract tests and type checks**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/common.ts \
  packages/contracts/src/projects.ts \
  packages/contracts/test/contracts.test.ts
git commit -m "feat: define project deletion contracts"
```

---

### Task 2: Add the D1 Soft-Deletion Schema and Read Boundaries

**Files:**
- Create: `apps/worker/migrations/0006_project_soft_deletion.sql`
- Create: `apps/worker/test/project-soft-deletion-migration.integration.test.ts`
- Modify: `apps/worker/test/schema.integration.test.ts`
- Modify: `apps/worker/src/db/projects.ts`
- Modify: `apps/worker/src/services/project-expiration.ts`
- Test: `apps/worker/test/project-expiration.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `Project.isDeleted` and `Project.deletedAt`.
- Produces: `findProject(db, id)`, `findProjectIncludingDeleted(db, id)`, and `listProjects(db, options)` where ordinary reads exclude deleted rows.

- [ ] **Step 1: Write failing schema, migration, DB, and Cron tests**

Create `project-soft-deletion-migration.integration.test.ts` with a test that
applies migrations `0001` through `0005`, inserts one closed project, records
the count, applies `0006`, and asserts:

```ts
expect(
  await env.MIGRATION_DB.prepare(
    `SELECT deleted_at, deleted_by, deleted_revision
     FROM projects WHERE id = 'pre-0006-project'`,
  ).first(),
).toEqual({
  deleted_at: null,
  deleted_by: null,
  deleted_revision: null,
});
expect(await countMigrationRows("projects")).toBe(preMigrationCount);
expect(
  (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
).toEqual([]);
```

In `schema.integration.test.ts`, assert the three nullable columns and reject
an inconsistent deleted row:

```ts
await expect(
  env.DB.prepare(
    `UPDATE projects
     SET deleted_at = '2026-07-29T00:00:00.000Z'
     WHERE id = ?`,
  ).bind(IDS.project).run(),
).rejects.toThrow(/INVALID_PROJECT_DELETION_STATE/);
```

Add DB behavior to `projects.integration.test.ts` or a focused DB test:

```ts
expect(await findProject(env.DB, deletedProjectId)).toBeNull();
expect(await findProjectIncludingDeleted(env.DB, deletedProjectId)).toMatchObject({
  id: deletedProjectId,
  isDeleted: true,
});
```

Add a Cron regression to `project-expiration.integration.test.ts`: a
soft-deleted, expired, non-closed fixture must not be selected or changed by
`closeExpiredProjects`.

- [ ] **Step 2: Run focused Worker tests and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/project-soft-deletion-migration.integration.test.ts \
  test/schema.integration.test.ts \
  test/project-expiration.integration.test.ts
```

Expected: FAIL on missing migration/columns and missing include-deleted lookup.

- [ ] **Step 3: Add migration `0006_project_soft_deletion.sql`**

Use this schema:

```sql
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects
  ADD COLUMN deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE projects
  ADD COLUMN deleted_revision INTEGER
  CHECK (deleted_revision IS NULL OR deleted_revision >= 0);

CREATE INDEX projects_deleted_status_order
  ON projects(deleted_at, status, start_date, created_at, closed_at);

CREATE TRIGGER projects_deletion_state_insert
BEFORE INSERT ON projects
WHEN (
  (NEW.deleted_at IS NULL
    AND NEW.deleted_by IS NULL
    AND NEW.deleted_revision IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.deleted_revision = NEW.revision
    AND NEW.status = 'CLOSED')
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PROJECT_DELETION_STATE');
END;

CREATE TRIGGER projects_deletion_state_update
BEFORE UPDATE OF deleted_at, deleted_by, deleted_revision, revision, status
ON projects
WHEN (
  (NEW.deleted_at IS NULL
    AND NEW.deleted_by IS NULL
    AND NEW.deleted_revision IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.deleted_revision = NEW.revision
    AND NEW.status = 'CLOSED')
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PROJECT_DELETION_STATE');
END;
```

- [ ] **Step 4: Implement ordinary and include-deleted DB reads**

In `apps/worker/src/db/projects.ts`:

```ts
export interface ProjectListOptions {
  actorUserId?: string;
  includeDeleted?: boolean;
}

export async function findProject(
  db: D1Database,
  id: string,
): Promise<ProjectRecord | null> {
  return findProjectByDeletionScope(db, id, false);
}

export async function findProjectIncludingDeleted(
  db: D1Database,
  id: string,
): Promise<ProjectRecord | null> {
  return findProjectByDeletionScope(db, id, true);
}
```

Extend `ProjectRow`, `SELECT_PROJECT`, and `mapProject`:

```ts
deleted_at: string | null;
deleted_by: string | null;
deleted_revision: number | null;

isDeleted: row.deleted_at !== null,
deletedAt: row.deleted_at,
```

Build `listProjects` predicates from an array so both visibility and deletion
scope compose without malformed double `WHERE` clauses:

```ts
const predicates = [
  ...(options.includeDeleted ? [] : ["projects.deleted_at IS NULL"]),
  ...(options.actorUserId ? [managerVisibilitySql] : []),
];
const where =
  predicates.length === 0 ? "" : ` WHERE ${predicates.join(" AND ")}`;
```

- [ ] **Step 5: Exclude deleted projects from scheduled expiration**

Add `deleted_at IS NULL` to both queries in
`apps/worker/src/services/project-expiration.ts`:

```sql
WHERE id = ? AND deleted_at IS NULL AND status <> 'CLOSED'
```

and:

```sql
WHERE deleted_at IS NULL
  AND status <> 'CLOSED'
  AND end_date IS NOT NULL
  AND end_date < ?
```

- [ ] **Step 6: Run focused tests and Worker type check**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/project-soft-deletion-migration.integration.test.ts \
  test/schema.integration.test.ts \
  test/project-expiration.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/migrations/0006_project_soft_deletion.sql \
  apps/worker/test/project-soft-deletion-migration.integration.test.ts \
  apps/worker/test/schema.integration.test.ts \
  apps/worker/test/project-expiration.integration.test.ts \
  apps/worker/src/db/projects.ts \
  apps/worker/src/services/project-expiration.ts
git commit -m "feat: add project soft deletion schema"
```

---

### Task 3: Implement Operator Delete, Restore, and Include-Deleted APIs

**Files:**
- Modify: `apps/worker/src/services/projects.ts`
- Modify: `apps/worker/src/services/project-organizations.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/src/services/imports.ts`
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/src/routes/projects.ts`
- Modify: `apps/worker/src/app.ts`
- Test: `apps/worker/test/projects.integration.test.ts`
- Test: `apps/worker/test/project-organizations.integration.test.ts`
- Test: `apps/worker/test/participants.integration.test.ts`
- Test: `apps/worker/test/roster.integration.test.ts`
- Test: `apps/worker/test/imports.integration.test.ts`
- Test: `apps/worker/test/organization-deletion.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas/errors and Task 2 include-deleted DB functions.
- Produces: `softDeleteProject`, `restoreProject`, operator-only include-deleted list/detail, and the two lifecycle routes.

- [ ] **Step 1: Write failing lifecycle and permission tests**

Add cases to `projects.integration.test.ts` covering:

```ts
const deleted = await authedRequest(
  operator,
  `/api/v1/projects/${closed.id}`,
  {
    method: "DELETE",
    body: JSON.stringify({
      confirmationName: closed.name,
      expectedRevision: closed.revision,
    }),
  },
);
expect(deleted.status).toBe(200);
expect(await deleted.json()).toMatchObject({
  id: closed.id,
  status: "CLOSED",
  isDeleted: true,
  revision: closed.revision + 1,
});
expect(
  (await authedRequest(operator, `/api/v1/projects/${closed.id}`)).status,
).toBe(404);
expect(
  (
    await authedRequest(
      operator,
      `/api/v1/projects/${closed.id}?includeDeleted=true`,
    )
  ).status,
).toBe(200);
```

Also assert:

- `PRE_REGISTRATION` and `IN_PROGRESS` deletion return
  `PROJECT_NOT_CLOSED`.
- mismatched whitespace/case/NFC-NFD confirmation returns
  `CONFIRMATION_MISMATCH`.
- stale delete and restore return `STALE_REVISION`.
- a second delete returns `NOT_FOUND` and creates one `PROJECT_DELETED` audit.
- restore clears `isDeleted`, increments revision, keeps `CLOSED`, and creates
  one `PROJECT_RESTORED` audit.
- organization managers receive `403` for `includeDeleted=true`, delete, and
  restore.
- bootstrap operator receives `403` for delete and restore.
- ordinary list omits deleted projects; operator include-deleted list contains
  them.

- [ ] **Step 2: Run the focused project integration test and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/projects.integration.test.ts
```

Expected: FAIL because routes and services are absent.

- [ ] **Step 3: Implement list/detail policy**

Change project service signatures:

```ts
export async function getProjects(
  env: Env,
  actor: Actor,
  includeDeleted = false,
): Promise<Project[]>

export async function getProject(
  env: Env,
  actor: Actor,
  projectId: string,
  includeDeleted = false,
): Promise<Project>
```

Rules:

```ts
if (includeDeleted) requireAdministrativeOperator(actor);
const project = includeDeleted
  ? await findProjectIncludingDeleted(env.DB, projectId)
  : await findProject(env.DB, projectId);
```

Call `listProjects` with:

```ts
{
  ...(actor.session.user.role === "OPERATOR"
    ? {}
    : { actorUserId: actor.session.user.id }),
  includeDeleted,
}
```

- [ ] **Step 4: Implement guarded atomic delete**

Add:

```ts
export async function softDeleteProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: DeleteProjectRequest,
  now = new Date(),
): Promise<Project>
```

Preflight in this order:

```ts
const current = await findProjectIncludingDeleted(env.DB, projectId);
if (!current || current.isDeleted) throw new DomainError("NOT_FOUND");
if (current.status !== "CLOSED") {
  throw new DomainError("PROJECT_NOT_CLOSED");
}
if (current.name !== input.confirmationName) {
  throw new DomainError("CONFIRMATION_MISMATCH");
}
if (current.revision !== input.expectedRevision) {
  throw new DomainError("STALE_REVISION");
}
```

Use `runGuardedAtomic` with an operator guard predicate that repeats all
conditions, then:

```sql
UPDATE projects
SET revision = revision + 1,
    deleted_revision = revision + 1,
    deleted_at = ?,
    deleted_by = ?,
    updated_at = ?
WHERE id = ?
  AND status = 'CLOSED'
  AND deleted_at IS NULL
  AND revision = ?
  AND name = ?
```

Insert `PROJECT_DELETED` in the same batch. On guarded failure, reread with
`findProjectIncludingDeleted` and translate to `NOT_FOUND`,
`PROJECT_NOT_CLOSED`, `CONFIRMATION_MISMATCH`, or `STALE_REVISION` using the
same precedence.

- [ ] **Step 5: Implement guarded atomic restore**

Add:

```ts
export async function restoreProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: RestoreProjectRequest,
  now = new Date(),
): Promise<Project>
```

Require an existing deleted row and exact revision. Update atomically:

```sql
UPDATE projects
SET status = 'CLOSED',
    revision = revision + 1,
    deleted_at = NULL,
    deleted_by = NULL,
    deleted_revision = NULL,
    updated_at = ?
WHERE id = ? AND deleted_at IS NOT NULL AND revision = ?
```

Insert `PROJECT_RESTORED` in the same batch and return the ordinary
`findProject` result.

- [ ] **Step 6: Add routes and HTTP mappings**

In `routes/projects.ts`, parse:

```ts
const IncludeDeletedQuerySchema = z.object({
  includeDeleted: z.enum(["true"]).optional(),
});
```

Add:

```ts
projectRoutes.delete("/projects/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = DeleteProjectRequestSchema.parse(await c.req.json());
  return c.json(await softDeleteProject(c.env, actor, c.req.param("id"), input));
});

projectRoutes.post("/projects/:id/restore", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = RestoreProjectRequestSchema.parse(await c.req.json());
  return c.json(await restoreProject(c.env, actor, c.req.param("id"), input));
});
```

Map errors in `apps/worker/src/app.ts`:

```ts
PROJECT_NOT_CLOSED: [409, "종료된 프로젝트만 삭제할 수 있습니다."],
CONFIRMATION_MISMATCH: [409, "프로젝트 이름이 일치하지 않습니다."],
```

- [ ] **Step 7: Audit raw project SQL for deletion bypasses**

Run:

```bash
rg -n "FROM projects|JOIN projects" apps/worker/src
```

For every query that drives ordinary project access, require
`deleted_at IS NULL`. Do not add that predicate to the explicit
include-deleted lookup or restore query. Add a focused integration assertion
for each corrected bypass before changing it. The current audit must cover
these exact files and predicates:

```text
apps/worker/src/services/project-organizations.ts
apps/worker/src/services/participants.ts
apps/worker/src/services/roster.ts
apps/worker/src/services/imports.ts
apps/worker/src/db/organizations.ts
```

Add `deleted_at IS NULL` (or `p.deleted_at IS NULL` for aliased joins) to the
project existence/guard query in each service. Add one containment assertion
to the corresponding integration test that soft-deletes a closed project and
expects its next child-resource request to return `404`. In
`organization-deletion.integration.test.ts`, assert a deleted project does not
contribute to `activeProjectCount` or the project-link deletion blocker.

- [ ] **Step 8: Run Worker lifecycle and full Worker tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/projects.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run test
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/services/projects.ts \
  apps/worker/src/services/project-organizations.ts \
  apps/worker/src/services/participants.ts \
  apps/worker/src/services/roster.ts \
  apps/worker/src/services/imports.ts \
  apps/worker/src/db/organizations.ts \
  apps/worker/src/routes/projects.ts \
  apps/worker/src/app.ts \
  apps/worker/test/projects.integration.test.ts \
  apps/worker/test/project-organizations.integration.test.ts \
  apps/worker/test/participants.integration.test.ts \
  apps/worker/test/roster.integration.test.ts \
  apps/worker/test/imports.integration.test.ts \
  apps/worker/test/organization-deletion.integration.test.ts
git commit -m "feat: add project delete and restore APIs"
```

Before committing, inspect `git diff --cached --name-only` and confirm it
contains only the files listed in this task.

---

### Task 4: Hide Excluded Organizations and Reactivate Them from Add

**Files:**
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`

**Interfaces:**
- Consumes: existing `ProjectOrganization.isActive`,
  `masterIsActive`, `hasBusinessHistory`, add endpoint, and revision chaining.
- Produces: `visibleMemberships` and `activeLinkedOrganizationIds` derived
  values; no API contract changes.

- [ ] **Step 1: Replace the old reactivation test with failing user-flow tests**

In `project-detail.test.tsx`, render one active and one inactive membership and
assert:

```ts
expect(screen.getByText("활성 조직")).toBeVisible();
expect(screen.queryByText("제외 조직")).not.toBeInTheDocument();
```

Pass the inactive organization in `allOrganizations`, type its name into the
combobox, select it, submit `프로젝트에 추가`, and assert:

```ts
expect(mockApi.post).toHaveBeenCalledWith(
  "/projects/project-1/organizations",
  {
    organizationId: "org-inactive",
    expectedProjectRevision: 8,
  },
);
```

Add an expectation that the confirmation copy says:

```text
기존 명단과 집계 이력이 있으면 그대로 다시 연결됩니다.
```

Retain the existing test that distinguishes delete-without-history from
deactivate-with-history at the Worker boundary.

- [ ] **Step 2: Run the focused Web test and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx
```

Expected: FAIL because inactive rows are rendered and all membership IDs block
selection.

- [ ] **Step 3: Derive visible rows and active linked IDs**

In `ProjectOrganizationsPanel.tsx`:

```ts
const visibleMemberships = useMemo(
  () =>
    memberships.filter(
      (membership) => membership.isActive && membership.masterIsActive,
    ),
  [memberships],
);

const linkedOrganizationIds = useMemo(
  () =>
    new Set(
      memberships
        .filter((membership) => membership.isActive)
        .map((membership) => membership.organizationId),
    ),
  [memberships],
);
```

Render `visibleMemberships`, including its empty-state check. Do not delete
inactive membership data from the parent state; `onChanged()` remains the
authoritative refresh.

- [ ] **Step 4: Add reactivation confirmation copy**

When `pendingSelection.kind === "EXISTING"` and the selected ID matches an
inactive membership, show this inline notice before submission:

```tsx
<StatusMessage tone="info">
  기존 명단과 집계 이력이 있으면 그대로 다시 연결됩니다.
</StatusMessage>
```

Continue using `POST /projects/:projectId/organizations`; the Worker already
reactivates an inactive conflict row.

- [ ] **Step 5: Run project detail tests and Web check**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/projects/project-detail.test.tsx
git commit -m "fix: hide excluded project organizations"
```

---

### Task 5: Add the Operator Deleted-Project List Filter

**Files:**
- Modify: `apps/web/src/features/projects/ProjectsPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectCard.tsx`
- Modify: `apps/web/src/features/projects/projects.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 1 project deletion fields and Task 3
  `GET /projects?includeDeleted=true`.
- Produces: operator-only filter and deleted project card linking to explicit
  deleted detail.

- [ ] **Step 1: Write failing list and card tests**

Add tests that assert:

```ts
expect(
  screen.getByRole("checkbox", { name: "삭제된 프로젝트 포함" }),
).toBeVisible();
fireEvent.click(
  screen.getByRole("checkbox", { name: "삭제된 프로젝트 포함" }),
);
await waitFor(() =>
  expect(mockApi.get).toHaveBeenLastCalledWith(
    "/projects?includeDeleted=true",
  ),
);
expect(screen.getByText("삭제됨", { exact: true })).toBeVisible();
expect(screen.getByRole("link", { name: /삭제 프로젝트/ })).toHaveAttribute(
  "href",
  "/projects/deleted-project?includeDeleted=true",
);
```

In an organization-manager render, assert the checkbox is absent and only
`/projects` is requested.

Add a stale-response test: toggle on, then off, resolve the older
include-deleted request last, and assert deleted cards remain absent.

- [ ] **Step 2: Run focused list tests and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/projects.test.tsx
```

Expected: FAIL because the filter and deleted card state do not exist.

- [ ] **Step 3: Implement filter-aware loading**

In `ProjectsPage.tsx`:

```ts
const [includeDeleted, setIncludeDeleted] = useState(false);
const listPath =
  operator && includeDeleted
    ? "/projects?includeDeleted=true"
    : "/projects";
```

Make `load` depend on `listPath`, retain the existing generation guard, and
reload when the operator changes the checkbox. Render:

```tsx
{operator ? (
  <label className="er-checkbox-field">
    <input
      type="checkbox"
      checked={includeDeleted}
      onChange={(event) => setIncludeDeleted(event.currentTarget.checked)}
    />
    삭제된 프로젝트 포함
  </label>
) : null}
```

- [ ] **Step 4: Render deleted cards distinctly**

In `ProjectCard.tsx`:

```tsx
const href = project.isDeleted
  ? `/projects/${encodeURIComponent(project.id)}?includeDeleted=true`
  : `/projects/${encodeURIComponent(project.id)}`;
```

Use `er-project-card--deleted`, show a `삭제됨` badge instead of the status
badge, and render the deletion date only through an explicit null guard:

```tsx
{project.isDeleted && project.deletedAt ? (
  <time dateTime={project.deletedAt}>
    삭제 {formatKstDate(project.deletedAt)}
  </time>
) : null}
```

Add CSS with reduced saturation but maintain WCAG-readable text and focus:

```css
.er-project-card--deleted {
  border-style: dashed;
  background: var(--er-surface-muted);
}

.er-project-card--deleted:hover,
.er-project-card--deleted:focus-visible {
  border-color: var(--er-primary);
}
```

Use existing CSS variables; if `--er-surface-muted` is absent, use the
existing muted panel background token rather than introducing a new palette.

- [ ] **Step 5: Run list tests, Web check, and build**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/projects.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/projects/ProjectsPage.tsx \
  apps/web/src/features/projects/ProjectCard.tsx \
  apps/web/src/features/projects/projects.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: list deleted projects for operators"
```

---

### Task 6: Add Delete Confirmation and Read-Only Restore Detail

**Files:**
- Create: `apps/web/src/features/projects/ProjectDeletionDialog.tsx`
- Create: `apps/web/src/features/projects/ProjectDeletionDialog.test.tsx`
- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 3 delete/restore endpoints and Task 5 deleted-detail link.
- Produces: exact-name delete modal, deleted read-only detail, restore action,
  and query-aware routing.

- [ ] **Step 1: Write failing dialog unit tests**

Create `ProjectDeletionDialog.test.tsx` with:

```ts
it("requires the exact project name and locks while deleting", async () => {
  const onConfirm = vi.fn(() => deferredDelete.promise);
  render(
    <ProjectDeletionDialog
      projectName="1회 수련 법회"
      open
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  const input = screen.getByRole("textbox", {
    name: "삭제할 프로젝트 이름",
  });
  const submit = screen.getByRole("button", { name: "프로젝트 삭제" });
  expect(submit).toBeDisabled();
  fireEvent.change(input, { target: { value: "1회 수련 법회 " } });
  expect(submit).toBeDisabled();
  fireEvent.change(input, { target: { value: "1회 수련 법회" } });
  fireEvent.click(submit);
  expect(onConfirm).toHaveBeenCalledWith("1회 수련 법회");
  expect(
    screen.getByRole("button", { name: "삭제 중…" }),
  ).toBeDisabled();
});
```

Also assert Escape, backdrop, and cancel do not close while the promise is
pending, and rejected confirmation keeps the input/dialog open.

- [ ] **Step 2: Write failing detail lifecycle tests**

In `project-detail.test.tsx`, assert:

- delete button exists only for operator + `CLOSED` + `!isDeleted`;
- delete calls:

```ts
mockApi.delete(
  "/projects/project-1",
  { confirmationName: "1회 수련 법회", expectedRevision: 7 },
);
```

- success navigates to `/projects` and dispatches `popstate`;
- `STALE_REVISION` reloads the project and closes the dialog;
- `CONFIRMATION_MISMATCH` keeps the dialog open with an exact-name message;
- deleted detail requests `/projects/project-1?includeDeleted=true`;
- deleted detail renders no tabs, edit, transition, import/export, organization,
  or roster actions;
- restore calls `/projects/project-1/restore` with revision and navigates to
  `/projects/project-1`;
- organization managers cannot open the deleted-detail mode.

In `App.test.tsx`, push a URL containing `?includeDeleted=true`, dispatch
`popstate`, and assert the detail component makes the include-deleted request.

- [ ] **Step 3: Run focused dialog/detail tests and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/ProjectDeletionDialog.test.tsx \
  src/features/projects/project-detail.test.tsx \
  src/app/App.test.tsx
```

Expected: FAIL on missing component and deleted-detail mode.

- [ ] **Step 4: Implement the focused deletion dialog**

Use this public interface:

```ts
export interface ProjectDeletionDialogProps {
  open: boolean;
  projectName: string;
  onClose(): void;
  onConfirm(confirmationName: string): Promise<void>;
}
```

The dialog copy must state:

```text
프로젝트는 목록에서 숨겨지며 참가 명단, 조직, 집계와 변경 이력은 보존됩니다.
삭제된 프로젝트 목록에서 다시 복구할 수 있습니다.
```

Keep local `confirmationName`, `submitting`, and `error` state. Enable submit
only when `confirmationName === projectName && !submitting`.

- [ ] **Step 5: Make AppShell query-aware**

Replace the pathname-only hook with:

```ts
function useLocationPath() {
  const [location, setLocation] = useState(
    () => `${window.location.pathname}${window.location.search}`,
  );
  useEffect(() => {
    const update = () =>
      setLocation(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return location;
}
```

Parse with `new URL(location, window.location.origin)` and pass:

```tsx
<ProjectDetailPage
  projectId={decodedId}
  includeDeleted={url.searchParams.get("includeDeleted") === "true"}
/>
```

Reject include-deleted mode in `ProjectDetailPage` unless the authenticated
role is `OPERATOR`.

- [ ] **Step 6: Implement delete and restore detail modes**

Change the component signature:

```ts
export function ProjectDetailPage({
  projectId,
  includeDeleted = false,
}: {
  projectId: string;
  includeDeleted?: boolean;
})
```

Use:

```ts
const projectPath = includeDeleted
  ? `/projects/${projectId}?includeDeleted=true`
  : `/projects/${projectId}`;
```

Do not start child resource requests in deleted-detail mode. Once the project
loads with `isDeleted`, render a compact read-only header/card with deletion
date and one `프로젝트 복구` button.

Delete:

```ts
await api.delete<Project>(`/projects/${projectId}`, {
  confirmationName,
  expectedRevision: project.revision,
});
navigate("/projects");
```

Restore:

```ts
await api.post<Project>(`/projects/${projectId}/restore`, {
  expectedRevision: project.revision,
});
navigate(`/projects/${encodeURIComponent(projectId)}`);
```

Use a small local `navigate` helper:

```ts
function navigate(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
```

- [ ] **Step 7: Run focused tests and full Web tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/ProjectDeletionDialog.test.tsx \
  src/features/projects/project-detail.test.tsx \
  src/app/App.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run test
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/projects/ProjectDeletionDialog.tsx \
  apps/web/src/features/projects/ProjectDeletionDialog.test.tsx \
  apps/web/src/features/projects/ProjectDetailPage.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/app/AppShell.tsx \
  apps/web/src/app/App.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: delete and restore closed projects"
```

---

### Task 7: Prove End-to-End Behavior and Document Migration Operations

**Files:**
- Create: `apps/web/e2e/project-deletion.spec.ts`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/recovery.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: browser-level acceptance coverage and an approved manual `0006`
  production migration/recovery gate.

- [ ] **Step 1: Write the failing E2E scenario**

Create `project-deletion.spec.ts`. Use an API context to log in as the seeded
operator and create two projects:

1. an organization-exclusion project linked to `fixture().organizationId`;
2. a deletion project transitioned from `PRE_REGISTRATION` to `IN_PROGRESS`
   and then `CLOSED`.

The browser assertions must execute this sequence:

```ts
await page.goto(`/projects/${exclusionProject.id}`);
await page.getByRole("tab", { name: "조직" }).click();
await page.getByRole("button", { name: "프로젝트에서 제외" }).click();
await page.getByRole("button", { name: "제외하기" }).click();
await expect(page.getByText("E2E 1팀", { exact: true })).toBeHidden();
```

Search the known organization name in the combobox, re-add it, and assert the
row returns.

For deletion:

```ts
await page.goto(`/projects/${closedProject.id}`);
await page.getByRole("button", { name: "프로젝트 삭제" }).click();
await page
  .getByRole("textbox", { name: "삭제할 프로젝트 이름" })
  .fill(closedProject.name);
await page
  .getByRole("dialog", { name: "프로젝트 삭제" })
  .getByRole("button", { name: "프로젝트 삭제" })
  .click();
await expect(page).toHaveURL(/\/projects$/);
await expect(page.getByText(closedProject.name)).toBeHidden();
```

Enable `삭제된 프로젝트 포함`, open the deleted card, restore it, and assert
the project returns with `종료` status.

- [ ] **Step 2: Run the new E2E test and confirm RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-deletion.spec.ts
```

Expected: FAIL before the completed lifecycle UI is available. If Tasks 1–6
already make it green, prove test relevance by temporarily changing one
expected endpoint to an invalid path, observe failure, restore the assertion,
and rerun green without committing the temporary change.

- [ ] **Step 3: Complete the E2E fixture and pass the scenario**

Use API-created per-test projects rather than shared mutable fixture projects.
Dispose the API context in `finally`. Do not call production URLs or write
credentials to output. Use existing local `.local-e2e-env.json` only through
`fixture()`.

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-deletion.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Add the manual `0006` deployment gate**

In `docs/operations/deployment.md`, require:

```bash
release_backup_dir="$(mktemp -d /private/tmp/event-roster-d1-0006.XXXXXX)"
chmod 700 "$release_backup_dir"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$release_backup_dir/event-roster-before-0006.sql"
chmod 600 "$release_backup_dir/event-roster-before-0006.sql"
shasum -a 256 "$release_backup_dir/event-roster-before-0006.sql" \
  > "$release_backup_dir/event-roster-before-0006.sql.sha256"
chmod 600 "$release_backup_dir/event-roster-before-0006.sql.sha256"
```

Record before apply:

```sql
SELECT COUNT(*) AS project_count FROM projects;
```

Require pending migration output to contain only
`0006_project_soft_deletion.sql`, then apply. Verify after apply:

```sql
SELECT COUNT(*) AS project_count FROM projects;
SELECT COUNT(*) AS deleted_count FROM projects WHERE deleted_at IS NOT NULL;
PRAGMA foreign_key_check;
```

The before/after project counts must match, initial `deleted_count` must be
`0`, and the foreign-key check must return no rows. State that Worker deploy
must stop if any condition fails.

- [ ] **Step 5: Document recovery and architecture**

In `docs/operations/recovery.md`, add a pre-`0006` export restore path that
imports into a newly created isolated D1, runs all migrations through `0006`,
verifies counts and foreign keys, and changes the production binding only
after validation.

In `docs/architecture.md`, document:

```text
Project deletion is a recoverable lifecycle overlay. Ordinary reads require
deleted_at IS NULL; only explicit operator include-deleted reads and restore
may cross that boundary.
```

- [ ] **Step 6: Run documentation and E2E checks**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-deletion.spec.ts
git diff --check -- docs/operations/deployment.md \
  docs/operations/recovery.md docs/architecture.md \
  apps/web/e2e/project-deletion.spec.ts
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e/project-deletion.spec.ts \
  docs/operations/deployment.md \
  docs/operations/recovery.md \
  docs/architecture.md
git commit -m "test: cover project soft deletion lifecycle"
```

---

### Task 8: Run Full Verification and Prepare the Branch for Review

**Files:**
- Verify: all tracked files changed by Tasks 1–7
- Do not modify: user-owned untracked files

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: fresh evidence that contracts, Worker, Web, E2E, build, format,
  and deploy dry-run all pass together.

- [ ] **Step 1: Confirm branch scope and tracked cleanliness**

Run:

```bash
git status --short
git log --oneline --decorate -12
git diff main...HEAD --stat
```

Expected: only known user-owned untracked files may remain; no unstaged or
staged tracked changes.

- [ ] **Step 2: Run the complete workspace test suite**

Run:

```bash
corepack pnpm@10.28.1 run test
```

Expected: exit 0 with all workspace test files passing.

- [ ] **Step 3: Run type and tracked-source formatting checks**

Run:

```bash
corepack pnpm@10.28.1 run check
git ls-files -z | xargs -0 corepack pnpm@10.28.1 exec biome check
```

Expected: both exit 0. Use the tracked-file Biome command because user-owned
ignored `.pnpm-store/` and brainstorming artifacts are outside product source
and must not be modified.

- [ ] **Step 4: Run Web build and full local E2E**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run build
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: build and all Playwright tests exit 0.

- [ ] **Step 5: Validate the production Worker bundle without deploying**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
```

Expected: exit 0, assets are discovered, D1 binding is `event-roster`, and no
production mutation occurs.

- [ ] **Step 6: Review requirements against the design**

Read:

```bash
git diff main...HEAD
sed -n '1,320p' \
  docs/superpowers/specs/2026-07-29-project-soft-deletion-and-organization-exclusion-visibility-design.md
```

Confirm explicitly:

- excluded organization disappears and is re-addable;
- no project-related business rows are physically deleted;
- only closed projects can be soft-deleted;
- deleted ordinary access is contained;
- operator filter/detail/restore works;
- exact confirmation, revision guards, and atomic audits exist;
- `0006` deployment and recovery gates are documented.

- [ ] **Step 7: Request code review**

Invoke `superpowers:requesting-code-review` against the full branch diff.
Address only confirmed correctness, security, accessibility, or spec gaps.
Rerun the smallest affected test after each fix, then repeat Steps 2–5 before
claiming completion.
