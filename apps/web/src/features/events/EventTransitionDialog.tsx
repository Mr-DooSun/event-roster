import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import type { EventStatus } from "./legacy-event-contracts";

export function EventTransitionDialog({
  eventName,
  targetStatus,
  onConfirm,
  onClose,
}: {
  eventName: string;
  targetStatus: EventStatus;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog title="행사 상태 변경" onClose={onClose}>
      <p>
        <strong>{eventName}</strong> 행사를 {statusLabel(targetStatus)} 상태로
        변경합니다.
      </p>
      <Button type="button" variant="primary" onClick={() => void onConfirm()}>
        변경 확인
      </Button>
    </Dialog>
  );
}

function statusLabel(status: EventStatus) {
  return {
    DRAFT: "초안",
    PRE_REGISTRATION: "사전 등록",
    DAY_OF: "당일 운영",
    CLOSED: "종료",
  }[status];
}
