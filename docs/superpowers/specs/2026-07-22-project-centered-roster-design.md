# Event Roster 프로젝트 중심 운영 설계

- 작성일: 2026-07-22
- 상태: 사용자 설계 승인 완료, 문서 검토 대기
- 대체 범위: 행사(`event`) 중심의 연도·상/하반기 모델과 전역 조직 관리 화면
- 유지 범위: 자체 계정/JWT 인증, 역할, 참가자 고유 ID, 사전·진행 중 명단 변경, 예상/현재 집계, 감사, 브라우저 Excel, Worker+D1 same-origin 배포

## 1. 목표와 결정

서비스의 최상위 운영 단위를 `행사`에서 범용적인 `프로젝트`로 바꾼다. 프로젝트는 이름과 생성일시만으로 만들 수 있고, 시작일과 종료일은 선택 사항이다. 연도와 상·하반기 구분은 삭제한다.

프로젝트 목록은 최소 정보 카드 그리드로 표시한다. 조직과 참가자는 서비스 전체에서 재사용 가능한 마스터로 유지하되, 프로젝트에는 필요한 조직과 참가 명단만 명시적으로 연결한다. 기존 프로젝트의 조직이나 참가 명단을 새 프로젝트에 자동 복사하지 않는다.

## 2. 프로젝트 모델과 수명주기

### 필드

프로젝트는 다음 필드를 가진다.

| 필드 | 규칙 |
| --- | --- |
| `id` | UUID, 서버 생성 |
| `name` | 필수, trim 후 1–100자 |
| `start_date` | 선택, `YYYY-MM-DD` 달력 날짜 |
| `end_date` | 선택, `YYYY-MM-DD` 달력 날짜 |
| `status` | `PREPARING`, `PRE_REGISTRATION`, `IN_PROGRESS`, `CLOSED` |
| `revision` | 0 이상의 낙관적 잠금 값 |
| `created_by` | 생성한 운영자 ID |
| `created_at` | 서버가 기록한 UTC ISO 시각, 화면에서는 한국 시간 날짜로 표시 |
| `updated_at` | 서버가 기록한 UTC ISO 시각 |
| `closed_at` | 종료 시각, 종료 전에는 `NULL` |
| `closed_by` | 수동 종료 운영자 ID, 자동 종료는 `NULL` |
| `close_reason` | 종료 전 `NULL`, 종료 후 `MANUAL` 또는 `SCHEDULED` |

시작일과 종료일은 서로 독립적으로 비워둘 수 있다. 두 값이 모두 있으면 종료일은 시작일보다 빠를 수 없다. 종료일이 있으면 자동 종료 대상이며, 종료일이 없으면 운영자가 수동으로 종료한다.

프로젝트 이름은 고유하지 않아도 된다. 같은 이름의 반복 프로젝트는 UUID와 날짜로 구분한다. 운영자는 모든 비종료 상태에서 이름과 날짜를 수정할 수 있고, 종료 프로젝트는 재개한 뒤에만 수정할 수 있다. 과거 종료일을 입력해 프로젝트를 만들거나 수정하면 다음 mutation 또는 scheduled 실행에서 종료된다.

### 상태 전환

사용자 표시 상태와 내부 값은 다음처럼 일치시킨다.

```text
준비 중(PREPARING)
  → 사전 등록(PRE_REGISTRATION)
  → 진행 중(IN_PROGRESS)
  → 종료(CLOSED)
```

앞의 세 전환은 운영자가 명시적으로 실행한다. 날짜만으로 `PRE_REGISTRATION`이나 `IN_PROGRESS`로 자동 전환하지 않는다. `PRE_REGISTRATION → IN_PROGRESS` 순간 조직별 예상 인원과 활성 사전 명단 스냅샷을 고정하는 기존 의미를 유지한다.

