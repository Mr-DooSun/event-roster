# Dialog Form Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 조직·새 프로젝트·프로젝트 수정 모달의 버튼을 간격 있는 하단 액션 행으로 정리하고, 프로젝트 날짜 입력 영역 전체를 클릭해 네이티브 달력을 열 수 있게 한다.

**Architecture:** 날짜 전용 동작은 새 `DateInput` 컴포넌트에 격리하고 일반 `TextInput`은 변경하지 않는다. `Dialog`에는 기존 기본 닫기 버튼을 선택적으로 숨기는 하위 호환 prop만 추가하며, 대상 모달 세 곳은 자체 form 안에서 공통 CSS class로 날짜 행과 액션 행을 구성한다.

**Tech Stack:** React 19, TypeScript 5.9, native `input type="date"`/`showPicker()`, Vitest 4, Testing Library, CSS custom properties, pnpm 10.28.1

## Global Constraints

- 새 조직, 새 프로젝트, 프로젝트 수정 및 일정 수정 모달만 변경한다.
- 프로젝트 상세 화면, 일반 텍스트 입력, 날짜 저장 형식과 API 계약은 변경하지 않는다.
- 커스텀 달력 UI와 날짜 라이브러리를 추가하지 않는다.
- 프로젝트 이름은 첫 번째 행 전체 너비를 사용한다.
- 시작일과 종료일은 데스크톱에서 같은 너비의 한 행, 36rem 이하에서 한 열로 배치한다.
- 액션 행은 데스크톱에서 오른쪽 정렬하고 버튼 간격은 정확히 `var(--er-space-3)`을 사용한다.
- 액션 DOM 순서는 `닫기`가 먼저이고 주요 실행 버튼이 다음이다.
- `showPicker()` 미지원 또는 호출 실패 시 예외를 전파하지 않고 focus된 네이티브 날짜 입력을 유지한다.
- disabled 날짜 입력에서는 picker를 열지 않는다.
- 기존 날짜 역전 validation, 제출 payload, busy/disabled 상태, Escape 닫기, focus trap과 focus 복원을 유지한다.
- 기존 `Dialog` 호출부는 새 prop을 전달하지 않으면 현재 기본 닫기 버튼을 그대로 제공한다.
- 일반 목록·검색 폼의 `er-form-grid` 동작은 변경하지 않는다.

---

## File Structure

- Create: `apps/web/src/components/ui/DateInput.tsx` — 네이티브 날짜 input, 접근 가능한 label/hint 연결, 안전한 `showPicker()` 호출만 담당한다.
- Create: `apps/web/src/components/ui/DateInput.test.tsx` — picker 지원·실패·disabled·label 연결을 독립적으로 검증한다.
- Modify: `apps/web/src/components/ui/Dialog.tsx` — `hideDefaultCloseAction?: boolean` 하위 호환 API를 제공한다.
- Modify: `apps/web/src/components/ui/Dialog.test.tsx` — 기본 닫기 유지와 명시적 숨김을 검증한다.
- Modify: `apps/web/src/features/projects/ProjectFormDialog.tsx` — 생성 폼을 이름 행, 날짜 행, 오류, 액션 행으로 조립한다.
- Modify: `apps/web/src/features/projects/ProjectEditDialog.tsx` — 수정/일정 폼에 같은 구조를 적용한다.
- Create: `apps/web/src/features/projects/ProjectEditDialog.test.tsx` — 수정 모달의 공통 레이아웃과 기존 payload를 집중 검증한다.
- Modify: `apps/web/src/features/projects/projects.test.tsx` — 생성 모달 구조·버튼 순서와 기존 validation을 검증한다.
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx` — 조직 생성 폼에 자체 액션 행을 둔다.
- Modify: `apps/web/src/features/admin/admin.test.tsx` — 조직 모달의 form/action 구조를 검증한다.
- Modify: `apps/web/src/styles/global.css` — 모달 전용 form/date/action class와 날짜 cursor, 모바일 한 열 배치를 제공한다.

### Task 1: Accessible Native Date Input

**Files:**
- Create: `apps/web/src/components/ui/DateInput.tsx`
- Create: `apps/web/src/components/ui/DateInput.test.tsx`
- Reference: `apps/web/src/components/ui/TextInput.tsx`

**Interfaces:**
- Consumes: native `InputHTMLAttributes<HTMLInputElement>`에서 `type`을 제외한 속성
- Produces: `DateInput({ label, hint?, id?, disabled?, onClick?, ...inputProps })`

- [ ] **Step 1: picker 동작을 정의하는 실패 테스트를 작성한다**

Create `apps/web/src/components/ui/DateInput.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DateInput } from "./DateInput";

