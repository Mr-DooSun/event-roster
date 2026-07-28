import {
  type BulkParticipantDuplicate,
  canonicalizeParticipantName,
  normalizeParticipantName,
} from "@event-roster/contracts";

export function parseBulkParticipantNames(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map(normalizeParticipantName)
    .filter((name) => name.length > 0);
}

export interface BulkParticipantNameFieldProps {
  rawValue: string;
  names: string[];
  duplicates: BulkParticipantDuplicate[];
  duplicateNamesConfirmed: boolean;
  disabled?: boolean;
  onRawValueChange(value: string): void;
  onDuplicateNamesConfirmedChange(value: boolean): void;
}

export function BulkParticipantNameField({
  rawValue,
  names,
  duplicates,
  duplicateNamesConfirmed,
  disabled = false,
  onRawValueChange,
  onDuplicateNamesConfirmedChange,
}: BulkParticipantNameFieldProps) {
  const overLimit = names.length > 30;
  const hasInvalidName = names.some((name) => name.length > 100);
  const duplicateByName = new Map(
    duplicates.map((duplicate) => [
      canonicalizeParticipantName(duplicate.name),
      duplicate,
    ]),
  );
  const previewOccurrences = new Map<string, number>();

  return (
    <div className="er-bulk-participant-summary">
      <label className="er-field" htmlFor="bulk-participant-names">
        <span>이름</span>
        <textarea
          id="bulk-participant-names"
          className="er-bulk-participant-textarea"
          value={rawValue}
          disabled={disabled}
          aria-describedby="bulk-participant-help bulk-participant-count"
          onChange={(event) => onRawValueChange(event.currentTarget.value)}
        />
      </label>
      <p id="bulk-participant-help" className="er-field-hint">
        한 줄에 한 명씩 입력하세요.
      </p>
      <p
        id="bulk-participant-count"
        className={`er-bulk-participant-count${
          overLimit ? " er-bulk-participant-count--error" : ""
        }`}
      >
        등록 예정 {names.length}명 / 최대 30명
      </p>
      {hasInvalidName ? (
        <p className="er-form-error">이름은 100자 이하여야 합니다.</p>
      ) : null}
      {names.length > 0 ? (
        <ol className="er-bulk-participant-list" aria-label="등록 예정 참가자">
          {names.map((name, index) => {
            const canonicalName = canonicalizeParticipantName(name);
            const occurrence = (previewOccurrences.get(canonicalName) ?? 0) + 1;
            previewOccurrences.set(canonicalName, occurrence);
            const duplicate = duplicateByName.get(canonicalName);
            const invalid = name.length > 100;
            return (
              <li key={`${canonicalName}:${occurrence}`}>
                <span
                  className={
                    invalid ? "er-bulk-participant-invalid" : undefined
                  }
                >
                  {index + 1}. {name}
                </span>
                {duplicate?.kinds.includes("INPUT_DUPLICATE") ? (
                  <span className="er-bulk-participant-duplicate">
                    입력 목록에 같은 이름이 있습니다.
                  </span>
                ) : null}
                {duplicate?.kinds.includes("EXISTING_PARTICIPANT") ? (
                  <span className="er-bulk-participant-duplicate">
                    이 조직에 같은 이름의 참가자가 있습니다.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {duplicates.length > 0 ? (
        <label className="er-bulk-participant-confirmation">
          <input
            type="checkbox"
            checked={duplicateNamesConfirmed}
            disabled={disabled}
            onChange={(event) =>
              onDuplicateNamesConfirmedChange(event.currentTarget.checked)
            }
          />
          <span>중복 이름을 확인했습니다</span>
        </label>
      ) : null}
    </div>
  );
}
