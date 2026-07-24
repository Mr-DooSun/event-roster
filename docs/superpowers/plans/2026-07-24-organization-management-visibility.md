# Organization Management Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 담당자 지정 모달을 두 단계 구획형 흐름으로 바꾸고, 조직 요약 화면에서 대표 조직장을 포함한 전체 담당자 수를 짧고 일관되게 표시한다.

**Architecture:** Worker API와 D1 계약은 유지하고 React 표시 계층만 변경한다. `OrganizationSummary`와 `ProjectOrganization`이 공통으로 가진 `managerCount`와 `primaryLeader`에서 전체 담당자 수를 계산하는 작은 프런트 유틸리티를 만들고 세 화면이 이를 공유한다. 기존 담당자 지정은 검색 상태와 지정 mutation 오류를 분리한 뒤, 선택적 `Dialog.size="wide"`와 전용 CSS로 A안 구획형 레이아웃을 적용한다.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, Vitest 4, Testing Library, Biome, pnpm 10.28.1

## Global Constraints

- 디자인 기준은 `docs/superpowers/specs/2026-07-24-organization-management-visibility-design.md`다.
- Worker API, D1 schema, `@event-roster/contracts`의 wire shape, Worker secret, Cron은 변경하지 않는다.
- API의 `managerCount`는 추가 관리자 수다. 화면의 `담당자`는 `managerCount + (primaryLeader ? 1 : 0)`으로 계산한 전체 담당자 수다.
- 대표 조직장이 없으면 `미지정`으로 표시한다.
- 조직 목록, 조직 상세, 프로젝트 조직 화면은 같은 담당자 수 의미를 사용한다.
- 서버 성공 전 담당자 데이터와 요약 수치를 낙관적으로 바꾸지 않는다.
- 검색 실패와 지정 실패 시 사용자가 입력하거나 선택한 값을 유지한다.
- `Dialog`의 focus trap, Escape 닫기, 닫힌 뒤 focus 복원 동작을 보존한다.
- 새 담당자 발급과 대표 변경·해제 흐름의 동작과 레이아웃은 변경하지 않는다.
- 데스크톱은 검색 행과 계정·역할 2열을 사용하고, `36rem` 이하에서는 단일 열로 전환한다.
- 모든 사용자 문구는 설계 문서에 확정된 한국어 문구를 그대로 사용한다.

---

## File Structure

### New files

- `apps/web/src/lib/organization-summary.ts`
  - 대표 조직장 포함 전체 담당자 수 계산만 담당한다.
- `apps/web/src/lib/organization-summary.test.ts`
  - 대표 유무와 추가 관리자 수 조합을 순수 함수 수준에서 검증한다.

### Modified files

- `apps/web/src/features/admin/OrganizationsPage.tsx`
  - 조직 목록 카드의 `미지정`, 전체 담당자 수, 프로젝트 수를 표시한다.
- `apps/web/src/features/admin/OrganizationDetailPage.tsx`
  - 조직 상세 상단의 담당자·프로젝트 요약 문구를 통일한다.
- `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
  - 프로젝트 조직 행에서 대표와 전체 담당자 수를 표시한다.
- `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
  - 후보 검색 상태, 지정 오류 상태, 두 단계 모달 markup을 소유한다.
- `apps/web/src/components/ui/Dialog.tsx`
  - 기존 기본 크기를 유지하면서 선택적 `wide` 크기를 제공한다.
- `apps/web/src/components/ui/Dialog.test.tsx`
  - 기본 크기와 wide modifier 계약을 검증한다.
- `apps/web/src/styles/global.css`
  - 조직 정보 칸과 구획형 담당자 지정 모달의 데스크톱·모바일 스타일을 정의한다.
- `apps/web/src/features/admin/admin.test.tsx`
  - 조직 목록·상세 표시와 기존 담당자 검색·지정 상태를 검증한다.
- `apps/web/src/features/projects/project-detail.test.tsx`
  - 프로젝트 조직 행의 대표·전체 담당자 표현을 검증한다.
- `apps/web/e2e/organization-management.spec.ts`
  - 실제 360px viewport에서 모달 overflow, Escape, focus 복원을 검증한다.

---

### Task 1: 전체 담당자 계산과 조직 요약 표현 통일

**Files:**

