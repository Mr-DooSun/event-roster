# Organization Picker Portal and Recents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render organization search results above the participant modal without clipping and make the three most recently used organizations fast to reuse per user and project.

**Architecture:** Keep organization selection controlled by ID, move only the listbox into a fixed-position React Portal, and isolate viewport positioning in a pure function. Store up to three organization IDs in failure-tolerant `localStorage`, sort valid active candidates by that order, and record usage only after a roster addition and reload both succeed.

**Tech Stack:** React 19 (`createPortal`), TypeScript, Testing Library, Vitest, CSS fixed positioning, browser `localStorage`, Playwright Chromium, pnpm 10.28.1.

## Global Constraints

- Use the storage key `event-roster:recent-organizations:v1:<user-id>:<project-id>`.
- Store organization IDs only, newest first, with a maximum of 3.
- Scope recent data by both authenticated user ID and project ID.
- Record recency only after the participant-add API and the subsequent `onChanged()` reload both succeed.
- Never record on modal close, generic failure, `STALE_REVISION`, or `PROJECT_CLOSED`.
- Only active organizations linked to the current project may be displayed, selected by default, or retained as recent.
- New-participant mode defaults to the newest valid recent organization; existing-participant mode preserves the participant's current organization.
- Recent organizations remain first even while a search query filters the list.
- The listbox must render under `document.body` with `position: fixed` and above the modal backdrop.
- Place below the input when there is sufficient space; otherwise place above it; constrain height to the larger available side when both are tight.
- Preserve controlled ID semantics, Arrow/Enter navigation, Tab behavior, ARIA roles, and two-stage Escape behavior.
- Browser storage and position measurement failures must not prevent ordinary organization selection or participant submission.
- Add no runtime dependency.
- Use TDD for every behavior change and commit after each task.

---

### Task 1: Add Failure-Tolerant Recent Organization Utilities

**Files:**
- Create: `apps/web/src/lib/recent-organizations.ts`
- Create: `apps/web/src/lib/recent-organizations.test.ts`

**Interfaces:**
- Produces:

```ts
export interface OrganizationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function recentOrganizationStorageKey(
  userId: string,
  projectId: string,
): string;

export function readRecentOrganizationIds(input: {
  storage: OrganizationStorage | null;
  userId: string;
  projectId: string;
  validOrganizationIds: ReadonlySet<string>;
}): string[];

export function recordRecentOrganizationId(input: {
  storage: OrganizationStorage | null;
  userId: string;
  projectId: string;
  organizationId: string;
  validOrganizationIds: ReadonlySet<string>;
}): string[];

export function orderOrganizationsByRecent<T extends { id: string }>(
  organizations: readonly T[],
  recentOrganizationIds: readonly string[],
): T[];

export function getBrowserOrganizationStorage(): OrganizationStorage | null;
```

- [ ] **Step 1: Write failing utility tests**

Create tests for scoping, maximum length, deduplication, invalid IDs, corrupt
JSON, storage exceptions, and stable ordering:

```ts
it("scopes recent IDs by user and project and keeps newest three", () => {
  const storage = memoryStorage();
  const validOrganizationIds = new Set(["a", "b", "c", "d"]);

  for (const organizationId of ["a", "b", "c", "a", "d"]) {
    recordRecentOrganizationId({
      storage,
      userId: "user-1",
      projectId: "project-1",
      organizationId,
      validOrganizationIds,
    });
  }

  expect(
    readRecentOrganizationIds({
      storage,
      userId: "user-1",
      projectId: "project-1",
      validOrganizationIds,
    }),
  ).toEqual(["d", "a", "c"]);
  expect(
    readRecentOrganizationIds({
      storage,
      userId: "user-2",
      projectId: "project-1",
      validOrganizationIds,
    }),
  ).toEqual([]);
});

it("ignores corrupt data, inactive IDs, and storage failures", () => {
  const throwingStorage = {
    getItem() {
      throw new DOMException("denied");
    },
    setItem() {
      throw new DOMException("denied");
    },
  };

  expect(
    readRecentOrganizationIds({
      storage: throwingStorage,
      userId: "user-1",
      projectId: "project-1",
      validOrganizationIds: new Set(["active"]),
    }),
  ).toEqual([]);
  expect(
    recordRecentOrganizationId({
      storage: throwingStorage,
      userId: "user-1",
      projectId: "project-1",
      organizationId: "active",
      validOrganizationIds: new Set(["active"]),
    }),
  ).toEqual(["active"]);
});

it("moves recent organizations first without reordering the rest", () => {
  const organizations = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];
  expect(orderOrganizationsByRecent(organizations, ["c", "a"])).toEqual([
    organizations[2],
    organizations[0],
    organizations[1],
  ]);
});
```

