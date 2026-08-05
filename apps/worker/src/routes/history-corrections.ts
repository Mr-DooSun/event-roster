import { Hono } from "hono";
import type { Env } from "../env";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { getClosedCorrectionCandidates } from "../services/history-corrections";

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