운영자는 `CLOSED → IN_PROGRESS`로 재개할 수 있다. 현재 한국 날짜가 종료일보다 뒤라면 먼저 종료일을 미래로 변경하거나 제거해야 재개할 수 있다. 재개하면 `closed_at`, `closed_by`, `close_reason`을 `NULL`로 되돌리고 감사 이력을 남긴다.

## 3. 자동 종료

같은 Worker에 Cloudflare Cron Trigger 하나를 `0 15 * * *`로 설정한다. Cloudflare Cron은 UTC 기준이므로 이는 한국 시간 매일 00:00 실행이다. scheduled handler는 한국 날짜 기준 `end_date < 오늘`이고 `status <> CLOSED`인 프로젝트를 원자적으로 종료한다.

Cron 실행 지연 중에도 종료된 프로젝트가 수정되지 않도록 모든 프로젝트 mutation의 guarded D1 조건에 동일한 만료 조건을 포함한다. mutation 시 이미 종료일이 지났다면 먼저 idempotent 자동 종료를 반영하고 `PROJECT_CLOSED` 문제 응답을 반환한다. 따라서 사용자 관점의 수정 차단은 종료일 당일 23:59:59 이후부터 적용된다.

자동 종료는 다음을 보장한다.

- `status=CLOSED`, `closed_at`, `close_reason=SCHEDULED`, revision 증가를 같은 guarded batch에서 기록한다.
- `actor_user_id=NULL`, action `PROJECT_AUTO_CLOSED`, entity type `PROJECT`인 감사 행을 남긴다.
- 이미 종료된 프로젝트에는 revision 증가나 중복 감사 행을 만들지 않는다.
- 한 번의 scheduled 실행은 만료 프로젝트를 `created_at` 오름차순으로 최대 50개 처리하고, 다음 실행에서 남은 프로젝트를 이어서 처리한다.
- 로컬에서는 Wrangler의 scheduled handler endpoint로 검증한다.

Workers Free는 계정당 Cron Trigger 5개를 허용하며 이 설계는 하나만 사용한다.

## 4. 조직과 프로젝트 연결

`organizations`는 전역 마스터로 유지한다. 새 `project_organizations`가 프로젝트별 조직 사용 상태를 관리한다.

```text
project_organizations
- project_id
- organization_id
- is_active
- added_at
- deactivated_at
- added_by
- updated_by
- PRIMARY KEY (project_id, organization_id)
```

프로젝트의 조직 탭에서는 다음 두 경로를 제공한다.

1. 기존 전역 조직을 이름으로 검색해 프로젝트에 추가한다.
2. 검색 결과가 없으면 새 전역 조직을 만들고 같은 요청 흐름에서 프로젝트에 연결한다.

같은 조직을 같은 프로젝트에 중복 추가하면 `CONFLICT`다. 비활성 연결을 다시 추가하면 새 행을 만들지 않고 기존 연결을 재활성화한다.

명단이 없는 프로젝트 조직은 연결 해제할 수 있다. 명단·예상 스냅샷·감사 기록 중 하나라도 있으면 행을 삭제하지 않고 `is_active=0`으로 전환한다. 비활성 조직에는 신규 참가자를 추가하거나 Excel import할 수 없지만 기존 명단의 조회·수정·취소와 과거 집계는 허용한다.

전역 조직 관리 화면과 주 메뉴 항목은 제거한다. 전역 조직 이름 수정과 전체 사용 중지는 프로젝트 조직 탭에서 운영자에게 제공하되, 이름 변경은 마스터의 현재 이름만 바꾸고 기존 명단의 조직명 스냅샷은 바꾸지 않는다.

전역 조직 이름을 바꾸기 전에는 현재 연결된 활성 프로젝트 수를 표시하고 전역 변경임을 확인받는다. 전역 사용 중지된 조직은 새 프로젝트에 추가할 수 없고, 이미 연결된 프로젝트에서는 과거 기록 조회와 기존 명단 수정·취소만 허용한다.

