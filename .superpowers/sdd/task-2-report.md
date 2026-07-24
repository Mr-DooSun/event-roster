# Task 2 report: authentication and app-shell loading feedback

## RED

Command:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Result: 3 expected failures. The new login pending assertion revealed no request had yet been awaited, password-change loading text was absent, and the RESTORING view had no `role="status"`.

## GREEN

Command:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Result: `Test Files 13 passed (13)`, `Tests 129 passed (129)`.

## Changed files

- `apps/web/src/features/auth/LoginPage.tsx`
- `apps/web/src/features/auth/ChangePasswordPage.tsx`
- `apps/web/src/features/auth/RecoveryPage.tsx`
- `apps/web/src/features/auth/BootstrapHandoffPage.tsx`
- `apps/web/src/app/router.tsx`
- `apps/web/src/app/AppShell.tsx`
- `apps/web/src/features/auth/auth.test.tsx`
- `apps/web/src/app/App.test.tsx`

## Verification

- `corepack pnpm@10.28.1 --filter @event-roster/web run check` passed (`tsc --noEmit` and E2E TypeScript config).
- `git diff --check` passed.
- Auth validation/error behavior and `AuthProvider` session/logout flow were left unchanged; local submit/logout state is restored in `finally`.

## Self-review

- Each requested auth mutation now guards duplicate submission after validation, uses `Button.loading` and its page-specific text, and resets state in `finally`.
- Bootstrap input state remains untouched on failures.
- Auth restoration and lazy import fallbacks use `LoadingStatus`; AppShell logout has local progress feedback and a duplicate-action guard.

## Review follow-up: logout visibility and lazy fallback busy state

### RED

Command:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Result: 2 expected failures. During a pending logout the provider's immediate RESTORING render replaced AppShell before `로그아웃 중…` could appear; the lazy import fallback had no busy ancestor.

### GREEN

Command:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Result: `Test Files 13 passed (13)`, `Tests 131 passed (131)`.

### Changes and verification

- `AuthProvider.logout` now clears only its internal auth reference before awaiting the request. This keeps the rendered AppShell mounted for its local pending feedback while preventing later API calls from reading the old credentials; it still commits anonymous state and navigates in `finally`.
- The lazy ImportWizard fallback is wrapped in an explicit `aria-busy="true"` container.
- Added pending logout and busy-fallback assertions to `auth.test.tsx` and `App.test.tsx`.
- `corepack pnpm@10.28.1 --filter @event-roster/web run check` and `git diff --check` passed.
