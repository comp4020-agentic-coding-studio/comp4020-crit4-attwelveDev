import { describe, expect, it } from "vitest";
import {
  AdaptiveRange,
  applyEnergy,
  EnergyFollower,
  handSpread,
  type Landmark,
} from "./gesture";
import { neutralTimbre, TIMBRE_AXES } from "./timbre";

// A headless browser can never detect a hand, so everything gesture-related
// that can be made pure is tested here instead.

/**
 * A synthetic hand. `spread` scales fingertip distance from the palm; palm
 * width is fixed, so the ratio the reading uses varies only with spread.
 */
function hand(spread: number): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.5,
  }));
  landmarks[0] = { x: 0.5, y: 0.6 }; // wrist, 0.1 below the palm
  landmarks[9] = { x: 0.5, y: 0.5 }; // palm
  for (const tip of [8, 12, 16, 20]) {
    landmarks[tip] = { x: 0.5, y: 0.5 - 0.1 * spread };
  }
  return landmarks;
}

describe("handSpread", () => {
  it("increases monotonically as the fingers open", () => {
    let previous = -1;
    for (let spread = 0.9; spread <= 2.2; spread += 0.1) {
      const value = handSpread(hand(spread));
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThan(previous);
      previous = value!;
    }
  });

  // A ratio against palm width, so moving the whole hand nearer the camera
  // must not read as opening it.
  it("is invariant to hand scale", () => {
    const near = hand(1.6);
    const far = near.map(({ x, y }) => ({
      x: 0.5 + (x - 0.5) * 0.4,
      y: 0.5 + (y - 0.5) * 0.4,
    }));
    expect(handSpread(far)!).toBeCloseTo(handSpread(near)!, 5);
  });

  // Null rather than a midpoint, so a caller can hold its last good reading
  // instead of being handed a fabricated one.
  it("returns null for a hand it cannot measure", () => {
    expect(handSpread([])).toBeNull();
    expect(
      handSpread(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))),
    ).toBeNull();
  });
});

describe("AdaptiveRange", () => {
  // The reason this exists: a hardcoded openness range guessed wrong means the
  // player only ever drives the middle of the output, and the control feels
  // dead. That is exactly what happened with the first fixed range.
  it("spans the full output once it has seen both extremes", () => {
    const range = new AdaptiveRange(1.15, 1.75);
    // Values outside the seed on both sides, which is what a real hand
    // produces the first time it is fully closed and fully opened.
    range.normalise(0.9);
    range.normalise(2.0);
    expect(range.normalise(0.9)).toBeCloseTo(0, 5);
    expect(range.normalise(2.0)).toBeCloseTo(1, 5);
    expect(range.normalise(1.45)).toBeCloseTo(0.5, 1);
  });

  it("widens to admit values outside its seed", () => {
    const range = new AdaptiveRange(1.15, 1.75);
    range.normalise(0.4);
    range.normalise(3);
    expect(range.low).toBeCloseTo(0.4);
    expect(range.high).toBeCloseTo(3);
  });

  // Shrinking toward recent values would make a hand held still slowly drift
  // to "fully open" --- the classic failure of adaptive normalisation.
  it("never narrows once widened", () => {
    const range = new AdaptiveRange(1, 2);
    range.normalise(0.5);
    range.normalise(2.5);
    for (let i = 0; i < 200; i += 1) range.normalise(1.5);
    expect(range.low).toBeCloseTo(0.5);
    expect(range.high).toBeCloseTo(2.5);
  });

  it("sits at the midpoint until the span is meaningful", () => {
    const range = new AdaptiveRange(1.5, 1.55);
    expect(range.normalise(1.52)).toBeCloseTo(0.5);
  });

  it("stays in range and never emits NaN", () => {
    const range = new AdaptiveRange(1.15, 1.75);
    for (const value of [0, -5, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = range.normalise(value);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
  });
});

describe("EnergyFollower", () => {
  const dt = 1 / 60;

  /** Move at constant speed --- a deliberate glide across the field. */
  function glide(follower: EnergyFollower, frames: number): number {
    let energy = 0;
    for (let i = 0; i < frames; i += 1) {
      energy = follower.push({ x: 0.2 + i * 0.01, y: 0.5 }, dt);
    }
    return energy;
  }

  it("stays near zero for a still hand", () => {
    const follower = new EnergyFollower();
    let energy = 0;
    for (let i = 0; i < 40; i += 1) energy = follower.push({ x: 0.4, y: 0.4 }, dt);
    expect(energy).toBeLessThan(0.02);
  });

  // The point of using jerk rather than speed: crossing the field to reach a
  // different prompt is a smooth movement and must not agitate the sound.
  it("stays low for a steady glide, however fast", () => {
    expect(glide(new EnergyFollower(), 40)).toBeLessThan(0.05);
  });

  it("spikes on a sharp change of direction", () => {
    const follower = new EnergyFollower();
    glide(follower, 20);
    // Reverse abruptly.
    let energy = 0;
    for (let i = 0; i < 3; i += 1) {
      energy = follower.push({ x: 0.4 - i * 0.05, y: 0.5 }, dt);
    }
    expect(energy).toBeGreaterThan(0.3);
  });

  it("decays after the gesture rather than switching off", () => {
    const follower = new EnergyFollower();
    glide(follower, 20);
    for (let i = 0; i < 3; i += 1) follower.push({ x: 0.4 - i * 0.05, y: 0.5 }, dt);
    const peak = follower.value;

    // Hold still: energy should fall, but still be audible a moment later.
    for (let i = 0; i < 6; i += 1) follower.push({ x: 0.25, y: 0.5 }, dt);
    const shortly = follower.value;
    for (let i = 0; i < 120; i += 1) follower.push({ x: 0.25, y: 0.5 }, dt);

    expect(shortly).toBeLessThan(peak);
    expect(shortly).toBeGreaterThan(peak * 0.3);
    expect(follower.value).toBeLessThan(0.02);
  });

  it("ignores absurd frame gaps rather than spiking on them", () => {
    const follower = new EnergyFollower();
    glide(follower, 10);
    // A backgrounded tab returning: a huge dt would divide into a huge jerk.
    const energy = follower.push({ x: 0.9, y: 0.9 }, 3);
    expect(energy).toBeLessThan(0.1);
  });

  it("resets cleanly", () => {
    const follower = new EnergyFollower();
    glide(follower, 20);
    follower.push({ x: 0.1, y: 0.9 }, dt);
    follower.reset();
    expect(follower.value).toBe(0);
  });
});

describe("applyEnergy", () => {
  it("leaves the timbre untouched at rest", () => {
    const timbre = neutralTimbre();
    expect(applyEnergy(timbre, 0)).toEqual(timbre);
  });

  it("raises only the two axes the embedding could not carry", () => {
    const before = neutralTimbre();
    const after = applyEnergy(before, 1);
    expect(after.restless).toBeGreaterThan(before.restless);
    expect(after.dense).toBeGreaterThan(before.dense);
    for (const axis of TIMBRE_AXES) {
      if (axis === "restless" || axis === "dense") continue;
      expect(after[axis]).toBe(before[axis]);
    }
  });

  it("never pushes an axis out of range", () => {
    const loud = { ...neutralTimbre(), restless: 0.95, dense: 0.9 };
    const after = applyEnergy(loud, 1);
    expect(after.restless).toBeLessThanOrEqual(1);
    expect(after.dense).toBeLessThanOrEqual(1);
  });
});
