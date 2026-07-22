import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { ImportWizard } from "./ImportWizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("sends normalized rows without uploading the source workbook", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1/imports/validate")) {
      return Promise.resolve(
        Response.json({
          projectRevision: 4,
          rows: [
            {
              rowNumber: 2,
              name: "박민수",
              organizationName: "1팀",
              issues: [],
              candidates: [],
            },
          ],
        }),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  const file = workbookFixture([{ 이름: "박민수", 조직: "1팀" }]);
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [file] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));

  expect(await screen.findByText("검증 완료")).toBeVisible();
  const validateCall = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/projects/project-1/imports/validate"),
  );
  expect(JSON.parse(String(validateCall?.[1]?.body))).toEqual([
    { rowNumber: 2, name: "박민수", organizationName: "1팀" },
  ]);
  expect(String(validateCall?.[1]?.body)).not.toContain(file.name);
});

it("revalidates an ambiguous participant selection before atomic commit", async () => {
  let validationReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1/imports/validate")) {
      validationReads += 1;
      return Promise.resolve(
        Response.json({
          projectRevision: 4,
          rows: [
            {
              rowNumber: 2,
              name: "동명이인",
              organizationName: "1팀",
              issues: validationReads === 1 ? ["AMBIGUOUS_PARTICIPANT"] : [],
              candidates: [
                {
                  participantId: "person-1",
                  participantNumber: "P-001",
                  name: "동명이인",
                },
                {
                  participantId: "person-2",
                  participantNumber: "P-002",
                  name: "동명이인",
                },
              ],
            },
          ],
        }),
      );
    }
    if (url.endsWith("/projects/project-1/imports/commit")) {
      return Promise.resolve(
        Response.json(
          { importedCount: 1, projectRevision: 5 },
          { status: 201 },
        ),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [workbookFixture([{ 이름: "동명이인", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  fireEvent.change(await screen.findByLabelText("2행 동명이인 선택"), {
    target: { value: "person-2" },
  });
  expect(screen.getByRole("button", { name: "명단 확정" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
  expect(
    await screen.findByRole("button", { name: "명단 확정" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "명단 확정" }));

  expect(await screen.findByText("1개 행을 확정했습니다.")).toBeVisible();
  const commitCall = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/projects/project-1/imports/commit"),
  );
  expect(JSON.parse(String(commitCall?.[1]?.body))).toEqual({
    rows: [
      {
        rowNumber: 2,
        name: "동명이인",
        organizationName: "1팀",
        resolvedParticipantId: "person-2",
      },
    ],
    expectedProjectRevision: 4,
  });
  expect(screen.queryByLabelText("시트")).not.toBeInTheDocument();
});

it("ignores a validation response from an obsolete column mapping", async () => {
  let resolveValidation: (response: Response) => void = () => undefined;
  const pendingValidation = new Promise<Response>((resolve) => {
    resolveValidation = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/projects/project-1/imports/validate")) {
        return pendingValidation;
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [workbookFixture([{ 이름: "박민수", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  fireEvent.change(screen.getByLabelText("조직 열"), {
    target: { value: "이름" },
  });
  await act(async () => {
    resolveValidation(
      Response.json({
        projectRevision: 4,
        rows: [
          {
            rowNumber: 2,
            name: "박민수",
            organizationName: "1팀",
            issues: [],
            candidates: [],
          },
        ],
      }),
    );
    await pendingValidation;
  });

  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "서버 검증" })).toBeEnabled(),
  );
  expect(screen.queryByText("검증 완료")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "검증 결과" }),
  ).not.toBeInTheDocument();
});

it("locks workflow controls until an atomic commit response arrives", async () => {
  let resolveCommit: (response: Response) => void = () => undefined;
  const pendingCommit = new Promise<Response>((resolve) => {
    resolveCommit = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/projects/project-1/imports/validate")) {
        return Promise.resolve(
          Response.json({
            projectRevision: 4,
            rows: [
              {
                rowNumber: 2,
                name: "박민수",
                organizationName: "1팀",
                issues: [],
                candidates: [],
              },
            ],
          }),
        );
      }
      if (url.endsWith("/projects/project-1/imports/commit"))
        return pendingCommit;
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [workbookFixture([{ 이름: "박민수", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  fireEvent.click(await screen.findByRole("button", { name: "명단 확정" }));

  expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();
  expect(screen.getByLabelText("시트")).toBeDisabled();
  expect(screen.getByLabelText("이름 열")).toBeDisabled();
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "명단으로 돌아가기" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("처리 중…")).toHaveAttribute("aria-disabled", "true");

  await act(async () => {
    resolveCommit(
      Response.json({ importedCount: 1, projectRevision: 5 }, { status: 201 }),
    );
    await pendingCommit;
  });
  expect(await screen.findByText("1개 행을 확정했습니다.")).toBeVisible();
});

function Gate({ children }: { children: React.ReactNode }) {
  return useAuth().auth ? children : <LoginPage />;
}

async function login() {
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "operator-01" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "temporary-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
}

function workbookFixture(rows: Array<Record<string, string>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "참가자",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([bytes], "source-roster.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function auth() {
  return {
    accessToken: "access",
    csrfToken: "csrf",
    session: {
      sessionKind: "FULL",
      user: {
        id: "operator",
        loginId: "operator-01",
        displayName: "운영자",
        role: "OPERATOR",
        organizationIds: [],
        isBootstrap: false,
      },
    },
  };
}
