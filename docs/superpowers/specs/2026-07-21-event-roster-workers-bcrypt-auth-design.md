# Event Roster: Cloudflare Workers bcrypt 인증 설계

- 작성일: 2026-07-21
- 상태: 사용자 승인 완료
- 대체 범위: `2026-07-20-event-roster-cloud-run-auth-design.md`와 그 구현 계획의 Cloud Run/FastAPI/Argon2id 인증 경계
- 유지 범위: 행사·조직·참가자·명단·감사·엑셀 요구사항과 단일 Worker same-origin 배포 원칙

## 1. 결정과 목표

서비스는 Google Cloud, Cloud Run, `gcloud`, Cloudflare Access, 외부 IdP 없이 Cloudflare Worker와 D1만으로 운영한다. 운영자가 발급한 영문 로그인 ID와 비밀번호를 `bcryptjs` cost 12로 Worker 안에서 처리하고, D1이 사용자·권한·세션·감사 데이터를 소유한다.

ATS 프로젝트의 `bcryptjs` cost 12 Worker 구현을 참고하되, Event Roster에는 refresh token을 가져오지 않는다. 같은 origin에서 동작하는 내부 도구의 인증 표면을 작게 유지하기 위해 8시간 절대 만료 JWT 쿠키와 D1 세션 폐기만 사용한다.

이 선택은 Workers Free에서 PBKDF2 600,000회가 거부된 사실을 부정하거나 변경하지 않는다. ADR 0001과 기존 PBKDF2 spike/evidence는 역사적 실패 기록으로 보존한다. bcrypt cost 12가 이 계정의 실제 Worker 환경에서도 충분한지는 별도의 실제 capability gate로 확인하며, 그 gate가 PASS하기 전에는 행사 기능 구현을 시작하지 않는다.

## 2. 배포 경계

```text
브라우저
  │ HTTPS, same-origin 쿠키와 CSRF 헤더
  ▼
event-roster.<account>.workers.dev
  ├── React/Vite Static Assets
  └── Hono Worker (/api/v1/*)
        └── D1: users, password_credentials, auth_sessions,
                 login_attempts, recovery_codes, security_events,
                 행사·명단·감사 데이터
```

브라우저는 `/api/v1/*`만 같은 Worker origin으로 호출한다. 별도 Pages 프로젝트, 별도 API origin, CORS, VM, Cloud Run, Secret Manager는 만들지 않는다. Worker는 `nodejs_compat` 호환성 플래그와 `bcryptjs`를 사용하지만 Node 서버나 Node crypto API에는 의존하지 않는다.

## 3. 비밀번호 자격 증명

### 알고리즘과 저장

- Worker는 `bcryptjs`의 cost factor `12`로 새 비밀번호와 임시 비밀번호를 해싱한다.
- bcrypt가 생성하는 hash 문자열에는 사용자별 salt와 cost가 포함된다. D1에는 오직 이 hash 문자열, 알고리즘 식별자 `bcrypt`, `must_change_password`, 변경 시각만 저장한다.
- `password_credentials`는 `user_id`를 기본 키로 하고 `algorithm = 'bcrypt'`, `password_hash`, `must_change_password`, `changed_at`을 가진다. hash의 cost는 항상 12인지 서버가 확인한다.
- 비밀번호 원문, salt 원문, JWT 원문, CSRF 원문, 복구 코드 원문, hash 문자열은 API DTO·감사 로그·애플리케이션 로그·브라우저 영구 저장소에 넣지 않는다.
- `DUMMY_BCRYPT_HASH`는 cost 12 bcrypt hash 형식의 Worker Secret이다. 존재하지 않거나 비활성인 로그인 ID에서도 Worker는 이 값을 대상으로 정확히 한 번 `bcrypt.compare()`를 수행한다. Secret이 없거나 cost 12가 아니면 Worker는 시작하지 않는다.

