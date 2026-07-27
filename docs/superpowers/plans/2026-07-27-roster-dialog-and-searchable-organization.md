# Roster Dialog and Searchable Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 추가 모달과 참가 명단 필터의 간격을 정돈하고, 소속 조직을 입력으로 검색한 뒤 유효한 프로젝트 조직을 명시적으로 선택하는 콤보박스로 바꾼다.

**Architecture:** 조직 이름 정규화는 작은 공통 유틸리티로 분리해 기존 프로젝트 조직 검색과 새 선택 전용 콤보박스가 공유한다. `OrganizationSelectCombobox`는 검색·키보드·명시적 선택 상태만 담당하고, `ParticipantDialog`가 기존/신규 참가자별 organization ID와 제출 가능 여부를 소유한다. 레이아웃은 새 외부 의존성 없이 기존 spacing token과 dialog/action class를 조합한다.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, Vitest 4, Testing Library, CSS custom properties, pnpm 10.28.1

## Global Constraints

- 디자인 기준은 `docs/superpowers/specs/2026-07-27-project-organization-exclusion-and-roster-usability-design.md`의 4–6절이다.
- `확정 소속 조직`과 새 참가자의 `소속 조직`은 입력 문자열을 직접 저장하지 않고 후보 조직 하나를 선택해야 유효하다.
- 후보는 현재 프로젝트에 연결된 활성 조직만 사용한다.
- 검색은 Unicode NFKC 정규화, trim, locale 소문자 변환 후 조직 이름 부분 일치다.
- 콤보박스에서 새 조직을 만들지 않는다.
- 입력을 수정하면 기존 선택을 즉시 해제하고 제출 버튼을 비활성화한다.
- 검색 결과가 없으면 `일치하는 조직이 없습니다.`를 표시한다.
- `ArrowDown`, `ArrowUp`, `Enter`, `Escape`, 마우스 선택을 지원한다.
- 조직 담당자가 기존 참가자를 추가할 때는 현재 소속을 읽기 전용으로 유지한다.
- 기존 참가자 추가 및 새 참가자 생성 API payload는 변경하지 않는다.
- mutation 중 중복 제출과 모달 닫기를 막고, 실패하면 입력과 선택을 유지한다.
- 새 spacing 값과 breakpoint를 추가하지 않고 기존 디자인 token과 `36rem`, `42rem`, `60rem` breakpoint 중 필요한 값을 사용한다.
- 외부 UI 또는 검색 라이브러리를 추가하지 않는다.

---

## File Structure

### New files

- `apps/web/src/lib/organization-name.ts`
  - 조직 검색에 쓰는 문자열 정규화만 담당한다.
- `apps/web/src/lib/organization-name.test.ts`
  - NFKC, 공백, 대소문자 정규화를 검증한다.
- `apps/web/src/features/roster/OrganizationSelectCombobox.tsx`
  - 기존 활성 조직 중 하나를 검색·선택하는 접근 가능한 콤보박스다.
- `apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx`
  - 필터, 명시적 선택, 키보드, 빈 결과, blur를 독립 검증한다.

### Modified files

- `apps/web/src/features/projects/OrganizationCombobox.tsx`
  - 로컬 정규화 함수 대신 공통 유틸리티를 사용한다.
- `apps/web/src/features/projects/project-detail.test.tsx`
  - 기존 조직 추가 검색이 공통 정규화 후에도 유지됨을 회귀 검증한다.
- `apps/web/src/features/roster/ParticipantDialog.tsx`
  - 두 소속 필드를 선택 전용 콤보박스로 바꾸고 공통 dialog form/action 구조를 사용한다.
- `apps/web/src/features/roster/RosterTable.tsx`
  - 필터에 전용 반응형 grid class를 사용한다.
- `apps/web/src/features/roster/ProjectRosterPage.tsx`
  - 상단 action row의 기존 wrap/gap 계약을 유지한다.
- `apps/web/src/features/roster/roster.test.tsx`
  - 모달 구조, 검색 선택, payload, pending, 필터 구조를 검증한다.
- `apps/web/src/styles/global.css`
  - 선택 콤보박스, 참가자 모달, 명단 필터의 간격과 반응형 배치를 제공한다.

---

### Task 1: Shared Organization Name Normalization

**Files:**

