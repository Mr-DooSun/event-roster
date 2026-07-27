export interface OrganizationPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

export function calculateOrganizationPopoverPosition(input: {
  anchor: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width">;
  viewportWidth: number;
  viewportHeight: number;
  desiredMaxHeight?: number;
  minimumUsefulHeight?: number;
  gap?: number;
  margin?: number;
}): OrganizationPopoverPosition {
  const desiredMaxHeight = input.desiredMaxHeight ?? 288;
  const minimumUsefulHeight = input.minimumUsefulHeight ?? 144;
  const gap = input.gap ?? 4;
  const margin = input.margin ?? 8;
  const availableBelow = Math.max(
    0,
    input.viewportHeight - margin - input.anchor.bottom - gap,
  );
  const availableAbove = Math.max(0, input.anchor.top - margin - gap);
  const placement =
    availableBelow >= minimumUsefulHeight || availableBelow >= availableAbove
      ? "bottom"
      : "top";
  const maxHeight = Math.min(
    desiredMaxHeight,
    placement === "bottom" ? availableBelow : availableAbove,
  );
  const width = Math.min(
    input.anchor.width,
    Math.max(0, input.viewportWidth - margin * 2),
  );
  const left = Math.min(
    Math.max(input.anchor.left, margin),
    input.viewportWidth - margin - width,
  );
  const top =
    placement === "bottom"
      ? input.anchor.bottom + gap
      : Math.max(margin, input.anchor.top - gap - maxHeight);

  return { top, left, width, maxHeight, placement };
}
