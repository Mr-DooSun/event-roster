import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { App } from "./App";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    role: "OPERATOR" as "OPERATOR" | "ORGANIZATION_MANAGER",
  },
}));

vi.mock("../features/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    api: mockApi,
    auth: {
      session: {
        user: {
          displayName: "운영자",
          role: authState.role,
          isBootstrap: false,
        },
      },
    },
    status: "AUTHENTICATED",
    logout: vi.fn(),
  }),
}));

beforeEach(() => {
  authState.role = "OPERATOR";
  mockApi.get.mockReset().mockResolvedValue([]);
  mockApi.post.mockReset();
  mockApi.patch.mockReset();
  mockApi.delete.mockReset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("renders project-centered navigation for operators", async () => {
  render(<App />);

  expect(await screen.findByRole("link", { name: "프로젝트" })).toHaveAttribute(
    "href",
    "/projects",
  );
  expect(screen.getByRole("link", { name: "계정" })).toHaveAttribute(
    "href",
    "/users",
  );
  expect(screen.getByRole("link", { name: "조직 관리" })).toHaveAttribute(
    "href",
    "/organizations",
  );
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "프로젝트",
    "조직 관리",
    "계정",
  ]);
  expect(screen.getByText("프로젝트 참가자 명단")).toBeVisible();
});

it("routes an organization URL to operator administration detail", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      return Promise.resolve({
        id: "org-1",
        name: "1팀",
        isActive: true,
        primaryLeader: null,
        managerCount: 0,
        projectCount: 0,
        managers: [],
        projects: [],
      });
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });

  render(<App />);

  expect(await screen.findByRole("heading", { name: "1팀" })).toBeVisible();
  expect(screen.getByText("대표 조직장 미지정")).toBeVisible();
});

it("assigns existing and newly provisioned organization managers", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  let failNextDetailReload = false;
  let auditCalls = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      if (failNextDetailReload) {
        failNextDetailReload = false;
        return Promise.reject(new Error("reload failed"));
      }
      return Promise.resolve(organizationDetail());
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      auditCalls += 1;
      return Promise.resolve({
        items:
          auditCalls > 1
            ? [
                {
                  id: "audit-assigned",
                  actorUserId: "operator-1",
                  action: "ORGANIZATION_MANAGER_ASSIGNED",
                  entityType: "USER_ORGANIZATION",
                  entityId: "user-3",
                  occurredAt: "2026-07-23T00:00:00.000Z",
                },
              ]
            : [],
        nextCursor: null,
      });
    }
    if (
      path === "/organizations/org-1/assignable-users?query=%EC%8B%A0%EA%B7%9C"
    ) {
      return Promise.resolve([
        {
          userId: "user-3",
          loginId: "manager-03",
          displayName: "신규 후보",
          isActive: true,
        },
      ]);
    }
    return Promise.resolve([]);
  });
  mockApi.post.mockImplementation(
    (_path: string, body: { kind: "EXISTING" | "NEW" }) => {
      if (body.kind === "NEW") {
        failNextDetailReload = true;
        return Promise.resolve({
          manager: {
            userId: "user-4",
            assignmentRole: "MANAGER",
          },
          temporaryPassword: "abcdefghjkmnpqrstuvw",
        });
      }
      return Promise.resolve({
        manager: { userId: "user-3", assignmentRole: "MANAGER" },
      });
    },
  );

  render(<App />);
  expect(await screen.findByRole("heading", { name: "1팀" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "기존 계정 지정" }));
  fireEvent.change(screen.getByLabelText("계정 검색"), {
    target: { value: "신규" },
  });
  fireEvent.click(screen.getByRole("button", { name: "계정 찾기" }));
  expect(
    await screen.findByRole("option", { name: /신규 후보/ }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("지정할 계정"), {
    target: { value: "user-3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "담당자로 지정" }));
  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith("/organizations/org-1/managers", {
      kind: "EXISTING",
      userId: "user-3",
      assignmentRole: "MANAGER",
    }),
  );
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/audit?limit=50",
      ),
    ).toHaveLength(2),
  );
  expect(await screen.findByText("조직 담당자 지정")).toBeVisible();

  const newManagerTrigger = screen.getByRole("button", {
    name: "새 담당자 발급",
  });
  fireEvent.click(newManagerTrigger);
  fireEvent.change(screen.getByLabelText("영문 로그인 ID"), {
    target: { value: "new-manager" },
  });
  fireEvent.change(screen.getByLabelText("표시 이름"), {
    target: { value: "새 담당자" },
  });
  fireEvent.change(screen.getByLabelText("조직별 역할"), {
    target: { value: "MANAGER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "계정 발급 및 지정" }));
  expect(await screen.findByText("abcdefghjkmnpqrstuvw")).toBeVisible();
  expect(
    await screen.findByText(
      "담당자 변경은 반영됐지만 최신 조직 정보를 불러오지 못했습니다.",
    ),
  ).toBeVisible();
  expect(mockApi.post).toHaveBeenCalledWith("/organizations/org-1/managers", {
    kind: "NEW",
    loginId: "new-manager",
    displayName: "새 담당자",
    assignmentRole: "MANAGER",
  });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(newManagerTrigger).toHaveFocus());
});

