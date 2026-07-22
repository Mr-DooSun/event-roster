import type { Project } from "@event-roster/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { useAuth } from "../auth/AuthProvider";
import { ProjectCard } from "./ProjectCard";
import { ProjectFormDialog } from "./ProjectFormDialog";

type ProjectCreateInput = {
  name: string;
  startDate?: string;
  endDate?: string;
};

export function ProjectsPage() {
  const { api, auth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const operator = auth?.session.user.role === "OPERATOR";
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const nextProjects = await api.get<Project[]>("/projects");
      if (generation !== loadGeneration.current) return;
      setProjects(nextProjects);
      setError(null);
    } catch {
      if (generation === loadGeneration.current) {
        setError("프로젝트 목록을 불러오지 못했습니다.");
      }
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function create(input: ProjectCreateInput) {
    setError(null);
    try {
      await api.post("/projects", input);
      await load();
      setShowCreate(false);
    } catch {
      setError("프로젝트를 만들지 못했습니다.");
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
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <div className="er-project-grid">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
      <ProjectFormDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={create}
      />
    </div>
  );
}
