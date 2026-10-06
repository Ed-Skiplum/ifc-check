/** A source's values judged against its requirement's Krav, for the Kilde
 *  value table: each listed value, its element count (the pset inventory's,
 *  over the elements the rule selects), and ok / feil. The same previews the
 *  walk drew its evidence with (`setup/candidates.ts`), and for an IDS
 *  property the evaluator's own value comparison (`idsValueMatches`).
 *
 * Pure. `ok` null: the value cannot be judged here (a pattern JavaScript
 * refuses, an Uttrekk that does not compile). */

import { idsValueMatches } from "../../ids/evaluate.ts";
import { nameMatcher } from "../../engine/type-name.ts";
import type { CodeLookupRole, Rule } from "../../ids/types.ts";
import { previewExtract, type ExtractPreview } from "../extract-preview.ts";
import type { PsetValue } from "../pset-choices.ts";
import { previewCopy, previewTfm } from "../setup/candidates.ts";
import { literalFacets } from "./merge.ts";

export interface JudgedValue {
  v: string;
  n: number;
  ok: boolean | null;
}

const fromPreview = (preview: ExtractPreview): JudgedValue[] => preview.rows.map((r) => ({ v: r.v, n: r.n, ok: r.state === "ok" }));

export function judgeValues(rule: Rule, values: readonly PsetValue[], ownerNames: readonly string[]): JudgedValue[] {
  const list = [...values];
  if (rule.kind === "ids") {
    const facet = literalFacets(rule)[0];
    if (!facet) return list.map((v) => ({ ...v, ok: null }));
    if (facet.cardinality === "prohibited") return list.map((v) => ({ ...v, ok: false }));
    const constraint = facet.value;
    if (constraint === undefined) return list.map((v) => ({ ...v, ok: true }));
    return list.map((v) => ({ ...v, ok: idsValueMatches(constraint, v.v) }));
  }
  const check = rule.check;
  try {
    if (check.type === "code-lookup") {
      const role = (rule.mapping ?? null) as CodeLookupRole | null;
      return fromPreview(previewExtract(check, list, role));
    }
    if (check.type === "copy-object") return fromPreview(previewCopy(check, list, ownerNames));
    if (check.type === "tfm") return fromPreview(previewTfm(check.sequence, list));
    if (check.type === "type-name") {
      const matcher = nameMatcher(check.sequence);
      return list.map((v) => ({ ...v, ok: matcher.parse(v.v).ok }));
    }
  } catch {
    return list.map((v) => ({ ...v, ok: null }));
  }
  return list.map((v) => ({ ...v, ok: null }));
}

/** The rows the table shows: the most frequent first, then every failing
 *  value the cut left out, so a failing value is never hidden. */
export function shownValues(judged: readonly JudgedValue[], top = 60): JudgedValue[] {
  const sorted = [...judged].sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
  const head = sorted.slice(0, top);
  const failing = sorted.slice(top).filter((r) => r.ok === false);
  return [...head, ...failing];
}
