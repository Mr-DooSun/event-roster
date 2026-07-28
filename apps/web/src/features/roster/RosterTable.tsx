import type { ParticipantRole, StudentGrade } from "@event-roster/contracts";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { GRADE_LABEL, ROLE_LABEL } from "./participant-profile-labels";

export interface RosterView {
  id: string;
  projectId: string;
  participantId: string;
  participantNumber: string;
  organizationId: string;
  participantName: string;
  organizationName: string;
  role: ParticipantRole | null;
  grade: StudentGrade | null;
  source: "PRE_REGISTRATION" | "IN_PROGRESS";
  status: "ACTIVE" | "CANCELLED";
  wasExpectedAtStart: boolean;
  revision: number;
  updatedAt: string;
}

export function RosterTable({
  rows,
  canMutate,
  busyRowIds,
  canMutateRow = () => true,
  canEditRow = canMutateRow,
  onStatusChange,
  onEdit,
}: {
  rows: RosterView[];
  canMutate: boolean;
  busyRowIds?: ReadonlySet<string>;
  canMutateRow?: (row: RosterView) => boolean;
  canEditRow?: (row: RosterView) => boolean;
  onStatusChange: (
    row: RosterView,
    status: "ACTIVE" | "CANCELLED",
  ) => Promise<void>;
  onEdit: (row: RosterView) => void;
}) {
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState("ALL");
  const [status, setStatus] = useState<"ALL" | RosterView["status"]>("ALL");
  const [role, setRole] = useState<"ALL" | ParticipantRole | "UNSPECIFIED">(
    "ALL",
  );
  const [grade, setGrade] = useState<"ALL" | StudentGrade | "UNSPECIFIED">(
    "ALL",
  );
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
      const matchesRole =
        role === "ALL" ||
        (role === "UNSPECIFIED" ? row.role === null : row.role === role);
      const matchesGrade =
        grade === "ALL" ||
        (grade === "UNSPECIFIED" ? row.grade === null : row.grade === grade);
      return (
        matchesQuery &&
        matchesOrganization &&
        matchesStatus &&
        matchesRole &&
        matchesGrade
      );
    });
  }, [grade, organization, query, role, rows, status]);
  return (
    <div className="er-page-stack">
      <div className="er-roster-filters">
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
        <label className="er-field">
          <span>참가자 구분 필터</span>
          <select
            value={role}
            onChange={(event) =>
              setRole(event.currentTarget.value as typeof role)
            }
          >
            <option value="ALL">전체 구분</option>
            <option value="STUDENT">{ROLE_LABEL.STUDENT}</option>
            <option value="TEACHER">{ROLE_LABEL.TEACHER}</option>
            <option value="UNSPECIFIED">미지정</option>
          </select>
        </label>
        <label className="er-field">
          <span>학년 필터</span>
          <select
            value={grade}
            onChange={(event) =>
              setGrade(event.currentTarget.value as typeof grade)
            }
          >
            <option value="ALL">전체 학년</option>
            {Object.entries(GRADE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="UNSPECIFIED">미지정</option>
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
              <th>참가자 구분</th>
              <th>학년</th>
              <th>등록 시점</th>
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
                <td>{row.role ? ROLE_LABEL[row.role] : "미지정"}</td>
                <td>
                  {row.role === "TEACHER"
                    ? "-"
                    : row.grade
                      ? GRADE_LABEL[row.grade]
                      : "미지정"}
                </td>
                <td>
                  {row.source === "PRE_REGISTRATION" ? "사전" : "진행 중 추가"}
                </td>
                <td>{row.status === "ACTIVE" ? "참석" : "취소"}</td>
                <td>
                  {canMutate && canMutateRow(row) ? (
                    <div className="er-action-row">
                      <Button
                        type="button"
                        disabled={busyRowIds?.has(row.id) || !canEditRow(row)}
                        onClick={() => onEdit(row)}
                      >
                        정보 수정
                      </Button>
                      <Button
                        type="button"
                        variant={
                          row.status === "ACTIVE" ? "danger" : "secondary"
                        }
                        loading={busyRowIds?.has(row.id) ?? false}
                        loadingText="변경 중…"
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
