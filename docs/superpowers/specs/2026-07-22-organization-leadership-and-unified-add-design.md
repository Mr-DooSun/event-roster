# Event Roster 조직 책임자 및 통합 조직 추가 설계

- 작성일: 2026-07-22
- 상태: 대화 설계 승인 완료, 사용자 문서 검토 대기
- 선행 문서: `2026-07-22-project-centered-roster-design.md`
- 변경 범위: 프로젝트 조직 추가 UX, 전역 조직 관리 화면, 조직별 담당자 역할과 권한
- 유지 범위: 프로젝트 수명주기, 참가자 마스터와 스냅샷, 자체 계정/JWT, 임시 비밀번호, 감사, 브라우저 Excel, Worker+D1 배포

## 1. 목표와 결정

프로젝트에 조직을 연결하는 현재의 `기존 조직 연결`과 `새 조직 연결`을 하나의 `조직 추가` 흐름으로 합친다. 운영자는 한 입력창에서 기존 조직을 검색해 연결하거나, 정확히 일치하는 조직이 없을 때 새 조직을 생성한 뒤 연결한다.

전역 조직 관리 화면을 운영자 전용으로 제공한다. 조직마다 대표 조직장 한 명과 추가 관리자 여러 명을 지정할 수 있다. 대표 조직장과 추가 관리자는 자신이 담당하는 조직의 프로젝트별 참여 명단을 사전 등록 기간에 직접 관리한다.

승인된 핵심 결정은 다음과 같다.

- 조직과 프로젝트의 관계는 계속 다대다다.
- 조직은 대표 조직장 없이도 프로젝트에 먼저 추가할 수 있다.
- 대표 조직장 지정 전에는 운영자가 명단을 관리한다.
- 한 계정은 여러 조직을 담당할 수 있다.
- 조직 담당자는 조직 정보나 계정 권한을 바꿀 수 없고 참여 명단만 관리한다.
- 조직장 계정과 참여자는 별개다. 조직장 계정 생성이나 프로젝트 연결이 참여 명단을 자동 생성하지 않는다.
- 조직 담당자는 `PRE_REGISTRATION`에서만 담당 조직 명단을 변경한다. `IN_PROGRESS` 이후 당일 변경은 운영자만 수행한다.
- 계정, 조직 배정, 프로젝트 연결 변경은 append-only 감사 이력으로 보존한다.

## 2. 검토한 접근과 선택

### 프로젝트 조직 추가 UX

다음 세 접근을 비교했다.

1. **검색 결과와 명시적 새 조직 생성을 한 목록에 표시**: 기존 조직을 우선 선택하고, 일치하는 결과가 없을 때 `“이름” 새 조직 생성 후 추가`를 명시적으로 선택한다.
2. **단일 입력 후 자동 판별**: 정확한 이름이 있으면 연결하고 없으면 자동 생성한다.
3. **조직과 조직장까지 한 wizard에서 지정**: 프로젝트 연결과 계정 발급을 한 작업으로 묶는다.

1번을 선택한다. 2번은 오타와 유사 이름으로 전역 조직이 중복 생성될 위험이 크다. 3번은 조직만 먼저 연결하려는 정상 흐름을 무겁게 만들고 프로젝트 화면과 전역 계정 관리의 책임을 섞는다.

### 조직 책임자 모델

대표 한 명만 두는 모델, 동등한 관리자만 여러 명 두는 모델, 대표 한 명과 추가 관리자 여러 명을 두는 모델을 비교했다. 책임 소재를 표시하면서 휴가·겸임·업무 분산에도 대응할 수 있도록 세 번째 모델을 선택한다.

## 3. 역할 모델

권한은 전역 사용자 역할과 조직별 배정 역할로 나눈다.

### 전역 사용자 역할

`users.role`은 기존 값을 유지한다.

| 값 | 의미 |
| --- | --- |
| `OPERATOR` | 전체 프로젝트, 조직, 계정, 명단을 운영한다. |
| `ORGANIZATION_MANAGER` | 배정된 조직의 허용된 명단 작업만 수행한다. |

### 조직별 배정 역할

`user_organizations.assignment_role`을 추가한다.

