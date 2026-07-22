# 월간 운영 점검

월 1회 아래 항목을 기록한다. OS 인스턴스를 직접 운영하지 않으므로 서버 OS 패치는 없지만, Cloudflare 런타임·의존성·자격증명·복구 가능성은 계속 점검해야 한다.

- Cloudflare Workers와 D1 공지, compatibility date, Wrangler·런타임 보안 업데이트를 확인한다.
- `pnpm audit` 결과와 GitHub 보안 알림을 검토한다. SheetJS는 npm 0.18.5가 아니라 공식 0.20.3 tarball과 lockfile integrity가 유지되는지 확인한다.
- Workers 오류율·CPU 시간·요청량과 D1 오류·행 읽기/쓰기·저장량을 확인한다.
- Cloudflare Dashboard의 Cron Past Events에서 `0 15 * * *` 실행의 success/failure와 실패 사유를 확인한다.
- 자동 종료된 프로젝트를 표본 추출해 `close_reason = 'SCHEDULED'`와 `PROJECT_AUTO_CLOSED` 감사 기록이 함께 남았는지 확인한다.
- 사용 중인 Worker Secret 4개와 bootstrap Secret 부재를 확인한다. 값 자체를 출력하지 않는다.
- 활성 운영자·조직 담당자·조직 연결·비활성 계정을 검토하고 불필요한 계정을 비활성화한다.
- 프로젝트별 Excel export와 D1 export의 보관 위치·체크섬·접근 권한을 확인한다.
- 최신 D1 export가 `projects`와 `project_organizations`를 포함하는지 확인하고 격리 로컬 DB에 복원한 뒤 로그인 제외 핵심 데이터(조직, 프로젝트, 프로젝트 조직, 참가자, 명단, 집계, 감사)를 표본 조회한다.
- 복구 코드 보관 담당자와 접근 가능 여부를 확인하되 코드 원문은 점검표에 기록하지 않는다.
- 저빈도 smoke는 배포 시 또는 인증 변경 시 수행한다. 월간 점검을 이유로 로그인 부하 테스트를 반복하지 않는다.

점검 결과에는 날짜, 담당자, 커밋/배포 버전, 이상 항목, 후속 조치만 남기며 비밀번호·토큰·해시·IP 원문은 남기지 않는다.
