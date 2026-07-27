# Final Fix Report — Organization Picker Portal and Recents

**Worktree:** `/Users/coursemos/develop/event-roster/.worktrees/automatic-preregistration-org-picker`
**Branch:** `codex/automatic-preregistration-org-picker`
**Commit subject:** `fix: finalize organization picker regressions`

## Fixes

### Top-placement geometry

- The pure position calculation now returns the top-placement attachment edge
  at `anchor.top - gap` instead of subtracting the maximum allowed listbox
  height.
- The Portal style applies `transform: translateY(-100%)` only for top
  placement, so the listbox's actual rendered height determines its top edge.
- Existing placement selection, viewport margins, width and `maxHeight`
  clamping, measurement fallback, captured scroll/resize updates, and
  `document.body` Portal behavior remain unchanged.
- The browser regression uses a `900 × 480` viewport, requires top placement,
  and verifies that the rendered listbox bottom is within 1 px of
  `anchor.top - 4`.

### Defensive regression coverage

- Added direct coverage for `getBrowserOrganizationStorage()` when `window` is
  unavailable and when reading the `localStorage` property throws.
- Added a roster integration test that changes the organization selection,
  closes the modal without submission, and verifies the raw localStorage value
  is byte-for-byte unchanged.

## TDD evidence

- RED: the focused four-file run reported 2 failures out of 64 tests.
  - Pure positioning returned `top: 408` instead of the anchor-adjacent
    `top: 696`.
  - The rendered top-placement listbox had `top: 408px` and no
    `translateY(-100%)`.
- GREEN: after the two production changes, the identical focused run passed
  4 files / 64 tests.
- The broader focused run including CSS structure passed 5 files / 66 tests.
- The storage and modal-close additions are regression coverage for existing
  defensive behavior and passed in the initial RED run.

## Verification evidence

| Command | Exit | Result |
| --- | ---: | --- |
| Focused Web Vitest command | 0 | 5 files / 66 tests passed. |
| `corepack pnpm@10.28.1 format:check` | 0 | 248 files checked; no fixes applied. |
| `corepack pnpm@10.28.1 check` | 0 | All 6 applicable workspace static checks passed. |
| `corepack pnpm@10.28.1 test` | 0 | 60 files / 497 tests passed: contracts 1/11, workers-free capability 6/19, workers-bcrypt capability 5/23, domain 4/10, web 19/268, worker 25/166. |
| `corepack pnpm@10.28.1 --filter @event-roster/web build` | 0 | Production build passed; 157 modules transformed. |
| Local-only `e2e:prepare` | 0 | Fresh isolated local E2E state prepared without printing secrets. |
| `corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test` | 0 | Full Chromium suite passed 6/6, including actual top-placement geometry. |
| `corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run` | 0 | Bundle assembled at 873.06 KiB, gzip 148.25 KiB, then exited at `--dry-run`. |
| `git diff --check` | 0 | No whitespace errors before staging. |

## Environment notices, separate from failures

- The first sandboxed full-test attempt could not write Wrangler logs under
  the user preferences directory or listen on `127.0.0.1`. The unchanged
  command passed after the required local permissions were granted; this was
  not a product or test assertion failure.
- The first sandboxed `e2e:prepare` attempt was likewise blocked from local
  Wrangler state access. The unchanged local-only command passed with the
  required permission.
- The workers-bcrypt capability probe printed its existing warnings for
  optional `DUMMY_BCRYPT_HASH` and `CAPABILITY_PROBE_TOKEN` values. No secret
  was injected and no runtime behavior was changed.
- Playwright printed the existing `NO_COLOR`/`FORCE_COLOR` notice.
- Wrangler reported that a newer CLI version is available. The pinned project
  version completed the dry-run successfully.

## Remote safety and concerns

- No remote deployment, migration, push, or other remote mutation was
  executed.
- No release blocker or remaining product concern was found.
