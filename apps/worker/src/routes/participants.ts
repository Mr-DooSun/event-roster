import { ProjectParticipantPatchRequestSchema } from "@event-roster/contracts";
import { Hono } from "hono";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import {
  getParticipants,
  updateProjectParticipant,
} from "../services/participants";

export const participantRoutes = new Hono<{ Bindings: Env }>();

participantRoutes.get("/participants", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getParticipants(c.env, actor));
});

participantRoutes.patch(
  "/projects/:projectId/participants/:participantId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireFullSession(actor);
    const input = ProjectParticipantPatchRequestSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await updateProjectParticipant(
        c.env,
        actor,
        c.req.param("projectId"),
        c.req.param("participantId"),
        input,
      ),
    );
  },
);
