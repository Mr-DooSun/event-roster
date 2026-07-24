# 비동기 로딩 피드백 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최초 조회, 재조회, 생성·수정·삭제와 엑셀 처리 중 사용자가 진행 상태를 명확히 확인하고 일시적 조회 실패를 해당 영역에서 재시도할 수 있게 한다.

**Architecture:** `Skeleton`, `LoadingStatus`, `RetryableError`와 loading 가능한 `Button`을 공통 UI 계층에 추가한다. 각 feature는 현재의 로컬 state와 request generation 패턴을 유지하면서 최초 로딩, 기존 데이터 재조회, 영역별 오류와 mutation 상태를 분리한다. API 계약과 서버 구현은 변경하지 않는다.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, 기존 CSS design tokens, Cloudflare Workers 정적 assets

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-24-loading-feedback-design.md`다.
- 백엔드 API 계약, Worker, D1 schema와 서버 데이터 처리 방식은 변경하지 않는다.
- TanStack Query 같은 데이터 조회 라이브러리나 전역 상태관리 라이브러리를 추가하지 않는다.
- 실제 데이터는 서버 성공 응답 후 반영하고 낙관적 업데이트를 도입하지 않는다.
- 최초 조회 전의 빈 배열을 빈 결과로 렌더링하지 않는다.
- 재조회 중에는 기존 데이터를 유지하고 관련 없는 화면과 동작을 차단하지 않는다.
- 오류 재시도는 실패한 영역의 요청만 다시 실행한다.
- 현재의 request generation, AbortController와 stale response 방지 규칙을 유지한다.
- 스켈레톤은 `aria-hidden="true"`, 로딩 영역은 `aria-busy`, 상태 문구는 `role="status"`와 `aria-live="polite"`를 사용한다.
- `prefers-reduced-motion: reduce`에서는 스켈레톤과 스피너 애니메이션을 제거한다.
- 모든 사용자 문구는 한국어로 작성한다.

---

## 파일 구조

### 새 파일

- `apps/web/src/components/ui/Skeleton.tsx`: 의미 없는 시각적 placeholder만 렌더링한다.
- `apps/web/src/components/ui/LoadingStatus.tsx`: 스피너와 화면 낭독기용 진행 문구를 렌더링한다.
- `apps/web/src/components/ui/RetryableError.tsx`: 영역 오류와 재시도 버튼을 결합한다.
- `apps/web/src/components/ui/LoadingFeedback.test.tsx`: 공통 로딩 UI의 동작과 접근성을 검증한다.
- `apps/web/src/features/projects/ProjectLoadingStates.tsx`: 프로젝트 카드, 상세 header와 tab용 skeleton 조합만 담당한다.

### 기존 파일

- `apps/web/src/components/ui/Button.tsx`: `loading`과 `loadingText`를 지원한다.
- `apps/web/src/styles/global.css`: skeleton, spinner, visually hidden, feature skeleton layout과 reduced-motion 스타일을 정의한다.
- `apps/web/src/app/router.tsx`, `apps/web/src/app/AppShell.tsx`: 인증 복원, lazy import와 logout 상태를 공통 UI로 표시한다.
- `apps/web/src/features/auth/*.tsx`: 인증 mutation 버튼 상태를 일관되게 표시한다.
- `apps/web/src/features/projects/*.tsx`: 프로젝트 목록·상세의 최초 로딩, 영역 재시도와 mutation 상태를 관리한다.
- `apps/web/src/features/roster/*.tsx`: 명단 표, 참가자 dialog, 이력 pagination과 엑셀 내보내기 상태를 관리한다.
- `apps/web/src/features/admin/*.tsx`: 조직·계정 조회, 검색, 상세와 mutation 상태를 관리한다.
- `apps/web/src/features/imports/ImportWizard.tsx`: 검증과 확정 진행 문구를 구분한다.
- 기존 feature test 파일: 지연 Promise 기반 상태 전환과 stale response 회귀를 검증한다.

---

### Task 1: 공통 로딩 UI 기반

**Files:**

- Create: `apps/web/src/components/ui/Skeleton.tsx`
- Create: `apps/web/src/components/ui/LoadingStatus.tsx`
- Create: `apps/web/src/components/ui/RetryableError.tsx`
- Create: `apps/web/src/components/ui/LoadingFeedback.test.tsx`
- Modify: `apps/web/src/components/ui/Button.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Produces: `Skeleton({ className?: string })`
- Produces: `LoadingStatus({ children: ReactNode, visuallyHidden?: boolean, className?: string })`
- Produces: `RetryableError({ message: string, onRetry(): void | Promise<unknown>, retrying?: boolean })`
- Produces: `ButtonProps.loading?: boolean`, `ButtonProps.loadingText?: string`
- Consumes: 기존 `StatusMessage`, 기존 button variant와 CSS token

- [ ] **Step 1: 공통 컴포넌트 실패 테스트 작성**

`apps/web/src/components/ui/LoadingFeedback.test.tsx`에 다음 사례를 작성한다.

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { LoadingStatus } from "./LoadingStatus";
import { RetryableError } from "./RetryableError";
import { Skeleton } from "./Skeleton";

afterEach(cleanup);

it("hides skeleton shapes and exposes the live loading message", () => {
  const { container } = render(
    <section aria-busy="true">
      <Skeleton className="er-skeleton--text" />
      <LoadingStatus visuallyHidden>프로젝트 불러오는 중…</LoadingStatus>
    </section>,
  );

  expect(container.querySelector(".er-skeleton")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "프로젝트 불러오는 중…",
  );
  expect(screen.getByRole("status")).toHaveClass("er-visually-hidden");
});

it("disables a loading button and replaces its visible label", () => {
  render(
    <Button loading loadingText="저장 중…" variant="primary">
      저장
    </Button>,
  );

  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
});

it("runs retry once and shows its pending label", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <RetryableError message="목록을 불러오지 못했습니다." onRetry={retry} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);

  rerender(
    <RetryableError
      message="목록을 불러오지 못했습니다."
      onRetry={retry}
      retrying
    />,
  );
  expect(screen.getByRole("button", { name: "다시 시도 중…" })).toBeDisabled();
});
```

- [ ] **Step 2: 테스트가 컴포넌트 부재로 실패하는지 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/components/ui/LoadingFeedback.test.tsx
```

Expected: `Skeleton`, `LoadingStatus`, `RetryableError` module을 찾지 못하거나 `Button`의 새 prop 동작이 없어 FAIL.

- [ ] **Step 3: 공통 컴포넌트 최소 구현**

`Skeleton.tsx`:

```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`er-skeleton ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
```

`LoadingStatus.tsx`:

```tsx
import type { ReactNode } from "react";

export function LoadingStatus({
  children,
  visuallyHidden = false,
  className = "",
}: {
  children: ReactNode;
  visuallyHidden?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`er-loading-status ${
        visuallyHidden ? "er-visually-hidden" : ""
      } ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="er-spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
```

`RetryableError.tsx`:

```tsx
import { Button } from "./Button";
import { StatusMessage } from "./StatusMessage";

export function RetryableError({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => void | Promise<unknown>;
  retrying?: boolean;
}) {
  return (
    <div className="er-retryable-error">
      <StatusMessage tone="error">{message}</StatusMessage>
      <Button
        type="button"
        loading={retrying}
        loadingText="다시 시도 중…"
        onClick={() => void onRetry()}
      >
        다시 시도
      </Button>
    </div>
  );
}
```

`Button.tsx`에서 기존 prop을 보존하며 loading을 결합한다.

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  loadingText?: string;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  className = "",
  loading = false,
  loadingText = "처리 중…",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`er-button er-button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="er-spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
```

- [ ] **Step 4: 공통 CSS 추가**

`apps/web/src/styles/global.css`의 button/status 영역에 다음 class를 추가한다.

```css
.er-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--er-space-2);
}

.er-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.er-loading-status {
  display: inline-flex;
  align-items: center;
  gap: var(--er-space-2);
  color: var(--er-color-muted);
}

.er-spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  animation: er-spin 0.75s linear infinite;
}

.er-skeleton {
  display: block;
  min-height: 1rem;
  border-radius: var(--er-radius-sm);
  background: linear-gradient(
    90deg,
    var(--er-color-info-soft) 25%,
    var(--er-color-border) 50%,
    var(--er-color-info-soft) 75%
  );
  background-size: 200% 100%;
  animation: er-skeleton-shimmer 1.4s ease-in-out infinite;
}

.er-skeleton--text {
  width: min(100%, 12rem);
  height: 1rem;
}

.er-retryable-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--er-space-3);
}

@keyframes er-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes er-skeleton-shimmer {
  to {
    background-position-x: -200%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .er-spinner,
  .er-skeleton {
    animation: none;
  }
}
```

- [ ] **Step 5: 공통 컴포넌트 테스트와 type check 통과 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/components/ui/LoadingFeedback.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web check
```

Expected: 새 테스트 PASS, TypeScript error 0.

- [ ] **Step 6: 공통 UI 커밋**

```bash
git add apps/web/src/components/ui/Button.tsx apps/web/src/components/ui/Skeleton.tsx apps/web/src/components/ui/LoadingStatus.tsx apps/web/src/components/ui/RetryableError.tsx apps/web/src/components/ui/LoadingFeedback.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add shared loading feedback components"
```

---

### Task 2: 인증과 앱 셸의 mutation 피드백

**Files:**

- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `apps/web/src/features/auth/ChangePasswordPage.tsx`
- Modify: `apps/web/src/features/auth/RecoveryPage.tsx`
- Modify: `apps/web/src/features/auth/BootstrapHandoffPage.tsx`
- Test: `apps/web/src/features/auth/auth.test.tsx`
- Test: `apps/web/src/app/App.test.tsx`

**Interfaces:**

- Consumes: `LoadingStatus`, `Button.loading`, `Button.loadingText`
- Produces: 인증 요청별 로컬 `submitting` state와 중복 submit guard
- Preserves: `AuthProvider`의 session 복원, 인증 오류와 logout 처리

- [ ] **Step 1: 지연된 인증 요청 실패 테스트 작성**

`auth.test.tsx`에 로그인과 비밀번호 변경의 pending 상태를 검증한다.

```tsx
it("shows pending feedback and prevents duplicate login submission", async () => {
  let resolveLogin: ((value: Response) => void) | undefined;
  const pendingLogin = new Promise<Response>((resolve) => {
    resolveLogin = resolve;
  });
  const fetchMock = vi.fn(() => pendingLogin);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <LoginPage />
    </AuthProvider>,
  );

  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: "operator" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "password-1234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  const pendingButton = screen.getByRole("button", { name: "로그인 중…" });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  resolveLogin?.(Response.json(auth()));
  await screen.findByText("프로젝트");
});
```

`App.test.tsx`에는 `status === "RESTORING"`일 때 `role="status"`와
`로그인 상태 확인 중…`이 노출되는 assertion을 추가한다.

- [ ] **Step 2: 새 인증 테스트의 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Expected: 공통 loading button 또는 status assertion이 없어 FAIL.

- [ ] **Step 3: 인증 페이지 상태를 공통 Button으로 통일**

각 submit 함수는 validation 통과 뒤에만 `submitting`을 `true`로 만들고
`try/finally`에서 복원한다. 예를 들어 `ChangePasswordPage`는 다음 구조를
사용한다.

```tsx
const [submitting, setSubmitting] = useState(false);

async function submit(event: FormEvent) {
  event.preventDefault();
  if (submitting) return;
  const parsed = PasswordSchema.safeParse(newPassword);
  if (!parsed.success) {
    setValidation(
      parsed.error.issues[0]?.message ?? "새 비밀번호를 확인해 주세요.",
    );
    return;
  }
  if (newPassword !== confirmNewPassword) {
    setValidation("새 비밀번호가 일치하지 않습니다.");
    return;
  }
  setSubmitting(true);
  try {
    await changePassword(currentPassword, parsed.data);
  } finally {
    setSubmitting(false);
  }
}
```

버튼은 페이지별 문구를 사용한다.

```tsx
<Button
  type="submit"
  variant="primary"
  loading={submitting}
  loadingText="비밀번호 변경 중…"
>
  비밀번호 변경
</Button>
```

동일 패턴을 다음 문구로 적용한다.

- Login: `로그인 중…`
- Recovery: `비밀번호 재설정 중…`
- Bootstrap handoff: `운영자 계정 만드는 중…`

Bootstrap submit은 `if (submitting) return` guard와 `try/finally`를
포함한다. 실패해도 loginId와 displayName을 지우지 않는다.

- [ ] **Step 4: 앱 셸 상태 표시 교체**

`router.tsx`의 인증 복원 fallback과 `AppShell.tsx`의 lazy import fallback을
`LoadingStatus`로 교체한다.

```tsx
if (status === "RESTORING") {
  return (
    <main className="er-loading" aria-busy="true">
      <LoadingStatus>로그인 상태 확인 중…</LoadingStatus>
    </main>
  );
}
```

```tsx
<Suspense
  fallback={
    <LoadingStatus className="er-panel-loading">
      엑셀 도구 불러오는 중…
    </LoadingStatus>
  }
>
  <ImportWizard projectId={decodeURIComponent(importMatch[1])} />
</Suspense>
```

`AppShell` logout button에는 로컬 `loggingOut` state를 추가하고
`로그아웃 중…`을 표시한다.

- [ ] **Step 5: 인증과 앱 테스트 통과 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/auth/auth.test.tsx src/app/App.test.tsx
```

Expected: 관련 테스트 PASS, 중복 인증 요청 1회.

- [ ] **Step 6: 인증 피드백 커밋**

```bash
git add apps/web/src/app/router.tsx apps/web/src/app/AppShell.tsx apps/web/src/features/auth/LoginPage.tsx apps/web/src/features/auth/ChangePasswordPage.tsx apps/web/src/features/auth/RecoveryPage.tsx apps/web/src/features/auth/BootstrapHandoffPage.tsx apps/web/src/features/auth/auth.test.tsx apps/web/src/app/App.test.tsx
git commit -m "feat: show progress for authentication actions"
```

---

### Task 3: 프로젝트 목록의 최초 로딩·재조회·재시도

**Files:**

- Create: `apps/web/src/features/projects/ProjectLoadingStates.tsx`
- Modify: `apps/web/src/features/projects/ProjectsPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectFormDialog.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/projects/projects.test.tsx`

**Interfaces:**

- Produces: `ProjectGridSkeleton()`, `ProjectHeaderSkeleton()`, `ProjectTabSkeleton({ kind })`
- Consumes: `Skeleton`, `LoadingStatus`, `RetryableError`, `Button.loading`
- Preserves: `/projects` 응답 순서와 `loadGeneration` stale response guard

- [ ] **Step 1: 프로젝트 목록 상태 테스트 작성**

`projects.test.tsx`에 deferred helper와 다음 테스트를 추가한다.

```tsx
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

it("shows project skeletons before deciding the list is empty", async () => {
  const request = deferred<(typeof projectFixture)[]>();
  mockApi.get.mockReturnValueOnce(request.promise);
  render(<ProjectsPage />);

  expect(screen.getByRole("status")).toHaveTextContent(
    "프로젝트 불러오는 중…",
  );
  expect(screen.getByTestId("project-grid-skeleton")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(screen.queryByText("등록된 프로젝트가 없습니다.")).not.toBeInTheDocument();

  await act(async () => request.resolve([]));
  expect(screen.getByText("등록된 프로젝트가 없습니다.")).toBeVisible();
});

it("retries a failed project list request", async () => {
  mockApi.get
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([projectFixture]);
  render(<ProjectsPage />);

  fireEvent.click(
    await screen.findByRole("button", { name: "다시 시도" }),
  );
  expect(await screen.findByText(projectFixture.name)).toBeVisible();
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});

it("keeps existing projects visible while reloading after create", async () => {
  const reload = deferred<(typeof projectFixture)[]>();
  mockApi.get
    .mockResolvedValueOnce([projectFixture])
    .mockReturnValueOnce(reload.promise);
  mockApi.post.mockResolvedValueOnce(projectFixture);
  render(<ProjectsPage />);

  await screen.findByText(projectFixture.name);
  fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "새 프로젝트" },
  });
  fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

  expect(await screen.findByText(projectFixture.name)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("새로고침 중…");
  await act(async () => reload.resolve([projectFixture]));
});
```

- [ ] **Step 2: 프로젝트 목록 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/projects/projects.test.tsx
```

Expected: skeleton test id, 빈 상태와 retry UI가 없어 FAIL.

- [ ] **Step 3: 프로젝트 skeleton 조합 구현**

`ProjectLoadingStates.tsx`에 여섯 카드짜리 grid와 상세용 export를 만든다.
이 task에서는 `ProjectGridSkeleton`만 화면에 연결하고 나머지는 Task 4에서
사용한다.

```tsx
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { Skeleton } from "../../components/ui/Skeleton";

export function ProjectGridSkeleton() {
  return (
    <div
      className="er-project-grid"
      data-testid="project-grid-skeleton"
      aria-busy="true"
    >
      <LoadingStatus visuallyHidden>프로젝트 불러오는 중…</LoadingStatus>
      {Array.from({ length: 6 }, (_, index) => (
        <div className="er-project-card er-project-card--skeleton" key={index}>
          <Skeleton className="er-skeleton--badge" />
          <Skeleton className="er-skeleton--title" />
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text er-skeleton--short" />
        </div>
      ))}
    </div>
  );
}
```

같은 파일에 `ProjectHeaderSkeleton`과
`ProjectTabSkeleton({ kind: "cards" | "list" | "table" })`을 명시적으로
구현한다. table kind는 실제 `<table>`을 만들지 않고 header와 여섯 행
block을 렌더링해 잘못된 table semantic을 피한다.

- [ ] **Step 4: 프로젝트 목록 상태 구현**

`ProjectsPage`에 다음 상태를 추가한다.

```tsx
type ListLoadState = "INITIAL" | "REFRESHING" | null;

const [loadState, setLoadState] = useState<ListLoadState>("INITIAL");
const hasLoaded = useRef(false);
```

`load` 시작 시 `hasLoaded.current`에 따라 상태를 설정하고, 현재 generation의
finally에서만 종료한다.

```tsx
const load = useCallback(async () => {
  const generation = ++loadGeneration.current;
  setLoadState(hasLoaded.current ? "REFRESHING" : "INITIAL");
  try {
    const nextProjects = await api.get<Project[]>("/projects");
    if (generation !== loadGeneration.current) return;
    setProjects(nextProjects);
    hasLoaded.current = true;
    setError(null);
  } catch {
    if (generation === loadGeneration.current) {
      setError("프로젝트 목록을 불러오지 못했습니다.");
    }
  } finally {
    if (generation === loadGeneration.current) setLoadState(null);
  }
}, [api]);
```

render 규칙:

```tsx
{loadState === "INITIAL" && !hasLoaded.current ? (
  <ProjectGridSkeleton />
) : error && !hasLoaded.current ? (
  <RetryableError
    message={error}
    retrying={loadState === "INITIAL"}
    onRetry={load}
  />
) : (
  <>
    {loadState === "REFRESHING" ? (
      <LoadingStatus>새로고침 중…</LoadingStatus>
    ) : null}
    {projects.length === 0 ? (
      <Card className="er-panel">
        <p className="er-muted">등록된 프로젝트가 없습니다.</p>
      </Card>
    ) : (
      <div className="er-project-grid">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    )}
  </>
)}
```

재조회 실패에서는 `hasLoaded.current === true`이므로 기존 grid 위에
`RetryableError`를 표시한다.

- [ ] **Step 5: 프로젝트 생성 버튼을 공통 loading Button으로 교체**

`ProjectFormDialog`의 submit button을 다음처럼 바꾼다.

```tsx
<Button
  type="submit"
  variant="primary"
  disabled={!name.trim() || reversed}
  loading={busy}
  loadingText="만드는 중…"
>
  프로젝트 만들기
</Button>
```

`ProjectLoadingStates`용 `.er-project-card--skeleton`,
`.er-skeleton--badge`, `.er-skeleton--title`,
`.er-skeleton--short` 스타일을 실제 card 높이에 맞춰 추가한다.

- [ ] **Step 6: 프로젝트 목록 테스트와 기존 stale response 테스트 통과**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/projects/projects.test.tsx
```

Expected: 새 로딩 테스트와 기존 응답 순서·stale response 테스트 모두 PASS.

- [ ] **Step 7: 프로젝트 목록 커밋**

```bash
git add apps/web/src/features/projects/ProjectLoadingStates.tsx apps/web/src/features/projects/ProjectsPage.tsx apps/web/src/features/projects/ProjectFormDialog.tsx apps/web/src/features/projects/projects.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add project list loading states"
```

---

### Task 4: 프로젝트 상세의 독립적인 영역 로딩과 재시도

**Files:**

- Modify: `apps/web/src/features/projects/ProjectDetailPage.tsx`
- Modify: `apps/web/src/features/projects/ProjectLoadingStates.tsx`
- Modify: `apps/web/src/features/projects/ProjectEditDialog.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`
- Test: `apps/web/src/features/projects/ProjectEditDialog.test.tsx`

**Interfaces:**

- Consumes: `ProjectHeaderSkeleton`, `ProjectTabSkeleton`, `RetryableError`, `LoadingStatus`
- Produces: `DetailLoading = Partial<Record<DetailResource, boolean>>`
- Produces: `retryProject()`, `retryTab(tab: ProjectTab)`
- Preserves: 병렬 request, `loadGeneration`, projectId context와 resource별 오류 문구

- [ ] **Step 1: 상세 최초 로딩과 독립 영역 테스트 작성**

`project-detail.test.tsx`에 project request와 summary request를 독립적으로
지연하는 테스트를 추가한다.

```tsx
it("shows the project shell before a slower overview resource completes", async () => {
  const summary = deferred<ReturnType<typeof emptySummary>>();
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/summary") return summary.promise;
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);

  expect(
    await screen.findByRole("heading", { name: project.name }),
  ).toBeVisible();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent(
    "프로젝트 개요 불러오는 중…",
  );

  await act(async () => summary.resolve(emptySummary("project-1")));
  expect(screen.getByRole("heading", { name: "프로젝트 개요" })).toBeVisible();
});

it("retries only the failed audit resource", async () => {
  let auditReads = 0;
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/projects/project-1/audit?limit=50") {
      auditReads += 1;
      if (auditReads === 1) return Promise.reject(new Error("offline"));
      return Promise.resolve({ items: [auditItem("재시도 성공")], nextCursor: null });
    }
    return defaultGet(path);
  });
  render(<ProjectDetailPage projectId="project-1" />);

  fireEvent.click(await screen.findByRole("tab", { name: "변경 이력" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "다시 시도" }),
  );
  expect(await screen.findByText("재시도 성공")).toBeVisible();
  expect(auditReads).toBe(2);
});
```

기존 `emptySummary(projectId)` helper를 그대로 사용한다.

- [ ] **Step 2: 상세 로딩 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/projects/project-detail.test.tsx
```

Expected: project shell이 모든 resource를 기다리거나 tab skeleton/retry가 없어 FAIL.

- [ ] **Step 3: resource loading map과 단일 resource loader 구현**

`ProjectDetailPage`에 다음 state를 추가한다.

```tsx
type DetailLoading = Partial<Record<DetailResource, boolean>>;

const [resourceLoading, setResourceLoading] = useState<DetailLoading>({});
const [projectLoading, setProjectLoading] = useState(true);
const [projectRefreshing, setProjectRefreshing] = useState(false);
```

기존 `loadResource`는 시작·종료 상태를 현재 context에서만 갱신한다.

```tsx
const loadResource = useCallback(
  async <T,>(
    context: RequestContext,
    resource: DetailResource,
    request: () => Promise<T>,
    apply: (value: T) => void,
  ) => {
    if (!isCurrent(context)) return false;
    setResourceLoading((current) => ({ ...current, [resource]: true }));
    setResourceErrors((current) => {
      const next = { ...current };
      delete next[resource];
      return next;
    });
    try {
      const value = await request();
      if (!isCurrent(context)) return false;
      apply(value);
      return true;
    } catch {
      if (!isCurrent(context)) return false;
      setResourceErrors((current) => ({
        ...current,
        [resource]: RESOURCE_ERROR_MESSAGE[resource],
      }));
      return false;
    } finally {
      if (isCurrent(context)) {
        setResourceLoading((current) => ({
          ...current,
          [resource]: false,
        }));
      }
    }
  },
  [isCurrent],
);
```

`load()`은 project와 여섯 resource 요청을 계속 `Promise.all`로 시작하지만,
project 응답이 오면 즉시 header/tabs를 렌더링한다. 전체 `loading` boolean은
제거한다.

- [ ] **Step 4: tab별 retry mapping 구현**

각 resource의 request와 apply를 한 곳에서 재사용할 수 있게
`loadDetailResource(context, resource)` switch를 만든다. 모든 case는
`loadResource`를 호출하고 `default`에 도달하지 않는 exhaustive check를
사용한다.

```tsx
const retryTab = useCallback(
  async (tab: ProjectTab) => {
    const context = { projectId, generation: loadGeneration.current };
    const failed = TAB_RESOURCES[tab].filter(
      (resource) => resourceErrors[resource],
    );
    await Promise.all(
      failed.map((resource) => loadDetailResource(context, resource)),
    );
  },
  [loadDetailResource, projectId, resourceErrors],
);
```

프로젝트 자체 실패는 `RetryableError`에서 전체 `load()`를 다시 호출한다.
tab 실패는 `retryTab(selectedTab)`만 실행한다.

- [ ] **Step 5: 상세 skeleton과 상태 render 연결**

render 순서는 다음과 같이 고정한다.

```tsx
if (projectLoading && !project) {
  return <ProjectHeaderSkeleton />;
}
if (!project) {
  return (
    <RetryableError
      message={projectLoadError ?? "프로젝트 정보를 불러오지 못했습니다."}
      retrying={projectLoading}
      onRetry={load}
    />
  );
}
```

선택 tab의 resource 중 하나라도 loading이면 `ProjectTabSkeleton`을
렌더링한다. 이미 해당 tab 데이터가 있는 `projectRefreshing` 상황에는
기존 콘텐츠 위에 `LoadingStatus>새로고침 중…</LoadingStatus>`만 표시한다.
오류가 있으면 `RetryableError` 하나에 오류 문구를 줄바꿈 없이 결합하고
재시도한다.

`ProjectEditDialog`의 저장 버튼은 `loading={busy}`,
`loadingText="저장 중…"`을 사용한다. 프로젝트 상태 변경 dialog에는
`transitioning` state와 `변경 중…`을 추가하며 중복 click을 막는다.

- [ ] **Step 6: 상세 테스트와 기존 context race 테스트 통과**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/projects/project-detail.test.tsx src/features/projects/ProjectEditDialog.test.tsx
```

Expected: 새 영역별 loading/retry 테스트, project 전환 race와 기존 오류 격리 테스트 PASS.

- [ ] **Step 7: 프로젝트 상세 커밋**

```bash
git add apps/web/src/features/projects/ProjectDetailPage.tsx apps/web/src/features/projects/ProjectLoadingStates.tsx apps/web/src/features/projects/ProjectEditDialog.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/features/projects/ProjectEditDialog.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add independent project detail loading states"
```

---

### Task 5: 참가 명단·연결 조직·변경 이력 진행 상태

**Files:**

- Modify: `apps/web/src/features/projects/ProjectOrganizationsPanel.tsx`
- Modify: `apps/web/src/features/roster/ProjectRosterPage.tsx`
- Modify: `apps/web/src/features/roster/RosterTable.tsx`
- Modify: `apps/web/src/features/roster/ParticipantDialog.tsx`
- Modify: `apps/web/src/features/roster/ParticipantEditDialog.tsx`
- Modify: `apps/web/src/features/roster/AuditPanel.tsx`
- Test: `apps/web/src/features/projects/project-detail.test.tsx`
- Test: `apps/web/src/features/roster/roster.test.tsx`
- Test: `apps/web/src/features/imports/export.test.ts`

**Interfaces:**

- Produces: `RosterTable.busyRowIds?: ReadonlySet<string>`
- Produces: `AuditPanel.loadingMore?: boolean`
- Consumes: `Button.loading`, `LoadingStatus`, parent `onChanged()`
- Preserves: project revision 충돌, stale revision 복구와 mutation 후 전체 상세 reload

- [ ] **Step 1: 행·dialog·내보내기 pending 테스트 작성**

`roster.test.tsx`에 status request를 지연해 해당 행 버튼만 pending이 되는
테스트를 작성한다.

```tsx
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const pendingStatus = deferred<void>();

function PendingRosterHarness() {
  const [busyRowIds, setBusyRowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const first = entry("ACTIVE");
  const second = {
    ...entry("ACTIVE"),
    id: "entry-2",
    participantId: "person-2",
    participantName: "다른 참가자",
    participantNumber: "P-002",
  };
  async function change(row: RosterView) {
    setBusyRowIds((current) => new Set(current).add(row.id));
    try {
      await pendingStatus.promise;
    } finally {
      setBusyRowIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }
  return (
    <RosterTable
      rows={[first, second]}
      canMutate
      busyRowIds={busyRowIds}
      onStatusChange={change}
      onEdit={vi.fn()}
    />
  );
}

it("shows the pending roster row without removing the table", async () => {
  render(<PendingRosterHarness />);

  fireEvent.click(screen.getByRole("button", { name: "박민수 취소" }));
  expect(
    screen.getByRole("button", { name: "변경 중…" }),
  ).toBeDisabled();
  expect(screen.getByText("박민수")).toBeVisible();
  expect(screen.getByRole("button", { name: "다른 참가자 취소" })).toBeEnabled();

  await act(async () => pendingStatus.resolve(undefined));
});
```

이 test 파일 import에 React `useState`, `RosterTable`, `RosterView`를
추가한다. 참가자 추가 dialog는 별도의 deferred `onAdd` 중
`명단에 추가 중…`이 보이고
두 번째 click이 callback을 다시 호출하지 않는 테스트를 추가한다.
내보내기는 API 응답 전 `내보내는 중…`과 기존 명단 유지 여부를 검증한다.

- [ ] **Step 2: roster pending 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/roster/roster.test.tsx src/features/imports/export.test.ts
```

Expected: row/dialog/export loading 문구가 없어 FAIL.

- [ ] **Step 3: roster operation key와 row 상태 연결**

`ProjectRosterPage`에 행별 mutation set과 export state를 둔다.

```tsx
const [busyRowIds, setBusyRowIds] = useState<ReadonlySet<string>>(
  () => new Set(),
);
const [exporting, setExporting] = useState(false);
```

`changeStatus`는 해당 row id를 set에 추가하고 `try/finally`에서 그 id만
제거한다. 이미 set에 있는 row의 중복 요청은 즉시 반환한다.
`RosterTable`에는 다음 prop을 전달한다.

```tsx
<RosterTable
  rows={rows}
  canMutate={canMutate}
  busyRowIds={busyRowIds}
  canMutateRow={canMutateRow}
  onStatusChange={changeStatus}
  onEdit={edit}
/>
```

`RosterTable`의 status button:

```tsx
<Button
  type="button"
  variant={row.status === "ACTIVE" ? "danger" : "secondary"}
  loading={busyRowIds?.has(row.id)}
  loadingText="변경 중…"
  onClick={() =>
    void onStatusChange(
      row,
      row.status === "ACTIVE" ? "CANCELLED" : "ACTIVE",
    )
  }
>
  {row.participantName} {row.status === "ACTIVE" ? "취소" : "복원"}
</Button>
```

다른 행은 활성 상태를 유지한다. 같은 row의 정보 수정 버튼만
`disabled={busyRowIds?.has(row.id)}`로 막는다.

- [ ] **Step 4: 참가자 dialog와 export 상태 구현**

`ParticipantDialog`는 `busy: "EXISTING" | "NEW" | null`을, edit dialog는
boolean busy를 로컬로 관리한다. callback을 `try/finally`로 await하고 버튼에
각각 `명단에 추가 중…`, `참가자 만드는 중…`, `정보 저장 중…`을 표시한다.

`exportRoster`는 별도 `exporting` state로 보호하고 다음 버튼을 사용한다.

```tsx
<Button
  type="button"
  loading={exporting}
  loadingText="내보내는 중…"
  onClick={() => void exportRoster()}
>
  엑셀 내보내기
</Button>
```

실패하면 기존 rows와 filter 입력을 유지한다.

- [ ] **Step 5: 연결 조직 mutation 문구 구현**

`ProjectOrganizationsPanel`은 기존 `busy`를 유지하되 각 버튼에 동작별
loading prop을 전달할 수 있도록 `busyAction`을 추가한다.

```tsx
type OrganizationAction =
  | "ADD_EXISTING"
  | "CREATE_AND_ADD"
  | `TOGGLE:${string}`
  | null;

const [busyAction, setBusyAction] = useState<OrganizationAction>(null);
```

기존 조직 추가는 `프로젝트에 추가 중…`, 새 조직은 `생성 후 추가 중…`,
membership row는 `변경 중…`을 표시한다. `busy` 중 전체 combobox mutation
중복은 계속 막지만 관련 버튼에만 spinner를 표시한다.

- [ ] **Step 6: AuditPanel pagination 상태 구현**

`AuditPanel` prop에 `loadingMore?: boolean`을 추가하고 다음 버튼을 쓴다.

```tsx
{nextCursor || loadingMore ? (
  <Button
    type="button"
    loading={loadingMore}
    loadingText="더 불러오는 중…"
    onClick={() => void onLoadMore()}
  >
    이력 더 보기
  </Button>
) : null}
```

`ProjectDetailPage`와 `OrganizationDetailPage`가 각각 pagination request
ref와 별도의 boolean state를 동기화한다. 실패하면 cursor를 유지하고
`RetryableError`의 재시도가 `loadMoreAudit`만 호출하게 한다.

- [ ] **Step 7: roster·조직 연결·이력 테스트 통과**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/roster/roster.test.tsx src/features/projects/project-detail.test.tsx src/features/imports/export.test.ts
```

Expected: pending UI, 중복 방지, 기존 stale revision·pagination lock 테스트 모두 PASS.

- [ ] **Step 8: 명단과 조직 동작 커밋**

```bash
git add apps/web/src/features/projects/ProjectOrganizationsPanel.tsx apps/web/src/features/roster/ProjectRosterPage.tsx apps/web/src/features/roster/RosterTable.tsx apps/web/src/features/roster/ParticipantDialog.tsx apps/web/src/features/roster/ParticipantEditDialog.tsx apps/web/src/features/roster/AuditPanel.tsx apps/web/src/features/projects/project-detail.test.tsx apps/web/src/features/roster/roster.test.tsx apps/web/src/features/imports/export.test.ts
git commit -m "feat: show roster and audit operation progress"
```

---

### Task 6: 조직 관리 조회·검색·상세 로딩

**Files:**

- Modify: `apps/web/src/features/admin/OrganizationsPage.tsx`
- Modify: `apps/web/src/features/admin/OrganizationDetailPage.tsx`
- Modify: `apps/web/src/features/admin/OrganizationManagersPanel.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/admin/admin.test.tsx`

**Interfaces:**

- Consumes: `Skeleton`, `LoadingStatus`, `RetryableError`, `Button.loading`
- Produces: 조직 목록 `loadState`, 상세 `detailLoading`, `auditLoading`, 검색 `searching`
- Preserves: detail/audit generation 분리, candidate AbortController와 manager mutation lock

- [ ] **Step 1: 조직 목록 최초 로딩과 검색 재조회 테스트 작성**

`admin.test.tsx`에 다음 테스트를 추가한다.

```tsx
it("distinguishes organization loading from an empty result", async () => {
  const organizations = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.includes("/organizations?")) return organizations.promise;
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();

  expect(screen.getByRole("status")).toHaveTextContent("조직 불러오는 중…");
  expect(screen.queryByText("조건에 맞는 조직이 없습니다.")).not.toBeInTheDocument();

  organizations.resolve(Response.json([]));
  expect(
    await screen.findByText("조건에 맞는 조직이 없습니다."),
  ).toBeVisible();
});

it("keeps organization results visible while applying filters", async () => {
  const second = deferred<Response>();
  let organizationReads = 0;
  const summary = {
    id: "org-1",
    name: "1팀",
    isActive: true,
    primaryLeader: null,
    managerCount: 2,
    projectCount: 3,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return Promise.resolve(Response.json(auth()));
    }
    if (url.includes("/organizations?")) {
      organizationReads += 1;
      return organizationReads === 1
        ? Promise.resolve(Response.json([summary]))
        : second.promise;
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <OrganizationsPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await screen.findByText("1팀");

  fireEvent.submit(screen.getByRole("form", { name: "조직 검색 및 필터" }));
  expect(screen.getByText("1팀")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("검색 중…");
  second.resolve(Response.json([]));
});
```

기존 `auth()`, `login()`, `Gate`와 `deferred()` helper를 재사용한다.

- [ ] **Step 2: 조직 loading 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

Expected: 최초 skeleton/loading status와 검색 중 표시가 없어 FAIL.

- [ ] **Step 3: 조직 목록 상태 구현**

`OrganizationsPage`에 `hasLoaded`, `loading`, `refreshing`, `creating`을
추가한다. `load`는 현재 generation에서만 상태를 종료한다.

최초 조회는 조직 card skeleton 여섯 개를 렌더링하고, 검색은 기존
`organizations`를 유지한 채 filter form에 `aria-busy="true"`와
`LoadingStatus>검색 중…</LoadingStatus>`를 표시한다.

오류는 데이터 유무에 관계없이 `RetryableError`를 표시한다. 기존 데이터가
있으면 card 목록을 그대로 둔다. 새 조직 submit 버튼은
`loading={creating}`, `loadingText="조직 만드는 중…"`을 사용하고 실패 시
name을 유지한다.

- [ ] **Step 4: 조직 상세 최초 로딩과 영역별 재시도 구현**

`OrganizationDetailPage`에 다음 state를 추가한다.

```tsx
const [detailLoading, setDetailLoading] = useState(true);
const [auditLoading, setAuditLoading] = useState(true);
const [mutating, setMutating] = useState<"RENAME" | "STATUS" | null>(null);
const [auditLoadingMore, setAuditLoadingMore] = useState(false);
```

`loadDetail`과 `loadInitialAudit`은 각 generation의 `finally`에서 loading을
종료한다. 상세가 없고 loading이면 header/card skeleton을, 실패면
`RetryableError onRetry={loadDetail}`을 표시한다. audit 오류는 조직
정보를 가리지 않고 audit 영역에서 `loadInitialAudit`만 재시도한다.

이름 저장은 `저장 중…`, 상태 변경은 `변경 중…`을 사용하고 기존
organization 정보를 요청 중에도 유지한다.

- [ ] **Step 5: 조직 담당자 검색과 mutation 문구 구현**

`OrganizationManagersPanel`에 `searchingCandidates`를 추가하고
AbortController의 현재 generation에서만 종료한다.

```tsx
<Button
  type="submit"
  loading={searchingCandidates}
  loadingText="계정 찾는 중…"
  disabled={isMutating}
>
  계정 찾기
</Button>
```

기존 `isMutating`은 유지하고 dialog별 실행 버튼에 `loading={isMutating}`과
다음 문구를 연결한다.

- `담당자로 지정 중…`
- `계정 발급 및 지정 중…`
- `대표 변경 중…`
- `담당 해제 중…`
- `대표 해제 중…`

후속 detail/audit 재조회 중에도 기존 조직과 담당자 목록을 유지한다.

- [ ] **Step 6: 조직 관리 테스트 통과 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

Expected: 조직 목록·상세·검색·재시도와 기존 담당자 동시성 테스트 PASS.

- [ ] **Step 7: 조직 관리 커밋**

```bash
git add apps/web/src/features/admin/OrganizationsPage.tsx apps/web/src/features/admin/OrganizationDetailPage.tsx apps/web/src/features/admin/OrganizationManagersPanel.tsx apps/web/src/features/admin/admin.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add organization management loading feedback"
```

---

### Task 7: 계정 관리의 표 로딩과 행 단위 작업 상태

**Files:**

- Modify: `apps/web/src/features/admin/UsersPage.tsx`
- Modify: `apps/web/src/features/admin/UserForm.tsx`
- Modify: `apps/web/src/features/admin/UserEditRow.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/features/admin/admin.test.tsx`

**Interfaces:**

- Produces: `UserForm.onSubmit(input): Promise<boolean>`
- Produces: `UserEditRow.onSave(id, input): Promise<boolean>`
- Produces: `UserEditRow.onReset(id): Promise<boolean>`
- Produces: `UserEditRow` 내부 `busyAction: "SAVE" | "RESET" | null`
- Consumes: `RetryableError`, `LoadingStatus`, `Skeleton`, `Button.loading`
- Preserves: 임시 비밀번호의 일회성 dialog와 기존 user payload

- [ ] **Step 1: 계정 목록·행 작업 pending 테스트 작성**

`admin.test.tsx`에 목록 요청 지연 시 table header와 skeleton row가 보이고
빈 tbody로 오해되지 않는 테스트를 추가한다. 별도로 PATCH를 지연해 수정한
행의 저장 버튼만 `저장 중…`으로 바뀌고 다른 행은 활성 상태인지 검증한다.

```tsx
it("shows a pending state only on the edited account row", async () => {
  const patch = deferred<Response>();
  const users = [
    {
      id: "user-1",
      loginId: "staff-01",
      displayName: "첫 담당자",
      role: "ORGANIZATION_MANAGER",
      isActive: true,
      organizationIds: [],
    },
    {
      id: "user-2",
      loginId: "staff-02",
      displayName: "둘째 담당자",
      role: "ORGANIZATION_MANAGER",
      isActive: true,
      organizationIds: [],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return Promise.resolve(Response.json(auth()));
      }
      if (url.endsWith("/users/user-1") && init?.method === "PATCH") {
        return patch.promise;
      }
      if (url.endsWith("/users")) {
        return Promise.resolve(Response.json(users));
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  render(
    <AuthProvider restoreOnMount={false}>
      <Gate>
        <UsersPage />
      </Gate>
    </AuthProvider>,
  );
  await login();
  await screen.findByLabelText("staff-01 표시 이름");

  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  expect(screen.getByLabelText("staff-02 표시 이름")).toBeEnabled();

  patch.resolve(Response.json({ id: "user-1" }));
});
```

helper는 두 user를 포함한 완전한 response와 auth login response를 반환한다.

- [ ] **Step 2: 계정 loading 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

Expected: table skeleton과 행별 loading 상태가 없어 FAIL.

- [ ] **Step 3: UsersPage 조회 상태와 retry 구현**

`UsersPage`에 `loading`, `refreshing`, `hasLoaded`를 추가한다. 최초 조회는
table header를 유지하고 다섯 개 skeleton row를 tbody에 렌더링한다.
첫 요청 실패는 table card 안에서 `RetryableError onRetry={load}`를
표시한다. mutation 후 재조회는 기존 rows와 `새로고침 중…`을 유지한다.
성공한 최초 조회의 `users.length === 0`일 때만 table body를 대신해
`등록된 계정이 없습니다.`를 표시한다.

`create`, `saveUser`, `reset`은 성공 시 `true`, 실패 시 `false`를
반환한다.

```tsx
async function saveUser(
  userId: string,
  input: Pick<UserView, "displayName" | "role" | "isActive">,
) {
  try {
    await api.patch(`/users/${userId}`, input);
    await load();
    return true;
  } catch {
    setError("계정 정보를 변경하지 못했습니다.");
    return false;
  }
}
```

- [ ] **Step 4: 계정 폼과 행의 독립 pending 상태 구현**

`UserForm`은 `busy` state와 `if (busy) return` guard를 사용한다. 입력값은
`onSubmit`이 `true`를 반환한 경우에만 비운다.

```tsx
const succeeded = await onSubmit({ loginId, displayName, role });
if (succeeded) {
  setLoginId("");
  setDisplayName("");
}
```

submit button은 `계정 만드는 중…`을 표시한다.

`UserEditRow`는 다음 state를 가진다.

```tsx
const [busyAction, setBusyAction] = useState<"SAVE" | "RESET" | null>(null);
```

각 callback을 `try/finally`로 await한다. 저장 중에는 현재 행의 입력과 두
버튼만 비활성화하고, 재설정 중에는 `비밀번호 재설정 중…`을 표시한다.

- [ ] **Step 5: 계정 테스트 통과 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/admin/admin.test.tsx
```

Expected: 새 목록/행 테스트와 기존 계정 payload·임시 비밀번호 테스트 PASS.

- [ ] **Step 6: 계정 관리 커밋**

```bash
git add apps/web/src/features/admin/UsersPage.tsx apps/web/src/features/admin/UserForm.tsx apps/web/src/features/admin/UserEditRow.tsx apps/web/src/features/admin/admin.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add account management loading feedback"
```

---

### Task 8: 엑셀 처리 상태 통일과 전체 검증

**Files:**

- Modify: `apps/web/src/features/imports/ImportWizard.tsx`
- Modify: `apps/web/src/features/imports/imports.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Verify: `apps/web/src/**/*.test.tsx`
- Verify: `apps/web/src/**/*.test.ts`

**Interfaces:**

- Consumes: `Button.loading`, `LoadingStatus`
- Produces: `busyAction: "READ_FILE" | "VALIDATE" | "COMMIT" | null`
- Produces: `organizationLoading: boolean`, `loadOrganizations(): Promise<void>`
- Preserves: workbook client parsing, source file 비업로드, workflow generation과 request owner lock

- [ ] **Step 1: 검증과 확정 문구를 구분하는 실패 테스트 작성**

`imports.test.tsx`의 기존 pending validation과 pending commit 테스트에
다음 assertion을 추가한다.

```tsx
expect(
  screen.getByRole("button", { name: "검증 중…" }),
).toBeDisabled();
expect(screen.getByLabelText("엑셀 파일")).toBeDisabled();
```

commit pending 구간에는 다음 assertion을 추가한다.

```tsx
expect(
  screen.getByRole("button", { name: "가져오는 중…" }),
).toBeDisabled();
expect(screen.getByRole("heading", { name: "검증 결과" })).toBeVisible();
```

- 프로젝트 조직 요청을 deferred로 두었을 때 `프로젝트 조직 불러오는 중…`
  상태가 보이고 빈 조직 수가 먼저 표시되지 않는지 검증한다.
- 첫 조직 요청을 reject하고 `다시 시도`를 누르면 두 번째 응답의 조직
  목록이 표시되는지 검증한다.
- `readWorkbook`을 deferred로 mock하고 파일 선택 후 `파일 읽는 중…`이
  표시되며 file input이 비활성화되는지 검증한다.

- [ ] **Step 2: import 문구 테스트 실패 확인**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/imports/imports.test.tsx
```