afterEach(cleanup);

it("opens the native picker when the date input area is clicked", () => {
  const showPicker = vi.fn();
  render(<DateInput label="시작일" value="" onChange={() => undefined} />);
  const input = screen.getByLabelText("시작일");
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: showPicker,
  });

  fireEvent.click(input);

  expect(input).toHaveFocus();
  expect(showPicker).toHaveBeenCalledOnce();
});

it("keeps the native input usable when showPicker throws", () => {
  render(<DateInput label="종료일" value="" onChange={() => undefined} />);
  const input = screen.getByLabelText("종료일");
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: () => {
      throw new DOMException("Picker blocked", "NotAllowedError");
    },
  });

  expect(() => fireEvent.click(input)).not.toThrow();
  expect(input).toHaveFocus();
});

it("does not open a picker for a disabled date input", () => {
  const showPicker = vi.fn();
  render(
    <DateInput
      label="시작일"
      value=""
      disabled
      onChange={() => undefined}
    />,
  );
  const input = screen.getByLabelText("시작일");
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: showPicker,
  });

  fireEvent.click(input);

  expect(showPicker).not.toHaveBeenCalled();
});

it("keeps the label, hint, and native date type connected", () => {
  render(
    <DateInput
      id="project-start-date"
      label="시작일"
      hint="선택 사항"
      value=""
      onChange={() => undefined}
    />,
  );
  const input = screen.getByLabelText("시작일");

  expect(input).toHaveAttribute("type", "date");
  expect(input).toHaveAttribute("id", "project-start-date");
  expect(input).toHaveAccessibleDescription("선택 사항");
  expect(screen.getByText("시작일").closest("label")).toHaveAttribute(
    "for",
    "project-start-date",
  );
});
```

- [ ] **Step 2: focused test가 예상대로 실패하는지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/components/ui/DateInput.test.tsx
```

Expected: FAIL because `./DateInput` cannot be resolved.

- [ ] **Step 3: 최소 DateInput 구현을 작성한다**

Create `apps/web/src/components/ui/DateInput.tsx`:

```tsx
import {
  type InputHTMLAttributes,
  type MouseEvent,
  useId,
  useRef,
} from "react";

interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

export function DateInput({
  label,
  hint,
  id,
  disabled,
  onClick,
  ...props
}: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // The focused native date input remains usable when picker access is blocked.
    }
  }

  return (
    <label className="er-field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        {...props}
        ref={inputRef}
        id={inputId}
        type="date"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={handleClick}
      />
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}
```

- [ ] **Step 4: focused test와 typecheck를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/components/ui/DateInput.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: `DateInput.test.tsx`의 4 tests PASS; Web TypeScript checks exit `0`.

- [ ] **Step 5: Task 1을 commit한다**

```bash
git add apps/web/src/components/ui/DateInput.tsx apps/web/src/components/ui/DateInput.test.tsx
git commit -m "feat: add native date input picker"
```

Expected: 새 컴포넌트와 focused test만 포함한 commit이 생성된다.

### Task 2: Backward-Compatible Dialog Close Action

**Files:**
- Modify: `apps/web/src/components/ui/Dialog.tsx:13-23,98-103`
- Modify: `apps/web/src/components/ui/Dialog.test.tsx:9-37`

