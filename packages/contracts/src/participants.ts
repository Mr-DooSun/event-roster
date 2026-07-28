import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";

export const ParticipantIdSchema = z.string().trim().min(1);

export const ParticipantSchema = z.object({
  participantId: ParticipantIdSchema,
  name: z.string().trim().min(1).max(100),
  organizationId: OrganizationIdSchema,
  suggestedRole: z.enum(["STUDENT", "TEACHER"]).nullable(),
  suggestedGrade: z.enum(["M1", "M2", "M3", "H1", "H2", "H3"]).nullable(),
});

export type Participant = z.infer<typeof ParticipantSchema>;
