import "@testing-library/jest-dom/vitest";
import type {
  OrganizationSummary,
  Project,
  ProjectOrganization,
} from "@event-roster/contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectOrganizationsPanel } from "./ProjectOrganizationsPanel";

const { mockApi, mockRole, mockBootstrap } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  mockRole: {
    current: "OPERATOR" as "OPERATOR" | "ORGANIZATION_MANAGER",
  },
  mockBootstrap: { current: false },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: {
      session: {
        user: {
          role: mockRole.current,
          isBootstrap: mockBootstrap.current,
        },
      },
    },
  }),
}));

const project = {
  id: "project-1",
  name: "리더십 캠프",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  status: "PRE_REGISTRATION" as const,
  revision: 1,
  createdAt: "2026-02-10T00:00:00.000Z",
  createdBy: "operator-1",
  updatedAt: "2026-02-10T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
  closeReason: null,
  isDeleted: false,
  deletedAt: null,
};

beforeEach(() => {
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockApi.patch.mockReset();
  mockApi.delete.mockReset();
  mockApi.post.mockResolvedValue({
    organization: organizationMembership(),
    projectRevision: 8,
  });
  mockApi.patch.mockResolvedValue({
    organization: organizationMembership(),
    projectRevision: 8,
  });
  mockApi.get.mockImplementation(defaultGet);
  mockRole.current = "OPERATOR";
  mockBootstrap.current = false;
});

afterEach(cleanup);

it("shows project deletion only to operators on a non-deleted closed project", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    return defaultGet(path);
  });
  const operatorView = render(<ProjectDetailPage projectId="project-1" />);
  expect(
    await screen.findByRole("button", { name: "프로젝트 삭제" }),
  ).toBeVisible();
  operatorView.unmount();

  mockRole.current = "ORGANIZATION_MANAGER";
  render(<ProjectDetailPage projectId="project-1" />);
  await screen.findByRole("heading", { name: project.name });
  expect(
    screen.queryByRole("button", { name: "프로젝트 삭제" }),
  ).not.toBeInTheDocument();
});

it("deletes a project with its exact name and navigates to the list", async () => {
  window.history.replaceState(null, "", "/projects/project-1");
  const closed = closedProject();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closed;
    return defaultGet(path);
  });
  mockApi.delete.mockResolvedValueOnce({
    ...closed,
    revision: closed.revision + 1,
    isDeleted: true,
    deletedAt: "2026-07-29T01:00:00.000Z",
  });
  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("button", { name: "프로젝트 삭제" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "삭제할 프로젝트 이름" }),
    { target: { value: closed.name } },
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "프로젝트 삭제" })).getByRole(
      "button",
      { name: "프로젝트 삭제" },
    ),
  );

  await waitFor(() =>
    expect(mockApi.delete).toHaveBeenCalledWith("/projects/project-1", {
      confirmationName: closed.name,
      expectedRevision: closed.revision,
    }),
  );
  await waitFor(() => expect(window.location.pathname).toBe("/projects"));
});

it("reloads a stale project deletion and closes its dialog", async () => {
  const closed = closedProject();
  let projectReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1
        ? closed
        : { ...closed, revision: closed.revision + 1 };
    }
    return defaultGet(path);
  });
  mockApi.delete.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "delete-stale",
    }),
  );
  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("button", { name: "프로젝트 삭제" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "삭제할 프로젝트 이름" }),
    { target: { value: closed.name } },
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "프로젝트 삭제" })).getByRole(
      "button",
      { name: "프로젝트 삭제" },
    ),
  );

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "프로젝트 삭제" }),
  ).not.toBeInTheDocument();
  expect(projectReads).toBe(2);
});

it("keeps deletion open when the server rejects the exact project name", async () => {
  const closed = closedProject();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closed;
    return defaultGet(path);
  });
  mockApi.delete.mockRejectedValueOnce(
    new ApiError(409, {
      code: "CONFIRMATION_MISMATCH",
      message: "mismatch",
      requestId: "delete-mismatch",
    }),
  );
  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("button", { name: "프로젝트 삭제" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "삭제할 프로젝트 이름" }),
    { target: { value: closed.name } },
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "프로젝트 삭제" })).getByRole(
      "button",
      { name: "프로젝트 삭제" },
    ),
  );

  expect(
    await screen.findByText(
      "프로젝트 이름이 일치하지 않습니다. 정확한 이름을 다시 입력해 주세요.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("dialog", { name: "프로젝트 삭제" })).toBeVisible();
});

it("renders a deleted project read-only and restores it without child reads", async () => {
  window.history.replaceState(
    null,
    "",
    "/projects/project-1?includeDeleted=true",
  );
  const deleted = deletedProject();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1?includeDeleted=true") return deleted;
    throw new Error(`unexpected deleted-detail request: ${path}`);
  });
  mockApi.post.mockResolvedValueOnce({
    ...deleted,
    revision: deleted.revision + 1,
    isDeleted: false,
    deletedAt: null,
  });
  render(<ProjectDetailPage projectId="project-1" includeDeleted />);

  expect(
    await screen.findByRole("heading", { name: deleted.name }),
  ).toBeVisible();
  expect(screen.getByText("삭제됨", { exact: true })).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /수정|진행|재개|종료/ }),
  ).not.toBeInTheDocument();
  expect(mockApi.get).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "프로젝트 복구" }));
  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith("/projects/project-1/restore", {
      expectedRevision: deleted.revision,
    }),
  );
  await waitFor(() =>
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/projects/project-1",
    ),
  );
});

it("does not let organization managers request deleted project detail", async () => {
  mockRole.current = "ORGANIZATION_MANAGER";
  render(<ProjectDetailPage projectId="project-1" includeDeleted />);

  expect(
    await screen.findByText("삭제된 프로젝트를 볼 권한이 없습니다."),
  ).toBeVisible();
  expect(mockApi.get).not.toHaveBeenCalled();
});

it("loads ordinary detail resources when an include-deleted link was already restored", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1?includeDeleted=true") {
      return closedProject();
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" includeDeleted />);

  expect(
    await screen.findByRole("heading", { name: project.name }),
  ).toBeVisible();
  await waitFor(() =>
    expect(mockApi.get).toHaveBeenCalledWith("/projects/project-1/summary"),
  );
  expect(mockApi.get).toHaveBeenCalledWith("/projects/project-1/organizations");
  expect(mockApi.get).toHaveBeenCalledWith("/projects/project-1/roster");
  expect(mockApi.get).toHaveBeenCalledWith(
    "/projects/project-1/audit?limit=50",
  );
});

it("does not expose project deletion or deleted detail to bootstrap operators", async () => {
  mockBootstrap.current = true;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    return defaultGet(path);
  });
  const detail = render(<ProjectDetailPage projectId="project-1" />);
  await screen.findByRole("heading", { name: project.name });
  expect(
    screen.queryByRole("button", { name: "프로젝트 삭제" }),
  ).not.toBeInTheDocument();
  detail.unmount();

  render(<ProjectDetailPage projectId="project-1" includeDeleted />);
  expect(
    await screen.findByText("삭제된 프로젝트를 볼 권한이 없습니다."),
  ).toBeVisible();
  expect(mockApi.get).not.toHaveBeenCalledWith(
    "/projects/project-1?includeDeleted=true",
  );
});

it("shows four semantic tabs with only the selected panel mounted", async () => {
  render(<ProjectDetailPage projectId="project-1" />);

  const overviewTab = await screen.findByRole("tab", { name: "개요" });
  expect(overviewTab).toHaveAttribute("aria-selected", "true");
  expect(overviewTab).not.toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("tab", { name: "조직" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "참가 명단" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "변경 이력" })).toBeVisible();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);

  fireEvent.click(screen.getByRole("tab", { name: "변경 이력" }));
  expect(screen.getByRole("tab", { name: "변경 이력" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "변경 이력" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "프로젝트 개요" }),
  ).not.toBeInTheDocument();
});

it("shows project status, dates, and automatic closing in the header", async () => {
  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: "리더십 캠프" }),
  ).toBeVisible();
  expect(await screen.findByText("사전 등록")).toBeVisible();
  expect(screen.getByRole("button", { name: "진행 시작" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "사전 등록 시작" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("2026.05.22 ~ 2026.05.23")).toBeVisible();
  expect(screen.getByText("자동 종료")).toBeVisible();
});

it("marks inactive historical organizations in the overview summary", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") {
      return {
        projectId: "project-1",
        expectedTotal: 2,
        finalTotal: 1,
        deltaTotal: -1,
        studentTotal: 3,
        teacherTotal: 2,
        organizations: [
          {
            organizationId: "org-history",
            organizationName: "과거 조직",
            isActive: false,
            masterIsActive: true,
            masterIsDeleted: false,
            expected: 2,
            inProgressAdded: 0,
            inProgressCancelled: 1,
            final: 1,
            delta: -1,
            studentCount: 3,
            teacherCount: 2,
          },
        ],
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  const row = (await screen.findByText("과거 조직")).closest("tr");
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).getByText("비활성")).toHaveClass(
    "er-badge--inactive",
  );
  expect(screen.getByText("학생 3명")).toBeVisible();
  expect(screen.getByText("담당교사 2명")).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "학생" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "담당교사" })).toBeVisible();
});

