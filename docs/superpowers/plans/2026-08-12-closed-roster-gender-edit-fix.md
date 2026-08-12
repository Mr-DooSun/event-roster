# 종료 프로젝트 명단 성별 수정 오류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종료 프로젝트 이력 보정에서 참가자 성별만 변경해도 PATCH 요청과 명단 스냅샷에 반영되게 한다.

**Architecture:** 기존 `ParticipantEditDialog`의 편집 결과와 서버의 `ClosedProjectRosterPatchRequestSchema`는 이미 `gender`를 지원한다. 중간 계층인 `ProjectRosterPage`의 이력 보정 PATCH body에 `input.gender`를 전달하고, 실제 fetch body를 검증하는 UI 회귀 테스트로 누락을 방지한다.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- 일반 프로젝트 참가자 수정 요청은 변경하지 않는다.
- 서버와 데이터베이스 스키마는 변경하지 않는다.
- 기존 revision 충돌 및 권한 오류 처리를 유지한다.

---

### Task 1: 이력 보정 성별 수정 요청 복구

**Files:**
- Modify: `apps/web/src/features/roster/roster.test.tsx:3260-3340`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx:297-323`

**Interfaces:**
- Consumes: `ParticipantEditDialog`의 `onSave({ name, organizationId, role, grade, gender, expectedRevision })`
- Produces: `PATCH /projects/:projectId/history-corrections/roster/:entryId` body의 `gender: Gender | null`

- [ ] **Step 1: 이력 보정 PATCH body에 성별을 요구하는 실패 테스트 작성**

`routes correction add, bulk, and snapshot requests without changing ordinary payloads` 테스트의 명단 행을 남성으로 구성하고 수정 창에서 여성으로 바꾼다.

```tsx
rows={[{ ...entry("ACTIVE"), gender: "MALE" }]}

fireEvent.change(screen.getByRole("combobox", { name: "성별" }), {
  target: { value: "FEMALE" },
});
```

기존 PATCH body 기대값에 다음 속성을 추가한다.

```tsx
gender: "FEMALE",
```

- [ ] **Step 2: 대상 테스트를 실행해 성별 누락으로 실패하는지 확인**

Run:

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "routes correction add, bulk, and snapshot requests"
```

Expected: PATCH body에 `gender`가 없어 FAIL.

- [ ] **Step 3: 이력 보정 PATCH body에 성별 전달**

`ProjectRosterPage.updateParticipant`의 `correctionMode` 요청 body에 다음 필드를 추가한다.

```tsx
gender: input.gender,
```

- [ ] **Step 4: 대상 테스트를 다시 실행해 통과 확인**

Run:

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "routes correction add, bulk, and snapshot requests"
```

Expected: PASS.

- [ ] **Step 5: 웹 전체 검사 실행**

Run:

```bash
corepack pnpm --filter @event-roster/web test
corepack pnpm --filter @event-roster/web check
corepack pnpm exec biome check apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/roster/roster.test.tsx
```

Expected: 모든 명령 exit code 0.

- [ ] **Step 6: 변경 커밋**

```bash
git add apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/roster/roster.test.tsx
git commit -m "fix: persist closed roster gender edits"
```

