import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the application name", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: "행사 참가자 명단" }),
  ).toBeVisible();
});
