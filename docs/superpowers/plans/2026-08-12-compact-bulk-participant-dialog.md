# 신규 참가자 일괄 추가 모달 컴팩트 레이아웃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 참가자 일괄 입력 카드를 낮고 분명하게 구분되는 형태로 바꾸고, 행 삭제는 우측 상단 `×`, 행 추가는 목록 하단 전체 너비 버튼으로 제공한다.

**Architecture:** `BulkParticipantRowsField`가 수량, 카드 목록, 빈 상태, 하단 추가 동작을 모두 소유하도록 렌더링 구조를 재배치하되 기존 초안과 검증 상태 흐름은 유지한다. `Dialog`에는 기존 roster 너비를 공유하면서 신규 일괄 입력에만 낮은 최대 높이를 적용하는 `roster-compact` 크기 변형을 추가하고, `ParticipantDialog`가 모드에 따라 크기를 선택한다. 레이아웃과 시각적 구분은 기존 전역 디자인 토큰을 사용하는 전용 CSS 클래스로 구현한다.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- 변경 범위는 `새 참가자` 모드의 일괄 입력 화면으로 한정한다.
- 마지막 참가자까지 삭제할 수 있고 0개 상태에서도 모달과 선택 조직을 유지한다.
- 참가자 초안 구조, 최대 30명 제한, 이름·학년·중복 검증 및 최종 제출 규칙은 변경하지 않는다.
- 제출 중 기존 입력·추가·삭제·닫기 비활성화 정책을 유지한다.
- 삭제 버튼은 시각적으로 `×`, 접근 가능한 이름은 `N번 참가자 삭제`로 제공한다.
- 참가자 추가 버튼은 목록 아래 전체 너비로 표시하고 접근 가능한 이름 `참가자 추가`를 유지한다.

---

### Task 1: 참가자 카드 구조와 빈 목록 동작

**Files:**
- Modify: `apps/web/src/features/roster/BulkParticipantRowsField.test.tsx`
- Modify: `apps/web/src/features/roster/BulkParticipantRowsField.tsx`

**Interfaces:**
- Consumes: `BulkParticipantRowsFieldProps`, `createBulkParticipantDraft()`, 기존 `removeRow(clientId)`와 중복 확인 초기화 동작
- Produces: `.er-bulk-participant-count`, `.er-bulk-participant-rows`, `.er-bulk-participant-empty`, `.er-bulk-participant-row__heading`, `.er-bulk-participant-row__remove`, `.er-bulk-participant-add` 구조

- [ ] **Step 1: 목록 하단 추가 버튼과 빈 상태를 검증하는 실패 테스트 작성**

`BulkParticipantRowsField.test.tsx`의 빈 목록 테스트에서 다음 구조와 동작을 검증한다.

```tsx
expect(screen.getByText("등록할 참가자가 없습니다.")).toBeVisible();
const addButton = screen.getByRole("button", { name: "참가자 추가" });
expect(addButton).toHaveClass("er-bulk-participant-add");
expect(screen.getByText("등록 예정 0명 / 최대 30명")).toBeVisible();

fireEvent.click(addButton);
expect(onRowsChange).toHaveBeenCalledWith([
  expect.objectContaining({
    clientId: expect.any(String),
    name: "",
    role: "STUDENT",
    grade: null,
    gender: null,
  }),
]);
```

다음 테스트를 추가해 버튼이 모든 참가자 `group` 뒤에 렌더링되는지 확인한다.

```tsx
it("places the participant add action after the card list", () => {
  render(
    <BulkParticipantRowsField
      rows={[
        student("row-1", "첫 번째", "M1"),
        student("row-2", "두 번째", "M2"),
      ]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  const groups = screen.getAllByRole("group", { name: /번 참가자/ });
  const addButton = screen.getByRole("button", { name: "참가자 추가" });
  expect(
    groups.at(-1)?.compareDocumentPosition(addButton) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
```

- [ ] **Step 2: 대상 테스트를 실행해 빈 상태와 버튼 위치가 구현되지 않아 실패하는지 확인**

Run:

```bash
pnpm --filter @event-roster/web test -- src/features/roster/BulkParticipantRowsField.test.tsx -t "starts empty|places the participant add action"
```

Expected: 빈 상태 문구와 `.er-bulk-participant-add` 버튼 클래스 또는 새 위치 검증이 없어 FAIL.

- [ ] **Step 3: 수량, 카드 목록, 빈 상태, 추가 버튼 순으로 구조 재배치**

`BulkParticipantRowsField.tsx`에서 추가 로직을 중복 없이 호출하도록 함수를 만든다.

```tsx
function addRow() {
  onRowsChange([...rows, createBulkParticipantDraft()]);
  onDuplicateNamesConfirmedChange(false);
}
```

