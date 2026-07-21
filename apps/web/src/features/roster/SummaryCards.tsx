import type { EventSummary } from "@event-roster/contracts";
import { Card } from "../../components/ui/Card";

export function SummaryCards({ summary }: { summary: EventSummary }) {
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
      </div>
      <Card className="er-panel">
        <h2>조직별 현황</h2>
        <div className="er-table-wrap">
          <table>
            <thead>
              <tr>
                <th>조직</th>
                <th>예상</th>
                <th>당일 추가</th>
                <th>당일 취소</th>
                <th>실제</th>
              </tr>
            </thead>
            <tbody>
              {summary.organizations.map((row) => (
                <tr key={row.organizationId}>
                  <td>{row.organizationName}</td>
                  <td>{row.expected}</td>
                  <td>{row.dayOfAdded}</td>
                  <td>{row.dayOfCancelled}</td>
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
