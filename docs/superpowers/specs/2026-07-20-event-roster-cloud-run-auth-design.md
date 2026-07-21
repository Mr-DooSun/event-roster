# Event Roster: D1 직접 계정 관리와 Cloud Run 비밀번호 KDF 설계

**상태:** Superseded by 2026-07-21 Workers bcrypt design; no remote Cloud Run gate was run.

## 1. 목적과 대체 범위

이 문서는 행사 명단 서비스의 인증·배포 경계를 새로 정의한다. 사용자는 Firebase, Supabase, Cloudflare Access 같은 관리형 로그인 서비스를 쓰지 않고, 서비스가 발급한 영문 로그인 ID·비밀번호와 자체 JWT 세션을 사용한다.

기존 `2026-07-20-event-roster-worker-design.md` 및 `2026-07-20-event-roster-worker-mvp.md`의 **Workers Free에서 PBKDF2-HMAC-SHA-256 600,000회를 직접 실행한다**는 가정은 원격 capability gate에서 실패했다. 그 실패 증거는 [ADR 0001](../../adr/0001-workers-free-capability-gate.md)에 보존한다. 이 문서는 그 인증 부분을 대체하며, 행사·조직·참가자·당일 변동·집계·감사 이력·엑셀 이관/내보내기 요구사항은 기존 승인 설계를 그대로 유지한다.

## 2. 확정 결정

| 항목 | 결정 |
| --- | --- |
| 사용자·권한·세션 데이터 | Cloudflare D1이 직접 보관한다. |
| 로그인 식별자 | 운영자가 발급한 별도 영문 `login_id`다. 이메일을 로그인 ID로 사용하지 않는다. |
| 비밀번호 저장 | D1에는 Argon2id PHC 문자열과 KDF 버전만 저장한다. 평문, salt 원문, pepper는 저장하지 않는다. |
| 비밀번호 KDF 실행 위치 | Google Cloud Run의 FastAPI `password-service`다. 이 서비스는 hash/verify만 수행하며 D1·JWT·역할을 소유하지 않는다. |
| 세션 | Cloudflare Worker가 서명한 8시간 절대 만료 JWT를 `__Host-er_session` HttpOnly 쿠키에만 둔다. D1 `auth_sessions`가 즉시 폐기를 가능하게 한다. |
| refresh token | MVP에서는 사용하지 않는다. 장기 refresh token의 회전·재사용 탐지·탈취 대응을 추가하지 않고, 만료 뒤 재로그인한다. |
| 초기 공용 운영자 | 첫 개별 운영자가 최초 비밀번호 변경을 성공하면 영구 비활성화하고 모든 세션을 폐기한다. |
| 긴급 복구 | 256비트 단회 복구 코드를 최초 인수인계와 복구 성공 때 한 번만 표시한다. D1에는 HMAC 값만 보관한다. |
| 비용 목표 | Cloud Run request-based billing, min instances 0, max instances 1을 사용한다. 현재 규모에서는 무료 할당량 내 사용을 목표로 하나, 결제 계정과 예산 알림은 필수다. |

## 3. 시스템 경계

```text
React SPA (동일 Worker origin)
        │ HTTPS, 쿠키, CSRF 헤더
        ▼
Cloudflare Worker + Hono ─── D1
        │                     ├─ users / password_credentials
        │                     ├─ auth_sessions / login_attempts
        │                     └─ recovery_codes / security_events
        │ HTTPS + 시간 제한 HMAC 서명
        ▼
Cloud Run FastAPI password-service
        └─ Secret Manager: PASSWORD_PEPPER, AUTH_KDF_SHARED_SECRET,
           DUMMY_ARGON2_PHC
```

`password-service`는 브라우저에서 직접 호출하지 않는다. Cloud Run URL은 인프라 차원에서는 인터넷에서 도달 가능할 수 있으나, 서비스는 유효한 Worker 서명이 없는 요청을 Argon2 실행 전에 거부한다. Google Cloud IAM 호출을 위해 장기 서비스 계정 개인키를 Worker에 넣는 대신, Cloudflare Worker Secret과 Google Secret Manager에 동일하게 저장한 고엔트로피 공유 비밀로 서비스 간 요청을 인증한다.

Cloud Run은 `min-instances=0`, `max-instances=1`, `concurrency=1`, `1 vCPU`, `512 MiB`, request-based billing으로 시작한다. 낮은 동시성은 메모리-하드 KDF가 여러 요청과 경쟁하거나 비정상 요청으로 비용이 늘어나는 범위를 제한한다. 13명 규모에서 cold start는 허용 가능한 로그인 지연으로 취급하되, Worker의 내부 호출 timeout은 8초로 둔다.

