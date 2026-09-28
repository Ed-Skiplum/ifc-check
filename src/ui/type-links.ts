/** What goes with what: the Typer and Materialer galleries' collections and
 *  the links between them, computed once per profile. The tabs only draw.
 *
 * Owner, 2026-09-28: *"for the types and materials to show what goes with
 * what."* Three collections, each keyed the way its card is keyed:
 *
 *   type       `${entity}::${typeName ?? ""}`, one card per IFC class × type
 *              name (the Typer grouping since 2026-09-25). A class's elements
 *              with no type object are the card `${entity}::`, so "a class
 *              without a type" is a card too and a link can land on it.
 *   material   the material name, from `ProductRowLite.materials` (the
 *              engine's `graph.materials` names per product).
 *   layer set  `IfcMaterialLayerSet.Name` when the engine gives it, else the
 *              layer stack itself (`materialsJson()` rows, role `layer`).
 *
 * The links are the products themselves: a product belongs to one type card
 * (its class and its type name; `type_guid` is carried per card as the type
 * objects behind it), names its materials, and has its layer rows. Type ↔
 * material and type ↔ layer set are the union over the products, so a link
 * exists exactly when at least one element carries both ends, and the number
 * on it is how many elements do.
 *
 * Instance order (the Typer instance mode's ‹ › and ↑ ↓): by storey, lowest
 * elevation first, storeys with no elevation after those, elements in no
 * storey last; then by GlobalId, plain string order. Stable across reloads of
 * the same file, and independent of the parser's row order.
 */

import type { ModelProfile, ProductRowLite } from "./profile";
import type { CodeTree, TreeNode } from "../engine/code-tree";

export interface TypeCard {
  key: string;
  entity: string;
  typeName: string | null;
  source: string | null;
  /** Distinct `type_guid`s among the instances (normally one). */
  typeGuids: string[];
  count: number;
  /** Instances in the instance order (see the header). */
  guids: string[];
  ext: [number, number, number];
  lb: [number, number, number];
}

export interface MaterialCard {
  name: string;
  entities: string[];
  guids: string[];
}

export interface LayerSetCard {
  key: string;
  /** `IfcMaterialLayerSet.Name`, or null when the engine does not give it. */
  name: string | null;
  layers: { material: string | null; thickness: number | null }[];
  total: number | null;
  count: number;
  /** The elements using it, for a card click's selection. */
  guids: string[];
}

/** One end of a link and how many elements carry both ends. */
export interface Link {
  key: string;
  n: number;
}

export interface Catalogue {
  types: TypeCard[];
  materials: MaterialCard[];
  /** null when the engine supplied no `materialsJson()` rows. */
  sets: LayerSetCard[] | null;
  typeMaterials: Map<string, Link[]>;
  materialTypes: Map<string, Link[]>;
  setTypes: Map<string, Link[]>;
  /** Type → layer sets, the reverse of setTypes (the gallery's material
   *  cards under the viewer, 2026-09-28). */
  typeSets: Map<string, Link[]>;
}

export const typeKeyOf = (row: Pick<ProductRowLite, "entity" | "typeName">) =>
  `${row.entity}::${row.typeName ?? ""}`;

function bump(tally: [number, number, number], value: boolean | null | undefined) {
  if (value === true) tally[0] += 1;
  else if (value === false) tally[1] += 1;
  else tally[2] += 1;
}

/** Sort key per storey: lowest elevation first, no elevation after, no storey
 *  (or one the file does not declare) last. */
function storeyRank(profile: ModelProfile): (guid: string | null) => number {
  const ordered = [...profile.storeys].sort((a, b) => {
    if (a.elevation === null && b.elevation === null) return a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0;
    if (a.elevation === null) return 1;
    if (b.elevation === null) return -1;
    return a.elevation - b.elevation || (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0);
  });
  const rank = new Map(ordered.map((s, i) => [s.guid, i]));
  return (guid) => (guid !== null && rank.has(guid) ? rank.get(guid)! : ordered.length);
}

/** The instance order of the header, over any set of products. */
export function instanceOrder(profile: ModelProfile, rows: ProductRowLite[]): string[] {
  const rank = storeyRank(profile);
  return rows
    .map((r) => ({ guid: r.guid, at: rank(r.storeyGuid) }))
    .sort((a, b) => a.at - b.at || (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0))
    .map((r) => r.guid);
}

