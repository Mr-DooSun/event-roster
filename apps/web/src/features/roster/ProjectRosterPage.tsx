import type { Project } from "@event-roster/contracts";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import type { ExportData } from "../../lib/excel/download-workbook";
import type { OrganizationView } from "../admin/UserForm";
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
  organizations: OrganizationView[];
  canMutate: boolean;
  onChanged(): Promise<void>;
}

export function ProjectRosterPage({
  project,
  rows,
  participants,
  organizations,
  canMutate,
  onChanged,
}: ProjectRosterPageProps) {
  const { api, auth } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editingParticipant, setEditingParticipant] =
    useState<ParticipantView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activeOrganizationIds = useMemo(
    () =>
      new Set(
        organizations
          .filter((organization) => organization.isActive)
          .map((organization) => organization.id),
      ),
    [organizations],
  );
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
    await handleMutation(() =>
      api.patch(`/projects/${project.id}/roster/${row.id}`, {
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
    if (completed) setShowAdd(false);
  }

  async function createAndAdd(input: { name: string; organizationId: string }) {
    const completed = await handleMutation(() =>
      api.post(`/projects/${project.id}/roster`, {
        newParticipant: input,
        expectedRevision: project.revision,
      }),
    );
    if (completed) setShowAdd(false);
  }

  async function exportRoster() {
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
    }
  }

  return (
    <div className="er-page-stack">
      {message ? (
        <StatusMessage tone={message.includes("최신") ? "info" : "error"}>
          {message}
        </StatusMessage>
      ) : null}
      <div className="er-action-row er-action-row--wrap">
        {auth?.session.user.role === "OPERATOR" &&
        project.status === "PRE_REGISTRATION" ? (
          <a
            className="er-button er-button--secondary"
            href={`/projects/${project.id}/import`}
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
      <Card className="er-panel">
        <h2>참가 명단</h2>
        <RosterTable
          rows={rows}
          canMutate={canMutate}
          canMutateRow={(row) =>
            auth?.session.user.role === "OPERATOR" ||
            activeOrganizationIds.has(row.organizationId)
          }
          onStatusChange={changeStatus}
          onEdit={edit}
        />
      </Card>
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
