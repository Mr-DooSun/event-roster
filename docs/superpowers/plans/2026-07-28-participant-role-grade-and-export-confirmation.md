# Participant Role, Grade, and Export Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트별 참가자 구분·학년을 안전하게 저장하고 최대 30명의 구조화된 일괄 등록, 명단 조회·수정·필터, Excel 가져오기·확인 후 내보내기를 제공한다.

**Architecture:** 참가자 마스터는 고유 ID·이름·조직만 유지하고 `project_roster_entries`에 nullable 역할·학년 스냅샷을 추가한다. 공용 Zod 계약이 신규 쓰기의 유효 조합을 강제하고 D1 trigger가 저장 무결성을 보완하며, Worker의 기존 guarded batch와 revision을 그대로 사용한다. React는 동적 참가자 행 컴포넌트와 독립된 내보내기 확인 대화상자를 사용하고, Excel 가져오기와 요약은 같은 enum·집계 함수를 공유한다.

**Tech Stack:** TypeScript 5.9, Zod 4, Hono 4, Cloudflare Workers/D1, React 19, Vitest 4, Testing Library, SheetJS 0.20.3, Playwright 1.61, pnpm 10.28.1

## Global Constraints

- 참가자 마스터에는 고유 ID, 이름, 현재 소속 조직만 저장한다.
- 역할과 학년은 프로젝트 명단 스냅샷에만 저장하고 과거 프로젝트 값을 이후 참가로 변경하지 않는다.
- 참가자 구분 저장 값은 `STUDENT | TEACHER`, 학생 학년 저장 값은 `M1 | M2 | M3 | H1 | H2 | H3`다.
- 학생은 중1~고3 중 하나의 학년이 필수이고 담당교사는 학년을 갖지 않는다.
- 기존 명단의 역할·학년은 추정하지 않고 `NULL / NULL`로 보존하며 화면에서 `미지정`으로 표시한다.
- 신규 단건·일괄 등록과 Excel 가져오기는 `NULL / NULL`을 만들 수 없다.
- 새 참가자 일괄 등록은 요청당 1~30명이며 전체 성공 또는 전체 실패다.
- 기존 `source`의 화면·Excel 열 이름은 `구분`이 아니라 `등록 시점`이다.
- 요약은 활성 명단의 전체 학생 수와 담당교사 수만 추가하고 학년별 집계는 만들지 않는다.
- Excel 내보내기는 화면 필터를 무시하고 활성·취소 전체 명단을 포함한다.
- Excel 가져오기는 `참가자 구분`과 `학년` 열을 요구하며 이전 형식에서 값을 추정하지 않는다.
- 원본 Excel 파일은 브라우저에서만 읽고 서버에 보관하지 않는다.
- 새 런타임 의존성이나 UI 라이브러리를 추가하지 않는다.
- 모든 구현 단계는 실패 테스트 작성 → 실패 확인 → 최소 구현 → 통과 확인 순서를 지킨다.

---

## File Structure

### Shared contracts and domain

- `packages/contracts/src/roster.ts`: 역할·학년 enum, 신규/기존/일괄 등록 및 명단 응답 계약
- `packages/contracts/src/participants.ts`: 참가자 조회 DTO의 최근 스냅샷 추천값
- `packages/contracts/src/imports.ts`: 역할·학년을 포함한 정규화 Excel 행
- `packages/contracts/src/projects.ts`: 전체·조직별 학생/담당교사 집계
- `packages/contracts/test/contracts.test.ts`: 모든 교차 필드 계약 검증
- `packages/domain/src/import-validation.ts`: Excel 행 역할·학년 검증
- `packages/domain/src/summary.ts`: 활성 명단의 역할별 집계
- `packages/domain/test/import-validation.test.ts`: 가져오기 도메인 검증
- `packages/domain/test/summary.test.ts`: 역할별 집계

### D1 and Worker

- `apps/worker/migrations/0005_roster_participant_profiles.sql`: nullable 스냅샷 열과 유효 조합 trigger
- `apps/worker/test/roster-profile-migration.integration.test.ts`: 기존 데이터 보존과 DB 무결성
- `apps/worker/src/db/roster.ts`: 역할·학년을 포함한 명단 row mapper
- `apps/worker/src/services/bulk-participants.ts`: 구조화된 최대 30명 원자적 생성
- `apps/worker/src/services/participants.ts`: 단건 생성, 명단 스냅샷 수정, 최근 값 추천
- `apps/worker/src/services/roster.ts`: 기존 참가자 추가·복원과 역할별 요약
- `apps/worker/src/services/imports.ts`: 역할·학년 Excel 검증·저장·내보내기
- `apps/worker/test/participants.integration.test.ts`: 단건 생성·수정·추천
- `apps/worker/test/roster.integration.test.ts`: 기존 참가자 추가·복원
- `apps/worker/test/imports.integration.test.ts`: Excel 역할·학년 가져오기
- `apps/worker/test/import-budget.integration.test.ts`: 변경된 D1 binding 예산
- `apps/worker/test/exports.integration.test.ts`: 새 열과 역할별 요약 내보내기
- `apps/worker/test/summary.integration.test.ts`: 권한 범위의 역할별 집계

### Web

- Delete: `apps/web/src/features/roster/BulkParticipantNameField.tsx`
- Delete: `apps/web/src/features/roster/BulkParticipantNameField.test.tsx`
- Create: `apps/web/src/features/roster/BulkParticipantRowsField.tsx`
- Create: `apps/web/src/features/roster/BulkParticipantRowsField.test.tsx`
- Create: `apps/web/src/features/roster/ExportRosterDialog.tsx`
- Create: `apps/web/src/features/roster/ExportRosterDialog.test.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/SummaryCards.tsx`
- Create: `apps/web/src/features/roster/participant-profile-labels.ts`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/features/imports/ColumnMapping.tsx`
- Modify: `apps/web/src/features/imports/ImportWizard.tsx`
- Modify: `apps/web/src/features/imports/ValidationTable.tsx`
- Modify: `apps/web/src/features/imports/imports.test.tsx`
- Modify: `apps/web/src/features/imports/export.test.ts`
- Modify: `apps/web/src/lib/excel/read-workbook.ts`
- Modify: `apps/web/src/lib/excel/read-workbook.test.ts`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/e2e/project-roster.spec.ts`
- Modify: `apps/web/e2e/import-export.spec.ts`

