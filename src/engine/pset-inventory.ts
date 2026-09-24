/** The pset inventory: every property and quantity set in a model, on
 *  instances and through types, as data (Ed-Skiplum/ifc-check#1 gap 5).
 *
 * HI90's Egenskapssett gallery renders it; this module only counts. It reads
 * the two long tables the wasm engine hands out, `psetsJson()` and
 * `quantitiesJson()`, and nothing else: no filter, no threshold, no verdict.
 * A set is categorised, never judged.
 *
 * Categories, in HI90's order (bygg_mottakskontroll.py `psett`):
 *   ifc    the IFC standard defines the set: its name is an
 *          IfcPropertySetTemplate in buildingSMART's templates for the file's
 *          schema family, or for IFC4 (IFC2X3's template carries no Qto_*).
 *          By DEFINITION, not by the `Pset_` prefix.
 *   krevd  not ifc, and a `propertySet` somewhere in the loaded ruleset names
 *          it: an enabled rule (any facet, any source) or the projectLayer.
 *   annen  neither.
 * `krevd_av` is filled whatever the category, so an IFC set the project also
 * requires still says so.
 *
 * The engine limit this output states rather than hides: ifcfast folds a type
 * object's own property rows onto every occurrence that uses the type
 * (`source: "type"`); no row is keyed by a type's GlobalId. So "on types" here
 * means "reached through an occurrence", a type that nothing uses is not
 * visible at all, and `typer` counts the distinct type objects behind the
 * type-sourced rows, which is a count of USED types only.
 */

import type { IdsValue, Restriction, Ruleset } from "../ids/types.ts";
import { IFC_PSET_NAMES, type PsetTemplateFamily } from "./ifc-pset-names.ts";
import type { IfcGraph } from "./types.ts";
import { schemaFamily } from "./standard-layer.ts";

export type PsetCategory = "ifc" | "krevd" | "annen";
const CATEGORY_ORDER: Record<PsetCategory, number> = { ifc: 0, krevd: 1, annen: 2 };

export interface PsetExample {
  verdi: string;
  n: number;
}

export interface PsetProperty {
  navn: string;
  /** Objects carrying the set with this property and a non-blank value. */
  med_verdi: number;
  /** Objects carrying the set with this property, value `""`, blank or null. */
  tom: number;
  /** Objects carrying the set WITHOUT this property. med_verdi + tom +
   *  mangler = the set's `objekter`. */
  mangler: number;
  /** Rows per origin: `forekomst` = own row, `type` = folded from the type. */
  kilde: { forekomst: number; type: number };
  /** Every `value_type` (or `quantity_type`) the rows carry, most frequent
   *  first; `type: null` = the engine gave none. */
  verdi_type: { type: string | null; n: number }[];
  /** Distinct non-blank values, most frequent first, capped. Verbatim STEP
   *  literals as the engine hands them out, never coerced. */
  eksempler: PsetExample[];
  /** Distinct non-blank values in total, exact (not capped). */
  ulike: number;
}

export interface PsetEntry {
  navn: string;
  /** `pset` = an IfcPropertySet row source (`psetsJson`), `qto` = an
   *  IfcElementQuantity (`quantitiesJson`). */
  art: "pset" | "qto";
  kategori: PsetCategory;
  /** The templates that define this name, of IFC2X3 / IFC4 / IFC4X3, whatever
   *  the file's schema. */
  ifc_mal: PsetTemplateFamily[];
  /** Where the ruleset names it: `rule:<id>` or `projectLayer:<key>`. */
  krevd_av: string[];
  /** Distinct owners carrying at least one row of the set. */
  objekter: number;
  /** Owners with at least one own (instance) row of the set. */
  objekter_forekomst: number;
  /** Owners with at least one row folded from their type. */
  objekter_type: number;
  /** Distinct type objects (`type_guid`) behind the type-folded rows: USED
   *  types only. null when the set has no type-folded row. */
  typer: number | null;
  /** Owner classes, most frequent first. `klasse: null` = the owner GUID is
   *  in no table the graph carries. */
  klasser: { klasse: string | null; n: number }[];
  egenskaper: PsetProperty[];
}

/** A limit of the engine, as a code plus the count it affects. Documented in
 *  AGENTS.md "Pset inventory"; never prose. */
export interface PsetLimit {
  kode: string;
  n: number | null;
}

export interface PsetInventory {
  /** The schema family the IFC category was judged against, and the
   *  templates actually used for it. */
  skjema_familie: string;
  ifc_maler: PsetTemplateFamily[];
  /** Row counts of the two source tables; null = the table was not supplied,
   *  which is not the same as a file with no sets. */
  tabeller: { psets: number | null; quantities: number | null };
  /** Declared type objects, and how many of them no product uses: those
   *  types' own sets cannot be read at all (see `grenser`). null when the
   *  graph carries no type-object table. */
  typer_deklarert: number | null;
  typer_ubrukt: number | null;
  grenser: PsetLimit[];
  psett: PsetEntry[];
}

export interface PsetInventoryOptions {
  /** Distinct example values per property. Default 5. */
  examples?: number;
}

