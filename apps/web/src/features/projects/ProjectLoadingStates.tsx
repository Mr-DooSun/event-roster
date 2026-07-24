import { LoadingStatus } from "../../components/ui/LoadingStatus";
import { Skeleton } from "../../components/ui/Skeleton";

const skeletonKeys = Array.from(
  { length: 6 },
  (_, index) => `project-skeleton-${index}`,
);

export function ProjectGridSkeleton({
  message = "프로젝트 불러오는 중…",
}: {
  message?: string;
} = {}) {
  return (
    <div
      className="er-project-grid"
      data-testid="project-grid-skeleton"
      aria-busy="true"
    >
      <LoadingStatus visuallyHidden>{message}</LoadingStatus>
      {skeletonKeys.map((key) => (
        <div className="er-project-card er-project-card--skeleton" key={key}>
          <Skeleton className="er-skeleton--badge" />
          <Skeleton className="er-skeleton--title" />
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text er-skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function ProjectHeaderSkeleton({
  message = "프로젝트 불러오는 중…",
}: {
  message?: string;
} = {}) {
  return (
    <header className="er-page-heading" aria-busy="true">
      <LoadingStatus visuallyHidden>{message}</LoadingStatus>
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
  message,
}: {
  kind: "cards" | "list" | "table";
  message: string;
}) {
  if (kind === "cards") return <ProjectGridSkeleton message={message} />;

  if (kind === "list") {
    return (
      <div className="er-list" aria-busy="true">
        <LoadingStatus visuallyHidden>{message}</LoadingStatus>
        {skeletonKeys.map((key) => (
          <div className="er-card" key={key}>
            <Skeleton className="er-skeleton--title" />
            <Skeleton className="er-skeleton--text" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="er-table-skeleton" aria-busy="true">
      <LoadingStatus visuallyHidden>{message}</LoadingStatus>
      <div className="er-table-skeleton__header">
        <Skeleton className="er-skeleton--text" />
        <Skeleton className="er-skeleton--text" />
        <Skeleton className="er-skeleton--text" />
      </div>
      {skeletonKeys.map((key) => (
        <div className="er-table-skeleton__row" key={key}>
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text" />
          <Skeleton className="er-skeleton--text" />
        </div>
      ))}
    </div>
  );
}