`ORGANIZATION_MANAGER`는 자신에게 할당된 전역 조직이 연결된 프로젝트만 볼 수 있다. 활성 연결에서는 기존 권한대로 명단을 운영할 수 있고, 비활성 연결에서는 과거 데이터만 읽을 수 있다. `OPERATOR`는 모든 프로젝트와 조직 연결을 관리한다.

## 5. 참가자 재사용과 소속 이동

`participants`는 고유 `participant_id`로 식별되는 전역 마스터다. `name`과 `organization_id`는 참가자의 현재 정보를 뜻한다.

새 프로젝트에서 동일한 `participant_id`가 다른 이름이나 조직으로 등록되면 운영자가 확인한 입력을 참가자 마스터의 최신 정보로 갱신한다. 프로젝트 명단에는 `participant_name_snapshot`과 `organization_name_snapshot`을 계속 저장하므로 과거 프로젝트의 표시·집계·Excel export는 변하지 않는다.

새 프로젝트에 기존 조직을 추가해도 그 조직의 참가자는 명단에 자동 추가되지 않는다. 참가자 추가 UI와 Excel 검증 단계에서 기존 참가자를 검색·선택할 수 있을 뿐이며, 프로젝트 명단 연결은 사용자가 명시적으로 확정해야 한다.

참가자의 새 조직은 해당 프로젝트의 활성 조직이어야 한다. 참가자 마스터 갱신과 프로젝트 명단 추가는 같은 guarded D1 batch에서 성공하거나 함께 rollback한다.

## 6. 명단, 집계, 감사, Excel

기존 `event_roster_entries`, `event_expected_snapshots`, `import_runs`의 의미를 각각 `project_roster_entries`, `project_expected_snapshots`, 프로젝트 기반 import로 옮긴다.

- 기존 `PRE_EVENT` source는 `PRE_REGISTRATION`으로, `DAY_OF` source는 `IN_PROGRESS`로 변환한다.
- 참가 상태 `ACTIVE`, `CANCELLED`와 예상/현재/증감 집계 규칙은 유지한다.
- 프로젝트 종료 후 명단·조직·import mutation은 거부한다.
- 감사 entity type `EVENT`는 `PROJECT`로 바꾸고 `EVENT_CREATED`, `EVENT_UPDATED`, `EVENT_TRANSITIONED`, `EVENT_REOPENED`는 각각 같은 suffix의 `PROJECT_*` action으로 변환한다. 명단 action은 유지한다.
- Excel 원본은 계속 브라우저에서만 읽고 서버에는 정규화 JSON만 전송한다.
- import는 프로젝트의 활성 조직만 resolve하며 1–130행 전체 성공 또는 전체 rollback을 유지한다.
- export workbook의 두 sheet 구조는 유지하되 제목과 파일명에서 행사 용어를 프로젝트로 바꾼다.

## 7. API 계약

행사 API와 사용자 경로는 호환 별칭 없이 프로젝트 용어로 교체한다. 아직 production API consumer가 없으므로 `/events` endpoint를 유지하지 않는다.

주요 endpoint는 다음과 같다.

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
POST   /api/v1/projects/:projectId/transition

GET    /api/v1/projects/:projectId/organizations
POST   /api/v1/projects/:projectId/organizations
PATCH  /api/v1/projects/:projectId/organizations/:organizationId

