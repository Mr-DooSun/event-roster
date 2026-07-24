import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DateInput } from "../../components/ui/DateInput";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";

export interface ProjectFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    startDate?: string;
    endDate?: string;
  }) => Promise<void>;
}

export function ProjectFormDialog({
  open,
  onClose,
  onSubmit,
}: ProjectFormDialogProps) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const reversed = Boolean(startDate && endDate && endDate < startDate);

  useEffect(() => {
    if (open) return;
    setName("");
    setStartDate("");
    setEndDate("");
    setBusy(false);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || reversed || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="새 프로젝트" onClose={onClose} hideDefaultCloseAction>
      <form className="er-dialog-form" onSubmit={submit}>
        <TextInput
          label="프로젝트 이름"
          required
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className="er-dialog-form__dates">
          <DateInput
            label="시작일"
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
          <DateInput
            label="종료일"
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
        </div>
        {reversed ? (
          <p
            className="er-status er-status--error er-dialog-form__error"
            role="alert"
          >
            종료일은 시작일보다 빠를 수 없습니다.
          </p>
        ) : null}
        <div className="er-dialog-actions">
          <Button type="button" onClick={onClose}>
            닫기
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || reversed}
            loading={busy}
            loadingText="만드는 중…"
          >
            프로젝트 만들기
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