it("marks deleted historical organizations before inactive state", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") {
      return {
        projectId: "project-1",
        expectedTotal: 2,
        finalTotal: 1,
        deltaTotal: -1,
        studentTotal: 1,
        teacherTotal: 0,
        organizations: [
          {
            organizationId: "org-deleted-history",
            organizationName: "삭제 이력 조직",
            isActive: false,
            masterIsActive: false,
            masterIsDeleted: true,
            expected: 2,
            inProgressAdded: 0,
            inProgressCancelled: 1,
            final: 1,
            delta: -1,
            studentCount: 1,
            teacherCount: 0,
          },
        ],
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  const row = (await screen.findByText("삭제 이력 조직")).closest("tr");
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).getByText("삭제됨")).toHaveClass(
    "er-badge--deleted",
  );
  expect(
    within(row as HTMLElement).queryByText("비활성"),
  ).not.toBeInTheDocument();
});

it("shows a project header skeleton while the project shell is loading", async () => {
  const projectRequest = deferred<Project>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return projectRequest.promise;
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(screen.getByRole("status")).toHaveTextContent("프로젝트 불러오는 중…");
  expect(screen.queryByRole("heading", { name: project.name })).toBeNull();

  await act(async () => projectRequest.resolve(project));
  expect(
    await screen.findByRole("heading", { name: project.name }),
  ).toBeVisible();
});

it("shows the project shell before a slower overview resource completes", async () => {
  const summary = deferred<ReturnType<typeof emptySummary>>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") return summary.promise;
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: project.name }),
  ).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent(
    "프로젝트 개요 불러오는 중…",
  );

  await act(async () => summary.resolve(emptySummary("project-1")));
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
});

it("keeps a new project's resource loading after an old request settles", async () => {
  const oldSummary = deferred<ReturnType<typeof emptySummary>>();
  const newSummary = deferred<ReturnType<typeof emptySummary>>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return project;
    if (path === "/projects/project-1/summary") return oldSummary.promise;
    if (path === "/projects/project-2/summary") return newSummary.promise;
    return multiProjectGet(path);
  });

  const view = render(<ProjectDetailPage projectId="project-1" />);
  expect(
    await screen.findByRole("heading", { name: project.name }),
  ).toBeVisible();
  view.rerender(<ProjectDetailPage projectId="project-2" />);
  expect(
    await screen.findByRole("heading", { name: "신규 프로젝트" }),
  ).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");

  await act(async () => oldSummary.resolve(emptySummary("project-1")));
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  expect(screen.queryByText("예상 0명")).not.toBeInTheDocument();

  await act(async () => newSummary.resolve(emptySummary("project-2")));
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
});

it("adds selected organizations in bulk and clears the selection after refresh", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockApi.post.mockResolvedValueOnce({
    organizationIds: ["org-1", "org-2"],
    projectRevision: 8,
  });
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "1팀" }),
        organizationSummary({ id: "org-2", name: "2팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("checkbox", { name: "1팀" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "2팀" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 2개 조직 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations/bulk",
      { organizationIds: ["org-1", "org-2"], expectedProjectRevision: 7 },
    ),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(
    screen.getByRole("button", { name: "선택한 0개 조직 추가" }),
  ).toBeDisabled();
});

it("shows progress while adding an existing organization", async () => {
  const pendingMutation = deferred<{
    organization: ProjectOrganization;
    projectRevision: number;
  }>();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockApi.post.mockReturnValue(pendingMutation.promise);
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[organizationMembership()]}
      allOrganizations={[organizationSummary({ id: "org-2", name: "2팀" })]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={onChanged}
    />,
  );
  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "2팀" } });
  fireEvent.click(screen.getByRole("option", { name: "2팀" }));

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  const pendingButton = screen.getByRole("button", {
    name: "프로젝트에 추가 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Ｅ２Ｅ 1팀")).toBeVisible();

  await act(async () =>
    pendingMutation.resolve({
      organization: organizationMembership({
        organizationId: "org-2",
        name: "2팀",
      }),
      projectRevision: 8,
    }),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it("chains mutation response revisions even when refresh fails without a rerender", async () => {
  const onChanged = vi.fn().mockRejectedValue(new Error("refresh failed"));
  mockApi.post
    .mockResolvedValueOnce({
      organization: organizationMembership(),
      projectRevision: 8,
    })
    .mockResolvedValueOnce({
      organization: organizationMembership({
        organizationId: "org-2",
        name: "2팀",
      }),
      projectRevision: 9,
    });
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "1팀" }),
        organizationSummary({ id: "org-2", name: "2팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={onChanged}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "1팀" } });
  fireEvent.click(screen.getByRole("option", { name: "1팀" }));
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

  fireEvent.change(input, { target: { value: "2팀" } });
  fireEvent.click(screen.getByRole("option", { name: "2팀" }));
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenLastCalledWith(
      "/projects/project-1/history-corrections/organizations",
      { organizationId: "org-2", expectedProjectRevision: 8 },
    ),
  );
  expect(mockApi.post).toHaveBeenCalledTimes(2);
});

it("renders one unified add flow with existing results before create", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "E2E 1팀" }),
        organizationSummary({ id: "org-2", name: "E2E 운영팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("heading", { name: "조직 추가" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "기존 조직 연결" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "새 조직 연결" }),
  ).not.toBeInTheDocument();

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "E2E" } });
  const options = screen.getAllByRole("option");
  expect(options[0]).toHaveAccessibleName("E2E 1팀");
  expect(options[1]).toHaveAccessibleName("E2E 운영팀");
  expect(options[2]).toHaveAccessibleName("“E2E” 새 조직 생성 후 추가");
});

it("suppresses exact-name creation and keeps linked organizations disabled", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[organizationMembership()]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "Ｅ２Ｅ 1팀" }),
        organizationSummary({ id: "org-2", name: "다른 팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "e2e 1팀" } });
  expect(
    screen.getByRole("option", { name: /Ｅ２Ｅ 1팀.*이미 추가됨/ }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("option", { name: /새 조직 생성 후 추가/ }),
  ).not.toBeInTheDocument();
});

it("selects the active combobox option with the keyboard", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "기획팀" }),
        organizationSummary({ id: "org-2", name: "개발팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const secondOption = screen.getByRole("option", { name: "개발팀" });
  expect(input).toHaveAttribute("aria-activedescendant", secondOption.id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("개발팀");
  expect(screen.getByRole("button", { name: "프로젝트에 추가" })).toBeEnabled();
});

it("starts ArrowUp at the final enabled option and scrolls it into view", async () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "기획팀" }),
        organizationSummary({ id: "org-2", name: "개발팀" }),
        organizationSummary({ id: "org-3", name: "운영팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.focus(input);
  const finalOption = screen.getByRole("option", { name: "운영팀" });
  const scrollIntoView = vi.fn();
  Object.defineProperty(finalOption, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  fireEvent.keyDown(input, { key: "ArrowUp" });

  expect(input).toHaveAttribute("aria-activedescendant", finalOption.id);
  expect(finalOption).toHaveAttribute("aria-selected", "true");
  await waitFor(() =>
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }),
  );
});

it("requires explicit confirmation before creating a global organization", async () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "새 조직 이름" }), {
    target: { value: "  신규 조직  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 생성 후 추가" }));
  expect(
    screen.getByText("전역 조직으로 생성한 뒤 이 프로젝트에 추가합니다."),
  ).toBeVisible();
  expect(mockApi.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations",
      { newOrganizationName: "신규 조직", expectedProjectRevision: 7 },
    ),
  );
});

it("shows progress while creating and adding a new organization", async () => {
  const pendingMutation = deferred<{
    organization: ProjectOrganization;
    projectRevision: number;
  }>();
  mockApi.post.mockReturnValue(pendingMutation.promise);
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "조직 이름 검색 또는 입력",
    }),
    { target: { value: "신규 조직" } },
  );
  fireEvent.click(screen.getByRole("option", { name: /새 조직 생성 후 추가/ }));

  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  const pendingButton = screen.getByRole("button", {
    name: "생성 후 추가 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("dialog", { name: "새 조직 생성 후 추가" }),
  ).toBeVisible();

  await act(async () =>
    pendingMutation.resolve({
      organization: organizationMembership({
        organizationId: "org-new",
        name: "신규 조직",
      }),
      projectRevision: 8,
    }),
  );
});

