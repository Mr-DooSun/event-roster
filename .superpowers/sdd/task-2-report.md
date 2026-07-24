# Task 2 Report: 기존 담당자 검색과 지정 상태 분리

## 구현 내용

- 기존 계정 지정 흐름에 검색 완료 여부, 검색 오류, 지정 오류를 각각 독립 상태로 추가했습니다.
- 검색 전·검색 중·빈 결과에서 후보 선택을 비활성화하고, 검색 오류와 빈 결과를 다르게 표시합니다.
- 새 검색, 검색어 변경, 다이얼로그 열기/닫기에서 후보 상태와 오류를 올바르게 초기화합니다.
- 다이얼로그를 닫거나 다시 열 때 검색 generation을 무효화하고 `AbortController`를 취소합니다.
- `mutate`가 작업별 오류 reporter를 받도록 확장했습니다. 기존 계정 지정의 API 오류와 409 충돌 메시지는 다이얼로그 안에 표시되며, 다른 담당자 mutation의 패널 메시지와 성공 후 최신 조직 재조회는 유지됩니다.
- 기존 후보 자동 선택을 제거해 명시적 선택을 요구합니다.

## 변경 파일

- `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
- `apps/web/src/features/admin/admin.test.tsx`
- `apps/web/src/app/App.test.tsx` (접근성 라벨/버튼 문구 변경에 따른 기존 회귀 테스트 동기화)

## TDD 증적

### RED

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

- 결과: exit 1, 205개 중 2개 실패.
- 기대한 실패 확인: 검색 전 `지정할 계정` select가 비활성화되지 않았고, `로그인 ID 또는 표시 이름` 라벨이 없어 새 지정 실패 시나리오가 진행되지 못했습니다.

### GREEN

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

- 결과: exit 0, 14 files / 205 tests passed.

```bash
corepack pnpm@10.28.1 --filter @event-roster/web check
```

- 결과: exit 0 (`tsc --noEmit` 및 `tsc --noEmit -p tsconfig.e2e.json`).

## stale/abort 회귀

- `aborts stale candidate searches and only ends the current search loading` 통과: 이전 요청 signal abort와 최신 응답만 반영되는 것을 확인했습니다.
- App 수준의 `keeps only the newest assignable-user search result and error`, `aborts an assignable-user search when leaving organization detail`도 위 GREEN 실행에 포함되어 통과했습니다.

## 자체 검토

- `git diff --check` 통과.
- 검색 상태는 stale generation 또는 abort된 요청에서 갱신되지 않으며, close helper와 query 변경 모두 controller와 generation을 무효화합니다.
- 409 충돌은 기존 계정 지정에서는 다이얼로그 내 reporter를 사용하고, 다른 mutation은 기본 panel reporter를 유지합니다. 성공 후 `onChanged()` 재조회 실패 메시지는 기존대로 panel에 남습니다.
- Task 3의 구획형 CSS/markup은 추가하지 않고 요구한 semantic rendering만 적용했습니다.

## 우려사항

- 이번 UI 문구 변경은 App 회귀 테스트의 selector도 변경해야 했습니다. 기능 범위는 확장하지 않았고, 동기화된 테스트는 전부 통과했습니다.
