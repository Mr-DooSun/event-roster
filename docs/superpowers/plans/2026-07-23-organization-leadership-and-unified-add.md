# Organization Leadership and Unified Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트의 기존/신규 조직 연결을 하나의 검색 흐름으로 합치고, 운영자가 조직별 대표 조직장 한 명과 추가 관리자 여러 명을 관리하며 담당자가 사전 등록 명단만 직접 관리하도록 만든다.

**Architecture:** 전역 인증 역할(`OPERATOR`, `ORGANIZATION_MANAGER`)과 조직별 배정 역할(`PRIMARY_LEADER`, `MANAGER`)을 분리하고 D1의 `user_organizations`를 권위 데이터로 사용한다. Worker는 조직 마스터·담당자 배정·프로젝트 연결을 각각 원자적 guarded batch로 처리하고, React는 프로젝트 연결 UI와 운영자 전용 조직 관리 UI를 분리한다. 기존 자체 비밀번호/JWT, 세션 재검증, 프로젝트 revision, append-only 감사 패턴을 그대로 확장한다.

**Tech Stack:** TypeScript, pnpm 10.28.1, Zod, Hono, Cloudflare Workers, D1/SQLite, React 19, Vitest, Cloudflare Workers test pool, Playwright, Biome

## Global Constraints

- 전역 사용자 역할은 `OPERATOR | ORGANIZATION_MANAGER`만 유지한다.
- 조직별 배정 역할은 `PRIMARY_LEADER | MANAGER`이며 활성 조직당 대표는 최대 한 명이다.
- 한 계정은 여러 조직에 배정될 수 있고 조직마다 다른 배정 역할을 가질 수 있다.
- 대표와 추가 관리자의 명단 권한은 동일하며 조직 정보·계정·담당자 배정은 운영자만 변경한다.
- 조직 담당자는 담당 조직의 `PRE_REGISTRATION` 명단만 변경하고 `IN_PROGRESS` 이후 변경은 운영자만 수행한다.
- 조직 담당자 계정은 참가자나 프로젝트 명단을 자동 생성하지 않는다.
- 조직은 대표 없이 프로젝트에 연결할 수 있다.
- 프로젝트 조직 추가는 기존 조직 선택 또는 명시적 새 조직 생성 중 정확히 하나만 허용한다.
- 새 조직 생성과 프로젝트 연결은 하나의 guarded D1 batch에서 성공하거나 함께 rollback한다.
- 계정·조직·담당자·프로젝트 연결 변경은 raw 비밀번호, hash, JWT, refresh token, CSRF, 원문 IP를 제외하고 append-only 감사 이력에 남긴다.
- Excel 원본 파일은 서버에 저장하지 않고 기존 브라우저 처리 방식을 유지한다.
- 물리적인 조직·사용자 삭제는 제공하지 않는다.

---

## File Structure

### Contracts

- `packages/contracts/src/organizations.ts`: 조직 목록/상세, 조직별 담당자 역할, 담당자 배정, 통합 프로젝트 조직 추가 계약을 소유한다.
- `packages/contracts/src/auth.ts`: 기존 세션의 `organizationIds`를 유지하며 전역 인증 역할만 소유한다.
- `packages/contracts/test/contracts.test.ts`: strict union, nullable expected primary, 프로젝트 revision 요구를 검증한다.

### Worker and D1

- `apps/worker/migrations/0003_organization_leadership.sql`: `user_organizations`를 역할·작업자·시각 포함 구조로 이관하고 대표 unique index를 만든다.
- `apps/worker/src/db/organizations.ts`: 조직 목록/상세/담당자/연결 프로젝트/조직 감사 read model을 전담한다.
- `apps/worker/src/services/audit-pages.ts`: 감사 cursor encode/decode와 details sanitization을 프로젝트·조직 감사에서 공유한다.
- `apps/worker/src/db/admin.ts`: 사용자 계정 read model만 남긴다.
- `apps/worker/src/services/organizations.ts`: 조직 CRUD, 담당자 배정·해제·대표 교체와 감사 batch를 전담한다.
- `apps/worker/src/services/admin.ts`: 계정 생성·수정·비밀번호 초기화만 담당하고 조직 배정 mutation을 제거한다.
- `apps/worker/src/routes/organizations.ts`: 조직 검색·상세·감사·담당자 endpoint와 schema parsing을 연결한다.
- `apps/worker/src/db/project-organizations.ts`: 프로젝트 조직 행에 대표, 관리자 수, 현재 명단 수를 집계한다.
- `apps/worker/src/services/project-organizations.ts`: expected project revision, 프로젝트 revision 증가, 동시 중복 생성 복구를 처리한다.
- `apps/worker/src/routes/project-organizations.ts`: revision 포함 프로젝트 조직 계약을 적용한다.
- `apps/worker/test/support/organization-leadership.ts`: 조직 책임자 통합 테스트에서 공유하는 고정 ID fixture와 요청 helper를 소유한다.
- `apps/worker/test/organization-leadership.integration.test.ts`: 담당자 배정과 대표 제약의 전용 통합 테스트다.
- 기존 `admin`, `project-organizations`, `schema`, `project-migration`, `participants`, `roster` 테스트: 회귀와 권한 경계를 검증한다.

### Web

- `apps/web/src/features/projects/OrganizationCombobox.tsx`: 접근 가능한 검색/listbox와 명시적 새 조직 생성 option을 소유한다.
- `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`: 통합 추가 흐름, 연결 상태, 대표 표시, 조직 관리 링크만 담당한다.
- `apps/web/src/features/admin/OrganizationsPage.tsx`: 조직 검색/필터/요약 목록을 담당한다.
- `apps/web/src/features/admin/OrganizationDetailPage.tsx`: 조직 정보, 연결 프로젝트, 감사 pagination을 조합한다.
- `apps/web/src/features/admin/OrganizationManagersPanel.tsx`: 기존 계정 배정, 새 담당자 발급, 대표 교체·해제를 담당한다.
- `apps/web/src/features/admin/UserForm.tsx`: 조직 체크박스 없이 전역 계정 필드만 입력한다.
- `apps/web/src/features/admin/UserEditRow.tsx`: 조직 체크박스 없이 전역 계정 상태만 수정한다.
- `apps/web/src/features/admin/UsersPage.tsx`: 계정 CRUD와 임시 비밀번호 표시만 유지한다.
- `apps/web/src/app/AppShell.tsx`: 운영자 전용 `조직 관리` navigation과 상세 route를 제공한다.
- `apps/web/src/styles/global.css`: combobox, 조직 요약 grid, 담당자/프로젝트 목록의 반응형 스타일을 추가한다.
- `apps/web/e2e/organization-management.spec.ts`: 운영자 발급부터 조직 담당자의 사전 명단 입력까지 검증한다.

---

### Task 1: Define Organization Leadership Contracts

**Files:**
- Modify: `packages/contracts/src/organizations.ts`
- Modify: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consumes: `LoginIdSchema`, existing `OrganizationIdSchema`, project revision convention.
- Produces: `OrganizationAssignmentRole`, `OrganizationSummary`, `OrganizationDetail`, `OrganizationManager`, `OrganizationManagerCreateRequest`, `OrganizationPrimaryPatchRequest`, revision-bearing `AddProjectOrganization`, `ProjectOrganizationPatch`, and enriched `ProjectOrganization`.

- [ ] **Step 1: Write failing strict-contract tests**

Add these imports and cases to `packages/contracts/test/contracts.test.ts`:

