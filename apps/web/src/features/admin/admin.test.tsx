import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { OrganizationDetailPage } from "./OrganizationDetailPage";
import { OrganizationsPage } from "./OrganizationsPage";
import { UsersPage } from "./UsersPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a generated password once and removes it after close", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/users") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            { id: "user-2", temporaryPassword: "abcdefghjkmnpqrstuvw" },
            { status: 201 },
          ),
        );
      }
      if (url.endsWith("/users")) return Promise.resolve(Response.json([]));
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <UsersPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByLabelText("역할")).toHaveClass(
    "er-control",
    "er-control--select",
  );
  fireEvent.change(await screen.findByLabelText("영문 로그인 ID"), {
    target: { value: "staff-01" },
  });
  fireEvent.change(screen.getByLabelText("표시 이름"), {
    target: { value: "프로젝트 스태프" },
  });
  fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));

  expect(await screen.findByText("abcdefghjkmnpqrstuvw")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("abcdefghjkmnpqrstuvw")).not.toBeInTheDocument();
});

it("creates an account without organization assignment fields", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/users") && init?.method === "POST") {
      return Promise.resolve(
        Response.json(
          { id: "user-2", temporaryPassword: "abcdefghjkmnpqrstuvw" },
          { status: 201 },
        ),
      );
    }
    if (url.endsWith("/users")) return Promise.resolve(Response.json([]));
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <UsersPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("영문 로그인 ID"), {
    target: { value: "staff-01" },
  });
  fireEvent.change(screen.getByLabelText("표시 이름"), {
    target: { value: "프로젝트 스태프" },
  });
  fireEvent.change(screen.getByLabelText("역할"), {
    target: { value: "ORGANIZATION_MANAGER" },
  });
  expect(screen.queryByText("담당 조직")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));

  await screen.findByText("abcdefghjkmnpqrstuvw");
  const createCall = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith("/users") && init?.method === "POST",
  );
  expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
    loginId: "staff-01",
    displayName: "프로젝트 스태프",
    role: "ORGANIZATION_MANAGER",
  });
});

it("updates an existing account role and active state without assignments", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/users/user-2") && init?.method === "PATCH") {
      return Promise.resolve(Response.json({ id: "user-2" }));
    }
    if (url.endsWith("/users")) {
      return Promise.resolve(
        Response.json([
          {
            id: "user-2",
            loginId: "staff-01",
            displayName: "프로젝트 스태프",
            role: "OPERATOR",
            isActive: true,
            organizationIds: [],
          },
        ]),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <UsersPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByLabelText("staff-01 표시 이름")).toHaveClass(
    "er-control",
    "er-control--inline",
  );
  expect(screen.getByLabelText("staff-01 역할")).toHaveClass(
    "er-control",
    "er-control--select",
  );
  expect(screen.getByLabelText("staff-01 활성")).toHaveClass(
    "er-toggle__input",
  );
  fireEvent.change(await screen.findByLabelText("staff-01 역할"), {
    target: { value: "ORGANIZATION_MANAGER" },
  });
  fireEvent.click(screen.getByLabelText("staff-01 활성"));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  await screen.findByText("계정 목록");
  const patchCall = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/users/user-2") && init?.method === "PATCH",
  );
  expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
    displayName: "프로젝트 스태프",
    role: "ORGANIZATION_MANAGER",
    isActive: false,
  });
});

