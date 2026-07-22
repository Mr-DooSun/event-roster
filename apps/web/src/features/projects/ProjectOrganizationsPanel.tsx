import type {
  Organization,
  ProjectOrganization,
} from "@event-roster/contracts";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

export interface ProjectOrganizationsPanelProps {
  projectId: string;
  memberships: ProjectOrganization[];
  allOrganizations: Organization[];
  canAdminister: boolean;
  onChanged(): Promise<void>;
  onProjectClosed?(): Promise<void>;
}

interface RenameConfirmation {
  membership: ProjectOrganization;
  name: string;
}

const EXISTING_ORGANIZATIONS_ID = "existing-organizations";

export function ProjectOrganizationsPanel({
  projectId,
  memberships,
  allOrganizations,
  canAdminister,
  onChanged,
  onProjectClosed,
}: ProjectOrganizationsPanelProps) {
  const { api } = useAuth();
  const availableOrganizations = useMemo(() => {
    const linked = new Set(
      memberships.map((membership) => membership.organizationId),
    );
    return allOrganizations.filter(
      (organization) => organization.isActive && !linked.has(organization.id),
    );
  }, [allOrganizations, memberships]);
  const [existingQuery, setExistingQuery] = useState("");
  const [existingId, setExistingId] = useState("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renameConfirmation, setRenameConfirmation] =
    useState<RenameConfirmation | null>(null);
  const [globalDeactivation, setGlobalDeactivation] =
    useState<ProjectOrganization | null>(null);
  const matchingOrganizations = useMemo(() => {
    const query = existingQuery.trim().toLocaleLowerCase();
    return availableOrganizations.filter(
      (organization) =>
        !query || organization.name.toLocaleLowerCase().includes(query),
    );
  }, [availableOrganizations, existingQuery]);

  useEffect(() => {
    if (availableOrganizations.some((item) => item.id === existingId)) return;
    setExistingId("");
  }, [availableOrganizations, existingId]);

  useEffect(() => {
    if (!canAdminister) {
      setRenameConfirmation(null);
      setGlobalDeactivation(null);
    }
  }, [canAdminister]);

  async function mutate(operation: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      await onChanged();
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED" &&
        onProjectClosed
      ) {
        setRenameConfirmation(null);
        setGlobalDeactivation(null);
        await onProjectClosed();
        return false;
      }
      setMessage("조직 변경을 반영하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addExisting(event: FormEvent) {
    event.preventDefault();
    if (!existingId) return;
    await mutate(() =>
      api.post(`/projects/${projectId}/organizations`, {
        organizationId: existingId,
      }),
    );
  }

  function selectExistingOrganization(organization: Organization) {
    setExistingId(organization.id);
    setExistingQuery(organization.name);
    setComboboxOpen(false);
    setActiveOptionIndex(-1);
  }

  function existingOrganizationOptionId(index: number) {
    return `${projectId}-existing-organization-${index}`;
  }

  async function addNew(event: FormEvent) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const completed = await mutate(() =>
      api.post(`/projects/${projectId}/organizations`, {
        newOrganizationName: trimmed,
      }),
    );
    if (completed) setNewName("");
  }

  async function setActive(membership: ProjectOrganization, active: boolean) {
    await mutate(() =>
      active
        ? api.post(`/projects/${projectId}/organizations`, {
            organizationId: membership.organizationId,
          })
        : api.patch(
            `/projects/${projectId}/organizations/${membership.organizationId}`,
            { isActive: false },
          ),
    );
  }

  async function confirmRename() {
    if (!renameConfirmation) return;
    const { membership, name } = renameConfirmation;
    const completed = await mutate(() =>
      api.patch(`/organizations/${membership.organizationId}`, { name }),
    );
    if (completed) setRenameConfirmation(null);
  }

  async function confirmGlobalDeactivation() {
    if (!globalDeactivation) return;
    const completed = await mutate(() =>
      api.patch(`/organizations/${globalDeactivation.organizationId}`, {
        isActive: false,
      }),
    );
    if (completed) setGlobalDeactivation(null);
  }

  return (
    <div className="er-page-stack">
      {message ? <StatusMessage tone="error">{message}</StatusMessage> : null}
      {canAdminister ? (
        <div className="er-project-organization-forms">
          <Card className="er-panel">
            <h2>기존 조직 연결</h2>
            <form className="er-inline-form" onSubmit={addExisting}>
              <label className="er-field">
                <span>기존 조직 검색</span>
                <input
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={
                    comboboxOpen && matchingOrganizations.length > 0
                  }
                  aria-controls={EXISTING_ORGANIZATIONS_ID}
                  aria-activedescendant={
                    comboboxOpen && matchingOrganizations[activeOptionIndex]
                      ? existingOrganizationOptionId(activeOptionIndex)
                      : undefined
                  }
                  value={existingQuery}
                  onFocus={() => {
                    setComboboxOpen(true);
                    setActiveOptionIndex(-1);
                  }}
                  onChange={(event) => {
                    const query = event.currentTarget.value;
                    setExistingQuery(query);
                    setExistingId("");
                    setComboboxOpen(true);
                    setActiveOptionIndex(-1);
                    const normalized = query.trim().toLocaleLowerCase();
                    if (
                      normalized &&
                      !availableOrganizations.some((organization) =>
                        organization.name
                          .toLocaleLowerCase()
                          .includes(normalized),
                      )
                    ) {
                      setNewName(query);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setComboboxOpen(false);
                      setActiveOptionIndex(-1);
                      return;
                    }
                    if (
                      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                      matchingOrganizations.length > 0
                    ) {
                      event.preventDefault();
                      setComboboxOpen(true);
                      setActiveOptionIndex((current) => {
                        if (event.key === "ArrowDown") {
                          return current >= matchingOrganizations.length - 1
                            ? 0
                            : current + 1;
                        }
                        return current <= 0
                          ? matchingOrganizations.length - 1
                          : current - 1;
                      });
                      return;
                    }
                    if (event.key === "Enter" && matchingOrganizations[0]) {
                      event.preventDefault();
                      selectExistingOrganization(
                        matchingOrganizations[activeOptionIndex] ??
                          matchingOrganizations[0],
                      );
                    }
                  }}
                />
              </label>
              {comboboxOpen ? (
                matchingOrganizations.length > 0 ? (
                  <div id={EXISTING_ORGANIZATIONS_ID} role="listbox">
                    {matchingOrganizations.map((organization, index) => (
                      <button
                        key={organization.id}
                        id={existingOrganizationOptionId(index)}
                        type="button"
                        role="option"
                        aria-selected={activeOptionIndex === index}
                        className="er-button er-button--secondary"
                        onClick={() => selectExistingOrganization(organization)}
                      >
                        {organization.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="er-muted">
                    검색 결과가 없습니다. 아래에서 새 조직을 추가하세요.
                  </p>
                )
              ) : null}
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !existingId}
              >
                프로젝트에 추가
              </Button>
            </form>
          </Card>
          <Card className="er-panel">
            <h2>새 조직 연결</h2>
            <form className="er-inline-form" onSubmit={addNew}>
              <TextInput
                label="새 조직 이름"
                required
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !newName.trim()}
              >
                새 조직 추가
              </Button>
            </form>
          </Card>
        </div>
      ) : null}
      <Card className="er-panel">
        <h2>프로젝트 조직</h2>
        {memberships.length === 0 ? (
          <p className="er-muted">연결된 조직이 없습니다.</p>
        ) : (
          <ul className="er-list">
            {memberships.map((membership) => (
              <OrganizationMembershipRow
                key={membership.organizationId}
                membership={membership}
                canAdminister={canAdminister}
                busy={busy}
                onRename={(name) => setRenameConfirmation({ membership, name })}
                onGlobalDeactivate={() => setGlobalDeactivation(membership)}
                onSetActive={(active) => setActive(membership, active)}
              />
            ))}
          </ul>
        )}
      </Card>
      {canAdminister && renameConfirmation ? (
        <Dialog
          title="조직 이름 변경"
          onClose={() => setRenameConfirmation(null)}
        >
          <p>
            이 변경은 현재 {renameConfirmation.membership.activeProjectCount}개
            활성 프로젝트에 반영됩니다.
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void confirmRename()}
          >
            변경 확인
          </Button>
        </Dialog>
      ) : null}
      {canAdminister && globalDeactivation ? (
        <Dialog
          title="조직 전체 사용 중지"
          onClose={() => setGlobalDeactivation(null)}
        >
          <p>
            현재 연결된 활성 프로젝트 {globalDeactivation.activeProjectCount}
            개를 포함해, 이 조직은 전체 프로젝트에서 신규 연결과 신규 참가자
            선택이 차단됩니다. 계속하시겠습니까?
          </p>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() => void confirmGlobalDeactivation()}
          >
            전체 사용 중지 확인
          </Button>
        </Dialog>
      ) : null}
    </div>
  );
}

