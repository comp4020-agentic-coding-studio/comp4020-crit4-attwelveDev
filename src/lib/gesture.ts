import { clamp01 } from "./mapping";
import type { Timbre } from "./timbre";
import type { Point } from "./weighting";

// What a hand expresses beyond where it is.
//
// Split deliberately along the line the projection experiment found (see
// docs/semantic-projection.md): a text embedding carries static spectral
// character well and temporal behaviour badly, so temporal behaviour is taken
// out of the prompt and given to the body. The field says what a place sounds
// like; the hand says how agitated it is there.
//
// Everything here is pure, so it is testable without a camera --- which
// matters, because a headless browser can never detect a hand.

/** MediaPipe hand landmark indices. */
const WRIST = 0;
const PALM = 9;
const FINGERTIPS = [8, 12, 16, 20] as const;

export interface Landmark {
  x: number;
  y: number;
}

/**
 * Observed spread ratios for a closed and an open hand.
 *
 * Tunable by feel: these decide how far you have to close your fingers before
 * the blend actually narrows. Measured against palm width rather than absolute
 * distance so the reading does not change as the hand moves nearer the camera.
 */
const OPENNESS_RANGE = { closed: 0.95, open: 2.15 } as const;

/**
 * How open the hand is, 0 (fist) to 1 (spread).
 *
 * Mean fingertip distance from the palm, over hand scale. The thumb is
 * excluded: it folds across the palm rather than away from it, so it reads as
 * closed at exactly the moment the other four are widest.
 */
export function handOpenness(landmarks: readonly Landmark[]): number {
  const wrist = landmarks[WRIST];
  const palm = landmarks[PALM];
  if (!wrist || !palm) return 0.5;

  const scale = Math.hypot(palm.x - wrist.x, palm.y - wrist.y);
  // A degenerate hand (all landmarks coincident) would divide by zero.
  if (scale < 1e-6) return 0.5;

  let total = 0;
  let counted = 0;
  for (const index of FINGERTIPS) {
    const tip = landmarks[index];
    if (!tip) continue;
    total += Math.hypot(tip.x - palm.x, tip.y - palm.y);
    counted += 1;
  }
  if (counted === 0) return 0.5;

  const ratio = total / counted / scale;
  const { closed, open } = OPENNESS_RANGE;
  return clamp01((ratio - closed) / (open - closed));
}

/** How hard a jerk has to be to reach full energy. Tunable by feel. */
const JERK_FULL_SCALE = 14;

/** Per-second decay of the energy envelope once a gesture has passed. */
const ENERGY_DECAY = 0.12;

/**
 * Tracks how emphatic the hand's movement is, 0 (still or gliding) to 1.
 *
 * Driven by jerk rather than speed, which is the whole point: travelling
 * across the field to reach a different prompt is a smooth movement and must
 * not agitate the sound, while a sharp gesture in place must. Speed cannot
 * tell those apart; the rate of change of velocity can.
 *
 * Fast attack and slow decay, so a gesture lands and then settles rather than
 * vanishing the instant the hand stops --- a conducted cue, not a switch.
 */
export class EnergyFollower {
  #energy = 0;
  #velocity: Point | null = null;
  #last: Point | null = null;

  get value(): number {
    return this.#energy;
  }

  reset(): void {
    this.#energy = 0;
    this.#velocity = null;
    this.#last = null;
  }

  /** Feed one sample. `dt` is seconds since the previous one. */
  push(point: Point, dt: number): number {
    // A zero or absurd frame gap (a backgrounded tab, a dropped frame) would
    // divide into a meaningless spike.
    if (dt <= 1e-4 || dt > 0.5) {
      this.#last = point;
      return this.#energy;
    }

    if (!this.#last) {
      this.#last = point;
      return this.#energy;
    }

    const velocity: Point = {
      x: (point.x - this.#last.x) / dt,
      y: (point.y - this.#last.y) / dt,
    };
    this.#last = point;

    if (!this.#velocity) {
      this.#velocity = velocity;
      return this.#energy;
    }

    const jerk = Math.hypot(
      (velocity.x - this.#velocity.x) / dt,
      (velocity.y - this.#velocity.y) / dt,
    );
    this.#velocity = velocity;

    const target = clamp01(jerk / JERK_FULL_SCALE);
    // Attack is immediate, decay is exponential in real time so it behaves the
    // same at any frame rate.
    this.#energy =
      target > this.#energy
        ? target
        : this.#energy * ENERGY_DECAY ** dt;
    return this.#energy;
  }
}

/** How far a full-energy gesture pushes each temporal axis. */
const ENERGY_REACH = { restless: 0.62, dense: 0.3 } as const;

/**
 * Add gestural energy to a blended timbre.
 *
 * Additive rather than overriding, so the field keeps a baseline and the
 * instrument behaves identically when no hand is present. It touches only the
 * two axes the embedding could not carry --- pushing `bright` or `metallic`
 * from gesture would overwrite exactly the information the prompt does convey
 * well.
 */
export function applyEnergy(timbre: Timbre, energy: number): Timbre {
  if (energy <= 0) return timbre;
  const amount = clamp01(energy);
  return {
    ...timbre,
    restless: clamp01(timbre.restless + amount * ENERGY_REACH.restless),
    dense: clamp01(timbre.dense + amount * ENERGY_REACH.dense),
  };
}
