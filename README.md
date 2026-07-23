# event-roster

이름과 선택 날짜로 구성된 프로젝트의 사전 참가 명단과 진행 중 추가·취소·변경을 함께 관리하는 내부 운영 도구다.

## 구성

- React/Vite 정적 UI와 Hono API를 Cloudflare Worker 하나에서 same-origin으로 제공
- Cloudflare D1에 자체 영문 로그인 ID, bcrypt 비밀번호, 회전 refresh session, 프로젝트·참가자·감사 데이터 저장
- 전역 계정 역할(`OPERATOR`, `ORGANIZATION_MANAGER`)과 조직별 배정 역할(`PRIMARY_LEADER`, `MANAGER`)을 분리하고 현재 D1 배정을 인가 기준으로 사용
- 브라우저에서만 Excel 원본을 읽고 정규화 JSON을 서버에 전달
- Workers Free + D1 Free 범위의 저빈도 내부 사용을 목표로 하며 FastAPI, VM, Pages, Access, 외부 인증 서비스는 사용하지 않음

## 역할과 권한

- `OPERATOR`는 조직·계정·프로젝트를 관리하고 전체 프로젝트 명단을 운영한다.
- `ORGANIZATION_MANAGER`는 전역 인증 역할이다. 실제 범위는 `user_organizations`의 현재 활성 조직 배정으로 정한다.
- 조직별 `PRIMARY_LEADER`는 활성 조직당 최대 한 명이고 `MANAGER`는 여러 명일 수 있다. 두 배정 역할의 명단 권한은 동일하다.
- 조직 담당자는 담당 조직이 활성이고 프로젝트 연결이 활성인 `PRE_REGISTRATION` 프로젝트의 명단만 변경한다. `IN_PROGRESS`부터는 읽기 전용이다.
- 계정 발급·조직 배정은 참가자나 프로젝트 명단 행을 자동 생성하지 않는다.

자세한 런타임·데이터 경계는 [아키텍처](docs/architecture.md), HTTP 경로와 권한은 [API 안내](docs/api.md)를 참고한다.

## 로컬 검증

Node 22와 pnpm 10.28.1을 사용한다.

```bash
corepack pnpm@10.28.1 install --frozen-lockfile
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

격리된 HTTPS localhost와 로컬 D1 E2E:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web exec playwright install chromium
corepack pnpm@10.28.1 --filter @event-roster/web run e2e
```

E2E는 Git에서 제외된 `apps/worker/.dev.vars`, `apps/worker/.wrangler/e2e-state`, `apps/web/e2e/.local-e2e-env.json`, `apps/web/dist`, `apps/web/test-results`만 생성한다. 실행할 때마다 로컬 D1과 fixture 상태를 재생성하고 원격 Cloudflare 자원을 사용하지 않는다. 생성된 강한 비밀번호는 `.local-e2e-env.json`에만 mode 0600으로 저장하며 출력하지 않는다.
프로젝트 E2E는 `/projects`의 로그인·상세 4개 탭·참가 명단, 운영자의 조직장 발급과 조직 담당자의 사전 등록 명단 입력·진행 중 읽기 전용 전환, 130행 Excel 가져오기와 2-sheet 내보내기, 로컬 scheduled 자동 종료를 검증한다.

## 운영

- [배포 절차](docs/operations/deployment.md)
- [계정·데이터 복구](docs/operations/recovery.md)
- [월간 점검](docs/operations/monthly-check.md)
- [API 안내](docs/api.md)
- [아키텍처](docs/architecture.md)

실제 Worker/D1/Secret 생성과 배포는 배포 절차에 따른 별도 사용자 승인 후에만 수행한다.