### Operations

- `docs/operations/deployment.md`: `0005` 전용 backup, pending, 검증 gate
- `docs/operations/recovery.md`: `0005` 이전 export의 격리 복원 절차

---

### Task 1: 공용 역할·학년 계약

**Files:**
- Modify: `packages/contracts/src/roster.ts`
- Modify: `packages/contracts/src/participants.ts`
- Modify: `packages/contracts/src/imports.ts`
- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces: `ParticipantRoleSchema`, `StudentGradeSchema`, `RosterParticipantProfileSchema`
- Produces: `RosterParticipantInput = { name: string; role: ParticipantRole; grade: StudentGrade | null }`
- Produces: `RosterRecordProfile = { role: ParticipantRole | null; grade: StudentGrade | null }`
- Produces: `NormalizedImportRow.role`, `NormalizedImportRow.grade`
- Produces: `ProjectSummary.studentTotal`, `ProjectSummary.teacherTotal`, organization-level `studentCount`, `teacherCount`

- [ ] **Step 1: Write failing contract tests**

Add table-driven tests proving valid and invalid combinations and the structured bulk request:

```ts
const validProfiles = [
  { role: "STUDENT", grade: "M1" },
  { role: "STUDENT", grade: "H3" },
  { role: "TEACHER", grade: null },
] as const;
for (const profile of validProfiles) {
  expect(RosterParticipantProfileSchema.safeParse(profile).success).toBe(true);
}
for (const profile of [
  { role: "STUDENT", grade: null },
  { role: "TEACHER", grade: "H1" },
]) {
  expect(RosterParticipantProfileSchema.safeParse(profile).success).toBe(false);
}

expect(
  BulkRosterCreateRequestSchema.parse({
    organizationId: "org-1",
    participants: [
      { name: "학생 1", role: "STUDENT", grade: "M2" },
      { name: "교사 1", role: "TEACHER", grade: null },
    ],
    confirmDuplicateNames: false,
    expectedRevision: 0,
  }).participants,
).toHaveLength(2);
expect(
  BulkRosterCreateRequestSchema.safeParse({
    organizationId: "org-1",
    participants: [],
    confirmDuplicateNames: false,
    expectedRevision: 0,
  }).success,
).toBe(false);
```

Also assert:

```ts
expect(
  NormalizedImportRowSchema.safeParse({
    rowNumber: 2,
    name: "학생 1",
    organizationName: "성룡사",
    role: "STUDENT",
    grade: null,
  }).success,
).toBe(false);

expect(
  ProjectParticipantPatchRequestSchema.safeParse({
    role: "TEACHER",
    grade: null,
    expectedRevision: 1,
    expectedProjectRevision: 2,
  }).success,
).toBe(true);
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec vitest run test/contracts.test.ts
```

Expected: FAIL because the profile schemas and structured fields do not exist.

- [ ] **Step 3: Implement the shared schemas and DTOs**

In `roster.ts`, add:

```ts
export const ParticipantRoleSchema = z.enum(["STUDENT", "TEACHER"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const StudentGradeSchema = z.enum([
  "M1", "M2", "M3", "H1", "H2", "H3",
]);
export type StudentGrade = z.infer<typeof StudentGradeSchema>;

const rosterParticipantProfileFields = {
  role: ParticipantRoleSchema,
  grade: StudentGradeSchema.nullable(),
};

function validateRosterParticipantProfile(
  value: { role: ParticipantRole; grade: StudentGrade | null },
  context: z.RefinementCtx,
) {
  if (value.role === "STUDENT" && value.grade === null) {
    context.addIssue({
      code: "custom",
      path: ["grade"],
      message: "학생은 학년이 필요합니다.",
    });
  }
  if (value.role === "TEACHER" && value.grade !== null) {
    context.addIssue({
      code: "custom",
      path: ["grade"],
      message: "담당교사는 학년을 입력하지 않습니다.",
    });
  }
}

export const RosterParticipantProfileSchema = z
  .object(rosterParticipantProfileFields)
  .strict()
  .superRefine(validateRosterParticipantProfile);

export const RosterParticipantInputSchema = z
  .object({
    name: BulkParticipantNameSchema,
    ...rosterParticipantProfileFields,
  })
  .strict()
  .superRefine(validateRosterParticipantProfile);
```

Replace bulk `names` with `participants`, add `role`/`grade` to both branches
of `RosterCreateRequestSchema`, add nullable `role`/`grade` to roster response
objects, and refine `ProjectParticipantPatchRequestSchema` so `role` and
`grade` are either both present or both absent. In `participants.ts`, extend
the response DTO with nullable `suggestedRole` and `suggestedGrade`. In
`imports.ts`, require a valid profile on every normalized row. In
`projects.ts`, add exact numeric fields:

```ts
studentCount: number;
teacherCount: number;
```

to `ProjectSummaryOrganization`, and:

```ts
studentTotal: number;
teacherTotal: number;
```

to `ProjectSummary`.

Use this patch refinement for the optional edit pair:

