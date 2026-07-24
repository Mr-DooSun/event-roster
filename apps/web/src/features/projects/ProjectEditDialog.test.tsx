import type { Project } from "@event-roster/contracts";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

  expect(
    within(dialog).getByLabelText("프로젝트 이름").closest("form"),
  ).toHaveClass("er-dialog-form");
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

it("shows save progress and prevents duplicate submissions", async () => {
  const submission = deferred<void>();
  const onSubmit = vi.fn().mockReturnValue(submission.promise);
  render(
    <ProjectEditDialog
      project={project}
      closed={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);

  await act(async () => submission.resolve());
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
