import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  BulkParticipantNameField,
  parseBulkParticipantNames,
} from "./BulkParticipantNameField";

afterEach(cleanup);

it("parses non-empty normalized lines in input order", () => {
  expect(parseBulkParticipantNames("  홍길동  \n\n김\t민수\nＥ２Ｅ")).toEqual([
    "홍길동",
    "김 민수",
    "E2E",
  ]);
});

it("shows the count and numbered preview", () => {
  render(
    <BulkParticipantNameField
      rawValue={"홍길동\n김민수"}
      names={["홍길동", "김민수"]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(screen.getByText("등록 예정 2명 / 최대 30명")).toBeVisible();
  const list = screen.getByRole("list", { name: "등록 예정 참가자" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(within(list).getByText("1. 홍길동")).toBeVisible();
});

it("marks an over-limit list and exposes no silent truncation", () => {
  const names = Array.from({ length: 31 }, (_, index) => `참가자 ${index + 1}`);
  render(
    <BulkParticipantNameField
      rawValue={names.join("\n")}
      names={names}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(screen.getByText("등록 예정 31명 / 최대 30명")).toHaveClass(
    "er-bulk-participant-count--error",
  );
  expect(
    screen.getByRole("list", { name: "등록 예정 참가자" }),
  ).toHaveTextContent("31. 참가자 31");
});

it("renders duplicate kinds and an explicit confirmation checkbox", () => {
  const onConfirm = vi.fn();
  render(
    <BulkParticipantNameField
      rawValue="홍길동"
      names={["홍길동"]}
      duplicates={[
        {
          name: "홍길동",
          kinds: ["INPUT_DUPLICATE", "EXISTING_PARTICIPANT"],
        },
      ]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={onConfirm}
    />,
  );

  expect(screen.getByText(/입력 목록에 같은 이름이 있습니다/)).toBeVisible();
  expect(
    screen.getByText(/이 조직에 같은 이름의 참가자가 있습니다/),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "중복 이름이 있습니다. 내용을 확인한 후 다시 제출하세요.",
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "중복 이름을 확인했습니다",
    }),
  );
  expect(onConfirm).toHaveBeenCalledWith(true);
});

it("marks a name longer than 100 characters as invalid", () => {
  const invalidName = "가".repeat(101);
  render(
    <BulkParticipantNameField
      rawValue={invalidName}
      names={[invalidName]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );

  expect(screen.getByText("이름은 100자 이하여야 합니다.")).toBeVisible();
  expect(screen.getByText(`1. ${invalidName}`)).toHaveClass(
    "er-bulk-participant-invalid",
  );
});
