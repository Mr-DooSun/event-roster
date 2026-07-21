import {
  CreateEventRequestSchema,
  EventStatusSchema,
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
  changeEventStatus,
  createEvent,
  getEvents,
  updateEvent,
} from "../services/events";

const EventPatchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
});
const EventTransitionSchema = z.object({
  targetStatus: EventStatusSchema,
  expectedRevision: z.number().int().nonnegative(),
});

export const eventRoutes = new Hono<{ Bindings: Env }>();

eventRoutes.get("/events", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getEvents(c.env));
});

eventRoutes.post("/events", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = CreateEventRequestSchema.parse(await c.req.json());
  return c.json(await createEvent(c.env, actor, input), 201);
});

eventRoutes.patch("/events/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = EventPatchSchema.parse(await c.req.json());
  return c.json(await updateEvent(c.env, actor, c.req.param("id"), input));
});

eventRoutes.post("/events/:id/transition", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireOperator(actor);
  if (actor.session.user.isBootstrap) requireAdministrativeOperator(actor);
  const input = EventTransitionSchema.parse(await c.req.json());
  return c.json(
    await changeEventStatus(
      c.env,
      actor,
      c.req.param("id"),
      input.targetStatus,
      input.expectedRevision,
    ),
  );
});
