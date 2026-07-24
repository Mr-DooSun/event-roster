import type { ReactNode } from "react";

export function LoadingStatus({
  children,
  visuallyHidden = false,
  className = "",
}: {
  children: ReactNode;
  visuallyHidden?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`er-loading-status ${
        visuallyHidden ? "er-visually-hidden" : ""
      } ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="er-spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
