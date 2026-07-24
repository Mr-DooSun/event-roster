import type { Organization } from "@event-roster/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import type { ParticipantView } from "./ParticipantDialog";

export function ParticipantEditDialog({
  participant,
  organizations,
  allowOrganizationChange,
  onSave,
  onClose,
}: {
  participant: ParticipantView;
  organizations: Organization[];
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
  const [busy, setBusy] = useState(false);
  const selectableOrganizations = organizations.filter(
    (organization) =>
      organization.isActive || organization.id === participant.organizationId,
  );

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        organizationId,
        expectedRevision: participant.revision,
      });
    } catch {
      // The parent owns mutation feedback; keep this dialog and its input.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="참가자 정보 수정" onClose={onClose}>
      <TextInput
        label="이름"
        required
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <label className="er-field">
        <span>소속 조직</span>
        <select
          disabled={busy || !allowOrganizationChange}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.currentTarget.value)}
        >
          {selectableOrganizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </label>
      {!allowOrganizationChange ? (
        <p className="er-muted">진행 중에는 조직을 이동할 수 없습니다.</p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        loading={busy}
        loadingText="정보 저장 중…"
        onClick={() => void save()}
      >
        정보 저장
      </Button>
    </Dialog>
  );
}
