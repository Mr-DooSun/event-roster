import type {
  ProjectOrganization,
  ProjectSummary,
} from "@event-roster/contracts";
import { Card } from "../../components/ui/Card";
import { SummaryCards } from "../roster/SummaryCards";

export function ProjectOverview({
  summary,
  memberships,
  showSummary = true,
  showMemberships = true,
}: {
  summary: ProjectSummary;
  memberships: ProjectOrganization[];
  showSummary?: boolean;
  showMemberships?: boolean;
}) {
  const activeOrganizationCount = memberships.filter(
    (membership) => membership.isActive && membership.masterIsActive,
  ).length;

  return (
    <div className="er-page-stack">
      {showMemberships ? (
        <Card className="er-panel">
          <h2>프로젝트 개요</h2>
          <p>
            등록 조직 <strong>{activeOrganizationCount}개</strong>
          </p>
        </Card>
      ) : null}
      {showSummary ? <SummaryCards summary={summary} /> : null}
    </div>
  );
}
