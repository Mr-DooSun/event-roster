import type {
  NormalizedImportRow,
  ProjectOrganization,
} from "@event-roster/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { RetryableError } from "../../components/ui/RetryableError";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { ApiError } from "../../lib/api";
import {
  getSheetHeaders,
  normalizeSheet,
  type ParsedWorkbook,
  readWorkbook,
} from "../../lib/excel/read-workbook";
import { useAuth } from "../auth/AuthProvider";
import { ColumnMapping } from "./ColumnMapping";
import { type ValidatedImportRow, ValidationTable } from "./ValidationTable";

interface ValidationResult {
  projectRevision: number;
  rows: ValidatedImportRow[];
}

interface ImportRequestOwner {
  projectId: string;
  generation: number;
}

type ImportBusyAction = "READ_FILE" | "VALIDATE" | "COMMIT" | null;

export function ImportWizard({ projectId }: { projectId: string }) {
  const { api } = useAuth();
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [columns, setColumns] = useState({ name: "", organization: "" });
  const [normalizedRows, setNormalizedRows] = useState<NormalizedImportRow[]>(
    [],
  );
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [resolutionDirty, setResolutionDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [projectClosed, setProjectClosed] = useState(false);
  const [activeOrganizations, setActiveOrganizations] = useState<
    ProjectOrganization[]
  >([]);
  const [organizationError, setOrganizationError] = useState<string | null>(
    null,
  );
  const [organizationLoading, setOrganizationLoading] = useState(true);
  const organizationGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const workflowGeneration = useRef(0);
  const currentProjectId = useRef(projectId);
  currentProjectId.current = projectId;
  const requestInFlight = useRef(false);
  const requestOwner = useRef<ImportRequestOwner | null>(null);
  const [busyAction, setBusyAction] = useState<ImportBusyAction>(null);
  const busy = busyAction !== null;
  const headers = useMemo(
    () => (parsed && sheetName ? getSheetHeaders(parsed, sheetName) : []),
    [parsed, sheetName],
  );
  useEffect(
    () => () => {
      workflowGeneration.current += 1;
      requestOwner.current = null;
      requestInFlight.current = false;
    },
    [],
  );
  useEffect(() => {
    currentProjectId.current = projectId;
    workflowGeneration.current += 1;
    requestOwner.current = null;
    requestInFlight.current = false;
    setBusyAction(null);
    setParsed(null);
    setSheetName("");
    setColumns({ name: "", organization: "" });
    setNormalizedRows([]);
    setValidation(null);
    setResolutionDirty(false);
    setMessage(null);
    setProjectClosed(false);
    if (fileInput.current) fileInput.current.value = "";
  }, [projectId]);
  const loadOrganizations = useCallback(async () => {
    const generation = organizationGeneration.current + 1;
    organizationGeneration.current = generation;
    const requestedProjectId = projectId;
    setOrganizationLoading(true);
    setOrganizationError(null);
    try {
      const memberships = await api.get<ProjectOrganization[]>(
        `/projects/${projectId}/organizations`,
      );
      if (
        generation !== organizationGeneration.current ||
        requestedProjectId !== currentProjectId.current
      )
        return;
      setActiveOrganizations(
        memberships.filter(
          (membership) => membership.isActive && membership.masterIsActive,
        ),
      );
    } catch {
      if (
        generation === organizationGeneration.current &&
        requestedProjectId === currentProjectId.current
      ) {
        setOrganizationError("프로젝트 조직을 불러오지 못했습니다.");
      }
    } finally {
      if (
        generation === organizationGeneration.current &&
        requestedProjectId === currentProjectId.current
      ) {
        setOrganizationLoading(false);
      }
    }
  }, [api, projectId]);
  useEffect(() => {
    setActiveOrganizations([]);
    setOrganizationError(null);
    void loadOrganizations();
    return () => {
      organizationGeneration.current += 1;
    };
  }, [loadOrganizations]);
  useEffect(() => {
    if (!busy) return;
    const preventExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventExit);
    return () => window.removeEventListener("beforeunload", preventExit);
  }, [busy]);

  async function chooseFile(file: File | undefined) {
    clearWorkbook();
    if (!file) return;
    const generation = workflowGeneration.current;
    const requestedProjectId = projectId;
    setBusyAction("READ_FILE");
    try {
      const next = await readWorkbook(file);
      if (
        generation !== workflowGeneration.current ||
        requestedProjectId !== currentProjectId.current
      )
        return;
      const firstSheet = next.sheetNames[0] ?? "";
      const nextHeaders = firstSheet ? getSheetHeaders(next, firstSheet) : [];
      setParsed(next);
      setSheetName(firstSheet);
      setColumns({
        name: nextHeaders.includes("이름") ? "이름" : (nextHeaders[0] ?? ""),
        organization: nextHeaders.includes("조직")
          ? "조직"
          : (nextHeaders[1] ?? nextHeaders[0] ?? ""),
      });
    } catch {
      if (
        generation !== workflowGeneration.current ||
        requestedProjectId !== currentProjectId.current
      )
        return;
      setMessage("엑셀 파일을 읽지 못했습니다.");
    } finally {
      if (
        generation === workflowGeneration.current &&
        requestedProjectId === currentProjectId.current
      ) {
        setBusyAction(null);
      }
    }
  }

  function changeSheet(nextSheet: string) {
    workflowGeneration.current += 1;
    const nextHeaders = parsed ? getSheetHeaders(parsed, nextSheet) : [];
    setSheetName(nextSheet);
    setColumns({
      name: nextHeaders.includes("이름") ? "이름" : (nextHeaders[0] ?? ""),
      organization: nextHeaders.includes("조직")
        ? "조직"
        : (nextHeaders[1] ?? nextHeaders[0] ?? ""),
    });
    setNormalizedRows([]);
    setValidation(null);
    setResolutionDirty(false);
  }

  async function validate() {
    if (!parsed || requestInFlight.current) return;
    const rows = normalizeSheet(parsed, sheetName, columns).map((row) => {
      const selected = normalizedRows.find(
        (current) => current.rowNumber === row.rowNumber,
      )?.resolvedParticipantId;
      return selected ? { ...row, resolvedParticipantId: selected } : row;
    });
    if (rows.length === 0 || rows.length > 130) {
      setMessage("가져올 행은 1개 이상 130개 이하여야 합니다.");
      return;
    }
    const generation = workflowGeneration.current;
    const owner = { projectId, generation };
    requestOwner.current = owner;
    requestInFlight.current = true;
    setBusyAction("VALIDATE");
    try {
      const result = await api.post<ValidationResult>(
        `/projects/${projectId}/imports/validate`,
        rows,
      );
      if (generation !== workflowGeneration.current) return;
      setNormalizedRows(rows);
      setValidation(result);
      setResolutionDirty(false);
      setMessage("검증 완료");
    } catch (error) {
      if (generation === workflowGeneration.current) {
        if (
          error instanceof ApiError &&
          error.problem?.code === "PROJECT_CLOSED"
        ) {
          discardClosedProject();
          return;
        }
        setMessage("명단을 검증하지 못했습니다.");
      }
    } finally {
      releaseRequest(owner);
    }
  }

  function resolveCandidate(rowNumber: number, participantId: string) {
    workflowGeneration.current += 1;
    setNormalizedRows((current) =>
      current.map((row) => {
        if (row.rowNumber !== rowNumber) return row;
        const { resolvedParticipantId: _selected, ...unresolved } = row;
        return participantId
          ? { ...unresolved, resolvedParticipantId: participantId }
          : unresolved;
      }),
    );
    setResolutionDirty(true);
    setMessage("동명이인 선택을 다시 검증해 주세요.");
  }

  async function commit() {
    if (!validation || resolutionDirty || requestInFlight.current) return;
    const generation = workflowGeneration.current;
    const owner = { projectId, generation };
    requestOwner.current = owner;
    requestInFlight.current = true;
    setBusyAction("COMMIT");
    try {
      const result = await api.post<{ importedCount: number }>(
        `/projects/${projectId}/imports/commit`,
        {
          rows: normalizedRows,
          expectedProjectRevision: validation.projectRevision,
        },
      );
      if (generation !== workflowGeneration.current) return;
      clearWorkbook();
      setMessage(`${result.importedCount}개 행을 확정했습니다.`);
    } catch (error) {
      if (generation !== workflowGeneration.current) return;
      if (
        error instanceof ApiError &&
        error.problem?.code === "STALE_REVISION"
      ) {
        setValidation(null);
        setMessage("다른 변경이 먼저 반영되었습니다. 다시 검증해 주세요.");
      } else if (
        error instanceof ApiError &&
        error.problem?.code === "PROJECT_CLOSED"
      ) {
        discardClosedProject();
      } else {
        setMessage("명단을 확정하지 못했습니다.");
      }
    } finally {
      releaseRequest(owner);
    }
  }

  function releaseRequest(owner: ImportRequestOwner) {
    if (requestOwner.current !== owner) return;
    requestOwner.current = null;
    requestInFlight.current = false;
    setBusyAction(null);
  }

  function clearWorkbook() {
    workflowGeneration.current += 1;
    requestOwner.current = null;
    requestInFlight.current = false;
    setBusyAction(null);
    setParsed(null);
    setSheetName("");
    setColumns({ name: "", organization: "" });
    setNormalizedRows([]);
    setValidation(null);
    setResolutionDirty(false);
    setMessage(null);
    setProjectClosed(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function discardClosedProject() {
    workflowGeneration.current += 1;
    requestOwner.current = null;
    requestInFlight.current = false;
    setBusyAction(null);
    setParsed(null);
    setSheetName("");
    setColumns({ name: "", organization: "" });
    setNormalizedRows([]);
    setValidation(null);
    setResolutionDirty(false);
    setProjectClosed(true);
    setMessage(
      "프로젝트가 종료되어 가져오기를 진행할 수 없습니다. 최신 프로젝트 정보를 확인해 주세요.",
    );
    if (fileInput.current) fileInput.current.value = "";
  }

  const canCommit =
    validation !== null &&
    !resolutionDirty &&
    validation.rows.every((row) => row.issues.length === 0);
  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">EXCEL IMPORT</p>
          <h1>엑셀 명단 가져오기</h1>
          <p className="er-muted">
            원본 파일은 브라우저에서만 읽고 서버에 보관하지 않습니다.
          </p>
        </div>
        <a
          className="er-button er-button--secondary"
          href={`/projects/${projectId}`}
        >
          명단으로 돌아가기
        </a>
      </header>
      {message ? (
        <StatusMessage tone={projectClosed ? "error" : "info"}>
          {message}
        </StatusMessage>
      ) : null}
      {projectClosed ? (
        <a
          className="er-button er-button--primary"
          href={`/projects/${projectId}`}
        >
          최신 프로젝트 보기
        </a>
      ) : null}
      <Card className="er-panel" aria-busy={organizationLoading || undefined}>
        <h2>가져오기 대상 조직</h2>
        {organizationLoading ? (
          <div aria-busy="true">
            <LoadingStatus>프로젝트 조직 불러오는 중…</LoadingStatus>
          </div>
        ) : organizationError ? (
          <RetryableError
            message={organizationError}
            onRetry={loadOrganizations}
            retrying={organizationLoading}
          />
        ) : (
          <>
            <p className="er-muted">활성 조직 {activeOrganizations.length}개</p>
            <ul className="er-compact-list">
              {activeOrganizations.map((organization) => (
                <li key={organization.organizationId}>{organization.name}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card
        className="er-panel"
        aria-busy={busyAction === "READ_FILE" || undefined}
      >
        <label className="er-field">
          <span>엑셀 파일</span>
          <input
            ref={fileInput}
            type="file"
            disabled={busy}
            accept=".xlsx,.xls,.csv"
            onChange={(event) =>
              void chooseFile(event.currentTarget.files?.[0])
            }
          />
        </label>
        {busyAction === "READ_FILE" ? (
          <LoadingStatus>파일 읽는 중…</LoadingStatus>
        ) : null}
      </Card>
      {parsed ? (
        <Card
          className="er-panel er-page-stack"
          aria-busy={busyAction === "VALIDATE" || undefined}
        >
          <label className="er-field">
            <span>시트</span>
            <select
              disabled={busy}
              value={sheetName}
              onChange={(event) => changeSheet(event.currentTarget.value)}
            >
              {parsed.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <ColumnMapping
            headers={headers}
            nameColumn={columns.name}
            organizationColumn={columns.organization}
            disabled={busy}
            onChange={(next) => {
              workflowGeneration.current += 1;
              setColumns(next);
              setNormalizedRows([]);
              setValidation(null);
              setResolutionDirty(false);
            }}
          />
          <div className="er-action-row">
            <Button
              type="button"
              variant="primary"
              loading={busyAction === "VALIDATE"}
              loadingText="검증 중…"
              disabled={busyAction === "COMMIT"}
              onClick={() => void validate()}
            >
              {resolutionDirty ? "다시 검증" : "서버 검증"}
            </Button>
            <Button type="button" disabled={busy} onClick={clearWorkbook}>
              취소
            </Button>
          </div>
        </Card>
      ) : null}
      {validation ? (
        <Card
          className="er-panel er-page-stack"
          aria-busy={busyAction === "COMMIT" || undefined}
        >
          <h2>검증 결과</h2>
          <ValidationTable
            rows={validation.rows}
            normalizedRows={normalizedRows}
            disabled={busy}
            onResolve={resolveCandidate}
          />
          <Button
            type="button"
            variant="primary"
            loading={busyAction === "COMMIT"}
            loadingText="가져오는 중…"
            disabled={!canCommit || busyAction === "VALIDATE"}
            onClick={() => void commit()}
          >
            명단 확정
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
