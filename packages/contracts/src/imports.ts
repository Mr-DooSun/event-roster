import { z } from "zod";
import { ParticipantIdSchema } from "./participants";

export const NormalizedImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string().max(100),
  organizationName: z.string().max(100),
  resolvedParticipantId: ParticipantIdSchema.optional(),
});

export type NormalizedImportRow = z.infer<typeof NormalizedImportRowSchema>;

export const ImportCommitRequestSchema = z.object({
  rows: z.array(NormalizedImportRowSchema).min(1).max(130),
  expectedProjectRevision: z.number().int().nonnegative(),
});