The test helper uses a `Map<string, string>` and implements both
`OrganizationStorage` methods; it does not depend on jsdom localStorage:

```ts
function memoryStorage(): OrganizationStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
```

- [ ] **Step 2: Run the utility tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/lib/recent-organizations.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement storage parsing and stable ordering**

Use these constants and invariants:

```ts
const PREFIX = "event-roster:recent-organizations:v1";
const LIMIT = 3;

export function recentOrganizationStorageKey(
  userId: string,
  projectId: string,
) {
  return `${PREFIX}:${userId}:${projectId}`;
}
```

`readRecentOrganizationIds` must:

1. return `[]` for null storage;
2. catch `getItem` and `JSON.parse`;
3. accept only arrays;
4. keep only string IDs contained in `validOrganizationIds`;
5. remove duplicates while preserving first occurrence;
6. return at most three.

`recordRecentOrganizationId` must compute:

```ts
const current = readRecentOrganizationIds(input);
const next = [
  input.organizationId,
  ...current.filter((id) => id !== input.organizationId),
].filter((id) => input.validOrganizationIds.has(id)).slice(0, LIMIT);
```

Attempt `setItem` in `try/catch` and return `next` even if persistence fails.

`orderOrganizationsByRecent` must use an ID-to-rank map and original indexes
so unranked organizations preserve server order.

`getBrowserOrganizationStorage` must catch access to `window.localStorage`
itself:

```ts
export function getBrowserOrganizationStorage(): OrganizationStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run utility tests and Web check**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec \
  vitest run src/lib/recent-organizations.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected: all utility tests and TypeScript checks pass.

- [ ] **Step 5: Commit the recent utility**

```bash
git add apps/web/src/lib/recent-organizations.ts \
  apps/web/src/lib/recent-organizations.test.ts
git commit -m "feat: remember recent project organizations"
```

---

### Task 2: Add Pure Viewport Positioning

**Files:**
- Create: `apps/web/src/features/roster/organization-popover-position.ts`
- Create: `apps/web/src/features/roster/organization-popover-position.test.ts`

**Interfaces:**
- Produces:

```ts
export interface OrganizationPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

export function calculateOrganizationPopoverPosition(input: {
  anchor: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width">;
  viewportWidth: number;
  viewportHeight: number;
  desiredMaxHeight?: number;
  minimumUsefulHeight?: number;
  gap?: number;
  margin?: number;
}): OrganizationPopoverPosition;
```

- [ ] **Step 1: Write exact positioning tests**

```ts
it("places below when the lower viewport has useful space", () => {
  expect(
    calculateOrganizationPopoverPosition({
      anchor: { top: 100, right: 220, bottom: 144, left: 20, width: 200 },
      viewportWidth: 800,
      viewportHeight: 800,
    }),
  ).toEqual({
    top: 148,
    left: 20,
    width: 200,
    maxHeight: 288,
    placement: "bottom",
  });
});

it("flips above when the lower viewport is too small", () => {
  expect(
    calculateOrganizationPopoverPosition({
      anchor: { top: 700, right: 220, bottom: 744, left: 20, width: 200 },
      viewportWidth: 800,
      viewportHeight: 800,
    }),
  ).toEqual({
    top: 408,
    left: 20,
    width: 200,
    maxHeight: 288,
    placement: "top",
  });
});

