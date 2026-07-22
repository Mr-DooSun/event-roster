import {
  ImportCommitRequestSchema,
  NormalizedImportRowSchema,
} from "@event-roster/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { IMPORT_LIMIT } from "../db/imports";
import type { Env } from "../env";
import { assertExactOrigin } from "../http/origin";
import { requireActor } from "../middleware/authentication";
import { requireFullSession } from "../middleware/authorization";
import { requireCsrf } from "../middleware/csrf";
import { requireAdministrativeOperator } from "../services/admin";
import {
  commitImport,
  getExportData,
  validateImport,
} from "../services/imports";

const RowsSchema = z.array(NormalizedImportRowSchema).min(1).max(IMPORT_LIMIT);

export const importRoutes = new Hono<{ Bindings: Env }>();

importRoutes.post("/projects/:projectId/imports/validate", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const rows = RowsSchema.parse(await c.req.json());
  return c.json(await validateImport(c.env, c.req.param("projectId"), rows));
});

importRoutes.post("/projects/:projectId/imports/commit", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = ImportCommitRequestSchema.parse(await c.req.json());
  return c.json(
    await commitImport(
      c.env,
      actor,
      c.req.param("projectId"),
      input.rows,
      input.expectedProjectRevision,
    ),
    201,
  );
});

importRoutes.get("/projects/:projectId/exports/roster", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requireFullSession(actor);
  return c.json(await getExportData(c.env, actor, c.req.param("projectId")));
});