Expected: 현재 범용 `처리 중…` 또는 원래 버튼 문구 때문에 FAIL.

- [ ] **Step 3: ImportWizard action별 상태 구현**

boolean `busy` 대신 action과 파생값을 사용한다.

```tsx
type ImportBusyAction = "READ_FILE" | "VALIDATE" | "COMMIT" | null;

const [busyAction, setBusyAction] = useState<ImportBusyAction>(null);
const busy = busyAction !== null;
```

`chooseFile`은 `readWorkbook` 직전에 `READ_FILE`을 설정하고 현재
workflow generation에서만 `finally`로 해제한다. 파일을 읽는 동안
`LoadingStatus>파일 읽는 중…</LoadingStatus>`를 파일 카드 안에 표시한다.

`validate` 시작 시 `setBusyAction("VALIDATE")`, `commit` 시작 시
`setBusyAction("COMMIT")`, 현재 request owner의 `releaseRequest`에서만
`setBusyAction(null)`을 실행한다. clear/discard도 `null`로 초기화한다.

버튼은 다음처럼 연결한다.

```tsx
<Button
  type="button"
  variant="primary"
  loading={busyAction === "VALIDATE"}
  loadingText="검증 중…"
  disabled={busyAction === "COMMIT"}
  onClick={() => void validate()}
>
  {resolutionDirty ? "다시 검증" : "서버 검증"}
</Button>
```

