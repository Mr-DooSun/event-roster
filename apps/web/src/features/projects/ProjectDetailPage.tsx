import type {
  Organization,
  Project,
  ProjectOrganization,
  ProjectStatus,
  ProjectSummary,
} from "@event-roster/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { RetryableError } from "../../components/ui/RetryableError";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { AuditPanel, type AuditView } from "../roster/AuditPanel";
import type { ParticipantView } from "../roster/ParticipantDialog";
import { ProjectRosterPage } from "../roster/ProjectRosterPage";
import type { RosterView } from "../roster/RosterTable";
import { ProjectEditDialog, type ProjectEditInput } from "./ProjectEditDialog";
import {
  ProjectHeaderSkeleton,
  ProjectTabSkeleton,
} from "./ProjectLoadingStates";
import { ProjectOrganizationsPanel } from "./ProjectOrganizationsPanel";
import { ProjectOverview } from "./ProjectOverview";

type ProjectTab = "overview" | "organizations" | "roster" | "audit";

type DetailResource =
  | "summary"
  | "memberships"
  | "organizations"
  | "roster"
  | "participants"
  | "audit";

type DetailErrors = Partial<Record<DetailResource, string>>;
export type DetailLoading = Partial<Record<DetailResource, boolean>>;
type DetailLoaded = Partial<Record<DetailResource, boolean>>;

interface RequestContext {
  projectId: string;
  generation: number;
}

interface AuditPaginationContext extends RequestContext {
  auditResourceToken: number;
}

const RESOURCE_ERROR_MESSAGE: Record<DetailResource, string> = {
  summary: "프로젝트 집계를 불러오지 못했습니다.",
  memberships: "프로젝트 조직을 불러오지 못했습니다.",
  organizations: "전체 조직을 불러오지 못했습니다.",
  roster: "참가 명단을 불러오지 못했습니다.",
  participants: "참가자 정보를 불러오지 못했습니다.",
  audit: "변경 이력을 불러오지 못했습니다.",
};

const TABS: ReadonlyArray<{ id: ProjectTab; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "organizations", label: "조직" },
  { id: "roster", label: "참가 명단" },
  { id: "audit", label: "변경 이력" },
];

const TAB_RESOURCES: Record<ProjectTab, DetailResource[]> = {
  overview: ["summary", "memberships"],
  organizations: ["memberships", "organizations"],
  roster: ["memberships", "roster", "participants"],
  audit: ["audit"],
};

const TAB_LOADING_STATE: Record<
  ProjectTab,
  { kind: "cards" | "list" | "table"; message: string }
> = {
  overview: { kind: "cards", message: "프로젝트 개요 불러오는 중…" },
  organizations: { kind: "list", message: "프로젝트 조직 불러오는 중…" },
  roster: { kind: "table", message: "참가 명단 불러오는 중…" },
  audit: { kind: "list", message: "변경 이력 불러오는 중…" },
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  PREPARING: "준비 중",
  PRE_REGISTRATION: "사전 등록",
  IN_PROGRESS: "진행 중",
  CLOSED: "종료",
};

const NEXT_ACTION: Record<
  ProjectStatus,
  { target: ProjectStatus; label: string }
> = {
  PREPARING: { target: "PRE_REGISTRATION", label: "사전 등록 시작" },
  PRE_REGISTRATION: { target: "IN_PROGRESS", label: "진행 시작" },
  IN_PROGRESS: { target: "CLOSED", label: "프로젝트 종료" },
  CLOSED: { target: "IN_PROGRESS", label: "프로젝트 재개" },
};

const EMPTY_SUMMARY = (projectId: string): ProjectSummary => ({
  projectId,
  expectedTotal: 0,
  finalTotal: 0,
  deltaTotal: 0,
  organizations: [],
});

