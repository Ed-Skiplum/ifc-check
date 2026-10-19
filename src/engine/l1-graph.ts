/** The platform substrate's L1 tables as the engine's `IfcGraph` + `IfcSummary`.
 *
 * The browser parses an IFC with the ifcfast wasm build and hands the engine
 * `graphJson()` / `summaryJson()` plus five attached tables. A parse stored in
 * konto arrives instead as seven Parquet tables and a `manifest.json`
 * (skiplum/internal/platform `docs/substrate.md`, schema v1). This adapter maps
 * the second onto the first, so `runFundamentals` and the rest of the engine
 * run unchanged on either. Pure: no reader, no I/O. The caller reads the
 * Parquet (DuckDB, hyparquet) and passes row objects by column name.
 *
 * The mapping follows ifcfast's own wasm graph (`crates/wasm/src/analysis.rs`
 * `graph_json`), field by field, so a difference in a check is a difference
 * in the facts and not in the adapter. Where L1 has no column for a field the
 * graph declares, the field is left out or null, and `unobserved` says which
 * and why. Nothing is filled with a plausible default: an absent fact read as
 * a clean one is how a check silently stops working.
 */

import type {
  ClassificationRow,
  IfcGraph,
  IfcSummary,
  MaterialRow,
  ProductRow,
  PropertyRow,
  QuantityRow,
  SpatialRow,
  StoreyRow,
  TypeObjectRow,
} from "./types.ts";

/** An int64 column: hyparquet hands back a `bigint`, DuckDB a `number` or a
 *  `bigint` depending on the build. Both are accepted. */
type Int = number | bigint;

/** `elements`, the columns the adapter reads (schema v1). */
export interface L1Element {
  global_id: string;
  step_id: Int;
  ifc_class: string;
  predefined_type: string | null;
  object_type: string | null;
  name: string | null;
  tag: string | null;
  type_global_id: string | null;
  storey_global_id: string | null;
  container_global_id: string | null;
  parent_global_id: string | null;
  host_global_id: string | null;
}

export interface L1Type {
  global_id: string;
  step_id: Int;
  ifc_class: string;
  name: string | null;
  instance_count?: Int;
}

export interface L1Spatial {
  global_id: string;
  step_id: Int | null;
  ifc_class: string;
  name: string | null;
  long_name?: string | null;
  parent_global_id: string | null;
  depth?: Int;
  elevation: number | null;
  elevation_m?: number | null;
}

export interface L1Property {
  owner_global_id: string;
  owner_kind: string;
  source: string;
  pset_name: string;
  prop_name: string;
  value: string | null;
  value_type: string | null;
  value_num?: number | null;
}

export interface L1Quantity {
  owner_global_id: string;
  owner_kind: string;
  source: string;
  qto_name: string;
  quantity_name: string;
  quantity_type: string | null;
  value: number | null;
  unit: string | null;
  value_si: number | null;
}

export interface L1Material {
  owner_global_id: string;
  owner_kind: string;
  source: string;
  role: string;
  layer_index: Int | null;
  material_name: string | null;
  layer_thickness_m: number | null;
  category: string | null;
  fraction: number | null;
}

export interface L1Classification {
  owner_global_id: string;
  owner_kind: string;
  assignment_source: string;
  system_name: string | null;
  edition: string | null;
  code: string | null;
  identification: string | null;
  item_reference: string | null;
  name: string | null;
  location: string | null;
  referenced_source: string | null;
}

export interface L1Tables {
  elements: L1Element[];
  types: L1Type[];
  spatial: L1Spatial[];
  properties: L1Property[];
  quantities: L1Quantity[];
  materials: L1Material[];
  classifications: L1Classification[];
}

/** `manifest.json`, the fields the adapter reads. */
export interface L1Manifest {
  format?: string;
  schemaVersion: number;
  parser?: string;
  ifcSchema: string;
  authoringApp?: string | null;
  projectName?: string | null;
  source?: { filename?: string; size?: number };
  units?: {
    lengthUnit?: string | null;
    fileUnitToMetre?: number | null;
    project?: Record<string, { unit?: string | null; to_si?: number | null }>;
  };
  warnings?: string[];
  timings?: Record<string, number>;
}

