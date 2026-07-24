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
