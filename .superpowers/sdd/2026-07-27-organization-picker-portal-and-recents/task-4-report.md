# Task 4 Report: Recent Organizations in Roster Adds

## 구현

- `ParticipantDialog`에 `recentOrganizationIds`를 연결했다.
  - 새 참가자는 활성 조직만 최근순으로 정렬한 첫 조직을 기본값으로 사용한다.
  - 기존 참가자의 확정 조직 초기화 규칙은 유지한다.
  - 기존/새 참가자 콤보박스 모두 최근순 후보를 사용한다.
- `ProjectRosterPage`에서 인증 세션의 실제 사용자 ID와 프로젝트 ID로 최근 조직을 읽고 갱신한다.
  - 활성 연결 조직만 유효 ID로 취급한다.
  - 기존/새 참가자 추가의 POST와 `onChanged()`가 모두 성공한 뒤에만 기록한다.
  - POST 거부, `STALE_REVISION`, `PROJECT_CLOSED`, 성공 POST 이후 reload 거부에서는 기록하지 않는다.
  - 사용자 또는 프로젝트가 바뀌면 해당 키의 최근 조직을 다시 읽는다.
- 선택된 조직 이름은 입력에 유지하면서, 포커스된 콤보박스 후보는 전체 활성 조직을 최근순으로 노출하도록 `OrganizationSelectCombobox`를 보완했다. 사용자가 입력을 수정한 뒤에는 기존 검색 필터가 그대로 적용된다.

## TDD

- RED: `roster.test.tsx` 실행에서 새 참가자 최근 기본값, 기존 조직 보존과 최근순 후보, 성공 후 저장, 사용자/프로젝트 격리 테스트가 기능 미구현 사유로 실패하는 것을 확인했다.
- GREEN: 최소 구현 후 roster 및 combobox focused 테스트가 통과했다.
- 실패 경로와 reload 완료 전 상태를 별도로 검증해 성공 완료 분기 밖의 저장을 방지했다.

## 최종 검증

- focused: 최근 조직 유틸리티 + 콤보박스 + roster, 3 files / 54 tests 통과
- full Web: 19 files / 262 tests 통과
- Web TypeScript check 통과
- repository Biome check: 248 files, 오류 없음
- `git diff --check` 통과

## Fix round 1: stale recency context guard

- RED: reload가 대기 중인 상태에서 프로젝트가 바뀌거나 선택 조직이
  비활성화되도록 rerender한 뒤 완료시키는 테스트 2개를 추가했다. 기존
  구현은 두 경우 모두 오래된 `org-2`를 localStorage에 기록하여
  `roster.test.tsx` 34개 중 신규 2개가 실패했다.
- GREEN: 인증 사용자, 프로젝트, 활성 조직 ID 집합의 의미적 변경을 render
  시점에 generation으로 기록했다. 각 추가 mutation은 시작 generation을
  캡처하고, reload 완료 직전 최신 generation과 다르면 recency 저장과 상태
  갱신만 건너뛴다. mutation 성공 후 모달 닫힘은 그대로 유지한다.
- focused: 최근 조직 유틸리티 + 콤보박스 + roster, 3 files / 56 tests 통과
- full Web: 19 files / 264 tests 통과
- Web TypeScript check 통과
- repository Biome check: 248 files, 오류 없음