```ts
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
  if (rolePresent && gradePresent) {
    const parsed = RosterParticipantProfileSchema.safeParse({
      role: value.role,
      grade: value.grade,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue(issue);
    }
  }
});
```

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/roster.ts packages/contracts/src/participants.ts packages/contracts/src/imports.ts packages/contracts/src/projects.ts packages/contracts/test/contracts.test.ts
git commit -m "feat: define project roster participant profiles"
```

---

### Task 2: D1 스냅샷 migration과 row mapping

**Files:**
- Create: `apps/worker/migrations/0005_roster_participant_profiles.sql`
- Create: `apps/worker/test/roster-profile-migration.integration.test.ts`
- Modify: `apps/worker/src/db/roster.ts`
- Modify: `apps/worker/test/schema.integration.test.ts`

**Interfaces:**
- Consumes: `ParticipantRole`, `StudentGrade`
- Produces: `RosterRecord.role: ParticipantRole | null`
- Produces: `RosterRecord.grade: StudentGrade | null`
- Produces: D1 columns `participant_role_snapshot`, `student_grade_snapshot`

- [ ] **Step 1: Write failing migration and mapper tests**

Test applying migrations `0001` through `0004`, inserting a legacy roster row,
then applying `0005`:

```ts
expect(
  await env.MIGRATION_DB.prepare(
    `SELECT participant_role_snapshot, student_grade_snapshot
     FROM project_roster_entries WHERE id = 'legacy-profile-entry'`,
  ).first(),
).toEqual({
  participant_role_snapshot: null,
  student_grade_snapshot: null,
});
```

Then assert valid inserts succeed and invalid combinations reject with
`INVALID_ROSTER_PROFILE`:

```ts
await env.MIGRATION_DB.batch([
  env.MIGRATION_DB.prepare(
    `INSERT INTO organizations
     (id, name, canonical_name, is_active, created_at, updated_at)
     VALUES ('profile-org', '프로필 조직', '프로필 조직', 1,
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`,
  ),
  env.MIGRATION_DB.prepare(
    `INSERT INTO users
     (id, login_id, login_id_canonical, display_name, role, is_active,
      is_bootstrap, session_version, created_at, updated_at)
     VALUES ('profile-user', 'profile-user', 'profile-user', '프로필 운영자',
       'OPERATOR', 1, 0, 1, '2026-07-28T00:00:00.000Z',
       '2026-07-28T00:00:00.000Z')`,
  ),
  env.MIGRATION_DB.prepare(
    `INSERT INTO projects
     (id, name, start_date, end_date, status, revision, created_by,
      created_at, updated_at)
     VALUES ('profile-project', '프로필 프로젝트', NULL, NULL,
       'PRE_REGISTRATION', 0, 'profile-user',
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`,
  ),
]);

async function insertProfile(
  id: string,
  role: "STUDENT" | "TEACHER",
  grade: "M1" | "M2" | "M3" | "H1" | "H2" | "H3" | null,
) {
  await env.MIGRATION_DB.prepare(
    `INSERT INTO participants
     (id, participant_id, name, organization_id, revision, created_at, updated_at)
     VALUES (?, ?, ?, 'profile-org', 0,
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`,
  )
    .bind(`participant-${id}`, `P-${id}`, id)
    .run();
  return env.MIGRATION_DB.prepare(
    `INSERT INTO project_roster_entries
     (id, project_id, participant_id, organization_id,
      participant_name_snapshot, organization_name_snapshot, source, status,
      was_expected_at_start, revision, created_by, updated_by, created_at,
      updated_at, participant_role_snapshot, student_grade_snapshot)
     VALUES (?, 'profile-project', ?, 'profile-org', ?, '프로필 조직',
       'PRE_REGISTRATION', 'ACTIVE', 0, 0, 'profile-user', 'profile-user',
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z', ?, ?)`,
  )
    .bind(id, `participant-${id}`, id, role, grade)
    .run();
}

await expect(insertProfile("student-ok", "STUDENT", "M1")).resolves.toBeDefined();
await expect(insertProfile("teacher-ok", "TEACHER", null)).resolves.toBeDefined();
await expect(insertProfile("student-bad", "STUDENT", null))
  .rejects.toThrow(/INVALID_ROSTER_PROFILE/);
await expect(insertProfile("teacher-bad", "TEACHER", "H2"))
  .rejects.toThrow(/INVALID_ROSTER_PROFILE/);
```

Add a `listRoster` assertion that maps both new columns and returns `null` for
the legacy row.

- [ ] **Step 2: Run Worker migration tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/roster-profile-migration.integration.test.ts test/schema.integration.test.ts
```

Expected: FAIL because migration `0005` and mapper fields do not exist.

- [ ] **Step 3: Add the append-only migration**

Create exact SQL:

```sql
ALTER TABLE project_roster_entries
ADD COLUMN participant_role_snapshot TEXT;

ALTER TABLE project_roster_entries
ADD COLUMN student_grade_snapshot TEXT;

CREATE TRIGGER project_roster_entries_profile_insert
BEFORE INSERT ON project_roster_entries
WHEN NOT (
  (NEW.participant_role_snapshot IS NULL
    AND NEW.student_grade_snapshot IS NULL)
  OR
  (NEW.participant_role_snapshot = 'STUDENT'
    AND NEW.student_grade_snapshot IN ('M1', 'M2', 'M3', 'H1', 'H2', 'H3'))
  OR
  (NEW.participant_role_snapshot = 'TEACHER'
    AND NEW.student_grade_snapshot IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_PROFILE');
END;

CREATE TRIGGER project_roster_entries_profile_update
BEFORE UPDATE OF participant_role_snapshot, student_grade_snapshot
ON project_roster_entries
WHEN NOT (
  (NEW.participant_role_snapshot IS NULL
    AND NEW.student_grade_snapshot IS NULL)
  OR
  (NEW.participant_role_snapshot = 'STUDENT'
    AND NEW.student_grade_snapshot IN ('M1', 'M2', 'M3', 'H1', 'H2', 'H3'))
  OR
  (NEW.participant_role_snapshot = 'TEACHER'
    AND NEW.student_grade_snapshot IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_PROFILE');
END;
```

- [ ] **Step 4: Extend `RosterRecord`, SELECT, and mapper**

Select and map the two columns:

```ts
role:
  row.participant_role_snapshot === null
    ? null
    : ParticipantRoleSchema.parse(row.participant_role_snapshot),
grade:
  row.student_grade_snapshot === null
    ? null
    : StudentGradeSchema.parse(row.student_grade_snapshot),
```

Keep legacy values nullable instead of substituting defaults.

