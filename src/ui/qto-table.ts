/** The Innhold tab's QTO table, as data (2026-10-01, edkjo: *"Innhold is a
 *  rollup of content, like the treemaps, QTO, etc."*). Pure: the table only
 *  draws this. Selftest in `scripts/ids-cli.ts`.
 *
 * One row per group of the chosen ear (Klasse · Type · Systemkode ·
 * Komponentkode · Etasje · Materiale), each with Antall · Volum · Areal ·
 * Lengde, and a totals row. Nothing here measures: the quantities are the
 * ones the treemaps resolve (`MeasureState.elements`, `ElementQuantity`),
 * the codes the board's code trees (`treeLeaves`: every object in exactly
 * one tile), materials the profile's (`elementMaterialNames`).
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 *   missing   an element with no value for a measure adds nothing to its
 *             sum and is counted under `missing`, never as zero.
 *   pending   an element the geometry pass has not reached yet: the sum is
 *             not final, so a measure with any pending element is shown as
 *             pending, never as a partial figure (`qtoPending`).
 *   grouping  an element the ear cannot place (a space under a code ear:
 *             spaces are in neither code tree) is in no row and not in the
 *             totals; `ungrouped` counts it.
 *   material  an element's materials are one group (its names, sorted,
 *             joined), so the totals stay the elements' own: an element is
 *             never counted under two materials.
 */

import type { ProductRowLite, StoreyRowLite } from "./profile";
import type { ElementQuantity } from "../engine/quantities";
import type { StringKey } from "./i18n";
import { treeLeaves, type CodeTree } from "../engine/code-tree.ts";

export type QtoBy = "class" | "type" | "system" | "function" | "storey" | "material";
export const QTO_BY: readonly QtoBy[] = ["class", "type", "system", "function", "storey", "material"];

/** Each ear's label: the existing column and mapping names. */
export const QTO_EAR: Record<QtoBy, StringKey> = {
  class: "col.class",
  type: "col.type",
  system: "mapping.system-classification",
  function: "mapping.component-classification",
  storey: "col.storey",
  material: "field.source.material",
};

export type QtoMeasure = "count" | "volume" | "area" | "length";
export const QTO_MEASURES: readonly QtoMeasure[] = ["count", "volume", "area", "length"];

/** A group an element falls in. `label` null is the group's own "none":
 *  untyped, no storey, a code tree's missing cell, no material. */
export interface QtoGroup {
  key: string;
  label: string | null;
  /** A code's name in its list (the code ears). */
  name?: string | null;
}

export type QtoKeyOf = (row: ProductRowLite) => QtoGroup | null;

export interface QtoSum {
  /** The summed values of the elements that have one. */
  sum: number;
  /** Elements with no value. */
  missing: number;
  /** Elements the geometry pass has not reached. */
  pending: number;
}

export interface QtoRow extends QtoGroup {
  guids: string[];
  count: number;
  volume: QtoSum;
  area: QtoSum;
  length: QtoSum;
}

export interface QtoTable {
  rows: QtoRow[];
  total: QtoRow;
  /** Elements in scope the ear places in no group. */
  ungrouped: number;
}

/** The element quantities as the model holds them; absent = not received. */
export interface QtoQuantities {
  byGuid: Readonly<Record<string, ElementQuantity>>;
  complete: boolean;
}

/** Where a measure sits in an `ElementQuantity`: value, then source (0 Qto,
 *  1 computed, 2 missing, 3 pending). */
const AT = { volume: 0, area: 2, length: 4 } as const;

const sum0 = (): QtoSum => ({ sum: 0, missing: 0, pending: 0 });

function add(into: QtoSum, q: ElementQuantity | undefined, at: 0 | 2 | 4, quantities: QtoQuantities | undefined) {
  if (!quantities) {
    into.pending += 1;
    return;
  }
  if (!q) {
    // No entry: final only once the pass is complete.
    if (quantities.complete) into.missing += 1;
    else into.pending += 1;
    return;
  }
  const v = q[at];
  const src = q[at + 1];
  if (src === 3) into.pending += 1;
  else if (src === 2 || typeof v !== "number") into.missing += 1;
  else into.sum += v;
}

function addRow(into: QtoRow, guid: string, quantities: QtoQuantities | undefined) {
  const q = quantities?.byGuid[guid];
  into.guids.push(guid);
  into.count += 1;
  add(into.volume, q, AT.volume, quantities);
  add(into.area, q, AT.area, quantities);
  add(into.length, q, AT.length, quantities);
}