function layerStacks(profile: ModelProfile) {
  const table = profile.materialRows;
  if (!table) return null;
  const layersOf = new Map<string, { index: number; material: string | null; thickness: number | null }[]>();
  for (const row of table) {
    if (row.role !== "layer") continue;
    let list = layersOf.get(row.guid);
    if (!list) layersOf.set(row.guid, (list = []));
    list.push({ index: row.layer_index, material: row.material_name, thickness: row.layer_thickness_mm });
  }
  return layersOf;
}

/** Links out of a (from → to → n) tally, largest first, then by key. */
function ranked(tally: Map<string, Map<string, number>>): Map<string, Link[]> {
  const out = new Map<string, Link[]>();
  for (const [from, tos] of tally) {
    out.set(
      from,
      [...tos.entries()]
        .map(([key, n]) => ({ key, n }))
        .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    );
  }
  return out;
}

function count(tally: Map<string, Map<string, number>>, from: string, to: string) {
  let tos = tally.get(from);
  if (!tos) tally.set(from, (tos = new Map()));
  tos.set(to, (tos.get(to) ?? 0) + 1);
}

export function catalogue(profile: ModelProfile): Catalogue {
  const types = new Map<string, TypeCard & { rows: ProductRowLite[]; tg: Set<string> }>();
  const materials = new Map<string, { entities: Set<string>; guids: string[] }>();
  const typeMat = new Map<string, Map<string, number>>();
  const matType = new Map<string, Map<string, number>>();
  const setType = new Map<string, Map<string, number>>();
  const typeSet = new Map<string, Map<string, number>>();

  for (const product of profile.rows) {
    if (product.isOpening) continue;
    const key = typeKeyOf(product);
    let card = types.get(key);
    if (!card) {
      card = {
        key,
        entity: product.entity,
        typeName: product.typeName ?? null,
        source: product.typeSource ?? null,
        typeGuids: [],
        count: 0,
        guids: [],
        ext: [0, 0, 0],
        lb: [0, 0, 0],
        rows: [],
        tg: new Set(),
      };
      types.set(key, card);
    }
    card.count += 1;
    card.rows.push(product);
    if (product.typeGuid) card.tg.add(product.typeGuid);
    bump(card.ext, product.isExternal);
    bump(card.lb, product.loadBearing);
    for (const name of new Set(product.materials ?? [])) {
      count(typeMat, key, name);
      count(matType, name, key);
    }
  }

  // Materials over every product, openings included, as the tab always had it.
  for (const row of profile.rows) {
    for (const name of row.materials ?? []) {
      let line = materials.get(name);
      if (!line) materials.set(name, (line = { entities: new Set(), guids: [] }));
      line.entities.add(row.entity);
      line.guids.push(row.guid);
    }
  }

  // A set is keyed by its NAME when the engine gives one. The wasm build does
  // not (`layer_set` is null on every HI90_ARK product, 2026-09-25), so then
  // the key is the layer stack itself: two differently named sets with the
  // same layers read as one card, which claims the stack, never a name.
  const layersOf = layerStacks(profile);
  let sets: LayerSetCard[] | null = null;
  if (layersOf) {
    const byKey = new Map<string, LayerSetCard>();
    for (const product of profile.rows) {
      const rows = layersOf.get(product.guid);
      if (!rows || rows.length === 0) continue;
      const layers = rows
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((l) => ({ material: l.material, thickness: l.thickness }));
      const name = product.layerSet ?? null;
      const key = name ?? `stack:${layers.map((l) => `${l.material}|${l.thickness}`).join("/")}`;
      let set = byKey.get(key);
      if (!set) {
        const known = layers.every((l) => l.thickness !== null);
        set = {
          key,
          name,
          layers,
          total: known ? layers.reduce((sum, l) => sum + (l.thickness ?? 0), 0) : null,
          count: 0,
          guids: [],
        };
        byKey.set(key, set);
      }
      set.count += 1;
      set.guids.push(product.guid);
      if (!product.isOpening) {
        count(setType, key, typeKeyOf(product));
        count(typeSet, typeKeyOf(product), key);
      }
    }
    sets = [...byKey.values()].sort((a, b) => b.count - a.count);
  }

  const typeCards: TypeCard[] = [...types.values()]
    .map(({ rows, tg, ...card }) => ({ ...card, typeGuids: [...tg].sort(), guids: instanceOrder(profile, rows) }))
    .sort((a, b) => b.count - a.count);

  return {
    types: typeCards,
    materials: [...materials.entries()]
      .map(([name, line]) => ({ name, entities: [...line.entities].sort(), guids: line.guids }))
      .sort((a, b) => b.guids.length - a.guids.length),
    sets,
    typeMaterials: ranked(typeMat),
    materialTypes: ranked(matType),
    setTypes: ranked(setType),
    typeSets: ranked(typeSet),
  };
}

