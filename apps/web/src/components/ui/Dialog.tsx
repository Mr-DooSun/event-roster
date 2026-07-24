import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { Button } from "./Button";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({
  title,
  children,
  closeLabel = "닫기",
  hideDefaultCloseAction = false,
  size = "default",
  onClose,
}: {
  title: string;
  children: ReactNode;
  closeLabel?: string;
  hideDefaultCloseAction?: boolean;
  size?: "default" | "wide";
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const openingElementRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const openingElement = openingElementRef.current;
    const focusable = getFocusableElements(dialog);
    (focusable[0] ?? dialog).focus();

    return () => {
      if (openingElement && isEligibleFocusTarget(openingElement)) {
        openingElement.focus();
        if (document.activeElement === openingElement) return;
      }
      for (const fallback of document.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      )) {
        if (dialog.contains(fallback) || !isEligibleFocusTarget(fallback)) {
          continue;
        }
        fallback.focus();
        if (document.activeElement === fallback) return;
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="er-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className={`er-dialog${size === "wide" ? " er-dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2>{title}</h2>
        {children}
        {hideDefaultCloseAction ? null : (
          <Button type="button" onClick={onClose}>
            {closeLabel}
          </Button>
        )}
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isEligibleFocusTarget);
}

function isEligibleFocusTarget(element: HTMLElement) {
  return (
    element.isConnected &&
    element.matches(FOCUSABLE_SELECTOR) &&
    element.closest('[hidden], [aria-hidden="true"], [inert]') === null
  );
}
