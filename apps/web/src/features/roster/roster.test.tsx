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
import { Suspense, startTransition, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { ProjectDetailPage } from "../projects/ProjectDetailPage";
import {
  type BulkParticipantSubmitOutcome,
  ParticipantDialog,
} from "./ParticipantDialog";
import { ParticipantEditDialog } from "./ParticipantEditDialog";
import { ProjectRosterPage } from "./ProjectRosterPage";
import { RosterTable, type RosterView } from "./RosterTable";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const bulkDialogProps = {
  participants: [
    {
      id: "person-1",
      participantId: "P-001",
      name: "기존 참가자",
      organizationId: "org-1",
      suggestedRole: "STUDENT" as const,
      suggestedGrade: "M1" as const,
      revision: 0,
    },
  ],
  organizations: [{ id: "org-1", name: "1팀", isActive: true }],
  onAdd: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

it("starts new mode empty and submits two structured participant profiles", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({ kind: "SUCCESS" });
  render(
    <ParticipantDialog {...bulkDialogProps} onCreateAndAdd={onCreateAndAdd} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  expect(
    screen.queryByRole("textbox", { name: /번 이름/ }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.change(screen.getByRole("textbox", { name: "1번 이름" }), {
    target: { value: "  홍길동  " },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "1번 학년" }), {
    target: { value: "M2" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "2번 이름" }), {
    target: { value: "김\t민수" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "2번 참가자 구분" }), {
    target: { value: "TEACHER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));

  await waitFor(() =>
    expect(onCreateAndAdd).toHaveBeenCalledWith({
      participants: [
        { name: "홍길동", role: "STUDENT", grade: "M2" },
        { name: "김 민수", role: "TEACHER", grade: null },
      ],
      organizationId: "org-1",
      confirmDuplicateNames: false,
    }),
  );
});

it("keeps all structured rows and profiles after a duplicate response", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({
    kind: "DUPLICATES",
    duplicates: [{ name: "홍길동", kinds: ["INPUT_DUPLICATE"] }],
  });
  render(
    <ParticipantDialog {...bulkDialogProps} onCreateAndAdd={onCreateAndAdd} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.change(screen.getByRole("textbox", { name: "1번 이름" }), {
    target: { value: "홍길동" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "1번 학년" }), {
    target: { value: "H1" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "2번 이름" }), {
    target: { value: "홍길동" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "2번 참가자 구분" }), {
    target: { value: "TEACHER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));

  expect(
    await screen.findByRole("checkbox", {
      name: "중복 이름을 확인했습니다",
    }),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "1번 이름" })).toHaveValue(
    "홍길동",
  );
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toHaveValue("H1");
  expect(screen.getByRole("combobox", { name: "2번 참가자 구분" })).toHaveValue(
    "TEACHER",
  );
  expect(screen.getByRole("combobox", { name: "2번 학년" })).toBeDisabled();
});

it("prefills a valid recent profile suggestion but waits for confirmation", async () => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  render(
    <ParticipantDialog
      {...bulkDialogProps}
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "기존 참가자",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "H2",
          revision: 0,
        },
      ]}
      onAdd={onAdd}
      onCreateAndAdd={vi.fn().mockResolvedValue({ kind: "SUCCESS" })}
    />,
  );

  expect(screen.getByRole("combobox", { name: "참가자 구분" })).toHaveValue(
    "STUDENT",
  );
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("H2");
  expect(onAdd).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));
  await waitFor(() =>
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ role: "STUDENT", grade: "H2" }),
    ),
  );
});

it("uses an unconfirmed student profile for absent legacy suggestions", () => {
  render(
    <ParticipantDialog
      {...bulkDialogProps}
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "기존 참가자",
          organizationId: "org-1",
          suggestedRole: null,
          suggestedGrade: null,
          revision: 0,
        },
      ]}
      onCreateAndAdd={vi.fn().mockResolvedValue({ kind: "SUCCESS" })}
    />,
  );

  expect(screen.getByRole("combobox", { name: "참가자 구분" })).toHaveValue(
    "STUDENT",
  );
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeDisabled();
});

it("edits the selected roster profile and includes it in the save payload", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ParticipantEditDialog
      participant={{
        id: "person-1",
        participantId: "P-001",
        name: "박민수",
        organizationId: "org-1",
        suggestedRole: null,
        suggestedGrade: null,
        revision: 4,
      }}
      roster={{
        ...entry("ACTIVE"),
        role: "STUDENT",
        grade: "M2",
      }}
      organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
      allowOrganizationChange
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByRole("combobox", { name: "참가자 구분" })).toHaveValue(
    "STUDENT",
  );
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("M2");
  fireEvent.change(screen.getByRole("combobox", { name: "학년" }), {
    target: { value: "M3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "정보 저장" }));

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      name: "박민수",
      organizationId: "org-1",
      role: "STUDENT",
      grade: "M3",
      expectedRevision: 4,
    }),
  );
});

it("submits normalized bulk names with one organization", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({ kind: "SUCCESS" });
  render(
    <ParticipantDialog {...bulkDialogProps} onCreateAndAdd={onCreateAndAdd} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("  홍길동  ", "M1");
  addStudentParticipantRow("김\t민수", "H2");
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));

  await waitFor(() =>
    expect(onCreateAndAdd).toHaveBeenCalledWith({
      participants: [
        { name: "홍길동", role: "STUDENT", grade: "M1" },
        { name: "김 민수", role: "STUDENT", grade: "H2" },
      ],
      organizationId: "org-1",
      confirmDuplicateNames: false,
    }),
  );
});

it("prevents a second bulk submit while the first is pending", async () => {
  const pending = deferred<BulkParticipantSubmitOutcome>();
  const onCreateAndAdd = vi.fn(() => pending.promise);
  render(
    <ParticipantDialog {...bulkDialogProps} onCreateAndAdd={onCreateAndAdd} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("홍길동");
  addStudentParticipantRow("김민수");
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "2명 등록 중…" }));

  expect(onCreateAndAdd).toHaveBeenCalledTimes(1);
});

