import { mapExp, mapLinear } from "./mapping";
import { neutralTimbre, type Timbre } from "./timbre";

// The pad layer: a drone whose every quality is driven by a blended timbre
// vector rather than by raw pointer coordinates. The engine never learns where
// the player is standing --- only what the field there sounds like.

/**
 * Partial ratios, interpolated by `metallic`.
 *
 * Sine partials rather than sawtooths: a saw already contains every harmonic
 * at 1/n, so five detuned saws leave nothing for the timbre axes to control
 * and everything sounds like the same buzz. Additive sines start from silence
 * and let each axis actually add something.
 *
 * The inharmonic set is the ideal-bar mode series, which is what makes a
 * struck bell read as metal rather than as a chord --- the partials are
 * stretched far wider than any harmonic series goes.
 */
const HARMONIC = [1, 2, 3, 4, 6] as const;
const INHARMONIC = [1, 2.76, 5.4, 8.93, 13.34] as const;
const PARTIAL_GAINS = [0.5, 0.26, 0.17, 0.11, 0.07] as const;
const PARTIAL_DETUNE = [0, 4, -3, 5, -6] as const;

/** A2..D5. Low enough to feel, high enough that timbre is audible. */
export const ROOT_RANGE = { min: 110, max: 587 } as const;

/**
 * Brightness is a ratio against the fundamental, not an absolute frequency.
 * A 100Hz tone cut at 2kHz is bright; a 1kHz tone cut at 2kHz is dull. Tying
 * the cutoff to the root keeps "bright" meaning the same thing everywhere in
 * the field, and guarantees the filter never sits below the fundamental and
 * silences the voice.
 */
const CUTOFF_RATIO = { min: 1.15, max: 17 } as const;
const CUTOFF_CEILING = 14_000;

/** Just under the fundamental: removes rumble and shaper DC without touching
 * the note. Because it tracks the root, low prompts keep their weight and high
 * ones genuinely lose their bottom --- which is what makes the low end vary
 * across the field instead of droning identically under everything. */
const HIGHPASS_RATIO = 0.62;

const DRIVE_RANGE = { min: 1, max: 11 } as const;
const DETUNE_SPREAD_RANGE = { min: 1, max: 4.4 } as const;
const LFO_RATE_RANGE = { min: 0.05, max: 5.5 } as const;
const LFO_DEPTH_RANGE = { min: 0, max: 1400 } as const;

const GLIDE_SECONDS = 0.07;
const FADE_IN_SECONDS = 1.4;
const MASTER_LEVEL = 0.34;

const REVERB_SECONDS = 3.4;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  voiceIn: GainNode;
  clean: GainNode;
  drive: GainNode;
  makeup: GainNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  lfoRate: OscillatorNode;
  lfoDepth: GainNode;
  oscillators: OscillatorNode[];
}

/**
 * A fixed soft-clip curve. The shape stays constant and the amount of
 * distortion is set by the gain feeding it --- rebuilding a WaveShaper curve on
 * every pointer move would allocate a 2048-sample array at frame rate and still
 * step discontinuously.
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

  /** Where the event layer connects, so plucks share the pad's colour and space. */
  get voiceBus(): AudioNode | null {
    return this.#graph?.voiceIn ?? null;
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

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.value = 1.1;
    lowpass.connect(dry);
    lowpass.connect(wet);

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.Q.value = 0.7;
    highpass.connect(lowpass);

    // Filter modulation. Depth is what `restless` moves; the rate rises with
    // it too, so restlessness is both wider and faster rather than just wider.
    const lfoRate = ctx.createOscillator();
    lfoRate.type = "sine";
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    lfoRate.connect(lfoDepth).connect(lowpass.frequency);
    lfoRate.start();

    // Two parallel paths into the filters. `rough` crossfades between them, so
    // a smooth prompt is genuinely clean rather than lightly distorted ---
    // running everything through the shaper at all times imposes the shaper's
    // own harmonic signature on every prompt and flattens the differences
    // between them.
    const clean = ctx.createGain();
    clean.connect(highpass);

    const makeup = ctx.createGain();
    makeup.connect(highpass);

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    shaper.connect(makeup);

    const drive = ctx.createGain();
    drive.connect(shaper);

    // Everything that makes sound arrives here: the pad's partials and the
    // event layer's plucks alike, so both take the same colour and space.
    const voiceIn = ctx.createGain();
    voiceIn.connect(clean);
    voiceIn.connect(drive);

    const oscillators = PARTIAL_GAINS.map((gain, index) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.detune.value = PARTIAL_DETUNE[index] ?? 0;

      const level = ctx.createGain();
      level.gain.value = gain;

      osc.connect(level).connect(voiceIn);
      osc.start();
      return osc;
    });

    this.#graph = {
      ctx,
      master,
      voiceIn,
      clean,
      drive,
      makeup,
      highpass,
      lowpass,
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
    const {
      ctx,
      clean,
      drive,
      makeup,
      highpass,
      lowpass,
      dry,
      wet,
      lfoRate,
      lfoDepth,
      oscillators,
    } = this.#graph;
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

    to(highpass.frequency, root * HIGHPASS_RATIO);
    to(
      lowpass.frequency,
      Math.min(
        CUTOFF_CEILING,
        root * mapExp(t.bright, CUTOFF_RATIO.min, CUTOFF_RATIO.max),
      ),
    );

    // Equal-power crossfade between clean and shaped, so `rough` changes the
    // character without also changing how loud the instrument is. Makeup gain
    // compensates the drive so the shaped path arrives at a matched level.
    const driveGain = mapExp(t.rough, DRIVE_RANGE.min, DRIVE_RANGE.max);
    to(drive.gain, driveGain);
    to(makeup.gain, Math.sin((t.rough * Math.PI) / 2) / Math.sqrt(driveGain));
    to(clean.gain, Math.cos((t.rough * Math.PI) / 2));

    to(lfoRate.frequency, mapExp(t.restless, LFO_RATE_RANGE.min, LFO_RATE_RANGE.max));
    to(lfoDepth.gain, mapLinear(t.restless, LFO_DEPTH_RANGE.min, LFO_DEPTH_RANGE.max));

    // Equal-power again: a linear pair dips in level through the middle, which
    // reads as the instrument getting quieter halfway to "distant".
    to(dry.gain, Math.cos((t.distant * Math.PI) / 2));
    to(wet.gain, Math.sin((t.distant * Math.PI) / 2));
  }
}