export interface L1Graph {
  graph: IfcGraph;
  summary: IfcSummary;
  /** Fields of the graph or summary that L1 does not carry, with what the
   *  adapter put there instead. Surfaced, never swallowed: a runner prints
   *  these beside the verdicts. */
  unobserved: string[];
}

/** The IFC classes an `IfcRelVoidsElement` points at (subtractions). Every
 *  other row with a `host_global_id` is a filling (`IfcRelFillsElement`), whose
 *  host is the opening it fills, not a void. */
const SUBTRACTIONS = new Set(["ifcopeningelement", "ifcopeningstandardcase", "ifcvoidingfeature"]);

/** wasm's `truthy`: present and not empty. */
const truthy = (s: string | null | undefined): s is string => s != null && s !== "";

const num = (v: Int | null | undefined): number | null => (v == null ? null : Number(v));

/** wasm's boolean reading of an IsExternal / LoadBearing value. */
const truthValue = (raw: string): boolean =>
  ["true", "t", "1", ".t."].includes(raw.trim().toLowerCase());

export function l1ToGraph(tables: L1Tables, manifest: L1Manifest): L1Graph {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`l1ToGraph reads substrate schema 1, got schema ${manifest.schemaVersion}`);
  }
  const unobserved: string[] = [];

  /* ----------------------------------------------------- spatial structure */

  const spatialClass = new Map<string, string>();
  for (const s of tables.spatial) spatialClass.set(s.global_id, s.ifc_class.toLowerCase());
  const elementClass = new Map<string, string>();
  for (const e of tables.elements) elementClass.set(e.global_id, e.ifc_class.toLowerCase());

  const spatialRows = (cls: string): SpatialRow[] =>
    tables.spatial
      .filter((s) => s.ifc_class.toLowerCase() === cls)
      .map((s) => ({ guid: s.global_id, name: s.name }));
  const projects = spatialRows("ifcproject");
  const sites = spatialRows("ifcsite");
  const buildings = spatialRows("ifcbuilding");

  const storeys: StoreyRow[] = [];
  const storeyBuilding: IfcGraph["storey_building"] = [];
  for (const s of tables.spatial) {
    if (s.ifc_class.toLowerCase() !== "ifcbuildingstorey") continue;
    const parentIsBuilding =
      s.parent_global_id != null && spatialClass.get(s.parent_global_id) === "ifcbuilding";
    const building = parentIsBuilding ? s.parent_global_id : null;
    storeys.push({ guid: s.global_id, name: s.name, elevation: s.elevation, building_guid: building });
    if (building) storeyBuilding.push({ storey_guid: s.global_id, building_guid: building });
  }
  const storeyIds = new Set(storeys.map((s) => s.guid));

  // wasm's parent_kind: the kind of whatever the aggregate's whole is.
  const kindOf = (guid: string): string => {
    const sp = spatialClass.get(guid);
    if (sp === "ifcproject") return "project";
    if (sp === "ifcsite") return "site";
    if (sp === "ifcbuilding") return "building";
    if (sp === "ifcbuildingstorey") return "storey";
    if (sp !== undefined) return sp.replace(/^ifc/, "");
    return elementClass.get(guid) === "ifcspace" ? "space" : "product";
  };

  const aggregates: IfcGraph["aggregates"] = [];
  for (const s of tables.spatial) {
    if (s.parent_global_id) {
      aggregates.push({ child_guid: s.global_id, parent_guid: s.parent_global_id, parent_kind: kindOf(s.parent_global_id) });
    }
  }

  /* -------------------------------------------------------------- products */

  const typeById = new Map<string, L1Type>();
  for (const t of tables.types) typeById.set(t.global_id, t);

  // wasm's `materials` column: the names of the `layer` rows and the named
  // `single` rows, per owner, distinct, in row order.
  const layerNames = new Map<string, string[]>();
  for (const m of tables.materials) {
    if (m.role !== "layer" && m.role !== "single") continue;
    const name = m.material_name ?? "";
    if (!name) continue;
    const list = layerNames.get(m.owner_global_id);
    if (!list) layerNames.set(m.owner_global_id, [name]);
    else if (!list.includes(name)) list.push(name);
  }

  // wasm's three attributes off the property sets: the first row per owner
  // whose property is called IsExternal, LoadBearing or FireRating, any set.
  const attrs = new Map<string, { ext?: boolean | null; lb?: boolean | null; fr?: string | null }>();
  for (const p of tables.properties) {
    const slot = p.prop_name === "IsExternal" ? "ext" : p.prop_name === "LoadBearing" ? "lb" : p.prop_name === "FireRating" ? "fr" : null;
    if (!slot) continue;
    let entry = attrs.get(p.owner_global_id);
    if (!entry) attrs.set(p.owner_global_id, (entry = {}));
    if (entry[slot] !== undefined) continue;
    if (slot === "fr") entry.fr = p.value;
    else entry[slot] = p.value == null ? null : truthValue(p.value);
  }

  const products: ProductRow[] = [];
  const spaces: SpatialRow[] = [];
  const containedIn: IfcGraph["contained_in"] = [];
  const voids: IfcGraph["voids"] = [];
  for (const e of tables.elements) {
    const cls = e.ifc_class.toLowerCase();
    // wasm's three-way type rule: a resolved IfcRelDefinesByType wins and
    // carries the type's GlobalId; an ObjectType string is a name with no
    // object behind it; otherwise untyped. A typed product whose type has no
    // name falls back to ObjectType for its name, exactly as wasm does.
    const type = e.type_global_id ? typeById.get(e.type_global_id) : undefined;
    const typeSource = type ? "ifctype" : truthy(e.object_type) ? "objecttype" : "none";
    const typeName = type ? (truthy(type.name) ? type.name : e.object_type) : truthy(e.object_type) ? e.object_type : null;
    const a = attrs.get(e.global_id);
    products.push({
      guid: e.global_id,
      entity: e.ifc_class,
      name: e.name,
      predefined_type: e.predefined_type,
      object_type: e.object_type,
      tag: e.tag,
      storey_guid: e.storey_global_id,
      parent_guid: e.parent_global_id,
      type_name: typeName,
      type_source: typeSource,
      typed: typeSource === "ifctype",
      type_guid: type ? type.global_id : null,
      materials: layerNames.get(e.global_id) ?? [],
      layer_set: null,
      is_external: a?.ext ?? null,
      fire_rating: a?.fr ?? null,
      load_bearing: a?.lb ?? null,
    });
    // IfcSpace is a product in wasm's graph AND a row of `spaces`; both here.
    if (cls === "ifcspace") spaces.push({ guid: e.global_id, name: e.name });
    if (e.container_global_id && storeyIds.has(e.container_global_id)) {
      containedIn.push({ product_guid: e.global_id, storey_guid: e.container_global_id });
    }
    if (e.parent_global_id) {
      aggregates.push({ child_guid: e.global_id, parent_guid: e.parent_global_id, parent_kind: kindOf(e.parent_global_id) });
    }
    if (e.host_global_id && SUBTRACTIONS.has(cls)) {
      voids.push({ opening_guid: e.global_id, host_guid: e.host_global_id });
    }
  }
  if (tables.elements.some((e) => e.type_global_id && !typeById.has(e.type_global_id))) {
    unobserved.push("products.typed: an element names a type_global_id the types table does not hold; read as untyped, as wasm does");
  }
  unobserved.push("products.layer_set: L1 materials carry no set name; null");

  /* ---------------------------------------------------------- long tables */

  const type_objects: TypeObjectRow[] = tables.types.map((t) => ({
    guid: t.global_id,
    entity: t.ifc_class,
    name: t.name,
    step_id: Number(t.step_id),
  }));

  // wasm's property rows are owned by products, spatial elements and the
  // project; a property defined on a type object reaches it only as the
  // occurrence's `source: "type"` row. L1 also lists the type's own rows
  // (`owner_kind: "type"`), which wasm does not; they are left out here.
  const psets: PropertyRow[] = tables.properties.filter((p) => p.owner_kind !== "type").map((p) => ({
    guid: p.owner_global_id,
    pset_name: p.pset_name,
    prop_name: p.prop_name,
    value: p.value,
    value_type: p.value_type,
    source: p.source,
  }));

  const quantities: QuantityRow[] = tables.quantities.map((q) => ({
    guid: q.owner_global_id,
    qto_name: q.qto_name,
    quantity_name: q.quantity_name,
    value: q.value == null ? null : String(q.value),
    quantity_type: q.quantity_type,
    unit_step_id: null,
    source: q.source,
  }));
  unobserved.push(
    "quantities.value: L1 stores a float64, not the STEP literal; unit_step_id null (L1 names the unit in `unit`, " +
      "converts in `value_si`); quantity_units left absent, so the treemap does not read these as metres",
  );

  const materials: MaterialRow[] = tables.materials.map((m) => ({
    guid: m.owner_global_id,
    role: m.role,
    layer_index: num(m.layer_index) ?? 0,
    material_name: m.material_name,
    layer_thickness_mm: m.layer_thickness_m == null ? null : m.layer_thickness_m * 1000,
    category: m.category,
    fraction: m.fraction,
    source: m.source,
  }));

  const classifications: ClassificationRow[] = tables.classifications.map((c) => ({
    guid: c.owner_global_id,
    system_name: c.system_name,
    edition: c.edition,
    identification: c.code ?? c.identification ?? c.item_reference,
    name: c.name,
    location: c.location,
    source: c.referenced_source,
    assignment_source: c.assignment_source,
  }));

  const graph: IfcGraph = {
    schema: manifest.ifcSchema,
    // wasm's graph always carries null here (IFCHeader has no project name).
    project_name: null,
    products,
    storeys,
    sites,
    buildings,
    projects,
    spaces,
    contained_in: containedIn,
    aggregates,
    storey_building: storeyBuilding,
    voids,
    type_objects,
    psets,
    classifications,
    quantities,
    materials,
  };

  /* --------------------------------------------------------------- summary */

  const units = manifest.units ?? {};
  const lengthFactor = units.project?.LENGTHUNIT?.to_si;
  // wasm reports whether the IfcUnitAssignment's length unit resolved. L1 has
  // no flag; the manifest's own reading of the unit assignment is the fact.
  const unitResolved = typeof lengthFactor === "number" && Number.isFinite(lengthFactor);
  if (!unitResolved) {
    unobserved.push("summary.unit_resolved: manifest.units.project has no LENGTHUNIT with a factor; read as unresolved");
  }
  if (units.fileUnitToMetre == null) {
    unobserved.push("summary.unit_scale: manifest.units.fileUnitToMetre is absent; 1 used");
  }

  // wasm counts products whose STEP id repeats. L1 keeps one row per product
  // ifcfast returned, so a repeat that ifcfast collapsed is not visible here.
  const seenStep = new Set<number>();
  let duplicateStepIds = 0;
  for (const e of tables.elements) {
    const id = Number(e.step_id);
    if (seenStep.has(id)) duplicateStepIds += 1;
    else seenStep.add(id);
  }
  unobserved.push(
    "summary.duplicate_step_ids: counted over elements.step_id only; L1 has no whole-file duplicate STEP id count " +
      "(substrate gap), so a duplicate the parser collapsed reads as 0",
  );

  const counts: Record<string, number> = {
    products: products.length,
    storeys: storeys.length,
    types: type_objects.length,
    psets: psets.length,
    quantities: quantities.length,
    materials: materials.length,
    classifications: classifications.length,
  };
  const summary: IfcSummary = {
    schema: manifest.ifcSchema,
    path: manifest.source?.filename ?? "",
    size_bytes: manifest.source?.size ?? 0,
    products: products.length,
    storeys: storeys.length,
    project_name: manifest.projectName ?? null,
    authoring_app: manifest.authoringApp ?? null,
    length_unit: units.lengthUnit ?? "",
    unit_scale: units.fileUnitToMetre ?? 1,
    unit_resolved: unitResolved,
    duplicate_step_ids: duplicateStepIds,
    parse_seconds: Object.values(manifest.timings ?? {}).reduce((a, b) => a + b, 0),
    warnings: manifest.warnings ?? [],
    tables: Object.fromEntries(
      Object.entries(counts).map(([k, rows]) => [k, { loaded: true, rows, columns: [] }]),
    ),
  };
  unobserved.push("summary.parse_seconds: the substrate job's stage timings summed, not a browser parse");

  return { graph, summary, unobserved };
}