it("requires explicit confirmation after a duplicate response", async () => {
  const onCreateAndAdd = vi
    .fn()
    .mockResolvedValueOnce({
      kind: "DUPLICATES",
      duplicates: [
        {
          name: "홍길동",
          kinds: ["INPUT_DUPLICATE", "EXISTING_PARTICIPANT"],
        },
      ],
    })
    .mockResolvedValueOnce({ kind: "SUCCESS" });
  const onClose = vi.fn();
  render(
    <ParticipantDialog
      {...bulkDialogProps}
      onCreateAndAdd={onCreateAndAdd}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("홍길동", "M2");
  addTeacherParticipantRow("홍길동");
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));

  expect(
    await screen.findAllByText("입력 목록에 같은 이름이 있습니다."),
  ).toHaveLength(2);
  expect(onClose).not.toHaveBeenCalled();
  const submit = screen.getByRole("button", { name: "2명 명단에 추가" });
  expect(submit).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "중복 이름을 확인했습니다" }),
  );
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  await waitFor(() =>
    expect(onCreateAndAdd).toHaveBeenLastCalledWith({
      participants: [
        { name: "홍길동", role: "STUDENT", grade: "M2" },
        { name: "홍길동", role: "TEACHER", grade: null },
      ],
      organizationId: "org-1",
      confirmDuplicateNames: true,
    }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("clears duplicate confirmation when names change", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({
    kind: "DUPLICATES",
    duplicates: [{ name: "홍길동", kinds: ["EXISTING_PARTICIPANT"] }],
  });
  render(
    <ParticipantDialog {...bulkDialogProps} onCreateAndAdd={onCreateAndAdd} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("홍길동");
  const nameField = screen.getByRole("textbox", { name: "1번 이름" });
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await screen.findByRole("checkbox", {
    name: "중복 이름을 확인했습니다",
  });
  fireEvent.change(nameField, { target: { value: "김민수" } });

  expect(
    screen.queryByRole("checkbox", { name: "중복 이름을 확인했습니다" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await waitFor(() =>
    expect(onCreateAndAdd).toHaveBeenLastCalledWith({
      participants: [{ name: "김민수", role: "STUDENT", grade: "M1" }],
      organizationId: "org-1",
      confirmDuplicateNames: false,
    }),
  );
});

it("clears duplicate confirmation when the selected organization becomes inactive", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({
    kind: "DUPLICATES",
    duplicates: [{ name: "홍길동", kinds: ["EXISTING_PARTICIPANT"] }],
  });
  const renderDialog = (orgOneActive: boolean) => (
    <ParticipantDialog
      {...bulkDialogProps}
      organizations={[
        { id: "org-1", name: "1팀", isActive: orgOneActive },
        { id: "org-2", name: "2팀", isActive: true },
      ]}
      onCreateAndAdd={onCreateAndAdd}
    />
  );
  const view = render(renderDialog(true));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("홍길동");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await screen.findByRole("checkbox", {
    name: "중복 이름을 확인했습니다",
  });

  view.rerender(renderDialog(false));

  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "중복 이름을 확인했습니다" }),
    ).not.toBeInTheDocument(),
  );
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
      roster={{ ...entry("ACTIVE"), role: "STUDENT", grade: "M1" }}
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

it("defaults reusable participants from an inactive master organization to an active project organization", () => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-old-inactive",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[{ id: "org-active", name: "활성 조직", isActive: true }]}
      onAdd={onAdd}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));
  expect(onAdd).toHaveBeenCalledWith({
    participantId: "person-1",
    name: "박민수",
    organizationId: "org-active",
    role: "STUDENT",
    grade: "M1",
    expectedParticipantRevision: 3,
  });
});

it("defaults a new participant to the newest valid recent organization", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
        { id: "org-inactive", name: "휴면사", isActive: false },
      ]}
      recentOrganizationIds={["org-2", "org-inactive"]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));

  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "황룡사",
  );
});

it("keeps an existing participant organization while ordering recent options", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      recentOrganizationIds={["org-2"]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  const input = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(input).toHaveValue("성룡사");
  fireEvent.focus(input);
  expect(
    within(screen.getByRole("listbox")).getAllByRole("option")[0],
  ).toHaveTextContent("황룡사");
});

it("records a new participant organization only after POST and reload succeed", async () => {
  const reload = deferred<void>();
  const onChanged = vi.fn(() => reload.promise);
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  renderRosterForRecentOrganizations({
    onChanged,
  });
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/projects/project-1/roster/bulk") &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );
  expect(recentOrganizationValue("user-1", "project-1")).toBeNull();

  await act(async () => {
    reload.resolve(undefined);
    await reload.promise;
  });

  await waitFor(() =>
    expect(recentOrganizationValue("user-1", "project-1")).toEqual(["org-2"]),
  );
});

it("posts bulk names, reloads, and shows a success notice", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  renderRosterForRecentOrganizations({ onChanged });
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.change(screen.getByRole("textbox", { name: "1번 이름" }), {
    target: { value: "홍길동" },
  });
  addStudentParticipantRow("김민수", "H1");
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));

  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  const write = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/roster/bulk") &&
      init?.method === "POST",
  );
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    organizationId: "org-2",
    participants: [
      { name: "홍길동", role: "STUDENT", grade: "M1" },
      { name: "김민수", role: "STUDENT", grade: "H1" },
    ],
    confirmDuplicateNames: false,
    expectedRevision: project().revision,
  });
  expect(
    screen.queryByRole("dialog", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("2명을 명단에 추가했습니다.")).toBeVisible();
  expect(recentOrganizationValue("user-1", "project-1")).toEqual(["org-2"]);
});

it("keeps bulk input open for a structured duplicate conflict", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const fetchMock = rosterAddFetch("user-1", () =>
    Promise.resolve(
      Response.json(
        {
          code: "CONFLICT",
          message: "duplicate names",
          requestId: "request-duplicate",
          details: {
            reason: "DUPLICATE_PARTICIPANT_NAMES",
            duplicates: [{ name: "홍길동", kinds: ["EXISTING_PARTICIPANT"] }],
          },
        },
        { status: 409 },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  renderRosterForRecentOrganizations({ onChanged });
  await login();

  await openNewParticipantForm("성룡사");
  fireEvent.change(screen.getByRole("textbox", { name: "1번 이름" }), {
    target: { value: "홍길동" },
  });
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

  expect(
    await screen.findByText("이 조직에 같은 이름의 참가자가 있습니다."),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "1번 이름" })).toHaveValue(
    "홍길동",
  );
  expect(onChanged).not.toHaveBeenCalled();
  expect(recentOrganizationValue("user-1", "project-1")).toBeNull();
});

it("records the confirmed organization after an existing participant add succeeds", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", rosterAddFetch());
  renderRosterForRecentOrganizations({
    onChanged,
    participants: [
      {
        id: "person-1",
        participantId: "P-001",
        name: "박민수",
        organizationId: "org-2",
        suggestedRole: "STUDENT",
        suggestedGrade: "M1",
        revision: 3,
      },
    ],
  });
  await login();

  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await waitFor(() =>
    expect(recentOrganizationValue("user-1", "project-1")).toEqual(["org-2"]),
  );
});

