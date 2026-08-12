# Project Organization Tile Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project organization list with visually distinct two-column tiles that emphasize roster counts and paginate eight organizations at a time.

**Architecture:** Keep data and mutations in `ProjectOrganizationsPanel`; pagination is presentation-only over the existing `visibleMemberships` array. Render each membership with semantic tile classes and a deterministic organization-ID color index, then add an accessible page controller below the grid.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, Biome

## Global Constraints

- Do not change Worker APIs, database schema, or contracts.
- Keep organization add-picker behavior, permissions, loading states, exclusion confirmation, and correction-mode behavior unchanged.
- Use two columns on desktop and one column on narrow screens.
- Use the organization ID to produce a stable six-color accent index; never rely on color alone for identification.
- Emphasize `rosterCount`, including zero, as the primary numeric fact.
- Paginate `visibleMemberships` with a fixed page size of 8 and no page-size selector.
- Do not add organization search, filters, or sorting.

---

### Task 1: Organization Membership Tiles and Roster Count Hierarchy

**Files:**
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx:396-605`
- Modify: `apps/web/src/styles/global.css:770-850`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx:1213-1300`

**Interfaces:**
- Consumes: existing `ProjectOrganization`, `getTotalOrganizationManagerCount()`, permission props, and mutation callbacks.
- Produces: `organizationColorIndex(organizationId: string): number`, `.er-project-organization-grid`, `.er-project-organization-tile`, and `.er-membership-roster-count` DOM contracts.

- [ ] **Step 1: Write the failing tile and roster-count test**

Add beside the existing leadership metadata test:

```tsx
it("renders visually distinct organization tiles with prominent roster counts", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[
        organizationMembership({ rosterCount: 0 }),
        organizationMembership({
          organizationId: "org-2",
          name: "2팀",
          rosterCount: 11,
        }),
      ]}
      allOrganizations={[]}
      canMutateMemberships={false}
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const list = screen.getByRole("list", { name: "프로젝트 조직 목록" });
  expect(list).toHaveClass("er-project-organization-grid");
  const tiles = within(list).getAllByRole("listitem");
  expect(tiles).toHaveLength(2);
  expect(tiles[0]).toHaveClass("er-project-organization-tile");
  expect(tiles[0]).toHaveAttribute("data-color-index");
  expect(tiles[1]).toHaveAttribute("data-color-index");
  expect(within(tiles[0]!).getByLabelText("현재 명단 0명")).toHaveClass(
    "er-membership-roster-count",
  );
  expect(within(tiles[1]!).getByLabelText("현재 명단 11명")).toHaveTextContent(
    "11명",
  );
});
```

Update the existing leadership test to query the roster count by `getByLabelText("현재 명단 11명")`, while retaining leader, manager-count, and permission assertions.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/projects/project-detail.test.tsx -t "visually distinct organization tiles|leadership metadata" --reporter=dot
```

Expected: FAIL because the labeled grid, tile classes, color index, and emphasized count do not exist.

- [ ] **Step 3: Implement stable tile markup**

Add the deterministic six-color hash pattern used by `RosterTable`:

```ts
function organizationColorIndex(organizationId: string) {
  let hash = 0;
  for (const character of organizationId) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % 6;
}
```

Change the list and item roots while keeping the existing callbacks and permission branches:

```tsx
<ul className="er-project-organization-grid" aria-label="프로젝트 조직 목록">
  {visibleMemberships.map((membership) => (
    <OrganizationMembershipRow key={membership.organizationId} {...props} />
  ))}
</ul>
```

```tsx
<li
  className="er-project-organization-tile"
  data-color-index={organizationColorIndex(membership.organizationId)}
>
  <div className="er-organization-membership">
    <div className="er-membership-heading">
      <strong>{membership.name}</strong>
      <span className="er-membership-state">...</span>
    </div>
    <div
      className="er-membership-roster-count"
      aria-label={`현재 명단 ${membership.rosterCount}명`}
    >
      <strong>{membership.rosterCount}</strong><span>명</span>
    </div>
    <div className="er-membership-meta">...</div>
    <div className="er-membership-actions">...</div>
  </div>