최상위 렌더에서는 기존 `.er-bulk-participant-add` 래퍼를 제거한다. 수량 `span`을 첫 번째 자식으로 옮기고, 기존 `.er-bulk-participant-rows` 전체를 두 번째 자식으로 옮긴 뒤 그 내부의 `rows.map(...)` 바로 앞에 다음 빈 상태를 추가한다.

```tsx
{rows.length === 0 ? (
  <p className="er-bulk-participant-empty">등록할 참가자가 없습니다.</p>
) : null}
```

기존 `.er-bulk-participant-rows` 닫는 태그 다음, 기존 중복 안내 조건문 앞에 정확히 다음 버튼을 둔다.

```tsx
<Button
  type="button"
  className="er-bulk-participant-add"
  disabled={disabled || atLimit}
  onClick={addRow}
>
  + 참가자 추가
</Button>
```

- [ ] **Step 4: 카드 제목, 간결한 라벨, `×` 삭제 버튼 마크업 구현**

각 `fieldset`은 숨김 `legend`를 유지하고 시각적 제목을 별도로 추가한다.

```tsx
<legend className="er-visually-hidden">{rowNumber}번 참가자</legend>
<span className="er-bulk-participant-row__heading" aria-hidden="true">
  {rowNumber}번 참가자
</span>
```

필드의 시각적 라벨은 `이름`, `성별`, `참가자 구분`, `학년`으로 줄이되 기존 쿼리와 접근성을 유지하도록 각 입력에 명시적인 `aria-label`을 둔다.

```tsx
<span>이름</span>
<input aria-label={`${rowNumber}번 이름`} />

<span>성별</span>
<select aria-label={`${rowNumber}번 성별`} />

<span>참가자 구분</span>
<select aria-label={`${rowNumber}번 참가자 구분`} />
```

삭제 버튼은 기존 이벤트와 비활성 조건을 그대로 사용하고 내용만 아이콘으로 바꾼다.

```tsx
<Button
  type="button"
  variant="secondary"
  className="er-bulk-participant-row__remove"
  disabled={disabled}
  aria-label={`${rowNumber}번 참가자 삭제`}
  onClick={() => removeRow(row.clientId)}
>
  <span aria-hidden="true">×</span>
</Button>
```

- [ ] **Step 5: 마지막 행 삭제와 중복 확인 초기화 회귀 테스트 추가**

```tsx
it("allows deleting the final row and resets duplicate confirmation", () => {
  const onRowsChange = vi.fn();
  const onConfirmedChange = vi.fn();
  render(
    <BulkParticipantRowsField
      rows={[student("row-1", "마지막 참가자", "M1")]}
      duplicates={[]}
      duplicateNamesConfirmed
      onRowsChange={onRowsChange}
      onDuplicateNamesConfirmedChange={onConfirmedChange}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "1번 참가자 삭제" }),
  );

  expect(onRowsChange).toHaveBeenCalledWith([]);
  expect(onConfirmedChange).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 6: 컴포넌트 테스트를 실행해 통과 확인**

Run:

```bash
pnpm --filter @event-roster/web test -- src/features/roster/BulkParticipantRowsField.test.tsx
```

Expected: `BulkParticipantRowsField.test.tsx` 전체 PASS.

- [ ] **Step 7: 카드 구조 변경 커밋**

```bash
git add apps/web/src/features/roster/BulkParticipantRowsField.test.tsx apps/web/src/features/roster/BulkParticipantRowsField.tsx
git commit -m "feat: compact bulk participant card structure"
```

---

### Task 2: 컴팩트 모달 크기와 시각적 구분 스타일

**Files:**
- Modify: `apps/web/src/components/ui/Dialog.test.tsx`
- Modify: `apps/web/src/components/ui/Dialog.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 1이 만드는 전용 클래스와 기존 `Dialog`의 `size` prop
- Produces: `Dialog`의 `size: "roster-compact"` 변형, 신규 참가자 모드의 `.er-dialog--roster-compact`, 컴팩트 카드 및 반응형 스타일

- [ ] **Step 1: 새 Dialog 크기 변형과 모드별 적용을 검증하는 실패 테스트 작성**

`Dialog.test.tsx`에 `supports the compact roster size` 테스트를 추가한다.

```tsx
render(
  <Dialog title="컴팩트 명단" size="roster-compact" onClose={vi.fn()}>
    내용
  </Dialog>,
);
expect(screen.getByRole("dialog", { name: "컴팩트 명단" })).toHaveClass(
  "er-dialog--roster-compact",
);
```

`roster.test.tsx`에 `uses compact bulk participant layout for new mode` 테스트를 추가한다. 참가자 모달을 `새 참가자`로 전환한 뒤 크기 클래스와 새 카드 구조를 확인한다.

