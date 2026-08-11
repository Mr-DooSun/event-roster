import type { OrganizationSummary } from "@event-roster/contracts";
import { useMemo, useState } from "react";
import { canonicalizeOrganizationInput } from "../../lib/organization-name";

export interface ProjectOrganizationBulkPickerProps {
  organizations: OrganizationSummary[];
  linkedOrganizationIds: ReadonlySet<string>;
  selectedOrganizationIds: ReadonlySet<string>;
  disabled: boolean;
  onSelectionChange(next: string[]): void;
}

export function ProjectOrganizationBulkPicker({
  organizations,
  linkedOrganizationIds,
  selectedOrganizationIds,
  disabled,
  onSelectionChange,
}: ProjectOrganizationBulkPickerProps) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => {
    const canonicalQuery = canonicalizeOrganizationInput(query);
    return organizations.filter(
      (organization) =>
        organization.isActive &&
        !organization.isDeleted &&
        (!canonicalQuery ||
          canonicalizeOrganizationInput(organization.name).includes(
            canonicalQuery,
          )),
    );
  }, [organizations, query]);

  const selectedIds = [...selectedOrganizationIds];

  return (
    <div className="er-project-organization-bulk-picker">
      <label className="er-field">
        <span>조직 이름 검색</span>
        <input
          disabled={disabled}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="er-project-organization-candidate-grid">
        {candidates.map((organization) => {
          const linked = linkedOrganizationIds.has(organization.id);
          const selected = selectedOrganizationIds.has(organization.id);
          return (
            <label
              className="er-project-organization-candidate"
              data-linked={linked || undefined}
              key={organization.id}
            >
              <input
                type="checkbox"
                aria-label={organization.name}
                checked={selected}
                disabled={disabled || linked}
                onChange={() =>
                  onSelectionChange(
                    selected
                      ? selectedIds.filter((id) => id !== organization.id)
                      : [...selectedIds, organization.id],
                  )
                }
              />
              <span className="er-project-organization-candidate__name">
                {organization.name}
              </span>
              <dl className="er-project-organization-candidate__facts">
                <div>
                  <dt>대표 담당자</dt>
                  <dd>
                    {organization.primaryLeader?.displayName ?? "대표 미지정"}
                  </dd>
                </div>
                <div>
                  <dt>연결 프로젝트</dt>
                  <dd>{organization.projectCount}개</dd>
                </div>
              </dl>
              {linked ? <span className="er-muted">이미 추가됨</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
