import type { Project, ProjectStatus } from "@event-roster/contracts";

export interface ProjectCardProps {
  project: Project;
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  PREPARING: "준비 중",
  PRE_REGISTRATION: "사전 등록",
  IN_PROGRESS: "진행 중",
  CLOSED: "종료",
};

export function ProjectCard({ project }: ProjectCardProps) {
  const closedClass =
    project.status === "CLOSED" ? " er-project-card--closed" : "";
  return (
    <a
      className={`er-card er-project-card${closedClass}`}
      href={`/projects/${encodeURIComponent(project.id)}`}
    >
      <span className={`er-badge er-badge--${project.status.toLowerCase()}`}>
        {STATUS_LABEL[project.status]}
      </span>
      <h2>{project.name}</h2>
      <span className="er-project-card__dates">
        <span>
          {project.startDate
            ? `시작 ${formatDate(project.startDate)}`
            : "시작 미정"}
        </span>
        <span>
          {project.endDate
            ? `종료 ${formatDate(project.endDate)}`
            : "종료 수동"}
        </span>
      </span>
      <time dateTime={project.createdAt}>
        생성 {formatKstDate(project.createdAt)}
      </time>
    </a>
  );
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKstDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}.${part("month")}.${part("day")}`;
}