- Create: `apps/web/src/lib/organization-name.ts`
- Create: `apps/web/src/lib/organization-name.test.ts`
- Modify: `apps/web/src/features/projects/OrganizationCombobox.tsx:1-70`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`

**Interfaces:**

- Produces:

```ts
export function canonicalizeOrganizationInput(value: string): string;
```

- Consumes: arbitrary organization-name query strings
- Preserves: existing project organization combobox filtering, exact-match detection, and new-organization option

- [ ] **Step 1: 정규화 유틸리티의 실패 테스트를 작성한다**

Create `apps/web/src/lib/organization-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalizeOrganizationInput } from "./organization-name";

describe("canonicalizeOrganizationInput", () => {
  it.each([
    ["  성룡사  ", "성룡사"],
    ["Ｅ２Ｅ 1팀", "e2e 1팀"],
    ["Platform TEAM", "platform team"],
  ])("%s를 검색 키 %s로 정규화한다", (value, expected) => {
    expect(canonicalizeOrganizationInput(value)).toBe(expected);
  });
});
```

- [ ] **Step 2: unit test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/lib/organization-name.test.ts
```

Expected: FAIL because `./organization-name` does not exist.

- [ ] **Step 3: 최소 유틸리티를 만들고 기존 콤보박스가 공유하게 한다**

Create `apps/web/src/lib/organization-name.ts`:

```ts
export function canonicalizeOrganizationInput(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
```

In `apps/web/src/features/projects/OrganizationCombobox.tsx`, import it:

```ts
import { canonicalizeOrganizationInput } from "../../lib/organization-name";
```

Delete the component-local exported function:

```ts
export function canonicalizeOrganizationInput(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
```

No other filtering code changes in this task.

- [ ] **Step 4: unit 및 기존 project combobox tests를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/lib/organization-name.test.ts \
  src/features/projects/project-detail.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: tests PASS and Web check exits `0`.

- [ ] **Step 5: Task 1을 commit한다**

```bash
git add \
  apps/web/src/lib/organization-name.ts \
  apps/web/src/lib/organization-name.test.ts \
  apps/web/src/features/projects/OrganizationCombobox.tsx
git commit -m "refactor: share organization search normalization"
```

---

### Task 2: Selection-Only Organization Combobox

**Files:**

- Create: `apps/web/src/features/roster/OrganizationSelectCombobox.tsx`
- Create: `apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes:

```ts
interface OrganizationSelectComboboxProps {
  label: string;
  organizations: Organization[];
  value: string;
  disabled?: boolean;
  onChange(organizationId: string): void;
}
```

- Produces: selected organization ID or `""` when the user edits away from an explicit selection
- Depends on: Task 1's `canonicalizeOrganizationInput`

- [ ] **Step 1: 검색과 명시적 선택의 실패 테스트를 작성한다**

Create `apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizationSelectCombobox } from "./OrganizationSelectCombobox";

const organizations = [
  { id: "org-1", name: "성룡사", isActive: true },
  { id: "org-2", name: "황룡사", isActive: true },
  { id: "org-inactive", name: "비활성 조직", isActive: false },
];

afterEach(cleanup);

it("filters active organizations and requires an explicit selection", () => {
  const onChange = vi.fn();
  render(
    <OrganizationSelectCombobox
      label="확정 소속 조직"
      organizations={organizations}
      value="org-1"
      onChange={onChange}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(input).toHaveValue("성룡사");
  fireEvent.change(input, { target: { value: "룡사" } });

  expect(onChange).toHaveBeenCalledWith("");
  expect(screen.getByRole("option", { name: "성룡사" })).toBeVisible();
  expect(screen.getByRole("option", { name: "황룡사" })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "비활성 조직" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("option", { name: "황룡사" }));
  expect(onChange).toHaveBeenLastCalledWith("org-2");
  expect(input).toHaveValue("황룡사");
});

it("selects a filtered option with ArrowDown and Enter", () => {
  const onChange = vi.fn();
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={onChange}
    />,
  );

  const input = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.change(input, { target: { value: "황" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const option = screen.getByRole("option", { name: "황룡사" });
  expect(input).toHaveAttribute("aria-activedescendant", option.id);
  fireEvent.keyDown(input, { key: "Enter" });

  expect(onChange).toHaveBeenLastCalledWith("org-2");
  expect(input).toHaveValue("황룡사");
});

it("shows a non-error empty result and closes with Escape", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );

  const input = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.change(input, { target: { value: "없는 조직" } });
  expect(screen.getByText("일치하는 조직이 없습니다.")).toBeVisible();
  expect(input).toHaveAttribute("aria-expanded", "true");

  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByText("일치하는 조직이 없습니다."),
  ).not.toBeInTheDocument();
});

