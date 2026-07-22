import { readFileSync } from "node:fs";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthBoundary } from "../../app/router";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { EventsPage } from "./EventsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("preserves native field select styling outside account controls", () => {
  const styles = readFileSync("src/styles/global.css", "utf8");
  const fieldSelectRule = styles.match(/\.er-field select\s*\{([^}]*)\}/)?.[1];

  expect(fieldSelectRule).toBe(
    `
  min-height: 2.75rem;
  border: 1px solid var(--er-color-border);
  border-radius: var(--er-radius-sm);
  padding: 0.625rem;
  background: var(--er-color-surface);
`,
  );
  expect(fieldSelectRule).not.toContain("appearance");
  expect(styles).not.toContain(".er-field select:focus");
});

it("does not render account controls for a manager opening the URL directly", async () => {
  window.history.replaceState(null, "", "/users");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(managerAuth()));
      }
      if (url.endsWith("/events")) return Promise.resolve(Response.json([]));
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <AuthBoundary />
    </AuthProvider>,
  );
  await login();
  expect(
    await screen.findByRole("heading", { name: "행사 관리" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "계정 관리" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "계정" })).not.toBeInTheDocument();
});

it("hides event creation and transitions from organization managers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(managerAuth()));
      if (url.endsWith("/events")) {
        return Promise.resolve(
          Response.json([
            {
              id: "event-1",
              year: 2029,
              half: "H1",
              name: "상반기 행사",
              status: "PRE_REGISTRATION",
              revision: 1,
            },
          ]),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <EventsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("상반기 행사")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "행사 만들기" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "당일 운영 시작" }),
  ).not.toBeInTheDocument();
});

it("closes a stale transition dialog and reloads without replaying", async () => {
  let eventReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(operatorAuth()));
    }
    if (url.endsWith("/events") && (!init?.method || init.method === "GET")) {
      eventReads += 1;
      return Promise.resolve(
        Response.json([
          {
            id: "event-1",
            year: 2029,
            half: "H1",
            name: "상반기 행사",
            status: eventReads === 1 ? "PRE_REGISTRATION" : "DAY_OF",
            revision: eventReads === 1 ? 1 : 2,
          },
        ]),
      );
    }
    if (url.endsWith("/events/event-1/transition") && init?.method === "POST") {
      return Promise.resolve(
        Response.json(
          {
            code: "STALE_REVISION",
            message: "stale",
            requestId: "request-1",
          },
          { status: 409 },
        ),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <EventsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(
    await screen.findByRole("button", { name: "당일 운영 시작" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 행사 목록을 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "행사 상태 변경" }),
  ).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/events/event-1/transition") &&
        init?.method === "POST",
    ),
  ).toHaveLength(1);
});

it("renames an event using its current revision", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(operatorAuth()));
    if (url.endsWith("/events/event-1") && init?.method === "PATCH") {
      return Promise.resolve(Response.json({ id: "event-1", revision: 2 }));
    }
    if (url.endsWith("/events")) {
      return Promise.resolve(
        Response.json([
          {
            id: "event-1",
            year: 2029,
            half: "H1",
            name: "상반기 행사",
            status: "DRAFT",
            revision: 1,
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
        <EventsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("상반기 행사 행사 이름"), {
    target: { value: "2029 상반기 정기 행사" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));

  await screen.findByText("행사 관리");
  const patchCall = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/events/event-1") && init?.method === "PATCH",
  );
  expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
    name: "2029 상반기 정기 행사",
    expectedRevision: 1,
  });
});

it("replaces a stale event name draft with the latest server value", async () => {
  let eventReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(operatorAuth()));
    }
    if (url.endsWith("/events/event-1") && init?.method === "PATCH") {
      return Promise.resolve(
        Response.json(
          {
            code: "STALE_REVISION",
            message: "stale",
            requestId: "request-name",
          },
          { status: 409 },
        ),
      );
    }
    if (url.endsWith("/events")) {
      eventReads += 1;
      return Promise.resolve(
        Response.json([
          {
            id: "event-1",
            year: 2029,
            half: "H1",
            name: eventReads === 1 ? "상반기 행사" : "서버 최신 행사명",
            status: "DRAFT",
            revision: eventReads === 1 ? 1 : 2,
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
        <EventsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("상반기 행사 행사 이름"), {
    target: { value: "충돌한 사용자 입력" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));

  expect(
    await screen.findByLabelText("서버 최신 행사명 행사 이름"),
  ).toHaveValue("서버 최신 행사명");
});

function Gate({ children }: { children: React.ReactNode }) {
  return useAuth().auth ? children : <LoginPage />;
}

async function login() {
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "manager-02" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "manager-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
}

function managerAuth() {
  return {
    accessToken: "access",
    csrfToken: "csrf",
    session: {
      sessionKind: "FULL",
      user: {
        id: "manager",
        loginId: "manager-02",
        displayName: "1팀 담당자",
        role: "ORGANIZATION_MANAGER",
        organizationIds: ["org-1"],
        isBootstrap: false,
      },
    },
  };
}

function operatorAuth() {
  return {
    ...managerAuth(),
    session: {
      ...managerAuth().session,
      user: {
        ...managerAuth().session.user,
        role: "OPERATOR",
        organizationIds: [],
      },
    },
  };
}