| 값 | 의미 |
| --- | --- |
| `PRIMARY_LEADER` | 해당 조직을 대표하는 책임자. 조직당 최대 한 명이다. |
| `MANAGER` | 추가 조직 관리자. 조직당 여러 명을 허용한다. |

`PRIMARY_LEADER`와 `MANAGER`는 명단 권한이 같다. `PRIMARY_LEADER`는 책임자 표시와 운영 연락 기준을 위한 조직별 속성이며 새로운 전역 인증 역할이 아니다.

한 사용자는 여러 조직에 배정될 수 있으며 조직마다 다른 `assignment_role`을 가질 수 있다. `OPERATOR`는 `user_organizations` 배정 없이 전체 권한을 가진다.

## 4. 데이터 모델과 마이그레이션

기존 `user_organizations`를 새 구조로 재구성한다.

```text
user_organizations
- user_id
- organization_id
- assignment_role       PRIMARY_LEADER | MANAGER
- assigned_by           OPERATOR user id, migrated row만 NULL
- assigned_at           UTC ISO timestamp
- PRIMARY KEY (user_id, organization_id)
```

DB 제약은 다음을 강제한다.

- `user_id`와 `organization_id`는 `ON DELETE RESTRICT` foreign key다.
- 같은 사용자를 같은 조직에 중복 배정할 수 없다.
- partial unique index로 조직마다 `PRIMARY_LEADER`를 최대 한 명만 허용한다.
- 조직 배정 대상 사용자는 서비스 계층에서 활성 `ORGANIZATION_MANAGER`인지 검증한다.
- 비활성 조직에는 새 담당자를 배정할 수 없다.

기존 행은 모두 `MANAGER`로 이관한다. 마이그레이션 시 임의로 대표를 추정하지 않는다. 기존 배정은 과거 작업자를 복원할 수 없으므로 `assigned_by=NULL`, `assigned_at=0002 프로젝트 모델 마이그레이션 적용 시각`으로 기록한다. 신규 배정은 서비스 계층에서 활성 운영자 ID를 필수로 기록한다. 구현 계획에서 SQLite table rebuild와 foreign key integrity 검사를 구체화한다.

조직 배정 해제는 관계 행을 제거하되 계정과 조직은 삭제하지 않는다. append-only `audit_logs`가 변경 전후 값을 영구 보존한다. 대표 교체는 기존 대표 해제 또는 `MANAGER` 전환, 새 대표 지정, 감사 행 삽입을 하나의 D1 batch에서 처리한다.

대표가 해제된 계정은 다음 규칙을 따른다.

- 다른 조직 배정은 그대로 유지한다.
- 어느 조직에도 배정되지 않아도 계정은 활성 상태로 보존한다.
- 배정이 없는 조직 담당자가 로그인하면 접근 가능한 프로젝트가 없는 빈 상태를 표시한다.
- 계정을 사용 중지할지는 운영자가 별도로 결정한다.

## 5. 프로젝트의 통합 `조직 추가`

프로젝트 상세의 `조직` 탭에서 기존 두 입력 카드를 제거하고 하나의 combobox를 제공한다.

### 검색과 선택

- label은 `조직 이름 검색 또는 입력`이다.
- trim과 기존 canonical-name 규칙으로 검색어를 정규화한다.
- 활성 전역 조직을 이름으로 검색한다.
- 현재 프로젝트에 이미 연결된 조직은 결과에 `이미 추가됨`으로 표시하고 선택을 막는다.
- 비활성 전역 조직은 기본 결과에서 제외한다.
- 기존 결과를 선택하면 해당 조직을 프로젝트에 연결하거나 비활성 프로젝트 연결을 재활성화한다.

### 새 조직 생성

- canonical name이 정확히 일치하는 조직이 없을 때만 `“입력값”을 새 조직으로 생성 후 추가` action을 표시한다.
- 유사 이름 검색 결과를 action보다 먼저 보여준다.
- action 선택 후 짧은 확인 단계에서 전역 조직이 생성된다는 점을 알린다.
- 조직 생성과 `project_organizations` 연결은 하나의 guarded D1 batch에서 성공하거나 함께 rollback한다.
- 동시 요청이 같은 canonical name을 생성하면 중복 조직을 만들지 않는다. 서버가 이미 생성된 조직을 다시 조회하고 프로젝트 연결 가능 상태를 반환한다.
- 프로젝트에 이미 연결된 경우 오류 토스트만 띄우지 않고 해당 조직 행을 강조해 결과를 보여준다.

