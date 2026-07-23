# Cloudflare 배포 절차

이 문서는 `event-roster`를 Cloudflare Workers Free와 D1 하나에 배포하는 수동 절차다. 프론트와 API는 동일한 `workers.dev` origin에서 제공한다. Cloudflare Access, Pages, Google Cloud, VM, 커스텀 도메인은 사용하지 않는다.

## 안전선

- 아래 원격 명령은 사용자가 Cloudflare 계정과 생성 대상(Worker 1개, D1 1개, Worker Secret 5개)을 명시적으로 승인한 뒤에만 실행한다.
- 비밀번호, JWT 키, refresh token, CSRF, bcrypt hash, bootstrap token을 명령 인자·로그·Git에 기록하지 않는다.
- Secret은 `wrangler secret put`의 대화형 표준 입력으로만 등록한다.
- 배포 전 로컬 전체 검증과 `wrangler deploy --dry-run`을 통과시킨다.
- 기존 D1에 migration `0003`을 적용하기 전에는 반드시 원격 전체 export와 체크섬을 확보한다. export 확인 전에는 migration이나 Worker 배포를 진행하지 않는다.

## 1. 계정 확인과 재승인

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler whoami
```

출력된 계정이 대상 계정인지 확인하고 여기서 멈춘다. 사용자에게 Worker `event-roster`, D1 `event-roster`, Secret 5개 생성을 다시 승인받는다.

## 2. D1 생성과 설정 반영

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 create event-roster
```

출력된 실제 `database_id`를 `apps/worker/wrangler.jsonc`의 `DB` binding에 반영한다. 추측한 ID나 테스트용 0 UUID를 운영 설정에 사용하지 않는다.

기존 D1을 `0003_organization_leadership.sql`로 올리는 경우 먼저 원격 전체 export를 만든다. 백업은 main checkout과 linked worktree를 포함한 어떤 저장소 안에도 잠시라도 만들지 않는다. 아래 절차를 저장소 루트에서 실행해 이미 존재하는 저장소 밖 상위 디렉터리의 절대 경로를 직접 입력한다. 절차는 canonicalization 전에 입력 경로의 leaf부터 `/`까지 각 구성요소를 `test -L`로 검사한다. symbolic link 구성요소와 존재하지 않는 tail은 모두 중단하며, 이 검사는 macOS zsh와 Linux bash에서 동일하게 동작한다. 이후 모든 worktree의 실제 경로와 비교하고 mode 0700 실행별 전용 디렉터리를 원자적으로 만든 뒤 export·체크섬의 기존 파일·symbolic link와 권한을 검사한다. `backups/`와 `event-roster-d1-*/`는 방어적으로 Git에서 제외하지만 운영 백업 위치로 사용하지 않는다.

