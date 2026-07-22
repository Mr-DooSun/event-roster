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
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import type { OrganizationView } from "../admin/UserForm";
import { useAuth } from "../auth/AuthProvider";
import { AuditPanel, type AuditView } from "../roster/AuditPanel";
import type { ParticipantView } from "../roster/ParticipantDialog";
import { ProjectRosterPage } from "../roster/ProjectRosterPage";
import type { RosterView } from "../roster/RosterTable";
import { ProjectEditDialog, type ProjectEditInput } from "./ProjectEditDialog";
import { ProjectOrganizationsPanel } from "./ProjectOrganizationsPanel";
import { ProjectOverview } from "./ProjectOverview";

type ProjectTab = "overview" | "organizations" | "roster" | "audit";

const TABS: ReadonlyArray<{ id: ProjectTab; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "organizations", label: "조직" },
  { id: "roster", label: "참가 명단" },
  { id: "audit", label: "변경 이력" },
];

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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const loadGeneration = useRef(0);
  const auditLoading = useRef(false);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const [
        nextProject,
        nextSummary,
        nextMemberships,
        nextOrganizations,
        nextRows,
        nextParticipants,
        auditPage,
      ] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<ProjectSummary>(`/projects/${projectId}/summary`),
        api.get<ProjectOrganization[]>(`/projects/${projectId}/organizations`),
        api.get<Organization[]>("/organizations"),
        api.get<RosterView[]>(`/projects/${projectId}/roster`),
        api.get<ParticipantView[]>("/participants"),
        api.get<{ items: AuditView[]; nextCursor: string | null }>(
          `/projects/${projectId}/audit?limit=50`,
        ),
      ]);
      if (generation !== loadGeneration.current) return;
      setProject(nextProject);
      setSummary(nextSummary);
      setMemberships(nextMemberships);
      setAllOrganizations(nextOrganizations);
      setRows(nextRows);
      setParticipants(nextParticipants);
      setAudit(auditPage.items);
      setAuditNextCursor(auditPage.nextCursor);
      setMessage(null);
    } catch {
      if (generation === loadGeneration.current) {
        setMessage("프로젝트 정보를 불러오지 못했습니다.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    setSelectedTab("overview");
    setProject(null);
    setSummary(EMPTY_SUMMARY(projectId));
    setMemberships([]);
    setAllOrganizations([]);
    setRows([]);
    setParticipants([]);
    setAudit([]);
    setAuditNextCursor(null);
    setMessage(null);
    setShowEdit(false);
    setShowTransition(false);
    setLoading(true);
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load, projectId]);

  async function reloadProjectAfterStale() {
    const latest = await api.get<Project>(`/projects/${projectId}`);
    setProject(latest);
  }

  async function updateProject(input: ProjectEditInput) {
    setMessage(null);
    try {
      const updated = await api.patch<Project>(`/projects/${projectId}`, input);
      setProject(updated);
      setShowEdit(false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        await reloadProjectAfterStale();
        setShowEdit(false);
        setMessage(
          "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
        );
      } else {
        setMessage("프로젝트 정보를 수정하지 못했습니다.");
      }
    }
  }

  async function transitionProject() {
    if (!project) return;
    const action = NEXT_ACTION[project.status];
    setMessage(null);
    try {
      await api.post(`/projects/${projectId}/transition`, {
        targetStatus: action.target,
        expectedRevision: project.revision,
      });
      setShowTransition(false);
      await load();
    } catch (error) {
      setShowTransition(false);
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        await reloadProjectAfterStale();
        setMessage(
          "다른 변경이 먼저 반영되어 최신 프로젝트를 다시 불러왔습니다.",
        );
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        await reloadProjectAfterStale();
        setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
      } else {
        setMessage("프로젝트 상태를 변경하지 못했습니다.");
      }
    }
  }

  async function loadMoreAudit() {
    if (!auditNextCursor || auditLoading.current) return;
    auditLoading.current = true;
    const generation = loadGeneration.current;
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(
        `/projects/${projectId}/audit?limit=50&cursor=${encodeURIComponent(
          auditNextCursor,
        )}`,
      );
      if (generation !== loadGeneration.current) return;
      setAudit((current) => [...current, ...page.items]);
      setAuditNextCursor(page.nextCursor);
    } catch {
      if (generation === loadGeneration.current) {
        setMessage("변경 이력을 더 불러오지 못했습니다.");
      }
    } finally {
      auditLoading.current = false;
    }
  }

  if (loading && !project) {
    return <p className="er-muted">프로젝트 불러오는 중…</p>;
  }
  if (!project) {
    return message ? (
      <StatusMessage tone="error">{message}</StatusMessage>
    ) : null;
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
    (operator || project.status === "PRE_REGISTRATION");
  const rosterOrganizations: OrganizationView[] = memberships.map(
    (membership) => ({
      id: membership.organizationId,
      name: membership.name,
      isActive: membership.isActive && membership.masterIsActive,
    }),
  );

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
      >
        {selectedTab === "overview" ? (
          <ProjectOverview summary={summary} memberships={memberships} />
        ) : null}
        {selectedTab === "organizations" ? (
          <ProjectOrganizationsPanel
            projectId={project.id}
            memberships={memberships}
            allOrganizations={allOrganizations}
            canAdminister={operator && project.status !== "CLOSED"}
            onChanged={load}
          />
        ) : null}
        {selectedTab === "roster" ? (
          <ProjectRosterPage
            project={project}
            rows={rows}
            participants={participants}
            organizations={rosterOrganizations}
            canMutate={canMutateRoster}
            onChanged={load}
          />
        ) : null}
        {selectedTab === "audit" ? (
          <AuditPanel
            items={audit}
            nextCursor={auditNextCursor}
            onLoadMore={loadMoreAudit}
          />
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
