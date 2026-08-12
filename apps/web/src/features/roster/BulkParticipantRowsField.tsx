import {
  type BulkParticipantDuplicate,
  canonicalizeParticipantName,
  type Gender,
  normalizeParticipantName,
  type ParticipantRole,
  type StudentGrade,
} from "@event-roster/contracts";
import { Button } from "../../components/ui/Button";

const GRADE_OPTIONS: ReadonlyArray<{
  value: StudentGrade;
  label: string;
}> = [
  { value: "M1", label: "중1" },
  { value: "M2", label: "중2" },
  { value: "M3", label: "중3" },
  { value: "H1", label: "고1" },
  { value: "H2", label: "고2" },
  { value: "H3", label: "고3" },
];

export interface BulkParticipantDraft {
  clientId: string;
  name: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
  gender?: Gender | null;
}

export interface BulkParticipantRowsFieldProps {
  rows: BulkParticipantDraft[];
  duplicates: BulkParticipantDuplicate[];
  duplicateNamesConfirmed: boolean;
  disabled?: boolean;
  onRowsChange(rows: BulkParticipantDraft[]): void;
  onDuplicateNamesConfirmedChange(value: boolean): void;
}

export function createBulkParticipantDraft(): BulkParticipantDraft {
  return {
    clientId: crypto.randomUUID(),
    name: "",
    role: "STUDENT",
    grade: null,
    gender: null,
  };
}

export function isValidBulkParticipantDraft(row: BulkParticipantDraft) {
  const name = normalizeParticipantName(row.name);
  return (
    name.length >= 1 &&
    name.length <= 100 &&
    (row.role === "TEACHER" || row.grade !== null)
  );
}

