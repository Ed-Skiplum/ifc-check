/** The Typer and Materialer facets (2026-09-28): flat toggle pills that
 *  narrow the gallery. Pure; the tabs only draw.
 *
 * Owner: *"we need filtering in the types and materials list. By ifcentities
 * and by classification and the main type properties"* … *"also, by unused
 * type and single instance types"*.
 *
 *   entity     the instances' IFC class (an unused type: its own class).
 *   system     the NS 3451 reading the card's System line tallies, or its
 *              fallback (the type object's class); none when neither.
 *   function   the NS 3457-8 reading of the Funksjon line, or PredefinedType.
 *   ext lb     IsExternal, LoadBearing: true, false or none.
 *   fire       FireRating as it occurs, or none.
 *   use        Typer only: `unused` (declared, no instance) and `single`
 *              (exactly one instance).
 *
 * The element facets are read per element (`elementFacets`), and a card
 * carries every value one of its elements has: a type whose instances
 * disagree on IsExternal answers to both true and false, as its card shows
 * both. A material card is its elements, so the same holds for Materialer. An
 * unused type has no elements: none in every element facet but its class.
 *
 * AND across facets, OR within one. A value's count is the cards that would
 * show if it were added, so every other facet's choice applies to it and its
 * own facet's does not. Unused types show only while `unused` is chosen, since
 * the gallery without that facet is the model's instances.
 *
 * A facet narrows the gallery only; a card click stays the one-origin cross
 * filter (`cross-filter.ts`) and a facet never touches it.
 */

import type { ModelProfile } from "./profile";
import type { CodeValue } from "./type-links";
import { elementCodes } from "./type-links.ts";
import type { CodeTree } from "../engine/code-tree";

export type ElementFacetId = "entity" | "system" | "function" | "ext" | "lb" | "fire";
export type FacetId = ElementFacetId | "use";

export const ELEMENT_FACETS: readonly ElementFacetId[] = ["entity", "system", "function", "ext", "lb", "fire"];

/** The none bucket's key. Not a value a file can carry. */
export const NONE = "\u0000none";

export interface FacetValue {
  key: string;
  /** How the pill draws it: a code, a raw value the list did not accept, a
   *  fallback (italic, as on the card), a plain value, or none. */
  kind: CodeValue["kind"] | "value";
  /** The code's name in the bundled list, for the pill's title. */
  name?: string | null;
}

/** Per GlobalId, the value it carries in each element facet. */
export type ElementFacets = Map<string, Record<ElementFacetId, FacetValue>>;

const none: FacetValue = { key: NONE, kind: "missing" };

function codeValue(v: CodeValue): FacetValue {
  return v.kind === "missing" || v.value === null ? none : { key: v.value, kind: v.kind, name: v.name };
}

function bool(v: boolean | null | undefined): FacetValue {
  return v === true ? { key: "true", kind: "value" } : v === false ? { key: "false", kind: "value" } : none;
}

export function elementFacets(
  profile: ModelProfile,
  trees: { system: CodeTree; function: CodeTree } | null | undefined,
): ElementFacets {
  const codes = elementCodes(profile, trees);
  const out: ElementFacets = new Map();
  for (const row of profile.rows) {
    const c = codes.get(row.guid);
    const fire = row.fireRating?.trim();
    out.set(row.guid, {
      entity: { key: row.entity, kind: "value" },
      system: c ? codeValue(c.system) : none,
      function: c ? codeValue(c.function) : none,
      ext: bool(row.isExternal),
      lb: bool(row.loadBearing),
      fire: fire ? { key: fire, kind: "value" } : none,
    });
  }
  return out;
}

/** One card as the facets see it. */
export interface FacetItem {
  key: string;
  values: Partial<Record<FacetId, Set<string>>>;
  /** An unused type: shown only while the `unused` value is chosen. */
  unused?: boolean;
}

export interface FacetItems {
  items: FacetItem[];
  /** Every value that occurs, per facet, for the pills. */
  values: Map<FacetId, Map<string, FacetValue>>;
}

export type FacetSelection = Partial<Record<FacetId, readonly string[]>>;

