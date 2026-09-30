/** The file's storeys against the project's floor config (Etasjeoppsett).
 *
 * edkjo: "Needs to be 1:1 or less floors, never more, and always same
 * elevation and naming." So, per model:
 *
 *   - every file storey matches one level of the table on name and
 *     elevation. Name: exact, case-sensitive. A name that matches only after
 *     trimming whitespace is its own finding, never a silent match.
 *     Elevation: within the setup's tolerance, in millimetres, file minus
 *     level, after the file's unit scale (StoreyRow.elevation is in FILE
 *     units, ifcfast#180). Tolerance 0 and 0 is equality at the millimetre.
 *   - the file has at most as many storeys as the table. Fewer is fine (a
 *     discipline need not model every floor); more is always a finding.
 *   - no level is matched by two file storeys.
 *
 * Which level a storey that does not match is compared against: a level of
 * the same name within `nameWindowMm` (null = any distance), reported as an
 * elevation mismatch; else the nearest level within `nearMm`, reported as a
 * name mismatch. `nearMm` 0 and `nameWindowMm` null is the exact matching
 * the check had before the setup carried them.
 *
 * A discipline measuring to another plane (`storeys.disciplines`) gets its
 * own plane and tolerance; with `requireAllNames` only when every level is
 * matched by a file storey of the same name and no file storey has no
 * same-named level (a structural model measured to OK bærende dekke: lower
 * accepted, higher not, only when every name matches).
 *
 * A level no file storey matches is ABSENT, shown in the matrix and never a
 * finding. With no config loaded the check is not_applicable, never a pass.
 * DEVIATION: a storey that is not the project's storey breaks every floor
 * filter and federation across disciplines.
 */

import type { CheckResult, Finding, IfcGraph, IfcSummary } from "./types";
import { finding, line, literal, result, share } from "./fundamentals.ts";
import { storeyPolicy, type StoreyPolicy } from "../ids/models.ts";
import type { Ruleset, StoreyLevel, StoreyPlane, StoreyTolerance } from "../ids/types.ts";

/** One level of the project config. `elevation` in METRES. */
export type FloorConfig = StoreyLevel;

export interface FileStorey {
  guid: string;
  name: string | null;
  /** FILE units. */
  elevation: number | null;
}

export type StoreyMatchState =
  | "match"
  | "whitespace"
  | "name-mismatch"
  | "elevation-mismatch"
  | "not-in-config"
  | "duplicate";

export interface StoreyMatch {
  storey: FileStorey;
  /** Metres, rounded to mm. null when the file carries no elevation. */
  elevationM: number | null;
  state: StoreyMatchState;
  /** Index into the config of the level this storey matched or is compared
   *  against; null for not-in-config. */
  config: number | null;
}

/** How a storey is matched to a level. */
export interface MatchRules {
  tolerance: StoreyTolerance;
  nameWindowMm: number | null;
  nearMm: number;
}

/** The matching the check had before the setup: equal at the millimetre,
 *  a same-named storey at any distance, another name at the same mm. */
export const EXACT: MatchRules = { tolerance: { aboveMm: 0, belowMm: 0 }, nameWindowMm: null, nearMm: 0 };

const mm = (m: number) => Math.round(m * 1000);

function within(deltaMm: number, t: StoreyTolerance): boolean {
  return (t.aboveMm === null || deltaMm <= t.aboveMm) && (t.belowMm === null || -deltaMm <= t.belowMm);
}

/** Per file storey, which level it is, and how. Exact matches claim their
 *  level first, so a later near-miss cannot steal it; a second exact match on
 *  an already claimed level is `duplicate`. */
export function matchStoreys(
  storeys: readonly FileStorey[],
  unitScale: number,
  config: readonly FloorConfig[],
  rules: MatchRules = EXACT,
): StoreyMatch[] {
  const claimed = new Set<number>();
  return storeys.map((storey) => {
    const elevationM = storey.elevation === null ? null : mm(storey.elevation * unitScale) / 1000;
    const name = storey.name ?? "";
    const delta = (i: number) => (elevationM === null ? null : mm(elevationM) - mm(config[i].elevation));
    const ok = (i: number) => {
      const d = delta(i);
      return d !== null && within(d, rules.tolerance);
    };
    const exact = config.findIndex((c, i) => c.name === name && ok(i));
    if (exact >= 0) {
      const state = claimed.has(exact) ? "duplicate" : "match";
      claimed.add(exact);
      return { storey, elevationM, state, config: exact };
    }
    const trimmed = config.findIndex((c, i) => c.name.trim() === name.trim() && ok(i));
    if (trimmed >= 0) return { storey, elevationM, state: "whitespace", config: trimmed };
    const byName = config.findIndex((c, i) => {
      if (c.name !== name) return false;
      if (rules.nameWindowMm === null) return true;
      const d = delta(i);
      return d !== null && Math.abs(d) <= rules.nameWindowMm;
    });
    if (byName >= 0) return { storey, elevationM, state: "elevation-mismatch", config: byName };
    let near = -1;
    let nearDelta = Infinity;
    config.forEach((_, i) => {
      const d = delta(i);
      if (d !== null && Math.abs(d) <= rules.nearMm && Math.abs(d) < nearDelta) {
        near = i;
        nearDelta = Math.abs(d);
      }
    });
    if (near >= 0) return { storey, elevationM, state: "name-mismatch", config: near };
    return { storey, elevationM, state: "not-in-config", config: null };
  });
}

