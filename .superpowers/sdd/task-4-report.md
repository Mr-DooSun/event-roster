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