it("closes when focus leaves the combobox", () => {
  render(
    <>
      <OrganizationSelectCombobox
        label="소속 조직"
        organizations={organizations}
        value=""
        onChange={vi.fn()}
      />
      <button type="button">다음</button>
    </>,
  );

  const input = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.focus(input);
  expect(input).toHaveAttribute("aria-expanded", "true");
  fireEvent.blur(input, {
    relatedTarget: screen.getByRole("button", { name: "다음" }),
  });
  expect(input).toHaveAttribute("aria-expanded", "false");
});
```

- [ ] **Step 2: focused test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/OrganizationSelectCombobox.test.tsx
```

Expected: FAIL because `OrganizationSelectCombobox` does not exist.

- [ ] **Step 3: 선택 전용 콤보박스의 상태와 후보 계산을 구현한다**

Create `apps/web/src/features/roster/OrganizationSelectCombobox.tsx` with these
imports and props:

```tsx
import type { Organization } from "@event-roster/contracts";
import {
  type FocusEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { canonicalizeOrganizationInput } from "../../lib/organization-name";

export interface OrganizationSelectComboboxProps {
  label: string;
  organizations: Organization[];
  value: string;
  disabled?: boolean;
  onChange(organizationId: string): void;
}
```

Inside the component, derive the selected organization and synchronize the displayed
query when `value` or candidates change:

```ts
const listboxId = useId();
const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
const committedValueRef = useRef(value);
const selected = organizations.find(
  (organization) => organization.isActive && organization.id === value,
);
const [query, setQuery] = useState(selected?.name ?? "");
const [open, setOpen] = useState(false);
const [activeIndex, setActiveIndex] = useState(-1);

useEffect(() => {
  if (committedValueRef.current === value) return;
  committedValueRef.current = value;
  setQuery(selected?.name ?? "");
}, [selected?.name, value]);

useEffect(() => {
  if (!value || selected) return;
  committedValueRef.current = "";
  setQuery("");
  onChange("");
}, [onChange, selected, value]);

const options = useMemo(() => {
  const key = canonicalizeOrganizationInput(query);
  return organizations.filter(
    (organization) =>
      organization.isActive &&
      (!key ||
        canonicalizeOrganizationInput(organization.name).includes(key)),
  );
}, [organizations, query]);
```

Implement `select`, enabled cyclic arrow movement, and active option scrolling using
the same behavior as the existing project `OrganizationCombobox`:

```ts
function select(organization: Organization) {
  setQuery(organization.name);
  committedValueRef.current = organization.id;
  onChange(organization.id);
  setOpen(false);
  setActiveIndex(-1);
}

function moveActive(direction: 1 | -1) {
  if (options.length === 0) return;
  setOpen(true);
  setActiveIndex((current) => {
    if (current < 0) return direction === 1 ? 0 : options.length - 1;
    return (current + direction + options.length) % options.length;
  });
}

useEffect(() => {
  if (activeIndex < 0) return;
  optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
}, [activeIndex]);
```

- [ ] **Step 4: 접근 가능한 markup과 조작을 구현한다**

Return this structure:

```tsx
<div
  className="er-selection-combobox"
  onBlur={(event: FocusEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setOpen(false);
    setActiveIndex(-1);
  }}
>
  <label className="er-field">
    <span>{label}</span>
    <input
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={
        open && activeIndex >= 0
          ? `${listboxId}-option-${activeIndex}`
          : undefined
      }
      autoComplete="off"
      disabled={disabled}
      value={query}
      onFocus={() => {
        setOpen(true);
        setActiveIndex(-1);
      }}
      onChange={(event) => {
        setQuery(event.currentTarget.value);
        committedValueRef.current = "";
        onChange("");
        setOpen(true);
        setActiveIndex(-1);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter" && open && options.length > 0) {
          event.preventDefault();
          select(options[activeIndex >= 0 ? activeIndex : 0]!);
        }
      }}
    />
  </label>
  {open ? (
    <div id={listboxId} className="er-combobox-list" role="listbox">
      {options.length === 0 ? (
        <p className="er-combobox-empty">일치하는 조직이 없습니다.</p>
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
            aria-selected={activeIndex === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(organization)}
          >
            {organization.name}
          </button>
        ))
      )}
    </div>
  ) : null}
</div>
```

