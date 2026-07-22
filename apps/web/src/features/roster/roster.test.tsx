import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { ProjectDetailPage } from "../projects/ProjectDetailPage";
import { ParticipantEditDialog } from "./ParticipantEditDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the current inactive organization while editing an existing participant", () => {
  render(
    <ParticipantEditDialog
      participant={{
        id: "person-1",
        participantId: "P-001",
        name: "박민수",
        organizationId: "org-inactive",
        revision: 1,
      }}
      organizations={[
        { id: "org-inactive", name: "이전 조직", isActive: false },
        { id: "org-active", name: "현재 조직", isActive: true },
      ]}
      allowOrganizationChange
      onSave={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByRole("option", { name: "이전 조직" })).toBeVisible();
  expect(screen.getByLabelText("소속 조직")).toHaveValue("org-inactive");
});

it("updates expected and actual totals after an in-progress cancellation", async () => {
  let summaryReads = 0;
  let rosterReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login"))
        return Promise.resolve(Response.json(auth()));
      if (url.endsWith("/projects/project-1"))
        return Promise.resolve(Response.json(project()));
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
      if (url.endsWith("/projects/project-1/organizations"))
        return Promise.resolve(
          Response.json([
            {
              organizationId: "org-1",
              name: "1팀",
              isActive: true,
              masterIsActive: true,
              activeProjectCount: 1,
              hasHistory: false,
            },
          ]),
        );
      if (url.endsWith("/organizations"))
        return Promise.resolve(
          Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
        );
      if (url.includes("/audit"))
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      if (url.endsWith("/roster/entry-1") && init?.method === "PATCH") {
        return Promise.resolve(
          Response.json({
            ...entry("CANCELLED"),
            revision: 1,
            projectRevision: 3,
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("예상 100명")).toBeVisible();
  expect(screen.getByText("실제 100명")).toBeVisible();
  await openRosterTab();
  fireEvent.click(screen.getByRole("button", { name: "박민수 취소" }));
  fireEvent.click(screen.getByRole("tab", { name: "개요" }));
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
    if (url.endsWith("/projects/project-1")) {
      return Promise.resolve(Response.json({ ...project(), revision: 3 }));
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
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-1",
            name: "1팀",
            isActive: true,
            masterIsActive: true,
            activeProjectCount: 1,
            hasHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit")) {
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
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
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

it("creates and adds a participant with one atomic roster request", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1"))
      return Promise.resolve(Response.json(project()));
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-1",
            name: "1팀",
            isActive: true,
            masterIsActive: true,
            activeProjectCount: 1,
            hasHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    if (url.endsWith("/roster") && init?.method === "POST") {
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
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "김신규" },
  });
  fireEvent.click(screen.getByRole("button", { name: "참가자 생성 후 추가" }));

  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/projects/project-1/roster") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1),
  );
  const rosterWrites = fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/roster") &&
      init?.method === "POST",
  );
  expect(rosterWrites).toHaveLength(1);
  expect(JSON.parse(String(rosterWrites[0]?.[1]?.body))).toEqual({
    newParticipant: { name: "김신규", organizationId: "org-1" },
    expectedRevision: 2,
  });
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("/participants") && init?.method === "POST",
    ),
  ).toBe(false);
});

it("closes participant editing after a stale revision reload", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1"))
      return Promise.resolve(Response.json(project()));
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([entry("ACTIVE")]));
    }
    if (
      url.endsWith("/projects/project-1/participants/person-1") &&
      init?.method === "PATCH"
    ) {
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
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-1",
            name: "1팀",
            isActive: true,
            masterIsActive: true,
            activeProjectCount: 1,
            hasHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
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
  const participantWrite = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/participants/person-1") &&
      init?.method === "PATCH",
  );
  expect(JSON.parse(String(participantWrite?.[1]?.body))).toEqual({
    name: "박민수 수정",
    organizationId: "org-1",
    expectedRevision: 1,
    expectedProjectRevision: 2,
  });
});

it("shows a project-closed message and reloads after a rejected mutation", async () => {
  let projectReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1")) {
      projectReads += 1;
      return Promise.resolve(
        Response.json({
          ...project(),
          status: projectReads === 1 ? "IN_PROGRESS" : "CLOSED",
        }),
      );
    }
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([entry("ACTIVE")]));
    }
    if (url.endsWith("/participants"))
      return Promise.resolve(Response.json([]));
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-1",
            name: "1팀",
            isActive: true,
            masterIsActive: true,
            activeProjectCount: 1,
            hasHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([{ id: "org-1", name: "1팀", isActive: true }]),
      );
    }
    if (url.includes("/audit")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    if (url.endsWith("/roster/entry-1") && init?.method === "PATCH") {
      return Promise.resolve(
        Response.json(
          {
            code: "PROJECT_CLOSED",
            message: "closed",
            requestId: "request-closed",
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
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
  fireEvent.click(await screen.findByRole("button", { name: "박민수 취소" }));

  expect(
    await screen.findByText("프로젝트가 종료되어 변경할 수 없습니다."),
  ).toBeVisible();
  expect(projectReads).toBe(2);
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

async function openRosterTab() {
  fireEvent.click(await screen.findByRole("tab", { name: "참가 명단" }));
  await screen.findByRole("heading", { name: "참가 명단" });
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

function project() {
  return {
    id: "project-1",
    name: "상반기 프로젝트",
    startDate: "2029-05-01",
    endDate: "2029-05-02",
    status: "IN_PROGRESS",
    revision: 2,
    createdAt: "2029-01-01T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2029-01-01T00:00:00.000Z",
    closedAt: null,
    closedBy: null,
    closeReason: null,
  };
}

function entry(status: "ACTIVE" | "CANCELLED") {
  return {
    id: "entry-1",
    projectId: "project-1",
    participantId: "person-1",
    participantNumber: "P-001",
    organizationId: "org-1",
    participantName: "박민수",
    organizationName: "1팀",
    source: "PRE_REGISTRATION",
    status,
    wasExpectedAtStart: true,
    revision: 0,
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function summary(final: number) {
  return {
    projectId: "project-1",
    expectedTotal: 100,
    finalTotal: final,
    deltaTotal: final - 100,
    organizations: [
      {
        organizationId: "org-1",
        organizationName: "1팀",
        expected: 100,
        inProgressAdded: 0,
        inProgressCancelled: 100 - final,
        final,
        delta: final - 100,
      },
    ],
  };
}
