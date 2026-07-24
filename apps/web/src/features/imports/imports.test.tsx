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
import * as workbookReader from "../../lib/excel/read-workbook";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { ImportWizard } from "./ImportWizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("loads only active project organizations as import targets", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-active",
            name: "활성 조직",
            isActive: true,
            masterIsActive: true,
            activeProjectCount: 1,
            hasHistory: false,
          },
          {
            organizationId: "org-inactive",
            name: "프로젝트 비활성 조직",
            isActive: false,
            masterIsActive: true,
            activeProjectCount: 0,
            hasHistory: true,
          },
          {
            organizationId: "org-master-inactive",
            name: "전역 비활성 조직",
            isActive: true,
            masterIsActive: false,
            activeProjectCount: 0,
            hasHistory: true,
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
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(await screen.findByText("활성 조직 1개")).toBeVisible();
  expect(screen.getByText("활성 조직", { selector: "li" })).toBeVisible();
  expect(screen.queryByText("프로젝트 비활성 조직")).not.toBeInTheDocument();
  expect(screen.queryByText("전역 비활성 조직")).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith("/projects/project-1/organizations"),
    ),
  ).toBe(true);
});

it("shows organization loading without flashing an empty count", async () => {
  let resolveOrganizations: ((response: Response) => void) | undefined;
  const pendingOrganizations = new Promise<Response>((resolve) => {
    resolveOrganizations = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/projects/project-1/organizations")) {
        return pendingOrganizations;
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

  expect(await screen.findByText("프로젝트 조직 불러오는 중…")).toBeVisible();
  expect(screen.queryByText("활성 조직 0개")).not.toBeInTheDocument();

  await act(async () => {
    resolveOrganizations?.(Response.json([]));
    await pendingOrganizations;
  });
  expect(await screen.findByText("활성 조직 0개")).toBeVisible();
});

it("retries only the failed organization region", async () => {
  let organizationReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/projects/project-1/organizations")) {
        organizationReads += 1;
        return organizationReads === 1
          ? Promise.reject(new Error("organizations unavailable"))
          : Promise.resolve(
              Response.json([
                {
                  organizationId: "org-recovered",
                  name: "복구된 조직",
                  isActive: true,
                  masterIsActive: true,
                  activeProjectCount: 1,
                  hasHistory: false,
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
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(
    await screen.findByText("프로젝트 조직을 불러오지 못했습니다."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByText("복구된 조직")).toBeVisible();
  expect(organizationReads).toBe(2);
});

it("ignores organizations loaded for an obsolete project", async () => {
  let resolveProjectOne: ((response: Response) => void) | undefined;
  const projectOneOrganizations = new Promise<Response>((resolve) => {
    resolveProjectOne = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/projects/project-1/organizations")) {
        return projectOneOrganizations;
      }
      if (url.endsWith("/projects/project-2/organizations")) {
        return Promise.resolve(
          Response.json([
            {
              organizationId: "org-current",
              name: "현재 프로젝트 조직",
              isActive: true,
              masterIsActive: true,
              activeProjectCount: 1,
              hasHistory: false,
            },
          ]),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  const view = render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  expect(await screen.findByText("프로젝트 조직 불러오는 중…")).toBeVisible();

  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-2" />
      </Gate>
    </AuthProvider>,
  );
  expect(await screen.findByText("현재 프로젝트 조직")).toBeVisible();

  await act(async () => {
    resolveProjectOne?.(
      Response.json([
        {
          organizationId: "org-obsolete",
          name: "이전 프로젝트 조직",
          isActive: true,
          masterIsActive: true,
          activeProjectCount: 1,
          hasHistory: false,
        },
      ]),
    );
    await projectOneOrganizations;
  });
  expect(screen.queryByText("이전 프로젝트 조직")).not.toBeInTheDocument();
  expect(screen.getByText("현재 프로젝트 조직")).toBeVisible();
});

it("shows file reading progress and locks the file input", async () => {
  let resolveWorkbook:
    | ((workbook: workbookReader.ParsedWorkbook) => void)
    | undefined;
  const pendingWorkbook = new Promise<workbookReader.ParsedWorkbook>(
    (resolve) => {
      resolveWorkbook = resolve;
    },
  );
  vi.spyOn(workbookReader, "readWorkbook").mockReturnValueOnce(pendingWorkbook);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/auth/login")
        ? Promise.resolve(Response.json(auth()))
        : Promise.reject(new Error("organizations unavailable")),
    ),
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
    target: { files: [new File(["workbook"], "roster.xlsx")] },
  });

  const fileLoadingStatus = await screen.findByText("파일 읽는 중…");
  expect(fileLoadingStatus).toBeVisible();
  expect(fileLoadingStatus.closest("[aria-busy=true]")).not.toBeNull();
  expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();

  await act(async () => {
    resolveWorkbook?.(parsedWorkbookFixture([{ 이름: "박민수", 조직: "1팀" }]));
    await pendingWorkbook;
  });
  expect(await screen.findByLabelText("시트")).toBeEnabled();
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
  expect(screen.getByRole("button", { name: "검증 중…" })).toBeDisabled();
  expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();
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

  expect(screen.getByRole("button", { name: "가져오는 중…" })).toBeDisabled();
  const validationHeading = screen.getByRole("heading", {
    name: "검증 결과",
  });
  expect(validationHeading).toBeVisible();
  expect(validationHeading.closest("[aria-busy=true]")).not.toBeNull();
  expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();
  expect(screen.getByLabelText("시트")).toBeDisabled();
  expect(screen.getByLabelText("이름 열")).toBeDisabled();
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "명단으로 돌아가기" })).toBeVisible();

  await act(async () => {
    resolveCommit(
      Response.json({ importedCount: 1, projectRevision: 5 }, { status: 201 }),
    );
    await pendingCommit;
  });
  expect(await screen.findByText("1개 행을 확정했습니다.")).toBeVisible();
});

it("discards staged validation and directs to the latest project when validation finds a closed project", async () => {
  let validations = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (
      url.endsWith("/projects/project-1/imports/validate") &&
      init?.method === "POST"
    ) {
      validations += 1;
      return Promise.resolve(
        validations === 1
          ? Response.json({
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
            })
          : projectClosedResponse(),
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
    target: { files: [workbookFixture([{ 이름: "박민수", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  expect(
    await screen.findByRole("heading", { name: "검증 결과" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "서버 검증" }));

  expect(
    await screen.findByText(
      "프로젝트가 종료되어 가져오기를 진행할 수 없습니다. 최신 프로젝트 정보를 확인해 주세요.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "검증 결과" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("엑셀 파일")).toBeEnabled();
  expect(screen.queryByText("처리 중…")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "최신 프로젝트 보기" }),
  ).toHaveAttribute("href", "/projects/project-1");
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/imports/validate") && init?.method === "POST",
    ),
  ).toHaveLength(2);
});

it("discards staged validation without replaying commit when commit finds a closed project", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (
      url.endsWith("/projects/project-1/imports/validate") &&
      init?.method === "POST"
    ) {
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
    if (
      url.endsWith("/projects/project-1/imports/commit") &&
      init?.method === "POST"
    ) {
      return Promise.resolve(projectClosedResponse());
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
    target: { files: [workbookFixture([{ 이름: "박민수", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  fireEvent.click(await screen.findByRole("button", { name: "명단 확정" }));

  expect(
    await screen.findByText(
      "프로젝트가 종료되어 가져오기를 진행할 수 없습니다. 최신 프로젝트 정보를 확인해 주세요.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "검증 결과" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("엑셀 파일")).toBeEnabled();
  expect(screen.queryByText("처리 중…")).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/imports/commit") && init?.method === "POST",
    ),
  ).toHaveLength(1);
});

it("ignores a file parse failure after the project context changes", async () => {
  let rejectParse: ((reason?: unknown) => void) | undefined;
  const parse = new Promise<never>((_resolve, reject) => {
    rejectParse = reject;
  });
  vi.spyOn(workbookReader, "readWorkbook").mockReturnValueOnce(parse);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/auth/login")
        ? Promise.resolve(Response.json(auth()))
        : Promise.reject(new Error("organizations unavailable")),
    ),
  );
  const view = render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [new File(["broken"], "broken.xlsx")] },
  });
  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-2" />
      </Gate>
    </AuthProvider>,
  );

  await act(async () => {
    rejectParse?.(new Error("obsolete parse failed"));
    await parse.catch(() => undefined);
  });
  expect(
    screen.queryByText("엑셀 파일을 읽지 못했습니다."),
  ).not.toBeInTheDocument();
});

it("keeps a current project request locked when an obsolete project request settles", async () => {
  let resolveProjectOne: (response: Response) => void = () => undefined;
  let resolveProjectTwo: (response: Response) => void = () => undefined;
  const projectOneRequest = new Promise<Response>((resolve) => {
    resolveProjectOne = resolve;
  });
  const projectTwoRequest = new Promise<Response>((resolve) => {
    resolveProjectTwo = resolve;
  });
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.endsWith("/projects/project-1/imports/validate")) {
      return projectOneRequest;
    }
    if (url.endsWith("/projects/project-2/imports/validate")) {
      return projectTwoRequest;
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  fireEvent.change(await screen.findByLabelText("엑셀 파일"), {
    target: { files: [workbookFixture([{ 이름: "프로젝트1", 조직: "1팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));

  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ImportWizard projectId="project-2" />
      </Gate>
    </AuthProvider>,
  );
  await vi.waitFor(() =>
    expect(screen.getByLabelText("엑셀 파일")).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("엑셀 파일"), {
    target: { files: [workbookFixture([{ 이름: "프로젝트2", 조직: "2팀" }])] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "서버 검증" }));
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/projects/project-2/imports/validate"),
      ),
    ).toHaveLength(1),
  );

  await act(async () => {
    resolveProjectOne(Response.json({ projectRevision: 1, rows: [] }));
    await projectOneRequest;
  });
  expect(screen.getByText("검증 중…")).toBeVisible();
  expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();
  const validateButton = screen.getByRole("button", { name: "검증 중…" });
  expect(validateButton).toBeDisabled();
  fireEvent.click(validateButton);
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/projects/project-2/imports/validate"),
    ),
  ).toHaveLength(1);

  await act(async () => {
    resolveProjectTwo(
      Response.json({
        projectRevision: 2,
        rows: [
          {
            rowNumber: 2,
            name: "프로젝트2",
            organizationName: "2팀",
            issues: [],
            candidates: [],
          },
        ],
      }),
    );
    await projectTwoRequest;
  });
  expect(await screen.findByText("검증 완료")).toBeVisible();
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
  const { workbook } = parsedWorkbookFixture(rows);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([bytes], "source-roster.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function parsedWorkbookFixture(
  rows: Array<Record<string, string>>,
): workbookReader.ParsedWorkbook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "참가자",
  );
  return { workbook, sheetNames: ["참가자"] };
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

function projectClosedResponse() {
  return Response.json(
    { code: "PROJECT_CLOSED", message: "closed", requestId: "request-closed" },
    { status: 409 },
  );
}
