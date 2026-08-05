# Closed Project History Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let non-bootstrap operators correct organizations and attendance history on a closed project without reopening it, changing expected-count snapshots, or rewriting participant and organization master history.

**Architecture:** Keep ordinary project mutation APIs closed to `CLOSED` projects and add a dedicated `/history-corrections` API surface backed by a focused service. Every correction runs in one guarded D1 batch that requires a non-deleted `CLOSED` project, the expected project revision, and a non-bootstrap operator; it updates only project membership/roster history, increments the project revision, and appends a correction-specific audit record. React reuses the existing organization, participant, roster, and import components behind an explicit local correction mode and switches only their request paths and candidate rules.

**Tech Stack:** TypeScript 5.9, React 19, Hono, Zod, Cloudflare Workers, D1/SQLite, Vitest, Testing Library, Playwright, pnpm 10.28.1, Biome.

## Global Constraints

- Use `corepack pnpm@10.28.1`; do not change the locked package manager or add dependencies.
- Do not add a project status or D1 migration. `CLOSED` and all existing close metadata stay unchanged.
- Do not weaken the ordinary organization, roster, participant, bulk, or import APIs. They must still return `PROJECT_CLOSED` for closed projects.
- Only a non-bootstrap `OPERATOR` may call correction reads and writes. Organization managers stay read-only, and a correction link never grants them current scope.
- All correction writes must use `runGuardedAtomic` with `createOperatorGuard`, require `projects.deleted_at IS NULL`, `projects.status = 'CLOSED'`, and the expected project revision, and update data + project revision + audit in the same batch.
- Closed-project additions use `source = 'IN_PROGRESS'`, `status = 'ACTIVE'`, and `was_expected_at_start = 0`. Never insert, update, or delete `project_expected_snapshots`.
- Existing-participant correction never updates `participants`; it writes the confirmed values to `project_roster_entries` snapshots only. New participants still receive a master row and stable `P-...` identifier for FK integrity.
- A correction may reference active, inactive, or deleted organization masters. It must never rename, reactivate, restore, or otherwise mutate the organization master.
- Excluding an organization in correction mode always keeps its `project_organizations` row with `is_active = 0`; re-adding reactivates the same row.
- Excel files remain browser-local. Validation and commit use normalized rows only, and commit remains all-or-nothing.
- Preserve user-owned untracked files such as `.DS_Store` and `.pnpm-store/`.
- Follow TDD for every behavior: add a failing focused test, run it and observe RED, add the minimum implementation, rerun GREEN, then commit.

---

## File Structure

### Contracts

- Create `packages/contracts/src/history-corrections.ts` for correction candidate responses and the combined roster snapshot/status patch schema.
- Modify `packages/contracts/src/index.ts` to export the new contract module.
- Modify `packages/contracts/test/contracts.test.ts` for strict parsing, role/grade pairing, and required mutation fields.

### Worker API and service

- Create `apps/worker/src/routes/history-corrections.ts` for correction candidates, organization mutations, roster single/bulk mutations, and import validation/commit.
- Create `apps/worker/src/services/history-corrections.ts` for the closed-project guard, organization membership correction, roster snapshot correction, and candidate reads.
- Modify `apps/worker/src/services/imports.ts` to share resolution/statement construction through an explicit ordinary-vs-correction policy without changing ordinary import behavior.
- Modify `apps/worker/src/app.ts` to register the correction routes.
- Create `apps/worker/test/history-corrections.integration.test.ts` for authorization, state, history isolation, summary, audit, concurrency, and rollback behavior.
- Modify `apps/worker/test/imports.integration.test.ts` for closed-correction Excel validation and atomic commit.
- Keep existing `project-organizations.integration.test.ts`, `roster.integration.test.ts`, and `participants.integration.test.ts` as regression coverage for ordinary closed-project rejection.

### Web

