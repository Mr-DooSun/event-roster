import type {
  Gender,
  ParticipantRole,
  StudentGrade,
} from "@event-roster/contracts";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type RosterFilter = "organization" | "gender" | "status" | "role" | "grade";

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
  const [activeFilter, setActiveFilter] = useState<RosterFilter | null>(null);
  const [filterMenuPosition, setFilterMenuPosition] = useState({
    top: 0,
    left: 0,
  });
  const filterMenuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (activeFilter === null) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (filterMenuRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-roster-filter-trigger]")
      ) {
        return;
      }
      setActiveFilter(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveFilter(null);
    };
    const closeOnViewportChange = () => setActiveFilter(null);

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [activeFilter]);

  const toggleFilter = (filter: RosterFilter, trigger: HTMLButtonElement) => {
    if (activeFilter === filter) {
      setActiveFilter(null);
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = 208;
    const viewportPadding = 16;
    setFilterMenuPosition({
      top: triggerRect.bottom + 8,
      left: Math.max(
        viewportPadding,
        Math.min(
          triggerRect.left,
          window.innerWidth - menuWidth - viewportPadding,
        ),
      ),
    });
    setActiveFilter(filter);
  };

  const renderFilterMenu = (filter: RosterFilter, label: string) => {
    if (activeFilter !== filter) return null;

    let control: ReactNode;
    if (filter === "organization") {
      control = (
        <select
          aria-label="조직 필터"
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
      );
    } else if (filter === "gender") {
      control = (
        <select
          aria-label="성별 필터"
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
      );
    } else if (filter === "status") {
      control = (
        <select
          aria-label="상태 필터"
          value={status}
          onChange={(event) =>
            setStatus(event.currentTarget.value as typeof status)
          }
        >
          <option value="ALL">전체 상태</option>
          <option value="ACTIVE">참석</option>
          <option value="CANCELLED">취소</option>
        </select>
      );
    } else if (filter === "role") {
      control = (
        <select
          aria-label="참가자 구분 필터"
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
      );
    } else {
      control = (
        <select
          aria-label="학년 필터"
          value={grade}
          onChange={(event) =>
            setGrade(event.currentTarget.value as typeof grade)
          }
        >
          <option value="ALL">전체 학년</option>
          {Object.entries(GRADE_LABEL).map(([value, gradeLabel]) => (
            <option key={value} value={value}>
              {gradeLabel}
            </option>
          ))}
          <option value="UNSPECIFIED">미지정</option>
        </select>
      );
    }

    return createPortal(
      <div
        ref={filterMenuRef}
        className="er-roster-filter-popover"
        role="dialog"
        aria-label={`${label} 필터 메뉴`}
        style={filterMenuPosition}
      >
        <div className="er-field">
          <span>{label} 필터</span>
          {control}
        </div>
      </div>,
      document.body,
    );
  };

  return (
    <div className="er-page-stack">
      <div className="er-roster-filters">
        <TextInput
          label="명단 검색"
          placeholder="이름, 조직"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
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
              <th className="er-roster-header-cell">
                <span>이름</span>
                <button
                  type="button"
                  aria-label="이름 정렬"
                  className="er-roster-header-icon"
                  onClick={() => setSort("NAME")}
                >
                  ↕
                </button>
              </th>
              <th className="er-roster-header-cell">
                <span>조직</span>
                <button
                  type="button"
                  aria-label="조직 정렬"
                  className="er-roster-header-icon"
                  onClick={() => setSort("ORGANIZATION")}
                >
                  ↕
                </button>
                <button
                  type="button"
                  aria-label="조직 필터"
                  className="er-roster-header-icon"
                  aria-haspopup="dialog"
                  aria-expanded={activeFilter === "organization"}
                  data-roster-filter-trigger
                  onClick={(event) =>
                    toggleFilter("organization", event.currentTarget)
                  }
                >
                  ⏷
                </button>
                {renderFilterMenu("organization", "조직")}
              </th>
              <th className="er-roster-header-cell">
                <span>참가자 구분</span>
                <button
                  type="button"
                  aria-label="참가자 구분 필터"
                  className="er-roster-header-icon"
                  aria-haspopup="dialog"
                  aria-expanded={activeFilter === "role"}
                  data-roster-filter-trigger
                  onClick={(event) => toggleFilter("role", event.currentTarget)}
                >
                  ⏷
                </button>
                {renderFilterMenu("role", "참가자 구분")}
              </th>
              <th className="er-roster-header-cell">
                <span>학년</span>
                <button
                  type="button"
                  aria-label="학년 정렬"
                  className="er-roster-header-icon"
                  onClick={() => setSort("GRADE")}
                >
                  ↕
                </button>
                <button
                  type="button"
                  aria-label="학년 필터"
                  className="er-roster-header-icon"
                  aria-haspopup="dialog"
                  aria-expanded={activeFilter === "grade"}
                  data-roster-filter-trigger
                  onClick={(event) =>
                    toggleFilter("grade", event.currentTarget)
                  }
                >
                  ⏷
                </button>
                {renderFilterMenu("grade", "학년")}
              </th>
              <th className="er-roster-header-cell">
                <span>성별</span>
                <button
                  type="button"
                  aria-label="성별 필터"
                  className="er-roster-header-icon"
                  aria-haspopup="dialog"
                  aria-expanded={activeFilter === "gender"}
                  data-roster-filter-trigger
                  onClick={(event) =>
                    toggleFilter("gender", event.currentTarget)
                  }
                >
                  ⏷
                </button>
                {renderFilterMenu("gender", "성별")}
              </th>
              <th>등록 시점</th>
              <th className="er-roster-header-cell">
                <span>상태</span>
                <button
                  type="button"
                  aria-label="상태 필터"
                  className="er-roster-header-icon"
                  aria-haspopup="dialog"
                  aria-expanded={activeFilter === "status"}
                  data-roster-filter-trigger
                  onClick={(event) =>
                    toggleFilter("status", event.currentTarget)
                  }
                >
                  ⏷
                </button>
                {renderFilterMenu("status", "상태")}
              </th>
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
