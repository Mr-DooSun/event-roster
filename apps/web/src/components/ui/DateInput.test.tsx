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

it("calls the caller click handler before opening the native picker", () => {
  const calls: string[] = [];
  render(
    <DateInput
      label="시작일"
      value=""
      onChange={() => undefined}
      onClick={() => calls.push("onClick")}
    />,
  );
  const input = screen.getByLabelText("시작일");
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: () => calls.push("showPicker"),
  });

  fireEvent.click(input);

  expect(calls).toEqual(["onClick", "showPicker"]);
});

it("does not focus or open a picker when the caller prevents the click", () => {
  render(
    <>
      <button type="button">다른 요소</button>
      <DateInput
        label="시작일"
        value=""
        onChange={() => undefined}
        onClick={(event) => event.preventDefault()}
      />
    </>,
  );
  const button = screen.getByRole("button", { name: "다른 요소" });
  const input = screen.getByLabelText("시작일");
  const showPicker = vi.fn();
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: showPicker,
  });
  button.focus();

  fireEvent.click(input);

  expect(button).toHaveFocus();
  expect(showPicker).not.toHaveBeenCalled();
});

it("keeps the native input usable when showPicker is unavailable", () => {
  render(<DateInput label="종료일" value="" onChange={() => undefined} />);
  const input = screen.getByLabelText("종료일");
  Object.defineProperty(input, "showPicker", {
    configurable: true,
    value: undefined,
  });

  expect(() => fireEvent.click(input)).not.toThrow();
  expect(input).toHaveFocus();
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
    <DateInput label="시작일" value="" disabled onChange={() => undefined} />,
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
  expect(input).toHaveAccessibleName("시작일");
  expect(input).toHaveAccessibleDescription("선택 사항");
  expect(screen.getByText("시작일").closest("label")).toHaveAttribute(
    "for",
    "project-start-date",
  );
});
