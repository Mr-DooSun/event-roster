import { z } from "zod";

export const OrganizationIdSchema = z.string().trim().min(1);

export const OrganizationSchema = z.object({
  id: OrganizationIdSchema,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
