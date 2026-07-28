# Task 8 Report — Excel roster export confirmation

## Implemented

- Added `buildExportRosterSummary(rows)`, which counts all authorization-scoped rows as `total`, separates `ACTIVE` and `CANCELLED`, and counts `STUDENT`/`TEACHER` only when `ACTIVE`. Legacy rows (`role: null`) are not inferred into either role count.
- Added `ExportRosterDialog` with the project name, five counts, both required scope notices, explicit cancel/confirm actions, disabled pending actions, and an inline retryable error.
- Changed `ProjectRosterPage` so the visible export button only opens the dialog. It passes its original `rows` prop rather than `RosterTable` filter state, so the displayed counts are filter-independent.
- The GET request remains `/projects/${project.id}/exports/roster`. It and workbook download run only after dialog confirmation; success closes the dialog only after both complete. Failures keep it open with `엑셀 명단을 내보내지 못했습니다. 다시 시도해 주세요.` and support retry. `exportingRef` remains the duplicate-request guard.

## TDD evidence

- RED: `ExportRosterDialog` module was unresolved, and the page test observed the GET request immediately after clicking the original export button.
- GREEN: `corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/ExportRosterDialog.test.tsx src/features/imports/export.test.ts` — 2 files, 8 tests passed.
- Formatting: targeted Biome check passed for all four modified web files.
- Root suite: `corepack pnpm@10.28.1 test` passed with 21 web test files / 295 tests, plus contracts, domain, and worker-capability suites.

## Verification concern

- `@event-roster/web run check` and `build` remain blocked before this task's code by the pre-existing `src/lib/excel/read-workbook.ts:43` mismatch: `NormalizedImportRow` now requires `role` and `grade`, while `normalizeSheet` returns neither. `git show HEAD` and blame confirm the affected implementation is unchanged by Task 8. This task's focused tests and formatting check pass.

## Self-review

- Confirmed summary inputs use parent `rows`, not table-filtered rows.
- Confirmed API/download are not called before confirmation, pending prevents confirm/close, errors remain visible, and retry performs a second API request.
