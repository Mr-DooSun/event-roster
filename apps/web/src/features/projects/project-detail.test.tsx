import "@testing-library/jest-dom/vitest";
import type { Project, ProjectOrganization } from "@event-roster/contracts";
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

const { mockApi, mockRole } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  mockRole: {
    current: "OPERATOR" as "OPERATOR" | "ORGANIZATION_MANAGER",
  },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: mockRole.current } } },
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
};

beforeEach(() => {
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockApi.patch.mockReset();
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
});

afterEach(cleanup);

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
  expect(screen.getByText("사전 등록")).toBeVisible();
  expect(screen.getByText("2026.05.22 ~ 2026.05.23")).toBeVisible();
  expect(screen.getByText("자동 종료")).toBeVisible();
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

it("adds an existing organization with the observed project revision", async () => {
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
    { target: { value: "1팀" } },
  );
  fireEvent.click(screen.getByRole("option", { name: "1팀" }));
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations",
      { organizationId: "org-1", expectedProjectRevision: 1 },
    ),
  );
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
      allOrganizations={[{ id: "org-2", name: "2팀", isActive: true }]}
      canMutateMemberships
      canManageOrganizations
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
        { id: "org-1", name: "1팀", isActive: true },
        { id: "org-2", name: "2팀", isActive: true },
      ]}
      canMutateMemberships
      canManageOrganizations
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
      "/projects/project-1/organizations",
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
        { id: "org-1", name: "E2E 1팀", isActive: true },
        { id: "org-2", name: "E2E 운영팀", isActive: true },
      ]}
      canMutateMemberships
      canManageOrganizations
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
        { id: "org-1", name: "Ｅ２Ｅ 1팀", isActive: true },
        { id: "org-2", name: "다른 팀", isActive: true },
      ]}
      canMutateMemberships
      canManageOrganizations
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
        { id: "org-1", name: "기획팀", isActive: true },
        { id: "org-2", name: "개발팀", isActive: true },
      ]}
      canMutateMemberships
      canManageOrganizations
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
        { id: "org-1", name: "기획팀", isActive: true },
        { id: "org-2", name: "개발팀", isActive: true },
        { id: "org-3", name: "운영팀", isActive: true },
      ]}
      canMutateMemberships
      canManageOrganizations
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

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "  신규 조직  " } });
  fireEvent.click(
    screen.getByRole("option", { name: "“신규 조직” 새 조직 생성 후 추가" }),
  );
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

it("reloads a stale project revision without replaying or clearing the query", async () => {
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
      allOrganizations={[{ id: "org-1", name: "기획팀", isActive: true }]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  fireEvent.change(input, { target: { value: "기획팀" } });
  fireEvent.click(screen.getByRole("option", { name: "기획팀" }));
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 프로젝트 정보를 불러왔습니다. 조직을 다시 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(input).toHaveValue("기획팀");
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

it("separates disabled membership mutations from operator organization management", () => {
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
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "프로젝트에 추가" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).toHaveAttribute("href", "/organizations/org-1");
  expect(
    screen.queryByRole("button", { name: /사용 중지|다시 사용/ }),
  ).not.toBeInTheDocument();
});

it("chains project revisions for deactivation and reactivation", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const membership = organizationMembership();
  const view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={7}
      memberships={[membership]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "사용 중지" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/projects/project-1/organizations/org-1",
      { isActive: false, expectedProjectRevision: 7 },
    ),
  );

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      projectRevision={8}
      memberships={[{ ...membership, isActive: false }]}
      allOrganizations={[]}
      canMutateMemberships
      canManageOrganizations
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 사용" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/projects/project-1/organizations/org-1",
      { isActive: true, expectedProjectRevision: 8 },
    ),
  );
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
    screen.getAllByRole("button", { name: "사용 중지" })[0] as HTMLElement,
  );

  expect(screen.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "사용 중지" })).toBeDisabled();
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
          activeProjectCount: 0,
          hasHistory: true,
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
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
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
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
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
  expect(screen.getByText("준비 중")).toBeVisible();
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
  expect(screen.getByText("준비 중")).toBeVisible();
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

it("refreshes once and hides organization controls when the project closes", async () => {
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
          activeProjectCount: 1,
          hasHistory: true,
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
  fireEvent.change(
    screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
    {
      target: { value: "종료 중 조직" },
    },
  );
  fireEvent.click(screen.getByRole("option", { name: /새 조직 생성 후 추가/ }));
  fireEvent.click(screen.getByRole("button", { name: "생성 후 추가" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 조직을 변경할 수 없습니다."),
  ).toBeVisible();
  expect(screen.getByText("종료")).toBeVisible();
  expect(projectReads).toBe(2);
  const preservedInput = screen.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  expect(preservedInput).toHaveValue("종료 중 조직");
  expect(preservedInput).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "프로젝트에 추가" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /사용 중지|다시 사용/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "조직 관리에서 담당자 지정" }),
  ).toBeVisible();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

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
    organizations: [],
  };
}

function projectTwo() {
  return {
    ...project,
    id: "project-2",
    name: "신규 프로젝트",
    status: "PREPARING" as const,
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

function organizationMembership(
  overrides: Partial<ProjectOrganization> = {},
): ProjectOrganization {
  return {
    organizationId: "org-1",
    name: "Ｅ２Ｅ 1팀",
    isActive: true,
    masterIsActive: true,
    activeProjectCount: 1,
    hasHistory: true,
    primaryLeader: null,
    managerCount: 0,
    rosterCount: 0,
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
