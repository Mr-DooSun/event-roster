import type {
  OrganizationDetail,
  OrganizationProject,
} from "@event-roster/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { RetryableError } from "../../components/ui/RetryableError";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { AuditPanel, type AuditView } from "../roster/AuditPanel";
import { OrganizationManagersPanel } from "./OrganizationManagersPanel";
import { TemporaryPasswordDialog } from "./TemporaryPasswordDialog";

const PROJECT_STATUS_LABEL: Record<
  OrganizationProject["projectStatus"],
  string
> = {
  PREPARING: "준비 중",
  PRE_REGISTRATION: "사전 등록",
  IN_PROGRESS: "진행 중",
  CLOSED: "종료",
};

interface AuditPaginationRequest {
  cursor: string;
  generation: number;
}

export function OrganizationDetailPage({
  organizationId,
}: {
  organizationId: string;
}) {
  const { api } = useAuth();
  const [organization, setOrganization] = useState<OrganizationDetail | null>(
    null,
  );
  const [name, setName] = useState("");
  const [audit, setAudit] = useState<AuditView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditPaginationError, setAuditPaginationError] = useState<
    string | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [mutating, setMutating] = useState<"RENAME" | "STATUS" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<{
    value: string;
    returnFocus?: HTMLElement;
  } | null>(null);
  const instanceActive = useRef(true);
  const activeOrganizationId = useRef(organizationId);
  activeOrganizationId.current = organizationId;
  const detailGeneration = useRef(0);
  const auditGeneration = useRef(0);
  const auditPaginationRequest = useRef<AuditPaginationRequest | null>(null);

  useEffect(() => {
    instanceActive.current = true;
    return () => {
      instanceActive.current = false;
      detailGeneration.current += 1;
      auditGeneration.current += 1;
      auditPaginationRequest.current = null;
    };
  }, []);

  const loadDetail = useCallback(async () => {
    const requestedOrganizationId = organizationId;
    if (
      !instanceActive.current ||
      activeOrganizationId.current !== requestedOrganizationId
    ) {
      return false;
    }
    const generation = ++detailGeneration.current;
    setDetailLoading(true);
    try {
      const next = await api.get<OrganizationDetail>(
        `/organizations/${encodeURIComponent(requestedOrganizationId)}`,
      );
      if (
        !instanceActive.current ||
        generation !== detailGeneration.current ||
        activeOrganizationId.current !== requestedOrganizationId
      ) {
        return false;
      }
      setOrganization(next);
      setName(next.name);
      setDetailError(null);
      return true;
    } catch {
      if (
        instanceActive.current &&
        generation === detailGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setDetailError("조직 정보를 불러오지 못했습니다.");
      }
      return false;
    } finally {
      if (
        instanceActive.current &&
        generation === detailGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setDetailLoading(false);
      }
    }
  }, [api, organizationId]);

  const loadInitialAudit = useCallback(async () => {
    const requestedOrganizationId = organizationId;
    if (
      !instanceActive.current ||
      activeOrganizationId.current !== requestedOrganizationId
    ) {
      return false;
    }
    const generation = ++auditGeneration.current;
    setAuditLoading(true);
    auditPaginationRequest.current = null;
    setAuditLoadingMore(false);
    setAuditPaginationError(null);
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(
        `/organizations/${encodeURIComponent(
          requestedOrganizationId,
        )}/audit?limit=50`,
      );
      if (
        instanceActive.current &&
        generation === auditGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setAudit(page.items);
        setAuditNextCursor(page.nextCursor);
        setAuditLoaded(true);
        setAuditError(null);
        return true;
      }
      return false;
    } catch {
      if (
        instanceActive.current &&
        generation === auditGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setAuditError("변경 이력을 불러오지 못했습니다.");
      }
      return false;
    } finally {
      if (
        instanceActive.current &&
        generation === auditGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setAuditLoading(false);
      }
    }
  }, [api, organizationId]);

  useEffect(() => {
    setOrganization(null);
    setAudit([]);
    setAuditNextCursor(null);
    setDetailError(null);
    setAuditError(null);
    setAuditPaginationError(null);
    setDetailLoading(true);
    setAuditLoading(true);
    setAuditLoaded(false);
    setAuditLoadingMore(false);
    setMutating(null);
    setMessage(null);
    setShowStatusConfirmation(false);
    setTemporaryPassword(null);
    void loadDetail();
    void loadInitialAudit();
  }, [loadDetail, loadInitialAudit]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    await mutateOrganization("RENAME", { name: name.trim() });
  }

  async function changeStatus() {
    if (!organization) return;
    await mutateOrganization("STATUS", {
      isActive: !organization.isActive,
    });
    if (
      instanceActive.current &&
      activeOrganizationId.current === organizationId
    ) {
      setShowStatusConfirmation(false);
    }
  }

  async function mutateOrganization(
    kind: "RENAME" | "STATUS",
    input: {
      name?: string;
      isActive?: boolean;
    },
  ) {
    const requestedOrganizationId = organizationId;
    setMutating(kind);
    setMessage(null);
    try {
      await api.patch(`/organizations/${requestedOrganizationId}`, input);
      if (
        !instanceActive.current ||
        activeOrganizationId.current !== requestedOrganizationId
      ) {
        return;
      }
      const [detailReloaded] = await Promise.all([
        loadDetail(),
        loadInitialAudit(),
      ]);
      if (
        !instanceActive.current ||
        activeOrganizationId.current !== requestedOrganizationId
      ) {
        return;
      }
      if (!detailReloaded) {
        setMessage(
          "조직 변경은 반영됐지만 최신 조직 정보를 불러오지 못했습니다.",
        );
      }
    } catch (error) {
      if (
        !instanceActive.current ||
        activeOrganizationId.current !== requestedOrganizationId
      ) {
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        const reloaded = await loadDetail();
        if (
          !instanceActive.current ||
          activeOrganizationId.current !== requestedOrganizationId
        ) {
          return;
        }
        setMessage(
          reloaded
            ? "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다."
            : "다른 관리 변경이 먼저 반영되었지만 최신 조직 정보를 불러오지 못했습니다.",
        );
      } else {
        setMessage("조직 정보를 변경하지 못했습니다.");
      }
    } finally {
      if (
        instanceActive.current &&
        activeOrganizationId.current === requestedOrganizationId
      ) {
        setMutating(null);
      }
    }
  }

  async function loadMoreAudit() {
    const requestedOrganizationId = organizationId;
    if (
      !instanceActive.current ||
      activeOrganizationId.current !== requestedOrganizationId ||
      !auditNextCursor ||
      auditPaginationRequest.current
    ) {
      return;
    }
    const cursor = auditNextCursor;
    const generation = auditGeneration.current;
    const request = { cursor, generation };
    auditPaginationRequest.current = request;
    setAuditLoadingMore(true);
    setAuditPaginationError(null);
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(
        `/organizations/${encodeURIComponent(
          requestedOrganizationId,
        )}/audit?limit=50&cursor=${encodeURIComponent(cursor)}`,
      );
      if (
        !instanceActive.current ||
        generation !== auditGeneration.current ||
        activeOrganizationId.current !== requestedOrganizationId ||
        auditPaginationRequest.current !== request
      ) {
        return;
      }
      setAudit((current) => [...current, ...page.items]);
      setAuditNextCursor(page.nextCursor);
      setAuditPaginationError(null);
    } catch {
      if (
        instanceActive.current &&
        generation === auditGeneration.current &&
        activeOrganizationId.current === requestedOrganizationId &&
        auditPaginationRequest.current === request
      ) {
        setAuditPaginationError("변경 이력을 더 불러오지 못했습니다.");
      }
    } finally {
      if (auditPaginationRequest.current === request) {
        auditPaginationRequest.current = null;
        setAuditLoadingMore(false);
      }
    }
  }

  async function reloadAfterManagerMutation() {
    const requestedOrganizationId = organizationId;
    if (
      !instanceActive.current ||
      activeOrganizationId.current !== requestedOrganizationId
    ) {
      return false;
    }
    const [detailReloaded] = await Promise.all([
      loadDetail(),
      loadInitialAudit(),
    ]);
    return (
      instanceActive.current &&
      activeOrganizationId.current === requestedOrganizationId &&
      detailReloaded
    );
  }

  function showTemporaryPassword(value: string, returnFocus?: HTMLElement) {
    const requestedOrganizationId = organizationId;
    if (
      !instanceActive.current ||
      activeOrganizationId.current !== requestedOrganizationId
    ) {
      return;
    }
    setTemporaryPassword({
      value,
      ...(returnFocus ? { returnFocus } : {}),
    });
  }

  return (
    <div className="er-page-stack">
      <a className="er-text-link" href="/organizations">
        조직 목록으로
      </a>
      {detailError ? (
        <RetryableError
          message={detailError}
          retrying={detailLoading}
          onRetry={loadDetail}
        />
      ) : null}
      {message ? (
        <StatusMessage
          tone={message.includes("불러오지 못했습니다") ? "error" : "info"}
        >
          {message}
        </StatusMessage>
      ) : null}
      {!organization && detailLoading && !detailError ? (
        <OrganizationDetailSkeleton />
      ) : null}
      {organization ? (
        <>
          {detailLoading ? (
            <LoadingStatus>조직 정보 새로고침 중…</LoadingStatus>
          ) : null}
          <header className="er-page-heading">
            <div>
              <p className="er-eyebrow">ORGANIZATION</p>
              <h1>{organization.name}</h1>
              <div className="er-project-meta">
                <span
                  className={`er-badge ${
                    organization.isActive
                      ? "er-badge--active"
                      : "er-badge--inactive"
                  }`}
                >
                  {organization.isActive ? "사용 중" : "사용 중지"}
                </span>
                <span>
                  {organization.primaryLeader?.displayName ??
                    "대표 조직장 미지정"}
                </span>
                <span>추가 관리자 {organization.managerCount}명</span>
                <span>연결 프로젝트 {organization.projectCount}개</span>
              </div>
            </div>
          </header>
          <Card className="er-panel">
            <div className="er-section-heading">
              <div>
                <h2>조직 정보</h2>
                <p className="er-muted">
                  이름과 사용 상태는 모든 프로젝트에 공통으로 적용됩니다.
                </p>
              </div>
              <Button
                type="button"
                variant={organization.isActive ? "danger" : "primary"}
                disabled={mutating !== null}
                onClick={() => setShowStatusConfirmation(true)}
              >
                {organization.isActive ? "조직 사용 중지" : "조직 다시 사용"}
              </Button>
            </div>
            <form className="er-inline-form" onSubmit={rename}>
              <TextInput
                label="조직 이름"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={
                  mutating !== null ||
                  !name.trim() ||
                  name.trim() === organization.name
                }
                loading={mutating === "RENAME"}
                loadingText="저장 중…"
              >
                이름 저장
              </Button>
            </form>
          </Card>
          <OrganizationManagersPanel
            organization={organization}
            onChanged={reloadAfterManagerMutation}
            onTemporaryPassword={showTemporaryPassword}
          />
          <Card className="er-panel">
            <h2>연결 프로젝트</h2>
            {organization.projects.length === 0 ? (
              <p className="er-muted">연결된 프로젝트가 없습니다.</p>
            ) : (
              <ul className="er-organization-project-list">
                {organization.projects.map((project) => (
                  <li key={project.projectId}>
                    <div>
                      <a
                        href={`/projects/${encodeURIComponent(
                          project.projectId,
                        )}`}
                      >
                        {project.projectName}
                      </a>
                      <span className="er-muted">
                        {PROJECT_STATUS_LABEL[project.projectStatus]}
                      </span>
                    </div>
                    <span>
                      {project.membershipIsActive
                        ? "연결 사용 중"
                        : "연결 중지"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
      {auditError ? (
        <RetryableError
          message={auditError}
          retrying={auditLoading}
          onRetry={loadInitialAudit}
        />
      ) : null}
      {auditPaginationError ? (
        <RetryableError
          message={auditPaginationError}
          retrying={auditLoadingMore}
          onRetry={loadMoreAudit}
        />
      ) : null}
      {auditLoading && auditLoaded ? (
        <LoadingStatus>변경 이력 새로고침 중…</LoadingStatus>
      ) : null}
      {auditLoading && !auditLoaded && !auditError ? (
        <OrganizationAuditSkeleton />
      ) : null}
      {auditLoaded ? (
        <AuditPanel
          items={audit}
          nextCursor={auditNextCursor}
          loadingMore={auditLoadingMore}
          onLoadMore={loadMoreAudit}
        />
      ) : null}
      {showStatusConfirmation && organization ? (
        <Dialog
          title="조직 상태 변경"
          onClose={() => setShowStatusConfirmation(false)}
        >
          <p>
            {organization.name} 조직을{" "}
            {organization.isActive ? "사용 중지" : "다시 사용"} 상태로
            변경합니다.
          </p>
          <Button
            type="button"
            variant={organization.isActive ? "danger" : "primary"}
            loading={mutating === "STATUS"}
            loadingText="변경 중…"
            onClick={changeStatus}
          >
            상태 변경 확인
          </Button>
        </Dialog>
      ) : null}
      {temporaryPassword ? (
        <TemporaryPasswordDialog
          value={temporaryPassword.value}
          onClose={() => {
            const returnFocus = temporaryPassword.returnFocus;
            setTemporaryPassword(null);
            queueMicrotask(() => {
              if (returnFocus?.isConnected) returnFocus.focus();
            });
          }}
        />
      ) : null}
    </div>
  );
}

function OrganizationDetailSkeleton() {
  return (
    <div className="er-organization-detail-skeleton" aria-busy="true">
      <LoadingStatus visuallyHidden>조직 불러오는 중…</LoadingStatus>
      <header className="er-page-heading">
        <div>
          <Skeleton className="er-skeleton--badge" />
          <Skeleton className="er-skeleton--title" />
          <Skeleton className="er-skeleton--text" />
        </div>
      </header>
      <Card className="er-panel">
        <Skeleton className="er-skeleton--title" />
        <Skeleton className="er-skeleton--text" />
        <Skeleton className="er-skeleton--text er-skeleton--short" />
      </Card>
    </div>
  );
}

function OrganizationAuditSkeleton() {
  return (
    <Card className="er-panel er-organization-audit-skeleton">
      <LoadingStatus visuallyHidden>변경 이력 불러오는 중…</LoadingStatus>
      <Skeleton className="er-skeleton--title" />
      <Skeleton className="er-skeleton--text" />
      <Skeleton className="er-skeleton--text er-skeleton--short" />
    </Card>
  );
}
