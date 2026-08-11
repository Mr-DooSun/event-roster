import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import { normalizeParticipantName } from "./participant-names";
import {
  type ParticipantRole,
  ParticipantRoleSchema,
  type Gender,
  GenderSchema,
  type StudentGrade,
  StudentGradeSchema,
} from "./participant-profile";
import { ParticipantIdSchema } from "./participants";
import { ProjectIdSchema } from "./projects";

export {
  type ParticipantRole,
  ParticipantRoleSchema,
  type Gender,
  GenderSchema,
  type StudentGrade,
  StudentGradeSchema,
} from "./participant-profile";

export const RosterSourceSchema = z.enum(["PRE_REGISTRATION", "IN_PROGRESS"]);
export type RosterSource = z.infer<typeof RosterSourceSchema>;

export const RosterStatusSchema = z.enum(["ACTIVE", "CANCELLED"]);
export type RosterStatus = z.infer<typeof RosterStatusSchema>;

const BulkParticipantNameSchema = z
  .string()
  .transform(normalizeParticipantName)
  .pipe(z.string().min(1).max(100));

const rosterParticipantProfileFields = {
  role: ParticipantRoleSchema,
  grade: StudentGradeSchema.nullable(),
  gender: GenderSchema.nullable().optional(),
};

function validateRosterParticipantProfile(
  value: { role: ParticipantRole; grade: StudentGrade | null },
  context: z.RefinementCtx,
) {
  if (value.role === "STUDENT" && value.grade === null) {
    context.addIssue({
      code: "custom",
      path: ["grade"],
      message: "학생은 학년이 필요합니다.",
    });
  }
  if (value.role === "TEACHER" && value.grade !== null) {
    context.addIssue({
      code: "custom",
      path: ["grade"],
      message: "담당교사는 학년을 입력하지 않습니다.",
    });
  }
}

export const RosterParticipantProfileSchema = z
  .object(rosterParticipantProfileFields)
  .strict()
  .superRefine(validateRosterParticipantProfile);

export const RosterParticipantInputSchema = z
  .object({
    name: BulkParticipantNameSchema,
    ...rosterParticipantProfileFields,
  })
  .strict()
  .superRefine(validateRosterParticipantProfile);

export type RosterParticipantInput = z.infer<
  typeof RosterParticipantInputSchema
>;

const ExpectedProjectRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});

const RosterParticipantDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    organizationId: OrganizationIdSchema,
    ...rosterParticipantProfileFields,
  })
  .strict()
  .superRefine(validateRosterParticipantProfile);

export const RosterCreateRequestSchema = z.union([
  ExpectedProjectRevisionSchema.extend({
    participantId: ParticipantIdSchema,
    confirmedParticipant: RosterParticipantDetailsSchema,
    expectedParticipantRevision: z.number().int().nonnegative(),
  }).strict(),
  ExpectedProjectRevisionSchema.extend({
    newParticipant: RosterParticipantDetailsSchema,
  }).strict(),
]);

export const BulkRosterCreateRequestSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    participants: z.array(RosterParticipantInputSchema).min(1).max(30),
    confirmDuplicateNames: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type BulkRosterCreateRequest = z.infer<
  typeof BulkRosterCreateRequestSchema
>;

export const BulkParticipantDuplicateKindSchema = z.enum([
  "INPUT_DUPLICATE",
  "EXISTING_PARTICIPANT",
]);

export type BulkParticipantDuplicateKind = z.infer<
  typeof BulkParticipantDuplicateKindSchema
>;

export const BulkParticipantDuplicateSchema = z
  .object({
    name: z.string().min(1).max(100),
    kinds: z.array(BulkParticipantDuplicateKindSchema).min(1),
  })
  .strict();

export type BulkParticipantDuplicate = z.infer<
  typeof BulkParticipantDuplicateSchema
>;

export const BulkParticipantDuplicateDetailsSchema = z
  .object({
    reason: z.literal("DUPLICATE_PARTICIPANT_NAMES"),
    duplicates: z.array(BulkParticipantDuplicateSchema).min(1),
  })
  .strict();

export type BulkParticipantDuplicateDetails = z.infer<
  typeof BulkParticipantDuplicateDetailsSchema
>;

export const BulkRosterCreateResponseSchema = z
  .object({
    batchId: z.string().min(1),
    participants: z.array(
      z
        .object({
          participant: z
            .object({
              id: ParticipantIdSchema,
              participantId: ParticipantIdSchema,
              name: z.string().min(1).max(100),
              organizationId: OrganizationIdSchema,
              revision: z.number().int().nonnegative(),
            })
            .strict(),
          rosterEntry: z
            .object({
              id: z.string().min(1),
              projectId: ProjectIdSchema,
              participantId: ParticipantIdSchema,
              participantNumber: ParticipantIdSchema,
              organizationId: OrganizationIdSchema,
              participantName: z.string().min(1).max(100),
              organizationName: z.string().min(1),
              source: RosterSourceSchema,
              status: RosterStatusSchema,
              role: ParticipantRoleSchema.nullable(),
              grade: StudentGradeSchema.nullable(),
              wasExpectedAtStart: z.boolean(),
              revision: z.number().int().nonnegative(),
              updatedAt: z.string().datetime(),
            })
            .strict(),
        })
        .strict(),
    ),
    projectRevision: z.number().int().nonnegative(),
  })
  .strict();

export type BulkRosterCreateResponse = z.infer<
  typeof BulkRosterCreateResponseSchema
>;

export const RosterPatchRequestSchema = z
  .object({
    status: RosterStatusSchema,
    expectedRevision: z.number().int().nonnegative(),
    expectedEntryRevision: z.number().int().nonnegative(),
  })
  .strict();

export const ProjectParticipantPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    organizationId: OrganizationIdSchema.optional(),
    role: ParticipantRoleSchema.optional(),
    grade: StudentGradeSchema.nullable().optional(),
    gender: GenderSchema.nullable().optional(),
    expectedRevision: z.number().int().nonnegative(),
    expectedProjectRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.organizationId !== undefined ||
      value.role !== undefined ||
      value.grade !== undefined,
  )
  .superRefine((value, context) => {
    const rolePresent = value.role !== undefined;
    const gradePresent = value.grade !== undefined;
    if (rolePresent !== gradePresent) {
      context.addIssue({
        code: "custom",
        path: rolePresent ? ["grade"] : ["role"],
        message: "참가자 구분과 학년을 함께 전송해 주세요.",
      });
      return;
    }
    if (rolePresent && gradePresent) {
      const parsed = RosterParticipantProfileSchema.safeParse({
        role: value.role,
        grade: value.grade,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: "custom",
            path: issue.path,
            message: issue.message,
          });
        }
      }
    }
  });

export const RosterEntrySchema = z.object({
  projectId: ProjectIdSchema,
  participantId: ParticipantIdSchema,
  organizationId: OrganizationIdSchema,
  source: RosterSourceSchema,
  status: RosterStatusSchema,
  role: ParticipantRoleSchema.nullable(),
  grade: StudentGradeSchema.nullable(),
  gender: GenderSchema.nullable(),
  revision: z.number().int().nonnegative(),
});

export type RosterRecordProfile = {
  role: ParticipantRole | null;
  grade: StudentGrade | null;
  gender: Gender | null;
};

export type RosterEntry = z.infer<typeof RosterEntrySchema>;
