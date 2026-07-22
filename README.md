# event-roster

상·하반기 프로젝트의 사전 참가 명단과 진행 중 추가·취소·변경을 함께 관리하는 내부 운영 도구다.

## 구성

- React/Vite 정적 UI와 Hono API를 Cloudflare Worker 하나에서 same-origin으로 제공
- Cloudflare D1에 자체 영문 로그인 ID, bcrypt 비밀번호, 회전 refresh session, 프로젝트·참가자·감사 데이터 저장
- 브라우저에서만 Excel 원본을 읽고 정규화 JSON을 서버에 전달
- Workers Free + D1 Free 범위의 저빈도 내부 사용을 목표로 하며 FastAPI, VM, Pages, Access, 외부 인증 서비스는 사용하지 않음

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

E2E는 Git에서 제외된 `apps/worker/.dev.vars`, `apps/worker/.wrangler/e2e-state`, `apps/web/e2e/.local-e2e-env.json`, `apps/web/dist`, `apps/web/test-results`만 생성한다. 실행할 때마다 로컬 D1과 fixture 상태를 재생성하고 원격 Cloudflare 자원을 사용하지 않는다.
프로젝트 E2E는 `/projects`의 로그인·상세 4개 탭·참가 명단, 130행 Excel 가져오기와 2-sheet 내보내기, 로컬 scheduled 자동 종료를 검증한다.

## 운영

- [배포 절차](docs/operations/deployment.md)
- [계정·데이터 복구](docs/operations/recovery.md)
- [월간 점검](docs/operations/monthly-check.md)

실제 Worker/D1/Secret 생성과 배포는 배포 절차에 따른 별도 사용자 승인 후에만 수행한다.
