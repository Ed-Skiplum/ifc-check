/** What the walk proposes on a mapping step (2026-10-05, edkjo: "the
 *  super intuitive pull-me-through ... onboarding"): the loaded models'
 *  properties, ranked by how well their values pass the step's own check.
 *
 * Pure. Every count is `previewExtract` (`extract-preview.ts`) over the
 * values the pset inventory carries, the same preview the values list shows,
 * so a proposal's evidence is exactly what confirming it gives. Nothing is
 * proposed on a name, a set's prefix or a guess: a property whose values pass
 * nothing is no candidate, and a step where none passes gets none.
 *
 *   Systemkode, Funksjonskode  the rule's Uttrekk against its bundled list;
 *            when a property's most frequent value carries a name after the
 *            code ("231 Bærevegger"), the Uttrekk `extractFromExample` makes
 *            of its first word is tried too, and the better one is the
 *            candidate's (written with the source on confirm).
 *   MMI      with no codes listed, the rule checks the format alone, which a
 *            width of 300 passes too; the ranking then counts against every
 *            MMI preset's codes, the step's code list. The evidence shown is
 *            still the rule's own check.
 *   Duplikat objekt  a value is known when the rule's copy or own values or
 *            a model's owner names name it (`copyVerdict`). A new rule names
 *            none, so it has no candidate until values are set.
 *
 * Score: elements passing times the share of the property's valued elements
 * passing, so a full property beats a rare perfect one and a large property
 * that passes by accident (a width that reads as a code) sinks.
 */

import { MMI_PRESETS } from "../../codelists/mmi-presets.ts";
import { extractFromExample } from "../../ids/extract-example.ts";
import { copyVerdict } from "../../ids/models.ts";
import type { CodeEntry, CodeLookupCheck, CopyObjectCheck, MappingRole } from "../../ids/types.ts";
import { previewExtract, type ExtractPreview, type ExtractState } from "../extract-preview.ts";
import type { PsetChoice, PsetProp, PsetValue } from "../pset-choices.ts";

export type MappingCheck = CodeLookupCheck | CopyObjectCheck;

export interface Candidate {
  set: string;
  name: string;
  prop: PsetProp;
  /** The Uttrekk the evidence was taken with; written with the source on
   *  confirm. Absent on Duplikat objekt. */
  extract?: string;
  /** What confirming gives: the rule's own check over the values. */
  preview: ExtractPreview;
  /** Distinct values passing, of `prop.distinct`. */
  okValues: number;
  score: number;
}

/** Every preset's codes, once: the MMI step's code list for ranking. */
const PRESET_CODES: CodeEntry[] = [
  ...new Map(MMI_PRESETS.flatMap((p) => p.codes).map((c) => [c.code, { ...c }])).values(),
];

/** A Duplikat objekt rule's reading of the values: a value it can place
 *  (copy or own) is `ok`, one it names nowhere `not-in-list`. The code
 *  column carries the verdict, `copy` or `own`. */
export function previewCopy(check: CopyObjectCheck, values: readonly PsetValue[], ownerNames: readonly string[]): ExtractPreview {
  const totals: Record<ExtractState, number> = { ok: 0, "no-match": 0, "not-in-list": 0 };
  const rows = values.map((value) => {
    const { verdict, known } = copyVerdict(check, value.v, ownerNames, ownerNames);
    const state: ExtractState = known ? "ok" : "not-in-list";
    totals[state] += value.n;
    return { ...value, code: verdict, state };
  });
  return { rows, totals };
}

/** The step's check over one property's values: what the values list and
 *  the proposal show. Throws the evaluator's error on an invalid Uttrekk. */
export function evidence(
  check: MappingCheck,
  role: MappingRole,
  prop: PsetProp,
  ownerNames: readonly string[],
): ExtractPreview {
  if (check.type === "copy-object") return previewCopy(check, prop.values, ownerNames);
  return previewExtract(check, prop.values, role === "copy-object" ? null : role);
}

function score(ok: number, prop: PsetProp): number {
  return prop.valued > 0 ? (ok * ok) / prop.valued : 0;
}

const okValues = (preview: ExtractPreview) => preview.rows.filter((r) => r.state === "ok").length;

/** The Uttrekk the first word of the most frequent value gives, when that
 *  value has more than one word: the code before its name. */
function leadingExtract(values: readonly PsetValue[]): string | null {
  const top = values[0]?.v ?? "";
  const space = top.search(/\s/);
  return space > 0 ? extractFromExample(top, 0, space) : null;
}

/** The properties of `choices` whose values pass the step's check, best
 *  first, at most `limit`. */
export function rankCandidates(
  choices: readonly PsetChoice[],
  role: MappingRole,
  check: MappingCheck,
  ownerNames: readonly string[],
  limit = 4,
): Candidate[] {
  const out: Candidate[] = [];
  for (const choice of choices) {
    for (const prop of choice.props) {
      if (prop.valued === 0 || prop.values.length === 0) continue;
      let best: Candidate | null = null;
      if (check.type === "copy-object") {
        const preview = previewCopy(check, prop.values, ownerNames);
        best = { set: choice.set, name: prop.name, prop, preview, okValues: okValues(preview), score: score(preview.totals.ok, prop) };
      } else {
        const classification = role === "system-classification" || role === "component-classification";
        const lead = classification ? leadingExtract(prop.values) : null;
        const extracts = lead !== null && lead !== check.extract ? [check.extract, lead] : [check.extract];
        const byFormat = role === "progress-code" && (check.codes ?? []).length === 0;
        for (const extract of extracts) {
          let preview: ExtractPreview;
          let ranked: ExtractPreview;
          try {
            preview = previewExtract({ ...check, extract }, prop.values, role === "copy-object" ? null : role);
            ranked = byFormat
              ? previewExtract({ ...check, extract, codes: PRESET_CODES }, prop.values, "progress-code")
              : preview;
          } catch {
            continue;
          }
          const s = score(ranked.totals.ok, prop);
          if (best === null || s > best.score) {
            best = { set: choice.set, name: prop.name, prop, extract, preview, okValues: okValues(preview), score: s };
          }
        }
      }
      if (best !== null && best.score > 0) out.push(best);
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.set.localeCompare(b.set) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
