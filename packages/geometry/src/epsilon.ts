/**
 * Tolerances.
 *
 * Every tolerance here is *relative*. A font is edited in design units where an
 * em is typically 1000 or 2048 units wide, but the same kernel has to stay
 * correct on a curve five units across. An absolute epsilon would be either
 * uselessly tight at one scale or dangerously loose at the other, so the
 * predicates below normalise by the magnitudes of the inputs before comparing.
 *
 * This is a deliberate departure from the Tunni-Lines prototype, which compared
 * a raw cross-product determinant against `0` and a point-to-line distance
 * against a literal `7`.
 */

/** Relative tolerance for "these two lines are parallel", compared against |sin θ|. */
export const PARALLEL_EPS = 1e-9;

/** Relative tolerance for "this point lies on this line", compared against |sin θ|. */
export const COLLINEAR_EPS = 1e-9;

/** Relative tolerance for "these two points are the same point". */
export const COINCIDENT_EPS = 1e-9;

/** Default flatness tolerance for curve subdivision, in design units. */
export const FLATTEN_TOLERANCE = 0.1;

/**
 * True when `value` is within `eps` of `reference` in magnitude.
 *
 * `reference` is the scale the comparison is relative to — typically a product
 * of vector lengths. When `reference` is zero the inputs are degenerate and the
 * answer is `true`, because everything is near zero at zero scale.
 */
export function isNegligible(value: number, reference: number, eps: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return false;
  return Math.abs(value) <= eps * Math.abs(reference);
}
