/** What Oppsett's MMI and Etasjeoppsett steps add from the loaded models, by
 *  click or by template (2026-10-01, edkjo: "both though"). Pure.
 *
 *   MMI      the codes the current Uttrekk takes out of the picked property's
 *            values, most frequent first; a new one is named `MMI <code>`,
 *            the precedent in examples/eks-project-layer.test.ruleset.json.
 *   Etasjer  the models' own storeys, name and elevation in metres (file
 *            units times the unit scale, to the mm), merged across models
 *            and deduplicated by name + elevation, lowest first. A storey
 *            with no name or no elevation, or in a file whose length unit is
 *            unresolved, has no level to give and is left out.
 *
 * The template files themselves are `writeCodesXlsx` / `writeLevelsXlsx`
 * (`src/ids/xlsx.ts`); these give them their defaults.
 */

import { compileExtract } from "../ids/evaluate.ts";
import type { CodeEntry, StoreyLevel } from "../ids/types.ts";
import type { PsetValue } from "./pset-choices.ts";

/** The distinct codes `extract` takes out of `values`, in the values' order.
 *  Throws the evaluator's own error on an invalid pattern. */
export function extractedCodes(extract: string, values: readonly PsetValue[]): string[] {
  const regex = compileExtract(extract);
  const out: string[] = [];
  for (const value of values) {
    const code = regex.exec(value.v)?.[1];
    if (code !== undefined && code !== "" && !out.includes(code)) out.push(code);
  }
  return out;
}

/** A new code entry: the code, named `MMI <code>`, no phase. */
export function newCode(code: string): CodeEntry {
  return { code, name: `MMI ${code}` };
}

/** `codes` plus every code in `extracted` the list lacks, in that order. */
export function withCodes(codes: readonly CodeEntry[], extracted: readonly string[]): CodeEntry[] {
  const have = new Set(codes.map((c) => c.code));
  return [...codes, ...extracted.filter((c) => !have.has(c)).map(newCode)];
}

/** One model's storeys as the profile has them. */
export interface StoreyPeer {
  storeys: readonly { name: string | null; elevation: number | null }[];
  unitScale: number;
  unitResolved: boolean;
}

const mm = (metres: number) => Math.round(metres * 1000);

function levelKey(level: StoreyLevel): string {
  return `${level.name}\u0000${mm(level.elevation)}`;
}

/** The models' storeys as levels: merged, deduplicated, lowest first. */
export function modelLevels(peers: readonly StoreyPeer[]): StoreyLevel[] {
  const seen = new Set<string>();
  const out: StoreyLevel[] = [];
  for (const peer of peers) {
    if (!peer.unitResolved) continue;
    for (const storey of peer.storeys) {
      if (storey.name === null || storey.name.trim() === "" || storey.elevation === null) continue;
      const level = { name: storey.name, elevation: mm(storey.elevation * peer.unitScale) / 1000 };
      const key = levelKey(level);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(level);
    }
  }
  return out.map((level, i) => ({ level, i })).sort((a, b) => a.level.elevation - b.level.elevation || a.i - b.i).map((x) => x.level);
}

/** Whether `levels` already holds this name at this elevation (to the mm). */
export function hasLevel(levels: readonly StoreyLevel[], level: StoreyLevel): boolean {
  const key = levelKey(level);
  return levels.some((l) => Number.isFinite(l.elevation) && levelKey(l) === key);
}

/** `levels` plus every one of `extra` it lacks, in that order. */
export function withLevels(levels: readonly StoreyLevel[], extra: readonly StoreyLevel[]): StoreyLevel[] {
  return [...levels, ...extra.filter((l) => !hasLevel(levels, l))];
}

/** The Etasjer template's rows: the current levels, or with none, the
 *  models' own. */
export function levelsTemplate(levels: readonly StoreyLevel[], fromModels: readonly StoreyLevel[]): StoreyLevel[] {
  return levels.length > 0 ? [...levels] : [...fromModels];
}

/** `<ruleset name or regelsett>.<step>.xlsx`. */
export function templateFileName(rulesetName: string, step: "mmi" | "etasjer"): string {
  const stem = rulesetName.trim() === "" ? "regelsett" : rulesetName.trim();
  return `${stem}.${step}.xlsx`;
}
