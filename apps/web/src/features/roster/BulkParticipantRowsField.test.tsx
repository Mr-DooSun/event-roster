import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  type BulkParticipantDraft,
  BulkParticipantRowsField,
  isValidBulkParticipantDraft,
} from "./BulkParticipantRowsField";

afterEach(cleanup);

function student(
  clientId: string,
  name = "",
  grade: BulkParticipantDraft["grade"] = null,
): BulkParticipantDraft {
  return { clientId, name, role: "STUDENT", grade };
}

it("starts empty and adds a student row with no selected grade", () => {
  const onRowsChange = vi.fn();
  const { rerender } = render(
    <BulkParticipantRowsField
      rows={[]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={onRowsChange}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(
    screen.queryByRole("textbox", { name: /이름/ }),
  ).not.toBeInTheDocument();
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

  const addedRow = (
    onRowsChange.mock.calls[0]?.[0] as BulkParticipantDraft[] | undefined
  )?.[0];
  if (!addedRow) throw new Error("participant row was not emitted");
  rerender(
    <BulkParticipantRowsField
      rows={[addedRow]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={onRowsChange}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("textbox", { name: "1번 이름" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "1번 참가자 구분" })).toHaveValue(
    "STUDENT",
  );
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toHaveValue("");
});

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
  const lastGroup = groups.at(-1);
  if (!lastGroup) throw new Error("participant group was not rendered");
  expect(
    lastGroup.compareDocumentPosition(addButton) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("requires a grade for students and accepts teachers without one", () => {
  expect(isValidBulkParticipantDraft(student("student", "학생"))).toBe(false);
  expect(isValidBulkParticipantDraft(student("student", "학생", "M2"))).toBe(
    true,
  );
  expect(
    isValidBulkParticipantDraft({
      clientId: "teacher",
      name: "교사",
      role: "TEACHER",
      grade: null,
    }),
  ).toBe(true);
});

it("exposes student grade requirements and name errors to assistive technology", () => {
  render(
    <BulkParticipantRowsField
      rows={[student("student", "가".repeat(101))]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("textbox", { name: "1번 이름" }),
  ).toHaveAccessibleDescription("이름은 100자 이하여야 합니다.");
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toBeRequired();
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

it("describes every missing student field and omits grade errors for teachers", () => {
  render(
    <BulkParticipantRowsField
      rows={[
        student("student"),
        {
          clientId: "teacher",
          name: "담당교사",
          role: "TEACHER",
          grade: null,
        },
      ]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("textbox", { name: "1번 이름" })).toBeRequired();
  expect(
    screen.getByRole("textbox", { name: "1번 이름" }),
  ).toHaveAccessibleDescription("이름을 입력해 주세요.");
  expect(
    screen.getByRole("combobox", { name: "1번 학년" }),
  ).toHaveAccessibleDescription("학생은 학년을 선택해 주세요.");

  const teacherGrade = screen.getByRole("combobox", { name: "2번 학년" });
  expect(teacherGrade).toBeDisabled();
  expect(teacherGrade).not.toHaveAttribute("aria-describedby");
  expect(teacherGrade).toHaveAttribute("aria-invalid", "false");
});

it("clears and disables grade when a row changes to teacher", () => {
  const onRowsChange = vi.fn();
  const props = {
    duplicates: [],
    duplicateNamesConfirmed: false,
    onRowsChange,
    onDuplicateNamesConfirmedChange: vi.fn(),
  };
  const { rerender } = render(
    <BulkParticipantRowsField
      rows={[student("row-1", "학생", "M3")]}
      {...props}
    />,
  );

  fireEvent.change(screen.getByRole("combobox", { name: "1번 참가자 구분" }), {
    target: { value: "TEACHER" },
  });

  expect(onRowsChange).toHaveBeenCalledWith([
    { clientId: "row-1", name: "학생", role: "TEACHER", grade: null },
  ]);
  rerender(
    <BulkParticipantRowsField
      rows={[
        {
          clientId: "row-1",
          name: "학생",
          role: "TEACHER",
          grade: null,
        },
      ]}
      {...props}
    />,
  );
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toBeDisabled();
});

it("deletes only the row identified by its client id", () => {
  const onRowsChange = vi.fn();
  render(
    <BulkParticipantRowsField
      rows={[
        student("row-1", "첫 번째", "M1"),
        student("row-2", "두 번째", "H1"),
      ]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={onRowsChange}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "1번 참가자 삭제" }));

  expect(onRowsChange).toHaveBeenCalledWith([
    { clientId: "row-2", name: "두 번째", role: "STUDENT", grade: "H1" },
  ]);
});

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

  fireEvent.click(screen.getByRole("button", { name: "1번 참가자 삭제" }));

  expect(onRowsChange).toHaveBeenCalledWith([]);
  expect(onConfirmedChange).toHaveBeenCalledWith(false);
});

it("disables adding at 30 rows while keeping the full count announcement", () => {
  render(
    <BulkParticipantRowsField
      rows={Array.from({ length: 30 }, (_, index) =>
        student(`row-${index + 1}`, `참가자 ${index + 1}`, "M1"),
      )}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRowsChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "참가자 추가" })).toBeDisabled();
  expect(screen.getByText("등록 예정 30명 / 최대 30명")).toBeVisible();
  expect(screen.getAllByRole("group", { name: /번 참가자/ })).toHaveLength(30);
});

it("shows duplicate warnings on every normalized matching row", () => {
  render(
    <BulkParticipantRowsField
      rows={[
        student("row-1", "  홍길동  ", "M1"),
        student("row-2", "홍길동", "M2"),
      ]}
      duplicates={[
        {
          name: "홍길동",
          kinds: ["INPUT_DUPLICATE", "EXISTING_PARTICIPANT"],
        },
      ]}
      duplicateNamesConfirmed={false}
      onRowsChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  for (const group of screen.getAllByRole("group", { name: /번 참가자/ })) {
    expect(
      within(group).getByText("입력 목록에 같은 이름이 있습니다."),
    ).toBeVisible();
    expect(
      within(group).getByText("이 조직에 같은 이름의 참가자가 있습니다."),
    ).toBeVisible();
  }
  expect(screen.getByRole("alert")).toHaveTextContent(
    "중복 이름이 있습니다. 내용을 확인한 후 다시 제출하세요.",
  );
  expect(
    screen.getByRole("checkbox", { name: "중복 이름을 확인했습니다" }),
  ).toBeVisible();
});

it("keeps duplicate confirmation for profile edits but resets it for name edits", () => {
  const onRowsChange = vi.fn();
  const onConfirmedChange = vi.fn();
  render(
    <BulkParticipantRowsField
      rows={[student("row-1", "홍길동", "M1")]}
      duplicates={[{ name: "홍길동", kinds: ["EXISTING_PARTICIPANT"] }]}
      duplicateNamesConfirmed
      onRowsChange={onRowsChange}
      onDuplicateNamesConfirmedChange={onConfirmedChange}
    />,
  );

  fireEvent.change(screen.getByRole("combobox", { name: "1번 학년" }), {
    target: { value: "M2" },
  });
  expect(onConfirmedChange).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole("textbox", { name: "1번 이름" }), {
    target: { value: "김민수" },
  });
  expect(onConfirmedChange).toHaveBeenCalledWith(false);
});
