import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizationSelectCombobox } from "./OrganizationSelectCombobox";

const organizations = [
  { id: "org-1", name: "성룡사", isActive: true },
  { id: "org-2", name: "황룡사", isActive: true },
  { id: "org-inactive", name: "비활성 조직", isActive: false },
];

const renamedOrganizations = [
  { id: "org-1", name: "새 성룡사", isActive: true },
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

it("keeps options out of tab order and closes before focus moves outside", () => {
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
  const next = screen.getByRole("button", { name: "다음" });
  fireEvent.focus(input);
  expect(screen.getAllByRole("option")).toHaveLength(2);
  for (const option of screen.getAllByRole("option")) {
    expect(option).toHaveAttribute("tabindex", "-1");
  }

  fireEvent.keyDown(input, { key: "Tab" });
  fireEvent.blur(input, { relatedTarget: next });
  next.focus();

  expect(document.activeElement).toBe(next);
  expect(input).toHaveAttribute("aria-expanded", "false");
});

it("updates a committed selection when its organization name changes", () => {
  const { rerender } = render(
    <OrganizationSelectCombobox
      label="확정 소속 조직"
      organizations={organizations}
      value="org-1"
      onChange={vi.fn()}
    />,
  );

  rerender(
    <OrganizationSelectCombobox
      label="확정 소속 조직"
      organizations={renamedOrganizations}
      value="org-1"
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("combobox", { name: "확정 소속 조직" })).toHaveValue(
    "새 성룡사",
  );
});

it("preserves a free query when the same selected organization rerenders", () => {
  const { rerender } = render(
    <OrganizationSelectCombobox
      label="확정 소속 조직"
      organizations={organizations}
      value="org-1"
      onChange={vi.fn()}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  fireEvent.change(input, { target: { value: "직접 입력 중" } });

  rerender(
    <OrganizationSelectCombobox
      label="확정 소속 조직"
      organizations={renamedOrganizations}
      value="org-1"
      onChange={vi.fn()}
    />,
  );

  expect(input).toHaveValue("직접 입력 중");
});

it("reports the committed selection separately from keyboard navigation", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value="org-1"
      onChange={vi.fn()}
    />,
  );

  const input = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });

  const selected = screen.getByRole("option", { name: "성룡사" });
  const active = screen.getByRole("option", { name: "황룡사" });
  expect(selected).toHaveAttribute("aria-selected", "true");
  expect(active).toHaveAttribute("aria-selected", "false");
  expect(active).toHaveAttribute("data-active", "true");
});

it("preserves the first free-query character after a controlled parent clears selection", () => {
  const onChange = vi.fn();

  function ControlledCombobox() {
    const [value, setValue] = useState("org-1");

    return (
      <OrganizationSelectCombobox
        label="확정 소속 조직"
        organizations={organizations}
        value={value}
        onChange={(organizationId) => {
          onChange(organizationId);
          setValue(organizationId);
        }}
      />
    );
  }

  render(<ControlledCombobox />);

  const input = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  fireEvent.change(input, { target: { value: "직" } });

  expect(onChange).toHaveBeenLastCalledWith("");
  expect(input).toHaveValue("직");
});
