import { describe, expect, it } from "vitest";
import { DEFAULT_FOCUS, gaussianWeights } from "./weighting";

const A = { x: 0, y: 0 };
const B = { x: 1, y: 0 };
const C = { x: 0.5, y: 1 };

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe("gaussianWeights", () => {
  it("returns nothing for an empty field", () => {
    expect(gaussianWeights({ x: 0.5, y: 0.5 }, [])).toEqual([]);
  });

  it("always sums to 1", () => {
    for (const focus of [0.08, DEFAULT_FOCUS, 0.5]) {
      const weights = gaussianWeights({ x: 0.3, y: 0.4 }, [A, B, C], focus);
      expect(sum(weights)).toBeCloseTo(1);
    }
  });

  it("gives the nearest prompt the largest share", () => {
    const weights = gaussianWeights({ x: 0.1, y: 0.05 }, [A, B, C]);
    expect(weights[0]).toBeGreaterThan(weights[1]!);
    expect(weights[0]).toBeGreaterThan(weights[2]!);
  });

  it("weights two equidistant prompts equally", () => {
    const weights = gaussianWeights({ x: 0.5, y: 0 }, [A, B]);
    expect(weights[0]).toBeCloseTo(weights[1]!);
  });

  // Standing exactly on a prompt is the case inverse-distance weighting
  // divides by zero on. It has to be ordinary here.
  it("is finite standing exactly on a prompt", () => {
    const weights = gaussianWeights(A, [A, B, C]);
    expect(weights.every(Number.isFinite)).toBe(true);
    expect(sum(weights)).toBeCloseTo(1);
    expect(weights[0]).toBeGreaterThan(0.9);
  });

  it("narrows the distribution as focus tightens", () => {
    const player = { x: 0.35, y: 0.2 };
    const tight = gaussianWeights(player, [A, B, C], 0.1);
    const wide = gaussianWeights(player, [A, B, C], 0.5);
    expect(Math.max(...tight)).toBeGreaterThan(Math.max(...wide));
  });

  it("approaches an even wash as focus widens", () => {
    const weights = gaussianWeights({ x: 0.4, y: 0.3 }, [A, B, C], 40);
    for (const weight of weights) expect(weight).toBeCloseTo(1 / 3, 2);
  });

  // Far away with a tight focus, every exponential underflows to zero. The
  // field must not go silent or emit NaN into an AudioParam.
  it("falls back to the nearest prompt when everything underflows", () => {
    const weights = gaussianWeights({ x: 900, y: 900 }, [A, B, C], 0.06);
    expect(weights.every(Number.isFinite)).toBe(true);
    expect(sum(weights)).toBeCloseTo(1);
    expect(weights[2]).toBe(1); // C is nearest to (900, 900)
  });
});