## 4. 비밀번호 KDF 서비스

### 4.1 KDF 정책

`password-service`는 다음 순서로 처리한다.

1. 비밀번호를 NFC로 정규화하고 UTF-8 바이트로 변환한다.
2. Secret Manager의 `PASSWORD_PEPPER`를 키로 HMAC-SHA-256을 계산한다.
3. 그 결과를 Argon2id 입력으로 사용한다. 파라미터는 `memory_cost=19456 KiB`, `time_cost=2`, `parallelism=1`, `hash_len=32`, `salt_len=16`이다.
4. 라이브러리가 생성한 salt와 파라미터가 들어간 표준 PHC 문자열을 D1에 저장한다.

이는 새 비밀번호 저장에 Argon2id를 우선하라는 OWASP 지침의 최소 구성(19 MiB, 2회, 병렬성 1)을 따른다. pepper 교체는 해당 버전의 모든 사용자에게 비밀번호 재설정을 요구하므로, `password_credentials.kdf_version`을 보관한다.

### 4.2 내부 HTTP 계약

두 엔드포인트만 둔다.

```http
POST /internal/v1/password/hash
Content-Type: application/json

{ "password": "plain password supplied only in request memory" }

200 { "kdfVersion": 1, "phc": "$argon2id$..." }
```

```http
POST /internal/v1/password/verify
Content-Type: application/json

{ "password": "plain password supplied only in request memory", "phc": "$argon2id$..." }

200 { "verified": true }
```

`verify` 요청의 `phc`가 없거나 유효하지 않으면 서비스의 `DUMMY_ARGON2_PHC` secret을 검증한다. 따라서 Worker는 존재하지 않는 `login_id`에도 실사용자와 같은 한 번의 Argon2id 작업을 요청하고, 모두 같은 실패 응답을 반환한다.

모든 요청에는 다음 헤더가 필요하다.

```text
X-ER-KDF-Key-Id: v1
X-ER-KDF-Timestamp: <UTC epoch seconds>
X-ER-KDF-Body-SHA256: <base64url SHA-256 of exact request bytes>
X-ER-KDF-Signature: <base64url HMAC-SHA-256>
```

서명 입력은 `v1\n<timestamp>\n<HTTP method>\n<path>\n<body digest>`다. 서비스는 시계 차이가 60초를 넘거나 body digest·서명이 일치하지 않으면 `401`을 반환하며, JSON parsing·KDF를 수행하지 않는다. HTTPS가 전송 중 기밀성을 제공하고, 서명은 Cloud Run URL을 아는 제3자가 KDF endpoint를 호출하지 못하게 한다. 이 timestamp 서명은 네트워크 격리나 완전한 재전송 방지가 아니므로, Cloud Run 공개 URL과 그 위험을 운영 문서에 명시한다. KDF 서비스는 request body·Authorization 계열 헤더·비밀번호·PHC 값을 기록하지 않는 구조화 로거만 사용한다.

## 5. D1 모델과 계정 수명주기

### 5.1 사용자와 자격 증명

`users`에는 `id`, `login_id`, `login_id_canonical`, `display_name`, `role`, `is_active`, `is_bootstrap`, `session_version`, 생성·수정 시각을 둔다. `login_id_canonical`은 유일하고, 형식은 `^[a-z][a-z0-9._-]{2,31}$`다. 입력은 소문자로 변환한 뒤 검사하며, `OPERATOR`만 개별 계정의 로그인 ID를 발급할 수 있고, 발급 후 로그인 ID 변경은 MVP에서 허용하지 않는다.

`password_credentials`에는 `user_id`, `kdf_version`, `phc`, `must_change_password`, `changed_at`을 둔다. salt와 KDF 인자는 PHC 문자열 안에만 있으며, 원문 비밀번호·pepper·JWT는 어떤 D1 테이블에도 저장하지 않는다.

`auth_sessions`에는 JWT의 `sid`, `user_id`, `session_version`, 발급·만료·폐기 시각과 CSRF hash를 둔다. Worker는 JWT 서명만 믿지 않고 D1 세션·사용자 활성 상태·세션 버전까지 확인한다.

### 5.2 초기 공용 운영자 인수인계

