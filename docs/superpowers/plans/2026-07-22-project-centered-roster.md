# Project-Centered Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행사 연도·상/하반기 모델을 이름과 선택 날짜를 가진 프로젝트 모델로 교체하고, 프로젝트별 조직 연결·재사용 가능한 참가자·KST 자동 종료·B형 프로젝트 그리드를 기존 Worker+D1 서비스에 통합한다.

**Architecture:** 전역 `organizations`와 `participants` 마스터는 유지하고 `projects`와 `project_organizations`가 프로젝트 운영 범위를 소유한다. 기존 행사 명단·예상 스냅샷·import·감사는 UUID를 보존한 채 프로젝트 테이블로 이관하며, HTTP mutation guard와 같은 Worker의 daily scheduled handler가 종료일 이후 쓰기를 차단한다. React는 `/projects` 카드 그리드와 `/projects/:projectId` 네 탭 상세 화면으로 전환한다.

**Tech Stack:** Node 22, pnpm 10.28.1, TypeScript strict, React 19, Vite 8, Hono, Zod, Cloudflare Workers Static Assets/D1/Cron Triggers, Vitest, `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright, SheetJS 0.20.3, Biome.

## Global Constraints

- 승인 명세는 `docs/superpowers/specs/2026-07-22-project-centered-roster-design.md`이며 충돌 시 이 문서보다 명세가 우선한다.
- `events`, `year`, `half`, `DRAFT`, `DAY_OF`, `EVENT_CLOSED`는 최종 사용자 API·계약·활성 코드·UI에 남기지 않는다.
- 프로젝트 상태는 정확히 `PREPARING`, `PRE_REGISTRATION`, `IN_PROGRESS`, `CLOSED`다.
- 프로젝트 이름은 trim 후 1–100자이며 중복 이름을 허용한다.
- `startDate`와 `endDate`는 각각 선택 가능한 `YYYY-MM-DD` 달력 날짜이고 둘 다 있으면 `endDate >= startDate`다.
- 프로젝트 생성일은 입력받지 않고 서버가 UTC ISO 시각으로 기록한다.
- 종료 프로젝트에서는 운영자의 시작일·종료일 변경만 허용하고 이름·조직·명단 mutation은 재개 전까지 차단한다.
- 종료일이 없으면 수동 종료, 있으면 KST 종료일 당일 23:59:59 이후 mutation 차단과 scheduled 영속화를 적용한다.
- scheduled handler cron은 UTC `0 15 * * *` 하나만 사용하고 한 번에 최대 50개 프로젝트를 처리한다.
- `PRE_REGISTRATION → IN_PROGRESS`에서 조직별 예상 인원과 활성 사전 명단을 한 번만 고정한다.
- 조직·참가자는 전역 마스터이며 프로젝트에 조직이나 과거 명단을 자동 복사하지 않는다.
- 프로젝트 조직 비활성화는 신규 명단/import만 차단하고 기존 명단 조회·수정·취소·집계를 보존한다.
- 참가자 마스터의 현재 이름·소속을 갱신해도 프로젝트 명단의 이름·조직 스냅샷은 바꾸지 않는다.
- roster source는 정확히 `PRE_REGISTRATION`, `IN_PROGRESS`; status는 `ACTIVE`, `CANCELLED`다.
- Excel 원본은 브라우저 밖으로 전송·보관하지 않으며 import 1–130행 전체 성공 또는 전체 rollback을 유지한다.
- 인증, JWT/refresh 회전, CSRF, bootstrap, recovery, 계정 관리의 기존 보안 계약을 변경하지 않는다.
- 기존 `0001_initial.sql`은 수정하지 않고 최종 migration은 `0002_project_model.sql` 하나다.
- Task 2의 migration은 중간 호환 단계로 시작하지만 Task 5에서 같은 파일을 최종 schema로 완성한다. 중간 커밋은 배포하지 않는다.
- 실제 Cloudflare D1 migration, Cron, Worker 배포는 모든 Task와 전체 검증이 끝난 뒤 별도 사용자 승인을 받아 수행한다.
- 각 Task는 RED 테스트 → RED 확인 → 최소 구현 → GREEN 확인 → 관련 전체 검사 → 커밋 순서를 지킨다.

## Target File Structure

```text
packages/contracts/src/
├── projects.ts                 # 프로젝트 DTO, 상태, 날짜, summary
├── organizations.ts            # 전역 조직과 프로젝트 조직 DTO
├── roster.ts                   # 프로젝트 roster source/entry
└── common.ts                   # PROJECT_CLOSED 문제 코드
packages/domain/src/
├── project-lifecycle.ts        # 수동 상태 전환
├── project-expiration.ts       # KST 날짜와 만료 판정
└── summary.ts                  # ProjectSummary 계산
apps/worker/
├── migrations/0002_project_model.sql
├── src/db/{projects,project-organizations,roster}.ts
├── src/services/{projects,project-organizations,project-expiration,roster,imports}.ts
├── src/routes/{projects,project-organizations,roster,imports}.ts
└── test/{project-migration,projects,project-organizations,project-expiration}.integration.test.ts
apps/web/src/features/projects/
├── ProjectFormDialog.tsx
├── ProjectCard.tsx
├── ProjectsPage.tsx
├── ProjectDetailPage.tsx
├── ProjectOverview.tsx
└── ProjectOrganizationsPanel.tsx
```

---

### Task 1: Add project contracts and pure domain rules without breaking the legacy runtime

**Files:**
- Create: `packages/contracts/src/projects.ts`
- Create: `packages/domain/src/project-lifecycle.ts`
- Create: `packages/domain/src/project-expiration.ts`
- Create: `packages/domain/test/project-lifecycle.test.ts`
- Create: `packages/domain/test/project-expiration.test.ts`
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/src/roster.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/summary.ts`
- Modify: `packages/domain/test/summary.test.ts`

**Interfaces:**
- Consumes: existing `Role`, `RosterStatus`, Zod conventions, and `DomainError`.
- Produces: `ProjectStatus`, `Project`, `ProjectSummary`, `ProjectRosterSource`, `CreateProjectRequestSchema`, `UpdateProjectRequestSchema`, `ProjectOrganization`, `transitionProject()`, `toKstDate()`, `isProjectExpired()`.

- [ ] **Step 1: Write RED contract and lifecycle tests**

Add these exact assertions to `packages/contracts/test/contracts.test.ts` and the new domain test files:

```ts
import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
} from "../src";

it("accepts duplicate-name project payloads with independently optional dates", () => {
  expect(
    CreateProjectRequestSchema.parse({
      name: "상반기 리더십 캠프",
      endDate: "2026-05-23",
    }),
  ).toEqual({ name: "상반기 리더십 캠프", endDate: "2026-05-23" });
  expect(() =>
    CreateProjectRequestSchema.parse({
      name: "기간 역전",
      startDate: "2026-05-24",
      endDate: "2026-05-23",
    }),
  ).toThrow();
  expect(
    UpdateProjectRequestSchema.parse({
      startDate: null,
      endDate: null,
      expectedRevision: 2,
    }),
  ).toEqual({ startDate: null, endDate: null, expectedRevision: 2 });
});
```

```ts
// packages/domain/test/project-lifecycle.test.ts
import { describe, expect, it } from "vitest";
import { transitionProject } from "../src";

describe("transitionProject", () => {
  it.each([
    ["PREPARING", "PRE_REGISTRATION"],
    ["PRE_REGISTRATION", "IN_PROGRESS"],
    ["IN_PROGRESS", "CLOSED"],
    ["CLOSED", "IN_PROGRESS"],
  ] as const)("allows OPERATOR %s -> %s", (current, target) => {
    expect(transitionProject(current, target, "OPERATOR")).toBe(target);
  });

  it("rejects skipped and organization-manager transitions", () => {
    expect(() =>
      transitionProject("PREPARING", "IN_PROGRESS", "OPERATOR"),
    ).toThrow("INVALID_TRANSITION");
    expect(() =>
      transitionProject("PREPARING", "PRE_REGISTRATION", "ORGANIZATION_MANAGER"),
    ).toThrow("FORBIDDEN");
  });
});
```

```ts
// packages/domain/test/project-expiration.test.ts
import { expect, it } from "vitest";
import { isProjectExpired, toKstDate } from "../src";

it("uses the KST calendar boundary", () => {
  expect(toKstDate(new Date("2026-05-23T14:59:59.999Z"))).toBe("2026-05-23");
  expect(toKstDate(new Date("2026-05-23T15:00:00.000Z"))).toBe("2026-05-24");
  expect(isProjectExpired("2026-05-23", new Date("2026-05-23T15:00:00.000Z"))).toBe(true);
  expect(isProjectExpired(null, new Date("2026-05-23T15:00:00.000Z"))).toBe(false);
});
```

- [ ] **Step 2: Run targeted tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec vitest run test/contracts.test.ts
corepack pnpm@10.28.1 --filter @event-roster/domain exec vitest run test/project-lifecycle.test.ts test/project-expiration.test.ts test/summary.test.ts
```

Expected: FAIL because project schemas and domain functions do not exist.

- [ ] **Step 3: Implement the complete project contracts**

Create `packages/contracts/src/projects.ts`:

```ts
import { z } from "zod";

