import type { Organization } from "@event-roster/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import { orderOrganizationsByRecent } from "../../lib/recent-organizations";
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

function initialConfirmedOrganizationId(
  participant: ParticipantView | undefined,
  organizations: Organization[],
  allowExistingOrganizationChange: boolean,
) {
  if (!allowExistingOrganizationChange && participant) {
    return participant.organizationId;
  }
  if (
    participant &&
    organizations.some(
      (organization) =>
        organization.isActive && organization.id === participant.organizationId,
    )
  ) {
    return participant.organizationId;
  }
  return organizations.find((organization) => organization.isActive)?.id ?? "";
}

function firstActiveOrganizationId(
  organizations: Organization[],
  recentOrganizationIds: readonly string[],
) {
  return (
    orderOrganizationsByRecent(
      organizations.filter((organization) => organization.isActive),
      recentOrganizationIds,
    )[0]?.id ?? ""
  );
}

export function ParticipantDialog({
  participants,
  organizations,
  recentOrganizationIds = [],
  onAdd,
  onCreateAndAdd,
  allowExistingOrganizationChange = true,
  initialParticipantId,
  onClose,
}: {
  participants: ParticipantView[];
  organizations: Organization[];
  recentOrganizationIds?: readonly string[];
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
    initialConfirmedOrganizationId(
      initialParticipant,
      organizations,
      allowExistingOrganizationChange,
    ),
  );
  const [organizationId, setOrganizationId] = useState(
    firstActiveOrganizationId(organizations, recentOrganizationIds),
  );
  const initializationContextRef = useRef({
    allowExistingOrganizationChange,
    organizations,
    participants,
  });
  initializationContextRef.current = {
    allowExistingOrganizationChange,
    organizations,
    participants,
  };
  const selectedParticipant = participants.find(
    (participant) => participant.id === participantId,
  );
  const selectedParticipantOrganizationId =
    selectedParticipant?.organizationId ?? "";
  useEffect(() => {
    if (initialParticipantId) {
      const context = initializationContextRef.current;
      const participant = context.participants.find(
        (item) => item.id === initialParticipantId,
      );
      setParticipantId(initialParticipantId);
      setConfirmedName(participant?.name ?? "");
      setConfirmedOrganizationId(
        initialConfirmedOrganizationId(
          participant,
          context.organizations,
          context.allowExistingOrganizationChange,
        ),
      );
      setMode("EXISTING");
    }
  }, [initialParticipantId]);

  useEffect(() => {
    if (
      allowExistingOrganizationChange &&
      confirmedOrganizationId &&
      !organizations.some(
        (organization) =>
          organization.isActive && organization.id === confirmedOrganizationId,
      )
    ) {
      setConfirmedOrganizationId("");
    }
  }, [allowExistingOrganizationChange, confirmedOrganizationId, organizations]);

  useEffect(() => {
    if (
      !allowExistingOrganizationChange &&
      selectedParticipantOrganizationId &&
      confirmedOrganizationId !== selectedParticipantOrganizationId
    ) {
      setConfirmedOrganizationId(selectedParticipantOrganizationId);
    }
  }, [
    allowExistingOrganizationChange,
    confirmedOrganizationId,
    selectedParticipantOrganizationId,
  ]);

  useEffect(() => {
    if (
      organizationId &&
      !organizations.some(
        (organization) =>
          organization.isActive && organization.id === organizationId,
      )
    ) {
      setOrganizationId("");
    }
  }, [organizationId, organizations]);

  function selectParticipant(nextParticipantId: string) {
    const participant = participants.find(
      (item) => item.id === nextParticipantId,
    );
    setParticipantId(nextParticipantId);
    setConfirmedName(participant?.name ?? "");
    setConfirmedOrganizationId(
      initialConfirmedOrganizationId(
        participant,
        organizations,
        allowExistingOrganizationChange,
      ),
    );
  }

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
                  selectParticipant(event.currentTarget.value)
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
                recentOrganizationIds={recentOrganizationIds}
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
              recentOrganizationIds={recentOrganizationIds}
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