it("searches and filters organization summaries", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.includes("/organizations?")) {
      return Promise.resolve(
        Response.json([
          {
            id: "org-1",
            name: "1팀",
            isActive: true,
            primaryLeader: null,
            managerCount: 2,
            projectCount: 3,
          },
        ]),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(await screen.findByLabelText("조직 이름 검색")).toBeVisible();
  expect(screen.getByLabelText("대표 조직장 상태")).toBeVisible();
  expect(await screen.findByText("대표 조직장 미지정")).toBeVisible();
  expect(screen.getByText("추가 관리자 2명")).toBeVisible();
  expect(screen.getByText("연결 프로젝트 3개")).toBeVisible();
  expect(screen.getByRole("link", { name: "1팀 상세 관리" })).toHaveAttribute(
    "href",
    "/organizations/org-1",
  );

  fireEvent.change(screen.getByLabelText("조직 이름 검색"), {
    target: { value: "운영 팀" },
  });
  fireEvent.change(screen.getByLabelText("조직 상태"), {
    target: { value: "INACTIVE" },
  });
  fireEvent.change(screen.getByLabelText("대표 조직장 상태"), {
    target: { value: "UNASSIGNED" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "조직 검색 및 필터" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/organizations?query=%EC%9A%B4%EC%98%81%20%ED%8C%80&status=INACTIVE&leaderStatus=UNASSIGNED",
      expect.objectContaining({ method: "GET" }),
    ),
  );
});

it("distinguishes organization loading from an empty result", async () => {
  const organizations = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) return organizations.promise;
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(await screen.findByRole("status")).toHaveTextContent(
    "조직 불러오는 중…",
  );
  expect(
    screen.queryByText("조건에 맞는 조직이 없습니다."),
  ).not.toBeInTheDocument();

  organizations.resolve(Response.json([]));
  expect(await screen.findByText("조건에 맞는 조직이 없습니다.")).toBeVisible();
});

it("keeps organization results visible while applying filters", async () => {
  const second = deferred<Response>();
  let organizationReads = 0;
  const summary = {
    id: "org-1",
    name: "1팀",
    isActive: true,
    primaryLeader: null,
    managerCount: 2,
    projectCount: 3,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.includes("/organizations?")) {
      organizationReads += 1;
      return organizationReads === 1
        ? Promise.resolve(Response.json([summary]))
        : second.promise;
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await screen.findByText("1팀");

  fireEvent.submit(screen.getByRole("form", { name: "조직 검색 및 필터" }));
  expect(screen.getByText("1팀")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("검색 중…");
  second.resolve(Response.json([]));
});

it("retries an initial organization list failure without showing empty state", async () => {
  const retry = deferred<Response>();
  let organizationReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) {
        organizationReads += 1;
        return organizationReads === 1
          ? Promise.resolve(new Response(null, { status: 503 }))
          : retry.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(
    await screen.findByText("조직 목록을 불러오지 못했습니다."),
  ).toBeVisible();
  expect(
    screen.queryByText("조건에 맞는 조직이 없습니다."),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(screen.getByRole("button", { name: "다시 시도 중…" })).toBeDisabled();

  retry.resolve(
    Response.json([
      {
        id: "org-retried",
        name: "재시도 조직",
        isActive: true,
        primaryLeader: null,
        managerCount: 0,
        projectCount: 0,
      },
    ]),
  );
  expect(await screen.findByText("재시도 조직")).toBeVisible();
});

it("keeps a duplicate organization name in its creation dialog", async () => {
  const creation = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) {
        return Promise.resolve(Response.json([]));
      }
      if (url.endsWith("/organizations") && init?.method === "POST") {
        return creation.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "새 조직" }));
  const dialog = screen.getByRole("dialog", { name: "새 조직" });
  fireEvent.change(within(dialog).getByLabelText("조직 이름"), {
    target: { value: "중복 조직" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "조직 만들기" }));

  expect(
    within(dialog).getByRole("button", { name: "조직 만드는 중…" }),
  ).toBeDisabled();
  creation.resolve(
    Response.json(
      {
        code: "CONFLICT",
        message: "duplicate",
        requestId: "request-1",
      },
      { status: 409 },
    ),
  );
  expect(
    await within(dialog).findByText("같은 이름의 조직이 이미 있습니다."),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("조직 이름")).toHaveValue("중복 조직");
});

it("keeps the newest organization search when responses arrive out of order", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("query=%EC%B2%AB%EB%B2%88%EC%A7%B8")) {
        return first.promise;
      }
      if (url.includes("query=%EB%91%90%EB%B2%88%EC%A7%B8")) {
        return second.promise;
      }
      if (url.includes("/organizations?")) {
        return Promise.resolve(Response.json([]));
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  const search = await screen.findByLabelText("조직 이름 검색");
  fireEvent.change(search, { target: { value: "첫번째" } });
  fireEvent.submit(screen.getByRole("form", { name: "조직 검색 및 필터" }));
  fireEvent.change(search, { target: { value: "두번째" } });
  fireEvent.submit(screen.getByRole("form", { name: "조직 검색 및 필터" }));

  second.resolve(
    Response.json([
      {
        id: "org-newest",
        name: "두번째 결과",
        isActive: true,
        primaryLeader: null,
        managerCount: 0,
        projectCount: 0,
      },
    ]),
  );
  expect(await screen.findByText("두번째 결과")).toBeVisible();

  first.resolve(
    Response.json([
      {
        id: "org-stale",
        name: "첫번째 결과",
        isActive: true,
        primaryLeader: null,
        managerCount: 0,
        projectCount: 0,
      },
    ]),
  );
  await waitFor(() =>
    expect(screen.queryByText("첫번째 결과")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("두번째 결과")).toBeVisible();
});

