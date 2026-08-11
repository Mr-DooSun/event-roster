import "@testing-library/jest-dom/vitest";
import type { OrganizationSummary } from "@event-roster/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectOrganizationBulkPicker } from "./ProjectOrganizationBulkPicker";

function organization(
  overrides: Partial<OrganizationSummary> = {},
): OrganizationSummary {
  return {
    id: "org-1",
    name: "관문사",
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    primaryLeader: { userId: "leader-1", displayName: "김대표" },
    managerCount: 1,
    projectCount: 3,
    ...overrides,
  };
}

const organizations = [
  organization(),
  organization({
    id: "org-2",
    name: "금룡사",
    primaryLeader: null,
    projectCount: 1,
  }),
  organization({ id: "org-3", name: "비활성 사찰", isActive: false }),
  organization({ id: "org-4", name: "삭제 사찰", isDeleted: true }),
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("활성인 조직의 정보와 연결 상태를 표시하고 선택을 전달한다", () => {
  const onSelectionChange = vi.fn();
  render(
    <ProjectOrganizationBulkPicker
      organizations={organizations}
      linkedOrganizationIds={new Set(["org-2"])}
      selectedOrganizationIds={new Set()}
      disabled={false}
      onSelectionChange={onSelectionChange}
    />,
  );

  expect(screen.getByRole("checkbox", { name: "관문사" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "금룡사" })).toBeDisabled();
  expect(screen.getByText("대표 미지정")).toBeVisible();
  expect(screen.getByText("연결 프로젝트 3개")).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "비활성 사찰" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "삭제 사찰" }),
  ).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "조직 이름 검색" }), {
    target: { value: " 관문사 " },
  });
  expect(screen.getByRole("checkbox", { name: "관문사" })).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "금룡사" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("checkbox", { name: "관문사" }));
  expect(onSelectionChange).toHaveBeenCalledWith(["org-1"]);
});

it("busy 상태에서는 검색과 선택을 비활성화한다", () => {
  render(
    <ProjectOrganizationBulkPicker
      organizations={organizations}
      linkedOrganizationIds={new Set(["org-2"])}
      selectedOrganizationIds={new Set()}
      disabled
      onSelectionChange={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("textbox", { name: "조직 이름 검색" }),
  ).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "관문사" })).toBeDisabled();
});
