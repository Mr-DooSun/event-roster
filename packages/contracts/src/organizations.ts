import { z } from "zod";

export const OrganizationIdSchema = z.string().trim().min(1);

export const OrganizationSchema = z.object({
  id: OrganizationIdSchema,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
});

export const OrganizationPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.isActive !== undefined);

export type Organization = z.infer<typeof OrganizationSchema>;

export const AddProjectOrganizationSchema = z.union([
  z.object({ organizationId: OrganizationIdSchema }).strict(),
  z
    .object({
      newOrganizationName: z.string().trim().min(1).max(100),
    })
    .strict(),
]);

export const ProjectOrganizationPatchSchema = z.object({
  isActive: z.boolean(),
});

export type AddProjectOrganization = z.infer<
  typeof AddProjectOrganizationSchema
>;

export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasHistory: boolean;
}
