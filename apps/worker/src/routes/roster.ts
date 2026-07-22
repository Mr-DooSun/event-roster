import {
  RosterCreateRequestSchema,
  RosterPatchRequestSchema,
} from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import { createParticipantAndAddToProject } from "../services/participants";
import {
  addRosterEntry,
  getAuditPage,
  getRoster,
  getSummary,
  updateRosterEntry,
} from "../services/roster";

export const rosterRoutes = new Hono<{ Bindings: Env }>();

rosterRoutes.get("/projects/:projectId/roster", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getRoster(c.env, actor, c.req.param("projectId")));
});

rosterRoutes.post("/projects/:projectId/roster", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = RosterCreateRequestSchema.parse(await c.req.json());
  if ("newParticipant" in input) {
    return c.json(
      await createParticipantAndAddToProject(
        c.env,
        actor,
        c.req.param("projectId"),
        { ...input.newParticipant, expectedRevision: input.expectedRevision },
      ),
      201,
    );
  }
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS found FROM project_roster_entries
     WHERE project_id = ? AND participant_id = ?`,
  )
    .bind(c.req.param("projectId"), input.participantId)
    .first<{ found: number }>();
  return c.json(
    await addRosterEntry(
      c.env,
      actor,
      c.req.param("projectId"),
      input.participantId,
      input.expectedRevision,
      input.confirmedParticipant,
      input.expectedParticipantRevision,
    ),
    existing ? 200 : 201,
  );
});

rosterRoutes.patch("/projects/:projectId/roster/:entryId", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = RosterPatchRequestSchema.parse(await c.req.json());
  return c.json(
    await updateRosterEntry(
      c.env,
      actor,
      c.req.param("projectId"),
      c.req.param("entryId"),
      input,
    ),
  );
});

rosterRoutes.get("/projects/:projectId/summary", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getSummary(c.env, actor, c.req.param("projectId")));
});

rosterRoutes.get("/projects/:projectId/audit", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().min(1).optional(),
    })
    .parse(c.req.query());
  return c.json(
    await getAuditPage(
      c.env,
      actor,
      c.req.param("projectId"),
      query.limit,
      query.cursor ?? null,
    ),
  );
});
