import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { RosterPage } from "./RosterPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("updates expected and actual totals after a day-of cancellation", async () => {
  let summaryReads = 0;
  let rosterReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/events"))
        return Promise.resolve(Response.json([event()]));
      if (url.endsWith("/summary")) {
        summaryReads += 1;
        return Promise.resolve(
          Response.json(summary(summaryReads === 1 ? 100 : 99)),
        );
      }
      if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
        rosterReads += 1;
        return Promise.resolve(
          Response.json([entry(rosterReads === 1 ? "ACTIVE" : "CANCELLED")]),
        );
      }
      if (url.endsWith("/participants"))
        return Promise.resolve(Response.json([]));
      if (url.endsWith("/organizations"))
        return Promise.resolve(
          Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
        );
      if (url.includes("/audit-logs"))
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      if (url.endsWith("/roster/entry-1") && init?.method === "PATCH") {
        return Promise.resolve(
          Response.json({
            ...entry("CANCELLED"),
            revision: 1,
            eventRevision: 3,
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <RosterPage eventId="event-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("예상 100명")).toBeVisible();
  expect(screen.getByText("실제 100명")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "박민수 취소" }));
  expect(await screen.findByText("실제 99명")).toBeVisible();
  expect(screen.getByText("예상 100명")).toBeVisible();
});

it("reloads a stale roster without replaying the mutation", async () => {
  let rosterReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.endsWith("/events")) {
      return Promise.resolve(Response.json([{ ...event(), revision: 3 }]));
    }
    if (url.endsWith("/summary")) {
      return Promise.resolve(Response.json(summary(99)));
    }
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      rosterReads += 1;
      return Promise.resolve(
        Response.json([entry(rosterReads === 1 ? "ACTIVE" : "CANCELLED")]),
      );
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit-logs")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    if (url.endsWith("/roster/entry-1") && init?.method === "PATCH") {
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
        <RosterPage eventId="event-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "박민수 취소" }));
  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/roster/entry-1") && init?.method === "PATCH",
    ),
  ).toHaveLength(1);
});

it("reuses a participant when creating succeeds but roster insertion is stale", async () => {
  let rosterWrites = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/events"))
      return Promise.resolve(Response.json([event()]));
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/participants") && init?.method === "POST") {
      return Promise.resolve(
        Response.json(
          {
            id: "person-new",
            participantId: "P-002",
            name: "김신규",
            organizationId: "org-1",
            revision: 0,
          },
          { status: 201 },
        ),
      );
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(
        Response.json([
          {
            id: "person-new",
            participantId: "P-002",
            name: "김신규",
            organizationId: "org-1",
            revision: 0,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit-logs")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    if (url.endsWith("/roster") && init?.method === "POST") {
      rosterWrites += 1;
      if (rosterWrites === 1) {
        return Promise.resolve(
          Response.json(
            {
              code: "STALE_REVISION",
              message: "stale",
              requestId: "request-2",
            },
            { status: 409 },
          ),
        );
      }
      return Promise.resolve(
        Response.json({ id: "entry-new" }, { status: 201 }),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <RosterPage eventId="event-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "김신규" },
  });
  fireEvent.click(screen.getByRole("button", { name: "참가자 생성 후 추가" }));

  expect(
    await screen.findByText(
      "참가자는 생성됐지만 명단 반영이 충돌했습니다. 생성된 참가자를 선택해 다시 추가해 주세요.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("참가자")).toHaveValue("person-new");
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await screen.findByText("아직 기록이 없습니다.");
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/participants") && init?.method === "POST",
    ),
  ).toHaveLength(1);
  expect(rosterWrites).toBe(2);
});

it("closes participant editing after a stale revision reload", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/events"))
      return Promise.resolve(Response.json([event()]));
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([entry("ACTIVE")]));
    }
    if (url.endsWith("/participants/person-1") && init?.method === "PATCH") {
      return Promise.resolve(
        Response.json(
          {
            code: "STALE_REVISION",
            message: "stale",
            requestId: "request-participant",
          },
          { status: 409 },
        ),
      );
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(
        Response.json([
          {
            id: "person-1",
            participantId: "P-001",
            name: "박민수",
            organizationId: "org-1",
            revision: 1,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit-logs")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <RosterPage eventId="event-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "정보 수정" }));
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "박민수 수정" },
  });
  fireEvent.click(screen.getByRole("button", { name: "정보 저장" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "참가자 정보 수정" }),
  ).not.toBeInTheDocument();
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

function event() {
  return {
    id: "event-1",
    year: 2029,
    half: "H1",
    name: "상반기 행사",
    status: "DAY_OF",
    revision: 2,
  };
}

function entry(status: "ACTIVE" | "CANCELLED") {
  return {
    id: "entry-1",
    eventId: "event-1",
    participantId: "person-1",
    participantNumber: "P-001",
    organizationId: "org-1",
    participantName: "박민수",
    organizationName: "1팀",
    source: "PRE_EVENT",
    status,
    wasExpectedAtDayOf: true,
    revision: 0,
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function summary(final: number) {
  return {
    eventId: "event-1",
    expectedTotal: 100,
    finalTotal: final,
    deltaTotal: final - 100,
    organizations: [
      {
        organizationId: "org-1",
        organizationName: "1팀",
        expected: 100,
        dayOfAdded: 0,
        dayOfCancelled: 100 - final,
        final,
        delta: final - 100,
      },
    ],
  };
}
