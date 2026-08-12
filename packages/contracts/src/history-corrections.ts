import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import {
  GenderSchema,
  type ParticipantRole,
  ParticipantRoleSchema,
  RosterParticipantProfileSchema,
  RosterStatusSchema,
  type StudentGrade,
  StudentGradeSchema,
} from "./roster";

export interface ClosedProjectCorrectionCandidateOrganization {
  id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
}

export interface ClosedProjectCorrectionCandidateParticipant {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
  suggestedRole: ParticipantRole | null;
  suggestedGrade: StudentGrade | null;
}

export const ClosedProjectRosterPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    organizationId: OrganizationIdSchema.optional(),
    role: ParticipantRoleSchema.optional(),
    grade: StudentGradeSchema.nullable().optional(),
    gender: GenderSchema.nullable().optional(),
    status: RosterStatusSchema.optional(),
    expectedProjectRevision: z.number().int().nonnegative(),
    expectedEntryRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.organizationId !== undefined ||
      value.role !== undefined ||
      value.grade !== undefined ||
      value.gender !== undefined ||
      value.status !== undefined,
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
    if (!rolePresent || !gradePresent) return;
    const parsed = RosterParticipantProfileSchema.safeParse({
      role: value.role,
      grade: value.grade,
    });
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });
