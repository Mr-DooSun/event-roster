# Bulk New Participant Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 조직을 선택하고 줄바꿈으로 입력한 새 참가자 1~30명을 프로젝트 명단에 원자적으로 등록하며, 동명이인은 경고 후 명시적 확인을 거치게 한다.

**Architecture:** 공용 contracts 패키지가 이름 정규화와 strict 요청·응답 타입을 제공하고, 새 Worker 서비스가 기존 `runGuardedAtomic`과 import chunking 패턴으로 전체 참가자를 한 transaction에 저장한다. Web은 이름 입력·미리보기·중복 확인을 독립 컴포넌트로 분리하고 `ProjectRosterPage`가 구조화된 API 결과, 재조회, 최근 조직과 성공·오류 메시지를 조정한다.

**Tech Stack:** TypeScript 5.9, Zod 4, Hono 4, Cloudflare Workers/D1, React 19, Vite 8, Vitest 4, Testing Library, Playwright 1.61, pnpm 10.28.1

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-28-bulk-new-participant-registration-design.md`다.
- 이번 기능의 “초대”는 알림·이메일·계정 발급이 아닌 프로젝트 참가 명단 등록이다.
- 모든 이름은 한 요청에서 선택한 하나의 조직에 소속된다.
- 요청당 정규화 후 인원은 1명 이상 30명 이하다.
- 전체 요청은 모두 성공하거나 모두 롤백한다.
- 이름은 Unicode NFKC 정규화, trim, 내부 연속 whitespace 축약 후 1~100자여야 한다.
- 중복 비교 키는 정규화된 이름에 locale 독립적인 `toLowerCase()`를 적용한다.
- 입력 내부 또는 선택 조직의 참가자 마스터에 동명이인이 있으면 HTTP 409 `CONFLICT`와 구조화된 details를 반환한다.
- `confirmDuplicateNames: true`인 재요청만 동명이인 생성을 허용한다.
- 프로젝트 revision은 생성 인원과 무관하게 정확히 1 증가한다.
- 각 `PARTICIPANT_CREATED`와 `ROSTER_ADDED` 감사 로그는 공통 `batchId`를 `details_json`에 기록한다.
- 운영자·조직 담당자 scope, 프로젝트 상태, 종료일, 활성 프로젝트 조직 정책은 기존 단건 새 참가자 등록과 동일하다.
- 기존 참가자 추가, 단건 새 참가자 API, Excel import/export 동작은 유지한다.
- D1 migration과 새 런타임 의존성은 추가하지 않는다.
- 요청 실패 시 모달의 원문 이름, 선택 조직과 중복 경고를 유지한다.
- 사용자 입력이나 조직이 바뀌면 이전 중복 확인 상태를 즉시 폐기한다.

---

## File Structure

### New files

- `packages/contracts/src/participant-names.ts`
  - 새 참가자 이름 저장값과 중복 비교 키의 유일한 정규화 규칙을 제공한다.
- `packages/contracts/test/participant-names.test.ts`
  - NFKC, trim, 내부 whitespace, locale 독립 소문자 규칙을 검증한다.
- `apps/worker/src/services/bulk-participants.ts`
  - 동명이인 검사, 권한·상태 snapshot, chunked SQL과 원자적 저장을 담당한다.
- `apps/web/src/features/roster/BulkParticipantNameField.tsx`
  - 줄바꿈 입력, 등록 예정 행, 인원 제한, 중복 표시와 확인 체크를 렌더링한다.
- `apps/web/src/features/roster/BulkParticipantNameField.test.tsx`
  - 입력 파싱과 독립 UI 상태를 검증한다.

### Modified files

- `packages/contracts/src/index.ts`
  - 이름 정규화 API를 export한다.
- `packages/contracts/src/roster.ts`
  - 일괄 요청·중복 details·성공 응답 타입과 schema를 추가한다.
- `packages/contracts/test/contracts.test.ts`
  - strict schema와 1~30명 경계를 검증한다.
- `apps/worker/src/routes/roster.ts`
  - `POST /projects/:projectId/roster/bulk`를 인증·CSRF 뒤 새 서비스에 연결한다.
- `apps/worker/src/services/participants.ts`
  - 기존 단건 정책 helper를 동작 변경 없이 export해 일괄 서비스와 공유한다.
- `apps/worker/test/roster.integration.test.ts`
  - API, 원자성, 동시성, 권한, 감사 로그를 D1에서 검증한다.
- `apps/web/src/features/roster/ParticipantDialog.tsx`
  - 단건 이름 input을 일괄 이름 field로 교체하고 typed submit outcome을 처리한다.
- `apps/web/src/features/roster/ProjectRosterPage.tsx`
  - 일괄 endpoint, duplicate details, 성공 메시지, reload와 최근 조직 갱신을 조정한다.
- `apps/web/src/features/roster/roster.test.tsx`
  - 모달·payload·중복 재확인·실패 보존·페이지 피드백을 검증한다.
- `apps/web/src/styles/global.css`
  - textarea, 카운터, 미리보기 행과 중복 경고의 기존 token 기반 스타일을 제공한다.
- `apps/web/e2e/project-roster.spec.ts`
  - 운영자 일괄 등록과 중복 확인을 실제 Worker/UI에서 검증한다.
- `apps/web/e2e/organization-management.spec.ts`
  - 조직 담당자의 기존 단건 시나리오를 새 여러 줄 입력 UI로 갱신한다.

---

### Task 1: Shared Name Normalization and Bulk Contracts

**Files:**

- Create: `packages/contracts/src/participant-names.ts`
- Create: `packages/contracts/test/participant-names.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/roster.ts`
- Modify: `packages/contracts/test/contracts.test.ts`

**Interfaces:**

- Produces:

```ts
export function normalizeParticipantName(value: string): string;
export function canonicalizeParticipantName(value: string): string;

export type BulkParticipantDuplicateKind =
  | "INPUT_DUPLICATE"
  | "EXISTING_PARTICIPANT";

export interface BulkParticipantDuplicate {
  name: string;
  kinds: BulkParticipantDuplicateKind[];
}

export interface BulkRosterCreateRequest {
  organizationId: string;
  names: string[];
  confirmDuplicateNames: boolean;
  expectedRevision: number;
}

export interface BulkRosterCreateResponse {
  batchId: string;
  participants: Array<{
    participant: {
      id: string;
      participantId: string;
      name: string;
      organizationId: string;
      revision: number;
    };
    rosterEntry: {
      id: string;
      projectId: string;
      participantId: string;
      participantNumber: string;
      organizationId: string;
      participantName: string;
      organizationName: string;
      source: RosterSource;
      status: RosterStatus;
      wasExpectedAtStart: boolean;
      revision: number;
      updatedAt: string;
    };
  }>;
  projectRevision: number;
}
```

- Produces runtime schemas:

```ts
BulkRosterCreateRequestSchema
BulkParticipantDuplicateDetailsSchema
BulkRosterCreateResponseSchema
```

- [ ] **Step 1: 이름 정규화 RED test를 작성한다**

Create `packages/contracts/test/participant-names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalizeParticipantName,
  normalizeParticipantName,
} from "../src";

describe("participant name normalization", () => {
  it.each([
    ["  홍길동  ", "홍길동"],
    ["김\t 민수", "김 민수"],
    ["Ｅ２Ｅ   Leader", "E2E Leader"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeParticipantName(input)).toBe(expected);
  });

  it("uses locale-independent lowercase for duplicate keys", () => {
    expect(canonicalizeParticipantName("  E2E   LEADER ")).toBe("e2e leader");
  });
});
```

- [ ] **Step 2: 정규화 test가 RED인지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts exec vitest run \
  test/participant-names.test.ts
```

Expected: FAIL because `normalizeParticipantName` and
`canonicalizeParticipantName` are not exported.

- [ ] **Step 3: 정규화 구현과 export를 추가한다**

Create `packages/contracts/src/participant-names.ts`:

```ts
export function normalizeParticipantName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function canonicalizeParticipantName(value: string): string {
  return normalizeParticipantName(value).toLowerCase();
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from "./participant-names";
```

- [ ] **Step 4: strict bulk contract RED tests를 작성한다**

Extend `packages/contracts/test/contracts.test.ts`:

```ts
it("accepts 1 to 30 normalized bulk participant names", () => {
  expect(
    BulkRosterCreateRequestSchema.parse({
      organizationId: "org-1",
      names: ["  홍길동  ", "김\t민수"],
      confirmDuplicateNames: false,
      expectedRevision: 4,
    }),
  ).toEqual({
    organizationId: "org-1",
    names: ["홍길동", "김 민수"],
    confirmDuplicateNames: false,
    expectedRevision: 4,
  });
  expect(
    BulkRosterCreateRequestSchema.safeParse({
      organizationId: "org-1",
      names: [],
      confirmDuplicateNames: false,
      expectedRevision: 4,
    }).success,
  ).toBe(false);
  expect(
    BulkRosterCreateRequestSchema.safeParse({
      organizationId: "org-1",
      names: Array.from({ length: 31 }, (_, index) => `참가자 ${index}`),
      confirmDuplicateNames: false,
      expectedRevision: 4,
    }).success,
  ).toBe(false);
});

it("rejects invalid names and unknown bulk fields", () => {
  for (const names of [["   "], ["가".repeat(101)]]) {
    expect(
      BulkRosterCreateRequestSchema.safeParse({
        organizationId: "org-1",
        names,
        confirmDuplicateNames: false,
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  }
  expect(
    BulkRosterCreateRequestSchema.safeParse({
      organizationId: "org-1",
      names: ["홍길동"],
      confirmDuplicateNames: false,
      expectedRevision: 0,
      ignored: true,
    }).success,
  ).toBe(false);
});
```

Add `BulkRosterCreateRequestSchema` to the test imports.

- [ ] **Step 5: bulk contract와 response types를 구현한다**

In `packages/contracts/src/roster.ts`, import
`normalizeParticipantName` and add:

```ts
const BulkParticipantNameSchema = z
  .string()
  .transform(normalizeParticipantName)
  .pipe(z.string().min(1).max(100));

export const BulkRosterCreateRequestSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    names: z.array(BulkParticipantNameSchema).min(1).max(30),
    confirmDuplicateNames: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const BulkParticipantDuplicateKindSchema = z.enum([
  "INPUT_DUPLICATE",
  "EXISTING_PARTICIPANT",
]);

export const BulkParticipantDuplicateSchema = z.object({
  name: z.string().min(1).max(100),
  kinds: z.array(BulkParticipantDuplicateKindSchema).min(1),
});

export const BulkParticipantDuplicateDetailsSchema = z
  .object({
    reason: z.literal("DUPLICATE_PARTICIPANT_NAMES"),
    duplicates: z.array(BulkParticipantDuplicateSchema).min(1),
  })
  .strict();
```

