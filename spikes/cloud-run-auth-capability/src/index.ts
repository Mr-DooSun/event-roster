import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "./env";
import {
  constantTimeEqualUtf8,
  createPasswordServiceClient,
} from "./kdf-client";

const ProbeRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("hash"),
    password: z.string().min(12).max(128),
  }),
  z.object({
    operation: z.literal("verify"),
    password: z.string().min(12).max(128),
    phc: z.string().min(1),
  }),
  z.object({
    operation: z.literal("verifyDummy"),
    password: z.string().min(12).max(128),
  }),
  z.object({
    operation: z.literal("corruptSignature"),
    password: z.string().min(12).max(128),
  }),
]);

const app = new Hono<{ Bindings: Env }>();

app.post("/probe", async (context) => {
  const suppliedToken = context.req.header("X-ER-Probe-Token") ?? "";
  if (
    !envIsConfigured(context.env) ||
    !(await constantTimeEqualUtf8(
      suppliedToken,
      context.env.CAPABILITY_PROBE_TOKEN,
    ))
  ) {
    return context.notFound();
  }

  let rawInput: unknown;
  try {
    rawInput = await context.req.json();
  } catch {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const parsed = ProbeRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const result = await createPasswordServiceClient(context.env).execute(
    parsed.data,
  );
  return context.json(result);
});

function envIsConfigured(env: Env): boolean {
  return Boolean(
    env.PASSWORD_SERVICE_URL.trim() &&
      env.AUTH_KDF_SHARED_SECRET.trim() &&
      env.CAPABILITY_PROBE_TOKEN.trim(),
  );
}

export default app;
