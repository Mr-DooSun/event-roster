# Cloudflare 운영 배포·관리 설계

## 목표

`event-roster`의 단일 운영 환경을 Cloudflare Workers Free와 D1으로 구성한다.
GitHub `main` 브랜치에 push된 코드는 검증 성공 후 자동 배포하고, 데이터
마이그레이션은 운영 데이터 보호를 위해 수동 승인 워크플로로 분리한다.

행사는 반기 단위로 저빈도 운영하지만, 행사 준비 기간에는 `main`을 운영
배포 기준으로 사용한다. 별도 staging 환경은 만들지 않는다.

## 비용 원칙

- 저장소 `Mr-DooSun/event-roster`는 공개 저장소다.
- 공개 저장소에서 표준 GitHub-hosted runner를 사용하는 GitHub Actions는
  무료다.
- larger runner, 유료 Actions, 장기 artifact 보관은 사용하지 않는다.
- Actions artifact는 기본적으로 만들지 않는다.
- Cloudflare Workers Free와 D1 Free 한도 안에서 운영한다.
- GitHub와 Cloudflare의 무료 사용량 알림을 활성화하고 유료 사용 예산은
  0으로 유지한다.

## 운영 자원

- Cloudflare 계정:
  `Shread.gpt.2001@gmail.com's Account`
- Cloudflare Account ID:
  `dadc085d94e111ad3effd04a57b33cb9`
- Worker:
  `event-roster`
- 운영 URL:
  첫 배포가 출력한 정확한 `https://...workers.dev` origin
- D1:
  새 `event-roster` 데이터베이스
- 기존 `event-roster-capability` D1:
  초기 연결 범위에서는 유지하며 운영 binding으로 사용하지 않는다.
- GitHub 저장소:
  `Mr-DooSun/event-roster`
- 운영 브랜치:
  `main`

## 배포 구조

### 코드 자동 배포

`.github/workflows/deploy-production.yml`은 `main` push와 수동 실행을
지원한다.

1. `actions/checkout`
2. Node 22와 Corepack/pnpm 10.28.1 준비
3. frozen lockfile 설치
4. format, typecheck, 전체 test
5. Web production build
6. Worker dry-run
7. 실제 Worker deploy

한 브랜치의 여러 push가 겹치면 이전 실행은 취소하고 최신 커밋 하나만
배포한다. job에는 최소 권한과 timeout을 설정한다. Cloudflare 배포 단계는
검증 단계가 모두 성공한 경우에만 실행한다.

### D1 수동 마이그레이션

`.github/workflows/migrate-production.yml`은 `workflow_dispatch`만 지원한다.
실행자는 정확한 대상 이름 `event-roster`와 현재 `main` commit SHA를
입력해야 한다.

운영 D1 전체 export는 민감 데이터가 포함되므로 GitHub Actions artifact에
올리지 않는다. 마이그레이션은 다음 두 경우로 나눈다.

- 최초 빈 D1: pending migration 확인 후 전체 migration 적용
- 기존 데이터 D1: 로컬의 보안 백업 절차로 원격 export와 체크섬을 먼저
  확보한 뒤 수동 workflow 실행

workflow는 migration 적용 후 `PRAGMA foreign_key_check`, 역할별 조직 배정
수, 조직별 대표 중복 여부를 검사한다. 실패하면 Worker 배포를 자동 재시도하지
않고 복구 절차로 전환한다.

## 인증과 Secret

GitHub Actions에는 Cloudflare API token과 Account ID만 저장한다.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

API token은 이 계정의 Workers Scripts 편집과 D1 편집에 필요한 최소
권한으로 별도 발급한다. 현재 로컬 Wrangler OAuth token은 GitHub에 복사하지
않는다.

애플리케이션 Secret은 Cloudflare Worker Secret으로만 저장한다.

- `JWT_SIGNING_KEY`
- `DUMMY_BCRYPT_HASH`
- `IP_HASH_KEY`
- `RECOVERY_CODE_PEPPER`
- `BOOTSTRAP_TOKEN` — 최초 운영자 인계 완료 후 삭제

Secret 값은 Git, Actions 변수, 로그, artifact에 기록하지 않는다.

## 최초 연결 순서

1. 새 `event-roster` D1 생성
2. 실제 D1 UUID를 `wrangler.jsonc` binding에 반영
3. `APP_ORIGIN`을 최종 `workers.dev` origin으로 설정
4. 운영 migration 적용 및 무결성 확인
5. Worker Secret 5개 등록
6. 첫 수동 배포
7. 일회성 bootstrap으로 초기 운영자 생성
8. 초기 운영자의 비밀번호 변경과 재로그인 확인
9. `BOOTSTRAP_TOKEN` 삭제
10. GitHub Actions용 최소 권한 Cloudflare API token 등록
11. 자동 배포 workflow를 main에 반영
12. workflow 수동 실행으로 배포 검증

초기 운영자 로그인 ID, 표시 이름, 비밀번호는 bootstrap 실행 시 사용자가
대화형으로 입력한다. Codex나 Actions 로그에 값을 출력하지 않는다.

## 운영 데이터와 실패 처리

- D1은 운영 데이터의 유일한 권위 저장소다.
- 코드 배포는 D1 migration을 자동 실행하지 않는다.
- migration이 필요한 코드 변경은 migration을 먼저 적용하고 호환 가능한
  Worker를 배포한다.
- 배포 실패 시 Cloudflare의 이전 Worker version으로 rollback한다.
- migration 실패 시 binding을 바꾸거나 Worker를 재배포하지 않는다.
- 데이터 복구는 `docs/operations/recovery.md`의 격리 D1 복원 절차를 따른다.
- 실제 행사가 없는 기간에도 월 1회 로그인, backup 복원 가능성, Cloudflare
  사용량과 오류를 확인한다.

## GitHub Actions 과금 방지

- `ubuntu-latest` 표준 runner만 사용한다.
- public repository 상태를 유지한다.
- workflow timeout을 설정한다.
- 동일 branch concurrency로 중복 실행을 취소한다.
- artifact와 cache는 꼭 필요한 경우에만 짧게 사용한다.
- larger runner와 macOS/Windows runner는 사용하지 않는다.
- GitHub Billing의 Actions 사용량 알림과 budget을 확인한다.

공개 저장소의 표준 GitHub-hosted runner 사용은 무료다. 저장소를 private으로
전환하면 GitHub Free의 월 2,000분 포함량 기준으로 바뀌므로 전환 전에
workflow 비용을 다시 검토한다.

## 완료 기준

- `event-roster` D1과 Worker가 같은 Cloudflare 계정에 존재한다.
- 첫 배포가 출력한 정확한 `workers.dev` URL에서 HTTPS로 접근된다.
- 운영자 bootstrap, 비밀번호 변경, 재로그인이 성공한다.
- `main` push가 검증 후 Worker를 자동 배포한다.
- D1 migration은 수동 workflow에서만 실행된다.
- 조직 관리와 조직 담당자 사전 명단 흐름의 운영 smoke가 성공한다.
- GitHub Actions와 Cloudflare에서 유료 자원이나 초과 과금 설정이 없다.
- 배포·migration·복구 절차가 운영 문서와 일치한다.
