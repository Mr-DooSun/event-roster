# Task 7 보고서: 명단 프로필 열·필터와 프로젝트 요약 UI

## 구현 내용

- `participant-profile-labels.ts`에 역할(`학생`/`담당교사`)과 학년(`중1`~`고3`) 표시 라벨을 단일 원천으로 추가했다.
- 명단 표에 `참가자 구분`, `학년`, `등록 시점` 열을 추가했다. legacy `role: null`과 `grade: null`은 각각 `미지정`, 담당교사의 학년은 `-`로 표시한다.
- 역할/학년 필터를 기존 검색·조직·상태 필터와 같은 memoized predicate에 결합했다. `UNSPECIFIED`는 nullable 값과 일치하고, 담당교사는 정확한 학년 필터에 일치하지 않는다.
- 이 필터는 표에만 적용되며, 부모 `rows`나 export 흐름은 변경하지 않았다.
- 프로젝트 기본 요약과 테스트 fixture에 학생/담당교사 합계를 보완하고, 요약 카드 2개 및 조직별 학생/담당교사 열을 추가했다.

## RED → GREEN

### RED

```sh
corepack pnpm@10.28.1 --filter @event-roster/web exec vitest run \
  src/features/roster/roster.test.tsx src/features/projects/project-detail.test.tsx
```

- 107개 중 2개 실패.
- 명단 표에 `등록 시점` 열과 profile 표시/필터가 없었고, summary 카드와 조직별 역할 열이 없었다.

### GREEN

같은 focused 명령을 포맷 후 다시 실행했다.

- 2 files, 107/107 통과.
- 학생/중2, 담당교사/`-`, legacy `미지정` 표시를 행 단위로 확인했다.
- 검색 `학생`, 조직 `1팀`, 상태 `참석`, 역할 `학생`, 학년 `중2`를 함께 선택했을 때 일치 행만 남는 것을 확인했다.
- overview에서 `학생 3명`, `담당교사 2명`, 조직별 `학생`/`담당교사` 열을 확인했다.

## 검증

```sh
corepack pnpm@10.28.1 --filter @event-roster/web test
```

- 20 files, 290/290 통과.

```sh
corepack pnpm@10.28.1 test
```

- 권한 확장 실행으로 contracts, domain, web, worker, capability suites가 모두 통과했다.

```sh
corepack pnpm@10.28.1 exec biome check <변경 7개 파일>
git diff --check
```

- 모두 통과.

`corepack pnpm@10.28.1 --filter @event-roster/web run check` 및 `run build`는 동일하게
`apps/web/src/lib/excel/read-workbook.ts:43`의 `role`/`grade` 누락(TS2322)에서 중단됐다.
이는 Task 9 import reader 범위이며, Task 7은 선점 수정하지 않았다.

## 자체 검토

- 라벨 맵은 새 `participant-profile-labels.ts` 한 곳에만 두고 표에서 재사용했다.
- 교사는 grade가 stale/non-null이더라도 표에서 항상 `-`로 표시하며, exact grade 필터에는 포함되지 않는다.
- profile 필터는 `filtered` 로컬 파생값만 바꾸므로 export에 전달되는 `rows`를 바꾸지 않는다.
- 기본 `ProjectSummary`도 새 합계 필드를 제공해 로딩/오류 fallback의 타입 계약을 유지한다.

## 우려 사항

- web check/build를 막는 import reader의 타입 오류는 Task 9 완료 후 재검증이 필요하다.