- Modify `apps/web/src/features/projects/ProjectDetailPage.tsx` to own the local correction mode, banner, refresh/error transitions, and child request mode.
- Modify `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx` to switch mutation endpoints and permit inactive/deleted history candidates only in correction mode.
- Modify `apps/web/src/features/roster/ProjectRosterPage.tsx` to switch single/bulk/snapshot/status endpoints and expose correction import navigation.
- Modify `apps/web/src/features/roster/RosterTable.tsx` only if its row gating needs a correction-mode override; retain deleted/inactive badges.
- Modify `apps/web/src/features/roster/ParticipantDialog.tsx` and `ParticipantEditDialog.tsx` only to accept the wider correction candidate set and preserve existing validation.
- Modify `apps/web/src/app/AppShell.tsx` and `apps/web/src/features/imports/ImportWizard.tsx` to carry `mode=history-correction` and use correction endpoints/candidate rules.
- Modify `apps/web/src/features/roster/AuditPanel.tsx` to label the three correction audit actions.
- Modify `apps/web/src/styles/global.css` for the correction warning banner and action layout.
- Modify `apps/web/src/features/projects/project-detail.test.tsx`, `apps/web/src/features/roster/roster.test.tsx`, and `apps/web/src/features/imports/imports.test.tsx` for the new UI flows.

### End-to-end and documentation

- Create `apps/web/e2e/closed-project-history-correction.spec.ts` for the operator and organization-manager journeys.
- Modify `docs/architecture.md` to document the separate correction boundary and snapshot ownership.
- Modify `docs/operations/deployment.md` to add correction smoke checks while keeping deployment manual.

---

### Task 1: Define the Correction Contracts

**Files:**
- Create: `packages/contracts/src/history-corrections.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces `ClosedProjectCorrectionCandidateOrganization`, including `isActive` and `isDeleted` independently.
- Produces `ClosedProjectCorrectionCandidateParticipant`, including master revision and latest role/grade suggestions.
- Produces `ClosedProjectRosterPatchRequestSchema`, combining snapshot fields and status under project/entry optimistic concurrency.
- Reuses `AddProjectOrganizationSchema`, `ProjectOrganizationPatchSchema`, `RosterCreateRequestSchema`, `BulkRosterCreateRequestSchema`, and `ImportCommitRequestSchema` unchanged on dedicated routes.

- [ ] **Step 1: Write failing contract tests**

Add parsing/type assertions:

```ts
import {
  ClosedProjectRosterPatchRequestSchema,
  type ClosedProjectCorrectionCandidateOrganization,
} from "../src";

expectTypeOf<ClosedProjectCorrectionCandidateOrganization>().toMatchTypeOf<{
  id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
}>();

expect(
  ClosedProjectRosterPatchRequestSchema.parse({
    name: "당시 이름",
    organizationId: "org-deleted",
    role: "STUDENT",
    grade: "M2",
    expectedProjectRevision: 7,
    expectedEntryRevision: 3,
  }),
).toMatchObject({ name: "당시 이름", grade: "M2" });

expect(() =>
  ClosedProjectRosterPatchRequestSchema.parse({
    expectedProjectRevision: 7,
    expectedEntryRevision: 3,
  }),
).toThrow();

expect(() =>
  ClosedProjectRosterPatchRequestSchema.parse({
    role: "STUDENT",
    expectedProjectRevision: 7,
    expectedEntryRevision: 3,
  }),
).toThrow();
```

Also assert that `status: "CANCELLED"` alone is valid and that `TEACHER` with a non-null grade is rejected.

- [ ] **Step 2: Run the focused contract test and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
```

Expected: FAIL because the correction module is not exported.

- [ ] **Step 3: Implement the strict contract**

Create `history-corrections.ts` with this public shape:

```ts
import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import {
  type ParticipantRole,
  ParticipantRoleSchema,
  RosterParticipantProfileSchema,
  RosterStatusSchema,
  type StudentGrade,
  StudentGradeSchema,
} from "./roster";

export interface ClosedProjectCorrectionCandidateOrganization {
  id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
}

export interface ClosedProjectCorrectionCandidateParticipant {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
  suggestedRole: ParticipantRole | null;
  suggestedGrade: StudentGrade | null;
}

export const ClosedProjectRosterPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    organizationId: OrganizationIdSchema.optional(),
    role: ParticipantRoleSchema.optional(),
    grade: StudentGradeSchema.nullable().optional(),
    status: RosterStatusSchema.optional(),
    expectedProjectRevision: z.number().int().nonnegative(),
    expectedEntryRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) =>
    value.name !== undefined || value.organizationId !== undefined ||
    value.role !== undefined || value.grade !== undefined ||
    value.status !== undefined,
  )
  .superRefine((value, context) => {
    const rolePresent = value.role !== undefined;
    const gradePresent = value.grade !== undefined;
    if (rolePresent !== gradePresent) {
      context.addIssue({
        code: "custom",
        path: rolePresent ? ["grade"] : ["role"],
        message: "참가자 구분과 학년을 함께 전송해 주세요.",
      });
      return;
    }
    if (!rolePresent || !gradePresent) return;
    const parsed = RosterParticipantProfileSchema.safeParse({
      role: value.role,
      grade: value.grade,
    });
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });
```

