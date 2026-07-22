import "@testing-library/jest-dom/vitest";
import type { AuthSuccess } from "@event-roster/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthBoundary } from "../../app/router";
import { createApiClient } from "../../lib/api";
import { AuthProvider, useAuth } from "./AuthProvider";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("uses project branding on the login screen", () => {
  render(
    <AuthProvider restoreOnMount={false}>
      <LoginPage />
    </AuthProvider>,
  );

  expect(screen.getByText("PROJECT ROSTER")).toBeVisible();
  const retiredBrand = ["EVENT", "ROSTER"].join(" ");
  expect(screen.queryByText(retiredBrand)).not.toBeInTheDocument();
});

it("keeps access and CSRF tokens only in memory", async () => {
  window.history.replaceState(null, "", "/projects/project-1");
  const auth = authSuccess("MUST_CHANGE_PASSWORD");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(auth, { status: 200 })),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(await screen.findByText("새 비밀번호를 설정하세요.")).toBeVisible();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("does not change a password when the confirmation differs", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (String(input).endsWith("/auth/login")) {
      return Promise.resolve(
        Response.json(authSuccess("MUST_CHANGE_PASSWORD")),
      );
    }
    throw new Error(`unexpected request: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  await submitLogin();
  await screen.findByText("새 비밀번호를 설정하세요.");
  fireEvent.change(screen.getByLabelText("현재 비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.change(screen.getByLabelText(/새 비밀번호.*10자 이상/), {
    target: { value: "new-password-123" },
  });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "different-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

  expect(
    await screen.findByText("새 비밀번호가 일치하지 않습니다."),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("changes a password when the confirmation matches and returns to login", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(
        Response.json(authSuccess("MUST_CHANGE_PASSWORD")),
      );
    }
    if (url.endsWith("/auth/change-password") && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/auth/logout")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  await submitLogin();
  await screen.findByText("새 비밀번호를 설정하세요.");
  fireEvent.change(screen.getByLabelText("현재 비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.change(screen.getByLabelText(/새 비밀번호.*10자 이상/), {
    target: { value: "new-password-123" },
  });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "new-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible(),
  );
  const changePasswordCall = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/auth/change-password") && init?.method === "POST",
  );
  expect(JSON.parse(String(changePasswordCall?.[1]?.body))).toEqual({
    currentPassword: "temporary-password-123",
    newPassword: "new-password-123",
  });
  expect(window.location.pathname).toBe("/login");
});

it("does not recover an account when the confirmation differs", async () => {
  window.history.replaceState(null, "", "/recover");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "operator-01" },
  });
  fireEvent.change(screen.getByLabelText("복구 코드"), {
    target: { value: "recovery-code-123" },
  });
  fireEvent.change(screen.getByLabelText(/새 비밀번호.*10자 이상/), {
    target: { value: "new-password-123" },
  });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "different-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 재설정" }));

  expect(
    await screen.findByText("새 비밀번호가 일치하지 않습니다."),
  ).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("sends the existing recovery request when the confirmation matches", async () => {
  window.history.replaceState(null, "", "/recover");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "operator-01" },
  });
  fireEvent.change(screen.getByLabelText("복구 코드"), {
    target: { value: "recovery-code-123" },
  });
  fireEvent.change(screen.getByLabelText(/새 비밀번호.*10자 이상/), {
    target: { value: "new-password-123" },
  });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "new-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 재설정" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible(),
  );
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    loginId: "operator-01",
    recoveryCode: "recovery-code-123",
    newPassword: "new-password-123",
  });
});

it("shows both first-operator credentials and logs out after acknowledgement", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(
        Response.json(authSuccess("FULL", "bootstrap-access", true)),
      );
    }
    if (url.endsWith("/bootstrap/first-operator")) {
      return Promise.resolve(
        Response.json({
          temporaryPassword: "temporary-password-123",
          recoveryCode: "recovery-code-123",
        }),
      );
    }
    if (url.endsWith("/auth/logout")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  await submitLogin();
  expect(
    await screen.findByRole("heading", { name: "첫 운영자 계정 인계" }),
  ).toBeVisible();

  fireEvent.change(screen.getByLabelText("영문 로그인 ID"), {
    target: { value: "operator-01" },
  });
  fireEvent.change(screen.getByLabelText("표시 이름"), {
    target: { value: "첫 운영자" },
  });
  fireEvent.click(screen.getByRole("button", { name: "운영자 계정 만들기" }));

  expect(await screen.findByText("temporary-password-123")).toBeVisible();
  expect(screen.getByText("recovery-code-123")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "기록했고 로그아웃" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible(),
  );
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/logout")),
  ).toBe(true);
});

it("does not retry a temporarily unavailable login", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { code: "AUTH_TEMPORARILY_UNAVAILABLE", message: "unavailable" },
        { status: 503 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );

  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(
    await screen.findByText("잠시 후 다시 로그인해 주세요."),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("rejects passwords over 72 UTF-8 bytes before a network request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "가".repeat(25) },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(
    await screen.findByText("비밀번호는 UTF-8 기준 72바이트 이하여야 합니다."),
  ).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("attempts the startup refresh exactly once", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider>
      <AuthBoundary />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("shares one refresh across concurrent 401 retries", async () => {
  let auth: AuthSuccess | null = authSuccess("FULL");
  const refreshed = authSuccess("FULL", "new-access");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json(refreshed))
    .mockResolvedValueOnce(Response.json({ ok: 1 }))
    .mockResolvedValueOnce(Response.json({ ok: 2 }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    getAuth: () => auth,
    refresh: async () => {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      auth = (await response.json()) as AuthSuccess;
      return auth;
    },
  });

  await Promise.all([client.get("/one"), client.get("/two")]);

  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/auth/refresh"),
    ),
  ).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("does not retry a failed mutation on a 5xx response", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { code: "INTERNAL_ERROR", message: "failed", requestId: "request-1" },
        { status: 500 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    getAuth: () => authSuccess("FULL"),
    refresh: async () => authSuccess("FULL", "new-access"),
  });

  await expect(client.post("/mutation", { value: 1 })).rejects.toMatchObject({
    status: 500,
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("clears memory auth even when logout fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(authSuccess("FULL")))
      .mockRejectedValueOnce(new Error("offline")),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(
    await screen.findByRole("heading", { name: "프로젝트" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible(),
  );
});

it("uses cookie-only logout even when the access token may be expired", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(authSuccess("FULL")))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );
  await submitLogin();
  expect(
    await screen.findByRole("heading", { name: "프로젝트" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();

  const logoutInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
  const headers = new Headers(logoutInit.headers);
  expect(headers.has("Authorization")).toBe(false);
  expect(headers.has("X-ER-CSRF")).toBe(false);
  expect(logoutInit.credentials).toBe("include");
});

it("does not restore auth or retry an old mutation after logout during refresh", async () => {
  let resolveRefresh: ((response: Response) => void) | undefined;
  const refreshResponse = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(authSuccess("FULL", "old-access")));
    }
    if (url.endsWith("/protected-mutation")) {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    if (url.endsWith("/auth/refresh")) return refreshResponse;
    if (url.endsWith("/auth/logout")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <RaceHarness />
    </AuthProvider>,
  );
  await submitLogin();
  fireEvent.click(await screen.findByRole("button", { name: "변경 요청" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/auth/refresh"),
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  resolveRefresh?.(Response.json(authSuccess("FULL", "late-access")));

  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/protected-mutation"),
    ),
  ).toHaveLength(1);
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/logout"),
    ),
  ).toHaveLength(1);
});

function authSuccess(
  sessionKind: "FULL" | "MUST_CHANGE_PASSWORD",
  accessToken = "access-token",
  isBootstrap = false,
): AuthSuccess {
  return {
    accessToken,
    csrfToken: "csrf-token",
    session: {
      sessionKind,
      user: {
        id: "user-1",
        loginId: "manager-01",
        displayName: "운영자",
        role: "OPERATOR",
        organizationIds: [],
        isBootstrap,
      },
    },
  };
}

function RaceHarness() {
  const { api, auth, logout, status } = useAuth();
  if (status === "RESTORING") return <p>처리 중</p>;
  if (!auth) return <LoginPage />;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void api.post("/protected-mutation", {}).catch(() => undefined);
        }}
      >
        변경 요청
      </button>
      <button type="button" onClick={() => void logout()}>
        로그아웃
      </button>
    </>
  );
}

async function submitLogin() {
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
}
