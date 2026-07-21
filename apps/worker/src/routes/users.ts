import { LoginIdSchema, RoleSchema } from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireCsrf } from "../middleware/csrf";
import {
  createUser,
  getUsers,
  requireAdministrativeOperator,
  resetUserPassword,
  updateUser,
} from "../services/admin";

const UserCreateSchema = z.object({
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(100),
  role: RoleSchema,
  organizationIds: z
    .array(z.string().min(1))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
});
const UserPatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: RoleSchema.optional(),
    isActive: z.boolean().optional(),
    organizationIds: z
      .array(z.string().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const userRoutes = new Hono<{ Bindings: Env }>();

userRoutes.get("/users", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireAdministrativeOperator(actor);
  return c.json(await getUsers(c.env));
});

userRoutes.post("/users", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = UserCreateSchema.parse(await c.req.json());
  return c.json(await createUser(c.env, actor, input), 201, {
    "Cache-Control": "no-store",
  });
});

userRoutes.patch("/users/:id", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = UserPatchSchema.parse(await c.req.json());
  return c.json(await updateUser(c.env, actor, c.req.param("id"), input));
});

userRoutes.post("/users/:id/password-reset", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  return c.json(await resetUserPassword(c.env, actor, c.req.param("id")), 200, {
    "Cache-Control": "no-store",
  });
});