- [ ] **Step 5: Run migration, schema, and Worker type tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/roster-profile-migration.integration.test.ts test/schema.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: PASS, including `PRAGMA foreign_key_check`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/migrations/0005_roster_participant_profiles.sql apps/worker/test/roster-profile-migration.integration.test.ts apps/worker/test/schema.integration.test.ts apps/worker/src/db/roster.ts
git commit -m "feat: persist project roster participant profiles"
```

---

### Task 3: 단건·일괄 명단 mutation과 최근 값 추천

**Files:**
- Modify: `apps/worker/src/services/bulk-participants.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/test/participants.integration.test.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`

**Interfaces:**
- Consumes: `RosterParticipantInput[]`, `ParticipantRole`, `StudentGrade`
- Produces: `getParticipants()` rows with `suggestedRole`, `suggestedGrade`
- Produces: all roster mutation responses with nullable `role`, `grade`

- [ ] **Step 1: Write failing Worker mutation tests**

Cover these concrete cases:

```ts
const response = await postBulk({
  organizationId: IDS.organization,
  participants: [
    { name: "중학생", role: "STUDENT", grade: "M2" },
    { name: "담당 교사", role: "TEACHER", grade: null },
  ],
  confirmDuplicateNames: false,
  expectedRevision: 0,
});
expect(response.participants.map((item) => item.rosterEntry)).toMatchObject([
  { participantName: "중학생", role: "STUDENT", grade: "M2" },
  { participantName: "담당 교사", role: "TEACHER", grade: null },
]);
expect(await projectRevision()).toBe(1);
```

Also assert:

- a 30-row request succeeds and a 31-row request is rejected before SQL;
- a duplicate conflict followed by confirmed retry preserves every profile;
- a forced guarded batch failure leaves participant, roster, audit counts unchanged;
- new single participant and existing participant add both persist the profile;
- restoring a canceled row overwrites its profile with the newly confirmed values;
- editing a legacy row replaces `NULL / NULL` with the submitted valid profile;
- editing one project does not change another project's roster snapshot;
- latest accessible roster snapshot is returned as `suggestedRole` and
  `suggestedGrade`;
- an organization manager never receives a suggestion from an organization
  outside their scope.

- [ ] **Step 2: Run focused Worker tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/participants.integration.test.ts test/roster.integration.test.ts
```

Expected: FAIL on missing request fields and missing database writes.

- [ ] **Step 3: Convert bulk creation to structured participants**

Replace every `input.names` use with `input.participants`. Preserve normalized
names and copy the profile into `PreparedParticipant`:

```ts
interface PreparedParticipant {
  participantId: string;
  participantNumber: string;
  rosterEntryId: string;
  name: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
}
```

Change duplicate collection to:

```ts
collectDuplicates(
  input.participants.map((participant) => participant.name),
  existingParticipants.map((participant) => participant.name),
);
```

Add profile values to the `WITH input` roster insert and include
`participantRole` and `studentGrade` in each participant's audit details.
Do not increment the project revision per participant.

- [ ] **Step 4: Update single add, restore, and edit**

Pass `{ role, grade }` through `createParticipantAndAddToProject` and
`addRosterEntry`. New insert SQL writes both snapshot columns. Restore SQL sets:

```sql
participant_role_snapshot = ?,
student_grade_snapshot = ?,
status = 'ACTIVE'
```

Extend `updateProjectParticipant` so one guarded batch updates the participant
master and the current project's roster row:

```sql
UPDATE project_roster_entries
SET participant_name_snapshot = ?,
    organization_id = ?,
    organization_name_snapshot = (
      SELECT name FROM organizations WHERE id = ?
    ),
    participant_role_snapshot = ?,
    student_grade_snapshot = ?,
    revision = revision + 1,
    updated_by = ?,
    updated_at = ?
WHERE project_id = ? AND participant_id = ?
```

Include before/after `role` and `grade` in the existing audit payload. Return
the updated roster profile so the caller and subsequent fetch agree.

- [ ] **Step 5: Query recent profile suggestions safely**

Extend `getParticipants` with a correlated newest-row lookup ordered by
`r.updated_at DESC, r.id DESC`. Restrict manager rows to their existing
`user_organizations` scope. Map absent history to:

```ts
suggestedRole: null,
suggestedGrade: null,
```

The selected fields use:

```sql
(SELECT r.participant_role_snapshot
 FROM project_roster_entries r
 WHERE r.participant_id = p.id
 ORDER BY r.updated_at DESC, r.id DESC
 LIMIT 1) AS suggested_role,
(SELECT r.student_grade_snapshot
 FROM project_roster_entries r
 WHERE r.participant_id = p.id
 ORDER BY r.updated_at DESC, r.id DESC
 LIMIT 1) AS suggested_grade
```

Do not write these values back to `participants`.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/participants.integration.test.ts test/roster.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/services/bulk-participants.ts apps/worker/src/services/participants.ts apps/worker/src/services/roster.ts apps/worker/test/participants.integration.test.ts apps/worker/test/roster.integration.test.ts
git commit -m "feat: write roster profiles in participant mutations"
```

---

### Task 4: 역할별 요약과 Excel 내보내기 데이터

**Files:**
- Modify: `packages/domain/src/summary.ts`
- Modify: `packages/domain/test/summary.test.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/src/services/imports.ts`
- Modify: `apps/worker/test/summary.integration.test.ts`
- Modify: `apps/worker/test/exports.integration.test.ts`

**Interfaces:**
- Consumes: `RosterRecord.role`, `RosterRecord.grade`
- Produces: `calculateProjectSummary()` with `studentTotal`, `teacherTotal`
- Produces: export columns `참가자 구분`, `학년`, `등록 시점`

- [ ] **Step 1: Write failing domain summary tests**

Use active, canceled, and legacy rows:

```ts
rosterEntries: [
  { organizationId: "org-1", source: "PRE_REGISTRATION", status: "ACTIVE", role: "STUDENT" },
  { organizationId: "org-1", source: "PRE_REGISTRATION", status: "ACTIVE", role: "TEACHER" },
  { organizationId: "org-1", source: "PRE_REGISTRATION", status: "ACTIVE", role: null },
  { organizationId: "org-1", source: "PRE_REGISTRATION", status: "CANCELLED", role: "STUDENT" },
]
```

Assert `studentTotal === 1`, `teacherTotal === 1`, organization counts are
`1/1`, final total is `3`, and canceled/legacy rows are not inferred into role
counts.

- [ ] **Step 2: Run domain tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run test/summary.test.ts
```

Expected: FAIL because role counts are absent.

- [ ] **Step 3: Add role counts to the shared summary calculation**

Extend `ProjectSummaryInput.rosterEntries` with:

```ts
role: ParticipantRole | null;
```

For each organization count only `status === "ACTIVE"`:

```ts
const studentCount = entries.filter(
  (entry) => entry.status === "ACTIVE" && entry.role === "STUDENT",
).length;
const teacherCount = entries.filter(
  (entry) => entry.status === "ACTIVE" && entry.role === "TEACHER",
).length;
```

Reduce organization counts into `studentTotal` and `teacherTotal`.

- [ ] **Step 4: Write failing Worker summary/export tests**

Assert scoped manager summary and operator summary return the correct two
totals. Assert exact export cells:

```ts
expect(data.명단).toContainEqual(
  expect.objectContaining({
    "참가자 구분": "학생",
    학년: "중2",
    "등록 시점": "사전",
    상태: "참석",
  }),
);
expect(data.명단).toContainEqual(
  expect.objectContaining({
    "참가자 구분": "미지정",
    학년: "미지정",
  }),
);
expect(data.집계[0]).toEqual(
  expect.objectContaining({ 학생: 1, 담당교사: 1 }),
);
```

- [ ] **Step 5: Wire Worker summary and export presentation**

Pass `role` into `calculateProjectSummary`. Add small exhaustive formatters in
`services/imports.ts`:

```ts
function displayRole(role: ParticipantRole | null) {
  if (role === "STUDENT") return "학생";
  if (role === "TEACHER") return "담당교사";
  return "미지정";
}

function displayGrade(grade: StudentGrade | null, role: ParticipantRole | null) {
  if (role === "TEACHER") return "";
  if (grade === null) return "미지정";
  return { M1: "중1", M2: "중2", M3: "중3", H1: "고1", H2: "고2", H3: "고3" }[grade];
}
```

Rename export `구분` to `등록 시점`, translate source/status into Korean
display strings, and add student/teacher columns to every organization summary
row.

- [ ] **Step 6: Run domain and Worker tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run test/summary.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/summary.integration.test.ts test/exports.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/summary.ts packages/domain/test/summary.test.ts apps/worker/src/services/roster.ts apps/worker/src/services/imports.ts apps/worker/test/summary.integration.test.ts apps/worker/test/exports.integration.test.ts
git commit -m "feat: summarize and export participant profiles"
```

---

### Task 5: Excel 역할·학년 가져오기

**Files:**
- Modify: `packages/domain/src/import-validation.ts`
- Modify: `packages/domain/test/import-validation.test.ts`
- Modify: `apps/worker/src/services/imports.ts`
- Modify: `apps/worker/test/imports.integration.test.ts`
- Modify: `apps/worker/test/import-budget.integration.test.ts`

**Interfaces:**
- Consumes: `NormalizedImportRow.role`, `NormalizedImportRow.grade`
- Produces: imported roster snapshots with exact role and grade
- Produces: `ROSTER_CHUNK_SIZE = 9` within D1's 100 binding limit

- [ ] **Step 1: Write failing domain import tests**

Add valid student/teacher rows and reject invalid pairings with row-specific
details:

```ts
expect(
  validateNormalizedRows([
    {
      rowNumber: 2,
      name: "학생",
      organizationName: "성룡사",
      role: "STUDENT",
      grade: "H1",
    },
    {
      rowNumber: 3,
      name: "교사",
      organizationName: "성룡사",
      role: "TEACHER",
      grade: null,
    },
  ]),
).toHaveLength(2);
```

Assert invalid input throws `VALIDATION_FAILED` with
`{ rowNumber: 2, field: "grade" }`.

- [ ] **Step 2: Run domain tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run test/import-validation.test.ts
```

Expected: FAIL before profile validation is implemented.

- [ ] **Step 3: Validate and resolve profile fields**

Keep name/organization normalization, then explicitly reject:

```ts
if (normalized.role === "STUDENT" && normalized.grade === null) {
  throw new DomainError("VALIDATION_FAILED", {
    rowNumber: normalized.rowNumber,
    field: "grade",
  });
}
if (normalized.role === "TEACHER" && normalized.grade !== null) {
  throw new DomainError("VALIDATION_FAILED", {
    rowNumber: normalized.rowNumber,
    field: "grade",
  });
}
```

Copy `role` and `grade` into `ResolvedImportRow`, validation responses, and
audit details.

- [ ] **Step 4: Write failing Worker import and budget tests**

Assert a mixed import stores the exact snapshots, a legacy-shaped request is
HTTP 422, invalid data causes zero mutations, and re-importing a canceled
existing participant updates the profile. Update the query budget expectation:

```ts
expect(plan.bindingCounts.every((count) => count <= 100)).toBe(true);
```

- [ ] **Step 5: Update import SQL and binding chunks**

Set:

```ts
const ROSTER_CHUNK_SIZE = 9;
```

Extend the incoming CTE with `participant_role`, `student_grade`; insert and
conflict-update both snapshot columns. Change the calculated binding count from
`8 * chunk + 6` to `10 * chunk + 6`. Existing participant selection continues
to use name, organization, and optional resolved ID; role and grade never
change the participant master match.

- [ ] **Step 6: Run focused import tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run test/import-validation.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/imports.integration.test.ts test/import-budget.integration.test.ts
```

Expected: PASS and maximum binding count at most 100.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/import-validation.ts packages/domain/test/import-validation.test.ts apps/worker/src/services/imports.ts apps/worker/test/imports.integration.test.ts apps/worker/test/import-budget.integration.test.ts
git commit -m "feat: import participant roles and grades"
```

---

### Task 6: 동적 참가자 입력과 기존 명단 프로필 수정

**Files:**
- Delete: `apps/web/src/features/roster/BulkParticipantNameField.tsx`
- Delete: `apps/web/src/features/roster/BulkParticipantNameField.test.tsx`
- Create: `apps/web/src/features/roster/BulkParticipantRowsField.tsx`
- Create: `apps/web/src/features/roster/BulkParticipantRowsField.test.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Produces: `BulkParticipantDraft`
- Produces: `BulkParticipantRowsField`
- Consumes: `ParticipantView.suggestedRole`, `suggestedGrade`
- Consumes: `RosterView.role`, `grade`

- [ ] **Step 1: Write failing dynamic-row component tests**

Define the intended interface in the test:

```ts
export interface BulkParticipantDraft {
  clientId: string;
  name: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
}