it("groups organization creation actions with close first", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) {
        return Promise.resolve(Response.json([]));
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "새 조직" }));
  const dialog = screen.getByRole("dialog", { name: "새 조직" });
  const name = within(dialog).getByLabelText("조직 이름");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  const create = within(dialog).getByRole("button", { name: "조직 만들기" });
  const actions = close.closest(".er-dialog-actions");

  expect(name.closest("form")).toHaveClass("er-dialog-form");
  expect(actions).toContainElement(create);
  expect(
    Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    ),
  ).toEqual(["닫기", "조직 만들기"]);
});

it("retries organization detail without hiding independently loaded audit", async () => {
  const detailRetry = deferred<Response>();
  let detailReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1")) {
        detailReads += 1;
        return detailReads === 1
          ? Promise.resolve(new Response(null, { status: 503 }))
          : detailRetry.promise;
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        return Promise.resolve(
          Response.json({
            items: [auditItem("ORGANIZATION_RENAMED")],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(
    await screen.findByText("조직 정보를 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByText("조직 이름 변경")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(screen.getByRole("button", { name: "다시 시도 중…" })).toBeDisabled();

  detailRetry.resolve(Response.json(organizationDetail()));
  expect(await screen.findByRole("heading", { name: "1팀" })).toBeVisible();
  expect(screen.getByText("조직 이름 변경")).toBeVisible();
});

it("keeps organization detail visible while retrying initial audit", async () => {
  const initialAudit = deferred<Response>();
  let auditReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(Response.json(organizationDetail()));
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        auditReads += 1;
        return auditReads === 1
          ? initialAudit.promise
          : Promise.resolve(
              Response.json({
                items: [auditItem("ORGANIZATION_MANAGER_ASSIGNED")],
                nextCursor: null,
              }),
            );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(await screen.findByRole("heading", { name: "1팀" })).toBeVisible();
  const auditLoadingStatus = screen.getByRole("status");
  expect(auditLoadingStatus).toHaveTextContent("변경 이력 불러오는 중…");
  expect(auditLoadingStatus.closest("[aria-busy=true]")).not.toBeNull();
  expect(screen.queryByText("아직 기록이 없습니다.")).not.toBeInTheDocument();

  initialAudit.resolve(new Response(null, { status: 503 }));
  expect(
    await screen.findByText("변경 이력을 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "1팀" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("조직 담당자 지정")).toBeVisible();
});

it("blocks a captured audit cursor handler across a base refresh", async () => {
  const refreshedAudit = deferred<Response>();
  let baseAuditReads = 0;
  let oldCursorReads = 0;
  let newCursorReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1") && init?.method === "PATCH") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(Response.json(organizationDetail()));
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        baseAuditReads += 1;
        return baseAuditReads === 1
          ? Promise.resolve(
              Response.json({
                items: [auditItem("이전 기준")],
                nextCursor: "old-cursor",
              }),
            )
          : refreshedAudit.promise;
      }
      if (url.endsWith("cursor=old-cursor")) {
        oldCursorReads += 1;
        return Promise.resolve(
          Response.json({
            items: [auditItem("오래된 페이지")],
            nextCursor: null,
          }),
        );
      }
      if (url.endsWith("cursor=new-cursor")) {
        newCursorReads += 1;
        return Promise.resolve(
          Response.json({
            items: [auditItem("새 페이지")],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("이전 기준")).toBeVisible();
  const staleLoadMore = captureReactClickHandler(
    screen.getByRole("button", { name: "이력 더 보기" }),
  );

  fireEvent.change(screen.getByLabelText("조직 이름"), {
    target: { value: "운영팀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  await waitFor(() => expect(baseAuditReads).toBe(2));

  await act(async () => {
    staleLoadMore();
    await Promise.resolve();
  });
  expect(oldCursorReads).toBe(0);
  const existingAuditItem = screen.getByText("이전 기준");
  expect(existingAuditItem.closest("[aria-busy=true]")).not.toBeNull();
  expect(
    screen.queryByRole("button", { name: "이력 더 보기" }),
  ).not.toBeInTheDocument();

  await act(async () => {
    refreshedAudit.resolve(
      Response.json({
        items: [auditItem("새 기준")],
        nextCursor: "new-cursor",
      }),
    );
    await refreshedAudit.promise;
  });
  const newAuditItem = await screen.findByText("새 기준");
  expect(newAuditItem.closest("[aria-busy=false]")).not.toBeNull();
  expect(screen.queryByText("오래된 페이지")).not.toBeInTheDocument();

  await act(async () => {
    staleLoadMore();
    await Promise.resolve();
  });
  expect(oldCursorReads).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(newCursorReads).toBe(1);
  expect(await screen.findByText("새 페이지")).toBeVisible();
});

it("shows pending labels for organization rename and status changes", async () => {
  const rename = deferred<Response>();
  const statusChange = deferred<Response>();
  let patchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1") && init?.method === "PATCH") {
        patchCalls += 1;
        return patchCalls === 1 ? rename.promise : statusChange.promise;
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(Response.json(organizationDetail()));
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("조직 이름"), {
    target: { value: "운영팀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));

  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "1팀" })).toBeVisible();
  rename.resolve(new Response(null, { status: 204 }));
  expect(
    await screen.findByRole("button", { name: "조직 사용 중지" }),
  ).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "조직 사용 중지" }));
  fireEvent.click(screen.getByRole("button", { name: "상태 변경 확인" }));
  expect(screen.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "1팀" })).toBeVisible();
  statusChange.resolve(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "조직 상태 변경" }),
    ).not.toBeInTheDocument(),
  );
});

it("aborts stale candidate searches and only ends the current search loading", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(Response.json(organizationDetail()));
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      }
      if (url.endsWith("query=%EC%B2%AB%EB%B2%88%EC%A7%B8")) {
        return first.promise;
      }
      if (url.endsWith("query=%EB%91%90%EB%B2%88%EC%A7%B8")) {
        return second.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(
    await screen.findByRole("button", { name: "기존 계정 지정" }),
  );
  const search = screen.getByLabelText("계정 검색");
  fireEvent.change(search, { target: { value: "첫번째" } });
  fireEvent.click(screen.getByRole("button", { name: "계정 찾기" }));
  expect(screen.getByRole("button", { name: "계정 찾는 중…" })).toBeDisabled();

  fireEvent.change(search, { target: { value: "두번째" } });
  fireEvent.click(screen.getByRole("button", { name: "계정 찾기" }));
  const searchCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input).includes("assignable-users"));
  expect(searchCalls).toHaveLength(2);
  expect(searchCalls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(searchCalls[1]?.[1]?.signal?.aborted).toBe(false);

  second.resolve(
    Response.json([
      {
        userId: "current-user",
        loginId: "current-01",
        displayName: "현재 후보",
        isActive: true,
      },
    ]),
  );
  expect(
    await screen.findByRole("option", { name: /현재 후보/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "계정 찾기" })).toBeEnabled();

  first.resolve(
    Response.json([
      {
        userId: "stale-user",
        loginId: "stale-01",
        displayName: "오래된 후보",
        isActive: true,
      },
    ]),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: /오래된 후보/ }),
    ).not.toBeInTheDocument(),
  );
});

