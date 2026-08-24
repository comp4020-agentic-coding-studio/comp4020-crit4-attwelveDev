import { describe, expect, it } from "vitest";
import { blendTimbres, neutralTimbre, TIMBRE_AXES, type Timbre } from "./timbre";

function timbre(fill: number): Timbre {
  return {
    bright: fill,
    rough: fill,
    dense: fill,
    restless: fill,
    distant: fill,
    metallic: fill,
    register: fill,
  };
}

describe("blendTimbres", () => {
  it("returns the single timbre when all weight is on it", () => {
    const blended = blendTimbres([timbre(0.2), timbre(0.8)], [1, 0]);
    expect(blended.bright).toBeCloseTo(0.2);
  });

  it("takes the weighted mean, axis by axis", () => {
    const blended = blendTimbres([timbre(0), timbre(1)], [0.25, 0.75]);
    for (const axis of TIMBRE_AXES) expect(blended[axis]).toBeCloseTo(0.75);
  });

  it("blends each axis independently", () => {
    const dark: Timbre = { ...timbre(0.5), bright: 0, register: 1 };
    const bright: Timbre = { ...timbre(0.5), bright: 1, register: 0 };
    const blended = blendTimbres([dark, bright], [0.5, 0.5]);
    expect(blended.bright).toBeCloseTo(0.5);
    expect(blended.register).toBeCloseTo(0.5);
    expect(blended.rough).toBeCloseTo(0.5);
  });

  it("stays inside 0..1 for normalised weights", () => {
    const blended = blendTimbres(
      [timbre(0), timbre(1), timbre(0.4)],
      [0.2, 0.5, 0.3],
    );
    for (const axis of TIMBRE_AXES) {
      expect(blended[axis]).toBeGreaterThanOrEqual(0);
      expect(blended[axis]).toBeLessThanOrEqual(1);
    }
  });

  // Anything that would reach an AudioParam as NaN has to be caught here.
  it("falls back to neutral rather than emitting NaN", () => {
    expect(blendTimbres([], [])).toEqual(neutralTimbre());
    expect(blendTimbres([timbre(1)], [])).toEqual(neutralTimbre());
    expect(blendTimbres([], [1])).toEqual(neutralTimbre());
  });
});
