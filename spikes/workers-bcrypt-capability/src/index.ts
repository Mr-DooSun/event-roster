import { Hono } from "hono";
import { z } from "zod";
import type { CapabilityEnv } from "./env";
import * as bcryptPassword from "./password";

const PROBE_PASSWORD = "event-roster-dummy-account-v1";
const probeRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("hash") }),
  z.strictObject({ operation: z.literal("correct") }),
  z.strictObject({ operation: z.literal("wrong") }),
  z.strictObject({ operation: z.literal("dummy") }),
]);
const runId = z.string().uuid();

export interface PasswordFunctions {
  assertCostTwelveHash(passwordHash: string): void;
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

const defaultPassword: PasswordFunctions = {
  assertCostTwelveHash: bcryptPassword.assertCostTwelveHash,
  hash: bcryptPassword.hashPassword,
  verify: bcryptPassword.verifyPassword,
};

export function constantTimeEqualUtf8(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function createProbeApp(
  env: CapabilityEnv,
  dependencies: { password: PasswordFunctions } = { password: defaultPassword },
) {
  const app = new Hono();

  app.onError((_error, context) =>
    context.json({ error: "capability probe unavailable" }, 500),
  );

  app.post("/probe", async (context) => {
    try {
      dependencies.password.assertCostTwelveHash(env.DUMMY_BCRYPT_HASH);
    } catch {
      return context.json({ error: "capability probe unavailable" }, 500);
    }

    if (
      !constantTimeEqualUtf8(
        context.req.header("X-ER-Probe-Token") ?? "",
        env.CAPABILITY_PROBE_TOKEN,
      )
    ) {
      return context.notFound();
    }

    if (!runId.safeParse(context.req.query("run")).success) {
      return context.notFound();
    }

    const parsed = probeRequest.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return context.notFound();

    if (parsed.data.operation === "hash") {
      const passwordHash = await dependencies.password.hash(PROBE_PASSWORD);
      dependencies.password.assertCostTwelveHash(passwordHash);
      return context.json({ hashed: true });
    }

    const password =
      parsed.data.operation === "correct"
        ? PROBE_PASSWORD
        : "different-password-123";
    const verified = await dependencies.password.verify(
      password,
      env.DUMMY_BCRYPT_HASH,
    );
    return context.json({ verified });
  });

  return app;
}

export default {
  fetch(request: Request, env: CapabilityEnv): Response | Promise<Response> {
    return createProbeApp(env).fetch(request);
  },
};
