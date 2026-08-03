import type {
  Organization,
  ProjectOrganization,
  ProjectOrganizationMutationResult,
} from "@event-roster/contracts";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import { getReservedOrganizationId } from "../../lib/organization-errors";
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
import { useAuth } from "../auth/AuthProvider";
import {
  OrganizationCombobox,
  type OrganizationComboboxSelection,
} from "./OrganizationCombobox";

export interface ProjectOrganizationsPanelProps {
  projectId: string;
  projectRevision: number;
  memberships: ProjectOrganization[];
  allOrganizations: Organization[];
  organizationCandidatesAvailable?: boolean;
  canMutateMemberships: boolean;
  canManageOrganizations: boolean;
  onChanged(): Promise<void>;
  onProjectClosed?(): Promise<void>;
}

interface PanelMessage {
  tone: "info" | "error";
  text: string;
}

type OrganizationAction =
  | "ADD_EXISTING"
  | "CREATE_AND_ADD"
  | `TOGGLE:${string}`
  | null;

export function ProjectOrganizationsPanel({
  projectId,
  projectRevision,
  memberships,
  allOrganizations,
  organizationCandidatesAvailable = true,
  canMutateMemberships,
  canManageOrganizations,
  onChanged,
  onProjectClosed,
}: ProjectOrganizationsPanelProps) {
  const { api } = useAuth();
  const visibleMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) =>
          membership.isActive &&
          membership.masterIsActive &&
          !membership.masterIsDeleted,
      ),
    [memberships],
  );
  const linkedOrganizationIds = useMemo(
    () =>
      new Set(
        memberships
          .filter(
            (membership) => membership.isActive && !membership.masterIsDeleted,
          )
          .map((membership) => membership.organizationId),
      ),
    [memberships],
  );
  const [pendingSelection, setPendingSelection] =
    useState<OrganizationComboboxSelection | null>(null);
  const [newConfirmation, setNewConfirmation] = useState<{
    kind: "NEW";
    name: string;
  } | null>(null);
  const [pendingExclusion, setPendingExclusion] =
    useState<ProjectOrganization | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<OrganizationAction>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [reservedOrganizationId, setReservedOrganizationId] = useState<
    string | null
  >(null);
  const [observedProjectRevision, setObservedProjectRevision] =
    useState(projectRevision);

  useEffect(() => {
    setObservedProjectRevision(projectRevision);
  }, [projectRevision]);

  const selectedInactiveMembership =
    pendingSelection?.kind === "EXISTING"
      ? memberships.find(
          (membership) =>
            membership.organizationId === pendingSelection.organizationId &&
            !membership.isActive &&
            !membership.masterIsDeleted,
        )
      : undefined;

  function selectOrganization(selection: OrganizationComboboxSelection) {
    setMessage(null);
    if (selection.kind === "NEW") {
      setPendingSelection(null);
      setReservedOrganizationId(null);
      setNewConfirmation(selection);
      return;
    }
    setNewConfirmation(null);
    setPendingSelection(selection);
  }

  async function mutate(
    action: Exclude<OrganizationAction, null>,
    operation: () => Promise<ProjectOrganizationMutationResult>,
  ) {
    if (busy) return false;
    setBusy(true);
    setBusyAction(action);
    setMessage(null);
    setReservedOrganizationId(null);
    try {
      const result = await operation();
      setObservedProjectRevision(result.projectRevision);
      setPendingSelection(null);
      setNewConfirmation(null);
      setReservedOrganizationId(null);
      try {
        await onChanged();
      } catch {
        setMessage({
          tone: "error",
          text: "조직 변경은 반영됐지만 최신 정보를 불러오지 못했습니다.",
        });
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.problem?.code === "STALE_REVISION") {
          setPendingSelection(null);
          setNewConfirmation(null);
          setPendingExclusion(null);
          await onChanged();
          setMessage({
            tone: "info",
            text: "다른 변경이 먼저 반영되어 최신 프로젝트 정보를 불러왔습니다. 조직을 다시 선택해 주세요.",
          });
          return false;
        }
        const reservedId = getReservedOrganizationId(error);
        if (reservedId) {
          setReservedOrganizationId(reservedId);
          setMessage({
            tone: "error",
            text: "같은 이름의 삭제된 조직이 있습니다.",
          });
          return false;
        }
        if (isOrganizationNameConflict(error)) {
          setPendingSelection(null);
          setNewConfirmation(null);
          await onChanged();
          setMessage({
            tone: "info",
            text: "같은 이름의 조직이 이미 생성되어 최신 조직 목록을 불러왔습니다. 기존 조직을 선택해 주세요.",
          });
          return false;
        }
        if (error.problem?.code === "PROJECT_CLOSED") {
          setPendingSelection(null);
          setNewConfirmation(null);
          await onChanged();
          await onProjectClosed?.();
          setMessage({
            tone: "error",
            text: "프로젝트가 종료되어 조직을 변경할 수 없습니다.",
          });
          return false;
        }
      }
      setMessage({ tone: "error", text: "조직 변경을 반영하지 못했습니다." });
      return false;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function addExisting(event: FormEvent) {
    event.preventDefault();
    if (pendingSelection?.kind !== "EXISTING") return;
    await mutate("ADD_EXISTING", () =>
      api.post<ProjectOrganizationMutationResult>(
        `/projects/${projectId}/organizations`,
        {
          organizationId: pendingSelection.organizationId,
          expectedProjectRevision: observedProjectRevision,
        },
      ),
    );
  }

  async function confirmCreate() {
    if (!newConfirmation) return;
    await mutate("CREATE_AND_ADD", () =>
      api.post<ProjectOrganizationMutationResult>(
        `/projects/${projectId}/organizations`,
        {
          newOrganizationName: newConfirmation.name,
          expectedProjectRevision: observedProjectRevision,
        },
      ),
    );
  }

  async function setActive(membership: ProjectOrganization, active: boolean) {
    return mutate(`TOGGLE:${membership.organizationId}`, () =>
      api.patch<ProjectOrganizationMutationResult>(
        `/projects/${projectId}/organizations/${membership.organizationId}`,
        {
          isActive: active,
          expectedProjectRevision: observedProjectRevision,
        },
      ),
    );
  }

  async function confirmExclusion() {
    if (!pendingExclusion) return;
    const changed = await setActive(pendingExclusion, false);
    if (changed) setPendingExclusion(null);
  }

  return (
    <div className="er-page-stack">
      {message ? (
        <StatusMessage tone={message.tone}>{message.text}</StatusMessage>
      ) : null}
      {canManageOrganizations ? (
        <Card className="er-panel">
          <h2>조직 추가</h2>
          <form className="er-inline-form" onSubmit={addExisting}>
            <OrganizationCombobox
              organizations={allOrganizations}
              linkedOrganizationIds={linkedOrganizationIds}
              disabled={
                busy ||
                !canMutateMemberships ||
                !organizationCandidatesAvailable
              }
              onSelect={selectOrganization}
              onQueryChange={() => setPendingSelection(null)}
            />
            {selectedInactiveMembership ? (
              <StatusMessage tone="info">
                기존 명단과 집계 이력이 있으면 그대로 다시 연결됩니다.
              </StatusMessage>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              loading={busyAction === "ADD_EXISTING"}
              loadingText="프로젝트에 추가 중…"
              disabled={
                busy ||
                !canMutateMemberships ||
                !organizationCandidatesAvailable ||
                !pendingSelection ||
                pendingSelection.kind !== "EXISTING"
              }
            >
              프로젝트에 추가
            </Button>
          </form>
        </Card>
      ) : null}
      <Card className="er-panel">
        <h2>프로젝트 조직</h2>
        {visibleMemberships.length === 0 ? (
          <p className="er-muted">연결된 조직이 없습니다.</p>
        ) : (
          <ul className="er-list">
            {visibleMemberships.map((membership) => (
              <OrganizationMembershipRow
                key={membership.organizationId}
                membership={membership}
                canMutateMemberships={canMutateMemberships}
                canManageOrganizations={canManageOrganizations}
                busy={busy}
                loading={busyAction === `TOGGLE:${membership.organizationId}`}
                onExclude={() => setPendingExclusion(membership)}
                onReactivate={() => setActive(membership, true)}
              />
            ))}
          </ul>
        )}
      </Card>
      {canMutateMemberships && newConfirmation ? (
        <Dialog
          title="새 조직 생성 후 추가"
          onClose={() => {
            setNewConfirmation(null);
            setReservedOrganizationId(null);
          }}
        >
          <p>
            새 조직 이름: <strong>{newConfirmation.name}</strong>
          </p>
          <p>전역 조직으로 생성한 뒤 이 프로젝트에 추가합니다.</p>
          {reservedOrganizationId ? (
            <a
              className="er-organization-recovery-link"
              href={`/organizations/${encodeURIComponent(reservedOrganizationId)}`}
            >
              삭제된 조직 복구하기
            </a>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={busyAction === "CREATE_AND_ADD"}
            loadingText="생성 후 추가 중…"
            disabled={busy}
            onClick={() => void confirmCreate()}
          >
            생성 후 추가
          </Button>
        </Dialog>
      ) : null}
      {canMutateMemberships && pendingExclusion ? (
        <Dialog
          title="프로젝트 조직 제외"
          hideDefaultCloseAction
          onClose={() => {
            if (!busy) setPendingExclusion(null);
          }}
        >
          <p>
            {pendingExclusion.hasBusinessHistory
              ? "기존 명단과 집계를 보존하기 위해 사용 중지 상태로 전환됩니다."
              : "이 조직을 프로젝트에서 제외할까요? 다시 추가할 수 있습니다."}
          </p>
          <div className="er-dialog-actions">
            <Button
              type="button"
              disabled={busy}
              onClick={() => setPendingExclusion(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={
                busyAction === `TOGGLE:${pendingExclusion.organizationId}`
              }
              loadingText="제외 중…"
              disabled={busy}
              onClick={() => void confirmExclusion()}
            >
              제외하기
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function OrganizationMembershipRow({
  membership,
  canMutateMemberships,
  canManageOrganizations,
  busy,
  loading,
  onExclude,
  onReactivate,
}: {
  membership: ProjectOrganization;
  canMutateMemberships: boolean;
  canManageOrganizations: boolean;
  busy: boolean;
  loading: boolean;
  onExclude: () => void;
  onReactivate: () => Promise<boolean>;
}) {
  return (
    <li>
      <div className="er-organization-membership">
        <strong>{membership.name}</strong>
        <span className="er-muted">
          {membership.isActive && membership.masterIsActive
            ? "사용 중"
            : "사용 중지"}
          {!membership.masterIsActive ? " · 전역 비활성" : ""}
        </span>
        <div className="er-membership-meta">
          <span>
            대표 조직장 {membership.primaryLeader?.displayName ?? "미지정"}
          </span>
          <span>담당자 {getTotalOrganizationManagerCount(membership)}명</span>
          <span>현재 명단 {membership.rosterCount}명</span>
        </div>
        {canManageOrganizations ? (
          <a
            href={`/organizations/${encodeURIComponent(membership.organizationId)}`}
          >
            조직 관리에서 담당자 지정
          </a>
        ) : null}
      </div>
      {canMutateMemberships ? (
        <div className="er-action-row">
          {membership.isActive ? (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={onExclude}
            >
              프로젝트에서 제외
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              loadingText="변경 중…"
              disabled={busy || !membership.masterIsActive}
              onClick={() => void onReactivate()}
            >
              다시 사용
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function isOrganizationNameConflict(error: ApiError) {
  if (error.problem?.code !== "CONFLICT") return false;
  const details = error.problem.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "reason" in details &&
    details.reason === "ORGANIZATION_NAME_EXISTS"
  );
}
