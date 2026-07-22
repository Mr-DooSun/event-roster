import type { Project } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";

export interface ProjectEditInput {
  name?: string;
  startDate: string | null;
  endDate: string | null;
  expectedRevision: number;
}

export function ProjectEditDialog({
  project,
  closed,
  onSubmit,
  onClose,
}: {
  project: Project;
  closed: boolean;
  onSubmit: (input: ProjectEditInput) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [endDate, setEndDate] = useState(project.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const reversed = Boolean(startDate && endDate && endDate < startDate);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || reversed || (!closed && !name.trim())) return;
    setBusy(true);
    try {
      await onSubmit({
        ...(!closed ? { name: name.trim() } : {}),
        startDate: startDate || null,
        endDate: endDate || null,
        expectedRevision: project.revision,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={closed ? "일정 수정" : "프로젝트 수정"} onClose={onClose}>
      <form className="er-form-grid" onSubmit={submit}>
        <TextInput
          label="프로젝트 이름"
          required={!closed}
          disabled={closed}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <TextInput
          label="시작일"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.currentTarget.value)}
        />
        <TextInput
          label="종료일"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.currentTarget.value)}
        />
        {reversed ? (
          <p className="er-status er-status--error" role="alert">
            종료일은 시작일보다 빠를 수 없습니다.
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || reversed || (!closed && !name.trim())}
        >
          저장
        </Button>
      </form>
    </Dialog>
  );
}