Define the interfaces from this task's `Interfaces` block, using
`z.infer` for request and duplicate types. Define the response schema:

```ts
export const BulkRosterCreateResponseSchema = z
  .object({
    batchId: z.string().min(1),
    participants: z.array(
      z
        .object({
          participant: z
            .object({
              id: ParticipantIdSchema,
              participantId: ParticipantIdSchema,
              name: z.string().min(1).max(100),
              organizationId: OrganizationIdSchema,
              revision: z.number().int().nonnegative(),
            })
            .strict(),
          rosterEntry: z
            .object({
              id: z.string().min(1),
              projectId: ProjectIdSchema,
              participantId: ParticipantIdSchema,
              participantNumber: ParticipantIdSchema,
              organizationId: OrganizationIdSchema,
              participantName: z.string().min(1).max(100),
              organizationName: z.string().min(1),
              source: RosterSourceSchema,
              status: RosterStatusSchema,
              wasExpectedAtStart: z.boolean(),
              revision: z.number().int().nonnegative(),
              updatedAt: z.string().datetime(),
            })
            .strict(),
        })
        .strict(),
    ),
    projectRevision: z.number().int().nonnegative(),
  })
  .strict();

export type BulkRosterCreateResponse = z.infer<
  typeof BulkRosterCreateResponseSchema
>;
```

- [ ] **Step 6: contracts tests와 typecheck를 GREEN으로 만든다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/contracts test
corepack pnpm@10.28.1 --filter @event-roster/contracts run check
```

Expected: all contract tests PASS and TypeScript exits `0`.

- [ ] **Step 7: Task 1을 commit한다**

```bash
git add \
  packages/contracts/src/participant-names.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/roster.ts \
  packages/contracts/test/participant-names.test.ts \
  packages/contracts/test/contracts.test.ts
git commit -m "feat: define bulk participant contracts"
```

---

### Task 2: Atomic Worker Bulk Registration API

**Files:**

- Create: `apps/worker/src/services/bulk-participants.ts`
- Modify: `apps/worker/src/services/participants.ts`
- Modify: `apps/worker/src/routes/roster.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`

**Interfaces:**

- Consumes Task 1:

```ts
BulkRosterCreateRequest
BulkRosterCreateResponse
BulkParticipantDuplicate
canonicalizeParticipantName(value: string): string
```

- Produces:

```ts
export async function createBulkParticipantsAndAddToProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: BulkRosterCreateRequest,
  now?: Date,
  hooks?: BulkParticipantHooks,
): Promise<BulkRosterCreateResponse>;

export interface BulkParticipantHooks {
  afterSnapshot?: () => Promise<void>;
}
```

- Route:

```text
POST /api/v1/projects/:projectId/roster/bulk
201 BulkRosterCreateResponse
409 ApiProblem { code: "CONFLICT", details.reason: "DUPLICATE_PARTICIPANT_NAMES" }
```

- [ ] **Step 1: 중복 경고와 데이터 무변경 integration RED test를 작성한다**

Extend `apps/worker/test/roster.integration.test.ts`:

```ts
it("warns about input and existing duplicates without writing rows", async () => {
  const fixture = await setupPreRegistration();
  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants",
  ).first<{ count: number }>();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        names: ["첫 참가자", "새 이름", " 새   이름 "],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "CONFLICT",
    details: {
      reason: "DUPLICATE_PARTICIPANT_NAMES",
      duplicates: [
        { name: "첫 참가자", kinds: ["EXISTING_PARTICIPANT"] },
        { name: "새 이름", kinds: ["INPUT_DUPLICATE"] },
      ],
    },
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(before?.count);
});
```

- [ ] **Step 2: bulk route 부재로 RED인지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/roster.integration.test.ts
```

Expected: the new test FAILS with HTTP `404`.

- [ ] **Step 3: 서비스의 snapshot과 중복 판정을 구현한다**

In `apps/worker/src/services/participants.ts`, add `export` to these existing
functions without changing their bodies:

```ts
export async function requireRosterMutableProject(
  env: Env,
  projectId: string,
  now: Date,
);
export function assertActorScope(
  actor: Actor,
  organizationId: string,
  projectStatus: ProjectStatus,
);
export function projectParticipantGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  projectId: string,
  organizationId: string,
  projectStatus: ProjectStatus,
  expectedProjectRevision: number,
  today: string,
  operationPredicate: string,
  operationBindings: Array<string | number>,
);
export function incrementProject(
  db: D1Database,
  projectId: string,
  timestamp: string,
);
```

The declarations above document the existing signatures; implement the
change by exporting the existing function definitions, not by adding ambient
declarations.

Create `apps/worker/src/services/bulk-participants.ts` with these internal
types and helpers:

```ts
interface OrganizationParticipantSnapshot {
  names: string[];
  count: number;
  revisionSum: number;
}

interface PreparedBulkParticipant {
  id: string;
  participantNumber: string;
  entryId: string;
  name: string;
}

function collectDuplicates(
  names: string[],
  existingNames: string[],
): BulkParticipantDuplicate[] {
  const inputCounts = new Map<string, number>();
  const displayNames = new Map<string, string>();
  for (const name of names) {
    const key = canonicalizeParticipantName(name);
    inputCounts.set(key, (inputCounts.get(key) ?? 0) + 1);
    if (!displayNames.has(key)) displayNames.set(key, name);
  }
  const existingKeys = new Set(existingNames.map(canonicalizeParticipantName));
  return [...inputCounts].flatMap(([key, count]) => {
    const kinds: BulkParticipantDuplicate["kinds"] = [];
    if (count > 1) kinds.push("INPUT_DUPLICATE");
    if (existingKeys.has(key)) kinds.push("EXISTING_PARTICIPANT");
    return kinds.length > 0
      ? [{ name: displayNames.get(key) as string, kinds }]
      : [];
  });
}
```

