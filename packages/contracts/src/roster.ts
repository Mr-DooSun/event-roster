import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import { ParticipantIdSchema } from "./participants";
import { ProjectIdSchema } from "./projects";

export const RosterSourceSchema = z.enum(["PRE_REGISTRATION", "IN_PROGRESS"]);
export type RosterSource = z.infer<typeof RosterSourceSchema>;

export const RosterStatusSchema = z.enum(["ACTIVE", "CANCELLED"]);
export type RosterStatus = z.infer<typeof RosterStatusSchema>;

const ExpectedProjectRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});

export const RosterCreateRequestSchema = z.union([
  ExpectedProjectRevisionSchema.extend({
    participantId: ParticipantIdSchema,
  }).strict(),
  ExpectedProjectRevisionSchema.extend({
    newParticipant: z
      .object({
        name: z.string().trim().min(1).max(100),
        organizationId: OrganizationIdSchema,
      })
      .strict(),
  }).strict(),
]);

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
    expectedRevision: z.number().int().nonnegative(),
    expectedProjectRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.organizationId !== undefined,
  );

export const RosterEntrySchema = z.object({
  projectId: ProjectIdSchema,
  participantId: ParticipantIdSchema,
  organizationId: OrganizationIdSchema,
  source: RosterSourceSchema,
  status: RosterStatusSchema,
  revision: z.number().int().nonnegative(),
});

export type RosterEntry = z.infer<typeof RosterEntrySchema>;
