import { z } from "zod";
import { OrganizationIdSchema } from "./organizations";
import { normalizeParticipantName } from "./participant-names";
import { ParticipantIdSchema } from "./participants";
import { ProjectIdSchema } from "./projects";

export const RosterSourceSchema = z.enum(["PRE_REGISTRATION", "IN_PROGRESS"]);
export type RosterSource = z.infer<typeof RosterSourceSchema>;

export const RosterStatusSchema = z.enum(["ACTIVE", "CANCELLED"]);
export type RosterStatus = z.infer<typeof RosterStatusSchema>;

const BulkParticipantNameSchema = z
  .string()
  .transform(normalizeParticipantName)
  .pipe(z.string().min(1).max(100));

const ExpectedProjectRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});

export const RosterCreateRequestSchema = z.union([
  ExpectedProjectRevisionSchema.extend({
    participantId: ParticipantIdSchema,
    confirmedParticipant: z
      .object({
        name: z.string().trim().min(1).max(100),
        organizationId: OrganizationIdSchema,
      })
      .strict(),
    expectedParticipantRevision: z.number().int().nonnegative(),
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

export const BulkRosterCreateRequestSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    names: z.array(BulkParticipantNameSchema).min(1).max(30),
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