Use `RosterParticipantProfileSchema.safeParse` inside `superRefine`; do not duplicate the student/teacher validation messages. Remove the unused schema imports if TypeScript flags them. Export the module from `index.ts`.

- [ ] **Step 4: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec \
  vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
git add packages/contracts/src/history-corrections.ts \
  packages/contracts/src/index.ts packages/contracts/test/contracts.test.ts
git commit -m "feat: define closed history correction contracts"
```

Expected: both commands exit 0.

---

### Task 2: Add the Closed-Project Guard and Candidate Reads

**Files:**
- Create: `apps/worker/src/services/history-corrections.ts`
- Create: `apps/worker/src/routes/history-corrections.ts`
- Modify: `apps/worker/src/app.ts`
- Test: `apps/worker/test/history-corrections.integration.test.ts`

**Endpoints:**
- `GET /api/v1/projects/:projectId/history-corrections/candidates`
- Response: `{ organizations, participants }` using the Task 1 candidate types.

- [ ] **Step 1: Write failing authorization and candidate-read tests**

Seed a closed, non-deleted project; active, inactive, and deleted organizations; participants in each; an organization manager; a bootstrap actor; and an administrative operator. Assert:

```ts
const response = await authedRequest(
  operator,
  `/api/v1/projects/${project.id}/history-corrections/candidates`,
);
expect(response.status).toBe(200);
expect(await response.json()).toMatchObject({
  organizations: [
    { id: "org-active", isActive: true, isDeleted: false },
    { id: "org-inactive", isActive: false, isDeleted: false },
    { id: "org-deleted", isActive: false, isDeleted: true },
  ],
});
```

Assert 403 for organization manager and bootstrap, 401 without authentication, 409 `INVALID_TRANSITION` for a non-closed project, and 404 for a deleted project. Assert the manager's normal project visibility/organization scopes are unchanged after this read.

- [ ] **Step 2: Run the focused Worker test and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/history-corrections.integration.test.ts
```

Expected: FAIL with 404 because the route does not exist.

- [ ] **Step 3: Implement the service boundary**

In `history-corrections.ts`, add:

```ts
export async function requireClosedCorrectionProject(
  env: Env,
  actor: Actor,
  projectId: string,
) {
  requireAdministrativeOperator(actor);
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status !== "CLOSED") throw new DomainError("INVALID_TRANSITION");
  return project;
}

export function createClosedCorrectionGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  projectId: string,
  expectedProjectRevision: number,
  operationPredicate = "1 = 1",
  operationBindings: unknown[] = [],
) {
  return createOperatorGuard(
    db,
    guardId,
    actor,
    `EXISTS (
       SELECT 1 FROM projects
       WHERE id = ? AND status = 'CLOSED' AND revision = ?
         AND deleted_at IS NULL
     ) AND (${operationPredicate})`,
    [projectId, expectedProjectRevision, ...operationBindings],
  );
}
```

`findProject` already hides deleted projects; verify that invariant in the test instead of adding a second source of project-deletion policy. Candidate SQL must include all organization master states and all participant masters, plus latest roster role/grade suggestions, but expose it only after `requireClosedCorrectionProject`. Order by organization name/id and participant name/participant_id for deterministic tests.

- [ ] **Step 4: Add and register the route**

Authenticate with `requireActor`, call `requireFullSession`, and let the service enforce non-bootstrap operator status. Register `historyCorrectionRoutes` under `/api/v1` in `app.ts`. Do not add a general `includeDeleted` participant endpoint.

- [ ] **Step 5: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  vitest run test/history-corrections.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/services/history-corrections.ts \
  apps/worker/src/routes/history-corrections.ts apps/worker/src/app.ts \
  apps/worker/test/history-corrections.integration.test.ts
