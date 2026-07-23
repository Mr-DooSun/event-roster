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
5. `0003` 적용 전 export를 복원할 때는 격리 D1에 복원한 다음 저장소의 모든 migration을 다시 적용해 `0003_organization_leadership.sql`까지 완료한다. migration 완료 전 운영 binding을 전환하지 않는다.
6. 격리 D1에서 `PRAGMA foreign_key_check`가 0행인지 확인하고, `user_organizations.assignment_role`별 수량 합계가 복원 전 배정 수와 같은지 확인한다. 조직별 `PRIMARY_LEADER`가 둘 이상인 조회도 0행이어야 한다.
7. 조직, 계정, 전역 역할, 조직별 역할, 프로젝트 revision/status, 프로젝트 조직, 참가자, 명단, snapshot, 감사, session 폐기 상태를 표본 검증한다.
8. 운영자·대표 조직장·추가 관리자·미배정 조직 담당자 표본으로 [월간 점검](monthly-check.md)의 권한 matrix를 검증한다.
9. 사용자 승인과 점검 결과를 확보한 뒤에만 Worker의 D1 binding을 검증 D1 또는 승인된 복원 D1으로 전환하고 배포한다.

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
