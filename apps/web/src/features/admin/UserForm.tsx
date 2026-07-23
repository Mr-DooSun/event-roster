import type { Role } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

export interface UserCreateInput {
  loginId: string;
  displayName: string;
  role: Role;
}

export function UserForm({
  onSubmit,
}: {
  onSubmit: (input: UserCreateInput) => Promise<void>;
}) {
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({ loginId, displayName, role });
    setLoginId("");
    setDisplayName("");
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
      <Button type="submit" variant="primary">
        계정 만들기
      </Button>
    </form>
  );
}