git commit -m "feat: add closed correction access boundary"
```

---

### Task 3: Implement Closed Organization Membership Correction

**Files:**
- Modify: `apps/worker/src/services/history-corrections.ts`
- Modify: `apps/worker/src/routes/history-corrections.ts`
- Test: `apps/worker/test/history-corrections.integration.test.ts`
- Regression test: `apps/worker/test/project-organizations.integration.test.ts`

**Endpoints:**
- `POST /api/v1/projects/:projectId/history-corrections/organizations`
- `PATCH /api/v1/projects/:projectId/history-corrections/organizations/:organizationId`
- Bodies reuse `AddProjectOrganizationSchema` and `ProjectOrganizationPatchSchema`.

- [ ] **Step 1: Write failing membership correction tests**

Cover these cases in separate tests:

- Link active, inactive, and deleted existing organizations to a closed project.
- Create and link a genuinely new organization while the project remains closed.
- Exclude an empty organization and verify the `project_organizations` row remains with `is_active = 0`.
- Re-add it and verify the same composite-key row is reactivated.
- Confirm organization master `name`, `is_active`, `deleted_at`, and `revision`-equivalent state do not change.
- Confirm project status, `closed_at`, `closed_by`, and `close_reason` do not change while project revision increments once.
- Confirm audit action `CLOSED_PROJECT_ORGANIZATION_CORRECTED`, with `details.operation` equal to `ADDED`, `CREATED_AND_ADDED`, `EXCLUDED`, or `REACTIVATED`, and serialized `before`/`after` membership values.
- Confirm a linked inactive/deleted organization does not make the project visible or writable to its organization manager.
- Race two requests with the same expected revision and assert exactly one succeeds.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/history-corrections.integration.test.ts \
  test/project-organizations.integration.test.ts
```

Expected: new endpoint assertions fail; ordinary closed-project rejection remains green.

- [ ] **Step 3: Implement guarded add/reactivate/create**

Implement `correctClosedProjectOrganization`. Resolve canonical-name conflicts before batching just as the ordinary service does. For an existing organization, permit any master lifecycle state as long as the row exists. For a new organization, insert the master as active, then insert the membership. Use:

```sql
INSERT INTO project_organizations
  (project_id, organization_id, is_active, added_at, deactivated_at,
   added_by, updated_by)
VALUES (?, ?, 1, ?, NULL, ?, ?)
ON CONFLICT(project_id, organization_id) DO UPDATE SET
  is_active = 1,
  deactivated_at = NULL,
  updated_by = excluded.updated_by
```

The operation predicate must reject an already-active membership and, for a new organization, recheck canonical-name absence. Increment `projects.revision` with an expected-revision predicate. Insert exactly one correction audit per request; include `projectId`, `organizationId`, `operation`, `before`, and `after` in `details_json`. An additional `ORGANIZATION_CREATED` audit is acceptable for a new master, but the correction audit is mandatory.

- [ ] **Step 4: Implement guarded soft exclusion**

Never reuse the ordinary service's delete-without-history branch. Always execute:

```sql
UPDATE project_organizations
SET is_active = 0, deactivated_at = ?, updated_by = ?
WHERE project_id = ? AND organization_id = ? AND is_active = 1
```

Guard the current active membership and closed-project revision. Return `ProjectOrganizationMutationResult` using `findProjectOrganization` after the batch.

- [ ] **Step 5: Wire routes and verify CSRF/origin**

Both mutation routes must call `assertExactOrigin`, `requireActor`, `requireCsrf`, and `requireAdministrativeOperator` before parsing. Return 201 only when a new master or new membership row is created; return 200 for reactivation and patch.

- [ ] **Step 6: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/history-corrections.integration.test.ts \
  test/project-organizations.integration.test.ts
git add apps/worker/src/services/history-corrections.ts \
  apps/worker/src/routes/history-corrections.ts \
  apps/worker/test/history-corrections.integration.test.ts \
  apps/worker/test/project-organizations.integration.test.ts
