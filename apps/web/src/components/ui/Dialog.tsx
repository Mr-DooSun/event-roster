import type { ReactNode } from "react";
import { Button } from "./Button";

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="er-dialog-backdrop" role="presentation">
      <section
        className="er-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        {children}
        <Button type="button" onClick={onClose}>
          닫기
        </Button>
      </section>
    </div>
  );
}
