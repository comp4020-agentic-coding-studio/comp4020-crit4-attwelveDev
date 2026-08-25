import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import {
  AdaptiveRange,
  EnergyFollower,
  handSpread,
  SPREAD_SEED,
} from "./gesture";
import { clamp01 } from "./mapping";
import type { Point } from "./weighting";

// Hand tracking as an input to the travelling point.
//
// This instrument is steered by exactly one 2D position, which is the one
// thing free-air gesture is genuinely good at: coarse, continuous, and
// low-precision. It is deliberately not asked to pick notes or trigger events,
// where hand tracking's poor repeatability would show immediately --- and
// because resting position stays musically meaningful, the arm doesn't have to
// stay raised.
//
// Everything here is a progressive enhancement. Pointer and keyboard remain
// the primary inputs, and every failure path below leaves them working.

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * Landmark 9 is the middle finger's base knuckle --- effectively the centre of
 * the palm. Steadier than the wrist, which swings widely as the hand rotates,
 * and far steadier than a fingertip.
 */
const PALM_LANDMARK = 9;

/**
 * Exponential smoothing on the tracked position.
 *
 * Raw landmarks jitter by a percent or two between frames even from a still
 * hand, and this position drives a filter cutoff --- unsmoothed, that jitter
 * is audible as a constant warble. Low enough to still feel responsive.
 */
const SMOOTHING = 0.28;

/**
 * Separate, much lighter smoothing for the signal the energy follower reads.
 *
 * The first version measured jerk on the display-smoothed position, which was
 * self-defeating: exponential smoothing is a low-pass filter and jerk is the
 * highest-frequency content in the signal, so the sharp gestures it exists to
 * detect were being filtered out before it saw them. This removes landmark
 * jitter while leaving transients intact.
 */
const ENERGY_SMOOTHING = 0.72;

/**
 * The camera sees a smaller area than a hand comfortably reaches, so raw
 * normalised coordinates make the edges of the field unreachable. Treating the
 * middle portion of the frame as the whole field means an ordinary movement
 * covers it, without the player pressing against the frame edge.
 */
const FRAME_INSET = 0.18;

/**
 * How close a landmark can get to the camera's raw edge (0 or 1, before the
 * inset expansion above) before it counts as "about to leave frame". Checked
 * against the raw coordinate, not the expanded field position, because the
 * field position already saturates at FRAME_INSET --- by the time it reads 1
 * the hand could still be well inside the frame.
 */
const EDGE_MARGIN = 0.09;

/**
 * A single dropped frame is normal --- detection flickers even from a still,
 * centred hand --- so "no hand" only fires after this much continuous silence,
 * not the first missed frame.
 */
const NO_HAND_GRACE_MS = 350;

export type HandState = "idle" | "loading" | "tracking" | "denied" | "failed";

/** Nothing to flag, the hand is about to leave frame, or it already has. */
export type HandWarning = "none" | "near-edge" | "no-hand";

/**
 * Whether a landmark is close enough to the camera's edge that the next
 * movement could lose it. Exported for the same reason as
 * fieldPointFromLandmark: it is coordinate arithmetic a headless browser's
 * fake camera never exercises, so it is pinned directly instead.
 */
export function nearFrameEdge(
  landmark: { x: number; y: number },
  margin: number = EDGE_MARGIN,
): boolean {
  return (
    landmark.x < margin ||
    landmark.x > 1 - margin ||
    landmark.y < margin ||
    landmark.y > 1 - margin
  );
}

/** Everything one hand expresses, per frame. */
export interface HandReading {
  /** Where in the field the hand is pointing. */
  point: Point;
  /** 0 fist, 1 spread. Drives how tightly the blend selects. */
  openness: number;
  /** 0 still or gliding, 1 emphatic. Drives the temporal axes. */
  energy: number;
}

export interface HandTrackerOptions {
  video: HTMLVideoElement;
  onReading: (reading: HandReading) => void;
  onState: (state: HandState) => void;
  /** Fires only on change, so the caller can drive an aria-live region without debouncing it again. */
  onWarning: (warning: HandWarning) => void;
}

/**
 * Openness is smoothed harder than position. Hand shape changes incidentally
 * during a fast move --- fingers trail and splay --- and without heavier
 * smoothing that crosstalk reads as the focus lurching every time you travel.
 */
const OPENNESS_SMOOTHING = 0.1;

function expand(value: number): number {
  return clamp01((value - FRAME_INSET) / (1 - 2 * FRAME_INSET));
}

/**
 * A landmark's normalised camera coordinates to a point in the field.
 *
 * Exported because it is the part of hand tracking a headless browser cannot
 * check --- Chrome's fake camera emits a test pattern, so no hand is ever
 * detected and this never runs there. Both inversions below are the kind of
 * mistake that looks fine in code and is instantly, confusingly wrong in the
 * hand, so they get tested directly.
 */
