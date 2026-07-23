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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { ProjectsPage } from "./ProjectsPage";

const { mockApi, mockRole } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  mockRole: {
    current: "OPERATOR" as "OPERATOR" | "ORGANIZATION_MANAGER",
  },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: mockRole.current } } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.current = "OPERATOR";
});

afterEach(cleanup);

const projectFixture = {
  id: "project-1",
  name: "상반기 리더십 캠프",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  status: "PRE_REGISTRATION" as const,
  revision: 0,
  createdAt: "2026-02-10T00:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-02-10T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
  closeReason: null,
};

it("renders the minimal B-style project card fields", async () => {
  mockApi.get.mockResolvedValueOnce([
    projectFixture,
    {
      ...projectFixture,
      id: "project-2",
      name: "일정 미정 프로젝트",
      startDate: null,
      endDate: null,
      status: "PREPARING",
      createdAt: "2026-07-18T00:00:00.000Z",
    },
  ]);
  render(<ProjectsPage />);

  expect(await screen.findByText("상반기 리더십 캠프")).toBeVisible();
  expect(screen.getByText("사전 등록")).toBeVisible();
  expect(screen.getByText("시작 2026.05.22")).toBeVisible();
  expect(screen.getByText("종료 2026.05.23")).toBeVisible();
  expect(screen.getByText("시작 미정")).toBeVisible();
  expect(screen.getByText("종료 수동")).toBeVisible();
  expect(screen.getByText("생성 2026.02.10")).toBeVisible();
  expect(screen.queryByText(/예상 .*명/)).not.toBeInTheDocument();
});

it("keeps the project order returned by the server", async () => {
  mockApi.get.mockResolvedValueOnce([
    { ...projectFixture, id: "project-older", name: "서버 첫 번째" },
    {
      ...projectFixture,
      id: "project-newer",
      name: "서버 두 번째",
      createdAt: "2026-07-20T00:00:00.000Z",
    },
  ]);
  render(<ProjectsPage />);

  const cards = await screen.findAllByRole("link");
  expect(cards.map((card) => card.textContent)).toEqual([
    expect.stringContaining("서버 첫 번째"),
    expect.stringContaining("서버 두 번째"),
  ]);
});

it("submits project dates and blocks a reversed range", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ProjectFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "새 프로젝트" },
  });
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-05-24" },
  });
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-05-23" },
  });
  expect(
    screen.getByRole("button", { name: "프로젝트 만들기" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-05-25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      name: "새 프로젝트",
      startDate: "2026-05-24",
      endDate: "2026-05-25",
    }),
  );
});

it("groups project fields and actions into the dialog layout", () => {
  render(<ProjectFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "새 프로젝트" });
  const name = within(dialog).getByLabelText("프로젝트 이름");
  const startDate = within(dialog).getByLabelText("시작일");
  const endDate = within(dialog).getByLabelText("종료일");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  const submit = within(dialog).getByRole("button", {
    name: "프로젝트 만들기",
  });
  const form = name.closest("form");
  const dates = startDate.closest(".er-dialog-form__dates");
  const actions = close.closest(".er-dialog-actions");

  expect(form).toHaveClass("er-dialog-form");
  expect(dates).not.toBeNull();
  expect(dates).toContainElement(startDate);
  expect(dates).toContainElement(endDate);
  expect(actions).not.toBeNull();
  expect(actions).toContainElement(submit);
  expect(
    Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    ),
  ).toEqual(["닫기", "프로젝트 만들기"]);
});

it("omits empty dates when creating a project", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ProjectFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "날짜 없는 프로젝트" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ name: "날짜 없는 프로젝트" }),
  );
});

it("clears project form values after closing and reopening", async () => {
  const props = { onClose: vi.fn(), onSubmit: vi.fn() };
  const { rerender } = render(<ProjectFormDialog open {...props} />);
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "작성 중 프로젝트" },
  });
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-05-24" },
  });

  rerender(<ProjectFormDialog open={false} {...props} />);
  rerender(<ProjectFormDialog open {...props} />);

  expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("");
  expect(screen.getByLabelText("시작일")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "프로젝트 만들기" }),
  ).toBeDisabled();
});

it("shows the create button only to operators", async () => {
  mockRole.current = "ORGANIZATION_MANAGER";
  mockApi.get.mockResolvedValueOnce([]);
  render(<ProjectsPage />);

  await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith("/projects"));
  expect(
    screen.queryByRole("button", { name: "새 프로젝트" }),
  ).not.toBeInTheDocument();
});

it("creates a project and reloads the server order", async () => {
  mockApi.get.mockResolvedValueOnce([]).mockResolvedValueOnce([projectFixture]);
  mockApi.post.mockResolvedValueOnce(projectFixture);
  render(<ProjectsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "새 프로젝트" }));
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "상반기 리더십 캠프" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

  await waitFor(() =>
    expect(mockApi.post).toHaveBeenCalledWith("/projects", {
      name: "상반기 리더십 캠프",
    }),
  );
  expect(await screen.findByText("상반기 리더십 캠프")).toBeVisible();
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});

it("does not let a stale initial response overwrite the post-create reload", async () => {
  let resolveInitial:
    | ((projects: (typeof projectFixture)[]) => void)
    | undefined;
  const initial = new Promise<(typeof projectFixture)[]>((resolve) => {
    resolveInitial = resolve;
  });
  mockApi.get
    .mockReturnValueOnce(initial)
    .mockResolvedValueOnce([projectFixture]);
  mockApi.post.mockResolvedValueOnce(projectFixture);
  render(<ProjectsPage />);

  fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: projectFixture.name },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
  expect(await screen.findByText(projectFixture.name)).toBeVisible();

  await act(async () => {
    resolveInitial?.([
      { ...projectFixture, id: "stale-project", name: "오래된 응답" },
    ]);
  });

  expect(screen.getByText(projectFixture.name)).toBeVisible();
  expect(screen.queryByText("오래된 응답")).not.toBeInTheDocument();
});

it("does not let a late initial load failure overwrite the current create failure", async () => {
  let rejectInitial: ((reason?: unknown) => void) | undefined;
  const initial = new Promise<(typeof projectFixture)[]>((_resolve, reject) => {
    rejectInitial = reject;
  });
  mockApi.get.mockReturnValueOnce(initial);
  mockApi.post.mockRejectedValueOnce(new Error("create failed"));
  render(<ProjectsPage />);

  fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "실패 프로젝트" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
  expect(
    await screen.findByText("프로젝트를 만들지 못했습니다."),
  ).toBeVisible();

  await act(async () => {
    rejectInitial?.(new Error("late load failed"));
    await initial.catch(() => undefined);
  });
  expect(screen.getByText("프로젝트를 만들지 못했습니다.")).toBeVisible();
  expect(
    screen.queryByText("프로젝트 목록을 불러오지 못했습니다."),
  ).not.toBeInTheDocument();
});

it("links cards to project details", async () => {
  mockApi.get.mockResolvedValueOnce([projectFixture]);
  render(<ProjectsPage />);
  expect(
    await screen.findByRole("link", { name: /상반기 리더십 캠프/ }),
  ).toHaveAttribute("href", "/projects/project-1");
});