`DUMMY_BCRYPT_HASH`는 기능 비밀을 담는 데이터가 아니라 timing 방어용 hash이지만, 운영 설정과 분리하기 위해 Worker Secret으로 관리한다. 생성과 교체는 `wrangler secret put DUMMY_BCRYPT_HASH`로만 수행하며 코드·D1·문서에 값 자체를 남기지 않는다.

### 로그인과 제한

1. Worker는 `loginId`를 소문자화한 뒤 `^[a-z][a-z0-9._-]{2,31}$` 형식으로 검증한다. 이메일은 로그인 ID로 쓰지 않는다.
2. Worker는 15분 창의 로그인 실패 제한을 login ID와 HMAC 처리 IP 기준으로 확인한다. 실패 5회는 잠금 처리하며 성공하면 해당 실패 상태를 초기화한다. IP 원문은 저장하지 않는다.
3. Worker는 활성 사용자라면 저장된 bcrypt hash, 없거나 비활성인 사용자라면 `DUMMY_BCRYPT_HASH`를 선택하고 한 번 비교한다.
4. 유효한 활성 계정만 성공 처리한다. 잘못된 비밀번호·없는 ID·비활성 계정·잠긴 계정은 같은 `401 AUTHENTICATION_REQUIRED` 사용자 의미를 반환하고 쿠키를 발급하지 않는다.
5. bcrypt 오류, D1 오류, 형식 오류는 비밀번호나 hash를 포함하지 않는 일반 문제 응답으로 끝난다.

운영 규모가 작아도 bcrypt 비교는 CPU 비용이 있으므로, 로그인 제한과 capability gate를 보안·비용 제어 장치로 함께 둔다. cost를 낮춰 Worker 한도에 맞추는 것은 허용하지 않는다.

## 4. JWT, D1 세션, CSRF

정상 로그인은 HS256 JWT를 `__Host-er_session` 쿠키에만 넣는다.

- 일반 `FULL` 세션은 발급 시점부터 8시간 절대 만료다.
- 임시 비밀번호 사용자는 `MUST_CHANGE_PASSWORD` 세션을 받고 10분 안에 비밀번호를 바꿔야 한다.
- 쿠키 속성은 정확히 `Path=/; HttpOnly; Secure; SameSite=Lax`이며 `Domain`은 설정하지 않는다.
- refresh token, refresh endpoint, `localStorage`, `sessionStorage`의 인증 정보는 만들지 않는다.
- JWT claim은 `sub`, `sid`, `sv`, `kind`, `iss=event-roster`, `aud=event-roster-web`, `iat`, `exp`만 가진다.
- 매 인증 요청에서 Worker는 JWT 서명뿐 아니라 D1 `auth_sessions`의 폐기/만료, `users.session_version`, 사용자 활성 상태, 현재 역할·조직 연결을 확인한다. JWT 안의 역할이나 조직 정보만 신뢰하지 않는다.

로그아웃, 비밀번호 변경, 비밀번호 재설정, 계정 비활성화, 역할 변경, 조직 연결 변경은 D1 세션을 폐기하거나 세션 버전을 올린다. 비밀번호 변경은 현재 쿠키도 삭제하고 모든 기존 세션을 폐기하므로 새 비밀번호로 다시 로그인해야 한다.

상태 변경 요청은 정확한 `Origin`과 세션별 `X-ER-CSRF`를 요구한다. CSRF 원문은 로그인 성공의 `LoginSuccess.csrfToken` 또는 인증된 `POST /api/v1/auth/csrf`에서만 반환하고 React provider 메모리에만 둔다. 로그인 성공과 CSRF 회전 응답은 모두 `Cache-Control: no-store`다. `POST /api/v1/auth/csrf`는 정확한 `Origin`과 인증 쿠키만으로 현재 세션의 hash를 원자적으로 회전하며, 기존 CSRF header는 요구하지 않는다. D1은 SHA-256 hash만 저장한다.

