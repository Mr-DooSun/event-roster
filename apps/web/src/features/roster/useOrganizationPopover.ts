import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { calculateOrganizationPopoverPosition } from "./organization-popover-position";

type AnchorGeometry = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width"
>;

const DEFAULT_FALLBACK_WIDTH = 320;

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
  const lastValidAnchorRef = useRef<AnchorGeometry | null>(null);
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
        const measuredAnchor = anchor.getBoundingClientRect();
        const anchorGeometry: AnchorGeometry = {
          top: measuredAnchor.top,
          right: measuredAnchor.right,
          bottom: measuredAnchor.bottom,
          left: measuredAnchor.left,
          width: measuredAnchor.width,
        };
        const position = calculateOrganizationPopoverPosition({
          anchor: anchorGeometry,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        lastValidAnchorRef.current = anchorGeometry;
        setPlacement(position.placement);
        setPopoverStyle({
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
          transform:
            position.placement === "top" ? "translateY(-100%)" : undefined,
        });
      } catch {
        const fallbackAnchor =
          lastValidAnchorRef.current ?? visibleFallbackAnchor(anchor);
        const fallback = calculateOrganizationPopoverPosition({
          anchor: fallbackAnchor,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        setPlacement(fallback.placement);
        setPopoverStyle({
          position: "fixed",
          top: fallback.top,
          left: fallback.left,
          width: fallback.width,
          maxHeight: fallback.maxHeight,
          transform:
            fallback.placement === "top" ? "translateY(-100%)" : undefined,
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

function visibleFallbackAnchor(anchor: HTMLInputElement): AnchorGeometry {
  let width = DEFAULT_FALLBACK_WIDTH;
  try {
    const layoutWidth = anchor.clientWidth || anchor.offsetWidth;
    if (Number.isFinite(layoutWidth) && layoutWidth > 0) {
      width = layoutWidth;
    }
  } catch {
    // The bounded default keeps the listbox usable when layout access fails.
  }

  return { top: 0, right: width, bottom: 0, left: 0, width };
}
