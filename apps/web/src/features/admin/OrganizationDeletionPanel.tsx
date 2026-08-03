import type { OrganizationDetail } from "@event-roster/contracts";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextInput } from "../../components/ui/TextInput";

export interface OrganizationDeletionPanelProps {
  organization: OrganizationDetail;
  dialogOpen: boolean;
  confirmationName: string;
  deleting: boolean;
  disabled?: boolean;
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
  disabled = false,
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

  if (organization.isDeleted) return null;

  const canConfirm =
    !disabled && confirmationName === organization.name && !deleting;

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
        <p>담당자, 참가자, 프로젝트 기록은 보존됩니다.</p>
        <p>나중에 복구할 수 있습니다.</p>
        <Button
          type="button"
          variant="danger"
          disabled={disabled}
          onClick={onOpen}
        >
          조직 삭제
        </Button>
      </section>
      {dialogOpen ? (
        <Dialog title="조직 삭제" onClose={closeDialog} hideDefaultCloseAction>
          <div className="er-dialog-form er-organization-deletion-dialog">
            <p>
              <span className="er-danger-zone__target">
                {organization.name}
              </span>
              조직을 삭제합니다.
            </p>
            <p>담당자, 참가자, 프로젝트 기록은 보존됩니다.</p>
            <p>삭제하면 일반 조직 목록과 조직 선택기에서 숨겨집니다.</p>
            {organization.isActive ? (
              <p>사용 중인 조직은 자동으로 사용 중지됩니다.</p>
            ) : null}
            <p>나중에 복구할 수 있습니다.</p>
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
                조직 삭제
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
