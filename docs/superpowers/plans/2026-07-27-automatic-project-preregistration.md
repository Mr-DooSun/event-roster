# Automatic Project Pre-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new project immediately usable for pre-registration, migrate legacy `PREPARING` projects to `PRE_REGISTRATION`, and preserve the existing start-of-event snapshot and closed-project rules.

**Architecture:** Add one append-only D1 migration that audits and converts legacy rows without rebuilding the `projects` table. Remove `PREPARING` from the public contract and runtime transition graph, create projects directly in `PRE_REGISTRATION`, then simplify Web actions and fixtures around the three runtime states `PRE_REGISTRATION`, `IN_PROGRESS`, and `CLOSED`.

**Tech Stack:** TypeScript, Zod contracts, Hono Cloudflare Worker, D1/SQLite migrations, React 19, Vitest, Cloudflare Workers test pool, Playwright Chromium, pnpm 10.28.1.

## Global Constraints

- Preserve the expected/actual/delta summary model and the `PRE_REGISTRATION` roster source.
- `PRE_REGISTRATION → IN_PROGRESS` must still atomically capture expected snapshots and mark active pre-registration rows as expected-at-start.
- `IN_PROGRESS → CLOSED`, scheduled close, and `CLOSED → IN_PROGRESS` behavior must remain unchanged.
- Organization managers may mutate rosters only in `PRE_REGISTRATION`; they remain read-only in `IN_PROGRESS`.
- Excel import remains available only in `PRE_REGISTRATION`.
- Keep `PREPARING` in the existing D1 CHECK constraint for compatibility; do not rebuild the `projects` table.
- No service or UI path may create a new `PREPARING` row or accept `PREPARING` as a transition target.
- Migrations are append-only. Never edit `0001_initial.sql`, `0002_project_model.sql`, or `0003_organization_leadership.sql`.
- Apply production migration only after an external D1 export and checksum verification following `docs/operations/deployment.md`.
- Use TDD for every behavior change and commit after each task.

---

### Task 1: Migrate and Audit Legacy Preparing Projects

**Files:**
- Create: `apps/worker/migrations/0004_automatic_project_preregistration.sql`
- Modify: `apps/worker/test/project-migration.integration.test.ts`

**Interfaces:**
- Consumes: existing `projects` and `audit_logs` tables after migrations 0001–0003.
- Produces: migration 0004, after which every existing project has a runtime status other than `PREPARING`; each converted row has revision `old + 1` and one `PROJECT_AUTO_PREREGISTERED` audit record.

- [ ] **Step 1: Extend the migration integration test with a legacy preparing row**

Update the migration destructuring and application order:

```ts
const [initial, projectModel, organizationLeadership, automaticPreregistration] =
  env.TEST_MIGRATIONS;
if (
  !initial ||
  !projectModel ||
  !organizationLeadership ||
  !automaticPreregistration
) {
  throw new Error("expected migrations 0001 through 0004");
}

await applyD1Migrations(env.MIGRATION_DB, [
  projectModel,
  organizationLeadership,
]);
await env.MIGRATION_DB.prepare(
  `INSERT INTO projects
   (id, name, start_date, end_date, status, revision, created_by,
    created_at, updated_at, closed_at, closed_by, close_reason)
   VALUES ('legacy-preparing', '준비 중 프로젝트', NULL, NULL, 'PREPARING', 5,
    'migration-user', '2026-01-01T00:00:00.000Z',
    '2026-05-01T00:00:00.000Z', NULL, NULL, NULL)`,
).run();
await applyD1Migrations(env.MIGRATION_DB, [automaticPreregistration]);
```

Assert the converted row, audit, absence of remaining rows, and foreign keys:

```ts
expect(
  await env.MIGRATION_DB.prepare(
    `SELECT status, revision, updated_at <> '2026-05-01T00:00:00.000Z' AS changed
     FROM projects WHERE id = 'legacy-preparing'`,
  ).first(),
).toEqual({ status: "PRE_REGISTRATION", revision: 6, changed: 1 });

expect(
  await env.MIGRATION_DB.prepare(
    `SELECT actor_user_id, action, entity_type, entity_id,
            json_extract(details_json, '$.fromStatus') AS from_status,
            json_extract(details_json, '$.toStatus') AS to_status
     FROM audit_logs
     WHERE action = 'PROJECT_AUTO_PREREGISTERED'
       AND entity_id = 'legacy-preparing'`,
  ).first(),
).toEqual({
  actor_user_id: null,
  action: "PROJECT_AUTO_PREREGISTERED",
  entity_type: "PROJECT",
  entity_id: "legacy-preparing",
  from_status: "PREPARING",
  to_status: "PRE_REGISTRATION",
});

expect(
  await env.MIGRATION_DB.prepare(
    "SELECT COUNT(*) AS count FROM projects WHERE status = 'PREPARING'",
  ).first(),
).toEqual({ count: 0 });
expect(
  (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
).toEqual([]);
```

- [ ] **Step 2: Run the migration test to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/project-migration.integration.test.ts
```

Expected: FAIL because migration 0004 does not exist or `automaticPreregistration` is undefined.

- [ ] **Step 3: Add the append-only migration**

Create `0004_automatic_project_preregistration.sql`:

```sql
PRAGMA foreign_keys = ON;

