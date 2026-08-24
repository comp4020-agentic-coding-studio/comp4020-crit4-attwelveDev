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

/**
 * The ratio of partial `index` at a given `metallic`. Shared with the event
 * layer so a pluck is built from the same spectrum as the pad --- otherwise
 * the two layers disagree about what the prompt sounds like, and whichever is
 * louder wins.
 */
export function partialRatio(index: number, metallic: number): number {
  const harmonic = HARMONIC[index] ?? 1;
  const inharmonic = INHARMONIC[index] ?? 1;
  return harmonic + (inharmonic - harmonic) * metallic;
}
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
/**
 * The floor is well above 1: a cutoff sitting on the fundamental passes only
 * the fundamental, and a single low sine is exactly what "a hum" means. Even
 * the darkest prompt keeps a few harmonics so it reads as an instrument
 * rather than a test tone.
 */
const CUTOFF_RATIO = { min: 2.2, max: 48 } as const;
const CUTOFF_CEILING = 15_000;

/**
 * The pad is a bed, not the lead voice. It sustains, so the ear stops hearing
 * it as information within a second or two while it goes on masking anything
 * sharing its critical band --- which is how a drone can be simultaneously
 * boring and overwhelming. It also thins as the field gets denser, to leave
 * room for the events that carry the actual character.
 */
const PAD_LEVEL = { base: 0.13, denseCut: 0.06 } as const;

/** Just under the fundamental: removes rumble and shaper DC without touching
 * the note. Because it tracks the root, low prompts keep their weight and high
 * ones genuinely lose their bottom --- which is what makes the low end vary
 * across the field instead of droning identically under everything. */
const HIGHPASS_RATIO = 0.62;

const DRIVE_RANGE = { min: 1, max: 6 } as const;
const DETUNE_SPREAD_RANGE = { min: 1, max: 4.4 } as const;
const LFO_RATE_RANGE = { min: 0.05, max: 5.5 } as const;
/**
 * Modulation depth as a fraction of the cutoff, not an absolute number of
 * hertz. A fixed +/-1400Hz swing is a gentle shimmer on a bright prompt and a
 * violent warble on a dark one, where it drives the cutoff below the
 * fundamental and back on every cycle.
 */
const LFO_DEPTH_RATIO = 0.62;

const GLIDE_SECONDS = 0.07;
const FADE_IN_SECONDS = 1.4;
const MASTER_LEVEL = 0.44;

const REVERB_SECONDS = 2.2;

/** Silence before the tail starts. Separating the reverb from the sound that
 * caused it is most of what makes a wet signal stay legible. */
const PRE_DELAY_SECONDS = 0.018;

/** One-pole coefficients for the impulse's damping, early to late. Lower is
 * darker, so the tail loses its top as it decays. */
const IR_DAMPING = { start: 0.34, end: 0.035 } as const;

/**
 * `distant` never reaches fully wet. A signal with no dry component left has
 * no transients and no definition --- and with the reverb carrying the sound,
 * whatever texture the impulse has becomes the texture of the prompt.
 */