Call `requireRosterMutableProject`, then `assertActorScope`. Load the selected
project organization with
`findProjectOrganization(env.DB, projectId, input.organizationId)` and reject
missing/inactive project membership or inactive master with
`DomainError("VALIDATION_FAILED")`. Load every participant name and revision
for the selected organization, then derive `count` and `revisionSum`. Invoke
`await hooks?.afterSnapshot?.()` immediately after this immutable snapshot is
constructed and before duplicate handling or statement construction.

When duplicates exist and `confirmDuplicateNames` is false, throw:

```ts
throw new DomainError("CONFLICT", {
  reason: "DUPLICATE_PARTICIPANT_NAMES",
  duplicates,
});
```

- [ ] **Step 4: 1명·30명·revision·감사 이력 RED tests를 작성한다**

Add integration tests that:

```ts
const names = Array.from({ length: 30 }, (_, index) => `일괄 참가자 ${index + 1}`);
const response = await authedRequest(
  fixture.operator,
  `/api/v1/projects/${fixture.project.id}/roster/bulk`,
  {
    method: "POST",
    body: JSON.stringify({
      organizationId: "org-1",
      names,
      confirmDuplicateNames: false,
      expectedRevision: fixture.project.revision,
    }),
  },
);
expect(response.status).toBe(201);
const body = await response.json<BulkRosterCreateResponse>();
expect(body.participants.map((item) => item.participant.name)).toEqual(names);
expect(body.projectRevision).toBe(fixture.project.revision + 1);
expect(new Set(body.participants.map((item) => item.participant.id)).size).toBe(30);
```

Query `participants`, `project_roster_entries`, `projects`, and `audit_logs`
to assert:

```ts
expect(participantCount).toBe(32);
expect(rosterCount).toBe(30);
expect(projectRevision).toBe(fixture.project.revision + 1);
expect(auditRows).toHaveLength(60);
expect(
  new Set(auditRows.map((row) => JSON.parse(row.details_json).batchId)).size,
).toBe(1);
```

Repeat with one name and assert the same response shape and one revision
increment.

Transition a second fixture to `IN_PROGRESS`, submit one new participant as
the operator with the transitioned revision, and assert:

```ts
expect(body.participants[0]?.rosterEntry).toMatchObject({
  source: "IN_PROGRESS",
  wasExpectedAtStart: false,
  status: "ACTIVE",
});
```

- [ ] **Step 5: chunked SQL과 guarded atomic write를 구현한다**

Use binding-safe chunk sizes:

```ts
const PARTICIPANT_CHUNK_SIZE = 15;
const ROSTER_CHUNK_SIZE = 15;
const AUDIT_EVENT_CHUNK_SIZE = 18;
```

Prepare all IDs before building statements:

```ts
const batchId = crypto.randomUUID();
const prepared = input.names.map((name) => ({
  id: crypto.randomUUID(),
  participantNumber: `P-${crypto.randomUUID().toUpperCase()}`,
  entryId: crypto.randomUUID(),
  name,
}));
```

Build multi-row statements with these exact binding budgets:

- participant INSERT: 6 bindings per row, at most 90
- roster INSERT: 4 row bindings plus fixed project/organization/actor/time
  bindings, at most 60 row bindings
- audit INSERT: 5 bindings per event, at most 90

The roster INSERT must select `organization_name_snapshot` from the active
`organizations` row, use the project status-derived source, set
`was_expected_at_start = 0`, and insert ACTIVE revision `0` rows.

Build the guard by calling the exported `projectParticipantGuard`. Its
operation predicate must always verify an active project membership and
active organization master:

```sql
EXISTS (
  SELECT 1
  FROM project_organizations po
  JOIN organizations o ON o.id = po.organization_id
  WHERE po.project_id = ? AND po.organization_id = ?
    AND po.is_active = 1 AND o.is_active = 1
)
```

When `confirmDuplicateNames` is false, append these predicates to the same
operation predicate:

```sql
AND (SELECT COUNT(*) FROM participants WHERE organization_id = ?)
      = ?
AND (SELECT COALESCE(SUM(revision), 0) FROM participants
     WHERE organization_id = ?)
      = ?
```

Pass the guard, all chunked INSERT statements, one project revision UPDATE,
all audit INSERT statements and the guard cleanup through:

```ts
await runGuardedAtomic(env.DB, {
  guardId,
  guardStatement,
  statements,
  failureCode: "STALE_REVISION",
});
```

Every audit event must serialize:

```ts
JSON.stringify({ batchId, projectId, organizationId: input.organizationId })
```

Return records built from `prepared`, the project organization name, source,
timestamp and `input.expectedRevision + 1`. Preserve input order.

- [ ] **Step 6: route를 인증·CSRF·strict parsing에 연결한다**

In `apps/worker/src/routes/roster.ts`, import
`BulkRosterCreateRequestSchema` and
`createBulkParticipantsAndAddToProject`, then add this route before the
`/:entryId` PATCH route:

```ts
rosterRoutes.post("/projects/:projectId/roster/bulk", async (c) => {
  assertExactOrigin(c.req.raw, c.env.APP_ORIGIN);
  const actor = await requireActor(c.req.raw, c.env);
  await requireCsrf(c.req.raw, actor);
  requireFullSession(actor);
  const input = BulkRosterCreateRequestSchema.parse(await c.req.json());
  return c.json(
    await createBulkParticipantsAndAddToProject(
      c.env,
      actor,
      c.req.param("projectId"),
      input,
    ),
    201,
  );
});
```

- [ ] **Step 7: 권한·상태·rollback RED tests를 작성한다**

Add integration cases for:

```ts
// stale project revision
expectedRevision: fixture.project.revision - 1 // 409, zero matching new names

// manager outside organization scope
const manager = await seedManager("org-2"); // 403 for organizationId org-1

// manager during IN_PROGRESS
// transition as operator, submit as the org-1 manager, expect 403 and zero rows

// inactive project membership or master organization
// 422 before write; zero matching participants and roster rows

// duplicate confirmation
confirmDuplicateNames: true // 201 and all duplicate input rows preserved
```

For rollback, create a temporary D1 trigger inside `try/finally`:

```sql
CREATE TRIGGER reject_bulk_failure_name
BEFORE INSERT ON participants
WHEN NEW.name = '실패 참가자'
BEGIN
  SELECT RAISE(ABORT, 'TEST_BULK_FAILURE');
END
```

Submit `["성공처럼 보이는 참가자", "실패 참가자"]`, expect HTTP 500, then
assert neither participant, roster entry, audit log nor project revision
changed. Drop the trigger in `finally`.

Add a race test that pauses after snapshot acquisition through the
`BulkParticipantHooks` interface from this task. Pass the hook only when
directly calling the service from the test. Insert or update another
same-organization participant while paused, release the hook, and assert
`STALE_REVISION` plus zero bulk-created rows.

- [ ] **Step 8: Worker tests와 typecheck를 GREEN으로 만든다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec vitest run \
  test/roster.integration.test.ts
corepack pnpm@10.28.1 --filter @event-roster/worker run check
```

Expected: all roster integration tests PASS and Worker TypeScript exits `0`.

- [ ] **Step 9: Task 2를 commit한다**

```bash
git add \
  apps/worker/src/services/bulk-participants.ts \
  apps/worker/src/services/participants.ts \
  apps/worker/src/routes/roster.ts \
  apps/worker/test/roster.integration.test.ts
git commit -m "feat: register new participants atomically"
```

---

### Task 3: Bulk Participant Name Field

**Files:**

- Create: `apps/web/src/features/roster/BulkParticipantNameField.tsx`
- Create: `apps/web/src/features/roster/BulkParticipantNameField.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes Task 1:

```ts
normalizeParticipantName(value: string): string
BulkParticipantDuplicate
```

- Produces:

```ts
export function parseBulkParticipantNames(raw: string): string[];

export interface BulkParticipantNameFieldProps {
  rawValue: string;
  names: string[];
  duplicates: BulkParticipantDuplicate[];
  duplicateNamesConfirmed: boolean;
  disabled?: boolean;
  onRawValueChange(value: string): void;
  onDuplicateNamesConfirmedChange(value: boolean): void;
}
```

- [ ] **Step 1: parser와 입력 미리보기 RED tests를 작성한다**

Create `apps/web/src/features/roster/BulkParticipantNameField.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  BulkParticipantNameField,
  parseBulkParticipantNames,
} from "./BulkParticipantNameField";

afterEach(cleanup);

it("parses non-empty normalized lines in input order", () => {
  expect(parseBulkParticipantNames("  홍길동  \n\n김\t민수\nＥ２Ｅ")).toEqual([
    "홍길동",
    "김 민수",
    "E2E",
  ]);
});

it("shows the count and numbered preview", () => {
  render(
    <BulkParticipantNameField
      rawValue={"홍길동\n김민수"}
      names={["홍길동", "김민수"]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );
  expect(screen.getByText("등록 예정 2명 / 최대 30명")).toBeVisible();
  const list = screen.getByRole("list", { name: "등록 예정 참가자" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(within(list).getByText("1. 홍길동")).toBeVisible();
});
```

- [ ] **Step 2: component 부재로 RED인지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/BulkParticipantNameField.test.tsx
```

Expected: FAIL because `BulkParticipantNameField` does not exist.

- [ ] **Step 3: parser와 기본 field를 구현한다**

Create `BulkParticipantNameField.tsx`:

```ts
export function parseBulkParticipantNames(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map(normalizeParticipantName)
    .filter((name) => name.length > 0);
}
```

Render a labelled `<textarea id="bulk-participant-names">`, helper copy
`한 줄에 한 명씩 입력하세요`, count text, and an ordered semantic list.
Use the supplied `names` instead of reparsing inside render so
`ParticipantDialog` owns the submit state.

- [ ] **Step 4: 30명 초과와 duplicate 확인 RED tests를 작성한다**

Add tests:

```tsx
it("marks an over-limit list and exposes no silent truncation", () => {
  const names = Array.from({ length: 31 }, (_, index) => `참가자 ${index + 1}`);
  render(
    <BulkParticipantNameField
      rawValue={names.join("\n")}
      names={names}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );
  expect(screen.getByText("등록 예정 31명 / 최대 30명")).toHaveClass(
    "er-bulk-participant-count--error",
  );
  expect(screen.getByRole("list", { name: "등록 예정 참가자" })).toHaveTextContent(
    "31. 참가자 31",
  );
});