it("replaces and removes organization leadership assignments explicitly", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      return Promise.resolve(organizationDetail());
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });
  mockApi.patch.mockResolvedValue(organizationDetail());
  mockApi.delete.mockResolvedValue(undefined);

  render(<App />);
  expect(await screen.findByText("추가 관리자 1")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "추가 관리자 1 대표로 지정" }),
  );
  fireEvent.change(screen.getByLabelText("기존 대표 처리"), {
    target: { value: "MANAGER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "대표 변경 확인" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith("/organizations/org-1/primary", {
      userId: "manager-2",
      expectedPrimaryUserId: "leader-1",
      previousPrimaryDisposition: "MANAGER",
    }),
  );
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/audit?limit=50",
      ),
    ).toHaveLength(2),
  );

  fireEvent.click(
    screen.getByRole("button", { name: "추가 관리자 1 담당 해제" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "담당 해제 확인" }));
  await waitFor(() =>
    expect(mockApi.delete).toHaveBeenCalledWith(
      "/organizations/org-1/managers/manager-2",
    ),
  );
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/audit?limit=50",
      ),
    ).toHaveLength(3),
  );

  fireEvent.click(screen.getByRole("button", { name: "대표 지정 해제" }));
  fireEvent.click(screen.getByRole("button", { name: "대표 해제 확인" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith("/organizations/org-1/primary", {
      userId: null,
      expectedPrimaryUserId: "leader-1",
      previousPrimaryDisposition: "REMOVE",
    }),
  );
  await waitFor(() =>
    expect(
      mockApi.get.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/audit?limit=50",
      ),
    ).toHaveLength(4),
  );
});

it("edits organization state, renders projects, and paginates audit history", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      return Promise.resolve(organizationDetail());
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({
        items: [
          {
            id: "audit-1",
            actorUserId: "operator-1",
            action: "ORGANIZATION_RENAMED",
            entityType: "ORGANIZATION",
            entityId: "org-1",
            occurredAt: "2026-07-23T00:00:00.000Z",
            details: { organizationId: "org-1" },
          },
        ],
        nextCursor: "cursor-1",
      });
    }
    if (path === "/organizations/org-1/audit?limit=50&cursor=cursor-1") {
      return Promise.resolve({
        items: [
          {
            id: "audit-2",
            actorUserId: "operator-1",
            action: "ORGANIZATION_MANAGER_ASSIGNED",
            entityType: "USER_ORGANIZATION",
            entityId: "manager-2",
            occurredAt: "2026-07-22T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve([]);
  });
  mockApi.patch
    .mockResolvedValueOnce({ ...organizationDetail(), name: "운영팀" })
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "CONFLICT",
        message: "conflict",
        requestId: "request-1",
      }),
    );

  render(<App />);
  expect(
    await screen.findByRole("link", { name: "진행 프로젝트" }),
  ).toHaveAttribute("href", "/projects/project-active");
  fireEvent.change(screen.getByLabelText("조직 이름"), {
    target: { value: "운영팀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  await waitFor(() =>
    expect(mockApi.patch).toHaveBeenCalledWith("/organizations/org-1", {
      name: "운영팀",
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "조직 사용 중지" }));
  fireEvent.click(screen.getByRole("button", { name: "상태 변경 확인" }));
  expect(
    await screen.findByText(
      "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다.",
    ),
  ).toBeVisible();

  expect(screen.getByText("조직 이름 변경")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(await screen.findByText("조직 담당자 지정")).toBeVisible();
});

it("does not claim a conflict reload succeeded when detail refresh fails", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  let detailCalls = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      detailCalls += 1;
      return detailCalls === 1
        ? Promise.resolve(organizationDetail())
        : Promise.reject(new Error("reload failed"));
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });
  mockApi.patch.mockRejectedValue(
    new ApiError(409, {
      code: "CONFLICT",
      message: "conflict",
      requestId: "request-1",
    }),
  );

  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "조직 사용 중지" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "상태 변경 확인" }));

  expect(
    await screen.findByText(
      "다른 관리 변경이 먼저 반영되었지만 최신 조직 정보를 불러오지 못했습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(
      "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다.",
    ),
  ).not.toBeInTheDocument();
});

