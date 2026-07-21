import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import type { OrganizationView } from "../admin/UserForm";
import type { ParticipantView } from "./ParticipantDialog";

export function ParticipantEditDialog({
  participant,
  organizations,
  allowOrganizationChange,
  onSave,
  onClose,
}: {
  participant: ParticipantView;
  organizations: OrganizationView[];
  allowOrganizationChange: boolean;
  onSave: (input: {
    name: string;
    organizationId: string;
    expectedRevision: number;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(participant.name);
  const [organizationId, setOrganizationId] = useState(
    participant.organizationId,
  );
  return (
    <Dialog title="참가자 정보 수정" onClose={onClose}>
      <TextInput
        label="이름"
        required
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <label className="er-field">
        <span>소속 조직</span>
        <select
          disabled={!allowOrganizationChange}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.currentTarget.value)}
        >
          {organizations
            .filter((organization) => organization.isActive)
            .map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
        </select>
      </label>
      {!allowOrganizationChange ? (
        <p className="er-muted">당일 운영 중에는 조직을 이동할 수 없습니다.</p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        onClick={() =>
          void onSave({
            name: name.trim(),
            organizationId,
            expectedRevision: participant.revision,
          })
        }
      >
        정보 저장
      </Button>
    </Dialog>
  );
}
