import "@testing-library/jest-dom/vitest";
import type { OrganizationDetail } from "@event-roster/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizationDeletionPanel } from "./OrganizationDeletionPanel";

function organization(
  overrides: Partial<OrganizationDetail> = {},
): OrganizationDetail {
  return {
    id: "org-1",
    name: "황룡사",
    isActive: false,
    isDeleted: false,
    deletedAt: null,
    primaryLeader: null,
    managerCount: 1,
    projectCount: 2,
    managers: [],
    projects: [],
    ...overrides,
  };
}

const controlledProps = {
  dialogOpen: false,
  confirmationName: "",
  deleting: false,
  error: null,
  onOpen: vi.fn(),
  onClose: vi.fn(),
  onConfirmationNameChange: vi.fn(),
  onConfirm: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  ["active", true],
  ["inactive", false],
])(
  "allows recoverable deletion of a non-deleted %s organization",
  (_, isActive) => {
    render(
      <OrganizationDeletionPanel
        organization={organization({ isActive })}
        {...controlledProps}
      />,
    );

    const dangerZone = screen.getByRole("region", { name: "위험 구역" });
    expect(
      within(dangerZone).getByRole("button", { name: "조직 삭제" }),
    ).toBeEnabled();
    expect(
      within(dangerZone).getByText(
        "담당자, 참가자, 프로젝트 기록은 보존됩니다.",
      ),
    ).toBeVisible();
    expect(
      within(dangerZone).getByText("나중에 복구할 수 있습니다."),
    ).toBeVisible();
  },
);

it("does not offer deletion for an already deleted organization", () => {
  const { container } = render(
    <OrganizationDeletionPanel
      organization={organization({
        isDeleted: true,
        deletedAt: "2026-08-03T00:00:00.000Z",
      })}
      {...controlledProps}
    />,
  );

  expect(container).toBeEmptyDOMElement();
});

it("explains selector visibility and automatic deactivation before deleting an active organization", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({ isActive: true })}
      {...controlledProps}
      dialogOpen
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "조직 삭제" });
  expect(
    within(dialog).getByText(
      "삭제하면 일반 조직 목록과 조직 선택기에서 숨겨집니다.",
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText("사용 중인 조직은 자동으로 사용 중지됩니다."),
  ).toBeVisible();
});

it("requires the exact organization name and disables confirmation during another mutation", () => {
  const { rerender } = render(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "조직 삭제" });
  expect(
    within(dialog).getByRole("button", { name: "조직 삭제" }),
  ).toBeDisabled();

  rerender(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
      confirmationName=" 황룡사 "
    />,
  );
  expect(
    within(screen.getByRole("dialog", { name: "조직 삭제" })).getByRole(
      "button",
      { name: "조직 삭제" },
    ),
  ).toBeDisabled();

  rerender(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
      confirmationName="황룡사"
    />,
  );
  expect(
    within(screen.getByRole("dialog", { name: "조직 삭제" })).getByRole(
      "button",
      { name: "조직 삭제" },
    ),
  ).toBeEnabled();

  rerender(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
      confirmationName="황룡사"
      disabled
    />,
  );
  expect(
    within(screen.getByRole("dialog", { name: "조직 삭제" })).getByRole(
      "button",
      { name: "조직 삭제" },
    ),
  ).toBeDisabled();
});

it("locks the dialog and blocks repeated confirms while deletion is pending", () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
      confirmationName="황룡사"
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  const confirm = within(
    screen.getByRole("dialog", { name: "조직 삭제" }),
  ).getByRole("button", { name: "조직 삭제" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledOnce();

  rerender(
    <OrganizationDeletionPanel
      organization={organization()}
      {...controlledProps}
      dialogOpen
      confirmationName="황룡사"
      deleting
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  const pendingDialog = screen.getByRole("dialog", { name: "조직 삭제" });
  expect(
    within(pendingDialog).getByRole("button", { name: "삭제 중…" }),
  ).toBeDisabled();
  expect(
    within(pendingDialog).getByRole("button", { name: "닫기" }),
  ).toBeDisabled();
  fireEvent.keyDown(pendingDialog, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

it("shows the deletion error without losing the recoverable-deletion copy", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({
        name: "매우긴조직이름매우긴조직이름매우긴조직이름",
      })}
      {...controlledProps}
      dialogOpen
      error="조직을 삭제하지 못했습니다."
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "조직을 삭제하지 못했습니다.",
  );
  expect(
    screen.getAllByText("나중에 복구할 수 있습니다.").length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByText("매우긴조직이름매우긴조직이름매우긴조직이름"),
  ).toHaveClass("er-danger-zone__target");
});

it("returns focus to the deletion trigger after closing the dialog", () => {
  render(<DeletionPanelHarness />);
  const trigger = screen.getByRole("button", { name: "조직 삭제" });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "조직 삭제" });
  expect(
    screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."),
  ).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });

  expect(trigger).toHaveFocus();
});

function DeletionPanelHarness() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  return (
    <OrganizationDeletionPanel
      organization={organization()}
      dialogOpen={dialogOpen}
      confirmationName={confirmationName}
      deleting={false}
      error={null}
      onOpen={() => setDialogOpen(true)}
      onClose={() => setDialogOpen(false)}
      onConfirmationNameChange={setConfirmationName}
      onConfirm={vi.fn()}
    />
  );
}
