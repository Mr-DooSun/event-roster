import type {
  Gender,
  ParticipantRole,
  StudentGrade,
} from "@event-roster/contracts";
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
  gender?: Gender | null;
  source: "PRE_REGISTRATION" | "IN_PROGRESS";
  status: "ACTIVE" | "CANCELLED";
  wasExpectedAtStart: boolean;
  revision: number;
  updatedAt: string;
}

export function RosterTable({
  rows,
  deletedOrganizationIds = new Set<string>(),
  canMutate,
  busyRowIds,
  canMutateRow = () => true,
  canEditRow = canMutateRow,
  onStatusChange,
  onEdit,
}: {
  rows: RosterView[];
  deletedOrganizationIds?: ReadonlySet<string>;
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
  const [gender, setGender] = useState<"ALL" | Gender | "UNSPECIFIED">("ALL");
  const [sort, setSort] = useState<
    "DEFAULT" | "ORGANIZATION" | "GRADE" | "NAME"
  >("DEFAULT");
  const organizations = useMemo(
    () => [...new Set(rows.slice(0, 130).map((row) => row.organizationName))],
    [rows],
  );
  const filtered = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return rows
      .slice(0, 130)
      .filter((row) => {
        const matchesQuery =
          !key ||
          `${row.participantName} ${row.organizationName}`
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
          (grade === "UNSPECIFIED"
            ? row.grade === null
            : row.role !== "TEACHER" && row.grade === grade);
        const matchesGender =
          gender === "ALL" ||
          (gender === "UNSPECIFIED"
            ? row.gender === null
            : row.gender === gender);
        return (
          matchesQuery &&
          matchesOrganization &&
          matchesStatus &&
          matchesRole &&
          matchesGrade &&
          matchesGender
        );
      })
      .sort((left, right) => compareRoster(left, right, sort));
  }, [gender, grade, organization, query, role, rows, sort, status]);
  return (
    <div className="er-page-stack">
      <div className="er-roster-filters">
        <TextInput
          label="명단 검색"
          placeholder="이름, 조직"
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
          <span>성별 필터</span>
          <select
            value={gender}
            onChange={(event) =>
              setGender(event.currentTarget.value as typeof gender)
            }
          >
            <option value="ALL">전체 성별</option>
            <option value="MALE">남성</option>
            <option value="FEMALE">여성</option>
            <option value="UNSPECIFIED">미지정</option>
          </select>
        </label>
        <label className="er-field">
          <span>정렬</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.currentTarget.value as typeof sort)
            }
          >
            <option value="DEFAULT">조직 · 학년 · 이름순</option>
            <option value="ORGANIZATION">조직순</option>
            <option value="GRADE">학년순</option>
            <option value="NAME">이름순</option>
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
              <th>이름</th>
              <th>조직</th>
              <th>참가자 구분</th>
              <th>학년</th>
              <th>성별</th>
              <th>등록 시점</th>
              <th>상태</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.participantName}</td>
                <td>
                  <span className="er-table-organization">
                    <span>{row.organizationName}</span>
                    {deletedOrganizationIds.has(row.organizationId) ? (
                      <span className="er-badge er-badge--deleted">삭제됨</span>
                    ) : null}
                  </span>
                </td>
                <td>{row.role ? ROLE_LABEL[row.role] : "미지정"}</td>
                <td>
                  {row.role === "TEACHER"
                    ? "-"
                    : row.grade
                      ? GRADE_LABEL[row.grade]
                      : "미지정"}
                </td>
                <td>
                  {row.gender === "MALE"
                    ? "남성"
                    : row.gender === "FEMALE"
                      ? "여성"
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
                        aria-label={
                          busyRowIds?.has(row.id)
                            ? undefined
                            : `${row.participantName} ${row.status === "ACTIVE" ? "취소" : "복원"}`
                        }
                      >
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

const GRADE_ORDER: Record<StudentGrade, number> = {
  M1: 0,
  M2: 1,
  M3: 2,
  H1: 3,
  H2: 4,
  H3: 5,
};

function compareRoster(
  left: RosterView,
  right: RosterView,
  sort: "DEFAULT" | "ORGANIZATION" | "GRADE" | "NAME",
) {
  const organization = left.organizationName.localeCompare(
    right.organizationName,
    "ko",
  );
  const grade =
    (left.grade === null ? 6 : GRADE_ORDER[left.grade]) -
    (right.grade === null ? 6 : GRADE_ORDER[right.grade]);
  const name = left.participantName.localeCompare(right.participantName, "ko");
  const defaultOrder = organization || grade || name;
  if (sort === "ORGANIZATION") return organization || grade || name;
  if (sort === "GRADE") return grade || organization || name;
  if (sort === "NAME") return name || organization || grade;
  return defaultOrder;
}