<BulkParticipantRowsField
  rows={[]}
  duplicates={[]}
  duplicateNamesConfirmed={false}
  onRowsChange={onRowsChange}
  onDuplicateNamesConfirmedChange={onConfirmedChange}
/>
```

Test:

- initial render has no name textbox and shows `참가자 추가`;
- clicking add emits one `{ role: "STUDENT", grade: null }` row;
- student submission remains invalid until a grade is selected;
- selecting teacher clears grade and disables the grade select;
- delete removes only that `clientId`;
- the 30th row disables add and displays `최대 30명`;
- duplicate warnings attach to matching normalized names and confirmation state
  survives profile edits but resets when a name changes.

- [ ] **Step 2: Run component tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/BulkParticipantRowsField.test.tsx
```

Expected: FAIL because the new component does not exist.

- [ ] **Step 3: Implement `BulkParticipantRowsField`**

Render one fieldset per row with accessible labels containing its 1-based
number. Use:

```ts
export function createBulkParticipantDraft(): BulkParticipantDraft {
  return {
    clientId: crypto.randomUUID(),
    name: "",
    role: "STUDENT",
    grade: null,
  };
}

export function isValidBulkParticipantDraft(row: BulkParticipantDraft) {
  const name = normalizeParticipantName(row.name);
  return (
    name.length >= 1 &&
    name.length <= 100 &&
    (row.role === "TEACHER" || row.grade !== null)
  );
}
```

Normalize names only when constructing the submit payload so typing whitespace
does not move the cursor. Preserve the existing duplicate confirmation copy.

- [ ] **Step 4: Write failing dialog/page integration tests**

Assert:

- new mode starts with zero rows;
- two added rows submit `participants`, not `names`;
- button copy is `2명 명단에 추가`;
- duplicate response retains both rows and their profiles;
- existing participant uses recent valid suggestion but still requires a
  submit click;
- absent/legacy suggestion starts as student with blank grade;
- edit dialog initializes from the selected `RosterView`, saves role/grade,
  and leaves other projects untouched through the API contract.

- [ ] **Step 5: Wire dialog and page state**

Change the exact submit shapes:

```ts
export interface ExistingParticipantConfirmation {
  participantId: string;
  name: string;
  organizationId: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
  expectedParticipantRevision: number;
}

export interface BulkParticipantSubmitInput {
  participants: RosterParticipantInput[];
  organizationId: string;
  confirmDuplicateNames: boolean;
}
```

Change the edit selection from only `ParticipantView` to:

```ts
interface EditingRosterParticipant {
  participant: ParticipantView;
  roster: RosterView;
}
```

`ParticipantEditDialog.onSave` returns name, organizationId, role, grade, and
expectedRevision. Update success text to
`${input.participants.length}명을 명단에 추가했습니다.`.

- [ ] **Step 6: Add responsive styles**

Replace textarea/list styles with:

```css
.er-bulk-participant-rows {
  display: grid;
  gap: var(--er-space-4);
}

.er-bulk-participant-row {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) minmax(8rem, 1fr)
    minmax(8rem, 1fr) auto;
  gap: var(--er-space-3);
  align-items: end;
  padding: var(--er-space-4);
  border: 1px solid var(--er-color-border);
  border-radius: var(--er-radius-md);
}
```

At the existing mobile breakpoint, set `grid-template-columns: 1fr` and keep
the delete button visually separated.

- [ ] **Step 7: Run roster UI tests and typecheck**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/BulkParticipantRowsField.test.tsx src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: PASS.

- [ ] **Step 8: Remove the old component and commit**

```bash
git add -A apps/web/src/features/roster/BulkParticipantNameField.tsx apps/web/src/features/roster/BulkParticipantNameField.test.tsx apps/web/src/features/roster/BulkParticipantRowsField.tsx apps/web/src/features/roster/BulkParticipantRowsField.test.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/features/roster/ParticipantEditDialog.tsx apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add structured participant entry rows"
```

---

### Task 7: 명단 열·필터와 프로젝트 요약 UI

**Files:**
- Create: `apps/web/src/features/roster/participant-profile-labels.ts`
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/SummaryCards.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `RosterView.role: ParticipantRole | null`
- Consumes: `RosterView.grade: StudentGrade | null`
- Consumes: summary `studentTotal`, `teacherTotal`, organization counts

- [ ] **Step 1: Write failing table and summary tests**

Render student, teacher, and legacy rows and assert exact labels:

```ts
expect(screen.getByText("학생")).toBeInTheDocument();
expect(screen.getByText("중2")).toBeInTheDocument();
expect(screen.getByText("담당교사")).toBeInTheDocument();
expect(screen.getByText("미지정")).toBeInTheDocument();
expect(screen.getByRole("columnheader", { name: "등록 시점" })).toBeInTheDocument();
```

Select `학생` and `중2` filters and assert only the matching row remains.
Render `SummaryCards` and assert `학생 3명`, `담당교사 2명`, plus organization
columns `학생`, `담당교사`.

- [ ] **Step 2: Run focused UI tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx src/features/projects/project-detail.test.tsx
```

Expected: FAIL because fields, filters, and summary cards are absent.

- [ ] **Step 3: Extend `RosterView` and presentation helpers**

Add `participant-profile-labels.ts` with:

```ts
export const ROLE_LABEL = {
  STUDENT: "학생",
  TEACHER: "담당교사",
} satisfies Record<ParticipantRole, string>;

export const GRADE_LABEL = {
  M1: "중1", M2: "중2", M3: "중3",
  H1: "고1", H2: "고2", H3: "고3",
} satisfies Record<StudentGrade, string>;
```

Add to `RosterView`:

```ts
role: ParticipantRole | null;
grade: StudentGrade | null;
```

Import the label constants into `RosterTable`.
For a legacy row display role `미지정`; display teacher grade `-`; display
legacy grade `미지정`. Rename the old source header to `등록 시점`.

- [ ] **Step 4: Add role and grade filters**

Track:

```ts
const [role, setRole] = useState<"ALL" | ParticipantRole | "UNSPECIFIED">("ALL");
const [grade, setGrade] = useState<"ALL" | StudentGrade | "UNSPECIFIED">("ALL");
```

Combine them with query, organization, and status inside the existing memo.
`UNSPECIFIED` matches `null`; teacher rows match no exact grade. Do not pass
filtered rows back to the parent or export flow.

- [ ] **Step 5: Extend summary cards and table**

Add two cards after the existing three:

```tsx
<Card className="er-summary-card">
  <span>학생</span>
  <strong>학생 {summary.studentTotal}명</strong>