GET    /api/v1/projects/:projectId/roster
POST   /api/v1/projects/:projectId/roster
PATCH  /api/v1/projects/:projectId/roster/:entryId
GET    /api/v1/projects/:projectId/summary
GET    /api/v1/projects/:projectId/audit
POST   /api/v1/projects/:projectId/imports/validate
POST   /api/v1/projects/:projectId/imports/commit
GET    /api/v1/projects/:projectId/exports/roster
```

프로젝트 생성 요청은 `{ name, startDate?, endDate? }`, 수정 요청은 `{ name?, startDate?, endDate?, expectedRevision }`다. nullable 날짜를 지우기 위해 수정 요청은 `null`을 허용하고, key 누락은 기존 값 유지로 해석한다.

문제 응답에는 기존 공통 코드를 유지하되 `EVENT_CLOSED`를 `PROJECT_CLOSED`로 교체한다. 날짜 역전, 잘못된 ISO 날짜, 비활성 프로젝트 조직, 프로젝트에 연결되지 않은 조직은 `VALIDATION_FAILED`; revision 불일치는 `STALE_REVISION`; 중복 프로젝트 조직은 `CONFLICT`로 반환한다.

## 8. 화면 구조

### 프로젝트 목록

주 메뉴와 heading의 `행사`를 `프로젝트`로 바꾼다. 프로젝트 목록은 반응형 최소 정보 카드 그리드다.

각 카드에는 다음 정보만 표시한다.

- 상태 배지
- 프로젝트 이름
- 시작일: 없으면 `시작 미정`
- 종료일: 없으면 `종료 수동`
- 생성일

조직 수와 인원 집계는 목록 카드에 표시하지 않는다. 종료 프로젝트는 시각적으로 약하게 표시하지만 목록에서 숨기지 않는다. 기본 정렬은 종료되지 않은 프로젝트를 먼저 표시한다. 종료되지 않은 프로젝트는 시작일이 있는 행을 날짜 오름차순으로, 시작일이 없는 행을 그 뒤에 생성일 내림차순으로 표시한다. 종료 프로젝트는 `closed_at` 내림차순으로 표시한다.

새 프로젝트는 dialog에서 이름, 시작일, 종료일을 입력한다. 생성일은 입력받지 않는다.

### 프로젝트 상세

상세 header에는 상태, 이름, 기간, 자동/수동 종료 방식과 가능한 상태 전환 action을 표시한다. 본문은 다음 네 탭이다.

1. `개요`: 등록 조직 수, 예상 참가자, 현재 참가자, 증감
2. `조직`: 기존 조직 검색·추가, 신규 조직 생성, 활성/비활성 전환, 마스터 이름 수정
3. `참가 명단`: 조직별 필터, 추가·수정·취소, Excel import/export
4. `변경 이력`: 기존 감사 로그 pagination

기존 전역 조직 관리 화면과 route는 제거한다. 계정 관리 화면은 유지한다.

## 9. D1 마이그레이션

기존 `0001_initial.sql`은 변경하지 않고 `0002_project_model.sql`을 추가한다. 마이그레이션은 새 프로젝트 테이블을 만든 뒤 기존 행사 데이터를 복사하고 참조 테이블을 재구성한다.

상태는 다음처럼 변환한다.

```text
DRAFT            → PREPARING
PRE_REGISTRATION → PRE_REGISTRATION
DAY_OF           → IN_PROGRESS
CLOSED           → CLOSED
```

기존 `events.name`, `revision`, 생성자와 시각은 보존하고 `start_date`, `end_date`는 `NULL`로 둔다. 기존 `(year, half)` 값은 새 프로젝트 모델에 저장하지 않는다. 기존 CLOSED 행은 `closed_at=updated_at`, `close_reason=MANUAL`, `closed_by=created_by`로 이관한다.

기존 명단 또는 예상 스냅샷에서 참조된 조직은 해당 프로젝트의 활성 `project_organizations`로 생성한다. 명단이 없는 전역 조직은 마스터에 남으며 운영자가 필요한 프로젝트에 추가할 수 있다. 명단, 예상 스냅샷, import run, audit entity ID는 기존 UUID를 유지한다.

기존 roster source는 `PRE_EVENT → PRE_REGISTRATION`, `DAY_OF → IN_PROGRESS`로 변환한다. 기존 audit의 `entity_type='EVENT'`는 `PROJECT`로 바꾸고 action prefix `EVENT_`는 `PROJECT_`로 치환한다. `EVENT_CLOSED` 문제 코드는 저장 데이터가 아니므로 migration 대상이 아니다.

마이그레이션은 foreign key integrity check와 행 수 보존 검사를 통과해야 한다. fresh D1은 `0001`과 `0002`를 순서대로 적용해 동일한 최종 schema를 만든다.

## 10. 오류 처리와 동시성

- 프로젝트, 프로젝트 조직, 명단 상태 변경은 기존 revision과 `operation_guards` 패턴을 유지한다.
- 영향 행 0을 성공으로 취급하지 않는다.
- 자동 종료, 수동 전환, 프로젝트 수정이 경쟁하면 정확히 하나의 revision만 성공한다.
- 클라이언트가 `STALE_REVISION`을 받으면 최신 프로젝트를 다시 불러오고 사용자가 작업을 재검토하게 한다.
- 프로젝트가 자동 종료된 뒤 mutation하면 UI는 최신 상태를 다시 불러오고 `프로젝트가 종료되어 변경할 수 없습니다.`를 표시한다.
- 조직 재활성화는 기존 연결 행을 사용하고 중복 행을 만들지 않는다.
- 자동 종료 오류는 credential 없이 Workers Observability에 기록하며 다음 Cron 실행에서 재시도 가능하게 둔다.

## 11. 테스트 전략

테스트는 RED → 최소 구현 → GREEN 순서를 지킨다.

- 계약/도메인: 프로젝트 DTO, 날짜 검증, 상태 전환, 자동 종료 판정, source 이름
- D1 migration: 기존 행사/명단/스냅샷/감사 row 보존, 상태 매핑, foreign key integrity
- Worker integration: 프로젝트 CRUD, revision conflict, 프로젝트별 조직 추가·중지·재활성화, 권한 scope
- scheduled integration: KST 날짜 경계, idempotent 자동 종료, 수동 전환과 경쟁, 감사 actor `NULL`
- 명단/import: 비연결·비활성 조직 거부, 기존 참가자 재사용, 소속 이동, 과거 스냅샷 보존, 130행 원자성
- React: B형 카드 정보와 정렬, 프로젝트 dialog, 상세 탭, 조직 검색·신규 생성, 종료 오류 갱신
- E2E: 프로젝트 생성 → 조직 연결 → 사전 명단 → 진행 중 전환 → 변경 → Excel export, scheduled handler 수동 trigger
- 회귀: 인증, 계정 관리, refresh 회전, CSRF, bootstrap, recovery, bundle dry-run

## 12. 완료 기준

- 사용자 화면과 API에 행사 연도·상/하반기 필드가 남지 않는다.
- 프로젝트 이름과 선택 날짜만으로 프로젝트를 만들고 B형 카드 그리드에서 확인한다.
- 조직과 참가자를 여러 프로젝트에서 재사용하되 새 프로젝트 명단은 비어 있다.
- 프로젝트별 조직 연결을 추가·중지·재활성화하고 기존 기록을 보존한다.
- 참가자 소속 이동 후에도 과거 프로젝트의 이름·조직·집계가 바뀌지 않는다.
- `PRE_REGISTRATION → IN_PROGRESS`에서 예상 명단이 고정된다.
- 종료일이 있으면 KST 날짜 경계 이후 수정이 즉시 차단되고 Cron이 상태와 감사를 영속화한다.
- 종료일이 없으면 운영자가 수동 종료한다.
- 기존 D1 데이터와 Excel 기능, 인증·감사 기능이 회귀 없이 동작한다.
- 전체 typecheck, format, unit/integration, web build, Worker dry-run, Playwright E2E가 통과한다.

## 13. 범위 밖

- 프로젝트 복제와 이전 명단 자동 복사
- 프로젝트별 조직 별칭
- 프로젝트별로 서로 다른 참가자 마스터
- 시작일 기반 자동 상태 전환
- 시·분 단위 프로젝트 일정
- 조직 또는 프로젝트의 물리 삭제
- 캘린더 화면, 체크인, 실시간 공동 편집
- 외부 인증 서비스와 별도 백엔드