- Create: `apps/web/src/lib/organization-summary.ts`
- Create: `apps/web/src/lib/organization-summary.test.ts`
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Modify: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes: `OrganizationSummary.primaryLeader`, `OrganizationSummary.managerCount`, `ProjectOrganization.primaryLeader`, `ProjectOrganization.managerCount`
- Produces:

```ts
export function getTotalOrganizationManagerCount(
  organization: Pick<
    OrganizationSummary,
    "managerCount" | "primaryLeader"
  >,
): number;
```

- Preserves: API response shape, 조직 상세의 status badge, 프로젝트 조직의 현재 명단 수와 관리 링크

- [ ] **Step 1: 전체 담당자 계산의 실패 테스트 작성**

Create `apps/web/src/lib/organization-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTotalOrganizationManagerCount } from "./organization-summary";

describe("getTotalOrganizationManagerCount", () => {
  it.each([
    {
      label: "대표와 추가 관리자가 모두 없음",
      value: { primaryLeader: null, managerCount: 0 },
      expected: 0,
    },
    {
      label: "대표만 있음",
      value: {
        primaryLeader: { userId: "leader-1", displayName: "김대표" },
        managerCount: 0,
      },
      expected: 1,
    },
    {
      label: "대표와 추가 관리자 둘이 있음",
      value: {
        primaryLeader: { userId: "leader-1", displayName: "김대표" },
        managerCount: 2,
      },
      expected: 3,
    },
  ])("$label", ({ value, expected }) => {
    expect(getTotalOrganizationManagerCount(value)).toBe(expected);
  });
});
```

- [ ] **Step 2: 조직 요약 화면의 실패 assertion 추가**

In `apps/web/src/features/admin/admin.test.tsx`, change the organization list
fixture to include one organization without a leader and one with a leader:

```ts
Response.json([
  {
    id: "org-1",
    name: "1팀",
    isActive: true,
    primaryLeader: null,
    managerCount: 0,
    projectCount: 0,
  },
  {
    id: "org-2",
    name: "2팀",
    isActive: true,
    primaryLeader: { userId: "leader-1", displayName: "김대표" },
    managerCount: 2,
    projectCount: 1,
  },
]);
```

Replace the old repeated-copy assertions with card-scoped assertions:

```ts
const firstCard = screen
  .getByRole("link", { name: "1팀 상세 관리" })
  .closest(".er-organization-summary-card");
const secondCard = screen
  .getByRole("link", { name: "2팀 상세 관리" })
  .closest(".er-organization-summary-card");

expect(firstCard).not.toBeNull();
expect(secondCard).not.toBeNull();
expect(within(firstCard as HTMLElement).getByText("미지정")).toBeVisible();
expect(within(firstCard as HTMLElement).getByText("0명")).toBeVisible();
expect(within(firstCard as HTMLElement).getByText("0개")).toBeVisible();
expect(within(secondCard as HTMLElement).getByText("김대표")).toBeVisible();
expect(within(secondCard as HTMLElement).getByText("3명")).toBeVisible();
expect(within(secondCard as HTMLElement).getByText("1개")).toBeVisible();
```

Change both `displayName` values for the primary leader in
`organizationDetailWithManagers()` from `대표 조직장` to `김대표`:

```ts
primaryLeader: {
  userId: "leader-1",
  loginId: "leader-01",
  displayName: "김대표",
  isActive: true,
  assignmentRole: "PRIMARY_LEADER" as const,
  assignedAt: "2026-07-22T00:00:00.000Z",
},
```

Apply the same `displayName: "김대표"` to the primary-leader item in the
fixture's `managers` array.

Add an organization detail assertion using `organizationDetailWithManagers()`:

```ts
expect(await screen.findByText("대표 조직장 김대표")).toBeVisible();
expect(screen.getByText("담당자 2명")).toBeVisible();
expect(screen.getByText("프로젝트 0개")).toBeVisible();
```

In `apps/web/src/features/projects/project-detail.test.tsx`, replace:

```ts
expect(screen.getByText("대표 조직장 미지정")).toBeVisible();
expect(screen.getByText("김대표")).toBeVisible();
expect(screen.getByText("추가 관리자 2명")).toBeVisible();
```

with:

```ts
expect(screen.getByText("대표 조직장 미지정")).toBeVisible();
expect(screen.getByText("대표 조직장 김대표")).toBeVisible();
expect(screen.getByText("담당자 0명")).toBeVisible();
expect(screen.getByText("담당자 3명")).toBeVisible();
expect(screen.getByText("현재 명단 11명")).toBeVisible();
```

- [ ] **Step 3: focused 테스트를 실행해 RED 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/lib/organization-summary.test.ts \
  src/features/admin/admin.test.tsx \
  src/features/projects/project-detail.test.tsx
```

Expected:

- `organization-summary.ts`를 찾지 못해 unit test FAIL
- 현재 `대표 조직장 미지정`, `추가 관리자 N명`,
  `연결 프로젝트 N개` 문구 때문에 UI assertions FAIL

- [ ] **Step 4: 전체 담당자 계산 유틸리티 구현**

Create `apps/web/src/lib/organization-summary.ts`:

```ts
import type { OrganizationSummary } from "@event-roster/contracts";

type OrganizationManagerSummary = Pick<
  OrganizationSummary,
  "managerCount" | "primaryLeader"
>;

export function getTotalOrganizationManagerCount(
  organization: OrganizationManagerSummary,
): number {
  return organization.managerCount + (organization.primaryLeader ? 1 : 0);
}
```

`ProjectOrganization`도 같은 두 필드 shape를 가지므로 별도 overload나
계약 변경 없이 이 함수에 전달할 수 있다.

- [ ] **Step 5: 세 조직 요약 화면을 공통 의미로 변경**

In `apps/web/src/features/admin/OrganizationsPage.tsx`, add:

```ts
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
```

Replace the facts block with:

```tsx
<dl className="er-organization-facts">
  <div>
    <dt>대표 조직장</dt>
    <dd>{organization.primaryLeader?.displayName ?? "미지정"}</dd>
  </div>
  <div>
    <dt>담당자</dt>
    <dd>{getTotalOrganizationManagerCount(organization)}명</dd>
  </div>
  <div>
    <dt>프로젝트</dt>
    <dd>{organization.projectCount}개</dd>
  </div>
</dl>
```

In `apps/web/src/features/admin/OrganizationDetailPage.tsx`, add:

```ts
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
```

Replace the three organization meta spans with:

```tsx
<span>
  대표 조직장 {organization.primaryLeader?.displayName ?? "미지정"}
</span>
<span>담당자 {getTotalOrganizationManagerCount(organization)}명</span>
<span>프로젝트 {organization.projectCount}개</span>
```

In `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`, add:

```ts
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
```

Replace the leader and manager spans with:

```tsx
<span>
  대표 조직장 {membership.primaryLeader?.displayName ?? "미지정"}
</span>
<span>담당자 {getTotalOrganizationManagerCount(membership)}명</span>
<span>현재 명단 {membership.rosterCount}명</span>
```

- [ ] **Step 6: 조직 목록 정보 칸 스타일 구현**

In `apps/web/src/styles/global.css`, replace the existing
`.er-organization-facts div` rule with:

```css
.er-organization-facts div {
  display: grid;
  gap: var(--er-space-1);
  min-width: 0;
  border-radius: var(--er-radius-sm);
  padding: var(--er-space-3);
  background: var(--er-color-canvas);
}
```

Keep the existing `dt`, `dd`, and `@media (max-width: 42rem)` rules. They
already make the three facts a single column on narrow screens.

- [ ] **Step 7: focused 테스트와 정적 검사로 GREEN 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/lib/organization-summary.test.ts \
  src/features/admin/admin.test.tsx \
  src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected:

- focused test files PASS
- Web TypeScript와 E2E TypeScript check PASS

- [ ] **Step 8: Task 1 커밋**

```bash
git add \
  apps/web/src/lib/organization-summary.ts \
  apps/web/src/lib/organization-summary.test.ts \
  apps/web/src/features/admin/OrganizationsPage.tsx \
  apps/web/src/features/admin/OrganizationDetailPage.tsx \
  apps/web/src/features/projects/ProjectOrganizationsPanel.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/src/features/projects/project-detail.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: clarify organization manager summaries"
