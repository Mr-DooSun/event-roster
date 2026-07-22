import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
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
      if (url.endsWith("/organizations")) {
        return Promise.resolve(
          Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
        );
      }
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

it("updates an existing account role, organizations, and active state", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
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
  fireEvent.click(screen.getByLabelText("1팀"));
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
    organizationIds: ["org-1"],
  });
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
