# Task 4 보고서: 프로젝트 상세 독립 로딩과 재시도

## Status

PASS — project shell과 6개 detail resource의 loading/error/retry를 분리하고,
기존 generation/projectId race 및 전용 오류 처리를 보존했다.

## 구현

- project 응답 즉시 header/tabs를 노출하고 선택 tab resource만 skeleton 처리
- 6개 resource를 동일한 `loadDetailResource` switch로 병렬 최초 조회 및 개별 재시도
- 실패한 선택 tab resource만 재요청하고 오류 문구를 한 줄로 결합
- full refresh 중 기존 tab 콘텐츠와 `새로고침 중…` 상태 유지
- initial/refresh project 오류를 전체 재조회 가능한 `RetryableError`로 표시
- edit/transition 버튼에 loading label과 중복 요청 방지 적용

## TDD 증거

### RED

- 최초 focused 실행: 새 테스트 6개 실패
  - header status 부재
  - tab `aria-busy`/skeleton 부재
  - 이전 project resource 종료가 새 loading을 보호하지 못함
  - 저장/상태 변경 loading label 부재
  - tab retry 버튼 부재
- full refresh 콘텐츠 보존 테스트: `프로젝트 개요` heading 소실로 1개 실패
- failed project refresh retry 테스트: retry 시 overview가 skeleton으로 교체되어 1개 실패

### GREEN

- 최초 구현 후 focused: 34/34 PASS
- full refresh 콘텐츠 보존 targeted: 1/1 PASS
- failed project refresh retry targeted: 1/1 PASS
- 최종 focused: 2 files, 36/36 PASS
- 최종 전체 web: 13 files, 147/147 PASS
- `@event-roster/web check`: PASS
- Biome 5 files 및 `git diff --check`: PASS

## Race 및 불변조건 검증

- `keeps a new project's resource loading after an old request settles`
  - 이전 project resource의 늦은 `finally`가 새 project loading을 지우지 않음
- `ignores a successful transition response after switching projects`
  - project 이동 후 이전 transition 성공 응답 무시
- `ignores a stale reload response after switching projects`
  - project 이동 후 이전 STALE_REVISION reload 응답 무시
- `invalidates the audit cursor and preserves a newer request lock across a full reload`
  - full reload가 이전 audit cursor를 무효화하고 새 pagination lock을 보존
- 모든 resource의 start/apply/error/finally 갱신에 동일한 `isCurrent(context)` 적용
- project 및 6개 resource는 하나의 `Promise.all`에 즉시 시작되어 병렬성 유지

## 자체 검토

- self-review에서 existing project refresh 재시도가 `load(false)`를 사용해 기존 콘텐츠를
  skeleton으로 바꾸는 문제를 발견했다.
- 재현 테스트를 RED로 확인한 뒤 `project !== null`을 refreshing 인자로 전달하는 최소
  수정으로 GREEN을 확인했다.
- API/서버/contracts 변경 없음. STALE_REVISION/PROJECT_CLOSED 분기 유지.

## 우려사항

없음.

---

## Code review Important 후속 수정

### Important 1: resource별 success/loaded 상태

#### RED

- `keeps loaded overview content when a full refresh resource fails`
  - refresh summary 실패 후 기존 `예상 7명`이 사라져 FAIL
- `keeps loaded audit content visible while its retry is pending`
  - refresh audit 실패 직후 기존 `기존 이력`이 사라져 FAIL
- `does not show an empty audit state before that resource first succeeds`
  - audit가 한 번도 성공하지 않았는데 full reload pending에서
    `아직 기록이 없습니다.`를 노출해 FAIL

#### GREEN

- `resourceLoaded: Partial<Record<DetailResource, boolean>>`를 추가했다.
- token 소유 요청이 성공한 경우에만 빈 배열/0을 포함해 loaded를 기록한다.
- loaded는 projectId 변경 effect에서만 reset하고 refresh/retry 실패에는 유지한다.
- tab의 모든 필수 resource가 loaded일 때만 content를 표시한다.
- loaded content는 refresh/retry loading과 error 중에도 인라인 상태와 함께 유지한다.
- 위 targeted 테스트: 3/3 PASS