it("labels each manager mutation with its specific pending action", async () => {
  const assignExisting = deferred<Response>();
  const provision = deferred<Response>();
  const replacePrimary = deferred<Response>();
  const removeManager = deferred<Response>();
  const removePrimary = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(Response.json(organizationDetailWithManagers()));
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      }
      if (url.includes("/assignable-users?")) {
        return Promise.resolve(
          Response.json([
            {
              userId: "candidate-1",
              loginId: "candidate-01",
              displayName: "지정 후보",
              isActive: true,
            },
          ]),
        );
      }
      if (url.endsWith("/organizations/org-1/managers")) {
        const body = JSON.parse(String(init?.body)) as { kind: string };
        return body.kind === "EXISTING"
          ? assignExisting.promise
          : provision.promise;
      }
      if (url.endsWith("/organizations/org-1/primary")) {
        const body = JSON.parse(String(init?.body)) as {
          userId: string | null;
        };
        return body.userId ? replacePrimary.promise : removePrimary.promise;
      }
      if (url.endsWith("/organizations/org-1/managers/manager-2")) {
        return removeManager.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await screen.findByRole("heading", { name: "1팀" });

  fireEvent.click(screen.getByRole("button", { name: "기존 계정 지정" }));
  fireEvent.click(screen.getByRole("button", { name: "계정 찾기" }));
  fireEvent.change(await screen.findByLabelText("지정할 계정"), {
    target: { value: "candidate-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "담당자로 지정" }));
  expect(
    screen.getByRole("button", { name: "담당자로 지정 중…" }),
  ).toBeDisabled();
  assignExisting.resolve(Response.json({ manager: { userId: "candidate-1" } }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "기존 담당자 지정" }),
    ).not.toBeInTheDocument(),
  );

  fireEvent.click(screen.getByRole("button", { name: "새 담당자 발급" }));
  fireEvent.change(screen.getByLabelText("영문 로그인 ID"), {
    target: { value: "new-manager" },
  });
  fireEvent.change(screen.getByLabelText("표시 이름"), {
    target: { value: "새 담당자" },
  });
  fireEvent.click(screen.getByRole("button", { name: "계정 발급 및 지정" }));
  expect(
    screen.getByRole("button", { name: "계정 발급 및 지정 중…" }),
  ).toBeDisabled();
  provision.resolve(Response.json({ manager: { userId: "new-manager" } }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "새 담당자 발급" }),
    ).not.toBeInTheDocument(),
  );

  fireEvent.click(
    screen.getByRole("button", { name: "추가 관리자 대표로 지정" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "대표 변경 확인" }));
  expect(screen.getByRole("button", { name: "대표 변경 중…" })).toBeDisabled();
  replacePrimary.resolve(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "대표 조직장 변경" }),
    ).not.toBeInTheDocument(),
  );

  fireEvent.click(
    screen.getByRole("button", { name: "추가 관리자 담당 해제" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "담당 해제 확인" }));
  expect(screen.getByRole("button", { name: "담당 해제 중…" })).toBeDisabled();
  removeManager.resolve(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "담당자 해제" }),
    ).not.toBeInTheDocument(),
  );

  fireEvent.click(screen.getByRole("button", { name: "대표 지정 해제" }));
  fireEvent.click(screen.getByRole("button", { name: "대표 해제 확인" }));
  expect(screen.getByRole("button", { name: "대표 해제 중…" })).toBeDisabled();
  removePrimary.resolve(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "대표 지정 해제" }),
    ).not.toBeInTheDocument(),
  );
});

