/** What Oppsett's property picker lists: every property and quantity set in
 *  the loaded models, each property with the number of elements carrying it
 *  and its distinct values.
 *
 * The counts are `psetInventory`'s (`src/engine/pset-inventory.ts`), reduced
 * in the worker to names, counts and values so the type facts never cross to
 * the main thread. A quantity set is listed beside the property sets because
 * the evaluator reads a property source from both (`evaluate.ts`
 * `quantityProperty`). Asked for on demand, when Oppsett opens, never on the
 * parse path, so the board's first paint does not wait on it.
 *
 * The values are capped at `VALUE_CAP` per property (2026-10-01): a code
 * property has tens or hundreds, an id-like one can have one per element.
 * `distinct` and `valued` say how much the list leaves out, so a capped list
 * is never shown as the whole.
 */

import type { PsetInventory } from "../engine/pset-inventory.ts";

/** Distinct values per property the picker request asks for. */
export const VALUE_CAP = 500;

export interface PsetValue {
  /** The value as the engine hands it out (`PsetExample.verdi`). */
  v: string;
  /** Rows carrying it: one per element, as the inventory counts them. */
  n: number;
}

export interface PsetProp {
  name: string;
  /** Elements carrying the property, valued or blank. */
  n: number;
  /** Elements carrying a non-blank value. */
  valued: number;
  /** Distinct non-blank values, most frequent first, at most `VALUE_CAP`
   *  per model. */
  values: PsetValue[];
  /** Distinct non-blank values in total. Exact when `exact`; else a lower
   *  bound (several capped models merged: their lists may overlap). */
  distinct: number;
  exact: boolean;
}

export interface PsetChoice {
  set: string;
  /** Elements carrying the set. */
  objects: number;
  props: PsetProp[];
}

export function psetChoices(inventory: PsetInventory): PsetChoice[] {
  return mergeChoices([
    inventory.psett.map((entry) => ({
      set: entry.navn,
      objects: entry.objekter,
      props: entry.egenskaper.map((p) => ({
        name: p.navn,
        n: p.med_verdi + p.tom,
        valued: p.med_verdi,
        values: p.eksempler.map((e) => ({ v: e.verdi, n: e.n })),
        distinct: p.ulike,
        exact: true,
      })),
    })),
  ]);
}

interface PropAcc {
  n: number;
  valued: number;
  values: Map<string, number>;
  /** Per input list: its distinct count, and whether its values were capped. */
  parts: { distinct: number; capped: boolean }[];
}

/** One list over several models (and over a pset and a qto of one name):
 *  counts add up per set, per property and per value. Most elements first. */
export function mergeChoices(lists: PsetChoice[][]): PsetChoice[] {
  const sets = new Map<string, { objects: number; props: Map<string, PropAcc> }>();
  for (const list of lists) {
    for (const choice of list) {
      let s = sets.get(choice.set);
      if (!s) {
        s = { objects: 0, props: new Map() };
        sets.set(choice.set, s);
      }
      s.objects += choice.objects;
      for (const p of choice.props) {
        let acc = s.props.get(p.name);
        if (!acc) {
          acc = { n: 0, valued: 0, values: new Map(), parts: [] };
          s.props.set(p.name, acc);
        }
        acc.n += p.n;
        acc.valued += p.valued ?? 0;
        for (const value of p.values ?? []) acc.values.set(value.v, (acc.values.get(value.v) ?? 0) + value.n);
        const listed = p.values?.length ?? 0;
        acc.parts.push({ distinct: p.distinct ?? listed, capped: !(p.exact ?? true) || (p.distinct ?? listed) > listed });
      }
    }
  }
  return [...sets.entries()]
    .map(([set, s]) => ({
      set,
      objects: s.objects,
      props: [...s.props.entries()]
        .map(([name, acc]): PsetProp => {
          const values = [...acc.values.entries()]
            .map(([v, n]) => ({ v, n }))
            .sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
          const capped = acc.parts.some((part) => part.capped);
          // Uncapped lists merge exactly: the union is every value. A capped
          // one leaves values out, so the union and the largest part are only
          // lower bounds.
          const distinct = capped ? Math.max(values.length, ...acc.parts.map((part) => part.distinct)) : values.length;
          return { name, n: acc.n, valued: acc.valued, values, distinct, exact: !capped || acc.parts.length === 1 };
        })
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.objects - a.objects || a.set.localeCompare(b.set));
}
