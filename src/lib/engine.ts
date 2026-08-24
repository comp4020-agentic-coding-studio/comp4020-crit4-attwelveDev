import { mapExp, mapLinear } from "./mapping";
import { neutralTimbre, type Timbre } from "./timbre";

// The pad layer: a drone whose every quality is driven by a blended timbre
// vector rather than by raw pointer coordinates. The engine never learns where
// the player is standing --- only what the field there sounds like.

/**
 * Partial ratios, harmonic through bell-like, interpolated by `metallic`.
 * The inharmonic set is roughly a struck-bar spectrum: the stretched, slightly
 * detuned partials are what make a bell read as metal rather than as a chord.
 */
const HARMONIC = [1, 1, 1.5, 2, 3] as const;
const INHARMONIC = [1, 1.04, 1.83, 2.67, 3.42] as const;
const PARTIAL_GAINS = [0.5, 0.38, 0.26, 0.17, 0.09] as const;
const PARTIAL_DETUNE = [-6, 5, -3, 4, -8] as const;

const ROOT_RANGE = { min: 46, max: 233 } as const; // F#1..A#3
const CUTOFF_RANGE = { min: 150, max: 9000 } as const;
const DRIVE_RANGE = { min: 1, max: 34 } as const;
const DETUNE_SPREAD_RANGE = { min: 1, max: 4.4 } as const;
const LFO_RATE_RANGE = { min: 0.05, max: 5.5 } as const;
const LFO_DEPTH_RANGE = { min: 0, max: 1400 } as const;

const GLIDE_SECONDS = 0.07;
const FADE_IN_SECONDS = 1.4;
const MASTER_LEVEL = 0.22;

const REVERB_SECONDS = 3.4;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  filter: BiquadFilterNode;
  drive: GainNode;
  makeup: GainNode;
  dry: GainNode;
  wet: GainNode;
  lfoRate: OscillatorNode;
  lfoDepth: GainNode;
  oscillators: OscillatorNode[];
}

/**
 * A fixed asymmetric-free soft-clip curve. The shape stays constant and the
 * amount of distortion is set by the gain feeding it --- rebuilding a
 * WaveShaper curve on every pointer move would allocate a 2048-sample array at
 * frame rate and still step discontinuously.
 */
// The explicit `<ArrayBuffer>` matters: TypeScript 6 makes the typed arrays
// generic over their backing buffer, and `WaveShaperNode.curve` accepts only
// the ArrayBuffer-backed form, not the SharedArrayBuffer one that the bare
// `Float32Array` alias widens to.
function softClipCurve(samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
}

/**
 * A reverb impulse generated from decaying noise rather than loaded from a
 * file. `spec/instrument.test.ts` forbids shipping audio assets --- sound has
 * to be made live, not played back --- and that constraint reaches the reverb
 * too, which is the right answer rather than an inconvenient one.
 */
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      // Exponential decay over uniform noise. The early samples carry the
      // density that reads as a room; the tail is what reads as distance.
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
  }
  return impulse;
}

export class Engine {
  #graph: Graph | null = null;
  #timbre: Timbre = neutralTimbre();

  get running(): boolean {
    return this.#graph?.ctx.state === "running";
  }

  /** The live AudioContext, for layers that schedule their own events. */
  get context(): AudioContext | null {
    return this.#graph?.ctx ?? null;
  }

  /** Where the event layer connects, so plucks share the pad's filter and space. */
  get voiceBus(): AudioNode | null {
    return this.#graph?.drive ?? null;
  }

