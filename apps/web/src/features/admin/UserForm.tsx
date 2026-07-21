import type { Role } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

export interface OrganizationView {
  id: string;
  name: string;
  isActive: boolean;
}

export interface UserCreateInput {
  loginId: string;
  displayName: string;
  role: Role;
  organizationIds: string[];
}

export function UserForm({
  organizations,
  onSubmit,
}: {
  organizations: OrganizationView[];
  onSubmit: (input: UserCreateInput) => Promise<void>;
}) {
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const [organizationIds, setOrganizationIds] = useState<string[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({ loginId, displayName, role, organizationIds });
    setLoginId("");
    setDisplayName("");
    setOrganizationIds([]);
  }

  return (
    <form className="er-form-grid" onSubmit={submit}>
      <TextInput
        label="영문 로그인 ID"
        required
        value={loginId}
        onChange={(event) => setLoginId(event.currentTarget.value)}
      />
      <TextInput
        label="표시 이름"
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.currentTarget.value)}
      />
      <label className="er-field">
        <span>역할</span>
        <select
          className="er-control er-control--select"
          value={role}
          onChange={(event) => setRole(event.currentTarget.value as Role)}
        >
          <option value="OPERATOR">운영자</option>
          <option value="ORGANIZATION_MANAGER">조직 담당자</option>
        </select>
      </label>
      {role === "ORGANIZATION_MANAGER" ? (
        <fieldset className="er-check-group">
          <legend>담당 조직</legend>
          {organizations
            .filter((item) => item.isActive)
            .map((organization) => (
              <label className="er-checkbox" key={organization.id}>
                <input
                  className="er-checkbox__input"
                  type="checkbox"
                  checked={organizationIds.includes(organization.id)}
                  onChange={(event) =>
                    setOrganizationIds((current) =>
                      event.currentTarget.checked
                        ? [...current, organization.id]
                        : current.filter((id) => id !== organization.id),
                    )
                  }
                />
                <span className="er-checkbox__box" aria-hidden="true" />
                <span>{organization.name}</span>
              </label>
            ))}
        </fieldset>
      ) : null}
      <Button type="submit" variant="primary">
        계정 만들기
      </Button>
    </form>
  );
}