INSERT INTO audit_logs
  (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
SELECT
  'migration-0004-auto-preregistration:' || id,
  NULL,
  'PROJECT_AUTO_PREREGISTERED',
  'PROJECT',
  id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  json_object(
    'fromStatus', 'PREPARING',
    'toStatus', 'PRE_REGISTRATION'
  )
FROM projects
WHERE status = 'PREPARING';

UPDATE projects
SET status = 'PRE_REGISTRATION',
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'PREPARING';

PRAGMA foreign_key_check;
```

- [ ] **Step 4: Run the migration test to verify GREEN**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/project-migration.integration.test.ts
```

Expected: PASS, including the migration row, revision, audit, and foreign-key assertions.

- [ ] **Step 5: Commit the migration**

```bash
git add apps/worker/migrations/0004_automatic_project_preregistration.sql \
  apps/worker/test/project-migration.integration.test.ts
git commit -m "feat: migrate projects to automatic preregistration"
```

---

### Task 2: Make Pre-Registration the Runtime Initial State

**Files:**
- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `packages/domain/src/project-lifecycle.ts`
- Modify: `packages/domain/test/project-lifecycle.test.ts`
- Modify: `apps/worker/src/services/projects.ts`
- Modify: `apps/worker/src/db/organizations.ts`
- Modify: `apps/worker/test/projects.integration.test.ts`
- Modify: `apps/worker/test/schema.integration.test.ts`

**Interfaces:**
- Consumes: migration 0004 guarantees no persisted `PREPARING` row after deployment.
- Produces: `ProjectStatus = "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED"` and creation responses whose status is always `PRE_REGISTRATION`.

- [ ] **Step 1: Write contract and domain tests for the three-state runtime**

Change the contract expectation to:

```ts
expect(ProjectStatusSchema.options).toEqual([
  "PRE_REGISTRATION",
  "IN_PROGRESS",
  "CLOSED",
]);
```

Replace the lifecycle table with:

```ts
it.each([
  ["PRE_REGISTRATION", "IN_PROGRESS"],
  ["IN_PROGRESS", "CLOSED"],
  ["CLOSED", "IN_PROGRESS"],
] as const)("allows OPERATOR %s -> %s", (current, target) => {
  expect(transitionProject(current, target, "OPERATOR")).toBe(target);
});

it("rejects skipped and organization-manager transitions", () => {
  expect(() =>
    transitionProject("PRE_REGISTRATION", "CLOSED", "OPERATOR"),
  ).toThrow("INVALID_TRANSITION");
  expect(() =>
    transitionProject(
      "PRE_REGISTRATION",
      "IN_PROGRESS",
      "ORGANIZATION_MANAGER",
    ),
  ).toThrow("FORBIDDEN");
});
```

In the Worker project creation test, expect:

```ts
expect(await first.json()).toMatchObject({
  ...body,
  status: "PRE_REGISTRATION",
  createdBy: operator.userId,
  closedBy: null,
});
```

Add a request-level rejection proving the public status schema no longer accepts `PREPARING`:

```ts
const invalid = await authedRequest(
  operator,
  `/api/v1/projects/${project.id}/transition`,
  {
    method: "POST",
    body: JSON.stringify({
      targetStatus: "PREPARING",
      expectedRevision: project.revision,
    }),
  },
);
expect(invalid.status).toBe(422);
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/domain exec \
  vitest run test/project-lifecycle.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/projects.integration.test.ts
```

Expected: FAIL because contracts and creation still expose `PREPARING`.

- [ ] **Step 3: Narrow the contract and transition graph**

Change the public status schema:

```ts
export const ProjectStatusSchema = z.enum([
  "PRE_REGISTRATION",
  "IN_PROGRESS",
  "CLOSED",
]);
```

Apply the same three-value union to
`packages/contracts/src/organizations.ts` and
`apps/worker/src/db/organizations.ts`.

Replace the domain transition map:

```ts
const FORWARD: Readonly<Record<ProjectStatus, ProjectStatus | null>> = {
  PRE_REGISTRATION: "IN_PROGRESS",
  IN_PROGRESS: "CLOSED",
  CLOSED: null,
};
```

- [ ] **Step 4: Create projects directly in pre-registration**

Change the SQL literal in `createProject`:

```ts
`INSERT INTO projects
 (id, name, start_date, end_date, status, revision, created_by,
  created_at, updated_at, closed_at, closed_by, close_reason)
 VALUES (?, ?, ?, ?, 'PRE_REGISTRATION', 0, ?, ?, ?, NULL, NULL, NULL)`
```

Do not change the `PRE_REGISTRATION → IN_PROGRESS` snapshot block in
`changeProjectStatus`.

- [ ] **Step 5: Update runtime tests and schema assertions**

In `projects.integration.test.ts`, remove the now-invalid first transition:

```ts
let closing = await seedProject(operator, { name: "종료 대상" });
closing = await transition(operator, closing, "IN_PROGRESS");
const closed = await transition(operator, closing, "CLOSED");
```

Likewise, in the snapshot test use:

```ts
const pre = await seedProject(operator);
const active = await transition(operator, pre, "IN_PROGRESS");
```

Update `schema.integration.test.ts` so the fresh migrated database still
asserts that the physical CHECK SQL contains `PREPARING` for compatibility,
while public contract tests prove it is not a runtime value:

```ts
expect(projectTable?.sql).toContain(
  "'PREPARING', 'PRE_REGISTRATION', 'IN_PROGRESS', 'CLOSED'",
);
```

- [ ] **Step 6: Run contracts, domain, and Worker tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts test
corepack pnpm@10.28.1 --filter @event-roster/domain test
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/projects.integration.test.ts test/schema.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker check
```

Expected: PASS. Creation is `PRE_REGISTRATION`; snapshot, close, reopen, and
physical compatibility constraint tests remain green.

- [ ] **Step 7: Commit the runtime lifecycle**

```bash
git add packages/contracts/src/projects.ts \
  packages/contracts/src/organizations.ts \
  packages/contracts/test/contracts.test.ts \
  packages/domain/src/project-lifecycle.ts \
  packages/domain/test/project-lifecycle.test.ts \
  apps/worker/src/services/projects.ts \
  apps/worker/src/db/organizations.ts \
  apps/worker/test/projects.integration.test.ts \
  apps/worker/test/schema.integration.test.ts
git commit -m "feat: create projects in preregistration"
```

---

### Task 3: Simplify Web Actions and Test Fixtures

**Files:**
- Modify: `apps/web/src/features/projects/ProjectCard.tsx`
- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Modify: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Modify: `apps/web/src/features/projects/projects.test.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/e2e/global-setup.ts`
- Modify: `apps/web/e2e/import-export.spec.ts`
- Modify: `apps/worker/test/support/roster.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`
- Modify: `apps/worker/test/projects.integration.test.ts`

**Interfaces:**
- Consumes: the three-value `ProjectStatus` contract from Task 2.
- Produces: project creation immediately renders `사전 등록`, and the first available lifecycle action is `진행 시작`.

- [ ] **Step 1: Change Web expectations before implementation**

In project list tests, assert:

```ts
expect(await screen.findByText("사전 등록")).toBeVisible();
expect(screen.queryByText("준비 중")).not.toBeInTheDocument();
```

In project detail tests, assert the initial header and action:

```ts
expect(await screen.findByText("사전 등록")).toBeVisible();
expect(
  screen.getByRole("button", { name: "진행 시작" }),
).toBeEnabled();
expect(
  screen.queryByRole("button", { name: "사전 등록 시작" }),
).not.toBeInTheDocument();
```

Delete fixtures that construct `status: "PREPARING"` and replace them with
`status: "PRE_REGISTRATION"`.

- [ ] **Step 2: Run focused Web tests to verify RED or compile failure**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/projects.test.tsx \
  src/features/projects/project-detail.test.tsx \
  src/app/App.test.tsx
```

Expected: FAIL because UI records and fixtures still contain `PREPARING`.

- [ ] **Step 3: Remove preparing labels and actions**

Use only three statuses:

```ts
const STATUS_LABEL: Record<ProjectStatus, string> = {
  PRE_REGISTRATION: "사전 등록",
  IN_PROGRESS: "진행 중",
  CLOSED: "종료",
};
```

Use only these detail actions:

```ts
const NEXT_ACTION: Record<
  ProjectStatus,
  { target: ProjectStatus; label: string }
> = {
  PRE_REGISTRATION: { target: "IN_PROGRESS", label: "진행 시작" },
  IN_PROGRESS: { target: "CLOSED", label: "프로젝트 종료" },
  CLOSED: { target: "IN_PROGRESS", label: "프로젝트 재개" },
};
```

Simplify roster mutation eligibility without a preparing exclusion:

```ts
const canMutateRoster =
  project.status !== "CLOSED" &&
  (operator ||
    (project.status === "PRE_REGISTRATION" &&
      memberships.some(
        (membership) => membership.isActive && membership.masterIsActive,
      )));
```

Apply the three-value label record to `OrganizationDetailPage.tsx`.

- [ ] **Step 4: Remove obsolete setup transitions**

In `apps/worker/test/support/roster.ts`, return the created project directly
instead of POSTing `targetStatus: "PRE_REGISTRATION"`.

Remove only the setup calls whose target is `PRE_REGISTRATION` from:

```text
apps/worker/test/roster.integration.test.ts
apps/web/e2e/global-setup.ts
apps/web/e2e/import-export.spec.ts
```

Keep roster row sources named `PRE_REGISTRATION`; those describe when a row
was registered, not a removed project state.

- [ ] **Step 5: Run focused Worker, Web, and E2E tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/projects.integration.test.ts \
  test/roster.integration.test.ts \
  test/imports.integration.test.ts \
  test/summary.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/projects.test.tsx \
  src/features/projects/project-detail.test.tsx \
  src/app/App.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-roster.spec.ts e2e/import-export.spec.ts
```

Expected: PASS. The E2E setup creates immediately usable projects, `진행 시작`
still freezes expected counts, and imports remain pre-registration-only.

- [ ] **Step 6: Commit the Web and fixture simplification**

```bash
git add apps/web/src/features/projects/ProjectCard.tsx \
  apps/web/src/features/projects/ProjectDetailPage.tsx \
  apps/web/src/features/admin/OrganizationDetailPage.tsx \
  apps/web/src/features/projects/projects.test.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/app/App.test.tsx \
  apps/web/e2e/global-setup.ts \
  apps/web/e2e/import-export.spec.ts \
  apps/worker/test/support/roster.ts \
  apps/worker/test/roster.integration.test.ts \
  apps/worker/test/projects.integration.test.ts
git commit -m "refactor: remove preparing project workflow"
```

---

### Task 4: Document the Production Migration Gate

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/recovery.md`

**Interfaces:**
- Consumes: migration `0004_automatic_project_preregistration.sql`.
- Produces: an executable production checklist for backup, row counts, migration application, post-checks, and rollback isolation.

- [ ] **Step 1: Add an automatic-preregistration migration section**

Add this exact operational sequence before the generic repeated-release
migration command:

```bash
release_backup_dir="$(mktemp -d /private/tmp/event-roster-d1-0004.XXXXXX)"
chmod 700 "$release_backup_dir"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$release_backup_dir/event-roster-before-0004.sql"
chmod 600 "$release_backup_dir/event-roster-before-0004.sql"
shasum -a 256 "$release_backup_dir/event-roster-before-0004.sql" \
  > "$release_backup_dir/event-roster-before-0004.sql.sha256"
chmod 600 "$release_backup_dir/event-roster-before-0004.sql.sha256"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS audit_count FROM audit_logs WHERE action='PROJECT_AUTO_PREREGISTERED'"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

Document that the post-migration `preparing_count` must be zero, the audit
count must increase by the pre-migration preparing count, and foreign-key
check must return no rows.

- [ ] **Step 2: Update architecture and recovery semantics**

Change the architecture lifecycle statement to:

```text
프로젝트는 생성 즉시 PRE_REGISTRATION이며
PRE_REGISTRATION → IN_PROGRESS → CLOSED 상태와 revision을 가진다.
종료된 프로젝트는 유효한 미래/미정 종료일로 수정한 뒤 IN_PROGRESS로 재개한다.
```

In recovery documentation, state that restoring the pre-0004 export must use
an isolated replacement D1 database and the same application migrations;
never reverse rows in the production D1 by hand.

- [ ] **Step 3: Verify documentation commands and forbidden claims**

Run:

```bash
rg -n "PROJECT_AUTO_PREREGISTERED|preparing_count|foreign_key_check|d1 export" \
  docs/operations/deployment.md docs/operations/recovery.md
rg -n "PRE_REGISTRATION → IN_PROGRESS → CLOSED" docs/architecture.md
test "$(rg -c "프로젝트는 생성 즉시 PRE_REGISTRATION" docs/architecture.md)" -eq 1
```

Expected: every command and invariant appears exactly in the intended
operations or architecture document.

- [ ] **Step 4: Commit the operational documentation**

```bash
git add docs/architecture.md docs/operations/deployment.md \
  docs/operations/recovery.md
git commit -m "docs: document automatic preregistration migration"
```

---

### Task 5: Verify the Complete Lifecycle Change

**Files:**
- Verify only; modify the owning task and amend its commit if a check exposes a defect.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: release evidence for a later explicitly authorized production migration and deployment.

- [ ] **Step 1: Confirm no runtime preparing workflow remains**

Run:

```bash
test -z "$(rg -n 'PREPARING|사전 등록 시작|준비 중' \
  packages/contracts/src packages/domain/src apps/worker/src apps/web/src \
  apps/web/e2e --glob '!**/*.test.*' || true)"
```

Expected: exit 0. `PREPARING` may remain only in migration SQL, migration
tests, schema compatibility assertions, and operations documentation.

- [ ] **Step 2: Run format and static checks**

```bash
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 check
```

Expected: both exit 0.

- [ ] **Step 3: Run the complete test suite**

```bash
corepack pnpm@10.28.1 test
```

Expected: every workspace suite passes. Missing optional bcrypt capability
probe secrets may print the existing warnings but must not fail tests.

- [ ] **Step 4: Build and run Chromium E2E**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test
```

Expected: production build and all Chromium scenarios pass.

- [ ] **Step 5: Verify the Worker bundle and migrations without mutating production**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations list event-roster --local
git diff --check
```

Expected: dry-run exit 0, local migration list is consistent, and no
whitespace errors exist. Do not apply migration 0004 remotely in this task.

- [ ] **Step 6: Inspect the final worktree**

Run:

```bash
git status --short
git diff --stat
```

Expected: no tracked changes remain. If verification exposed a defect or
formatting drift, return it to the task that owns the affected file, rerun
that task's focused verification, and amend that task's commit. Do not create
an empty or catch-all verification commit.