export const ProjectStatusSchema = z.enum([
  "PREPARING",
  "PRE_REGISTRATION",
  "IN_PROGRESS",
  "CLOSED",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectIdSchema = z.string().trim().min(1);
const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "유효한 날짜를 입력해 주세요.");

function datesInOrder(value: { startDate?: string | null; endDate?: string | null }) {
  return !value.startDate || !value.endDate || value.endDate >= value.startDate;
}

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startDate: CalendarDateSchema.optional(),
    endDate: CalendarDateSchema.optional(),
  })
  .refine(datesInOrder, { path: ["endDate"], message: "종료일은 시작일보다 빠를 수 없습니다." });

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startDate: CalendarDateSchema.nullable().optional(),
    endDate: CalendarDateSchema.nullable().optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.name !== undefined || value.startDate !== undefined || value.endDate !== undefined,
    "변경할 필드가 필요합니다.",
  )
  .refine(datesInOrder, { path: ["endDate"], message: "종료일은 시작일보다 빠를 수 없습니다." });

export interface Project {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closeReason: "MANUAL" | "SCHEDULED" | null;
}

export interface ProjectSummary {
  projectId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    expected: number;
    inProgressAdded: number;
    inProgressCancelled: number;
    final: number;
    delta: number;
  }>;
}
```

Extend `organizations.ts` and add a parallel project roster source without removing the legacy source yet:

```ts
export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasHistory: boolean;
}
```

```ts
export const ProjectRosterSourceSchema = z.enum(["PRE_REGISTRATION", "IN_PROGRESS"]);
export type ProjectRosterSource = z.infer<typeof ProjectRosterSourceSchema>;
```

Add `PROJECT_CLOSED` to `API_PROBLEM_CODES` while temporarily retaining `EVENT_CLOSED` until Task 5, and export `projects.ts` from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Implement pure lifecycle, expiration, and summary names**

Create `packages/domain/src/project-lifecycle.ts`:

```ts
import type { ProjectStatus, Role } from "@event-roster/contracts";
import { DomainError } from "./errors";

const FORWARD: Readonly<Record<ProjectStatus, ProjectStatus | null>> = {
  PREPARING: "PRE_REGISTRATION",
  PRE_REGISTRATION: "IN_PROGRESS",
  IN_PROGRESS: "CLOSED",
  CLOSED: null,
};

export function transitionProject(
  current: ProjectStatus,
  target: ProjectStatus,
  role: Role,
): ProjectStatus {
  if (role !== "OPERATOR") throw new DomainError("FORBIDDEN");
  if (FORWARD[current] === target || (current === "CLOSED" && target === "IN_PROGRESS")) return target;
  throw new DomainError("INVALID_TRANSITION");
}
```

Create `packages/domain/src/project-expiration.ts`:

```ts
export function toKstDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isProjectExpired(endDate: string | null, now: Date): boolean {
  return endDate !== null && endDate < toKstDate(now);
}
```

Add `ProjectSummaryInput` and `calculateProjectSummary()` beside the legacy exports in `summary.ts`. The project input uses `projectId`, `ProjectRosterSource`, `inProgressAdded`, and `inProgressCancelled`, and compares source values against `IN_PROGRESS` and `PRE_REGISTRATION`. Keep `EventSummaryInput` and `calculateEventSummary()` unchanged until Task 5 so the legacy Worker remains green.

- [ ] **Step 5: Verify GREEN and compatibility**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts test
corepack pnpm@10.28.1 --filter @event-roster/domain test
corepack pnpm@10.28.1 check
```

Expected: new project tests PASS and legacy Worker/Web still typecheck because legacy event exports remain until Task 5.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/domain
git commit -m "feat: add project contracts and lifecycle rules"
```

### Task 2: Add the staged project schema and project CRUD API

**Files:**
- Create: `apps/worker/migrations/0002_project_model.sql`
- Create: `apps/worker/src/db/projects.ts`
- Create: `apps/worker/src/services/projects.ts`
- Create: `apps/worker/src/routes/projects.ts`
- Create: `apps/worker/test/project-migration.integration.test.ts`
- Create: `apps/worker/test/projects.integration.test.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/src/http/problem.ts`
- Modify: `apps/worker/wrangler.test.jsonc`
- Modify: `apps/worker/test/env.d.ts`
- Modify: `apps/worker/test/support/admin.ts`
- Modify: `apps/worker/test/support/ids.ts`

**Interfaces:**
- Consumes: `Project`, `ProjectStatus`, request schemas, `transitionProject()`, `runGuardedAtomic()`, `Actor`.
- Produces: `ProjectRecord`, `findProject()`, `listProjects()`, `createProject()`, `updateProject()`, `changeProjectStatus()`, `/api/v1/projects` endpoints.

- [ ] **Step 1: Write RED migration and CRUD integration tests**

Add a second local-only D1 binding to `wrangler.test.jsonc`:

```json
{
  "binding": "MIGRATION_DB",
  "database_name": "event-roster-migration-test",
  "database_id": "00000000-0000-0000-0000-000000000001"
}
```

Add `MIGRATION_DB: D1Database` to `test/env.d.ts`. Create `project-migration.integration.test.ts` so it applies migration files one at a time:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("migrates legacy events and exposes project columns without year or half", async () => {
  const [initial, projectModel] = env.TEST_MIGRATIONS;
  if (!initial || !projectModel) throw new Error("expected migrations 0001 and 0002");
  await applyD1Migrations(env.MIGRATION_DB, [initial]);
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
       session_version, created_at, updated_at)
      VALUES ('migration-user', 'migration-user', 'migration-user', '이관 사용자',
       'OPERATOR', 1, 0, 1, '2026-01-01', '2026-01-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO events
      (id, year, half, name, status, revision, created_by, created_at, updated_at)
      VALUES ('legacy-event', 2026, 'H1', '기존 행사', 'DAY_OF', 3,
       'migration-user', '2026-01-01', '2026-05-01')`),
  ]);
  await applyD1Migrations(env.MIGRATION_DB, [projectModel]);
  const columns = (
    await env.MIGRATION_DB.prepare("PRAGMA table_info(projects)").all<{ name: string }>()
  ).results.map((column) => column.name);
  expect(columns).toEqual(
    expect.arrayContaining([
      "id", "name", "start_date", "end_date", "status", "revision",
      "created_by", "created_at", "updated_at", "closed_at", "closed_by", "close_reason",
    ]),
  );
  expect(columns).not.toContain("year");
  expect(columns).not.toContain("half");
  expect(await env.MIGRATION_DB.prepare(
    "SELECT id, name, status, revision FROM projects WHERE id='legacy-event'",
  ).first()).toEqual({ id: "legacy-event", name: "기존 행사", status: "IN_PROGRESS", revision: 3 });
});
```

Create `projects.integration.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedOperator } from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);

it("creates duplicate-name projects and validates date order", async () => {
  const operator = await seedOperator();
  const body = { name: "리더십 캠프", startDate: "2026-05-22", endDate: "2026-05-23" };
  const first = await authedRequest(operator, "/api/v1/projects", { method: "POST", body: JSON.stringify(body) });
  const second = await authedRequest(operator, "/api/v1/projects", { method: "POST", body: JSON.stringify(body) });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(
    (
      await authedRequest(operator, "/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "역전", startDate: "2026-05-24", endDate: "2026-05-23" }),
      })
    ).status,
  ).toBe(422);
});
```

Add this shared helper to `test/support/admin.ts`:

```ts
export type SeededLogin = LoginResult & { userId: string };

export async function seedOperator(): Promise<SeededLogin> {
  await seedUser();
  return { ...(await login()), userId: "user-1" };
}

export async function seedManager(organizationId = "org-1"): Promise<SeededLogin> {
  await seedUser({ id: "manager-user", loginId: "manager-02", password: "manager-password-123" });
  await env.DB.prepare("UPDATE users SET role='ORGANIZATION_MANAGER' WHERE id='manager-user'").run();
  await env.DB.prepare(
    "INSERT INTO user_organizations (user_id, organization_id) VALUES ('manager-user', ?)",
  ).bind(organizationId).run();
  return { ...(await login("manager-02", "manager-password-123")), userId: "manager-user" };
}

export async function seedProject(
  operator: SeededLogin,
  input: { name?: string; startDate?: string; endDate?: string } = {},
) {
  const response = await authedRequest(operator, "/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ ...input, name: input.name ?? "테스트 프로젝트" }),
  });
  if (!response.ok) throw new Error(`seedProject failed: ${response.status}`);
  return response.json<{ id: string; revision: number; status: string }>();
}
```

Add these lifecycle cases to `projects.integration.test.ts`:

```ts
it("clears optional dates and rejects a stale patch", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator, {
    startDate: "2026-05-22",
    endDate: "2026-05-23",
  });
  const cleared = await authedRequest(operator, `/api/v1/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ startDate: null, endDate: null, expectedRevision: project.revision }),
  });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toMatchObject({ startDate: null, endDate: null, revision: 1 });
  expect((await authedRequest(operator, `/api/v1/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "stale", expectedRevision: project.revision }),
  })).status).toBe(409);
});

