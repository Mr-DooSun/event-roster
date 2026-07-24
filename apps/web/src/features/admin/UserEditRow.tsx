import type { Role } from "@event-roster/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/Button";

export interface UserView {
  id: string;
  loginId: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  organizationIds: string[];
}

type UserUpdate = Pick<UserView, "displayName" | "role" | "isActive">;

export function UserEditRow({
  user,
  onSave,
  onReset,
}: {
  user: UserView;
  onSave: (id: string, input: UserUpdate) => Promise<boolean>;
  onReset: (id: string) => Promise<boolean>;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [busyAction, setBusyAction] = useState<"SAVE" | "RESET" | null>(null);

  async function save() {
    if (busyAction) return;
    setBusyAction("SAVE");
    try {
      await onSave(user.id, { displayName, role, isActive });
    } finally {
      setBusyAction(null);
    }
  }

  async function reset() {
    if (busyAction) return;
    setBusyAction("RESET");
    try {
      await onReset(user.id);
    } finally {
      setBusyAction(null);
    }
  }

  const busy = busyAction !== null;

  return (
    <tr>
      <td>
        <input
          className="er-control er-control--inline"
          aria-label={`${user.loginId} 표시 이름`}
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          disabled={busy}
        />
      </td>
      <td>{user.loginId}</td>
      <td>
        <select
          className="er-control er-control--select"
          aria-label={`${user.loginId} 역할`}
          value={role}
          onChange={(event) => setRole(event.currentTarget.value as Role)}
          disabled={busy}
        >
          <option value="OPERATOR">운영자</option>
          <option value="ORGANIZATION_MANAGER">조직 담당자</option>
        </select>
      </td>
      <td>
        <label className="er-toggle">
          <input
            className="er-toggle__input"
            aria-label={`${user.loginId} 활성`}
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.currentTarget.checked)}
            disabled={busy}
          />
          <span className="er-toggle__track" aria-hidden="true">
            <span className="er-toggle__thumb" />
          </span>
          <span>{isActive ? "사용" : "중지"}</span>
        </label>
      </td>
      <td>
        <div className="er-action-row">
          <Button
            type="button"
            variant="primary"
            onClick={() => void save()}
            disabled={busy}
            loading={busyAction === "SAVE"}
            loadingText="저장 중…"
          >
            저장
          </Button>
          <Button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            loading={busyAction === "RESET"}
            loadingText="비밀번호 재설정 중…"
          >
            비밀번호 재설정
          </Button>
        </div>
      </td>
    </tr>
  );
}
