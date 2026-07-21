import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import {
  createParticipant,
  getParticipants,
  updateParticipant,
} from "../services/participants";

const ParticipantCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  organizationId: z.string().trim().min(1),
});
const ParticipantPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    organizationId: z.string().trim().min(1).optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.name !== undefined || value.organizationId !== undefined,
  );

export const participantRoutes = new Hono<{ Bindings: Env }>();

participantRoutes.get("/participants", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getParticipants(c.env, actor));
});

participantRoutes.post("/participants", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = ParticipantCreateSchema.parse(await c.req.json());
  return c.json(await createParticipant(c.env, actor, input), 201);
});

participantRoutes.patch("/participants/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = ParticipantPatchSchema.parse(await c.req.json());
  return c.json(
    await updateParticipant(c.env, actor, c.req.param("id"), input),
  );
});
