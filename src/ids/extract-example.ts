/** An `extract` pattern from one example value (2026-10-01, edkjo: "type an
 *  example code and get that reverse engineered as regex").
 *
 * The marked part of the example is the code. Every run of one kind of
 * character is generalised: uppercase letters to `[A-ZÆØÅ]{n}`, lowercase to
 * `[a-zæøå]{n}`, digits to `\d{n}`; anything else stays as an escaped literal.
 * The code goes in the one capture group and the pattern is anchored with
 * `^`. After the code, the tail is generalised the same way up to its first
 * whitespace, and from there on it is `.*`, the name that usually follows a
 * code ("231 Bærevegger").
 *
 * Pure: no DOM, no state. The selftest (`scripts/ids-cli.ts`) holds the cases.
 */

const UPPER = /[A-ZÆØÅ]/;
const LOWER = /[a-zæøå]/;
const DIGIT = /[0-9]/;

type Kind = "upper" | "lower" | "digit" | "other";

function kindOf(ch: string): Kind {
  if (UPPER.test(ch)) return "upper";
  if (LOWER.test(ch)) return "lower";
  if (DIGIT.test(ch)) return "digit";
  return "other";
}

const CLASS: Record<Exclude<Kind, "other">, string> = {
  upper: "[A-ZÆØÅ]",
  lower: "[a-zæøå]",
  digit: "\\d",
};

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The runs of `text` as pattern pieces. */
export function generalise(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const kind = kindOf(text[i]);
    let j = i + 1;
    while (j < text.length && kindOf(text[j]) === kind) j += 1;
    const run = text.slice(i, j);
    if (kind === "other") out += escapeLiteral(run);
    else out += CLASS[kind] + (run.length > 1 ? `{${run.length}}` : "");
    i = j;
  }
  return out;
}

/** The pattern for `example` with `[start, end)` as the code. A range that is
 *  empty or out of bounds marks the whole value. */
export function extractFromExample(example: string, start = 0, end = example.length): string {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(example.length, Math.max(start, end));
  if (s === e) {
    s = 0;
    e = example.length;
  }
  const head = example.slice(0, s);
  const code = example.slice(s, e);
  const tail = example.slice(e);
  const space = tail.search(/\s/);
  const tailPattern =
    space === -1 ? generalise(tail) : generalise(tail.slice(0, space)) + ".*";
  return `^${generalise(head)}(${generalise(code)})${tailPattern}`;
}
