# Cloudflare 배포 절차

이 문서는 `event-roster`를 Cloudflare Workers Free와 D1 하나에 배포하는 수동 절차다. 프론트와 API는 동일한 `workers.dev` origin에서 제공한다. Cloudflare Access, Pages, Google Cloud, VM, 커스텀 도메인은 사용하지 않는다.

## 안전선

- 아래 원격 명령은 사용자가 Cloudflare 계정과 생성 대상(Worker 1개, D1 1개, Worker Secret 5개)을 명시적으로 승인한 뒤에만 실행한다.
- 비밀번호, JWT 키, refresh token, CSRF, bcrypt hash, bootstrap token을 명령 인자·로그·Git에 기록하지 않는다.
- Secret은 `wrangler secret put`의 대화형 표준 입력으로만 등록한다.
- 배포 전 로컬 전체 검증과 `wrangler deploy --dry-run`을 통과시킨다.
- 기존 D1에 migration `0003`을 적용하기 전에는 반드시 원격 전체 export와 체크섬을 확보한다. export 확인 전에는 migration이나 Worker 배포를 진행하지 않는다.

종료 프로젝트 이력 보정 release에는 D1 migration이 없다. 이 release만 배포할
때는 `wrangler d1 migrations apply`를 실행하지 않으며, 7.3의 원격 pending
목록이 비어 있어야 한다. 예상하지 않은 pending migration이 있으면 보정
release와 함께 적용하지 말고 해당 전용 gate와 승인 상태를 확인할 때까지
배포를 중단한다. Cloudflare 배포 방식은 계속 7절의 깨끗한 `main` checkout을
사용하는 수동 절차이며 feature branch에서 deploy하지 않는다.

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
chmod 700 "$EVENT_ROSTER_BACKUP_DIR"
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
chmod 600 "$EVENT_ROSTER_BACKUP_FILE"
EVENT_ROSTER_CHECKSUM_FILE="${EVENT_ROSTER_BACKUP_FILE}.sha256"
test ! -e "$EVENT_ROSTER_CHECKSUM_FILE"
test ! -L "$EVENT_ROSTER_CHECKSUM_FILE"
(set -C; shasum -a 256 "$EVENT_ROSTER_BACKUP_FILE" > "$EVENT_ROSTER_CHECKSUM_FILE")
test -f "$EVENT_ROSTER_CHECKSUM_FILE"
test ! -L "$EVENT_ROSTER_CHECKSUM_FILE"
chmod 600 "$EVENT_ROSTER_CHECKSUM_FILE"
EVENT_ROSTER_BACKUP_FILE_MODE="$(stat -c '%a' "$EVENT_ROSTER_BACKUP_FILE" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_BACKUP_FILE")"
EVENT_ROSTER_CHECKSUM_FILE_MODE="$(stat -c '%a' "$EVENT_ROSTER_CHECKSUM_FILE" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_CHECKSUM_FILE")"
test "$EVENT_ROSTER_BACKUP_FILE_MODE" = "600"
test "$EVENT_ROSTER_CHECKSUM_FILE_MODE" = "600"
shasum -a 256 -c "$EVENT_ROSTER_CHECKSUM_FILE"
```

절대 백업 파일 경로, 생성 시각, database ID, 체크섬을 접근 제한된 배포 기록에 남긴다. export가 비어 있지 않고 `users`, `organizations`, `user_organizations`, `projects`, `project_organizations`, `participants`, `project_roster_entries`, `audit_logs`의 schema/data를 포함하는지 확인한다. 신규 빈 D1도 생성 사실과 pending migration 목록을 기록한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations list event-roster --remote
```

