# 참가 명단 페이지네이션·조직 배지·성별 추가 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 추가의 모든 경로에서 성별을 저장하고, 명단을 조직·학년·이름 중심의 열 순서와 조직 배지 및 30/60/100 클라이언트 페이지네이션으로 개선한다.

**Architecture:** 성별은 기존 nullable roster snapshot 모델을 유지하면서 웹의 누락된 submit 매핑과 worker 단건 추가 SQL을 연결한다. 명단 표는 기존 필터·다중 정렬 결과를 `filtered`로 유지하고 그 뒤에 페이지 계산과 slice를 적용한다. 조직 배지는 조직 ID에서 결정적 팔레트 번호를 계산해 텍스트와 함께 표시한다.

**Tech Stack:** React 19, TypeScript, Hono, Zod, Cloudflare D1, Vitest, Testing Library, CSS

## Global Constraints

- 성별은 `MALE | FEMALE | null`이며 미지정 등록을 허용한다.
- 기존 `NULL` 성별은 자동 추정하거나 일괄 변환하지 않는다.
- 기존 revision, 프로젝트 상태, 조직 권한 및 원자성 규칙을 유지한다.
- 기본 정렬은 `조직 → 학년 → 이름`이며 열은 `조직 → 학년 → 이름 → 참가자 구분 → 성별 → 상태 → 작업 → 등록 시점` 순서다.
- 페이지네이션은 화면에만 적용하며 Excel 내보내기와 집계 데이터에는 영향을 주지 않는다.
- 기본 페이지 크기는 30명이고 선택지는 30/60/100명이다.

---

### Task 1: 새 참가자와 기존 참가자 성별 submit 연결

**Files:**
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`

**Interfaces:**
- Consumes: `Gender`, `BulkParticipantDraft.gender`, `RosterParticipantInput.gender`
- Produces: `ExistingParticipantConfirmation.gender: Gender | null` 및 bulk participant item의 `gender`

- [ ] **Step 1: 새 참가자 bulk payload 회귀 테스트 작성**

기존 `submits normalized bulk names with one organization` 테스트에서 첫 행의 `1번 성별`을 `MALE`, 두 번째 행을 `FEMALE`로 변경하고 다음 payload를 기대한다.

```tsx
expect(onCreateAndAdd).toHaveBeenCalledWith({
  participants: [
    { name: "홍길동", role: "STUDENT", grade: "M1", gender: "MALE" },
    { name: "김 민수", role: "STUDENT", grade: "H2", gender: "FEMALE" },
  ],
  organizationId: "org-1",
  confirmDuplicateNames: false,
});
```

- [ ] **Step 2: 기존 참가자 성별 선택과 payload 회귀 테스트 작성**

기존 참가자 dialog 테스트에서 `성별` combobox를 `FEMALE`로 바꾸고 `onAdd` 호출에 다음 필드를 요구한다.

```tsx
gender: "FEMALE",
```

참가자를 다른 사람으로 선택하면 combobox가 빈 값으로 돌아가는 검증도 추가한다.

- [ ] **Step 3: 웹 대상 테스트를 실행해 두 누락으로 실패 확인**

Run:

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "submits normalized bulk|existing participant.*gender"
```

Expected: bulk payload에 `gender`가 없고 기존 참가자 성별 combobox가 없어 FAIL.

- [ ] **Step 4: ParticipantDialog에 최소 구현**

contracts import에 `Gender`를 추가하고 interface와 state를 다음처럼 확장한다.

```tsx
export interface ExistingParticipantConfirmation {
  // existing fields
  gender: Gender | null;
}

const [confirmedGender, setConfirmedGender] = useState<Gender | null>(null);
```

`selectParticipant`에서 `setConfirmedGender(null)`을 호출하고 기존 참가자 폼에 다음 select를 추가한다.

```tsx
<label className="er-field">
  <span>성별</span>
  <select
    value={confirmedGender ?? ""}
    disabled={busy !== null}
    onChange={(event) =>
      setConfirmedGender((event.currentTarget.value || null) as Gender | null)
    }
  >
    <option value="">미지정</option>
    <option value="MALE">남성</option>
    <option value="FEMALE">여성</option>
  </select>
</label>
```

`addExisting` payload에 `gender: confirmedGender`, `createAndAdd`의 `rows.map`에 `gender: row.gender ?? null`을 포함한다.

