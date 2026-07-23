# 아키텍처

## 런타임 경계

React/Vite 정적 자산과 Hono API를 Cloudflare Worker 하나가 동일 origin으로 제공한다. 브라우저는 `/api/v1/*`만 호출하고, Worker는 D1에 인증·권한·프로젝트·참가자·명단·감사를 저장한다. Excel 원본은 브라우저에서만 읽고 서버에는 정규화한 행만 전달한다.

모노레포의 책임은 다음과 같다.

- `apps/web`: 역할별 화면, 접근 가능한 조직 검색/선택, revision 충돌 후 명시적 재선택
- `apps/worker`: HTTP 변환, 현재 D1 상태 기반 인가, guarded mutation, scheduled 자동 종료
- `packages/contracts`: Zod 입력 계약과 공유 TypeScript 응답 타입
- `packages/domain`: 프로젝트 수명주기와 순수 도메인 규칙

## 역할과 권위 데이터

`users.role`은 전역 인증 역할 `OPERATOR | ORGANIZATION_MANAGER`만 저장한다. 조직 안의 책임은 `user_organizations.assignment_role`의 `PRIMARY_LEADER | MANAGER`로 별도 저장한다.

- 활성 조직마다 `PRIMARY_LEADER`는 partial unique index로 최대 한 명이다.
- `MANAGER`는 여러 명일 수 있고 한 사용자가 여러 조직에 서로 다른 역할로 배정될 수 있다.
- 대표와 추가 관리자의 명단 권한은 동일하다. 대표 명칭은 운영 책임 표시에만 사용한다.
- Worker는 JWT의 역할/조직 claim을 권위 데이터로 사용하지 않는다. 인증 요청마다 활성 사용자와 현재 `user_organizations`를 D1에서 다시 읽는다.
- 조직 배정 변경은 대상 세션을 폐기해 다음 요청부터 새 범위를 적용한다.

## 프로젝트와 명단

`projects`는 `PREPARING → PRE_REGISTRATION → IN_PROGRESS → CLOSED` 상태와 revision을 가진다. `project_organizations`는 전역 조직과 프로젝트의 연결을 보존한다.

- 조직 담당자 mutation은 활성 사용자, 활성 조직, 현재 배정, 활성 프로젝트 연결, `PRE_REGISTRATION`을 모두 요구한다.
- 운영자는 전체 프로젝트를 관리하며 기존 이력 정정은 프로젝트 조직이나 조직 마스터가 비활성화된 뒤에도 보존한다.
- 계정(`users`)과 참가자(`participants`)는 별도다. 담당자 발급·배정은 참가자나 `project_roster_entries`를 만들지 않는다.
- 명단 행은 당시 이름·조직 snapshot을 보존하고 현재 참가자 마스터 변경이 과거 프로젝트를 다시 쓰지 않게 한다.

## 원자성, 동시성, 감사

Worker mutation은 `operation_guards`를 사용하는 guarded D1 batch로 현재 세션·역할·revision·관찰 상태를 다시 확인한다.

- 프로젝트 조직 생성/연결/비활성화는 프로젝트 revision 증가와 감사를 같은 batch에 넣는다.
- 대표 교체는 관찰한 대표와 요청 target을 검증한 뒤 이전 대표 처리, 새 대표 지정, 세션 폐기, 감사를 한 batch로 수행한다.
- stale 또는 canonical-name 경합은 `409`로 반환한다. 클라이언트는 최신 데이터를 다시 읽지만 mutation을 자동 replay하지 않는다.
- 감사 로그는 append-only이며 credential/IP 계열 detail을 제거한다. 프로젝트와 조직 감사는 `(occurred_at DESC, id DESC)` cursor pagination을 사용한다.

## D1 migration `0003`

`0003_organization_leadership.sql`은 기존 `user_organizations` 행을 모두 `MANAGER`로 보존하면서 `assignment_role`, `assigned_by`, `assigned_at`을 추가하고 조직별 대표 unique index를 만든다. 적용 전 원격 export를 확보하고, 적용 후 foreign key와 대표 중복을 확인한다. 자세한 순서는 [배포 절차](operations/deployment.md), 격리 복원은 [복구 절차](operations/recovery.md)를 따른다.
