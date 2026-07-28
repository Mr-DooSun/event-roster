import type { ProjectSummary } from "@event-roster/contracts";
import { Card } from "../../components/ui/Card";

export function SummaryCards({ summary }: { summary: ProjectSummary }) {
  return (
    <>
      <div className="er-summary-grid">
        <Card className="er-summary-card">
          <span>예상</span>
          <strong>예상 {summary.expectedTotal}명</strong>
        </Card>
        <Card className="er-summary-card">
          <span>실제</span>
          <strong>실제 {summary.finalTotal}명</strong>
        </Card>
        <Card className="er-summary-card">
          <span>증감</span>
          <strong>
            {summary.deltaTotal > 0 ? "+" : ""}
            {summary.deltaTotal}명
          </strong>
        </Card>
        <Card className="er-summary-card">
          <span>학생</span>
          <strong>학생 {summary.studentTotal}명</strong>
        </Card>
        <Card className="er-summary-card">
          <span>담당교사</span>
          <strong>담당교사 {summary.teacherTotal}명</strong>
        </Card>
      </div>
      <Card className="er-panel">
        <h2>조직별 현황</h2>
        <div className="er-table-wrap">
          <table>
            <thead>
              <tr>
                <th>조직</th>
                <th>학생</th>
                <th>담당교사</th>
                <th>예상</th>
                <th>진행 중 추가</th>
                <th>진행 중 취소</th>
                <th>실제</th>
              </tr>
            </thead>
            <tbody>
              {summary.organizations.map((row) => (
                <tr key={row.organizationId}>
                  <td>
                    <span className="er-table-organization">
                      <span>{row.organizationName}</span>
                      {!row.isActive || !row.masterIsActive ? (
                        <span className="er-badge er-badge--inactive">
                          비활성
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>{row.studentCount}</td>
                  <td>{row.teacherCount}</td>
                  <td>{row.expected}</td>
                  <td>{row.inProgressAdded}</td>
                  <td>{row.inProgressCancelled}</td>
                  <td>{row.final}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
