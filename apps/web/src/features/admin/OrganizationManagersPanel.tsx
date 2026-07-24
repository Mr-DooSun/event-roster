import type {
  OrganizationAssignmentRole,
  OrganizationDetail,
  OrganizationManager,
} from "@event-roster/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

interface AssignableManager {
  userId: string;
  loginId: string;
  displayName: string;
  isActive: boolean;
}

export interface OrganizationManagersPanelProps {
  organization: OrganizationDetail;
  onChanged(): Promise<boolean>;
  onTemporaryPassword(value: string, returnFocus?: HTMLElement): void;
}

export function OrganizationManagersPanel({
  organization,
  onChanged,
  onTemporaryPassword,
}: OrganizationManagersPanelProps) {
  const { api } = useAuth();
  const [mode, setMode] = useState<"EXISTING" | "NEW" | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<AssignableManager[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [assignmentRole, setAssignmentRole] =
    useState<OrganizationAssignmentRole>("MANAGER");
  const [primaryTarget, setPrimaryTarget] =
    useState<OrganizationManager | null>(null);
  const [primaryDisposition, setPrimaryDisposition] = useState<
    "REMOVE" | "MANAGER"
  >("MANAGER");
  const [removeManager, setRemoveManager] =
    useState<OrganizationManager | null>(null);
  const [removePrimary, setRemovePrimary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [hasSearchedCandidates, setHasSearchedCandidates] = useState(false);
  const [candidateSearchError, setCandidateSearchError] = useState<
    string | null
  >(null);
  const [existingAssignmentError, setExistingAssignmentError] = useState<
    string | null
  >(null);
  const newManagerTrigger = useRef<HTMLButtonElement | null>(null);
  const candidateSearchGeneration = useRef(0);
  const candidateSearchController = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    return () => {
      candidateSearchGeneration.current += 1;
      candidateSearchController.current?.abort();
      candidateSearchController.current = null;
    };
  }, []);

  async function searchCandidates(event: FormEvent) {
    event.preventDefault();
    const generation = ++candidateSearchGeneration.current;
    candidateSearchController.current?.abort();
    const controller = new AbortController();
    candidateSearchController.current = controller;
    setSearchingCandidates(true);
    setHasSearchedCandidates(false);
    setCandidateSearchError(null);
    setExistingAssignmentError(null);
    try {
      const next = await api.get<AssignableManager[]>(
        `/organizations/${encodeURIComponent(
          organization.id,
        )}/assignable-users?query=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      if (
        generation !== candidateSearchGeneration.current ||
        controller.signal.aborted
      ) {
        return;
      }
      setCandidates(next);
      setSelectedUserId("");
      setHasSearchedCandidates(true);
    } catch {
      if (
        generation === candidateSearchGeneration.current &&
        !controller.signal.aborted
      ) {
        setHasSearchedCandidates(true);
        setCandidateSearchError("지정 가능한 계정을 찾지 못했습니다.");
      }
    } finally {
      if (generation === candidateSearchGeneration.current) {
        if (candidateSearchController.current === controller) {
          candidateSearchController.current = null;
        }
        setSearchingCandidates(false);
      }
    }
  }

  function changeCandidateQuery(nextQuery: string) {
    candidateSearchGeneration.current += 1;
    candidateSearchController.current?.abort();
    candidateSearchController.current = null;
    setSearchingCandidates(false);
    setQuery(nextQuery);
    setCandidates([]);
    setSelectedUserId("");
    setHasSearchedCandidates(false);
    setCandidateSearchError(null);
    setExistingAssignmentError(null);
  }

  function closeExistingAssignment() {
    candidateSearchGeneration.current += 1;
    candidateSearchController.current?.abort();
    candidateSearchController.current = null;
    setSearchingCandidates(false);
    setMode(null);
  }

  async function assignExisting(event: FormEvent) {
    event.preventDefault();
    if (!selectedUserId) return;
    setExistingAssignmentError(null);
    await mutate(async () => {
      await api.post(`/organizations/${organization.id}/managers`, {
        kind: "EXISTING",
        userId: selectedUserId,
        assignmentRole,
      });
      closeExistingAssignment();
    }, setExistingAssignmentError);
  }

  async function provision(event: FormEvent) {
    event.preventDefault();
    await mutate(async () => {
      const result = await api.post<{
        manager: OrganizationManager;
        temporaryPassword?: string;
      }>(`/organizations/${organization.id}/managers`, {
        kind: "NEW",
        loginId: loginId.trim(),
        displayName: displayName.trim(),
        assignmentRole,
      });
      if (result.temporaryPassword) {
        onTemporaryPassword(
          result.temporaryPassword,
          newManagerTrigger.current ?? undefined,
        );
      }
      setMode(null);
      setLoginId("");
      setDisplayName("");
    });
  }

  async function replacePrimary() {
    if (!primaryTarget) return;
    await mutate(async () => {
      await api.patch(`/organizations/${organization.id}/primary`, {
        userId: primaryTarget.userId,
        expectedPrimaryUserId: organization.primaryLeader?.userId ?? null,
        previousPrimaryDisposition: primaryDisposition,
      });
      setPrimaryTarget(null);
    });
  }

  async function removePrimaryAssignment() {
    await mutate(async () => {
      await api.patch(`/organizations/${organization.id}/primary`, {
        userId: null,
        expectedPrimaryUserId: organization.primaryLeader?.userId ?? null,
        previousPrimaryDisposition: "REMOVE",
      });
      setRemovePrimary(false);
    });
  }

  async function removeManagerAssignment() {
    if (!removeManager) return;
    await mutate(async () => {
      await api.delete(
        `/organizations/${organization.id}/managers/${encodeURIComponent(
          removeManager.userId,
        )}`,
      );
      setRemoveManager(null);
    });
  }

  async function mutate(
    operation: () => Promise<void>,
    reportOperationError: (message: string) => void = setMessage,
  ) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setIsMutating(true);
    setMessage(null);
    try {
      try {
        await operation();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const reloaded = await onChanged();
          reportOperationError(
            reloaded
              ? "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다."
              : "다른 관리 변경이 먼저 반영되었지만 최신 조직 정보를 불러오지 못했습니다.",
          );
        } else {
          reportOperationError("담당자 변경을 반영하지 못했습니다.");
        }
        return;
      }
      if (!(await onChanged())) {
        setMessage(
          "담당자 변경은 반영됐지만 최신 조직 정보를 불러오지 못했습니다.",
        );
      }
    } finally {
      mutationInFlight.current = false;
      setIsMutating(false);
    }
  }

  function openAssignment(nextMode: "EXISTING" | "NEW") {
    setMode(nextMode);
    setAssignmentRole(
      organization.primaryLeader ? "MANAGER" : "PRIMARY_LEADER",
    );
    setMessage(null);
    if (nextMode === "EXISTING") {
      candidateSearchGeneration.current += 1;
      candidateSearchController.current?.abort();
      candidateSearchController.current = null;
      setSearchingCandidates(false);
      setQuery("");
      setCandidates([]);
      setSelectedUserId("");
      setHasSearchedCandidates(false);
      setCandidateSearchError(null);
      setExistingAssignmentError(null);
    }
  }

  return (
    <Card className="er-panel">
      <div className="er-section-heading">
        <div>
          <h2>조직 담당자</h2>
          <p className="er-muted">
            대표 조직장과 추가 관리자는 명단 관리 권한이 같습니다.
          </p>
        </div>
        <div className="er-action-row er-action-row--wrap">
          <Button
            type="button"
            disabled={isMutating}
            onClick={() => openAssignment("EXISTING")}
          >
            기존 계정 지정
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isMutating}
            onClick={(event) => {
              newManagerTrigger.current = event.currentTarget;
              openAssignment("NEW");
            }}
          >
            새 담당자 발급
          </Button>
        </div>
      </div>
      {message ? (
        <StatusMessage
          tone={message.includes("불러오지 못했습니다") ? "error" : "info"}
        >
          {message}
        </StatusMessage>
      ) : null}
      {organization.managers.length === 0 ? (
        <p className="er-muted">지정된 담당자가 없습니다.</p>
      ) : (
        <ul className="er-manager-list">
          {organization.managers.map((manager) => (
            <li key={manager.userId}>
              <div>
                <strong>{manager.displayName}</strong>
                <span className="er-muted">{manager.loginId}</span>
                <span>
                  {manager.assignmentRole === "PRIMARY_LEADER"
                    ? "대표 조직장"
                    : "추가 관리자"}
                  {!manager.isActive ? " · 비활성 계정" : ""}
                </span>
              </div>
              <div className="er-action-row er-action-row--wrap">
                {manager.assignmentRole === "PRIMARY_LEADER" ? (
                  <Button
                    type="button"
                    disabled={isMutating}
                    onClick={() => setRemovePrimary(true)}
                  >
                    대표 지정 해제
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      disabled={isMutating}
                      onClick={() => setPrimaryTarget(manager)}
                      aria-label={`${manager.displayName} 대표로 지정`}
                    >
                      대표로 지정
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={isMutating}
                      onClick={() => setRemoveManager(manager)}
                      aria-label={`${manager.displayName} 담당 해제`}
                    >
                      담당 해제
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {mode === "EXISTING" ? (
        <Dialog
          title="기존 담당자 지정"
          size="wide"
          hideDefaultCloseAction
          onClose={closeExistingAssignment}
        >
          <div className="er-assignment-dialog">
            <section
              className="er-assignment-step"
              aria-labelledby="existing-manager-search-step"
            >
              <h3
                id="existing-manager-search-step"
                className="er-assignment-step__heading"
              >
                <span className="er-assignment-step__number" aria-hidden="true">
                  1
                </span>
                <span>계정 찾기</span>
              </h3>
              <form
                className="er-assignment-search"
                onSubmit={searchCandidates}
              >
                <TextInput
                  label="로그인 ID 또는 표시 이름"
                  value={query}
                  onChange={(event) =>
                    changeCandidateQuery(event.currentTarget.value)
                  }
                />
                <Button
                  type="submit"
                  loading={searchingCandidates}
                  loadingText="검색 중…"
                  disabled={isMutating}
                >
                  검색
                </Button>
              </form>
              {candidateSearchError ? (
                <StatusMessage tone="error">
                  {candidateSearchError}
                </StatusMessage>
              ) : hasSearchedCandidates && candidates.length === 0 ? (
                <StatusMessage>검색된 계정이 없습니다.</StatusMessage>
              ) : null}
            </section>

            <form onSubmit={assignExisting}>
              <section
                className="er-assignment-step"
                aria-labelledby="existing-manager-assignment-step"
              >
                <h3
                  id="existing-manager-assignment-step"
                  className="er-assignment-step__heading"
                >
                  <span
                    className="er-assignment-step__number"
                    aria-hidden="true"
                  >
                    2
                  </span>
                  <span>담당 범위 설정</span>
                </h3>
                <div className="er-assignment-fields">
                  <label className="er-field">
                    <span>지정할 계정</span>
                    <select
                      className="er-control er-control--select"
                      value={selectedUserId}
                      disabled={
                        isMutating ||
                        searchingCandidates ||
                        candidates.length === 0
                      }
                      onChange={(event) =>
                        setSelectedUserId(event.currentTarget.value)
                      }
                    >
                      <option value="">계정을 선택하세요</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.userId} value={candidate.userId}>
                          {candidate.displayName} · {candidate.loginId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AssignmentRoleField
                    value={assignmentRole}
                    onChange={setAssignmentRole}
                  />
                </div>
                {existingAssignmentError ? (
                  <StatusMessage tone="error">
                    {existingAssignmentError}
                  </StatusMessage>
                ) : null}
              </section>
              <div className="er-dialog-actions">
                <Button
                  type="button"
                  disabled={isMutating}
                  onClick={closeExistingAssignment}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isMutating || !selectedUserId}
                  loading={isMutating}
                  loadingText="담당자로 지정 중…"
                >
                  담당자로 지정
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      ) : null}
      {mode === "NEW" ? (
        <Dialog title="새 담당자 발급" onClose={() => setMode(null)}>
          <form className="er-form-grid" onSubmit={provision}>
            <TextInput
              label="영문 로그인 ID"
              required
              value={loginId}
              onChange={(event) => setLoginId(event.currentTarget.value)}
            />
            <TextInput
              label="표시 이름"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <AssignmentRoleField
              value={assignmentRole}
              onChange={setAssignmentRole}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isMutating || !loginId.trim() || !displayName.trim()}
              loading={isMutating}
              loadingText="계정 발급 및 지정 중…"
            >
              계정 발급 및 지정
            </Button>
          </form>
        </Dialog>
      ) : null}
      {primaryTarget ? (
        <Dialog title="대표 조직장 변경" onClose={() => setPrimaryTarget(null)}>
          <p>{primaryTarget.displayName} 계정을 대표 조직장으로 지정합니다.</p>
          <label className="er-field">
            <span>기존 대표 처리</span>
            <select
              className="er-control er-control--select"
              value={primaryDisposition}
              onChange={(event) =>
                setPrimaryDisposition(
                  event.currentTarget.value as "REMOVE" | "MANAGER",
                )
              }
            >
              <option value="MANAGER">추가 관리자로 유지</option>
              <option value="REMOVE">조직 담당에서 해제</option>
            </select>
          </label>
          <Button
            type="button"
            variant="primary"
            disabled={isMutating}
            loading={isMutating}
            loadingText="대표 변경 중…"
            onClick={replacePrimary}
          >
            대표 변경 확인
          </Button>
        </Dialog>
      ) : null}
      {removeManager ? (
        <Dialog title="담당자 해제" onClose={() => setRemoveManager(null)}>
          <p>{removeManager.displayName} 계정의 조직 담당을 해제합니다.</p>
          <Button
            type="button"
            variant="danger"
            disabled={isMutating}
            loading={isMutating}
            loadingText="담당 해제 중…"
            onClick={removeManagerAssignment}
          >
            담당 해제 확인
          </Button>
        </Dialog>
      ) : null}
      {removePrimary ? (
        <Dialog title="대표 지정 해제" onClose={() => setRemovePrimary(false)}>
          <p>대표 조직장 지정을 해제하면 이 조직은 대표 없이 유지됩니다.</p>
          <Button
            type="button"
            variant="danger"
            disabled={isMutating}
            loading={isMutating}
            loadingText="대표 해제 중…"
            onClick={removePrimaryAssignment}
          >
            대표 해제 확인
          </Button>
        </Dialog>
      ) : null}
    </Card>
  );
}

function AssignmentRoleField({
  value,
  onChange,
}: {
  value: OrganizationAssignmentRole;
  onChange(value: OrganizationAssignmentRole): void;
}) {
  return (
    <label className="er-field">
      <span>조직별 역할</span>
      <select
        className="er-control er-control--select"
        value={value}
        onChange={(event) =>
          onChange(event.currentTarget.value as OrganizationAssignmentRole)
        }
      >
        <option value="PRIMARY_LEADER">대표 조직장</option>
        <option value="MANAGER">추가 관리자</option>
      </select>
    </label>
  );
}
