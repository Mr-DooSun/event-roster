import type {
  BulkParticipantDuplicate,
  Organization,
  ParticipantRole,
  RosterParticipantInput,
  StudentGrade,
} from "@event-roster/contracts";
import { normalizeParticipantName } from "@event-roster/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { orderOrganizationsByRecent } from "../../lib/recent-organizations";
import {
  type BulkParticipantDraft,
  BulkParticipantRowsField,
  isValidBulkParticipantDraft,
} from "./BulkParticipantRowsField";
import { OrganizationSelectCombobox } from "./OrganizationSelectCombobox";

export interface ParticipantView {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  suggestedRole?: ParticipantRole | null;
  suggestedGrade?: StudentGrade | null;
  revision: number;
}

export interface RosterOrganizationView extends Organization {
  isDeleted?: boolean;
  masterIsActive?: boolean;
}

export interface ExistingParticipantConfirmation {
  participantId: string;
  name: string;
  organizationId: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
  expectedParticipantRevision: number;
}

export interface BulkParticipantSubmitInput {
  participants: RosterParticipantInput[];
  organizationId: string;
  confirmDuplicateNames: boolean;
}

export type BulkParticipantSubmitOutcome =
  | { kind: "SUCCESS" }
  | { kind: "DUPLICATES"; duplicates: BulkParticipantDuplicate[] }
  | { kind: "FAILED" };

function initialConfirmedOrganizationId(
  participant: ParticipantView | undefined,
  organizations: RosterOrganizationView[],
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
  organizations: RosterOrganizationView[],
  recentOrganizationIds: readonly string[],
) {
  return (
    orderOrganizationsByRecent(
      organizations.filter((organization) => organization.isActive),
      recentOrganizationIds,
    )[0]?.id ?? ""
  );
}

