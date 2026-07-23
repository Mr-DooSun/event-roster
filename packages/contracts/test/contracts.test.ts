import { describe, expect, it } from "vitest";
import type { Project } from "../src";
import {
  AddProjectOrganizationSchema,
  CreateProjectRequestSchema,
  LoginIdSchema,
  OrganizationManagerCreateRequestSchema,
  OrganizationPatchRequestSchema,
  OrganizationPrimaryPatchRequestSchema,
  PasswordSchema,
  ProjectOrganizationPatchSchema,
  RosterCreateRequestSchema,
  RosterSourceSchema,
  UpdateProjectRequestSchema,
} from "../src";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

describe("authentication contracts", () => {
  it("accepts only canonical login IDs", () => {
    expect(LoginIdSchema.safeParse("manager-01").success).toBe(true);
    expect(LoginIdSchema.safeParse("Manager 01").success).toBe(false);
    expect(LoginIdSchema.parse("  Manager-01  ")).toBe("manager-01");
    expect(LoginIdSchema.safeParse("01-manager").success).toBe(false);
  });

  it("enforces password length in UTF-8 bytes", () => {
    expect(PasswordSchema.safeParse("safe-pass-01").success).toBe(true);
    expect(PasswordSchema.safeParse("short").success).toBe(false);
    expect(PasswordSchema.safeParse("가".repeat(24)).success).toBe(true);
    expect(PasswordSchema.safeParse(`${"가".repeat(24)}a`).success).toBe(false);
  });
});

describe("organization contracts", () => {
  it("accepts the minimal global deactivation payload", () => {
    expect(OrganizationPatchRequestSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
    expect(OrganizationPatchRequestSchema.safeParse({}).success).toBe(false);
  });

  it("requires a project revision and exactly one organization source", () => {
    expect(
      AddProjectOrganizationSchema.parse({
        organizationId: "org-1",
        expectedProjectRevision: 4,
      }),
    ).toEqual({ organizationId: "org-1", expectedProjectRevision: 4 });
    expect(
      AddProjectOrganizationSchema.safeParse({
        organizationId: "org-1",
        newOrganizationName: "새 조직",
        expectedProjectRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      ProjectOrganizationPatchSchema.safeParse({ isActive: false }).success,
    ).toBe(false);
  });

  it("distinguishes existing and newly provisioned organization managers", () => {
    expect(
      OrganizationManagerCreateRequestSchema.parse({
        kind: "EXISTING",
        userId: "user-1",
        assignmentRole: "MANAGER",
      }),
    ).toEqual({
      kind: "EXISTING",
      userId: "user-1",
      assignmentRole: "MANAGER",
    });
    expect(
      OrganizationManagerCreateRequestSchema.safeParse({
        kind: "NEW",
        userId: "user-1",
        loginId: "manager-01",
        displayName: "담당자",
        assignmentRole: "MANAGER",
      }).success,
    ).toBe(false);
  });

  it("requires the observed primary when replacing or removing a leader", () => {
    expect(
      OrganizationPrimaryPatchRequestSchema.parse({
        userId: "user-2",
        expectedPrimaryUserId: "user-1",
        previousPrimaryDisposition: "MANAGER",
      }),
    ).toEqual({
      userId: "user-2",
      expectedPrimaryUserId: "user-1",
      previousPrimaryDisposition: "MANAGER",
    });
    expect(
      OrganizationPrimaryPatchRequestSchema.parse({
        userId: null,
        expectedPrimaryUserId: "user-1",
        previousPrimaryDisposition: "REMOVE",
      }).userId,
    ).toBeNull();
  });
});

describe("roster contracts", () => {
  it("uses project lifecycle sources and a strict participant creation union", () => {
    expect(RosterSourceSchema.options).toEqual([
      "PRE_REGISTRATION",
      "IN_PROGRESS",
    ]);
    expect(
      RosterCreateRequestSchema.safeParse({
        participantId: "participant-1",
        newParticipant: { name: "모호함", organizationId: "org-1" },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it("requires confirmed participant state for an existing participant reuse", () => {
    expect(
      RosterCreateRequestSchema.safeParse({
        participantId: "participant-1",
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      RosterCreateRequestSchema.parse({
        participantId: "participant-1",
        confirmedParticipant: { name: "확인된 이름", organizationId: "org-1" },
        expectedParticipantRevision: 2,
        expectedRevision: 3,
      }),
    ).toEqual({
      participantId: "participant-1",
      confirmedParticipant: { name: "확인된 이름", organizationId: "org-1" },
      expectedParticipantRevision: 2,
      expectedRevision: 3,
    });
  });
});

it("accepts duplicate-name project payloads with independently optional dates", () => {
  expect(
    CreateProjectRequestSchema.parse({
      name: "상반기 리더십 캠프",
      endDate: "2026-05-23",
    }),
  ).toEqual({ name: "상반기 리더십 캠프", endDate: "2026-05-23" });
  expect(() =>
    CreateProjectRequestSchema.parse({
      name: "기간 역전",
      startDate: "2026-05-24",
      endDate: "2026-05-23",
    }),
  ).toThrow();
  expect(
    UpdateProjectRequestSchema.parse({
      startDate: null,
      endDate: null,
      expectedRevision: 2,
    }),
  ).toEqual({ startDate: null, endDate: null, expectedRevision: 2 });
});

it("exposes required project audit creator fields", () => {
  type ProjectAuditCreators = Assert<
    Equal<
      Pick<Project, "createdBy" | "closedBy">,
      { createdBy: string; closedBy: string | null }
    >
  >;

  const projectAuditCreatorShape: ProjectAuditCreators = true;
  const auditCreators: Pick<Project, "createdBy" | "closedBy"> = {
    createdBy: "operator-1",
    closedBy: null,
  };

  expect(projectAuditCreatorShape).toBe(true);
  expect(auditCreators).toEqual({ createdBy: "operator-1", closedBy: null });
});