```ts
import {
  AddProjectOrganizationSchema,
  OrganizationManagerCreateRequestSchema,
  OrganizationPrimaryPatchRequestSchema,
  ProjectOrganizationPatchSchema,
} from "../src";

it("requires a project revision and exactly one organization source", () => {
  expect(
    AddProjectOrganizationSchema.parse({
      organizationId: "org-1",
      expectedProjectRevision: 4,
    }),
  ).toEqual({ organizationId: "org-1", expectedProjectRevision: 4 });
  expect(
    AddProjectOrganizationSchema.safeParse({
      organizationId: "org-1",
      newOrganizationName: "새 조직",
      expectedProjectRevision: 4,
    }).success,
  ).toBe(false);
  expect(
    ProjectOrganizationPatchSchema.safeParse({ isActive: false }).success,
  ).toBe(false);
});

it("distinguishes existing and newly provisioned organization managers", () => {
  expect(
    OrganizationManagerCreateRequestSchema.parse({
      kind: "EXISTING",
      userId: "user-1",
      assignmentRole: "MANAGER",
    }),
  ).toEqual({
    kind: "EXISTING",
    userId: "user-1",
    assignmentRole: "MANAGER",
  });
  expect(
    OrganizationManagerCreateRequestSchema.safeParse({
      kind: "NEW",
      userId: "user-1",
      loginId: "manager-01",
      displayName: "담당자",
      assignmentRole: "MANAGER",
    }).success,
  ).toBe(false);
});

it("requires the observed primary when replacing or removing a leader", () => {
  expect(
    OrganizationPrimaryPatchRequestSchema.parse({
      userId: "user-2",
      expectedPrimaryUserId: "user-1",
      previousPrimaryDisposition: "MANAGER",
    }),
  ).toEqual({
    userId: "user-2",
    expectedPrimaryUserId: "user-1",
    previousPrimaryDisposition: "MANAGER",
  });
  expect(
    OrganizationPrimaryPatchRequestSchema.parse({
      userId: null,
      expectedPrimaryUserId: "user-1",
      previousPrimaryDisposition: "REMOVE",
    }).userId,
  ).toBeNull();
});
```

- [ ] **Step 2: Run the contracts test to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/contracts test -- contracts.test.ts`

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Implement the organization contracts**

Replace and extend the relevant declarations in `packages/contracts/src/organizations.ts` with these exact public shapes:

```ts
import { z } from "zod";
import { LoginIdSchema } from "./auth";

export const OrganizationIdSchema = z.string().trim().min(1);
export const OrganizationAssignmentRoleSchema = z.enum([
  "PRIMARY_LEADER",
  "MANAGER",
]);
export type OrganizationAssignmentRole = z.infer<
  typeof OrganizationAssignmentRoleSchema
>;

export const OrganizationSchema = z.object({
  id: OrganizationIdSchema,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export interface OrganizationManager {
  userId: string;
  loginId: string;
  displayName: string;
  isActive: boolean;
  assignmentRole: OrganizationAssignmentRole;
  assignedAt: string;
}

export interface OrganizationProject {
  projectId: string;
  projectName: string;
  projectStatus: "PREPARING" | "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED";
  membershipIsActive: boolean;
}

export interface OrganizationSummary extends Organization {
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  projectCount: number;
}

export interface OrganizationDetail extends OrganizationSummary {
  managers: OrganizationManager[];
  projects: OrganizationProject[];
}

export const OrganizationPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.isActive !== undefined);

export const OrganizationManagerCreateRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("EXISTING"),
        userId: z.string().trim().min(1),
        assignmentRole: OrganizationAssignmentRoleSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("NEW"),
        loginId: LoginIdSchema,
        displayName: z.string().trim().min(1).max(100),
        assignmentRole: OrganizationAssignmentRoleSchema,
      })
      .strict(),
  ],
);
export type OrganizationManagerCreateRequest = z.infer<
  typeof OrganizationManagerCreateRequestSchema
>;

export const OrganizationPrimaryPatchRequestSchema = z
  .object({
    userId: z.string().trim().min(1).nullable(),
    expectedPrimaryUserId: z.string().trim().min(1).nullable(),
    previousPrimaryDisposition: z.enum(["REMOVE", "MANAGER"]),
  })
  .strict();
export type OrganizationPrimaryPatchRequest = z.infer<
  typeof OrganizationPrimaryPatchRequestSchema
>;

const ExpectedProjectRevisionSchema = z.number().int().min(0);
export const AddProjectOrganizationSchema = z.union([
  z
    .object({
      organizationId: OrganizationIdSchema,
      expectedProjectRevision: ExpectedProjectRevisionSchema,
    })
    .strict(),
  z
    .object({
      newOrganizationName: z.string().trim().min(1).max(100),
      expectedProjectRevision: ExpectedProjectRevisionSchema,
    })
    .strict(),
]);
export type AddProjectOrganization = z.infer<
  typeof AddProjectOrganizationSchema
>;

export const ProjectOrganizationPatchSchema = z
  .object({
    isActive: z.boolean(),
    expectedProjectRevision: ExpectedProjectRevisionSchema,
  })
  .strict();
export type ProjectOrganizationPatch = z.infer<
  typeof ProjectOrganizationPatchSchema
>;

export interface ProjectOrganization {
  organizationId: string;
  name: string;
  isActive: boolean;
  masterIsActive: boolean;
  activeProjectCount: number;
  hasHistory: boolean;
  primaryLeader: Pick<OrganizationManager, "userId" | "displayName"> | null;
  managerCount: number;
  rosterCount: number;
}

export interface ProjectOrganizationMutationResult {
  organization: ProjectOrganization;
  projectRevision: number;
}
```

- [ ] **Step 4: Run contracts tests and typecheck**

Run: `corepack pnpm@10.28.1 --filter @event-roster/contracts test -- contracts.test.ts && corepack pnpm@10.28.1 --filter @event-roster/contracts run check`

Expected: PASS.

- [ ] **Step 5: Commit the contract boundary**

```bash
git add packages/contracts/src/organizations.ts packages/contracts/test/contracts.test.ts
git commit -m "feat: define organization leadership contracts"
```

### Task 2: Migrate Organization Assignments Without Data Loss

**Files:**
- Create: `apps/worker/migrations/0003_organization_leadership.sql`
- Modify: `apps/worker/test/project-migration.integration.test.ts`
- Modify: `apps/worker/test/schema.integration.test.ts`
- Modify: `apps/worker/test/support/admin.ts`
- Modify: `apps/worker/test/participants.integration.test.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`

**Interfaces:**
- Consumes: legacy `user_organizations(user_id, organization_id)` after migration `0002`.
- Produces: `user_organizations(user_id, organization_id, assignment_role, assigned_by, assigned_at)` and unique index `user_organizations_one_primary`.

- [ ] **Step 1: Extend the migration preservation test and schema constraints**

In `apps/worker/test/project-migration.integration.test.ts`, seed a manager and legacy assignment after applying `0001`, apply `0002` and `0003`, and assert:

```ts
const [initial, projectModel, organizationLeadership] = env.TEST_MIGRATIONS;
if (!initial || !projectModel || !organizationLeadership) {
  throw new Error("expected migrations 0001, 0002 and 0003");
}

await env.MIGRATION_DB.prepare(`INSERT INTO users
  (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
   session_version, created_at, updated_at)
  VALUES ('migration-manager', 'migration-manager', 'migration-manager',
   '이관 담당자', 'ORGANIZATION_MANAGER', 1, 0, 1, '2026-01-01', '2026-01-01')`).run();
await env.MIGRATION_DB.prepare(
  "INSERT INTO user_organizations (user_id, organization_id) VALUES ('migration-manager', 'migration-org')",
).run();

await applyD1Migrations(env.MIGRATION_DB, [projectModel, organizationLeadership]);
expect(
  await env.MIGRATION_DB.prepare(`SELECT assignment_role, assigned_by,
    assigned_at IS NOT NULL AS has_assigned_at FROM user_organizations
    WHERE user_id='migration-manager' AND organization_id='migration-org'`).first(),
).toEqual({
  assignment_role: "MANAGER",
  assigned_by: null,
  has_assigned_at: 1,
});
```

In `apps/worker/test/schema.integration.test.ts`, insert two active manager users and assert a second `PRIMARY_LEADER` for the same organization throws while `MANAGER` succeeds.

- [ ] **Step 2: Run migration tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- project-migration.integration.test.ts schema.integration.test.ts`

Expected: FAIL because migration `0003` and assignment columns do not exist.

- [ ] **Step 3: Create the D1 migration**

Create `apps/worker/migrations/0003_organization_leadership.sql`:

```sql
PRAGMA foreign_keys = ON;

ALTER TABLE user_organizations RENAME TO user_organizations_legacy;

CREATE TABLE user_organizations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL CHECK (assignment_role IN ('PRIMARY_LEADER', 'MANAGER')),
  assigned_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, organization_id)
);

INSERT INTO user_organizations
  (user_id, organization_id, assignment_role, assigned_by, assigned_at)
SELECT user_id, organization_id, 'MANAGER', NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM user_organizations_legacy;

DROP TABLE user_organizations_legacy;

CREATE UNIQUE INDEX user_organizations_one_primary
ON user_organizations (organization_id)
WHERE assignment_role = 'PRIMARY_LEADER';

CREATE INDEX user_organizations_by_organization
ON user_organizations (organization_id, assignment_role, assigned_at);

PRAGMA foreign_key_check;
```

- [ ] **Step 4: Update all test and seed inserts to specify assignment metadata**

Change direct inserts in `apps/worker/test/support/admin.ts`, `participants.integration.test.ts`, `roster.integration.test.ts`, and `schema.integration.test.ts` to this form. Test fixtures use `assigned_by=NULL` to represent pre-feature data; production services added in Task 4 always bind the authenticated operator:

```ts
await env.DB.prepare(`INSERT INTO user_organizations
  (user_id, organization_id, assignment_role, assigned_by, assigned_at)
  VALUES (?, ?, 'MANAGER', NULL, ?)`)
  .bind(userId, organizationId, "2026-07-23T00:00:00.000Z")
  .run();
```

Keep `seedManager(organizationId = "org-1")` unchanged at call sites and insert its fixture assignment with `assigned_by=NULL` and the fixed timestamp above.

- [ ] **Step 5: Run migration and schema tests to verify GREEN**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- project-migration.integration.test.ts schema.integration.test.ts participants.integration.test.ts roster.integration.test.ts`

Expected: PASS with no foreign key violations.

- [ ] **Step 6: Commit the migration**

```bash
git add apps/worker/migrations/0003_organization_leadership.sql apps/worker/test/project-migration.integration.test.ts apps/worker/test/schema.integration.test.ts apps/worker/test/support/admin.ts apps/worker/test/participants.integration.test.ts apps/worker/test/roster.integration.test.ts
git commit -m "feat: migrate organization leadership assignments"
```

### Task 3: Add Organization Search, Detail, Project, and Audit Read Models

**Files:**
- Create: `apps/worker/src/db/organizations.ts`
- Create: `apps/worker/src/services/audit-pages.ts`
- Create: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/src/db/admin.ts`
- Modify: `apps/worker/src/services/admin.ts`
- Modify: `apps/worker/src/routes/organizations.ts`
- Create: `apps/worker/test/organization-leadership.integration.test.ts`
- Create: `apps/worker/test/support/organization-leadership.ts`
- Modify: `apps/worker/test/admin.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 D1 schema.
- Produces: `listOrganizationSummaries`, `getOrganizationDetail`, `getOrganizationAuditPage`, query-filtered `GET /organizations`, operator-only `GET /organizations/:id`, `GET /organizations/:id/assignable-users`, `GET /organizations/:id/audit`, and reusable leadership fixtures.

- [ ] **Step 1: Write failing organization read-model integration tests**

Create `apps/worker/test/organization-leadership.integration.test.ts` with fixtures for one primary, two managers, one active project, and one closed project. Assert:

Create `apps/worker/test/support/organization-leadership.ts` with this deterministic fixture:

```ts
import { env } from "cloudflare:workers";
import type { SeededLogin } from "./admin";
import { seedOperator, seedOrganization } from "./admin";
import { login, seedUser } from "./auth";

export interface LeadershipFixture {
  operator: SeededLogin;
  manager: SeededLogin;
  organizationIds: ["org-1", "org-2"];
  projectIds: ["project-active", "project-closed"];
}

export async function seedLeadershipFixture(): Promise<LeadershipFixture> {
  const operator = await seedOperator();
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  for (const [id, loginId, displayName] of [
    ["leader-1", "leader-01", "대표 조직장"],
    ["manager-2", "manager-02", "추가 관리자 1"],
    ["manager-3", "manager-03", "추가 관리자 2"],
  ] as const) {
    await seedUser({ id, loginId, password: "manager-password-123" });
    await env.DB.prepare(
      "UPDATE users SET role='ORGANIZATION_MANAGER', display_name=? WHERE id=?",
    )
      .bind(displayName, id)
      .run();
  }
  const now = "2026-07-23T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('leader-1', 'org-1', 'PRIMARY_LEADER', ?, ?)`)
      .bind(operator.userId, now),
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('manager-2', 'org-1', 'MANAGER', ?, ?)`)
      .bind(operator.userId, now),
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('manager-3', 'org-1', 'MANAGER', ?, ?)`)
      .bind(operator.userId, now),
    env.DB.prepare(`INSERT INTO projects
      (id, name, status, revision, created_by, created_at, updated_at)
      VALUES ('project-active', '진행 프로젝트', 'PRE_REGISTRATION', 0, ?, ?, ?)`)
      .bind(operator.userId, now, now),
    env.DB.prepare(`INSERT INTO projects
      (id, name, status, revision, created_by, created_at, updated_at,
       closed_at, closed_by, close_reason)
      VALUES ('project-closed', '종료 프로젝트', 'CLOSED', 1, ?, ?, ?, ?, ?, 'MANUAL')`)
      .bind(operator.userId, now, now, now, operator.userId),
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES ('project-active', 'org-1', 1, ?, ?, ?)`)
      .bind(now, operator.userId, operator.userId),
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES ('project-closed', 'org-1', 1, ?, ?, ?)`)
      .bind(now, operator.userId, operator.userId),
  ]);
  const managerLogin = await login("leader-01", "manager-password-123");
  return {
    operator,
    manager: { ...managerLogin, userId: "leader-1" },
    organizationIds: ["org-1", "org-2"],
    projectIds: ["project-active", "project-closed"],
  };
}
```

Use `beforeEach(resetAuthState)` so this helper never deletes data itself.

```ts
it("returns searchable organization summaries and a complete operator detail", async () => {
  const operator = await seedLeadershipFixture();
  const list = await authedRequest(
    operator,
    "/api/v1/organizations?query=1%ED%8C%80&status=ACTIVE&leaderStatus=ASSIGNED",
  );
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([
    expect.objectContaining({
      id: "org-1",
      primaryLeader: { userId: "leader-1", displayName: "대표 조직장" },
      managerCount: 2,
      projectCount: 2,
    }),
  ]);

  const detail = await authedRequest(operator, "/api/v1/organizations/org-1");
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: "org-1",
    managers: [
      expect.objectContaining({
        userId: "leader-1",
        assignmentRole: "PRIMARY_LEADER",
      }),
    ],
    projects: expect.arrayContaining([
      expect.objectContaining({ projectId: "project-active" }),
      expect.objectContaining({ projectId: "project-closed" }),
    ]),
  });
});

it("does not expose organization administration detail to a manager", async () => {
  const { manager } = await seedLeadershipFixture();
  expect(
    (await authedRequest(manager, "/api/v1/organizations/org-1")).status,
  ).toBe(403);
});
```

Also assert `leaderStatus=UNASSIGNED`, `status=INACTIVE`, empty search, malformed query `422`, assignable active `ORGANIZATION_MANAGER` account search excluding users already assigned to the organization, and organization audit pagination ordered by `(occurred_at DESC, id DESC)`.

Add create/rename/status tests asserting `ORGANIZATION_CREATED`, `ORGANIZATION_RENAMED`, `ORGANIZATION_DEACTIVATED`, and `ORGANIZATION_REACTIVATED` details contain sanitized `before`/`after` values and no credential fields.

- [ ] **Step 2: Run the new integration test to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- organization-leadership.integration.test.ts`

Expected: FAIL because detail and filtered read endpoints do not exist.

- [ ] **Step 3: Implement focused D1 read functions**

Create `apps/worker/src/db/organizations.ts` with these exported signatures:

