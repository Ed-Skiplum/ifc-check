/** The four check states, each as a whole-cell fill plus a glyph.
 *
 * Colour never carries a state on its own — every cell also prints a glyph and
 * the state's name, so the matrix survives a black-and-white print and a
 * colour-blind reader. `not_applicable` is deliberately nowhere near green.
 */

import type { CheckState } from "../engine/types";

export const STATE_GLYPH: Record<CheckState, string> = {
  pass: "✓",
  fail: "✗",
  review: "!",
  not_applicable: "–",
};

/** Whole-cell fill. Not a tint, not a border, not a corner dot. */
export const STATE_FILL: Record<CheckState, string> = {
  pass: "bg-green text-cream",
  fail: "bg-bad text-cream",
  review: "bg-gold text-ink",
  not_applicable: "bg-muted text-ink",
};
