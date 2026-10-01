/** What Oppsett's property picker lists: every property and quantity set in
 *  the loaded models, each property with the number of elements carrying it.
 *
 * The counts are `psetInventory`'s (`src/engine/pset-inventory.ts`), reduced
 * in the worker to names and counts so the examples and type facts never
 * cross to the main thread. A quantity set is listed beside the property sets
 * because the evaluator reads a property source from both (`evaluate.ts`
 * `quantityProperty`). Asked for on demand, when Oppsett opens, never on the
 * parse path, so the board's first paint does not wait on it.
 */

import type { PsetInventory } from "../engine/pset-inventory.ts";

export interface PsetChoice {
  set: string;
  /** Elements carrying the set. */
  objects: number;
  /** Elements carrying the property, valued or blank. */
  props: { name: string; n: number }[];
}

export function psetChoices(inventory: PsetInventory): PsetChoice[] {
  return mergeChoices([
    inventory.psett.map((entry) => ({
      set: entry.navn,
      objects: entry.objekter,
      props: entry.egenskaper.map((p) => ({ name: p.navn, n: p.med_verdi + p.tom })),
    })),
  ]);
}

/** One list over several models (and over a pset and a qto of one name):
 *  counts add up per set and per property. Most elements first. */
export function mergeChoices(lists: PsetChoice[][]): PsetChoice[] {
  const sets = new Map<string, { objects: number; props: Map<string, number> }>();
  for (const list of lists) {
    for (const choice of list) {
      let s = sets.get(choice.set);
      if (!s) {
        s = { objects: 0, props: new Map() };
        sets.set(choice.set, s);
      }
      s.objects += choice.objects;
      for (const p of choice.props) s.props.set(p.name, (s.props.get(p.name) ?? 0) + p.n);
    }
  }
  return [...sets.entries()]
    .map(([set, s]) => ({
      set,
      objects: s.objects,
      props: [...s.props.entries()]
        .map(([name, n]) => ({ name, n }))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.objects - a.objects || a.set.localeCompare(b.set));
}