/* -------------------------------------------------------- required sets */

function matchesRestriction(r: Restriction, value: string): boolean {
  if (r.enumeration && !r.enumeration.includes(value)) return false;
  if (r.pattern !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(`^(?:${r.pattern})$`);
    } catch {
      return false;
    }
    if (!re.test(value)) return false;
  }
  if (r.length !== undefined && value.length !== r.length) return false;
  if (r.minLength !== undefined && value.length < r.minLength) return false;
  if (r.maxLength !== undefined && value.length > r.maxLength) return false;
  return true;
}

function nameMatches(ref: IdsValue, name: string): boolean {
  if (typeof ref === "string") return ref === name;
  if (ref && typeof ref === "object" && "restriction" in ref) return matchesRestriction(ref.restriction, name);
  return false;
}

/** Every `propertySet` value anywhere under `node`: an IDS property facet, a
 *  code-lookup property source, a projectLayer cascade source. Walked
 *  generically so a new rule shape or projectLayer key that names a set is
 *  picked up without this module knowing it. */
function collectSetRefs(node: unknown, out: IdsValue[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSetRefs(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "propertySet" && (typeof value === "string" || (value && typeof value === "object"))) {
      out.push(value as IdsValue);
    } else {
      collectSetRefs(value, out);
    }
  }
}

export interface RequiredSetRef {
  by: string;
  ref: IdsValue;
}

/** The ruleset's references to property sets. A disabled rule does not
 *  count, as a disabled mapping counts as unconfigured in the report. */
export function requiredSetRefs(ruleset: Ruleset | null | undefined): RequiredSetRef[] {
  if (!ruleset) return [];
  const refs: RequiredSetRef[] = [];
  for (const rule of ruleset.rules ?? []) {
    if (rule.enabled === false) continue;
    const found: IdsValue[] = [];
    collectSetRefs(rule, found);
    for (const ref of found) refs.push({ by: `rule:${rule.id}`, ref });
  }
  for (const [key, layer] of Object.entries(ruleset.projectLayer ?? {})) {
    const found: IdsValue[] = [];
    collectSetRefs(layer, found);
    for (const ref of found) refs.push({ by: `projectLayer:${key}`, ref });
  }
  return refs;
}

/* ------------------------------------------------------------ inventory */

const FAMILIES: PsetTemplateFamily[] = ["IFC2X3", "IFC4", "IFC4X3"];
const TEMPLATE_SETS = new Map(FAMILIES.map((f) => [f, new Set(IFC_PSET_NAMES[f])]));

/** The templates an IFC set is judged against: the file's own family plus
 *  IFC4, as HI90 does (`get_template(schema)` and `get_template("IFC4")`).
 *  An unknown family is judged against IFC4 alone. */
export function templatesFor(schema: string): PsetTemplateFamily[] {
  const family = schemaFamily(schema);
  const own = (FAMILIES as string[]).includes(family) ? [family as PsetTemplateFamily] : [];
  return [...new Set<PsetTemplateFamily>([...own, "IFC4"])];
}

interface Row {
  guid: string;
  set: string;
  prop: string;
  value: string | null;
  vtype: string | null;
  fromType: boolean;
}

interface PropAcc {
  withValue: Set<string>;
  empty: Set<string>;
  forekomst: number;
  type: number;
  vtypes: Map<string | null, number>;
  values: Map<string, number>;
}

interface SetAcc {
  art: "pset" | "qto";
  name: string;
  owners: Set<string>;
  ownInstance: Set<string>;
  ownType: Set<string>;
  props: Map<string, PropAcc>;
}

function ownerClasses(graph: IfcGraph): Map<string, string> {
  const cls = new Map<string, string>();
  const spatial: [keyof IfcGraph, string][] = [
    ["projects", "IfcProject"],
    ["sites", "IfcSite"],
    ["buildings", "IfcBuilding"],
    ["storeys", "IfcBuildingStorey"],
    ["spaces", "IfcSpace"],
  ];
  for (const [table, entity] of spatial) {
    for (const row of (graph[table] as { guid: string }[] | undefined) ?? []) cls.set(row.guid, entity);
  }
  // Product rows win: they carry the class as the file wrote it.
  for (const p of graph.products) cls.set(p.guid, p.entity);
  return cls;
}

