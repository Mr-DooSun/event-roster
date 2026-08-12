# 참가 명단 다중 정렬 및 필터 요약 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가 명단의 조직·학년·이름 정렬을 고정 우선순위 다중 정렬로 전환하고, 활성 검색·필터를 개별 해제 가능한 요약 배지로 표시한다.

**Architecture:** `RosterTable`이 정렬 기준 목록과 기존 필터 값을 단일 원본 상태로 관리한다. 정렬 결과와 필터 배지는 이 상태에서 파생하며 표시 전용 중복 상태는 만들지 않는다. 기존 헤더 팝오버 구조는 유지하고 정렬 버튼 상태 및 필터 적용 상태만 명확히 표시한다.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, Biome, Vite, Cloudflare Workers

## Global Constraints

- 최초 정렬은 `조직 → 학년 → 이름`이며 우선순위는 항상 이 순서를 따른다.
- 정렬 기준을 끄거나 다시 켤 수 있고, 남은 활성 기준의 표시 번호는 연속되게 계산한다.
- 활성 정렬 기준이 없으면 입력 명단 순서를 보존한다.
- 검색어와 `ALL`이 아닌 필터만 요약 배지로 표시한다.
- 배지 제거는 해당 조건만 기본값으로 되돌리고 다른 조건을 유지한다.
- 기존 헤더 필터 팝오버의 위치, 바깥 클릭, Escape 닫기 동작을 보존한다.

---

## File Structure

- Modify: `apps/web/src/features/roster/RosterTable.tsx` — 다중 정렬 상태, 비교 로직, 활성 필터 파생 값, 필터 배지 및 해제 동작
- Modify: `apps/web/src/features/roster/roster.test.tsx` — 다중 정렬, 우선순위 표시, 필터 배지, 개별 해제 및 팝오버 회귀 테스트
- Modify: `apps/web/src/styles/global.css` — 활성 정렬/필터 아이콘과 요약 배지 레이아웃 및 상태 스타일

### Task 1: 고정 우선순위 다중 정렬

**Files:**
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Test: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Produces: `type RosterSortKey = "ORGANIZATION" | "GRADE" | "NAME"`
- Produces: `sortKeys: RosterSortKey[]`, 항상 고정 상대 순서를 유지
- Produces: `compareRoster(left, right, sortKeys)`, 활성 기준만 비교하고 모두 같으면 `0` 반환

- [ ] **Step 1: 기본 다중 정렬과 활성 순번의 실패 테스트 작성**

역순 행을 전달하고 조직·학년·이름 순으로 표시되는지와 세 버튼의 상태를 검증한다.

```tsx
expect(screen.getByRole("button", { name: "조직 정렬, 우선순위 1" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getByRole("button", { name: "학년 정렬, 우선순위 2" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getByRole("button", { name: "이름 정렬, 우선순위 3" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
  expect.stringContaining("가 조직"),
  expect.stringContaining("가 조직"),
  expect.stringContaining("나 조직"),
]);
```

- [ ] **Step 2: 테스트가 현재 단일 정렬 구현에서 실패하는지 확인**

Run:

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "uses organization grade and name as the default sort priority" --reporter=dot
```

Expected: 우선순위 접근성 이름 또는 `aria-pressed`를 찾지 못해 FAIL.

- [ ] **Step 3: 다중 정렬 상태와 토글 구현**

```tsx
type RosterSortKey = "ORGANIZATION" | "GRADE" | "NAME";
const SORT_PRIORITY: RosterSortKey[] = ["ORGANIZATION", "GRADE", "NAME"];
const [sortKeys, setSortKeys] = useState<RosterSortKey[]>(SORT_PRIORITY);

const toggleSort = (key: RosterSortKey) => {
  setSortKeys((current) =>
    current.includes(key)
      ? current.filter((item) => item !== key)
      : SORT_PRIORITY.filter((item) => item === key || current.includes(item)),
  );
};
```

- [ ] **Step 4: 활성 기준 순회 비교 로직 구현**

```tsx
function compareRoster(left: RosterView, right: RosterView, sortKeys: RosterSortKey[]) {
  const comparisons: Record<RosterSortKey, number> = {
    ORGANIZATION: left.organizationName.localeCompare(right.organizationName, "ko"),
    GRADE:
      (left.grade === null ? 6 : GRADE_ORDER[left.grade]) -
      (right.grade === null ? 6 : GRADE_ORDER[right.grade]),
    NAME: left.participantName.localeCompare(right.participantName, "ko"),
  };
  for (const key of sortKeys) {
    if (comparisons[key] !== 0) return comparisons[key];
  }
  return 0;
}
```

- [ ] **Step 5: 정렬 버튼 활성 상태와 우선순위 표시 구현**

각 기준의 `sortKeys.indexOf(key)`로 순번을 계산하고 `aria-pressed`, 동적 `aria-label`, 화면의 작은 순번을 렌더링한다.

```tsx
const nameSortIndex = sortKeys.indexOf("NAME");
<button
  type="button"
  aria-label={nameSortIndex >= 0 ? `이름 정렬, 우선순위 ${nameSortIndex + 1}` : "이름 정렬, 비활성"}
  aria-pressed={nameSortIndex >= 0}
  className="er-roster-header-icon er-roster-sort-control"
  onClick={() => toggleSort("NAME")}
>
  ↕{nameSortIndex >= 0 ? <small>{nameSortIndex + 1}</small> : null}
</button>
```

- [ ] **Step 6: 토글, 재활성화, 전체 비활성 테스트 작성 및 실행**

학년을 끄면 조직 `1`, 이름 `2`가 되고, 다시 켜면 원래 우선순위로 복귀하는지 검증한다. 세 기준을 모두 끄면 입력 행 순서가 유지되는지도 검증한다.

Run:

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "sort" --reporter=dot
```

