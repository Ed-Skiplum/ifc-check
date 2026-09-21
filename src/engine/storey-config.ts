/** The file's storeys against the project's floor config (Etasjeoppsett).
 *
 * edkjo: "Needs to be 1:1 or less floors, never more, and always same
 * elevation and naming." So, per model:
 *
 *   - every file storey matches one config floor EXACTLY on name and
 *     elevation. Name: exact, case-sensitive. A name that matches only after
 *     trimming whitespace is its own finding, never a silent match.
 *     Elevation: equal at millimetre precision, after the file's unit scale
 *     (StoreyRow.elevation is in FILE units, ifcfast#180).
 *   - the file has at most as many storeys as the config. Fewer is fine (a
 *     discipline need not model every floor); more is always a finding.
 *   - no config floor is matched by two file storeys.
 *
 * A config floor no file storey matches is ABSENT, shown in the matrix and
 * never a finding. With no config loaded the check is not_applicable, never a
 * pass. DEVIATION: a storey that is not the project's storey breaks every
 * floor filter and federation across disciplines.
 */

import type { CheckResult, Finding, IfcGraph, IfcSummary } from "./types";
import { finding, literal, result, share } from "./fundamentals.ts";

/** One floor of the project config. `elevation` in METRES. */
export interface FloorConfig {
  name: string;
  elevation: number;
}

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
  /** Index into the config of the floor this storey matched or is nearest to
   *  (same name, or same elevation); null for not-in-config. */
  config: number | null;
}

const mm = (m: number) => Math.round(m * 1000);

/** Per file storey, which config floor it is, and how. Exact matches claim
 *  their floor first, so a later near-miss cannot steal it; a second exact
 *  match on an already claimed floor is `duplicate`. */
export function matchStoreys(
  storeys: readonly FileStorey[],
  unitScale: number,
  config: readonly FloorConfig[],
): StoreyMatch[] {
  const claimed = new Set<number>();
  return storeys.map((storey) => {
    const elevationM = storey.elevation === null ? null : mm(storey.elevation * unitScale) / 1000;
    const name = storey.name ?? "";
    const sameElev = (i: number) => elevationM !== null && mm(config[i].elevation) === mm(elevationM);
    const exact = config.findIndex((c, i) => c.name === name && sameElev(i));
    if (exact >= 0) {
      const state = claimed.has(exact) ? "duplicate" : "match";
      claimed.add(exact);
      return { storey, elevationM, state, config: exact };
    }
    const trimmed = config.findIndex((c, i) => c.name.trim() === name.trim() && sameElev(i));
    if (trimmed >= 0) return { storey, elevationM, state: "whitespace", config: trimmed };
    const byName = config.findIndex((c) => c.name === name);
    if (byName >= 0) return { storey, elevationM, state: "elevation-mismatch", config: byName };
    const byElev = config.findIndex((_, i) => sameElev(i));
    if (byElev >= 0) return { storey, elevationM, state: "name-mismatch", config: byElev };
    return { storey, elevationM, state: "not-in-config", config: null };
  });
}

export function checkStoreyConfig(
  graph: IfcGraph,
  summary: IfcSummary,
  config: readonly FloorConfig[] | undefined,
): CheckResult {
  const id = "storey-config";
  if (!config || config.length === 0) {
    const reason = "no floor config loaded";
    return { ...result(id, "deviation", 0, [], literal("—"), reason), reason };
  }
  if (!summary.unit_resolved) {
    const reason = "length unit unresolved, storey elevations cannot be compared";
    return { ...result(id, "deviation", 0, [], literal("—"), reason), reason };
  }

  const matches = matchStoreys(graph.storeys, summary.unit_scale, config);
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
    `${matched} of ${graph.storeys.length} storeys match the floor config exactly; ` +
      `config has ${config.length}, ${absent} absent from this file`,
  );
}
