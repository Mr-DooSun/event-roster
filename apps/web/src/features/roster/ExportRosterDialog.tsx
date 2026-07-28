import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import type { RosterView } from "./RosterTable";

export interface ExportRosterSummary {
  total: number;
  active: number;
  cancelled: number;
  students: number;
  teachers: number;
}

export function buildExportRosterSummary(
  rows: RosterView[],
): ExportRosterSummary {
  return rows.reduce<ExportRosterSummary>(
    (summary, row) => ({
      total: summary.total + 1,
      active: summary.active + (row.status === "ACTIVE" ? 1 : 0),
      cancelled: summary.cancelled + (row.status === "CANCELLED" ? 1 : 0),
      students:
        summary.students +
        (row.status === "ACTIVE" && row.role === "STUDENT" ? 1 : 0),
      teachers:
        summary.teachers +
        (row.status === "ACTIVE" && row.role === "TEACHER" ? 1 : 0),
    }),
    { total: 0, active: 0, cancelled: 0, students: 0, teachers: 0 },
  );
}

export function ExportRosterDialog({
  projectName,
  rows,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  projectName: string;
  rows: RosterView[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const summary = buildExportRosterSummary(rows);
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog title="엑셀 명단 내보내기" hideDefaultCloseAction onClose={close}>
      <p>
        <strong>{projectName}</strong>의 명단을 엑셀 파일로 내보냅니다.
      </p>
      <dl>
        <div>
          <dt>전체</dt>
          <dd>{summary.total}명</dd>
        </div>
        <div>
          <dt>참석</dt>
          <dd>{summary.active}명</dd>
        </div>
        <div>
          <dt>취소</dt>
          <dd>{summary.cancelled}명</dd>
        </div>
        <div>
          <dt>학생</dt>
          <dd>{summary.students}명</dd>
        </div>
        <div>
          <dt>교사</dt>
          <dd>{summary.teachers}명</dd>
        </div>
      </dl>
      <p>현재 화면 필터와 관계없이 전체 명단을 내보냅니다.</p>
      <p>취소 명단도 상태와 함께 포함됩니다.</p>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <div className="er-action-row">
        <Button type="button" disabled={pending} onClick={close}>
          취소
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={pending}
          loadingText="내보내는 중…"
          onClick={onConfirm}
        >
          엑셀 내보내기
        </Button>
      </div>
    </Dialog>
  );
}
