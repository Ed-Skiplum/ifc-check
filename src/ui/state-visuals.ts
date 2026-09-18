/** Verdict and rule-result states, each as a whole-element fill plus a glyph.
 *
 * Colour never carries a state on its own — every element also prints a glyph
 * and the state's name, so a verdict survives a black-and-white print and a
 * colour-blind reader. That is the traffic-light primitive the delivered
 * Skiplum reports use (cell + text + dot), in the ATELIER palette.
 *
 * Two vocabularies, deliberately separate, on two surfaces:
 *
 *   Verdict      what a UNIVERSAL check says about the file with no ruleset
 *                loaded — Bestått · Advarsel · Avvik · N/A.
 *   ResultState  what a PROJECT rule says — pass · fail · not_applicable ·
 *                not_evaluable.
 *
 * `not_applicable` is deliberately nowhere near green, and `not_evaluable` is
 * nowhere near either green or red: it is the state that says the answer is
 * unknown.
 */

import type { Verdict } from "../engine/types";
import type { ResultState } from "../ids/evaluate.ts";

export const VERDICT_GLYPH: Record<Verdict, string> = {
  pass: "✓",
  warn: "!",
  fail: "✗",
  na: "–",
};

/** Whole-element fill. Not a tint, not a border, not a corner dot, and never
 *  a left-edge stripe. */
export const VERDICT_FILL: Record<Verdict, string> = {
  pass: "bg-green text-cream",
  warn: "bg-gold text-ink",
  fail: "bg-bad text-cream",
  na: "bg-muted text-cream",
};

export const RESULT_GLYPH: Record<ResultState, string> = {
  pass: "✓",
  fail: "✗",
  not_applicable: "–",
  not_evaluable: "?",
};

export const RESULT_FILL: Record<ResultState, string> = {
  pass: "bg-green text-cream",
  fail: "bg-bad text-cream",
  not_applicable: "bg-muted text-cream",
  not_evaluable: "bg-gold text-ink",
};

/** A project rule speaking for a universal check overrides its verdict: the
 *  number now belongs to the rule that claimed it. `not_evaluable` lands on
 *  Advarsel rather than N/A — the evaluator could not answer, which is a thing
 *  to look at, not a thing that does not apply. */
export const VERDICT_OF_RESULT: Record<ResultState, Verdict> = {
  pass: "pass",
  fail: "fail",
  not_applicable: "na",
  not_evaluable: "warn",
};
