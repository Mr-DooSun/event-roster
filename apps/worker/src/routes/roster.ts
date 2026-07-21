import { RosterStatusSchema } from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import {
  addRosterEntry,
  getAuditPage,
  getRoster,
  getSummary,
  updateRosterEntry,
} from "../services/roster";

const RosterCreateSchema = z.object({
  participantId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
});
const RosterPatchSchema = z.object({
  status: RosterStatusSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedEntryRevision: z.number().int().nonnegative(),
});

export const rosterRoutes = new Hono<{ Bindings: Env }>();

rosterRoutes.get("/events/:eventId/roster", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getRoster(c.env, actor, c.req.param("eventId")));
});

rosterRoutes.post("/events/:eventId/roster", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = RosterCreateSchema.parse(await c.req.json());
  const existing = await c.env.DB.prepare(
    "SELECT 1 AS found FROM event_roster_entries WHERE event_id = ? AND participant_id = ?",
  )
    .bind(c.req.param("eventId"), input.participantId)
    .first<{ found: number }>();
  return c.json(
    await addRosterEntry(
      c.env,
      actor,
      c.req.param("eventId"),
      input.participantId,
      input.expectedRevision,
    ),
    existing ? 200 : 201,
  );
});

rosterRoutes.patch("/events/:eventId/roster/:entryId", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = RosterPatchSchema.parse(await c.req.json());
  return c.json(
    await updateRosterEntry(
      c.env,
      actor,
      c.req.param("eventId"),
      c.req.param("entryId"),
      input,
    ),
  );
});

rosterRoutes.get("/events/:eventId/summary", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getSummary(c.env, actor, c.req.param("eventId")));
});

rosterRoutes.get("/events/:eventId/audit-logs", async (c) => {
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
      c.req.param("eventId"),
      query.limit,
      query.cursor ?? null,
    ),
  );
});