git commit -m "feat: correct closed project organizations"
```

---

### Task 4: Implement Manual and Bulk Closed Roster Correction

**Files:**
- Modify: `apps/worker/src/services/history-corrections.ts`
- Modify: `apps/worker/src/routes/history-corrections.ts`
- Test: `apps/worker/test/history-corrections.integration.test.ts`
- Regression tests: `apps/worker/test/roster.integration.test.ts`
- Regression tests: `apps/worker/test/participants.integration.test.ts`

**Endpoints:**
- `POST /api/v1/projects/:projectId/history-corrections/roster`
- `POST /api/v1/projects/:projectId/history-corrections/roster/bulk`
- `PATCH /api/v1/projects/:projectId/history-corrections/roster/:entryId`

- [ ] **Step 1: Write failing single-entry and snapshot-isolation tests**

Assert that adding an existing participant:

- uses the confirmed name/organization/role/grade in the roster snapshot;
- stores `IN_PROGRESS`, `ACTIVE`, and `wasExpectedAtStart = false`;
- leaves the participant master row byte-for-byte unchanged;
- leaves another project's roster snapshot unchanged;
- works when the target project membership/master organization is inactive or deleted;
- increments actual/in-progress-added/delta while expected remains exactly the pre-correction value.

Assert that adding a new participant creates one `participants` row, one roster row, and a stable `P-...` number in the same successful operation. Assert rollback leaves neither row if audit insertion or the guard fails.

- [ ] **Step 2: Write failing patch tests**

Patch name, organization, role/grade, status cancellation, and status restoration. Assert only `project_roster_entries` snapshot/status fields and its revision change; `participants`, expected snapshots, other projects, and close metadata remain unchanged. Assert the target organization only needs to exist, not be active or undeleted.

Audit assertions must use `CLOSED_PROJECT_ROSTER_CORRECTED` and include:

```ts
{
  projectId,
  organizationId,
  operation: "ADDED" | "CREATED_AND_ADDED" | "UPDATED" |
    "CANCELLED" | "RESTORED",
  before: null | { name, organizationId, role, grade, status },
  after: { name, organizationId, role, grade, status },
}
```

- [ ] **Step 3: Write failing bulk tests**

Reuse the existing 1-30 row input and duplicate-confirmation behavior. Assert all rows receive `IN_PROGRESS`/`ACTIVE`/false, all are actual attendance, and a duplicate/stale/audit failure leaves no participants, roster rows, project revision increment, or correction audits.

- [ ] **Step 4: Run focused tests and confirm RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/history-corrections.integration.test.ts \
  test/roster.integration.test.ts test/participants.integration.test.ts
```

- [ ] **Step 5: Implement single existing/new add**

Parse the existing `RosterCreateRequestSchema` on the dedicated route. For existing participants, validate the participant revision and confirmed snapshot in the guard but do not update `participants`. Insert/upsert only the roster row. A cancelled existing roster row may be restored, but preserve `was_expected_at_start`; a brand-new row always sets it to 0 and source to `IN_PROGRESS`.

For new participants, insert the participant master and roster snapshot in the same batch. Permit organization master lifecycle states, but require an existing active project membership for the target organization; operators must connect/reactivate the organization first so the history remains navigable.

- [ ] **Step 6: Implement snapshot/status patch**

Read the roster row by ID, merge optional fields with current snapshot values, validate the resulting role/grade pair, resolve the target organization name for `organization_name_snapshot`, and run:

```sql
UPDATE project_roster_entries
SET participant_name_snapshot = ?, organization_id = ?,
    organization_name_snapshot = ?, participant_role_snapshot = ?,
    student_grade_snapshot = ?, status = ?,
    revision = revision + 1, updated_by = ?, updated_at = ?
WHERE id = ? AND project_id = ? AND revision = ?
```

Do not update `source` or `was_expected_at_start` while editing an existing row. Reject a no-op after merging fields so empty correction audits are not created.

- [ ] **Step 7: Implement bulk add with shared statement helpers**

Extract only mechanical chunk/insert/audit helpers from `bulk-participants.ts` if reuse keeps ordinary behavior identical. Otherwise implement correction-specific helpers in `history-corrections.ts`. Correction guards differ materially: closed state, operator-only, organization existence/membership, and no master active/deleted requirement. Emit one `CLOSED_PROJECT_ROSTER_CORRECTED` audit per added roster row with a shared `batchId`.

- [ ] **Step 8: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/history-corrections.integration.test.ts \
  test/roster.integration.test.ts test/participants.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/services/history-corrections.ts \
  apps/worker/src/routes/history-corrections.ts \
  apps/worker/test/history-corrections.integration.test.ts \
  apps/worker/test/roster.integration.test.ts \
  apps/worker/test/participants.integration.test.ts
