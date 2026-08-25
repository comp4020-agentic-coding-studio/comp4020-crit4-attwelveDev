import { describe, expect, it } from "vitest";
import { fieldPointFromLandmark, nearFrameEdge } from "./hands";

// The coordinate mapping is the one part of hand tracking a headless browser
// cannot exercise: Chrome's fake camera emits a test pattern, so no hand is
// ever detected and the mapping never runs there. Both of its inversions are
// the kind of mistake that reads fine and is instantly confusing in the hand,
// so they are pinned here instead.

describe("fieldPointFromLandmark", () => {
  it("mirrors x, because the camera sees the player reversed", () => {
    // A hand on the camera's left is on the player's right.
    const cameraLeft = fieldPointFromLandmark({ x: 0.2, y: 0.5 });
    const cameraRight = fieldPointFromLandmark({ x: 0.8, y: 0.5 });
    expect(cameraLeft.x).toBeGreaterThan(cameraRight.x);
  });

  it("flips y, because landmarks run down and the field runs up", () => {
    const high = fieldPointFromLandmark({ x: 0.5, y: 0.2 });
    const low = fieldPointFromLandmark({ x: 0.5, y: 0.8 });
    expect(high.y).toBeGreaterThan(low.y);
  });

  it("puts the centre of the frame at the centre of the field", () => {
    const centre = fieldPointFromLandmark({ x: 0.5, y: 0.5 });
    expect(centre.x).toBeCloseTo(0.5, 5);
    expect(centre.y).toBeCloseTo(0.5, 5);
  });

  // Without the inset the corners of the field need the hand at the very edge
  // of the frame, where tracking is worst and reaching is least comfortable.
  it("reaches the field's edges before the hand reaches the frame's", () => {
    const nearEdge = fieldPointFromLandmark({ x: 0.18, y: 0.18 });
    expect(nearEdge.x).toBeCloseTo(1, 5);
    expect(nearEdge.y).toBeCloseTo(1, 5);
  });

  it("clamps rather than escaping the field past the inset", () => {
    for (const landmark of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: -0.4, y: 1.7 },
    ]) {
      const point = fieldPointFromLandmark(landmark);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonic across the reachable span", () => {
    let previous = -1;
    for (let x = 0.2; x <= 0.8; x += 0.05) {
      // x is mirrored, so walking the frame left-to-right walks the field
      // right-to-left; compare against the mirrored input instead.
      const point = fieldPointFromLandmark({ x: 1 - x, y: 0.5 });
      expect(point.x).toBeGreaterThan(previous);
      previous = point.x;
    }
  });
});

describe("nearFrameEdge", () => {
  it("is false in the middle of the frame", () => {
    expect(nearFrameEdge({ x: 0.5, y: 0.5 })).toBe(false);
  });

  it("is true right at each edge", () => {
    expect(nearFrameEdge({ x: 0.01, y: 0.5 })).toBe(true);
    expect(nearFrameEdge({ x: 0.99, y: 0.5 })).toBe(true);
    expect(nearFrameEdge({ x: 0.5, y: 0.01 })).toBe(true);
    expect(nearFrameEdge({ x: 0.5, y: 0.99 })).toBe(true);
  });

  it("respects a custom margin", () => {
    expect(nearFrameEdge({ x: 0.5, y: 0.5 }, 0.6)).toBe(true);
    expect(nearFrameEdge({ x: 0.5, y: 0.5 }, 0.01)).toBe(false);
  });
});