```ts
import type {
  OrganizationDetail,
  OrganizationManager,
  OrganizationSummary,
} from "@event-roster/contracts";

export interface OrganizationListFilters {
  query: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  leaderStatus: "ALL" | "ASSIGNED" | "UNASSIGNED";
  visibleOrganizationIds?: string[];
}

export async function listOrganizationSummaries(
  db: D1Database,
  filters: OrganizationListFilters,
): Promise<OrganizationSummary[]>;

export async function findOrganizationDetail(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationDetail | null>;

export async function listAssignableManagerAccounts(
  db: D1Database,
  organizationId: string,
  query: string,
): Promise<Array<Pick<OrganizationManager, "userId" | "loginId" | "displayName" | "isActive">>>;

export interface OrganizationAuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  occurred_at: string;
  details_json: string;
}

export async function listOrganizationAuditRows(
  db: D1Database,
  organizationId: string,
  limit: number,
  cursor: { occurredAt: string; id: string } | null,
): Promise<{ rows: OrganizationAuditRow[]; hasMore: boolean }>;
```

Use parameter-bound `LIKE ? ESCAPE '\\'` with escaped `%`, `_`, and `\` for query search. Aggregate primary with a correlated subquery, count all `MANAGER` assignment rows as `managerCount` while exposing each account's `isActive` in detail, and count all current/historical `project_organizations` rows as `projectCount`. Order managers by primary first, then display name and user ID; order projects by non-closed first, then project name and ID.

Move `decodeCursor` and `sanitizeAuditDetails` from `services/roster.ts` into `services/audit-pages.ts`, add a matching `encodeCursor`, and import those functions from both roster and organization services. Invalid base64/JSON cursor input throws `DomainError("VALIDATION_FAILED")`; sanitization stringifies scalar JSON values and drops keys matching `password`, `hash`, `token`, `csrf`, `recovery`, or `ip` case-insensitively.

- [ ] **Step 4: Route read requests through the organization service**

Move `getOrganizations`, `createOrganization`, and `updateOrganization` from `services/admin.ts` into `services/organizations.ts`; keep `canonicalizeOrganizationName` exported from the new service. Add:

```ts
export async function getOrganizationSummaries(
  env: Env,
  actor: Actor,
  filters: OrganizationListFilters,
): Promise<OrganizationSummary[]>;

export async function getOrganizationDetail(
  env: Env,
  actor: Actor,
  organizationId: string,
): Promise<OrganizationDetail>;

export async function getOrganizationAuditPage(
  env: Env,
  actor: Actor,
  organizationId: string,
  limit: number,
  cursor: string | null,
): Promise<{
  items: Array<{
    id: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    occurredAt: string;
    details: Record<string, string>;
  }>;
  nextCursor: string | null;
}>;
```

`getOrganizationSummaries` keeps manager-compatible scoped reads for project screens. Detail, account search, and organization audit call `requireAdministrativeOperator` before querying.

`createOrganization` inserts `ORGANIZATION_CREATED` in the same guarded batch. `updateOrganization` writes one exact audit row per changed field (`ORGANIZATION_RENAMED`, `ORGANIZATION_DEACTIVATED`, or `ORGANIZATION_REACTIVATED`); a request containing both fields writes two rows in the same batch. Each row records:

```ts
JSON.stringify({
  before: { name: current.name, isActive: current.isActive },
  after: { name, isActive },
})
```

The organization audit query includes rows whose entity is the organization and rows whose sanitized details contain the same `organizationId`, including project membership and manager assignment actions.

- [ ] **Step 5: Add strict query and detail routes**

In `apps/worker/src/routes/organizations.ts`, parse the list query with:

```ts
const OrganizationListQuerySchema = z
  .object({
    query: z.string().trim().max(100).default(""),
    status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
    leaderStatus: z
      .enum(["ALL", "ASSIGNED", "UNASSIGNED"])
      .default("ALL"),
  })
  .strict();

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
```

Register `GET /organizations/:id/assignable-users?query=` and `GET /organizations/:id/audit` before generic mutation routes. Both require a full non-bootstrap operator. Return `404` for a missing organization before returning an empty candidate or audit result.

- [ ] **Step 6: Run organization read and existing admin tests**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- organization-leadership.integration.test.ts admin.integration.test.ts project-organizations.integration.test.ts roster.integration.test.ts`

Expected: PASS; manager organization list remains scoped and detail remains operator-only.

- [ ] **Step 7: Commit organization read models**

```bash
git add apps/worker/src/db/organizations.ts apps/worker/src/db/admin.ts apps/worker/src/services/audit-pages.ts apps/worker/src/services/organizations.ts apps/worker/src/services/admin.ts apps/worker/src/services/roster.ts apps/worker/src/routes/organizations.ts apps/worker/test/organization-leadership.integration.test.ts apps/worker/test/support/organization-leadership.ts apps/worker/test/admin.integration.test.ts
git commit -m "feat: add organization administration read models"
```

### Task 4: Implement Atomic Manager Assignment and Primary Replacement

**Files:**
- Modify: `apps/worker/src/services/organizations.ts`
- Modify: `apps/worker/src/routes/organizations.ts`
- Modify: `apps/worker/src/services/admin.ts`
- Modify: `apps/worker/src/routes/users.ts`
- Modify: `apps/worker/src/db/admin.ts`
- Modify: `apps/worker/test/organization-leadership.integration.test.ts`
- Modify: `apps/worker/test/support/organization-leadership.ts`
- Modify: `apps/worker/test/admin.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 manager request contracts, `BcryptPasswordHasher`, `createOperatorGuard`, Task 3 detail read model.
- Produces: `assignOrganizationManager`, `replaceOrganizationPrimary`, `removeOrganizationManager`; organization assignment changes revoke existing target sessions; new-account response optionally contains one-time `temporaryPassword`.

- [ ] **Step 1: Write failing assignment lifecycle tests**

Add tests covering new and existing accounts, multiple organizations, representative uniqueness, replacement dispositions, removal, session revocation, inactive targets, and audit rollback. Core assertions:

Extend the support file with wrappers used below:

```ts
export async function seedOperatorWithTwoOrganizations(): Promise<SeededLogin> {
  const operator = await seedOperator();
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  return operator;
}

export async function seedTwoManagersAndPrimary(): Promise<LeadershipFixture> {
  return seedLeadershipFixture();
}
```

```ts
it("assigns one primary and many managers while allowing one user across organizations", async () => {
  const operator = await seedOperatorWithTwoOrganizations();
  const created = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/managers",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "NEW",
        loginId: "team.leader",
        displayName: "대표 조직장",
        assignmentRole: "PRIMARY_LEADER",
      }),
    },
  );
  expect(created.status).toBe(201);
  expect(created.headers.get("Cache-Control")).toBe("no-store");
  const createdBody = await created.json<{
    manager: { userId: string; assignmentRole: string };
    temporaryPassword: string;
  }>();
  expect(createdBody).toMatchObject({
    manager: { assignmentRole: "PRIMARY_LEADER" },
    temporaryPassword: expect.stringMatching(/^.{20}$/),
  });

  const userId = createdBody.manager.userId;
  const second = await authedRequest(
    operator,
    "/api/v1/organizations/org-2/managers",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "EXISTING",
        userId,
        assignmentRole: "MANAGER",
      }),
    },
  );
  expect(second.status).toBe(201);
});

it("replaces a primary atomically and keeps the former primary as a manager", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: "manager-1",
        previousPrimaryDisposition: "MANAGER",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    primaryLeader: { userId: "manager-2" },
    managers: expect.arrayContaining([
      expect.objectContaining({
        userId: "manager-1",
        assignmentRole: "MANAGER",
      }),
    ]),
  });
});
```

Add a stale `expectedPrimaryUserId` race expecting `409` and unchanged rows/audit count.

Extend `admin.integration.test.ts` to assert generic account creation writes `USER_CREATED`, account status changes write `USER_DEACTIVATED` or `USER_REACTIVATED`, and audit details contain only user ID, display name, role, and active-state before/after values. Assert the plaintext temporary password and password hash do not occur in `details_json`.

Add a regression that changing an assigned `ORGANIZATION_MANAGER` to `OPERATOR` returns `409` and preserves both the user role and assignments. After all assignments are removed through organization administration, the same role change is allowed.

- [ ] **Step 2: Run assignment tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- organization-leadership.integration.test.ts admin.integration.test.ts`

Expected: FAIL with `404` for manager and primary mutation routes.

- [ ] **Step 3: Remove organization assignment mutation from generic user APIs**

