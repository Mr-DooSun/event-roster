import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "../../components/ui/Dialog";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders the listbox under document.body above the modal", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );

  fireEvent.focus(screen.getByRole("combobox", { name: "소속 조직" }));

  const listbox = screen.getByRole("listbox");
  expect(listbox.parentElement).toBe(document.body);
  expect(listbox).toHaveAttribute("data-placement", "bottom");
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "aria-controls",
    listbox.id,
  );
  expect(listbox).toHaveStyle({
    position: "fixed",
    top: "4px",
  });
});

it("recalculates placement on captured scroll and viewport resize", () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      top: 700,
      right: 220,
      bottom: 744,
      left: 20,
      width: 200,
      height: 44,
      x: 20,
      y: 700,
      toJSON: () => ({}),
    });
  const { container } = render(
    <div data-testid="scroll-container">
      <OrganizationSelectCombobox
        label="소속 조직"
        organizations={organizations}
        value=""
        onChange={vi.fn()}
      />
    </div>,
  );
  fireEvent.focus(screen.getByRole("combobox"));
  expect(screen.getByRole("listbox")).toHaveAttribute("data-placement", "top");

  rect.mockReturnValue({
    top: 20,
    right: 220,
    bottom: 64,
    left: 20,
    width: 200,
    height: 44,
    x: 20,
    y: 20,
    toJSON: () => ({}),
  });
  fireEvent.scroll(container.firstElementChild as HTMLElement);
  expect(screen.getByRole("listbox")).toHaveAttribute(
    "data-placement",
    "bottom",
  );

  rect.mockReturnValue({
    top: 700,
    right: 220,
    bottom: 744,
    left: 20,
    width: 200,
    height: 44,
    x: 20,
    y: 700,
    toJSON: () => ({}),
  });
  fireEvent(window, new Event("resize"));

  expect(screen.getByRole("listbox")).toHaveAttribute("data-placement", "top");
});

it("coalesces repeated scroll measurements and cancels a pending frame on close", () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const cancelAnimationFrame = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      top: 20,
      right: 220,
      bottom: 64,
      left: 20,
      width: 200,
      height: 44,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    });
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  const initialMeasurements = rect.mock.calls.length;

  fireEvent.scroll(window);
  fireEvent.scroll(window);
  fireEvent.scroll(window);

  expect(callbacks).toHaveLength(1);
  callbacks[0]?.(0);
  expect(rect).toHaveBeenCalledTimes(initialMeasurements + 1);

  fireEvent.scroll(window);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
  const measurementsAfterClose = rect.mock.calls.length;
  fireEvent(window, new Event("resize"));
  expect(rect).toHaveBeenCalledTimes(measurementsAfterClose);
});

it("falls back to a constrained below placement when measurement fails", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => {
      throw new DOMException("measurement failed");
    },
  );
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );

  fireEvent.focus(screen.getByRole("combobox"));

  const listbox = screen.getByRole("listbox");
  expect(listbox).toHaveAttribute("data-placement", "bottom");
  expect(listbox).toHaveStyle({ position: "fixed" });
  expect(Number.parseFloat(listbox.style.maxHeight)).toBeLessThanOrEqual(
    window.innerHeight,
  );
});

it("closes for outside pointers but keeps listbox pointers internal", () => {
  render(
    <>
      <OrganizationSelectCombobox
        label="소속 조직"
        organizations={organizations}
        value=""
        onChange={vi.fn()}
      />
      <button type="button">외부 버튼</button>
    </>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);

  fireEvent.pointerDown(screen.getByRole("option", { name: "성룡사" }));
  expect(input).toHaveAttribute("aria-expanded", "true");

  fireEvent.pointerDown(screen.getByRole("button", { name: "외부 버튼" }));
  expect(input).toHaveAttribute("aria-expanded", "false");
});

it("closes when an update finds the anchor disconnected", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  vi.spyOn(input, "isConnected", "get").mockReturnValue(false);

  fireEvent(window, new Event("resize"));

  expect(input).toHaveAttribute("aria-expanded", "false");
});

it("orders filtered options by recent organization IDs", () => {
  render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      recentOrganizationIds={["org-2"]}
      onChange={vi.fn()}
    />,
  );

  fireEvent.focus(screen.getByRole("combobox"));

  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["황룡사", "성룡사"]);
});

it("clears stale keyboard activation when candidates shrink", () => {
  const { rerender } = render(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations}
      value=""
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });

  rerender(
    <OrganizationSelectCombobox
      label="소속 조직"
      organizations={organizations.slice(0, 1)}
      value=""
      onChange={vi.fn()}
    />,
  );

  expect(input).not.toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(input, { key: "Enter" });
});

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

it("uses the first Escape for the listbox and the second for its dialog", () => {
  function DialogWithCombobox() {
    const [dialogOpen, setDialogOpen] = useState(true);
    return dialogOpen ? (
      <Dialog title="참가자 추가" onClose={() => setDialogOpen(false)}>
        <OrganizationSelectCombobox
          label="소속 조직"
          organizations={organizations}
          value=""
          onChange={vi.fn()}
        />
      </Dialog>
    ) : null;
  }

  render(<DialogWithCombobox />);
  const input = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.focus(input);

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