```tsx
<Button
  type="button"
  variant="primary"
  loading={busyAction === "COMMIT"}
  loadingText="가져오는 중…"
  disabled={!canCommit || busyAction === "VALIDATE"}
  onClick={() => void commit()}
>
  명단 확정
</Button>
```

상단의 가짜 disabled link는 제거하고 원래 `명단으로 돌아가기` link를
유지하되 busy 중 click을 차단하지 않는다. 현재 입력과 validation 결과는
요청 중 그대로 둔다.

- [ ] **Step 4: 프로젝트 조직 최초 로딩과 재시도 구현**

기존 inline `useEffect` 요청을 `loadOrganizations` callback으로 추출한다.
`organizationLoading`을 요청 시작에 `true`, 현재 projectId 요청의
`finally`에서 `false`로 바꾼다. 성공 전에는 활성 조직 0개를 표시하지
않는다.

```tsx
{organizationLoading ? (
  <div aria-busy="true">
    <LoadingStatus>프로젝트 조직 불러오는 중…</LoadingStatus>
  </div>
) : organizationError ? (
  <RetryableError
    message={organizationError}
    onRetry={loadOrganizations}
    retrying={organizationLoading}
  />
) : (
  <>
    <p className="er-muted">활성 조직 {activeOrganizations.length}개</p>
    <ul className="er-compact-list">
      {activeOrganizations.map((organization) => (
        <li key={organization.organizationId}>{organization.name}</li>
      ))}
    </ul>
  </>
)}
```

