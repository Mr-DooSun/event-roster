import type { NormalizedImportRow } from "@event-roster/contracts";
import { GRADE_LABEL, ROLE_LABEL } from "../roster/participant-profile-labels";
import { CandidatePicker, type ImportCandidate } from "./CandidatePicker";

export interface ValidatedImportRow {
  rowNumber: number;
  name: string;
  organizationName: string;
  issues: string[];
  candidates: ImportCandidate[];
}

export function ValidationTable({
  rows,
  normalizedRows,
  disabled = false,
  onResolve,
}: {
  rows: ValidatedImportRow[];
  normalizedRows: NormalizedImportRow[];
  disabled?: boolean;
  onResolve: (rowNumber: number, participantId: string) => void;
}) {
  return (
    <div className="er-table-wrap">
      <table>
        <thead>
          <tr>
            <th>행</th>
            <th>이름</th>
            <th>조직</th>
            <th>참가자 구분</th>
            <th>학년</th>
            <th>검증 결과</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const normalized = normalizedRows.find(
              (item) => item.rowNumber === row.rowNumber,
            );
            return (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{row.name}</td>
                <td>{row.organizationName}</td>
                <td>{normalized ? ROLE_LABEL[normalized.role] : "-"}</td>
                <td>
                  {normalized?.grade ? GRADE_LABEL[normalized.grade] : "-"}
                </td>
                <td>
                  {row.issues.length === 0 ? "정상" : row.issues.join(", ")}
                  {row.candidates.length > 1 ? (
                    <CandidatePicker
                      rowNumber={row.rowNumber}
                      candidates={row.candidates}
                      disabled={disabled}
                      value={normalized?.resolvedParticipantId ?? ""}
                      onChange={(participantId) =>
                        onResolve(row.rowNumber, participantId)
                      }
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
