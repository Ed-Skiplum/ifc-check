/** The seven numbers on the board's KPI row, derived in ONE place so the
 *  screen and `scripts/check-cli.ts` cannot print two different answers.
 *
 *   typesDeclared / typesUsed
 *               type objects the file DECLARES, and how many of them an element
 *               is actually defined by. Both, never one: "398 types" and "339
 *               types" are both true of KNM_ARK and mean different things, and
 *               the KPI printed the first while the type ledger counted a third
 *               number (84 distinct type NAMES). The card now prints
 *               `used / declared` and is labelled as that.
 *
 *               `typesDeclared` is `summary.tables.type_objects.rows`, the
 *               core's own count of the declared table. `typesUsed` is the
 *               distinct non-null `type_guid` over the products, which needs
 *               ifcfast 0.5.3; null when no product row carries the column, and
 *               null is printed as `—`, never as 0.
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
  /** The type object this product is defined by. `undefined` on a profile that
   *  predates the column — which is why `typesUsed` can be null. */
  typeGuid?: string | null;
}

export interface ModelKpis {
  typesDeclared: number | null;
  typesUsed: number | null;
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
  // A type used only by a copy/reference object is still a used type: the
  // exclusion scopes ELEMENTS, and nothing about the file's type roster changes
  // because a project marked some objects as duplicates.
  const usedTypes = new Set<string>();
  let sawTypeGuid = false;
  for (const p of products) {
    if (p.typeGuid === undefined) continue;
    sawTypeGuid = true;
    if (p.typeGuid !== null) usedTypes.add(p.typeGuid);
  }
  return {
    typesDeclared: typeTable && typeTable.loaded ? typeTable.rows : null,
    typesUsed: sawTypeGuid ? usedTypes.size : null,
    untyped: findingsOf(checks, "element-typed"),
    floors: storeys,
    sizeBytes,
    materials: names.size,
    orphans: findingsOf(checks, "storey-containment"),
    placement: findingsOf(checks, "mesh-placement"),
  };
}
