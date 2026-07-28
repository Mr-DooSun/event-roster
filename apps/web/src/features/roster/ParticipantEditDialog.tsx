import type {
  Organization,
  ParticipantRole,
  StudentGrade,
} from "@event-roster/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";
import type { ParticipantView } from "./ParticipantDialog";
import type { RosterView } from "./RosterTable";

export function ParticipantEditDialog({
  participant,
  roster,
  organizations,
  allowOrganizationChange,
  onSave,
  onClose,
}: {
  participant: ParticipantView;
  roster: RosterView;
  organizations: Organization[];
  allowOrganizationChange: boolean;
  onSave: (input: {
    name: string;
    organizationId: string;
    role: ParticipantRole;
    grade: StudentGrade | null;
    expectedRevision: number;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(participant.name);
  const [organizationId, setOrganizationId] = useState(
    participant.organizationId,
  );
  const [role, setRole] = useState<ParticipantRole>(
    roster.role === "TEACHER" ? "TEACHER" : "STUDENT",
  );
  const [grade, setGrade] = useState<StudentGrade | null>(
    roster.role === "STUDENT" ? roster.grade : null,
  );
  const [busy, setBusy] = useState(false);
  const selectableOrganizations = organizations.filter(
    (organization) =>
      organization.isActive || organization.id === participant.organizationId,
  );

  async function save() {
    if (
      busy ||
      !name.trim() ||
      !organizationId ||
      (role === "STUDENT" && grade === null)
    ) {
      return;
    }
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        organizationId,
        role,
        grade,
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
      <label className="er-field">
        <span>참가자 구분</span>
        <select
          disabled={busy}
          value={role}
          onChange={(event) => {
            const nextRole = event.currentTarget.value as ParticipantRole;
            setRole(nextRole);
            if (nextRole === "TEACHER") setGrade(null);
          }}
        >
          <option value="STUDENT">학생</option>
          <option value="TEACHER">담당교사</option>
        </select>
      </label>
      <label className="er-field">
        <span>학년</span>
        <select
          disabled={busy || role === "TEACHER"}
          value={grade ?? ""}
          required={role === "STUDENT"}
          aria-invalid={role === "STUDENT" && grade === null}
          onChange={(event) =>
            setGrade((event.currentTarget.value || null) as StudentGrade | null)
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
      <Button
        type="button"
        variant="primary"
        loading={busy}
        loadingText="정보 저장 중…"
        disabled={
          busy ||
          !name.trim() ||
          !organizationId ||
          (role === "STUDENT" && grade === null)
        }
        onClick={() => void save()}
      >
        정보 저장
      </Button>
    </Dialog>
  );
}
