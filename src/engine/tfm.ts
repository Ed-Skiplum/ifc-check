/** TFM (tverrfaglig merkesystem): the sequence model, its regex, and the
 *  parse of one string into named segments.
 *
 * Ported from tfm-check (`backend/engine/constants.py`, `rules.py`), the
 * N=3 tool this repo reads as reference and never edits: the same nine
 * kodeledd, the same separators, the same per-part forms
 * (PLACEHOLDER_FALLBACK) and the same digit lock on the digit parts. The
 * Statsbygg PA 0802 rev.3 form is the default: `+ Lokasjon = Systemkode .
 * Løpenummer - Komponent Komp.nr`, e.g. `+123456=360.001-JV401`.
 *
 * Two departures, both deliberate:
 *   - a token is an object (`{part}`, `{sep}`, `{text}`) where tfm-check has
 *     a flat string with a `T:` sentinel for text, so the ruleset's JSON
 *     Schema can say what each one is;
 *   - the regex is anchored at both ends (tfm-check anchors the start only):
 *     the check is "this string IS the sequence", and trailing text is a
 *     deviation the parse names, not something a match silently ignores.
 *
 * Pure: no React, no model. The evaluator (`src/ids/evaluate.ts`) reads the
 * strings and the bound values off the elements; the walk's builder
 * (`src/ui/setup/TfmBuilder.tsx`) runs the same parse over the property's
 * values as you edit.
 */

import type { TfmPart, TfmSeparator, TfmToken } from "../ids/types.ts";

export const TFM_PARTS: readonly TfmPart[] = [
  "Lokasjon",
  "Rom",
  "Systemkode",
  "Etasje",
  "Subnr",
  "Løpenummer",
  "Komponent",
  "Komp.nr",
  "T-suffiks",
];

export const TFM_SEPARATORS: readonly TfmSeparator[] = ["+", ".", "-", "_", "/", " ", "=", "++"];

/** The parts a digit count may lock (tfm-check DIGIT_LOCKABLE_PARTS), so
 *  `{etasje}{subnr}` on "103" can read as "1" + "03". */
export const DIGIT_PARTS: readonly TfmPart[] = ["Etasje", "Subnr", "Komp.nr", "Løpenummer", "Rom"];

/** Each part's form when no digit count locks it (tfm-check
 *  PLACEHOLDER_FALLBACK: PA 0802 rev.3, looser where the standard is
 *  silent; Etasje, Subnr and Rom are project-local). */
export const PART_PATTERN: Readonly<Record<TfmPart, string>> = {
  Lokasjon: "[A-Za-z0-9]{6}",
  Rom: "\\d{1,5}",
  Systemkode: "\\d{3}",
  Etasje: "[A-Za-z0-9æøåÆØÅ_\\- ]{1,12}",
  Subnr: "\\d{1,4}",
  Løpenummer: "\\d{3}",
  Komponent: "[A-Z]{2}",
  "Komp.nr": "\\d{3}",
  "T-suffiks": "T?",
};

/** tfm-check PART_EXAMPLE: what a part shows when no real value does. */
const PART_EXAMPLE: Readonly<Record<TfmPart, string>> = {
  Lokasjon: "123456",
  Rom: "012",
  Systemkode: "244",
  Etasje: "01",
  Subnr: "01",
  Løpenummer: "001",
  Komponent: "DI",
  "Komp.nr": "001",
  "T-suffiks": "T",
};

/** Statsbygg PA 0802 rev.3 (tfm-check STATSBYGG_SEQUENCE). */
export const STATSBYGG_SEQUENCE: readonly TfmToken[] = [
  { sep: "+" },
  { part: "Lokasjon" },
  { sep: "=" },
  { part: "Systemkode" },
  { sep: "." },
  { part: "Løpenummer" },
  { sep: "-" },
  { part: "Komponent" },
  { part: "Komp.nr" },
];

/** The standard's own example. */
export const STATSBYGG_EXAMPLE = "+123456=360.001-JV401";

export function isPart(token: TfmToken): token is { part: TfmPart; digits?: number } {
  return "part" in token;
}

export function isDigitPart(part: TfmPart): boolean {
  return DIGIT_PARTS.includes(part);
}

