# 참가 명단 성별·정렬·표시 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 명단에서 성별을 프로젝트별 스냅샷으로 관리하고, ID를 숨긴 읽기 쉬운 정렬·필터 UI를 제공한다.

**Architecture:** 성별은 contracts의 roster profile에 추가해 모든 생성·수정·import 경로가 동일한 값을 검증한다. worker는 `project_roster_entries.gender_snapshot`을 읽고 쓰며, web은 `RosterView.gender`를 통해 입력·표시·필터·정렬한다.

**Tech Stack:** TypeScript, Zod, Cloudflare D1, Hono worker, React, Vitest, Playwright, ExcelJS.

## Global Constraints

- 성별 저장 값은 `MALE`, `FEMALE`, `NULL`이고 기존 명단은 `NULL`을 유지한다.
- 고유 ID는 화면 표와 화면 검색에서는 제거하지만 API 내부 식별과 Excel 내보내기에는 유지한다.
- 기본 정렬은 조직명, 학년(M1~H3, 담당교사/미지정 후순위), 이름 오름차순이다.
- 모든 mutation은 기존 권한·revision·원자성 규칙을 바꾸지 않는다.

---

### Task 1: 성별 계약과 D1 스키마

**Files:**
- Create: `apps/worker/migrations/0006_roster_gender.sql`
- Modify: `packages/contracts/src/participant-profile.ts`, `packages/contracts/src/roster.ts`, `packages/contracts/src/history-corrections.ts`, `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces `GenderSchema = z.enum(["MALE", "FEMALE"])`, `type Gender`, and nullable `gender` in every roster profile input/output schema.
- Produces nullable `project_roster_entries.gender_snapshot` constrained to `MALE`/`FEMALE`.

- [ ] **Step 1: Write failing contract tests** for valid `gender: "MALE"`, `gender: "FEMALE"`, `gender: null`, and invalid value rejection in create and patch schemas.
- [ ] **Step 2: Run** `pnpm --filter @event-roster/contracts test`; expect the new cases to fail because schemas omit `gender`.
- [ ] **Step 3: Implement** `GenderSchema` in `participant-profile.ts`, include `gender: GenderSchema.nullable()` in roster and history-correction profile schemas and add migration SQL:
  ```sql
  ALTER TABLE project_roster_entries ADD COLUMN gender_snapshot TEXT;
  CREATE TRIGGER project_roster_entries_gender_insert
  BEFORE INSERT ON project_roster_entries
  WHEN NEW.gender_snapshot IS NOT NULL
   AND NEW.gender_snapshot NOT IN ('MALE', 'FEMALE')
  BEGIN SELECT RAISE(ABORT, 'INVALID_ROSTER_GENDER'); END;
  ```
  Add the analogous update trigger.
- [ ] **Step 4: Run** the contracts tests and worker migration test command; expect pass.
- [ ] **Step 5: Commit** `feat: add roster gender contract`.

### Task 2: Worker roster projection and mutations

**Files:**
- Modify: `apps/worker/src/db/roster.ts`, `apps/worker/src/services/roster.ts`, `apps/worker/src/services/bulk-participants.ts`, `apps/worker/src/services/participants.ts`, `apps/worker/src/services/history-corrections.ts`, `apps/worker/src/routes/roster.ts`, `apps/worker/src/routes/participants.ts`
- Test: `apps/worker/test/roster.integration.test.ts`, `apps/worker/test/history-corrections.integration.test.ts`

**Interfaces:**
- Consumes Task 1 `Gender` and nullable request field.
- Produces roster responses `{ ..., role, grade, gender }` and persists `gender_snapshot` in every roster-entry INSERT/UPDATE.

- [ ] **Step 1: Write failing integration tests** that create a participant with `gender: "FEMALE"`, retrieve it from `/roster`, patch it to `"MALE"`, and assert legacy rows return `gender: null`.
- [ ] **Step 2: Run** focused worker integration tests; expect response field and SQL binding failures.
- [ ] **Step 3: Implement** the field in `RosterRow`, `RosterRecord`, `SELECT_ROSTER`, `mapRoster`, all explicit `project_roster_entries` insert column lists, update statements, and response mappers. Thread request gender through ordinary, bulk, and closed-history correction flows without changing revision guards.
- [ ] **Step 4: Run** focused worker integration tests; expect pass.
- [ ] **Step 5: Commit** `feat: persist roster gender snapshots`.

### Task 3: Excel import and export

**Files:**
- Modify: `apps/worker/src/services/imports.ts`, `apps/worker/test/exports.integration.test.ts`, import service tests, `apps/web/src/features/imports/ImportWizard.tsx`, `apps/web/src/features/imports/imports.test.tsx`

**Interfaces:**
- Consumes `Gender` profile value.
- Produces Excel `성별` column: `남성`, `여성`, `미지정`; blank and `미지정` import as `null`.

- [ ] **Step 1: Write failing tests** for export column/value and import mappings `남성 → MALE`, `여성 → FEMALE`, blank/`미지정 → null`, invalid text rejection with row and field context.
- [ ] **Step 2: Run** import/export focused tests; expect failures.
- [ ] **Step 3: Implement** template/header parsing, validation, SQL staging/upsert bindings, display mapping, and workbook export column while retaining the existing exported 고유 ID column.
- [ ] **Step 4: Run** focused import/export tests; expect pass.
- [ ] **Step 5: Commit** `feat: include roster gender in excel flows`.

### Task 4: 참가자 입력·수정 성별 UI

**Files:**
- Modify: `apps/web/src/features/roster/BulkParticipantRowsField.tsx`, `apps/web/src/features/roster/ParticipantDialog.tsx`, `apps/web/src/features/roster/ParticipantEditDialog.tsx`, `apps/web/src/features/roster/ProjectRosterPage.tsx`, history-correction participant form components
- Test: `apps/web/src/features/roster/BulkParticipantRowsField.test.tsx`, `apps/web/src/features/roster/roster.test.tsx`, `apps/web/src/features/projects/project-detail.test.tsx`

**Interfaces:**
- Consumes/produces drafts and API payloads with `gender: Gender | null`.

- [ ] **Step 1: Write failing component tests** that new rows default to 미지정, users can choose 남성/여성, and edit saves the selected value.
- [ ] **Step 2: Run** the focused web tests; expect type and payload assertion failures.
- [ ] **Step 3: Implement** a reusable select (`미지정`, `남성`, `여성`), add gender to draft creation/validity/payloads and edit dialog local state/save input. Keep gender optional so a legacy participant can remain 미지정.
- [ ] **Step 4: Run** focused web tests; expect pass.
- [ ] **Step 5: Commit** `feat: collect roster gender`.

### Task 5: 명단 표, 필터와 정렬

**Files:**
- Modify: `apps/web/src/features/roster/RosterTable.tsx`, `apps/web/src/features/roster/participant-profile-labels.ts`, `apps/web/src/features/roster/roster.test.tsx`, `apps/web/e2e/project-roster.spec.ts`

**Interfaces:**
- Extends `RosterView` with `gender: Gender | null`.
- Provides sort value `DEFAULT | ORGANIZATION | GRADE | NAME` and filtered, deterministic display rows.

- [ ] **Step 1: Write failing table tests** asserting no 고유 ID heading/value or ID-only search match, `취소` button text, 성별 column/filter, default organization→grade→name order, and each sort selection order.
- [ ] **Step 2: Run** `pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx`; expect failures.
- [ ] **Step 3: Implement** query matching only name/organization, remove ID column, render gender label/filter, and sort after filtering. Compare strings with Korean locale and use a numeric grade rank map `{ M1: 0, M2: 1, M3: 2, H1: 3, H2: 4, H3: 5, null: 6 }`; use the default comparator as tie-breaker for alternate sorts. Render the button visually as `취소`/`복원` with `aria-label={`${row.participantName} 취소`}`.
- [ ] **Step 4: Run** focused web unit and E2E tests; expect pass.
- [ ] **Step 5: Commit** `feat: filter and sort roster by gender`.

### Task 6: Full verification and release

**Files:**
- Modify only files produced by Tasks 1–5.

- [ ] **Step 1: Apply** the migration to local and remote D1 using the repository migration command, then query the schema to confirm `gender_snapshot` exists.
- [ ] **Step 2: Run** `pnpm test`, `pnpm --filter @event-roster/web check`, `pnpm --filter @event-roster/web build`, and relevant Playwright specs.
- [ ] **Step 3: Inspect** `git diff --check`, the migration status, and an end-to-end create/edit/import/export flow.
- [ ] **Step 4: Commit** any verification-only corrections, merge to `main`, push, deploy the worker, and check `/api/v1/health`.