it("does not mutate raw recent storage when the add modal closes", async () => {
  const storageKey = "event-roster:recent-organizations:v1:user-1:project-1";
  const rawRecentOrganizations = '["org-1","missing"]';
  window.localStorage.setItem(storageKey, rawRecentOrganizations);
  vi.stubGlobal("fetch", rosterAddFetch());
  renderRosterForRecentOrganizations({
    onChanged: vi.fn().mockResolvedValue(undefined),
  });
  await login();

  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  const organization = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.change(organization, { target: { value: "황" } });
  fireEvent.click(screen.getByRole("option", { name: "황룡사" }));
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  expect(
    screen.queryByRole("dialog", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();
  expect(window.localStorage.getItem(storageKey)).toBe(rawRecentOrganizations);
});

it("skips recency side effects when the project changes during reload", async () => {
  window.localStorage.setItem(
    "event-roster:recent-organizations:v1:user-1:project-2",
    JSON.stringify(["org-1"]),
  );
  const reload = deferred<void>();
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  const view = renderRosterForRecentOrganizations({
    onChanged: vi.fn(() => reload.promise),
  });
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await waitForRosterPost(fetchMock);

  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={{ ...project(), id: "project-2" }}
          rows={[]}
          participants={[]}
          organizations={recentTestOrganizations()}
          canMutate
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </Gate>
    </AuthProvider>,
  );

  await act(async () => {
    reload.resolve(undefined);
    await reload.promise;
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "참가자 추가" }),
    ).not.toBeInTheDocument(),
  );
  expect(recentOrganizationValue("user-1", "project-1")).toBeNull();
  expect(recentOrganizationValue("user-1", "project-2")).toEqual(["org-1"]);

  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "성룡사",
  );
});

it("skips recency side effects when the chosen organization becomes inactive during reload", async () => {
  const reload = deferred<void>();
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  const view = renderRosterForRecentOrganizations({
    onChanged: vi.fn(() => reload.promise),
  });
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await waitForRosterPost(fetchMock);

  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={project()}
          rows={[]}
          participants={[]}
          organizations={[
            { id: "org-1", name: "성룡사", isActive: true },
            { id: "org-2", name: "황룡사", isActive: false },
          ]}
          canMutate
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </Gate>
    </AuthProvider>,
  );

  await act(async () => {
    reload.resolve(undefined);
    await reload.promise;
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "참가자 추가" }),
    ).not.toBeInTheDocument(),
  );
  expect(recentOrganizationValue("user-1", "project-1")).toBeNull();
});

it("records recency when a speculative project render is discarded during reload", async () => {
  const reload = deferred<void>();
  const blockedRender = deferred<void>();
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ConcurrentRosterHarness
          blockedRender={blockedRender.promise}
          onChanged={vi.fn(() => reload.promise)}
        />
      </Gate>
    </AuthProvider>,
  );
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));
  await waitForRosterPost(fetchMock);

  fireEvent.click(
    screen.getByRole("button", { name: "프로젝트 전환 렌더 시작" }),
  );

  await act(async () => {
    reload.resolve(undefined);
    await reload.promise;
  });

  await waitFor(() =>
    expect(recentOrganizationValue("user-1", "project-1")).toEqual(["org-2"]),
  );
});

it.each([
  {
    name: "POST rejection",
    post: () => Promise.reject(new Error("network failed")),
    onChanged: () => Promise.resolve(),
  },
  {
    name: "STALE_REVISION",
    post: () =>
      Promise.resolve(
        Response.json(
          {
            code: "STALE_REVISION",
            message: "stale",
            requestId: "request-stale",
          },
          { status: 409 },
        ),
      ),
    onChanged: () => Promise.resolve(),
  },
  {
    name: "PROJECT_CLOSED",
    post: () =>
      Promise.resolve(
        Response.json(
          {
            code: "PROJECT_CLOSED",
            message: "closed",
            requestId: "request-closed",
          },
          { status: 409 },
        ),
      ),
    onChanged: () => Promise.resolve(),
  },
])(
  "does not record a recent organization after $name",
  async ({ post, onChanged }) => {
    const fetchMock = rosterAddFetch("user-1", post);
    vi.stubGlobal("fetch", fetchMock);
    renderRosterForRecentOrganizations({
      onChanged: vi.fn(onChanged),
    });
    await login();

    await openNewParticipantForm("황룡사");
    fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "1명 명단에 추가" }),
      ).toBeEnabled(),
    );
    expect(recentOrganizationValue("user-1", "project-1")).toBeNull();
  },
);

it("closes the dialog without recording recency when reload fails after bulk POST", async () => {
  const fetchMock = rosterAddFetch();
  vi.stubGlobal("fetch", fetchMock);
  renderRosterForRecentOrganizations({
    onChanged: vi.fn().mockRejectedValue(new Error("reload failed")),
  });
  await login();

  await openNewParticipantForm("황룡사");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "참가자 추가" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText(
      "참가자는 등록됐지만 최신 명단을 불러오지 못했습니다. 페이지를 새로고침해 주세요.",
    ),
  ).toBeVisible();
  expect(recentOrganizationValue("user-1", "project-1")).toBeNull();
});

it("isolates recent defaults by project and authenticated user while ignoring invalid IDs", async () => {
  window.localStorage.setItem(
    "event-roster:recent-organizations:v1:user-1:project-1",
    JSON.stringify(["org-inactive", "missing", "org-2"]),
  );
  window.localStorage.setItem(
    "event-roster:recent-organizations:v1:user-1:project-2",
    JSON.stringify(["org-1"]),
  );
  window.localStorage.setItem(
    "event-roster:recent-organizations:v1:user-2:project-1",
    JSON.stringify(["org-1"]),
  );
  vi.stubGlobal("fetch", rosterAddFetch());
  const view = renderRosterForRecentOrganizations({
    onChanged: vi.fn().mockResolvedValue(undefined),
  });
  await login();

  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "황룡사",
  );
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  view.rerender(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={{ ...project(), id: "project-2" }}
          rows={[]}
          participants={[]}
          organizations={recentTestOrganizations()}
          canMutate
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </Gate>
    </AuthProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
      "성룡사",
    ),
  );

  cleanup();
  vi.stubGlobal("fetch", rosterAddFetch("user-2"));
  renderRosterForRecentOrganizations({
    onChanged: vi.fn().mockResolvedValue(undefined),
  });
  await login();
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "성룡사",
  );
});

it("groups participant fields and actions with visible spacing hooks", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "참가자 추가" });
  expect(dialog).toHaveClass("er-dialog--roster");
  expect(
    screen.getByRole("button", { name: "기존 참가자" }).parentElement,
  ).toHaveClass("er-participant-mode-actions");
  expect(screen.getByLabelText("참가자").closest("form")).toHaveClass(
    "er-dialog-form",
  );
  expect(
    within(dialog).getByRole("button", { name: "닫기" }).parentElement,
  ).toHaveClass("er-dialog-actions");
  expect(
    within(dialog).getByRole("button", { name: "명단에 추가" }).parentElement,
  ).toHaveClass("er-dialog-actions");
  expect(within(dialog).getByRole("combobox", { name: "학년" })).toBeRequired();
});

