/** The seven numbers on the board's KPI row, derived in ONE place so the
 *  screen and `scripts/check-cli.ts` cannot print two different answers.
 *
 *   types       type objects the file DECLARES (`summary.tables.type_objects`
 *               rows). The graph only reaches types through the elements that
 *               use them, but the core counts the declared table, so the
 *               declared number is available and is what "types in the file"
 *               means. null when the table did not load.
 *   untyped     findings of `element-typed`
 *   floors      IfcBuildingStorey count
 *   sizeBytes   the file's size
 *   materials   distinct material names over the physical, in-scope products
 *   orphans     findings of `storey-containment`. The wasm graph carries
 *               storey containment only, so an element contained directly in
 *               a site or building counts here too.
 *   placement   findings of `mesh-placement` (see `placement.ts`)
 *
 * The three finding counts come off `checks`, so they follow the copy-object
 * scope filter whenever the checks were re-run with it.
 */

import type { CheckResult, IfcSummary } from "./types";

export interface KpiProduct {
  guid: string;
  materials?: readonly string[];
  isOpening?: boolean;
}

export interface ModelKpis {
  types: number | null;
  untyped: number | null;
  floors: number;
  sizeBytes: number;
  materials: number;
  orphans: number | null;
  placement: number | null;
}

/** Findings of a check, or null when it did not run: a check that could not
 *  run has no count, and a zero would read as a clean result. */
function findingsOf(checks: readonly CheckResult[], id: string): number | null {
  const check = checks.find((c) => c.id === id);
  if (!check || check.state === "not_applicable") return null;
  return check.findings.length;
}

export function modelKpis(args: {
  summary: IfcSummary;
  checks: readonly CheckResult[];
  sizeBytes: number;
  storeys: number;
  products: readonly KpiProduct[];
  excluded?: ReadonlySet<string>;
}): ModelKpis {
  const { summary, checks, sizeBytes, storeys, products, excluded } = args;
  const typeTable = summary.tables?.type_objects;
  const names = new Set<string>();
  for (const p of products) {
    if (p.isOpening || excluded?.has(p.guid)) continue;
    for (const m of p.materials ?? []) if (m && m.trim()) names.add(m.trim());
  }
  return {
    types: typeTable && typeTable.loaded ? typeTable.rows : null,
    untyped: findingsOf(checks, "element-typed"),
    floors: storeys,
    sizeBytes,
    materials: names.size,
    orphans: findingsOf(checks, "storey-containment"),
    placement: findingsOf(checks, "mesh-placement"),
  };
}