- [ ] **Step 5: 웹 대상 테스트 통과 확인 후 커밋**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "submits normalized bulk|existing participant.*gender"
git add apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/features/roster/roster.test.tsx
git commit -m "fix: submit roster gender from participant add"
```

Expected: 대상 테스트 PASS.

---

### Task 2: 단건 추가와 재활성화 성별 스냅샷 저장

**Files:**
- Modify: `apps/worker/src/services/roster.ts`
- Modify: `apps/worker/test/roster.integration.test.ts`

**Interfaces:**
- Consumes: `RosterCreateRequestSchema.confirmedParticipant.gender?: Gender | null`
- Produces: 신규·재활성화 `project_roster_entries.gender_snapshot` 및 `RosterRecord.gender`

- [ ] **Step 1: 신규 단건 추가와 재활성화 실패 테스트 작성**

`adds, cancels, and reactivates one roster row with revisions`와 `reactivates a same-project entry with the newly confirmed profile`에 각각 `gender: "MALE"`, `gender: "FEMALE"`를 confirmed participant에 전달한다. API body와 DB를 다음처럼 검증한다.

```ts
expect(await response.json()).toMatchObject({ gender: "MALE" });
expect(
  await env.DB.prepare(
    "SELECT gender_snapshot FROM project_roster_entries WHERE id = ?",
  ).bind(entryId).first(),
).toEqual({ gender_snapshot: "MALE" });
```

재활성화는 기존 값을 `FEMALE`로 덮어쓰고 응답과 재조회도 `FEMALE`인지 확인한다.

- [ ] **Step 2: worker 대상 테스트에서 SQL 저장 누락 실패 확인**

```bash
corepack pnpm --filter @event-roster/worker exec vitest run --maxWorkers=1 test/roster.integration.test.ts -t "adds, cancels, and reactivates|reactivates a same-project entry"
```

Expected: 응답 또는 DB의 gender가 `null`이라 FAIL.

- [ ] **Step 3: roster service의 입력 타입과 SQL 구현**

`Gender`, `GenderSchema`를 import하고 `confirmedParticipant` 타입에 다음을 추가한다.

```ts
gender?: Gender | null;
```

재활성화 UPDATE에 `gender_snapshot = ?`, 신규 INSERT column/select에 `gender_snapshot`과 `confirmedParticipant.gender ?? null`을 추가한다. 두 `RETURNING` 절에 `gender_snapshot`을 포함한다.

`mapReturnedRoster` 검증에 다음 조건을 추가한다.

```ts
(row.gender_snapshot !== null && typeof row.gender_snapshot !== "string")
```

반환 매핑은 다음을 사용한다.

```ts
gender:
  row.gender_snapshot === null
    ? null
    : GenderSchema.parse(row.gender_snapshot),
```

- [ ] **Step 4: worker 대상 테스트 통과 및 관련 전체 테스트 실행**

```bash
corepack pnpm --filter @event-roster/worker exec vitest run --maxWorkers=1 test/roster.integration.test.ts
```

Expected: roster integration 테스트 전체 PASS.

- [ ] **Step 5: worker 변경 커밋**

```bash
git add apps/worker/src/services/roster.ts apps/worker/test/roster.integration.test.ts
git commit -m "fix: persist gender for roster additions"
```

---

### Task 3: 명단 열 순서와 조직 배지

**Files:**
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `RosterView.organizationId`, `organizationName`, `grade`, `participantName`
- Produces: `.er-organization-badge`와 `data-color-index="0..5"`

- [ ] **Step 1: 헤더·셀 순서와 안정적 배지 실패 테스트 작성**

테이블의 header text 순서를 다음 배열로 검증한다.

```tsx
expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.replace(/\d/g, ""))).toEqual([
  expect.stringContaining("조직"),
  expect.stringContaining("학년"),
  expect.stringContaining("이름"),
  "참가자 구분",
  expect.stringContaining("성별"),
  expect.stringContaining("상태"),
  "작업",
  "등록 시점",
]);
```

같은 organizationId의 두 행은 같은 `data-color-index`, 다른 organizationId는 다른 인덱스를 가지며 조직명 span에 `.er-organization-badge`가 있는지 검증한다.

- [ ] **Step 2: 대상 테스트가 기존 이름-first 열과 배지 부재로 실패하는지 확인**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "orders roster columns|organization badges"
```

Expected: 헤더 순서와 배지 assertion FAIL.

- [ ] **Step 3: 열과 셀을 조직·학년·이름 순으로 재배치**

`RosterTable`의 header와 각 row의 첫 세 cell을 같은 순서로 옮긴다. 정렬·필터 버튼의 handler와 접근성 이름은 기존 값을 유지한다.

파일 내부에 결정적 인덱스 함수를 추가한다.

```ts
function organizationColorIndex(organizationId: string) {
  let hash = 0;
  for (const character of organizationId) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % 6;
}
```

조직명은 다음 구조로 표시한다.

```tsx
<span
  className="er-organization-badge"
  data-color-index={organizationColorIndex(row.organizationId)}
>
  {row.organizationName}
</span>
```