it("renders duplicate kinds and an explicit confirmation checkbox", () => {
  const onConfirm = vi.fn();
  render(
    <BulkParticipantNameField
      rawValue="홍길동"
      names={["홍길동"]}
      duplicates={[
        {
          name: "홍길동",
          kinds: ["INPUT_DUPLICATE", "EXISTING_PARTICIPANT"],
        },
      ]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={onConfirm}
    />,
  );
  expect(screen.getByText(/입력 목록에 같은 이름이 있습니다/)).toBeVisible();
  expect(screen.getByText(/이 조직에 같은 이름의 참가자가 있습니다/)).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox", {
    name: "중복 이름을 확인했습니다",
  }));
  expect(onConfirm).toHaveBeenCalledWith(true);
});

it("marks a name longer than 100 characters as invalid", () => {
  const invalidName = "가".repeat(101);
  render(
    <BulkParticipantNameField
      rawValue={invalidName}
      names={[invalidName]}
      duplicates={[]}
      duplicateNamesConfirmed={false}
      onRawValueChange={vi.fn()}
      onDuplicateNamesConfirmedChange={vi.fn()}
    />,
  );
  expect(screen.getByText("이름은 100자 이하여야 합니다.")).toBeVisible();
  expect(screen.getByText(`1. ${invalidName}`)).toHaveClass(
    "er-bulk-participant-invalid",
  );
});
```

- [ ] **Step 5: duplicate state와 기존 token 기반 CSS를 구현한다**

Render duplicate badges within the matching preview row and show the checkbox
only when `duplicates.length > 0`. Add these classes to
`apps/web/src/styles/global.css`:

```css
.er-bulk-participant-textarea {
  min-height: 9rem;
  resize: vertical;
}
.er-bulk-participant-summary {
  display: grid;
  gap: var(--er-space-3);
}
.er-bulk-participant-count {
  margin: 0;
  color: var(--er-color-muted);
}
.er-bulk-participant-count--error {
  color: var(--er-color-danger);
}
.er-bulk-participant-list {
  display: grid;
  gap: var(--er-space-2);
  max-height: 14rem;
  overflow-y: auto;
  margin: 0;
  padding: var(--er-space-3);
  border: 1px solid var(--er-color-border);
  border-radius: var(--er-radius-sm);
  list-style: none;
}
.er-bulk-participant-duplicate {
  color: var(--er-color-danger);
}
.er-bulk-participant-invalid {
  color: var(--er-color-danger);
}
.er-bulk-participant-confirmation {
  display: flex;
  align-items: flex-start;
  gap: var(--er-space-2);
}
```

The existing token is `--er-color-danger`; do not add a new color token.

- [ ] **Step 6: field tests와 Web typecheck를 GREEN으로 만든다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/BulkParticipantNameField.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: all field tests PASS and Web TypeScript exits `0`.

- [ ] **Step 7: Task 3을 commit한다**

```bash
git add \
  apps/web/src/features/roster/BulkParticipantNameField.tsx \
  apps/web/src/features/roster/BulkParticipantNameField.test.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: add bulk participant name field"
```

---

### Task 4: Dialog and Roster Page Integration

**Files:**

- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**

- Consumes Task 1:

```ts
BulkParticipantDuplicate
BulkParticipantDuplicateDetailsSchema
BulkRosterCreateResponse
```

- Consumes Task 3:

```ts
BulkParticipantNameField
parseBulkParticipantNames(raw: string): string[]
```

- Replaces the new-participant callback with:

```ts
export interface BulkParticipantSubmitInput {
  names: string[];
  organizationId: string;
  confirmDuplicateNames: boolean;
}

export type BulkParticipantSubmitOutcome =
  | { kind: "SUCCESS" }
  | { kind: "DUPLICATES"; duplicates: BulkParticipantDuplicate[] }
  | { kind: "FAILED" };

onCreateAndAdd(
  input: BulkParticipantSubmitInput,
): Promise<BulkParticipantSubmitOutcome>;
```

- [ ] **Step 1: dialog parsing·버튼·pending RED tests를 작성한다**

Update the new participant cases in
`apps/web/src/features/roster/roster.test.tsx`:

```tsx
const bulkDialogProps = {
  participants: [
    {
      id: "person-1",
      participantId: "P-001",
      name: "기존 참가자",
      organizationId: "org-1",
      revision: 0,
    },
  ],
  organizations: [{ id: "org-1", name: "1팀", isActive: true }],
  onAdd: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

it("submits normalized bulk names with one organization", async () => {
  const onCreateAndAdd = vi.fn().mockResolvedValue({ kind: "SUCCESS" });
  render(
    <ParticipantDialog
      {...bulkDialogProps}
      onCreateAndAdd={onCreateAndAdd}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "  홍길동  \n\n김\t민수" },
  });
  fireEvent.click(screen.getByRole("button", { name: "2명 명단에 추가" }));
  await waitFor(() =>
    expect(onCreateAndAdd).toHaveBeenCalledWith({
      names: ["홍길동", "김 민수"],
      organizationId: "org-1",
      confirmDuplicateNames: false,
    }),
  );
});