### 프로젝트 조직 목록

각 조직 행에는 다음을 표시한다.

- 조직 이름과 프로젝트 연결 상태
- 대표 조직장 이름 또는 `대표 조직장 미지정`
- 추가 관리자 수
- 현재 명단 인원
- 운영자에게만 보이는 `조직 관리에서 담당자 지정` 이동 action

대표 조직장이 없어도 프로젝트 연결과 운영자 명단 입력은 정상 동작한다.

## 6. 운영자 전용 조직 관리

선행 프로젝트 설계에서 제거하기로 했던 전역 조직 관리 화면을 이 문서가 다시 도입한다. 프로젝트 조직 탭은 연결을 관리하고, 전역 조직 관리 화면은 조직과 담당자 마스터를 관리한다.

### 조직 목록

왼쪽 주 메뉴에 운영자 전용 `조직 관리`를 추가한다. 목록은 다음을 제공한다.

- 조직 이름 검색
- 활성/비활성 상태 필터
- 대표 조직장 미지정 필터
- 대표 조직장 이름
- 추가 관리자 수
- 연결된 프로젝트 수
- 새 조직 생성
- 조직 상세 이동

### 조직 상세

조직 상세는 다음 영역으로 구성한다.

- 조직 이름과 활성 상태
- 대표 조직장 지정, 교체, 해제
- 추가 관리자 지정과 해제
- 기존 조직 담당자 계정 검색
- 새 조직 담당자 계정 발급
- 현재 및 과거 연결 프로젝트
- 조직과 담당자 변경 감사 이력

조직 이름 변경과 전체 사용 중지는 기존 과거 명단의 조직명 snapshot을 바꾸지 않는다. 비활성 조직은 신규 프로젝트 연결, 신규 담당자 배정, 신규 참가자·명단 추가를 막고 과거 기록 조회는 유지한다.

## 7. 계정 발급과 담당자 배정

계정 생성은 기존 자체 아이디/비밀번호/JWT 흐름을 재사용한다.

1. 운영자가 영문 로그인 ID와 표시 이름을 입력한다.
2. 서버가 `ORGANIZATION_MANAGER` 계정과 임시 비밀번호를 생성한다.
3. 계정 생성과 조직 배정을 가능한 한 하나의 운영 흐름으로 처리하되 raw 임시 비밀번호는 성공 응답에서 한 번만 표시한다.
4. 사용자는 첫 로그인에서 새 비밀번호를 반드시 설정한다.
5. 비밀번호 변경용 제한 세션을 종료한 뒤 새 비밀번호로 다시 로그인한다.
6. 이후 access/refresh JWT와 서버측 세션 검증을 포함한 기존 인증 정책을 유지한다.

대표 교체 시 기존 계정을 삭제하거나 자동 사용 중지하지 않는다. 기존 대표를 같은 조직의 `MANAGER`로 남길지는 운영자가 교체 화면에서 명시적으로 선택한다. 계정 사용 중지는 별도 action이며 성공 시 `session_version` 증가와 세션 revoke로 기존 로그인을 무효화한다.

조직장 계정은 참가자 마스터가 아니다. 계정 생성, 조직 배정, 프로젝트 조직 연결 어느 것도 `participants` 또는 `project_roster_entries`를 자동 생성하지 않는다. 실제 참석하는 조직장은 다른 참가자와 같은 방식으로 명단에 추가한다.

## 8. 권한 정책

