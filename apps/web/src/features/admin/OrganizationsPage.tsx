import type { OrganizationSummary } from "@event-roster/contracts";
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
import { getReservedOrganizationId } from "../../lib/organization-errors";
import { getTotalOrganizationManagerCount } from "../../lib/organization-summary";
import { useAuth } from "../auth/AuthProvider";

type OrganizationStatus = "ALL" | "ACTIVE" | "INACTIVE";
type LeaderStatus = "ALL" | "ASSIGNED" | "UNASSIGNED";
type ListLoadState = "INITIAL" | "REFRESHING" | null;

const organizationSkeletonKeys = Array.from(
  { length: 6 },
  (_, index) => `organization-skeleton-${index}`,
);

export function OrganizationsPage() {
  const { api } = useAuth();
  const [organizationNotice] = useState(consumeOrganizationNotice);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<OrganizationStatus>("ALL");
  const [leaderStatus, setLeaderStatus] = useState<LeaderStatus>("ALL");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reservedOrganizationId, setReservedOrganizationId] = useState<
    string | null
  >(null);
  const [loadState, setLoadState] = useState<ListLoadState>("INITIAL");
  const [creating, setCreating] = useState(false);
  const hasLoaded = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadState(hasLoaded.current ? "REFRESHING" : "INITIAL");
    const search = `query=${encodeURIComponent(
      submittedQuery,
    )}&status=${status}&leaderStatus=${leaderStatus}&includeDeleted=${includeDeleted}`;
    try {
      const next = await api.get<OrganizationSummary[]>(
        `/organizations?${search}`,
      );
      if (generation !== loadGeneration.current) return;
      setOrganizations(next);
      hasLoaded.current = true;
      setError(null);
    } catch {
      if (generation !== loadGeneration.current) return;
      setError("조직 목록을 불러오지 못했습니다.");
    } finally {
      if (generation === loadGeneration.current) setLoadState(null);
    }
  }, [api, includeDeleted, leaderStatus, status, submittedQuery]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === submittedQuery) {
      void load();
      return;
    }
    setSubmittedQuery(nextQuery);
  }

  function resetCreateForm() {
    setName("");
    setCreateError(null);
    setReservedOrganizationId(null);
  }

  function openCreateDialog() {
    resetCreateForm();
    setShowCreate(true);
  }

  function closeCreateDialog() {
    setShowCreate(false);
    resetCreateForm();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setReservedOrganizationId(null);
    setCreating(true);
    try {
      await api.post("/organizations", { name: name.trim() });
      closeCreateDialog();
      await load();
    } catch (caught) {
      const reservedId = getReservedOrganizationId(caught);
      setReservedOrganizationId(reservedId);
      setCreateError(
        reservedId || (caught instanceof ApiError && caught.status === 409)
          ? "같은 이름의 조직이 이미 있습니다."
          : "조직을 만들지 못했습니다.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">ADMIN</p>
          <h1>조직 관리</h1>
        </div>
        <Button type="button" variant="primary" onClick={openCreateDialog}>
          새 조직
        </Button>
      </header>
      {organizationNotice ? (
        <StatusMessage tone="info">{organizationNotice}</StatusMessage>
      ) : null}
      {error ? (
        <RetryableError
          message={error}
          retrying={loadState !== null}
          onRetry={load}
        />
      ) : null}
      <Card className="er-panel">
        <form
          className="er-organization-filters"
          aria-label="조직 검색 및 필터"
          aria-busy={loadState === "REFRESHING" || undefined}
          onSubmit={search}
        >
          <TextInput
            label="조직 이름 검색"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <label className="er-field">
            <span>조직 상태</span>
            <select
              className="er-control er-control--select"
              value={status}
              onChange={(event) => {
                setStatus(event.currentTarget.value as OrganizationStatus);
              }}
            >
              <option value="ALL">전체</option>
              <option value="ACTIVE">사용 중</option>
              <option value="INACTIVE">사용 중지</option>
            </select>
          </label>
          <label className="er-field">
            <span>대표 조직장 상태</span>
            <select
              className="er-control er-control--select"
              value={leaderStatus}
              onChange={(event) => {
                setLeaderStatus(event.currentTarget.value as LeaderStatus);
              }}
            >
              <option value="ALL">전체</option>
              <option value="ASSIGNED">지정됨</option>
              <option value="UNASSIGNED">미지정</option>
            </select>
          </label>
          <Button type="submit" variant="primary">
            검색
          </Button>
          <label className="er-checkbox">
            <input
              className="er-checkbox__input"
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) =>
                setIncludeDeleted(event.currentTarget.checked)
              }
            />
            <span className="er-checkbox__box" aria-hidden="true" />
            <span>삭제된 조직 보기</span>
          </label>
          {loadState === "REFRESHING" ? (
            <LoadingStatus>검색 중…</LoadingStatus>
          ) : null}
        </form>
      </Card>
      <section
        aria-labelledby="organization-list-title"
        aria-busy={loadState === "REFRESHING" || undefined}
      >
        <h2 id="organization-list-title">조직 목록</h2>
        {loadState === "INITIAL" && !hasLoaded.current ? (
          <div data-testid="organization-grid-skeleton" aria-busy="true">
            <LoadingStatus visuallyHidden>조직 불러오는 중…</LoadingStatus>
            <ul className="er-organization-summary-grid">
              {organizationSkeletonKeys.map((key) => (
                <li key={key}>
                  <Card className="er-organization-summary-card er-organization-summary-card--skeleton">
                    <Skeleton className="er-skeleton--badge" />
                    <Skeleton className="er-skeleton--title" />
                    <Skeleton className="er-skeleton--text" />
                    <Skeleton className="er-skeleton--text er-skeleton--short" />
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ) : organizations.length === 0 && hasLoaded.current ? (
          <Card className="er-panel">
            <p className="er-muted">조건에 맞는 조직이 없습니다.</p>
          </Card>
        ) : (
          <ul className="er-organization-summary-grid">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Card
                  className={`er-organization-summary-card${
                    organization.isDeleted
                      ? " er-organization-summary-card--deleted"
                      : ""
                  }`}
                >
                  <div className="er-organization-summary-heading">
                    <div>
                      <h3>{organization.name}</h3>
                      <span
                        className={`er-badge ${
                          organization.isDeleted
                            ? "er-badge--deleted"
                            : organization.isActive
                              ? "er-badge--active"
                              : "er-badge--inactive"
                        }`}
                      >
                        {organization.isDeleted
                          ? "삭제됨"
                          : organization.isActive
                            ? "사용 중"
                            : "사용 중지"}
                      </span>
                    </div>
                    <a
                      href={`/organizations/${encodeURIComponent(
                        organization.id,
                      )}`}
                      aria-label={`${organization.name} 상세 관리`}
                    >
                      상세 관리
                    </a>
                  </div>
                  <dl className="er-organization-facts">
                    <div>
                      <dt>대표 조직장</dt>
                      <dd>
                        {organization.primaryLeader?.displayName ?? "미지정"}
                      </dd>
                    </div>
                    <div>
                      <dt>담당자</dt>
                      <dd>
                        {getTotalOrganizationManagerCount(organization)}명
                      </dd>
                    </div>
                    <div>
                      <dt>프로젝트</dt>
                      <dd>{organization.projectCount}개</dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showCreate ? (
        <Dialog
          title="새 조직"
          onClose={closeCreateDialog}
          hideDefaultCloseAction
        >
          <form className="er-dialog-form" onSubmit={create}>
            {createError ? (
              <StatusMessage tone="error">{createError}</StatusMessage>
            ) : null}
            {reservedOrganizationId ? (
              <a
                className="er-organization-recovery-link"
                href={`/organizations/${encodeURIComponent(reservedOrganizationId)}`}
              >
                삭제된 조직 복구하기
              </a>
            ) : null}
            <TextInput
              label="조직 이름"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <div className="er-dialog-actions">
              <Button type="button" onClick={closeCreateDialog}>
                닫기
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!name.trim()}
                loading={creating}
                loadingText="조직 만드는 중…"
              >
                조직 만들기
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

function consumeOrganizationNotice(): string | null {
  const state = window.history.state;
  if (
    typeof state !== "object" ||
    state === null ||
    !("organizationNotice" in state) ||
    typeof state.organizationNotice !== "string"
  ) {
    return null;
  }
  const mutableState = { ...state } as Record<string, unknown>;
  const organizationNotice = mutableState.organizationNotice as string;
  delete mutableState.organizationNotice;
  window.history.replaceState(
    Object.keys(mutableState).length > 0 ? mutableState : null,
    "",
    window.location.href,
  );
  return organizationNotice;
}