it("clamps width and left edge inside a narrow viewport", () => {
  expect(
    calculateOrganizationPopoverPosition({
      anchor: { top: 100, right: 220, bottom: 144, left: -20, width: 240 },
      viewportWidth: 180,
      viewportHeight: 400,
    }),
  ).toMatchObject({ left: 8, width: 164 });
});
```

Defaults are `desiredMaxHeight=288`, `minimumUsefulHeight=144`, `gap=4`,
and `margin=8`.

- [ ] **Step 2: Run the positioning test to verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/organization-popover-position.test.ts
```

Expected: FAIL because the function does not exist.

- [ ] **Step 3: Implement deterministic placement**

Compute:

```ts
const availableBelow = Math.max(
  0,
  input.viewportHeight - margin - input.anchor.bottom - gap,
);
const availableAbove = Math.max(0, input.anchor.top - margin - gap);
const placement =
  availableBelow >= minimumUsefulHeight ||
  availableBelow >= availableAbove
    ? "bottom"
    : "top";
const maxHeight = Math.min(
  desiredMaxHeight,
  placement === "bottom" ? availableBelow : availableAbove,
);
const width = Math.min(
  input.anchor.width,
  Math.max(0, input.viewportWidth - margin * 2),
);
const left = Math.min(
  Math.max(input.anchor.left, margin),
  input.viewportWidth - margin - width,
);
const top =
  placement === "bottom"
    ? input.anchor.bottom + gap
    : Math.max(margin, input.anchor.top - gap - maxHeight);
```

Return finite, non-negative width and height values even for a tiny viewport.

- [ ] **Step 4: Run tests and commit**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/organization-popover-position.test.ts
git add \
  apps/web/src/features/roster/organization-popover-position.ts \
  apps/web/src/features/roster/organization-popover-position.test.ts
git commit -m "feat: calculate organization popover placement"
```

Expected: positioning tests pass before commit.

---

### Task 3: Render the Accessible Listbox in a Portal

**Files:**
- Create: `apps/web/src/features/roster/useOrganizationPopover.ts`
- Modify: `apps/web/src/features/roster/OrganizationSelectCombobox.tsx`
- Modify: `apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/styles/global.test.ts`

**Interfaces:**
- Consumes:

```ts
calculateOrganizationPopoverPosition(...)
orderOrganizationsByRecent(...)
```

- Produces:

```ts
export interface OrganizationSelectComboboxProps {
  label: string;
  organizations: Organization[];
  value: string;
  recentOrganizationIds?: readonly string[];
  disabled?: boolean;
  onChange(organizationId: string): void;
}
```

`useOrganizationPopover` consumes an input ref and `open`, and returns the
fixed style, placement, and listbox ref:

```ts
export function useOrganizationPopover(input: {
  open: boolean;
  anchorRef: RefObject<HTMLInputElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onRequestClose(): void;
}): {
  listboxRef: RefObject<HTMLDivElement | null>;
  popoverStyle: CSSProperties | null;
  placement: "top" | "bottom";
};
```

- [ ] **Step 1: Add Portal, placement, and stale-active tests**

Add these assertions to `OrganizationSelectCombobox.test.tsx`:

```ts
it("renders the listbox under document.body above the modal", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  fireEvent.focus(screen.getByRole("combobox", { name: "소속 조직" }));
  const listbox = screen.getByRole("listbox");
  expect(listbox.parentElement).toBe(document.body);
  expect(listbox).toHaveAttribute("data-placement", "bottom");
});

it("recalculates placement on captured scroll and viewport resize", () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      top: 700,
      right: 220,
      bottom: 744,
      left: 20,
      width: 200,
      height: 44,
      x: 20,
      y: 700,
      toJSON: () => ({}),
    });
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  fireEvent.focus(screen.getByRole("combobox"));
  expect(screen.getByRole("listbox")).toHaveAttribute("data-placement", "top");
  rect.mockReturnValue({
    top: 20,
    right: 220,
    bottom: 64,
    left: 20,
    width: 200,
    height: 44,
    x: 20,
    y: 20,
    toJSON: () => ({}),
  });
  fireEvent.scroll(window);
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("listbox")).toHaveAttribute(
    "data-placement",
    "bottom",
  );
});