**Interfaces:**
- Consumes: 기존 `Dialog` props와 새 `hideDefaultCloseAction?: boolean`
- Produces: prop이 `true`면 자동 닫기 버튼이 없고, 생략/`false`면 기존 닫기 버튼을 유지하는 Dialog

- [ ] **Step 1: 선택적 기본 닫기 버튼의 실패 테스트를 추가한다**

Append after the caller-provided label test in `apps/web/src/components/ui/Dialog.test.tsx`:

```tsx
it("lets a form provide its own close action without rendering a duplicate", () => {
  render(
    <Dialog title="새 프로젝트" onClose={vi.fn()} hideDefaultCloseAction>
      <form>
        <button type="button">폼 닫기</button>
        <button type="submit">프로젝트 만들기</button>
      </form>
    </Dialog>,
  );

  expect(
    screen.queryByRole("button", { name: "닫기" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "폼 닫기" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "프로젝트 만들기" }),
  ).toBeVisible();
});
```

- [ ] **Step 2: focused test가 prop type 오류로 실패하는지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/components/ui/Dialog.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web exec tsc --noEmit
```

Expected: test transform 또는 TypeScript가 `hideDefaultCloseAction`이 Dialog props에 없다고 FAIL.

- [ ] **Step 3: 하위 호환 prop을 최소 구현한다**

Modify the Dialog signature and prop type in `apps/web/src/components/ui/Dialog.tsx`:

```tsx
export function Dialog({
  title,
  children,
  closeLabel = "닫기",
  hideDefaultCloseAction = false,
  onClose,
}: {
  title: string;
  children: ReactNode;
  closeLabel?: string;
  hideDefaultCloseAction?: boolean;
  onClose: () => void;
}) {
```

Replace the unconditional close button at the end of the dialog:

```tsx
{hideDefaultCloseAction ? null : (
  <Button type="button" onClick={onClose}>
    {closeLabel}
  </Button>
)}
```

- [ ] **Step 4: Dialog 회귀 테스트와 typecheck를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/components/ui/Dialog.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: Dialog의 default/custom label, hide action, Tab/Shift+Tab trap, Escape, focus restore tests가 모두 PASS; Web check exit `0`.

- [ ] **Step 5: Task 2를 commit한다**

```bash
git add apps/web/src/components/ui/Dialog.tsx apps/web/src/components/ui/Dialog.test.tsx
git commit -m "feat: support custom dialog action rows"
```

Expected: Dialog API와 회귀 test만 포함한 commit이 생성된다.

### Task 3: Organization and Project Dialog Layouts

**Files:**
- Modify: `apps/web/src/features/projects/ProjectFormDialog.tsx:1-88`
- Modify: `apps/web/src/features/projects/ProjectEditDialog.tsx:1-84`
- Create: `apps/web/src/features/projects/ProjectEditDialog.test.tsx`
- Modify: `apps/web/src/features/projects/projects.test.tsx:94-153`
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx:195-213`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/src/styles/global.css:304-309,651-657,666-712`

**Interfaces:**
- Consumes: Task 1 `DateInput`; Task 2 `Dialog.hideDefaultCloseAction`
- Produces: `er-dialog-form`, `er-dialog-form__dates`, `er-dialog-form__error`, `er-dialog-actions`를 공유하는 세 모달

- [ ] **Step 1: 프로젝트 생성 모달의 실패 테스트를 추가한다**

Append this test after `submits project dates and blocks a reversed range` in `apps/web/src/features/projects/projects.test.tsx`:

```tsx
it("groups project fields and actions into the dialog layout", () => {
  render(
    <ProjectFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />,
  );
  const dialog = screen.getByRole("dialog", { name: "새 프로젝트" });
  const name = within(dialog).getByLabelText("프로젝트 이름");
  const startDate = within(dialog).getByLabelText("시작일");
  const endDate = within(dialog).getByLabelText("종료일");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  const submit = within(dialog).getByRole("button", {
    name: "프로젝트 만들기",
  });
  const form = name.closest("form");
  const dates = startDate.closest(".er-dialog-form__dates");
  const actions = close.closest(".er-dialog-actions");

  expect(form).toHaveClass("er-dialog-form");
  expect(dates).not.toBeNull();
  expect(dates).toContainElement(startDate);
  expect(dates).toContainElement(endDate);
  expect(actions).not.toBeNull();
  expect(actions).toContainElement(submit);
  expect(
    Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    ),
  ).toEqual(["닫기", "프로젝트 만들기"]);
});
```

Add `within` to the existing Testing Library import:

```tsx
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
```

- [ ] **Step 2: 프로젝트 수정 모달 focused 실패 테스트를 작성한다**

Create `apps/web/src/features/projects/ProjectEditDialog.test.tsx`:

```tsx
import type { Project } from "@event-roster/contracts";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectEditDialog } from "./ProjectEditDialog";

