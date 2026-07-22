import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock("../features/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    api: mockApi,
    auth: {
      session: {
        user: { displayName: "운영자", role: "OPERATOR", isBootstrap: false },
      },
    },
    status: "AUTHENTICATED",
    logout: vi.fn(),
  }),
}));

beforeEach(() => {
  mockApi.get.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("renders project-centered navigation for operators", async () => {
  render(<App />);

  expect(await screen.findByRole("link", { name: "프로젝트" })).toHaveAttribute(
    "href",
    "/projects",
  );
  expect(screen.getByRole("link", { name: "계정" })).toHaveAttribute(
    "href",
    "/users",
  );
  expect(screen.queryByRole("link", { name: "조직" })).not.toBeInTheDocument();
  expect(screen.queryByText("행사 참가자 명단")).not.toBeInTheDocument();
});

it("routes a project URL to the project roster", async () => {
  window.history.replaceState(null, "", "/projects/project-1");
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1") {
      return Promise.resolve({
        id: "project-1",
        name: "상반기 리더십 캠프",
        startDate: null,
        endDate: null,
        status: "IN_PROGRESS",
        revision: 0,
      });
    }
    if (path.endsWith("/summary")) {
      return Promise.resolve({
        projectId: "project-1",
        expectedTotal: 0,
        finalTotal: 0,
        deltaTotal: 0,
        organizations: [],
      });
    }
    if (path.includes("/audit")) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve([]);
  });

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "상반기 리더십 캠프" }),
  ).toBeVisible();
  expect(mockApi.get).toHaveBeenCalledWith("/projects/project-1");
});
