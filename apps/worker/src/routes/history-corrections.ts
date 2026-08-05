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
  correctClosedProjectOrganization,
  getClosedCorrectionCandidates,
  setClosedProjectOrganizationActive,
} from "../services/history-corrections";

export const historyCorrectionRoutes = new Hono<{ Bindings: Env }>();

historyCorrectionRoutes.get(
  "/projects/:projectId/history-corrections/candidates",
  async (c) => {
    const actor = await requireActor(c.req.raw, c.env);
    requireFullSession(actor);
    return c.json(
      await getClosedCorrectionCandidates(
        c.env,
        actor,
        c.req.param("projectId"),
      ),
    );
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/organizations",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = AddProjectOrganizationSchema.parse(await c.req.json());
    const result = await correctClosedProjectOrganization(
      c.env,
      actor,
      c.req.param("projectId"),
      input,
    );
    const { created, ...mutation } = result;
    return c.json(mutation, created ? 201 : 200);
  },
);

historyCorrectionRoutes.patch(
  "/projects/:projectId/history-corrections/organizations/:organizationId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = ProjectOrganizationPatchSchema.parse(await c.req.json());
    return c.json(
      await setClosedProjectOrganizationActive(
        c.env,
        actor,
        c.req.param("projectId"),
        c.req.param("organizationId"),
        input,
      ),
    );
  },
);