</li>
```

Move the management link and existing mutate button into `.er-membership-actions` without changing labels, callbacks, loading, or disabled states.

- [ ] **Step 4: Add tile and count styles**

```css
.er-project-organization-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--er-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.er-project-organization-tile {
  display: grid;
  min-width: 0;
  border: 1px solid var(--er-color-border);
  border-left: 5px solid var(--er-organization-accent);
  border-radius: var(--er-radius-md);
  padding: var(--er-space-5);
  background: var(--er-color-surface);
}
.er-project-organization-tile[data-color-index="0"] { --er-organization-accent: #4770db; }
.er-project-organization-tile[data-color-index="1"] { --er-organization-accent: #7b61c9; }
.er-project-organization-tile[data-color-index="2"] { --er-organization-accent: #3a9384; }
.er-project-organization-tile[data-color-index="3"] { --er-organization-accent: #c17a3b; }
.er-project-organization-tile[data-color-index="4"] { --er-organization-accent: #458092; }
.er-project-organization-tile[data-color-index="5"] { --er-organization-accent: #b65f6a; }
.er-membership-heading,
.er-membership-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--er-space-3);
}
.er-membership-roster-count {
  display: flex;
  align-items: flex-end;
  gap: var(--er-space-1);
  color: var(--er-color-primary);
}
.er-membership-roster-count strong { font-size: 1.75rem; line-height: 1; }
.er-membership-roster-count span { color: var(--er-color-muted); }
```

At `max-width: 60rem`, use one grid column. At the mobile breakpoint, allow `.er-membership-actions` to wrap or stack.

- [ ] **Step 5: Run project-detail tests and verify GREEN**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/projects/project-detail.test.tsx --reporter=dot
```

Expected: all project-detail tests PASS, including unchanged permissions and mutations.

- [ ] **Step 6: Commit the tile deliverable**

```bash
git add apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/styles/global.css
git commit -m "feat: present project organizations as tiles"
```

---

### Task 2: Eight-Organization Client Pagination

**Files:**
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx:63-145,396-435`
- Modify: `apps/web/src/styles/global.css:770-890`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx:1213-1350`

**Interfaces:**
- Consumes: `visibleMemberships` and the tile DOM contract from Task 1.
- Produces: `ORGANIZATION_PAGE_SIZE = 8`, `currentPage`, `pagedMemberships`, and `nav[aria-label="프로젝트 조직 페이지네이션"]`.

- [ ] **Step 1: Write failing pagination tests**

Use the existing explicit panel props instead of introducing a shared fixture:

```tsx
it("paginates project organization tiles eight at a time", () => {
  const memberships = Array.from({ length: 10 }, (_, index) =>
    organizationMembership({
      organizationId: `org-${index + 1}`,
      name: `${index + 1}팀`,
    }),
  );
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={memberships}
      allOrganizations={[]}
      canMutateMemberships={false}
      canManageOrganizations={false}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const list = screen.getByRole("list", { name: "프로젝트 조직 목록" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  expect(screen.getByText("총 10개 조직 · 1–8개 표시")).toBeVisible();
  expect(screen.queryByText("9팀")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText("총 10개 조직 · 9–10개 표시")).toBeVisible();
  expect(screen.getByRole("button", { name: "2페이지" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
```

Add a rerender test that moves to page 2, rerenders with one organization, and verifies page 1 becomes current, previous/next are disabled, and the remaining organization is visible. Extend the empty-membership test to assert that `queryByRole("navigation", { name: "프로젝트 조직 페이지네이션" })` is absent.

- [ ] **Step 2: Run pagination tests and verify RED**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/projects/project-detail.test.tsx -t "paginates project organization|shrinks the organization page|hides deleted memberships" --reporter=dot
```

Expected: FAIL because all memberships render and pagination is absent.

- [ ] **Step 3: Implement state and range calculations**

```tsx
const ORGANIZATION_PAGE_SIZE = 8;
const [currentPage, setCurrentPage] = useState(1);
const pageCount = Math.max(
  1,
  Math.ceil(visibleMemberships.length / ORGANIZATION_PAGE_SIZE),
);
const safePage = Math.min(currentPage, pageCount);
const firstIndex = (safePage - 1) * ORGANIZATION_PAGE_SIZE;
const pagedMemberships = visibleMemberships.slice(
  firstIndex,
  firstIndex + ORGANIZATION_PAGE_SIZE,
);
const rangeStart = visibleMemberships.length === 0 ? 0 : firstIndex + 1;
const rangeEnd = Math.min(
  firstIndex + ORGANIZATION_PAGE_SIZE,
  visibleMemberships.length,
);

useEffect(() => {
  if (currentPage > pageCount) setCurrentPage(pageCount);
}, [currentPage, pageCount]);
```

Render `pagedMemberships`; do not reset the page for loading or dialog state changes.

- [ ] **Step 4: Add accessible page controls inside the non-empty branch**

```tsx
<nav
  className="er-project-organization-pagination"
  aria-label="프로젝트 조직 페이지네이션"
>
  <span>총 {visibleMemberships.length}개 조직 · {rangeStart}–{rangeEnd}개 표시</span>
  <div className="er-project-organization-pagination__pages">
    <Button
      type="button"
      variant="secondary"
      aria-label="이전 페이지"
      disabled={safePage === 1}
      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
    >이전</Button>
    {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
      <Button
        key={page}
        type="button"
        variant={page === safePage ? "primary" : "secondary"}
        aria-label={`${page}페이지`}
        aria-current={page === safePage ? "page" : undefined}
        onClick={() => setCurrentPage(page)}
      >{page}</Button>
    ))}
    <Button
      type="button"
      variant="secondary"
      aria-label="다음 페이지"
      disabled={safePage === pageCount}
      onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
    >다음</Button>
  </div>
</nav>
```

- [ ] **Step 5: Style pagination and mobile layout**

```css
.er-project-organization-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--er-space-4);
  margin-top: var(--er-space-5);
  color: var(--er-color-muted);
  font-size: 0.875rem;
}
.er-project-organization-pagination__pages {
  display: flex;
  flex-wrap: wrap;
  gap: var(--er-space-2);
}
.er-project-organization-pagination__pages .er-button {
  min-width: 2.5rem;
  padding: var(--er-space-2) var(--er-space-3);
}
```

At `max-width: 42rem`, stack summary and controls with `align-items: stretch`.

- [ ] **Step 6: Run project-detail and full web tests**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/projects/project-detail.test.tsx --reporter=dot
corepack pnpm --filter @event-roster/web test -- --reporter=dot
```