Change `UserCreateSchema` and `UserPatchSchema` in `routes/users.ts` so they no longer accept `organizationIds`. Change `createUser` and `updateUser` inputs in `services/admin.ts` accordingly. Keep `organizationIds` in authentication/session read models because authorization still needs the current D1 assignments.

Add an admin regression:

```ts
it("rejects organization assignment through the generic user endpoint", async () => {
  const operator = await seedOperator();
  const response = await authedRequest(operator, "/api/v1/users", {
    method: "POST",
    body: JSON.stringify({
      loginId: "manager.invalid",
      displayName: "잘못된 경로",
      role: "ORGANIZATION_MANAGER",
      organizationIds: ["org-1"],
    }),
  });
  expect(response.status).toBe(422);
});
```

- [ ] **Step 4: Implement manager assignment statements and auditing**

Add these service signatures:

```ts
export async function assignOrganizationManager(
  env: Env,
  actor: Actor,
  organizationId: string,
  input: OrganizationManagerCreateRequest,
): Promise<{
  manager: OrganizationManager;
  temporaryPassword?: string;
}>;

export async function replaceOrganizationPrimary(
  env: Env,
  actor: Actor,
  organizationId: string,
  input: OrganizationPrimaryPatchRequest,
): Promise<OrganizationDetail>;

export async function removeOrganizationManager(
  env: Env,
  actor: Actor,
  organizationId: string,
  userId: string,
): Promise<void>;
```

For `kind: "EXISTING"`, guard an active non-bootstrap `ORGANIZATION_MANAGER`, active organization, no duplicate assignment, and no existing primary when requesting `PRIMARY_LEADER`. For `kind: "NEW"`, hash a generated 20-character temporary password before entering the batch, insert the user and `password_credentials(must_change_password=1)`, then insert the assignment and audit rows in the same batch.

The new-account batch writes both `USER_CREATED` and the assignment action. Update generic account mutations so display-name/role changes use `USER_UPDATED`, active-state changes use `USER_DEACTIVATED` or `USER_REACTIVATED`, and each audit stores sanitized before/after values. Password reset keeps `PASSWORD_RESET` with no password material.

The generic user update guard rejects `role='OPERATOR'` while any `user_organizations` row exists. It never silently deletes or rewrites organization assignments.

Use these audit details without secrets:

```ts
JSON.stringify({
  organizationId,
  userId,
  beforeAssignmentRole: null,
  afterAssignmentRole: input.assignmentRole,
})
```

For an existing target assignment change or removal, increment `users.session_version`, revoke `auth_sessions` and `refresh_tokens`, and write the assignment audit in the same batch. New users have no sessions to revoke.

- [ ] **Step 5: Implement stale-safe primary replacement**

The guard must compare the current primary exactly with `expectedPrimaryUserId`, treating `NULL` as no primary. It must also validate the requested target is an active assigned manager in the same organization. Apply the following state transitions in one batch:

```text
requested userId = NULL:
  current primary -> DELETE assignment

requested userId != NULL and previousPrimaryDisposition = MANAGER:
  current primary -> MANAGER
  requested user -> PRIMARY_LEADER

requested userId != NULL and previousPrimaryDisposition = REMOVE:
  current primary -> DELETE assignment
  requested user -> PRIMARY_LEADER
```

If requested user already equals expected primary, return the current detail without a write. Audit successful changes as `ORGANIZATION_PRIMARY_ASSIGNED`, `ORGANIZATION_PRIMARY_REPLACED`, or `ORGANIZATION_PRIMARY_REMOVED` with both user IDs and disposition.

- [ ] **Step 6: Add routes and one-time password headers**

Register:

```ts
organizationRoutes.post("/organizations/:id/managers", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationManagerCreateRequestSchema.parse(await c.req.json());
  const result = await assignOrganizationManager(
    c.env,
    actor,
    c.req.param("id"),
    input,
  );
  return result.temporaryPassword
    ? c.json(result, 201, { "Cache-Control": "no-store" })
    : c.json(result, 201);
});

organizationRoutes.patch("/organizations/:id/primary", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireAdministrativeOperator(actor);
  const input = OrganizationPrimaryPatchRequestSchema.parse(await c.req.json());
  return c.json(
    await replaceOrganizationPrimary(c.env, actor, c.req.param("id"), input),
  );
});

organizationRoutes.delete(
  "/organizations/:id/managers/:userId",
  async (c) => {
    assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
    const actor = await requireActor(c.req.raw, c.env);
    await requireCsrf(c.req.raw, actor);
    requireAdministrativeOperator(actor);
    await removeOrganizationManager(
      c.env,
      actor,
      c.req.param("id"),
      c.req.param("userId"),
    );
    return c.body(null, 204);
  },
);
```

All three require exact origin, authenticated full session, CSRF, and non-bootstrap operator. A new-account manager response uses status `201` and `Cache-Control: no-store`; existing assignment uses `201`; removal returns `204`.

- [ ] **Step 7: Run lifecycle, authentication, and audit tests**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- organization-leadership.integration.test.ts admin.integration.test.ts auth.integration.test.ts audit.integration.test.ts`

Expected: PASS, including stale no-write and append-only audit rollback cases.

- [ ] **Step 8: Commit manager lifecycle**

```bash
git add apps/worker/src/services/organizations.ts apps/worker/src/routes/organizations.ts apps/worker/src/services/admin.ts apps/worker/src/routes/users.ts apps/worker/src/db/admin.ts apps/worker/test/organization-leadership.integration.test.ts apps/worker/test/support/organization-leadership.ts apps/worker/test/admin.integration.test.ts
git commit -m "feat: manage organization leaders and managers"
```

### Task 5: Make Project Organization Mutations Revision-Safe and Enrich Rows

**Files:**
- Modify: `apps/worker/src/db/project-organizations.ts`
- Modify: `apps/worker/src/services/project-organizations.ts`
- Modify: `apps/worker/src/routes/project-organizations.ts`
- Modify: `apps/worker/test/project-organizations.integration.test.ts`
- Modify: `apps/worker/test/projects.integration.test.ts`
- Modify: `apps/web/e2e/global-setup.ts`

**Interfaces:**
- Consumes: Task 1 revision-bearing contracts and Task 2 assignment schema.
- Produces: enriched `ProjectOrganization`, project revision increments for add/deactivate/reactivate, and `ProjectOrganizationMutationResult` responses.

- [ ] **Step 1: Update project-organization integration expectations to RED**

Change every project organization mutation request to send the currently observed `expectedProjectRevision`. Assert the first add response shape and project revision:

```ts
const response = await authedRequest(
  operator,
  `/api/v1/projects/${project.id}/organizations`,
  {
    method: "POST",
    body: JSON.stringify({
      organizationId: organization.id,
      expectedProjectRevision: project.revision,
    }),
  },
);
expect(await response.json()).toMatchObject({
  organization: {
    organizationId: organization.id,
    primaryLeader: null,
    managerCount: 0,
    rosterCount: 0,
  },
  projectRevision: project.revision + 1,
});
```

Add a stale concurrent add test: two requests with the same revision yield one success and one `STALE_REVISION`; only one membership and one membership audit exist. Add a canonical-name concurrent create test where exactly one global organization exists and the loser receives a recoverable `409` detail containing the existing `organizationId`.

- [ ] **Step 2: Run project organization tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- project-organizations.integration.test.ts projects.integration.test.ts`

Expected: FAIL because responses do not include enriched fields or project revisions.

- [ ] **Step 3: Enrich the D1 project organization query**

Extend `SELECT_PROJECT_ORGANIZATION` with parameter-free correlated subqueries:

```sql
(SELECT u.id FROM user_organizations uo
 JOIN users u ON u.id = uo.user_id
 WHERE uo.organization_id = po.organization_id
   AND uo.assignment_role = 'PRIMARY_LEADER'
 LIMIT 1) AS primary_user_id,
(SELECT u.display_name FROM user_organizations uo
 JOIN users u ON u.id = uo.user_id
 WHERE uo.organization_id = po.organization_id
   AND uo.assignment_role = 'PRIMARY_LEADER'
 LIMIT 1) AS primary_display_name,
(SELECT COUNT(*) FROM user_organizations uo
 WHERE uo.organization_id = po.organization_id
   AND uo.assignment_role = 'MANAGER') AS manager_count,
(SELECT COUNT(*) FROM project_roster_entries roster
 WHERE roster.project_id = po.project_id
   AND roster.organization_id = po.organization_id
   AND roster.status = 'ACTIVE') AS roster_count
```