git commit -m "feat: correct closed project roster history"
```

---

### Task 5: Add Closed-Correction Excel Validation and Commit

**Files:**
- Modify: `apps/worker/src/services/imports.ts`
- Modify: `apps/worker/src/services/history-corrections.ts`
- Modify: `apps/worker/src/routes/history-corrections.ts`
- Modify: `apps/worker/test/imports.integration.test.ts`
- Test: `apps/worker/test/history-corrections.integration.test.ts`

**Endpoints:**
- `POST /api/v1/projects/:projectId/history-corrections/imports/validate`
- `POST /api/v1/projects/:projectId/history-corrections/imports/commit`

- [ ] **Step 1: Write failing validation tests**

For a closed project, validate rows against linked active, inactive, and deleted organizations. Return the current project revision and the same row/candidate error shape as ordinary import. Assert ordinary `/imports/validate` still returns `PROJECT_CLOSED`.

- [ ] **Step 2: Write failing atomic commit tests**

Assert all imported entries use `IN_PROGRESS`, `ACTIVE`, false and update actual but not expected. Assert existing participants are not rewritten. Assert exactly one `project_import_runs` row is inserted, and each changed roster row has `CLOSED_PROJECT_ROSTER_IMPORTED` with `batchId`, `projectId`, `organizationId`, role/grade, and before/after. Force a bad final row, stale revision, project reopen race, project deletion race, and audit statement failure; every case must leave the whole batch unchanged.

- [ ] **Step 3: Run RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/imports.integration.test.ts \
  test/history-corrections.integration.test.ts
```

- [ ] **Step 4: Introduce an explicit import policy**

Refactor `imports.ts` around an internal policy instead of branching on project status throughout the SQL:

```ts
interface ImportMutationPolicy {
  mode: "ORDINARY" | "CLOSED_CORRECTION";
  source: "PRE_REGISTRATION" | "IN_PROGRESS";
  auditAction: "ROSTER_IMPORTED" | "CLOSED_PROJECT_ROSTER_IMPORTED";
  allowHistoricalOrganizationMasters: boolean;
}
```

Keep exported ordinary `validateImport`/`commitImport` signatures and default behavior unchanged. Export dedicated `validateClosedCorrectionImport` and `commitClosedCorrectionImport` wrappers. The correction resolver accepts active project memberships regardless of organization-master active/deleted state; both validation and commit require the project membership itself to be active, matching manual correction. Do not let the policy bypass candidate-revision, duplicate, row-count, or chunk binding checks.

- [ ] **Step 5: Wire correction routes and audit metadata**

Use the existing `RowsSchema`/`ImportCommitRequestSchema` validation. Add origin, CSRF, and administrative-operator checks. Insert an import-run record and correction audits in the same batch. Preserve existing query-count/binding-count tests by updating `buildImportQueryPlan` only if the correction metadata adds statements; ordinary counts must remain unchanged.

- [ ] **Step 6: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/imports.integration.test.ts \
  test/history-corrections.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
git add apps/worker/src/services/imports.ts \
  apps/worker/src/services/history-corrections.ts \
  apps/worker/src/routes/history-corrections.ts \
  apps/worker/test/imports.integration.test.ts \
  apps/worker/test/history-corrections.integration.test.ts
git commit -m "feat: import closed project history corrections"
```

---

### Task 6: Add the Operator Correction Mode to Project Detail

**Files:**
- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`
- Modify: `apps/web/src/features/roster/AuditPanel.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`
- Test: `apps/web/src/features/roster/roster.test.tsx`

- [ ] **Step 1: Write failing project-detail mode tests**

Assert:

- only a non-bootstrap operator on a non-deleted `CLOSED` project sees `이력 보정 시작`;
- clicking it shows `종료 후 이력 보정 중`, `예상 인원은 변경되지 않고 실제 참석 인원에 반영됩니다.`, and `이력 보정 종료`;
- organization and roster mutation controls are absent before entry and present during correction;
- project status and transition controls do not change merely by entering/leaving the mode;
- organization managers and bootstrap operators never receive correction controls;
- starting a project transition or deletion disables correction controls.