it("freezes expected snapshots on IN_PROGRESS and requires a valid reopen date", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const project = await seedProject(operator, { endDate: "2026-05-23" });
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, 'org-1', 1, ?, ?, ?)`)
    .bind(project.id, "2026-05-01T00:00:00.000Z", operator.userId, operator.userId).run();
  const pre = await transition(operator, project, "PRE_REGISTRATION");
  const active = await transition(operator, pre, "IN_PROGRESS");
  expect((await env.DB.prepare(
    "SELECT expected_count FROM project_expected_snapshots WHERE project_id=? AND organization_id='org-1'",
  ).bind(project.id).first<{ expected_count: number }>())?.expected_count).toBe(0);
  const closed = await transition(operator, active, "CLOSED");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-23T15:00:00.000Z"));
  expect((await authedRequest(operator, `/api/v1/projects/${project.id}/transition`, {
    method: "POST",
    body: JSON.stringify({ targetStatus: "IN_PROGRESS", expectedRevision: closed.revision }),
  })).status).toBe(409);
  const cleared = await authedRequest(operator, `/api/v1/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ endDate: null, expectedRevision: closed.revision }),
  });
  expect(cleared.status).toBe(200);
  const clearedProject = await cleared.json<{ id: string; revision: number }>();
  expect((await transition(operator, clearedProject, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
  vi.useRealTimers();
});
```

Define this local helper in the test:

```ts
async function transition(
  operator: Awaited<ReturnType<typeof seedOperator>>,
  project: { id: string; revision: number },
  targetStatus: "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED",
) {
  const response = await authedRequest(operator, `/api/v1/projects/${project.id}/transition`, {
    method: "POST",
    body: JSON.stringify({ targetStatus, expectedRevision: project.revision }),
  });
  if (!response.ok) throw new Error(`transition failed: ${response.status}`);
  return response.json<{ id: string; revision: number; status: string }>();
}
```

- [ ] **Step 2: Run Worker tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-migration.integration.test.ts test/projects.integration.test.ts
```

Expected: FAIL because `projects` and `/api/v1/projects` do not exist.

- [ ] **Step 3: Create the staged migration**

Create `0002_project_model.sql` with this initial compatibility schema. Do not deploy this intermediate revision:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('PREPARING', 'PRE_REGISTRATION', 'IN_PROGRESS', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('MANUAL', 'SCHEDULED')),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK ((status = 'CLOSED') = (close_reason IS NOT NULL))
);

INSERT INTO projects
  (id, name, start_date, end_date, status, revision, created_by, created_at, updated_at, closed_at, closed_by, close_reason)
SELECT id, name, NULL, NULL,
  CASE status
    WHEN 'DRAFT' THEN 'PREPARING'
    WHEN 'PRE_REGISTRATION' THEN 'PRE_REGISTRATION'
    WHEN 'DAY_OF' THEN 'IN_PROGRESS'
    WHEN 'CLOSED' THEN 'CLOSED'
  END,
  revision, created_by, created_at, updated_at,
  CASE WHEN status = 'CLOSED' THEN updated_at END,
  CASE WHEN status = 'CLOSED' THEN created_by END,
  CASE WHEN status = 'CLOSED' THEN 'MANUAL' END
FROM events;

CREATE INDEX projects_status_dates ON projects (status, end_date, start_date, created_at);

CREATE TABLE project_organizations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  added_at TEXT NOT NULL,
  deactivated_at TEXT,
  added_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (project_id, organization_id)
);

INSERT INTO project_organizations
  (project_id, organization_id, is_active, added_at, deactivated_at, added_by, updated_by)
SELECT e.id, referenced.organization_id, 1, e.created_at, NULL, e.created_by, e.created_by
FROM events e
JOIN (
  SELECT event_id, organization_id FROM event_roster_entries
  UNION
  SELECT event_id, organization_id FROM event_expected_snapshots
) referenced ON referenced.event_id = e.id;

CREATE TABLE project_expected_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (project_id, organization_id)
);

INSERT INTO project_expected_snapshots
SELECT event_id, organization_id, expected_count, captured_at
FROM event_expected_snapshots;
```

- [ ] **Step 4: Implement project DB mapping and ordered listing**

Create `apps/worker/src/db/projects.ts`:

```ts
import type { Project, ProjectStatus } from "@event-roster/contracts";

interface ProjectRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  close_reason: "MANUAL" | "SCHEDULED" | null;
}

export type ProjectRecord = Project;

const SELECT_PROJECT = `SELECT id, name, start_date, end_date, status, revision,
  created_at, updated_at, closed_at, close_reason FROM projects`;

export async function findProject(db: D1Database, id: string): Promise<ProjectRecord | null> {
  const row = await db.prepare(`${SELECT_PROJECT} WHERE id = ?`).bind(id).first<ProjectRow>();
  return row ? mapProject(row) : null;
}

export async function listProjects(db: D1Database): Promise<ProjectRecord[]> {
  const rows = (await db.prepare(`${SELECT_PROJECT} ORDER BY
    CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END,
    CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN 1 ELSE 0 END,
    CASE WHEN status <> 'CLOSED' THEN start_date END,
    CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN created_at END DESC,
    CASE WHEN status = 'CLOSED' THEN closed_at END DESC`).all<ProjectRow>()).results;
  return rows.map(mapProject);
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
  };
}
```

- [ ] **Step 5: Implement project services and routes**

Create `routes/projects.ts` with the exact route surface:

```ts
projectRoutes.get("/projects", listHandler);
projectRoutes.get("/projects/:id", detailHandler);
projectRoutes.post("/projects", createHandler);
projectRoutes.patch("/projects/:id", patchHandler);
projectRoutes.post("/projects/:id/transition", transitionHandler);
```

Each mutation must call `assertExactOrigin`, `requireActor`, `requireCsrf`, and the existing operator authorization. Implement these exported service signatures in `services/projects.ts`:

```ts
export async function getProjects(env: Env, actor: Actor): Promise<Project[]>;
export async function getProject(env: Env, actor: Actor, projectId: string): Promise<Project>;
export async function createProject(
  env: Env,
  actor: Actor,
  input: z.infer<typeof CreateProjectRequestSchema>,
  now?: Date,
): Promise<Project>;
export async function updateProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof UpdateProjectRequestSchema>,
  now?: Date,
): Promise<Project>;
export async function changeProjectStatus(
  env: Env,
  actor: Actor,
  projectId: string,
  targetStatus: ProjectStatus,
  expectedRevision: number,
  now?: Date,
): Promise<Project>;
```

`createProject()` inserts `PREPARING`; `updateProject()` merges omitted keys with the current row, omits merged `null` dates when passing the value back through `CreateProjectRequestSchema`, and stores the validated absent dates as SQL `NULL`; `changeProjectStatus()` uses `transitionProject()`. On a CLOSED project `updateProject()` accepts only `startDate`/`endDate` keys and rejects `name` with `PROJECT_CLOSED`, which makes a past end date removable before reopen. `PRE_REGISTRATION → IN_PROGRESS` inserts into `project_expected_snapshots` from project-linked organizations and existing legacy roster rows during this staged task. Audit actions are `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_TRANSITIONED`, `PROJECT_REOPENED` with entity type `PROJECT`.

Mount `projectRoutes` in `app.ts` and map `PROJECT_CLOSED` to HTTP 409 with message `종료된 프로젝트는 변경할 수 없습니다.` in `http/problem.ts`.

- [ ] **Step 6: Verify project API GREEN and legacy compatibility**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-migration.integration.test.ts test/projects.integration.test.ts test/events.integration.test.ts
corepack pnpm@10.28.1 check
```

Expected: project tests PASS; legacy event tests remain PASS during the staged cutover.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/migrations/0002_project_model.sql apps/worker/src apps/worker/test
git commit -m "feat: add project schema and lifecycle API"
```

### Task 3: Enforce KST expiration and add the scheduled handler

**Files:**
- Create: `apps/worker/src/services/project-expiration.ts`
- Create: `apps/worker/test/project-expiration.integration.test.ts`
- Modify: `apps/worker/src/services/projects.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/wrangler.jsonc`
- Modify: `apps/worker/wrangler.e2e.jsonc`
- Modify: `apps/worker/wrangler.test.jsonc`

**Interfaces:**
- Consumes: `toKstDate()`, `ProjectRecord`, `runGuardedAtomic()`, D1 and audit schema.
- Produces: `closeExpiredProject()`, `closeExpiredProjects()`, Worker `scheduled()` handler, reusable mutation expiration guard.

- [ ] **Step 1: Write RED expiration integration tests**

Create `project-expiration.integration.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { closeExpiredProject, closeExpiredProjects } from "../src/services/project-expiration";
import { seedOperator } from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);

