import { mapExp } from "./mapping";

// Phase 0: one drone voice whose brightness and register follow the travelling
// point. This exists to prove the whole loop end to end --- gesture gate,
// continuous parameter control, no zipper noise --- before the constellation
// and the event layer are built on top of it.

/** Partials of the drone, as ratios against the root, with their gains. */
const PARTIALS: readonly { ratio: number; gain: number; detune: number }[] = [
  { ratio: 1, gain: 0.5, detune: -6 },
  { ratio: 1, gain: 0.4, detune: 5 },
  { ratio: 1.5, gain: 0.28, detune: -3 },
  { ratio: 2, gain: 0.2, detune: 4 },
  { ratio: 3, gain: 0.09, detune: -8 },
];

const ROOT_RANGE = { min: 55, max: 220 } as const; // A1..A3
const CUTOFF_RANGE = { min: 170, max: 7500 } as const;

/**
 * How fast parameters chase their targets. Long enough that fast pointer
 * movement doesn't step audibly, short enough that the instrument still feels
 * like it is responding to you rather than trailing you.
 */
const GLIDE_SECONDS = 0.07;

/** Fade-in on first sound, so starting the instrument isn't a click. */
const FADE_IN_SECONDS = 1.4;

const MASTER_LEVEL = 0.22;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  filter: BiquadFilterNode;
  oscillators: OscillatorNode[];
}

/** Normalised position in the field: x left..right, y bottom..top. */
export interface Position {
  x: number;
  y: number;
}

export class Engine {
  #graph: Graph | null = null;
  #position: Position = { x: 0.5, y: 0.5 };

  get running(): boolean {
    return this.#graph?.ctx.state === "running";
  }

  /**
   * Build the graph and start sounding. Must be called from a user gesture ---
   * the autoplay policy leaves a fresh AudioContext suspended, so nothing
   * sounds before the player's first action, which is exactly the behaviour
   * this week's spec asks for.
   */
  async start(): Promise<void> {
    if (this.#graph) {
      if (this.#graph.ctx.state === "suspended") await this.#graph.ctx.resume();
      return;
    }

    const ctx = new AudioContext();

    // A limiter on the end of the chain: five detuned oscillators summing at
    // full tilt is louder than it looks on paper, and this is played through
    // strangers' headphones.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.1;
    filter.connect(master);

    const oscillators = PARTIALS.map(({ gain, detune }) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = detune;

      const level = ctx.createGain();
      level.gain.value = gain;

      osc.connect(level).connect(filter);
      osc.start();
      return osc;
    });

    this.#graph = { ctx, master, filter, oscillators };
    this.#apply(0);

    master.gain.setTargetAtTime(
      MASTER_LEVEL,
      ctx.currentTime,
      FADE_IN_SECONDS / 3,
    );

    if (ctx.state === "suspended") await ctx.resume();
  }

  /** Move the travelling point. Safe to call before `start()`. */
  setPosition(position: Position): void {
    this.#position = position;
    this.#apply(GLIDE_SECONDS);
  }

  /** Silence the instrument without tearing the graph down. */
  async suspend(): Promise<void> {
    if (this.#graph?.ctx.state === "running") await this.#graph.ctx.suspend();
  }

  /**
   * Push the current position into the graph. `setTargetAtTime` rather than
   * a direct `.value =` assignment: assigning on every pointermove steps the
   * parameter at frame rate, which is audible as zipper noise on a filter.
   */
  #apply(glide: number): void {
    if (!this.#graph) return;
    const { ctx, filter, oscillators } = this.#graph;
    const now = ctx.currentTime;

    const root = mapExp(this.#position.y, ROOT_RANGE.min, ROOT_RANGE.max);
    const cutoff = mapExp(this.#position.x, CUTOFF_RANGE.min, CUTOFF_RANGE.max);

    // setTargetAtTime's third argument is a time constant, not a duration: the
    // parameter covers ~95% of the distance in 3x this. A zero constant is
    // invalid, so an immediate set uses the smallest sane step instead.
    const tau = glide > 0 ? glide / 3 : 0.001;

    filter.frequency.setTargetAtTime(cutoff, now, tau);
    oscillators.forEach((osc, index) => {
      const partial = PARTIALS[index];
      if (!partial) return;
      osc.frequency.setTargetAtTime(root * partial.ratio, now, tau);
    });
  }
}
