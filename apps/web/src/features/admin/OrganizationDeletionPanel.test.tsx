import "@testing-library/jest-dom/vitest";
import type {
  OrganizationDeletionBlockers,
  OrganizationDetail,
} from "@event-roster/contracts";
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

const emptyBlockers: OrganizationDeletionBlockers = {
  managerAssignments: 0,
  participants: 0,
  projectLinks: 0,
  rosterEntries: 0,
  expectedSnapshots: 0,
};

function organization(
  overrides: Partial<OrganizationDetail> = {},
): OrganizationDetail {
  return {
    id: "org-1",
    name: "황룡사",
    isActive: false,
    primaryLeader: null,
    managerCount: 0,
    projectCount: 0,
    managers: [],
    projects: [],
    deletionEligibility: {
      canDelete: true,
      blockers: emptyBlockers,
    },
    ...overrides,
  };
}

const onClose = vi.fn();
const onConfirmationNameChange = vi.fn();
const controlledProps = {
  dialogOpen: false,
  confirmationName: "",
  deleting: false,
  error: null,
  onOpen: vi.fn(),
  onClose,
  onConfirmationNameChange,
  onConfirm: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("hides the danger zone for an active organization", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({ isActive: true })}
      {...controlledProps}
    />,
  );

  expect(
    screen.queryByRole("region", { name: "위험 구역" }),
  ).not.toBeInTheDocument();
});

it("shows only positive blockers and disables permanent deletion", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({
        isActive: false,
        deletionEligibility: {
          canDelete: false,
          blockers: {
            managerAssignments: 0,
            participants: 3,
            projectLinks: 2,
            rosterEntries: 0,
            expectedSnapshots: 1,
          },
        },
      })}
      {...controlledProps}
    />,
  );

  expect(screen.getByText("참가자 3명")).toBeVisible();
  expect(screen.getByText("프로젝트 연결 이력 2건")).toBeVisible();
  expect(screen.getByText("예상 인원 기록 1건")).toBeVisible();
  expect(screen.queryByText("담당자 배정 0건")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "조직 영구 삭제" }),
  ).toBeDisabled();
});

it("requires the exact current name and locks the dialog while deleting", () => {
  const onConfirm = vi.fn();
  const eligibleOrganization = organization();
  const { rerender } = render(
    <OrganizationDeletionPanel
      organization={eligibleOrganization}
      dialogOpen
      confirmationName=""
      deleting={false}
      error={null}
      onOpen={vi.fn()}
      onClose={onClose}
      onConfirmationNameChange={onConfirmationNameChange}
      onConfirm={onConfirm}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "조직 영구 삭제" });
  expect(
    within(dialog).getByRole("button", { name: "조직 영구 삭제" }),
  ).toBeDisabled();

  fireEvent.change(
    screen.getByLabelText("확인을 위해 조직 이름을 입력하세요."),
    { target: { value: " 황룡사 " } },
  );
  expect(onConfirmationNameChange).toHaveBeenCalledWith(" 황룡사 ");

  rerender(
    <OrganizationDeletionPanel
      organization={eligibleOrganization}
      dialogOpen
      confirmationName="황룡사"
      deleting
      error={null}
      onOpen={vi.fn()}
      onClose={onClose}
      onConfirmationNameChange={onConfirmationNameChange}
      onConfirm={onConfirm}
    />,
  );
  const pendingDialog = screen.getByRole("dialog", {
    name: "조직 영구 삭제",
  });
  expect(
    within(pendingDialog).getByRole("button", { name: "삭제 중…" }),
  ).toBeDisabled();
  expect(
    within(pendingDialog).getByRole("button", { name: "닫기" }),
  ).toBeDisabled();
  fireEvent.keyDown(pendingDialog, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

it("shows the deletion error and wraps a long target name", () => {
  render(
    <OrganizationDeletionPanel
      organization={organization({ name: "매우긴조직이름매우긴조직이름매우긴조직이름" })}
      dialogOpen
      confirmationName=""
      deleting={false}
      error="조직을 삭제하지 못했습니다."
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onConfirmationNameChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "조직을 삭제하지 못했습니다.",
  );
  expect(
    screen.getByText("매우긴조직이름매우긴조직이름매우긴조직이름"),
  ).toHaveClass("er-danger-zone__target");
});

it("blocks repeated exact-name confirms before the parent rerenders", () => {
  const onConfirm = vi.fn();
  render(
    <OrganizationDeletionPanel
      organization={organization()}
      dialogOpen
      confirmationName="황룡사"
      deleting={false}
      error={null}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onConfirmationNameChange={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  const confirm = within(
    screen.getByRole("dialog", { name: "조직 영구 삭제" }),
  ).getByRole("button", { name: "조직 영구 삭제" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(onConfirm).toHaveBeenCalledOnce();
});

it("allows another confirmation after a deleting cycle or a new dialog attempt", () => {
  const onConfirm = vi.fn();
  const props = {
    organization: organization(),
    confirmationName: "황룡사",
    error: null,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onConfirmationNameChange: vi.fn(),
    onConfirm,
  };
  const { rerender } = render(
    <OrganizationDeletionPanel dialogOpen deleting={false} {...props} />,
  );

  fireEvent.click(
    within(screen.getByRole("dialog", { name: "조직 영구 삭제" })).getByRole(
      "button",
      { name: "조직 영구 삭제" },
    ),
  );
  expect(onConfirm).toHaveBeenCalledTimes(1);

  rerender(<OrganizationDeletionPanel dialogOpen deleting {...props} />);
  rerender(<OrganizationDeletionPanel dialogOpen deleting={false} {...props} />);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "조직 영구 삭제" })).getByRole(
      "button",
      { name: "조직 영구 삭제" },
    ),
  );
  expect(onConfirm).toHaveBeenCalledTimes(2);

  rerender(<OrganizationDeletionPanel dialogOpen={false} deleting={false} {...props} />);
  rerender(<OrganizationDeletionPanel dialogOpen deleting={false} {...props} />);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "조직 영구 삭제" })).getByRole(
      "button",
      { name: "조직 영구 삭제" },
    ),
  );
  expect(onConfirm).toHaveBeenCalledTimes(3);
});

it("returns focus to the deletion trigger after closing the dialog", () => {
  render(<DeletionPanelHarness />);
  const trigger = screen.getByRole("button", { name: "조직 영구 삭제" });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "조직 영구 삭제" });
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