const INITIAL_RESOURCE_REQUEST_TOKEN: Record<DetailResource, number> = {
  summary: 0,
  memberships: 0,
  organizations: 0,
  roster: 0,
  participants: 0,
  audit: 0,
};

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { api, auth } = useAuth();
  const [selectedTab, setSelectedTab] = useState<ProjectTab>("overview");
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<ProjectSummary>(() =>
    EMPTY_SUMMARY(projectId),
  );
  const [memberships, setMemberships] = useState<ProjectOrganization[]>([]);
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [rows, setRows] = useState<RosterView[]>([]);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [audit, setAudit] = useState<AuditView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditPaginationError, setAuditPaginationError] = useState<
    string | null
  >(null);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [projectLoading, setProjectLoading] = useState(true);
  const [resourceLoading, setResourceLoading] = useState<DetailLoading>({});
  const [resourceLoaded, setResourceLoaded] = useState<DetailLoaded>({});
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [resourceErrors, setResourceErrors] = useState<DetailErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const loadGeneration = useRef(0);
  const currentProjectId = useRef(projectId);
  const resourceRequestTokens = useRef({
    ...INITIAL_RESOURCE_REQUEST_TOKEN,
  });
  const auditNextCursorRef = useRef<string | null>(null);
  const auditPaginationRequest = useRef<AuditPaginationContext | null>(null);
  currentProjectId.current = projectId;

  const updateAuditNextCursor = useCallback((nextCursor: string | null) => {
    auditNextCursorRef.current = nextCursor;
    setAuditNextCursor(nextCursor);
  }, []);

  const isCurrent = useCallback(
    (context: RequestContext) =>
      currentProjectId.current === context.projectId &&
      loadGeneration.current === context.generation,
    [],
  );

  const loadResource = useCallback(
    async <T,>(
      context: RequestContext,
      resource: DetailResource,
      request: () => Promise<T>,
      apply: (value: T) => void,
    ) => {
      if (!isCurrent(context)) return false;
      const requestToken = resourceRequestTokens.current[resource] + 1;
      resourceRequestTokens.current[resource] = requestToken;
      if (resource === "audit") {
        auditPaginationRequest.current = null;
        setAuditLoadingMore(false);
        updateAuditNextCursor(null);
      }
      const ownsRequest = () =>
        isCurrent(context) &&
        resourceRequestTokens.current[resource] === requestToken;
      setResourceLoading((current) => ({ ...current, [resource]: true }));
      setResourceErrors((current) => {
        const next = { ...current };
        delete next[resource];
        return next;
      });
      try {
        const value = await request();
        if (!ownsRequest()) return false;
        apply(value);
        setResourceLoaded((current) => ({ ...current, [resource]: true }));
        return true;
      } catch {
        if (!ownsRequest()) return false;
        setResourceErrors((current) => ({
          ...current,
          [resource]: RESOURCE_ERROR_MESSAGE[resource],
        }));
        return false;
      } finally {
        if (ownsRequest()) {
          setResourceLoading((current) => ({
            ...current,
            [resource]: false,
          }));
        }
      }
    },
    [isCurrent, updateAuditNextCursor],
  );

  const loadDetailResource = useCallback(
    (context: RequestContext, resource: DetailResource) => {
      switch (resource) {
        case "summary":
          return loadResource(
            context,
            resource,
            () =>
              api.get<ProjectSummary>(`/projects/${context.projectId}/summary`),
            setSummary,
          );
        case "memberships":
          return loadResource(
            context,
            resource,
            () =>
              api.get<ProjectOrganization[]>(
                `/projects/${context.projectId}/organizations`,
              ),
            setMemberships,
          );
        case "organizations":
          return loadResource(
            context,
            resource,
            () => api.get<Organization[]>("/organizations"),
            setAllOrganizations,
          );
        case "roster":
          return loadResource(
            context,
            resource,
            () =>
              api.get<RosterView[]>(`/projects/${context.projectId}/roster`),
            setRows,
          );
        case "participants":
          return loadResource(
            context,
            resource,
            () => api.get<ParticipantView[]>("/participants"),
            setParticipants,
          );
        case "audit":
          return loadResource(
            context,
            resource,
            () =>
              api.get<{ items: AuditView[]; nextCursor: string | null }>(
                `/projects/${context.projectId}/audit?limit=50`,
              ),
            (page) => {
              setAudit(page.items);
              updateAuditNextCursor(page.nextCursor);
            },
          );
        default:
          return assertNever(resource);
      }
    },
    [api, loadResource, updateAuditNextCursor],
  );

  const load = useCallback(async () => {
    const context = {
      projectId,
      generation: ++loadGeneration.current,
    };
    if (!isCurrent(context)) return;
    auditPaginationRequest.current = null;
    setAuditLoadingMore(false);
    updateAuditNextCursor(null);
    setProjectLoading(true);
    setResourceLoading({});
    setProjectLoadError(null);
    setResourceErrors({});
    setAuditPaginationError(null);
    setMessage(null);

    const projectRequest = (async () => {
      try {
        const nextProject = await api.get<Project>(
          `/projects/${context.projectId}`,
        );
        if (isCurrent(context)) setProject(nextProject);
      } catch {
        if (isCurrent(context)) {
          setProjectLoadError("프로젝트 정보를 불러오지 못했습니다.");
        }
      } finally {
        if (isCurrent(context)) setProjectLoading(false);
      }
    })();

    await Promise.all([
      projectRequest,
      ...(
        [
          "summary",
          "memberships",
          "organizations",
          "roster",
          "participants",
          "audit",
        ] satisfies DetailResource[]
      ).map((resource) => loadDetailResource(context, resource)),
    ]);
  }, [api, isCurrent, loadDetailResource, projectId, updateAuditNextCursor]);

  const retryProject = useCallback(() => load(), [load]);
  const retryTab = useCallback(
    async (tab: ProjectTab, expectedGeneration: number) => {
      const context = {
        projectId,
        generation: expectedGeneration,
      };
      if (!isCurrent(context)) return;
      const failed = TAB_RESOURCES[tab].filter(
        (resource) => resourceErrors[resource],
      );
      await Promise.all(
        failed.map((resource) => loadDetailResource(context, resource)),
      );
    },
    [isCurrent, loadDetailResource, projectId, resourceErrors],
  );

  useEffect(() => {
    setSelectedTab("overview");
    setProject(null);
    setSummary(EMPTY_SUMMARY(projectId));
    setMemberships([]);
    setAllOrganizations([]);
    setRows([]);
    setParticipants([]);
    setAudit([]);
    updateAuditNextCursor(null);
    setAuditPaginationError(null);
    setProjectLoadError(null);
    setResourceErrors({});
    setResourceLoading({});
    setResourceLoaded({});
    setMessage(null);
    setShowEdit(false);
    setShowTransition(false);
    setTransitioning(false);
    setProjectLoading(true);
    auditPaginationRequest.current = null;
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load, projectId, updateAuditNextCursor]);

  async function reloadProjectForContext(context: RequestContext) {
    if (!isCurrent(context)) return null;
    try {
      const latest = await api.get<Project>(`/projects/${context.projectId}`);
      if (!isCurrent(context)) return null;
      setProject(latest);
      return latest;
    } catch {
      if (isCurrent(context)) {
        setProjectLoadError("프로젝트 정보를 불러오지 못했습니다.");
      }
      return null;
    }
  }

  async function updateProject(input: ProjectEditInput) {
    const context = { projectId, generation: loadGeneration.current };
    if (!isCurrent(context)) return;
    setMessage(null);
    try {
      const updated = await api.patch<Project>(
        `/projects/${context.projectId}`,
        input,
      );
      if (!isCurrent(context)) return;
      setProject(updated);
      setShowEdit(false);
    } catch (error) {
      if (!isCurrent(context)) return;
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        const latest = await reloadProjectForContext(context);
        if (!latest || !isCurrent(context)) return;
        setShowEdit(false);
        setMessage(
          "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
        );
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        const latest = await reloadProjectForContext(context);
        if (!latest || !isCurrent(context)) return;
        setShowEdit(false);
        setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
      } else {
        setMessage("프로젝트 정보를 수정하지 못했습니다.");
      }
    }
  }

  async function transitionProject() {
    if (!project || transitioning) return;
    const context = { projectId, generation: loadGeneration.current };
    if (!isCurrent(context)) return;
    const action = NEXT_ACTION[project.status];
    setTransitioning(true);
    setMessage(null);
    try {
      await api.post(`/projects/${context.projectId}/transition`, {
        targetStatus: action.target,
        expectedRevision: project.revision,
      });
      if (!isCurrent(context)) return;
      setShowTransition(false);
      setTransitioning(false);
      await load();
    } catch (error) {
      if (!isCurrent(context)) return;
      setShowTransition(false);
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        const latest = await reloadProjectForContext(context);
        if (!latest || !isCurrent(context)) return;
        setMessage(
          "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
        );
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        const latest = await reloadProjectForContext(context);
        if (!latest || !isCurrent(context)) return;
        setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
      } else {
        setMessage("프로젝트 상태를 변경하지 못했습니다.");
      }
    } finally {
      if (isCurrent(context)) setTransitioning(false);
    }
  }

  async function loadMoreAudit(
    expectedGeneration: number,
    expectedCursor: string | null,
  ) {
    const context: AuditPaginationContext = {
      projectId,
      generation: expectedGeneration,
      auditResourceToken: resourceRequestTokens.current.audit,
    };
    if (
      !expectedCursor ||
      !isCurrent(context) ||
      auditNextCursorRef.current !== expectedCursor ||
      auditPaginationRequest.current
    ) {
      return;
    }
    auditPaginationRequest.current = context;
    setAuditLoadingMore(true);
    const ownsRequest = () =>
      isCurrent(context) &&
      resourceRequestTokens.current.audit === context.auditResourceToken &&
      auditPaginationRequest.current === context;
    setAuditPaginationError(null);
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(
        `/projects/${context.projectId}/audit?limit=50&cursor=${encodeURIComponent(
          expectedCursor,
        )}`,
      );
      if (!ownsRequest()) return;
      setAudit((current) => [...current, ...page.items]);
      updateAuditNextCursor(page.nextCursor);
    } catch {
      if (ownsRequest()) {
        setAuditPaginationError("변경 이력을 더 불러오지 못했습니다.");
      }
    } finally {
      if (ownsRequest()) {
        auditPaginationRequest.current = null;
        setAuditLoadingMore(false);
      }
    }
  }

  if (projectLoading && !project) {
    return <ProjectHeaderSkeleton />;
  }
  if (!project) {
    return (
      <RetryableError
        message={projectLoadError ?? "프로젝트 정보를 불러오지 못했습니다."}
        retrying={projectLoading}
        onRetry={retryProject}
      />
    );
  }

  if (project.id !== projectId) {
    return <ProjectHeaderSkeleton />;
  }

  const operator = auth?.session.user.role === "OPERATOR";
  const action = NEXT_ACTION[project.status];
  const reopenBlocked =
    project.status === "CLOSED" &&
    project.endDate !== null &&
    project.endDate < currentKstDate();
  const canMutateRoster =
    project.status !== "CLOSED" &&
    project.status !== "PREPARING" &&
    (operator ||
      (project.status === "PRE_REGISTRATION" &&
        memberships.some(
          (membership) => membership.isActive && membership.masterIsActive,
        )));
  const rosterOrganizations: Organization[] = memberships.map((membership) => ({
    id: membership.organizationId,
    name: membership.name,
    isActive: membership.isActive && membership.masterIsActive,
  }));
  const childContext = {
    projectId: project.id,
    generation: loadGeneration.current,
  };
  const selectedTabErrors = TAB_RESOURCES[selectedTab]
    .map((resource) => resourceErrors[resource])
    .filter((error): error is string => Boolean(error));
  const selectedTabLoading = TAB_RESOURCES[selectedTab].some(
    (resource) => resourceLoading[resource],
  );
  const selectedTabLoaded = TAB_RESOURCES[selectedTab].every(
    (resource) => resourceLoaded[resource],
  );
  const renderGeneration = loadGeneration.current;
  const showRefreshingContent = selectedTabLoaded && selectedTabLoading;
  const showTabContent = selectedTabLoaded;
  const tabLoadingState = TAB_LOADING_STATE[selectedTab];

  async function reloadAfterChildMutation() {
    if (!isCurrent(childContext)) return;
    await load();
  }

  async function handleChildProjectClosed() {
    const latest = await reloadProjectForContext(childContext);
    if (!latest || !isCurrent(childContext)) return;
    setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
  }

  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">PROJECT DETAIL</p>
          <h1>{project.name}</h1>
          <div className="er-project-meta">
            <span
              className={`er-badge er-badge--${project.status.toLowerCase()}`}
            >
              {STATUS_LABEL[project.status]}
            </span>
            <span>{formatProjectDates(project)}</span>
            <span>{project.endDate ? "자동 종료" : "수동 종료"}</span>
          </div>
        </div>
        {operator ? (
          <div className="er-project-actions">
            <Button type="button" onClick={() => setShowEdit(true)}>
              {project.status === "CLOSED" ? "일정 수정" : "프로젝트 수정"}
            </Button>
            <Button
              type="button"
              variant={action.target === "CLOSED" ? "danger" : "primary"}
              disabled={reopenBlocked}
              onClick={() => setShowTransition(true)}
            >
              {action.label}
            </Button>
            {reopenBlocked ? (
              <span className="er-muted">
                종료일을 미래로 변경하거나 제거한 뒤 재개하세요.
              </span>
            ) : null}
          </div>
        ) : null}
      </header>
      {projectLoadError ? (
        <RetryableError
          message={projectLoadError}
          retrying={projectLoading}
          onRetry={retryProject}
        />
      ) : null}
      {message ? (
        <StatusMessage tone={message.includes("최신") ? "info" : "error"}>
          {message}
        </StatusMessage>
      ) : null}
      <div className="er-tabs" role="tablist" aria-label="프로젝트 상세">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`project-${project.id}-${tab.id}-tab`}
            className="er-tab"
            type="button"
            role="tab"
            aria-selected={selectedTab === tab.id}
            aria-controls={`project-${project.id}-${tab.id}-panel`}
            onClick={() => setSelectedTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`project-${project.id}-${selectedTab}-panel`}
        role="tabpanel"
        aria-labelledby={`project-${project.id}-${selectedTab}-tab`}
        aria-busy={selectedTabLoading}
      >
        {showRefreshingContent ? (
          <LoadingStatus>새로고침 중…</LoadingStatus>
        ) : null}
        {!selectedTabLoaded && selectedTabLoading ? (
          <ProjectTabSkeleton
            kind={tabLoadingState.kind}
            message={tabLoadingState.message}
          />
        ) : null}
        {selectedTabErrors.length > 0 ? (
          <RetryableError
            message={selectedTabErrors.join(" ")}
            onRetry={() => retryTab(selectedTab, renderGeneration)}
          />
        ) : null}
        {showTabContent && selectedTab === "overview" ? (
          <ProjectOverview summary={summary} memberships={memberships} />
        ) : null}
        {showTabContent && selectedTab === "organizations" ? (
          <ProjectOrganizationsPanel
            key={project.id}
            projectId={project.id}
            projectRevision={project.revision}
            memberships={memberships}
            allOrganizations={allOrganizations}
            canMutateMemberships={operator && project.status !== "CLOSED"}
            canManageOrganizations={operator}
            onChanged={reloadAfterChildMutation}
            onProjectClosed={handleChildProjectClosed}
          />
        ) : null}
        {showTabContent && selectedTab === "roster" ? (
          <ProjectRosterPage
            key={project.id}
            project={project}
            rows={rows}
            participants={participants}
            organizations={rosterOrganizations}
            canMutate={canMutateRoster}
            onChanged={reloadAfterChildMutation}
          />
        ) : null}
        {showTabContent && selectedTab === "audit" ? (
          <div className="er-page-stack">
            {auditPaginationError ? (
              <RetryableError
                message={auditPaginationError}
                retrying={auditLoadingMore}
                onRetry={() => loadMoreAudit(renderGeneration, auditNextCursor)}
              />
            ) : null}
            <AuditPanel
              items={audit}
              nextCursor={auditNextCursor}
              loadingMore={auditLoadingMore}
              onLoadMore={() =>
                loadMoreAudit(renderGeneration, auditNextCursor)
              }
            />
          </div>
        ) : null}
      </div>
      {showEdit ? (
        <ProjectEditDialog
          project={project}
          closed={project.status === "CLOSED"}
          onSubmit={updateProject}
          onClose={() => setShowEdit(false)}
        />
      ) : null}
      {showTransition ? (
        <Dialog
          title="프로젝트 상태 변경"
          onClose={() => setShowTransition(false)}
        >
          <p>
            {project.name} 프로젝트를 ‘{action.label}’ 상태로 변경하시겠습니까?
          </p>
          <Button
            type="button"
            variant={action.target === "CLOSED" ? "danger" : "primary"}
            loading={transitioning}
            loadingText="변경 중…"
            onClick={() => void transitionProject()}
          >
            변경 확인
          </Button>
        </Dialog>
      ) : null}
    </div>
  );
}

function formatProjectDates(project: Project) {
  const start = project.startDate?.replaceAll("-", ".") ?? "시작 미정";
  const end = project.endDate?.replaceAll("-", ".") ?? "종료 미정";
  return `${start} ~ ${end}`;
}

function currentKstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled detail resource: ${String(value)}`);
}