it("prevents a second bulk submit while the first is pending", async () => {
  const pending = deferred<BulkParticipantSubmitOutcome>();
  const onCreateAndAdd = vi.fn(() => pending.promise);
  render(
    <ParticipantDialog
      {...bulkDialogProps}
      onCreateAndAdd={onCreateAndAdd}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 참가자" }));
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "홍길동\n김민수" },
  });
  const submit = screen.getByRole("button", { name: "2명 명단에 추가" });
  fireEvent.click(submit);
  fireEvent.click(screen.getByRole("button", { name: "2명 등록 중…" }));
  expect(onCreateAndAdd).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 기존 single-name UI 때문에 RED인지 확인한다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx
```

Expected: new bulk-name assertions FAIL while existing participant tests
continue to execute.

- [ ] **Step 3: ParticipantDialog를 bulk state로 전환한다**

Replace `name` with:

```ts
const [rawNames, setRawNames] = useState("");
const names = useMemo(() => parseBulkParticipantNames(rawNames), [rawNames]);
const [duplicates, setDuplicates] = useState<BulkParticipantDuplicate[]>([]);
const [duplicateNamesConfirmed, setDuplicateNamesConfirmed] = useState(false);
const overLimit = names.length > 30;
const hasInvalidName = names.some((name) => name.length > 100);
```

When raw names or `organizationId` changes:

```ts
setDuplicates([]);
setDuplicateNamesConfirmed(false);
```

Submit:

```ts
const outcome = await onCreateAndAdd({
  names,
  organizationId,
  confirmDuplicateNames: duplicateNamesConfirmed,
});
if (outcome.kind === "DUPLICATES") {
  setDuplicates(outcome.duplicates);
  setDuplicateNamesConfirmed(false);
}
```

Render `OrganizationSelectCombobox` before `BulkParticipantNameField`.
Disable submit when busy, no organization, no names, over limit, or
an invalid name exists, or duplicates exist without confirmation. Use the
exact button copy from the design:

```tsx
loadingText={`${names.length}명 등록 중…`}
{names.length > 0 ? `${names.length}명 명단에 추가` : "명단에 추가"}
```

On `{ kind: "SUCCESS" }`, call `onClose()`. On `{ kind: "FAILED" }`, preserve
all local state.

- [ ] **Step 4: duplicate response·state reset RED tests를 작성한다**

Add tests that make `onCreateAndAdd` first resolve:

```ts
{
  kind: "DUPLICATES",
  duplicates: [{
    name: "홍길동",
    kinds: ["INPUT_DUPLICATE", "EXISTING_PARTICIPANT"],
  }],
}
```

Assert the dialog remains open, warnings appear, submit is disabled until
the checkbox is selected, and the second callback receives
`confirmDuplicateNames: true`. Change the textarea or organization and assert
the warning and checkbox disappear and the next payload contains
`confirmDuplicateNames: false`.

- [ ] **Step 5: ProjectRosterPage API outcome RED tests를 작성한다**

Add fetch-mocked cases that assert:

```ts
expect(postUrl.endsWith("/projects/project-1/roster/bulk")).toBe(true);
expect(JSON.parse(postInit.body as string)).toEqual({
  organizationId: "org-1",
  names: ["홍길동", "김민수"],
  confirmDuplicateNames: false,
  expectedRevision: project().revision,
});
```

For a 409 problem with valid duplicate details, assert warnings are shown and
`onChanged` is not called. For success, assert `onChanged` completes before
the dialog closes, recent organization storage is updated, and the page
shows `2명을 명단에 추가했습니다.` with success tone. For stale, closed and
generic failures, assert the current explanatory message and unchanged input.

- [ ] **Step 6: typed page outcomes와 status tone을 구현한다**

Change page message state to:

```ts
interface RosterNotice {
  text: string;
  tone: "info" | "success" | "error";
}
const [notice, setNotice] = useState<RosterNotice | null>(null);
```

Replace every existing message assignment with its explicit tone:

```ts
{ text: "다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.", tone: "info" }
{ text: "프로젝트가 종료되어 변경할 수 없습니다.", tone: "error" }
{ text: "명단 변경을 반영하지 못했습니다.", tone: "error" }
{ text: "엑셀 명단을 내보내지 못했습니다.", tone: "error" }
```

Render:

```tsx
{notice ? (
  <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage>
) : null}
```

Implement the bulk callback without routing duplicate conflicts through the
generic `handleMutation` branch:

```ts
const details = BulkParticipantDuplicateDetailsSchema.safeParse(
  error instanceof ApiError ? error.problem?.details : undefined,
);
if (
  error instanceof ApiError &&
  error.status === 409 &&
  error.problem?.code === "CONFLICT" &&
  details.success
) {
  return { kind: "DUPLICATES", duplicates: details.data.duplicates };
}
```

On success, await `onChanged()`, record the common organization, set the
success notice, and return `{ kind: "SUCCESS" }`. Reuse the existing stale,
closed and generic error copy and return `{ kind: "FAILED" }`.

- [ ] **Step 7: Web roster tests와 typecheck를 GREEN으로 만든다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/BulkParticipantNameField.test.tsx \
  src/features/roster/roster.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web run check
```

Expected: all selected tests PASS and Web TypeScript exits `0`.

- [ ] **Step 8: Task 4를 commit한다**

```bash
git add \
  apps/web/src/features/roster/ParticipantDialog.tsx \
  apps/web/src/features/roster/ProjectRosterPage.tsx \
  apps/web/src/features/roster/roster.test.tsx
git commit -m "feat: submit bulk participants from roster dialog"
```

