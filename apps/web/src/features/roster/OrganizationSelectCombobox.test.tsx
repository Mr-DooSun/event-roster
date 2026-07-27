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