it("shows organization audit pagination progress without replacing items", async () => {
  const pendingPage = deferred<Response>();
  let paginationReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/organizations/org-1")) {
        return Promise.resolve(
          Response.json({
            id: "org-1",
            name: "1팀",
            isActive: true,
            primaryLeader: null,
            managerCount: 0,
            projectCount: 0,
            managers: [],
            projects: [],
          }),
        );
      }
      if (url.endsWith("/organizations/org-1/audit?limit=50")) {
        return Promise.resolve(
          Response.json({
            items: [auditItem("기존 이력")],
            nextCursor: "next-cursor",
          }),
        );
      }
      if (url.endsWith("cursor=next-cursor")) {
        paginationReads += 1;
        return pendingPage.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("기존 이력")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  const pendingButton = screen.getByRole("button", {
    name: "더 불러오는 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(paginationReads).toBe(1);
  expect(screen.getByText("기존 이력")).toBeVisible();

  await act(async () =>
    pendingPage.resolve(
      Response.json({
        items: [auditItem("추가 이력")],
        nextCursor: null,
      }),
    ),
  );
  expect(await screen.findByText("추가 이력")).toBeVisible();
});

it("retries failed organization audit pagination with the same cursor", async () => {
  const failedPage = deferred<Response>();
  const nextCursorPage = deferred<Response>();
  let cursorOneReads = 0;
  let cursorTwoReads = 0;
  const cursorOnePath = "/organizations/org-1/audit?limit=50&cursor=cursor-one";
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.endsWith("/organizations/org-1")) {
      return Promise.resolve(
        Response.json({
          id: "org-1",
          name: "1팀",
          isActive: true,
          primaryLeader: null,
          managerCount: 0,
          projectCount: 0,
          managers: [],
          projects: [],
        }),
      );
    }
    if (url.endsWith("/organizations/org-1/audit?limit=50")) {
      return Promise.resolve(
        Response.json({
          items: [auditItem("기존 이력")],
          nextCursor: "cursor-one",
        }),
      );
    }
    if (url.endsWith(cursorOnePath)) {
      cursorOneReads += 1;
      if (cursorOneReads === 1) return failedPage.promise;
      return Promise.resolve(
        Response.json({
          items: [auditItem("재시도 이력")],
          nextCursor: "cursor-two",
        }),
      );
    }
    if (url.endsWith("cursor=cursor-two")) {
      cursorTwoReads += 1;
      return nextCursorPage.promise;
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationDetailPage organizationId="org-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("기존 이력")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));

  await act(async () => {
    failedPage.reject(new Error("pagination unavailable"));
    await failedPage.promise.catch(() => undefined);
  });

  expect(
    await screen.findByText("변경 이력을 더 불러오지 못했습니다."),
  ).toBeVisible();
  expect(screen.getByText("기존 이력")).toBeVisible();
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByText("재시도 이력")).toBeVisible();
  expect(screen.getByText("기존 이력")).toBeVisible();
  expect(cursorOneReads).toBe(2);
  expect(
    fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith(cursorOnePath),
    ),
  ).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "이력 더 보기" }));
  expect(cursorTwoReads).toBe(1);
  expect(screen.getByText("기존 이력")).toBeVisible();
  expect(screen.getByText("재시도 이력")).toBeVisible();

  await act(async () =>
    nextCursorPage.resolve(
      Response.json({
        items: [],
        nextCursor: null,
      }),
    ),
  );
});

