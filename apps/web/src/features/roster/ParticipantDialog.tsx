import type { Organization } from "@event-roster/contracts";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";

export interface ParticipantView {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
}

export interface ExistingParticipantConfirmation {
  participantId: string;
  name: string;
  organizationId: string;
  expectedParticipantRevision: number;
}

export function ParticipantDialog({
  participants,
  organizations,
  onAdd,
  onCreateAndAdd,
  allowExistingOrganizationChange = true,
  initialParticipantId,
  onClose,
}: {
  participants: ParticipantView[];
  organizations: Organization[];
  onAdd: (input: ExistingParticipantConfirmation) => Promise<void>;
  onCreateAndAdd: (input: {
    name: string;
    organizationId: string;
  }) => Promise<void>;
  allowExistingOrganizationChange?: boolean;
  initialParticipantId?: string | null;
  onClose: () => void;
}) {
  const [participantId, setParticipantId] = useState(
    initialParticipantId ?? participants[0]?.id ?? "",
  );
  const initialParticipant = participants.find(
    (participant) =>
      participant.id === (initialParticipantId ?? participants[0]?.id),
  );
  const [mode, setMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [name, setName] = useState("");
  const [confirmedName, setConfirmedName] = useState(
    initialParticipant?.name ?? "",
  );
  const [confirmedOrganizationId, setConfirmedOrganizationId] = useState(
    !allowExistingOrganizationChange && initialParticipant
      ? initialParticipant.organizationId
      : organizations.some(
            (organization) =>
              organization.isActive &&
              organization.id === initialParticipant?.organizationId,
          )
        ? (initialParticipant?.organizationId ?? "")
        : (organizations.find((organization) => organization.isActive)?.id ??
          ""),
  );
  const [organizationId, setOrganizationId] = useState(
    organizations.find((organization) => organization.isActive)?.id ?? "",
  );
  useEffect(() => {
    if (initialParticipantId) {
      setParticipantId(initialParticipantId);
      setMode("EXISTING");
    }
  }, [initialParticipantId]);

  useEffect(() => {
    const participant = participants.find((item) => item.id === participantId);
    setConfirmedName(participant?.name ?? "");
    setConfirmedOrganizationId(
      !allowExistingOrganizationChange && participant
        ? participant.organizationId
        : organizations.some(
              (organization) =>
                organization.isActive &&
                organization.id === participant?.organizationId,
            )
          ? (participant?.organizationId ?? "")
          : (organizations.find((organization) => organization.isActive)?.id ??
            ""),
    );
  }, [
    allowExistingOrganizationChange,
    organizations,
    participantId,
    participants,
  ]);

  const selectedParticipant = participants.find(
    (participant) => participant.id === participantId,
  );
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
          <TextInput
            label="확정 이름"
            required
            value={confirmedName}
            onChange={(event) => setConfirmedName(event.currentTarget.value)}
          />
          <label className="er-field">
            <span>확정 소속 조직</span>
            <select
              value={confirmedOrganizationId}
              disabled={!allowExistingOrganizationChange}
              onChange={
                allowExistingOrganizationChange
                  ? (event) =>
                      setConfirmedOrganizationId(event.currentTarget.value)
                  : undefined
              }
            >
              {organizations
                .filter((organization) =>
                  allowExistingOrganizationChange
                    ? organization.isActive
                    : organization.id === selectedParticipant?.organizationId,
                )
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
            disabled={
              !selectedParticipant ||
              !confirmedName.trim() ||
              !confirmedOrganizationId
            }
            onClick={() => {
              if (!selectedParticipant) return;
              void onAdd({
                participantId: selectedParticipant.id,
                name: confirmedName.trim(),
                organizationId: confirmedOrganizationId,
                expectedParticipantRevision: selectedParticipant.revision,
              });
            }}
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
