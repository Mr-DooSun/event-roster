# 조직 안전 영구 삭제 설계

## 배경

현재 조직은 전역 마스터로 관리하며 `사용 중지`와 `다시 사용`만 지원한다.
사용 중지는 과거 프로젝트, 참가자, 담당자, 명단 및 감사 이력을 보존해야 하는
일반적인 운영 종료 수단이다.

반면 잘못 만들었고 한 번도 사용하지 않은 빈 조직까지 계속 보관할 필요는 없다.
운영자는 이런 조직만 안전하게 영구 삭제할 수 있어야 한다. 영구 삭제를 일상적인
상태 변경과 구분하고, 화면의 오래된 판단이나 동시 변경 때문에 참조 데이터가
손상되지 않도록 서버와 데이터베이스가 삭제 조건을 최종 통제한다.

## 목표

- 사용 중지된 완전히 빈 조직만 영구 삭제한다.
- 삭제 전에 조직 이름을 정확히 입력하게 해 오작동을 방지한다.
- 삭제 가능 여부와 구체적인 차단 사유를 조직 상세 화면에서 확인한다.
- 삭제 조건을 서버의 원자적 작업 안에서 다시 검사한다.
- 삭제 사실은 append-only 감사 로그로 보존한다.
- 삭제된 이름은 새 조직 ID로 다시 사용할 수 있다.

## 범위 제외

- 사용 이력이 있는 조직의 강제 삭제
- 관련 프로젝트, 참가자, 담당자 또는 명단의 연쇄 삭제
- 삭제 예약, 유예 기간, 휴지통 및 삭제 복구
- 삭제된 조직을 조회하는 별도 보관함 UI
- 감사 로그의 삭제 또는 변경
- 프로젝트 안에서의 조직 연결 해제 정책 변경

## 핵심 정책

### 사용 중지와 영구 삭제의 역할

`사용 중지`는 사용 이력이 있는 조직을 보존하는 기본 운영 기능이다. 영구
삭제는 잘못 생성한 빈 조직을 정리하는 예외 기능이다.

영구 삭제는 다음 조건을 모두 만족할 때만 가능하다.

1. `organizations.is_active = 0`
2. `user_organizations`의 해당 조직 배정이 0건
3. `participants`의 해당 조직 참가자가 0명
4. `project_organizations`의 해당 조직 연결이 0건
5. `project_roster_entries`의 해당 조직 명단이 0건
6. `project_expected_snapshots`의 해당 조직 예상 기록이 0건

활성 여부, 프로젝트 상태 및 프로젝트 연결 활성 여부와 관계없이 전체 이력을
센다. 종료 프로젝트나 비활성 프로젝트 연결도 한 건이라도 있으면 삭제할 수
없다.

`audit_logs`는 삭제 차단 조건이 아니다. 조직 생성만 해도 감사 로그가 생기므로
이를 차단 조건에 포함하면 어떤 조직도 삭제할 수 없다. 기존 감사 로그와 새
삭제 감사 로그는 조직 행이 사라진 뒤에도 append-only 기록으로 유지한다.

### 이름 재사용

삭제가 성공하면 기존 `canonical_name` 유일성 점유가 해제된다. 같은 이름을
나중에 만들 수 있지만 항상 새로운 조직 ID를 발급한다. 감사 로그는 조직 ID를
기준으로 기존 조직과 새 조직을 구분한다.

## 계약

### 삭제 가능 상태

조직 상세 계약에 다음 값을 추가한다.

```ts
export interface OrganizationDeletionBlockers {
  managerAssignments: number;
  participants: number;
  projectLinks: number;
  rosterEntries: number;
  expectedSnapshots: number;
}

export interface OrganizationDeletionEligibility {
  canDelete: boolean;
  blockers: OrganizationDeletionBlockers;
}

export interface OrganizationDetail extends OrganizationSummary {
  managers: OrganizationManager[];
  projects: OrganizationProject[];
  deletionEligibility: OrganizationDeletionEligibility;
}
```

`canDelete`는 조직이 사용 중지 상태이고 모든 blocker가 0일 때만 `true`다.
활성 조직도 상세 응답에 정확한 blocker 개수를 포함하지만 UI는 활성 상태에서
위험 구역을 표시하지 않는다.

### 삭제 요청

```ts
export const OrganizationDeleteRequestSchema = z
  .object({
    confirmationName: z.string().min(1).max(100),
  })
  .strict();
```

`confirmationName`에는 `.trim()`이나 대소문자·Unicode 정규화를 적용하지 않는다.
저장된 현재 `organizations.name`과 코드 포인트 기준으로 정확히 같아야 한다.
화면 역시 사용자가 입력한 값을 그대로 전송한다.

```http
DELETE /api/v1/organizations/:id
Content-Type: application/json
X-ER-CSRF: ...

{"confirmationName":"황룡사"}
```

성공 응답은 `204 No Content`다.

## 권한과 보안

삭제 API는 기존 조직 변경 API와 동일하게 다음을 모두 요구한다.

