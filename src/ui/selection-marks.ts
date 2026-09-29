/** Which containers hold the selection (2026-09-29).
 *
 * edkjo: *"selected objects need to be highlighted, be that graph, chart,
 * table or model object."* (data-workspace.md, SELECTION IS VISIBLE
 * EVERYWHERE.) The selection is its own state (`filter-state.ts`); this
 * answers, for any view, "does this cell, row, bar or card hold a selected
 * element?", so every view can carry the one mark (`[data-sel]`, index.css).
 *
 * A mark only: nothing here narrows, hides or moves anything. The filter
 * still isolates; the selection highlights inside whatever the filter shows.
 *
 * The common doors (a class, a storey × class cell, a storey, a type) are
 * answered off the selected rows' own facts, so a board of a few hundred
 * doors costs a few hundred lookups. Every other focus (a check, a rule, a
 * requirement, a code-tree node) is resolved once through `resolve` and
 * remembered for this selection.
 *
 * Pure and free of React, so the selftest drives it (`ids-cli.ts`).
 */

import type { Focus } from "./trace";
import type { ModelProfile } from "./profile";

export interface SelectionMarks {
  /** How many elements are selected. */
  readonly size: number;
  /** This element is selected. */
  has(guid: string): boolean;
  /** A selected element is among these. */
  any(guids: Iterable<string> | null | undefined): boolean;
  /** The set this focus stands for holds a selected element. */
  focus(focus: Focus | null | undefined): boolean;
}

export const NO_MARKS: SelectionMarks = {
  size: 0,
  has: () => false,
  any: () => false,
  focus: () => false,
};

/** A focus's elements, or null when it is not an element set. */
export type FocusResolver = (focus: Focus) => ReadonlySet<string> | null;

const SEP = "\u0000";

/** The marks for `selection` over `profile`. `resolve` answers the foci the
 *  rows cannot (checks, rules, requirements, tree nodes, ids). */
export function selectionMarks(
  selection: readonly string[],
  profile: Pick<ModelProfile, "rows" | "storeys"> | null,
  resolve: FocusResolver,
): SelectionMarks {
  if (selection.length === 0) return NO_MARKS;
  const sel = new Set(selection);

  // The selected rows' own facts, bucketed as `census` and `typeGuids`
  // bucket them: an element whose storey is not a known storey is in the
  // no-storey bucket, an opening is in no type.
  const entities = new Set<string>();
  const cells = new Set<string>();
  const storeys = new Set<string | null>();
  const types = new Set<string | null>();
  if (profile) {
    const known = new Set(profile.storeys.map((s) => s.guid));
    for (const row of profile.rows) {
      if (!sel.has(row.guid)) continue;
      const storey = row.storeyGuid !== null && known.has(row.storeyGuid) ? row.storeyGuid : null;
      entities.add(row.entity);
      cells.add(`${storey ?? ""}${SEP}${row.entity}`);
      storeys.add(storey);
      if (row.isOpening !== true) types.add(row.typed && row.typeName ? row.typeName : null);
    }
  }

  const has = (guid: string) => sel.has(guid);
  const any = (guids: Iterable<string> | null | undefined) => {
    if (!guids) return false;
    for (const g of guids) if (sel.has(g)) return true;
    return false;
  };
  const memo = new Map<string, boolean>();
  const focus = (f: Focus | null | undefined): boolean => {
    if (!f) return false;
    switch (f.kind) {
      case "kpi":
        return false;
      case "element":
        return any(f.guids);
      case "class":
        return profile ? entities.has(f.entity) : resolved(f);
      case "cell":
        return profile ? cells.has(`${f.storeyGuid ?? ""}${SEP}${f.entity}`) : resolved(f);
      case "storey":
        return profile ? f.storeyGuids.some((g) => storeys.has(g)) : resolved(f);
      case "type":
        return profile ? types.has(f.typeName) : resolved(f);
      default:
        return resolved(f);
    }
  };
  function resolved(f: Focus): boolean {
    const key = JSON.stringify(f);
    let hit = memo.get(key);
    if (hit === undefined) {
      hit = any(resolve(f));
      memo.set(key, hit);
    }
    return hit;
  }
  return { size: sel.size, has, any, focus };
}

/** The attribute every view sets on a marked element: `data-sel` present,
 *  absent otherwise (React drops `undefined`). */
export const selAttr = (on: boolean): "" | undefined => (on ? "" : undefined);
