# CI Deployment Credentials and Stability Design

## Goal

`main` push에서 별도의 `CI`와 `Deploy production` 워크플로가 모두
안정적으로 성공하도록 한다. 운영 Cloudflare 자격 증명은 Git 기록과 로그에
남기지 않으며, 배포에 필요한 최소 범위로만 GitHub Actions에 전달한다.

## Current failures

### CI

`apps/web/src/features/admin/admin.test.tsx`의
`searches and filters organization summaries` 테스트는 검색 필드가 나타난
직후 조직 카드도 동기적으로 존재한다고 가정한다. GitHub Runner에서는 검색
필드가 먼저 렌더링되고 조직 요청은 아직 스켈레톤 상태일 수 있어
`getByRole("link", { name: "1팀 상세 관리" })`가 간헐적으로 실패한다.

### Production deployment

`.github/workflows/deploy-production.yml`은 `production` Environment에서
`CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`를 읽지만 현재 두 값이
등록되어 있지 않다. 검증, 빌드, E2E, Worker dry-run은 성공하고 비대화형
실제 배포 단계만 인증 오류로 실패한다.

운영 Worker는 로컬 Wrangler OAuth 세션으로 별도 배포되어 현재 정상
동작하지만, 자동 배포 경로는 복구되지 않은 상태다.

## Approved design

### Stable organization test

조직 검색 테스트는 조직 목록의 실제 준비 조건인
`1팀 상세 관리` 링크를 `findByRole`로 기다린다. 이후 두 조직 카드에 대한
scoped assertion과 필터 요청 assertion은 그대로 유지한다.

프로덕션 컴포넌트 코드는 변경하지 않는다. 이번 변경은 테스트가 비동기 UI
계약을 정확히 기다리도록 만드는 것뿐이다.

### Credential boundary

- `CLOUDFLARE_API_TOKEN`은 GitHub `production` Environment Secret으로
  저장한다.
- `CLOUDFLARE_ACCOUNT_ID`는 비밀이 아니므로 GitHub `production`
  Environment Variable로 저장한다.
- workflow는 토큰을
  `secrets.CLOUDFLARE_API_TOKEN`, 계정 ID를
  `vars.CLOUDFLARE_ACCOUNT_ID`에서 읽는다.
- 토큰 값은 소스, 문서, `.env`, 셸 명령 인자, Actions 로그, 대화에 남기지
  않는다.
- 로컬 `wrangler login`의 OAuth 토큰을 GitHub에 복사하지 않는다.

Cloudflare API 토큰은 배포 대상 계정 하나로 제한하고 Worker 편집에 필요한
최소 권한만 부여한다. GitHub `production` Environment는 향후 필요하면
required reviewer를 추가할 수 있지만, 이번 복구 범위에서 승인 단계를
새로 강제하지 않는다.

### Secret registration

계정 ID Variable은 GitHub CLI로 등록할 수 있다. API 토큰은 사용자가
Cloudflare에서 생성한 뒤, 값이 화면·히스토리·대화에 노출되지 않는
GitHub UI 또는 표준 입력 방식으로 Environment Secret에 직접 등록한다.

자동화는 Secret 이름의 존재와 workflow 결과만 확인하며 Secret 값을
조회하거나 출력하지 않는다.

## Verification

1. 변경 전 조직 검색 테스트의 CI 실패 로그가 스켈레톤 상태에서 동기
   `getByRole`이 실패한 증거임을 보존한다.
2. 변경 후 Web 전체 테스트와 monorepo 전체 테스트를 실행한다.
3. TypeScript, Biome, Web build, Worker dry-run을 실행한다.
4. GitHub `production` Environment에 Variable과 Secret 이름이 존재하는지
   값 없이 확인한다.
5. `CI`와 `Deploy production`을 재실행한다.
6. 두 workflow가 대상 `main` SHA에서 성공했는지 확인한다.
7. 운영 URL의 `/api/v1/health`와 SPA HTTPS 200 응답을 확인한다.

## Non-goals

- Cloudflare Workers Builds로 배포 플랫폼을 이전하지 않는다.
- D1 schema나 migration을 변경하지 않는다.
- Worker runtime Secret과 사용자 계정 데이터를 변경하지 않는다.
- 로컬 Wrangler OAuth 자격 증명을 GitHub Actions에 재사용하지 않는다.