it("closes an expired project once with a SYSTEM audit row", async () => {
  const operator = await seedOperator();
  await env.DB.prepare(`INSERT INTO projects
    (id, name, end_date, status, revision, created_by, created_at, updated_at)
    VALUES ('project-expired', '만료 프로젝트', '2026-05-23', 'IN_PROGRESS', 0, ?, ?, ?)`)
    .bind(operator.userId, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z").run();

  const now = new Date("2026-05-23T15:00:00.000Z");
  expect(await closeExpiredProject(env, "project-expired", now)).toBe(true);
  expect(await closeExpiredProject(env, "project-expired", now)).toBe(false);
  const row = await env.DB.prepare("SELECT status, close_reason, revision FROM projects WHERE id = 'project-expired'")
    .first<{ status: string; close_reason: string; revision: number }>();
  expect(row).toEqual({ status: "CLOSED", close_reason: "SCHEDULED", revision: 1 });
  const audit = await env.DB.prepare("SELECT actor_user_id, action FROM audit_logs WHERE entity_id = 'project-expired'")
    .first<{ actor_user_id: string | null; action: string }>();
  expect(audit).toEqual({ actor_user_id: null, action: "PROJECT_AUTO_CLOSED" });
});

it("processes at most fifty projects", async () => {
  expect(await closeExpiredProjects(env, new Date("2026-05-23T15:00:00.000Z"), 50)).toBeLessThanOrEqual(50);
});
```

Add an HTTP mutation test with Vitest's fixed clock:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-05-23T15:00:00.000Z"));
const response = await authedRequest(operator, "/api/v1/projects/project-expired", {
  method: "PATCH",
  body: JSON.stringify({ name: "차단되어야 함", expectedRevision: 0 }),
});
expect(response.status).toBe(409);
expect((await response.json<{ code: string }>()).code).toBe("PROJECT_CLOSED");
expect((await env.DB.prepare(
  "SELECT status FROM projects WHERE id='project-expired'",
).first<{ status: string }>())?.status).toBe("CLOSED");
vi.useRealTimers();
```

- [ ] **Step 2: Run the expiration test to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-expiration.integration.test.ts
```

Expected: FAIL because expiration services and scheduled export do not exist.

- [ ] **Step 3: Implement idempotent expiration**

Create `services/project-expiration.ts` using the existing guarded-batch primitive so state and audit cannot diverge:

```ts
import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import type { Env } from "../env";

export async function closeExpiredProject(env: Env, projectId: string, now = new Date()): Promise<boolean> {
  const today = toKstDate(now);
  const project = await env.DB.prepare(
    "SELECT revision FROM projects WHERE id = ? AND status <> 'CLOSED' AND end_date IS NOT NULL AND end_date < ?",
  ).bind(projectId, today).first<{ revision: number }>();
  if (!project) return false;
  const guardId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: env.DB.prepare(`INSERT INTO operation_guards (id, ok)
        VALUES (?, CASE WHEN EXISTS (
          SELECT 1 FROM projects WHERE id=? AND revision=? AND status <> 'CLOSED'
            AND end_date IS NOT NULL AND end_date < ?
        ) THEN 1 ELSE 0 END)`).bind(guardId, projectId, project.revision, today),
      statements: [
        env.DB.prepare(`UPDATE projects SET status='CLOSED', revision=revision+1,
          closed_at=?, closed_by=NULL, close_reason='SCHEDULED', updated_at=? WHERE id=?`)
          .bind(now.toISOString(), now.toISOString(), projectId),
        env.DB.prepare(`INSERT INTO audit_logs
          (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
          VALUES (?, NULL, 'PROJECT_AUTO_CLOSED', 'PROJECT', ?, ?, '{}')`)
          .bind(auditId, projectId, now.toISOString()),
      ],
      failureCode: "CONFLICT",
    });
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "CONFLICT") return false;
    throw error;
  }
}

export async function closeExpiredProjects(env: Env, now = new Date(), limit = 50): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT id FROM projects
    WHERE status <> 'CLOSED' AND end_date IS NOT NULL AND end_date < ?
    ORDER BY created_at LIMIT ?`).bind(toKstDate(now), Math.min(limit, 50)).all<{ id: string }>()).results;
  let closed = 0;
  for (const row of rows) if (await closeExpiredProject(env, row.id, now)) closed += 1;
  return closed;
}
```

Before every project mutation, call `closeExpiredProject()` and reload the row. Throw `DomainError("PROJECT_CLOSED")` when it is closed, except that `updateProject()` may execute a date-only PATCH whose keys are limited to `startDate`, `endDate`, and `expectedRevision`. Keep the guarded UPDATE condition `status <> 'CLOSED' AND (end_date IS NULL OR end_date >= ?)` on ordinary mutations so expiration and mutation races cannot both succeed; the date-only CLOSED update uses `status='CLOSED' AND revision=?` instead.

- [ ] **Step 4: Export the scheduled Worker and configure Cron**

Replace `src/index.ts` with:

```ts
import { createApp } from "./app";
import type { Env } from "./env";
import { closeExpiredProjects } from "./services/project-expiration";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(closeExpiredProjects(env).then(() => undefined));
  },
};
```

Add to production and E2E Wrangler configs, but not a second Worker:

```json
"triggers": { "crons": ["0 15 * * *"] }
```

Add this scheduled export test using the installed pool helpers; no public route or special Miniflare socket setting is needed:

```ts
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

const ctx = createExecutionContext();
exports.default.scheduled(
  createScheduledController({ cron: "0 15 * * *", scheduledTime: Date.now() }),
  env,
  ctx,
);
await waitOnExecutionContext(ctx);
expect((await findProject(env.DB, "project-expired"))?.status).toBe("CLOSED");
```

