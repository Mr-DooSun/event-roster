import { describe, expect, it } from "vitest";

import { calculateOrganizationPopoverPosition } from "./organization-popover-position";

describe("calculateOrganizationPopoverPosition", () => {
  it("places below when the lower viewport has useful space", () => {
    expect(
      calculateOrganizationPopoverPosition({
        anchor: { top: 100, right: 220, bottom: 144, left: 20, width: 200 },
        viewportWidth: 800,
        viewportHeight: 800,
      }),
    ).toEqual({
      top: 148,
      left: 20,
      width: 200,
      maxHeight: 288,
      placement: "bottom",
    });
  });

  it("flips above when the lower viewport is too small", () => {
    expect(
      calculateOrganizationPopoverPosition({
        anchor: { top: 700, right: 220, bottom: 744, left: 20, width: 200 },
        viewportWidth: 800,
        viewportHeight: 800,
      }),
    ).toEqual({
      top: 408,
      left: 20,
      width: 200,
      maxHeight: 288,
      placement: "top",
    });
  });

  it("clamps width and left edge inside a narrow viewport", () => {
    expect(
      calculateOrganizationPopoverPosition({
        anchor: { top: 100, right: 220, bottom: 144, left: -20, width: 240 },
        viewportWidth: 180,
        viewportHeight: 400,
      }),
    ).toMatchObject({ left: 8, width: 164 });
  });

  it("returns finite non-negative dimensions in a tiny viewport", () => {
    const position = calculateOrganizationPopoverPosition({
      anchor: { top: 0, right: 10, bottom: 10, left: -5, width: 40 },
      viewportWidth: 0,
      viewportHeight: 0,
    });

    expect(position.width).toBe(0);
    expect(position.maxHeight).toBe(0);
    expect(position.top).toBe(14);
    expect(Number.isFinite(position.width)).toBe(true);
    expect(Number.isFinite(position.maxHeight)).toBe(true);
  });
});
