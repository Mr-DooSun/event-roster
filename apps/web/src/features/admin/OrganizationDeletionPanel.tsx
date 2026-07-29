import type {
  OrganizationDeletionBlockers,
  OrganizationDetail,
} from "@event-roster/contracts";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";

const BLOCKER_LABELS = {
  managerAssignments: ["담당자 배정", "건"],
  participants: ["참가자", "명"],
  projectLinks: ["프로젝트 연결 이력", "건"],
  rosterEntries: ["참가 명단 이력", "건"],
  expectedSnapshots: ["예상 인원 기록", "건"],
} as const;

export interface OrganizationDeletionPanelProps {
  organization: OrganizationDetail;
  dialogOpen: boolean;
  confirmationName: string;
  deleting: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: () => void;
  onConfirmationNameChange: (value: string) => void;
  onConfirm: () => void;
}

export function OrganizationDeletionPanel({
  organization,
  dialogOpen,
  confirmationName,
  deleting,
  error,
  onOpen,
  onClose,
  onConfirmationNameChange,
  onConfirm,
}: OrganizationDeletionPanelProps) {
  const confirmationLockedRef = useRef(false);

  useEffect(() => {
    if (!dialogOpen || !deleting) confirmationLockedRef.current = false;
  }, [dialogOpen, deleting]);

  if (organization.isActive) return null;

  const canDelete = organization.deletionEligibility.canDelete;
  const canConfirm = confirmationName === organization.name && !deleting;

  function closeDialog() {
    if (!deleting) onClose();
  }

  function confirmDeletion() {
    if (!canConfirm || confirmationLockedRef.current) return;
    confirmationLockedRef.current = true;
    onConfirm();
  }

  return (
    <>
      <section className="er-danger-zone" aria-label="위험 구역">
        <h2>위험 구역</h2>
        {canDelete ? (
          <>
            <p>이 조직은 연결된 데이터가 없어 영구 삭제할 수 있습니다.</p>
            <Button type="button" variant="danger" onClick={onOpen}>
              조직 영구 삭제
            </Button>
          </>
        ) : (
          <>
            <p>이 조직에는 보존해야 할 연결 데이터가 있어 삭제할 수 없습니다.</p>
            <ul className="er-danger-zone__blockers">
              {(Object.keys(BLOCKER_LABELS) as Array<
                keyof OrganizationDeletionBlockers
              >)
                .filter(
                  (key) => organization.deletionEligibility.blockers[key] > 0,
                )
                .map((key) => {
                  const [label, unit] = BLOCKER_LABELS[key];
                  const count = organization.deletionEligibility.blockers[key];
                  return (
                    <li key={key}>
                      {label} {count}
                      {unit}
                    </li>
                  );
                })}
            </ul>
            <p>사용 중지 상태로 유지하면 기존 기록은 보존됩니다.</p>
            <Button type="button" variant="danger" disabled>
              조직 영구 삭제
            </Button>
          </>
        )}
      </section>
      {dialogOpen && canDelete ? (
        <Dialog
          title="조직 영구 삭제"
          onClose={closeDialog}
          hideDefaultCloseAction
        >
          <div className="er-dialog-form er-organization-deletion-dialog">
            <p>
              <span className="er-danger-zone__target">{organization.name}</span>
              조직을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <TextInput
              label="확인을 위해 조직 이름을 입력하세요."
              value={confirmationName}
              disabled={deleting}
              onChange={(event) =>
                onConfirmationNameChange(event.currentTarget.value)
              }
            />
            {error ? (
              <p className="er-status er-status--error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="er-dialog-actions">
              <Button type="button" disabled={deleting} onClick={closeDialog}>
                닫기
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={!canConfirm}
                loading={deleting}
                loadingText="삭제 중…"
                onClick={confirmDeletion}
              >
                조직 영구 삭제
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
