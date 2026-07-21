import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
