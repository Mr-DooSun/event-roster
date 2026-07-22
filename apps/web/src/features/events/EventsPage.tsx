import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { EventForm } from "./EventForm";
import { EventTransitionDialog } from "./EventTransitionDialog";
import type { EventStatus, Half } from "./legacy-event-contracts";

export interface EventView {
  id: string;
  year: number;
  half: Half;
  name: string;
  status: EventStatus;
  revision: number;
}

export function EventsPage() {
  const { api, auth } = useAuth();
  const [events, setEvents] = useState<EventView[]>([]);
  const [transition, setTransition] = useState<{
    event: EventView;
    target: EventStatus;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operator = auth?.session.user.role === "OPERATOR";
  const load = useCallback(async () => {
    try {
      setEvents(await api.get<EventView[]>("/events"));
    } catch {
      setError("행사 목록을 불러오지 못했습니다.");
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  async function create(input: { year: number; half: Half; name: string }) {
    try {
      await api.post("/events", input);
      await load();
    } catch {
      setError("행사를 만들지 못했습니다.");
    }
  }
  async function confirmTransition() {
    if (!transition) return;
    try {
      await api.post(`/events/${transition.event.id}/transition`, {
        targetStatus: transition.target,
        expectedRevision: transition.event.revision,
      });
      setTransition(null);
      await load();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.problem?.code === "STALE_REVISION"
      ) {
        setTransition(null);
        setError(
          "다른 변경이 먼저 반영되어 최신 행사 목록을 다시 불러왔습니다.",
        );
        await load();
      } else {
        setError("행사 상태를 변경하지 못했습니다.");
      }
    }
  }

  async function rename(event: EventView, name: string) {
    try {
      await api.patch(`/events/${event.id}`, {
        name,
        expectedRevision: event.revision,
      });
      await load();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.problem?.code === "STALE_REVISION"
      ) {
        setError(
          "다른 변경이 먼저 반영되어 최신 행사 목록을 다시 불러왔습니다.",
        );
        await load();
      } else {
        setError("행사 이름을 변경하지 못했습니다.");
      }
    }
  }
  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">EVENTS</p>
          <h1>행사 관리</h1>
        </div>
      </header>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {operator ? (
        <Card className="er-panel">
          <h2>새 행사</h2>
          <EventForm onSubmit={create} />
        </Card>
      ) : null}
      <div className="er-card-grid">
        {events.map((event) => (
          <Card className="er-panel" key={event.id}>
            <div className="er-event-title">
              <div>
                <span
                  className={`er-badge er-badge--${event.status.toLowerCase()}`}
                >
                  {statusLabel(event.status)}
                </span>
                {operator &&
                (event.status === "DRAFT" ||
                  event.status === "PRE_REGISTRATION") ? (
                  <EventNameEditor event={event} onSave={rename} />
                ) : (
                  <h2>{event.name}</h2>
                )}
                <p className="er-muted">
                  {event.year}년 {event.half === "H1" ? "상반기" : "하반기"}
                </p>
              </div>
              <a
                className="er-button er-button--primary"
                href={`/events/${event.id}`}
              >
                명단 열기
              </a>
            </div>
            {operator ? (
              <div className="er-action-row">
                {nextActions(event.status).map((action) => (
                  <Button
                    key={action.target}
                    type="button"
                    onClick={() =>
                      setTransition({ event, target: action.target })
                    }
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {transition ? (
        <EventTransitionDialog
          eventName={transition.event.name}
          targetStatus={transition.target}
          onConfirm={confirmTransition}
          onClose={() => setTransition(null)}
        />
      ) : null}
    </div>
  );
}

function EventNameEditor({
  event,
  onSave,
}: {
  event: EventView;
  onSave: (event: EventView, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(event.name);
  useEffect(() => {
    setName(event.name);
  }, [event.name]);
  return (
    <div className="er-inline-form">
      <label className="er-field">
        <span className="er-sr-only">{event.name} 행사 이름</span>
        <input
          aria-label={`${event.name} 행사 이름`}
          value={name}
          onChange={(changeEvent) => setName(changeEvent.currentTarget.value)}
        />
      </label>
      <Button
        type="button"
        disabled={!name.trim()}
        onClick={() => void onSave(event, name.trim())}
      >
        이름 저장
      </Button>
    </div>
  );
}

function nextActions(
  status: EventStatus,
): Array<{ target: EventStatus; label: string }> {
  if (status === "DRAFT")
    return [{ target: "PRE_REGISTRATION", label: "사전 등록 시작" }];
  if (status === "PRE_REGISTRATION")
    return [{ target: "DAY_OF", label: "당일 운영 시작" }];
  if (status === "DAY_OF") return [{ target: "CLOSED", label: "행사 종료" }];
  return [{ target: "DAY_OF", label: "당일 운영 재개" }];
}

function statusLabel(status: EventStatus) {
  return {
    DRAFT: "초안",
    PRE_REGISTRATION: "사전 등록",
    DAY_OF: "당일 운영",
    CLOSED: "종료",
  }[status];
}