1. 빈 D1에서만 `BOOTSTRAP_TOKEN` 보호 route가 공용 운영자(`is_bootstrap=1`, `OPERATOR`)와 임시 비밀번호를 만든다. bootstrap route는 첫 사용자 생성 뒤 비활성화된다.
2. 공용 운영자는 첫 개별 운영자(`is_bootstrap=0`, `OPERATOR`)를 만들고, 해당 계정은 `must_change_password=1` 상태다.
3. 개별 운영자가 임시 비밀번호로 로그인해 새 비밀번호 변경을 성공한다.
4. 같은 D1 트랜잭션에서 공용 운영자를 비활성화하고, 공용 운영자 세션을 전부 폐기하며, 보안·감사 이벤트를 남긴다.
5. 인수인계 완료 뒤 공용 운영자 계정을 다시 활성화하는 UI·API는 없다.

계정 생성 직후가 아니라 최초 비밀번호 변경 뒤 폐기하는 이유는 오타·전달 실패로 전체 관리 권한을 잃는 상황을 방지하기 위해서다.

### 5.3 긴급 복구

초기 공용 운영자 생성 성공 시 32 random bytes를 base64url로 인코딩한 복구 코드를 한 번만 표시한다. `recovery_codes` 테이블에는 `HMAC-SHA-256(RECOVERY_CODE_PEPPER, code)`와 상태·교체 시각만 저장한다.

`POST /api/v1/auth/recover`는 복구 코드, 새 영문 로그인 ID, 표시 이름, 새 비밀번호를 받는다. Worker는 요청 제한·입력을 먼저 검증하고 KDF service로 해시를 만든 뒤, 단일 D1 트랜잭션에서 기존 코드를 소비하고 `must_change_password=1`인 새 `OPERATOR` 계정·자격 증명을 만들고 교체 복구 코드를 생성한다. 응답은 새 복구 코드를 한 번만 포함한다. 새 운영자가 제공한 비밀번호로 로그인한 뒤 최초 비밀번호 변경을 성공해야만, 아직 활성인 공용 운영자 계정이 표준 인수인계 규칙에 따라 폐기된다. 이 흐름은 공용 운영자 계정을 직접 복원하지 않는다.

## 6. 로그인, 세션, 권한 흐름

1. 브라우저가 같은 origin의 `POST /api/v1/auth/login`에 `loginId`, `password`를 보낸다.
2. Worker는 canonical login ID와 HMAC 처리한 IP/login ID 기반의 `login_attempts`를 확인한다.
3. Worker는 D1의 PHC를 읽어 KDF service의 `verify`를 호출한다. 계정이 없거나 비활성인 경우에도 dummy verify를 한 번 호출한다.
4. 유효·활성 계정의 검증이 성공하면 Worker가 `auth_sessions`를 만들고 `sub`, `sid`, `sv`, `iat`, `exp` claim을 가진 8시간 JWT를 `__Host-er_session; HttpOnly; Secure; SameSite=Lax; Path=/` 쿠키로 설정한다.
5. `must_change_password=1`이면 허용 route는 `GET /api/v1/auth/me`, `POST /api/v1/auth/change-password`, `POST /api/v1/auth/logout`만이다. 비밀번호 변경 성공은 그 세션을 포함해 해당 사용자의 모든 이전 세션을 폐기하고, 사용자를 로그아웃시킨다.
6. 로그인과 `GET /api/v1/auth/csrf`를 제외한 모든 상태 변경 요청은 같은 origin, `credentials: include`, 브라우저 메모리에만 둔 `X-ER-CSRF` 원문과 D1의 SHA-256 hash 검증을 요구한다. 별도 CSRF cookie는 만들지 않는다. 로그인 응답과 `GET /api/v1/auth/csrf`만 새 원문을 JSON으로 반환하며 `Cache-Control: no-store`를 설정한다.

로그아웃, 계정 비활성화, 역할/조직 변경, 비밀번호 재설정은 관련 D1 세션을 폐기하거나 `session_version`을 증가시킨다. 어떤 역할도 JWT claim만으로 신뢰하지 않고 D1의 현재 역할·조직 연결을 기준으로 인가한다.

## 7. 장애·보안·운영 규칙