## 5. 계정 인수인계와 복구

기존 계정 수명주기 결정을 유지한다.

- 빈 D1에서 `BOOTSTRAP_TOKEN`으로만 공용 bootstrap 운영자와 단회 복구 코드를 만든다.
- bootstrap 운영자는 FULL 세션과 CSRF로 첫 개별 `OPERATOR` 한 명만 만들 수 있다.
- 첫 개별 운영자가 임시 비밀번호를 성공적으로 바꾸는 같은 D1 트랜잭션에서만 bootstrap 계정과 모든 bootstrap 세션을 비활성화한다.
- 운영자가 새 사용자 또는 재설정 비밀번호를 발급하면 20자 CSPRNG 임시 비밀번호를 한 번만 보여 준다. raw 값은 닫히면 UI 메모리에서 지운다.
- 32 random byte 복구 코드는 화면에 한 번만 보이고, D1에는 `RECOVERY_CODE_PEPPER`로 HMAC한 값만 저장한다. 복구는 기존 코드 소비·교체 코드 생성·새 MUST_CHANGE 운영자 생성이 하나의 guarded D1 batch로 원자적으로 완료되어야 한다.

이 흐름에서 bcrypt hash 생성은 D1 guarded write 전에 완료한다. hash 생성이 실패하면 사용자·세션·복구 코드·감사 행을 쓰지 않는다.

## 6. D1 모델과 원자성

Cloud Run 설계의 `password_credentials.phc`와 `kdf_version`은 사용하지 않는다. 초기 migration에는 아래 bcrypt 모델을 넣는다.

| 테이블 | 인증 관련 핵심 열 |
| --- | --- |
| `users` | `login_id`, 고유 `login_id_canonical`, 표시 이름, 역할, 활성 여부, bootstrap 여부, 양수 `session_version` |
| `password_credentials` | `user_id` PK, `algorithm='bcrypt'`, `password_hash`, `must_change_password`, `changed_at` |
| `auth_sessions` | `id`, `user_id`, `session_version`, `csrf_hash`, `kind`, 발급·만료·폐기 시각 |
| `login_attempts` | action, HMAC 처리 login ID/IP 키, SUCCESS/FAILURE, 발생 시각 |
| `recovery_codes` | HMAC된 코드, 활성/사용 상태, 교체 관계 |
| `security_events` | 자격 증명 없는 보안 이벤트, append-only |

상태·revision·복구 코드·bootstrap 인수인계에 영향을 주는 모든 D1 쓰기는 `operation_guards`를 첫 batch statement로 사용한다. false guard는 도메인 오류로 변환하고 guard·도메인 쓰기·세션 폐기·감사·보안 이벤트를 함께 rollback한다. 영향 행 수 0을 성공으로 취급하지 않는다.

무료 D1의 요청당 50-query, statement당 100-bound-parameter 제약 안에서 1–130행 import를 처리한다. validate와 commit은 행별 D1 호출을 금지하고, parameter-bound `VALUES` bulk statement와 UPSERT를 chunked planner로 생성한다. planner는 worst-case 130행의 읽기·guard·participant/roster/audit bulk write·import run·revision·cleanup을 합쳐 50 query 미만, 각 statement 100 bindings 이하로 보장하며 이 예산을 자동화 테스트로 검증한다. JSON1 지원 여부에 의존하지 않는다.

## 7. 실제 bcrypt capability gate

이 gate는 Cloud Run gate와 별개이며 실제 `workers.dev` Worker에서만 PASS/FAIL을 결정한다.

