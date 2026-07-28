# Task 10 Report — E2E, migration gate, full verification

## 구현

- `project-roster.spec.ts`에서 한 번의 제출로 동적 학생/담당교사 2행을
  생성한다. 학생은 `중2`, 담당교사는 grade 없이 등록하고 표의 profile을
  행 단위로 확인한다. 학생을 `중3`으로 수정하고 담당교사를 취소한 뒤 exact
  role/grade filter와 grade filter의 담당교사 제외를 검증한다.
- `import-export.spec.ts`에서 구형 workbook의 `참가자 구분`, `학년` 동시 누락
  거부, 혼합 profile import, 확인 전 download 0건, 필터와 무관한 전체 명단
  집계, 확인 후 실제 workbook 다운로드와 header/취소 행 보존을 검증한다.
- 전체 E2E에서 확인된 `organization-management.spec.ts`의 stale `이름`
  selector는 부모 task의 명시적 통합 범위 승인 후, 첫 동적 행 생성과
  `1번 이름`/학년 선택으로만 최소 정렬했다. 제품 코드는 변경하지 않았다.
- `deployment.md`에 기존 운영 D1의 exact-0005 pending gate, 외부 mode 0700
  backup, mode 0600 export/checksum, schema-first 사전 기록, 모든 사후 SQL과
  fail-closed Worker 배포 조건을 추가했다.
- `recovery.md`에 pre-0005 export의 checksum 검증과 격리 D1 import, ledger
  검증, 같은 0005 gate 적용, 격리 smoke를 추가했다. reverse migration과
  production의 두 profile 열 수동 삭제를 금지했다.
- root formatting gate가 지적한 이전 Task 파일 4개는 brief가 허용한 Biome
  기계적 formatting만 적용했다.

## TDD RED → GREEN

RED:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web run e2e -- \
  --grep "participant profile|import and export profile"
```

- Wrangler 쓰기/localhost 권한을 승인한 실행에서 exit 1.
- 계획의 `-- --grep`은 현재 pnpm/Playwright 조합에서 grep을 전달하지 않고
  7개 전체 테스트를 실행했다.
- 새 profile journey는 동적 행이 0개인 fixture에서 `1번 이름`을 찾지 못했고,
  import/export journey는 dialog의 동일한 `1명` 텍스트 개수 assertion이 실제
  의미별 집계와 맞지 않아 실패했다. 테스트가 새 fixture alignment 전 상태를
  실제로 거부하는 것을 확인했다.

GREEN:

```sh
corepack pnpm@10.28.1 --filter @event-roster/web run e2e \
  --grep "participant profile|import and export profile"
```

- 실제 focused 전달 형식으로 2/2 passed.
- 이후 전체 E2E에서도 두 테스트를 포함해 7/7 passed.

## 운영 gate 자체검토

- 기존 운영 D1은 remote pending에
  `0005_roster_participant_profiles.sql` 정확히 하나만 있을 때만 진행한다.
- 외부 backup directory 0700, export/checksum 0600과 checksum 검증을
  명령으로 강제한다.
- migration 전에 `PRAGMA table_info(project_roster_entries)`와 roster count를
  순서대로 기록하며, 새 열 존재 여부를 schema로 확인하기 전에 그 열을
  조회하지 않는다.
- 사후 roster count, legacy profile count, invalid profile count,
  `PRAGMA foreign_key_check`를 모두 문서화했다. pre/post/legacy 수량은
  일치하고 invalid는 0, foreign key 결과는 0행이어야 한다.
- 어느 gate라도 실패하면 Worker를 배포하지 않고 pre-0005 export를 격리
  D1에 복원한다. 격리 복원도 ledger 확인 후 동일 gate와 smoke를 통과해야
  하며 production reverse migration/열 삭제는 금지한다.

## 전체 검증

- `corepack pnpm@10.28.1 run format:check` — PASS, 257 files.
- `corepack pnpm@10.28.1 run check` — PASS, 6 workspace projects.
- `corepack pnpm@10.28.1 run test` — PASS. contracts 19, capability
  19+23, domain 13, web 305, worker 187 tests.
- `corepack pnpm@10.28.1 --filter @event-roster/web run build` — PASS,
  Vite 161 modules.
- `corepack pnpm@10.28.1 --filter @event-roster/web run e2e` — PASS, 7/7.
- `corepack pnpm@10.28.1 --filter @event-roster/worker exec wrangler deploy --dry-run`
  — controller가 명시 승인 경로로 실행해 PASS(exit 0). assets 7 files,
  894.06 KiB/gzip 152.14 KiB, D1/ASSETS/APP_ORIGIN bindings를 확인했다.
  실제 배포는 수행하지 않았다.
- `git diff --check` — PASS.

## 우려 사항

- 없음. 프로덕션 migration과 Worker 배포는 수행하지 않았다.
