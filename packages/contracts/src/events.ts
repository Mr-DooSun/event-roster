import { z } from "zod";

export const EventStatusSchema = z.enum([
  "DRAFT",
  "PRE_REGISTRATION",
  "DAY_OF",
  "CLOSED",
]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const HalfSchema = z.enum(["H1", "H2"]);
export type Half = z.infer<typeof HalfSchema>;

export const EventIdSchema = z.string().trim().min(1);

export const CreateEventRequestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  half: HalfSchema,
  name: z.string().trim().min(1).max(100),
});

export interface EventSummary {
  eventId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    expected: number;
    dayOfAdded: number;
    dayOfCancelled: number;
    final: number;
    delta: number;
  }>;
}
