import {
  AddProjectOrganizationSchema,
  AddProjectOrganizationsBulkSchema,
  BulkRosterCreateRequestSchema,
  ClosedProjectRosterPatchRequestSchema,
  ImportCommitRequestSchema,
  NormalizedImportRowSchema,
  ProjectOrganizationPatchSchema,
  RosterCreateRequestSchema,
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
  commitClosedProjectImport,
  correctClosedProjectOrganization,
  correctClosedProjectOrganizationsBulk,
  correctClosedProjectRoster,
  correctClosedProjectRosterBulk,
  getClosedCorrectionCandidates,
  patchClosedProjectRoster,
  setClosedProjectOrganizationActive,
  validateClosedProjectImport,
} from "../services/history-corrections";

const RowsSchema = z.array(NormalizedImportRowSchema).min(1).max(IMPORT_LIMIT);

export const historyCorrectionRoutes = new Hono<{ Bindings: Env }>();

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/imports/validate",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const rows = RowsSchema.parse(await c.req.json());
    return c.json(
      await validateClosedProjectImport(
        c.env,
        actor,
        c.req.param("projectId"),
        rows,
      ),
    );
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/imports/commit",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = ImportCommitRequestSchema.parse(await c.req.json());
    return c.json(
      await commitClosedProjectImport(
        c.env,
        actor,
        c.req.param("projectId"),
        input.rows,
        input.expectedProjectRevision,
      ),
      201,
    );
  },
);

historyCorrectionRoutes.get(
  "/projects/:projectId/history-corrections/candidates",
  async (c) => {
    const actor = await requireActor(c.req.raw, c.env);
    requireFullSession(actor);
    return c.json(
      await getClosedCorrectionCandidates(
        c.env,
        actor,
        c.req.param("projectId"),
      ),
    );
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/organizations",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = AddProjectOrganizationSchema.parse(await c.req.json());
    const result = await correctClosedProjectOrganization(
      c.env,
      actor,
      c.req.param("projectId"),
      input,
    );
    const { created, ...mutation } = result;
    return c.json(mutation, created ? 201 : 200);
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/organizations/bulk",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = AddProjectOrganizationsBulkSchema.parse(await c.req.json());
    return c.json(
      await correctClosedProjectOrganizationsBulk(
        c.env,
        actor,
        c.req.param("projectId"),
        input,
      ),
    );
  },
);

historyCorrectionRoutes.patch(
  "/projects/:projectId/history-corrections/organizations/:organizationId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = ProjectOrganizationPatchSchema.parse(await c.req.json());
    return c.json(
      await setClosedProjectOrganizationActive(
        c.env,
        actor,
        c.req.param("projectId"),
        c.req.param("organizationId"),
        input,
      ),
    );
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/roster",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = RosterCreateRequestSchema.parse(await c.req.json());
    const mutation = await correctClosedProjectRoster(
      c.env,
      actor,
      c.req.param("projectId"),
      input,
    );
    return c.json(mutation.result, mutation.created ? 201 : 200);
  },
);

historyCorrectionRoutes.post(
  "/projects/:projectId/history-corrections/roster/bulk",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = BulkRosterCreateRequestSchema.parse(await c.req.json());
    return c.json(
      await correctClosedProjectRosterBulk(
        c.env,
        actor,
        c.req.param("projectId"),
        input,
      ),
      201,
    );
  },
);

historyCorrectionRoutes.patch(
  "/projects/:projectId/history-corrections/roster/:entryId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    const input = ClosedProjectRosterPatchRequestSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await patchClosedProjectRoster(
        c.env,
        actor,
        c.req.param("projectId"),
        c.req.param("entryId"),
        input,
      ),
    );
  },
);
