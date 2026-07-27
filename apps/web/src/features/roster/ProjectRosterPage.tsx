import type { Organization, Project } from "@event-roster/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import type { ExportData } from "../../lib/excel/download-workbook";
import {
  getBrowserOrganizationStorage,
  readRecentOrganizationIds,
  recordRecentOrganizationId,
} from "../../lib/recent-organizations";
import { useAuth } from "../auth/AuthProvider";
import {
  type ExistingParticipantConfirmation,
  ParticipantDialog,
  type ParticipantView,
} from "./ParticipantDialog";
import { ParticipantEditDialog } from "./ParticipantEditDialog";
import { RosterTable, type RosterView } from "./RosterTable";

export interface ProjectRosterPageProps {
  project: Project;
  rows: RosterView[];
  participants: ParticipantView[];
  organizations: Organization[];
  canMutate: boolean;
  participantCandidatesAvailable?: boolean;
  onChanged(): Promise<void>;
}

interface RecentOrganizationContext {
  generation: number;
  userId: string;
  projectId: string;
  validOrganizationIds: ReadonlySet<string>;
}

function hasSameOrganizationIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
) {
  return (
    left.size === right.size &&
    Array.from(left).every((organizationId) => right.has(organizationId))
  );
}

export function ProjectRosterPage({
  project,
  rows,
  participants,
  organizations,
  canMutate,
  participantCandidatesAvailable = true,
  onChanged,
}: ProjectRosterPageProps) {
  const { api, auth } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editingParticipant, setEditingParticipant] =
    useState<ParticipantView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyRowIds, setBusyRowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [exporting, setExporting] = useState(false);
  const busyRowIdsRef = useRef<ReadonlySet<string>>(new Set());
  const exportingRef = useRef(false);
  const authenticatedUserId = auth?.session.user.id ?? "";
  const validOrganizationIds = useMemo(
    () =>
      new Set(
        organizations
          .filter((organization) => organization.isActive)
          .map((organization) => organization.id),
      ),
    [organizations],
  );
  const recentOrganizationContextRef = useRef<RecentOrganizationContext>({
    generation: 0,
    userId: authenticatedUserId,
    projectId: project.id,
    validOrganizationIds,
  });
  useLayoutEffect(() => {
    const previousContext = recentOrganizationContextRef.current;
    const contextChanged =
      previousContext.userId !== authenticatedUserId ||
      previousContext.projectId !== project.id ||
      !hasSameOrganizationIds(
        previousContext.validOrganizationIds,
        validOrganizationIds,
      );
    recentOrganizationContextRef.current = {
      generation: previousContext.generation + (contextChanged ? 1 : 0),
      userId: authenticatedUserId,
      projectId: project.id,
      validOrganizationIds,
    };
  }, [authenticatedUserId, project.id, validOrganizationIds]);
  const [recentOrganizationIds, setRecentOrganizationIds] = useState<string[]>(
    () =>
      authenticatedUserId
        ? readRecentOrganizationIds({
            storage: getBrowserOrganizationStorage(),
            userId: authenticatedUserId,
            projectId: project.id,
            validOrganizationIds,
          })
        : [],
  );
  useEffect(() => {
    if (!authenticatedUserId) {
      setRecentOrganizationIds([]);
      return;
    }
    setRecentOrganizationIds(
      readRecentOrganizationIds({
        storage: getBrowserOrganizationStorage(),
        userId: authenticatedUserId,
        projectId: project.id,
        validOrganizationIds,
      }),
    );
  }, [authenticatedUserId, project.id, validOrganizationIds]);
  const availableParticipants = useMemo(
    () =>
      participants.filter(
        (participant) =>
          (auth?.session.user.role === "OPERATOR" ||
            validOrganizationIds.has(participant.organizationId)) &&
          !rows.some(
            (row) =>
              row.participantId === participant.id && row.status === "ACTIVE",
          ),
      ),
    [auth?.session.user.role, participants, rows, validOrganizationIds],
  );

  function rememberOrganization(
    organizationId: string,
    expectedGeneration: number,
  ) {
    const context = recentOrganizationContextRef.current;
    if (context.generation !== expectedGeneration || !context.userId) return;
    setRecentOrganizationIds(
      recordRecentOrganizationId({
        storage: getBrowserOrganizationStorage(),
        userId: context.userId,
        projectId: context.projectId,
        organizationId,
        validOrganizationIds: context.validOrganizationIds,
      }),
    );
  }

  async function handleMutation(
    operation: () => Promise<unknown>,
    onStale?: () => void,
  ) {
    setMessage(null);
    try {
      await operation();
      await onChanged();
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        onStale?.();
        setMessage("다른 변경이 먼저 반영되어 최신 명단을 다시 불러왔습니다.");
        await onChanged();
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        setMessage("프로젝트가 종료되어 변경할 수 없습니다.");
        await onChanged();
      } else {
        setMessage("명단 변경을 반영하지 못했습니다.");
      }
      return false;
    }
  }

  async function changeStatus(row: RosterView, status: "ACTIVE" | "CANCELLED") {
    if (busyRowIdsRef.current.has(row.id)) return;
    const nextBusyRowIds = new Set(busyRowIdsRef.current).add(row.id);
    busyRowIdsRef.current = nextBusyRowIds;
    setBusyRowIds(nextBusyRowIds);
    try {
      await handleMutation(() =>
        api.patch(`/projects/${project.id}/roster/${row.id}`, {
          status,
          expectedRevision: project.revision,
          expectedEntryRevision: row.revision,
        }),
      );
    } finally {
      const remainingBusyRowIds = new Set(busyRowIdsRef.current);
      remainingBusyRowIds.delete(row.id);
      busyRowIdsRef.current = remainingBusyRowIds;
      setBusyRowIds(remainingBusyRowIds);
    }
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
    if (!editingParticipant) return;
    const completed = await handleMutation(
      () =>
        api.patch(
          `/projects/${project.id}/participants/${editingParticipant.id}`,
          { ...input, expectedProjectRevision: project.revision },
        ),
      () => setEditingParticipant(null),
    );
    if (completed) setEditingParticipant(null);
  }

  async function add(input: ExistingParticipantConfirmation) {
    const recentOrganizationGeneration =
      recentOrganizationContextRef.current.generation;
    const {
      participantId,
      expectedParticipantRevision,
      ...confirmedParticipant
    } = input;
    const completed = await handleMutation(() =>
      api.post(`/projects/${project.id}/roster`, {
        participantId,
        confirmedParticipant,
        expectedParticipantRevision,
        expectedRevision: project.revision,
      }),
    );
    if (completed) {
      rememberOrganization(input.organizationId, recentOrganizationGeneration);
      setShowAdd(false);
    }
  }

  async function createAndAdd(input: { name: string; organizationId: string }) {
    const recentOrganizationGeneration =
      recentOrganizationContextRef.current.generation;
    const completed = await handleMutation(() =>
      api.post(`/projects/${project.id}/roster`, {
        newParticipant: input,
        expectedRevision: project.revision,
      }),
    );
    if (completed) {
      rememberOrganization(input.organizationId, recentOrganizationGeneration);
      setShowAdd(false);
    }
  }

  async function exportRoster() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setMessage(null);
    try {
      const data = await api.get<ExportData>(
        `/projects/${project.id}/exports/roster`,
      );
      const { downloadExportWorkbook, projectRosterFilename } = await import(
        "../../lib/excel/download-workbook"
      );
      const filename = projectRosterFilename(project.name);
      downloadExportWorkbook(data, filename);
    } catch {
      setMessage("엑셀 명단을 내보내지 못했습니다.");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <div className="er-page-stack">
      {message ? (
        <StatusMessage tone={message.includes("최신") ? "info" : "error"}>
          {message}
        </StatusMessage>
      ) : null}
      <div className="er-roster-actions er-action-row er-action-row--wrap">
        {auth?.session.user.role === "OPERATOR" &&
        project.status === "PRE_REGISTRATION" ? (
          <a
            className="er-button er-button--secondary"
            href={`/projects/${project.id}/import`}
          >
            엑셀 가져오기
          </a>
        ) : null}
        <Button
          type="button"
          loading={exporting}
          loadingText="내보내는 중…"
          onClick={() => void exportRoster()}
        >
          엑셀 내보내기
        </Button>
        {canMutate ? (
          <Button
            type="button"
            variant="primary"
            disabled={!participantCandidatesAvailable}
            onClick={() => setShowAdd(true)}
          >
            참가자 추가
          </Button>
        ) : null}
      </div>
      <Card className="er-panel">
        <h2>참가 명단</h2>
        <RosterTable
          rows={rows}
          canMutate={canMutate}
          busyRowIds={busyRowIds}
          canMutateRow={(row) =>
            auth?.session.user.role === "OPERATOR" ||
            validOrganizationIds.has(row.organizationId)
          }
          canEditRow={(row) =>
            participantCandidatesAvailable &&
            (auth?.session.user.role === "OPERATOR" ||
              validOrganizationIds.has(row.organizationId))
          }
          onStatusChange={changeStatus}
          onEdit={edit}
        />
      </Card>
      {showAdd && canMutate ? (
        <ParticipantDialog
          participants={availableParticipants}
          organizations={organizations}
          recentOrganizationIds={recentOrganizationIds}
          allowExistingOrganizationChange={
            auth?.session.user.role === "OPERATOR"
          }
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
            project.status === "PRE_REGISTRATION" &&
            auth?.session.user.role === "OPERATOR"
          }
          onSave={updateParticipant}
          onClose={() => setEditingParticipant(null)}
        />
      ) : null}
    </div>
  );
}