  /**
   * Build the graph and start sounding. Must be called from a user gesture:
   * the autoplay policy leaves a fresh AudioContext suspended, so nothing
   * sounds before the player's first action.
   */
  async start(): Promise<void> {
    if (this.#graph) {
      if (this.#graph.ctx.state === "suspended") await this.#graph.ctx.resume();
      return;
    }

    const ctx = new AudioContext();

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    // Dry and wet meet at the master, so `distant` is a crossfade rather than
    // an extra layer piled on top.
    const dry = ctx.createGain();
    dry.connect(master);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, REVERB_SECONDS);
    const wet = ctx.createGain();
    wet.connect(reverb).connect(master);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.1;
    filter.connect(dry);
    filter.connect(wet);

    // Filter modulation. Depth is what `restless` moves; the rate rises with
    // it too, so restlessness is both wider and faster rather than just wider.
    const lfoRate = ctx.createOscillator();
    lfoRate.type = "sine";
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    lfoRate.connect(lfoDepth).connect(filter.frequency);
    lfoRate.start();

    const makeup = ctx.createGain();
    makeup.connect(filter);

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    shaper.connect(makeup);

    const drive = ctx.createGain();
    drive.connect(shaper);

    const oscillators = PARTIAL_GAINS.map((gain, index) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = PARTIAL_DETUNE[index] ?? 0;

      const level = ctx.createGain();
      level.gain.value = gain;

      osc.connect(level).connect(drive);
      osc.start();
      return osc;
    });

    this.#graph = {
      ctx,
      master,
      filter,
      drive,
      makeup,
      dry,
      wet,
      lfoRate,
      lfoDepth,
      oscillators,
    };
    this.#apply(0);

    master.gain.setTargetAtTime(
      MASTER_LEVEL,
      ctx.currentTime,
      FADE_IN_SECONDS / 3,
    );

    if (ctx.state === "suspended") await ctx.resume();
  }

  /** Set the sound. Safe to call before `start()`. */
  setTimbre(timbre: Timbre): void {
    this.#timbre = timbre;
    this.#apply(GLIDE_SECONDS);
  }

  get timbre(): Timbre {
    return this.#timbre;
  }

  async suspend(): Promise<void> {
    if (this.#graph?.ctx.state === "running") await this.#graph.ctx.suspend();
  }

  /**
   * Push the current timbre into the graph. `setTargetAtTime` rather than
   * assigning `.value`: assigning on every pointer move steps parameters at
   * frame rate, which is audible as zipper noise on a filter.
   */
  #apply(glide: number): void {
    if (!this.#graph) return;
    const { ctx, filter, drive, makeup, dry, wet, lfoRate, lfoDepth, oscillators } =
      this.#graph;
    const t = this.#timbre;
    const now = ctx.currentTime;

    // setTargetAtTime's third argument is a time constant, not a duration: the
    // parameter covers ~95% of the distance in 3x this. Zero is invalid, so an
    // immediate set uses the smallest sane step instead.
    const tau = glide > 0 ? glide / 3 : 0.001;
    const to = (param: AudioParam, value: number): void => {
      param.setTargetAtTime(value, now, tau);
    };

    const root = mapExp(t.register, ROOT_RANGE.min, ROOT_RANGE.max);
    const spread = mapLinear(
      t.rough,
      DETUNE_SPREAD_RANGE.min,
      DETUNE_SPREAD_RANGE.max,
    );

    oscillators.forEach((osc, index) => {
      const harmonic = HARMONIC[index] ?? 1;
      const inharmonic = INHARMONIC[index] ?? 1;
      const ratio = harmonic + (inharmonic - harmonic) * t.metallic;
      to(osc.frequency, root * ratio);
      to(osc.detune, (PARTIAL_DETUNE[index] ?? 0) * spread);
    });

    to(filter.frequency, mapExp(t.bright, CUTOFF_RANGE.min, CUTOFF_RANGE.max));

    // Drive and makeup move against each other so that turning up `rough`
    // changes the character without also changing how loud the instrument is.
    const driveGain = mapExp(t.rough, DRIVE_RANGE.min, DRIVE_RANGE.max);
    to(drive.gain, driveGain);
    to(makeup.gain, 1 / Math.sqrt(driveGain));

    to(lfoRate.frequency, mapExp(t.restless, LFO_RATE_RANGE.min, LFO_RATE_RANGE.max));
    to(lfoDepth.gain, mapLinear(t.restless, LFO_DEPTH_RANGE.min, LFO_DEPTH_RANGE.max));

    // Equal-power crossfade: a linear pair dips in level through the middle,
    // which reads as the instrument getting quieter halfway to "distant".
    to(dry.gain, Math.cos((t.distant * Math.PI) / 2));
    to(wet.gain, Math.sin((t.distant * Math.PI) / 2));
  }
}
