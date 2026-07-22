import type {
  ProjectOrganization,
  ProjectSummary,
} from "@event-roster/contracts";
import { Card } from "../../components/ui/Card";
import { SummaryCards } from "../roster/SummaryCards";

export function ProjectOverview({
  summary,
  memberships,
}: {
  summary: ProjectSummary;
  memberships: ProjectOrganization[];
}) {
  const activeOrganizationCount = memberships.filter(
    (membership) => membership.isActive && membership.masterIsActive,
  ).length;

  return (
    <div className="er-page-stack">
      <Card className="er-panel">
        <h2>프로젝트 개요</h2>
        <p>
          등록 조직 <strong>{activeOrganizationCount}개</strong>
        </p>
      </Card>
      <SummaryCards summary={summary} />
    </div>
  );
}