it("reports a successful organization mutation whose detail reload fails", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  let detailCalls = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      detailCalls += 1;
      return detailCalls === 1
        ? Promise.resolve(organizationDetail())
        : Promise.reject(new Error("reload failed"));
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });
  mockApi.patch.mockResolvedValue({ ...organizationDetail(), name: "운영팀" });

  render(<App />);
  fireEvent.change(await screen.findByLabelText("조직 이름"), {
    target: { value: "운영팀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));

  expect(
    await screen.findByText(
      "조직 변경은 반영됐지만 최신 조직 정보를 불러오지 못했습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("조직 정보를 변경하지 못했습니다."),
  ).not.toBeInTheDocument();
});

it("prevents duplicate in-flight requests for the same audit cursor", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  const nextPage = deferred<{
    items: Array<{
      id: string;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      occurredAt: string;
    }>;
    nextCursor: null;
  }>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      return Promise.resolve(organizationDetail());
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      return Promise.resolve({
        items: [],
        nextCursor: "cursor-1",
      });
    }
    if (path === "/organizations/org-1/audit?limit=50&cursor=cursor-1") {
      return nextPage.promise;
    }
    return Promise.resolve([]);
  });

  render(<App />);
  const loadMore = await screen.findByRole("button", { name: "이력 더 보기" });
  fireEvent.click(loadMore);
  fireEvent.click(loadMore);
  expect(
    mockApi.get.mock.calls.filter(
      ([path]) =>
        path === "/organizations/org-1/audit?limit=50&cursor=cursor-1",
    ),
  ).toHaveLength(1);

  nextPage.resolve({
    items: [
      {
        id: "audit-2",
        actorUserId: "operator-1",
        action: "ORGANIZATION_MANAGER_ASSIGNED",
        entityType: "USER_ORGANIZATION",
        entityId: "manager-2",
        occurredAt: "2026-07-22T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  });
  expect(await screen.findByText("조직 담당자 지정")).toBeVisible();
  expect(screen.getAllByText("조직 담당자 지정")).toHaveLength(1);
});

it("does not let an old audit request clear a newer lock for the same cursor", async () => {
  window.history.replaceState(null, "", "/organizations/org-1");
  const oldPage = deferred<{
    items: [];
    nextCursor: string | null;
  }>();
  const newPage = deferred<{
    items: [];
    nextCursor: string | null;
  }>();
  let initialAuditReads = 0;
  let paginationReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/organizations/org-1") {
      return Promise.resolve(organizationDetail());
    }
    if (path === "/organizations/org-1/audit?limit=50") {
      initialAuditReads += 1;
      return Promise.resolve({
        items: [],
        nextCursor: "shared-cursor",
      });
    }
    if (path === "/organizations/org-1/audit?limit=50&cursor=shared-cursor") {
      paginationReads += 1;
      return paginationReads === 1 ? oldPage.promise : newPage.promise;
    }
    return Promise.resolve([]);
  });
  mockApi.patch.mockResolvedValue(organizationDetail());

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "이력 더 보기" }));
  await waitFor(() => expect(paginationReads).toBe(1));

  fireEvent.change(screen.getByLabelText("조직 이름"), {
    target: { value: "운영팀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  await waitFor(() => expect(initialAuditReads).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  await waitFor(() => expect(paginationReads).toBe(2));

  await act(async () => {
    oldPage.resolve({ items: [], nextCursor: null });
    await oldPage.promise;
  });
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  expect(paginationReads).toBe(2);
  newPage.resolve({ items: [], nextCursor: null });
});

it("keeps organization administration hidden from managers", async () => {
  authState.role = "ORGANIZATION_MANAGER";
  window.history.replaceState(null, "", "/organizations/org-1");

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "프로젝트" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "조직 관리" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "계정" })).not.toBeInTheDocument();
  expect(mockApi.get).not.toHaveBeenCalledWith("/organizations/org-1");
});

it("routes a project URL to the project roster", async () => {
  window.history.replaceState(null, "", "/projects/project-1");
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      return Promise.resolve({
        id: "project-1",
        name: "상반기 리더십 캠프",
        startDate: null,
        endDate: null,
        status: "IN_PROGRESS",
        revision: 0,
      });
    }
    if (path.endsWith("/summary")) {
      return Promise.resolve({
        projectId: "project-1",
        expectedTotal: 0,
        finalTotal: 0,
        deltaTotal: 0,
        organizations: [],
      });
    }
    if (path.includes("/audit")) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "상반기 리더십 캠프" }),
  ).toBeVisible();
  expect(mockApi.get).toHaveBeenCalledWith("/projects/project-1");
});

function organizationDetail() {
  return {
    id: "org-1",
    name: "1팀",
    isActive: true,
    primaryLeader: { userId: "leader-1", displayName: "대표 조직장" },
    managerCount: 1,
    projectCount: 1,
    managers: [
      {
        userId: "leader-1",
        loginId: "leader-01",
        displayName: "대표 조직장",
        isActive: true,
        assignmentRole: "PRIMARY_LEADER",
        assignedAt: "2026-07-23T00:00:00.000Z",
      },
      {
        userId: "manager-2",
        loginId: "manager-02",
        displayName: "추가 관리자 1",
        isActive: true,
        assignmentRole: "MANAGER",
        assignedAt: "2026-07-23T00:00:00.000Z",
      },
    ],
    projects: [
      {
        projectId: "project-active",
        projectName: "진행 프로젝트",
        projectStatus: "PRE_REGISTRATION",
        membershipIsActive: true,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
