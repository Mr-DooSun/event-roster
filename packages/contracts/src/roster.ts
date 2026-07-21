import { z } from "zod";
import { EventIdSchema } from "./events";
import { OrganizationIdSchema } from "./organizations";
import { ParticipantIdSchema } from "./participants";

export const RosterSourceSchema = z.enum(["PRE_EVENT", "DAY_OF"]);
export type RosterSource = z.infer<typeof RosterSourceSchema>;

export const RosterStatusSchema = z.enum(["ACTIVE", "CANCELLED"]);
export type RosterStatus = z.infer<typeof RosterStatusSchema>;

export const RosterEntrySchema = z.object({
  eventId: EventIdSchema,
  participantId: ParticipantIdSchema,
  organizationId: OrganizationIdSchema,
  source: RosterSourceSchema,
  status: RosterStatusSchema,
  revision: z.number().int().nonnegative(),
});

export type RosterEntry = z.infer<typeof RosterEntrySchema>;
