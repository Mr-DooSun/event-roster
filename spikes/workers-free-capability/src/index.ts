import { Hono } from "hono";
import {
  isProbeAuthorized,
  type ProbeResponse,
  type ProbeScenario,
  runAtomicProbe,
  runJwtRevocationProbe,
  runPasswordProbe,
  runRollbackProbe,
} from "./probe";

interface CapabilityBindings {
  DB: D1Database;
  PASSWORD_PEPPER: string | undefined;
  JWT_SIGNING_KEY: string | undefined;
  CAPABILITY_PROBE_SECRET: string | undefined;
}

const scenarios = new Set<ProbeScenario>([
  "correct",
  "wrong",
  "nonexistent",
  "jwt-revocation",
  "atomic",
  "rollback",
]);

const app = new Hono<{ Bindings: CapabilityBindings }>();

app.get("/__capability", async (context) => {
  if (
    !isProbeAuthorized(
      context.env.CAPABILITY_PROBE_SECRET,
      context.req.header("X-ER-Capability-Secret"),
    )
  ) {
    return context.notFound();
  }
  const scenarioValue = context.req.query("scenario");
  const runId = context.req.query("runId");
  if (
    !scenarioValue ||
    !scenarios.has(scenarioValue as ProbeScenario) ||
    !runId
  ) {
    return context.json({ error: "invalid capability probe request" }, 400);
  }
  const scenario = scenarioValue as ProbeScenario;
  try {
    let result: ProbeResponse;
    if (
      scenario === "correct" ||
      scenario === "wrong" ||
      scenario === "nonexistent"
    ) {
      if (!context.env.PASSWORD_PEPPER) {
        return context.json({ error: "capability probe unavailable" }, 500);
      }
      result = await runPasswordProbe(scenario, context.env.PASSWORD_PEPPER);
    } else if (scenario === "jwt-revocation") {
      if (!context.env.JWT_SIGNING_KEY) {
        return context.json({ error: "capability probe unavailable" }, 500);
      }
      result = await runJwtRevocationProbe(
        context.env.DB,
        runId,
        context.env.JWT_SIGNING_KEY,
      );
    } else if (scenario === "atomic") {
      result = await runAtomicProbe(context.env.DB, `${runId}-atomic`);
    } else {
      result = await runRollbackProbe(context.env.DB, `${runId}-rollback`);
    }
    console.log(
      JSON.stringify({
        event: "capability-probe",
        runId,
        scenario,
        scenarioPassed: result.scenarioPassed,
      }),
    );
    return context.json(result);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "capability-probe-error",
        runId,
        scenario,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return context.json({ error: "capability probe failed" }, 500);
  }
});

export default app;