Map null leader columns to `primaryLeader: null` and numbers to `managerCount` and `rosterCount`.

- [ ] **Step 4: Guard project organization mutations by revision**

In both add/reactivate and deactivate/remove paths, add `projects.revision = ?` to the operator guard. Add an update statement before the audit:

```ts
env.DB.prepare(
  `UPDATE projects
   SET revision = revision + 1, updated_at = ?
   WHERE id = ? AND revision = ?`,
).bind(timestamp, projectId, input.expectedProjectRevision)
```

Return `projectRevision: expectedProjectRevision + 1`. Translate a guard failure by rereading the project: return `PROJECT_CLOSED` when closed/expired, `STALE_REVISION` when the revision changed, and `CONFLICT` for duplicate/invalid organization state.

When the request creates a new global organization, insert both `ORGANIZATION_CREATED` and `PROJECT_ORGANIZATION_ADDED` audit rows in the same batch. Existing links write only the project-membership action. Both details payloads include `organizationId`; the membership row also includes `projectId`.

- [ ] **Step 5: Return recoverable canonical-name conflicts**

When a new organization insert loses a unique-name race, query by canonical name. Throw `DomainError("CONFLICT", { organizationId, organizationName, reason: "ORGANIZATION_NAME_EXISTS" })`. Do not automatically link it because the original guarded batch lost its observed project revision; the UI must reload and let the operator select the resolved existing organization explicitly.

- [ ] **Step 6: Update all callers and E2E setup**

Update test helpers and `apps/web/e2e/global-setup.ts` to pass the project revision returned by project creation. Parse the organization mutation response, then use its `projectRevision` for the subsequent transition:

```ts
const linked = (await linkResponse.json()) as { projectRevision: number };
await api.post(`/api/v1/projects/${project.id}/transition`, {
  headers: authHeaders(operatorAuth),
  data: {
    targetStatus: "PRE_REGISTRATION",
    expectedRevision: linked.projectRevision,
  },
});
```

Remove `organizationIds: []` from the temporary generic user creation request because Task 4 makes assignment changes available only through organization administration endpoints.

- [ ] **Step 7: Run project and full Worker type checks**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- project-organizations.integration.test.ts projects.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/worker run check`

Expected: PASS.

- [ ] **Step 8: Commit revision-safe project organization mutations**

```bash
git add apps/worker/src/db/project-organizations.ts apps/worker/src/services/project-organizations.ts apps/worker/src/routes/project-organizations.ts apps/worker/test/project-organizations.integration.test.ts apps/worker/test/projects.integration.test.ts apps/web/e2e/global-setup.ts
git commit -m "feat: guard project organization mutations by revision"
```

### Task 6: Replace Split Project Organization Forms with One Combobox

**Files:**
- Create: `apps/web/src/features/projects/OrganizationCombobox.tsx`
- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Modify: `apps/web/src/features/projects/project-detail.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 1 enriched organization contracts and Task 5 mutation responses.
- Produces: `OrganizationCombobox` selection union and a project panel with one `조직 추가` card.

- [ ] **Step 1: Rewrite project detail UI tests for the approved A flow**

Replace assertions for `기존 조직 연결` and `새 조직 연결` with:

```tsx
render(
  <ProjectOrganizationsPanel
    projectId="project-1"
    projectRevision={7}
    memberships={[]}
    allOrganizations={[
      { id: "org-1", name: "E2E 1팀", isActive: true },
      { id: "org-2", name: "E2E 운영팀", isActive: true },
    ]}
    canAdminister
    onChanged={onChanged}
  />,
);

expect(screen.getByRole("heading", { name: "조직 추가" })).toBeVisible();
expect(
  screen.queryByRole("heading", { name: "기존 조직 연결" }),
).not.toBeInTheDocument();
fireEvent.change(screen.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }), {
  target: { value: "E2E" },
});
expect(screen.getByRole("option", { name: /E2E 1팀/ })).toBeVisible();
expect(screen.getByRole("option", { name: /“E2E” 새 조직 생성 후 추가/ })).toBeVisible();
```

Add tests for exact existing-name suppression of the create option, already-linked disabled result, keyboard selection, explicit create confirmation, recoverable `ORGANIZATION_NAME_EXISTS`, stale revision reload, leaderless label, primary name, manager count, roster count, and operator-only organization-management link.

- [ ] **Step 2: Run the project UI test to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- project-detail.test.tsx`

Expected: FAIL because the panel still renders two cards and has no `projectRevision` prop.

- [ ] **Step 3: Build the accessible combobox as a focused component**

Create `OrganizationCombobox.tsx` with this public interface:

```ts
export type OrganizationComboboxSelection =
  | { kind: "EXISTING"; organizationId: string }
  | { kind: "NEW"; name: string };

export interface OrganizationComboboxProps {
  organizations: Organization[];
  linkedOrganizationIds: ReadonlySet<string>;
  disabled: boolean;
  onSelect(selection: OrganizationComboboxSelection): void;
}

