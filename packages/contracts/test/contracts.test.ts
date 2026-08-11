import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ClosedProjectCorrectionCandidateOrganization,
  ClosedProjectCorrectionCandidateParticipant,
  OrganizationDetail,
  OrganizationSummary,
  Participant,
  ParticipantRole,
  Project,
  StudentGrade,
} from "../src";
import {
  AddProjectOrganizationSchema,
  AddProjectOrganizationsBulkSchema,
  API_PROBLEM_CODES,
  BulkRosterCreateRequestSchema,
  ClosedProjectRosterPatchRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
  LoginIdSchema,
  NormalizedImportRowSchema,
  OrganizationDeleteRequestSchema,
  OrganizationManagerCreateRequestSchema,
  OrganizationPatchRequestSchema,
  OrganizationPrimaryPatchRequestSchema,
  ParticipantSchema,
  PasswordSchema,
  ProjectOrganizationPatchSchema,
  ProjectParticipantPatchRequestSchema,
  ProjectStatusSchema,
  RestoreProjectRequestSchema,
  RosterCreateRequestSchema,
  RosterParticipantProfileSchema,
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
  it("requires an exact unnormalized organization deletion confirmation", () => {
    expect(
      OrganizationDeleteRequestSchema.parse({
        confirmationName: "황룡사",
      }),
    ).toEqual({ confirmationName: "황룡사" });
    expect(
      OrganizationDeleteRequestSchema.parse({
        confirmationName: "  황룡사  ",
      }),
    ).toEqual({ confirmationName: "  황룡사  " });
    expect(
      OrganizationDeleteRequestSchema.safeParse({
        confirmationName: "황룡사",
        cascade: true,
      }).success,
    ).toBe(false);
    expect(
      OrganizationDeleteRequestSchema.safeParse({
        confirmationName: "",
      }).success,
    ).toBe(false);

    expectTypeOf<OrganizationSummary>().toMatchTypeOf<{
      isDeleted: boolean;
      deletedAt: string | null;
    }>();
    expectTypeOf<OrganizationDetail>().toMatchTypeOf<{
      isDeleted: boolean;
      deletedAt: string | null;
    }>();
    expect(API_PROBLEM_CODES).toContain("ORGANIZATION_NAME_RESERVED");
  });

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

  it("rejects empty and duplicate bulk organization IDs", () => {
    expect(
      AddProjectOrganizationsBulkSchema.parse({
        organizationIds: ["org-1"],
        expectedProjectRevision: 3,
      }),
    ).toEqual({ organizationIds: ["org-1"], expectedProjectRevision: 3 });
    expect(() =>
      AddProjectOrganizationsBulkSchema.parse({
        organizationIds: ["org-1", "org-1"],
        expectedProjectRevision: 3,
      }),
    ).toThrow();
    expect(() =>
      AddProjectOrganizationsBulkSchema.parse({
        organizationIds: [],
        expectedProjectRevision: 3,
      }),
    ).toThrow();
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
    expect(
      OrganizationPrimaryPatchRequestSchema.safeParse({
        userId: null,
        expectedPrimaryUserId: "user-1",
        previousPrimaryDisposition: "MANAGER",
      }).success,
    ).toBe(false);
  });
});

