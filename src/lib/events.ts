import { partialRatio, ROOT_RANGE, type Engine } from "./engine";
import { mapExp, mapLinear } from "./mapping";
import { neutralTimbre, type Timbre } from "./timbre";

// The event layer: short plucks scheduled ahead of time, whose rate, register
// and decay follow the blended timbre. The pad alone morphs but never moves;
// this is what gives the field a pulse.

/** Minor pentatonic, in semitones. Every pair of these is consonant, which is
 * how "there is no way to play it wrong" survives contact with random pitch
 * selection --- a scale with no tritone cannot produce a sour interval. */
const SCALE = [0, 3, 5, 7, 10] as const;
const OCTAVES = [0, 12] as const;

/** Seconds between scheduler ticks, and how far ahead each tick schedules. */
const TICK_MS = 25;
const SCHEDULE_AHEAD = 0.12;

const INTERVAL_RANGE = { min: 0.11, max: 2.4 } as const;
const DECAY_RANGE = { min: 0.18, max: 2.2 } as const;
const MAX_JITTER = 0.55;

/** Peak of a single pluck. These are the voice that carries the field's
 * character, so they sit above the pad rather than inside it. */
const PLUCK_LEVEL = 0.62;

/** Relative gains of a pluck's partials. Three is enough for a spectrum. */
const PLUCK_PARTIALS = [1, 0.4, 0.18] as const;

/**
 * Each partial rings this fraction as long as the one below it, and how much
 * depends on `metallic`.
 *
 * This is most of what separates metal from wood, and it was missing: moving
 * partial *ratios* alone measured as the second-weakest axis in the
 * instrument. A struck bar sheds its high partials slowly and rings for
 * seconds; a struck block sheds them almost immediately and thuds. Same
 * spectrum at the attack, completely different object a moment later.
 */
const DECAY_TILT = { warm: 0.4, metallic: 0.94 } as const;

function decayTilt(metallic: number): number {
  return DECAY_TILT.warm + (DECAY_TILT.metallic - DECAY_TILT.warm) * metallic;
}

/**
 * Seconds between events. Inverted against `dense` --- dense means more events,
 * so a shorter gap --- and exponential, because event rate is perceived
 * ratiometrically: 0.1s to 0.2s is a far bigger change than 2.0s to 2.1s.
 */
export function eventInterval(dense: number): number {
  return mapExp(1 - dense, INTERVAL_RANGE.min, INTERVAL_RANGE.max);
}

/**
 * How long each pluck rings. Sparse fields ring long; dense ones ring short,
 * so that raising `dense` adds events rather than turning them into a smear.
 */
export function eventDecay(dense: number): number {
  return mapExp(1 - dense, DECAY_RANGE.min, DECAY_RANGE.max);
}

/** How far an event may stray from the grid, as a fraction of the interval. */
export function jitterAmount(restless: number): number {
  return mapLinear(restless, 0, MAX_JITTER);
}

/** Frequency of one event: root from `register`, offset by a scale degree. */
export function eventFrequency(register: number, pick: number): number {
  const root = mapExp(register, ROOT_RANGE.min, ROOT_RANGE.max);
  const degree = SCALE[Math.floor(pick * SCALE.length) % SCALE.length] ?? 0;
  const octave =
    OCTAVES[Math.floor(pick * SCALE.length * OCTAVES.length) % OCTAVES.length] ??
    0;
  // An octave above the drone. Two sounds in the same critical band mask each
  // other, and the pad sustains while a pluck is brief --- so without the
  // separation the pad wins every time and the events are felt rather than
  // heard.
  return root * 2 ** ((degree + octave + 12) / 12);
}

export class EventLayer {
  readonly #engine: Engine;
  #timbre: Timbre = neutralTimbre();
  #timer: ReturnType<typeof setInterval> | null = null;
  #nextTime = 0;

  constructor(engine: Engine) {
    this.#engine = engine;
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  setTimbre(timbre: Timbre): void {
    this.#timbre = timbre;
  }

  start(): void {
    const ctx = this.#engine.context;
    if (!ctx || this.#timer !== null) return;
    this.#nextTime = ctx.currentTime + 0.08;
    this.#timer = setInterval(() => {
      this.#tick();
    }, TICK_MS);
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Schedule every event falling inside the lookahead window.
   *
   * The scheduling is done against the audio clock, not `setInterval`'s: timer
   * callbacks drift and are throttled in background tabs, whereas an event
   * given an explicit `AudioContext` time lands exactly there. The timer only
   * has to fire often enough that the window never runs dry.
   */
  #tick(): void {
    const ctx = this.#engine.context;
    const bus = this.#engine.voiceBus;
    if (!ctx || !bus) return;

    // A backgrounded tab stops firing the timer; on return, `nextTime` can be
    // far behind. Catching up would dump every missed event at once, so skip
    // the gap instead.
    if (this.#nextTime < ctx.currentTime) {
      this.#nextTime = ctx.currentTime + 0.02;
    }

    const horizon = ctx.currentTime + SCHEDULE_AHEAD;
    // Bounded rather than `while`: a bug that drove the interval toward zero
    // would otherwise hang the tab inside this loop.
    for (let guard = 0; guard < 64 && this.#nextTime < horizon; guard += 1) {
      this.#schedule(ctx, bus, this.#nextTime);

      const interval = eventInterval(this.#timbre.dense);
      const jitter = jitterAmount(this.#timbre.restless);
      const offset = (Math.random() * 2 - 1) * jitter * interval;
      this.#nextTime += Math.max(0.03, interval + offset);
    }
  }

  /**
   * One struck tone, built from the same partial series as the pad.
   *
   * A single oscillator per event left the plucks carrying almost none of the
   * prompt's identity --- the pad held all of it, so the pad had to be loud,
   * and a loud sustained layer masks everything. Giving each event its own
   * spectrum moves the character into the layer that punctuates rather than
   * the one that drones.
   */
  #schedule(ctx: AudioContext, bus: AudioNode, at: number): void {
    const t = this.#timbre;
    const decay = eventDecay(t.dense);
    const fundamental = eventFrequency(t.register, Math.random());
    const tilt = decayTilt(t.metallic);
    const nodes: AudioNode[] = [];

    PLUCK_PARTIALS.forEach((gain, index) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = fundamental * partialRatio(index, t.metallic);

      const envelope = ctx.createGain();
      // Upper partials decay faster than the fundamental, which is what makes
      // a struck sound read as struck: the strike is bright, the ring is not.
      const partialDecay = decay * tilt ** index;

      envelope.gain.setValueAtTime(0, at);
      // A short ramp rather than an instant jump: a step from 0 is a click at
      // the discontinuity.
      envelope.gain.linearRampToValueAtTime(PLUCK_LEVEL * gain, at + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + partialDecay);

      osc.connect(envelope).connect(bus);
      osc.start(at);
      osc.stop(at + partialDecay + 0.05);
      nodes.push(osc, envelope);

      // Nodes are single-use; without this the graph grows without bound.
      osc.addEventListener("ended", () => {
        for (const node of nodes) node.disconnect();
      });
    });
  }
}