| 기능 | `OPERATOR` | 배정된 `ORGANIZATION_MANAGER` |
| --- | --- | --- |
| 전체 조직·계정 관리 | 허용 | 거부 |
| 프로젝트 조직 추가·중지 | 허용 | 거부 |
| 모든 조직 명단 조회·변경 | 허용 | 거부 |
| 담당 조직이 연결된 프로젝트 조회 | 허용 | 허용 |
| 담당 조직 명단 조회 | 허용 | 허용 |
| 담당 조직 사전 명단 추가·수정·취소 | 허용 | `PRE_REGISTRATION`에서만 허용 |
| `IN_PROGRESS` 당일 변경 | 허용 | 거부 |
| Excel import | 허용 | 거부 |
| Excel export | 전체 허용 | 담당 조직 범위만 허용 |
| 감사 이력 | 전체 허용 | 담당 조직의 명단 변경만 허용 |

조직 담당자는 조직 이름, 활성 상태, 대표, 추가 관리자, 계정 상태를 변경할 수 없다. 대표와 추가 관리자의 명단 권한은 동일하다.

서버는 UI 노출 여부와 관계없이 매 mutation에서 다음을 다시 검증한다.

- 사용자와 세션 활성 상태
- 전역 사용자 역할
- 활성 사용자-조직 배정
- 프로젝트-조직 연결과 상태
- 프로젝트 상태와 revision
- 대상 participant/roster의 조직 scope

JWT claim의 조직 ID나 역할만 신뢰하지 않고 D1의 현재 상태를 권위 데이터로 사용한다.

## 9. API 방향

정확한 request/response schema는 구현 계획에서 기존 contracts와 함께 확정한다. endpoint 책임은 다음과 같이 나눈다.

```text
GET    /api/v1/organizations?query=&status=&leaderStatus=
POST   /api/v1/organizations
GET    /api/v1/organizations/:organizationId
PATCH  /api/v1/organizations/:organizationId

GET    /api/v1/organizations/:organizationId/managers
POST   /api/v1/organizations/:organizationId/managers
PATCH  /api/v1/organizations/:organizationId/managers/:userId
DELETE /api/v1/organizations/:organizationId/managers/:userId

POST   /api/v1/projects/:projectId/organizations
```

프로젝트 조직 추가 POST는 다음 두 variant 중 정확히 하나를 받는 union 계약으로 만든다.

```text
{ organizationId, expectedProjectRevision }
{ newOrganizationName, expectedProjectRevision }
```

대표 교체는 중간에 대표가 둘이 되거나 의도치 않게 없어지는 상태를 방지하도록 하나의 전용 mutation 또는 revision을 포함한 원자적 batch로 처리한다. 담당자 생성과 배정은 기존 사용자 생성 API를 재사용할 수 있지만, UI가 raw 임시 비밀번호를 잃지 않도록 성공/실패 경계를 명확히 한다.

## 10. 감사 이력

기존 append-only `audit_logs`와 수정·삭제 방지 trigger를 유지한다. 다음 action을 추가하거나 명시한다.

- `ORGANIZATION_CREATED`
- `ORGANIZATION_RENAMED`
- `ORGANIZATION_DEACTIVATED`
- `ORGANIZATION_REACTIVATED`
- `PROJECT_ORGANIZATION_ADDED`
- `PROJECT_ORGANIZATION_REACTIVATED`
- `PROJECT_ORGANIZATION_DEACTIVATED`
- `ORGANIZATION_PRIMARY_ASSIGNED`
- `ORGANIZATION_PRIMARY_REPLACED`
- `ORGANIZATION_PRIMARY_REMOVED`
- `ORGANIZATION_MANAGER_ASSIGNED`
- `ORGANIZATION_MANAGER_REMOVED`
- 기존 사용자 생성·비밀번호 초기화·사용 중지·재활성화 action

각 행은 작업자, 대상 entity, 발생 시각, 민감정보를 제외한 변경 전후 값을 포함한다. raw 비밀번호, password hash, JWT, refresh token, CSRF 값, IP 원문은 감사 detail에 기록하지 않는다.

## 11. 오류와 동시성

