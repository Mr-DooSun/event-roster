import { z } from "zod";
import { ParticipantIdSchema } from "./participants";
import {
  ParticipantRoleSchema,
  RosterParticipantProfileSchema,
  StudentGradeSchema,
} from "./roster";

export const NormalizedImportRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    name: z.string().max(100),
    organizationName: z.string().max(100),
    role: ParticipantRoleSchema,
    grade: StudentGradeSchema.nullable(),
    resolvedParticipantId: ParticipantIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
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
  });

export type NormalizedImportRow = z.infer<typeof NormalizedImportRowSchema>;

export const ImportCommitRequestSchema = z.object({
  rows: z.array(NormalizedImportRowSchema).min(1).max(130),
  expectedProjectRevision: z.number().int().nonnegative(),
});