describe("roster contracts", () => {
  it("defines strict closed-project history correction contracts", () => {
    expectTypeOf<ClosedProjectCorrectionCandidateOrganization>().toMatchTypeOf<{
      id: string;
      name: string;
      isActive: boolean;
      isDeleted: boolean;
    }>();
    expectTypeOf<ClosedProjectCorrectionCandidateParticipant>().toMatchTypeOf<{
      id: string;
      participantId: string;
      name: string;
      organizationId: string;
      revision: number;
      suggestedRole: ParticipantRole | null;
      suggestedGrade: StudentGrade | null;
    }>();

    expect(
      ClosedProjectRosterPatchRequestSchema.parse({
        name: "당시 이름",
        organizationId: "org-deleted",
        role: "STUDENT",
        grade: "M2",
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    ).toMatchObject({ name: "당시 이름", grade: "M2" });
    expect(
      ClosedProjectRosterPatchRequestSchema.parse({
        status: "CANCELLED",
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    ).toMatchObject({ status: "CANCELLED" });
    expect(() =>
      ClosedProjectRosterPatchRequestSchema.parse({
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    ).toThrow();
    expect(() =>
      ClosedProjectRosterPatchRequestSchema.parse({
        role: "STUDENT",
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    ).toThrow();
    expect(() =>
      ClosedProjectRosterPatchRequestSchema.parse({
        role: "TEACHER",
        grade: "M2",
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    ).toThrow();
  });

  it("keeps participant profile suggestions nullable and enum constrained", () => {
    expectTypeOf<
      Participant["suggestedRole"]
    >().toEqualTypeOf<ParticipantRole | null>();
    expectTypeOf<
      Participant["suggestedGrade"]
    >().toEqualTypeOf<StudentGrade | null>();
    expect(
      ParticipantSchema.parse({
        participantId: "participant-1",
        name: "추천 참가자",
        organizationId: "org-1",
        suggestedRole: "STUDENT",
        suggestedGrade: "H3",
      }),
    ).toMatchObject({
      suggestedRole: "STUDENT",
      suggestedGrade: "H3",
    });
    expect(
      ParticipantSchema.safeParse({
        participantId: "participant-2",
        name: "기존 참가자",
        organizationId: "org-1",
        suggestedRole: null,
        suggestedGrade: null,
      }).success,
    ).toBe(true);
    for (const suggestions of [
      { suggestedRole: "VOLUNTEER", suggestedGrade: "M1" },
      { suggestedRole: "STUDENT", suggestedGrade: "E6" },
    ]) {
      expect(
        ParticipantSchema.safeParse({
          participantId: "participant-invalid",
          name: "잘못된 추천",
          organizationId: "org-1",
          ...suggestions,
        }).success,
      ).toBe(false);
    }
  });

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
        confirmedParticipant: {
          name: "확인된 이름",
          organizationId: "org-1",
          role: "STUDENT",
          grade: "M1",
        },
        expectedParticipantRevision: 2,
        expectedRevision: 3,
      }),
    ).toEqual({
      participantId: "participant-1",
      confirmedParticipant: {
        name: "확인된 이름",
        organizationId: "org-1",
        role: "STUDENT",
        grade: "M1",
      },
      expectedParticipantRevision: 2,
      expectedRevision: 3,
    });
  });

  it("accepts only valid participant role and grade profiles", () => {
    const validProfiles = [
      { role: "STUDENT", grade: "M1" },
      { role: "STUDENT", grade: "H3" },
      { role: "TEACHER", grade: null },
    ] as const;
    for (const profile of validProfiles) {
      expect(RosterParticipantProfileSchema.safeParse(profile).success).toBe(
        true,
      );
    }
    for (const profile of [
      { role: "STUDENT", grade: null },
      { role: "TEACHER", grade: "H1" },
    ]) {
      expect(RosterParticipantProfileSchema.safeParse(profile).success).toBe(
        false,
      );
    }
  });

  it("accepts 1 to 30 structured bulk participant rows", () => {
    expect(
      BulkRosterCreateRequestSchema.parse({
        organizationId: "org-1",
        participants: [
          { name: "  홍길동  ", role: "STUDENT", grade: "M2" },
          { name: "김\t민수", role: "TEACHER", grade: null },
        ],
        confirmDuplicateNames: false,
        expectedRevision: 4,
      }),
    ).toEqual({
      organizationId: "org-1",
      participants: [
        { name: "홍길동", role: "STUDENT", grade: "M2" },
        { name: "김 민수", role: "TEACHER", grade: null },
      ],
      confirmDuplicateNames: false,
      expectedRevision: 4,
    });
    expect(
      BulkRosterCreateRequestSchema.safeParse({
        organizationId: "org-1",
        participants: [],
        confirmDuplicateNames: false,
        expectedRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      BulkRosterCreateRequestSchema.safeParse({
        organizationId: "org-1",
        participants: Array.from({ length: 31 }, (_, index) => ({
          name: `참가자 ${index}`,
          role: "STUDENT" as const,
          grade: "M1" as const,
        })),
        confirmDuplicateNames: false,
        expectedRevision: 4,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid participant rows and unknown bulk fields", () => {
    for (const participants of [
      [{ name: "   ", role: "STUDENT", grade: "M1" }],
      [{ name: "가".repeat(101), role: "STUDENT", grade: "M1" }],
      [{ name: "학생", role: "STUDENT", grade: null }],
      [{ name: "교사", role: "TEACHER", grade: "H1" }],
    ]) {
      expect(
        BulkRosterCreateRequestSchema.safeParse({
          organizationId: "org-1",
          participants,
          confirmDuplicateNames: false,
          expectedRevision: 0,
        }).success,
      ).toBe(false);
    }
    expect(
      BulkRosterCreateRequestSchema.safeParse({
        organizationId: "org-1",
        participants: [{ name: "홍길동", role: "STUDENT", grade: "M1" }],
        confirmDuplicateNames: false,
        expectedRevision: 0,
        ignored: true,
      }).success,
    ).toBe(false);
  });

  it("requires a valid profile on import rows and accepts optional profile patches", () => {
    expect(
      NormalizedImportRowSchema.safeParse({
        rowNumber: 2,
        name: "학생 1",
        organizationName: "성룡사",
        role: "STUDENT",
        grade: null,
      }).success,
    ).toBe(false);
    expect(
      ProjectParticipantPatchRequestSchema.safeParse({
        role: "TEACHER",
        grade: null,
        expectedRevision: 1,
        expectedProjectRevision: 2,
      }).success,
    ).toBe(true);
  });
});

it("exposes the three runtime project statuses", () => {
  expect(ProjectStatusSchema.options).toEqual([
    "PRE_REGISTRATION",
    "IN_PROGRESS",
    "CLOSED",
  ]);
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

it("keeps project delete confirmation exact and validates revisions", () => {
  expect(
    DeleteProjectRequestSchema.parse({
      confirmationName: "1회 수련 법회",
      expectedRevision: 7,
    }),
  ).toEqual({
    confirmationName: "1회 수련 법회",
    expectedRevision: 7,
  });
  expect(
    DeleteProjectRequestSchema.parse({
      confirmationName: " 1회 수련 법회 ",
      expectedRevision: 7,
    }).confirmationName,
  ).toBe(" 1회 수련 법회 ");
  expect(
    DeleteProjectRequestSchema.safeParse({
      confirmationName: "",
      expectedRevision: 7,
    }).success,
  ).toBe(false);
  expect(
    RestoreProjectRequestSchema.safeParse({ expectedRevision: -1 }).success,
  ).toBe(false);
});

it("exposes project deletion summary fields", () => {
  expectTypeOf<Project["isDeleted"]>().toEqualTypeOf<boolean>();
  expectTypeOf<Project["deletedAt"]>().toEqualTypeOf<string | null>();
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
