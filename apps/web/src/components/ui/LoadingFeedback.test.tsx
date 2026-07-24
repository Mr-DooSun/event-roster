import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { LoadingStatus } from "./LoadingStatus";
import { RetryableError } from "./RetryableError";
import { Skeleton } from "./Skeleton";

afterEach(cleanup);

it("hides skeleton shapes and exposes the live loading message", () => {
  const { container } = render(
    <section aria-busy="true">
      <Skeleton className="er-skeleton--text" />
      <LoadingStatus visuallyHidden>프로젝트 불러오는 중…</LoadingStatus>
    </section>,
  );

  expect(container.querySelector(".er-skeleton")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "프로젝트 불러오는 중…",
  );
  expect(screen.getByRole("status")).toHaveClass("er-visually-hidden");
});

it("disables a loading button and replaces its visible label", () => {
  render(
    <Button loading loadingText="저장 중…" variant="primary">
      저장
    </Button>,
  );

  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
});

it("runs retry once and shows its pending label", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <RetryableError message="목록을 불러오지 못했습니다." onRetry={retry} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);

  rerender(
    <RetryableError
      message="목록을 불러오지 못했습니다."
      onRetry={retry}
      retrying
    />,
  );
  expect(screen.getByRole("button", { name: "다시 시도 중…" })).toBeDisabled();
});
