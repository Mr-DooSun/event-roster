import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import {
  buildExportWorkbook,
  downloadExportWorkbook,
  projectRosterFilename,
} from "../../lib/excel/download-workbook";
import { ProjectRosterPage } from "../roster/ProjectRosterPage";

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: "OPERATOR" } } },
  }),
}));

const fixture = {
  명단: [
    {
      "고유 ID": "P-001",
      이름: "박민수",
      조직: "1팀",
      구분: "PRE_REGISTRATION",
      상태: "ACTIVE",
      "최종 수정": "2026-07-21T00:00:00.000Z",
    },
  ],
  집계: [
    {
      조직: "1팀",
      예상: 1,
      "진행 중 추가": 0,
      "진행 중 취소": 0,
      최종: 1,
      증감: 0,
    },
  ],
};

it("creates exactly the project summary and participant roster sheets", () => {
  expect(buildExportWorkbook(fixture).SheetNames).toEqual([
    "프로젝트 집계",
    "참가 명단",
  ]);
});

it("writes the project-named workbook only in the browser", () => {
  const writeFile = vi.fn();
  downloadExportWorkbook(fixture, "상반기-프로젝트-명단.xlsx", writeFile);
  expect(writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      SheetNames: ["프로젝트 집계", "참가 명단"],
    }),
    "상반기-프로젝트-명단.xlsx",
  );
});

it("builds a sanitized project roster filename", () => {
  expect(projectRosterFilename("상반기/리더십")).toBe(
    "상반기-리더십-프로젝트-명단.xlsx",
  );
});

it("keeps the roster and filters while an export fails", async () => {
  const pendingExport = deferred<never>();
  mockApi.get.mockReset();
  mockApi.get.mockReturnValue(pendingExport.promise);
  const rows = [
    {
      id: "entry-1",
      projectId: "project-1",
      participantId: "person-1",
      participantNumber: "P-001",
      organizationId: "org-1",
      participantName: "박민수",
      organizationName: "1팀",
      source: "PRE_REGISTRATION" as const,
      status: "ACTIVE" as const,
      wasExpectedAtStart: true,
      revision: 0,
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
  ];
  render(
    createElement(ProjectRosterPage, {
      project: {
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
      },
      rows,
      participants: [],
      organizations: [{ id: "org-1", name: "1팀", isActive: true }],
      canMutate: true,
      onChanged: vi.fn().mockResolvedValue(undefined),
    }),
  );
  fireEvent.change(screen.getByLabelText("명단 검색"), {
    target: { value: "박민수" },
  });

  fireEvent.click(screen.getByRole("button", { name: "엑셀 내보내기" }));

  const pendingButton = screen.getByRole("button", {
    name: "내보내는 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(screen.getByText("박민수")).toBeVisible();
  expect(screen.getByLabelText("명단 검색")).toHaveValue("박민수");

  await act(async () => {
    pendingExport.reject(new Error("export unavailable"));
    await pendingExport.promise.catch(() => undefined);
  });
  expect(screen.getByText("엑셀 명단을 내보내지 못했습니다.")).toBeVisible();
  expect(screen.getByText("박민수")).toBeVisible();
  expect(screen.getByLabelText("명단 검색")).toHaveValue("박민수");
  cleanup();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
