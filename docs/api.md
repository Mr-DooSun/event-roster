# API 안내

브라우저와 Worker는 같은 origin을 사용하고 모든 애플리케이션 경로는 `/api/v1` 아래에 있다. 요청·응답의 정확한 런타임 계약은 `packages/contracts`가 소유한다.

## 인증과 공통 규칙

- 로그인은 access token과 회전 refresh session을 사용한다. Worker는 매 인증 요청에서 D1의 사용자 활성 상태, session version, 현재 전역 역할과 조직 배정을 다시 확인한다.
- 상태 변경 요청은 정확한 `Origin`, 인증, `X-ER-CSRF`를 요구한다.
- 동시 변경 가능한 프로젝트·명단 요청은 관찰한 revision을 보낸다. `STALE_REVISION`이나 `409` 뒤 클라이언트는 최신 상태를 다시 읽되 mutation을 자동 재실행하지 않는다.
- 임시 비밀번호는 생성/재설정 성공 응답에서 한 번만 반환하고 `Cache-Control: no-store`를 사용한다. 목록·감사·로그에는 비밀번호, hash, JWT, refresh token, CSRF, 복구 코드, 원문 IP를 넣지 않는다.

## 역할 모델

| 구분 | 값 | 권한 |
| --- | --- | --- |
| 전역 사용자 역할 | `OPERATOR` | 조직·계정·프로젝트 관리와 전체 명단 운영 |
| 전역 사용자 역할 | `ORGANIZATION_MANAGER` | 현재 조직 배정에서 파생된 프로젝트·명단 접근 |
| 조직별 배정 역할 | `PRIMARY_LEADER` | 활성 조직당 최대 한 명, 명단 권한은 `MANAGER`와 동일 |
| 조직별 배정 역할 | `MANAGER` | 한 조직에 여러 명 가능, 한 계정이 여러 조직에 배정 가능 |

조직 담당자는 활성 사용자·활성 조직·활성 프로젝트 조직 연결이 모두 충족된 담당 조직의 `PRE_REGISTRATION` 명단만 변경한다. `IN_PROGRESS`부터는 읽기 전용이다. 계정과 참가자는 별도 모델이며 계정 배정만으로 참가자나 명단이 생성되지 않는다.

## 주요 경로

### 인증

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/change-password`, `POST /auth/recover`
- `POST /bootstrap`, `POST /bootstrap/first-operator`

### 조직과 담당자

- `GET /organizations`: 운영자는 전체 검색/필터, 조직 담당자는 현재 배정 범위만 조회
- `POST /organizations`, `PATCH /organizations/:id`: 운영자 전용
- `GET /organizations/:id`, `GET /organizations/:id/audit`: 운영자 전용 상세·감사
- `GET /organizations/:id/assignable-users`: 운영자 전용 배정 후보 검색
- `POST /organizations/:id/managers`: 기존 계정 배정 또는 새 담당자 계정 발급
- `PATCH /organizations/:id/primary`: 관찰한 대표 ID를 포함한 대표 지정·교체·해제
- `DELETE /organizations/:id/managers/:userId`: 추가 관리자 배정 해제

`POST /organizations/:id/managers`의 `assignmentRole`은 `PRIMARY_LEADER | MANAGER`다. 대표 변경은 `expectedPrimaryUserId`와 이전 대표 처리 방식 `REMOVE | MANAGER`를 요구한다.

### 프로젝트와 프로젝트 조직

- `GET /projects`, `GET /projects/:id`
- `POST /projects`, `PATCH /projects/:id`, `POST /projects/:id/transition`: 운영자 전용
- `GET /projects/:projectId/organizations`: 권한 범위의 조직 연결과 대표/관리자/명단 집계
- `POST /projects/:projectId/organizations`: 기존 조직 또는 명시적 새 조직 중 하나를 revision과 함께 연결
- `PATCH /projects/:projectId/organizations/:organizationId`: 연결 활성/비활성 변경

프로젝트 조직 mutation은 프로젝트 revision 증가와 감사 기록을 같은 guarded D1 batch에서 처리한다. 새 조직 생성과 연결도 함께 성공하거나 rollback한다.

### 참가자·명단·감사·Excel

- `GET /participants`, `PATCH /participants/:id`
- `GET|POST /projects/:projectId/roster`
- `PATCH /projects/:projectId/roster/:entryId`
- `GET /projects/:projectId/summary`, `GET /projects/:projectId/audit`
- `POST /projects/:projectId/imports/validate`, `POST /projects/:projectId/imports/commit`
- `GET /projects/:projectId/exports/roster`

운영자는 전체 범위에서 프로젝트 수명주기 규칙에 따라 작업한다. 조직 담당자는 현재 D1 배정과 프로젝트 상태를 기준으로 제한되며 assignment role 두 값 사이에 명단 권한 차이는 없다.