function Gate({ children }: { children: React.ReactNode }) {
  return useAuth().auth ? children : <LoginPage />;
}

async function login() {
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
}

function auth() {
  return {
    accessToken: "access",
    csrfToken: "csrf",
    session: {
      sessionKind: "FULL",
      user: {
        id: "user-1",
        loginId: "manager-01",
        displayName: "운영자",
        role: "OPERATOR",
        organizationIds: [],
        isBootstrap: false,
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, nextReject) => {
    resolve = next;
    reject = nextReject;
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

function auditItem(action: string) {
  return {
    id: `audit-${action}`,
    actorUserId: "operator-1",
    action,
    entityType: "ORGANIZATION",
    entityId: "org-1",
    occurredAt: "2026-07-22T00:00:00.000Z",
  };
}

function organizationDetail() {
  return {
    id: "org-1",
    name: "1팀",
    isActive: true,
    primaryLeader: null,
    managerCount: 0,
    projectCount: 0,
    managers: [],
    projects: [],
  };
}

function organizationDetailWithManagers() {
  return {
    ...organizationDetail(),
    primaryLeader: {
      userId: "leader-1",
      loginId: "leader-01",
      displayName: "대표 조직장",
      isActive: true,
      assignmentRole: "PRIMARY_LEADER" as const,
      assignedAt: "2026-07-22T00:00:00.000Z",
    },
    managerCount: 1,
    managers: [
      {
        userId: "leader-1",
        loginId: "leader-01",
        displayName: "대표 조직장",
        isActive: true,
        assignmentRole: "PRIMARY_LEADER" as const,
        assignedAt: "2026-07-22T00:00:00.000Z",
      },
      {
        userId: "manager-2",
        loginId: "manager-02",
        displayName: "추가 관리자",
        isActive: true,
        assignmentRole: "MANAGER" as const,
        assignedAt: "2026-07-22T00:00:00.000Z",
      },
    ],
  };
}
