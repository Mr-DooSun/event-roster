import type { NormalizedImportRow } from "@event-roster/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const workflowGeneration = useRef(0);
  const requestInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const headers = useMemo(
    () => (parsed && sheetName ? getSheetHeaders(parsed, sheetName) : []),
    [parsed, sheetName],
  );
  useEffect(
    () => () => {
      workflowGeneration.current += 1;
    },
    [],
  );
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
    try {
      const next = await readWorkbook(file);
      if (generation !== workflowGeneration.current) return;
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
      setMessage("엑셀 파일을 읽지 못했습니다.");
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
    requestInFlight.current = true;
    setBusy(true);
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
    } catch {
      if (generation === workflowGeneration.current) {
        setMessage("명단을 검증하지 못했습니다.");
      }
    } finally {
      requestInFlight.current = false;
      setBusy(false);
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
    requestInFlight.current = true;
    setBusy(true);
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
      } else {
        setMessage("명단을 확정하지 못했습니다.");
      }
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function clearWorkbook() {
    workflowGeneration.current += 1;
    setParsed(null);
    setSheetName("");
    setColumns({ name: "", organization: "" });
    setNormalizedRows([]);
    setValidation(null);
    setResolutionDirty(false);
    setMessage(null);
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
        {busy ? (
          <span className="er-button er-button--secondary" aria-disabled="true">
            처리 중…
          </span>
        ) : (
          <a
            className="er-button er-button--secondary"
            href={`/projects/${projectId}`}
          >
            명단으로 돌아가기
          </a>
        )}
      </header>
      {message ? <StatusMessage tone="info">{message}</StatusMessage> : null}
      <Card className="er-panel">
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
      </Card>
      {parsed ? (
        <Card className="er-panel er-page-stack">
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
              disabled={busy}
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
        <Card className="er-panel er-page-stack">
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
            disabled={!canCommit || busy}
            onClick={() => void commit()}
          >
            명단 확정
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
