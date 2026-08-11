import type {
  ClosedProjectCorrectionCandidateOrganization,
  OrganizationSummary,
  ProjectOrganization,
  ProjectOrganizationBulkMutationResult,
  ProjectOrganizationMutationResult,
} from "@event-roster/contracts";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import { getReservedOrganizationId } from "../../lib/organization-errors";
import { canonicalizeOrganizationInput } from "../../lib/organization-name";
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
import { useAuth } from "../auth/AuthProvider";
import {
  OrganizationCombobox,
  type OrganizationComboboxSelection,
} from "./OrganizationCombobox";
import { ProjectOrganizationBulkPicker } from "./ProjectOrganizationBulkPicker";

export interface ProjectOrganizationsPanelProps {
  projectId: string;
  projectRevision: number;
  memberships: ProjectOrganization[];
  allOrganizations:
    | OrganizationSummary[]
    | ClosedProjectCorrectionCandidateOrganization[];
  organizationCandidatesAvailable?: boolean;
  canMutateMemberships: boolean;
  canManageOrganizations: boolean;
  mutationMode?: ProjectMutationMode;
  onChanged(): Promise<void>;
  onProjectClosed?(): Promise<void>;
}

export type ProjectMutationMode = "ORDINARY" | "CLOSED_CORRECTION";

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
  mutationMode = "ORDINARY",
  onChanged,
  onProjectClosed,
}: ProjectOrganizationsPanelProps) {
  const { api } = useAuth();
  const correctionMode = mutationMode === "CLOSED_CORRECTION";
  const organizationPath = correctionMode
    ? `/projects/${projectId}/history-corrections/organizations`
    : `/projects/${projectId}/organizations`;
  const visibleMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) =>
          correctionMode ||
          (membership.isActive &&
            membership.masterIsActive &&
            !membership.masterIsDeleted),
      ),
    [correctionMode, memberships],
  );
  const linkedOrganizationIds = useMemo(
    () =>
      new Set(
        memberships
          .filter(
            (membership) =>
              membership.isActive &&
              (correctionMode || !membership.masterIsDeleted),
          )
          .map((membership) => membership.organizationId),
      ),
    [correctionMode, memberships],
  );
  const [pendingSelection, setPendingSelection] =
    useState<OrganizationComboboxSelection | null>(null);
  const [newConfirmation, setNewConfirmation] = useState<{
    kind: "NEW";
    name: string;
  } | null>(null);
  const [pendingExclusion, setPendingExclusion] =
    useState<ProjectOrganization | null>(null);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<
    string[]
  >([]);
  const [organizationPickerOpen, setOrganizationPickerOpen] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
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
            (correctionMode || !membership.masterIsDeleted),
        )
      : undefined;

  const selectedInactiveBulkMembership = selectedOrganizationIds.some(
    (organizationId) =>
      memberships.some(
        (membership) =>
          membership.organizationId === organizationId &&
          !membership.isActive &&
          (correctionMode || !membership.masterIsDeleted),
      ),
  );
  const pickerOrganizations = correctionMode
    ? allOrganizations
    : (allOrganizations as OrganizationSummary[]);

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
    operation: () => Promise<
      ProjectOrganizationMutationResult | ProjectOrganizationBulkMutationResult
    >,
    onSuccess?: () => void,
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
      onSuccess?.();
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
          if (!correctionMode) {
            setPendingSelection(null);
            setNewConfirmation(null);
            setPendingExclusion(null);
            setSelectedOrganizationIds([]);
          }
          await onChanged();
          setMessage({
            tone: "info",
            text: correctionMode
              ? "최신 이력을 불러왔습니다."
              : "다른 변경이 먼저 반영되어 최신 프로젝트 정보를 불러왔습니다. 조직을 다시 선택해 주세요.",
          });
          return false;
        }
        if (
          correctionMode &&
          (error.problem?.code === "INVALID_TRANSITION" ||
            error.problem?.code === "NOT_FOUND")
        ) {
          await onChanged();
          setMessage({ tone: "info", text: "최신 이력을 불러왔습니다." });
          return false;
        }
        const reservedId = getReservedOrganizationId(error);
        if (reservedId) {
          if (correctionMode) {
            setNewConfirmation(null);
            await onChanged();
            setMessage({
              tone: "info",
              text: "최신 이력 후보를 불러왔습니다. 삭제된 조직을 선택해 주세요.",
            });
            return false;
          }
          setReservedOrganizationId(reservedId);
          setMessage({
            tone: "error",
            text: "삭제된 동일 이름의 조직이 있습니다.",
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

  async function addSelectedOrganizations() {
    if (selectedOrganizationIds.length === 0) return;
    await mutate(
      "ADD_EXISTING",
      () =>
        api.post<ProjectOrganizationBulkMutationResult>(
          `${organizationPath}/bulk`,
          {
            organizationIds: selectedOrganizationIds,
            expectedProjectRevision: observedProjectRevision,
          },
        ),
      () => {
        setSelectedOrganizationIds([]);
        setOrganizationPickerOpen(false);
      },
    );
  }

  async function addExisting(event: FormEvent) {
    event.preventDefault();
    if (pendingSelection?.kind !== "EXISTING") return;
    await mutate("ADD_EXISTING", () =>
      api.post<ProjectOrganizationMutationResult>(organizationPath, {
        organizationId: pendingSelection.organizationId,
        expectedProjectRevision: observedProjectRevision,
      }),
    );
  }

  function requestNewOrganization(event: FormEvent) {
    event.preventDefault();
    const name = newOrganizationName.trim();
    if (!name) return;
    setNewConfirmation({ kind: "NEW", name });
  }

  async function confirmCreate() {
    if (!newConfirmation) return;
    await mutate("CREATE_AND_ADD", () =>
      api.post<ProjectOrganizationMutationResult>(organizationPath, {
        newOrganizationName: newConfirmation.name,
        expectedProjectRevision: observedProjectRevision,
      }),
    );
  }

  async function setActive(membership: ProjectOrganization, active: boolean) {
    return mutate(`TOGGLE:${membership.organizationId}`, () =>
      api.patch<ProjectOrganizationMutationResult>(
        `${organizationPath}/${membership.organizationId}`,
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
      {canManageOrganizations && canMutateMemberships ? (
        <Card className="er-panel">
          <h2>조직 추가</h2>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !organizationCandidatesAvailable}
            onClick={() => setOrganizationPickerOpen(true)}
          >
            조직 선택 추가
          </Button>
          {correctionMode ? (
            <form className="er-inline-form" onSubmit={addExisting}>
              <OrganizationCombobox
                organizations={allOrganizations}
                linkedOrganizationIds={linkedOrganizationIds}
                includeInactive
                disabled={busy || !organizationCandidatesAvailable}
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
                  !organizationCandidatesAvailable ||
                  !pendingSelection ||
                  pendingSelection.kind !== "EXISTING"
                }
              >
                프로젝트에 추가
              </Button>
            </form>
          ) : (
            <form className="er-inline-form" onSubmit={requestNewOrganization}>
              <label className="er-field">
                <span>새 조직 이름</span>
                <input
                  disabled={busy || selectedOrganizationIds.length > 0}
                  value={newOrganizationName}
                  onChange={(event) =>
                    setNewOrganizationName(event.currentTarget.value)
                  }
                />
              </label>
              <Button
                type="submit"
                disabled={
                  busy ||
                  selectedOrganizationIds.length > 0 ||
                  !canonicalizeOrganizationInput(newOrganizationName)
                }
              >
                새 조직 생성 후 추가
              </Button>
            </form>
          )}
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
                correctionMode={correctionMode}
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
      {canManageOrganizations &&
      canMutateMemberships &&
      organizationPickerOpen ? (
        <Dialog
          title="조직 선택 추가"
          size="wide"
          onClose={() => setOrganizationPickerOpen(false)}
        >
          <ProjectOrganizationBulkPicker
            organizations={pickerOrganizations}
            linkedOrganizationIds={linkedOrganizationIds}
            selectedOrganizationIds={new Set(selectedOrganizationIds)}
            disabled={busy || !organizationCandidatesAvailable}
            includeInactive={correctionMode}
            onSelectionChange={setSelectedOrganizationIds}
          />
          {selectedInactiveBulkMembership ? (
            <StatusMessage tone="info">
              기존 명단과 집계 이력이 있으면 그대로 다시 연결됩니다.
            </StatusMessage>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={busyAction === "ADD_EXISTING"}
            loadingText="선택한 조직 추가 중…"
            disabled={
              busy ||
              !organizationCandidatesAvailable ||
              selectedOrganizationIds.length === 0
            }
            onClick={() => void addSelectedOrganizations()}
          >
            선택한 {selectedOrganizationIds.length}개 조직 추가
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
  correctionMode,
  busy,
  loading,
  onExclude,
  onReactivate,
}: {
  membership: ProjectOrganization;
  canMutateMemberships: boolean;
  canManageOrganizations: boolean;
  correctionMode: boolean;
  busy: boolean;
  loading: boolean;
  onExclude: () => void;
  onReactivate: () => Promise<boolean>;
}) {
  return (
    <li>
      <div className="er-organization-membership">
        <strong>{membership.name}</strong>
        <span className="er-membership-state">
          {membership.masterIsDeleted ? (
            <span className="er-badge er-badge--deleted">삭제됨</span>
          ) : !membership.masterIsActive ? (
            <span className="er-badge er-badge--inactive">사용 중지</span>
          ) : (
            <span className="er-muted">
              {membership.isActive ? "사용 중" : "사용 중지"}
            </span>
          )}
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
              disabled={busy || (!correctionMode && !membership.masterIsActive)}
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
