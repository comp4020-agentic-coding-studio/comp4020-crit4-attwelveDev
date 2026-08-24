// Pure control-value maths. The navigation layer works entirely in normalised
// 0..1 coordinates so it stays testable without an AudioContext or a DOM; these
// helpers are the only place that range meets real units.

/** Clamp into the 0..1 range, treating NaN as 0 rather than propagating it. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Map a control value onto a frequency range exponentially, so equal movements
 * of the hand feel like equal musical intervals rather than equal numbers of
 * hertz. Linear frequency mapping is the classic reason a filter sweep feels
 * like it does nothing for the top two thirds of its travel.
 *
 * Both bounds must be positive — a range through zero has no ratio.
 */
export function mapExp(value01: number, min: number, max: number): number {
  if (min <= 0 || max <= 0) {
    throw new RangeError(`mapExp needs positive bounds, got ${min}..${max}`);
  }
  return min * (max / min) ** clamp01(value01);
}

/** Map a control value onto a range linearly, for units without a ratio feel. */
export function mapLinear(value01: number, min: number, max: number): number {
  return min + (max - min) * clamp01(value01);
}