export function fieldPointFromLandmark(landmark: {
  x: number;
  y: number;
}): Point {
  return {
    // The camera image is mirrored relative to the player, so moving right
    // must raise x, not lower it.
    x: expand(1 - landmark.x),
    // Landmark y runs downward; the field's runs up.
    y: expand(1 - landmark.y),
  };
}

export class HandTracker {
  readonly #options: HandTrackerOptions;
  #landmarker: HandLandmarker | null = null;
  #stream: MediaStream | null = null;
  #frame: number | null = null;
  #smoothed: Point | null = null;
  #openness: number | null = null;
  #energyPoint: Point | null = null;
  readonly #spreadRange = new AdaptiveRange(SPREAD_SEED.closed, SPREAD_SEED.open);
  #lastVideoTime = -1;
  #lastSample = 0;
  readonly #energy = new EnergyFollower();
  #warning: HandWarning = "none";
  #lastHandSeen = 0;

  constructor(options: HandTrackerOptions) {
    this.#options = options;
  }

  get tracking(): boolean {
    return this.#frame !== null;
  }

  #setWarning(next: HandWarning): void {
    if (next === this.#warning) return;
    this.#warning = next;
    this.#options.onWarning(next);
  }

  /**
   * Ask for the camera, load the model, and begin tracking.
   *
   * The camera is requested *before* the model downloads: a permission prompt
   * that appears after a long silent wait reads as the page having hung, and a
   * refusal after a 10MB download wastes it entirely.
   */
  async start(): Promise<boolean> {
    if (this.tracking) return true;
    this.#options.onState("loading");

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
    } catch {
      // Refusal and "no camera on this machine" are the same to us: the
      // instrument carries on with pointer and keyboard.
      this.#options.onState("denied");
      return false;
    }

    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.#landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });

      const { video } = this.#options;
      video.srcObject = this.#stream;
      await video.play();

      this.#options.onState("tracking");
      // Grace period starts now, not at the first missed frame --- otherwise
      // a hand that takes a moment to be recognised warns immediately.
      this.#lastHandSeen = performance.now();
      this.#loop();
      return true;
    } catch (error) {
      console.error("hand tracking unavailable", error);
      this.stop();
      this.#options.onState("failed");
      return false;
    }
  }

  stop(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#options.video.srcObject = null;
    this.#smoothed = null;
    this.#openness = null;
    this.#energyPoint = null;
    this.#lastVideoTime = -1;
    this.#energy.reset();
    this.#setWarning("none");
    this.#options.onState("idle");
  }

  #loop = (): void => {
    this.#frame = requestAnimationFrame(this.#loop);
    const { video, onReading } = this.#options;
    if (!this.#landmarker || video.readyState < 2) return;

    // detectForVideo throws if given the same timestamp twice, and the camera
    // frame rate is independent of the display's.
    if (video.currentTime === this.#lastVideoTime) return;
    this.#lastVideoTime = video.currentTime;

    const now = performance.now();
    const result = this.#landmarker.detectForVideo(video, now);
    const landmarks = result.landmarks?.[0];
    const palm = landmarks?.[PALM_LANDMARK];
    // No hand in frame: hold the last reading rather than snapping the sound
    // to a corner. A hand leaving the frame should sound like a held note.
    if (!landmarks || !palm) {
      if (now - this.#lastHandSeen > NO_HAND_GRACE_MS) {
        this.#setWarning("no-hand");
      }
      this.#lastSample = now;
      return;
    }
    this.#lastHandSeen = now;
    this.#setWarning(nearFrameEdge(palm) ? "near-edge" : "none");

    const target = fieldPointFromLandmark(palm);
    this.#smoothed = this.#smoothed
      ? {
          x: this.#smoothed.x + (target.x - this.#smoothed.x) * SMOOTHING,
          y: this.#smoothed.y + (target.y - this.#smoothed.y) * SMOOTHING,
        }
      : target;

    const spread = handSpread(landmarks);
    if (spread !== null) {
      // Normalised against the range this hand is actually observed to cover,
      // because how far a given person opens their fingers is not knowable in
      // advance and a wrong guess makes the control feel dead.
      const openness = this.#spreadRange.normalise(spread);
      this.#openness =
        this.#openness === null
          ? openness
          : this.#openness + (openness - this.#openness) * OPENNESS_SMOOTHING;
    }

    // Energy reads a lightly-smoothed position of its own, not the heavily
    // smoothed one driving the display --- see ENERGY_SMOOTHING.
    this.#energyPoint = this.#energyPoint
      ? {
          x: this.#energyPoint.x + (target.x - this.#energyPoint.x) * ENERGY_SMOOTHING,
          y: this.#energyPoint.y + (target.y - this.#energyPoint.y) * ENERGY_SMOOTHING,
        }
      : target;

    const dt = (now - this.#lastSample) / 1000;
    this.#lastSample = now;
    const energy = this.#energy.push(this.#energyPoint, dt);

    onReading({
      point: this.#smoothed,
      // Neutral until a measurable hand has been seen, so the focus starts
      // mid-range rather than pinned to one extreme.
      openness: this.#openness ?? 0.5,
      energy,
    });
  };
}
