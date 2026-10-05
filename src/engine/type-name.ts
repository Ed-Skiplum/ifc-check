/** A type name scheme compiled to one anchored matcher, and a parse that
 *  says which part a name leaves it at (2026-10-05, edkjo: "The important
 *  thing is that everything is typed, and it should be possible to set a
 *  naming scheme by regex or by accepted value lists" · "NS3457-8 and NS3451
 *  as options to select. Can also be a hybrid").
 *
 * Pure. One named group per part, so a part's own regex may carry groups of
 * its own. A list part is its codes, longest first (the reserved ones left
 * out: "Koden skal ikke benyttes"); a value list part its values, longest
 * first; both escaped. The whole name must match. Off the scheme, `at` is
 * the end of the longest leading run of parts that matches, `part` the index
 * of the part that does not follow there (`sequence.length` when text
 * trails), as the TFM parse (`tfm.ts`) says it.
 */

import { CODE_LISTS } from "../codelists/index.ts";
import type { NamePart } from "../ids/types.ts";

/** POFIN 2.1 EIR bygg, Objekttypenavn (NS 8360-1): NS 3457-8 component class
 *  + "." + a project-unique type number, DUZ.001. The number's width is not
 *  set by the standard. */
export const POFIN_TYPE_NAME: readonly NamePart[] = [{ list: "ns3457-8" }, { text: "." }, { regex: "\\d+" }];

export const POFIN_TYPE_NAME_EXAMPLE = "DUZ.001";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const longestFirst = (codes: readonly string[]) =>
  [...new Set(codes)].filter((c) => c !== "").sort((a, b) => b.length - a.length || a.localeCompare(b));

/** One part's pattern, without its group. */
export function partSource(part: NamePart): string {
  if ("list" in part) {
    const list = CODE_LISTS[part.list];
    const reserved = new Set(list.reserved ?? []);
    return longestFirst(Object.keys(list.codes).filter((c) => !reserved.has(c))).map(escape).join("|");
  }
  if ("values" in part) return longestFirst(part.values).map(escape).join("|") || "(?!)";
  if ("regex" in part) return part.regex;
  return escape(part.text);
}

const group = (part: NamePart, i: number) => `(?<p${i}>${partSource(part)})`;

export type NameParse = { ok: true; texts: string[] } | { ok: false; at: number; part: number };

export interface NameMatcher {
  parse(value: string): NameParse;
}

/** A scheme compiled once. Throws on a part whose regex does not compile. */
export function nameMatcher(sequence: readonly NamePart[]): NameMatcher {
  const regex = new RegExp(`^${sequence.map(group).join("")}$`);
  let prefixes: RegExp[] | null = null;
  const leading = () =>
    (prefixes ??= sequence.map((_, k) => new RegExp(`^${sequence.slice(0, k + 1).map(group).join("")}`)));
  return {
    parse(value) {
      const m = regex.exec(value);
      if (m) return { ok: true, texts: sequence.map((_, i) => m.groups?.[`p${i}`] ?? "") };
      const runs = leading();
      for (let k = runs.length - 1; k >= 0; k -= 1) {
        const hit = runs[k].exec(value);
        if (hit) return { ok: false, at: hit[0].length, part: k + 1 };
      }
      return { ok: false, at: 0, part: 0 };
    },
  };
}

/** A part as the chip and a miss name it. */
export function partName(part: NamePart): string {
  if ("list" in part) return CODE_LISTS[part.list].meta.label;
  if ("values" in part) return part.values.join(" | ");
  if ("regex" in part) return `/${part.regex}/`;
  return `"${part.text}"`;
}

/** What a part shows when no real name parses: the text, the first value,
 *  the POFIN example's class (DUZ) or an NS 3451 class, else the pattern. */
export function partExample(part: NamePart): string {
  if ("text" in part) return part.text;
  if ("values" in part) return part.values[0] ?? "";
  if ("list" in part) return part.list === "ns3457-8" ? "DUZ" : "2341";
  return part.regex === "\\d+" ? "001" : part.regex;
}

export function sameScheme(a: readonly NamePart[], b: readonly NamePart[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
