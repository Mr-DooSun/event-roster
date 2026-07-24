import type { Project } from "@event-roster/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { RetryableError } from "../../components/ui/RetryableError";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { useAuth } from "../auth/AuthProvider";
import { ProjectCard } from "./ProjectCard";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { ProjectGridSkeleton } from "./ProjectLoadingStates";

type ProjectCreateInput = {
  name: string;
  startDate?: string;
  endDate?: string;
};

type ListLoadState = "INITIAL" | "REFRESHING" | null;

export function ProjectsPage() {
  const { api, auth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ListLoadState>("INITIAL");
  const hasLoaded = useRef(false);
  const loadGeneration = useRef(0);
  const operator = auth?.session.user.role === "OPERATOR";
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadState(hasLoaded.current ? "REFRESHING" : "INITIAL");
    try {
      const nextProjects = await api.get<Project[]>("/projects");
      if (generation !== loadGeneration.current) return;
      setProjects(nextProjects);
      hasLoaded.current = true;
      setError(null);
    } catch {
      if (generation === loadGeneration.current) {
        setError("프로젝트 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoadState(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function create(input: ProjectCreateInput) {
    setCreateError(null);
    try {
      await api.post("/projects", input);
      await load();
      setShowCreate(false);
    } catch {
      setCreateError("프로젝트를 만들지 못했습니다.");
    }
  }

  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">PROJECTS</p>
          <h1>프로젝트</h1>
        </div>
        {operator ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => setShowCreate(true)}
          >
            새 프로젝트
          </Button>
        ) : null}
      </header>
      {createError ? (
        <StatusMessage tone="error">{createError}</StatusMessage>
      ) : null}
      {error && !hasLoaded.current ? (
        <RetryableError
          message={error}
          retrying={loadState === "INITIAL"}
          onRetry={load}
        />
      ) : loadState === "INITIAL" && !hasLoaded.current ? (
        <ProjectGridSkeleton />
      ) : (
        <>
          {error ? (
            <RetryableError
              message={error}
              retrying={loadState === "REFRESHING"}
              onRetry={load}
            />
          ) : null}
          {loadState === "REFRESHING" ? (
            <LoadingStatus>새로고침 중…</LoadingStatus>
          ) : null}
          {projects.length === 0 ? (
            <Card className="er-panel">
              <p className="er-muted">등록된 프로젝트가 없습니다.</p>
            </Card>
          ) : (
            <div className="er-project-grid">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </>
      )}
      <ProjectFormDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={create}
      />
    </div>
  );
}
