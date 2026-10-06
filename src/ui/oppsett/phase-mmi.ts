/** Fase in Oppsett v2: where the phase is read from, and the MMI phase table.
 *
 *   Status  the standard alone (Pset_*Common.Status), plus any project
 *           property source
 *   MMI     the same, then the phase of the element's MMI code: a
 *           `{ progressCode: {} }` source, reading the progress-code rule's
 *           codes, each carrying at most one `phase`
 *
 * The phase table is the MMI rule's codes grouped by `phase`. A phase is
 * stored only through its codes; a phase with none lives in the page's
 * `order` while the page is open (no ruleset field for it).
 *
 * Pure. What it writes is the shape lint accepts: a code with no phase has
 * no `phase` key, never an empty one.
 */

import { presetCodes } from "../../codelists/mmi-presets.ts";
import { pofinRuleset } from "../../engine/pofin-ruleset.ts";
import { anyRoleRule } from "../../ids/models.ts";
import type { CodeEntry, CodeLookupCheck, ExtendedRule, PhaseSource, Ruleset } from "../../ids/types.ts";
import { layerSources, withLayerSources } from "../layer-steps.ts";
import { freshId } from "./merge.ts";

export type PhaseMode = "status" | "mmi";

export const isMmiSource = (source: PhaseSource): source is { progressCode: Record<string, never> } => "progressCode" in source;

export function phaseMode(ruleset: Ruleset): PhaseMode {
  return layerSources(ruleset, "phase").some(isMmiSource) ? "mmi" : "status";
}

/** The progress-code rule's codes; none without the rule. */
export function mmiCodes(ruleset: Ruleset): CodeEntry[] {
  const check = anyRoleRule(ruleset, "progress-code")?.check;
  return check?.type === "code-lookup" ? [...(check.codes ?? [])] : [];
}

/** `ruleset` with the progress-code rule's codes replaced (a bundled list,
 *  should one be set, gives way: lint takes one of the two). */
export function withMmiCodes(ruleset: Ruleset, codes: CodeEntry[]): Ruleset {
  const rule = anyRoleRule(ruleset, "progress-code");
  if (!rule || rule.check.type !== "code-lookup") return ruleset;
  const check: CodeLookupCheck = { ...rule.check, codes };
  delete check.list;
  delete check.minLevel;
  const next: ExtendedRule = { ...rule, check };
  return { ...ruleset, rules: ruleset.rules.map((r) => (r.id === rule.id ? next : r)) };
}

/** The phase sources other than the MMI one, in order. */
export function otherPhaseSources(ruleset: Ruleset): PhaseSource[] {
  return layerSources(ruleset, "phase").filter((s) => !isMmiSource(s));
}

/** `ruleset` with the other phase sources replaced, the MMI source kept
 *  where it stood among them. */
export function withOtherPhaseSources(ruleset: Ruleset, others: PhaseSource[]): Ruleset {
  const sources = layerSources(ruleset, "phase");
  const at = sources.findIndex(isMmiSource);
  if (at < 0) return withLayerSources(ruleset, "phase", others);
  const before = Math.min(sources.slice(0, at).filter((s) => !isMmiSource(s)).length, others.length);
  return withLayerSources(ruleset, "phase", [...others.slice(0, before), sources[at], ...others.slice(before)]);
}

/** The source switch. `status` drops the MMI source and leaves the codes'
 *  phases be. `mmi` adds it, with what it needs to read: the progress-code
 *  rule (added as «Legg til krav» adds it, enabled if it was not) and, when
 *  that rule is format only, the codes of «MMI for gjenbruk». */
export function withPhaseMode(ruleset: Ruleset, mode: PhaseMode): Ruleset {
  if (mode === "status") {
    return withLayerSources(ruleset, "phase", layerSources(ruleset, "phase").filter((s) => !isMmiSource(s)));
  }
  let next = ruleset;
  let rule = anyRoleRule(next, "progress-code");
  if (!rule) {
    const template = pofinRuleset().rules.find((r): r is ExtendedRule => r.kind === "extended" && r.mapping === "progress-code")!;
    rule = { ...template, id: freshId(next.rules, template.id) };
    next = { ...next, rules: [...next.rules, rule] };
  } else if (rule.enabled === false) {
    const enabled: ExtendedRule = { ...rule };
    delete enabled.enabled;
    next = { ...next, rules: next.rules.map((r) => (r.id === enabled.id ? enabled : r)) };
  }
  if (mmiCodes(next).length === 0) next = withMmiCodes(next, presetCodes("gjenbruk"));
  const sources = layerSources(next, "phase");
  return sources.some(isMmiSource) ? next : withLayerSources(next, "phase", [...sources, { progressCode: {} }]);
}

/* ------------------------------------------------------------ the table */

/** The table's phases: the page's `order` (phases without codes included),
 *  then any phase the codes carry that it lacks, in code order. */
export function phaseRows(codes: readonly CodeEntry[], order: readonly string[]): string[] {
  const rows = [...order];
  for (const c of codes) if (c.phase && !rows.includes(c.phase)) rows.push(c.phase);
  return rows;
}

export const codesOf = (codes: readonly CodeEntry[], phase: string): CodeEntry[] => codes.filter((c) => c.phase === phase);

export const unassigned = (codes: readonly CodeEntry[]): CodeEntry[] => codes.filter((c) => !c.phase);

const withPhase = (entry: CodeEntry, phase: string | null): CodeEntry => {
  const next = { ...entry };
  if (phase === null || phase.trim() === "") delete next.phase;
  else next.phase = phase;
  return next;
};

/** The codes with `which` moved to `phase` (null: to none). A code is in one
 *  phase at most, so moving it takes it out of the one it was in. */
export function assignCodes(codes: readonly CodeEntry[], which: Iterable<string>, phase: string | null): CodeEntry[] {
  const moving = new Set(which);
  return codes.map((c) => (moving.has(c.code) ? withPhase(c, phase) : c));
}

/** Every code carrying `from` carries `to`. */
export function renamePhase(codes: readonly CodeEntry[], from: string, to: string): CodeEntry[] {
  return codes.map((c) => (c.phase === from ? withPhase(c, to) : c));
}

/** The phase gone: its codes carry none. */
export function deletePhase(codes: readonly CodeEntry[], phase: string): CodeEntry[] {
  return codes.map((c) => (c.phase === phase ? withPhase(c, null) : c));
}

/** A name another row has, ignoring case and surrounding space (as the
 *  engine compares phases). */
export function phaseNameTaken(rows: readonly string[], index: number, name: string): boolean {
  const k = name.trim().toUpperCase();
  return rows.some((r, j) => j !== index && r.trim().toUpperCase() === k);
}