afterEach(cleanup);

const project = {
  id: "project-1",
  name: "리더십 캠프",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  status: "PRE_REGISTRATION",
  revision: 4,
  createdAt: "2026-02-10T00:00:00.000Z",
  createdBy: "operator-1",
  updatedAt: "2026-02-10T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
  closeReason: null,
} satisfies Project;

it("uses the shared date and action rows when editing a project", () => {
  render(
    <ProjectEditDialog
      project={project}
      closed={false}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "프로젝트 수정" });
  const startDate = within(dialog).getByLabelText("시작일");
  const endDate = within(dialog).getByLabelText("종료일");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  const save = within(dialog).getByRole("button", { name: "저장" });
  const dates = startDate.closest(".er-dialog-form__dates");
  const actions = close.closest(".er-dialog-actions");

  expect(within(dialog).getByLabelText("프로젝트 이름").closest("form")).toHaveClass(
    "er-dialog-form",
  );
  expect(dates).toContainElement(endDate);
  expect(actions).toContainElement(save);
  expect(
    Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    ),
  ).toEqual(["닫기", "저장"]);
});

it("keeps the edit payload contract after changing dates", () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectEditDialog
      project={project}
      closed={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );

  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-06-01" },
  });
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-06-02" },
  });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  expect(onSubmit).toHaveBeenCalledWith({
    name: "리더십 캠프",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    expectedRevision: 4,
  });
});
```

- [ ] **Step 3: 조직 생성 액션 행의 실패 테스트를 추가한다**

Append to `apps/web/src/features/admin/admin.test.tsx`:

```tsx
it("groups organization creation actions with close first", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) {
        return Promise.resolve(Response.json([]));
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "새 조직" }));
  const dialog = screen.getByRole("dialog", { name: "새 조직" });
  const name = within(dialog).getByLabelText("조직 이름");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  const create = within(dialog).getByRole("button", { name: "조직 만들기" });
  const actions = close.closest(".er-dialog-actions");

  expect(name.closest("form")).toHaveClass("er-dialog-form");
  expect(actions).toContainElement(create);
  expect(
    Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    ),
  ).toEqual(["닫기", "조직 만들기"]);
});
```

- [ ] **Step 4: 세 focused test가 레이아웃 부재로 실패하는지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/projects/projects.test.tsx src/features/projects/ProjectEditDialog.test.tsx src/features/admin/admin.test.tsx
```

Expected: FAIL because the forms do not have `er-dialog-form`, date fields are not inside `er-dialog-form__dates`, and close/create/save buttons are not together in `er-dialog-actions`.

- [ ] **Step 5: 프로젝트 생성 모달을 새 구조로 변경한다**

Replace the imports and returned Dialog form in `apps/web/src/features/projects/ProjectFormDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DateInput } from "../../components/ui/DateInput";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
```

