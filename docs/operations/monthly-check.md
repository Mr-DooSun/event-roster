# 월간 운영 점검

월 1회 아래 항목을 기록한다. OS 인스턴스를 직접 운영하지 않으므로 서버 OS 패치는 없지만, Cloudflare 런타임·의존성·자격증명·복구 가능성은 계속 점검해야 한다.

- Cloudflare Workers와 D1 공지, compatibility date, Wrangler·런타임 보안 업데이트를 확인한다.
- `pnpm audit` 결과와 GitHub 보안 알림을 검토한다. SheetJS는 npm 0.18.5가 아니라 공식 0.20.3 tarball과 lockfile integrity가 유지되는지 확인한다.
- Workers 오류율·CPU 시간·요청량과 D1 오류·행 읽기/쓰기·저장량을 확인한다.
- Cloudflare Dashboard의 Cron Past Events에서 `0 15 * * *` 실행의 success/failure와 실패 사유를 확인한다.
- 자동 종료된 프로젝트를 표본 추출해 `close_reason = 'SCHEDULED'`와 `PROJECT_AUTO_CLOSED` 감사 기록이 함께 남았는지 확인한다.
- 사용 중인 Worker Secret 4개와 bootstrap Secret 부재를 확인한다. 값 자체를 출력하지 않는다.
- 활성 운영자·조직 담당자·조직 연결·비활성 계정을 검토하고 불필요한 계정을 비활성화한다.
- 계정 표본은 활성 운영자 한 명, `PRIMARY_LEADER` 한 명, `MANAGER` 한 명, 조직 배정이 없는 `ORGANIZATION_MANAGER` 한 명을 포함한다.
- 운영자는 조직·계정·프로젝트 관리가 가능하고, 대표와 추가 관리자는 동일하게 담당 조직의 활성 `PRE_REGISTRATION` 프로젝트 명단만 변경 가능한지 확인한다.
- 대표와 추가 관리자가 다른 조직 프로젝트를 볼 수 없고 `IN_PROGRESS`부터 읽기 전용인지 확인한다. 미배정 조직 담당자는 배정에서 파생되는 프로젝트·참가자·명단 접근이 없어야 한다.
- 대표 계정 생성·추가 관리자 배정이 참가자나 명단 행을 자동 생성하지 않았는지 표본 확인한다.
- 활성 조직당 `PRIMARY_LEADER`가 최대 한 명인지, `assignment_role` 값이 `PRIMARY_LEADER` 또는 `MANAGER`뿐인지 조회한다.
- 프로젝트별 Excel export와 D1 export의 보관 위치·체크섬·접근 권한을 확인한다.
- 최신 D1 export가 `projects`와 `project_organizations`를 포함하는지 확인하고 격리 로컬 DB에 복원한 뒤 로그인 제외 핵심 데이터(조직, 프로젝트, 프로젝트 조직, 참가자, 명단, 집계, 감사)를 표본 조회한다.
- 복구 코드 보관 담당자와 접근 가능 여부를 확인하되 코드 원문은 점검표에 기록하지 않는다.
- 저빈도 smoke는 배포 시 또는 인증 변경 시 수행한다. 월간 점검을 이유로 로그인 부하 테스트를 반복하지 않는다.

점검 결과에는 날짜, 담당자, 커밋/배포 버전, 표본 계정의 내부 ID와 역할 조합, 이상 항목, 후속 조치만 남기며 로그인 ID가 불필요하면 기록하지 않는다. 비밀번호·임시 비밀번호·토큰·해시·IP 원문은 남기지 않는다.
