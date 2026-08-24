import { describe, expect, it } from "vitest";
import { clamp01, mapExp, mapLinear } from "./mapping";

describe("clamp01", () => {
  it("passes through values already in range", () => {
    expect(clamp01(0.4)).toBe(0.4);
  });

  it("clamps outside the range", () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(9)).toBe(1);
  });

  // A NaN reaching an AudioParam throws and kills the voice, so it stops here.
  it("absorbs NaN rather than passing it to an AudioParam", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("mapExp", () => {
  it("hits both bounds", () => {
    expect(mapExp(0, 100, 8000)).toBeCloseTo(100);
    expect(mapExp(1, 100, 8000)).toBeCloseTo(8000);
  });

  it("puts the geometric mean at the midpoint, not the arithmetic one", () => {
    // 100..10000 spans two decades, so halfway across the control is 1000 Hz —
    // an octave-even sweep. A linear map would sit at 5050 Hz here.
    expect(mapExp(0.5, 100, 10_000)).toBeCloseTo(1000);
  });

  it("clamps its input", () => {
    expect(mapExp(-1, 100, 8000)).toBeCloseTo(100);
    expect(mapExp(4, 100, 8000)).toBeCloseTo(8000);
  });

  it("rejects a range that has no ratio", () => {
    expect(() => mapExp(0.5, 0, 8000)).toThrow(RangeError);
  });
});

describe("mapLinear", () => {
  it("hits both bounds and the midpoint", () => {
    expect(mapLinear(0, 2, 10)).toBeCloseTo(2);
    expect(mapLinear(0.5, 2, 10)).toBeCloseTo(6);
    expect(mapLinear(1, 2, 10)).toBeCloseTo(10);
  });

  it("handles an inverted range", () => {
    expect(mapLinear(0.25, 10, 2)).toBeCloseTo(8);
  });
});
