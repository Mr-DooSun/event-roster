# Final Fix Report

## Addressed important findings

1. In ordinary bulk mode, selecting one or more existing organizations disables the new-organization name input and create action. Removing the last selection enables them again.
2. In ordinary bulk mode, selecting an organization with an inactive (and non-deleted) project membership displays: `기존 명단과 집계 이력이 있으면 그대로 다시 연결됩니다.`
3. Worker integration coverage now asserts no `PROJECT_ORGANIZATION` membership audit is written for rejected mixed inactive/deleted requests, and covers rollback for a deleted requested organization. The existing active-membership rejection also asserts its original audit count is unchanged.

## TDD evidence

- Added the two panel regressions before the UI implementation; the focused web run failed on the expected missing disabled state and warning.
- Added Worker rollback/audit assertions. The deleted fixture initially violated the database deletion trigger, so its setup was corrected to mark the organization inactive together with deletion fields before verifying the service behavior.

## Verification

- `corepack pnpm --filter @event-roster/web test -- src/features/projects/project-detail.test.tsx` — 25 files, 383 tests passed.
- `corepack pnpm --filter @event-roster/worker test -- project-organizations.integration.test.ts` — passed.
- `corepack pnpm --filter @event-roster/web check` — passed.
- `corepack pnpm --filter @event-roster/worker check` — passed.
- `corepack pnpm exec biome check apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/projects/project-detail.test.tsx apps/worker/test/project-organizations.integration.test.ts` — passed.
- `git diff --check` — passed.