- [ ] **Step 2: Write failing request-routing and candidate tests**

In `project-detail.test.tsx` and `roster.test.tsx`, assert correction mode loads the dedicated candidate endpoint, displays inactive/deleted organization badges, and sends all organization/roster single/bulk/status/snapshot requests to `/history-corrections/...`. Assert ordinary project states keep the existing paths exactly.

- [ ] **Step 3: Run RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx \
  src/features/roster/roster.test.tsx
```

- [ ] **Step 4: Own correction mode and candidates in `ProjectDetailPage`**

Add local state only:

```ts
const [historyCorrection, setHistoryCorrection] = useState(false);
const correctionActive =
  administrativeOperator && project.status === "CLOSED" && historyCorrection;
```

On entry, request `/projects/:id/history-corrections/candidates` and retain existing detail data until the request resolves. Pass `mutationMode="CLOSED_CORRECTION"`, candidate organizations/participants, and the existing refresh callback to child panels. On exit, clear only the mode/candidate state; do not call a mutation API.

After each successful correction, reload project, memberships, summary, roster, participants/candidates, and audit. If a stale response occurs, preserve open form values, reload data, and show `최신 이력을 불러왔습니다.`. If the refreshed project is reopened or deleted, exit correction mode and render its current read-only state.

- [ ] **Step 5: Route organization mutations by explicit mode**

Replace a boolean-only API decision with:

```ts
type ProjectMutationMode = "ORDINARY" | "CLOSED_CORRECTION";
```

Build the path once in `ProjectOrganizationsPanel`. In correction mode, permit existing candidate organizations regardless of master state, label them `사용 중지` or `삭제됨`, and allow project-link exclusion/reactivation. Do not expose organization-master rename/status/restore controls in this panel.

- [ ] **Step 6: Route roster mutations and preserve row rules**

In correction mode:

- show participant add, edit, cancel, and restore for all roster rows;
- use dedicated single/bulk/patch endpoints;
- permit linked inactive/deleted organizations and correction candidates;
- keep role/grade validation and the 30-person bulk limit;
- preserve the modal's current form state during stale reload;
- link Excel import to `/projects/:id/import?mode=history-correction`.

Keep ordinary `canMutate` and organization-manager row scope unchanged.

- [ ] **Step 7: Label correction audits and style the banner**

Add labels:

```ts
CLOSED_PROJECT_ORGANIZATION_CORRECTED: "종료 후 조직 이력 보정",
CLOSED_PROJECT_ROSTER_CORRECTED: "종료 후 명단 이력 보정",
CLOSED_PROJECT_ROSTER_IMPORTED: "종료 후 엑셀 이력 보정",
```

Use the existing warning/status design tokens for a clearly separated banner; do not introduce a new color system.

- [ ] **Step 8: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/projects/project-detail.test.tsx \
  src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
git add apps/web/src/features/projects/ProjectDetailPage.tsx \
  apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/roster/ProjectRosterPage.tsx \
  apps/web/src/features/roster/RosterTable.tsx \
  apps/web/src/features/roster/ParticipantDialog.tsx \
  apps/web/src/features/roster/ParticipantEditDialog.tsx \
  apps/web/src/features/roster/AuditPanel.tsx \
  apps/web/src/styles/global.css \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/features/roster/roster.test.tsx
git commit -m "feat: add closed project correction mode"
```

---

### Task 7: Route Excel UI Through Correction Mode

**Files:**
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/features/imports/ImportWizard.tsx`
- Test: `apps/web/src/features/imports/imports.test.tsx`

- [ ] **Step 1: Write failing correction-mode import tests**

Render `ImportWizard` with `mode="CLOSED_CORRECTION"`. Assert it:

- shows the correction warning and actual-not-expected notice;
- lists linked inactive/deleted organizations with status labels;
- posts validation and commit to correction endpoints;
- returns to `/projects/:id` without changing project state;
- preserves normalized rows/candidate resolution on stale revision and requires revalidation;
- treats `INVALID_TRANSITION`/404 as project state change, clears correction mode, and offers `최신 프로젝트 보기`;
- leaves ordinary import behavior and endpoints unchanged.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/imports/imports.test.tsx
```

- [ ] **Step 3: Parse and pass the explicit URL mode**

In `AppShell`, accept only the exact query value:

```tsx
const importMode =
  url.searchParams.get("mode") === "history-correction"
    ? "CLOSED_CORRECTION"
    : "ORDINARY";
<ImportWizard projectId={id} mode={importMode} />;
```

The correction route remains operator-only through the existing AppShell operator gate and Worker authorization.

- [ ] **Step 4: Switch import endpoints and organization display**

Give `ImportWizard` a defaulted `mode` prop so existing tests/callers remain ordinary. Derive one base path for validate/commit. In correction mode, display all linked organizations and their master/membership state, but server validation remains authoritative. Keep file reading, SheetJS parsing, normalization, and file clearing entirely client-side.

On stale revision, keep `parsed`, `sheetName`, `columns`, and `normalizedRows`; clear only `validation`, show the stale message, and require server validation again. On reopened/deleted state, discard the correction workflow and return to current project detail.

- [ ] **Step 5: Run GREEN and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/features/imports/imports.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
git add apps/web/src/app/AppShell.tsx \
  apps/web/src/features/imports/ImportWizard.tsx \
  apps/web/src/features/imports/imports.test.tsx
git commit -m "feat: add closed correction excel workflow"
```

---

### Task 8: Add End-to-End Coverage, Documentation, and Full Verification

**Files:**
- Create: `apps/web/e2e/closed-project-history-correction.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/operations/deployment.md`

- [ ] **Step 1: Write the failing operator E2E scenario**

Use existing E2E support helpers to:

1. create a project and capture a nonzero expected snapshot;
2. close the project and record close metadata;
3. deactivate or delete an organization master;
4. enter `이력 보정 시작`;
5. connect that organization, add one student and one teacher, edit a snapshot, cancel/restore one row, and import another row;
6. assert the project still shows `종료`, close metadata is unchanged, expected is unchanged, actual/delta changed, and all three correction audit labels appear;
7. leave correction mode and assert mutation controls disappear.

- [ ] **Step 2: Add the organization-manager E2E assertion**

Sign in as a manager assigned to the historically connected organization. Assert the closed project remains read-only and correction controls/API writes are unavailable; do not require the deleted/inactive link to grant new project visibility.

- [ ] **Step 3: Run the focused E2E and confirm RED, then complete selectors/fixtures**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  closed-project-history-correction.spec.ts
```

Expected before completing fixture/selectors: FAIL on the first missing correction interaction. Finish only test support required by this scenario, then rerun until it exits 0.

- [ ] **Step 4: Document the invariant and manual smoke path**

In `docs/architecture.md`, document:

- ordinary APIs reject `CLOSED` while correction APIs require it;
- correction mode is browser-local, not a project status;
- `participants` is the reusable identity master and `project_roster_entries` owns historical display snapshots;
- expected snapshots are immutable during correction;
- inactive/deleted organization links do not grant manager authorization.

In `docs/operations/deployment.md`, add post-deploy smoke checks for operator correction entry/exit, actual-vs-expected, audit labels, organization-manager read-only behavior, and rollback on a deliberately stale revision. State explicitly that there is no migration for this release and retain the existing manual Cloudflare deployment procedure.

- [ ] **Step 5: Run the complete verification suite**

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web run build
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: every command exits 0. If Biome reports only changed files, format those files with the repository's existing Biome command and rerun all five commands. Do not deploy from the feature branch.

- [ ] **Step 6: Review the final diff for the safety boundaries**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
rg -n "status <> 'CLOSED'|PROJECT_CLOSED" \
  apps/worker/src/services/project-organizations.ts \
  apps/worker/src/services/roster.ts \
  apps/worker/src/services/participants.ts \
  apps/worker/src/services/imports.ts
rg -n "project_expected_snapshots" \
  apps/worker/src/services/history-corrections.ts
```

Expected: no whitespace errors; only intended files changed; ordinary closed guards remain; the final `rg` finds no correction write to expected snapshots (a read used by assertions/comments is acceptable only if clearly non-mutating).

- [ ] **Step 7: Commit the E2E and documentation**

```bash
git add apps/web/e2e/closed-project-history-correction.spec.ts \
  docs/architecture.md docs/operations/deployment.md
git commit -m "test: verify closed project history correction"
```

Do not merge, push, or deploy until the user chooses an execution/integration option and the implementation passes the full verification gate.