const MAX_WET = 0.82;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  voiceIn: GainNode;
  padLevel: GainNode;
  clean: GainNode;
  drive: GainNode;
  makeup: GainNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  lowpass2: BiquadFilterNode;
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
  const rate = ctx.sampleRate;
  const pre = Math.max(1, Math.floor(rate * PRE_DELAY_SECONDS));
  const tail = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, pre + tail, rate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    // One-pole lowpass whose cutoff falls as the tail decays. Undamped white
    // noise is the whole problem: convolving with it smears every partial into
    // a band of noise around itself, which is a hiss, not a room. Real spaces
    // absorb high frequencies far faster than low ones, and that progressive
    // damping is what makes a tail read as air rather than static.
    let lowpassed = 0;
    let peak = 0;

    for (let i = 0; i < tail; i += 1) {
      const t = i / tail;
      const coeff = IR_DAMPING.start - (IR_DAMPING.start - IR_DAMPING.end) * t;
      lowpassed += coeff * (Math.random() * 2 - 1 - lowpassed);
      const value = lowpassed * (1 - t) ** 2.2;
      samples[pre + i] = value;
      peak = Math.max(peak, Math.abs(value));
    }

    // The damping costs most of the amplitude, so normalise back to a known
    // level rather than leaving wet gain to compensate for a filter constant.
    if (peak > 0) {
      for (let i = pre; i < samples.length; i += 1) {
        samples[i] = (samples[i] ?? 0) / peak;
      }
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

    // A safety net, not a mix bus compressor. The first version sat at -10dB
    // with 12:1 and a 3ms attack, which is a brick wall: it caught every pluck
    // transient and squashed it back down to the pad's level, destroying the
    // exact contrast that makes an event audible over a drone. Levels below
    // are set so this rarely engages at all.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 6;
    // Slow enough that a pluck's 8ms attack passes through before the gain
    // reduction arrives.
    limiter.attack.value = 0.015;
    limiter.release.value = 0.3;
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

    // Two cascaded lowpass stages rather than one. A single biquad rolls off
    // at 12dB/octave, which measured as the weakest axis in the instrument ---
    // a gentle tilt rather than a filter you notice. Cascading doubles the
    // slope to 24dB/octave, which is what a synth filter normally is, and it
    // is the difference between "slightly duller" and "closed".
    const lowpass2 = ctx.createBiquadFilter();
    lowpass2.type = "lowpass";
    lowpass2.Q.value = 0.7;
    lowpass2.connect(dry);
    lowpass2.connect(wet);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.value = 1.1;
    lowpass.connect(lowpass2);

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
    lfoRate.connect(lfoDepth);
    lfoDepth.connect(lowpass.frequency);
    lfoDepth.connect(lowpass2.frequency);
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

    // The pad passes through its own level control on the way to the shared
    // bus; the event layer connects to the bus directly. Without this the two
    // are locked together and the sustained layer always wins.
    const padLevel = ctx.createGain();
    padLevel.connect(voiceIn);

    const oscillators = PARTIAL_GAINS.map((gain, index) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.detune.value = PARTIAL_DETUNE[index] ?? 0;

      const level = ctx.createGain();
      level.gain.value = gain;

      osc.connect(level).connect(padLevel);
      osc.start();
      return osc;
    });

    this.#graph = {
      ctx,
      master,
      voiceIn,
      padLevel,
      clean,
      drive,
      makeup,
      highpass,
      lowpass,
      lowpass2,
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
      padLevel,
      clean,
      drive,
      makeup,
      highpass,
      lowpass,
      lowpass2,
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
      to(osc.frequency, root * partialRatio(index, t.metallic));
      to(osc.detune, (PARTIAL_DETUNE[index] ?? 0) * spread);
    });

    to(padLevel.gain, PAD_LEVEL.base - t.dense * PAD_LEVEL.denseCut);

    to(highpass.frequency, root * HIGHPASS_RATIO);
    const cutoff = Math.min(
      CUTOFF_CEILING,
      root * mapExp(t.bright, CUTOFF_RATIO.min, CUTOFF_RATIO.max),
    );
    to(lowpass.frequency, cutoff);
    to(lowpass2.frequency, cutoff);

    // Equal-power crossfade between clean and shaped, so `rough` changes the
    // character without also changing how loud the instrument is. Makeup gain
    // compensates the drive so the shaped path arrives at a matched level.
    const driveGain = mapExp(t.rough, DRIVE_RANGE.min, DRIVE_RANGE.max);
    to(drive.gain, driveGain);
    to(makeup.gain, Math.sin((t.rough * Math.PI) / 2) / Math.sqrt(driveGain));
    to(clean.gain, Math.cos((t.rough * Math.PI) / 2));

    to(lfoRate.frequency, mapExp(t.restless, LFO_RATE_RANGE.min, LFO_RATE_RANGE.max));
    to(lfoDepth.gain, cutoff * LFO_DEPTH_RATIO * t.restless);

    // Equal-power again: a linear pair dips in level through the middle, which
    // reads as the instrument getting quieter halfway to "distant".
    const wetness = t.distant * MAX_WET;
    to(dry.gain, Math.cos((wetness * Math.PI) / 2));
    to(wet.gain, Math.sin((wetness * Math.PI) / 2));
  }
}