it("uses dedicated responsive spacing for roster actions and filters", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      throw new Error(`unexpected request: ${String(input)}`);
    }),
  );

  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={project()}
          rows={[entry("ACTIVE")]}
          participants={[]}
          organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
          canMutate
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </Gate>
    </AuthProvider>,
  );

  await login();

  const exportButton = await screen.findByRole("button", {
    name: "엑셀 내보내기",
  });
  const addButton = screen.getByRole("button", { name: "참가자 추가" });
  expect(exportButton.parentElement).toBe(addButton.parentElement);
  expect(exportButton.parentElement).toHaveClass(
    "er-roster-actions",
    "er-action-row--wrap",
  );

  const filterGrid =
    screen.getByLabelText("명단 검색").parentElement?.parentElement;
  expect(filterGrid).toHaveClass("er-roster-filters");
  expect(
    within(filterGrid as HTMLElement).getByLabelText("조직 필터"),
  ).toBeVisible();
  expect(
    within(filterGrid as HTMLElement).getByLabelText("상태 필터"),
  ).toBeVisible();
});

it("clears a selected organization when its search text changes", () => {
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );

  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeEnabled();
  fireEvent.change(organization, { target: { value: "황" } });
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeDisabled();
  fireEvent.click(screen.getByRole("option", { name: "황룡사" }));
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeEnabled();
});

it("preserves an edited participant name and clears a removed organization candidate", async () => {
  const participant = {
    id: "person-1",
    participantId: "P-001",
    name: "박민수",
    organizationId: "org-1",
    suggestedRole: "STUDENT" as const,
    suggestedGrade: "M1" as const,
    revision: 3,
  };
  const commonProps = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onCreateAndAdd: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };
  const { rerender } = render(
    <ParticipantDialog
      participants={[participant]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      {...commonProps}
    />,
  );

  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "작성 중인 이름" },
  });
  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  fireEvent.change(organization, { target: { value: "황" } });
  fireEvent.click(screen.getByRole("option", { name: "황룡사" }));

  rerender(
    <ParticipantDialog
      participants={[{ ...participant, name: "새 서버 이름", revision: 4 }]}
      organizations={[{ id: "org-1", name: "성룡사", isActive: true }]}
      {...commonProps}
    />,
  );

  await waitFor(() => expect(organization).toHaveValue(""));
  expect(screen.getByLabelText("확정 이름")).toHaveValue("작성 중인 이름");
  expect(screen.getByRole("button", { name: "명단에 추가" })).toBeDisabled();
});

it("synchronizes a manager confirmation to the participant's refreshed read-only organization", async () => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const commonProps = {
    allowExistingOrganizationChange: false,
    organizations: [
      { id: "org-1", name: "1팀", isActive: true },
      { id: "org-2", name: "2팀", isActive: true },
    ],
    onAdd,
    onCreateAndAdd: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };
  const { rerender } = render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "서버 이름",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      {...commonProps}
    />,
  );

  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "조직장 확인 이름" },
  });
  rerender(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "갱신된 서버 이름",
          organizationId: "org-2",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 4,
        },
      ]}
      {...commonProps}
    />,
  );

  expect(screen.getByLabelText("확정 이름")).toHaveValue("조직장 확인 이름");
  expect(screen.getByLabelText("확정 소속 조직")).toHaveValue("2팀");
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await waitFor(() =>
    expect(onAdd).toHaveBeenCalledWith({
      participantId: "person-1",
      name: "조직장 확인 이름",
      organizationId: "org-2",
      role: "STUDENT",
      grade: "M1",
      expectedParticipantRevision: 4,
    }),
  );
});

it("closes the organization listbox before a second Escape closes the participant dialog", () => {
  const onClose = vi.fn();
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[
        { id: "org-1", name: "성룡사", isActive: true },
        { id: "org-2", name: "황룡사", isActive: true },
      ]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={onClose}
    />,
  );

  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "수정 중인 이름" },
  });
  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  fireEvent.focus(organization);
  expect(screen.getByRole("listbox")).toBeVisible();

  fireEvent.keyDown(organization, { key: "Escape" });

  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.getByLabelText("확정 이름")).toHaveValue("수정 중인 이름");
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(organization, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows participant profiles and combines role and grade filters with existing filters", () => {
  const matchingRow: RosterView = {
    ...entry("ACTIVE"),
    participantName: "중2 학생",
    participantNumber: "P-002",
    role: "STUDENT",
    grade: "M2",
  };
  const rows: RosterView[] = [
    matchingRow,
    {
      ...entry("ACTIVE"),
      id: "entry-student-other-grade",
      participantId: "person-student-other-grade",
      participantName: "중1 학생",
      participantNumber: "P-003",
      role: "STUDENT",
      grade: "M1",
    },
    {
      ...entry("ACTIVE"),
      id: "entry-teacher",
      participantId: "person-teacher",
      participantName: "담당 교사",
      participantNumber: "P-004",
      role: "TEACHER",
      grade: null,
    },
    {
      ...entry("CANCELLED"),
      id: "entry-legacy",
      participantId: "person-legacy",
      participantName: "기존 참가자",
      participantNumber: "P-005",
      organizationId: "org-2",
      organizationName: "2팀",
      role: null,
      grade: null,
    },
  ];
  render(
    <RosterTable
      rows={rows}
      canMutate={false}
      onStatusChange={vi.fn().mockResolvedValue(undefined)}
      onEdit={vi.fn()}
    />,
  );

  expect(screen.getByRole("columnheader", { name: "등록 시점" })).toBeVisible();
  const studentRow = screen.getByText("중2 학생").closest("tr");
  const teacherRow = screen.getByText("담당 교사").closest("tr");
  const legacyRow = screen.getByText("기존 참가자").closest("tr");
  expect(studentRow).not.toBeNull();
  expect(teacherRow).not.toBeNull();
  expect(legacyRow).not.toBeNull();
  expect(within(studentRow as HTMLElement).getByText("학생")).toBeVisible();
  expect(within(studentRow as HTMLElement).getByText("중2")).toBeVisible();
  expect(within(teacherRow as HTMLElement).getByText("담당교사")).toBeVisible();
  expect(within(teacherRow as HTMLElement).getByText("-")).toBeVisible();
  expect(within(legacyRow as HTMLElement).getAllByText("미지정")).toHaveLength(
    2,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "명단 검색" }), {
    target: { value: "학생" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "조직 필터" }), {
    target: { value: "1팀" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), {
    target: { value: "ACTIVE" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "참가자 구분 필터" }), {
    target: { value: "STUDENT" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "학년 필터" }), {
    target: { value: "M2" },
  });

  expect(screen.getByText("중2 학생")).toBeVisible();
  expect(screen.queryByText("중1 학생")).not.toBeInTheDocument();
  expect(screen.queryByText("담당 교사")).not.toBeInTheDocument();
  expect(screen.queryByText("기존 참가자")).not.toBeInTheDocument();
});

it("keeps the roster snapshot name and labels rows from deleted organizations", () => {
  render(
    <AuthProvider restoreOnMount={false}>
      <ProjectRosterPage
        project={project()}
        rows={[{ ...entry("ACTIVE"), organizationName: "등록 당시 조직명" }]}
        participants={[]}
        organizations={[]}
        memberships={[
          {
            organizationId: "org-1",
            name: "현재 조직명",
            isActive: false,
            masterIsActive: false,
            masterIsDeleted: true,
            activeProjectCount: 0,
            hasBusinessHistory: true,
            primaryLeader: null,
            managerCount: 0,
            rosterCount: 1,
          },
        ]}
        canMutate={false}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </AuthProvider>,
  );

  const row = screen.getByText("박민수").closest("tr");
  expect(row).not.toBeNull();
  expect(
    within(row as HTMLElement).getByText("등록 당시 조직명"),
  ).toBeVisible();
  expect(within(row as HTMLElement).getByText("삭제됨")).toHaveClass(
    "er-badge--deleted",
  );
});

