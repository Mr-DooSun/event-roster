import {
  LoginIdSchema,
  LoginRequestSchema,
  PasswordChangeRequestSchema,
  PasswordSchema,
} from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { Hono } from "hono";
import { z } from "zod";
import { clearRefreshCookie, refreshCookieName } from "../auth/refresh-token";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { getClientIp } from "../http/request-context";
import { requireActor } from "../middleware/authentication";
import { requireCsrf } from "../middleware/csrf";
import {
  changePassword,
  loginWithCredentials,
  refreshAuthentication,
  revokeByRefreshToken,
} from "../services/auth";
import { recoverAccount } from "../services/recovery";

const RecoveryRequestSchema = z.object({
  loginId: LoginIdSchema,
  recoveryCode: z.string().min(1).max(200),
  newPassword: PasswordSchema,
});

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/auth/login", async (c) => {
  const input = LoginRequestSchema.parse(await c.req.json());
  const result = await loginWithCredentials(c.env, {
    ...input,
    clientIp: getClientIp(c.req.raw),
  });

  return c.json(result.body, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": result.refreshCookie,
  });
});

authRoutes.post("/auth/refresh", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const rawRefresh = readCookie(c.req.raw, refreshCookieName);
  if (!rawRefresh) throw new DomainError("AUTHENTICATION_REQUIRED");
  const result = await refreshAuthentication(c.env, rawRefresh);

  return c.json(result.body, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": result.refreshCookie,
  });
});

authRoutes.post("/auth/logout", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const rawRefresh = readCookie(c.req.raw, refreshCookieName);
  if (c.req.header("Authorization")) {
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
  }
  await revokeByRefreshToken(c.env, rawRefresh);
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": clearRefreshCookie(),
    },
  });
});

authRoutes.post("/auth/change-password", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  const input = PasswordChangeRequestSchema.parse(await c.req.json());
  await changePassword(c.env, actor, input.currentPassword, input.newPassword);

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": clearRefreshCookie(),
    },
  });
});

authRoutes.post("/auth/recover", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const input = RecoveryRequestSchema.parse(await c.req.json());
  await recoverAccount(c.env, input);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
});

authRoutes.get("/auth/me", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  return c.json(
    {
      sessionKind: actor.session.kind,
      user: {
        id: actor.session.user.id,
        loginId: actor.session.user.loginId,
        displayName: actor.session.user.displayName,
        role: actor.session.user.role,
        organizationIds: actor.session.user.organizationIds,
        isBootstrap: actor.session.user.isBootstrap,
      },
    },
    200,
    { "Cache-Control": "no-store" },
  );
});

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}
