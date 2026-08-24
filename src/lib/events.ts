import { mapExp, mapLinear } from "./mapping";
import { neutralTimbre, type Timbre } from "./timbre";
import type { Engine } from "./engine";

// The event layer: short plucks scheduled ahead of time, whose rate, register
// and decay follow the blended timbre. The pad alone morphs but never moves;
// this is what gives the field a pulse.

/** Minor pentatonic, in semitones. Every pair of these is consonant, which is
 * how "there is no way to play it wrong" survives contact with random pitch
 * selection --- a scale with no tritone cannot produce a sour interval. */
const SCALE = [0, 3, 5, 7, 10] as const;
const OCTAVES = [0, 12, 24] as const;

/** Seconds between scheduler ticks, and how far ahead each tick schedules. */
const TICK_MS = 25;
const SCHEDULE_AHEAD = 0.12;

const INTERVAL_RANGE = { min: 0.11, max: 2.4 } as const;
const DECAY_RANGE = { min: 0.18, max: 2.2 } as const;
const ROOT_RANGE = { min: 46, max: 233 } as const;
const MAX_JITTER = 0.55;

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
  // Plucks sit an octave above the drone so they read as a separate voice
  // rather than thickening the pad.
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

  #schedule(ctx: AudioContext, bus: AudioNode, at: number): void {
    const t = this.#timbre;
    const decay = eventDecay(t.dense);

    const osc = ctx.createOscillator();
    // Warm fields pluck with a triangle, metallic ones with a square: the odd
    // harmonics are what make the same envelope read as struck rather than
    // blown.
    osc.type = t.metallic > 0.5 ? "square" : "triangle";
    osc.frequency.value = eventFrequency(t.register, Math.random());

    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    // A short ramp rather than an instant jump: setValueAtTime on a gain of 0
    // produces a click at the discontinuity.
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.22, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    osc.connect(envelope).connect(bus);
    osc.start(at);
    osc.stop(at + decay + 0.05);
    // Nodes are single-use; without this the graph grows without bound.
    osc.addEventListener("ended", () => {
      osc.disconnect();
      envelope.disconnect();
    });
  }
}