The non-null assertion is safe because the branch requires `options.length > 0`
and chooses either a valid active index or index `0`.

- [ ] **Step 5: 콤보박스 스타일을 기존 list/option 스타일에 연결한다**

In `apps/web/src/styles/global.css`, add:

```css
.er-selection-combobox {
  position: relative;
  min-width: 0;
}
.er-combobox-empty {
  margin: 0;
  padding: var(--er-space-3);
  color: var(--er-color-muted);
}
```

Do not duplicate `.er-combobox-list` or `.er-combobox-option`.

- [ ] **Step 6: focused tests와 Web check를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/OrganizationSelectCombobox.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: 4 combobox tests PASS and Web check exits `0`.

- [ ] **Step 7: Task 2를 commit한다**

```bash
git add \
  apps/web/src/features/roster/OrganizationSelectCombobox.tsx \
  apps/web/src/features/roster/OrganizationSelectCombobox.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: add searchable organization selection"
```

---

### Task 3: Participant Dialog Selection and Spacing

**Files:**

- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes: Task 2's `OrganizationSelectCombobox`
- Produces: unchanged `ExistingParticipantConfirmation` and
  `{ name: string; organizationId: string }` callbacks
- Preserves: participant candidate selection, confirmed name editing, manager scope,
  pending-state input preservation

- [ ] **Step 1: 모달 구조와 검색 선택의 실패 테스트를 작성한다**

In `apps/web/src/features/roster/roster.test.tsx`, add:

```tsx
it("groups participant fields and actions with visible spacing hooks", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "참가자 추가" });
  expect(
    screen.getByRole("button", { name: "기존 참가자" }).parentElement,
  ).toHaveClass("er-participant-mode-actions");
  expect(screen.getByLabelText("참가자").closest("form")).toHaveClass(
    "er-dialog-form",
  );
  expect(
    within(dialog).getByRole("button", { name: "닫기" }).parentElement,
  ).toHaveClass("er-dialog-actions");
  expect(
    within(dialog).getByRole("button", { name: "명단에 추가" }).parentElement,
  ).toHaveClass("er-dialog-actions");
});

it("clears a selected organization when its search text changes", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeEnabled();
  fireEvent.change(organization, { target: { value: "황" } });
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeDisabled();
  fireEvent.click(screen.getByRole("option", { name: "황룡사" }));
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeEnabled();
});
```

Change the existing operator payload test from native select change:

```ts
fireEvent.change(screen.getByLabelText("확정 소속 조직"), {
  target: { value: "org-2" },
});
```

to:

```ts
const organization = screen.getByRole("combobox", {
  name: "확정 소속 조직",
});
fireEvent.change(organization, { target: { value: "2팀" } });
fireEvent.click(screen.getByRole("option", { name: "2팀" }));
```

Keep its final request assertion unchanged: `organizationId` must be `"org-2"`.

For the manager read-only test, change the assertion to visible text:

```ts
const organization = screen.getByLabelText("확정 소속 조직");
expect(organization).toBeDisabled();
expect(organization).toHaveValue("1팀");
expect(
  screen.queryByRole("combobox", { name: "확정 소속 조직" }),
).not.toBeInTheDocument();
```

- [ ] **Step 2: focused dialog tests를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx
```

Expected:

- no dialog form/action layout wrappers
- organization fields remain native selects
- typing organization text and explicit option selection are unavailable

- [ ] **Step 3: dialog close guard와 공통 form 구조를 적용한다**

In `ParticipantDialog.tsx`, import:

```ts
import { OrganizationSelectCombobox } from "./OrganizationSelectCombobox";
```

Use the busy-aware close handler:

```ts
const close = () => {
  if (busy === null) onClose();
};
```

Change the dialog opening and mode row to:

```tsx
<Dialog
  title="참가자 추가"
  hideDefaultCloseAction
  onClose={close}
>
  <div className="er-participant-mode-actions er-action-row">
    <Button
      type="button"
      variant={mode === "EXISTING" ? "primary" : "secondary"}
      disabled={busy !== null}
      onClick={() => setMode("EXISTING")}
    >
      기존 참가자
    </Button>
    <Button
      type="button"
      variant={mode === "NEW" ? "primary" : "secondary"}
      disabled={busy !== null}
      onClick={() => setMode("NEW")}
    >
      새 참가자
    </Button>
  </div>