it("clears stale keyboard activation when candidates shrink", () => {
  const { rerender } = render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  rerender(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={[organizations[0]]}
      value=""
      onChange={vi.fn()}
    />,
  );
  expect(input).not.toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(input, { key: "Enter" });
});
```

Also assert a recent order:

```ts
expect(
  screen.getAllByRole("option").map((option) => option.textContent),
).toEqual(["황룡사", "성룡사"]);
```

when `recentOrganizationIds={["org-2"]}`.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/styles/global.test.ts
```

Expected: FAIL because the listbox is still inside the component container,
no recent prop exists, and stale active state remains.

- [ ] **Step 3: Implement the positioning hook**

`useOrganizationPopover` must:

- read the anchor with `getBoundingClientRect`;
- call `calculateOrganizationPopoverPosition`;
- return `CSSProperties` with `position: "fixed"`, pixel `top`, `left`,
  `width`, and `maxHeight`;
- register `resize` and capture-phase `scroll` only while open;
- register a capture-phase document `pointerdown` while open and call
  `onRequestClose` only when neither `containerRef` nor `listboxRef` contains
  the event target;
- remove resize, scroll, and pointer listeners on close/unmount;
- call `onRequestClose` when the anchor is disconnected;
- fall back to a below placement constrained to `window.innerHeight` if
  measurement throws.

Use `requestAnimationFrame` to coalesce repeated scroll events, and cancel
the pending frame during cleanup.

- [ ] **Step 4: Move the listbox to a Portal**

Import:

```ts
import { createPortal } from "react-dom";
import { orderOrganizationsByRecent } from "../../lib/recent-organizations";
```

After filtering, order options:

```ts
const options = useMemo(() => {
  const key = canonicalizeOrganizationInput(query);
  const filtered = organizations.filter(
    (organization) =>
      organization.isActive &&
      (!key ||
        canonicalizeOrganizationInput(organization.name).includes(key)),
  );
  return orderOrganizationsByRecent(filtered, recentOrganizationIds);
}, [organizations, query, recentOrganizationIds]);
```

Render the list only when `open`, `document` exists, and a position is
available:

```tsx
{open && popoverStyle
  ? createPortal(
      <div
        ref={listboxRef}
        id={listboxId}
        className="er-combobox-list er-combobox-list--portal"
        role="listbox"
        data-placement={placement}
        style={popoverStyle}
      >
        {options.length === 0 ? (
          <p className="er-combobox-empty">
            일치하는 조직이 없습니다.
          </p>
        ) : (
          options.map((organization, index) => (
            <button
              key={organization.id}
              id={`${listboxId}-option-${index}`}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              className="er-combobox-option"
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={organization.id === value}
              data-active={activeIndex === index || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(organization)}
            >
              {organization.name}
            </button>
          ))
        )}
      </div>,
      document.body,
    )
  : null}
```

Outside-pointer and focus-leave checks must treat both `containerRef` and
`listboxRef` as internal. Keep options at `tabIndex={-1}` and keep
`onMouseDown={(event) => event.preventDefault()}` so clicking an option does
not blur the input before selection.

Reset `activeIndex` to `-1` whenever the ordered option ID sequence changes.

- [ ] **Step 5: Add Portal CSS and structural test**

Keep shared listbox visuals, but split placement:

```css
.er-combobox-list--portal {
  z-index: 110;
  right: auto;
  bottom: auto;
  overflow-y: auto;
}
```

The inline fixed style owns coordinates and height. Add a CSS test:

```ts
expect(stylesheet).toMatch(
  /\.er-combobox-list--portal\s*\{[^}]*z-index:\s*110;/s,
);
```

