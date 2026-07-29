# 계정·데이터 복구

## 복구 코드 보관

- 운영자 생성 시 한 번 표시되는 복구 코드는 비밀번호 관리자 또는 암호화된 오프라인 저장소에 보관한다.
- 코드 원문을 D1, 이슈, 메신저, 로그, Git에 저장하지 않는다.
- 사용한 복구 코드는 다시 사용할 수 없으므로 새 복구 코드를 안전하게 교체 보관한다.

## 운영자 계정 복구

1. 로그인 화면의 복구 코드 흐름에서 영문 로그인 ID, 복구 코드, 새 비밀번호를 입력한다.
2. 복구 성공 후 기존 session과 refresh token이 모두 폐기되는지 확인한다.
3. 새 비밀번호로 로그인하고 감사 기록과 계정 활성 상태를 확인한다.
4. 복구 코드가 없고 활성 운영자도 없으면 임의로 D1을 수정하지 않는다. 변경 승인과 백업을 확보한 뒤, 배포 절차의 bootstrap 재개 방안을 별도 변경 계획으로 검토한다.

## 세션 강제 폐기

- 비밀번호 변경·운영자 재설정·계정 비활성화·전역 역할 변경·조직 배정 변경은 대상 사용자의 모든 session/refresh token을 폐기한다.
- 의심 계정은 먼저 비활성화하고 모든 브라우저에서 재로그인이 요구되는지 확인한다.
- JWT·refresh token 원문을 조회하거나 복구 대상으로 삼지 않는다.

## D1 백업과 복원