```

---

### Task 2: 기존 담당자 검색과 지정 상태 분리

**Files:**

- Modify: `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`

**Interfaces:**

- Consumes: existing `api.get`, `api.post`, generation guard,
  `AbortController`, `mutationInFlight`, `onChanged(): Promise<boolean>`
- Produces:
  - `hasSearchedCandidates: boolean`
  - `candidateSearchError: string | null`
  - `existingAssignmentError: string | null`
  - `mutate(operation, reportOperationError?)`
- Preserves: 검색 stale-response 차단, 다른 manager mutation 문구, 성공 후
  최신 조직 재조회

- [ ] **Step 1: 검색 전 비활성화와 빈 결과 실패 테스트 작성**

Add a focused test to `apps/web/src/features/admin/admin.test.tsx`:

```tsx
it("gates existing assignment until candidate search succeeds", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/organizations/org-1"))
        return Promise.resolve(Response.json(organizationDetail()));
      if (url.endsWith("/organizations/org-1/audit?limit=50"))
        return Promise.resolve(
          Response.json({ items: [], nextCursor: null }),
        );
      if (url.includes("/assignable-users?"))
        return Promise.resolve(Response.json([]));
      throw new Error(`unexpected request: ${url}`);
    }),
  );

  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(
    await screen.findByRole("button", { name: "기존 계정 지정" }),
  );

  expect(
    screen.getByRole("combobox", { name: "지정할 계정" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "담당자로 지정" }),
  ).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "검색" }));

  expect(
    await screen.findByText("검색된 계정이 없습니다."),
  ).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "지정할 계정" }),
  ).toBeDisabled();
});
```

- [ ] **Step 2: 지정 실패 후 입력 유지 실패 테스트 작성**

Add:

```tsx
it("keeps existing assignment choices after mutation failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/organizations/org-1"))
        return Promise.resolve(Response.json(organizationDetail()));
      if (url.endsWith("/organizations/org-1/audit?limit=50"))
        return Promise.resolve(
          Response.json({ items: [], nextCursor: null }),
        );
      if (url.includes("/assignable-users?"))
        return Promise.resolve(
          Response.json([
            {
              userId: "candidate-1",
              loginId: "candidate-01",
              displayName: "지정 후보",
              isActive: true,
            },
          ]),
        );
      if (
        url.endsWith("/organizations/org-1/managers") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          Response.json(
            { code: "INTERNAL", message: "failed" },
            { status: 500 },
          ),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );

  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(
    await screen.findByRole("button", { name: "기존 계정 지정" }),
  );
  fireEvent.change(screen.getByLabelText("로그인 ID 또는 표시 이름"), {
    target: { value: "지정" },
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  await screen.findByRole("option", { name: "지정 후보 · candidate-01" });
  fireEvent.change(screen.getByLabelText("지정할 계정"), {
    target: { value: "candidate-1" },
  });
  fireEvent.change(screen.getByLabelText("조직별 역할"), {
    target: { value: "MANAGER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "담당자로 지정" }));

  const dialog = await screen.findByRole("dialog", {
    name: "기존 담당자 지정",
  });
  expect(
    within(dialog).getByText("담당자 변경을 반영하지 못했습니다."),
  ).toBeVisible();
  expect(
    within(dialog).getByLabelText("로그인 ID 또는 표시 이름"),
  ).toHaveValue("지정");
  expect(within(dialog).getByLabelText("지정할 계정")).toHaveValue(
    "candidate-1",
  );
  expect(within(dialog).getByLabelText("조직별 역할")).toHaveValue(
    "MANAGER",
  );
});
```

- [ ] **Step 3: focused test를 실행해 RED 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/features/admin/admin.test.tsx
```

Expected:

- 현재 검색 전 candidate select가 활성이라 FAIL
- 현재 검색 버튼 문구가 `계정 찾기`라 FAIL
- 검색 결과 없음 status가 없어 FAIL
- 지정 실패 message가 dialog 바깥에 있어 scoped assertion FAIL

- [ ] **Step 4: 후보 검색 상태를 독립 state로 구현**

In `OrganizationManagersPanel`, add:

```ts
const [hasSearchedCandidates, setHasSearchedCandidates] = useState(false);
const [candidateSearchError, setCandidateSearchError] = useState<string | null>(
  null,
);
const [existingAssignmentError, setExistingAssignmentError] = useState<
  string | null
>(null);
```

Add a close helper that invalidates a search request before closing:

```ts
function closeExistingAssignment() {
  candidateSearchGeneration.current += 1;
  candidateSearchController.current?.abort();
  candidateSearchController.current = null;
  setSearchingCandidates(false);
  setMode(null);
}
```

At the beginning of `searchCandidates`, after creating the controller:

```ts
setSearchingCandidates(true);
setHasSearchedCandidates(false);
setCandidateSearchError(null);
setExistingAssignmentError(null);
```

Replace the success state update with:

```ts
setCandidates(next);
setSelectedUserId("");
setHasSearchedCandidates(true);
```

Replace the non-aborted search catch body with:

```ts
setCandidates([]);
setSelectedUserId("");
setHasSearchedCandidates(true);
setCandidateSearchError("지정 가능한 계정을 찾지 못했습니다.");
```

Extend `changeCandidateQuery` after `setQuery(nextQuery)`:

```ts
setCandidates([]);
setSelectedUserId("");
setHasSearchedCandidates(false);
setCandidateSearchError(null);
setExistingAssignmentError(null);
```

When `openAssignment("EXISTING")` runs, reset only the existing-assignment
workflow:

```ts
if (nextMode === "EXISTING") {
  candidateSearchGeneration.current += 1;
  candidateSearchController.current?.abort();
  candidateSearchController.current = null;
  setSearchingCandidates(false);
  setQuery("");
  setCandidates([]);
  setSelectedUserId("");
  setHasSearchedCandidates(false);
  setCandidateSearchError(null);
  setExistingAssignmentError(null);
}
```

- [ ] **Step 5: mutation 오류 reporter를 분리**

Change `mutate` to accept an optional operation-error reporter:

```ts
async function mutate(
  operation: () => Promise<void>,
  reportOperationError: (message: string) => void = setMessage,
) {
  if (mutationInFlight.current) return;
  mutationInFlight.current = true;
  setIsMutating(true);
  setMessage(null);
  try {
    try {
      await operation();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const reloaded = await onChanged();
        reportOperationError(
          reloaded
            ? "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다."
            : "다른 관리 변경이 먼저 반영되었지만 최신 조직 정보를 불러오지 못했습니다.",
        );
      } else {
        reportOperationError("담당자 변경을 반영하지 못했습니다.");
      }
      return;
    }
    if (!(await onChanged())) {
      setMessage(
        "담당자 변경은 반영됐지만 최신 조직 정보를 불러오지 못했습니다.",
      );
    }
  } finally {
    mutationInFlight.current = false;
    setIsMutating(false);
  }
}
```

Change `assignExisting` to clear and use the dialog-local error:

```ts
async function assignExisting(event: FormEvent) {
  event.preventDefault();
  if (!selectedUserId) return;
  setExistingAssignmentError(null);
  await mutate(
    async () => {
      await api.post(`/organizations/${organization.id}/managers`, {
        kind: "EXISTING",
        userId: selectedUserId,
        assignmentRole,
      });
      closeExistingAssignment();
    },
    setExistingAssignmentError,
  );
}
```

Other manager mutations keep calling `mutate(operation)` and therefore retain
their existing panel-level messages.

- [ ] **Step 6: temporary semantic rendering for GREEN**

Before Task 3 applies the final A-layout classes, update the existing dialog
controls and status rendering:

```tsx
<TextInput
  label="로그인 ID 또는 표시 이름"
  value={query}
  onChange={(event) => changeCandidateQuery(event.currentTarget.value)}
/>
<Button
  type="submit"
  loading={searchingCandidates}
  loadingText="검색 중…"
  disabled={isMutating}
>
  검색
</Button>
{candidateSearchError ? (
  <StatusMessage tone="error">{candidateSearchError}</StatusMessage>
) : hasSearchedCandidates && candidates.length === 0 ? (
  <StatusMessage>검색된 계정이 없습니다.</StatusMessage>
) : null}
```

Set the account select disabled state:

```tsx
disabled={isMutating || searchingCandidates || candidates.length === 0}
```

Render the local assignment error next to the assignment controls:

```tsx
{existingAssignmentError ? (
  <StatusMessage tone="error">{existingAssignmentError}</StatusMessage>
) : null}
```

Keep the assign button rule:

```tsx
disabled={isMutating || !selectedUserId}
```

- [ ] **Step 7: focused test와 기존 동시성 회귀를 GREEN으로 확인**

Update existing admin tests that query `계정 검색`, `계정 찾기`,
`계정 찾는 중…` to use:

```ts
screen.getByLabelText("로그인 ID 또는 표시 이름");
screen.getByRole("button", { name: "검색" });
screen.getByRole("button", { name: "검색 중…" });
```

Where an existing test relied on automatic first-candidate selection, select
the candidate explicitly:

```ts
fireEvent.change(await screen.findByLabelText("지정할 계정"), {
  target: { value: "candidate-1" },
});
```

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected:

- admin tests PASS
- stale search response and abort assertions remain PASS
- Web check PASS

- [ ] **Step 8: Task 2 커밋**

```bash
git add \
  apps/web/src/features/admin/OrganizationManagersPanel.tsx \
  apps/web/src/features/admin/admin.test.tsx
git commit -m "fix: clarify existing manager assignment states"
```

---

### Task 3: A안 구획형 모달과 반응형 스타일 적용

**Files:**

- Modify: `apps/web/src/components/ui/Dialog.tsx`
- Modify: `apps/web/src/components/ui/Dialog.test.tsx`
- Modify: `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/e2e/organization-management.spec.ts`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes: Task 2의 `hasSearchedCandidates`, `candidateSearchError`,
  `existingAssignmentError`
- Produces:

```ts
size?: "default" | "wide";
```

- Produces CSS contracts:
  - `.er-dialog--wide`
  - `.er-assignment-dialog`
  - `.er-assignment-step`
  - `.er-assignment-step__heading`
  - `.er-assignment-step__number`
  - `.er-assignment-search`
  - `.er-assignment-fields`
- Preserves: all default dialogs remain `28rem`; only existing manager
  assignment uses wide layout

- [ ] **Step 1: Dialog wide modifier 실패 테스트 작성**

Add to `apps/web/src/components/ui/Dialog.test.tsx`:

```tsx
it("applies the wide modifier only when requested", () => {
  const view = render(
    <Dialog title="기본" onClose={vi.fn()}>
      <p>내용</p>
    </Dialog>,
  );

  expect(screen.getByRole("dialog", { name: "기본" })).toHaveClass(
    "er-dialog",
  );
  expect(screen.getByRole("dialog", { name: "기본" })).not.toHaveClass(
    "er-dialog--wide",
  );

  view.rerender(
    <Dialog title="넓은 모달" size="wide" onClose={vi.fn()}>
      <p>내용</p>
    </Dialog>,
  );

  expect(screen.getByRole("dialog", { name: "넓은 모달" })).toHaveClass(
    "er-dialog",
    "er-dialog--wide",
  );
});
```

- [ ] **Step 2: 구획 구조와 action 실패 테스트 작성**

Add to `apps/web/src/features/admin/admin.test.tsx`:

```tsx
it("renders existing manager assignment as two labelled steps", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/organizations/org-1"))
        return Promise.resolve(Response.json(organizationDetail()));
      if (url.endsWith("/organizations/org-1/audit?limit=50"))
        return Promise.resolve(
          Response.json({ items: [], nextCursor: null }),
        );
      throw new Error(`unexpected request: ${url}`);
    }),
  );

  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(
    await screen.findByRole("button", { name: "기존 계정 지정" }),
  );

  const dialog = screen.getByRole("dialog", {
    name: "기존 담당자 지정",
  });
  expect(dialog).toHaveClass("er-dialog--wide");
  expect(
    within(dialog).getByRole("heading", { name: "계정 찾기" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("heading", { name: "담당 범위 설정" }),
  ).toBeVisible();
  expect(
    within(
      within(dialog).getByRole("heading", { name: "계정 찾기" }),
    ).getByText("1"),
  ).toBeVisible();
  expect(
    within(
      within(dialog).getByRole("heading", { name: "담당 범위 설정" }),
    ).getByText("2"),
  ).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "취소" })).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "닫기" }),
  ).not.toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(
    screen.queryByRole("dialog", { name: "기존 담당자 지정" }),
  ).not.toBeInTheDocument();
});
```

Add this test before the existing mutation-heavy test in
`apps/web/e2e/organization-management.spec.ts`:

```ts
test("existing manager assignment stays usable at 360px", async ({ page }) => {
  const data = fixture();
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, data.operator.loginId, data.operator.password);
  await page.getByRole("link", { name: "조직 관리" }).click();
  expect(
    await page
      .locator(".er-organization-facts")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);
  await page
    .getByRole("link", { name: "E2E 1팀 상세 관리" })
    .click();

  const trigger = page.getByRole("button", { name: "기존 계정 지정" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "기존 담당자 지정" });

  await expect(
    dialog.getByRole("heading", { name: "계정 찾기" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "담당 범위 설정" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeVisible();
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await dialog
      .locator(".er-assignment-search")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);
  expect(
    await dialog
      .locator(".er-assignment-fields")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
```

- [ ] **Step 3: focused unit과 E2E test를 실행해 RED 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/components/ui/Dialog.test.tsx \
  src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  organization-management.spec.ts
```

Expected:

- `Dialog`에 `size` prop이 없어 TypeScript/test FAIL
- 단계 headings, wide class, `취소` 버튼이 없어 FAIL
- 기본 `닫기` 버튼이 남아 있어 FAIL
- 360px E2E가 단계 headings를 찾지 못해 FAIL

- [ ] **Step 4: Dialog의 opt-in wide size 구현**

Change the `Dialog` props and class in
`apps/web/src/components/ui/Dialog.tsx`:

```tsx
export function Dialog({
  title,
  children,
  closeLabel = "닫기",
  hideDefaultCloseAction = false,
  size = "default",
  onClose,
}: {
  title: string;
  children: ReactNode;
  closeLabel?: string;
  hideDefaultCloseAction?: boolean;
  size?: "default" | "wide";
  onClose: () => void;
}) {
```

Use:

```tsx
<section
  ref={dialogRef}
  className={`er-dialog${size === "wide" ? " er-dialog--wide" : ""}`}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabIndex={-1}
  onKeyDown={handleKeyDown}
>
```

Do not change focus collection, Escape handling, or default close action
logic.

- [ ] **Step 5: 기존 담당자 지정 markup을 A안으로 교체**

Replace only the `mode === "EXISTING"` dialog block in
`OrganizationManagersPanel.tsx`:

```tsx
{mode === "EXISTING" ? (
  <Dialog
    title="기존 담당자 지정"
    size="wide"
    hideDefaultCloseAction
    onClose={closeExistingAssignment}
  >
    <div className="er-assignment-dialog">
      <section
        className="er-assignment-step"
        aria-labelledby="existing-manager-search-step"
      >
        <h3
          id="existing-manager-search-step"
          className="er-assignment-step__heading"
        >
          <span className="er-assignment-step__number" aria-hidden="true">
            1
          </span>
          <span>계정 찾기</span>
        </h3>
        <form
          className="er-assignment-search"
          onSubmit={searchCandidates}
        >
          <TextInput
            label="로그인 ID 또는 표시 이름"
            value={query}
            onChange={(event) =>
              changeCandidateQuery(event.currentTarget.value)
            }
          />
          <Button
            type="submit"
            loading={searchingCandidates}
            loadingText="검색 중…"
            disabled={isMutating}
          >
            검색
          </Button>
        </form>
        {candidateSearchError ? (
          <StatusMessage tone="error">{candidateSearchError}</StatusMessage>
        ) : hasSearchedCandidates && candidates.length === 0 ? (
          <StatusMessage>검색된 계정이 없습니다.</StatusMessage>
        ) : null}
      </section>

      <form onSubmit={assignExisting}>
        <section
          className="er-assignment-step"
          aria-labelledby="existing-manager-assignment-step"
        >
          <h3
            id="existing-manager-assignment-step"
            className="er-assignment-step__heading"
          >
            <span className="er-assignment-step__number" aria-hidden="true">
              2
            </span>
            <span>담당 범위 설정</span>
          </h3>
          <div className="er-assignment-fields">
            <label className="er-field">
              <span>지정할 계정</span>
              <select
                className="er-control er-control--select"
                value={selectedUserId}
                disabled={
                  isMutating ||
                  searchingCandidates ||
                  candidates.length === 0
                }
                onChange={(event) =>
                  setSelectedUserId(event.currentTarget.value)
                }
              >
                <option value="">계정을 선택하세요</option>
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.displayName} · {candidate.loginId}
                  </option>
                ))}
              </select>
            </label>
            <AssignmentRoleField
              value={assignmentRole}
              onChange={setAssignmentRole}
            />
          </div>
          {existingAssignmentError ? (
            <StatusMessage tone="error">
              {existingAssignmentError}
            </StatusMessage>
          ) : null}
        </section>
        <div className="er-dialog-actions">
          <Button
            type="button"
            disabled={isMutating}
            onClick={closeExistingAssignment}
          >
            취소
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isMutating || !selectedUserId}
            loading={isMutating}
            loadingText="담당자로 지정 중…"
          >
            담당자로 지정
          </Button>
        </div>
      </form>
    </div>
  </Dialog>
) : null}
```

- [ ] **Step 6: 구획형·반응형 CSS 구현**

Add after `.er-dialog` in `apps/web/src/styles/global.css`:

```css
.er-dialog--wide {
  width: min(100%, 36rem);
}
.er-assignment-dialog {
  display: grid;
  gap: var(--er-space-4);
  margin-top: var(--er-space-4);
}
.er-assignment-step {
  display: grid;
  gap: var(--er-space-3);
  border: 1px solid var(--er-color-border);
  border-radius: var(--er-radius-md);
  padding: var(--er-space-4);
  background: var(--er-color-canvas);
}
.er-assignment-step__heading {
  display: flex;
  align-items: center;
  gap: var(--er-space-2);
  margin: 0;
  color: var(--er-color-primary);
  font-size: 0.95rem;
}
.er-assignment-step__number {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 1.5rem;
  border-radius: 999px;
  color: var(--er-color-surface);
  background: var(--er-color-primary);
  font-size: 0.8rem;
  font-weight: var(--er-font-weight-bold);
}
.er-assignment-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--er-space-3);
}
.er-assignment-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--er-space-3);
}
```

Inside the existing `@media (max-width: 36rem)` block, add:

```css
.er-assignment-search,
.er-assignment-fields {
  grid-template-columns: 1fr;
}
.er-assignment-dialog .er-dialog-actions {
  align-items: stretch;
  flex-direction: column-reverse;
}
.er-assignment-dialog .er-dialog-actions .er-button {
  width: 100%;
}
```

The `column-reverse` rule keeps the primary submit action visually above
`취소` on narrow screens while DOM order remains `취소` then submit for
predictable keyboard navigation.

- [ ] **Step 7: focused tests, Web 전체 테스트, E2E, build 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- \
  src/components/ui/Dialog.test.tsx \
  src/features/admin/admin.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 --filter @event-roster/web check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  organization-management.spec.ts
```