---

### Task 5: End-to-End and Full Regression Verification

**Files:**

- Modify: `apps/web/e2e/project-roster.spec.ts`
- Modify: `apps/web/e2e/organization-management.spec.ts`
- Modify only if test evidence requires a defect fix:
  `packages/contracts/src/participant-names.ts`,
  `packages/contracts/src/roster.ts`,
  `apps/worker/src/services/bulk-participants.ts`,
  `apps/worker/src/services/participants.ts`,
  `apps/worker/src/routes/roster.ts`,
  `apps/web/src/features/roster/BulkParticipantNameField.tsx`,
  `apps/web/src/features/roster/ParticipantDialog.tsx`,
  `apps/web/src/features/roster/ProjectRosterPage.tsx`,
  `apps/web/src/styles/global.css`

**Interfaces:**

- Consumes the complete bulk registration flow from Tasks 1–4.
- Produces no new runtime API.

- [ ] **Step 1: 기존 E2E single-name selectors를 새 UI에 맞게 갱신한다**

In both E2E files, replace:

```ts
await page.getByLabel("이름").fill("E2E 진행 참가자");
await page.getByRole("button", { name: "참가자 생성 후 추가" }).click();
```

with:

```ts
await page.getByLabel("이름").fill("E2E 진행 참가자");
await page.getByRole("button", { name: "1명 명단에 추가" }).click();
```

Apply the same button change to `E2E 조직 참가자` and `최근 조직 참가자`.

- [ ] **Step 2: 운영자 다건 등록 E2E RED scenario를 작성한다**

Add to `apps/web/e2e/project-roster.spec.ts` before the project transition:

```ts
await page.getByRole("button", { name: "참가자 추가" }).click();
await page.getByRole("button", { name: "새 참가자" }).click();
await page.getByLabel("이름").fill("E2E 일괄 참가자 A\nE2E 일괄 참가자 B");
await expect(page.getByText("등록 예정 2명 / 최대 30명")).toBeVisible();
await page.getByRole("button", { name: "2명 명단에 추가" }).click();
await expect(
  page.getByRole("cell", { name: "E2E 일괄 참가자 A", exact: true }),
).toBeVisible();
await expect(
  page.getByRole("cell", { name: "E2E 일괄 참가자 B", exact: true }),
).toBeVisible();
await expect(page.getByText("2명을 명단에 추가했습니다.")).toBeVisible();
```

- [ ] **Step 3: 중복 확인 E2E RED scenario를 작성한다**

Open the dialog again and enter the same new name twice:

```ts
await page.getByLabel("이름").fill("E2E 동명이인\nE2E 동명이인");
await page.getByRole("button", { name: "2명 명단에 추가" }).click();
await expect(page.getByText(/입력 목록에 같은 이름이 있습니다/)).toBeVisible();
await page.getByRole("checkbox", {
  name: "중복 이름을 확인했습니다",
}).check();
await page.getByRole("button", { name: "2명 명단에 추가" }).click();
await expect(
  page.getByRole("row", { name: /E2E 동명이인/ }),
).toHaveCount(2);
```

- [ ] **Step 4: Chromium E2E를 실행해 GREEN으로 만든다**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright test \
  e2e/project-roster.spec.ts \
  e2e/organization-management.spec.ts \
  --project=chromium
```

Expected: both spec files PASS. If a failure identifies a product defect,
write a focused Vitest or Worker integration regression test first, observe
RED, make the smallest runtime correction in the files listed for this task,
then rerun the focused test and this E2E command.

- [ ] **Step 5: full repository verification을 실행한다**

Run:

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: all workspace tests PASS, all type/lint/format checks exit `0`, Web
production build succeeds, and Wrangler dry-run exits `0` with the existing
`DB`, `ASSETS`, `APP_ORIGIN` and scheduled trigger configuration.

- [ ] **Step 6: 변경 범위와 migration 부재를 확인한다**

Run:

```bash
git status --short
git diff --name-only "$(git merge-base HEAD main)"..HEAD
git diff --check
```

Expected:

- 변경 파일은 이 계획의 File Structure에 열거된 경로뿐이다.
- `apps/worker/migrations/` 아래 새 파일이 없다.
- whitespace 오류가 없다.
- `.DS_Store`, `.pnpm-store/`와 기존 사용자 미추적 파일이 staged되지 않았다.

- [ ] **Step 7: Task 5를 commit한다**

```bash
git add \
  apps/web/e2e/project-roster.spec.ts \
  apps/web/e2e/organization-management.spec.ts
git commit -m "test: cover bulk participant registration end to end"
```

If Step 4 required a focused runtime correction, include only its regression
test and directly corrected runtime file in this same commit. Do not stage
unrelated working-tree files.

---

## Execution Notes

- Begin implementation with `superpowers:using-git-worktrees`; use an isolated
  `codex/` feature branch because local `main` contains user-owned untracked
  files.
- Execute each task with TDD: RED test, minimal GREEN implementation, focused
  verification, then the listed commit.
- Use `superpowers:systematic-debugging` before changing code in response to
  any unexpected test or E2E failure.
- Use `superpowers:requesting-code-review` after Tasks 2 and 4 because those
  are the backend atomicity and frontend state-machine boundaries.
- Use `superpowers:verification-before-completion` before claiming Task 5 or
  the complete plan is finished.