it("reloads a recoverable name conflict without replaying or clearing the query", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "CONFLICT",
      message: "exists",
      requestId: "request-conflict",
      details: {
        organizationId: "org-existing",
        organizationName: "신규 조직",
        reason: "ORGANIZATION_NAME_EXISTS",
      },
    }),
  );
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={onChanged}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "신규 조직" } });
  fireEvent.click(screen.getByRole("option", { name: /새 조직 생성 후 추가/ }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  expect(
    await screen.findByText(
      "같은 이름의 조직이 이미 생성되어 최신 조직 목록을 불러왔습니다. 기존 조직을 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(input).toHaveValue("신규 조직");
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("guides an administrator to recover a deleted organization reserved during inline creation", async () => {
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "ORGANIZATION_NAME_RESERVED",
      message: "삭제된 동일 이름의 조직이 있습니다.",
      requestId: "request-1",
      details: { organizationId: "deleted org/1" },
    }),
  );
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const input = screen.getByRole("textbox", { name: "새 조직 이름" });
  fireEvent.change(input, { target: { value: "삭제된 조직" } });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 생성 후 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  const recovery = await screen.findByRole("link", {
    name: "삭제된 조직 복구하기",
  });
  expect(screen.getByText("삭제된 동일 이름의 조직이 있습니다.")).toBeVisible();
  expect(recovery).toHaveAttribute("href", "/organizations/deleted%20org%2F1");
  expect(input).toHaveValue("삭제된 조직");
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("refreshes correction candidates without exposing master restore for a reserved name", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "ORGANIZATION_NAME_RESERVED",
      message: "삭제된 동일 이름의 조직이 있습니다.",
      requestId: "request-correction-reserved",
      details: { organizationId: "deleted-org" },
    }),
  );
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      mutationMode="CLOSED_CORRECTION"
      onChanged={onChanged}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "삭제된 조직" } });
  fireEvent.click(screen.getByRole("option", { name: /새 조직 생성 후 추가/ }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  expect(
    await screen.findByText(
      "최신 이력 후보를 불러왔습니다. 삭제된 조직을 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "삭제된 조직 복구하기" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "새 조직 생성 후 추가" }),
  ).not.toBeInTheDocument();
  expect(input).toHaveValue("삭제된 조직");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("clears a reserved recovery link when an inline creation retry has a generic error", async () => {
  mockApi.post
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "ORGANIZATION_NAME_RESERVED",
        message: "삭제된 동일 이름의 조직이 있습니다.",
        requestId: "request-reserved",
        details: { organizationId: "deleted-org" },
      }),
    )
    .mockRejectedValueOnce(new Error("network failure"));
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "새 조직 이름" }), {
    target: { value: "삭제된 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 생성 후 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));
  expect(
    await screen.findByRole("link", { name: "삭제된 조직 복구하기" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  expect(
    await screen.findByText("조직 변경을 반영하지 못했습니다."),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "삭제된 조직 복구하기" }),
  ).not.toBeInTheDocument();
  expect(mockApi.post).toHaveBeenCalledTimes(2);
});

it("reloads a stale project revision and clears the bulk selection", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "request-stale",
    }),
  );
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[]}
      allOrganizations={[
        organizationSummary({ id: "org-1", name: "기획팀" }),
        organizationSummary({ id: "org-2", name: "운영팀" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("checkbox", { name: "기획팀" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "운영팀" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 2개 조직 추가" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 프로젝트 정보를 불러왔습니다. 조직을 다시 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "선택한 0개 조직 추가" }),
  ).toBeDisabled();
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("renders leadership metadata and only operator management links", () => {
  const memberships = [
    organizationMembership(),
    organizationMembership({
      organizationId: "org-2",
      name: "2팀",
      primaryLeader: { userId: "leader-1", displayName: "김대표" },
      managerCount: 2,
      rosterCount: 11,
    }),
  ];
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={memberships}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  expect(screen.getByText("대표 조직장 미지정")).toBeVisible();
  expect(screen.getByText("대표 조직장 김대표")).toBeVisible();
  expect(screen.getByText("담당자 0명")).toBeVisible();
  expect(screen.getByText("담당자 3명")).toBeVisible();
  expect(screen.getByText("현재 명단 11명")).toBeVisible();
  expect(
    screen.getAllByRole("link", { name: "조직 관리에서 담당자 지정" })[1],
  ).toHaveAttribute("href", "/organizations/org-2");

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={memberships}
      allOrganizations={[]}
      canMutateMemberships={false}
      canManageOrganizations={false}
      onChanged={onChanged}
    />,
  );
  expect(
    screen.queryByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).not.toBeInTheDocument();
});

it("hides deleted memberships from project organization management", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[
        organizationMembership({
          organizationId: "org-deleted",
          name: "삭제된 연결",
          isActive: true,
          masterIsActive: true,
          masterIsDeleted: true,
        }),
      ]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.queryByText("삭제된 연결")).not.toBeInTheDocument();
  expect(screen.getByText("연결된 조직이 없습니다.")).toBeVisible();
});

it("keeps operator organization management links without membership mutation controls", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[organizationMembership()]}
      allOrganizations={[]}
      canMutateMemberships={false}
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(
    screen.queryByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "프로젝트에 추가" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).toHaveAttribute("href", "/organizations/org-1");
  expect(
    screen.queryByRole("button", { name: /사용 중지|다시 사용/ }),
  ).not.toBeInTheDocument();
});

it("hides excluded organizations and reactivates them through the add flow", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={8}
      memberships={[
        organizationMembership({
          organizationId: "org-active",
          name: "활성 조직",
        }),
        organizationMembership({
          organizationId: "org-inactive",
          name: "제외 조직",
          isActive: false,
        }),
      ]}
      allOrganizations={[
        organizationSummary({ id: "org-active", name: "활성 조직" }),
        organizationSummary({ id: "org-inactive", name: "제외 조직" }),
      ]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  expect(screen.getByRole("checkbox", { name: "활성 조직" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "제외 조직" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 1개 조직 추가" }));
  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations/bulk",
      {
        organizationIds: ["org-inactive"],
        expectedProjectRevision: 8,
      },
    ),
  );
});

it("explains preservation when excluding an organization with business history", () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[organizationMembership({ hasBusinessHistory: true })]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에서 제외" }));
  expect(
    screen.getByText(
      "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다.",
    ),
  ).toBeVisible();
});

it("keeps the selected history-preserving exclusion dialog open after a patch failure", async () => {
  mockApi.patch.mockRejectedValueOnce(new Error("patch failed"));
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[
        organizationMembership({
          name: "기록 보존 조직",
          hasBusinessHistory: true,
        }),
      ]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에서 제외" }));
  const dialog = screen.getByRole("dialog", { name: "프로젝트 조직 제외" });
  fireEvent.click(within(dialog).getByRole("button", { name: "제외하기" }));

  await waitFor(() => expect(mockApi.patch).toHaveBeenCalledTimes(1));
  expect(
    screen.getByRole("dialog", { name: "프로젝트 조직 제외" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다.",
    ),
  ).toBeVisible();
  expect(screen.getByText("기록 보존 조직")).toBeVisible();
});

it("clears a stale exclusion and uses refreshed history when reopened", async () => {
  const originalMembership = organizationMembership({
    hasBusinessHistory: true,
  });
  const refreshedMembership = organizationMembership({
    hasBusinessHistory: false,
  });
  let view: ReturnType<typeof render> | undefined;
  const onChanged = vi.fn().mockImplementation(async () => {
    view?.rerender(
      <ProjectOrganizationsPanel
        projectId="project-1"
        projectRevision={8}
        memberships={[refreshedMembership]}
        allOrganizations={[]}
        canMutateMemberships
        canManageOrganizations
        onChanged={onChanged}
      />,
    );
  });
  mockApi.patch.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "request-stale-exclusion",
    }),
  );
  view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[originalMembership]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에서 제외" }));
  expect(
    screen.getByText(
      "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "제외하기" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 프로젝트 정보를 불러왔습니다. 조직을 다시 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "프로젝트 조직 제외" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에서 제외" }));
  expect(
    screen.getByText(
      "이 조직을 프로젝트에서 제외할까요? 다시 추가할 수 있습니다.",
    ),
  ).toBeVisible();
});

it("keeps the exclusion dialog open when cancel or close is attempted during mutation", () => {
  const pendingMutation = deferred<{
    organization: ProjectOrganization;
    projectRevision: number;
  }>();
  mockApi.patch.mockReturnValue(pendingMutation.promise);
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[organizationMembership({ hasBusinessHistory: false })]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "프로젝트에서 제외" }));
  const dialog = screen.getByRole("dialog", { name: "프로젝트 조직 제외" });
  fireEvent.click(within(dialog).getByRole("button", { name: "제외하기" }));

  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  fireEvent.keyDown(dialog, { key: "Escape" });

  expect(
    screen.getByRole("dialog", { name: "프로젝트 조직 제외" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "이 조직을 프로젝트에서 제외할까요? 다시 추가할 수 있습니다.",
    ),
  ).toBeVisible();
});