Expected: 다중 정렬 관련 테스트 PASS.

- [ ] **Step 7: Task 1 커밋**

```bash
git add apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx
git commit -m "feat: add roster multi-column sorting"
```

### Task 2: 활성 검색·필터 요약 배지

**Files:**
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Consumes: 기존 `query`, `organization`, `status`, `role`, `grade`, `gender` 상태
- Produces: 상태에서 파생한 `activeFilterSummaries` 목록
- Produces: 구체적인 접근성 이름을 가진 조건별 해제 버튼

- [ ] **Step 1: 요약 표시 및 개별 해제의 실패 테스트 작성**

검색어, 성별, 상태 필터를 적용하고 다음을 검증한다.

```tsx
expect(screen.getByText("검색: 학생")).toBeVisible();
expect(screen.getByText("성별: 남성")).toBeVisible();
expect(screen.getByText("상태: 참석")).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: "성별 필터 해제" }));
expect(screen.queryByText("성별: 남성")).not.toBeInTheDocument();
expect(screen.getByText("검색: 학생")).toBeVisible();
expect(screen.getByText("상태: 참석")).toBeVisible();
```

검색 해제 시 입력값이 비고, 모든 조건 해제 후 요약 영역이 사라지는 검증도 포함한다.

- [ ] **Step 2: 현재 구현에서 테스트가 실패하는지 확인**

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "summarizes active roster filters" --reporter=dot
```

Expected: 요약 배지를 찾지 못해 FAIL.

- [ ] **Step 3: 기존 상태에서 요약 목록 파생**

목록 항목은 `key`, `text`, `clearLabel`, `onClear`를 가진다. 검색어가 비었거나 필터가 `ALL`이면 제외한다. 성별·상태·구분·학년은 기존 한국어 레이블을 사용한다.

```tsx
const activeFilterSummaries = [
  query.trim()
    ? { key: "query", text: `검색: ${query.trim()}`, clearLabel: "검색 필터 해제", onClear: () => setQuery("") }
    : null,
  organization !== "ALL"
    ? { key: "organization", text: `조직: ${organization}`, clearLabel: "조직 필터 해제", onClear: () => setOrganization("ALL") }
    : null,
].filter((item): item is NonNullable<typeof item> => item !== null);
```

- [ ] **Step 4: 검색창 위에 요약 배지 렌더링**

```tsx
{activeFilterSummaries.length > 0 ? (
  <div className="er-roster-filter-summary" aria-label="적용 중인 검색 및 필터">
    <span className="er-roster-filter-summary-label">적용 중</span>
    {activeFilterSummaries.map((item) => (
      <span className="er-roster-filter-chip" key={item.key}>
        {item.text}
        <button type="button" aria-label={item.clearLabel} onClick={item.onClear}>×</button>
      </span>
    ))}
  </div>
) : null}
```

- [ ] **Step 5: 필터 적용 아이콘 상태와 배지 CSS 구현**

필터 버튼에 `data-filtered={filterValue !== "ALL" || undefined}`를 추가한다.

```css
.er-roster-filter-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--er-space-2);
}
.er-roster-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--er-space-1);
  border-radius: 999px;
  padding: var(--er-space-1) var(--er-space-2);
  color: var(--er-color-primary);
  background: var(--er-color-info-soft);
  font-size: 0.8125rem;
}
.er-roster-header-icon[aria-pressed="true"],
.er-roster-header-icon[data-filtered="true"] {
  color: var(--er-color-primary);
}
```

- [ ] **Step 6: 필터 요약과 기존 팝오버 회귀 테스트 실행**

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx --reporter=dot
```

Expected: 명단 테스트 전체 PASS. 팝오버 바깥 클릭, Escape 닫기, 결과 0건 재열기 테스트 유지.

- [ ] **Step 7: Task 2 커밋**

```bash
git add apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git commit -m "feat: summarize active roster filters"
```

### Task 3: 최종 검증, push 및 배포

**Files:**
- Verify: `apps/web/src/features/roster/RosterTable.tsx`
- Verify: `apps/web/src/features/roster/roster.test.tsx`
- Verify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 1과 Task 2의 UI 및 테스트
- Produces: 검증된 `main` 커밋과 Cloudflare Worker 배포 버전

- [ ] **Step 1: 명단 테스트, 타입, 정적 검사 실행**

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx --reporter=dot
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web check
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec biome check --vcs-use-ignore-file=false apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git diff --check
```

Expected: 모든 명령 exit code 0.

- [ ] **Step 2: 프로덕션 빌드 실행**

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/web build
```

Expected: Vite build 성공.

- [ ] **Step 3: 원격 main 동기화 및 push**

```bash
git fetch origin main
git rebase origin/main
git push origin main
```

Expected: 원격 `main`이 현재 구현 커밋을 가리킴.

- [ ] **Step 4: Cloudflare Worker 배포**

```bash
PATH="/tmp/event-roster-corepack-bin:/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @event-roster/worker exec wrangler deploy
```

Expected: 새 `Current Version ID` 출력.

- [ ] **Step 5: 운영 헬스 및 자산 확인**

```bash
curl --fail --silent --show-error https://event-roster.event-roster.workers.dev/api/v1/health
curl --fail --silent --show-error https://event-roster.event-roster.workers.dev/ | rg -o 'index-[A-Za-z0-9_-]+\.(js|css)'
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
```

Expected: `{"status":"ok"}`, 새 자산 해시, 동일한 로컬/원격 HEAD, 깨끗한 작업 트리.
