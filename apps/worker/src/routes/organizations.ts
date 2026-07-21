import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import {
  createOrganization,
  getOrganizations,
  requireAdministrativeOperator,
  updateOrganization,
} from "../services/admin";

const OrganizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
const OrganizationPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const organizationRoutes = new Hono<{ Bindings: Env }>();

organizationRoutes.get("/organizations", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getOrganizations(c.env, actor));
});

organizationRoutes.post("/organizations", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationCreateSchema.parse(await c.req.json());
  return c.json(await createOrganization(c.env, actor, input.name), 201);
});

organizationRoutes.patch("/organizations/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationPatchSchema.parse(await c.req.json());
  return c.json(
    await updateOrganization(c.env, actor, c.req.param("id"), input),
  );
});
