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
  buildExportRosterSummary,
  ExportRosterDialog,
} from "./ExportRosterDialog";
import type { RosterView } from "./RosterTable";

afterEach(cleanup);

const rows: RosterView[] = [
  rosterRow({ id: "active-student", role: "STUDENT", status: "ACTIVE" }),
  rosterRow({ id: "cancelled-student", role: "STUDENT", status: "CANCELLED" }),
  rosterRow({ id: "active-teacher", role: "TEACHER", status: "ACTIVE" }),
  rosterRow({ id: "active-legacy", role: null, status: "ACTIVE" }),
];

it("summarizes all rows while counting only active student and teacher profiles", () => {
  expect(buildExportRosterSummary(rows)).toEqual({
    total: 4,
    active: 3,
    cancelled: 1,
    students: 1,
    teachers: 1,
  });
});

it("shows the complete roster scope and summary before export", () => {
  render(
    <ExportRosterDialog
      projectName="여름 수련회"
      rows={rows}
      pending={false}
      error={null}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "엑셀 명단 내보내기" });
  expect(within(dialog).getByText("여름 수련회")).toBeVisible();
  expect(within(dialog).getByText("전체", { selector: "dt" })).toBeVisible();
  expect(within(dialog).getByText("참석", { selector: "dt" })).toBeVisible();
  expect(within(dialog).getByText("취소", { selector: "dt" })).toBeVisible();
  expect(within(dialog).getByText("학생", { selector: "dt" })).toBeVisible();
  expect(within(dialog).getByText("교사", { selector: "dt" })).toBeVisible();
  expect(within(dialog).getByText("4명")).toBeVisible();
  expect(within(dialog).getAllByText("1명")).toHaveLength(3);
  expect(
    within(dialog).getByText(
      "현재 화면 필터와 관계없이 전체 명단을 내보냅니다.",
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText("취소 명단도 상태와 함께 포함됩니다."),
  ).toBeVisible();
});

it("closes on cancel and invokes export only after confirmation", () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ExportRosterDialog
      projectName="여름 수련회"
      rows={rows}
      pending={false}
      error={null}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "엑셀 내보내기" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("keeps the dialog open during a request and exposes an error for retry", () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const { rerender } = render(
    <ExportRosterDialog
      projectName="여름 수련회"
      rows={rows}
      pending
      error={null}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );

  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "내보내는 중…" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();

  rerender(
    <ExportRosterDialog
      projectName="여름 수련회"
      rows={rows}
      pending={false}
      error="엑셀 명단을 내보내지 못했습니다. 다시 시도해 주세요."
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "엑셀 명단을 내보내지 못했습니다. 다시 시도해 주세요.",
  );
  fireEvent.click(screen.getByRole("button", { name: "엑셀 내보내기" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

function rosterRow(
  input: Pick<RosterView, "id" | "role" | "status">,
): RosterView {
  return {
    id: input.id,
    projectId: "project-1",
    participantId: `participant-${input.id}`,
    participantNumber: `P-${input.id}`,
    organizationId: "organization-1",
    participantName: "참가자",
    organizationName: "조직",
    role: input.role,
    grade: input.role === "STUDENT" ? "M1" : null,
    source: "PRE_REGISTRATION",
    status: input.status,
    wasExpectedAtStart: true,
    revision: 0,
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}
