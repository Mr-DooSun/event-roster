import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/Card";
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { RetryableError } from "../../components/ui/RetryableError";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { useAuth } from "../auth/AuthProvider";
import { TemporaryPasswordDialog } from "./TemporaryPasswordDialog";
import { UserEditRow, type UserView } from "./UserEditRow";
import { type UserCreateInput, UserForm } from "./UserForm";

const userSkeletonKeys = Array.from(
  { length: 5 },
  (_, index) => `user-skeleton-${index}`,
);

export function UsersPage() {
  const { api } = useAuth();
  const [users, setUsers] = useState<UserView[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setLoading(true);
    else setRefreshing(true);
    try {
      setUsers(await api.get<UserView[]>("/users"));
      hasLoadedRef.current = true;
      setHasLoaded(true);
      setLoadError(null);
    } catch {
      setLoadError("계정 목록을 불러오지 못했습니다.");
    } finally {
      if (initialLoad) setLoading(false);
      else setRefreshing(false);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  async function create(input: UserCreateInput) {
    try {
      const result = await api.post<{ id: string; temporaryPassword: string }>(
        "/users",
        input,
      );
      setTemporaryPassword(result.temporaryPassword);
      await load();
      return true;
    } catch {
      setError("계정을 만들지 못했습니다.");
      return false;
    }
  }

  async function reset(userId: string) {
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        `/users/${userId}/password-reset`,
      );
      setTemporaryPassword(result.temporaryPassword);
      return true;
    } catch {
      setError("비밀번호를 재설정하지 못했습니다.");
      return false;
    }
  }

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

  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">ADMIN</p>
          <h1>계정 관리</h1>
        </div>
      </header>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Card className="er-panel">
        <h2>새 계정</h2>
        <UserForm onSubmit={create} />
      </Card>
      <Card className="er-panel">
        <h2>계정 목록</h2>
        {loadError && !hasLoaded ? (
          <RetryableError
            message={loadError}
            retrying={loading}
            onRetry={load}
          />
        ) : (
          <>
            {loadError ? (
              <RetryableError
                message={loadError}
                retrying={refreshing}
                onRetry={load}
              />
            ) : null}
            {refreshing ? <LoadingStatus>새로고침 중…</LoadingStatus> : null}
            <div className="er-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>로그인 ID</th>
                    <th>역할</th>
                    <th>상태</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody
                  data-testid={
                    loading && !hasLoaded ? "user-table-skeleton" : undefined
                  }
                  aria-busy={(loading && !hasLoaded) || undefined}
                >
                  {loading && !hasLoaded ? (
                    userSkeletonKeys.map((key) => (
                      <tr key={key} className="er-user-table-skeleton">
                        <td>
                          <Skeleton className="er-skeleton--text" />
                        </td>
                        <td>
                          <Skeleton className="er-skeleton--text er-skeleton--short" />
                        </td>
                        <td>
                          <Skeleton className="er-skeleton--text" />
                        </td>
                        <td>
                          <Skeleton className="er-skeleton--short" />
                        </td>
                        <td>
                          <Skeleton className="er-skeleton--button" />
                        </td>
                      </tr>
                    ))
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="er-muted">
                        등록된 계정이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <UserEditRow
                        key={user.id}
                        user={user}
                        onSave={saveUser}
                        onReset={reset}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {temporaryPassword ? (
        <TemporaryPasswordDialog
          value={temporaryPassword}
          onClose={() => setTemporaryPassword(null)}
        />
      ) : null}
    </div>
  );
}