Expected:

- Dialog and admin focused tests PASS
- all Web test files PASS
- TypeScript checks PASS
- Vite production build PASS
- organization management E2E PASS at 360px

- [ ] **Step 8: Task 3 커밋**

```bash
git add \
  apps/web/src/components/ui/Dialog.tsx \
  apps/web/src/components/ui/Dialog.test.tsx \
  apps/web/src/features/admin/OrganizationManagersPanel.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/e2e/organization-management.spec.ts \
  apps/web/src/styles/global.css
git commit -m "feat: improve existing manager assignment dialog"
```

---

## Final Verification

- [ ] Run the monorepo test suite:

```bash
corepack pnpm@10.28.1 test
```

Expected: contracts, domain, Web, Worker, and capability test files PASS.

- [ ] Run all static checks:

```bash
corepack pnpm@10.28.1 check
git ls-files -z | xargs -0 corepack pnpm@10.28.1 exec biome check --no-errors-on-unmatched
git diff --check
```

Expected: TypeScript/Biome errors 0 and whitespace errors 0. The tracked-file
Biome command intentionally excludes local `.pnpm-store`, `.DS_Store`, and
`.superpowers/brainstorm` artifacts.

- [ ] Validate the production bundle without deploying:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: Web build success and Worker dry-run exit code 0 with the existing
`event-roster` D1 binding. Actual Cloudflare deployment requires a later,
explicit deployment request.

- [ ] Run the complete browser E2E suite:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: all Playwright scenarios PASS against the isolated local D1 state.

- [ ] Confirm repository scope:

```bash
git status --short --branch
git diff --name-only "$(git merge-base HEAD main)"..HEAD
```

Expected: only the files listed in this plan are changed by the implementation;
pre-existing untracked `.DS_Store` and `.pnpm-store` remain untouched.