/* ── The two classification lines of a type card (2026-09-28) ──────────────
 *
 * Owner: *"the type cards need to show the system classification and function
 * classification: ns3451 vs ns3457-8 (or their fallback values ifctypeobject
 * and predefined type)"*. Read off the board's two code trees (`boardData`,
 * built through `codeLookupSubjects`, the path the Systemkode and
 * Funksjonskode requirements count by), so a card and the treemap cannot
 * disagree. Per instance: the code the mapping read (with its name in the
 * bundled list), or the raw value it did not accept (`deviating`); with no
 * mapping or no value, the fallback: the type object's IFC class for system,
 * PredefinedType for function. The type's line is the majority value, the
 * others kept with their counts, never hidden. */

export interface CodeValue {
  kind: "code" | "deviating" | "fallback" | "missing";
  /** The code, the raw value, or the fallback; null on `missing`. */
  value: string | null;
  /** The code's name in the bundled list, on `code`. */
  name: string | null;
  n: number;
}

export interface CodeLine extends CodeValue {
  /** The other values the instances carry, largest first. */
  others: CodeValue[];
}

export interface TypeCodes {
  system: CodeLine;
  function: CodeLine;
}

/** ifcfast spells a type class `IfcWalltype` (ifcfast#186). When it is the
 *  instance class plus `type` / `style`, give it the IFC spelling; otherwise
 *  as the engine gave it. */
export function typeObjectClass(typeEntity: string | null | undefined, entity: string): string | null {
  if (!typeEntity) return null;
  const base = entity.replace(/(StandardCase|ElementedCase)$/, "");
  const lower = typeEntity.toLowerCase();
  if (lower === `${base.toLowerCase()}type`) return `${base}Type`;
  if (lower === `${base.toLowerCase()}style`) return `${base}Style`;
  return typeEntity;
}

/** Per GlobalId, the deepest node of a code tree that holds it. */
function readingsOf(tree: CodeTree | null | undefined): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      for (const guid of node.guids) out.set(guid, node);
      walk(node.children);
    }
  };
  if (tree) walk(tree.root);
  return out;
}

function lineOf(values: CodeValue[]): CodeLine {
  const tally = new Map<string, CodeValue>();
  for (const v of values) {
    const k = `${v.kind}\u0000${v.value ?? ""}`;
    const at = tally.get(k);
    if (at) at.n += 1;
    else tally.set(k, { ...v, n: 1 });
  }
  const order = (v: CodeValue) => (v.kind === "missing" ? 1 : 0);
  const sorted = [...tally.values()].sort(
    (a, b) => b.n - a.n || order(a) - order(b) || String(a.value ?? "").localeCompare(String(b.value ?? "")),
  );
  const [top, ...others] = sorted;
  return top ? { ...top, others } : { kind: "missing", value: null, name: null, n: 0, others: [] };
}

export function typeCodes(
  profile: ModelProfile,
  types: readonly TypeCard[],
  trees: { system: CodeTree; function: CodeTree } | null | undefined,
): Map<string, TypeCodes> {
  const rowOf = new Map(profile.rows.map((r) => [r.guid, r]));
  const system = trees?.system.by === "mapping" ? readingsOf(trees.system) : new Map<string, TreeNode>();
  const fn = trees?.function.by === "mapping" ? readingsOf(trees.function) : new Map<string, TreeNode>();
  const out = new Map<string, TypeCodes>();
  for (const card of types) {
    const sys: CodeValue[] = [];
    const fun: CodeValue[] = [];
    for (const guid of card.guids) {
      const row = rowOf.get(guid);
      const s = system.get(guid);
      if (s && (s.kind === "code" || s.kind === "deviating")) {
        sys.push({ kind: s.kind, value: s.label, name: s.kind === "code" ? s.name : null, n: 1 });
      } else {
        const cls = row ? typeObjectClass(row.typeEntity, row.entity) : null;
        sys.push(cls ? { kind: "fallback", value: cls, name: null, n: 1 } : { kind: "missing", value: null, name: null, n: 1 });
      }
      const f = fn.get(guid);
      if (f && (f.kind === "code" || f.kind === "deviating")) {
        fun.push({ kind: f.kind, value: f.label, name: f.kind === "code" ? f.name : null, n: 1 });
      } else {
        const pre = row?.predefinedType ?? null;
        fun.push(pre ? { kind: "fallback", value: pre, name: null, n: 1 } : { kind: "missing", value: null, name: null, n: 1 });
      }
    }
    out.set(card.key, { system: lineOf(sys), function: lineOf(fun) });
  }
  return out;
}