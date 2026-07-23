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
    PROJECT_REOPENED: "프로젝트 재개",
    ORGANIZATION_CREATED: "조직 생성",
    ORGANIZATION_RENAMED: "조직 이름 변경",
    ORGANIZATION_DEACTIVATED: "조직 사용 중지",
    ORGANIZATION_REACTIVATED: "조직 다시 사용",
    ORGANIZATION_PRIMARY_ASSIGNED: "대표 조직장 지정",
    ORGANIZATION_PRIMARY_REPLACED: "대표 조직장 변경",
    ORGANIZATION_PRIMARY_REMOVED: "대표 조직장 해제",
    ORGANIZATION_MANAGER_ASSIGNED: "조직 담당자 지정",
    ORGANIZATION_MANAGER_REMOVED: "조직 담당자 해제",
  };
  return labels[action] ?? action;
}
