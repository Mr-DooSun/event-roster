# Task 2 Report: Pure Viewport Positioning

## Status

Completed.

## RED

Added four behavior-focused tests, then ran:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/organization-popover-position.test.ts
```

The suite failed as expected because `./organization-popover-position` did not exist.

## GREEN

Implemented `calculateOrganizationPopoverPosition` with the specified defaults:

- `desiredMaxHeight`: 288
- `minimumUsefulHeight`: 144
- `gap`: 4
- `margin`: 8

It deterministically selects below or above, constrains height and width, and clamps the horizontal position according to the task formula. The tiny viewport test confirms width and maxHeight remain finite and non-negative at zero viewport dimensions.

Verification passed:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/roster/organization-popover-position.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Results: 4 positioning tests passed; TypeScript and e2e TypeScript checks passed.

## Changed Files

- `apps/web/src/features/roster/organization-popover-position.ts`
- `apps/web/src/features/roster/organization-popover-position.test.ts`

## Self-Review

- Hand-derived test expectations cover normal below placement, top flip, narrow-width clamp, and the zero-size viewport boundary.
- The implementation matches the provided placement, sizing, left, and top equations.
- `git diff --check` completed without whitespace errors.

## Commit

`feat: calculate organization popover placement`
