/** The ONE active filter, as a pure reducer (2026-09-28).
 *
 * edkjo's rule, verbatim: *"cross filter should have one origin: all other
 * views show only the matching results. The clicked origin highlights. So:
 * Original: Highlight, everything else: Isolate."* It replaced chips that
 * AND-ed across facets, which the owner saw as *"the cross filter is
 * cumulative somehow"*.
 *
 * So there is exactly one filter per model: the view that was clicked (its
 * ORIGIN), what was chosen in it (its KEY) and the elements that stand for
 * (a focus the caller resolves, or the guids themselves). A click anywhere
 * REPLACES it and makes that view the origin; the chosen item clicked again
 * clears it. Nothing stacks.
 *
 * Two exceptions, both within ONE view:
 *   - Shift or Ctrl on an ELEMENT pick (the canvas, a Scope row, a graph
 *     product) adds that element to, or takes it from, the element filter
 *     of the same origin. A click in another view still replaces it.
 *   - A pick IN Scope keeps the list it was made from (`base`): Scope is the
 *     origin then, so it keeps its rows, and picking the chosen row again
 *     steps back to that list's own filter rather than to nothing.
 *
 * Pure and free of React so the selftest can drive it (`ids-cli.ts`).
 */

import type { Focus } from "./trace";

/** The view a click came from: `viewer`, `graph`, `scope`, `tree-system`,
 *  `tree-function`, `mmi`, `reqs`, `checks`, `ids`, `floors`, `census`,
 *  `types`, `type-materials`, `materials`, `typepage`. */
export type Origin = string;

export type ChipKind =
  | "class"
  | "cell"
  | "check"
  | "rule"
  | "type"
  | "storey"
  | "element"
  /** A material row of the Materialer tab; carries its own `guids`. */
  | "material"
  | "tree"
  /** One specification of the loaded `.ids`: its failing elements. */
  | "ids";

export interface ActiveFilter {
  origin: Origin;
  /** What was chosen, unique within its origin. */
  key: string;
  kind: ChipKind;
  label: string;
  /** The board number it was made from, resolved by the caller. */
  focus?: Focus;
  /** The elements, when the chosen item carries them itself. */
  guids?: string[];
  /** A pick made in Scope: the filter Scope's list belongs to. */
  base?: FilterState;
}

export interface FilterState {
  /** The click that set this state, or null at rest. */
  origin: Origin | null;
  key: string | null;
  /** The active filter. Null with an origin: a click on something that is
   *  not an element set (a KPI of every product, a check that never ran). It
   *  opens Scope and narrows nothing. */
  filter: ActiveFilter | null;
  /** What Scope lists. */
  scope: Focus | null;
  selection: string[];
}

export const EMPTY_FILTER: FilterState = { origin: null, key: null, filter: null, scope: null, selection: [] };

export type FilterAction =
  /** A click on a set: a number, a cell, a card. `filter` null when it is
   *  not an element set. `scope` is what Scope lists for it. */
  | {
      type: "choose";
      origin: Origin;
      key: string;
      filter: Omit<ActiveFilter, "origin" | "key"> | null;
      scope: Focus | null;
      selection?: string[];
    }
  /** A click on ONE element in a view. */
  | { type: "element"; origin: Origin; guid: string | null; label: string | null; additive: boolean }
  | { type: "clear" }
  /** Set outright, no toggle: the type page's own isolate. */
  | { type: "set"; state: FilterState };

const elementKey = (guids: string[]) => `element:${guids.join("+")}`;

function elementState(origin: Origin, guids: string[], label: string, prev: FilterState): FilterState {
  const inScope = origin === "scope";
  // A pick in Scope remembers the filter its list came from; picking on
  // from there keeps the same base.
  const own = ({ origin: o, key, filter, scope, selection }: FilterState): FilterState => ({ origin: o, key, filter, scope, selection });
  const base = inScope ? (prev.filter?.origin === "scope" ? prev.filter.base : own(prev)) : undefined;
  return {
    origin,
    key: elementKey(guids),
    filter: { origin, key: elementKey(guids), kind: "element", label, guids, base },
    scope: inScope ? prev.scope : { kind: "element", guids },
    selection: guids,
  };
}

export function reduceFilter(state: FilterState, action: FilterAction): FilterState {
  if (action.type === "clear") return EMPTY_FILTER;
  if (action.type === "set") {
    const { origin, key, filter, scope, selection } = action.state;
    return { origin, key, filter, scope, selection };
  }

  if (action.type === "choose") {
    // The chosen item again: off.
    if (state.origin === action.origin && state.key === action.key) return EMPTY_FILTER;
    return {
      origin: action.origin,
      key: action.key,
      filter: action.filter ? { ...action.filter, origin: action.origin, key: action.key } : null,
      scope: action.scope,
      selection: action.selection ?? [],
    };
  }

  // One element.
  const { origin, guid, additive } = action;
  const mine = state.filter?.kind === "element" && state.filter.origin === origin ? state.filter : null;
  // Where a Scope pick steps back to: its list's own filter.
  const back = (): FilterState =>
    origin === "scope" && mine?.base ? mine.base : origin === "scope" ? { ...EMPTY_FILTER, scope: state.scope } : EMPTY_FILTER;
  if (guid === null) return mine ? back() : { ...state, selection: [] };
  const label = action.label ?? guid;
  const current = mine?.guids ?? [];
  if (additive && mine) {
    const next = current.includes(guid) ? current.filter((g) => g !== guid) : [...current, guid];
    if (next.length === 0) return back();
    return elementState(origin, next, next.length === 1 ? label : `${next.length}`, state);
  }
  if (mine && current.length === 1 && current[0] === guid) return back();
  return elementState(origin, [guid], label, state);
}
