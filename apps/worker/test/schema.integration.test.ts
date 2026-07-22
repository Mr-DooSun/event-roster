import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { countRows, insertOrganization } from "./support/database";
import { IDS } from "./support/ids";

describe("initial D1 schema", () => {
  it("rejects duplicate canonical login IDs and validates project date order", async () => {
    await insertOrganization(IDS.organization, "조직 A");
    await env.DB.prepare(
      "INSERT INTO users (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPERATOR', 1, 0, 1, ?, ?)",
    )
      .bind(IDS.user, "minsu", "minsu", "김민수", "2026-07-21", "2026-07-21")
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO users (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPERATOR', 1, 0, 1, ?, ?)",
      )
        .bind(
          IDS.secondUser,
          "MinSu",
          "minsu",
          "다른 사용자",
          "2026-07-21",
          "2026-07-21",
        )
        .run(),
    ).rejects.toThrow();

    for (const id of [IDS.project, "project-2"]) {
      await env.DB.prepare(
        `INSERT INTO projects
         (id, name, start_date, end_date, status, revision, created_by,
          created_at, updated_at)
         VALUES (?, '같은 이름', '2026-05-22', '2026-05-23', 'PREPARING', 0, ?, ?, ?)`,
      )
        .bind(id, IDS.user, "2026-07-21", "2026-07-21")
        .run();
    }
    await expect(
      env.DB.prepare(
        `INSERT INTO projects
         (id, name, start_date, end_date, status, revision, created_by,
          created_at, updated_at)
         VALUES ('project-invalid', '역전', '2026-05-24', '2026-05-23',
                 'PREPARING', 0, ?, ?, ?)`,
      )
        .bind(IDS.user, "2026-07-21", "2026-07-21")
        .run(),
    ).rejects.toThrow();
  });

  it("enforces foreign keys and append-only logs", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO user_organizations (user_id, organization_id) VALUES ('missing-user', 'missing-org')",
      ).run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json) VALUES (?, NULL, 'TEST', 'schema', 'schema', ?, '{}')",
    )
      .bind(IDS.audit, "2026-07-21")
      .run();
    expect(await countRows("audit_logs")).toBe(1);

    await expect(
      env.DB.prepare("UPDATE audit_logs SET action = 'MUTATED' WHERE id = ?")
        .bind(IDS.audit)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM audit_logs WHERE id = ?")
        .bind(IDS.audit)
        .run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO security_events (id, event_type, occurred_at, details_json) VALUES ('security-1', 'TEST', ?, '{}')",
    )
      .bind("2026-07-21")
      .run();
    expect(await countRows("security_events")).toBe(1);
    await expect(
      env.DB.prepare(
        "UPDATE security_events SET event_type = 'MUTATED' WHERE id = 'security-1'",
      ).run(),
    ).rejects.toThrow();
  });
});
