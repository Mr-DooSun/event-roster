import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { useAuth } from "../auth/AuthProvider";
import { TemporaryPasswordDialog } from "./TemporaryPasswordDialog";
import { UserEditRow, type UserView } from "./UserEditRow";
import {
  type OrganizationView,
  type UserCreateInput,
  UserForm,
} from "./UserForm";

export function UsersPage() {
  const { api } = useAuth();
  const [users, setUsers] = useState<UserView[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextUsers, nextOrganizations] = await Promise.all([
        api.get<UserView[]>("/users"),
        api.get<OrganizationView[]>("/organizations"),
      ]);
      setUsers(nextUsers);
      setOrganizations(nextOrganizations);
    } catch {
      setError("계정 목록을 불러오지 못했습니다.");
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
    } catch {
      setError("계정을 만들지 못했습니다.");
    }
  }

  async function reset(userId: string) {
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        `/users/${userId}/password-reset`,
      );
      setTemporaryPassword(result.temporaryPassword);
    } catch {
      setError("비밀번호를 재설정하지 못했습니다.");
    }
  }

  async function saveUser(
    userId: string,
    input: Omit<UserView, "id" | "loginId">,
  ) {
    try {
      await api.patch(`/users/${userId}`, input);
      await load();
    } catch {
      setError("계정 정보를 변경하지 못했습니다.");
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
        <UserForm organizations={organizations} onSubmit={create} />
      </Card>
      <Card className="er-panel">
        <h2>계정 목록</h2>
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
            <tbody>
              {users.map((user) => (
                <UserEditRow
                  key={user.id}
                  user={user}
                  organizations={organizations}
                  onSave={saveUser}
                  onReset={reset}
                />
              ))}
            </tbody>
          </table>
        </div>
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