```bash
set -eu
umask 077
printf '%s' '저장소 밖의 기존 백업 상위 디렉터리 절대 경로: '
IFS= read -r EVENT_ROSTER_BACKUP_PARENT
case "$EVENT_ROSTER_BACKUP_PARENT" in
  /*) ;;
  *) echo "절대 경로가 필요합니다." >&2; exit 1 ;;
esac
while [ "$EVENT_ROSTER_BACKUP_PARENT" != "/" ] && [ "${EVENT_ROSTER_BACKUP_PARENT%/}" != "$EVENT_ROSTER_BACKUP_PARENT" ]; do
  EVENT_ROSTER_BACKUP_PARENT="${EVENT_ROSTER_BACKUP_PARENT%/}"
done
EVENT_ROSTER_PATH_COMPONENT="$EVENT_ROSTER_BACKUP_PARENT"
while [ "$EVENT_ROSTER_PATH_COMPONENT" != "/" ]; do
  if [ -L "$EVENT_ROSTER_PATH_COMPONENT" ]; then
    echo "백업 상위 경로에 symbolic link 구성요소가 있습니다: $EVENT_ROSTER_PATH_COMPONENT" >&2
    exit 1
  fi
  if [ ! -e "$EVENT_ROSTER_PATH_COMPONENT" ]; then
    echo "백업 상위 경로의 모든 구성요소가 이미 존재해야 합니다: $EVENT_ROSTER_PATH_COMPONENT" >&2
    exit 1
  fi
  EVENT_ROSTER_PATH_COMPONENT="${EVENT_ROSTER_PATH_COMPONENT%/*}"
  test -n "$EVENT_ROSTER_PATH_COMPONENT" || EVENT_ROSTER_PATH_COMPONENT="/"
done
test -d "$EVENT_ROSTER_BACKUP_PARENT"
EVENT_ROSTER_BACKUP_PARENT="$(cd "$EVENT_ROSTER_BACKUP_PARENT" && pwd -P)"
EVENT_ROSTER_WORKTREE_LIST="$(git -c core.quotePath=false worktree list --porcelain)"
while IFS= read -r EVENT_ROSTER_WORKTREE_LINE; do
  case "$EVENT_ROSTER_WORKTREE_LINE" in
    "worktree "*)
      EVENT_ROSTER_WORKTREE="${EVENT_ROSTER_WORKTREE_LINE#worktree }"
      EVENT_ROSTER_WORKTREE="$(cd "$EVENT_ROSTER_WORKTREE" && pwd -P)"
      case "${EVENT_ROSTER_BACKUP_PARENT}/" in
        "${EVENT_ROSTER_WORKTREE}/"*) echo "백업 경로는 모든 Git worktree 밖이어야 합니다." >&2; exit 1 ;;
      esac
      ;;
  esac
done <<EOF
$EVENT_ROSTER_WORKTREE_LIST
EOF
EVENT_ROSTER_BACKUP_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVENT_ROSTER_BACKUP_DIR="${EVENT_ROSTER_BACKUP_PARENT}/event-roster-d1-${EVENT_ROSTER_BACKUP_TIMESTAMP}-$$"
test ! -e "$EVENT_ROSTER_BACKUP_DIR"
test ! -L "$EVENT_ROSTER_BACKUP_DIR"
mkdir -- "$EVENT_ROSTER_BACKUP_DIR"
chmod 700 -- "$EVENT_ROSTER_BACKUP_DIR"
EVENT_ROSTER_BACKUP_DIR="$(cd "$EVENT_ROSTER_BACKUP_DIR" && pwd -P)"
EVENT_ROSTER_BACKUP_DIR_MODE="$(stat -c '%a' "$EVENT_ROSTER_BACKUP_DIR" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_BACKUP_DIR")"
test "$EVENT_ROSTER_BACKUP_DIR_MODE" = "700"
EVENT_ROSTER_BACKUP_FILE="${EVENT_ROSTER_BACKUP_DIR}/event-roster-pre-0003.sql"
test ! -e "$EVENT_ROSTER_BACKUP_FILE"
test ! -L "$EVENT_ROSTER_BACKUP_FILE"
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 export event-roster --remote --output "$EVENT_ROSTER_BACKUP_FILE"
test -s "$EVENT_ROSTER_BACKUP_FILE"
test -f "$EVENT_ROSTER_BACKUP_FILE"
test ! -L "$EVENT_ROSTER_BACKUP_FILE"
chmod 600 -- "$EVENT_ROSTER_BACKUP_FILE"
EVENT_ROSTER_CHECKSUM_FILE="${EVENT_ROSTER_BACKUP_FILE}.sha256"
test ! -e "$EVENT_ROSTER_CHECKSUM_FILE"
test ! -L "$EVENT_ROSTER_CHECKSUM_FILE"
(set -C; shasum -a 256 "$EVENT_ROSTER_BACKUP_FILE" > "$EVENT_ROSTER_CHECKSUM_FILE")
test -f "$EVENT_ROSTER_CHECKSUM_FILE"
test ! -L "$EVENT_ROSTER_CHECKSUM_FILE"
chmod 600 -- "$EVENT_ROSTER_CHECKSUM_FILE"
EVENT_ROSTER_BACKUP_FILE_MODE="$(stat -c '%a' "$EVENT_ROSTER_BACKUP_FILE" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_BACKUP_FILE")"
EVENT_ROSTER_CHECKSUM_FILE_MODE="$(stat -c '%a' "$EVENT_ROSTER_CHECKSUM_FILE" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_CHECKSUM_FILE")"
test "$EVENT_ROSTER_BACKUP_FILE_MODE" = "600"
test "$EVENT_ROSTER_CHECKSUM_FILE_MODE" = "600"
shasum -a 256 -c "$EVENT_ROSTER_CHECKSUM_FILE"
```

절대 백업 파일 경로, 생성 시각, database ID, 체크섬을 접근 제한된 배포 기록에 남긴다. export가 비어 있지 않고 `users`, `organizations`, `user_organizations`, `projects`, `project_organizations`, `participants`, `project_roster_entries`, `audit_logs`의 schema/data를 포함하는지 확인한 뒤에만 migration을 적용한다. 신규 빈 D1은 생성 사실과 pending migration 목록을 기록하고 같은 검증 순서를 따른다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler d1 execute event-roster --remote --command "PRAGMA foreign_key_check"
```

`PRAGMA foreign_key_check`는 행을 반환하지 않아야 한다. 이어 아래 두 조회를 원격 D1에서 실행한다.

```sql
SELECT assignment_role, COUNT(*)
FROM user_organizations
GROUP BY assignment_role;

SELECT organization_id, COUNT(*) AS primary_count
FROM user_organizations
WHERE assignment_role = 'PRIMARY_LEADER'
GROUP BY organization_id
HAVING COUNT(*) > 1;
```

첫 조회의 합계가 migration 전 `user_organizations` 행 수와 같아야 한다. 기존 배정은 `MANAGER`로 보존된다. 두 번째 조회는 반드시 0행이어야 한다. 불일치하면 Worker binding을 전환하거나 다음 배포 단계로 진행하지 말고 [복구 절차](recovery.md)의 격리 복원을 수행한다.

## 3. Secret 5개 등록

아래 helper는 cost-12 dummy bcrypt hash와 최소 32 CSPRNG bytes의 무작위 secret을 생성해 Wrangler 표준 입력으로 직접 전달한다. 값은 출력하거나 명령 인자에 넣지 않는다. 실행 전 정확히 `event-roster`를 입력해야 한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run secrets:remote
```