### Important 2: stale retry generation과 동일 generation 요청 경쟁

#### RED

- `ignores a retry handler captured before a newer full load`
  - 이전 오류 UI retry callback이 새 generation을 읽어 audit GET을 2회에서 3회로
    증가시켜 FAIL
- `lets only the latest same-generation resource request update state`
  - 먼저 끝난 이전 요청의 `finally`가 최신 요청 pending 중 `aria-busy=false`로
    변경해 FAIL

#### GREEN

- RetryableError 렌더 시점 generation을 callback에 캡처하고 호출 시
  `isCurrent(context)`가 아니면 no-op 처리했다.
- resource별 monotonically increasing request token을 추가했다.
- 같은 resource의 최신 token 소유자만 apply/error/loaded/finally를 갱신한다.
- 먼저 끝난 이전 요청은 loading을 종료하지 않고, 늦은 이전 응답은 최신 데이터를
  덮어쓰지 않는다.
- 위 targeted 테스트: 2/2 PASS

### Fresh verification

- focused: 2 files, 41/41 PASS
- 전체 web: 13 files, 152/152 PASS
- `@event-roster/web check`: PASS
- Biome 2 files 및 `git diff --check`: PASS

---

## Code review audit pagination race 후속 수정

### RED

- `ignores an audit pagination handler captured before a newer full load`
  - 이전 렌더에서 캡처한 `이력 더 보기` 핸들러가 full reload 이후의 최신 generation을
    읽어 `old-cursor` GET을 1회 발생시켜 FAIL
  - 오래된 페이지가 새 기준 이력에 합쳐지고 최신 cursor를 지울 수 있는 경합을 재현

### GREEN

- `loadMoreAudit`가 렌더 시점의 `expectedGeneration`과 `expectedCursor`를 명시적으로
  받도록 변경했다.
- 요청 전에 generation/projectId, 현재 cursor 일치, pagination lock을 함께 검증한다.
- 응답·오류는 동일 context가 현재 pagination lock을 소유할 때만 반영한다.
- 이전 렌더 핸들러는 no-op하고, 새 기준 이력과 `new-cursor` 페이지 조회는 유지된다.
- targeted: 1/1 PASS

### Fresh verification

- focused: 2 files, 42/42 PASS
- 전체 web: 13 files, 153/153 PASS
- `@event-roster/web check`: PASS
- Biome 2 files 및 `git diff --check`: PASS

### 우려사항

없음.

---

## Code review live audit cursor와 base token 후속 수정

### RED

- `ignores an old audit pagination handler after the live cursor advances`
  - 동일 generation에서 첫 pagination 완료로 cursor가 `cursor-2`가 된 뒤에도
    이전 렌더의 `cursor-1` 핸들러가 `cursor-1` GET을 다시 실행해 FAIL
- `lets a same-generation audit retry supersede pending pagination`
  - `cursor-1` pagination pending 중 audit base retry가 최신 기준을 반영한 뒤,
    이전 pagination 응답이 `무효 페이지`를 append하고 최신 cursor를 지워 FAIL

### GREEN

- `auditNextCursorRef`와 `updateAuditNextCursor`를 추가해 state/ref cursor를 한
  경로에서 ref 우선으로 갱신한다.
- projectId reset, full load, audit base apply, pagination apply가 모두 같은 cursor
  갱신 경로를 사용한다.
- audit base 요청 시작 시 resource token을 증가시키고 이전 pagination lock/cursor를
  무효화해 pending base load 중 추가 pagination도 차단한다.
- pagination context에 시작 시점 audit resource token을 저장한다.
- generation/projectId, live cursor, lock identity, audit token이 모두 일치하는
  pagination만 결과·오류·cursor·lock을 갱신한다.
- targeted: 2/2 PASS

### Fresh verification

- focused: 2 files, 44/44 PASS
- 전체 web: 13 files, 155/155 PASS
- `@event-roster/web check`: PASS
- Biome 2 files 및 `git diff --check`: PASS

### 우려사항

없음.