```tsx
fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
expect(screen.getByRole("dialog", { name: "참가자 추가" })).toHaveClass(
  "er-dialog--roster-compact",
);
const addParticipant = screen.getByRole("button", { name: "참가자 추가" });
expect(addParticipant).toHaveClass(
  "er-bulk-participant-add",
);
fireEvent.click(addParticipant);
expect(
  screen.getByRole("button", { name: "1번 참가자 삭제" }),
).toHaveTextContent("×");
```

- [ ] **Step 2: 대상 테스트를 실행해 새 크기 변형이 없어 실패하는지 확인**

Run:

```bash
pnpm --filter @event-roster/web test -- src/components/ui/Dialog.test.tsx src/features/roster/roster.test.tsx -t "compact roster size|compact bulk participant layout"
```

Expected: `roster-compact` 클래스가 렌더링되지 않아 FAIL.

- [ ] **Step 3: Dialog 크기 타입과 ParticipantDialog의 모드별 선택 구현**

`Dialog.tsx`의 size 타입에 값을 추가한다.

```tsx
size?: "default" | "wide" | "roster" | "roster-compact";
```

`ParticipantDialog.tsx`에서는 기존 참가자 모드는 기존 크기, 신규 참가자는 컴팩트 크기를 사용한다.

```tsx
<Dialog
  title="참가자 추가"
  hideDefaultCloseAction
  size={mode === "NEW" ? "roster-compact" : "roster"}
  onClose={close}
>
```

- [ ] **Step 4: 모달과 카드의 컴팩트 전용 CSS 구현**

`global.css`에 roster 너비를 공유하는 낮은 모달 변형을 추가한다.

```css
.er-dialog--roster-compact {
  width: min(100%, 52rem);
  max-height: min(80dvh, 44rem);
}
```

기존 일괄 입력 스타일을 아래 책임에 맞게 교체한다.

```css
.er-bulk-participant-summary {
  display: grid;
  min-height: 0;
  gap: var(--er-space-3);
}
.er-bulk-participant-count {
  color: var(--er-color-muted);
  font-size: 0.875rem;
}
.er-bulk-participant-rows {
  display: grid;
  gap: var(--er-space-2);
  max-height: min(42dvh, 20rem);
  overflow-y: auto;
  padding-right: var(--er-space-1);
}
.er-bulk-participant-empty {
  margin: 0;
  padding: var(--er-space-4);
  border: 1px dashed var(--er-color-border);
  border-radius: var(--er-radius-md);
  color: var(--er-color-muted);
  text-align: center;
  background: var(--er-color-canvas);
}
.er-bulk-participant-row {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(8rem, 1fr));
  gap: var(--er-space-2) var(--er-space-3);
  align-items: start;
  margin: 0;
  padding: var(--er-space-3);
  padding-top: var(--er-space-6);
  border: 1px solid var(--er-color-border);
  border-radius: var(--er-radius-md);
  background: var(--er-color-canvas);
}
.er-bulk-participant-row__heading {
  position: absolute;
  top: var(--er-space-2);
  left: var(--er-space-3);
  font-size: 0.8125rem;
  font-weight: var(--er-font-weight-bold);
}
.er-bulk-participant-row__remove {
  position: absolute;
  top: var(--er-space-1);
  right: var(--er-space-1);
  min-width: 2rem;
  min-height: 2rem;
  padding: 0;
  border-color: transparent;
  color: var(--er-color-muted);
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
}
.er-bulk-participant-row__remove:hover,
.er-bulk-participant-row__remove:focus-visible {
  color: var(--er-color-danger);
  border-color: var(--er-color-danger);
}
.er-bulk-participant-add {
  width: 100%;
  justify-content: center;
}
```

기존 `@media (max-width: 48rem)` 규칙은 카드가 2열이 되게 바꾸고, `@media (max-width: 36rem)`에는 1열 규칙을 추가한다.

```css
@media (max-width: 48rem) {
  .er-dialog--roster-compact {
    max-height: calc(100dvh - 2rem);
  }
  .er-bulk-participant-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 36rem) {
  .er-bulk-participant-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Dialog 및 명단 대상 테스트 실행**

Run:

```bash
pnpm --filter @event-roster/web test -- src/components/ui/Dialog.test.tsx src/features/roster/BulkParticipantRowsField.test.tsx src/features/roster/roster.test.tsx
```

Expected: 세 테스트 파일 전체 PASS.

- [ ] **Step 6: 웹 전체 테스트, 타입 검사, 프로덕션 빌드 실행**

Run:

```bash
pnpm --filter @event-roster/web test
pnpm --filter @event-roster/web check
pnpm --filter @event-roster/web build
```

Expected: 웹 전체 테스트, TypeScript 검사, Vite 빌드 PASS.

- [ ] **Step 7: 컴팩트 모달 스타일 커밋**

```bash
git add apps/web/src/components/ui/Dialog.test.tsx apps/web/src/components/ui/Dialog.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/styles/global.css
git commit -m "style: compact bulk participant dialog"
```
