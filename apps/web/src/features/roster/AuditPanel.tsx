import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export interface AuditView {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  details?: Record<string, string>;
}

export function AuditPanel({
  items,
  nextCursor,
  onLoadMore,
}: {
  items: AuditView[];
  nextCursor: string | null;
  onLoadMore: () => Promise<void>;
}) {
  return (
    <Card className="er-panel">
      <h2>변경 이력</h2>
      {items.length === 0 ? (
        <p className="er-muted">아직 기록이 없습니다.</p>
      ) : (
        <ol className="er-audit-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{actionLabel(item.action)}</strong>
                <span className="er-muted">
                  수행자 {item.actorUserId ?? "시스템"} · 대상 {item.entityType}{" "}
                  / {item.entityId}
                </span>
                {item.details && Object.keys(item.details).length > 0 ? (
                  <span className="er-muted">
                    {Object.entries(item.details)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString("ko-KR")}
              </time>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <Button type="button" onClick={() => void onLoadMore()}>
          이력 더 보기
        </Button>
      ) : null}
    </Card>
  );
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    ROSTER_ADDED: "명단 추가",
    ROSTER_CANCELLED: "참석 취소",
    ROSTER_REACTIVATED: "참석 복원",
    ROSTER_IMPORTED: "엑셀 명단 반영",
    EVENT_REOPENED: "행사 재개",
  };
  return labels[action] ?? action;
}
