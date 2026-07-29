import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";

export interface ProjectDeletionDialogProps {
  open: boolean;
  projectName: string;
  onClose(): void;
  onConfirm(confirmationName: string): Promise<void>;
}

export function ProjectDeletionDialog({
  open,
  projectName,
  onClose,
  onConfirm,
}: ProjectDeletionDialogProps) {
  const [confirmationName, setConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmationName("");
    setSubmitting(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  function close() {
    if (!submitting) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || confirmationName !== projectName) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(confirmationName);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "프로젝트를 삭제하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="프로젝트 삭제" hideDefaultCloseAction onClose={close}>
      <form className="er-dialog-form" onSubmit={(event) => void submit(event)}>
        <p>
          프로젝트는 목록에서 숨겨지며 참가 명단, 조직, 집계와 변경 이력은
          보존됩니다.
        </p>
        <p>삭제된 프로젝트 목록에서 다시 복구할 수 있습니다.</p>
        <label className="er-field">
          <span>삭제할 프로젝트 이름</span>
          <input
            autoComplete="off"
            disabled={submitting}
            value={confirmationName}
            onChange={(event) => setConfirmationName(event.currentTarget.value)}
          />
        </label>
        <p className="er-muted">
          확인을 위해 <strong>{projectName}</strong>을(를) 정확히 입력해 주세요.
        </p>
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <div className="er-dialog-actions">
          <Button type="button" disabled={submitting} onClick={close}>
            취소
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={submitting}
            loadingText="삭제 중…"
            disabled={confirmationName !== projectName}
          >
            프로젝트 삭제
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