- KDF service timeout, 5xx, 서명 오류는 `503` 또는 내부 오류로 끝나며 JWT 발급·비밀번호 변경을 우회하지 않는다.
- 로그인 실패는 존재 여부·비활성 여부·비밀번호 오류를 구별하지 않는 동일한 사용자 메시지와 상태 코드로 응답한다.
- 15분에 5회 실패하면 IP/login ID 복합 키를 잠그고, 성공 시 해당 실패 상태를 초기화한다. IP 원문은 D1에 넣지 않고 `IP_HASH_KEY`로 HMAC 처리한다.
- Worker의 `JWT_SIGNING_KEY`, `AUTH_KDF_SHARED_SECRET`, `IP_HASH_KEY`, `BOOTSTRAP_TOKEN`, `RECOVERY_CODE_PEPPER`는 Cloudflare Worker Secrets에만 둔다. `PASSWORD_PEPPER`, `AUTH_KDF_SHARED_SECRET`, `DUMMY_ARGON2_PHC`는 Google Secret Manager에서 Cloud Run으로 주입한다.
- `BOOTSTRAP_TOKEN`은 초기 인수인계 검증 뒤 Cloudflare에서 삭제한다. 비밀번호, PHC, pepper, JWT 원문, 복구 코드, CSRF 원문은 로그·감사 로그·엑셀·브라우저 영구 저장소에 남기지 않는다.
- `PASSWORD_PEPPER`는 일상적으로 교체하지 않는다. 교체가 필요한 침해 대응에서는 모든 기존 비밀번호 검증을 중단하고, 긴급 복구 코드로 새 운영자를 만든 뒤 모든 계정의 비밀번호 재설정과 모든 세션 폐기를 수행한다. `kdf_version`은 알고리즘/비용 변경을 식별하지만 이전 pepper를 복구하지 않는다.
- Cloud Run에는 결제 계정이 필요하다. 월 예산 알림을 설정하고 `min-instances=0`, `max-instances=1`을 유지한다. 예산 알림은 hard spending cap이 아니므로 Worker 로그인 rate limit과 Cloud Run instance cap을 함께 적용한다.

## 8. UI 기준

`/Users/coursemos/develop/coursemos-supporter/docs/design-system.md`의 원칙을 적용한다. 즉, 로그인·비밀번호 변경·복구 화면은 한 화면에 하나의 우선 행동을 보여 주고, 색상·간격·radius·shadow는 `--er-*` CSS 토큰으로 관리한다. `Button`, `Card`, `TextInput`, `StatusMessage`, `Dialog` 같은 UI 프리미티브를 먼저 만들고 도메인 화면은 이를 조합한다.

영구 브라우저 저장소에는 JWT·refresh token·비밀번호·복구 코드를 쓰지 않는다. 임시 비밀번호와 새 복구 코드는 해당 dialog의 메모리에만 두고 닫으면 지운다.

## 9. 검증 기준

구현을 시작하기 전에 실제 Cloud Run 환경 capability gate를 수행한다.

1. Argon2id hash, 정상 verify, 잘못된 비밀번호 verify, 존재하지 않는 ID dummy verify가 모두 올바른 의미 결과를 낸다.
2. 정상 비밀번호·잘못된 비밀번호·존재하지 않는 ID를 각각 50회 순차 요청한다. warm 상태의 각 시나리오 P95는 1.5초 이하여야 한다.
3. 13개의 정상 로그인을 동시에 요청해 모두 Worker의 8초 내부 timeout 전에 완료하고 5xx/OOM이 없어야 한다.
4. Worker 서명이 없거나 timestamp/body digest/signature가 틀린 KDF 요청은 Argon2 실행 없이 `401`이 된다.
5. D1에서 bootstrap 인수인계는 새 운영자의 최초 비밀번호 변경 전에는 공용 계정을 유지하고, 성공 뒤에는 공용 계정과 세션을 폐기한다.
6. 복구 코드는 한 번만 소비되고, 새 운영자 계정과 교체 코드가 원자적으로 생성된다.
7. 로그아웃·비밀번호 변경·비활성화·역할 변경 뒤 이전 JWT가 모두 거부된다.
8. Cloud Run 실제 hash/verify의 P95 응답 시간, cold start, 메모리·5xx 상태를 evidence로 보관한다. Argon2id work factor는 측정 결과로만 조정하며 OWASP 최소 구성보다 낮추지 않는다.

## 10. 범위 밖

- Firebase, Supabase, Cloudflare Access, 외부 IdP, 이메일 OTP
- refresh token, 소셜 로그인, 공개 회원가입, 이메일 기반 비밀번호 재설정
- 공용 운영자 계정 재활성화 또는 D1 직접 수동 수정
- 원본 엑셀 파일·원본 셀 행렬 보관, 체크인, 실시간 공동 편집

## 11. 구현 전제

이 설계는 Google Cloud 프로젝트와 결제 계정, Cloud Run/Cloud Build/Secret Manager 사용 권한이 준비된 경우에만 배포까지 완료할 수 있다. 권한이나 결제 계정이 아직 없다면, 코드·테스트는 로컬과 mock 기반으로 진행하되 원격 capability gate와 production deploy는 그 전제 충족 뒤에만 수행한다.
