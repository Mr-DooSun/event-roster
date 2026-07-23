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
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

type OrganizationStatus = "ALL" | "ACTIVE" | "INACTIVE";
type LeaderStatus = "ALL" | "ASSIGNED" | "UNASSIGNED";

export function OrganizationsPage() {
  const { api } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<OrganizationStatus>("ALL");
  const [leaderStatus, setLeaderStatus] = useState<LeaderStatus>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setError(null);
    const search = `query=${encodeURIComponent(
      submittedQuery,
    )}&status=${status}&leaderStatus=${leaderStatus}`;
    try {
      const next = await api.get<OrganizationSummary[]>(
        `/organizations?${search}`,
      );
      if (generation !== loadGeneration.current) return;
      setOrganizations(next);
      setError(null);
    } catch {
      if (generation !== loadGeneration.current) return;
      setError("조직 목록을 불러오지 못했습니다.");
    }
  }, [api, leaderStatus, status, submittedQuery]);

  useEffect(() => void load(), [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    try {
      await api.post("/organizations", { name: name.trim() });
      setName("");
      setShowCreate(false);
      await load();
    } catch (caught) {
      setCreateError(
        caught instanceof ApiError && caught.status === 409
          ? "같은 이름의 조직이 이미 있습니다."
          : "조직을 만들지 못했습니다.",
      );
    }
  }

  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">ADMIN</p>
          <h1>조직 관리</h1>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            setCreateError(null);
            setShowCreate(true);
          }}
        >
          새 조직
        </Button>
      </header>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Card className="er-panel">
        <form
          className="er-organization-filters"
          aria-label="조직 검색 및 필터"
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
        </form>
      </Card>
      <section aria-labelledby="organization-list-title">
        <h2 id="organization-list-title">조직 목록</h2>
        {organizations.length === 0 ? (
          <Card className="er-panel">
            <p className="er-muted">조건에 맞는 조직이 없습니다.</p>
          </Card>
        ) : (
          <ul className="er-organization-summary-grid">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Card className="er-organization-summary-card">
                  <div className="er-organization-summary-heading">
                    <div>
                      <h3>{organization.name}</h3>
                      <span
                        className={`er-badge ${
                          organization.isActive
                            ? "er-badge--active"
                            : "er-badge--inactive"
                        }`}
                      >
                        {organization.isActive ? "사용 중" : "사용 중지"}
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
                        {organization.primaryLeader?.displayName ??
                          "대표 조직장 미지정"}
                      </dd>
                    </div>
                    <div>
                      <dt>담당자</dt>
                      <dd>추가 관리자 {organization.managerCount}명</dd>
                    </div>
                    <div>
                      <dt>프로젝트</dt>
                      <dd>연결 프로젝트 {organization.projectCount}개</dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showCreate ? (
        <Dialog title="새 조직" onClose={() => setShowCreate(false)}>
          <form className="er-form-grid" onSubmit={create}>
            {createError ? (
              <StatusMessage tone="error">{createError}</StatusMessage>
            ) : null}
            <TextInput
              label="조직 이름"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              조직 만들기
            </Button>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
