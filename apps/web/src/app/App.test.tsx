import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "./App";

it("renders the application name", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "행사 참가자 명단" }),
  ).toBeVisible();
});