Expected: project-detail tests and all web test files PASS.

- [ ] **Step 7: Commit pagination**

```bash
git add apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/styles/global.css
git commit -m "feat: paginate project organization tiles"
```

---

### Task 3: Full Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed tile and pagination implementation.
- Produces: verification evidence for integration.

- [ ] **Step 1: Run repository type checks**

```bash
corepack pnpm -r run check
```

Expected: every workspace package exits 0.

- [ ] **Step 2: Run Biome**

```bash
corepack pnpm exec biome check apps packages spikes
```

Expected: all processed files pass with no fixes required.

- [ ] **Step 3: Run the full repository test suite**

```bash
corepack pnpm -r run test
```

Expected: every test file passes; Worker integration tests exit 0.

- [ ] **Step 4: Build production web assets**

```bash
corepack pnpm --filter @event-roster/web run build
```

Expected: TypeScript and Vite production builds exit 0.

- [ ] **Step 5: Verify the deployment bundle after the web build**

```bash
corepack pnpm --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: Wrangler reads web assets and exits successfully without deploying.

- [ ] **Step 6: Confirm a clean feature branch**

```bash
git diff --check
git status --short
git log --oneline --max-count=5
```

Expected: no whitespace errors, no uncommitted implementation changes, and tile/pagination commits are present.