/** A part's form: exactly `digits` digits when locked, else its own. */
export function partPattern(token: { part: TfmPart; digits?: number }): string {
  const n = token.digits;
  if (n !== undefined && Number.isInteger(n) && n > 0 && isDigitPart(token.part)) return `\\d{${n}}`;
  return PART_PATTERN[token.part];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** One token as a capturing group: its form, or its text escaped. */
function tokenSource(token: TfmToken): string {
  if ("part" in token) return `(${partPattern(token)})`;
  if ("sep" in token) return `(${escape(token.sep)})`;
  return `(${escape(token.text)})`;
}

/** The whole sequence as one regular expression source, anchored at both
 *  ends, one capturing group per token. What «Avansert» shows. */
export function tfmRegexSource(sequence: readonly TfmToken[]): string {
  return `^${sequence.map(tokenSource).join("")}$`;
}

export interface TfmSegment {
  /** Index into the sequence. */
  index: number;
  token: TfmToken;
  text: string;
  start: number;
  end: number;
}

/** A string read against a sequence. Off the sequence, `at` is where it
 *  leaves it (the end of the longest leading run of tokens that matches)
 *  and `token` the index of the first token that does not follow there;
 *  `token === sequence.length` when every token matched and text trails. */
export type TfmParse =
  | { ok: true; segments: TfmSegment[] }
  | { ok: false; at: number; token: number };

export interface TfmMatcher {
  sequence: readonly TfmToken[];
  regex: RegExp;
  parse(value: string): TfmParse;
}

/** A sequence compiled once, for parsing many strings. */
export function tfmMatcher(sequence: readonly TfmToken[]): TfmMatcher {
  const regex = new RegExp(tfmRegexSource(sequence));
  // The leading runs, built on the first miss only.
  let prefixes: RegExp[] | null = null;
  const leading = () =>
    (prefixes ??= sequence.map((_, k) => new RegExp(`^${sequence.slice(0, k + 1).map(tokenSource).join("")}`)));
  return {
    sequence,
    regex,
    parse(value) {
      const m = regex.exec(value);
      if (m) {
        let start = 0;
        const segments = sequence.map((token, index) => {
          const text = m[index + 1] ?? "";
          const segment = { index, token, text, start, end: start + text.length };
          start += text.length;
          return segment;
        });
        return { ok: true, segments };
      }
      const runs = leading();
      for (let k = runs.length - 1; k >= 0; k -= 1) {
        const hit = runs[k].exec(value);
        if (hit) return { ok: false, at: hit[0].length, token: k + 1 };
      }
      return { ok: false, at: 0, token: 0 };
    },
  };
}

/** The segment text of a part, by part, from a parse (the first token of
 *  that part when it occurs twice). */
export function partTexts(segments: readonly TfmSegment[]): Map<TfmPart, string> {
  const out = new Map<TfmPart, string>();
  for (const s of segments) if ("part" in s.token && !out.has(s.token.part)) out.set(s.token.part, s.text);
  return out;
}

const STANDARD_TEXTS: Map<TfmPart, string> = (() => {
  const parsed = tfmMatcher(STATSBYGG_SEQUENCE).parse(STATSBYGG_EXAMPLE);
  return parsed.ok ? partTexts(parsed.segments) : new Map();
})();

/** What a token shows with no real value: the standard example's text for a
 *  part it has, else tfm-check's example, fitted to a digit lock. */
export function exampleText(token: TfmToken): string {
  if ("sep" in token) return token.sep;
  if ("text" in token) return token.text;
  const base = STANDARD_TEXTS.get(token.part) ?? PART_EXAMPLE[token.part];
  const n = token.digits;
  if (n !== undefined && n > 0 && isDigitPart(token.part) && !new RegExp(`^${partPattern(token)}$`).test(base)) {
    return base.replace(/\D/g, "").padStart(n, "0").slice(-n);
  }
  return base;
}

/** The sequence as the summary names it: `+ Lokasjon = Systemkode . ...`. */
export function formatSequence(sequence: readonly TfmToken[]): string {
  return sequence
    .map((token) =>
      "part" in token
        ? token.part + (token.digits ? `{${token.digits}}` : "")
        : "sep" in token
          ? token.sep === " "
            ? "␣"
            : token.sep
          : `"${token.text}"`,
    )
    .join(" ");
}

export function sameSequence(a: readonly TfmToken[], b: readonly TfmToken[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `sequence` with the token at `from` moved to `to` (an index in the
 *  result). */
export function moveToken(sequence: readonly TfmToken[], from: number, to: number): TfmToken[] {
  const next = [...sequence];
  const [token] = next.splice(from, 1);
  if (token === undefined) return [...sequence];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, token);
  return next;
}

/** Whether a parsed segment agrees with an element's own value: the same
 *  text, or the value begins with it as a code before a name ("360
 *  Ventilasjon"). Literal: nothing is translated between code lists. */
export function agrees(segment: string, bound: string): boolean {
  if (segment === bound) return true;
  return bound.length > segment.length && bound.startsWith(segment) && /\s/.test(bound[segment.length]);
}

/** Whether a bound value can take the part's form at all, whole or as its
 *  first word. A bound part whose values never can is no comparison: the
 *  two read different things (PA 0802's two letters against a three-letter
 *  NS 3457-8 code), and the part is checked for shape only. */
export function fitsPart(token: { part: TfmPart; digits?: number }, bound: string): boolean {
  const re = new RegExp(`^(?:${partPattern(token)})$`);
  return re.test(bound) || re.test(bound.split(/\s/)[0] ?? "");
}