export function BulkParticipantRowsField({
  rows,
  duplicates,
  duplicateNamesConfirmed,
  disabled = false,
  onRowsChange,
  onDuplicateNamesConfirmedChange,
}: BulkParticipantRowsFieldProps) {
  const atLimit = rows.length >= 30;
  const duplicateByName = new Map(
    duplicates.map((duplicate) => [
      canonicalizeParticipantName(duplicate.name),
      duplicate,
    ]),
  );

  function changeRow(
    clientId: string,
    change: (row: BulkParticipantDraft) => BulkParticipantDraft,
  ) {
    onRowsChange(
      rows.map((row) => (row.clientId === clientId ? change(row) : row)),
    );
  }

  function changeName(clientId: string, name: string) {
    changeRow(clientId, (row) => ({ ...row, name }));
    onDuplicateNamesConfirmedChange(false);
  }

  function addRow() {
    onRowsChange([...rows, createBulkParticipantDraft()]);
    onDuplicateNamesConfirmedChange(false);
  }

  function changeRole(clientId: string, role: ParticipantRole) {
    changeRow(clientId, (row) => ({
      ...row,
      role,
      grade: role === "TEACHER" ? null : row.grade,
    }));
  }

  function removeRow(clientId: string) {
    onRowsChange(rows.filter((row) => row.clientId !== clientId));
    onDuplicateNamesConfirmedChange(false);
  }

  return (
    <div className="er-bulk-participant-summary">
      <span className="er-bulk-participant-count">
        등록 예정 {rows.length}명 / 최대 30명
      </span>
      <div className="er-bulk-participant-rows">
        {rows.length === 0 ? (
          <p className="er-bulk-participant-empty">등록할 참가자가 없습니다.</p>
        ) : null}
        {rows.map((row, index) => {
          const rowNumber = index + 1;
          const duplicate = duplicateByName.get(
            canonicalizeParticipantName(row.name),
          );
          const normalizedName = normalizeParticipantName(row.name);
          const nameError =
            normalizedName.length === 0
              ? "이름을 입력해 주세요."
              : normalizedName.length > 100
                ? "이름은 100자 이하여야 합니다."
                : null;
          const missingStudentGrade =
            row.role === "STUDENT" && row.grade === null;
          const nameErrorId = `bulk-participant-${row.clientId}-name-error`;
          const gradeErrorId = `bulk-participant-${row.clientId}-grade-error`;
          return (
            <fieldset key={row.clientId} className="er-bulk-participant-row">
              <legend className="er-visually-hidden">
                {rowNumber}번 참가자
              </legend>
              <span
                className="er-bulk-participant-row__heading"
                aria-hidden="true"
              >
                {rowNumber}번 참가자
              </span>
              <label className="er-field">
                <span>이름</span>
                <input
                  value={row.name}
                  disabled={disabled}
                  required
                  aria-label={`${rowNumber}번 이름`}
                  aria-invalid={nameError !== null}
                  aria-describedby={nameError ? nameErrorId : undefined}
                  onChange={(event) =>
                    changeName(row.clientId, event.currentTarget.value)
                  }
                />
                {nameError ? (
                  <small
                    id={nameErrorId}
                    className="er-bulk-participant-invalid"
                  >
                    {nameError}
                  </small>
                ) : null}
                {duplicate?.kinds.includes("INPUT_DUPLICATE") ? (
                  <small className="er-bulk-participant-duplicate">
                    입력 목록에 같은 이름이 있습니다.
                  </small>
                ) : null}
                {duplicate?.kinds.includes("EXISTING_PARTICIPANT") ? (
                  <small className="er-bulk-participant-duplicate">
                    이 조직에 같은 이름의 참가자가 있습니다.
                  </small>
                ) : null}
              </label>
              <label className="er-field">
                <span>성별</span>
                <select
                  value={row.gender ?? ""}
                  disabled={disabled}
                  aria-label={`${rowNumber}번 성별`}
                  onChange={(event) =>
                    changeRow(row.clientId, (current) => ({
                      ...current,
                      gender: (event.currentTarget.value ||
                        null) as Gender | null,
                    }))
                  }
                >
                  <option value="">미지정</option>
                  <option value="MALE">남성</option>
                  <option value="FEMALE">여성</option>
                </select>
              </label>
              <label className="er-field">
                <span>참가자 구분</span>
                <select
                  value={row.role}
                  disabled={disabled}
                  aria-label={`${rowNumber}번 참가자 구분`}
                  onChange={(event) =>
                    changeRole(
                      row.clientId,
                      event.currentTarget.value as ParticipantRole,
                    )
                  }
                >
                  <option value="STUDENT">학생</option>
                  <option value="TEACHER">담당교사</option>
                </select>
              </label>
              <label className="er-field">
                <span>학년</span>
                <select
                  value={row.grade ?? ""}
                  disabled={disabled || row.role === "TEACHER"}
                  required={row.role === "STUDENT"}
                  aria-label={`${rowNumber}번 학년`}
                  aria-invalid={missingStudentGrade}
                  aria-describedby={
                    missingStudentGrade ? gradeErrorId : undefined
                  }
                  onChange={(event) =>
                    changeRow(row.clientId, (current) => ({
                      ...current,
                      grade: (event.currentTarget.value ||
                        null) as StudentGrade | null,
                    }))
                  }
                >
                  <option value="">학년 선택</option>
                  {GRADE_OPTIONS.map((grade) => (
                    <option key={grade.value} value={grade.value}>
                      {grade.label}
                    </option>
                  ))}
                </select>
                {missingStudentGrade ? (
                  <small
                    id={gradeErrorId}
                    className="er-bulk-participant-invalid"
                  >
                    학생은 학년을 선택해 주세요.
                  </small>
                ) : null}
              </label>
              <Button
                type="button"
                variant="secondary"
                className="er-bulk-participant-row__remove"
                disabled={disabled}
                aria-label={`${rowNumber}번 참가자 삭제`}
                onClick={() => removeRow(row.clientId)}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </fieldset>
          );
        })}
      </div>
      <Button
        type="button"
        className="er-bulk-participant-add"
        disabled={disabled || atLimit}
        aria-label="참가자 추가"
        onClick={addRow}
      >
        + 참가자 추가
      </Button>
      {duplicates.length > 0 ? (
        <>
          <p
            id="bulk-participant-duplicate-summary"
            className="er-bulk-participant-duplicate"
            role="alert"
          >
            중복 이름이 있습니다. 내용을 확인한 후 다시 제출하세요.
          </p>
          <label className="er-bulk-participant-confirmation">
            <input
              type="checkbox"
              checked={duplicateNamesConfirmed}
              disabled={disabled}
              aria-describedby="bulk-participant-duplicate-summary"
              onChange={(event) =>
                onDuplicateNamesConfirmedChange(event.currentTarget.checked)
              }
            />
            <span>중복 이름을 확인했습니다</span>
          </label>
        </>
      ) : null}
    </div>
  );
}
