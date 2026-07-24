import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  loadingText?: string;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  className = "",
  loading = false,
  loadingText = "처리 중…",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`er-button er-button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
      aria-busy={loading || props["aria-busy"] || undefined}
    >
      {loading ? (
        <>
          <span className="er-spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