1. 프로젝트별 Excel 내보내기로 업무상 복구 가능한 명단·집계 사본을 정기 확보한다.
2. 원격 변경 전 [배포 절차](deployment.md)의 보안 백업 명령으로 D1 export를 생성한다. symbolic link 구성요소가 전혀 없는, main checkout과 모든 linked worktree 밖의 명시적 절대 경로만 사용한다. mode 0700 실행별 디렉터리 안의 export와 체크섬 파일이 각각 mode 0600인지 확인한다. 저장소의 `backups/`와 `event-roster-d1-*/`는 운영 백업 위치로 사용하지 않는다.
3. export가 `users`, `organizations`, `user_organizations`, `projects`, `project_organizations`를 포함하고 각 행 수가 예상과 일치하는지 확인한다.
4. 복원은 운영 DB에 바로 덮어쓰지 않고 별도 격리 D1에 import한다. 운영 Worker는 이 단계에서 격리 D1을 바라보지 않는다.
5. **import하지 않을 신규 빈 배포 D1**은 복원 대상으로 취급하지 않는다. 이
   경우에만 [신규 빈 D1 단계 초기화](deployment.md#fresh-empty-d1-staged-initialization)로
   `0001`~`0003`을 적용한다. 앞으로 export를 import할 D1에는 이 초기화를
   먼저 실행하지 않는다.
6. export를 격리 D1에 import한 직후에는 export에 포함된 migration ledger와
   현재 checkout의 pending 목록을 기록한다. 격리 D1을 가리키는 검토된
   recovery config를 사용하고 운영 config를 재사용하지 않는다.

   ```bash
   set -euo pipefail
   test -n "${EVENT_ROSTER_RECOVERY_CONFIG:?격리 D1 recovery config가 필요합니다}"
   test -f "$EVENT_ROSTER_RECOVERY_CONFIG"
   test ! -L "$EVENT_ROSTER_RECOVERY_CONFIG"
   EVENT_ROSTER_RECOVERY_CONFIG_MODE="$(stat -c '%a' "$EVENT_ROSTER_RECOVERY_CONFIG" 2>/dev/null || stat -f '%Lp' "$EVENT_ROSTER_RECOVERY_CONFIG")"
   test "$EVENT_ROSTER_RECOVERY_CONFIG_MODE" = "600"
   corepack pnpm@10.28.1 --filter @event-roster/worker exec \
     wrangler d1 migrations list DB --remote \
     --config "$EVENT_ROSTER_RECOVERY_CONFIG"
   corepack pnpm@10.28.1 --filter @event-roster/worker exec \
     wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
     --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
   ```

   config의 `DB` binding과 `database_id`가 격리 D1인지 Cloudflare Dashboard와
   대조한 뒤 명령을 실행한다. migration ledger가 없거나 export 시점의
   배포 기록과 다르면 import가 완전하지 않은 것이므로 중단한다.
7. **`0003` 적용 이후, `0004` 적용 이전 export**는 복원 후 ledger에
   `0001`~`0003`이 있고 pending 목록에는
   `0004_automatic_project_preregistration.sql`만 있어야 한다. 이 유형은
   fresh-D1 초기화를 사용하지 않고, 격리 D1을 대상으로 backup/count 조건을
   유지한 [0004 전용 적용 게이트](deployment.md#automatic-preregistration-0004-gate)로
   이동한다. 격리 복원 검증 중에는 게이트의 각 D1 명령 대상을 운영
   `event-roster`가 아니라 `DB --config "$EVENT_ROSTER_RECOVERY_CONFIG"`로
   바꾸고, export도 격리 D1에서 만든다. 운영 config로 게이트 block을 그대로
   실행하지 않는다.
8. **`0003` 적용 이전 export**는 fresh-D1 초기화나 현재 checkout의 일반
   `migrations apply`를 사용하지 않는다. export의 migration ledger와 정확히
   일치하는 서명·보관된 release checkout에서 시작해, migration 최댓값이
   `0003_organization_leadership.sql`인 복구 artifact와 격리 D1 전용 mode
   0600 config를 사용한다. 적용 전 목록에는 export 이후부터 `0003`까지만,
   적용 후에는 현재 checkout 기준 `0004`만 pending이어야 한다. 해당 release
   artifact, 격리 config, export 시점 ledger 중 하나라도 없으면 이 유형의
   복원은 **BLOCKED**이며 운영 binding을 전환하지 않는다. 임의 SQL로 ledger를
   만들거나 현재 checkout에서 `0003`과 `0004`를 함께 적용하지 않는다.
9. **`0001`~`0004`가 적용되고 `0005` 적용 전인 export**는 운영 D1에
   덮어쓰지 않고 새 격리 D1에 import한다. 운영 config를 재사용하지 말고
   격리 D1의 `DB` binding과 `database_id`만 포함한 검토된 mode 0600
   recovery config를 사용한다. import 직후 아래 ledger와 pending 목록을
   배포 당시 기록과 대조한다.

   ```bash
   set -euo pipefail
   test -n "${EVENT_ROSTER_RECOVERY_CONFIG:?격리 D1 recovery config가 필요합니다}"
   test -n "${EVENT_ROSTER_PRE_0005_EXPORT:?pre-0005 export가 필요합니다}"
   test -f "$EVENT_ROSTER_RECOVERY_CONFIG"
   test ! -L "$EVENT_ROSTER_RECOVERY_CONFIG"
   test -s "$EVENT_ROSTER_PRE_0005_EXPORT"
   test -f "$EVENT_ROSTER_PRE_0005_EXPORT"
   test ! -L "$EVENT_ROSTER_PRE_0005_EXPORT"
   test -f "${EVENT_ROSTER_PRE_0005_EXPORT}.sha256"
   test ! -L "${EVENT_ROSTER_PRE_0005_EXPORT}.sha256"
   test "$(stat -c '%a' "$EVENT_ROSTER_RECOVERY_CONFIG" 2>/dev/null ||
     stat -f '%Lp' "$EVENT_ROSTER_RECOVERY_CONFIG")" = "600"
   test "$(stat -c '%a' "$EVENT_ROSTER_PRE_0005_EXPORT" 2>/dev/null ||
     stat -f '%Lp' "$EVENT_ROSTER_PRE_0005_EXPORT")" = "600"
   test "$(stat -c '%a' "${EVENT_ROSTER_PRE_0005_EXPORT}.sha256" 2>/dev/null ||
     stat -f '%Lp' "${EVENT_ROSTER_PRE_0005_EXPORT}.sha256")" = "600"
   shasum -a 256 -c "${EVENT_ROSTER_PRE_0005_EXPORT}.sha256"
   corepack pnpm@10.28.1 --filter @event-roster/worker exec \
     wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
     --file "$EVENT_ROSTER_PRE_0005_EXPORT"
   corepack pnpm@10.28.1 --filter @event-roster/worker exec \
     wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
     --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
   corepack pnpm@10.28.1 --filter @event-roster/worker exec \
     wrangler d1 migrations list DB --remote \
     --config "$EVENT_ROSTER_RECOVERY_CONFIG"
   ```

   ledger에는 `0001`~`0004`가 정확히 적용되어 있고 pending에는
   `0005_roster_participant_profiles.sql` 하나만 있어야 한다. 다르면
   import가 완전하지 않거나 export 유형이 다른 것이므로 중단한다.

   이어 [0005 전용 적용 gate](deployment.md#roster-participant-profiles-0005-gate)를
   격리 D1에 그대로 적용한다. gate의 모든 D1 명령 대상은
   `event-roster --remote`가 아니라
   `DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG"`로 바꾸고, 외부
   mode 0700 디렉터리의 mode 0600 export/checksum, schema-first 사전 기록,
   migration 적용 직전의 정규화된 전체 pending filename set exact 재검사,
   세 수량 일치, NULL-safe `(valid profile predicate) IS NOT TRUE` 조회의
   invalid 0, foreign-key 0행 조건을 동일하게 유지한다.
   운영 config나 운영 database ID가 명령에 남아 있으면 실행하지 않는다.

   gate 통과 후 격리 D1에만 연결된 local 또는 preview Worker로 health,
   로그인, 전체 명단 조회, legacy profile 표시, 학생/담당교사 생성·수정,
   정확한 role/grade 필터, 취소 행을 포함한 Excel 내보내기를 smoke test한다.
   smoke가 모두 통과하고 사용자 승인과 binding 대조가 끝나기 전에는 운영
   Worker binding을 전환하거나 배포하지 않는다.
10. **`0001`~`0005`가 적용되고 `0006` 적용 전인 export**는 새로 생성한
    격리 D1에만 import한다. 운영 D1이나 운영 Worker binding을 import
    대상으로 사용하지 않는다. 격리 D1의 database ID만 담은 mode 0600
    recovery config와 mode 0600 export/checksum을 준비하고 체크섬을 먼저
    검증한다. export는 배포 기록에 남긴 지속성 있는 저장소 밖 백업 경로에서
    가져와야 하며 `/tmp`, `/private/tmp`, `${TMPDIR}`의 파일은 승인된 복구
    원본으로 간주하지 않는다.

    import 직후 migration ledger에 `0001`~`0005`가 정확히 적용되어 있고
    pending 파일이 `0006_project_soft_deletion.sql` 하나뿐인지 확인한다.
    이어 사전 프로젝트 수를 기록하고, 격리 D1에만 `0006`을 적용한다.

    ```bash
    set -euo pipefail
    test -n "${EVENT_ROSTER_RECOVERY_CONFIG:?격리 D1 recovery config가 필요합니다}"
    test -n "${EVENT_ROSTER_PRE_0006_EXPORT:?pre-0006 export가 필요합니다}"
    test -f "$EVENT_ROSTER_RECOVERY_CONFIG"
    test ! -L "$EVENT_ROSTER_RECOVERY_CONFIG"
    test -s "$EVENT_ROSTER_PRE_0006_EXPORT"
    test -f "$EVENT_ROSTER_PRE_0006_EXPORT"
    test ! -L "$EVENT_ROSTER_PRE_0006_EXPORT"
    test -f "${EVENT_ROSTER_PRE_0006_EXPORT}.sha256"
    test ! -L "${EVENT_ROSTER_PRE_0006_EXPORT}.sha256"
    test "$(stat -c '%a' "$EVENT_ROSTER_RECOVERY_CONFIG" 2>/dev/null ||
      stat -f '%Lp' "$EVENT_ROSTER_RECOVERY_CONFIG")" = "600"
    test "$(stat -c '%a' "$EVENT_ROSTER_PRE_0006_EXPORT" 2>/dev/null ||
      stat -f '%Lp' "$EVENT_ROSTER_PRE_0006_EXPORT")" = "600"
    test "$(stat -c '%a' "${EVENT_ROSTER_PRE_0006_EXPORT}.sha256" 2>/dev/null ||
      stat -f '%Lp' "${EVENT_ROSTER_PRE_0006_EXPORT}.sha256")" = "600"
    shasum -a 256 -c "${EVENT_ROSTER_PRE_0006_EXPORT}.sha256"

    corepack pnpm@10.28.1 --filter @event-roster/worker exec \
      wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
      --file "$EVENT_ROSTER_PRE_0006_EXPORT"
    corepack pnpm@10.28.1 --filter @event-roster/worker exec \
      wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
      --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
    corepack pnpm@10.28.1 --filter @event-roster/worker exec \
      wrangler d1 migrations list DB --remote \
      --config "$EVENT_ROSTER_RECOVERY_CONFIG"
    corepack pnpm@10.28.1 --filter @event-roster/worker exec \
      wrangler d1 execute DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG" \
      --command "SELECT COUNT(*) AS project_count FROM projects"
    ```

    pending 집합이 정확하지 않거나 사전 수량을 기록하지 못하면 중단한다.
    격리 config를 대상으로
    [0006 전용 적용 게이트](deployment.md#project-soft-deletion-0006-gate)의
    pending 재검사와 migration apply를 수행한다. 모든 D1 명령 대상은
    `event-roster`가 아니라
    `DB --remote --config "$EVENT_ROSTER_RECOVERY_CONFIG"`여야 한다.

    적용 후 `project_count`가 사전 값과 같고 `deleted_count`가 0이며
    `PRAGMA foreign_key_check`가 행을 반환하지 않는지 확인한다. 격리 D1에
    연결한 local 또는 preview Worker에서 일반 프로젝트 목록, 조직 제외 후
    재추가, 종료 프로젝트 삭제·include-deleted 조회·복구를 smoke test한다.
    검증 결과와 사용자 승인을 확보하기 전에는 production binding을 변경하지
    않는다. 승인 뒤에도 binding의 database ID가 검증한 격리 D1과 정확히
    같은지 다시 대조한 후에만 전환한다.
11. 운영 D1의 행을 수동으로 되돌리거나 역방향 migration으로 복구하지 않는다.
   특히 production의 `participant_role_snapshot`,
   `student_grade_snapshot` 열을 수동 삭제하지 않는다. pre-0005 export는
   오직 격리 D1에 복원하고 검증하며, 실패한 운영 schema를 reverse migration
   또는 `ALTER TABLE`로 되돌리지 않는다.
   격리 D1에서 `PRAGMA foreign_key_check`가 0행인지 확인하고,
   `user_organizations.assignment_role`별 수량 합계가 복원 전 배정 수와
   같은지 확인한다. 조직별 `PRIMARY_LEADER`가 둘 이상인 조회도 0행이어야
   한다.
12. 조직, 계정, 전역 역할, 조직별 역할, 프로젝트 revision/status, 프로젝트 조직, 참가자, 명단, snapshot, 감사, session 폐기 상태를 표본 검증한다.
13. 운영자·대표 조직장·추가 관리자·미배정 조직 담당자 표본으로 [월간 점검](monthly-check.md)의 권한 matrix를 검증한다.
14. 사용자 승인과 점검 결과를 확보한 뒤에만 Worker의 D1 binding을 검증 D1 또는 승인된 복원 D1으로 전환하고 배포한다.

`0003` 전 export 복원 후 사용하는 검증 조회:

```sql
PRAGMA foreign_key_check;

SELECT assignment_role, COUNT(*)
FROM user_organizations
GROUP BY assignment_role;

SELECT organization_id, COUNT(*) AS primary_count
FROM user_organizations
WHERE assignment_role = 'PRIMARY_LEADER'
GROUP BY organization_id
HAVING COUNT(*) > 1;
```

Excel 원본은 서비스에 보관하지 않는다. Excel은 업무 데이터 복구용이며 계정·감사·세션 데이터의 D1 백업을 대체하지 않는다.
