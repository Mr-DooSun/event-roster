# Task 3 Report: Accessible Organization Portal

## Status

Completed.

## RED

Added behavior-focused coverage for:

- rendering the listbox under `document.body` with fixed bottom/top placement;
- captured scroll, viewport resize, RAF coalescing, and pending-frame cleanup;
- measurement failure and disconnected-anchor fallbacks;
- inside/outside pointer handling;
- recent-organization ordering and stale active-option cleanup;
- Portal stacking CSS.

Then ran:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/styles/global.test.ts
```

The run failed with nine expected behavior failures: the listbox was still
inside the component, had no placement/style data, registered no position or
outside-pointer listeners, did not use recent ordering, retained a stale
active descendant, and had no Portal CSS.

## GREEN

Implemented `useOrganizationPopover` and moved the listbox to a
`document.body` Portal. The hook:

- uses `calculateOrganizationPopoverPosition`;
- owns fixed coordinates, placement, and constrained height;
- updates on resize and capture-phase scroll;
- coalesces scroll measurements with `requestAnimationFrame`;
- treats the input container and Portal listbox as internal pointer/focus
  targets;
- closes for disconnected anchors and falls back safely when measurement
  throws;
- removes listeners and cancels pending animation frames on close/unmount.

The combobox now orders filtered active organizations by recent ID, resets
keyboard activation when the ordered ID sequence changes, and preserves
controlled selection, Arrow/Enter, Tab, ARIA, and two-stage Escape behavior.

Focused verification:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/organization-popover-position.test.ts \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/styles/global.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Results: 24 focused tests passed; both TypeScript checks passed.

Full web regression:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web test
```

Results: 19 test files and 252 tests passed.

Formatting/lint verification:

```sh
corepack pnpm@10.28.1 exec biome check \
  apps/web/src/features/roster/useOrganizationPopover.ts \
  apps/web/src/features/roster/OrganizationSelectCombobox.tsx \
  apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx \
  apps/web/src/styles/global.css \
  apps/web/src/styles/global.test.ts
```

Result: five changed source/test files checked with no errors.

## Changed Files

- `apps/web/src/features/roster/useOrganizationPopover.ts`
- `apps/web/src/features/roster/OrganizationSelectCombobox.tsx`
- `apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx`
- `apps/web/src/styles/global.css`
- `apps/web/src/styles/global.test.ts`

## Self-Review

- The Portal is stacked at `z-index: 110`, above the dialog backdrop at 100.
- Scroll, resize, pointer, cleanup, fallback, and stale-option boundaries have
  direct behavior assertions.
- The focused suite also covers Arrow/Enter, Tab, blur, ARIA, and first/second
  Escape behavior.
- No runtime dependency or lockfile changed.
- `git diff --check` completed without whitespace errors.

## Concerns

No blocking concerns. The measurement-failure fallback intentionally uses
zero anchor geometry because viewport-relative anchor coordinates are
unavailable after `getBoundingClientRect` throws; keyboard selection remains
available and the list height stays constrained to the viewport.

## Commit

`feat: render organization picker above dialogs`

---

## Important Fix Round 1: Visible Measurement Fallback

### Finding

The first measurement exception used a synthetic zero-width anchor. That
produced `width: 0px` while the combobox remained expanded, so the Portal
listbox could be effectively invisible.

### RED

Strengthened the first-failure test to require finite positive width and
height, bottom placement, viewport bounds, and successful pointer selection.
Added a second test that measures a 200px anchor successfully, narrows the
viewport to 180px, then throws on resize and expects the cached anchor to
recalculate to the viewport-safe 164px width.

Both tests failed before the fix:

- the first fallback returned `width: 0px`;
- the later fallback discarded the previous anchor and collapsed back to
  `top: 4px; width: 0px`.

### GREEN

`useOrganizationPopover` now copies the last anchor geometry whose position
calculation succeeded. A later measurement exception recalculates from that
geometry against the current viewport. If the first measurement fails, the
hook uses the input's positive `clientWidth` or `offsetWidth`, then a bounded
320px default; the existing position calculator clamps it inside the viewport.
Layout-width access is also guarded so the measurement failure path cannot
leak an exception.

Verification:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/organization-popover-position.test.ts \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/styles/global.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web check
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 exec biome check \
  apps/web/src/features/roster/useOrganizationPopover.ts \
  apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx
```

Results:

- focused: 25 tests passed;
- full web: 19 test files, 253 tests passed;
- TypeScript and e2e TypeScript checks passed;
- Biome passed with no errors.

### Concerns

No blocking concerns. When no valid geometry or layout width has ever been
available, the 320px default is intentionally clamped by the existing 8px
viewport margins; exact input alignment is unknowable, but the listbox remains
visible and selectable.

### Commit

`fix: keep organization fallback list visible`
