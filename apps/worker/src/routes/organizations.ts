import {
  OrganizationManagerCreateRequestSchema,
  OrganizationPatchRequestSchema,
  OrganizationPrimaryPatchRequestSchema,
} from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import { requireAdministrativeOperator } from "../services/admin";
import {
  assignOrganizationManager,
  createOrganization,
  getAssignableManagerAccounts,
  getOrganizationAuditPage,
  getOrganizationDetail,
  getOrganizationSummaries,
  removeOrganizationManager,
  replaceOrganizationPrimary,
  updateOrganization,
} from "../services/organizations";

const OrganizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const OrganizationListQuerySchema = z
  .object({
    query: z.string().trim().max(100).default(""),
    status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
    leaderStatus: z.enum(["ALL", "ASSIGNED", "UNASSIGNED"]).default("ALL"),
  })
  .strict();

const AssignableQuerySchema = z
  .object({
    query: z.string().trim().max(100).default(""),
  })
  .strict();

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const organizationRoutes = new Hono<{ Bindings: Env }>();

organizationRoutes.get("/organizations", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = OrganizationListQuerySchema.parse(c.req.query());
  return c.json(await getOrganizationSummaries(c.env, actor, query));
});

organizationRoutes.get("/organizations/:id/assignable-users", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = AssignableQuerySchema.parse(c.req.query());
  return c.json(
    await getAssignableManagerAccounts(
      c.env,
      actor,
      c.req.param("id"),
      query.query,
    ),
  );
});

organizationRoutes.get("/organizations/:id/audit", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = AuditQuerySchema.parse(c.req.query());
  return c.json(
    await getOrganizationAuditPage(
      c.env,
      actor,
      c.req.param("id"),
      query.limit,
      query.cursor ?? null,
    ),
  );
});

organizationRoutes.get("/organizations/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getOrganizationDetail(c.env, actor, c.req.param("id")));
});

organizationRoutes.post("/organizations/:id/managers", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationManagerCreateRequestSchema.parse(
    await c.req.json(),
  );
  const result = await assignOrganizationManager(
    c.env,
    actor,
    c.req.param("id"),
    input,
  );
  return result.temporaryPassword
    ? c.json(result, 201, { "Cache-Control": "no-store" })
    : c.json(result, 201);
});

organizationRoutes.patch("/organizations/:id/primary", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationPrimaryPatchRequestSchema.parse(await c.req.json());
  return c.json(
    await replaceOrganizationPrimary(c.env, actor, c.req.param("id"), input),
  );
});

organizationRoutes.delete("/organizations/:id/managers/:userId", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  await removeOrganizationManager(
    c.env,
    actor,
    c.req.param("id"),
    c.req.param("userId"),
  );
  return c.body(null, 204);
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
  const input = OrganizationPatchRequestSchema.parse(await c.req.json());
  return c.json(
    await updateOrganization(c.env, actor, c.req.param("id"), input),
  );
});
