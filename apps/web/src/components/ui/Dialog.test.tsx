import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

it("uses the existing close label by default", () => {
  const onClose = vi.fn();
  render(
    <Dialog title="확인" onClose={onClose}>
      <p>내용</p>
    </Dialog>,
  );

  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  expect(onClose).toHaveBeenCalledOnce();
});

it("uses a caller-provided acknowledgement label", () => {
  const onClose = vi.fn();
  render(
    <Dialog
      title="초기 계정 인계"
      closeLabel="기록했고 로그아웃"
      onClose={onClose}
    >
      <p>일회성 값</p>
    </Dialog>,
  );

  fireEvent.click(screen.getByRole("button", { name: "기록했고 로그아웃" }));

  expect(onClose).toHaveBeenCalledOnce();
});

it("moves focus inside and traps Tab in both directions", () => {
  render(<DialogHarness />);
  const trigger = screen.getByRole("button", { name: "대화상자 열기" });
  trigger.focus();
  fireEvent.click(trigger);

  const firstAction = screen.getByRole("button", { name: "첫 작업" });
  const close = screen.getByRole("button", { name: "닫기" });
  const dialog = screen.getByRole("dialog", { name: "확인" });
  expect(firstAction).toHaveFocus();

  close.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(firstAction).toHaveFocus();

  firstAction.focus();
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  expect(close).toHaveFocus();
});

it("closes with Escape and restores the opening trigger", () => {
  render(<DialogHarness />);
  const trigger = screen.getByRole("button", { name: "대화상자 열기" });
  trigger.focus();
  fireEvent.click(trigger);

  fireEvent.keyDown(screen.getByRole("dialog", { name: "확인" }), {
    key: "Escape",
  });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("restores fallback focus when the opening trigger is removed", () => {
  render(<DialogHarness removeTriggerOnOpen />);
  const trigger = screen.getByRole("button", { name: "대화상자 열기" });
  trigger.focus();
  fireEvent.click(trigger);

  fireEvent.keyDown(screen.getByRole("dialog", { name: "확인" }), {
    key: "Escape",
  });

  expect(screen.getByRole("button", { name: "대체 포커스" })).toHaveFocus();
});

function DialogHarness({
  removeTriggerOnOpen = false,
}: {
  removeTriggerOnOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [triggerRemoved, setTriggerRemoved] = useState(false);
  return (
    <>
      {!triggerRemoved ? (
        <button
          type="button"
          onClick={() => {
            if (removeTriggerOnOpen) setTriggerRemoved(true);
            setOpen(true);
          }}
        >
          대화상자 열기
        </button>
      ) : null}
      <button type="button">대체 포커스</button>
      {open ? (
        <Dialog title="확인" onClose={() => setOpen(false)}>
          <button type="button">첫 작업</button>
        </Dialog>
      ) : null}
    </>
  );
}