function OrganizationMembershipRow({
  membership,
  canAdminister,
  busy,
  onRename,
  onGlobalDeactivate,
  onSetActive,
}: {
  membership: ProjectOrganization;
  canAdminister: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onGlobalDeactivate: () => void;
  onSetActive: (active: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(membership.name);

  useEffect(() => setName(membership.name), [membership.name]);

  return (
    <li>
      <div className="er-organization-membership">
        {canAdminister ? (
          <input
            className="er-control er-control--inline"
            aria-label={`${membership.name} 조직 이름`}
            value={name}
            disabled={!membership.masterIsActive}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        ) : (
          <strong>{membership.name}</strong>
        )}
        <span className="er-muted">
          {membership.isActive && membership.masterIsActive
            ? "사용 중"
            : "사용 중지"}
          {!membership.masterIsActive ? " · 전역 비활성" : ""}
        </span>
      </div>
      {canAdminister ? (
        <div className="er-action-row">
          <Button
            type="button"
            disabled={
              busy ||
              !membership.masterIsActive ||
              !name.trim() ||
              name.trim() === membership.name
            }
            onClick={() => onRename(name.trim())}
          >
            이름 저장
          </Button>
          {membership.masterIsActive ? (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={onGlobalDeactivate}
            >
              전체 사용 중지
            </Button>
          ) : null}
          <Button
            type="button"
            variant={membership.isActive ? "danger" : "secondary"}
            disabled={
              busy || (!membership.isActive && !membership.masterIsActive)
            }
            onClick={() => void onSetActive(!membership.isActive)}
          >
            {membership.isActive ? "사용 중지" : "다시 사용"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