- [ ] **Step 6: Run focused accessibility and CSS tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/organization-popover-position.test.ts \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/styles/global.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Extend the file's `afterEach` with `vi.unstubAllGlobals()` so animation-frame
stubs cannot leak into later keyboard tests.

Expected: Portal, positioning, recent ordering, Arrow/Enter, Tab, blur,
outside pointer, stale-active, ARIA, and two-stage Escape tests pass.

- [ ] **Step 7: Commit the Portal**

```bash
git add apps/web/src/features/roster/useOrganizationPopover.ts \
  apps/web/src/features/roster/OrganizationSelectCombobox.tsx \
  apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx \
  apps/web/src/styles/global.css apps/web/src/styles/global.test.ts
git commit -m "feat: render organization picker above dialogs"
```

---

### Task 4: Connect Recent Organizations to Successful Roster Adds

**Files:**
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Consumes recent utility functions from Task 1 and
  `recentOrganizationIds?: readonly string[]` from Task 3.
- Produces: successful existing/new participant additions update recency;
  reopening new-participant mode defaults to the latest valid recent ID.

- [ ] **Step 1: Write new-mode and existing-mode component tests**

Add:

```ts
it("defaults a new participant to the newest valid recent organization", () => {
  render(
    <ParticipantDialog
      participants={participants}
      organizations={organizations}
      recentOrganizationIds={["org-2", "org-inactive"]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "황룡사",
  );
});

it("keeps an existing participant organization while ordering recent options", () => {
  render(
    <ParticipantDialog
      participants={[{ ...participants[0], organizationId: "org-1" }]}
      organizations={organizations}
      recentOrganizationIds={["org-2"]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(input).toHaveValue("성룡사");
  fireEvent.focus(input);
  expect(screen.getAllByRole("option")[0]).toHaveTextContent("황룡사");
});
```

- [ ] **Step 2: Write ProjectRosterPage success/failure persistence tests**

Set localStorage for `user-1` and `project-1`, add a new participant to
`org-2`, resolve both POST and reload, then assert:

```ts
expect(
  JSON.parse(
    localStorage.getItem(
      "event-roster:recent-organizations:v1:user-1:project-1",
    ) ?? "null",
  ),
).toEqual(["org-2"]);
```

Add separate cases where POST rejects and where POST returns
`STALE_REVISION`; assert the same key remains null. Add a rerender with
`project-2` or `user-2` and assert no default leaks across the key boundary.

- [ ] **Step 3: Run roster tests to verify RED**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx
```

Expected: FAIL because ParticipantDialog has no recent prop and successful
mutations do not update localStorage.

- [ ] **Step 4: Add recent IDs to ParticipantDialog**

Extend props:

```ts
recentOrganizationIds?: readonly string[];
```

Default it to an empty array while destructuring the component props:

```ts
recentOrganizationIds = [],
```

Create a helper:

```ts
function firstActiveOrganizationId(
  organizations: Organization[],
  recentOrganizationIds: readonly string[],
) {
  return (
    orderOrganizationsByRecent(
      organizations.filter((organization) => organization.isActive),
      recentOrganizationIds,
    )[0]?.id ?? ""
  );
}
```

Use it only for the new-participant `organizationId` initial state. Keep
`initialConfirmedOrganizationId` unchanged so existing participants preserve
their own organization/fallback semantics.

Pass `recentOrganizationIds` to both combobox instances so search ordering is
consistent.

- [ ] **Step 5: Load and record recency in ProjectRosterPage**

Build the valid set from active organizations and load state using:

```ts
const authenticatedUserId = auth?.session.user.id ?? "";
const validOrganizationIds = useMemo(
  () =>
    new Set(
      organizations
        .filter((organization) => organization.isActive)
        .map((organization) => organization.id),
    ),
  [organizations],
);
const [recentOrganizationIds, setRecentOrganizationIds] = useState<string[]>(
  () =>
    authenticatedUserId
      ? readRecentOrganizationIds({
          storage: getBrowserOrganizationStorage(),
          userId: authenticatedUserId,
          projectId: project.id,
          validOrganizationIds,
        })
      : [],
);

