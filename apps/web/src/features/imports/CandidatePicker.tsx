export interface ImportCandidate {
  participantId: string;
  participantNumber: string;
  name: string;
}

export function CandidatePicker({
  rowNumber,
  candidates,
  value,
  disabled,
  onChange,
}: {
  rowNumber: number;
  candidates: ImportCandidate[];
  value: string;
  disabled?: boolean;
  onChange: (participantId: string) => void;
}) {
  return (
    <label className="er-field">
      <span>{rowNumber}행 동명이인 선택</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">선택하세요</option>
        {candidates.map((candidate) => (
          <option key={candidate.participantId} value={candidate.participantId}>
            {candidate.name} · {candidate.participantNumber}
          </option>
        ))}
      </select>
    </label>
  );
}