```tsx
<Dialog
  title="새 프로젝트"
  onClose={onClose}
  hideDefaultCloseAction
>
  <form className="er-dialog-form" onSubmit={submit}>
    <TextInput
      label="프로젝트 이름"
      required
      value={name}
      onChange={(event) => setName(event.currentTarget.value)}
    />
    <div className="er-dialog-form__dates">
      <DateInput
        label="시작일"
        value={startDate}
        onChange={(event) => setStartDate(event.currentTarget.value)}
      />
      <DateInput
        label="종료일"
        value={endDate}
        onChange={(event) => setEndDate(event.currentTarget.value)}
      />
    </div>
    {reversed ? (
      <p
        className="er-status er-status--error er-dialog-form__error"
        role="alert"
      >
        종료일은 시작일보다 빠를 수 없습니다.
      </p>
    ) : null}
    <div className="er-dialog-actions">
      <Button type="button" onClick={onClose}>
        닫기
      </Button>
      <Button
        type="submit"
        variant="primary"
        disabled={!name.trim() || reversed || busy}
      >
        프로젝트 만들기
      </Button>
    </div>
  </form>
</Dialog>
```

- [ ] **Step 6: 프로젝트 수정 모달을 같은 구조로 변경한다**

Add the `DateInput` import and replace the returned Dialog form in `apps/web/src/features/projects/ProjectEditDialog.tsx`:

```tsx
import { DateInput } from "../../components/ui/DateInput";
```

```tsx
<Dialog
  title={closed ? "일정 수정" : "프로젝트 수정"}
  onClose={onClose}
  hideDefaultCloseAction
>
  <form className="er-dialog-form" onSubmit={submit}>
    <TextInput
      label="프로젝트 이름"
      required={!closed}
      disabled={closed}
      value={name}
      onChange={(event) => setName(event.currentTarget.value)}
    />
    <div className="er-dialog-form__dates">
      <DateInput
        label="시작일"
        value={startDate}
        onChange={(event) => setStartDate(event.currentTarget.value)}
      />
      <DateInput
        label="종료일"
        value={endDate}
        onChange={(event) => setEndDate(event.currentTarget.value)}
      />
    </div>
    {reversed ? (
      <p
        className="er-status er-status--error er-dialog-form__error"
        role="alert"
      >
        종료일은 시작일보다 빠를 수 없습니다.
      </p>
    ) : null}
    <div className="er-dialog-actions">
      <Button type="button" onClick={onClose}>
        닫기
      </Button>
      <Button
        type="submit"
        variant="primary"
        disabled={busy || reversed || (!closed && !name.trim())}
      >
        저장
      </Button>
    </div>
  </form>
</Dialog>
```

- [ ] **Step 7: 조직 생성 모달에 같은 액션 행을 적용한다**

Replace the create Dialog in `apps/web/src/features/admin/OrganizationsPage.tsx`:

```tsx
<Dialog
  title="새 조직"
  onClose={() => setShowCreate(false)}
  hideDefaultCloseAction
>
  <form className="er-dialog-form" onSubmit={create}>
    {createError ? (
      <StatusMessage tone="error">{createError}</StatusMessage>
    ) : null}
    <TextInput
      label="조직 이름"
      required
      maxLength={100}
      value={name}
      onChange={(event) => setName(event.currentTarget.value)}
    />
    <div className="er-dialog-actions">
      <Button type="button" onClick={() => setShowCreate(false)}>
        닫기
      </Button>
      <Button type="submit" variant="primary" disabled={!name.trim()}>
        조직 만들기
      </Button>
    </div>
  </form>
</Dialog>
```

- [ ] **Step 8: 모달 전용 CSS와 모바일 배치를 구현한다**

Add after `.er-form-grid` in `apps/web/src/styles/global.css`:

```css
.er-dialog-form {
  display: grid;
  gap: var(--er-space-4);
  margin-top: var(--er-space-4);
}
.er-dialog-form__dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--er-space-4);
}
.er-dialog-form__error {
  margin: 0;
}
.er-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--er-space-3);
  margin-top: var(--er-space-2);
}
.er-field input[type="date"]:not(:disabled) {
  cursor: pointer;
}
.er-field input[type="date"]:disabled {
  cursor: not-allowed;
}
```

Add inside the existing `@media (max-width: 36rem)` block:

```css
.er-dialog-form__dates {
  grid-template-columns: 1fr;
}
.er-dialog-actions {
  justify-content: flex-start;
}
```

