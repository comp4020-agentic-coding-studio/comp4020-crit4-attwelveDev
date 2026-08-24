// How much each prompt is heard, given where the player is standing.

export interface Point {
  x: number;
  y: number;
}

/** How tightly the blend selects. Small is a spotlight, large is a wash. */
export const FOCUS_RANGE = { min: 0.06, max: 0.55 } as const;
export const DEFAULT_FOCUS = 0.22;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Normalised Gaussian weights for each position, relative to the player.
 *
 * Gaussian falloff rather than inverse distance: inverse distance goes to
 * infinity as the player crosses a prompt, so standing exactly on one is a
 * division by zero, and near-misses produce a spike you can hear as a lurch.
 * A Gaussian is smooth and finite everywhere, and its width is a parameter
 * worth playing --- `focus` is what makes one prompt a spotlight or lets six
 * of them wash together.
 *
 * Returns weights summing to 1. Far from everything with a tight focus, every
 * exponential underflows to zero; rather than divide by zero, all the weight
 * goes to the nearest prompt, so the field never goes silent or produces NaN.
 */
export function gaussianWeights(
  player: Point,
  positions: readonly Point[],
  focus: number = DEFAULT_FOCUS,
): number[] {
  if (positions.length === 0) return [];

  const sigma = Math.max(focus, 1e-4);
  const raw = positions.map((position) =>
    Math.exp(-(distance(player, position) ** 2) / (2 * sigma ** 2)),
  );

  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total > 0 && Number.isFinite(total)) {
    return raw.map((value) => value / total);
  }

  // Everything underflowed. Fall back to winner-takes-all on the nearest.
  const distances = positions.map((position) => distance(player, position));
  let nearest = 0;
  for (const [index, d] of distances.entries()) {
    if (d < (distances[nearest] ?? Infinity)) nearest = index;
  }
  return positions.map((_, index) => (index === nearest ? 1 : 0));
}
