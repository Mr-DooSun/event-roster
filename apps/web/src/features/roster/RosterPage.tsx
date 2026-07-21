import type { EventSummary } from "@event-roster/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import type { ExportData } from "../../lib/excel/download-workbook";
import type { OrganizationView } from "../admin/UserForm";
import { useAuth } from "../auth/AuthProvider";
import type { EventView } from "../events/EventsPage";
import { AuditPanel, type AuditView } from "./AuditPanel";
import { ParticipantDialog, type ParticipantView } from "./ParticipantDialog";
import { ParticipantEditDialog } from "./ParticipantEditDialog";
import { RosterTable, type RosterView } from "./RosterTable";
import { SummaryCards } from "./SummaryCards";

const EMPTY_SUMMARY = (eventId: string): EventSummary => ({
  eventId,
  expectedTotal: 0,
  finalTotal: 0,
  deltaTotal: 0,
  organizations: [],
});

export function RosterPage({ eventId }: { eventId: string }) {
  const { api, auth } = useAuth();
  const [event, setEvent] = useState<EventView | null>(null);
  const [rows, setRows] = useState<RosterView[]>([]);
  const [summary, setSummary] = useState<EventSummary>(() =>
    EMPTY_SUMMARY(eventId),
  );
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [audit, setAudit] = useState<AuditView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingCreatedParticipantId, setPendingCreatedParticipantId] =
    useState<string | null>(null);
  const [editingParticipant, setEditingParticipant] =
    useState<ParticipantView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const auditLoading = useRef(false);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const [
        events,
        nextRows,
        nextSummary,
        nextParticipants,
        nextOrganizations,
        auditPage,
      ] = await Promise.all([
        api.get<EventView[]>("/events"),
        api.get<RosterView[]>(`/events/${eventId}/roster`),
        api.get<EventSummary>(`/events/${eventId}/summary`),
        api.get<ParticipantView[]>("/participants"),
        api.get<OrganizationView[]>("/organizations"),
        api.get<{ items: AuditView[]; nextCursor: string | null }>(
          `/events/${eventId}/audit-logs?limit=50`,
        ),
      ]);
      if (generation !== loadGeneration.current) return;
      setEvent(events.find((item) => item.id === eventId) ?? null);
      setRows(nextRows);
      setSummary(nextSummary);
      setParticipants(nextParticipants);
      setOrganizations(nextOrganizations);
      setAudit(auditPage.items);
      setAuditNextCursor(auditPage.nextCursor);
    } catch {
      if (generation === loadGeneration.current) {
        setMessage("행사 명단을 불러오지 못했습니다.");
      }
    }
  }, [api, eventId]);
  useEffect(() => {
    setEvent(null);
    setRows([]);
    setSummary(EMPTY_SUMMARY(eventId));
    setAudit([]);
    setAuditNextCursor(null);
    setShowAdd(false);
    setEditingParticipant(null);
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [eventId, load]);
  const canMutate =
    event !== null &&
    event.status !== "CLOSED" &&
    event.status !== "DRAFT" &&
    (auth?.session.user.role === "OPERATOR" ||
      event.status === "PRE_REGISTRATION");
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
      } else setMessage("명단 변경을 반영하지 못했습니다.");
      return false;
    }
  }
  async function changeStatus(row: RosterView, status: "ACTIVE" | "CANCELLED") {
    if (!event) return;
    await handleMutation(() =>
      api.patch(`/events/${eventId}/roster/${row.id}`, {
        status,
        expectedRevision: event.revision,
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
      () => api.patch(`/participants/${editingParticipant.id}`, input),
      () => setEditingParticipant(null),
    );
    if (completed) setEditingParticipant(null);
  }
  async function add(participantId: string) {
    if (!event) return;
    const completed = await handleMutation(() =>
      api.post(`/events/${eventId}/roster`, {
        participantId,
        expectedRevision: event.revision,
      }),
    );
    if (completed) {
      setPendingCreatedParticipantId(null);
      setShowAdd(false);
    }
  }
  async function createAndAdd(input: { name: string; organizationId: string }) {
    if (!event) return;
    setMessage(null);
    let created: { id: string } | null = null;
    try {
      created = await api.post<{ id: string }>("/participants", input);
      await api.post(`/events/${eventId}/roster`, {
        participantId: created.id,
        expectedRevision: event.revision,
      });
      setPendingCreatedParticipantId(null);
      setShowAdd(false);
      await load();
    } catch {
      if (created) {
        setPendingCreatedParticipantId(created.id);
        setMessage(
          "참가자는 생성됐지만 명단 반영이 충돌했습니다. 생성된 참가자를 선택해 다시 추가해 주세요.",
        );
        await load();
      } else {
        setMessage("참가자를 만들지 못했습니다.");
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
        `/events/${eventId}/audit-logs?limit=50&cursor=${encodeURIComponent(auditNextCursor)}`,
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
      const data = await api.get<ExportData>(`/events/${eventId}/export-data`);
      const safeName = (event?.name ?? "행사")
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
          <h1>{event?.name ?? "행사 명단"}</h1>
          <p className="er-muted">
            {event ? statusLabel(event.status) : "불러오는 중"}
          </p>
        </div>
        <div className="er-action-row">
          {auth?.session.user.role === "OPERATOR" &&
          event?.status === "PRE_REGISTRATION" ? (
            <a
              className="er-button er-button--secondary"
              href={`/events/${eventId}/import`}
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
              onClick={() => {
                setPendingCreatedParticipantId(null);
                setShowAdd(true);
              }}
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
          initialParticipantId={pendingCreatedParticipantId}
          onClose={() => {
            setPendingCreatedParticipantId(null);
            setShowAdd(false);
          }}
        />
      ) : null}
      {editingParticipant && canMutate ? (
        <ParticipantEditDialog
          participant={editingParticipant}
          organizations={organizations}
          allowOrganizationChange={
            event?.status === "PRE_REGISTRATION" &&
            auth?.session.user.role === "OPERATOR"
          }
          onSave={updateParticipant}
          onClose={() => setEditingParticipant(null)}
        />
      ) : null}
    </div>
  );
}

function statusLabel(status: EventView["status"]) {
  return {
    DRAFT: "초안",
    PRE_REGISTRATION: "사전 등록",
    DAY_OF: "당일 운영",
    CLOSED: "종료",
  }[status];
}
