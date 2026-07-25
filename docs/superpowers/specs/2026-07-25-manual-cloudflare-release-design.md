# Manual Cloudflare Release Design

## Goal

GitHub Actions는 코드 품질을 확인하는 `CI`에만 사용하고, Cloudflare Worker
배포와 원격 D1 migration은 운영자의 로컬 Wrangler 로그인 세션에서
명시적으로 실행한다.

이 서비스는 상·하반기 행사 전후에만 주로 사용하므로 지속 배포를 위한 별도
Cloudflare API Token을 유지하는 비용보다, 검증된 수동 release 절차의
단순성과 통제 가능성을 우선한다.

## Context

현재 로컬 배포는 `wrangler login`으로 생성된 OAuth 세션을 사용해 정상
동작한다. 반면 GitHub Actions Runner는 이 로컬 세션에 접근할 수 없으므로
별도의 `CLOUDFLARE_API_TOKEN`이 필요하다.

기존
`2026-07-24-ci-deployment-credentials-and-stability-design.md`는 GitHub
`production` Environment에 API Token과 Account ID를 등록해 자동 배포를
복구하도록 설계했다. 사용자는 자동 배포보다 기존 로컬 수동 배포와 명확한
운영 매뉴얼을 선택했다. 이 문서는 기존 설계의 Cloudflare 자동 배포 부분을
대체한다. 비동기 조직 목록 테스트 안정화 결정은 그대로 유지한다.

## Considered approaches

### A. CI만 유지하고 Cloudflare 작업은 로컬에서 수동 실행

선택한 방식이다.

- GitHub Actions에는 Cloudflare 자격 증명이 필요 없다.
- 운영자가 배포 시점과 D1 migration 실행 여부를 직접 통제한다.
- 기존 `wrangler login` 인증을 그대로 사용한다.
- 저빈도 서비스에 맞는 가장 작은 운영 구조다.

단점은 배포가 특정 로컬 환경과 운영자의 명시적 실행에 의존한다는 것이다.
이를 보완하기 위해 저장소 문서에 사전 검증, 백업, migration, deploy,
smoke, 복구 중단 조건을 순서대로 유지한다.

### B. `workflow_dispatch`로만 실행되는 GitHub Actions 배포

자동 push 배포는 막을 수 있지만 GitHub Runner 인증에는 여전히
Cloudflare API Token이 필요하다. 토큰을 만들지 않겠다는 목적을 충족하지
못하므로 선택하지 않는다.

### C. Cloudflare Workers Builds 사용

Cloudflare가 build 인증을 관리할 수 있지만 새 배포 체계와 Git 연동을
추가해야 한다. 연간 사용 빈도와 현재 프로젝트 규모에 비해 과도하므로
선택하지 않는다.

## Approved architecture

### GitHub Actions boundary

- `.github/workflows/ci.yml`만 유지한다.
- `main` push와 pull request는 테스트, 타입 검사, lint/build 등 현재 CI
  검증만 수행한다.
- `.github/workflows/deploy-production.yml`을 제거한다.
- `.github/workflows/migrate-production.yml`을 제거한다.
- GitHub Actions에서 `wrangler deploy`와 원격 D1 명령을 실행하지 않는다.
- 저장소 workflow는 `CLOUDFLARE_API_TOKEN` 또는
  `CLOUDFLARE_ACCOUNT_ID`를 참조하지 않는다.

### Local release boundary

운영 release는 저장소 루트에서 다음 순서를 따른다.

1. `wrangler whoami`로 대상 Cloudflare 계정을 확인한다.
2. 전체 테스트, 타입 검사, formatting 검사와 Web build를 통과시킨다.
3. Worker `wrangler deploy --dry-run`을 통과시킨다.
4. pending D1 migration이 있으면 저장소 밖에 원격 D1 export와 체크섬을
   만든다.
5. 백업 검증 후에만 원격 migration을 적용하고 foreign key 및 조직 배정
   검사를 수행한다.
6. Web build 후 Worker를 배포한다.
7. 운영 health endpoint, SPA 응답과 저빈도 smoke를 확인한다.
8. 배포 커밋 SHA, 실행 시각, URL과 결과를 운영 기록에 남긴다.

기존 `docs/operations/deployment.md`의 초기 생성·Secret 등록·bootstrap
절차는 신규 환경 구축용으로 보존한다. 반복 release를 위한 짧은 체크리스트를
별도 섹션으로 추가하고 GitHub Actions 배포 설정 섹션은 제거한다.

### Credential handling

- 로컬 Wrangler OAuth 자격 증명을 GitHub에 복사하지 않는다.
- GitHub용 Cloudflare API Token은 생성하거나 등록하지 않는다.
- 이미 등록된 GitHub `production/CLOUDFLARE_ACCOUNT_ID` Environment
  Variable은 더 이상 사용하지 않으므로 제거한다.
- GitHub `production` Environment 자체는 비밀값을 포함하지 않는다면
  남겨도 동작에 영향이 없다. Environment 삭제는 이번 범위에 포함하지
  않는다.
- Worker runtime Secret은 기존처럼 `wrangler secret put` 또는 저장소의
  대화형 helper로만 관리한다. 이는 배포용 API Token과 별개다.

## Failure handling

- 로컬 검증, dry-run, 백업, migration 검증 중 하나라도 실패하면 이후
  단계로 진행하지 않는다.
- migration 적용 전 백업 파일과 체크섬을 검증하지 못하면 migration과
  deploy를 모두 중단한다.
- migration 이후 데이터 무결성 검사가 실패하면 새 Worker를 배포하지 않고
  `docs/operations/recovery.md`의 격리 복구 절차를 따른다.
- deploy 이후 health 또는 SPA 확인이 실패하면 성공으로 기록하지 않고
  Wrangler 배포 이력과 Worker 로그를 확인한다.
- 수동 release 명령은 Secret 값을 명령 인자, Git, 로그 또는 문서에
  기록하지 않는다.

## Verification

1. `.github/workflows`에 `ci.yml`만 남았는지 확인한다.
2. 추적 파일 전체에서 `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `Deploy production` 자동 배포 참조가
   남지 않았는지 확인한다. 과거 설계·계획 문서는 역사 기록이므로
   superseded 표시와 함께 예외로 둔다.
3. 비동기 조직 목록 회귀 테스트, Web 전체 테스트와 monorepo 전체 테스트를
   실행한다.
4. TypeScript 검사, Biome, Web build, Worker dry-run과
   `git diff --check`를 실행한다.
5. `main` push 후 최신 `CI`가 해당 SHA에서 성공하는지 확인한다.
6. 실제 release가 필요할 때만 로컬 수동 절차를 실행하고 운영 URL을 smoke
   확인한다. 문서 변경만으로 불필요한 운영 재배포를 수행하지 않는다.

## Non-goals

- 애플리케이션 기능, D1 schema, migration 파일과 Worker runtime Secret을
  변경하지 않는다.
- Cloudflare Workers Builds를 도입하지 않는다.
- GitHub Actions에서 수동 또는 자동 운영 배포 경로를 남기지 않는다.
- 배포 실패를 자동 rollback하는 새 시스템을 만들지 않는다.
- GitHub `production` Environment 자체를 삭제하지 않는다.
