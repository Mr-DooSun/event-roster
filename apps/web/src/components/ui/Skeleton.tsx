export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span className={`er-skeleton ${className}`.trim()} aria-hidden="true" />
  );
}