/** The plane and tolerance a model is judged by: the setup's, or its
 *  discipline's override when it holds. An override with `requireAllNames`
 *  holds only when every level has a file storey of the same name within the
 *  name window and every file storey has a same-named level. */
export function resolveStoreyRules(
  policy: StoreyPolicy,
  storeys: readonly FileStorey[],
  unitScale: number,
  config: readonly FloorConfig[],
): { plane: StoreyPlane; rules: MatchRules; override: "none" | "applied" | "not-all-names" } {
  const base: MatchRules = { tolerance: policy.tolerance, nameWindowMm: policy.nameWindowMm, nearMm: policy.nearMm };
  const o = policy.override;
  if (!o) return { plane: policy.plane, rules: base, override: "none" };
  const withO: MatchRules = { ...base, tolerance: o.tolerance };
  if (o.requireAllNames) {
    // Names only: a same-named storey within the name window is its level.
    const w = policy.nameWindowMm;
    const byName = matchStoreys(storeys, unitScale, config, { ...withO, tolerance: { aboveMm: w, belowMm: w } });
    const named = byName.filter((m) => m.state === "match" || m.state === "duplicate");
    const everyLevel = config.every((_, i) => named.some((m) => m.config === i));
    const noOther = byName.every((m) => m.state === "match");
    if (!(everyLevel && noOther)) return { plane: o.plane, rules: base, override: "not-all-names" };
  }
  return { plane: o.plane, rules: withO, override: "applied" };
}

export function checkStoreyConfig(
  graph: IfcGraph,
  summary: IfcSummary,
  ruleset: Ruleset | null | undefined,
  fileName: string,
): CheckResult {
  const id = "storey-config";
  const policy = storeyPolicy(ruleset, fileName);
  const config = ruleset?.storeys?.levels;
  if (!policy || !config || config.length === 0) {
    const reason = "no floor config loaded";
    return { ...result(id, "deviation", 0, [], literal("—"), reason), reason };
  }
  if (!summary.unit_resolved) {
    const reason = "length unit unresolved, storey elevations cannot be compared";
    return { ...result(id, "deviation", 0, [], literal("—"), reason), reason };
  }

  const { rules } = resolveStoreyRules(policy, graph.storeys, summary.unit_scale, config);
  const matches = matchStoreys(graph.storeys, summary.unit_scale, config, rules);
  const findings: Finding[] = [];
  for (const m of matches) {
    if (m.state === "match") continue;
    const el = { guid: m.storey.guid, entity: "IfcBuildingStorey", name: m.storey.name };
    const cfg = m.config === null ? null : config[m.config];
    const elevation = m.elevationM === null ? "-" : m.elevationM.toFixed(3);
    switch (m.state) {
      case "whitespace":
        findings.push(finding(el, "storey-name-whitespace", { storey: m.storey.name ?? "", config: cfg!.name }));
        break;
      case "elevation-mismatch":
        findings.push(
          finding(el, "storey-elevation-mismatch", { elevation, config: cfg!.elevation.toFixed(3) }),
        );
        break;
      case "name-mismatch":
        findings.push(finding(el, "storey-name-mismatch", { storey: m.storey.name ?? "", config: cfg!.name }));
        break;
      case "duplicate":
        findings.push(finding(el, "storey-duplicate-match", { config: cfg!.name }));
        break;
      default:
        findings.push(finding(el, "storey-not-in-config", { storey: m.storey.name ?? "", elevation }));
    }
  }
  if (graph.storeys.length > config.length) {
    findings.push(
      finding({ guid: "-", entity: "IfcBuildingStorey", name: null }, "storey-count-exceeds", {
        count: graph.storeys.length,
        config: config.length,
      }),
    );
  }
  const matched = matches.filter((m) => m.state === "match").length;
  const absent = config.length - new Set(matches.filter((m) => m.state === "match").map((m) => m.config)).size;
  return result(
    id,
    "deviation",
    graph.storeys.length,
    findings,
    share(matched, graph.storeys.length),
    line("storey-config", { good: matched, total: graph.storeys.length, config: config.length, absent }),
  );
}