</Card>
<Card className="er-summary-card">
  <span>담당교사</span>
  <strong>담당교사 {summary.teacherTotal}명</strong>
</Card>
```

Add organization table cells for `studentCount` and `teacherCount`.

- [ ] **Step 6: Run UI tests and build**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/roster/participant-profile-labels.ts apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/SummaryCards.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/styles/global.css
git commit -m "feat: show and filter roster participant profiles"
```

---

### Task 8: Excel 내보내기 확인 대화상자

**Files:**
- Create: `apps/web/src/features/roster/ExportRosterDialog.tsx`
- Create: `apps/web/src/features/roster/ExportRosterDialog.test.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/imports/export.test.ts`

**Interfaces:**
- Produces: `buildExportRosterSummary(rows: RosterView[]): ExportRosterSummary`
- Produces: `ExportRosterDialog`
- Consumes: unfiltered, authorization-scoped `ProjectRosterPage.rows`

- [ ] **Step 1: Write failing pure summary and dialog tests**

Use rows containing active/canceled student, active teacher, and active legacy
entries:

```ts
expect(buildExportRosterSummary(rows)).toEqual({
  total: 4,
  active: 3,
  cancelled: 1,
  students: 1,
  teachers: 1,
});
```

Render the dialog and assert project name, all five counts, the copy
`현재 화면 필터와 관계없이 전체 명단을 내보냅니다.` and
`취소 명단도 상태와 함께 포함됩니다.`. Assert cancel closes without calling
`onConfirm`, confirm calls it once, pending disables both actions, and error
copy remains visible for retry.

- [ ] **Step 2: Run dialog tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/ExportRosterDialog.test.tsx src/features/imports/export.test.ts
```

Expected: FAIL because confirmation does not exist.

- [ ] **Step 3: Implement the dialog and summary**

Define:

```ts
export interface ExportRosterSummary {
  total: number;
  active: number;
  cancelled: number;
  students: number;
  teachers: number;
}
```

Count students and teachers only when `status === "ACTIVE"`; do not infer
legacy rows. Use the shared `Dialog` with `hideDefaultCloseAction`, a summary
definition list, explicit scope notices, and `취소`/`엑셀 내보내기` actions.

- [ ] **Step 4: Gate download behind confirmation**

Replace direct export click with `setShowExport(true)`. Keep
`exportingRef.current` as the duplicate-request guard. `exportRoster()` closes
the dialog only after API fetch and workbook download both succeed. On failure,
set dialog-local error `엑셀 명단을 내보내지 못했습니다. 다시 시도해 주세요.` and
keep the dialog open.

The dialog receives the original `rows` prop, never `RosterTable`'s filtered
array. The GET request remains
`/projects/${project.id}/exports/roster`, so the server is also the authority
for the complete authorized export.

- [ ] **Step 5: Run export UI tests and build**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/ExportRosterDialog.test.tsx src/features/imports/export.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: PASS; no workbook writer call occurs before confirmation.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/roster/ExportRosterDialog.tsx apps/web/src/features/roster/ExportRosterDialog.test.tsx apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/imports/export.test.ts
git commit -m "feat: confirm complete roster export"
```

---

### Task 9: Excel 가져오기 UI와 workbook 검증

**Files:**
- Modify: `apps/web/src/lib/excel/read-workbook.ts`
- Modify: `apps/web/src/lib/excel/read-workbook.test.ts`
- Modify: `apps/web/src/features/imports/ColumnMapping.tsx`
- Modify: `apps/web/src/features/imports/ImportWizard.tsx`
- Modify: `apps/web/src/features/imports/ValidationTable.tsx`
- Modify: `apps/web/src/features/imports/imports.test.tsx`

**Interfaces:**
- Produces: `ImportColumns = { name: string; organization: string; role: string; grade: string }`
- Produces: exact Korean value parsing into `ParticipantRole`, `StudentGrade | null`
- Consumes: `NormalizedImportRow`

- [ ] **Step 1: Write failing workbook normalization tests**

Create a sheet with headers `이름`, `조직`, `참가자 구분`, `학년` and assert:

```ts
expect(normalizeSheet(parsed, "명단", {
  name: "이름",
  organization: "조직",
  role: "참가자 구분",
  grade: "학년",
})).toEqual([
  {
    rowNumber: 2,
    name: "학생 1",
    organizationName: "성룡사",
    role: "STUDENT",
    grade: "M1",
  },
  {
    rowNumber: 3,
    name: "교사 1",
    organizationName: "성룡사",
    role: "TEACHER",
    grade: null,
  },
]);
```

Assert missing role or grade headers throws `MISSING_REQUIRED_COLUMNS` with
the missing Korean column names. Assert unknown role, unknown grade, and a
teacher grade produce row-specific parse issues rather than guessed values.

- [ ] **Step 2: Run workbook tests and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/lib/excel/read-workbook.test.ts
```

Expected: FAIL because only name and organization are mapped.

- [ ] **Step 3: Implement exact value parsing**

Define maps:

```ts
const ROLE_VALUE = {
  학생: "STUDENT",
  담당교사: "TEACHER",
} as const;