it("shows progress only on the membership being changed", async () => {
  const pendingMutation = deferred<{
    organization: ProjectOrganization;
    projectRevision: number;
  }>();
  mockApi.patch.mockReturnValue(pendingMutation.promise);
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[
        organizationMembership(),
        organizationMembership({
          organizationId: "org-2",
          name: "2팀",
        }),
      ]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  fireEvent.click(
    screen.getAllByRole("button", {
      name: "프로젝트에서 제외",
    })[0] as HTMLElement,
  );
  fireEvent.click(screen.getByRole("button", { name: "제외하기" }));

  expect(screen.getByRole("button", { name: "제외 중…" })).toBeDisabled();
  for (const button of screen.getAllByRole("button", {
    name: "프로젝트에서 제외",
  })) {
    expect(button).toBeDisabled();
  }
  expect(screen.getByText("Ｅ２Ｅ 1팀")).toBeVisible();
  expect(screen.getByText("2팀")).toBeVisible();

  await act(async () =>
    pendingMutation.resolve({
      organization: organizationMembership({ isActive: false }),
      projectRevision: 8,
    }),
  );
});

it("allows manager roster changes only for an active pre-registration membership", async () => {
  let membershipActive = false;
  let projectStatus: Project["status"] = "PRE_REGISTRATION";
  mockRole.current = "ORGANIZATION_MANAGER";
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      return { ...project, status: projectStatus };
    }
    if (path === "/projects/project-1/organizations") {
      return [
        {
          organizationId: "org-inactive",
          name: "중지 조직",
          isActive: membershipActive,
          masterIsActive: true,
          masterIsDeleted: false,
          activeProjectCount: 0,
          hasBusinessHistory: true,
          primaryLeader: null,
          managerCount: 0,
          rosterCount: 1,
        },
      ];
    }
    if (path === "/projects/project-1/roster") {
      return [
        {
          id: "entry-inactive",
          projectId: "project-1",
          participantId: "participant-1",
          participantNumber: "P-001",
          organizationId: "org-inactive",
          participantName: "박민수",
          organizationName: "중지 조직",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          wasExpectedAtStart: false,
          revision: 0,
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ];
    }
    if (path === "/participants") {
      return [
        {
          id: "participant-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-inactive",
          revision: 0,
        },
      ];
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));

  expect(await screen.findByText("읽기 전용")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "정보 수정" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "박민수 취소" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();

  cleanup();
  mockRole.current = "OPERATOR";
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("button", { name: "박민수 취소" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "정보 수정" })).toBeVisible();
  expect(screen.getByRole("button", { name: "참가자 추가" })).toBeVisible();

  cleanup();
  mockRole.current = "ORGANIZATION_MANAGER";
  membershipActive = true;
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("button", { name: "참가자 추가" }),
  ).toBeVisible();

  cleanup();
  projectStatus = "IN_PROGRESS";
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));
  expect(await screen.findByText("읽기 전용")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "정보 수정" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "박민수 취소" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();

  cleanup();
  mockRole.current = "OPERATOR";
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("button", { name: "박민수 취소" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "정보 수정" })).toBeVisible();
  expect(screen.getByRole("button", { name: "참가자 추가" })).toBeVisible();
});

it("confirms the exhaustive next transition action", async () => {
  mockApi.post.mockResolvedValueOnce({
    ...project,
    status: "IN_PROGRESS",
    revision: 2,
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  expect(mockApi.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/transition",
      { targetStatus: "IN_PROGRESS", expectedRevision: 1 },
    ),
  );
});

it("shows transition progress and prevents duplicate transition requests", async () => {
  const transition = deferred<unknown>();
  mockApi.post.mockReturnValueOnce(transition.promise);
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  const confirm = screen.getByRole("button", { name: "변경 확인" });

  fireEvent.click(confirm);

  expect(screen.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "변경 중…" }));
  expect(mockApi.post).toHaveBeenCalledTimes(1);

  await act(async () => transition.resolve(undefined));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "진행 시작" })).toBeEnabled(),
  );
});

it("keeps existing tab content visible while a full refresh is pending", async () => {
  const refreshedSummary = deferred<ReturnType<typeof emptySummary>>();
  let summaryReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") {
      summaryReads += 1;
      return summaryReads === 1
        ? emptySummary("project-1")
        : refreshedSummary.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  expect(
    await screen.findByRole("heading", { name: "프로젝트 개요" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(summaryReads).toBe(2));

  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("새로고침 중…");
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");

  await act(async () => refreshedSummary.resolve(emptySummary("project-1")));
  expect(screen.queryByText("새로고침 중…")).not.toBeInTheDocument();
});

it("preserves existing tab content when retrying a failed project refresh", async () => {
  let projectReads = 0;
  let summaryReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      if (projectReads === 2) return Promise.reject(new Error("offline"));
      return project;
    }
    if (path === "/projects/project-1/summary") {
      summaryReads += 1;
      return emptySummary("project-1");
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  expect(
    await screen.findByRole("heading", { name: "프로젝트 개요" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  expect(
    await screen.findByText("프로젝트 정보를 불러오지 못했습니다."),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(projectReads).toBe(3));

  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  expect(summaryReads).toBe(2);
  expect(screen.queryByText("새로고침 중…")).not.toBeInTheDocument();
});

it("keeps loaded overview content when a full refresh resource fails", async () => {
  let summaryReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") {
      summaryReads += 1;
      if (summaryReads === 1) {
        return { ...emptySummary("project-1"), expectedTotal: 7 };
      }
      return Promise.reject(new Error("summary unavailable"));
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  expect(await screen.findByText("예상 7명")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));

  expect(
    await screen.findByText("프로젝트 집계를 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByText("예상 7명")).toBeVisible();
});

it("keeps loaded audit content visible while its retry is pending", async () => {
  const retryAudit = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) {
        return {
          items: [auditItem("기존 이력")],
          nextCursor: null,
        };
      }
      if (auditReads === 2) {
        return Promise.reject(new Error("audit unavailable"));
      }
      return retryAudit.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(await screen.findByText("기존 이력")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  expect(
    await screen.findByText("변경 이력을 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByText("기존 이력")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(auditReads).toBe(3));
  expect(screen.getByText("기존 이력")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("새로고침 중…");

  await act(async () =>
    retryAudit.resolve({
      items: [auditItem("재시도 이력")],
      nextCursor: null,
    }),
  );
});

it("does not show an empty audit state before that resource first succeeds", async () => {
  const refreshedAudit = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) {
        return Promise.reject(new Error("audit unavailable"));
      }
      return refreshedAudit.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(
    await screen.findByText("변경 이력을 불러오지 못했습니다."),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(auditReads).toBe(2));

  expect(screen.queryByText("아직 기록이 없습니다.")).not.toBeInTheDocument();

  await act(async () =>
    refreshedAudit.resolve({
      items: [],
      nextCursor: null,
    }),
  );
  expect(await screen.findByText("아직 기록이 없습니다.")).toBeVisible();
});

it("reloads once after a stale transition without replaying it", async () => {
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "request-1",
    }),
  );
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(
    mockApi.get.mock.calls.filter(([path]) => path === "/projects/project-1"),
  ).toHaveLength(2);
});

it("requires a past end date to be cleared before reopen", async () => {
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      return {
        ...project,
        status: "CLOSED",
        revision: 2,
        endDate: "2026-05-23",
        closedAt: "2026-05-24T00:00:00.000Z",
        closedBy: "operator-1",
        closeReason: "SCHEDULED",
      };
    }
    if (
      path === "/projects/project-1/organizations" ||
      path === "/organizations" ||
      path === "/projects/project-1/roster" ||
      path === "/participants"
    ) {
      return [];
    }
    if (path === "/projects/project-1/summary") {
      return {
        projectId: "project-1",
        expectedTotal: 0,
        finalTotal: 0,
        deltaTotal: 0,
        organizations: [],
      };
    }
    if (path.startsWith("/projects/project-1/audit")) {
      return { items: [], nextCursor: null };
    }
    throw new Error(`unexpected path: ${path}`);
  });
  mockApi.patch.mockResolvedValueOnce({
    ...project,
    status: "CLOSED",
    revision: 3,
    endDate: null,
    closedAt: "2026-05-24T00:00:00.000Z",
    closedBy: "operator-1",
    closeReason: "SCHEDULED",
  });
  render(<ProjectDetailPage projectId="project-1" />);
  expect(
    await screen.findByRole("button", { name: "프로젝트 재개" }),
  ).toBeDisabled();
  expect(
    screen.getByText("종료일을 미래로 변경하거나 제거한 뒤 재개하세요."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "일정 수정" }));
  expect(screen.getByLabelText("프로젝트 이름")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith("/projects/project-1", {
      startDate: "2026-05-22",
      endDate: null,
      expectedRevision: 2,
    }),
  );
  expect(
    await screen.findByRole("button", { name: "프로젝트 재개" }),
  ).toBeEnabled();
});

it("keeps the project shell and overview when audit loading fails", async () => {
  mockApi.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/projects/project-1/audit")) {
      throw new Error("audit unavailable");
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: "리더십 캠프" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "변경 이력" }));
  expect(screen.getByText("변경 이력을 불러오지 못했습니다.")).toBeVisible();
});