useEffect(() => {
  if (!authenticatedUserId) {
    setRecentOrganizationIds([]);
    return;
  }
  setRecentOrganizationIds(
    readRecentOrganizationIds({
      storage: getBrowserOrganizationStorage(),
      userId: authenticatedUserId,
      projectId: project.id,
      validOrganizationIds,
    }),
  );
}, [authenticatedUserId, project.id, validOrganizationIds]);
```

Use a stable helper:

```ts
function rememberOrganization(organizationId: string) {
  if (!authenticatedUserId) return;
  setRecentOrganizationIds(
    recordRecentOrganizationId({
      storage: getBrowserOrganizationStorage(),
      userId: authenticatedUserId,
      projectId: project.id,
      organizationId,
      validOrganizationIds,
    }),
  );
}
```

Call `rememberOrganization(input.organizationId)` only inside each
`if (completed)` branch, after `handleMutation` has successfully awaited
`onChanged()`, immediately before closing the modal.

Pass `recentOrganizationIds` into `ParticipantDialog`.

- [ ] **Step 6: Run roster tests and Web check**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/lib/recent-organizations.test.ts \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected: recent default, existing participant preservation, successful-only
recording, invalid-ID cleanup, and user/project isolation pass.

- [ ] **Step 7: Commit the roster integration**

```bash
git add apps/web/src/features/roster/ParticipantDialog.tsx \
  apps/web/src/features/roster/ProjectRosterPage.tsx \
  apps/web/src/features/roster/roster.test.tsx
git commit -m "feat: prioritize recent roster organizations"
```

---

### Task 5: Add Browser Regression Coverage and Verify

**Files:**
- Modify: `apps/web/e2e/project-roster.spec.ts`
- Verify all organization picker and roster files.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: browser evidence that the Portal is unclipped, recent selection
  survives modal reopen and page reload, and the complete application remains
  deployable.

- [ ] **Step 1: Add one E2E flow for Portal and recent selection**

Extend the existing roster scenario:

```ts
await page.getByRole("button", { name: "참가자 추가" }).click();
await page.getByRole("button", { name: "새 참가자" }).click();
const organization = page.getByRole("combobox", { name: "소속 조직" });
await organization.fill("황룡사");
await expect(page.getByRole("listbox")).toBeVisible();
const geometry = await page.getByRole("listbox").evaluate((element) => ({
  parent: element.parentElement === document.body,
  zIndex: Number(getComputedStyle(element).zIndex),
  top: element.getBoundingClientRect().top,
  bottom: element.getBoundingClientRect().bottom,
  viewport: window.innerHeight,
}));
expect(geometry).toMatchObject({ parent: true, zIndex: 110 });
expect(geometry.top).toBeGreaterThanOrEqual(0);
expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
await page.getByRole("option", { name: "황룡사" }).click();
await page.getByLabel("이름").fill("최근 조직 참가자");
await page.getByRole("button", { name: "참가자 생성 후 추가" }).click();

await page.reload();
await page.getByRole("button", { name: "참가자 추가" }).click();
await page.getByRole("button", { name: "새 참가자" }).click();
await expect(page.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
  "황룡사",
);
```

- [ ] **Step 2: Run focused Web and E2E tests**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/lib/recent-organizations.test.ts \
  src/features/roster/organization-popover-position.test.ts \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/features/roster/roster.test.tsx \
  src/styles/global.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-roster.spec.ts
```

Expected: all focused tests and Chromium roster scenario pass.

- [ ] **Step 3: Run full static and test verification**

```bash
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 test
```

Expected: every command exits 0.

- [ ] **Step 4: Build and verify the Worker bundle**

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler deploy --dry-run
git diff --check
```

Expected: production build, all Chromium E2E, Worker dry-run, and whitespace
check pass. No remote deployment occurs.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add apps/web/e2e/project-roster.spec.ts
git commit -m "test: cover recent organization picker workflow"
```

If formatting changed tracked source files, include those exact files in this
commit only when the diff is formatting-only; otherwise amend the owning task.