- 유사 조직이 있어도 새 조직 생성을 영구 차단하지 않지만 기존 결과 확인과 명시적 생성 action을 거치게 한다.
- canonical name 중복은 `CONFLICT`로 끝내지 않고 가능한 경우 기존 조직을 resolve해 사용자가 이어서 연결할 수 있는 응답을 제공한다.
- 이미 연결된 조직은 현재 연결 상태를 반환하고 UI에서 해당 행을 강조한다.
- 비활성 조직·계정·배정은 mutation을 거부하되 과거 기록 조회는 유지한다.
- 대표 교체 경쟁은 조직 배정 revision 또는 DB unique 제약으로 정확히 하나만 성공시킨다.
- 프로젝트 상태나 revision이 바뀌면 입력을 보존하고 최신 프로젝트를 다시 불러온다.
- D1 batch의 영향 행 0을 성공으로 취급하지 않는다.
- 조직 배정, 계정 상태, 감사 행은 원자적이어야 한다. 감사 삽입 실패 시 업무 변경도 rollback한다.

## 12. 테스트 전략

테스트는 RED → 최소 구현 → GREEN 순서를 따른다.

### 계약과 도메인

- 조직 검색 query와 통합 조직 추가 union schema
- `PRIMARY_LEADER | MANAGER` validation
- 같은 조직 사용자 중복과 대표 최대 한 명 규칙
- 역할별/프로젝트 상태별 권한 matrix

### D1 migration과 통합

- 기존 `user_organizations`가 모두 `MANAGER`로 보존되는지 검증
- foreign key integrity와 대표 partial unique index 검증
- 한 계정의 복수 조직 배정
- 대표 교체 원자성과 동시 요청 경쟁
- 배정 해제 후 계정과 과거 감사 보존
- 조직/계정 비활성화 시 신규 변경 차단과 과거 조회 유지
- 조직 생성+프로젝트 연결의 전체 성공/전체 rollback
- canonical name 동시 생성과 프로젝트 중복 연결
- 감사 trigger와 민감정보 비기록

### Web

- 기존/신규 카드를 통합 combobox로 교체
- 기존 결과, 유사 결과, 새 조직 생성 action, 이미 추가됨 상태
- 조직장 미지정 표시와 조직 상세 이동
- 운영자에게만 조직 관리 navigation 노출
- 조직 목록 필터와 조직 상세 담당자 편집
- raw 임시 비밀번호 1회 표시와 실패 복구
- 조직 담당자에게 관리 UI가 노출되지 않는지 검증

### 권한과 E2E

- 대표와 추가 관리자의 동일한 사전 명단 권한
- 다른 조직과 연결되지 않은 프로젝트 접근 차단
- `PRE_REGISTRATION`에서는 담당 명단 변경 허용
- `IN_PROGRESS` 이후에는 조직 담당자 변경 거부, 운영자 변경 허용
- 담당자 계정이 참여 명단에 자동 등록되지 않음
- 운영자 조직 생성 → 프로젝트 연결 → 계정 발급 → 대표 지정 → 첫 비밀번호 변경 → 담당 조직 사전 명단 입력의 전체 흐름

## 13. 완료 기준

- 프로젝트 조직 탭에 `조직 추가` combobox 하나만 존재한다.
- 기존 조직 연결과 명시적 신규 조직 생성이 한 흐름에서 동작한다.
- 대표 없이도 조직을 프로젝트에 연결할 수 있다.
- 운영자 전용 조직 관리에서 대표 한 명과 추가 관리자 여러 명을 관리한다.
- 한 계정이 여러 조직을 담당할 수 있다.
- 조직 담당자는 자신의 조직 명단만 사전 등록 기간에 변경한다.
- 당일 변경과 조직·계정 관리는 운영자만 수행한다.
- 계정과 참가자가 자동 결합되지 않는다.
- 기존 조직 배정, 프로젝트, 명단과 감사 데이터가 migration 후 보존된다.
- 모든 관리 변경이 민감정보 없이 append-only 감사 이력에 남는다.
- 전체 typecheck, format, unit/integration, web build, Worker dry-run과 관련 Playwright E2E가 통과한다.

## 14. 범위 밖

- 조직 담당자의 조직 정보 수정
- 조직 담당자의 다른 관리자 초대·해제
- 조직장 계정의 참여자 자동 생성
- 이메일 발송 또는 외부 인증 서비스
- 프로젝트별로 서로 다른 조직장 지정
- 조직 간 계층 구조
- 조직 또는 사용자 물리 삭제