- 정확한 `Origin`
- 유효한 full session
- 유효한 CSRF token
- administrative operator 권한

조직 담당자는 API와 화면 모두에서 영구 삭제 기능을 사용할 수 없다. 확인 이름은
권한 검사를 대체하지 않으며 추가적인 오작동 방지 수단일 뿐이다.

## 서버 데이터 흐름

### 상세 조회

조직 상세 조회는 기존 조직·담당자·프로젝트 정보와 함께 다섯 blocker를 집계한다.
각 집계는 해당 조직 ID에 대한 전체 행 수이며 활성 행만 필터링하지 않는다.

목록 화면에는 이 집계를 추가하지 않는다. 삭제 판단이 필요한 조직 상세에서만
계산해 목록 조회 비용을 늘리지 않는다.

### 삭제

서비스는 다음 순서로 처리한다.

1. 현재 조직을 조회한다. 없으면 `404 NOT_FOUND`다.
2. 현재 조직 이름과 요청의 `confirmationName`이 다르면 `409 CONFLICT`다.
3. `runGuardedAtomic`의 guard에서 다음을 한 번 더 확인한다.
   - 동일 ID, 동일 이름, `is_active = 0`
   - 다섯 참조 테이블이 모두 `NOT EXISTS`
4. 같은 원자 작업에서 `ORGANIZATION_DELETED` 감사 로그를 삽입한다.
5. 같은 원자 작업에서 해당 `organizations` 행을 삭제한다.
6. guard 또는 FK 제약이 실패하면 조직을 삭제하지 않고 `409 CONFLICT`를
   반환한다.

화면에서 삭제 가능 상태를 본 뒤 담당자, 참가자 또는 프로젝트 연결이 추가되는
경쟁 상태가 생겨도 guard와 삭제가 같은 D1 원자 작업에 있으므로 부분 성공하지
않는다. 기존 모든 `ON DELETE RESTRICT` 제약은 마지막 방어선으로 유지한다.

guard 실패 후 서버는 최신 조직 상태와 blocker를 다시 읽어 로그에는 내부 제약
오류를 노출하지 않고 안전한 충돌 응답을 반환한다. 요청 도중 이미 다른 요청이
삭제했다면 `404 NOT_FOUND`로 정리한다.

### 감사 로그

삭제 감사 로그는 다음 의미를 갖는다.

```json
{
  "action": "ORGANIZATION_DELETED",
  "entityType": "ORGANIZATION",
  "entityId": "<deleted organization id>",
  "details": {
    "before": {
      "name": "황룡사",
      "isActive": false
    },
    "after": {
      "name": null,
      "isActive": null
    },
    "deletionEligibility": {
      "managerAssignments": 0,
      "participants": 0,
      "projectLinks": 0,
      "rosterEntries": 0,
      "expectedSnapshots": 0
    }
  }
}
```

`actor_user_id`와 `occurred_at`은 기존 감사 형식을 따른다. 감사 삽입이 실패하면
조직 삭제도 롤백한다. 삭제된 조직의 상세 화면은 존재하지 않으므로 이번 범위에서
감사 로그용 별도 UI는 추가하지 않는다. 로그는 운영 D1과 백업에서 계속 보존한다.

## 오류 처리

| 상황 | HTTP / 문제 코드 | UI 동작 |
| --- | --- | --- |
| 조직 없음 또는 이미 삭제됨 | `404 NOT_FOUND` | 조직 목록으로 이동하고 이미 삭제됐거나 찾을 수 없다고 안내 |
| 현재 이름 불일치 | `409 CONFLICT` | 모달 유지, 상세 재조회, 이름이 변경됐다고 안내 |
| 조직이 다시 활성화됨 | `409 CONFLICT` | 상세 재조회 후 위험 구역 제거 |
| 참조 데이터가 생김 | `409 CONFLICT` | 모달 유지, 최신 blocker 표시 |
| CSRF·세션·권한 실패 | 기존 인증 문제 응답 | 기존 공통 처리 사용 |
| 제약 또는 원자 작업 실패 | 안전한 공통 문제 응답 | 삭제 실패 안내, 입력 및 상세 화면 유지 |

409 응답만으로 브라우저가 blocker 수를 신뢰하지 않는다. 충돌 후
`GET /organizations/:id`를 다시 호출해 최신 `deletionEligibility`를 표시한다.

## UI 설계

### 위험 구역

활성 조직에는 위험 구역을 표시하지 않는다. 운영자는 먼저 기존
`조직 사용 중지` 흐름을 완료해야 한다.

사용 중지 조직 상세 맨 아래, 변경 이력 다음에 별도의 위험 구역 카드를 둔다.
일반 정보 카드와 시각적으로 분리하고 danger 색상은 제목, 경계선 및 최종 동작에
제한해 본문 가독성을 유지한다.

삭제 가능한 경우:

- `이 조직은 연결된 데이터가 없어 영구 삭제할 수 있습니다.`
- danger 버튼 `조직 영구 삭제`