function collector() {
  const values = new Map<FacetId, Map<string, FacetValue>>();
  const add = (item: FacetItem, facet: FacetId, value: FacetValue) => {
    let set = item.values[facet];
    if (!set) item.values[facet] = set = new Set();
    set.add(value.key);
    let seen = values.get(facet);
    if (!seen) values.set(facet, (seen = new Map()));
    if (!seen.has(value.key)) seen.set(value.key, value);
  };
  return { values, add };
}

/** Cards that are sets of elements (material cards, layer set cards, used
 *  type cards): each carries the union of its elements' values. */
function elementItem(key: string, guids: readonly string[], index: ElementFacets, add: ReturnType<typeof collector>["add"]): FacetItem {
  const item: FacetItem = { key, values: {} };
  for (const guid of guids) {
    const at = index.get(guid);
    if (!at) continue;
    for (const facet of ELEMENT_FACETS) add(item, facet, at[facet]);
  }
  return item;
}

export function elementItems(cards: readonly { key: string; guids: readonly string[] }[], index: ElementFacets): FacetItems {
  const { values, add } = collector();
  return { items: cards.map((c) => elementItem(c.key, c.guids, index, add)), values };
}

/** The Typer gallery's cards, plus the unused type cards (count 0). */
export function typeItems(
  cards: readonly { key: string; entity: string; count: number; guids: readonly string[] }[],
  unused: readonly { key: string; entity: string }[],
  index: ElementFacets,
): FacetItems {
  const { values, add } = collector();
  const items = cards.map((c) => {
    const item = elementItem(c.key, c.guids, index, add);
    if (c.count === 1) add(item, "use", { key: "single", kind: "value" });
    return item;
  });
  for (const c of unused) {
    const item: FacetItem = { key: c.key, values: {}, unused: true };
    add(item, "entity", { key: c.entity, kind: "value" });
    for (const facet of ELEMENT_FACETS) if (facet !== "entity") add(item, facet, none);
    add(item, "use", { key: "unused", kind: "value" });
    items.push(item);
  }
  return { items, values };
}

/** The item passes every chosen facet but `except`. */
export function passes(item: FacetItem, sel: FacetSelection, except?: FacetId): boolean {
  if (item.unused && except !== "use" && !(sel.use ?? []).includes("unused")) return false;
  for (const facet of Object.keys(sel) as FacetId[]) {
    if (facet === except) continue;
    const chosen = sel[facet];
    if (!chosen || chosen.length === 0) continue;
    const has = item.values[facet];
    if (!has || !chosen.some((k) => has.has(k))) return false;
  }
  return true;
}

/** The keys of the cards the selection shows. */
export function narrow(items: readonly FacetItem[], sel: FacetSelection): Set<string> {
  return new Set(items.filter((i) => passes(i, sel)).map((i) => i.key));
}

/** A facet's pills: each value with the cards it would show. A value that
 *  would show none is left out unless it is chosen, so it can be cleared.
 *  Largest first, then by value; none last. */
export function facetCounts(fi: FacetItems, sel: FacetSelection, facet: FacetId): { value: FacetValue; n: number }[] {
  const known = fi.values.get(facet);
  if (!known) return [];
  const tally = new Map<string, number>();
  for (const item of fi.items) {
    if (!passes(item, sel, facet)) continue;
    for (const k of item.values[facet] ?? []) tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const chosen = new Set(sel[facet] ?? []);
  return [...known.values()]
    .map((value) => ({ value, n: tally.get(value.key) ?? 0 }))
    .filter((v) => v.n > 0 || chosen.has(v.value.key))
    .sort(
      (a, b) =>
        Number(a.value.key === NONE) - Number(b.value.key === NONE) ||
        b.n - a.n ||
        a.value.key.localeCompare(b.value.key, undefined, { numeric: true }),
    );
}

/** One value on or off. */
export function toggle(sel: FacetSelection, facet: FacetId, key: string): FacetSelection {
  const at = sel[facet] ?? [];
  const next = at.includes(key) ? at.filter((k) => k !== key) : [...at, key];
  const out: FacetSelection = { ...sel };
  if (next.length > 0) out[facet] = next;
  else delete out[facet];
  return out;
}

export const anyChosen = (sel: FacetSelection) => Object.values(sel).some((v) => v && v.length > 0);