- [ ] **Step 5: Verify expiration, project, and dry-run GREEN**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-expiration.integration.test.ts test/projects.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: tests PASS and dry-run reports one Worker with one scheduled trigger without creating remote resources.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src apps/worker/test/project-expiration.integration.test.ts apps/worker/wrangler*.jsonc
git commit -m "feat: add scheduled project expiration"
```

### Task 4: Add project-scoped organization membership and authorization

**Files:**
- Create: `apps/worker/src/db/project-organizations.ts`
- Create: `apps/worker/src/services/project-organizations.ts`
- Create: `apps/worker/src/routes/project-organizations.ts`
- Create: `apps/worker/test/project-organizations.integration.test.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/src/services/projects.ts`
- Modify: `apps/worker/src/services/admin.ts`
- Modify: `apps/worker/test/support/admin.ts`
- Modify: `packages/contracts/src/organizations.ts`

**Interfaces:**
- Consumes: `project_organizations`, organization master, `Actor`, global user-organization assignments.
- Produces: `listProjectOrganizations()`, `addProjectOrganization()`, `setProjectOrganizationActive()`, project-aware read/write scope.

- [ ] **Step 1: Write RED organization membership tests**

Create tests for all three paths:

```ts
it("links an existing organization, deactivates it, and reuses the row", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  const link = await authedRequest(operator, `/api/v1/projects/${project.id}/organizations`, {
    method: "POST",
    body: JSON.stringify({ organizationId: organization.id }),
  });
  expect(link.status).toBe(201);
  const disabled = await authedRequest(operator, `/api/v1/projects/${project.id}/organizations/${organization.id}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  expect(disabled.status).toBe(200);
  expect((await authedRequest(operator, `/api/v1/projects/${project.id}/organizations`, {
    method: "POST",
    body: JSON.stringify({ organizationId: organization.id }),
  })).status).toBe(200);
  expect((await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id=? AND organization_id=?",
  ).bind(project.id, organization.id).first<{ count: number }>())?.count).toBe(1);
});
```

Replace `seedOrganization()` with this returning helper, then add the exact cases below:

```ts
export async function seedOrganization(
  id = "org-1",
  name = "1팀",
  isActive = true,
): Promise<{ id: string; name: string; isActive: boolean }> {
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.prepare(`INSERT INTO organizations
    (id, name, canonical_name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      name,
      name.normalize("NFKC").toLocaleLowerCase(),
      isActive ? 1 : 0,
      now,
      now,
    )
    .run();
  return { id, name, isActive };
}
```

```ts
it("creates and links a new organization atomically, then deletes a no-history link", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator);
  const created = await authedRequest(operator, `/api/v1/projects/${project.id}/organizations`, {
    method: "POST",
    body: JSON.stringify({ newOrganizationName: "신규 조직" }),
  });
  expect(created.status).toBe(201);
  const membership = await created.json<{ organizationId: string }>();
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${membership.organizationId}`,
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(await disabled.json()).toMatchObject({ isActive: false, removed: true });
  expect((await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id=? AND organization_id=?",
  ).bind(project.id, membership.organizationId).first<{ count: number }>())?.count).toBe(0);
});

it("preserves a historical link and scopes an organization manager to linked projects", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const linked = await seedProject(operator, { name: "연결 프로젝트" });
  const hidden = await seedProject(operator, { name: "숨김 프로젝트" });
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, ?, 1, ?, ?, ?)`)
    .bind(linked.id, organization.id, "2026-05-01T00:00:00.000Z", operator.userId, operator.userId).run();
  await env.DB.prepare(`INSERT INTO project_expected_snapshots
    (project_id, organization_id, expected_count, captured_at) VALUES (?, ?, 0, ?)`)
    .bind(linked.id, organization.id, "2026-05-01T00:00:00.000Z").run();
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${linked.id}/organizations/${organization.id}`,
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(await disabled.json()).toMatchObject({ isActive: false, removed: false });
  const manager = await seedManager(organization.id);
  const visible = await (await authedRequest(manager, "/api/v1/projects")).json<Array<{ id: string }>>();
  expect(visible.map((project) => project.id)).toContain(linked.id);
  expect(visible.map((project) => project.id)).not.toContain(hidden.id);
});

it("reports global rename impact without rewriting a roster snapshot", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  await linkProjectOrganization(operator, project.id, organization.id);
  await seedLegacyRosterSnapshot(project.id, organization.id, organization.name, operator.userId);
  const response = await authedRequest(operator, `/api/v1/organizations/${organization.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "변경된 조직" }),
  });
  expect(await response.json()).toMatchObject({ name: "변경된 조직", activeProjectCount: 1 });
  expect((await env.DB.prepare(
    "SELECT organization_name_snapshot FROM event_roster_entries WHERE event_id=? LIMIT 1",
  ).bind(project.id).first<{ organization_name_snapshot: string }>())?.organization_name_snapshot)
    .toBe(organization.name);
});
```

Define these helpers in the test file:

```ts
async function linkProjectOrganization(
  operator: Awaited<ReturnType<typeof seedOperator>>,
  projectId: string,
  organizationId: string,
) {
  const response = await authedRequest(operator, `/api/v1/projects/${projectId}/organizations`, {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
  expect(response.status).toBe(201);
}

async function seedLegacyRosterSnapshot(
  projectId: string,
  organizationId: string,
  organizationName: string,
  userId: string,
) {
  const now = "2026-05-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO events
      (id, year, half, name, status, revision, created_by, created_at, updated_at)
      VALUES (?, 2099, 'H1', 'legacy', 'PRE_REGISTRATION', 0, ?, ?, ?)`)
      .bind(projectId, userId, now, now),
    env.DB.prepare(`INSERT INTO participants
      (id, participant_id, name, organization_id, revision, created_at, updated_at)
      VALUES ('legacy-person', 'P-LEGACY', '기존 참가자', ?, 0, ?, ?)`)
      .bind(organizationId, now, now),
    env.DB.prepare(`INSERT INTO event_roster_entries
      (id, event_id, participant_id, organization_id, participant_name_snapshot,
       organization_name_snapshot, source, status, revision, created_by, updated_by, created_at, updated_at)
      VALUES ('legacy-entry', ?, 'legacy-person', ?, '기존 참가자', ?,
       'PRE_EVENT', 'ACTIVE', 0, ?, ?, ?, ?)`)
      .bind(projectId, organizationId, organizationName, userId, userId, now, now),
  ]);
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-organizations.integration.test.ts
```

Expected: FAIL with 404 project organization endpoints.

- [ ] **Step 3: Implement membership DB reads**

Create `db/project-organizations.ts` with these exports:

```ts
export async function listProjectOrganizations(
  db: D1Database,
  projectId: string,
): Promise<ProjectOrganization[]>;

export async function findProjectOrganization(
  db: D1Database,
  projectId: string,
  organizationId: string,
): Promise<ProjectOrganization | null>;

export async function listActorProjectOrganizationIds(
  db: D1Database,
  actorUserId: string,
  projectId: string,
  activeOnly: boolean,
): Promise<string[]>;
```

During this staged Task, the list query calculates `hasHistory` with `EXISTS` over legacy `event_roster_entries` plus `project_expected_snapshots`; Task 5 switches the roster subquery to `project_roster_entries`. Calculate `activeProjectCount` with a correlated count over active memberships and map both SQLite integers to booleans.

- [ ] **Step 4: Implement atomic membership services and routes**

Use a discriminated Zod union for POST:

```ts
const AddProjectOrganizationSchema = z.union([
  z.object({ organizationId: OrganizationIdSchema }),
  z.object({ newOrganizationName: z.string().trim().min(1).max(100) }),
]);

const ProjectOrganizationPatchSchema = z.object({ isActive: z.boolean() });
```

Implement:

```ts
export async function addProjectOrganization(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { organizationId: string } | { newOrganizationName: string },
  now?: Date,
): Promise<{ organization: ProjectOrganization; created: boolean }>;

export async function setProjectOrganizationActive(
  env: Env,
  actor: Actor,
  projectId: string,
  organizationId: string,
  isActive: boolean,
  now?: Date,
): Promise<{ organizationId: string; isActive: boolean; removed: boolean }>;
```

For no-history deactivation, DELETE only the membership. For history, UPDATE `is_active=0`, set `deactivated_at`, and keep snapshots. Reactivation uses UPSERT on the existing primary key. Every path writes `PROJECT_ORGANIZATION_ADDED`, `PROJECT_ORGANIZATION_REACTIVATED`, `PROJECT_ORGANIZATION_DEACTIVATED`, or `PROJECT_ORGANIZATION_REMOVED` audit.

Mount:

```ts
GET   /projects/:projectId/organizations
POST  /projects/:projectId/organizations
PATCH /projects/:projectId/organizations/:organizationId
```

Filter `getProjects()` for organization managers through `user_organizations JOIN project_organizations`; operators receive all rows.

- [ ] **Step 5: Verify organization scope GREEN**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/project-organizations.integration.test.ts test/projects.integration.test.ts test/admin.integration.test.ts
corepack pnpm@10.28.1 check
```

Expected: all tests PASS and account organization assignment behavior remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/organizations.ts apps/worker/src apps/worker/test/project-organizations.integration.test.ts
git commit -m "feat: scope organizations to projects"
```

### Task 5: Complete the migration and cut roster, participant, import, export, and audit APIs over to projects

**Files:**
- Modify: `apps/worker/migrations/0002_project_model.sql`
- Modify: `apps/worker/src/db/roster.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/src/services/imports.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/routes/roster.ts`
- Modify: `apps/worker/src/routes/imports.ts`
- Modify: `apps/worker/src/routes/participants.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/test/{atomic,schema,roster,summary,audit,participants,imports,exports,import-budget}.integration.test.ts`
- Modify: `apps/worker/test/support/{auth,database,ids,roster}.ts`
- Modify: `packages/contracts/src/{projects,roster,imports,index,common}.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `packages/domain/src/{summary,index}.ts`
- Modify: `packages/domain/test/summary.test.ts`
- Delete: `packages/contracts/src/events.ts`
- Delete: `packages/domain/src/event-lifecycle.ts`
- Delete: `packages/domain/test/event-lifecycle.test.ts`
- Delete: `apps/worker/src/{db,services,routes}/events.ts`
- Delete: `apps/worker/test/events.integration.test.ts`

**Interfaces:**
- Consumes: final project schema, membership scope, expiration guard, project contracts.
- Produces: project-only roster/import/export APIs and a final `0002_project_model.sql` with no active event tables.

- [ ] **Step 1: Rewrite backend tests to RED project terminology**

Mechanically rename fixtures and paths, then add the new behavioral test:

```ts
it("updates the participant master organization without rewriting past snapshots", async () => {
  const { operator, project, firstOrganization, secondOrganization, entry, participant } =
    await seedProjectRosterScenario();
  await linkOrganization(operator, project.id, secondOrganization.id);
  const response = await authedRequest(operator, `/api/v1/projects/${project.id}/participants/${participant.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: participant.name,
      organizationId: secondOrganization.id,
      expectedRevision: participant.revision,
    }),
  });
  expect(response.status).toBe(200);
  const master = await env.DB.prepare("SELECT organization_id FROM participants WHERE id=?")
    .bind(participant.id).first<{ organization_id: string }>();
  const snapshot = await env.DB.prepare(
    "SELECT organization_id, organization_name_snapshot FROM project_roster_entries WHERE id=?",
  ).bind(entry.id).first<{ organization_id: string; organization_name_snapshot: string }>();
  expect(master?.organization_id).toBe(secondOrganization.id);
  expect(snapshot).toEqual({
    organization_id: firstOrganization.id,
    organization_name_snapshot: firstOrganization.name,
  });
});
```

Every prior `/api/v1/events/:eventId/...` expectation becomes `/api/v1/projects/:projectId/...`; `PRE_EVENT` becomes `PRE_REGISTRATION`; `DAY_OF` becomes `IN_PROGRESS`; response `eventId` becomes `projectId`; summary counters become `inProgressAdded` and `inProgressCancelled`. Add this atomic creation test:

```ts
it("creates a participant and roster entry atomically", async () => {
  const fixture = await setupPreRegistration();
  const created = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: { name: "신규 참가자", organizationId: "org-1" },
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(created.status).toBe(201);
  expect((await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants WHERE name='신규 참가자'",
  ).first<{ count: number }>())?.count).toBe(1);
  expect((await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id=?",
  ).bind(fixture.project.id).first<{ count: number }>())?.count).toBe(1);

  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: { name: "롤백 참가자", organizationId: "org-1" },
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect((await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants WHERE name='롤백 참가자'",
  ).first<{ count: number }>())?.count).toBe(0);
});
```

- [ ] **Step 2: Run the renamed suites to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run test/roster.integration.test.ts test/summary.integration.test.ts test/audit.integration.test.ts test/participants.integration.test.ts test/imports.integration.test.ts test/exports.integration.test.ts
```

Expected: FAIL because routes and tables still use event terminology.

- [ ] **Step 3: Complete `0002_project_model.sql` with project roster tables and data copy**

Append final tables and copy statements before dropping legacy domain tables:

```sql
CREATE TABLE project_roster_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  participant_name_snapshot TEXT NOT NULL,
  organization_name_snapshot TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PRE_REGISTRATION', 'IN_PROGRESS')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
  was_expected_at_start INTEGER NOT NULL DEFAULT 0 CHECK (was_expected_at_start IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, participant_id)
);

INSERT INTO project_roster_entries
SELECT id, event_id, participant_id, organization_id,
  participant_name_snapshot, organization_name_snapshot,
  CASE source WHEN 'PRE_EVENT' THEN 'PRE_REGISTRATION' WHEN 'DAY_OF' THEN 'IN_PROGRESS' END,
  status, was_expected_at_day_of, revision, created_by, updated_by, created_at, updated_at
FROM event_roster_entries;

CREATE INDEX project_roster_entries_scope
ON project_roster_entries (project_id, organization_id, status);

CREATE TABLE project_import_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 130),
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO project_import_runs
SELECT id, event_id, actor_user_id, row_count, created_at, details_json
FROM import_runs;

UPDATE audit_logs SET
  entity_type = CASE WHEN entity_type = 'EVENT' THEN 'PROJECT' ELSE entity_type END,
  action = CASE
    WHEN action = 'EVENT_CREATED' THEN 'PROJECT_CREATED'
    WHEN action = 'EVENT_UPDATED' THEN 'PROJECT_UPDATED'
    WHEN action = 'EVENT_TRANSITIONED' THEN 'PROJECT_TRANSITIONED'
    WHEN action = 'EVENT_REOPENED' THEN 'PROJECT_REOPENED'
    ELSE action
  END;

DROP TABLE import_runs;
DROP TABLE event_expected_snapshots;
DROP TABLE event_roster_entries;
DROP TABLE events;

PRAGMA foreign_key_check;
```

Update the migration test to compare pre-copy fixture counts with `projects`, `project_roster_entries`, `project_expected_snapshots`, `project_import_runs`, and assert `PRAGMA foreign_key_check` returns zero rows.

- [ ] **Step 4: Rename roster DB and domain interfaces**

Use these final shapes throughout:

```ts
export interface RosterRecord {
  id: string;
  projectId: string;
  participantId: string;
  participantNumber: string;
  organizationId: string;
  participantName: string;
  organizationName: string;
  source: "PRE_REGISTRATION" | "IN_PROGRESS";
  status: "ACTIVE" | "CANCELLED";
  wasExpectedAtStart: boolean;
  revision: number;
  updatedAt: string;
}
```

Rename SQL columns and service arguments from `eventId` to `projectId`. Summary must enumerate project memberships, including inactive organizations with history, rather than every global organization.

In this cutover, delete the legacy `RosterSourceSchema`, `EventSummaryInput`, and `calculateEventSummary()`. Rename `ProjectRosterSourceSchema`/`ProjectRosterSource` to the final public `RosterSourceSchema`/`RosterSource`, keep values `PRE_REGISTRATION` and `IN_PROGRESS`, and update `calculateProjectSummary()` imports accordingly.

All roster/import/project-participant mutations must execute this sequence:

```ts
await closeExpiredProject(env, projectId, now);
const project = await findProject(env.DB, projectId);
if (!project) throw new DomainError("NOT_FOUND");
if (project.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
const membership = await findProjectOrganization(env.DB, projectId, organizationId);
if (!membership?.isActive || !membership.masterIsActive) {
  throw new DomainError("VALIDATION_FAILED");
}
```

Existing entry cancellation/reactivation may use an inactive membership; creating a new entry and import commit may not.

Replace global participant writes with project-aware signatures:

```ts
export async function createParticipantAndAddToProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { name: string; organizationId: string; expectedRevision: number },
  now?: Date,
): Promise<{ participant: ParticipantRecord; rosterEntry: RosterRecord }>;

export async function updateProjectParticipant(
  env: Env,
  actor: Actor,
  projectId: string,
  participantId: string,
  input: { name?: string; organizationId?: string; expectedRevision: number; expectedProjectRevision: number },
  now?: Date,
): Promise<ParticipantRecord>;
```

The create function inserts participant master, project roster snapshot, project revision, and both audit rows in one guarded batch. The update function changes the participant master and only `project_roster_entries WHERE project_id=? AND participant_id=?`; it never updates snapshots in another project.

- [ ] **Step 5: Cut routes and contracts over and remove legacy modules**

Final route surface:

```ts
GET   /projects/:projectId/roster
POST  /projects/:projectId/roster
PATCH /projects/:projectId/roster/:entryId
PATCH /projects/:projectId/participants/:participantId
GET   /projects/:projectId/summary
GET   /projects/:projectId/audit
POST  /projects/:projectId/imports/validate
POST  /projects/:projectId/imports/commit
GET   /projects/:projectId/exports/roster
```

Make roster POST a strict union of `{ participantId, expectedRevision }` for an existing participant and `{ newParticipant: { name, organizationId }, expectedRevision }` for atomic creation. Keep only global `GET /participants`; remove global participant POST/PATCH routes. Remove event routes from `app.ts`, delete legacy files listed above, remove `EVENT_CLOSED` from `API_PROBLEM_CODES`, and remove event exports. Update `NormalizedImportRow` resolution to require an active project membership. Update export JSON and workbook-facing DTO labels to project terminology.

Update `resetAuthState()` to delete project tables in foreign-key order:

```ts
await env.DB.batch([
  env.DB.prepare("DELETE FROM project_import_runs"),
  env.DB.prepare("DELETE FROM project_expected_snapshots"),
  env.DB.prepare("DELETE FROM project_roster_entries"),
  env.DB.prepare("DELETE FROM project_organizations"),
  env.DB.prepare("DELETE FROM projects"),
  env.DB.prepare("DELETE FROM participants"),
  env.DB.prepare("DELETE FROM user_organizations"),
  env.DB.prepare("DELETE FROM organizations"),
]);
```

Change the atomic test predicate to `EXISTS (SELECT 1 FROM projects WHERE id='missing-project')`. Replace the schema duplicate year/half assertion with two same-name project INSERTs that both succeed, followed by an INSERT with `start_date='2026-05-24', end_date='2026-05-23'` that rejects.

- [ ] **Step 6: Verify all backend suites and absence of active event terminology**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts test
corepack pnpm@10.28.1 --filter @event-roster/domain test
corepack pnpm@10.28.1 --filter @event-roster/worker test
corepack pnpm@10.28.1 check
rg -n 'EventStatus|EventSummary|eventId|/events|EVENT_CLOSED|PRE_EVENT|DAY_OF' packages apps/worker/src apps/worker/test
```

Expected: all tests PASS; final `rg` exits 1 because migrations and historical docs are outside the scanned paths. If a match exists, remove it before committing.

- [ ] **Step 7: Commit**

```bash
git add packages apps/worker
git commit -m "refactor: move roster operations to projects"
```

### Task 6: Build the B-style project grid and project routing

**Files:**
- Create: `apps/web/src/features/projects/ProjectCard.tsx`
- Create: `apps/web/src/features/projects/ProjectFormDialog.tsx`
- Create: `apps/web/src/features/projects/ProjectsPage.tsx`
- Create: `apps/web/src/features/projects/projects.test.tsx`
- Rename: `apps/web/src/features/roster/RosterPage.tsx` → `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/{ProjectRosterPage,SummaryCards,RosterTable,AuditPanel}.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Delete: `apps/web/src/features/events/{EventForm,EventTransitionDialog,EventsPage,events.test}.tsx`

**Interfaces:**
- Consumes: project-only Worker API and `Project`, `ProjectSummary` contracts.
- Produces: `/projects` B-style card grid, project creation dialog, `/projects/:projectId` roster-compatible route.

- [ ] **Step 1: Write RED grid and routing tests**

Create `projects.test.tsx` with mocked API responses:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectsPage } from "./ProjectsPage";

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: "OPERATOR" } } },
  }),
}));

beforeEach(() => vi.clearAllMocks());

const projectFixture = {
  id: "project-1",
  name: "상반기 리더십 캠프",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  status: "PRE_REGISTRATION" as const,
  revision: 0,
  createdAt: "2026-02-10T00:00:00.000Z",
  updatedAt: "2026-02-10T00:00:00.000Z",
  closedAt: null,
  closeReason: null,
};

it("renders the minimal B-style project card fields", async () => {
  mockApi.get.mockResolvedValueOnce([
    {
      id: "project-1",
      name: "상반기 리더십 캠프",
      startDate: "2026-05-22",
      endDate: "2026-05-23",
      status: "PRE_REGISTRATION",
      revision: 0,
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
      closedAt: null,
      closeReason: null,
    },
    {
      id: "project-2",
      name: "일정 미정 프로젝트",
      startDate: null,
      endDate: null,
      status: "PREPARING",
      revision: 0,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      closedAt: null,
      closeReason: null,
    },
  ]);
  render(<ProjectsPage />);
  expect(await screen.findByText("상반기 리더십 캠프")).toBeVisible();
  expect(screen.getByText("시작 2026.05.22")).toBeVisible();
  expect(screen.getByText("종료 2026.05.23")).toBeVisible();
  expect(screen.getByText("시작 미정")).toBeVisible();
  expect(screen.getByText("종료 수동")).toBeVisible();
  expect(screen.queryByText(/예상 .*명/)).not.toBeInTheDocument();
});
```

Add these form and navigation assertions:

```tsx
it("submits project dates and blocks a reversed range", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ProjectFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "새 프로젝트" } });
  fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-05-24" } });
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-05-23" } });
  expect(screen.getByRole("button", { name: "프로젝트 만들기" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-05-25" } });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
    name: "새 프로젝트",
    startDate: "2026-05-24",
    endDate: "2026-05-25",
  }));
});

it("links cards to project details", async () => {
  mockApi.get.mockResolvedValueOnce([projectFixture]);
  render(<ProjectsPage />);
  expect(await screen.findByRole("link", { name: /상반기 리더십 캠프/ }))
    .toHaveAttribute("href", "/projects/project-1");
});
```

Update `App.test.tsx` to assert `프로젝트` and `계정` navigation links, absence of an `조직` link, and absence of the heading text `행사 참가자 명단` after authenticated render.

- [ ] **Step 2: Run web tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/projects/projects.test.tsx src/app/App.test.tsx src/features/roster/roster.test.tsx
```

Expected: FAIL because project components and routes do not exist.

- [ ] **Step 3: Implement reusable project card and form dialog**

`ProjectCard.tsx` receives exactly:

```ts
export interface ProjectCardProps {
  project: Project;
}
```

Render status label through an exhaustive mapping:

```ts
const STATUS_LABEL: Record<ProjectStatus, string> = {
  PREPARING: "준비 중",
  PRE_REGISTRATION: "사전 등록",
  IN_PROGRESS: "진행 중",
  CLOSED: "종료",
};
```

The card link is `/projects/${encodeURIComponent(project.id)}`. Render only badge, name, start label, end label, and KST creation date. Apply `er-project-card--closed` when CLOSED.

`ProjectFormDialog.tsx` owns `name`, `startDate`, `endDate`; converts empty date strings to omitted keys; disables submit when `endDate < startDate`; calls:

```ts
onSubmit(input: { name: string; startDate?: string; endDate?: string }): Promise<void>;
```

- [ ] **Step 4: Implement `ProjectsPage` and rename roster endpoints**

`ProjectsPage` loads `GET /projects`, opens the dialog only for operators, POSTs `/projects`, reloads after success, and keeps server order without client resorting.

Rename `RosterPage` to `ProjectRosterPage`, prop `eventId` to `projectId`, `EventSummary` to `ProjectSummary`, and every endpoint to `/projects/${projectId}`. Change visible error strings from 행사 to 프로젝트 and `EVENT_CLOSED` handling to `PROJECT_CLOSED`:

```ts
if (error instanceof ApiError && error.problem?.code === "PROJECT_CLOSED") {
  setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
  await load();
  return false;
}
```

Replace the two-request participant create/add recovery path with one atomic roster POST:

```ts
async function createAndAdd(input: { name: string; organizationId: string }) {
  if (!project) return;
  const completed = await handleMutation(() =>
    api.post(`/projects/${projectId}/roster`, {
      newParticipant: input,
      expectedRevision: project.revision,
    }),
  );
  if (completed) setShowAdd(false);
}

async function updateParticipant(input: {
  name: string;
  organizationId: string;
  expectedRevision: number;
}) {
  if (!project || !editingParticipant) return;
  const completed = await handleMutation(() =>
    api.patch(`/projects/${projectId}/participants/${editingParticipant.id}`, {
      ...input,
      expectedProjectRevision: project.revision,
    }),
  );
  if (completed) setEditingParticipant(null);
}
```

Delete `pendingCreatedParticipantId` and the partial-success message because the server now commits both rows atomically.

- [ ] **Step 5: Replace AppShell routes and CSS**

Use these routes only:

```ts
if (path === "/" || path === "/projects") return <ProjectsPage />;
if (path === "/users" && operator) return <UsersPage />;
const importMatch = path.match(/^\/projects\/([^/]+)\/import$/);
const projectMatch = path.match(/^\/projects\/([^/]+)$/);
```

Navigation contains `프로젝트` and operator-only `계정`; remove organization menu/import. Add this responsive card CSS, reusing existing color/radius tokens:

```css
.er-project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}

.er-project-card {
  display: grid;
  gap: 1rem;
  min-height: 13rem;
  padding: 1.25rem;
  color: inherit;
  text-decoration: none;
}

.er-project-card--closed {
  opacity: 0.72;
  border-color: color-mix(in srgb, var(--er-color-border) 72%, transparent);
}

.er-project-card__dates {
  display: grid;
  gap: 0.25rem;
  color: var(--er-color-text-muted);
}
```

- [ ] **Step 6: Verify web GREEN**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 --filter @event-roster/web check
corepack pnpm@10.28.1 --filter @event-roster/web build
```

Expected: all web tests PASS and build emits the SPA assets.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add project grid and routing"
```

### Task 7: Build the project detail tabs and project organization UI

**Files:**
- Create: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Create: `apps/web/src/features/projects/ProjectEditDialog.tsx`
- Create: `apps/web/src/features/projects/ProjectOverview.tsx`
- Create: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Create: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/imports/ImportWizard.tsx`
- Modify: `apps/web/src/lib/excel/download-workbook.ts`
- Modify: `apps/web/src/features/imports/{imports.test.tsx,export.test.ts}`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Project detail, summary, project organization and roster APIs.
- Produces: `개요 / 조직 / 참가 명단 / 변경 이력` tabs and project-scoped organization management.

- [ ] **Step 1: Write RED detail and organization UI tests**

Create `project-detail.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectOrganizationsPanel } from "./ProjectOrganizationsPanel";

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    api: mockApi,
    auth: { session: { user: { role: "OPERATOR" } } },
  }),
}));

const project = {
  id: "project-1",
  name: "리더십 캠프",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  status: "PRE_REGISTRATION" as const,
  revision: 1,
  createdAt: "2026-02-10T00:00:00.000Z",
  updatedAt: "2026-02-10T00:00:00.000Z",
  closedAt: null,
  closeReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") return project;
    if (path === "/projects/project-1/organizations") return [];
    if (path === "/organizations") return [{ id: "org-1", name: "1팀", isActive: true }];
    if (path === "/projects/project-1/summary") {
      return { projectId: "project-1", expectedTotal: 0, finalTotal: 0, deltaTotal: 0, organizations: [] };
    }
    if (path.startsWith("/projects/project-1/audit")) return { items: [], nextCursor: null };
    if (path === "/projects/project-1/roster" || path === "/participants") return [];
    throw new Error(`unexpected path: ${path}`);
  });
});

it("shows four tabs and adds an existing organization", async () => {
  render(<ProjectDetailPage projectId="project-1" />);
  expect(await screen.findByRole("tab", { name: "개요" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "조직" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "참가 명단" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "변경 이력" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "조직" }));
  fireEvent.change(screen.getByLabelText("기존 조직"), { target: { value: "org-1" } });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
    "/projects/project-1/organizations", { organizationId: "org-1" },
  ));
});

it("creates a new organization and hides controls in read-only mode", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const view = render(<ProjectOrganizationsPanel
    projectId="project-1"
    memberships={[]}
    allOrganizations={[]}
    canAdminister
    onChanged={onChanged}
  />);
  fireEvent.change(screen.getByLabelText("새 조직 이름"), { target: { value: "신규 조직" } });
  fireEvent.click(screen.getByRole("button", { name: "새 조직 추가" }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
    "/projects/project-1/organizations", { newOrganizationName: "신규 조직" },
  ));
  view.rerender(<ProjectOrganizationsPanel
    projectId="project-1"
    memberships={[{ organizationId: "org-1", name: "1팀", isActive: false, masterIsActive: true, activeProjectCount: 2, hasHistory: true }]}
    allOrganizations={[]}
    canAdminister={false}
    onChanged={onChanged}
  />);
  expect(screen.queryByRole("button", { name: /다시 사용|사용 중지|이름 저장/ })).not.toBeInTheDocument();
});

it("confirms the global impact before renaming", async () => {
  render(<ProjectOrganizationsPanel
    projectId="project-1"
    memberships={[{ organizationId: "org-1", name: "1팀", isActive: true, masterIsActive: true, activeProjectCount: 2, hasHistory: true }]}
    allOrganizations={[]}
    canAdminister
    onChanged={vi.fn().mockResolvedValue(undefined)}
  />);
  fireEvent.change(screen.getByLabelText("1팀 조직 이름"), { target: { value: "변경 조직" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  expect(screen.getByText("이 변경은 현재 2개 활성 프로젝트에 반영됩니다.")).toBeVisible();
  expect(mockApi.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
    "/organizations/org-1", { name: "변경 조직" },
  ));
});
```

Add these transition and reopen tests:

```tsx
it("reloads once after a stale transition without replaying it", async () => {
  mockApi.post.mockRejectedValueOnce(new ApiError(409, {
    code: "STALE_REVISION",
    message: "stale",
    requestId: "request-1",
  }));
  render(<ProjectDetailPage projectId="project-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 시작" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 확인" }));
  expect(await screen.findByText("다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.")).toBeVisible();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(mockApi.get.mock.calls.filter(([path]) => path === "/projects/project-1").length).toBe(2);
});

it("requires a past end date to be cleared before reopen", async () => {
  mockApi.get.mockImplementation(async (path: string) => {
    if (path === "/projects/project-1") {
      return { ...project, status: "CLOSED", revision: 2, endDate: "2026-05-23", closedAt: "2026-05-24T00:00:00.000Z", closeReason: "SCHEDULED" };
    }
    if (path === "/projects/project-1/organizations" || path === "/organizations" || path === "/projects/project-1/roster" || path === "/participants") return [];
    if (path === "/projects/project-1/summary") return { projectId: "project-1", expectedTotal: 0, finalTotal: 0, deltaTotal: 0, organizations: [] };
    if (path.startsWith("/projects/project-1/audit")) return { items: [], nextCursor: null };
    throw new Error(`unexpected path: ${path}`);
  });
  mockApi.patch.mockResolvedValueOnce({ ...project, status: "CLOSED", revision: 3, endDate: null });
  render(<ProjectDetailPage projectId="project-1" />);
  expect(await screen.findByRole("button", { name: "프로젝트 재개" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "일정 수정" }));
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
    "/projects/project-1", { startDate: "2026-05-22", endDate: null, expectedRevision: 2 },
  ));
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run src/features/projects/project-detail.test.tsx src/features/imports/imports.test.tsx src/features/imports/export.test.ts
```

Expected: FAIL because project detail tabs do not exist and Excel labels still use events.

- [ ] **Step 3: Implement detail header, transitions, and overview**

`ProjectDetailPage` loads project, summary, memberships, roster, and audit through focused child components. Use semantic tabs with `role="tablist"`, `role="tab"`, `aria-selected`, and one mounted panel at a time. Header displays name, status, dates, `자동 종료` when `endDate` exists or `수동 종료` otherwise.

`ProjectEditDialog` accepts `project`, `closed`, `onSubmit`, and `onClose`. In non-CLOSED states it edits name and dates; in CLOSED state it disables the name field and submits only `startDate`, `endDate`, and `expectedRevision`. Disable the reopen action while `project.endDate !== null && project.endDate < currentKstDate`; show `종료일을 미래로 변경하거나 제거한 뒤 재개하세요.` beside it.

Transition actions are exhaustive:

```ts
const NEXT_ACTION: Record<ProjectStatus, { target: ProjectStatus; label: string }> = {
  PREPARING: { target: "PRE_REGISTRATION", label: "사전 등록 시작" },
  PRE_REGISTRATION: { target: "IN_PROGRESS", label: "진행 시작" },
  IN_PROGRESS: { target: "CLOSED", label: "프로젝트 종료" },
  CLOSED: { target: "IN_PROGRESS", label: "프로젝트 재개" },
};
```

`ProjectOverview` renders registered organization count and `ProjectSummary` totals. Do not duplicate roster fetching inside overview.

- [ ] **Step 4: Implement the organization panel**

`ProjectOrganizationsPanel` receives:

```ts
interface ProjectOrganizationsPanelProps {
  projectId: string;
  memberships: ProjectOrganization[];
  allOrganizations: Organization[];
  canAdminister: boolean;
  onChanged(): Promise<void>;
}
```

Existing organization POST body is `{organizationId}`; new organization body is `{newOrganizationName}`. Disable action calls PATCH `{isActive:false}` and reactivation calls POST `{organizationId}`. Before global rename, show `이 변경은 현재 ${activeProjectCount}개 활성 프로젝트에 반영됩니다.` in a dialog and call the existing global organization PATCH only after confirmation.

- [ ] **Step 5: Integrate roster, audit, and Excel tabs**

Move the existing roster table/dialog behavior under the `참가 명단` tab and audit pagination under `변경 이력`. Participant organization selectors use active project memberships only. Import wizard loads `/projects/:projectId/organizations`; export endpoint is `/projects/:projectId/exports/roster`.

Change downloaded filename and sheet metadata:

```ts
const filename = `${sanitizeFilename(projectName)}-프로젝트-명단.xlsx`;
const summarySheetName = "프로젝트 집계";
const rosterSheetName = "참가 명단";
```

Keep exactly two sheets and all 130-row browser-only constraints.

- [ ] **Step 6: Verify detail UI GREEN and accessibility basics**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test
corepack pnpm@10.28.1 --filter @event-roster/web check
corepack pnpm@10.28.1 --filter @event-roster/web build
```

Expected: all tests PASS; tabs are keyboard-focusable; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add project detail operations"
```

### Task 8: Update local E2E, operations docs, and complete verification

**Files:**
- Rename: `apps/web/e2e/event-roster.spec.ts` → `apps/web/e2e/project-roster.spec.ts`
- Create: `apps/web/e2e/scheduled-expiration.spec.ts`
- Modify: `apps/web/e2e/global-setup.ts`
- Modify: `apps/web/e2e/support.ts`
- Modify: `apps/web/e2e/import-export.spec.ts`
- Modify: `apps/worker/scripts/prepare-e2e-env.mts`
- Modify: `apps/worker/wrangler.e2e.jsonc`
- Modify: `docs/operations/{deployment,recovery,monthly-check}.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: complete project-only application.
- Produces: project fixture, scheduled local verification, deployment instructions for one Cron Trigger, and complete regression evidence.

- [ ] **Step 1: Rewrite E2E setup and scenarios to RED project behavior**

Change fixture shape:

```ts
interface Fixture {
  baseUrl: string;
  bootstrapToken: string;
  bootstrap: { loginId: string; displayName: string; password: string };
  operator: { loginId: string; displayName: string; password: string };
  temporaryUser: { loginId: string; displayName: string; password?: string };
  organizationId?: string;
  projectId?: string;
}
```

Global setup sequence must be:

```ts
const projectResponse = await api.post("/api/v1/projects", {
  headers: authHeaders(operatorAuth),
  data: {
    name: "E2E 상반기 프로젝트",
    startDate: "2029-05-22",
    endDate: "2029-05-23",
  },
});
const project = (await projectResponse.json()) as { id: string; revision: number };
await ok(await api.post(`/api/v1/projects/${project.id}/organizations`, {
  headers: authHeaders(operatorAuth),
  data: { organizationId: fixture.organizationId },
}));
await ok(await api.post(`/api/v1/projects/${project.id}/transition`, {
  headers: authHeaders(operatorAuth),
  data: { targetStatus: "PRE_REGISTRATION", expectedRevision: project.revision },
}));
fixture.projectId = project.id;
```

`project-roster.spec.ts` navigates to `/projects/:projectId`, verifies all four tabs, opens 참가 명단, and sees `예상 0명`. Import/export still imports 130 rows and downloads a two-sheet workbook whose filename contains `프로젝트-명단`.

Create `scheduled-expiration.spec.ts`:

```ts
import { expect, request, test } from "@playwright/test";
import { fixture } from "./support";

test("scheduled handler closes an expired project", async () => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  const login = await api.post("/api/v1/auth/login", {
    data: { loginId: data.operator.loginId, password: data.operator.password },
  });
  const auth = (await login.json()) as { accessToken: string; csrfToken: string };
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-ER-CSRF": auth.csrfToken,
  };
  const created = await api.post("/api/v1/projects", {
    headers,
    data: { name: "E2E 만료 프로젝트", endDate: "2020-01-01" },
  });
  const project = (await created.json()) as { id: string };
  expect((await api.get("/__scheduled?cron=0+15+*+*+*" )).ok()).toBe(true);
  const closed = await api.get(`/api/v1/projects/${project.id}`, { headers });
  expect(await closed.json()).toMatchObject({ status: "CLOSED", closeReason: "SCHEDULED" });
  await api.dispose();
});
```

- [ ] **Step 2: Run E2E to verify RED**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: FAIL until all project fixture paths and UI expectations are updated.

- [ ] **Step 3: Implement the E2E fixture and scheduled local smoke**

Update all fixture keys and paths to `projectId`. Keep HTTPS 127.0.0.1, one Playwright worker, no existing server reuse, random ignored secrets, and isolated D1 state. Add `--test-scheduled` to the `e2e:serve` Wrangler command so `/__scheduled` exists only while the Playwright web server is running; `scheduled-expiration.spec.ts` is the CI smoke and no public application route is added.

- [ ] **Step 4: Update runbooks and deployment checks**

Document these exact additions in `deployment.md`:

```text
1. `wrangler deploy --dry-run`에서 Scheduled Trigger `0 15 * * *` 확인
2. 실제 deploy 후 Cloudflare Dashboard의 Trigger 목록에 Cron 하나만 있는지 확인
3. KST 경계 fixture로 scheduled handler를 수동 검증
4. 만료 프로젝트 mutation이 PROJECT_CLOSED를 반환하는지 확인
5. project_organizations와 project roster migration 행 수 확인
```

Update recovery/export terminology to project. Monthly check includes Cron Past Events success/failure, auto-close audit sampling, and D1 export containing `projects` and `project_organizations`. README local examples use `/projects` and project E2E wording.

- [ ] **Step 5: Run the complete verification matrix**

Run exactly:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
git diff --check
rg -n '행사|/events|eventId|EventStatus|EVENT_CLOSED|PRE_EVENT|DAY_OF' apps packages README.md docs/operations
```

Expected:

- contracts, domain, Worker, Web, spike regression suites all PASS.
- strict type checks and Biome format checks PASS.
- web build and Worker dry-run exit 0; dry-run lists one Cron Trigger and creates no remote resource.
- Playwright auth, project roster, and 130-row Excel scenarios PASS.
- `git diff --check` has no output.
- final terminology scan has matches only in `apps/worker/migrations/0001_initial.sql`, the data-copy section of `0002_project_model.sql`, and runbook migration-history explanations. Active source, tests, current UI copy, and API paths have no legacy matches.

- [ ] **Step 6: Commit the delivery updates**

```bash
git add .github README.md apps/web/e2e apps/worker/scripts apps/worker/wrangler.e2e.jsonc docs/operations
git commit -m "test: verify project-centered roster flows"
```

## Plan Self-Review

- [x] Spec coverage: 프로젝트 필드·상태·B형 그리드·프로젝트 조직·참가자 재사용·스냅샷·Cron·migration·Excel·권한·감사가 Task 1–8에 각각 매핑된다.
- [x] Deployment safety: 중간 migration 커밋은 배포하지 않으며 실제 Cloudflare 변경은 전체 검증 뒤 별도 승인으로 제한한다.
- [x] Placeholder scan: 미결정 표기 없이 각 코드 변경 단계에 실제 인터페이스, SQL/TypeScript/TSX, 명령, 기대 결과가 있다.
- [x] Type consistency: `ProjectStatus`, `Project`, `ProjectSummary`, `ProjectOrganization`, `projectId`, `PRE_REGISTRATION`, `IN_PROGRESS`, `PROJECT_CLOSED`가 모든 Task에서 동일하다.
- [x] Migration consistency: `0001`은 불변이고 `0002`가 UUID·명단·snapshot·import·audit를 보존한 최종 프로젝트 schema를 만든다.
- [x] Test consistency: 각 Task가 RED 확인, 최소 구현, GREEN 확인, 커밋으로 끝나며 Task 8이 전체 회귀를 다시 검증한다.