it("keeps the project shell and overview when participant loading fails", async () => {
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/participants") throw new Error("participants unavailable");
    if (path === "/projects/project-1/roster") {
      return [
        {
          id: "entry-failed-candidates",
          projectId: "project-1",
          participantId: "participant-1",
          participantNumber: "P-001",
          organizationId: "org-1",
          participantName: "후보 실패에도 유지",
          organizationName: "1팀",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          wasExpectedAtStart: true,
          revision: 0,
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ];
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: "리더십 캠프" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  expect(screen.getByText("참가자 정보를 불러오지 못했습니다.")).toBeVisible();
  expect(screen.getByText("후보 실패에도 유지")).toBeVisible();
});

it("keeps a loaded roster visible while participant candidates are pending", async () => {
  const participantCandidates = deferred<never[]>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/participants") return participantCandidates.promise;
    if (path === "/projects/project-1/roster") {
      return [
        {
          id: "entry-1",
          projectId: "project-1",
          participantId: "participant-1",
          participantNumber: "P-001",
          organizationId: "org-1",
          participantName: "박민수",
          organizationName: "1팀",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          wasExpectedAtStart: true,
          revision: 0,
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ];
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));

  expect(await screen.findByText("박민수")).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "참가자 추가" })).toBeDisabled();

  await act(async () => participantCandidates.resolve([]));
});

it("keeps project memberships visible while organization candidates fail", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/organizations") {
      return [organizationMembership()];
    }
    if (path === "/organizations") {
      return Promise.reject(new Error("organizations unavailable"));
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));

  expect(await screen.findByText("Ｅ２Ｅ 1팀")).toBeVisible();
  expect(screen.getByText("전체 조직을 불러오지 못했습니다.")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "조직 이름 검색" }),
  ).toBeDisabled();
});

it("keeps project memberships visible while organization candidates are pending", async () => {
  const organizationCandidates = deferred<never[]>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/organizations") {
      return [organizationMembership()];
    }
    if (path === "/organizations") return organizationCandidates.promise;
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));

  expect(await screen.findByText("Ｅ２Ｅ 1팀")).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(
    screen.getByRole("textbox", { name: "조직 이름 검색" }),
  ).toBeDisabled();

  await act(async () => organizationCandidates.resolve([]));
});

it("shows successful overview regions without waiting for the other region", async () => {
  const summary = deferred<ReturnType<typeof emptySummary>>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") return summary.promise;
    if (path === "/projects/project-1/organizations") {
      return [organizationMembership()];
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(await screen.findByText("등록 조직")).toBeVisible();
  expect(screen.getByText("1개")).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");

  await act(async () => summary.resolve(emptySummary("project-1")));
});

it("retries only the project header request and preserves loaded resources", async () => {
  let projectReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      if (projectReads === 2) return Promise.reject(new Error("offline"));
      return project;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  await screen.findByRole("heading", { name: project.name });

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  expect(
    await screen.findByText("프로젝트 정보를 불러오지 못했습니다."),
  ).toBeVisible();
  const callsBeforeRetry = mockApi.get.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(projectReads).toBe(3));

  expect(
    mockApi.get.mock.calls.slice(callsBeforeRetry).map(([path]) => path),
  ).toEqual(["/projects/project-1"]);
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
});

it("lets only the latest same-generation project retry update the shell", async () => {
  const olderRetry = deferred<Project>();
  const latestRetry = deferred<Project>();
  let projectReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      if (projectReads === 1) return Promise.reject(new Error("offline"));
      return projectReads === 2 ? olderRetry.promise : latestRetry.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  const retry = captureReactClickHandler(
    await screen.findByRole("button", { name: "다시 시도" }),
  );

  act(() => {
    retry();
    retry();
  });
  await act(async () =>
    latestRetry.resolve({ ...project, name: "최신 프로젝트", revision: 3 }),
  );
  expect(
    await screen.findByRole("heading", { name: "최신 프로젝트" }),
  ).toBeVisible();

  await act(async () => olderRetry.reject(new Error("late failure")));
  expect(screen.getByRole("heading", { name: "최신 프로젝트" })).toBeVisible();
  expect(
    screen.queryByText("프로젝트 정보를 불러오지 못했습니다."),
  ).not.toBeInTheDocument();
});

it("keeps stale project actions disabled until the post-transition project refresh settles", async () => {
  const latestProject = deferred<Project>();
  let projectReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1 ? project : latestProject.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(projectReads).toBe(2));

  const header = screen
    .getByRole("heading", { name: project.name })
    .closest("header");
  expect(header).toHaveAttribute("aria-busy", "true");
  expect(within(header as HTMLElement).getByRole("status")).toHaveTextContent(
    "프로젝트 정보 새로고침 중…",
  );
  expect(screen.getByRole("button", { name: "프로젝트 수정" })).toBeDisabled();
  const staleTransition = screen.getByRole("button", { name: "진행 시작" });
  expect(staleTransition).toBeDisabled();
  fireEvent.click(staleTransition);
  expect(mockApi.post).toHaveBeenCalledTimes(1);

  await act(async () => latestProject.reject(new Error("offline")));
  expect(
    await screen.findByText("프로젝트 정보를 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "프로젝트 수정" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "진행 시작" })).toBeDisabled();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("releases transition actions after the project shell refresh without waiting for detail resources", async () => {
  const refreshedParticipants = deferred<never[]>();
  let projectReads = 0;
  let participantReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1
        ? project
        : { ...project, status: "IN_PROGRESS", revision: 2 };
    }
    if (path === "/participants") {
      participantReads += 1;
      return participantReads === 1 ? [] : refreshedParticipants.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));

  const nextAction = await screen.findByRole("button", {
    name: "프로젝트 종료",
  });
  expect(nextAction).toBeEnabled();
  const header = screen
    .getByRole("heading", { name: project.name })
    .closest("header");
  expect(header).not.toHaveAttribute("aria-busy");

  fireEvent.click(nextAction);
  expect(
    screen.getByRole("dialog", { name: "프로젝트 상태 변경" }),
  ).toBeVisible();

  await act(async () => refreshedParticipants.resolve([]));
});

it("retries only the failed audit resource", async () => {
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        items: [auditItem("재시도 성공")],
        nextCursor: null,
      });
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  const readsBeforeRetry = mockApi.get.mock.calls.map(([path]) => path);
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

  expect(await screen.findByText("재시도 성공")).toBeVisible();
  expect(auditReads).toBe(2);
  expect(
    mockApi.get.mock.calls.slice(readsBeforeRetry.length).map(([path]) => path),
  ).toEqual(["/projects/project-1/audit?limit=50"]);
});

it("ignores a retry handler captured before a newer full load", async () => {
  const refreshedAudit = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) return Promise.reject(new Error("offline"));
      return refreshedAudit.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  const staleRetry = captureReactClickHandler(
    await screen.findByRole("button", { name: "다시 시도" }),
  );

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(auditReads).toBe(2));
  act(() => staleRetry());

  expect(auditReads).toBe(2);

  await act(async () =>
    refreshedAudit.resolve({
      items: [],
      nextCursor: null,
    }),
  );
});

it("lets only the latest same-generation resource request update state", async () => {
  type AuditPage = {
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  };
  const earlyRequest = deferred<AuditPage>();
  const lateRequest = deferred<AuditPage>();
  const latestRequest = deferred<AuditPage>();
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) return Promise.reject(new Error("offline"));
      if (auditReads === 2) return earlyRequest.promise;
      if (auditReads === 3) return lateRequest.promise;
      return latestRequest.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  const retry = captureReactClickHandler(
    await screen.findByRole("button", { name: "다시 시도" }),
  );

  act(() => {
    retry();
    retry();
    retry();
  });
  expect(auditReads).toBe(4);

  await act(async () =>
    earlyRequest.resolve({
      items: [auditItem("먼저 끝난 이전 요청")],
      nextCursor: null,
    }),
  );
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("먼저 끝난 이전 요청")).not.toBeInTheDocument();

  await act(async () =>
    latestRequest.resolve({
      items: [auditItem("최신 요청")],
      nextCursor: null,
    }),
  );
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
  expect(screen.getByText("최신 요청")).toBeVisible();

  await act(async () =>
    lateRequest.resolve({
      items: [auditItem("늦게 끝난 이전 요청")],
      nextCursor: null,
    }),
  );
  expect(screen.getByText("최신 요청")).toBeVisible();
  expect(screen.queryByText("늦게 끝난 이전 요청")).not.toBeInTheDocument();
});

