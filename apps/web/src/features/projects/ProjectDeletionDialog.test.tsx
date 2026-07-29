import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectDeletionDialog } from "./ProjectDeletionDialog";

afterEach(cleanup);

it("requires the exact project name and locks while deleting", async () => {
  const deferredDelete = deferred<void>();
  const onConfirm = vi.fn(() => deferredDelete.promise);
  render(
    <ProjectDeletionDialog
      projectName="1회 수련 법회"
      open
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  const input = screen.getByRole("textbox", {
    name: "삭제할 프로젝트 이름",
  });
  const submit = screen.getByRole("button", { name: "프로젝트 삭제" });
  expect(submit).toBeDisabled();
  fireEvent.change(input, { target: { value: "1회 수련 법회 " } });
  expect(submit).toBeDisabled();
  fireEvent.change(input, { target: { value: "1회 수련 법회" } });
  fireEvent.click(submit);
  expect(onConfirm).toHaveBeenCalledWith("1회 수련 법회");
  expect(screen.getByRole("button", { name: "삭제 중…" })).toBeDisabled();

  await act(async () => deferredDelete.resolve());
});

it("does not close from cancel, Escape, or the backdrop while deleting", async () => {
  const deferredDelete = deferred<void>();
  const onClose = vi.fn();
  render(
    <ProjectDeletionDialog
      projectName="삭제 대상"
      open
      onClose={onClose}
      onConfirm={() => deferredDelete.promise}
    />,
  );

  fireEvent.change(
    screen.getByRole("textbox", { name: "삭제할 프로젝트 이름" }),
    { target: { value: "삭제 대상" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "프로젝트 삭제" }), {
    key: "Escape",
  });
  const dialogParent = screen.getByRole("dialog", {
    name: "프로젝트 삭제",
  }).parentElement;
  expect(dialogParent).not.toBeNull();
  if (!dialogParent) throw new Error("dialog overlay is missing");
  fireEvent.click(dialogParent);
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => deferredDelete.resolve());
});

it("keeps the dialog and exact input after a rejected deletion", async () => {
  render(
    <ProjectDeletionDialog
      projectName="삭제 대상"
      open
      onClose={vi.fn()}
      onConfirm={vi
        .fn()
        .mockRejectedValue(new Error("이름을 다시 확인해 주세요."))}
    />,
  );

  const input = screen.getByRole("textbox", {
    name: "삭제할 프로젝트 이름",
  });
  fireEvent.change(input, { target: { value: "삭제 대상" } });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }));

  expect(await screen.findByText("이름을 다시 확인해 주세요.")).toBeVisible();
  expect(input).toHaveValue("삭제 대상");
  expect(screen.getByRole("dialog", { name: "프로젝트 삭제" })).toBeVisible();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