`loadOrganizations`는 requested projectId와 generation을 캡처해 이전
프로젝트 응답을 무시한다.

- [ ] **Step 5: import와 전체 Web 테스트 실행**

Run:

```bash
corepack pnpm@10.28.1 --filter @event-roster/web test -- src/features/imports/imports.test.tsx
corepack pnpm@10.28.1 --filter @event-roster/web test
```

Expected: import tests PASS, 전체 Web test files PASS.

- [ ] **Step 6: 정적 검사와 production build 실행**

Run:

```bash
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 --filter @event-roster/web build
git diff --check
```

Expected: TypeScript checks PASS, Vite production build success, whitespace error 0.

- [ ] **Step 7: tracked file format 검사**

사용자의 미추적 `.pnpm-store`와 OS 파일을 검사 대상으로 넣지 않기 위해
tracked file만 검사한다.

Run:

```bash
git ls-files -z | xargs -0 corepack pnpm@10.28.1 exec biome check --no-errors-on-unmatched
```

Expected: tracked files에서 formatting error 0.

- [ ] **Step 8: 수동 반응형·접근성 검증**

로컬 Web/Worker 개발 서버를 실행한 뒤 다음을 확인한다.

```bash
corepack pnpm@10.28.1 dev
```

확인 기준:

- 프로젝트 카드 skeleton이 데스크톱 grid와 360px 모바일 단일 열에서 overflow를 만들지 않는다.
- 표 skeleton과 실제 표 전환 시 header가 사라지지 않는다.
- 재조회 중 기존 프로젝트·조직·계정 데이터가 유지된다.
- mutation 중 관련 버튼만 진행 문구를 표시하고 중복 click이 발생하지 않는다.
- 네트워크 실패를 모의했을 때 해당 영역의 `다시 시도`로 복구된다.
- 브라우저 reduced-motion 설정에서 shimmer와 spinner animation이 멈춘다.
- keyboard Tab으로 retry button과 사용 가능한 다른 동작에 접근할 수 있다.

- [ ] **Step 9: 엑셀과 최종 검증 커밋**

```bash
git add apps/web/src/features/imports/ImportWizard.tsx apps/web/src/features/imports/imports.test.tsx apps/web/src/styles/global.css
git commit -m "feat: complete loading feedback across workflows"
```

---

## 완료 확인

계획의 모든 task를 구현한 뒤 다음 명령을 깨끗한 작업 상태에서 다시 실행한다.

```bash
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 check
corepack pnpm@10.28.1 --filter @event-roster/web build
git diff --check
git status --short --branch
```

Expected:

- monorepo 전체 test PASS
- TypeScript check PASS
- production Web build success
- whitespace error 0
- 계획과 무관한 사용자 미추적 파일 외에 변경 파일 없음
