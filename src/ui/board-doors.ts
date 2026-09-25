/** The elements behind a requirement, a value of its fordeling, or a treemap
 *  cell: what the Scope panel lists and what the chip narrows to. Read off
 *  the board data the worker built (`report-rows.ts`); nothing is recounted.
 *
 *  - a requirement: its report row's `funn`, the objects it flagged
 *  - a value of a mapping row: every object the rule read that value on
 *    (`BoardData.values`), flagged or not
 *  - a value of any other row: the `funn` carrying that value, which is only
 *    the flagged values, so an unflagged value there is not a door
 *  - a treemap cell: the node's objects */

import { findNode } from "../engine/code-tree";
import type { ReportFinding, ReportRow } from "../engine/report";
import type { ModelEntry } from "./useModels";
import { rowOfReq } from "./requirements";

type ReqFocus = { kind: "req"; id: string; value?: string | null };
type TreeFocus = { kind: "tree"; axis: "system" | "function"; key: string };

export interface Door {
  row: ReportRow | null;
  guids: string[];
  /** The findings behind the door, when it is a finding set: their code and
   *  value ride the Scope rows. */
  funn: ReportFinding[] | null;
}

export function reqDoor(model: ModelEntry, focus: ReqFocus): Door {
  const row = rowOfReq(model.board?.rows, focus.id);
  if (!row) return { row: null, guids: [], funn: null };
  if (focus.value === undefined) {
    return { row, guids: [...new Set(row.funn.map((f) => f.guid))], funn: row.funn };
  }
  const index = model.board?.values[row.id];
  if (index) {
    const hit = index.find(([v]) => v === focus.value);
    return { row, guids: hit ? hit[1] : [], funn: null };
  }
  const funn = row.funn.filter((f) => f.verdi === focus.value);
  return { row, guids: [...new Set(funn.map((f) => f.guid))], funn };
}

/** Whether a value of this row opens anything, and how many objects. */
export function valueDoorSize(model: ModelEntry, row: ReportRow, value: string | null): number {
  const index = model.board?.values[row.id];
  if (index) return index.find(([v]) => v === value)?.[1].length ?? 0;
  return row.funn.filter((f) => f.verdi === value).length;
}

export function treeDoor(model: ModelEntry, focus: TreeFocus): string[] | null {
  const tree = model.board?.trees[focus.axis];
  if (!tree) return null;
  return findNode(tree.root, focus.key)?.guids ?? null;
}