현재 checkout에 `0001`부터 `0004`까지 있을 때 `0004`를 적용할 수 있는 유일한
허용 상태는 목록에 `0004_automatic_project_preregistration.sql` 하나만
pending으로 표시되는 경우다. 이는 `0001`~`0003`이 적용 기록에 있다는
뜻이다. 이 경우에도 일반 `migrations apply`를 실행하지 말고
[7.3.1 전용 게이트](#automatic-preregistration-0004-gate)로
이동한다.

`0003`과 `0004`가 함께 보이거나 `0001`~`0003` 중 하나, 또는 다른
migration이 `0004`와 함께 pending이면 여기서 중단한다. 신규 빈 D1에서
`0001`~`0004`가 정확히 모두 보이는 경우에만 아래
[신규 빈 D1 단계 초기화](#fresh-empty-d1-staged-initialization)를 사용한다.
기존 데이터가 있거나 export를 import한 D1에는 이 초기화를 사용하지 않는다.
그 외 조합은 모두 중단하고 [복구 절차](recovery.md)의 데이터베이스 유형별
경로를 따른다.

<a id="fresh-empty-d1-staged-initialization"></a>

### 2.1 신규 빈 D1 단계 초기화: `0001`~`0003`

이 절차는 방금 생성했고 아직 Worker binding 연결, bootstrap, import, 수동
schema 변경을 한 적이 없는 **신규 빈 `event-roster` D1** 전용이다. 기본
config의 remote pending 목록이 정확히 `0001`~`0004` 네 개이고, 아래
예상 밖 schema object 수와 적용된 migration ledger 행 수가 모두 0일 때만
실행한다. 기존 운영 D1, export를 import한 복원 D1, pending 조합이 다른
D1에는 사용하지 않는다. 조건이 하나라도 다르면 중단한다.

Wrangler 4.112.0의 `d1 migrations apply`에는 특정 migration 파일만 고르는
옵션이 없다. 따라서 저장소 밖 mode 0700 임시 디렉터리에 `0001`~`0003`
세 파일만 복사하고, 기본 config의 정확한 `DB` binding, database name,
`database_id`를 읽어 `migrations_dir`만 제한한 최소 config를 생성한다.
생성기는 기본 `wrangler.jsonc`를 strict JSON으로도 해석할 수 없거나 대상
binding이 정확히 하나가 아니면 실패한다. 이 경우 값을 손으로 복사한 config를
만들지 말고 문서와 생성 절차를 다시 검토한다.

Wrangler 4.112.0 local D1에서 fresh `migrations list` 직후 관찰되는 schema
object는 D1 내부 `_cf_METADATA`, 빈 `d1_migrations`와 SQLite가 관리하는
`sqlite_sequence`, `sqlite_autoindex_d1_migrations_1`뿐이다. guard는 정확한
D1 내부 이름 두 개와 SQLite 예약 `sqlite_` prefix만 제외한다. 그 외 이름의
table, view, trigger, index가 하나라도 있거나 `d1_migrations`에 행이 있으면
중단한다. guard는 최초 확인과 staged apply 직전에 두 번 실행한다.

임시 루트는 `${TMPDIR:-/tmp}`가 가리키는 기존 절대 디렉터리를 `pwd -P`로
canonicalize해 사용한다. `/tmp`가 `/private/tmp` symbolic link인 macOS에서도
canonical 경로만 이후 검사에 사용한다. 생성된 디렉터리의 parent, 안전한
basename, mode 0700, main checkout과 모든 linked worktree 밖이라는 조건을
확인하기 전에는 migration이나 config를 쓰지 않는다.

```bash
set -euo pipefail
umask 077

EVENT_ROSTER_REPO_ROOT="$(git rev-parse --show-toplevel)"
EVENT_ROSTER_BASE_CONFIG="${EVENT_ROSTER_REPO_ROOT}/apps/worker/wrangler.jsonc"

EVENT_ROSTER_PENDING_BEFORE="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE"
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE" | grep -c '0001_initial.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE" | grep -c '0002_project_model.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE" | grep -c '0003_organization_leadership.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE" | grep -c '0004_automatic_project_preregistration.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_BEFORE" | grep -Ec '[0-9]{4}_[[:alnum:]_]+\.sql')" -eq 4

assert_event_roster_fresh_empty() {
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 execute event-roster --remote --json --command \
    "SELECT
       (
         SELECT COUNT(*)
         FROM sqlite_schema
         WHERE name NOT GLOB 'sqlite_*'
           AND name NOT IN ('_cf_METADATA', 'd1_migrations')
       ) AS unexpected_schema_count,
       (SELECT COUNT(*) FROM d1_migrations) AS applied_migration_count" |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const payload = JSON.parse(input);
        const result = payload?.[0];
        const row = result?.results?.[0];
        if (
          result?.success !== true ||
          row?.unexpected_schema_count !== 0 ||
          row?.applied_migration_count !== 0
        ) {
          console.error(
            `fresh empty D1 required; unexpected_schema_count=${String(row?.unexpected_schema_count)}, applied_migration_count=${String(row?.applied_migration_count)}`,
          );
          process.exit(1);
        }
      });
    '
}
assert_event_roster_fresh_empty

EVENT_ROSTER_TEMP_ROOT_INPUT="${TMPDIR:-/tmp}"
case "$EVENT_ROSTER_TEMP_ROOT_INPUT" in
  /*) ;;
  *) echo "TMPDIR은 절대 경로여야 합니다." >&2; exit 1 ;;
esac
test -d "$EVENT_ROSTER_TEMP_ROOT_INPUT"
test -w "$EVENT_ROSTER_TEMP_ROOT_INPUT"
EVENT_ROSTER_TEMP_ROOT="$(
  cd "$EVENT_ROSTER_TEMP_ROOT_INPUT"
  pwd -P
)"
test -d "$EVENT_ROSTER_TEMP_ROOT"
test ! -L "$EVENT_ROSTER_TEMP_ROOT"
test "$EVENT_ROSTER_TEMP_ROOT" != "/"

EVENT_ROSTER_STAGE_DIR="$(
  mktemp -d "${EVENT_ROSTER_TEMP_ROOT}/event-roster-d1-base.XXXXXXXX"
)"
chmod 700 "$EVENT_ROSTER_STAGE_DIR"
EVENT_ROSTER_STAGE_DIR="$(cd "$EVENT_ROSTER_STAGE_DIR" && pwd -P)"
test ! -L "$EVENT_ROSTER_STAGE_DIR"
test "${EVENT_ROSTER_STAGE_DIR%/*}" = "$EVENT_ROSTER_TEMP_ROOT"
printf '%s\n' "${EVENT_ROSTER_STAGE_DIR##*/}" |
  grep -Eq '^event-roster-d1-base\.[[:alnum:]]{6,}$'
EVENT_ROSTER_STAGE_DIR_MODE="$(stat -c '%a' "$EVENT_ROSTER_STAGE_DIR" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_STAGE_DIR")"
test "$EVENT_ROSTER_STAGE_DIR_MODE" = "700"

EVENT_ROSTER_STAGE_MIGRATIONS="${EVENT_ROSTER_STAGE_DIR}/migrations-0001-0003"
EVENT_ROSTER_STAGE_CONFIG="${EVENT_ROSTER_STAGE_DIR}/wrangler.0001-0003.json"
cleanup_event_roster_stage() {
  rm -f -- \
    "$EVENT_ROSTER_STAGE_CONFIG" \
    "$EVENT_ROSTER_STAGE_MIGRATIONS/0001_initial.sql" \
    "$EVENT_ROSTER_STAGE_MIGRATIONS/0002_project_model.sql" \
    "$EVENT_ROSTER_STAGE_MIGRATIONS/0003_organization_leadership.sql"
  rmdir -- "$EVENT_ROSTER_STAGE_MIGRATIONS" 2>/dev/null || true
  rmdir -- "$EVENT_ROSTER_STAGE_DIR" 2>/dev/null || true
}
trap cleanup_event_roster_stage EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

EVENT_ROSTER_WORKTREE_LIST="$(git -c core.quotePath=false worktree list --porcelain)"
while IFS= read -r EVENT_ROSTER_WORKTREE_LINE; do
  case "$EVENT_ROSTER_WORKTREE_LINE" in
    "worktree "*)
      EVENT_ROSTER_WORKTREE="${EVENT_ROSTER_WORKTREE_LINE#worktree }"
      EVENT_ROSTER_WORKTREE="$(cd "$EVENT_ROSTER_WORKTREE" && pwd -P)"
      case "${EVENT_ROSTER_STAGE_DIR}/" in
        "${EVENT_ROSTER_WORKTREE}/"*)
          echo "임시 migration 디렉터리는 모든 Git worktree 밖이어야 합니다." >&2
          exit 1
          ;;
      esac
      ;;
  esac
done <<EOF
$EVENT_ROSTER_WORKTREE_LIST
EOF

mkdir -- "$EVENT_ROSTER_STAGE_MIGRATIONS"
chmod 700 "$EVENT_ROSTER_STAGE_MIGRATIONS"
install -m 600 \
  "${EVENT_ROSTER_REPO_ROOT}/apps/worker/migrations/0001_initial.sql" \
  "${EVENT_ROSTER_REPO_ROOT}/apps/worker/migrations/0002_project_model.sql" \
  "${EVENT_ROSTER_REPO_ROOT}/apps/worker/migrations/0003_organization_leadership.sql" \
  "$EVENT_ROSTER_STAGE_MIGRATIONS/"

node - "$EVENT_ROSTER_BASE_CONFIG" "$EVENT_ROSTER_STAGE_MIGRATIONS" \
  "$EVENT_ROSTER_STAGE_CONFIG" <<'NODE'
const fs = require("node:fs");
const [basePath, migrationsDir, outputPath] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
const matches = (base.d1_databases ?? []).filter(
  (entry) =>
    entry.binding === "DB" && entry.database_name === "event-roster",
);
if (matches.length !== 1) {
  throw new Error("expected exactly one event-roster DB binding");
}
const database = matches[0];
if (
  typeof database.database_id !== "string" ||
  database.database_id.length === 0
) {
  throw new Error("event-roster database_id is missing");
}
const staged = {
  name: `${base.name}-base-migrations`,
  compatibility_date: base.compatibility_date,
  d1_databases: [
    {
      binding: database.binding,
      database_name: database.database_name,
      database_id: database.database_id,
      migrations_dir: migrationsDir,
    },
  ],
};
fs.writeFileSync(outputPath, `${JSON.stringify(staged, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
NODE
chmod 600 "$EVENT_ROSTER_STAGE_CONFIG"

EVENT_ROSTER_STAGE_DIR_MODE="$(stat -c '%a' "$EVENT_ROSTER_STAGE_DIR" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_STAGE_DIR")"
EVENT_ROSTER_STAGE_MIGRATIONS_MODE="$(stat -c '%a' "$EVENT_ROSTER_STAGE_MIGRATIONS" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_STAGE_MIGRATIONS")"
EVENT_ROSTER_STAGE_CONFIG_MODE="$(stat -c '%a' "$EVENT_ROSTER_STAGE_CONFIG" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_STAGE_CONFIG")"
test "$EVENT_ROSTER_STAGE_DIR_MODE" = "700"
test "$EVENT_ROSTER_STAGE_MIGRATIONS_MODE" = "700"
test "$EVENT_ROSTER_STAGE_CONFIG_MODE" = "600"
for EVENT_ROSTER_STAGE_MIGRATION in "$EVENT_ROSTER_STAGE_MIGRATIONS"/*.sql; do
  EVENT_ROSTER_STAGE_MIGRATION_MODE="$(stat -c '%a' "$EVENT_ROSTER_STAGE_MIGRATION" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_STAGE_MIGRATION")"
  test "$EVENT_ROSTER_STAGE_MIGRATION_MODE" = "600"
done

EVENT_ROSTER_STAGE_PENDING="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote \
    --config "$EVENT_ROSTER_STAGE_CONFIG"
)"
printf '%s\n' "$EVENT_ROSTER_STAGE_PENDING"
test "$(printf '%s\n' "$EVENT_ROSTER_STAGE_PENDING" | grep -c '0001_initial.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_STAGE_PENDING" | grep -c '0002_project_model.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_STAGE_PENDING" | grep -c '0003_organization_leadership.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_STAGE_PENDING" | grep -Ec '[0-9]{4}_[[:alnum:]_]+\.sql')" -eq 3

# 목록 확인과 apply 사이에 schema나 ledger가 바뀌면 즉시 중단한다.
assert_event_roster_fresh_empty

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote \
  --config "$EVENT_ROSTER_STAGE_CONFIG"

EVENT_ROSTER_PENDING_AFTER="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_PENDING_AFTER"
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_AFTER" | grep -c '0004_automatic_project_preregistration.sql')" -eq 1
test "$(printf '%s\n' "$EVENT_ROSTER_PENDING_AFTER" | grep -Ec '[0-9]{4}_[[:alnum:]_]+\.sql')" -eq 1
```

마지막 두 검사가 통과하면 `0001`~`0003`의 적용 기록이 만들어졌고 기본
config에서 `0004`만 pending이다. 임시 config에는 secret이 없지만
`database_id`가 있으므로 mode 0600을 유지하고, migration 사본과 함께 trap이
정확한 파일명만 삭제하게 둔다. 이 디렉터리는 백업이나 배포 산출물이 아니므로
보관·압축·업로드하지 않는다. 중단으로 trap cleanup이 끝나지 않았다면 경로와
mode가 위 패턴과 일치하는지 확인한 뒤 같은 세 파일과 config만 삭제하고 빈
디렉터리를 제거한다. 감사 기록에는 config가 아니라 pending 목록, 적용 결과,
대상 database ID와 시각만 남긴다.

이제 기존 [7.3.1 `0004` 전용 게이트](#automatic-preregistration-0004-gate)로
이동한다. `0004` 적용 전 backup과 pre/post count, audit count,
foreign-key 검증은 신규 D1에서도 생략하지 않는다.

허용된 migration gate를 완료했거나 pending migration이 없을 때만 아래
검증을 실행한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

`PRAGMA foreign_key_check`는 행을 반환하지 않아야 한다. 이어 아래 두 조회를
원격 D1에서 실행한다.

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

최종 Worker 배포 직후 구버전 Worker와의 migration 경계가 닫혔는지 다시
확인한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"
```

`preparing_count`는 반드시 0이어야 한다. 0이 아니면 bootstrap이나 다음
배포 단계로 진행하지 말고 [복구 절차](recovery.md)의 격리 복원을 따른다.

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

종료 프로젝트 이력 보정은 별도의 격리된 smoke 프로젝트에서 다음 순서로
확인한다. 테스트가 끝나면 프로젝트와 테스트 조직을 soft-delete해 운영 목록과
담당자 범위를 원래대로 돌린다.

1. 운영자로 예상 인원이 1명 이상인 프로젝트를 진행 시작 후 수동 종료하고
   `status`, `closed_at`, `closed_by`, `close_reason`, 예상 인원을 기록한다.
2. 별도 조직을 사용 중지하거나 삭제한 뒤 `이력 보정 시작`으로 진입한다.
   해당 조직 연결, 학생·교사 추가, 당시 snapshot 수정, 한 행 취소·복원,
   `mode=history-correction` Excel 검증·확정을 수행한다.
3. 프로젝트가 계속 `종료`이고 1번의 종료 metadata와 예상 인원이 그대로인지,
   실제 인원과 증감만 바뀌었는지 확인한다. 변경 이력에서 `종료 후 조직 이력
   보정`, `종료 후 명단 이력 보정`, `종료 후 엑셀 이력 보정`을 모두 확인한다.
4. 프로젝트 상세에서 보정 mode를 종료한다. 보정 banner, 조직 추가·제외,
   참가자 추가·수정·취소·복원, 보정 Excel 진입 control이 사라지는지 확인한다.
5. 현재 활성 연결 조직의 조직 담당자로 로그인해 같은 종료 프로젝트가 읽기
   전용인지 확인한다. `이력 보정 시작`이 없어야 하며 correction 후보 read와
   write 요청은 `403`이어야 한다. 비활성·삭제 조직 연결만으로 새 조회 범위가
   생겼다고 판단하지 않는다.
6. 두 운영자 탭에서 같은 revision을 읽고 모두 보정 mode에 진입한다. 첫 탭에서
   한 건을 반영한 뒤 두 번째 탭의 준비된 변경을 제출해 의도적으로 stale
   revision을 만든다. 두 번째 요청은 `409 STALE_REVISION`이어야 하며 그 요청의
   데이터, project revision 증가, correction 감사 중 어느 것도 남지 않아야
   한다. 하나라도 부분 반영되면 배포 실패로 기록하고 Worker/D1을 조사한다.

Wrangler 4.112.0의 dry-run 요약이 Cron을 별도로 출력하지 않는 경우에는 exit 0과 `apps/worker/wrangler.jsonc`의 `triggers.crons`가 `["0 15 * * *"]` 하나인지를 함께 대조한다. 실제 원격 Trigger 존재 여부는 2번에서 확정한다.

마지막으로 Cloudflare 대시보드에서 Workers 오류, CPU 시간, D1 오류·사용량을 확인하고 배포 시각·커밋 SHA·정확한 URL·smoke 결과만 배포 기록에 남긴다.

## 7. 반복 수동 release

운영 변경은 자동 배포하지 않는다. 아래 절차는 저장소의 깨끗한 `main`
checkout과 `wrangler login`으로 인증된 운영자 로컬 환경에서만 실행한다.
GitHub Actions에는 Cloudflare API Token과 Account ID를 등록하지 않는다.

### 7.1 대상 커밋과 계정 확인

```bash
set -euo pipefail
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git rev-parse HEAD
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler whoami
```

현재 SHA와 Wrangler가 표시한 Cloudflare 계정이 배포 대상인지 확인한다.
하나라도 다르거나 작업 트리가 깨끗하지 않으면 중단한다.

### 7.2 로컬 검증

```bash
set -euo pipefail
corepack pnpm@10.28.1 install --frozen-lockfile
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 format:check
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run
```

모든 명령이 exit 0일 때만 다음 단계로 진행한다.

### 7.3 pending D1 migration 판단

```bash
set -euo pipefail
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations list event-roster --remote
```

pending migration이 없으면 7.4로 이동한다. pending migration이 있으면 해당
migration의 승인된 사전·사후 검증 절차가 문서화되어 있어야 한다. 기존
데이터가 있는 D1은 2절의 저장소 밖 export·checksum 검증을 먼저 수행한다.
승인된 검증 절차나 확인된 백업 중 하나라도 없으면 migration과 배포를
중단한다.

`0004_automatic_project_preregistration.sql`이 목록에 있으면
`0001`~`0003`은 목록에 없어야 하고, 다른 pending migration도 없어야 한다.
즉 `0004` 하나만 pending인 출력이 `0001`~`0003` applied와 `0004` only
pending을 확인하는 gate다. `0003`+`0004`, `0001`~`0004`, 또는
`0004`+다른 migration 조합이면 중단한다. 단, 방금 생성한 미사용 빈 D1에서
정확히 `0001`~`0004`가 pending이면
[신규 빈 D1 단계 초기화](#fresh-empty-d1-staged-initialization)를 완료한 뒤
목록을 다시 확인한다. 기존 또는 복원 D1은 이 초기화를 사용하지 않고
[복구 절차](recovery.md)의 데이터베이스 유형별 경로를 따른다.

`0004`가 pending인 동안에는 아래 일반 `migrations apply`를 실행하지 않는다.
반드시 [7.3.1 전용 게이트](#automatic-preregistration-0004-gate)를
사용한다. 승인과 백업이 모두 확인된 경우에만 적용한다.

<a id="automatic-preregistration-0004-gate"></a>

### 7.3.1 `0004_automatic_project_preregistration.sql` 적용 게이트

먼저 pending 목록을 다시 확인한다.

```bash
set -euo pipefail
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations list event-roster --remote
```

출력에는 `0004_automatic_project_preregistration.sql`만 있어야 한다.
`0001`~`0003` 또는 다른 migration이 함께 있으면 아래 apply를 실행하지 않고
[복구 절차](recovery.md)의 격리 D1로 이동한다. 정확한 조건을 통과하면 아래
절차를 수행한다. export와 체크섬은 실행별 전용 디렉터리에만 보관한다.
migration 전 `preparing_count`와 `audit_count`를 배포 기록에 남긴다.
post-migration `preparing_count`는 반드시 0이어야 하고, 사후 `audit_count`는
사전 `audit_count + preparing_count`와 같아야 하며, foreign-key 검사는 행을
반환하지 않아야 한다. 하나라도 충족하지 않으면 Worker를 배포하지 말고
[복구 절차](recovery.md)의 격리 복원을 따른다. migration 끝에 생성되는 D1
trigger가 구버전 Worker의 새 `PREPARING` INSERT/UPDATE를 차단한다.

```bash
set -euo pipefail
release_backup_dir="$(mktemp -d /private/tmp/event-roster-d1-0004.XXXXXX)"
chmod 700 "$release_backup_dir"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$release_backup_dir/event-roster-before-0004.sql"
chmod 600 "$release_backup_dir/event-roster-before-0004.sql"
shasum -a 256 "$release_backup_dir/event-roster-before-0004.sql" \
  > "$release_backup_dir/event-roster-before-0004.sql.sha256"
chmod 600 "$release_backup_dir/event-roster-before-0004.sql.sha256"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS audit_count FROM audit_logs WHERE action='PROJECT_AUTO_PREREGISTERED'"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS audit_count FROM audit_logs WHERE action='PROJECT_AUTO_PREREGISTERED'"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

`0004`가 pending인 경우에는 위 전용 block만 실행한다. 아래 일반 block은
`migrations list`에 `0004`와 `0005`가 없고, 표시된 모든 pending migration에
각각 승인된 검증 절차가 있을 때만 실행한다.

`0005_roster_participant_profiles.sql`이 목록에 있으면 `0001`~`0004`와 다른
pending migration은 모두 없어야 한다. 정확히 `0005` 하나만 pending인 기존
운영 D1은 아래 7.3.2 전용 gate로 이동한다. `0005`와 다른 migration이 함께
있거나, `0005` 전용 백업·사전 기록을 완료하지 못한 경우 migration과 Worker
배포를 모두 중단한다.

`0006_project_soft_deletion.sql`이 목록에 있으면 `0001`~`0005`와 다른
pending migration은 모두 없어야 한다. 정확히 `0006` 하나만 pending인 기존
운영 D1은 아래 7.3.3 전용 gate로 이동한다. 다른 조합에는 일반
`migrations apply`를 실행하지 않는다.

`0007_organization_soft_deletion.sql`이 목록에 있으면 `0001`~`0006`과 다른
pending migration은 모두 없어야 한다. 정확히 `0007` 하나만 pending인 기존
운영 D1은 아래 7.3.4 전용 gate로 이동한다. 다른 조합에는 일반
`migrations apply`를 실행하지 않는다.

<a id="roster-participant-profiles-0005-gate"></a>

### 7.3.2 `0005_roster_participant_profiles.sql` 적용 게이트

이 gate는 기존 운영 D1에만 사용한다. 먼저 pending 출력을 접근 제한된 배포
기록에 저장하고, migration 파일명이 정확히 하나이며 그 값이
`0005_roster_participant_profiles.sql`인지 확인한다.

```bash
set -euo pipefail
EVENT_ROSTER_0005_PENDING="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_0005_PENDING"
EVENT_ROSTER_0005_PENDING_FILES="$(
  printf '%s\n' "$EVENT_ROSTER_0005_PENDING" |
    LC_ALL=C tr -cs '[:alnum:]_.\n-' '\n' |
    LC_ALL=C awk '/^[[:alnum:]_.-]+[.]sql$/ { print }' |
    LC_ALL=C sort -u
)"
test "$EVENT_ROSTER_0005_PENDING_FILES" = \
  "0005_roster_participant_profiles.sql"
```

출력 형식 변경 등으로 위 검사가 확실하지 않으면 통과로 간주하지 않는다.
Cloudflare Dashboard와 migration ledger를 함께 확인하고 gate를 중단한다.

백업은 저장소와 모든 linked worktree 밖의, 운영자가 미리 만든 실행별 전용
디렉터리만 사용한다. 그 디렉터리는 symbolic link가 아닌 절대 경로이며 mode
0700이어야 한다. 아래 명령은 export와 checksum이 이미 있거나 symbolic
link이면 실패하며, 두 파일을 mode 0600으로 고정하고 checksum을 즉시
검증한다.

```bash
set -euo pipefail
umask 077
test -n "${EVENT_ROSTER_0005_BACKUP_DIR:?외부 0005 백업 디렉터리가 필요합니다}"
case "$EVENT_ROSTER_0005_BACKUP_DIR" in
  /*) ;;
  *) echo "백업 디렉터리는 절대 경로여야 합니다." >&2; exit 1 ;;
esac
test -d "$EVENT_ROSTER_0005_BACKUP_DIR"
test ! -L "$EVENT_ROSTER_0005_BACKUP_DIR"
EVENT_ROSTER_0005_BACKUP_DIR="$(
  cd "$EVENT_ROSTER_0005_BACKUP_DIR"
  pwd -P
)"
EVENT_ROSTER_0005_BACKUP_MODE="$(
  stat -c '%a' "$EVENT_ROSTER_0005_BACKUP_DIR" 2>/dev/null ||
    stat -f '%Lp' "$EVENT_ROSTER_0005_BACKUP_DIR"
)"
test "$EVENT_ROSTER_0005_BACKUP_MODE" = "700"

EVENT_ROSTER_0005_WORKTREES="$(
  git -c core.quotePath=false worktree list --porcelain
)"
while IFS= read -r EVENT_ROSTER_0005_WORKTREE_LINE; do
  case "$EVENT_ROSTER_0005_WORKTREE_LINE" in
    "worktree "*)
      EVENT_ROSTER_0005_WORKTREE="$(
        cd "${EVENT_ROSTER_0005_WORKTREE_LINE#worktree }"
        pwd -P
      )"
      case "${EVENT_ROSTER_0005_BACKUP_DIR}/" in
        "${EVENT_ROSTER_0005_WORKTREE}/"*)
          echo "0005 백업은 모든 Git worktree 밖에 있어야 합니다." >&2
          exit 1
          ;;
      esac
      ;;
  esac
done <<EOF
$EVENT_ROSTER_0005_WORKTREES
EOF

EVENT_ROSTER_0005_EXPORT="${EVENT_ROSTER_0005_BACKUP_DIR}/event-roster-pre-0005.sql"
EVENT_ROSTER_0005_CHECKSUM="${EVENT_ROSTER_0005_EXPORT}.sha256"
test ! -e "$EVENT_ROSTER_0005_EXPORT"
test ! -L "$EVENT_ROSTER_0005_EXPORT"
test ! -e "$EVENT_ROSTER_0005_CHECKSUM"
test ! -L "$EVENT_ROSTER_0005_CHECKSUM"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$EVENT_ROSTER_0005_EXPORT"
test -s "$EVENT_ROSTER_0005_EXPORT"
chmod 600 "$EVENT_ROSTER_0005_EXPORT"
(set -C; shasum -a 256 "$EVENT_ROSTER_0005_EXPORT" \
  > "$EVENT_ROSTER_0005_CHECKSUM")
chmod 600 "$EVENT_ROSTER_0005_CHECKSUM"
test "$(stat -c '%a' "$EVENT_ROSTER_0005_EXPORT" 2>/dev/null ||
  stat -f '%Lp' "$EVENT_ROSTER_0005_EXPORT")" = "600"
test "$(stat -c '%a' "$EVENT_ROSTER_0005_CHECKSUM" 2>/dev/null ||
  stat -f '%Lp' "$EVENT_ROSTER_0005_CHECKSUM")" = "600"
shasum -a 256 -c "$EVENT_ROSTER_0005_CHECKSUM"
```

migration 전에는 아래 순서를 바꾸지 않는다. 먼저 현재 schema를 기록하고
`participant_role_snapshot`, `student_grade_snapshot` 열이 아직 없음을
`PRAGMA table_info` 결과로 확인한다. 그 확인 전에는 두 열을 참조하는 쿼리를
실행하지 않는다. 그 다음 roster 수를 기록한다.

```bash
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA table_info(project_roster_entries)"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS roster_count FROM project_roster_entries"
```

schema, 사전 `roster_count`, export 절대 경로, checksum을 배포 기록에
남긴 뒤에만 migration을 적용한다.

```bash
set -euo pipefail
EVENT_ROSTER_0005_PENDING_BEFORE_APPLY="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_0005_PENDING_BEFORE_APPLY"
EVENT_ROSTER_0005_PENDING_FILES_BEFORE_APPLY="$(
  printf '%s\n' "$EVENT_ROSTER_0005_PENDING_BEFORE_APPLY" |
    LC_ALL=C tr -cs '[:alnum:]_.\n-' '\n' |
    LC_ALL=C awk '/^[[:alnum:]_.-]+[.]sql$/ { print }' |
    LC_ALL=C sort -u
)"
test "$EVENT_ROSTER_0005_PENDING_FILES_BEFORE_APPLY" = \
  "0005_roster_participant_profiles.sql"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS roster_count FROM project_roster_entries"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS legacy_profile_count
   FROM project_roster_entries
   WHERE participant_role_snapshot IS NULL
     AND student_grade_snapshot IS NULL"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS invalid_profile_count
   FROM project_roster_entries
   WHERE (
     (participant_role_snapshot IS NULL AND student_grade_snapshot IS NULL)
     OR (participant_role_snapshot = 'STUDENT'
         AND student_grade_snapshot IN ('M1','M2','M3','H1','H2','H3'))
     OR (participant_role_snapshot = 'TEACHER'
         AND student_grade_snapshot IS NULL)
   ) IS NOT TRUE"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

사전 `roster_count`, 사후 `roster_count`, 사후 `legacy_profile_count` 세 값은
모두 같아야 한다. `invalid_profile_count`는 0이어야 하고,
`PRAGMA foreign_key_check`는 행을 반환하지 않아야 한다. pending 목록에서
`0005`가 사라지고 ledger에 적용 기록이 생겼는지도 확인한다. 이 조건 중
하나라도 충족하지 않으면 성공으로 기록하거나 Worker를 배포하지 않는다.
[복구 절차](recovery.md)의 pre-0005 export 격리 복원으로 이동한다.

<a id="project-soft-deletion-0006-gate"></a>

### 7.3.3 `0006_project_soft_deletion.sql` 적용 게이트

이 gate는 `0001`~`0005`가 이미 적용된 기존 운영 D1 전용이다. 2절에서
검증한 저장소·모든 worktree 밖의 **지속성 있는 백업 상위 디렉터리**에
실행별 디렉터리를 만들고, export와 체크섬을 각각 mode 0600으로 제한한다.
`/tmp`, `/private/tmp`, `${TMPDIR}` 같은 OS 임시 경로는 재부팅이나 정리
정책으로 사라질 수 있으므로 pre-`0006` 복구 원본 위치로 사용하지 않는다.

```bash
set -euo pipefail
umask 077
test -n "${EVENT_ROSTER_0006_BACKUP_PARENT:?지속성 있는 외부 백업 경로가 필요합니다}"
case "$EVENT_ROSTER_0006_BACKUP_PARENT" in
  /*) ;;
  *) echo "백업 상위 경로는 절대 경로여야 합니다." >&2; exit 1 ;;
esac
test -d "$EVENT_ROSTER_0006_BACKUP_PARENT"
test ! -L "$EVENT_ROSTER_0006_BACKUP_PARENT"
EVENT_ROSTER_0006_BACKUP_PARENT="$(
  cd "$EVENT_ROSTER_0006_BACKUP_PARENT"
  pwd -P
)"
case "$EVENT_ROSTER_0006_BACKUP_PARENT" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*)
    echo "0006 백업은 OS 임시 경로에 둘 수 없습니다." >&2
    exit 1
    ;;
esac
release_backup_dir="$(
  mktemp -d "$EVENT_ROSTER_0006_BACKUP_PARENT/event-roster-d1-0006.XXXXXX"
)"
chmod 700 "$release_backup_dir"
test "$(stat -c '%a' "$release_backup_dir" 2>/dev/null ||
  stat -f '%Lp' "$release_backup_dir")" = "700"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$release_backup_dir/event-roster-before-0006.sql"
test -s "$release_backup_dir/event-roster-before-0006.sql"
chmod 600 "$release_backup_dir/event-roster-before-0006.sql"
shasum -a 256 "$release_backup_dir/event-roster-before-0006.sql" \
  > "$release_backup_dir/event-roster-before-0006.sql.sha256"
chmod 600 "$release_backup_dir/event-roster-before-0006.sql.sha256"
shasum -a 256 -c \
  "$release_backup_dir/event-roster-before-0006.sql.sha256"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS project_count FROM projects"
```

사전 `project_count`, export 절대 경로와 체크섬을 접근 제한된 배포 기록에
남긴다. export와 checksum을 migration 복구 보존 기간 동안 유지할 수 있고
별도 셸에서 checksum 검증이 다시 성공하는지 확인한다. 이 보존 확인이
끝나기 전에는 migration을 적용하지 않는다. 이어 pending 파일명 집합을
정규화해 정확히
`0006_project_soft_deletion.sql` 하나인지 migration 적용 직전에 다시
확인한다.

```bash
set -euo pipefail
EVENT_ROSTER_0006_PENDING="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_0006_PENDING"
EVENT_ROSTER_0006_PENDING_FILES="$(
  printf '%s\n' "$EVENT_ROSTER_0006_PENDING" |
    LC_ALL=C tr -cs '[:alnum:]_.\n-' '\n' |
    LC_ALL=C awk '/^[[:alnum:]_.-]+[.]sql$/ { print }' |
    LC_ALL=C sort -u
)"
test "$EVENT_ROSTER_0006_PENDING_FILES" = \
  "0006_project_soft_deletion.sql"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS project_count FROM projects"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS deleted_count FROM projects WHERE deleted_at IS NOT NULL"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

사전·사후 `project_count`는 같아야 하고 최초 `deleted_count`는 0이어야
한다. `PRAGMA foreign_key_check`는 행을 반환하지 않아야 하며 pending
목록에서 `0006`이 사라지고 ledger에 적용 기록이 있어야 한다. 어느 조건이든
실패하면 Worker 배포를 즉시 중단하고
[복구 절차](recovery.md)의 pre-0006 export 격리 복원으로 이동한다. 운영
D1을 수동 SQL이나 역방향 migration으로 되돌리지 않는다.

<a id="organization-soft-deletion-0007-gate"></a>

### 7.3.4 `0007_organization_soft_deletion.sql` 적용 게이트

이 gate는 `0001`~`0006`이 이미 적용된 기존 운영 D1 전용이다. 2절에서
검증한 저장소·모든 worktree 밖의 지속성 있는 백업 상위 디렉터리에 실행별
디렉터리를 만들고, export와 체크섬을 각각 mode 0600으로 제한한다.
`/tmp`, `/private/tmp`, `${TMPDIR}` 같은 OS 임시 경로는 pre-`0007` 복구
원본으로 사용하지 않는다.

```bash
set -euo pipefail
umask 077
test -n "${EVENT_ROSTER_0007_BACKUP_PARENT:?지속성 있는 외부 백업 경로가 필요합니다}"
case "$EVENT_ROSTER_0007_BACKUP_PARENT" in
  /*) ;;
  *) echo "백업 상위 경로는 절대 경로여야 합니다." >&2; exit 1 ;;
esac
test -d "$EVENT_ROSTER_0007_BACKUP_PARENT"
test ! -L "$EVENT_ROSTER_0007_BACKUP_PARENT"
EVENT_ROSTER_0007_BACKUP_PARENT="$(
  cd "$EVENT_ROSTER_0007_BACKUP_PARENT"
  pwd -P
)"
case "$EVENT_ROSTER_0007_BACKUP_PARENT" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*)
    echo "0007 백업은 OS 임시 경로에 둘 수 없습니다." >&2
    exit 1
    ;;
esac
release_backup_dir="$(
  mktemp -d "$EVENT_ROSTER_0007_BACKUP_PARENT/event-roster-d1-0007.XXXXXX"
)"
chmod 700 "$release_backup_dir"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 export event-roster --remote \
  --output "$release_backup_dir/event-roster-before-0007.sql"
test -s "$release_backup_dir/event-roster-before-0007.sql"
chmod 600 "$release_backup_dir/event-roster-before-0007.sql"
shasum -a 256 "$release_backup_dir/event-roster-before-0007.sql" \
  > "$release_backup_dir/event-roster-before-0007.sql.sha256"
chmod 600 "$release_backup_dir/event-roster-before-0007.sql.sha256"
shasum -a 256 -c \
  "$release_backup_dir/event-roster-before-0007.sql.sha256"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS organization_count FROM organizations"
```

사전 `organization_count`, export 절대 경로와 체크섬을 접근 제한된 배포
기록에 남긴다. 별도 셸에서 체크섬 검증이 다시 성공하고 백업 보존 위치가
확인되기 전에는 migration을 적용하지 않는다. 적용 직전 전체 pending 파일명
집합이 정확히 `0007_organization_soft_deletion.sql` 하나인지 다시 검증한다.

```bash
set -euo pipefail
EVENT_ROSTER_0007_PENDING="$(
  corepack pnpm@10.28.1 --filter @event-roster/worker exec \
    wrangler d1 migrations list event-roster --remote
)"
printf '%s\n' "$EVENT_ROSTER_0007_PENDING"
EVENT_ROSTER_0007_PENDING_FILES="$(
  printf '%s\n' "$EVENT_ROSTER_0007_PENDING" |
    LC_ALL=C tr -cs '[:alnum:]_.\n-' '\n' |
    LC_ALL=C awk '/^[[:alnum:]_.-]+[.]sql$/ { print }' |
    LC_ALL=C sort -u
)"
test "$EVENT_ROSTER_0007_PENDING_FILES" = \
  "0007_organization_soft_deletion.sql"

corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 migrations apply event-roster --remote
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS organization_count FROM organizations"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS deleted_count
   FROM organizations WHERE deleted_at IS NOT NULL"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS invalid_deletion_state_count
   FROM organizations
   WHERE ((deleted_at IS NULL AND deleted_by IS NULL)
       OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND is_active = 0))
     IS NOT TRUE"
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "PRAGMA foreign_key_check"
```

사전·사후 `organization_count`는 같아야 하고 최초 `deleted_count`와
`invalid_deletion_state_count`는 모두 0이어야 한다.
`PRAGMA foreign_key_check`는 행을 반환하지 않아야 하며 pending 목록에서
`0007`이 사라지고 ledger에 적용 기록이 있어야 한다. 하나라도 실패하면
Worker 배포를 즉시 중단하고
[복구 절차](recovery.md)의 pre-0007 export 격리 복원으로 이동한다. 운영
D1을 수동 SQL이나 역방향 migration으로 되돌리지 않는다.

### 7.4 Worker 배포와 확인

```bash
set -euo pipefail
corepack pnpm@10.28.1 --filter @event-roster/web build
corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy
corepack pnpm@10.28.1 --filter @event-roster/worker exec \
  wrangler d1 execute event-roster --remote --command \
  "SELECT COUNT(*) AS preparing_count FROM projects WHERE status='PREPARING'"
curl --fail --silent --show-error \
  https://event-roster.event-roster.workers.dev/api/v1/health | \
  node -e 'let input = ""; process.stdin.on("data", chunk => input += chunk).on("end", () => { try { const payload = JSON.parse(input); if (payload === null || Array.isArray(payload) || typeof payload !== "object" || payload.status !== "ok") process.exitCode = 1; } catch { process.exitCode = 1; } });'
curl --fail --silent --show-error --head \
  https://event-roster.event-roster.workers.dev/
```

Worker 배포 후 `preparing_count`는 반드시 0이어야 한다. health 응답은
`{"status":"ok"}`이고 SPA 요청은 HTTP 200이어야 한다. 이어 6절의
`smoke:remote`를 한 번 실행한다. 하나라도 실패하면 성공으로 기록하지 않고
Worker 로그와 Wrangler 배포 이력을 확인하며, D1 불변식 실패는
[복구 절차](recovery.md)의 격리 복원으로 보낸다.

### 7.5 운영 기록

다음 항목만 접근 제한된 운영 기록에 남긴다.

- `git rev-parse HEAD`의 전체 40자 SHA
- 배포 시작·종료 시각
- `https://event-roster.event-roster.workers.dev`
- migration 적용 여부와 검증 결과
- health, SPA와 smoke 결과
- 실패한 경우 중단 단계와 복구 여부

OAuth token, runtime Secret, 로그인 비밀번호, JWT, refresh token과 D1
백업 내용은 기록하지 않는다.