- [ ] **Step 4: 6색 저채도 CSS 팔레트 추가**

`.er-organization-badge`에 inline-flex, padding, pill radius와 font-weight를 주고 `[data-color-index="0"]`부터 `5`까지 기존 디자인 토큰 계열의 연한 배경/진한 글자색을 지정한다. `.er-table-organization`의 삭제 배지 정렬은 유지한다.

- [ ] **Step 5: 대상 테스트와 CSS 정적 검사 후 커밋**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "orders roster columns|organization badges"
corepack pnpm exec biome check apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git add apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git commit -m "feat: emphasize roster organizations"
```

---

### Task 4: 30/60/100 클라이언트 페이지네이션

**Files:**
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/roster.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: 필터·정렬 완료 `filtered: RosterView[]`
- Produces: `pageSize: 30 | 60 | 100`, `currentPage`, `pagedRows`, `.er-roster-pagination`

- [ ] **Step 1: 기본 페이지와 이동 실패 테스트 작성**

35개 행을 렌더해 처음 30개만 보이고 `총 35명 · 1–30명 표시`가 노출되는지 검증한다. `다음 페이지` 클릭 후 31–35번째 행과 `총 35명 · 31–35명 표시`를 검증한다.

- [ ] **Step 2: 페이지 크기와 조건 초기화 실패 테스트 작성**

65개 행에서 `페이지당 표시 인원`을 60으로 변경하면 60개가 표시되고, 2페이지에서 검색 또는 성별 필터를 변경하면 1페이지 표시로 돌아오는지 검증한다. 30/60/100 option도 모두 확인한다.

- [ ] **Step 3: 대상 테스트가 전체 행 표시와 컨트롤 부재로 실패 확인**

```bash
corepack pnpm --filter @event-roster/web exec vitest run src/features/roster/roster.test.tsx -t "paginates roster|resets roster page"
```

Expected: 30개 제한과 pagination control이 없어 FAIL.

- [ ] **Step 4: 필터·정렬 뒤 pagination state와 범위 구현**

```tsx
const [pageSize, setPageSize] = useState<30 | 60 | 100>(30);
const [currentPage, setCurrentPage] = useState(1);
const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
const safePage = Math.min(currentPage, pageCount);
const firstIndex = (safePage - 1) * pageSize;
const pagedRows = filtered.slice(firstIndex, firstIndex + pageSize);
```

query와 각 filter, sortKeys, pageSize 변경 시 `setCurrentPage(1)`을 수행하고, filtered 길이 축소 시 `setCurrentPage(pageCount)`로 범위를 보정한다. tbody는 `pagedRows.map`을 사용한다.

- [ ] **Step 5: pagination UI와 접근성 구현**

테이블 아래 `.er-roster-pagination`에 결과 범위, page size select, 이전/페이지 번호/다음 버튼을 둔다. 버튼 접근성 이름은 `이전 페이지`, `N페이지`, `다음 페이지`로 지정하고 현재 페이지에는 `aria-current="page"`를 준다. 빈 결과 범위는 `총 0명 · 0명 표시`다.

- [ ] **Step 6: 반응형 pagination CSS 구현**

desktop은 결과 범위·page size·버튼을 한 행에 배치하고 좁은 화면은 wrap한다. 버튼은 기존 button token을 재사용하되 표 아래에서 과도한 높이를 만들지 않는 compact 크기로 지정한다.

- [ ] **Step 7: 웹 전체 테스트와 검사 후 커밋**

```bash
corepack pnpm --filter @event-roster/web test
corepack pnpm --filter @event-roster/web check
corepack pnpm exec biome check apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git add apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/styles/global.css
git commit -m "feat: paginate project roster"
```

---

### Task 5: 전체 회귀 검증

**Files:**
- Verify only: repository-wide changes from Tasks 1–4

**Interfaces:**
- Consumes: 모든 이전 task 결과
- Produces: 배포 가능한 검증 증거

- [ ] **Step 1: 전체 테스트·타입·포맷 검사**

```bash
corepack pnpm -r run test
corepack pnpm -r run check
corepack pnpm exec biome check .
```

Expected: 모든 명령 exit code 0.

- [ ] **Step 2: production build와 Worker bundle dry-run**

```bash
corepack pnpm --filter @event-roster/web build
corepack pnpm --filter @event-roster/worker exec wrangler deploy --dry-run
```

Expected: build와 dry-run exit code 0, static assets와 Worker bundle 생성 성공.

- [ ] **Step 3: 작업 트리와 커밋 검토**

```bash
git diff --check main...HEAD
git status --short
git log --oneline main..HEAD
```

Expected: whitespace 오류와 미커밋 파일이 없고 Task 1–4의 집중된 커밋이 순서대로 표시된다.