export function canonicalizeOrganizationInput(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
```

Use one input with `role="combobox"`, one `role="listbox"`, and button options with `role="option"`. Existing active organizations appear before the create option. Show the create option only when the trimmed input is non-empty and no organization has the same canonical name. Keep linked organizations visible as `이미 추가됨` and disabled.

- [ ] **Step 4: Simplify the project organization panel**

Remove inline global rename and global deactivation controls from `ProjectOrganizationsPanel`; those belong to organization detail. Accept:

```ts
export interface ProjectOrganizationsPanelProps {
  projectId: string;
  projectRevision: number;
  memberships: ProjectOrganization[];
  allOrganizations: Organization[];
  canAdminister: boolean;
  onChanged(): Promise<void>;
  onProjectClosed?(): Promise<void>;
}
```

Selecting an existing option stores it as the pending selection; the explicit `프로젝트에 추가` button POSTs `{ organizationId, expectedProjectRevision: projectRevision }`. Selecting a new option opens a confirmation dialog stating `전역 조직으로 생성한 뒤 이 프로젝트에 추가합니다.` and POSTs `{ newOrganizationName: name, expectedProjectRevision: projectRevision }` only after confirmation. PATCH activation with `{ isActive, expectedProjectRevision: projectRevision }`.

On `STALE_REVISION`, `PROJECT_CLOSED`, or recoverable name conflict, preserve the typed query, call `onChanged`, and show a specific Korean status message. Never automatically replay a mutation after reload.

- [ ] **Step 5: Render leadership metadata and management links**

Each membership row renders:

```tsx
<span>{membership.primaryLeader?.displayName ?? "대표 조직장 미지정"}</span>
<span>추가 관리자 {membership.managerCount}명</span>
<span>현재 명단 {membership.rosterCount}명</span>
```

For operators, link to `/organizations/${encodeURIComponent(membership.organizationId)}` with text `조직 관리에서 담당자 지정`. Managers see the metadata but not the administration link.

- [ ] **Step 6: Pass project revision and add responsive styles**

Pass `project.revision` from `ProjectDetailPage`. Add `.er-organization-combobox`, `.er-combobox-list`, `.er-combobox-option`, `.er-membership-meta` styles with visible focus, selected, disabled, and mobile wrapping states. Do not introduce a component library.

- [ ] **Step 7: Run web project tests and typecheck**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- project-detail.test.tsx && corepack pnpm@10.28.1 --filter @event-roster/web run check`

Expected: PASS.

- [ ] **Step 8: Commit the unified project organization UI**

```bash
git add apps/web/src/features/projects/OrganizationCombobox.tsx apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/projects/ProjectDetailPage.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/styles/global.css
git commit -m "feat: unify project organization add flow"
```

### Task 7: Build Operator Organization Administration UI

**Files:**
- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Create: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Create: `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
- Modify: `apps/web/src/features/admin/UserForm.tsx`
- Modify: `apps/web/src/features/admin/UserEditRow.tsx`
- Modify: `apps/web/src/features/admin/UsersPage.tsx`
- Modify: `apps/web/src/features/admin/admin.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4 organization APIs and existing `TemporaryPasswordDialog`.
- Produces: operator-only organization list/detail routes, account provisioning inside organization detail, and generic user forms without assignment checkboxes.

- [ ] **Step 1: Write failing organization administration component tests**

Add tests in `admin.test.tsx` that mock summary/detail responses and assert:

```tsx
expect(screen.getByRole("link", { name: "조직 관리" })).toBeVisible();
expect(screen.getByLabelText("조직 이름 검색")).toBeVisible();
expect(screen.getByLabelText("대표 조직장 상태")).toBeVisible();
expect(screen.getByText("대표 조직장 미지정")).toBeVisible();
```

On detail, test assigning an existing account, provisioning a new account and showing its one-time password, replacing primary with `MANAGER` disposition, removing a manager, renaming/deactivating the organization, rendering linked projects, and paginating audit history. Assert a manager role never sees the navigation and `/organizations/:id` falls back to projects.

- [ ] **Step 2: Run admin UI tests to verify RED**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test -- admin.test.tsx App.test.tsx`

Expected: FAIL because organization navigation/detail and manager controls are absent.

- [ ] **Step 3: Remove organization assignment controls from generic user forms**

Change `UserCreateInput` to:

```ts
export interface UserCreateInput {
  loginId: string;
  displayName: string;
  role: Role;
}
```

Remove `organizations` props and organization checkbox state from `UserForm`, `UserEditRow`, and `UsersPage`. Keep role, display name, active state, password reset, and temporary password dialog. Use `Organization` from contracts for roster/participant UI instead of the `OrganizationView` type formerly declared in `UserForm`.

- [ ] **Step 4: Upgrade the organization list page**

Fetch `/organizations?query=${encodeURIComponent(query)}&status=${status}&leaderStatus=${leaderStatus}` after an explicit search submission or filter change. Render name, state, primary leader, manager count, project count, and a detail link. Keep creation in a dialog or compact card, clear the name only after success, and show duplicate-name conflict without discarding input.

- [ ] **Step 5: Implement manager controls and primary replacement**

`OrganizationManagersPanel` accepts:

```ts
export interface OrganizationManagersPanelProps {
  organization: OrganizationDetail;
  onChanged(): Promise<void>;
  onTemporaryPassword(value: string): void;
}
```

Existing-account assignment POSTs `kind: "EXISTING"`; new-account provisioning POSTs `kind: "NEW"`. If the response includes `temporaryPassword`, call `onTemporaryPassword` before reloading so a reload failure cannot lose the secret. Representative replacement PATCHes the observed `expectedPrimaryUserId` and chosen `previousPrimaryDisposition`. Primary removal uses `userId: null`. DELETE is available only for `MANAGER`; primary removal must use the explicit primary dialog.

- [ ] **Step 6: Compose organization detail and audit pagination**

`OrganizationDetailPage` loads `/organizations/:id` and `/organizations/:id/audit?limit=50` independently, preserves whichever succeeds, and reuses `AuditPanel`. Render organization editing, `OrganizationManagersPanel`, linked projects, and audit. Handle `409` by reloading without replaying the mutation and show `다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다.`

- [ ] **Step 7: Add operator-only navigation and routes**

In `AppShell`, render navigation in this order for an operator: `프로젝트`, `조직 관리`, `계정`. Route exact `/organizations` to `OrganizationsPage` and `/organizations/:id` to `OrganizationDetailPage`. Managers never render those pages even if they type the URL.

Add `delete<T>(path: string)` to `createApiClient`:

```ts
delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
```

- [ ] **Step 8: Add responsive organization administration styles**

Add grid/table styles for summary cards, manager rows, project rows, filters, and mobile stacking. Preserve current tokens and focus indicators; verify controls remain usable below 960px.

- [ ] **Step 9: Run all web unit tests and build**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web test && corepack pnpm@10.28.1 --filter @event-roster/web run build`

Expected: PASS.

- [ ] **Step 10: Commit organization administration UI**

```bash
git add apps/web/src/features/admin apps/web/src/app/AppShell.tsx apps/web/src/app/App.test.tsx apps/web/src/lib/api.ts apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/features/roster/ParticipantEditDialog.tsx apps/web/src/styles/global.css
git commit -m "feat: add organization leadership administration"
```

### Task 8: Verify Manager Scope, Lifecycle Boundaries, and Non-Participant Behavior

**Files:**
- Modify: `apps/worker/src/db/auth.ts`
- Modify: `apps/worker/src/db/project-organizations.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/test/participants.integration.test.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`
- Modify: `apps/worker/test/organization-leadership.integration.test.ts`
- Modify: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Consumes: current D1 assignment rows loaded by `findSessionById` and existing project lifecycle authorization.
- Produces: explicit regression coverage that both assignment roles have equal scope, inactive/removed assignments stop access immediately, and account assignment never writes participant/roster rows.

- [ ] **Step 1: Add failing authorization matrix tests**

Add parameterized tests for `PRIMARY_LEADER` and `MANAGER`:

```ts
it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "%s can mutate its active organization only during pre-registration",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    const manager = await seedManager("org-1");
    await env.DB.prepare(`UPDATE user_organizations
      SET assignment_role=? WHERE user_id=? AND organization_id='org-1'`)
      .bind(assignmentRole, manager.userId)
      .run();

    const preRegistrationAdd = await addRoster(
      { ...fixture, operator: manager },
      fixture.firstParticipant.id,
    );
    expect(preRegistrationAdd.status).toBe(201);
    const added = await preRegistrationAdd.json<{ projectRevision: number }>();

    const transitioned = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({
          targetStatus: "IN_PROGRESS",
          expectedRevision: added.projectRevision,
        }),
      },
    );
    expect(transitioned.status).toBe(200);
    const inProgress = await transitioned.json<{ revision: number }>();

    const dayOfAdd = await addRoster(
      {
        ...fixture,
        operator: manager,
        project: { ...fixture.project, revision: inProgress.revision },
      },
      fixture.secondParticipant.id,
      inProgress.revision,
    );
    expect(dayOfAdd.status).toBe(403);
  },
);
```

Reuse the existing cross-organization denial fixture to assert the same manager receives `403` for another organization's participant. Add tests that assignment removal and organization deactivation are effective on the next authenticated request, a user assigned to two organizations sees both linked projects, a leaderless organization remains operator-editable, and creating/assigning a manager leaves `participants` and `project_roster_entries` counts unchanged.

- [ ] **Step 2: Run the authorization matrix as a regression baseline**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- participants.integration.test.ts roster.integration.test.ts organization-leadership.integration.test.ts`

Expected: PASS for both assignment roles and all lifecycle boundaries. Any failure identifies a concrete current-state guard that Step 3 must correct before proceeding.

- [ ] **Step 3: Make current D1 assignment state explicit in scope queries**

Keep `db/auth.ts` loading `organizationIds` from `user_organizations` on every authenticated session lookup. In project, participant, and roster scope SQL, join the current assignment row and do not branch on `assignment_role`; both values are authorized equally. Require active user, active organization, active project membership, and `PRE_REGISTRATION` for manager mutations. Do not cache organization IDs in access-token claims.

- [ ] **Step 4: Keep operator historical-edit behavior intact**

Do not globally require active project membership for an operator editing/cancelling an already-existing historical roster row. Require active membership only for new participant/roster/import additions. Managers remain read-only for inactive project memberships. Preserve the current tests for global organization deactivation allowing operator correction/cancellation of existing history.

- [ ] **Step 5: Align React roster capability tests**

In `roster.test.tsx` and `project-detail.test.tsx`, assert a manager can mutate only when project status is `PRE_REGISTRATION` and at least one visible assigned membership is active. At `IN_PROGRESS`, show `읽기 전용` and hide add/edit/cancel buttons. Operators keep day-of controls.

- [ ] **Step 6: Run authorization and UI regression suites**

Run: `corepack pnpm@10.28.1 --filter @event-roster/worker test -- participants.integration.test.ts roster.integration.test.ts projects.integration.test.ts organization-leadership.integration.test.ts && corepack pnpm@10.28.1 --filter @event-roster/web test -- roster.test.tsx project-detail.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit permission hardening**

```bash
git add apps/worker/src/db/auth.ts apps/worker/src/db/project-organizations.ts apps/worker/src/services/participants.ts apps/worker/src/services/roster.ts apps/worker/test/participants.integration.test.ts apps/worker/test/roster.integration.test.ts apps/worker/test/organization-leadership.integration.test.ts apps/web/src/features/roster/roster.test.tsx apps/web/src/features/projects/project-detail.test.tsx
git commit -m "test: enforce organization manager roster boundaries"
```

### Task 9: Complete E2E, Operations Documentation, and Full Verification

**Files:**
- Create: `apps/web/e2e/organization-management.spec.ts`
- Modify: `apps/web/e2e/global-setup.ts`
- Modify: `apps/web/e2e/support.ts`
- Modify: `apps/worker/scripts/prepare-e2e-env.mts`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/recovery.md`
- Modify: `docs/operations/monthly-check.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: local browser proof of the complete operator-to-manager workflow and deployment/recovery checks for migration `0003`.

- [ ] **Step 1: Add the end-to-end workflow**

Create `apps/web/e2e/organization-management.spec.ts` with a serial flow that:

1. logs in as the seeded operator;
2. opens `조직 관리`, creates `E2E 2팀`, and verifies `대표 조직장 미지정`;
3. opens the detail, provisions `e2e-org-leader` as `PRIMARY_LEADER`, captures the one-time password, and verifies it is not displayed again after closing;
4. returns to the seeded project and uses the single combobox to link the new organization;
5. logs out, logs in with the temporary password, changes it, confirms the forced session ends, and logs in with the new password;
6. verifies only linked projects and assigned organization rows are visible;
7. adds an organization participant during `PRE_REGISTRATION` and verifies the account itself was not pre-added as a participant;
8. logs back in as operator, transitions to `IN_PROGRESS`, then verifies the organization manager sees read-only controls.

Use a generated strong new password stored only in `.local-e2e-env.json`; never print it in test output.

Implement the flow with this test body, matching the accessible labels introduced in Tasks 6 and 7:

```ts
import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator delegates pre-registration roster entry to an organization leader", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  await page.getByRole("link", { name: "조직 관리" }).click();
  await page.getByRole("button", { name: "새 조직" }).click();
  await page.getByLabel("조직 이름").fill("E2E 2팀");
  await page.getByRole("button", { name: "조직 만들기" }).click();
  await page.getByRole("link", { name: /E2E 2팀/ }).click();
  await expect(page.getByText("대표 조직장 미지정")).toBeVisible();

  await page.getByRole("button", { name: "새 담당자 발급" }).click();
  await page.getByLabel("영문 로그인 ID").fill("e2e-org-leader");
  await page.getByLabel("표시 이름").fill("E2E 대표 조직장");
  await page.getByLabel("조직별 역할").selectOption("PRIMARY_LEADER");
  await page.getByRole("button", { name: "계정 발급 및 지정" }).click();
  const temporaryPassword = await page.locator(".er-secret-value").innerText();
  expect(temporaryPassword).toHaveLength(20);
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator(".er-secret-value")).toHaveCount(0);

  await page.getByRole("link", { name: "프로젝트" }).click();
  await page.getByRole("link", { name: "E2E 상반기 프로젝트" }).click();
  await page.getByRole("tab", { name: "조직" }).click();
  await page
    .getByRole("combobox", { name: "조직 이름 검색 또는 입력" })
    .fill("E2E 2팀");
  await page.getByRole("option", { name: /E2E 2팀/ }).click();
  await page.getByRole("button", { name: "프로젝트에 추가" }).click();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, "e2e-org-leader", temporaryPassword);
  await page.getByLabel("현재 비밀번호").fill(temporaryPassword);
  await page
    .getByLabel("새 비밀번호", { exact: true })
    .fill(data.organizationManager.password);
  await page
    .getByLabel("새 비밀번호 확인")
    .fill(data.organizationManager.password);
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await login(page, "e2e-org-leader", data.organizationManager.password);

  await page.getByRole("link", { name: "E2E 상반기 프로젝트" }).click();
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(page.getByText("E2E 대표 조직장", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 조직 참가자");
  await page.getByRole("button", { name: "참가자 생성 후 추가" }).click();
  await expect(page.getByText("E2E 조직 참가자", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${data.projectId}`);
  await page.getByRole("button", { name: "진행 시작" }).click();
  await page.getByRole("button", { name: "변경 확인" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, "e2e-org-leader", data.organizationManager.password);
  await page.goto(`/projects/${data.projectId}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(page.getByText("읽기 전용")).toBeVisible();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toHaveCount(0);
});
```

Extend `E2eFixture` and the prepare script with `organizationManager: { password: string }`, generated as `E2e-Manager-${randomBytes(16).toString("base64url")}`.

- [ ] **Step 2: Run the new E2E workflow**

Run: `corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- organization-management.spec.ts`

Expected: PASS with one Playwright worker and no retry.

- [ ] **Step 3: Document migration and recovery verification**

Update deployment order to require remote D1 backup/export before applying `0003`, then run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --command "PRAGMA foreign_key_check"
```

Document post-migration checks:

```sql
SELECT assignment_role, COUNT(*)
FROM user_organizations
GROUP BY assignment_role;

SELECT organization_id, COUNT(*) AS primary_count
FROM user_organizations
WHERE assignment_role = 'PRIMARY_LEADER'
GROUP BY organization_id
HAVING COUNT(*) > 1;
```

The second query must return zero rows. Recovery documentation must state that a pre-`0003` export is restored into an isolated D1, then all migrations are reapplied before switching bindings. Monthly checks sample an operator, a primary, an additional manager, and an unassigned manager account.

- [ ] **Step 4: Run the full repository verification**

Run:

```bash
corepack pnpm@10.28.1 run format:check
corepack pnpm@10.28.1 run check
corepack pnpm@10.28.1 run test
corepack pnpm@10.28.1 --filter @event-roster/web run build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run --config wrangler.jsonc
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

Expected: every command exits `0`; Worker dry-run reports a valid bundle and all Playwright specs pass with one worker.

- [ ] **Step 5: Inspect the final diff for secrets and accidental files**

Run:

```bash
git diff --check
git status --short
git diff --name-only --cached
```

Expected: no `.dev.vars`, `.local-e2e-env.json`, `.wrangler`, `.pnpm-store`, `.DS_Store`, raw passwords, or generated browser traces are staged.

- [ ] **Step 6: Commit E2E and operations guidance**

```bash
git add apps/web/e2e/organization-management.spec.ts apps/web/e2e/global-setup.ts apps/web/e2e/support.ts apps/worker/scripts/prepare-e2e-env.mts docs/operations/deployment.md docs/operations/recovery.md docs/operations/monthly-check.md
git commit -m "test: verify organization leadership workflow"
```

## Spec Coverage Checklist

- 통합 `조직 추가` A안: Tasks 1, 5, 6
- 정확한 기존 조직 우선 및 명시적 신규 생성: Tasks 5, 6
- 대표 없는 프로젝트 조직 허용: Tasks 5, 6, 8
- 대표 한 명과 추가 관리자 여러 명: Tasks 1, 2, 4, 7
- 한 계정의 여러 조직 배정: Tasks 2, 4, 8
- 전역 역할과 조직별 역할 분리: Tasks 1, 2, 4
- 운영자 전용 조직 관리: Tasks 3, 4, 7
- 조직 담당자의 명단 전용 권한: Tasks 7, 8
- `PRE_REGISTRATION`만 조직 담당자 쓰기 허용: Task 8
- 계정과 참가자 분리: Tasks 4, 8, 9
- 임시 비밀번호와 강제 변경 흐름 유지: Tasks 4, 7, 9
- 조직·계정·배정·프로젝트 연결 감사: Tasks 3, 4, 5
- migration 데이터 보존과 대표 unique 제약: Task 2
- 오류·동시성·stale no-replay: Tasks 4, 5, 6, 7
- 조직 목록/상세/프로젝트/감사 UI: Tasks 3, 7
- 전체 회귀와 배포·복구 문서: Task 9
