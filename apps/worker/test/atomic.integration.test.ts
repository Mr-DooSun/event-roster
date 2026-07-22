import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { runGuardedAtomic } from "../src/db/atomic";
import { countRows } from "./support/database";

it("rolls back every statement when the guard is false", async () => {
  await expect(
    runGuardedAtomic(env.DB, {
      guardId: "guard-false",
      guardStatement: env.DB.prepare(
        "INSERT INTO operation_guards (id, ok) VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM projects WHERE id = 'missing-project') THEN 1 ELSE 0 END)",
      ).bind("guard-false"),
      statements: [
        env.DB.prepare(
          "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json) VALUES ('audit-rollback', NULL, 'TEST', 'project', 'missing-project', '2026-07-21', '{}')",
        ),
      ],
      failureCode: "STALE_REVISION",
    }),
  ).rejects.toThrowError("STALE_REVISION");

  expect(await countRows("audit_logs")).toBe(0);
});

it("commits statements and removes a successful guard", async () => {
  await runGuardedAtomic(env.DB, {
    guardId: "guard-true",
    guardStatement: env.DB.prepare(
      "INSERT INTO operation_guards (id, ok) VALUES (?, 1)",
    ).bind("guard-true"),
    statements: [
      env.DB.prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json) VALUES ('audit-commit', NULL, 'TEST', 'project', 'project-1', '2026-07-21', '{}')",
      ),
    ],
    failureCode: "STALE_REVISION",
  });

  expect(await countRows("audit_logs")).toBe(1);
  const guard = await env.DB.prepare(
    "SELECT id FROM operation_guards WHERE id = 'guard-true'",
  ).first();
  expect(guard).toBeNull();
});

it("does not disguise a statement failure as a stale revision", async () => {
  await expect(
    runGuardedAtomic(env.DB, {
      guardId: "guard-sql-error",
      guardStatement: env.DB.prepare(
        "INSERT INTO operation_guards (id, ok) VALUES (?, 1)",
      ).bind("guard-sql-error"),
      statements: [env.DB.prepare("INSERT INTO missing_table (id) VALUES (1)")],
      failureCode: "STALE_REVISION",
    }),
  ).rejects.not.toThrowError("STALE_REVISION");
});