it("ignores an audit pagination handler captured before a newer full load", async () => {
  const reloadedAudit = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let initialAuditReads = 0;
  let oldCursorReads = 0;
  let newCursorReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      initialAuditReads += 1;
      return initialAuditReads === 1
        ? {
            items: [auditItem("이전 기준")],
            nextCursor: "old-cursor",
          }
        : reloadedAudit.promise;
    }
    if (path.endsWith("cursor=old-cursor")) {
      oldCursorReads += 1;
      return {
        items: [auditItem("오래된 페이지")],
        nextCursor: null,
      };
    }
    if (path.endsWith("cursor=new-cursor")) {
      newCursorReads += 1;
      return {
        items: [auditItem("새 페이지")],
        nextCursor: null,
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(await screen.findByText("이전 기준")).toBeVisible();
  const staleLoadMore = captureReactClickHandler(
    screen.getByRole("button", { name: "이력 더 보기" }),
  );

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(initialAuditReads).toBe(2));
  await act(async () => {
    reloadedAudit.resolve({
      items: [auditItem("새 기준")],
      nextCursor: "new-cursor",
    });
    await reloadedAudit.promise;
  });
  expect(screen.getByText("새 기준")).toBeVisible();

  await act(async () => {
    staleLoadMore();
    await Promise.resolve();
  });

  expect(oldCursorReads).toBe(0);
  expect(screen.queryByText("오래된 페이지")).not.toBeInTheDocument();
  expect(screen.getByText("새 기준")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(newCursorReads).toBe(1);
  expect(await screen.findByText("새 페이지")).toBeVisible();
});

it("ignores an old audit pagination handler after the live cursor advances", async () => {
  let firstCursorReads = 0;
  let secondCursorReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      return {
        items: [auditItem("기준 이력")],
        nextCursor: "cursor-1",
      };
    }
    if (path.endsWith("cursor=cursor-1")) {
      firstCursorReads += 1;
      return {
        items: [auditItem("첫 페이지")],
        nextCursor: "cursor-2",
      };
    }
    if (path.endsWith("cursor=cursor-2")) {
      secondCursorReads += 1;
      return {
        items: [auditItem("둘째 페이지")],
        nextCursor: null,
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(await screen.findByText("기준 이력")).toBeVisible();
  const staleFirstCursor = captureReactClickHandler(
    screen.getByRole("button", { name: "이력 더 보기" }),
  );

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(await screen.findByText("첫 페이지")).toBeVisible();
  await act(async () => {
    staleFirstCursor();
    await Promise.resolve();
  });

  expect(firstCursorReads).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(secondCursorReads).toBe(1);
  expect(await screen.findByText("둘째 페이지")).toBeVisible();
});

it("lets a same-generation audit retry supersede pending pagination", async () => {
  const oldPage = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let baseAuditReads = 0;
  let firstCursorReads = 0;
  let latestCursorReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      baseAuditReads += 1;
      if (baseAuditReads === 1) {
        return Promise.reject(new Error("offline"));
      }
      if (baseAuditReads === 2) {
        return {
          items: [auditItem("이전 기준")],
          nextCursor: "cursor-1",
        };
      }
      return {
        items: [auditItem("최신 기준")],
        nextCursor: "latest-cursor",
      };
    }
    if (path.endsWith("cursor=cursor-1")) {
      firstCursorReads += 1;
      return oldPage.promise;
    }
    if (path.endsWith("cursor=latest-cursor")) {
      latestCursorReads += 1;
      return {
        items: [auditItem("최신 페이지")],
        nextCursor: null,
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  const retryAudit = captureReactClickHandler(
    await screen.findByRole("button", { name: "다시 시도" }),
  );
  act(() => retryAudit());
  expect(await screen.findByText("이전 기준")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  await waitFor(() => expect(firstCursorReads).toBe(1));
  act(() => retryAudit());
  expect(await screen.findByText("최신 기준")).toBeVisible();

  await act(async () => {
    oldPage.resolve({
      items: [auditItem("무효 페이지")],
      nextCursor: null,
    });
    await oldPage.promise;
  });

  expect(screen.getByText("최신 기준")).toBeVisible();
  expect(screen.queryByText("이전 기준")).not.toBeInTheDocument();
  expect(screen.queryByText("무효 페이지")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(latestCursorReads).toBe(1);
  expect(await screen.findByText("최신 페이지")).toBeVisible();
});

it("invalidates the audit cursor and preserves a newer request lock across a full reload", async () => {
  const oldPage = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  const reloadedAudit = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  const newPage = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let initialAuditReads = 0;
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      initialAuditReads += 1;
      return initialAuditReads === 1
        ? { items: [auditItem("초기 이력")], nextCursor: "old-cursor" }
        : reloadedAudit.promise;
    }
    if (path.endsWith("cursor=old-cursor")) return oldPage.promise;
    if (path.endsWith("cursor=new-cursor")) return newPage.promise;
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(await screen.findByText("초기 이력")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.some(([path]) =>
        path.endsWith("cursor=old-cursor"),
      ),
    ).toBe(true),
  );

  fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(initialAuditReads).toBe(2));
  expect(
    screen.queryByRole("button", { name: "이력 더 보기" }),
  ).not.toBeInTheDocument();

  await act(async () => {
    reloadedAudit.resolve({
      items: [auditItem("재조회 기준")],
      nextCursor: "new-cursor",
    });
    await reloadedAudit.promise;
  });
  expect(screen.getByText("재조회 기준")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.filter(([path]) =>
        path.endsWith("cursor=new-cursor"),
      ),
    ).toHaveLength(1),
  );

  await act(async () => {
    oldPage.resolve({ items: [auditItem("무효 이력")], nextCursor: null });
    await oldPage.promise;
  });
  expect(screen.queryByText("무효 이력")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "더 불러오는 중…" }),
  ).toBeDisabled();
  expect(
    mockApi.get.mock.calls.filter(([path]) =>
      path.endsWith("cursor=new-cursor"),
    ),
  ).toHaveLength(1);

  await act(async () => {
    newPage.resolve({ items: [auditItem("새 페이지")], nextCursor: null });
    await newPage.promise;
  });
  expect(screen.getByText("새 페이지")).toBeVisible();
});

it("keeps audit items and retries after pagination fails", async () => {
  let paginationReads = 0;
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      return { items: [auditItem("기존 이력")], nextCursor: "retry-cursor" };
    }
    if (path.endsWith("cursor=retry-cursor")) {
      paginationReads += 1;
      if (paginationReads === 1) throw new Error("pagination unavailable");
      return { items: [auditItem("재시도 이력")], nextCursor: null };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  expect(await screen.findByText("기존 이력")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  expect(
    await screen.findByText("변경 이력을 더 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByText("기존 이력")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByText("재시도 이력")).toBeVisible();
  expect(paginationReads).toBe(2);
  expect(
    screen.queryByText("변경 이력을 더 불러오지 못했습니다."),
  ).not.toBeInTheDocument();
});

it("shows audit pagination progress and prevents duplicate requests", async () => {
  const pendingPage = deferred<{
    items: ReturnType<typeof auditItem>[];
    nextCursor: string | null;
  }>();
  let paginationReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      return { items: [auditItem("기존 이력")], nextCursor: "next-cursor" };
    }
    if (path.endsWith("cursor=next-cursor")) {
      paginationReads += 1;
      return pendingPage.promise;
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  const pendingButton = screen.getByRole("button", {
    name: "더 불러오는 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(paginationReads).toBe(1);
  expect(screen.getByText("기존 이력")).toBeVisible();

  await act(async () =>
    pendingPage.resolve({
      items: [auditItem("추가 이력")],
      nextCursor: null,
    }),
  );
  expect(await screen.findByText("추가 이력")).toBeVisible();
});

it("ignores a successful transition response after switching projects", async () => {
  const transition = deferred<unknown>();
  const lateProjectOne = deferred<Project>();
  let projectOneReads = 0;
  mockApi.post.mockReturnValueOnce(transition.promise);
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      projectOneReads += 1;
      return projectOneReads === 1 ? project : lateProjectOne.promise;
    }
    return multiProjectGet(path);
  });

  const view = render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  view.rerender(<ProjectDetailPage projectId="project-2" />);
  expect(
    await screen.findByRole("heading", { name: "신규 프로젝트" }),
  ).toBeVisible();

  await act(async () => {
    transition.resolve(undefined);
    await transition.promise;
    await Promise.resolve();
  });
  await act(async () => {
    lateProjectOne.resolve({ ...project, status: "IN_PROGRESS", revision: 2 });
    await lateProjectOne.promise;
    await Promise.resolve();
  });

  expect(screen.getByRole("heading", { name: "신규 프로젝트" })).toBeVisible();
  expect(screen.getByText("사전 등록")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "리더십 캠프" }),
  ).not.toBeInTheDocument();
});