- [ ] **Step 9: focused UI tests를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/components/ui/DateInput.test.tsx src/components/ui/Dialog.test.tsx src/features/projects/projects.test.tsx src/features/projects/ProjectEditDialog.test.tsx src/features/admin/admin.test.tsx
```

Expected: DateInput, Dialog, project create/edit, organization admin focused suites PASS; 기존 reversed range와 payload assertions도 PASS.

- [ ] **Step 10: 전체 Web 검증과 production build를 실행한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 --filter @event-roster/web run check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
git diff --check
```

Expected: Web test 전체 PASS, TypeScript checks PASS, Biome format check PASS, Vite production build PASS, whitespace 오류 없음.

- [ ] **Step 11: 브라우저에서 반응형·picker·키보드 동작을 검증한다**

Run the existing local E2E server:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run e2e:prepare
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker run e2e:serve
```

Verify at desktop width:

1. 새 조직 모달에서 입력 아래 `닫기`, `조직 만들기`가 같은 행에 있고 사이가 0.75rem이다.
2. 새 프로젝트 모달에서 프로젝트 이름이 첫 행 전체 너비이고 시작일·종료일이 다음 행에 나란히 있다.
3. 날짜 input의 텍스트 영역을 클릭했을 때 네이티브 달력이 열린다.
4. 프로젝트 수정과 일정 수정 모달도 같은 배치를 사용한다.
5. Tab/Shift+Tab이 모달 내부에서 순환하고 Escape로 닫힌 뒤 열기 버튼으로 focus가 돌아간다.

Verify at viewport width `360px`:

1. 시작일과 종료일이 한 열로 쌓인다.
2. 두 액션 버튼이 겹치거나 모달 밖으로 넘치지 않는다.

Expected: 모든 항목이 설계와 일치하고 browser console error가 없다. 검증 후 로컬 server만 종료한다.

- [ ] **Step 12: Task 3을 commit한다**

```bash
git add \
  apps/web/src/features/projects/ProjectFormDialog.tsx \
  apps/web/src/features/projects/ProjectEditDialog.tsx \
  apps/web/src/features/projects/ProjectEditDialog.test.tsx \
  apps/web/src/features/projects/projects.test.tsx \
  apps/web/src/features/admin/OrganizationsPage.tsx \
  apps/web/src/features/admin/admin.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: improve dialog form layouts"
```

Expected: 세 모달의 layout, tests, CSS만 포함한 commit이 생성된다.

### Task 4: Final Regression Verification

**Files:**
- Verify only: all files changed in Tasks 1–3

**Interfaces:**
- Consumes: Tasks 1–3 commits
- Produces: merge 가능한 전체 UI 변경과 검증 근거

- [ ] **Step 1: 전체 저장소 검증을 새로 실행한다**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
git diff --check
git status --short --branch
```

Expected:

- 모든 workspace test와 typecheck PASS
- Biome format check PASS
- Web production build PASS
- Worker dry-run이 `DB`, `ASSETS`, 정확한 `APP_ORIGIN`을 유지하고 gzip bundle이 Free 제한 이하
- working tree clean

- [ ] **Step 2: 변경 범위와 의도하지 않은 회귀를 확인한다**

Run:

```bash
git diff --stat f779b1b..HEAD
git diff --name-only f779b1b..HEAD
git log --oneline f779b1b..HEAD
```

Expected: 변경 파일은 File Structure에 나열된 Web UI/test/CSS 파일뿐이고, API·Worker·D1 migration·운영 설정·dependencies 변경은 없다. Task 1–3의 세 기능 commit이 순서대로 보인다.

- [ ] **Step 3: 완료 전 review와 branch 마무리 절차로 전환한다**

Use `superpowers:requesting-code-review` for the full `f779b1b..HEAD` diff. Critical/Important finding을 모두 수정하고 재검증한 뒤 `superpowers:finishing-a-development-branch`를 사용한다.

Expected: final reviewer가 spec compliance와 code quality를 승인하고, 사용자가 선택한 integration 방식으로만 main 병합·push·운영 배포를 진행한다.
