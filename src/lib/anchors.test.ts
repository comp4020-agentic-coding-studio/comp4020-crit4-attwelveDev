import { describe, expect, it } from "vitest";
import { ANCHORS, projectToTimbre, type AnchorVectors } from "./anchors";
import { TIMBRE_AXES } from "./timbre";

// The projection is tested with synthetic vectors rather than real embeddings:
// the model is a 23MB download and its output is not the thing under test here.
// What matters is that a phrase leaning toward a pole lands near that pole, and
// that nothing ever escapes 0..1 and reaches an AudioParam as garbage.

const DIMS = 8;

function unit(values: number[]): Float32Array {
  const magnitude = Math.hypot(...values) || 1;
  return Float32Array.from(values.map((v) => v / magnitude));
}

/** Anchors on orthogonal axes, so each can be leaned toward independently. */
function syntheticAnchors(): AnchorVectors {
  const anchors: AnchorVectors = new Map();
  TIMBRE_AXES.forEach((axis, index) => {
    const positive = Array.from({ length: DIMS }, () => 0);
    const negative = Array.from({ length: DIMS }, () => 0);
    positive[index % DIMS] = 1;
    negative[index % DIMS] = -1;
    anchors.set(axis, [unit(positive), unit(negative)]);
  });
  return anchors;
}

describe("ANCHORS", () => {
  it("covers every timbre axis exactly once", () => {
    expect(ANCHORS.map((a) => a.axis).sort()).toEqual([...TIMBRE_AXES].sort());
  });

  it("gives each axis two distinct poles", () => {
    for (const anchor of ANCHORS) {
      expect(anchor.positive).not.toBe(anchor.negative);
      expect(anchor.positive.length).toBeGreaterThan(0);
      expect(anchor.negative.length).toBeGreaterThan(0);
    }
  });
});

describe("projectToTimbre", () => {
  const anchors = syntheticAnchors();

  it("puts a phrase equidistant from both poles at the centre", () => {
    const orthogonal = unit([0, 0, 0, 0, 0, 0, 0, 1]);
    const timbre = projectToTimbre(orthogonal, anchors);
    for (const axis of TIMBRE_AXES) expect(timbre[axis]).toBeCloseTo(0.5, 5);
  });

  it("lands above centre when leaning toward the positive pole", () => {
    const leaning = Array.from({ length: DIMS }, () => 0);
    leaning[0] = 1;
    const timbre = projectToTimbre(unit(leaning), anchors);
    expect(timbre.bright).toBeGreaterThan(0.9);
  });

  it("lands below centre when leaning toward the negative pole", () => {
    const leaning = Array.from({ length: DIMS }, () => 0);
    leaning[0] = -1;
    const timbre = projectToTimbre(unit(leaning), anchors);
    expect(timbre.bright).toBeLessThan(0.1);
  });

  it("stays inside 0..1 for any input, however extreme", () => {
    const extremes = [
      unit([50, -50, 20, 0, 0, 0, 0, 0]),
      Float32Array.from(Array.from({ length: DIMS }, () => 0)),
      unit([-1, -1, -1, -1, -1, -1, -1, -1]),
    ];
    for (const embedding of extremes) {
      const timbre = projectToTimbre(embedding, anchors);
      for (const axis of TIMBRE_AXES) {
        expect(timbre[axis]).toBeGreaterThanOrEqual(0);
        expect(timbre[axis]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(timbre[axis])).toBe(true);
      }
    }
  });

  it("falls back to neutral for an axis with no anchor rather than emitting NaN", () => {
    const partial: AnchorVectors = new Map(anchors);
    partial.delete("metallic");
    const timbre = projectToTimbre(unit([1, 0, 0, 0, 0, 0, 0, 0]), partial);
    expect(timbre.metallic).toBe(0.5);
  });
});
