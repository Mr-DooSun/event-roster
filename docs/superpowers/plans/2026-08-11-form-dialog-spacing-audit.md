# 폼·다이얼로그 여백 전수 점검 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 모든 웹 폼과 모달에서 일관된 필드·액션 여백을 제공한다.

**Architecture:** 공통 CSS의 form/action 규칙을 강화하고, 해당 규칙을 쓰지 않는 모달을 공통 form 구조로 전환한다.

**Tech Stack:** React, CSS, Vitest.

## Global Constraints

- 필드 간 16px, 본문과 하단 액션 간 24px을 적용한다.
- 모바일에서 액션은 줄바꿈되어도 동일한 간격을 유지한다.

### Task 1: 공통 폼 규칙

**Files:**
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/roster/roster.test.tsx`

- [ ] Add a failing test that the participant edit dialog uses `er-dialog-form` and `er-dialog-actions`.
- [ ] Verify the test fails because the dialog has direct child fields and buttons.
- [ ] Set `.er-dialog-form` to grid with `gap: var(--er-space-4)` and `.er-dialog-actions` to `margin-top: var(--er-space-6)`; keep mobile actions vertically readable.
- [ ] Run focused roster tests and confirm pass.

### Task 2: Dialog consumer audit

**Files:**
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`, `apps/web/src/features/admin/TemporaryPasswordDialog.tsx`, `apps/web/src/features/admin/OrganizationManagersPanel.tsx`, `apps/web/src/features/roster/ExportRosterDialog.tsx`
- Test: existing feature tests

- [ ] Wrap direct-field dialogs in `er-dialog-form` and explicit `er-dialog-actions`.
- [ ] Run `rg '<Dialog' apps/web/src` and inspect every direct child field/action use; apply the common classes where absent.
- [ ] Run web typecheck, focused tests, Biome, and production build.

### Task 3: Release

- [ ] Run `git diff --check` and relevant tests.
- [ ] Merge, push, deploy, and verify `/api/v1/health`.
