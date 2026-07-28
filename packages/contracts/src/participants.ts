import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import {
  ParticipantRoleSchema,
  StudentGradeSchema,
} from "./participant-profile";

export const ParticipantIdSchema = z.string().trim().min(1);

export const ParticipantSchema = z.object({
  participantId: ParticipantIdSchema,
  name: z.string().trim().min(1).max(100),
  organizationId: OrganizationIdSchema,
  suggestedRole: ParticipantRoleSchema.nullable(),
  suggestedGrade: StudentGradeSchema.nullable(),
});

export type Participant = z.infer<typeof ParticipantSchema>;
