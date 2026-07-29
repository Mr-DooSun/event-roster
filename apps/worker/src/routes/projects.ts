import {
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
  ProjectStatusSchema,
  RestoreProjectRequestSchema,
  UpdateProjectRequestSchema,
} from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import {
  requireFullSession,
  requireOperator,
} from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import { requireAdministrativeOperator } from "../services/admin";
import {
  changeProjectStatus,
  createProject,
  getProject,
  getProjects,
  restoreProject,
  softDeleteProject,
  updateProject,
} from "../services/projects";

const ProjectTransitionSchema = z.object({
  targetStatus: ProjectStatusSchema,
  expectedRevision: z.number().int().nonnegative(),
});

const IncludeDeletedQuerySchema = z.object({
  includeDeleted: z.enum(["true"]).optional(),
});

export const projectRoutes = new Hono<{ Bindings: Env }>();

projectRoutes.get("/projects", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = IncludeDeletedQuerySchema.parse(c.req.query());
  return c.json(
    await getProjects(c.env, actor, query.includeDeleted === "true"),
  );
});

projectRoutes.get("/projects/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = IncludeDeletedQuerySchema.parse(c.req.query());
  return c.json(
    await getProject(
      c.env,
      actor,
      c.req.param("id"),
      query.includeDeleted === "true",
    ),
  );
});

projectRoutes.post("/projects", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = CreateProjectRequestSchema.parse(await c.req.json());
  return c.json(await createProject(c.env, actor, input), 201);
});

projectRoutes.patch("/projects/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = UpdateProjectRequestSchema.parse(await c.req.json());
  return c.json(await updateProject(c.env, actor, c.req.param("id"), input));
});

projectRoutes.delete("/projects/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = DeleteProjectRequestSchema.parse(await c.req.json());
  return c.json(
    await softDeleteProject(c.env, actor, c.req.param("id"), input),
  );
});

projectRoutes.post("/projects/:id/restore", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = RestoreProjectRequestSchema.parse(await c.req.json());
  return c.json(await restoreProject(c.env, actor, c.req.param("id"), input));
});

projectRoutes.post("/projects/:id/transition", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireOperator(actor);
  if (actor.session.user.isBootstrap) requireAdministrativeOperator(actor);
  const input = ProjectTransitionSchema.parse(await c.req.json());
  return c.json(
    await changeProjectStatus(
      c.env,
      actor,
      c.req.param("id"),
      input.targetStatus,
      input.expectedRevision,
    ),
  );
});
