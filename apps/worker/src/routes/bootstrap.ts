import { LoginIdSchema, PasswordSchema } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireCsrf } from "../middleware/csrf";
import {
  createBootstrapAccount,
  createFirstOperator,
} from "../services/bootstrap";

const BootstrapRequestSchema = z.object({
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(100),
  password: PasswordSchema,
});

const FirstOperatorRequestSchema = z.object({
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(100),
});

export const bootstrapRoutes = new Hono<{ Bindings: Env }>();

bootstrapRoutes.post("/bootstrap", async (c) => {
  if (
    !c.env.BOOTSTRAP_TOKEN ||
    c.req.header("X-Bootstrap-Token") !== c.env.BOOTSTRAP_TOKEN
  ) {
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }
  const input = BootstrapRequestSchema.parse(await c.req.json());
  await createBootstrapAccount(c.env, input);
  return c.json({ created: true }, 201, { "Cache-Control": "no-store" });
});

bootstrapRoutes.post("/bootstrap/first-operator", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  const input = FirstOperatorRequestSchema.parse(await c.req.json());
  const oneTime = await createFirstOperator(c.env, actor, input);
  return c.json(oneTime, 201, { "Cache-Control": "no-store" });
});