</Dialog>
```

Place one `<form className="er-dialog-form">` inside the dialog after the mode row.
Its `onSubmit` prevents native submission and calls `addExisting()` when
`mode === "EXISTING"` or `createAndAdd()` when `mode === "NEW"`. Move the current
mode conditional inside that form. Steps 4 and 5 define the exact action contents;
no primary button remains outside `.er-dialog-actions`.

- [ ] **Step 4: 기존 참가자 소속을 검색 선택 또는 읽기 전용으로 렌더한다**

For an operator-capable existing participant, render:

```tsx
<OrganizationSelectCombobox
  label="확정 소속 조직"
  organizations={organizations}
  value={confirmedOrganizationId}
  disabled={busy !== null}
  onChange={setConfirmedOrganizationId}
/>
```

When `allowExistingOrganizationChange` is false, render:

```tsx
<TextInput
  label="확정 소속 조직"
  value={
    organizations.find(
      (organization) =>
        organization.id === selectedParticipant?.organizationId,
    )?.name ?? ""
  }
  disabled
  readOnly
/>
```

Keep `confirmedOrganizationId` set to the selected participant's organization ID
so the unchanged submit callback sends the ID, not the displayed name.

End the existing-participant branch with:

```tsx
<div className="er-dialog-actions">
  <Button type="button" disabled={busy !== null} onClick={close}>
    닫기
  </Button>
  <Button
    type="submit"
    variant="primary"
    loading={busy === "EXISTING"}
    loadingText="명단에 추가 중…"
    disabled={
      busy !== null ||
      !selectedParticipant ||
      !confirmedName.trim() ||
      !confirmedOrganizationId
    }
  >
    명단에 추가
  </Button>
</div>
```

- [ ] **Step 5: 새 참가자 소속에도 같은 선택 계약을 적용한다**

Replace the new-participant native select with:

```tsx
<OrganizationSelectCombobox
  label="소속 조직"
  organizations={organizations}
  value={organizationId}
  disabled={busy !== null}
  onChange={setOrganizationId}
/>
```

End the new-participant branch with:

```tsx
<div className="er-dialog-actions">
  <Button type="button" disabled={busy !== null} onClick={close}>
    닫기
  </Button>
  <Button
    type="submit"
    variant="primary"
    loading={busy === "NEW"}
    loadingText="참가자 만드는 중…"
    disabled={busy !== null || !name.trim() || !organizationId}
  >
    참가자 생성 후 추가
  </Button>
</div>
```

Mode 전환은 각 모드가 가진 `confirmedOrganizationId`와 `organizationId`를
그대로 보존한다.

- [ ] **Step 6: 모달 spacing hook을 스타일링한다**

In `apps/web/src/styles/global.css`, add:

```css
.er-participant-mode-actions {
  margin-top: var(--er-space-4);
}
.er-participant-mode-actions + .er-dialog-form {
  margin-top: var(--er-space-4);
}
```

Use the existing `.er-dialog-form { gap: var(--er-space-4) }` and
`.er-dialog-actions { gap: var(--er-space-3) }`; do not duplicate their rules.

- [ ] **Step 7: pending 상태에서 닫기 차단과 실패 보존 assertion을 보강한다**

In both existing pending dialog tests, after the primary action starts, add:

```ts
fireEvent.click(screen.getByRole("button", { name: "닫기" }));
fireEvent.keyDown(screen.getByRole("dialog", { name: "참가자 추가" }), {
  key: "Escape",
});
expect(onClose).not.toHaveBeenCalled();
expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
```

For the new-participant pending test, store `const onClose = vi.fn()` and pass it
so the same assertion is possible.

- [ ] **Step 8: focused dialog tests와 Web check를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/OrganizationSelectCombobox.test.tsx \
  src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: combobox and dialog tests PASS; Web check exits `0`.

- [ ] **Step 9: Task 3을 commit한다**

```bash
git add \
  apps/web/src/features/roster/ParticipantDialog.tsx \
  apps/web/src/features/roster/roster.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: improve participant organization selection"
```

---

### Task 4: Responsive Roster Filter Spacing

**Files:**

- Modify: `apps/web/src/features/roster/RosterTable.tsx:60-99`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx:200-230`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes: existing local `query`, `organization`, and `status` filter state
- Produces: responsive grid and stable action spacing without filter behavior changes
- Preserves: 130-row cap, search semantics, select values, table rendering

