import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

export interface RosterView {
  id: string;
  eventId: string;
  participantId: string;
  participantNumber: string;
  organizationId: string;
  participantName: string;
  organizationName: string;
  source: "PRE_EVENT" | "DAY_OF";
  status: "ACTIVE" | "CANCELLED";
  wasExpectedAtDayOf: boolean;
  revision: number;
  updatedAt: string;
}

export function RosterTable({
  rows,
  canMutate,
  onStatusChange,
  onEdit,
}: {
  rows: RosterView[];
  canMutate: boolean;
  onStatusChange: (
    row: RosterView,
    status: "ACTIVE" | "CANCELLED",
  ) => Promise<void>;
  onEdit: (row: RosterView) => void;
}) {
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState("ALL");
  const [status, setStatus] = useState<"ALL" | RosterView["status"]>("ALL");
  const organizations = useMemo(
    () => [...new Set(rows.slice(0, 130).map((row) => row.organizationName))],
    [rows],
  );
  const filtered = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return rows.slice(0, 130).filter((row) => {
      const matchesQuery =
        !key ||
        `${row.participantName} ${row.organizationName} ${row.participantNumber}`
          .toLocaleLowerCase()
          .includes(key);
      const matchesOrganization =
        organization === "ALL" || row.organizationName === organization;
      const matchesStatus = status === "ALL" || row.status === status;
      return matchesQuery && matchesOrganization && matchesStatus;
    });
  }, [organization, query, rows, status]);
  return (
    <div className="er-page-stack">
      <div className="er-filter-row">
        <TextInput
          label="명단 검색"
          placeholder="이름, 조직, 고유 ID"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <label className="er-field">
          <span>조직 필터</span>
          <select
            value={organization}
            onChange={(event) => setOrganization(event.currentTarget.value)}
          >
            <option value="ALL">전체 조직</option>
            {organizations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="er-field">
          <span>상태 필터</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as typeof status)
            }
          >
            <option value="ALL">전체 상태</option>
            <option value="ACTIVE">참석</option>
            <option value="CANCELLED">취소</option>
          </select>
        </label>
      </div>
      {rows.length > 130 ? (
        <p className="er-status er-status--error" role="alert">
          화면 표시 한도 130명을 초과했습니다. 데이터 상태를 확인해 주세요.
        </p>
      ) : null}
      <div className="er-table-wrap">
        <table>
          <thead>
            <tr>
              <th>고유 ID</th>
              <th>이름</th>
              <th>조직</th>
              <th>구분</th>
              <th>상태</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.participantNumber}</td>
                <td>{row.participantName}</td>
                <td>{row.organizationName}</td>
                <td>{row.source === "PRE_EVENT" ? "사전" : "당일 추가"}</td>
                <td>{row.status === "ACTIVE" ? "참석" : "취소"}</td>
                <td>
                  {canMutate ? (
                    <div className="er-action-row">
                      <Button type="button" onClick={() => onEdit(row)}>
                        정보 수정
                      </Button>
                      <Button
                        type="button"
                        variant={
                          row.status === "ACTIVE" ? "danger" : "secondary"
                        }
                        onClick={() =>
                          void onStatusChange(
                            row,
                            row.status === "ACTIVE" ? "CANCELLED" : "ACTIVE",
                          )
                        }
                      >
                        {row.participantName}{" "}
                        {row.status === "ACTIVE" ? "취소" : "복원"}
                      </Button>
                    </div>
                  ) : (
                    "읽기 전용"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
