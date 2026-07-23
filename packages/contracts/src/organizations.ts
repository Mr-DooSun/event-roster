import { z } from "zod";
import { LoginIdSchema } from "./auth";

export const OrganizationIdSchema = z.string().trim().min(1);
export const OrganizationAssignmentRoleSchema = z.enum([
  "PRIMARY_LEADER",
  "MANAGER",
]);
export type OrganizationAssignmentRole = z.infer<
  typeof OrganizationAssignmentRoleSchema
>;

export const OrganizationSchema = z.object({
  id: OrganizationIdSchema,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export interface OrganizationManager {
  userId: string;
  loginId: string;
  displayName: string;
  isActive: boolean;
  assignmentRole: OrganizationAssignmentRole;
  assignedAt: string;
}

export interface OrganizationProject {
  projectId: string;
  projectName: string;
  projectStatus: "PREPARING" | "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED";
  membershipIsActive: boolean;
}

export interface OrganizationSummary extends Organization {
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  projectCount: number;
}

export interface OrganizationDetail extends OrganizationSummary {
  managers: OrganizationManager[];
  projects: OrganizationProject[];
}

export const OrganizationPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.isActive !== undefined);

export const OrganizationManagerCreateRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("EXISTING"),
        userId: z.string().trim().min(1),
        assignmentRole: OrganizationAssignmentRoleSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("NEW"),
        loginId: LoginIdSchema,
        displayName: z.string().trim().min(1).max(100),
        assignmentRole: OrganizationAssignmentRoleSchema,
      })
      .strict(),
  ],
);
export type OrganizationManagerCreateRequest = z.infer<
  typeof OrganizationManagerCreateRequestSchema
>;

export const OrganizationPrimaryPatchRequestSchema = z
  .object({
    userId: z.string().trim().min(1).nullable(),
    expectedPrimaryUserId: z.string().trim().min(1).nullable(),
    previousPrimaryDisposition: z.enum(["REMOVE", "MANAGER"]),
  })
  .strict()
  .refine(
    (value) =>
      value.userId !== null || value.previousPrimaryDisposition === "REMOVE",
    { path: ["previousPrimaryDisposition"] },
  );
export type OrganizationPrimaryPatchRequest = z.infer<
  typeof OrganizationPrimaryPatchRequestSchema
>;

const ExpectedProjectRevisionSchema = z.number().int().min(0);
export const AddProjectOrganizationSchema = z.union([
  z
    .object({
      organizationId: OrganizationIdSchema,
      expectedProjectRevision: ExpectedProjectRevisionSchema,
    })
    .strict(),
  z
    .object({
      newOrganizationName: z.string().trim().min(1).max(100),
      expectedProjectRevision: ExpectedProjectRevisionSchema,
    })
    .strict(),
]);
export type AddProjectOrganization = z.infer<
  typeof AddProjectOrganizationSchema
>;

export const ProjectOrganizationPatchSchema = z
  .object({
    isActive: z.boolean(),
    expectedProjectRevision: ExpectedProjectRevisionSchema,
  })
  .strict();
export type ProjectOrganizationPatch = z.infer<
  typeof ProjectOrganizationPatchSchema
>;

export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasHistory: boolean;
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  rosterCount: number;
}

export interface ProjectOrganizationMutationResult {
  organization: ProjectOrganization;
  projectRevision: number;
}