it("ignores a stale reload response after switching projects", async () => {
  const staleReload = deferred<Project>();
  let projectOneReads = 0;
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "request-switch",
    }),
  );
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      projectOneReads += 1;
      return projectOneReads === 1 ? project : staleReload.promise;
    }
    return multiProjectGet(path);
  });

  const view = render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(projectOneReads).toBe(2));
  view.rerender(<ProjectDetailPage projectId="project-2" />);
  expect(
    await screen.findByRole("heading", { name: "신규 프로젝트" }),
  ).toBeVisible();

  await act(async () => {
    staleReload.resolve({ ...project, revision: 2 });
    await staleReload.promise;
  });

  expect(screen.getByRole("heading", { name: "신규 프로젝트" })).toBeVisible();
  expect(screen.getByText("사전 등록")).toBeVisible();
});

it("refreshes a project edit once when the project closed concurrently", async () => {
  let projectReads = 0;
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1 ? project : closedProject();
    }
    return defaultGet(path);
  });
  mockApi.patch.mockRejectedValueOnce(projectClosedError());

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "프로젝트 수정" }));
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "수정 시도" },
  });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 변경할 수 없습니다."),
  ).toBeVisible();
  expect(screen.getByText("종료")).toBeVisible();
  expect(projectReads).toBe(2);
});

it("refreshes once and removes organization mutation controls when the project closes", async () => {
  let projectReads = 0;
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1 ? project : closedProject();
    }
    if (path === "/projects/project-1/organizations") {
      return [
        {
          organizationId: "org-1",
          name: "1팀",
          isActive: true,
          masterIsActive: true,
          masterIsDeleted: false,
          activeProjectCount: 1,
          hasBusinessHistory: true,
          primaryLeader: null,
          managerCount: 0,
          rosterCount: 0,
        },
      ];
    }
    return defaultGet(path);
  });
  mockApi.post.mockRejectedValueOnce(projectClosedError());

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));
  fireEvent.change(screen.getByRole("textbox", { name: "새 조직 이름" }), {
    target: { value: "종료 중 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 생성 후 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 조직을 변경할 수 없습니다."),
  ).toBeVisible();
  expect(screen.getByText("종료")).toBeVisible();
  expect(projectReads).toBe(2);
  expect(
    screen.queryByRole("textbox", { name: "조직 이름 검색" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "선택한 0개 조직 추가" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /사용 중지|다시 사용/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).toBeVisible();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("owns closed history correction as an administrative operator-only local mode", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/history-corrections/candidates") {
      return { organizations: [], participants: [] };
    }
    return defaultGet(path);
  });

  const operatorView = render(<ProjectDetailPage projectId="project-1" />);
  const start = await screen.findByRole("button", { name: "이력 보정 시작" });
  expect(screen.queryByText("종료 후 이력 보정 중")).not.toBeInTheDocument();

  fireEvent.click(start);

  expect(await screen.findByText("종료 후 이력 보정 중")).toBeVisible();
  expect(
    screen.getByText("예상 인원은 변경되지 않고 실제 참석 인원에 반영됩니다."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "이력 보정 종료" })).toBeEnabled();
  expect(screen.getByText("종료", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "프로젝트 재개" })).toBeVisible();
  expect(mockApi.post).not.toHaveBeenCalledWith(
    "/projects/project-1/transition",
    expect.anything(),
  );

  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("button", { name: "참가자 추가" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "이력 보정 종료" }));
  expect(screen.queryByText("종료 후 이력 보정 중")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("종료", { exact: true })).toBeVisible();
  operatorView.unmount();

  mockRole.current = "ORGANIZATION_MANAGER";
  render(<ProjectDetailPage projectId="project-1" />);
  await screen.findByRole("heading", { name: project.name });
  expect(
    screen.queryByRole("button", { name: "이력 보정 시작" }),
  ).not.toBeInTheDocument();
});

it("omits organization mutation controls before entering closed correction", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/organizations") {
      return [organizationMembership()];
    }
    if (path === "/projects/project-1/history-corrections/candidates") {
      return {
        organizations: [
          { id: "org-2", name: "2팀", isActive: true, isDeleted: false },
        ],
        participants: [],
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));

  expect(
    screen.queryByRole("heading", { name: "조직 추가" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "이력 보정 시작" }));
  expect(
    await screen.findByRole("heading", { name: "조직 추가" }),
  ).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
  ).toBeEnabled();
});

it("discards open correction dialogs when the local mode exits", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/history-corrections/candidates") {
      return { organizations: [], participants: [] };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "이력 보정 시작" }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "이력 보정 종료" }));
  expect(
    screen.queryByRole("dialog", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "이력 보정 시작" }));
  await screen.findByText("종료 후 이력 보정 중");
  expect(
    screen.queryByRole("dialog", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();
});

it.each([
  { outcome: "reopened", code: "INVALID_TRANSITION" as const },
  { outcome: "deleted", code: "NOT_FOUND" as const },
])(
  "reloads the latest project when the initial correction candidates report $outcome",
  async ({ outcome, code }) => {
    let projectReads = 0;
    const latestProject =
      outcome === "reopened"
        ? { ...closedProject(), status: "IN_PROGRESS" as const, revision: 3 }
        : { ...deletedProject(), name: project.name, revision: 3 };
    mockApi.get.mockImplementation((path: string) => {
      if (path === "/projects/project-1") {
        projectReads += 1;
        if (projectReads === 1) return closedProject();
        if (outcome === "deleted") {
          throw new ApiError(404, {
            code: "NOT_FOUND",
            message: "deleted",
            requestId: "candidate-deleted",
          });
        }
        return latestProject;
      }
      if (path === "/projects/project-1?includeDeleted=true") {
        return latestProject;
      }
      if (path === "/projects/project-1/history-corrections/candidates") {
        throw new ApiError(code === "NOT_FOUND" ? 404 : 409, {
          code,
          message: outcome,
          requestId: `candidate-${outcome}`,
        });
      }
      return defaultGet(path);
    });

    render(<ProjectDetailPage projectId="project-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "이력 보정 시작" }),
    );

    expect(
      await screen.findByText(
        outcome === "deleted" ? "삭제된 프로젝트" : "진행 중",
        { exact: true },
      ),
    ).toBeVisible();
    expect(screen.queryByText("종료 후 이력 보정 중")).not.toBeInTheDocument();
    expect(projectReads).toBe(2);
  },
);

it("never exposes closed history correction to bootstrap operators", async () => {
  mockBootstrap.current = true;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  await screen.findByRole("heading", { name: project.name });
  expect(
    screen.queryByRole("button", { name: "이력 보정 시작" }),
  ).not.toBeInTheDocument();
  expect(mockApi.get).not.toHaveBeenCalledWith(
    "/projects/project-1/history-corrections/candidates",
  );
});

it("loads inactive and deleted correction candidates and routes organization mutations", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/organizations") {
      return [
        organizationMembership({
          organizationId: "org-deleted",
          name: "삭제 조직",
          isActive: false,
          masterIsActive: false,
          masterIsDeleted: true,
        }),
      ];
    }
    if (path === "/projects/project-1/history-corrections/candidates") {
      return {
        organizations: [
          {
            id: "org-inactive",
            name: "휴면 조직",
            isActive: false,
            isDeleted: false,
          },
          {
            id: "org-deleted",
            name: "삭제 조직",
            isActive: false,
            isDeleted: true,
          },
        ],
        participants: [],
      };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "이력 보정 시작" }),
  );
  await waitFor(() =>
    expect(mockApi.get).toHaveBeenCalledWith(
      "/projects/project-1/history-corrections/candidates",
    ),
  );
  fireEvent.click(screen.getByRole("tab", { name: "조직" }));

  expect(await screen.findByText("삭제 조직")).toBeVisible();
  expect(screen.getByText("삭제됨", { exact: true })).toHaveClass(
    "er-badge--deleted",
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
    { target: { value: "휴면" } },
  );
  fireEvent.click(
    screen.getByRole("option", { name: "휴면 조직 · 사용 중지" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/history-corrections/organizations",
      { organizationId: "org-inactive", expectedProjectRevision: 2 },
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "다시 사용" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/projects/project-1/history-corrections/organizations/org-deleted",
      { isActive: true, expectedProjectRevision: 8 },
    ),
  );
  for (const path of [
    "/projects/project-1",
    "/projects/project-1/organizations",
    "/projects/project-1/summary",
    "/projects/project-1/roster",
    "/projects/project-1/audit?limit=50",
    "/projects/project-1/history-corrections/candidates",
  ]) {
    expect(
      mockApi.get.mock.calls.filter(([requestedPath]) => requestedPath === path)
        .length,
    ).toBeGreaterThanOrEqual(2);
  }
});

