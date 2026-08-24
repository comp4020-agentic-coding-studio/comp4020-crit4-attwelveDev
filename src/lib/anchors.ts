import { embed, similarity } from "./embedding";
import { clamp01 } from "./mapping";
import { TIMBRE_AXES, type Timbre } from "./timbre";

// Text to sound, without a model that knows anything about audio.
//
// Each timbre axis is anchored by a pair of opposed descriptions. A prompt's
// position on that axis is how much closer it sits to one pole than the other
// in embedding space. Nothing here is trained: the sound of a phrase falls out
// of a general-purpose language model's sense of what the phrase means, and the
// anchors are the only place audio knowledge enters.
//
// Anchors are phrases rather than single words because a mean-pooled sentence
// embedding of one word is dominated by that word's other senses --- "bright"
// alone sits as close to daylight and cleverness as to treble.

export interface Anchor {
  axis: keyof Timbre;
  positive: string;
  negative: string;
}

export const ANCHORS: readonly Anchor[] = [
  {
    axis: "bright",
    positive: "bright brilliant crisp shimmering glassy sound",
    negative: "dark muffled dull murky smothered sound",
  },
  {
    axis: "rough",
    positive: "rough harsh gritty distorted abrasive sound",
    negative: "smooth clean pure gentle polished sound",
  },
  {
    axis: "dense",
    positive: "dense busy crowded teeming relentless activity",
    negative: "sparse empty bare occasional isolated activity",
  },
  {
    axis: "restless",
    positive: "restless agitated trembling flickering unstable motion",
    negative: "calm steady motionless settled sustained stillness",
  },
  {
    axis: "distant",
    positive: "distant faraway echoing cavernous reverberant space",
    negative: "close intimate dry pressed against the ear",
  },
  {
    axis: "metallic",
    positive: "metallic clanging bell-like ringing struck metal",
    negative: "warm wooden soft mellow breathy organic",
  },
  {
    axis: "register",
    positive: "high pitched soaring piercing treble",
    negative: "low deep rumbling subterranean bass",
  },
];

/**
 * How hard a small similarity difference is pushed toward the extremes.
 *
 * Cosine differences between two anchor poles are small --- a strongly "dark"
 * phrase might sit only 0.15 closer to the dark pole than the bright one ---
 * so without gain every prompt lands in a narrow band around neutral and the
 * whole field sounds the same. Calibrated against the authored constellation
 * so its spread roughly matches what a person chose by hand.
 */
const AXIS_GAIN = 7.5;

export type AnchorVectors = Map<keyof Timbre, [Float32Array, Float32Array]>;

/** Embed every anchor phrase. Cached by the embedder; call once per session. */
export async function buildAnchors(): Promise<AnchorVectors> {
  const vectors: AnchorVectors = new Map();
  for (const anchor of ANCHORS) {
    const positive = await embed(anchor.positive);
    const negative = await embed(anchor.negative);
    vectors.set(anchor.axis, [positive, negative]);
  }
  return vectors;
}

/**
 * Place an embedded phrase on all seven axes.
 *
 * `tanh` rather than a linear scale with a clamp: it saturates smoothly, so a
 * phrase that sits far past the anchor still lands inside the range instead of
 * flattening against a hard edge, and the differences between moderate phrases
 * --- where most real prompts live --- stay legible.
 */
export function projectToTimbre(
  embedding: Float32Array,
  anchors: AnchorVectors,
): Timbre {
  const timbre = {} as Timbre;
  for (const axis of TIMBRE_AXES) {
    const pair = anchors.get(axis);
    if (!pair) {
      timbre[axis] = 0.5;
      continue;
    }
    const [positive, negative] = pair;
    const lean = similarity(embedding, positive) - similarity(embedding, negative);
    timbre[axis] = clamp01(Math.tanh(lean * AXIS_GAIN) * 0.5 + 0.5);
  }
  return timbre;
}

/** Embed and project in one step. */
export async function timbreForText(
  text: string,
  anchors: AnchorVectors,
): Promise<Timbre> {
  return projectToTimbre(await embed(text), anchors);
}