helper는 bootstrap 단계 연결을 위해 무작위 bootstrap token 하나만 `apps/worker/.bootstrap-token.tmp`에 mode 0600으로 임시 저장한다. 이 파일은 Git에서 제외되며 bootstrap 성공 시 다음 helper가 즉시 삭제한다. 다른 네 Secret은 파일에 저장하지 않는다.

임시 파일은 exclusive create로만 만들며 기존 파일이나 symbolic link가 있으면 Secret 설정 전에 중단한다. 이 경우 진행 중인 bootstrap이 없다는 사실과 파일 유형·경로를 확인하고 사용자에게 삭제를 명시적으로 승인받은 뒤에만 기존 파일을 제거하고 다시 실행한다. 조용히 덮어쓰지 않는다.

## 4. 첫 배포와 origin 확정

```bash
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
```

Wrangler가 출력한 정확한 `https://<worker>.<account>.workers.dev` URL을 복사한다. `APP_ORIGIN`을 그 URL과 완전히 동일하게 `wrangler.jsonc`의 `vars`에 설정한 뒤 다시 배포한다. 경로와 마지막 `/`는 넣지 않는다.

## 5. bootstrap 인계

운영 bootstrap 요청은 아래 helper로 한 번만 수행한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run bootstrap:remote
```

helper는 username/password/port/path/query/hash가 없는 정확한 HTTPS `<worker>.<account>.workers.dev` origin만 허용한다. 초기 영문 로그인 ID·표시 이름은 일반 입력, 초기 비밀번호는 터미널 echo를 끈 숨김 입력으로 받는다. bootstrap token은 mode 0600 임시 파일에서 읽고 성공 즉시 삭제한다. 비밀값을 argv, 셸 히스토리, 로그에 기록하지 않으며 응답 본문도 출력하지 않는다. 비대화형 터미널에서는 안전하게 중단된다.

성공 후 초기 계정으로 브라우저에 로그인해 첫 영문 로그인 ID 운영자를 만들고, 임시 비밀번호와 복구 코드는 안전한 오프라인 채널로 전달한다.

인계가 완료되면 즉시 bootstrap Secret을 삭제한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler secret delete BOOTSTRAP_TOKEN
```

초기 계정이 더 이상 로그인할 수 없고 새 운영자가 임시 비밀번호 변경 후 다시 로그인되는지 확인한다.

## 6. 저빈도 smoke와 관찰

로컬 환경 변수 `SMOKE_BASE_URL`, `SMOKE_LOGIN_ID`, `SMOKE_PASSWORD`를 셸 히스토리에 남지 않는 방식으로 주입하고 다음을 한 번 실행한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker run smoke:remote
```

스크립트는 올바른 로그인 1회, 잘못된 비밀번호 1회, 존재하지 않는 ID 1회를 2초 간격으로 수행하며 재시도하지 않는다. 이어 Access JWT 900초, refresh cookie 속성·1회 회전, logout 폐기를 확인한다. 5xx면 배포 실패로 기록하되 ADR 0003의 stress 결과를 변경하지 않는다.

프로젝트 scheduled 자동 종료와 조직 리더십은 아래 항목을 순서대로 확인한다.

1. `wrangler deploy --dry-run`에서 Scheduled Trigger `0 15 * * *` 확인
2. 실제 deploy 후 Cloudflare Dashboard의 Trigger 목록에 Cron 하나만 있는지 확인
3. KST 경계 fixture로 scheduled handler를 수동 검증
4. 만료 프로젝트 mutation이 `PROJECT_CLOSED`를 반환하는지 확인
5. `project_organizations`와 project roster migration 행 수 확인
6. 운영자에게만 `조직 관리`가 보이고 대표 한 명·추가 관리자 여러 명을 배정할 수 있는지 확인
7. 대표와 추가 관리자가 담당 조직의 `PRE_REGISTRATION` 명단만 변경하고 `IN_PROGRESS`에서는 읽기 전용인지 확인

Wrangler 4.112.0의 dry-run 요약이 Cron을 별도로 출력하지 않는 경우에는 exit 0과 `apps/worker/wrangler.jsonc`의 `triggers.crons`가 `["0 15 * * *"]` 하나인지를 함께 대조한다. 실제 원격 Trigger 존재 여부는 2번에서 확정한다.

마지막으로 Cloudflare 대시보드에서 Workers 오류, CPU 시간, D1 오류·사용량을 확인하고 배포 시각·커밋 SHA·정확한 URL·smoke 결과만 배포 기록에 남긴다.
