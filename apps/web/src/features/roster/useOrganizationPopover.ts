import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { calculateOrganizationPopoverPosition } from "./organization-popover-position";

export function useOrganizationPopover(input: {
  open: boolean;
  anchorRef: RefObject<HTMLInputElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onRequestClose(): void;
}): {
  listboxRef: RefObject<HTMLDivElement | null>;
  popoverStyle: CSSProperties | null;
  placement: "top" | "bottom";
} {
  const listboxRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");

  useEffect(() => {
    if (!input.open || typeof window === "undefined") {
      setPopoverStyle(null);
      return;
    }

    let animationFrame: number | null = null;

    function applyPosition() {
      const anchor = input.anchorRef.current;
      if (!anchor?.isConnected) {
        input.onRequestClose();
        return;
      }

      try {
        const position = calculateOrganizationPopoverPosition({
          anchor: anchor.getBoundingClientRect(),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        setPlacement(position.placement);
        setPopoverStyle({
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
        });
      } catch {
        const fallback = calculateOrganizationPopoverPosition({
          anchor: { top: 0, right: 0, bottom: 0, left: 0, width: 0 },
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        setPlacement("bottom");
        setPopoverStyle({
          position: "fixed",
          top: fallback.top,
          left: fallback.left,
          width: fallback.width,
          maxHeight: fallback.maxHeight,
        });
      }
    }

    function schedulePositionUpdate() {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        applyPosition();
      });
    }

    function closeForOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        (input.containerRef.current?.contains(target) ||
          listboxRef.current?.contains(target))
      ) {
        return;
      }
      input.onRequestClose();
    }

    applyPosition();
    window.addEventListener("resize", applyPosition);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    document.addEventListener("pointerdown", closeForOutsidePointer, true);

    return () => {
      window.removeEventListener("resize", applyPosition);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      document.removeEventListener("pointerdown", closeForOutsidePointer, true);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [input.anchorRef, input.containerRef, input.onRequestClose, input.open]);

  return { listboxRef, popoverStyle, placement };
}
