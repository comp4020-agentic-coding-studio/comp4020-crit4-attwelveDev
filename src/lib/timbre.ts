// A prompt's sound, as a point on seven axes. Every value is 0..1, and the
// names say which pole 1 is: `bright` 0 is dark, `metallic` 0 is warm.
//
// This is deliberately the shape a semantic projection would produce --- one
// scalar per bipolar anchor pair --- so that authored vectors and embedded
// ones are interchangeable and the synthesis layer never learns which it got.

export interface Timbre {
  /** Filter cutoff. 0 dark, 1 bright. */
  bright: number;
  /** Waveshaper drive and detune spread. 0 smooth, 1 rough. */
  rough: number;
  /** Event rate. 0 sparse, 1 dense. */
  dense: number;
  /** Filter modulation depth and timing jitter. 0 still, 1 restless. */
  restless: number;
  /** Reverb send against dry level. 0 near, 1 distant. */
  distant: number;
  /** Partial ratios, harmonic through bell-like. 0 warm, 1 metallic. */
  metallic: number;
  /** Root frequency of the drone. 0 low, 1 high. */
  register: number;
}

export const TIMBRE_AXES = [
  "bright",
  "rough",
  "dense",
  "restless",
  "distant",
  "metallic",
  "register",
] as const satisfies readonly (keyof Timbre)[];

/** A timbre at the centre of every axis --- the fallback when nothing is near. */
export function neutralTimbre(): Timbre {
  return {
    bright: 0.5,
    rough: 0.5,
    dense: 0.5,
    restless: 0.5,
    distant: 0.5,
    metallic: 0.5,
    register: 0.5,
  };
}

/**
 * Weighted mean of several timbres, axis by axis.
 *
 * Weights are expected to be normalised (see `gaussianWeights`); this does not
 * renormalise, because a caller passing unnormalised weights has a bug worth
 * hearing rather than one worth silently absorbing. Mismatched lengths and an
 * empty set both fall back to neutral rather than producing NaN, since a NaN
 * reaching an AudioParam throws and takes the voice with it.
 */
export function blendTimbres(
  timbres: readonly Timbre[],
  weights: readonly number[],
): Timbre {
  if (timbres.length === 0 || timbres.length !== weights.length) {
    return neutralTimbre();
  }

  const blended = {} as Timbre;
  for (const axis of TIMBRE_AXES) {
    let total = 0;
    for (const [index, timbre] of timbres.entries()) {
      total += timbre[axis] * (weights[index] ?? 0);
    }
    blended[axis] = total;
  }
  return blended;
}
