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

it("keeps a duplicate organization name in its creation dialog", async () => {
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
        return Promise.resolve(
          Response.json(
            {
              code: "CONFLICT",
              message: "duplicate",
              requestId: "request-1",
            },
            { status: 409 },
          ),
        );
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