- [ ] **Step 1: 필터와 action spacing hook의 실패 테스트를 작성한다**

In `apps/web/src/features/roster/roster.test.tsx`, add:

```tsx
it("uses dedicated responsive spacing for roster actions and filters", () => {
  render(
    <ProjectRosterPage
      project={project()}
      rows={[entry("ACTIVE")]}
      participants={[]}
      organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
      canMutate
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const exportButton = screen.getByRole("button", {
    name: "엑셀 내보내기",
  });
  const addButton = screen.getByRole("button", { name: "참가자 추가" });
  expect(exportButton.parentElement).toBe(addButton.parentElement);
  expect(exportButton.parentElement).toHaveClass(
    "er-roster-actions",
    "er-action-row--wrap",
  );

  const filterGrid = screen.getByLabelText("명단 검색").parentElement
    ?.parentElement;
  expect(filterGrid).toHaveClass("er-roster-filters");
  expect(within(filterGrid as HTMLElement).getByLabelText("조직 필터")).toBeVisible();
  expect(within(filterGrid as HTMLElement).getByLabelText("상태 필터")).toBeVisible();
});
```

Keep the existing filter behavior tests unchanged.

- [ ] **Step 2: focused test를 실행해 RED를 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx
```

Expected: `.er-roster-actions` and `.er-roster-filters` are absent.

- [ ] **Step 3: 전용 class를 markup에 적용한다**

In `ProjectRosterPage.tsx`, change the action row class only:

```tsx
<div className="er-roster-actions er-action-row er-action-row--wrap">
```

In `RosterTable.tsx`, replace:

```tsx
<div className="er-filter-row">
```

with:

```tsx
<div className="er-roster-filters">
```

Do not change state, filtering, labels, or select options.

- [ ] **Step 4: 데스크톱과 모바일 grid를 구현한다**

In `apps/web/src/styles/global.css`, add:

```css
.er-roster-actions {
  gap: var(--er-space-3);
}
.er-roster-filters {
  display: grid;
  grid-template-columns: minmax(16rem, 2fr) repeat(2, minmax(10rem, 1fr));
  align-items: end;
  gap: var(--er-space-4);
}
```

Inside the existing `@media (max-width: 42rem)` block, add:

```css
.er-roster-filters {
  grid-template-columns: 1fr;
}
```

The surrounding `.er-page-stack` already provides `var(--er-space-6)` between
the filter grid and table, so do not add a duplicate hard-coded margin.

- [ ] **Step 5: focused tests, check, and production build를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx \
  src/features/imports/export.test.ts
corepack pnpm@10.28.1 --filter @event-roster/web run check
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: tests PASS, type checks exit `0`, and Vite production build succeeds.

- [ ] **Step 6: Task 4를 commit한다**

```bash
git add \
  apps/web/src/features/roster/RosterTable.tsx \
  apps/web/src/features/roster/ProjectRosterPage.tsx \
  apps/web/src/features/roster/roster.test.tsx \
  apps/web/src/styles/global.css
git commit -m "style: improve roster action and filter spacing"
```

---

### Task 5: Plan-Wide Verification

**Files:**

- Verify only; no planned source file changes

**Interfaces:**

- Consumes: Tasks 1–4
- Produces: evidence that the searchable selection, spacing, payload, and build work together

- [ ] **Step 1: forbidden dependency와 stale native organization select를 검사한다**

Run:

```bash
git diff main -- package.json pnpm-lock.yaml
rg -n "<select" apps/web/src/features/roster/ParticipantDialog.tsx
```

Expected: no dependency diff and no organization `<select>` remains in
`ParticipantDialog.tsx`. The participant candidate select may remain, so inspect any
match and confirm its accessible label is `참가자`.

- [ ] **Step 2: 전체 정적 검사와 테스트를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 run format:check
corepack pnpm@10.28.1 run check
corepack pnpm@10.28.1 run test
corepack pnpm@10.28.1 --filter @event-roster/web run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: 좁은 화면 E2E 회귀를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  --project=chromium
```

Expected: Playwright Chromium suite passes, including existing dialog focus and
mobile layout coverage.

- [ ] **Step 4: 실패가 있으면 소유 Task로 되돌아간다**

The verification commands are read-only. If one fails, return to the task that owns
the failing file, add a focused regression assertion, implement the smallest fix,
rerun that task's commands, and amend only that task's commit. Do not create an empty
verification commit.