1. 짧은 수명의 `event-roster-bcrypt-capability` Worker를 배포한다. Worker에는 D1·Static Assets가 없고 `DUMMY_BCRYPT_HASH`, capability probe token만 Worker Secret으로 둔다.
2. bcrypt cost 12로 hash 한 값에 대해 정상 비밀번호, 틀린 비밀번호, 존재하지 않는 사용자(dummy hash)를 각각 50회 순차 검증한다.
3. 각 시나리오는 의미상 정확해야 하며, warm P95 응답 시간은 1,500 ms 이하여야 한다.
4. 정상 비밀번호 verify 13개를 동시에 요청해 모두 8초 안에 성공해야 하고, Workers Observability에 `exceededCpu`, OOM, 5xx가 없어야 한다.
5. bcrypt hash 문자열, 비밀번호, probe token, Worker secrets는 evidence·로그·응답에 넣지 않는다. evidence에는 run ID, 시각, 상태 목록, boolean 의미, milliseconds, P95, probe URL, Observability 집계만 남긴다.
6. PASS면 factual evidence와 ADR을 커밋하고 temporary probe Worker를 삭제한다. FAIL이면 factual evidence와 ADR만 커밋하고 이후 기능 Task를 시작하지 않는다.

ATS 코드가 bcryptjs Worker 호환의 유효한 구현 참고라는 사실과 별개로, 이 서비스의 실제 Cloudflare account/plan/runtime에서의 성능·CPU 한계는 이 gate로 다시 확인해야 한다.

## 8. 테스트와 배포

테스트는 아래 순서를 따른다.

- bcrypt unit: cost 12 hash/verify, dummy hash 형식·cost 거부, 원문/해시 비노출
- Worker+D1 integration: non-enumerating login, 제한, 세션 폐기, CSRF, MUST_CHANGE, bootstrap handoff, recovery 원자성
- 도메인·D1 integration: 행사 상태, 조직 범위, roster revision, import all-or-nothing, append-only audit
- React/E2E: 로그인·임시 비밀번호·권한 경계·행사 운영·엑셀 이관/내보내기
- remote gate: 실제 bcrypt capability 및 production smoke

Cloudflare 운영 설정에는 `JWT_SIGNING_KEY`, `DUMMY_BCRYPT_HASH`, `BOOTSTRAP_TOKEN`, `IP_HASH_KEY`, `RECOVERY_CODE_PEPPER`만 Worker Secrets로 둔다. `APP_ORIGIN`과 실제 D1 ID는 커밋 가능한 non-secret Worker 설정에 둔다. 최초 production smoke 성공 뒤 `BOOTSTRAP_TOKEN`을 삭제한다.

## 9. 구현 전환과 범위 밖

새 구현 계획의 첫 작업은 다음을 수행한다.

1. 아직 원격 배포되지 않은 `apps/password-service`, `spikes/cloud-run-auth-capability`, Cloud Run ADR 0002와 Cloud Run 계획을 제거하거나 `Superseded`로 명확히 표시한다.
2. 기존 Workers PBKDF2 spike, ADR 0001, factual evidence는 변경하지 않는다.
3. bcrypt capability gate가 PASS한 뒤에만 Worker/Web/D1 MVP 구현을 시작한다.

범위 밖은 Cloud Run, Google Cloud, `gcloud`, Firebase, Supabase, Cloudflare Access, OTP, refresh token, 공개 회원가입, 이메일 기반 비밀번호 재설정, 원본 Excel 보관, 체크인, 실시간 공동 편집이다.

## 10. 완료 기준

- 실제 Worker deploy 출력으로 확정한 HTTPS same-origin URL에서 동작한다.
- 운영자가 발급한 영문 로그인 ID·bcrypt cost 12 비밀번호·JWT/D1 세션으로 로그인한다.
- 임시 비밀번호 변경, bootstrap 인수인계, 세션 즉시 폐기, 단회 복구가 원자적으로 동작한다.
- Cloud Run이나 Google Cloud 리소스 없이 행사·조직·명단·집계·감사·브라우저 Excel 기능을 제공한다.
- 실제 Workers bcrypt capability gate, 자동화 테스트, production smoke를 통과한다.
