import type { Role } from "@event-roster/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { OrganizationView } from "./UserForm";

export interface UserView {
  id: string;
  loginId: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  organizationIds: string[];
}

type UserUpdate = Omit<UserView, "id" | "loginId">;

export function UserEditRow({
  user,
  organizations,
  onSave,
  onReset,
}: {
  user: UserView;
  organizations: OrganizationView[];
  onSave: (id: string, input: UserUpdate) => Promise<void>;
  onReset: (id: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [organizationIds, setOrganizationIds] = useState(user.organizationIds);
  return (
    <tr>
      <td>
        <input
          className="er-control er-control--inline"
          aria-label={`${user.loginId} 표시 이름`}
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
      </td>
      <td>{user.loginId}</td>
      <td>
        <select
          className="er-control er-control--select"
          aria-label={`${user.loginId} 역할`}
          value={role}
          onChange={(event) => {
            const next = event.currentTarget.value as Role;
            setRole(next);
            if (next === "OPERATOR") setOrganizationIds([]);
          }}
        >
          <option value="OPERATOR">운영자</option>
          <option value="ORGANIZATION_MANAGER">조직 담당자</option>
        </select>
        {role === "ORGANIZATION_MANAGER" ? (
          <div className="er-compact-checks">
            {organizations
              .filter((item) => item.isActive)
              .map((organization) => (
                <label className="er-checkbox" key={organization.id}>
                  <input
                    className="er-checkbox__input"
                    type="checkbox"
                    checked={organizationIds.includes(organization.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setOrganizationIds((current) =>
                        checked
                          ? [...current, organization.id]
                          : current.filter((id) => id !== organization.id),
                      );
                    }}
                  />
                  <span className="er-checkbox__box" aria-hidden="true" />
                  <span>{organization.name}</span>
                </label>
              ))}
          </div>
        ) : null}
      </td>
      <td>
        <label className="er-toggle">
          <input
            className="er-toggle__input"
            aria-label={`${user.loginId} 활성`}
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.currentTarget.checked)}
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
            onClick={() =>
              void onSave(user.id, {
                displayName,
                role,
                isActive,
                organizationIds,
              })
            }
          >
            저장
          </Button>
          <Button type="button" onClick={() => void onReset(user.id)}>
            비밀번호 재설정
          </Button>
        </div>
      </td>
    </tr>
  );
}
