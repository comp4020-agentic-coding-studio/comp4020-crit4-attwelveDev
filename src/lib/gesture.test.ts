import { describe, expect, it } from "vitest";
import { applyEnergy, EnergyFollower, handOpenness, type Landmark } from "./gesture";
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

describe("handOpenness", () => {
  it("reads a fist low and a spread hand high", () => {
    expect(handOpenness(hand(0.9))).toBeLessThan(0.2);
    expect(handOpenness(hand(2.2))).toBeGreaterThan(0.8);
  });

  it("increases monotonically with spread", () => {
    let previous = -1;
    for (let spread = 0.9; spread <= 2.2; spread += 0.1) {
      const value = handOpenness(hand(spread));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  // The reading is a ratio against palm width, so moving the whole hand nearer
  // the camera must not read as opening it.
  it("is invariant to hand scale", () => {
    const near = hand(1.6);
    const far = near.map(({ x, y }) => ({
      x: 0.5 + (x - 0.5) * 0.4,
      y: 0.5 + (y - 0.5) * 0.4,
    }));
    expect(handOpenness(far)).toBeCloseTo(handOpenness(near), 5);
  });

  it("stays in range and never emits NaN for degenerate input", () => {
    for (const landmarks of [
      [],
      Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })),
      hand(0),
      hand(80),
    ]) {
      const value = handOpenness(landmarks);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
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
