import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

// Sentence embeddings, client-side. This is the only part of the instrument
// that costs a download, so nothing imports it at startup --- the authored
// constellation plays instantly with no model, and this loads the first time
// someone actually types a prompt.

const MODEL = "Xenova/all-MiniLM-L6-v2";

let pending: Promise<FeatureExtractionPipeline> | null = null;

/** Load the model, once. Concurrent callers share the same promise. */
export function loadEmbedder(): Promise<FeatureExtractionPipeline> {
  pending ??= pipeline("feature-extraction", MODEL, { dtype: "q8" });
  return pending;
}

/** Whether the model is already in memory, so callers can skip a spinner. */
export function embedderReady(): boolean {
  return pending !== null;
}

/**
 * Embed one phrase as a unit-length vector.
 *
 * Mean pooling over tokens, then normalised, which is what makes a dot product
 * between two of these a cosine similarity --- the anchor projection relies on
 * that, so it is not an optional flag.
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await loadEmbedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(output.data as Iterable<number>);
}

/** Cosine similarity of two unit vectors, which is just their dot product. */
export function similarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
  return total;
}