const GRADE_VALUE = {
  중1: "M1", 중2: "M2", 중3: "M3",
  고1: "H1", 고2: "H2", 고3: "H3",
} as const;
```

Do not accept ranges or derive grade from other cells. For a teacher, require
the trimmed grade cell to be empty and return `null`. Introduce a typed
`WorkbookImportError` containing:

```ts
{
  code: "MISSING_REQUIRED_COLUMNS" | "INVALID_IMPORT_VALUE";
  missingColumns?: string[];
  rowNumber?: number;
  field?: "role" | "grade";
}
```

- [ ] **Step 4: Write failing wizard and mapping tests**

Assert automatic matching of all four exact headers, four visible column
selectors, missing-column message:

```text
필수 열이 없습니다: 참가자 구분, 학년
```

and validation rows displaying role and grade. Verify that invalid workbook
values never issue `/imports/validate`.

- [ ] **Step 5: Extend mapping and wizard**

Use one `ImportColumns` state everywhere. Reset all four fields on project,
sheet, and workbook changes. Pass normalized role/grade to validate and commit.
`ValidationTable` shows `참가자 구분` and `학년` by importing `ROLE_LABEL` and
`GRADE_LABEL` from
`apps/web/src/features/roster/participant-profile-labels.ts`.

- [ ] **Step 6: Run import UI tests and build**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/lib/excel/read-workbook.test.ts src/features/imports/imports.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/excel/read-workbook.ts apps/web/src/lib/excel/read-workbook.test.ts apps/web/src/features/imports/ColumnMapping.tsx apps/web/src/features/imports/ImportWizard.tsx apps/web/src/features/imports/ValidationTable.tsx apps/web/src/features/imports/imports.test.tsx
git commit -m "feat: map participant profiles from Excel"
```

---

### Task 10: E2E, 운영 migration gate, 전체 검증

**Files:**
- Modify: `apps/web/e2e/project-roster.spec.ts`
- Modify: `apps/web/e2e/import-export.spec.ts`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/recovery.md`

**Interfaces:**
- Consumes: completed contract, Worker, Web, and migration behavior
- Produces: reproducible `0005` production rollout and recovery procedure

- [ ] **Step 1: Write failing E2E coverage**

In `project-roster.spec.ts`, create two dynamic rows, select `중2` and
`담당교사`, submit once, and verify the table shows both profiles. Edit the
student to `중3`, cancel the teacher, and verify role/grade filters.

In `import-export.spec.ts`, verify:

1. an old workbook without role/grade is rejected with both missing columns;
2. a valid mixed workbook imports;
3. export click opens confirmation and does not download;
4. confirmation shows active/canceled and student/teacher counts;
5. confirming downloads a workbook whose roster header contains
   `참가자 구분`, `학년`, `등록 시점`;
6. a canceled row remains present with status `취소`.

- [ ] **Step 2: Run E2E and verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- --grep "participant profile|import and export profile"
```

Expected: FAIL until all user journeys and fixtures use the new fields.

- [ ] **Step 3: Update E2E fixtures and make scenarios pass**

Every direct roster request in the affected specs must send:

```ts
role: "STUDENT",
grade: "M1",
```

or:

```ts
role: "TEACHER",
grade: null,
```

Update generated workbook rows to include exact Korean values. Keep assertions
on the downloaded workbook rather than only the download event.

- [ ] **Step 4: Document the `0005` deployment gate**

Add a dedicated section requiring the pending list to contain only:

```text
0005_roster_participant_profiles.sql
```

before applying to an existing production D1. Record pre-migration:

```sql
SELECT COUNT(*) AS roster_count FROM project_roster_entries;
SELECT COUNT(*) AS invalid_count
FROM project_roster_entries
WHERE participant_role_snapshot IS NOT NULL
   OR student_grade_snapshot IS NOT NULL;
```

The second query is executed only after confirming the new columns do not yet
exist by inspecting `PRAGMA table_info(project_roster_entries)`; before
migration, record `roster_count` and the current table schema instead.

After applying, require:

```sql
SELECT COUNT(*) AS roster_count FROM project_roster_entries;
SELECT COUNT(*) AS legacy_profile_count
FROM project_roster_entries
WHERE participant_role_snapshot IS NULL
  AND student_grade_snapshot IS NULL;
SELECT COUNT(*) AS invalid_profile_count
FROM project_roster_entries
WHERE NOT (
  (participant_role_snapshot IS NULL AND student_grade_snapshot IS NULL)
  OR (participant_role_snapshot = 'STUDENT'
      AND student_grade_snapshot IN ('M1','M2','M3','H1','H2','H3'))
  OR (participant_role_snapshot = 'TEACHER'
      AND student_grade_snapshot IS NULL)
);
PRAGMA foreign_key_check;
```

The pre/post roster counts and post legacy count must match, invalid count must
be zero, and foreign key check must return no rows. Require an external
mode-0700 backup directory, mode-0600 export/checksum, and no Worker deployment
until all checks pass.

- [ ] **Step 5: Document recovery**

For an export with `0001`–`0004` applied and `0005` pending, require import into
an isolated D1, verify the migration ledger, run the same `0005` gate there,
then smoke test. Explicitly prohibit reverse migration or manual deletion of
the two columns in production.

- [ ] **Step 6: Run focused E2E and documentation checks**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- --grep "participant profile|import and export profile"
git diff --check -- docs/operations/deployment.md docs/operations/recovery.md
```

Expected: E2E PASS and no whitespace errors in the documentation diff.

- [ ] **Step 7: Run the complete verification suite**

```bash
corepack pnpm@10.28.1 run format:check
corepack pnpm@10.28.1 run check
corepack pnpm@10.28.1 run test
corepack pnpm@10.28.1 --filter @event-roster/web run build
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: every command exits 0. Review `git status --short` and ensure only
the intended implementation files are tracked; preserve `.DS_Store`,
`.pnpm-store/`, and other pre-existing untracked user files.

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e/project-roster.spec.ts apps/web/e2e/import-export.spec.ts docs/operations/deployment.md docs/operations/recovery.md
git commit -m "test: verify participant profile workflows"
```

---

## Production Rollout Handoff

Production rollout is performed only after the implementation branch has been
reviewed, merged into local `main`, and pushed at the user's request.

1. Confirm `main` contains migration `0005` and the Worker code that writes the
   new columns.
2. Follow `docs/operations/deployment.md` to create and verify the external D1
   export and checksum.
3. Confirm remote pending migration is exactly
   `0005_roster_participant_profiles.sql`.
4. Record pre-migration roster count and schema.
5. Apply the migration and run every documented post-migration SQL check.
6. Deploy `main` with the existing authenticated local Wrangler workflow.
7. Run remote health and authenticated roster smoke checks.
8. Record Cloudflare deployment version, Git SHA, backup checksum, migration
   result, and smoke result.
9. If a post-check fails, stop traffic-changing work and use the isolated
   restore procedure in `docs/operations/recovery.md`; do not mutate production
   rows to simulate rollback.
