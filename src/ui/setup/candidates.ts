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
import { agrees, partTexts, tfmMatcher } from "../../engine/tfm.ts";
import { extractFromExample } from "../../ids/extract-example.ts";
import { copyVerdict, defaultExtract } from "../../ids/models.ts";
import { POFIN_SOURCES, ROLE_STANDARD, type PofinSource } from "../../engine/pofin-standard.ts";
import type { CodeEntry, CodeLookupCheck, CopyObjectCheck, MappingRole, TfmPart, TfmToken } from "../../ids/types.ts";
import { previewExtract, type ExtractPreview, type ExtractState } from "../extract-preview.ts";
import type { PsetChoice, PsetProp, PsetValue } from "../pset-choices.ts";

export type MappingCheck = CodeLookupCheck | CopyObjectCheck;

/** The roles a mapping step proposes a source for; `tfm` ranks its own way
 *  (`rankTfmCandidates`). */
export type CardRole = Exclude<MappingRole, "tfm" | "type-name">;

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
  /** Fit enough to be pre-picked: most of its valued elements pass in full,
   *  or its own name names the step's list. A weaker candidate is listed,
   *  never taken for the user. */
  strong: boolean;
}

/** A value that is a date (20.05.2025, 2025-05-20) is no code, whatever a
 *  pattern makes of it: «20» from a date is NS 3451 class 20 by accident
 *  (rendered 2026-10-05: `MMI.MMI dato` pre-picked as Systemkode). */
const DATE = /^\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}(?:[ T].*)?$/;
export const isDateLike = (value: string) => DATE.test(value.trim());

/** Quantity sets carry measures, never a code (rendered: `BaseQuantities.
 *  CrossSectionArea` passed as NS 3451 on a Revit export). */
const MEASURES = /^(?:BaseQuantities|Qto_)/i;

/** The step's list named in the property's own name: NS 3451 for
 *  Systemkode, NS 3457 for Funksjonskode, MMI for the progress code. */
const NAMES: Partial<Record<CardRole, RegExp>> = {
  "system-classification": /3451/,
  "component-classification": /3457/,
  "progress-code": /\bmmi\b|prosesstatus|processstatus/i,
};

