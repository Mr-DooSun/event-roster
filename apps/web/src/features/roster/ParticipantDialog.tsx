import type { Organization } from "@event-roster/contracts";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import { OrganizationSelectCombobox } from "./OrganizationSelectCombobox";

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
  const [busy, setBusy] = useState<"EXISTING" | "NEW" | null>(null);
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

  async function addExisting() {
    if (busy || !selectedParticipant) return;
    setBusy("EXISTING");
    try {
      await onAdd({
        participantId: selectedParticipant.id,
        name: confirmedName.trim(),
        organizationId: confirmedOrganizationId,
        expectedParticipantRevision: selectedParticipant.revision,
      });
    } catch {
      // The parent owns mutation feedback; keep this dialog and its input.
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    if (busy) return;
    setBusy("NEW");
    try {
      await onCreateAndAdd({ name: name.trim(), organizationId });
    } catch {
      // The parent owns mutation feedback; keep this dialog and its input.
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    if (busy === null) onClose();
  };

  return (
    <Dialog title="참가자 추가" hideDefaultCloseAction onClose={close}>
      <div className="er-participant-mode-actions er-action-row">
        <Button
          type="button"
          variant={mode === "EXISTING" ? "primary" : "secondary"}
          disabled={busy !== null}
          onClick={() => setMode("EXISTING")}
        >
          기존 참가자
        </Button>
        <Button
          type="button"
          variant={mode === "NEW" ? "primary" : "secondary"}
          disabled={busy !== null}
          onClick={() => setMode("NEW")}
        >
          새 참가자
        </Button>
      </div>
      <form
        className="er-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "EXISTING") void addExisting();
          else void createAndAdd();
        }}
      >
        {mode === "EXISTING" ? (
          <>
            <label className="er-field">
              <span>참가자</span>
              <select
                value={participantId}
                disabled={busy !== null}
                onChange={(event) =>
                  setParticipantId(event.currentTarget.value)
                }
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
              disabled={busy !== null}
              onChange={(event) => setConfirmedName(event.currentTarget.value)}
            />
            {allowExistingOrganizationChange ? (
              <OrganizationSelectCombobox
                label="확정 소속 조직"
                organizations={organizations}
                value={confirmedOrganizationId}
                disabled={busy !== null}
                onChange={setConfirmedOrganizationId}
              />
            ) : (
              <TextInput
                label="확정 소속 조직"
                value={
                  organizations.find(
                    (organization) =>
                      organization.id === selectedParticipant?.organizationId,
                  )?.name ?? ""
                }
                disabled
                readOnly
              />
            )}
            <div className="er-dialog-actions">
              <Button type="button" disabled={busy !== null} onClick={close}>
                닫기
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy === "EXISTING"}
                loadingText="명단에 추가 중…"
                disabled={
                  busy !== null ||
                  !selectedParticipant ||
                  !confirmedName.trim() ||
                  !confirmedOrganizationId
                }
              >
                명단에 추가
              </Button>
            </div>
          </>
        ) : (
          <>
            <TextInput
              label="이름"
              required
              value={name}
              disabled={busy !== null}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <OrganizationSelectCombobox
              label="소속 조직"
              organizations={organizations}
              value={organizationId}
              disabled={busy !== null}
              onChange={setOrganizationId}
            />
            <div className="er-dialog-actions">
              <Button type="button" disabled={busy !== null} onClick={close}>
                닫기
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy === "NEW"}
                loadingText="참가자 만드는 중…"
                disabled={busy !== null || !name.trim() || !organizationId}
              >
                참가자 생성 후 추가
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}
