import type {
  OrganizationDetail,
  OrganizationProject,
} from "@event-roster/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
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
  const [message, setMessage] = useState<string | null>(null);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );

  const loadDetail = useCallback(async () => {
    try {
      const next = await api.get<OrganizationDetail>(
        `/organizations/${encodeURIComponent(organizationId)}`,
      );
      setOrganization(next);
      setName(next.name);
      setDetailError(null);
    } catch {
      setDetailError("조직 정보를 불러오지 못했습니다.");
    }
  }, [api, organizationId]);

  const loadInitialAudit = useCallback(async () => {
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(`/organizations/${encodeURIComponent(organizationId)}/audit?limit=50`);
      setAudit(page.items);
      setAuditNextCursor(page.nextCursor);
      setAuditError(null);
    } catch {
      setAuditError("변경 이력을 불러오지 못했습니다.");
    }
  }, [api, organizationId]);

  useEffect(() => {
    setOrganization(null);
    setAudit([]);
    setAuditNextCursor(null);
    setDetailError(null);
    setAuditError(null);
    setMessage(null);
    void loadDetail();
    void loadInitialAudit();
  }, [loadDetail, loadInitialAudit]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    await mutateOrganization({ name: name.trim() });
  }

  async function changeStatus() {
    if (!organization) return;
    setShowStatusConfirmation(false);
    await mutateOrganization({ isActive: !organization.isActive });
  }

  async function mutateOrganization(input: {
    name?: string;
    isActive?: boolean;
  }) {
    setMessage(null);
    try {
      await api.patch(`/organizations/${organizationId}`, input);
      await Promise.all([loadDetail(), loadInitialAudit()]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await loadDetail();
        setMessage(
          "다른 관리 변경이 먼저 반영되어 최신 조직 정보를 불러왔습니다.",
        );
      } else {
        setMessage("조직 정보를 변경하지 못했습니다.");
      }
    }
  }

  async function loadMoreAudit() {
    if (!auditNextCursor) return;
    try {
      const page = await api.get<{
        items: AuditView[];
        nextCursor: string | null;
      }>(
        `/organizations/${encodeURIComponent(
          organizationId,
        )}/audit?limit=50&cursor=${encodeURIComponent(auditNextCursor)}`,
      );
      setAudit((current) => [...current, ...page.items]);
      setAuditNextCursor(page.nextCursor);
      setAuditError(null);
    } catch {
      setAuditError("변경 이력을 더 불러오지 못했습니다.");
    }
  }

  if (!organization && !detailError) {
    return <p className="er-muted">조직 불러오는 중…</p>;
  }

  return (
    <div className="er-page-stack">
      <a className="er-text-link" href="/organizations">
        조직 목록으로
      </a>
      {detailError ? (
        <StatusMessage tone="error">{detailError}</StatusMessage>
      ) : null}
      {message ? (
        <StatusMessage tone={message.includes("최신") ? "info" : "error"}>
          {message}
        </StatusMessage>
      ) : null}
      {organization ? (
        <>
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
                disabled={!name.trim() || name.trim() === organization.name}
              >
                이름 저장
              </Button>
            </form>
          </Card>
          <OrganizationManagersPanel
            organization={organization}
            onChanged={loadDetail}
            onTemporaryPassword={setTemporaryPassword}
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
        <StatusMessage tone="error">{auditError}</StatusMessage>
      ) : null}
      <AuditPanel
        items={audit}
        nextCursor={auditNextCursor}
        onLoadMore={loadMoreAudit}
      />
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
            onClick={changeStatus}
          >
            상태 변경 확인
          </Button>
        </Dialog>
      ) : null}
      {temporaryPassword ? (
        <TemporaryPasswordDialog
          value={temporaryPassword}
          onClose={() => setTemporaryPassword(null)}
        />
      ) : null}
    </div>
  );
}