const emptyRow = (group: QtoGroup): QtoRow => ({
  ...group,
  guids: [],
  count: 0,
  volume: sum0(),
  area: sum0(),
  length: sum0(),
});

/** How each ear places an element, or null where the ear has nothing to
 *  group by: a code ear without its mapping, Materiale without the material
 *  table. */
export function qtoKeyOf(
  by: QtoBy,
  input: {
    storeys: readonly StoreyRowLite[];
    trees?: { system: CodeTree; function: CodeTree };
    /** The material table was supplied (`ModelProfile.materialRows`). */
    materials: boolean;
  },
): QtoKeyOf | null {
  if (by === "class") return (row) => ({ key: row.entity, label: row.entity });
  if (by === "type") {
    // The ledger's key: the type name, null the untyped remainder.
    return (row) => {
      const name = row.typeName ?? null;
      return name === null ? { key: "", label: null } : { key: `=${name}`, label: name };
    };
  }
  if (by === "storey") {
    const names = new Map(input.storeys.map((s) => [s.guid, s.name ?? s.guid]));
    return (row) =>
      row.storeyGuid !== null && names.has(row.storeyGuid)
        ? { key: row.storeyGuid, label: names.get(row.storeyGuid)! }
        : { key: "", label: null };
  }
  if (by === "material") {
    if (!input.materials) return null;
    return (row) => {
      const names = [...new Set(row.materials ?? [])].sort((a, b) => a.localeCompare(b));
      return names.length ? { key: names.join("\u0000"), label: names.join(" · ") } : { key: "", label: null };
    };
  }
  const tree = input.trees?.[by];
  if (!tree || tree.by !== "mapping") return null;
  const leafOf = new Map<string, QtoGroup>();
  for (const { node } of treeLeaves(tree.root)) {
    const group: QtoGroup = { key: node.key, label: node.kind === "missing" ? null : node.label, name: node.name };
    for (const g of node.guids) leafOf.set(g, group);
  }
  return (row) => leafOf.get(row.guid) ?? null;
}

/** The table over `rows` (the profile's), within `within` when a filter
 *  from another view isolates it. Rows in first-seen order; sort with
 *  `sortQto`. */
export function qtoTable(
  rows: readonly ProductRowLite[],
  keyOf: QtoKeyOf,
  quantities: QtoQuantities | undefined,
  within: ReadonlySet<string> | null = null,
): QtoTable {
  const groups = new Map<string, QtoRow>();
  const total = emptyRow({ key: "", label: null });
  let ungrouped = 0;
  for (const row of rows) {
    if (within && !within.has(row.guid)) continue;
    const group = keyOf(row);
    if (!group) {
      ungrouped += 1;
      continue;
    }
    let into = groups.get(group.key);
    if (!into) {
      into = emptyRow(group);
      groups.set(group.key, into);
    }
    addRow(into, row.guid, quantities);
    addRow(total, row.guid, quantities);
  }
  return { rows: [...groups.values()], total, ungrouped };
}

/** A measure is pending while any element of the table waits on the
 *  geometry pass: its figures are not final, so none is shown. */
export function qtoPending(table: QtoTable, measure: QtoMeasure): boolean {
  return measure !== "count" && table.total[measure].pending > 0;
}

/** A row's figure for a measure: the count, or the sum of the values known. */
export function qtoValue(row: QtoRow, measure: QtoMeasure): number {
  return measure === "count" ? row.count : row[measure].sum;
}

/** What the table sorts by: a measure, or the group column. */
export type QtoSort = QtoMeasure | "label";

/** Sorted by a measure (descending unless `asc`; ties by count, then label)
 *  or by the group label (ascending unless `asc` is false); a group's "none"
 *  last either way. */
export function sortQto(rows: readonly QtoRow[], by: QtoSort, asc = by === "label"): QtoRow[] {
  const dir = asc ? 1 : -1;
  const byLabel = (a: QtoRow, b: QtoRow, d: number) => {
    if (a.label === null) return b.label === null ? 0 : 1;
    if (b.label === null) return -1;
    return d * a.label.localeCompare(b.label, undefined, { numeric: true });
  };
  return [...rows].sort((a, b) => {
    if (by === "label") return byLabel(a, b, dir) || b.count - a.count;
    const d = qtoValue(a, by) - qtoValue(b, by);
    if (d !== 0) return dir * d;
    if (a.count !== b.count) return b.count - a.count;
    return byLabel(a, b, 1);
  });
}
