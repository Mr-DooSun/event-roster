import "@testing-library/jest-dom/vitest";
import type { Project } from "@event-roster/contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectOrganizationsPanel } from "./ProjectOrganizationsPanel";

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: "OPERATOR" } } },
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
  mockApi.post.mockResolvedValue(undefined);
  mockApi.patch.mockResolvedValue(undefined);
  mockApi.get.mockImplementation(defaultGet);
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

it("adds an existing organization from the organization tab", async () => {
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));
  fireEvent.change(screen.getByLabelText("기존 조직"), {
    target: { value: "org-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations",
      { organizationId: "org-1" },
    ),
  );
});

it("creates a new organization and hides controls in read-only mode", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[]}
      allOrganizations={[]}
      canAdminister
      onChanged={onChanged}
    />,
  );
  fireEvent.change(screen.getByLabelText("새 조직 이름"), {
    target: { value: "신규 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 추가" }));
  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations",
      { newOrganizationName: "신규 조직" },
    ),
  );

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[
        {
          organizationId: "org-1",
          name: "1팀",
          isActive: false,
          masterIsActive: true,
          activeProjectCount: 2,
          hasHistory: true,
        },
      ]}
      allOrganizations={[]}
      canAdminister={false}
      onChanged={onChanged}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /다시 사용|사용 중지|이름 저장/ }),
  ).not.toBeInTheDocument();
});

it("deactivates and reactivates a project organization", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const membership = {
    organizationId: "org-1",
    name: "1팀",
    isActive: true,
    masterIsActive: true,
    activeProjectCount: 1,
    hasHistory: true,
  };
  const view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[membership]}
      allOrganizations={[]}
      canAdminister
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "사용 중지" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/projects/project-1/organizations/org-1",
      { isActive: false },
    ),
  );

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[{ ...membership, isActive: false }]}
      allOrganizations={[]}
      canAdminister
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 사용" }));
  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith(
      "/projects/project-1/organizations",
      { organizationId: "org-1" },
    ),
  );
});

it("confirms the global impact before renaming", async () => {
  render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[
        {
          organizationId: "org-1",
          name: "1팀",
          isActive: true,
          masterIsActive: true,
          activeProjectCount: 2,
          hasHistory: true,
        },
      ]}
      allOrganizations={[]}
      canAdminister
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.change(screen.getByLabelText("1팀 조직 이름"), {
    target: { value: "변경 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  expect(
    screen.getByText("이 변경은 현재 2개 활성 프로젝트에 반영됩니다."),
  ).toBeVisible();
  expect(mockApi.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith("/organizations/org-1", {
      name: "변경 조직",
    }),
  );
});

it("discards a hidden rename confirmation before administration returns", async () => {
  const membership = {
    organizationId: "org-1",
    name: "1팀",
    isActive: true,
    masterIsActive: true,
    activeProjectCount: 2,
    hasHistory: true,
  };
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[membership]}
      allOrganizations={[]}
      canAdminister
      onChanged={onChanged}
    />,
  );
  fireEvent.change(screen.getByLabelText("1팀 조직 이름"), {
    target: { value: "변경 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  expect(screen.getByRole("button", { name: "변경 확인" })).toBeVisible();

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[membership]}
      allOrganizations={[]}
      canAdminister={false}
      onChanged={onChanged}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "변경 확인" }),
  ).not.toBeInTheDocument();

  view.rerender(
    <ProjectOrganizationsPanel
      projectId="project-1"
      memberships={[membership]}
      allOrganizations={[]}
      canAdminister
      onChanged={onChanged}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "변경 확인" }),
  ).not.toBeInTheDocument();
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
    return defaultGet(path);
  });

  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: "리더십 캠프" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "참가 명단" }));
  expect(screen.getByText("참가자 정보를 불러오지 못했습니다.")).toBeVisible();
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

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
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
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  expect(await screen.findByText("재시도 이력")).toBeVisible();
  expect(paginationReads).toBe(2);
  expect(
    screen.queryByText("변경 이력을 더 불러오지 못했습니다."),
  ).not.toBeInTheDocument();
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
        },
      ];
    }
    return defaultGet(path);
  });
  mockApi.post.mockRejectedValueOnce(projectClosedError());

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));
  fireEvent.change(screen.getByLabelText("새 조직 이름"), {
    target: { value: "종료 중 조직" },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 추가" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 변경할 수 없습니다."),
  ).toBeVisible();
  expect(screen.getByText("종료")).toBeVisible();
  expect(projectReads).toBe(2);
  expect(
    screen.queryByRole("button", { name: /새 조직 추가|사용 중지|이름 저장/ }),
  ).not.toBeInTheDocument();
});

it("closes an organization rename dialog when the project closes", async () => {
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
        },
      ];
    }
    return defaultGet(path);
  });
  mockApi.patch.mockRejectedValueOnce(projectClosedError());

  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("tab", { name: "조직" }));
  fireEvent.change(screen.getByLabelText("1팀 조직 이름"), {
    target: { value: "변경 시도" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 변경할 수 없습니다."),
  ).toBeVisible();
  expect(projectReads).toBe(2);
  expect(
    screen.queryByRole("button", { name: "변경 확인" }),
  ).not.toBeInTheDocument();
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