it("hides roster row actions from operators when the master organization is inactive or deleted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth("OPERATOR")));
      }
      throw new Error(`unexpected request: ${String(input)}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={project()}
          rows={[
            entry("ACTIVE"),
            {
              ...entry("CANCELLED"),
              id: "entry-2",
              participantId: "person-2",
              participantNumber: "P-002",
              participantName: "김민수",
              organizationId: "org-2",
              organizationName: "2팀",
            },
          ]}
          participants={[]}
          organizations={[]}
          memberships={[
            {
              organizationId: "org-1",
              name: "1팀",
              isActive: false,
              masterIsActive: false,
              masterIsDeleted: true,
              activeProjectCount: 0,
              hasBusinessHistory: true,
              primaryLeader: null,
              managerCount: 0,
              rosterCount: 1,
            },
            {
              organizationId: "org-2",
              name: "2팀",
              isActive: true,
              masterIsActive: false,
              masterIsDeleted: false,
              activeProjectCount: 1,
              hasBusinessHistory: true,
              primaryLeader: null,
              managerCount: 0,
              rosterCount: 1,
            },
          ]}
          canMutate
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </Gate>
    </AuthProvider>,
  );
  await login();

  const row = (await screen.findByText("박민수")).closest("tr");
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).getByText("읽기 전용")).toBeVisible();
  expect(
    within(row as HTMLElement).queryByRole("button", { name: "박민수 취소" }),
  ).not.toBeInTheDocument();
  expect(
    within(row as HTMLElement).queryByRole("button", { name: "정보 수정" }),
  ).not.toBeInTheDocument();
  const inactiveRow = screen.getByText("김민수").closest("tr");
  expect(inactiveRow).not.toBeNull();
  expect(
    within(inactiveRow as HTMLElement).getByText("읽기 전용"),
  ).toBeVisible();
  expect(
    within(inactiveRow as HTMLElement).queryByRole("button", {
      name: "김민수 복원",
    }),
  ).not.toBeInTheDocument();
});

it("excludes teachers with stale grades from exact grade filters", () => {
  render(
    <RosterTable
      rows={[
        {
          ...entry("ACTIVE"),
          participantName: "중2 학생",
          participantNumber: "P-002",
          role: "STUDENT",
          grade: "M2",
        },
        {
          ...entry("ACTIVE"),
          id: "entry-teacher-stale-grade",
          participantId: "person-teacher-stale-grade",
          participantName: "학년이 남은 담당교사",
          participantNumber: "P-003",
          role: "TEACHER",
          grade: "M2",
        },
      ]}
      canMutate={false}
      onStatusChange={vi.fn().mockResolvedValue(undefined)}
      onEdit={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByRole("combobox", { name: "학년 필터" }), {
    target: { value: "M2" },
  });

  expect(screen.getByText("중2 학생")).toBeVisible();
  expect(screen.queryByText("학년이 남은 담당교사")).not.toBeInTheDocument();
});

it("shows the pending roster row without removing the table", async () => {
  const pendingStatus = deferred<void>();

  function PendingRosterHarness() {
    const [busyRowIds, setBusyRowIds] = useState<ReadonlySet<string>>(
      () => new Set(),
    );
    const first = entry("ACTIVE");
    const second = {
      ...entry("ACTIVE"),
      id: "entry-2",
      participantId: "person-2",
      participantName: "다른 참가자",
      participantNumber: "P-002",
    };
    async function change(row: RosterView) {
      setBusyRowIds((current) => new Set(current).add(row.id));
      try {
        await pendingStatus.promise;
      } finally {
        setBusyRowIds((current) => {
          const next = new Set(current);
          next.delete(row.id);
          return next;
        });
      }
    }
    return (
      <RosterTable
        rows={[first, second]}
        canMutate
        busyRowIds={busyRowIds}
        onStatusChange={change}
        onEdit={vi.fn()}
      />
    );
  }

  render(<PendingRosterHarness />);

  fireEvent.click(screen.getByRole("button", { name: "박민수 취소" }));
  expect(screen.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  expect(screen.getByText("박민수")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "다른 참가자 취소" }),
  ).toBeEnabled();

  await act(async () => {
    pendingStatus.resolve(undefined);
    await pendingStatus.promise;
  });
});

it("tracks concurrent production roster rows without replaying the same row", async () => {
  const firstPatch = deferred<Response>();
  const secondPatch = deferred<Response>();
  const first = entry("ACTIVE");
  const second: RosterView = {
    ...entry("ACTIVE"),
    id: "entry-2",
    participantId: "person-2",
    participantName: "다른 참가자",
    participantNumber: "P-002",
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (
      url.endsWith("/projects/project-1/roster/entry-1") &&
      init?.method === "PATCH"
    ) {
      return firstPatch.promise;
    }
    if (
      url.endsWith("/projects/project-1/roster/entry-2") &&
      init?.method === "PATCH"
    ) {
      return secondPatch.promise;
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={project()}
          rows={[first, second]}
          participants={[]}
          organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
          canMutate
          onChanged={onChanged}
        />
      </Gate>
    </AuthProvider>,
  );
  await login();
  const firstButton = await screen.findByRole("button", {
    name: "박민수 취소",
  });

  act(() => {
    firstButton.click();
    firstButton.click();
  });

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          String(input).endsWith("/projects/project-1/roster/entry-1") &&
          init?.method === "PATCH"
        );
      }),
    ).toHaveLength(1),
  );
  fireEvent.click(screen.getByRole("button", { name: "다른 참가자 취소" }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "변경 중…" })).toHaveLength(2),
  );
  for (const button of screen.getAllByRole("button", { name: "변경 중…" })) {
    expect(button).toBeDisabled();
  }

  await act(async () => {
    secondPatch.resolve(Response.json({ id: "entry-2" }));
    await secondPatch.promise;
  });

  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "변경 중…" })).toHaveLength(1),
  );
  expect(screen.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "다른 참가자 취소" }),
  ).toBeEnabled();

  await act(async () => {
    firstPatch.resolve(Response.json({ id: "entry-1" }));
    await firstPatch.promise;
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "변경 중…" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "박민수 취소" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "다른 참가자 취소" }),
  ).toBeEnabled();
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it("keeps an existing-participant dialog pending without submitting twice", async () => {
  const pendingAdd = deferred<void>();
  const onAdd = vi.fn(() => pendingAdd.promise);
  const onClose = vi.fn();
  render(
    <ParticipantDialog
      participants={[
        {
          id: "person-1",
          participantId: "P-001",
          name: "박민수",
          organizationId: "org-1",
          suggestedRole: "STUDENT",
          suggestedGrade: "M1",
          revision: 3,
        },
      ]}
      organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
      onAdd={onAdd}
      onCreateAndAdd={vi.fn().mockResolvedValue(undefined)}
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "확정 이름" },
  });

  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  const pendingButton = screen.getByRole("button", {
    name: "명단에 추가 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("확정 이름")).toHaveValue("확정 이름");
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "참가자 추가" }), {
    key: "Escape",
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();

  await act(async () => {
    pendingAdd.reject(new Error("add failed"));
    await pendingAdd.promise.catch(() => undefined);
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText("확정 이름")).toHaveValue("확정 이름");
});

it("keeps a new-participant dialog pending without submitting twice", async () => {
  const pendingCreate = deferred<BulkParticipantSubmitOutcome>();
  const onCreateAndAdd = vi.fn(() => pendingCreate.promise);
  const onClose = vi.fn();
  render(
    <ParticipantDialog
      participants={[]}
      organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
      onAdd={vi.fn().mockResolvedValue(undefined)}
      onCreateAndAdd={onCreateAndAdd}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("새 참가자 이름");
  fireEvent.change(screen.getByRole("combobox", { name: "1번 참가자 구분" }), {
    target: { value: "TEACHER" },
  });

  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

  const pendingButton = screen.getByRole("button", {
    name: "1명 등록 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(onCreateAndAdd).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "1번 이름" })).toHaveValue(
    "새 참가자 이름",
  );
  expect(screen.getByRole("combobox", { name: "1번 참가자 구분" })).toHaveValue(
    "TEACHER",
  );
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "참가자 추가" }), {
    key: "Escape",
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();

  await act(async () => {
    pendingCreate.reject(new Error("create failed"));
    await pendingCreate.promise.catch(() => undefined);
  });
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "1번 이름" })).toHaveValue(
    "새 참가자 이름",
  );
  expect(screen.getByRole("combobox", { name: "1번 참가자 구분" })).toHaveValue(
    "TEACHER",
  );
  expect(screen.getByRole("combobox", { name: "1번 학년" })).toBeDisabled();
});

it("keeps participant edits pending without submitting twice", async () => {
  const pendingSave = deferred<void>();
  const onSave = vi.fn(() => pendingSave.promise);
  render(
    <ParticipantEditDialog
      participant={{
        id: "person-1",
        participantId: "P-001",
        name: "박민수",
        organizationId: "org-1",
        revision: 1,
      }}
      roster={{ ...entry("ACTIVE"), role: "STUDENT", grade: "M1" }}
      organizations={[{ id: "org-1", name: "1팀", isActive: true }]}
      allowOrganizationChange
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "수정 이름" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "학년" }), {
    target: { value: "H3" },
  });

  fireEvent.click(screen.getByRole("button", { name: "정보 저장" }));

  const pendingButton = screen.getByRole("button", {
    name: "정보 저장 중…",
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("이름")).toHaveValue("수정 이름");
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("H3");

  await act(async () => {
    pendingSave.reject(new Error("save failed"));
    await pendingSave.promise.catch(() => undefined);
  });
  expect(
    screen.getByRole("dialog", { name: "참가자 정보 수정" }),
  ).toBeVisible();
  expect(screen.getByLabelText("이름")).toHaveValue("수정 이름");
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("H3");
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
              masterIsDeleted: false,
              activeProjectCount: 1,
              hasBusinessHistory: false,
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
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

it("preserves an existing-participant draft after a stale add reload", async () => {
  let projectReads = 0;
  let participantReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.endsWith("/projects/project-1")) {
      projectReads += 1;
      return Promise.resolve(
        Response.json({ ...project(), revision: projectReads === 1 ? 2 : 3 }),
      );
    }
    if (url.endsWith("/summary")) {
      return Promise.resolve(Response.json(summary(0)));
    }
    if (url.endsWith("/roster") && init?.method === "POST") {
      return Promise.resolve(
        Response.json(
          {
            code: "STALE_REVISION",
            message: "stale",
            requestId: "request-stale-add",
          },
          { status: 409 },
        ),
      );
    }
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/participants")) {
      participantReads += 1;
      return Promise.resolve(
        Response.json([
          {
            id: "person-1",
            participantId: "P-001",
            name: participantReads === 1 ? "서버 이름" : "갱신된 서버 이름",
            organizationId: "org-1",
            suggestedRole: "STUDENT",
            suggestedGrade: "M1",
            revision: participantReads === 1 ? 7 : 8,
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
          {
            organizationId: "org-2",
            name: "2팀",
            isActive: true,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(Response.json([]));
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
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "작성 중인 확정 이름" },
  });
  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  fireEvent.change(organization, { target: { value: "2팀" } });
  fireEvent.click(screen.getByRole("option", { name: "2팀" }));
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "명단에 추가" })).toBeEnabled(),
  );
  expect(screen.getByRole("dialog", { name: "참가자 추가" })).toBeVisible();
  expect(screen.getByLabelText("확정 이름")).toHaveValue("작성 중인 확정 이름");
  expect(organization).toHaveValue("2팀");
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
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
    if (url.endsWith("/roster/bulk") && init?.method === "POST") {
      return Promise.resolve(
        Response.json(
          { batchId: "batch-1", participants: [], projectRevision: 3 },
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
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("김신규");
  fireEvent.click(screen.getByRole("button", { name: "1명 명단에 추가" }));

  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/projects/project-1/roster/bulk") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1),
  );
  const rosterWrites = fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/roster/bulk") &&
      init?.method === "POST",
  );
  expect(rosterWrites).toHaveLength(1);
  expect(JSON.parse(String(rosterWrites[0]?.[1]?.body))).toEqual({
    organizationId: "org-1",
    participants: [{ name: "김신규", role: "STUDENT", grade: "M1" }],
    confirmDuplicateNames: false,
    expectedRevision: 2,
  });
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("/participants") && init?.method === "POST",
    ),
  ).toBe(false);
});

it("confirms reusable participant details in one existing-roster request", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1"))
      return Promise.resolve(Response.json(project()));
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([entry("CANCELLED")]));
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(
        Response.json([
          {
            id: "person-1",
            participantId: "P-001",
            name: "이전 이름",
            organizationId: "org-old-inactive",
            suggestedRole: "STUDENT",
            suggestedGrade: "M1",
            revision: 7,
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: true,
          },
          {
            organizationId: "org-2",
            name: "2팀",
            isActive: true,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations"))
      return Promise.resolve(Response.json([]));
    if (url.includes("/audit"))
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    if (url.endsWith("/roster") && init?.method === "POST") {
      return Promise.resolve(Response.json({ id: "entry-1" }, { status: 201 }));
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
  const organization = screen.getByRole("combobox", {
    name: "확정 소속 조직",
  });
  expect(organization).toHaveValue("1팀");
  expect(organization).toBeEnabled();
  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "확정 이름" },
  });
  fireEvent.change(organization, { target: { value: "2팀" } });
  fireEvent.click(screen.getByRole("option", { name: "2팀" }));
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/projects/project-1/roster") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1),
  );
  const write = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/roster") &&
      init?.method === "POST",
  );
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    participantId: "person-1",
    confirmedParticipant: {
      name: "확정 이름",
      organizationId: "org-2",
      role: "STUDENT",
      grade: "M1",
    },
    expectedParticipantRevision: 7,
    expectedRevision: 2,
  });
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/projects/project-1/roster") &&
        init?.method === "POST",
    ),
  ).toHaveLength(1);
});

it("keeps a manager reuse confirmation in the participant master organization", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(
        Response.json(auth("ORGANIZATION_MANAGER", ["org-1", "org-2"])),
      );
    }
    if (url.endsWith("/projects/project-1")) {
      return Promise.resolve(
        Response.json({ ...project(), status: "PRE_REGISTRATION" }),
      );
    }
    if (url.endsWith("/summary")) {
      return Promise.resolve(Response.json(summary(0)));
    }
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(
        Response.json([
          {
            id: "person-1",
            participantId: "P-001",
            name: "담당자 확인 전 이름",
            organizationId: "org-1",
            suggestedRole: "STUDENT",
            suggestedGrade: "M1",
            revision: 5,
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
          {
            organizationId: "org-2",
            name: "2팀",
            isActive: true,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.includes("/audit")) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    if (url.endsWith("/roster") && init?.method === "POST") {
      return Promise.resolve(Response.json({ id: "entry-1" }, { status: 201 }));
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

  const organization = screen.getByLabelText("확정 소속 조직");
  expect(organization).toBeDisabled();
  expect(organization).toHaveValue("1팀");
  expect(
    screen.queryByRole("combobox", { name: "확정 소속 조직" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("확정 이름"), {
    target: { value: "담당자 확인 이름" },
  });
  fireEvent.click(screen.getByRole("button", { name: "명단에 추가" }));

  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(
        ([url, request]) =>
          String(url).endsWith("/projects/project-1/roster") &&
          request?.method === "POST",
      ),
    ).toHaveLength(1),
  );
  const write = fetchMock.mock.calls.find(
    ([url, request]) =>
      String(url).endsWith("/projects/project-1/roster") &&
      request?.method === "POST",
  );
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    participantId: "person-1",
    confirmedParticipant: {
      name: "담당자 확인 이름",
      organizationId: "org-1",
      role: "STUDENT",
      grade: "M1",
    },
    expectedParticipantRevision: 5,
    expectedRevision: 2,
  });
});

it("hides participants from an inactive project membership in a manager add dialog", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(
        Response.json(auth("ORGANIZATION_MANAGER", ["org-1", "org-2"])),
      );
    }
    if (url.endsWith("/projects/project-1")) {
      return Promise.resolve(
        Response.json({ ...project(), status: "PRE_REGISTRATION" }),
      );
    }
    if (url.endsWith("/summary")) {
      return Promise.resolve(Response.json(summary(0)));
    }
    if (url.endsWith("/roster")) {
      return Promise.resolve(
        Response.json([
          {
            id: "entry-inactive",
            projectId: "project-1",
            participantId: "person-inactive-row",
            participantNumber: "P-INACTIVE-ROW",
            organizationId: "org-2",
            participantName: "비활성 명단 참가자",
            organizationName: "비활성 연결",
            source: "PRE_REGISTRATION",
            status: "ACTIVE",
            wasExpectedAtStart: false,
            revision: 0,
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
        ]),
      );
    }
    if (url.endsWith("/participants")) {
      return Promise.resolve(
        Response.json([
          {
            id: "person-active",
            participantId: "P-ACTIVE",
            name: "활성 조직 참가자",
            organizationId: "org-1",
            revision: 0,
          },
          {
            id: "person-inactive",
            participantId: "P-INACTIVE",
            name: "비활성 연결 참가자",
            organizationId: "org-2",
            revision: 0,
          },
        ]),
      );
    }
    if (url.endsWith("/projects/project-1/organizations")) {
      return Promise.resolve(
        Response.json([
          {
            organizationId: "org-1",
            name: "활성 연결",
            isActive: true,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
            primaryLeader: null,
            managerCount: 1,
            rosterCount: 0,
          },
          {
            organizationId: "org-2",
            name: "비활성 연결",
            isActive: false,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 0,
            hasBusinessHistory: true,
            primaryLeader: null,
            managerCount: 1,
            rosterCount: 0,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(Response.json([]));
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
  expect(await screen.findByText("읽기 전용")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "비활성 명단 참가자 취소" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));

  expect(
    screen.getByRole("option", { name: "활성 조직 참가자 · P-ACTIVE" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("option", {
      name: "비활성 연결 참가자 · P-INACTIVE",
    }),
  ).not.toBeInTheDocument();
});

it("keeps in-progress roster controls read-only for managers and available to operators", async () => {
  const createFetch = (role: "OPERATOR" | "ORGANIZATION_MANAGER") =>
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth(role, ["org-1"])));
      }
      if (url.endsWith("/projects/project-1")) {
        return Promise.resolve(Response.json(project()));
      }
      if (url.endsWith("/summary")) {
        return Promise.resolve(Response.json(summary(1)));
      }
      if (url.endsWith("/projects/project-1/organizations")) {
        return Promise.resolve(
          Response.json([
            {
              organizationId: "org-1",
              name: "1팀",
              isActive: true,
              masterIsActive: true,
              masterIsDeleted: false,
              activeProjectCount: 1,
              hasBusinessHistory: true,
              primaryLeader: null,
              managerCount: 1,
              rosterCount: 1,
            },
          ]),
        );
      }
      if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
        return Promise.resolve(Response.json([entry("ACTIVE")]));
      }
      if (url.endsWith("/participants")) {
        return Promise.resolve(
          Response.json([
            {
              id: "person-1",
              participantId: "P-001",
              name: "박민수",
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
      if (url.includes("/audit")) {
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      }
      throw new Error(`unexpected request: ${url}`);
    });

  vi.stubGlobal("fetch", createFetch("ORGANIZATION_MANAGER"));
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
  expect(await screen.findByText("읽기 전용")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "박민수 취소" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "정보 수정" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "참가자 추가" }),
  ).not.toBeInTheDocument();

  cleanup();
  vi.stubGlobal("fetch", createFetch("OPERATOR"));
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectDetailPage projectId="project-1" />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await openRosterTab();
  expect(
    await screen.findByRole("button", { name: "박민수 취소" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "정보 수정" })).toBeVisible();
  expect(screen.getByRole("button", { name: "참가자 추가" })).toBeVisible();
});

it("keeps the participant profile draft after a stale revision reload", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login"))
      return Promise.resolve(Response.json(auth()));
    if (url.endsWith("/projects/project-1"))
      return Promise.resolve(
        Response.json({ ...project(), status: "PRE_REGISTRATION" }),
      );
    if (url.endsWith("/summary"))
      return Promise.resolve(Response.json(summary(100)));
    if (url.endsWith("/roster") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(
        Response.json([{ ...entry("ACTIVE"), role: "TEACHER", grade: null }]),
      );
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
          {
            organizationId: "org-2",
            name: "2팀",
            isActive: true,
            masterIsActive: true,
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
          },
        ]),
      );
    }
    if (url.endsWith("/organizations")) {
      return Promise.resolve(
        Response.json([
          { id: "org-1", name: "1팀", isActive: true },
          { id: "org-2", name: "2팀", isActive: true },
        ]),
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
  fireEvent.change(screen.getByRole("combobox", { name: "소속 조직" }), {
    target: { value: "org-2" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "참가자 구분" }), {
    target: { value: "STUDENT" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "학년" }), {
    target: { value: "H3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "정보 저장" }));

  expect(
    await screen.findByText(
      "다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("dialog", { name: "참가자 정보 수정" }),
  ).toBeVisible();
  expect(screen.getByLabelText("이름")).toHaveValue("박민수 수정");
  expect(screen.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "org-2",
  );
  expect(screen.getByRole("combobox", { name: "참가자 구분" })).toHaveValue(
    "STUDENT",
  );
  expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("H3");
  const participantWrite = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/projects/project-1/participants/person-1") &&
      init?.method === "PATCH",
  );
  expect(JSON.parse(String(participantWrite?.[1]?.body))).toEqual({
    name: "박민수 수정",
    organizationId: "org-2",
    role: "STUDENT",
    grade: "H3",
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
            masterIsDeleted: false,
            activeProjectCount: 1,
            hasBusinessHistory: false,
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

function auth(
  role: "OPERATOR" | "ORGANIZATION_MANAGER" = "OPERATOR",
  organizationIds: string[] = [],
  userId = "user-1",
) {
  return {
    accessToken: "access",
    csrfToken: "csrf",
    session: {
      sessionKind: "FULL",
      user: {
        id: userId,
        loginId: "manager-01",
        displayName: "운영자",
        role,
        organizationIds,
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
    status: "IN_PROGRESS" as const,
    revision: 2,
    createdAt: "2029-01-01T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2029-01-01T00:00:00.000Z",
    closedAt: null,
    closedBy: null,
    closeReason: null,
    isDeleted: false,
    deletedAt: null,
  };
}

function entry(status: "ACTIVE" | "CANCELLED"): RosterView {
  return {
    id: "entry-1",
    projectId: "project-1",
    participantId: "person-1",
    participantNumber: "P-001",
    organizationId: "org-1",
    participantName: "박민수",
    organizationName: "1팀",
    role: "STUDENT",
    grade: "M1",
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
    studentTotal: final,
    teacherTotal: 0,
    organizations: [
      {
        organizationId: "org-1",
        organizationName: "1팀",
        isActive: true,
        masterIsActive: true,
        masterIsDeleted: false,
        expected: 100,
        inProgressAdded: 0,
        inProgressCancelled: 100 - final,
        final,
        delta: final - 100,
        studentCount: final,
        teacherCount: 0,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function recentTestOrganizations() {
  return [
    { id: "org-1", name: "성룡사", isActive: true },
    { id: "org-2", name: "황룡사", isActive: true },
    { id: "org-inactive", name: "휴면사", isActive: false },
  ];
}

function rosterAddFetch(
  userId = "user-1",
  post: () => Promise<Response> = () =>
    Promise.resolve(Response.json({ id: "entry-new" }, { status: 201 })),
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth("OPERATOR", [], userId)));
    }
    if (
      (url.endsWith("/projects/project-1/roster") ||
        url.endsWith("/projects/project-1/roster/bulk")) &&
      init?.method === "POST"
    ) {
      return post();
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

function renderRosterForRecentOrganizations({
  onChanged,
  participants = [],
}: {
  onChanged: () => Promise<void>;
  participants?: React.ComponentProps<typeof ProjectRosterPage>["participants"];
}) {
  return render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <ProjectRosterPage
          project={project()}
          rows={[]}
          participants={participants}
          organizations={recentTestOrganizations()}
          canMutate
          onChanged={onChanged}
        />
      </Gate>
    </AuthProvider>,
  );
}

function ConcurrentRosterHarness({
  blockedRender,
  onChanged,
}: {
  blockedRender: Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("project-1");

  return (
    <>
      <button
        type="button"
        onClick={() => {
          startTransition(() => setProjectId("project-2"));
        }}
      >
        프로젝트 전환 렌더 시작
      </button>
      <Suspense fallback={null}>
        <ProjectRosterPage
          project={{ ...project(), id: projectId }}
          rows={[]}
          participants={[]}
          organizations={recentTestOrganizations()}
          canMutate
          onChanged={onChanged}
        />
        {projectId === "project-2" ? (
          <BlockedRender promise={blockedRender} />
        ) : null}
      </Suspense>
    </>
  );
}

function BlockedRender({ promise }: { promise: Promise<void> }): never {
  throw promise;
}

function addStudentParticipantRow(name: string, grade = "M1") {
  const dialog = screen.getByRole("dialog", { name: "참가자 추가" });
  fireEvent.click(within(dialog).getByRole("button", { name: "참가자 추가" }));
  const rowNumber = within(dialog).getAllByRole("group", {
    name: /번 참가자/,
  }).length;
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: `${rowNumber}번 이름` }),
    { target: { value: name } },
  );
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: `${rowNumber}번 학년` }),
    { target: { value: grade } },
  );
}

function addTeacherParticipantRow(name: string) {
  const dialog = screen.getByRole("dialog", { name: "참가자 추가" });
  fireEvent.click(within(dialog).getByRole("button", { name: "참가자 추가" }));
  const rowNumber = within(dialog).getAllByRole("group", {
    name: /번 참가자/,
  }).length;
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: `${rowNumber}번 이름` }),
    { target: { value: name } },
  );
  fireEvent.change(
    within(dialog).getByRole("combobox", {
      name: `${rowNumber}번 참가자 구분`,
    }),
    { target: { value: "TEACHER" } },
  );
}

async function openNewParticipantForm(organizationName: string) {
  fireEvent.click(await screen.findByRole("button", { name: "참가자 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  addStudentParticipantRow("김신규");
  const organization = screen.getByRole("combobox", { name: "소속 조직" });
  fireEvent.change(organization, {
    target: { value: organizationName.slice(0, 1) },
  });
  fireEvent.click(screen.getByRole("option", { name: organizationName }));
}

async function waitForRosterPost(fetchMock: ReturnType<typeof rosterAddFetch>) {
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/projects/project-1/roster/bulk") &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );
}

function recentOrganizationValue(userId: string, projectId: string) {
  const value = window.localStorage.getItem(
    `event-roster:recent-organizations:v1:${userId}:${projectId}`,
  );
  return value === null ? null : JSON.parse(value);
}
