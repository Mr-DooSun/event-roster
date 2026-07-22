import type {
  Project,
  ProjectOrganization,
  ProjectSummary,
} from "@event-roster/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import type { ExportData } from "../../lib/excel/download-workbook";
import type { OrganizationView } from "../admin/UserForm";
import { useAuth } from "../auth/AuthProvider";
import { AuditPanel, type AuditView } from "./AuditPanel";
import { ParticipantDialog, type ParticipantView } from "./ParticipantDialog";
import { ParticipantEditDialog } from "./ParticipantEditDialog";
import { RosterTable, type RosterView } from "./RosterTable";
import { SummaryCards } from "./SummaryCards";

const EMPTY_SUMMARY = (projectId: string): ProjectSummary => ({
  projectId,
  expectedTotal: 0,
  finalTotal: 0,
  deltaTotal: 0,
  organizations: [],
});

export function ProjectRosterPage({ projectId }: { projectId: string }) {
  const { api, auth } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<RosterView[]>([]);
  const [summary, setSummary] = useState<ProjectSummary>(() =>
    EMPTY_SUMMARY(projectId),
  );
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [audit, setAudit] = useState<AuditView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingParticipant, setEditingParticipant] =
    useState<ParticipantView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const auditLoading = useRef(false);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const [
        nextProject,
        nextRows,
        nextSummary,
        nextParticipants,
        nextOrganizations,
        auditPage,
      ] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<RosterView[]>(`/projects/${projectId}/roster`),
        api.get<ProjectSummary>(`/projects/${projectId}/summary`),
        api.get<ParticipantView[]>("/participants"),
        api.get<ProjectOrganization[]>(`/projects/${projectId}/organizations`),
        api.get<{ items: AuditView[]; nextCursor: string | null }>(
          `/projects/${projectId}/audit?limit=50`,
        ),
      ]);
      if (generation !== loadGeneration.current) return;
      setProject(nextProject);
      setRows(nextRows);
      setSummary(nextSummary);
      setParticipants(nextParticipants);
      setOrganizations(
        nextOrganizations.map((organization) => ({
          id: organization.organizationId,
          name: organization.name,
          isActive: organization.isActive && organization.masterIsActive,
        })),
      );
      setAudit(auditPage.items);
      setAuditNextCursor(auditPage.nextCursor);
    } catch {
      if (generation === loadGeneration.current) {
        setMessage("프로젝트 명단을 불러오지 못했습니다.");
      }
    }
  }, [api, projectId]);
  useEffect(() => {
    setProject(null);
    setRows([]);
    setSummary(EMPTY_SUMMARY(projectId));
    setAudit([]);
    setAuditNextCursor(null);
    setShowAdd(false);
    setEditingParticipant(null);
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [projectId, load]);
  const canMutate =
    project !== null &&
    project.status !== "CLOSED" &&
    project.status !== "PREPARING" &&
    (auth?.session.user.role === "OPERATOR" ||
      project.status === "PRE_REGISTRATION");
  const availableParticipants = useMemo(
    () =>
      participants.filter(
        (participant) =>
          !rows.some(
            (row) =>
              row.participantId === participant.id && row.status === "ACTIVE",
          ),
      ),
    [participants, rows],
  );
  async function handleMutation(
    operation: () => Promise<unknown>,
    onStale?: () => void,
  ) {
    setMessage(null);
    try {
      await operation();
      await load();
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        onStale?.();
        setMessage("다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.");
        await load();
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
        await load();
      } else setMessage("명단 변경을 반영하지 못했습니다.");
      return false;
    }
  }
  async function changeStatus(row: RosterView, status: "ACTIVE" | "CANCELLED") {
    if (!project) return;
    await handleMutation(() =>
      api.patch(`/projects/${projectId}/roster/${row.id}`, {
        status,
        expectedRevision: project.revision,
        expectedEntryRevision: row.revision,
      }),
    );
  }
  function edit(row: RosterView) {
    setEditingParticipant(
      participants.find(
        (participant) => participant.id === row.participantId,
      ) ?? null,
    );
  }

  async function updateParticipant(input: {
    name: string;
    organizationId: string;
    expectedRevision: number;
  }) {
    if (!project || !editingParticipant) return;
    const completed = await handleMutation(
      () =>
        api.patch(
          `/projects/${projectId}/participants/${editingParticipant.id}`,
          { ...input, expectedProjectRevision: project.revision },
        ),
      () => setEditingParticipant(null),
    );
    if (completed) setEditingParticipant(null);
  }
  async function add(participantId: string) {
    if (!project) return;
    const completed = await handleMutation(() =>
      api.post(`/projects/${projectId}/roster`, {
        participantId,
        expectedRevision: project.revision,
      }),
    );
    if (completed) {
      setShowAdd(false);
    }
  }
  async function createAndAdd(input: { name: string; organizationId: string }) {
    if (!project) return;
    const completed = await handleMutation(() =>
      api.post(`/projects/${projectId}/roster`, {
        newParticipant: input,
        expectedRevision: project.revision,
      }),
    );
    if (completed) setShowAdd(false);
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
        `/projects/${projectId}/audit?limit=50&cursor=${encodeURIComponent(auditNextCursor)}`,
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

  async function exportRoster() {
    try {
      const data = await api.get<ExportData>(
        `/projects/${projectId}/exports/roster`,
      );
      const safeName = (project?.name ?? "프로젝트")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim();
      const { downloadExportWorkbook } = await import(
        "../../lib/excel/download-workbook"
      );
      downloadExportWorkbook(data, `${safeName}-명단.xlsx`);
    } catch {
      setMessage("엑셀 명단을 내보내지 못했습니다.");
    }
  }
  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">ROSTER</p>
          <h1>{project?.name ?? "프로젝트 명단"}</h1>
          <p className="er-muted">
            {project ? statusLabel(project.status) : "불러오는 중"}
          </p>
        </div>
        <div className="er-action-row">
          {auth?.session.user.role === "OPERATOR" &&
          project?.status === "PRE_REGISTRATION" ? (
            <a
              className="er-button er-button--secondary"
              href={`/projects/${projectId}/import`}
            >
              엑셀 가져오기
            </a>
          ) : null}
          <Button type="button" onClick={() => void exportRoster()}>
            엑셀 내보내기
          </Button>
          {canMutate ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowAdd(true)}
            >
              참가자 추가
            </Button>
          ) : null}
        </div>
      </header>
      {message ? (
        <StatusMessage tone={message.includes("최신") ? "info" : "error"}>
          {message}
        </StatusMessage>
      ) : null}
      <SummaryCards summary={summary} />
      <Card className="er-panel">
        <h2>참가 명단</h2>
        <RosterTable
          rows={rows}
          canMutate={canMutate}
          onStatusChange={changeStatus}
          onEdit={edit}
        />
      </Card>
      <AuditPanel
        items={audit}
        nextCursor={auditNextCursor}
        onLoadMore={loadMoreAudit}
      />
      {showAdd && canMutate ? (
        <ParticipantDialog
          participants={availableParticipants}
          organizations={organizations}
          onAdd={add}
          onCreateAndAdd={createAndAdd}
          onClose={() => setShowAdd(false)}
        />
      ) : null}
      {editingParticipant && canMutate ? (
        <ParticipantEditDialog
          participant={editingParticipant}
          organizations={organizations}
          allowOrganizationChange={
            project?.status === "PRE_REGISTRATION" &&
            auth?.session.user.role === "OPERATOR"
          }
          onSave={updateParticipant}
          onClose={() => setEditingParticipant(null)}
        />
      ) : null}
    </div>
  );
}

function statusLabel(status: Project["status"]) {
  return {
    PREPARING: "준비 중",
    PRE_REGISTRATION: "사전 등록",
    IN_PROGRESS: "진행 중",
    CLOSED: "종료",
  }[status];
}
