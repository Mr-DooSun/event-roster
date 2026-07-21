import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";

export function TemporaryPasswordDialog({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  return (
    <Dialog title="임시 비밀번호" onClose={onClose}>
      <p className="er-secret-value">{value}</p>
      <StatusMessage>닫으면 다시 표시되지 않습니다.</StatusMessage>
    </Dialog>
  );
}
