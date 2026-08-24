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
 * Raw spread: mean fingertip distance from the palm, over palm width.
 *
 * A ratio rather than a distance, so it does not change as the hand moves
 * nearer the camera. The thumb is excluded: it folds across the palm rather
 * than away from it, so it reads as closed at exactly the moment the other
 * four are widest.
 *
 * Returns null for a hand it cannot measure, so callers can hold their last
 * good reading instead of being handed a fabricated midpoint.
 */
export function handSpread(landmarks: readonly Landmark[]): number | null {
  const wrist = landmarks[WRIST];
  const palm = landmarks[PALM];
  if (!wrist || !palm) return null;

  const scale = Math.hypot(palm.x - wrist.x, palm.y - wrist.y);
  // A degenerate hand (all landmarks coincident) would divide by zero.
  if (scale < 1e-6) return null;

  let total = 0;
  let counted = 0;
  for (const index of FINGERTIPS) {
    const tip = landmarks[index];
    if (!tip) continue;
    total += Math.hypot(tip.x - palm.x, tip.y - palm.y);
    counted += 1;
  }
  if (counted === 0) return null;

  return total / counted / scale;
}

/**
 * Normalises a signal against the range it is actually observed to occupy.
 *
 * Hands differ, cameras differ, and how far a given person opens their fingers
 * is not knowable in advance. A hardcoded range guessed wrong means the player
 * only ever drives the middle of the output and the control feels dead --- so
 * the range learns from what it sees instead.
 *
 * It only ever widens. Shrinking toward recent values would make a hand held
 * still slowly become "fully open", which is the classic failure of adaptive
 * normalisation: the control drifts under a player who has not moved.
 */
export class AdaptiveRange {
  #low: number;
  #high: number;
  readonly #minSpan: number;

  constructor(low: number, high: number, minSpan = 0.25) {
    this.#low = low;
    this.#high = high;
    this.#minSpan = minSpan;
  }

  get low(): number {
    return this.#low;
  }

  get high(): number {
    return this.#high;
  }

  normalise(value: number): number {
    if (!Number.isFinite(value)) return 0.5;
    if (value < this.#low) this.#low = value;
    if (value > this.#high) this.#high = value;

    const span = this.#high - this.#low;
    // Before the player has shown both extremes the span is small, and
    // dividing by it would swing the output wildly on tiny movements.
    if (span < this.#minSpan) return 0.5;
    return clamp01((value - this.#low) / span);
  }
}

/**
 * Starting bounds, deliberately narrow. They widen on contact with a real
 * hand within a second or two of opening and closing it once.
 */
export const SPREAD_SEED = { closed: 1.15, open: 1.75 } as const;

/**
 * How hard a jerk has to be to reach full energy.
 *
 * Lowered sharply after the first version proved unnoticeable in the hand. An
 * ordinary conducting gesture is not a violent movement, and the threshold has
 * to sit where real gestures land rather than where a theoretical maximum
 * would.
 */
const JERK_FULL_SCALE = 4.5;

/** Per-second decay of the energy envelope once a gesture has passed. */
const ENERGY_DECAY = 0.1;

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

/**
 * How far a full-energy gesture pushes each temporal axis.
 *
 * Close to the full range: a conducted cue should be unmistakable, and the
 * first version's smaller reach was reported as no audible difference at all.
 */
const ENERGY_REACH = { restless: 0.95, dense: 0.6 } as const;

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
