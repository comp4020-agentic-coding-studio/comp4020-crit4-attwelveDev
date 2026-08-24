import { describe, expect, it } from "vitest";
import {
  eventDecay,
  eventFrequency,
  eventInterval,
  jitterAmount,
} from "./events";

describe("eventInterval", () => {
  // The whole point of the `dense` axis: walking toward a dense prompt has to
  // audibly add events, not just change their colour.
  it("shortens as the field gets denser", () => {
    expect(eventInterval(1)).toBeLessThan(eventInterval(0.5));
    expect(eventInterval(0.5)).toBeLessThan(eventInterval(0));
  });

  it("stays positive and finite across the range", () => {
    for (const dense of [0, 0.25, 0.5, 0.75, 1]) {
      const interval = eventInterval(dense);
      expect(interval).toBeGreaterThan(0);
      expect(Number.isFinite(interval)).toBe(true);
    }
  });
});

describe("eventDecay", () => {
  // Dense fields must ring shorter, or raising density turns the layer into a
  // smear instead of a pulse.
  it("shortens as the field gets denser", () => {
    expect(eventDecay(1)).toBeLessThan(eventDecay(0));
  });

  it("always outlasts a single interval at the sparse end", () => {
    expect(eventDecay(0)).toBeGreaterThan(0.1);
  });
});

describe("jitterAmount", () => {
  it("is none at rest and grows with restlessness", () => {
    expect(jitterAmount(0)).toBeCloseTo(0);
    expect(jitterAmount(1)).toBeGreaterThan(jitterAmount(0.5));
  });

  // Jitter is applied as a fraction of the interval, so at 1 the grid would
  // invert and events could be scheduled in the past.
  it("stays below 1 so events cannot cross each other", () => {
    expect(jitterAmount(1)).toBeLessThan(1);
  });
});

describe("eventFrequency", () => {
  it("rises with register", () => {
    expect(eventFrequency(1, 0)).toBeGreaterThan(eventFrequency(0, 0));
  });

  it("stays audible for every pick across the register", () => {
    for (const register of [0, 0.5, 1]) {
      for (let pick = 0; pick < 1; pick += 0.05) {
        const frequency = eventFrequency(register, pick);
        expect(frequency).toBeGreaterThan(20);
        expect(frequency).toBeLessThan(20_000);
      }
    }
  });

  it("handles the boundary pick without falling off the scale", () => {
    expect(Number.isFinite(eventFrequency(0.5, 1))).toBe(true);
    expect(eventFrequency(0.5, 1)).toBeGreaterThan(0);
  });
});