function sortedCounts<K>(m: Map<K, number>): { key: K; n: number }[] {
  return [...m.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
}

export function psetInventory(
  graph: IfcGraph,
  schema: string,
  ruleset?: Ruleset | null,
  options: PsetInventoryOptions = {},
): PsetInventory {
  const exampleCap = options.examples ?? 5;
  const maler = templatesFor(schema);
  const refs = requiredSetRefs(ruleset);
  const classOf = ownerClasses(graph);
  const typeOf = new Map(graph.products.map((p) => [p.guid, p.type_guid]));

  const rows: Row[] = [];
  for (const r of graph.psets ?? []) {
    rows.push({ guid: r.guid, set: r.pset_name, prop: r.prop_name, value: r.value, vtype: r.value_type, fromType: r.source === "type" });
  }
  const psetRowCount = rows.length;
  for (const r of graph.quantities ?? []) {
    rows.push({ guid: r.guid, set: r.qto_name, prop: r.quantity_name, value: r.value, vtype: r.quantity_type, fromType: r.source === "type" });
  }

  const sets = new Map<string, SetAcc>();
  rows.forEach((r, i) => {
    const art = i < psetRowCount ? "pset" : "qto";
    const key = `${art}\u0000${r.set}`;
    let s = sets.get(key);
    if (!s) {
      s = { art, name: r.set, owners: new Set(), ownInstance: new Set(), ownType: new Set(), props: new Map() };
      sets.set(key, s);
    }
    s.owners.add(r.guid);
    (r.fromType ? s.ownType : s.ownInstance).add(r.guid);
    let p = s.props.get(r.prop);
    if (!p) {
      p = { withValue: new Set(), empty: new Set(), forekomst: 0, type: 0, vtypes: new Map(), values: new Map() };
      s.props.set(r.prop, p);
    }
    if (r.fromType) p.type += 1;
    else p.forekomst += 1;
    p.vtypes.set(r.vtype, (p.vtypes.get(r.vtype) ?? 0) + 1);
    const blank = r.value === null || r.value.trim() === "";
    if (blank) {
      p.empty.add(r.guid);
    } else {
      p.withValue.add(r.guid);
      p.values.set(r.value!, (p.values.get(r.value!) ?? 0) + 1);
    }
  });

  const psett: PsetEntry[] = [];
  for (const s of sets.values()) {
    const ifcMal = FAMILIES.filter((f) => TEMPLATE_SETS.get(f)!.has(s.name));
    const krevdAv = [...new Set(refs.filter((r) => nameMatches(r.ref, s.name)).map((r) => r.by))];
    const kategori: PsetCategory = maler.some((f) => ifcMal.includes(f))
      ? "ifc"
      : krevdAv.length > 0
        ? "krevd"
        : "annen";

    const klasser = new Map<string | null, number>();
    for (const g of s.owners) {
      const k = classOf.get(g) ?? null;
      klasser.set(k, (klasser.get(k) ?? 0) + 1);
    }
    const types = new Set<string>();
    for (const g of s.ownType) {
      const t = typeOf.get(g);
      if (t) types.add(t);
    }

    const egenskaper: PsetProperty[] = [...s.props.entries()].map(([navn, p]) => {
      // An owner with both a valued and a blank row (instance and type for the
      // same name should not happen, ifcfast lets instance win) counts as valued.
      const tom = [...p.empty].filter((g) => !p.withValue.has(g)).length;
      return {
        navn,
        med_verdi: p.withValue.size,
        tom,
        mangler: s.owners.size - p.withValue.size - tom,
        kilde: { forekomst: p.forekomst, type: p.type },
        verdi_type: sortedCounts(p.vtypes).map(({ key, n }) => ({ type: key, n })),
        eksempler: sortedCounts(p.values).slice(0, exampleCap).map(({ key, n }) => ({ verdi: key, n })),
        ulike: p.values.size,
      };
    });

    psett.push({
      navn: s.name,
      art: s.art,
      kategori,
      ifc_mal: ifcMal,
      krevd_av: krevdAv,
      objekter: s.owners.size,
      objekter_forekomst: s.ownInstance.size,
      objekter_type: s.ownType.size,
      typer: s.ownType.size > 0 ? types.size : null,
      klasser: sortedCounts(klasser).map(({ key, n }) => ({ klasse: key, n })),
      egenskaper,
    });
  }
  psett.sort(
    (a, b) =>
      CATEGORY_ORDER[a.kategori] - CATEGORY_ORDER[b.kategori] ||
      b.objekter - a.objekter ||
      a.navn.localeCompare(b.navn) ||
      a.art.localeCompare(b.art),
  );

  const declared = graph.type_objects;
  const used = new Set(graph.products.map((p) => p.type_guid).filter((g): g is string => !!g));
  const unused = declared ? declared.filter((t) => !used.has(t.guid)).length : null;
  const typeFoldedOwners = new Set<string>();
  for (const s of sets.values()) for (const g of s.ownType) typeFoldedOwners.add(g);

  const grenser: PsetLimit[] = [
    // Every type-sourced row is keyed by an occurrence, never by the type.
    { kode: "type-rows-on-occurrences", n: typeFoldedOwners.size },
    // Declared types no product uses: their own sets are not in any table.
    { kode: "unused-type-sets-unreadable", n: unused },
  ];
  if (graph.psets === undefined) grenser.push({ kode: "table-absent:psets", n: null });
  if (graph.quantities === undefined) grenser.push({ kode: "table-absent:quantities", n: null });
  if (declared === undefined) grenser.push({ kode: "table-absent:type_objects", n: null });

  return {
    skjema_familie: schemaFamily(schema),
    ifc_maler: maler,
    tabeller: {
      psets: graph.psets === undefined ? null : graph.psets.length,
      quantities: graph.quantities === undefined ? null : graph.quantities.length,
    },
    typer_deklarert: declared === undefined ? null : declared.length,
    typer_ubrukt: unused,
    grenser,
    psett,
  };
}
