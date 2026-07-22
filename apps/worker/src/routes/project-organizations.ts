import {
  AddProjectOrganizationSchema,
  ProjectOrganizationPatchSchema,
} from "@event-roster/contracts";
import { Hono } from "hono";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import { requireAdministrativeOperator } from "../services/admin";
import {
  addProjectOrganization,
  getProjectOrganizations,
  setProjectOrganizationActive,
} from "../services/project-organizations";

export const projectOrganizationRoutes = new Hono<{ Bindings: Env }>();

projectOrganizationRoutes.get(
  "/projects/:projectId/organizations",
  async (c) => {
    const actor = await requireActor(c.req.raw, c.env);
    requireFullSession(actor);
    return c.json(
      await getProjectOrganizations(c.env, actor, c.req.param("projectId")),
    );
  },
);

projectOrganizationRoutes.post(
  "/projects/:projectId/organizations",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = AddProjectOrganizationSchema.parse(await c.req.json());
    const result = await addProjectOrganization(
      c.env,
      actor,
      c.req.param("projectId"),
      input,
    );
    return c.json(result.organization, result.created ? 201 : 200);
  },
);

projectOrganizationRoutes.patch(
  "/projects/:projectId/organizations/:organizationId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = ProjectOrganizationPatchSchema.parse(await c.req.json());
    return c.json(
      await setProjectOrganizationActive(
        c.env,
        actor,
        c.req.param("projectId"),
        c.req.param("organizationId"),
        input.isActive,
      ),
    );
  },
);