삭제 불가능한 경우:

- `이 조직에는 보존해야 할 연결 데이터가 있어 삭제할 수 없습니다.`
- 0보다 큰 blocker만 사람이 읽을 수 있는 항목과 개수로 표시
- 삭제 버튼 비활성화
- `사용 중지 상태로 유지하면 기존 기록은 보존됩니다.` 안내

### 확인 모달

모달에는 다음을 표시한다.

- `삭제한 조직은 복구할 수 없습니다.` 경고
- 삭제 대상 조직 이름
- `확인을 위해 조직 이름을 입력하세요.` 입력란
- 보조 `닫기` 버튼
- danger `조직 영구 삭제` 버튼

최종 버튼은 입력값이 현재 조직 이름과 정확히 일치할 때만 활성화한다. 요청 중에는
입력, 닫기, backdrop 닫기 및 중복 제출을 막고 로딩 문구를 표시한다. 실패 시
입력값과 모달을 유지한다. 조직 이름이 바뀌었다면 최신 이름을 표시하고 입력값을
초기화한다.

모달은 기존 `Dialog`의 focus trap, Escape, return focus 동작을 재사용한다.
360px 화면에서도 경고, 이름, 입력란과 두 버튼이 겹치지 않게 세로 배치한다.

### 성공

삭제 성공 시 `/organizations`로 이동하고 다음 일회성 안내를 표시한다.

```text
황룡사 조직을 영구 삭제했습니다.
```

삭제된 조직은 목록·검색·필터 결과에 나타나지 않는다.

## 테스트 전략

### 계약

- 삭제 요청은 `confirmationName` 외 필드를 거부한다.
- 확인 이름을 trim하거나 정규화하지 않는다.
- 조직 상세의 blocker와 `canDelete` 타입을 고정한다.

### DB와 서비스

- 활성 조직 삭제 거부
- 이름 불일치 삭제 거부
- 담당자 배정이 있으면 거부
- 참가자가 있으면 거부
- 활성·비활성 및 종료 프로젝트 연결이 있으면 거부
- 명단 이력이 있으면 거부
- 예상 스냅샷이 있으면 거부
- 비활성이고 모든 참조가 0인 조직만 삭제
- 삭제 성공 시 조직 행이 사라지고 `ORGANIZATION_DELETED` 감사 로그가 남음
- 감사 삽입 실패 시 조직 행도 유지
- guard 평가 직전에 참조가 추가된 경쟁 상태에서 전체 실패
- 삭제 후 같은 canonical name으로 새 조직 생성 가능
- FK `foreign_key_check` 결과가 비어 있음

### 라우트와 권한

- Origin, CSRF, full session, administrative operator 요구
- 조직 담당자 및 비관리 운영자의 삭제 거부
- 성공 `204`, 없음 `404`, stale/blocked `409`
- 실패 응답에 SQL과 내부 제약 세부 정보가 노출되지 않음

### Web

- 활성 조직에는 위험 구역이 없음
- 사용 중지 조직에는 위험 구역이 있음
- blocker가 있으면 실제 0 초과 항목과 개수를 표시하고 버튼 비활성화
- 삭제 가능한 조직만 확인 모달을 열 수 있음
- 이름이 정확히 일치하기 전 최종 버튼 비활성화
- 요청 중 중복 제출과 닫기 차단
- 409 후 모달 유지, 최신 상세 재조회 및 blocker 갱신
- 404 후 목록 이동
- 성공 후 목록 이동과 일회성 성공 안내
- 360px에서 긴 조직 이름과 버튼이 겹치지 않음

### E2E

1. 새 조직을 만든다.
2. 먼저 사용 중지한다.
3. 틀린 이름으로 최종 버튼이 활성화되지 않는지 확인한다.
4. 정확한 이름을 입력해 삭제한다.
5. 목록과 직접 상세 URL에서 조직이 사라졌는지 확인한다.
6. 같은 이름으로 새 조직을 만들 수 있는지 확인한다.
7. 프로젝트에 한 번 연결한 조직은 연결을 비활성화해도 삭제할 수 없고 차단 사유가
   표시되는지 확인한다.

## 배포와 운영

스키마 변경이 없으므로 새 D1 migration은 없다. 배포 전 전체 계약·Worker·Web
테스트, 타입 검사, 포맷 검사, 빌드, E2E 및 Worker dry-run을 실행한다.

운영 smoke test에서는 기존 조직을 삭제하지 않는다. 새 임시 조직을 생성하고
사용 중지한 뒤 이름 확인 삭제 흐름을 검증하거나, 운영 데이터 변경 승인을 받지
못한 경우 삭제 가능 상태와 모달까지만 읽기·표시 검증한다.

운영 D1 백업은 삭제 실수에 대한 즉시 복구 수단일 뿐 애플리케이션의 삭제 취소
기능이 아니다. 삭제 전 UI와 서버 안전장치를 우회해 직접 SQL로 조직을 삭제하지
않는다.
