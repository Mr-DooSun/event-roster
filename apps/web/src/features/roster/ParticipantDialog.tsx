import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import type { OrganizationView } from "../admin/UserForm";

export interface ParticipantView {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
}

export function ParticipantDialog({
  participants,
  organizations,
  onAdd,
  onCreateAndAdd,
  initialParticipantId,
  onClose,
}: {
  participants: ParticipantView[];
  organizations: OrganizationView[];
  onAdd: (participantId: string) => Promise<void>;
  onCreateAndAdd: (input: {
    name: string;
    organizationId: string;
  }) => Promise<void>;
  initialParticipantId?: string | null;
  onClose: () => void;
}) {
  const [participantId, setParticipantId] = useState(
    initialParticipantId ?? participants[0]?.id ?? "",
  );
  const [mode, setMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState(
    organizations.find((organization) => organization.isActive)?.id ?? "",
  );
  useEffect(() => {
    if (initialParticipantId) {
      setParticipantId(initialParticipantId);
      setMode("EXISTING");
    }
  }, [initialParticipantId]);
  return (
    <Dialog title="참가자 추가" onClose={onClose}>
      <div className="er-action-row">
        <Button
          type="button"
          variant={mode === "EXISTING" ? "primary" : "secondary"}
          onClick={() => setMode("EXISTING")}
        >
          기존 참가자
        </Button>
        <Button
          type="button"
          variant={mode === "NEW" ? "primary" : "secondary"}
          onClick={() => setMode("NEW")}
        >
          새 참가자
        </Button>
      </div>
      {mode === "EXISTING" ? (
        <>
          <label className="er-field">
            <span>참가자</span>
            <select
              value={participantId}
              onChange={(event) => setParticipantId(event.currentTarget.value)}
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name} · {participant.participantId}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="primary"
            disabled={!participantId}
            onClick={() => void onAdd(participantId)}
          >
            명단에 추가
          </Button>
        </>
      ) : (
        <>
          <TextInput
            label="이름"
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <label className="er-field">
            <span>소속 조직</span>
            <select
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
          <Button
            type="button"
            variant="primary"
            disabled={!name.trim() || !organizationId}
            onClick={() =>
              void onCreateAndAdd({ name: name.trim(), organizationId })
            }
          >
            참가자 생성 후 추가
          </Button>
        </>
      )}
    </Dialog>
  );
}