it("disables correction controls while a project transition confirmation is open", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/history-corrections/candidates") {
      return { organizations: [], participants: [] };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "이력 보정 시작" }),
  );
  await screen.findByText("종료 후 이력 보정 중");
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("link", { name: "엑셀 가져오기" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 재개" }));

  expect(screen.getByRole("button", { name: "이력 보정 종료" })).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "엑셀 가져오기" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "프로젝트 상태 변경" }),
  ).toBeVisible();
});

it("disables correction controls while a project deletion confirmation is open", async () => {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") return closedProject();
    if (path === "/projects/project-1/history-corrections/candidates") {
      return { organizations: [], participants: [] };
    }
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "이력 보정 시작" }),
  );
  await screen.findByText("종료 후 이력 보정 중");
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  expect(
    await screen.findByRole("link", { name: "엑셀 가져오기" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }));

  expect(screen.getByRole("button", { name: "이력 보정 종료" })).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "엑셀 가져오기" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "프로젝트 삭제" })).toBeVisible();
});

it("preserves a correction participant draft after stale reload", async () => {
  let projectReads = 0;
  let candidateReads = 0;
  const staleProjectReload = deferred<Project>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      projectReads += 1;
      return projectReads === 1 ? closedProject() : staleProjectReload.promise;
    }
    if (path === "/projects/project-1/organizations") {
      return [organizationMembership()];
    }
    if (path === "/projects/project-1/history-corrections/candidates") {
      candidateReads += 1;
      return {
        organizations: [
          { id: "org-1", name: "1팀", isActive: true, isDeleted: false },
        ],
        participants: [
          {
            id: "person-2",
            participantId: "P-002",
            name: candidateReads === 1 ? "서버 이름" : "최신 서버 이름",
            organizationId: "org-1",
            revision: candidateReads,
            suggestedRole: "STUDENT",
            suggestedGrade: "M1",
          },
        ],
      };
    }
    return defaultGet(path);
  });
  mockApi.post.mockRejectedValueOnce(
    new ApiError(409, {
      code: "STALE_REVISION",
      message: "stale",
      requestId: "correction-stale",
    }),
  );

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "이력 보정 시작" }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "사용자 입력 보존" },
  });
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await waitFor(() => expect(projectReads).toBe(2));
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.getByLabelText("확정 이름")).toHaveValue("사용자 입력 보존");

  await act(async () =>
    staleProjectReload.resolve({ ...closedProject(), revision: 3 }),
  );
  expect(await screen.findByText("최신 이력을 불러왔습니다.")).toBeVisible();
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.getByLabelText("확정 이름")).toHaveValue("사용자 입력 보존");
  expect(projectReads).toBe(2);
  expect(candidateReads).toBe(2);
});

it.each([
  { outcome: "reopened", code: "INVALID_TRANSITION" as const },
  { outcome: "deleted", code: "NOT_FOUND" as const },
])(
  "leaves correction mode for a concurrently $outcome project",
  async ({ outcome, code }) => {
    let projectReads = 0;
    const latestProject =
      outcome === "reopened"
        ? { ...closedProject(), status: "IN_PROGRESS" as const, revision: 3 }
        : {
            ...deletedProject(),
            name: project.name,
            revision: 3,
          };
    mockApi.get.mockImplementation((path: string) => {
      if (path === "/projects/project-1") {
        projectReads += 1;
        if (projectReads === 1) return closedProject();
        if (outcome === "deleted") {
          throw new ApiError(404, {
            code: "NOT_FOUND",
            message: "deleted",
            requestId: "correction-deleted",
          });
        }
        return latestProject;
      }
      if (path === "/projects/project-1?includeDeleted=true") {
        return latestProject;
      }
      if (path === "/projects/project-1/organizations") {
        return [organizationMembership()];
      }
      if (path === "/projects/project-1/roster") {
        return [
          {
            id: "entry-1",
            projectId: "project-1",
            participantId: "person-1",
            participantNumber: "P-001",
            organizationId: "org-1",
            participantName: "박민수",
            organizationName: "1팀",
            role: "STUDENT",
            grade: "M1",
            source: "PRE_REGISTRATION",
            status: "ACTIVE",
            wasExpectedAtStart: true,
            revision: 0,
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
        ];
      }
      if (path === "/projects/project-1/history-corrections/candidates") {
        return {
          organizations: [
            { id: "org-1", name: "1팀", isActive: true, isDeleted: false },
          ],
          participants: [],
        };
      }
      return defaultGet(path);
    });
    mockApi.patch.mockRejectedValueOnce(
      new ApiError(code === "NOT_FOUND" ? 404 : 409, {
        code,
        message: outcome,
        requestId: `correction-${outcome}`,
      }),
    );

    render(<ProjectDetailPage projectId="project-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "이력 보정 시작" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
    fireEvent.click(await screen.findByRole("button", { name: "박민수 취소" }));

    await waitFor(() =>
      expect(
        screen.queryByText("종료 후 이력 보정 중"),
      ).not.toBeInTheDocument(),
    );
    if (outcome === "deleted") {
      expect(
        screen.getByText("삭제된 프로젝트", { exact: true }),
      ).toBeVisible();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText("진행 중", { exact: true })).toBeVisible();
      expect(screen.getByRole("tablist")).toBeVisible();
    }
  },
);

async function defaultGet(path: string) {
  if (path === "/projects/project-1") return project;
  if (path === "/projects/project-1/organizations") return [];
  if (path === "/organizations") {
    return [{ id: "org-1", name: "1팀", isActive: true }];
  }
  if (path === "/projects/project-1/summary") return emptySummary("project-1");
  if (path.startsWith("/projects/project-1/audit")) {
    return { items: [], nextCursor: null };
  }
  if (path === "/projects/project-1/roster" || path === "/participants") {
    return [];
  }
  throw new Error(`unexpected path: ${path}`);
}

async function multiProjectGet(path: string) {
  if (path === "/projects/project-2") return projectTwo();
  if (path === "/projects/project-2/summary") return emptySummary("project-2");
  if (
    path === "/projects/project-2/organizations" ||
    path === "/projects/project-2/roster"
  ) {
    return [];
  }
  if (path.startsWith("/projects/project-2/audit")) {
    return { items: [], nextCursor: null };
  }
  if (
    path === "/projects/project-1/summary" ||
    path === "/projects/project-1/organizations" ||
    path === "/projects/project-1/roster" ||
    path === "/participants" ||
    path === "/organizations"
  ) {
    if (path.endsWith("/summary")) return emptySummary("project-1");
    return [];
  }
  if (path.startsWith("/projects/project-1/audit")) {
    return { items: [], nextCursor: null };
  }
  throw new Error(`unexpected path: ${path}`);
}

function emptySummary(projectId: string) {
  return {
    projectId,
    expectedTotal: 0,
    finalTotal: 0,
    deltaTotal: 0,
    studentTotal: 0,
    teacherTotal: 0,
    organizations: [],
  };
}

function projectTwo() {
  return {
    ...project,
    id: "project-2",
    name: "신규 프로젝트",
    status: "PRE_REGISTRATION" as const,
    revision: 0,
  };
}

function closedProject() {
  return {
    ...project,
    status: "CLOSED" as const,
    revision: 2,
    endDate: null,
    closedAt: "2026-07-22T00:00:00.000Z",
    closedBy: "operator-1",
    closeReason: "MANUAL" as const,
  };
}

function deletedProject(): Project {
  return {
    ...closedProject(),
    name: "삭제된 수련 법회",
    revision: 7,
    isDeleted: true,
    deletedAt: "2026-07-29T01:00:00.000Z",
  };
}

function organizationMembership(
  overrides: Partial<ProjectOrganization> = {},
): ProjectOrganization {
  return {
    organizationId: "org-1",
    name: "Ｅ２Ｅ 1팀",
    isActive: true,
    masterIsActive: true,
    masterIsDeleted: false,
    activeProjectCount: 1,
    hasBusinessHistory: true,
    primaryLeader: null,
    managerCount: 0,
    rosterCount: 0,
    ...overrides,
  };
}

function organizationSummary(
  overrides: Partial<OrganizationSummary> = {},
): OrganizationSummary {
  return {
    id: "org-1",
    name: "Ｅ２Ｅ 1팀",
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    primaryLeader: null,
    managerCount: 0,
    projectCount: 0,
    ...overrides,
  };
}

function projectClosedError() {
  return new ApiError(409, {
    code: "PROJECT_CLOSED",
    message: "closed",
    requestId: "request-closed",
  });
}

function auditItem(action: string) {
  return {
    id: `audit-${action}`,
    actorUserId: "operator-1",
    action,
    entityType: "PROJECT",
    entityId: "project-1",
    occurredAt: "2026-07-22T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function captureReactClickHandler(element: HTMLElement) {
  const reactPropsKey = Object.getOwnPropertyNames(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!reactPropsKey) throw new Error("React click props not found");
  const props = (
    element as unknown as Record<string, { onClick?: () => void }>
  )[reactPropsKey];
  if (!props?.onClick) throw new Error("React click handler not found");
  return props.onClick;
}