/** Share of valued elements that must pass in full for a pre-pick. */
const STRONG_SHARE = 0.8;
/** Below this share a property is no candidate at all. */
const CANDIDATE_SHARE = 0.5;

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
  role: CardRole,
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
  role: CardRole,
  check: MappingCheck,
  ownerNames: readonly string[],
  limit = 4,
): Candidate[] {
  const out: Candidate[] = [];
  const naming = NAMES[role];
  for (const choice of choices) {
    // A measure is no code, no MMI and no owner.
    if (MEASURES.test(choice.set)) continue;
    for (const prop of choice.props) {
      if (prop.valued === 0 || prop.values.length === 0) continue;
      const named = naming !== undefined && naming.test(`${choice.set}.${prop.name}`);
      let best: Candidate | null = null;
      if (check.type === "copy-object") {
        const preview = previewCopy(check, prop.values, ownerNames);
        const ok = preview.totals.ok;
        best = { set: choice.set, name: prop.name, prop, preview, okValues: okValues(preview), score: score(ok, prop), strong: true };
      } else {
        const classification = role === "system-classification" || role === "component-classification";
        const lead = classification ? leadingExtract(prop.values) : null;
        // The rule's own Uttrekk, the whole value, the standard's form (a
        // project property may carry 2341.001 too), the code before a name.
        const standard = POFIN_SOURCES[ROLE_STANDARD[role]].extract;
        const extracts = [
          ...new Set([check.extract, ...(classification ? [defaultExtract(role), standard, lead] : [])]),
        ].filter((e): e is string => e != null);
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
          // Passing in full: the pattern's code is in the list AND the value
          // is not a date (a pattern that reads «20» out of 20.05.2025 has
          // not found a code).
          const ok = ranked.rows.reduce((n, r) => n + (r.state === "ok" && !isDateLike(r.v) ? r.n : 0), 0);
          const share = prop.valued > 0 ? ok / prop.valued : 0;
          if (share < CANDIDATE_SHARE && !(named && ok > 0)) continue;
          // A property whose name names the list is preferred over one that
          // passes by its values alone.
          const s = score(ok, prop) * (named ? 4 : 1);
          if (best === null || s > best.score) {
            best = {
              set: choice.set,
              name: prop.name,
              prop,
              extract,
              preview,
              okValues: okValues(preview),
              score: s,
              // A code list is taken for the user only from a property whose
              // name names it: values alone read as codes by accident too
              // often (rendered: `MMI.MMI signatur`, initials, and
              // `SoneData.Gulvbehandling`, G01, both pre-picked as
              // Funksjonskode). They stay in the list, with their counts.
              strong: named || (!classification && share >= STRONG_SHARE),
            };
          }
        }
      }
      if (best !== null && best.score > 0) out.push(best);
    }
  }
  return out
    .sort(
      (a, b) =>
        Number(b.strong) - Number(a.strong) || b.score - a.score || a.set.localeCompare(b.set) || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/* ------------------------------------------------------------ the standard */

/** The step's standard source (`pofin-standard.ts`) as the step shows it:
 *  the check confirming it writes, and the model's real count, 0 when the
 *  models do not carry it. */
export interface StandardOption {
  entry: PofinSource;
  set: string;
  name: string;
  /** The property in the models; undefined when they lack it. */
  prop: PsetProp | undefined;
  /** What «Bruk» on the standard writes: its source, and its Uttrekk when
   *  its value form needs one. */
  check: MappingCheck;
  /** The step's check over its values; null when absent, or on an error. */
  preview: ExtractPreview | null;
  /** Elements carrying a value. */
  hits: number;
}

export function standardOption(
  role: CardRole,
  check: MappingCheck,
  choices: readonly PsetChoice[] | null,
  ownerNames: readonly string[],
): StandardOption {
  const entry = POFIN_SOURCES[ROLE_STANDARD[role]];
  const property = "property" in entry.source ? entry.source.property : { propertySet: "", name: "" };
  const next: MappingCheck =
    check.type === "code-lookup"
      ? {
          ...check,
          source: entry.source,
          ...(entry.extract !== undefined ? { extract: entry.extract } : {}),
          ...(role === "system-classification" || role === "component-classification"
            ? { target: entry.target ?? "occurrence" }
            : {}),
        }
      : { ...check, source: entry.source };
  const prop = choices?.find((c) => c.set === property.propertySet)?.props.find((p) => p.name === property.name);
  let preview: ExtractPreview | null = null;
  if (prop) {
    try {
      preview = evidence(next, role, prop, ownerNames);
    } catch {
      preview = null;
    }
  }
  return { entry, set: property.propertySet, name: property.name, prop, check: next, preview, hits: prop?.valued ?? 0 };
}

/** Which answer a mapping step opens on. The standard is always shown first;
 *  this is only what «Bruk» takes.
 *
 *   saved      the ruleset's source, when the models carry it (hits > 0), its
 *              count cannot be read here (null: an attribute, a
 *              classification), or it was set on this step just now
 *   standard   when the models carry it
 *   candidate  the model's best, when the standard has no hits
 *   saved, else the standard, with 0: nothing has hits
 *
 * A saved source the models lack never wins over one they carry. */
export type PrePick = "saved" | "standard" | "candidate";

export function prePick(
  standardHits: number,
  saved: { hits: number | null; chosen: boolean } | null,
  candidates: number,
): PrePick {
  if (saved && (saved.chosen || saved.hits === null || saved.hits > 0)) return "saved";
  if (standardHits > 0) return "standard";
  if (candidates > 0) return "candidate";
  return saved ? "saved" : "standard";
}

/** A segment of the walk's bar (2026-10-05, edkjo: "is this great UI?" on
 *  a bar six-tenths green before any model was loaded). The bar does not lie:
 *
 *   done   a model is loaded, and the step's answer was confirmed in this
 *          Oppsett against it, or the ruleset's saved source has hits in it
 *   saved  the ruleset has an answer for the step not yet checked against a
 *          model: none is loaded, or its count is 0 or cannot be read (null)
 *   open   no answer
 *
 * With no model loaded nothing is done, whatever the ruleset holds. */
export type SegmentState = "done" | "saved" | "open";

export function segmentState(
  modelLoaded: boolean,
  confirmed: boolean,
  saved: { hits: number | null } | null,
): SegmentState {
  if (modelLoaded && (confirmed || (saved?.hits ?? 0) > 0)) return "done";
  return saved ? "saved" : "open";
}

/* -------------------------------------------------------------------- TFM */

/** A property's values read against a TFM sequence: `ok` a string of the
 *  sequence, `no-match` one off it. The same parse the tfm check runs
 *  (`src/engine/tfm.ts`), shape only: agreement needs each element's own
 *  values, which the inventory's value list does not pair. */
export function previewTfm(sequence: readonly TfmToken[], values: readonly PsetValue[]): ExtractPreview {
  const matcher = tfmMatcher(sequence);
  const totals: Record<ExtractState, number> = { ok: 0, "no-match": 0, "not-in-list": 0 };
  const rows = values.map((value) => {
    const state: ExtractState = matcher.parse(value.v).ok ? "ok" : "no-match";
    totals[state] += value.n;
    return { ...value, code: null, state };
  });
  return { rows, totals };
}

/** The TFM step's proposals: the properties whose values are strings of
 *  `sequence` (the standard's, or the saved rule's), scored as the other
 *  steps score. A property no value of which parses is no candidate. */
export function rankTfmCandidates(choices: readonly PsetChoice[], sequence: readonly TfmToken[], limit = 4): Candidate[] {
  const out: Candidate[] = [];
  for (const choice of choices) {
    for (const prop of choice.props) {
      if (prop.valued === 0 || prop.values.length === 0) continue;
      const preview = previewTfm(sequence, prop.values);
      const s = score(preview.totals.ok, prop);
      if (s > 0) out.push({ set: choice.set, name: prop.name, prop, preview, okValues: okValues(preview), score: s, strong: true });
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.set.localeCompare(b.set) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The properties that could bind a part (Lokasjon): those carrying the
 *  segments the TFM values parse to for it, as a value or a code before a
 *  name, most elements first. Overlap of values, never a name. */
export function rankPartBindings(
  choices: readonly PsetChoice[],
  sequence: readonly TfmToken[],
  values: readonly PsetValue[],
  part: TfmPart,
  limit = 4,
): { set: string; name: string; n: number }[] {
  const matcher = tfmMatcher(sequence);
  const segments = new Set<string>();
  for (const value of values) {
    const parsed = matcher.parse(value.v);
    const text = parsed.ok ? partTexts(parsed.segments).get(part) : undefined;
    if (text) segments.add(text);
  }
  if (segments.size === 0) return [];
  const out: { set: string; name: string; n: number }[] = [];
  for (const choice of choices) {
    for (const prop of choice.props) {
      const n = prop.values.reduce((sum, v) => sum + ([...segments].some((seg) => agrees(seg, v.v)) ? v.n : 0), 0);
      if (n > 0) out.push({ set: choice.set, name: prop.name, n });
    }
  }
  return out.sort((a, b) => b.n - a.n || a.set.localeCompare(b.set) || a.name.localeCompare(b.name)).slice(0, limit);
}