function suggestedProfile(participant: ParticipantView | undefined): {
  role: ParticipantRole;
  grade: StudentGrade | null;
} {
  if (
    participant?.suggestedRole === "STUDENT" &&
    participant.suggestedGrade != null
  ) {
    return {
      role: "STUDENT",
      grade: participant.suggestedGrade,
    };
  }
  if (
    participant?.suggestedRole === "TEACHER" &&
    participant.suggestedGrade === null
  ) {
    return {
      role: "TEACHER",
      grade: null,
    };
  }
  return {
    role: "STUDENT",
    grade: null,
  };
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
  organizations: RosterOrganizationView[];
  recentOrganizationIds?: readonly string[];
  onAdd: (input: ExistingParticipantConfirmation) => Promise<void>;
  onCreateAndAdd: (
    input: BulkParticipantSubmitInput,
  ) => Promise<BulkParticipantSubmitOutcome>;
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
  const [rows, setRows] = useState<BulkParticipantDraft[]>([]);
  const [duplicates, setDuplicates] = useState<BulkParticipantDuplicate[]>([]);
  const [duplicateNamesConfirmed, setDuplicateNamesConfirmed] = useState(false);
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
  const initialProfile = suggestedProfile(initialParticipant);
  const [confirmedRole, setConfirmedRole] = useState<ParticipantRole>(
    initialProfile.role,
  );
  const [confirmedGrade, setConfirmedGrade] = useState<StudentGrade | null>(
    initialProfile.grade,
  );
  const [organizationId, setOrganizationId] = useState(
    firstActiveOrganizationId(organizations, recentOrganizationIds),
  );
  const displayOrganizations = useMemo(
    () =>
      organizations.map((organization) => ({
        ...organization,
        name: organizationDisplayName(organization),
      })),
    [organizations],
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
      const profile = suggestedProfile(participant);
      setConfirmedRole(profile.role);
      setConfirmedGrade(profile.grade);
      setMode("EXISTING");
    }
  }, [initialParticipantId]);

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

  const confirmedOrganizationUnavailable =
    allowExistingOrganizationChange &&
    Boolean(confirmedOrganizationId) &&
    !organizations.some(
      (organization) =>
        organization.isActive && organization.id === confirmedOrganizationId,
    );
  const bulkOrganizationUnavailable =
    Boolean(organizationId) &&
    !organizations.some(
      (organization) =>
        organization.isActive && organization.id === organizationId,
    );

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
    const profile = suggestedProfile(participant);
    setConfirmedRole(profile.role);
    setConfirmedGrade(profile.grade);
  }

  async function addExisting() {
    if (
      busy ||
      !selectedParticipant ||
      !confirmedName.trim() ||
      !confirmedOrganizationId ||
      confirmedOrganizationUnavailable ||
      (confirmedRole === "STUDENT" && confirmedGrade === null)
    ) {
      return;
    }
    setBusy("EXISTING");
    try {
      await onAdd({
        participantId: selectedParticipant.id,
        name: confirmedName.trim(),
        organizationId: confirmedOrganizationId,
        role: confirmedRole,
        grade: confirmedGrade,
        expectedParticipantRevision: selectedParticipant.revision,
      });
    } catch {
      // The parent owns mutation feedback; keep this dialog and its input.
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    if (
      busy ||
      !organizationId ||
      bulkOrganizationUnavailable ||
      rows.length === 0 ||
      rows.length > 30 ||
      rows.some((row) => !isValidBulkParticipantDraft(row)) ||
      (duplicates.length > 0 && !duplicateNamesConfirmed)
    ) {
      return;
    }
    setBusy("NEW");
    try {
      const outcome = await onCreateAndAdd({
        participants: rows.map((row) => ({
          name: normalizeParticipantName(row.name),
          role: row.role,
          grade: row.grade,
        })),
        organizationId,
        confirmDuplicateNames: duplicateNamesConfirmed,
      });
      if (outcome.kind === "SUCCESS") {
        onClose();
      } else if (outcome.kind === "DUPLICATES") {
        setDuplicates(outcome.duplicates);
        setDuplicateNamesConfirmed(false);
      }
    } catch {
      // The parent owns mutation feedback; keep this dialog and its input.
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    if (busy === null) onClose();
  };
  const hasInvalidRow = rows.some((row) => !isValidBulkParticipantDraft(row));

  function changeRows(nextRows: BulkParticipantDraft[]) {
    const currentNames = rows.map((row) => [
      row.clientId,
      normalizeParticipantName(row.name),
    ]);
    const nextNames = nextRows.map((row) => [
      row.clientId,
      normalizeParticipantName(row.name),
    ]);
    setRows(nextRows);
    if (JSON.stringify(currentNames) !== JSON.stringify(nextNames)) {
      setDuplicates([]);
      setDuplicateNamesConfirmed(false);
    }
  }

  function changeOrganization(nextOrganizationId: string) {
    setOrganizationId(nextOrganizationId);
    setDuplicates([]);
    setDuplicateNamesConfirmed(false);
  }

  return (
    <Dialog
      title="참가자 추가"
      hideDefaultCloseAction
      size="roster"
      onClose={close}
    >
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
                organizations={displayOrganizations}
                recentOrganizationIds={recentOrganizationIds}
                value={confirmedOrganizationId}
                preserveUnavailableValue
                disabled={busy !== null}
                onChange={setConfirmedOrganizationId}
              />
            ) : (
              <TextInput
                label="확정 소속 조직"
                value={organizationDisplayName(
                  organizations.find(
                    (organization) =>
                      organization.id === selectedParticipant?.organizationId,
                  ),
                )}
                disabled
                readOnly
              />
            )}
            {confirmedOrganizationUnavailable ? (
              <StatusMessage tone="info">
                선택한 조직을 더 이상 사용할 수 없습니다. 다른 조직을 선택해
                주세요.
              </StatusMessage>
            ) : null}
            <label className="er-field">
              <span>참가자 구분</span>
              <select
                value={confirmedRole}
                disabled={busy !== null}
                onChange={(event) => {
                  const role = event.currentTarget.value as ParticipantRole;
                  setConfirmedRole(role);
                  if (role === "TEACHER") setConfirmedGrade(null);
                }}
              >
                <option value="STUDENT">학생</option>
                <option value="TEACHER">담당교사</option>
              </select>
            </label>
            <label className="er-field">
              <span>학년</span>
              <select
                value={confirmedGrade ?? ""}
                disabled={busy !== null || confirmedRole === "TEACHER"}
                required={confirmedRole === "STUDENT"}
                aria-invalid={
                  confirmedRole === "STUDENT" && confirmedGrade === null
                }
                onChange={(event) =>
                  setConfirmedGrade(
                    (event.currentTarget.value || null) as StudentGrade | null,
                  )
                }
              >
                <option value="">학년 선택</option>
                <option value="M1">중1</option>
                <option value="M2">중2</option>
                <option value="M3">중3</option>
                <option value="H1">고1</option>
                <option value="H2">고2</option>
                <option value="H3">고3</option>
              </select>
            </label>
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
                  !confirmedOrganizationId ||
                  confirmedOrganizationUnavailable ||
                  (confirmedRole === "STUDENT" && confirmedGrade === null)
                }
              >
                명단에 추가
              </Button>
            </div>
          </>
        ) : (
          <>
            <OrganizationSelectCombobox
              label="소속 조직"
              organizations={displayOrganizations}
              recentOrganizationIds={recentOrganizationIds}
              value={organizationId}
              preserveUnavailableValue
              disabled={busy !== null}
              onChange={changeOrganization}
            />
            {bulkOrganizationUnavailable ? (
              <StatusMessage tone="info">
                선택한 조직을 더 이상 사용할 수 없습니다. 다른 조직을 선택해
                주세요.
              </StatusMessage>
            ) : null}
            <BulkParticipantRowsField
              rows={rows}
              duplicates={duplicates}
              duplicateNamesConfirmed={duplicateNamesConfirmed}
              disabled={busy !== null}
              onRowsChange={changeRows}
              onDuplicateNamesConfirmedChange={setDuplicateNamesConfirmed}
            />
            <div className="er-dialog-actions">
              <Button type="button" disabled={busy !== null} onClick={close}>
                닫기
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy === "NEW"}
                loadingText={`${rows.length}명 등록 중…`}
                disabled={
                  busy !== null ||
                  !organizationId ||
                  bulkOrganizationUnavailable ||
                  rows.length === 0 ||
                  rows.length > 30 ||
                  hasInvalidRow ||
                  (duplicates.length > 0 && !duplicateNamesConfirmed)
                }
              >
                {rows.length > 0
                  ? `${rows.length}명 명단에 추가`
                  : "명단에 추가"}
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

function organizationDisplayName(organization?: RosterOrganizationView) {
  if (!organization) return "";
  if (organization.isDeleted) return `${organization.name} · 삭제됨`;
  if (organization.masterIsActive === false) {
    return `${organization.name} · 사용 중지`;
  }
  return organization.name;
}
