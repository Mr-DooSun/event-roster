import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { Skeleton } from "../../components/ui/Skeleton";

export function ProjectGridSkeleton() {
  return (
    <div
      className="er-project-grid"
      data-testid="project-grid-skeleton"
      aria-busy="true"
    >
      <LoadingStatus visuallyHidden>프로젝트 불러오는 중…</LoadingStatus>
      {Array.from({ length: 6 }, (_, index) => (
        <div className="er-project-card er-project-card--skeleton" key={index}>
          <Skeleton className="er-skeleton--badge" />
          <Skeleton className="er-skeleton--title" />
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text er-skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function ProjectHeaderSkeleton() {
  return (
    <header className="er-page-heading" aria-busy="true">
      <div>
        <Skeleton className="er-skeleton--badge" />
        <Skeleton className="er-skeleton--title" />
      </div>
      <Skeleton className="er-skeleton--button" />
    </header>
  );
}

export function ProjectTabSkeleton({
  kind,
}: {
  kind: "cards" | "list" | "table";
}) {
  if (kind === "cards") return <ProjectGridSkeleton />;

  if (kind === "list") {
    return (
      <div className="er-list" aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="er-card" key={index}>
            <Skeleton className="er-skeleton--title" />
            <Skeleton className="er-skeleton--text" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="er-table-skeleton" aria-busy="true">
      <div className="er-table-skeleton__header">
        <Skeleton className="er-skeleton--text" />
        <Skeleton className="er-skeleton--text" />
        <Skeleton className="er-skeleton--text" />
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div className="er-table-skeleton__row" key={index}>
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text" />
        </div>
      ))}
    </div>
  );
}
