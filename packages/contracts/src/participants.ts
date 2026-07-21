import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";

export const ParticipantIdSchema = z.string().trim().min(1);

export const ParticipantSchema = z.object({
  participantId: ParticipantIdSchema,
  name: z.string().trim().min(1).max(100),
  organizationId: OrganizationIdSchema,
});

export type Participant = z.infer<typeof ParticipantSchema>;
