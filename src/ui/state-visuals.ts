/** Rule-result states, each as a whole-element fill plus a glyph.
 *
 * Colour never carries a state on its own — every element also prints a glyph
 * and the state's name, so the strip survives a black-and-white print and a
 * colour-blind reader. `not_applicable` is deliberately nowhere near green, and
 * `not_evaluable` is nowhere near either green or red: it is the state that
 * says the answer is unknown.
 */

import type { ResultState } from "../ids/evaluate.ts";

export const RESULT_GLYPH: Record<ResultState, string> = {
  pass: "✓",
  fail: "✗",
  not_applicable: "–",
  not_evaluable: "?",
};

/** Whole-element fill. Not a tint, not a border, not a corner dot. */
export const RESULT_FILL: Record<ResultState, string> = {
  pass: "bg-green text-cream",
  fail: "bg-bad text-cream",
  not_applicable: "bg-muted text-ink",
  not_evaluable: "bg-gold text-ink",
};
