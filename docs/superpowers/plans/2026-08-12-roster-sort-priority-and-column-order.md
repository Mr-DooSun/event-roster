# 참가 명단 정렬 우선순위 및 열 순서 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가 명단의 정렬 우선순위를 차분한 위첨자로 표시하고 `등록 시점` 열을 표의 맨 마지막으로 이동한다.

**Architecture:** 기존 `RosterTable`의 다중 정렬 상태와 이벤트 처리는 그대로 두고 정렬 우선순위 마크업만 `small` 원형 배지에서 접근성 트리에서 제외된 `sup` 위첨자로 바꾼다. 같은 컴포넌트에서 헤더와 행 셀의 렌더링 순서를 함께 변경하며, 전용 CSS는 배경 없는 작은 강조색 위첨자 형태로 단순화한다.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- 최종 열 순서는 `이름 → 조직 → 참가자 구분 → 학년 → 성별 → 상태 → 작업 → 등록 시점`이다.
- 비활성 정렬 기준에는 우선순위 숫자를 표시하지 않는다.
- 정렬 버튼의 클릭 동작, `aria-pressed`, 우선순위를 포함한 접근 가능한 이름은 유지한다.
- 정렬, 필터, 상태 변경 및 정보 수정 동작은 변경하지 않는다.

---

### Task 1: 정렬 위첨자와 등록 시점 열 순서 변경

**Files:**
- Modify: `apps/web/src/features/roster/roster.test.tsx:1441-1560`
- Modify: `apps/web/src/features/roster/RosterTable.tsx:380-570`
- Modify: `apps/web/src/styles/global.css:444-460`

**Interfaces:**
- Consumes: 기존 `sortPriority(key: RosterSortKey): number | null`, `toggleSort(key: RosterSortKey): void`, `RosterView.source`
- Produces: 활성 정렬 버튼 안의 `<sup aria-hidden="true">{priority}</sup>` 마크업과 `등록 시점`이 마지막인 8열 테이블

- [ ] **Step 1: 위첨자 마크업과 열 순서를 검증하는 실패 테스트 작성**

`apps/web/src/features/roster/roster.test.tsx`의 기본 정렬 테스트에 활성 우선순위가 `SUP` 요소로 렌더링되는 검증을 추가한다.

```tsx
const organizationSort = screen.getByRole("button", {
  name: "조직 정렬, 우선순위 1",
});
const gradeSort = screen.getByRole("button", {
  name: "학년 정렬, 우선순위 2",
});
const nameSort = screen.getByRole("button", {
  name: "이름 정렬, 우선순위 3",
});

expect(within(organizationSort).getByText("1").tagName).toBe("SUP");
expect(within(gradeSort).getByText("2").tagName).toBe("SUP");
expect(within(nameSort).getByText("3").tagName).toBe("SUP");
```

같은 렌더 결과에서 헤더 순서와 첫 행의 `등록 시점` 값이 마지막 셀인지 검증한다.

```tsx
expect(
  screen.getAllByRole("columnheader").map((header) =>
    header.textContent?.replace(/[↕⏷123]/g, "").trim(),
  ),
).toEqual([
  "이름",
  "조직",
  "참가자 구분",
  "학년",
  "성별",
  "상태",
  "작업",
  "등록 시점",
]);

const firstDataRow = screen.getAllByRole("row")[1];
expect(within(firstDataRow).getAllByRole("cell").at(-1)).toHaveTextContent(
  /^(사전|진행 중 추가)$/,
);
```

- [ ] **Step 2: 대상 테스트를 실행해 기존 마크업과 열 순서 때문에 실패하는지 확인**

Run:

```bash
pnpm --filter @event-roster/web test -- src/features/roster/roster.test.tsx -t "uses organization grade and name as the default sort priority"
```

Expected: 우선순위 요소의 태그가 `SMALL`이고 `등록 시점`이 마지막 열이 아니어서 FAIL.

- [ ] **Step 3: 정렬 우선순위 마크업을 위첨자로 변경**

`RosterTable.tsx`의 이름, 조직, 학년 정렬 버튼에서 활성 우선순위 마크업을 동일하게 변경한다.

```tsx
{sortPriority("ORGANIZATION") === null ? null : (
  <sup aria-hidden="true">{sortPriority("ORGANIZATION")}</sup>
)}
```

이름에는 `NAME`, 학년에는 `GRADE` 키를 사용한다. 버튼의 `aria-label`, `aria-pressed`, `onClick`은 수정하지 않는다.

- [ ] **Step 4: 등록 시점 헤더와 행 셀을 마지막으로 이동**

헤더는 상태 필터와 작업 헤더 다음에 등록 시점을 렌더링한다.

```tsx
<th className="er-roster-header-cell">{/* 상태 필터 */}</th>
<th>작업</th>
<th>등록 시점</th>
```

행은 성별 다음에 상태 셀과 기존 작업 셀 전체를 순서만 바꾸어 렌더링하고, 기존 source 표현을 마지막 셀로 이동한다. 작업 셀 내부의 조건, 버튼 속성, 이벤트 핸들러는 수정하지 않는다.

```tsx
<td>{row.status === "ACTIVE" ? "참석" : "취소"}</td>
{/* 기존 작업 셀 전체가 이 위치에 온다. */}
<td>{row.source === "PRE_REGISTRATION" ? "사전" : "진행 중 추가"}</td>
```

- [ ] **Step 5: 원형 배지 CSS를 배경 없는 위첨자 CSS로 변경**

`global.css`에서 기존 `.er-roster-sort-control small` 규칙을 교체한다.

```css
.er-roster-sort-control sup {
  position: relative;
  top: -0.35em;
  color: var(--er-color-primary);
  font-size: 0.625rem;
  font-weight: var(--er-font-weight-bold);
  line-height: 1;
}
```

`.er-roster-sort-control`의 `inline-flex`, `align-items`는 유지하고 숫자가 아이콘과 자연스럽게 붙도록 `gap: 0`으로 변경한다.

- [ ] **Step 6: 대상 테스트와 웹 전체 테스트를 실행해 통과 확인**

Run:

```bash
pnpm --filter @event-roster/web test -- src/features/roster/roster.test.tsx -t "uses organization grade and name as the default sort priority"
pnpm --filter @event-roster/web test
```

Expected: 대상 테스트와 웹 전체 테스트 PASS.

- [ ] **Step 7: 타입 검사와 프로덕션 빌드로 회귀 검증**

Run:

```bash
pnpm --filter @event-roster/web check
pnpm --filter @event-roster/web build
```

Expected: TypeScript 검사와 Vite 프로덕션 빌드 PASS.

- [ ] **Step 8: 구현 결과 커밋**

```bash
git add apps/web/src/features/roster/roster.test.tsx apps/web/src/features/roster/RosterTable.tsx apps/web/src/styles/global.css
git commit -m "fix: refine roster sort priority display"
```
