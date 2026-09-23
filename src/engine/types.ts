/** Shapes returned by ifcfast's wasm accessors.
 *
 * Hand-written against the module vendored in vendor/ifcfast-wasm (ifcfast
 * `feat/wasm-type-objects-183` @ 6a16c16, crate 0.5.3). The crate ships a
 * .d.ts, but only for the class surface — every accessor returns `string`, so
 * the JSON payloads are untyped there.
 */

export interface ProductRow {
  guid: string;
  entity: string;
  name: string | null;
  predefined_type: string | null;
  object_type: string | null;
  tag: string | null;
  storey_guid: string | null;
  parent_guid: string | null;
  type_name: string | null;
  type_source: string;
  typed: boolean;
  /** The GlobalId of the `IfcTypeObject` this product is defined by, null when
   *  no `IfcRelDefinesByType` reaches it. It points into `type_objects`, which
   *  is what makes "declared but used by nothing" answerable. */
  type_guid: string | null;
  materials: string[];
  layer_set: string | null;
  is_external: boolean | null;
  fire_rating: string | null;
  load_bearing: boolean | null;
}

/** One `IfcTypeObject` the file DECLARES — `typeObjectsJson()`.
 *
 * Not the same roster as `typesJson()`, and the difference is the point:
 * `typesJson()` groups the types products point at, by NAME, and its `guid` is
 * a representative OCCURRENCE's. This is one row per declared type object, keyed
 * by the type's own GlobalId, which is what `ProductRow.type_guid` points at.
 *
 * `entity` comes back in ifcfast's own spelling, which title-cases the class
 * rather than the IFC one: `IfcWalltype`, not `IfcWallType`
 * ([ifcfast#186](https://github.com/EdvardGK/ifcfast/issues/186)). Compare it
 * case-insensitively; never match it against a class name literally.
 */
export interface TypeObjectRow {
  guid: string;
  entity: string;
  name: string | null;
  step_id: number;
}

/** One property, long format — `psetsJson()`.
 *
 * `guid` is the owner: a product, a spatial structure element, or the project
 * itself. A consumer that joins only against products silently drops the rest
 * (KNM_RIB carries 231 of its 337 rows on site, building and storeys).
 *
 * `value` is the STEP literal as a string, never coerced — a browser that
 * parsed `"3.0"` into `3.0` would disagree with the desktop for one file.
 * `source` is `instance` or `type`: type-inherited properties are included,
 * keyed by the OCCURRENCE's guid, with instance winning a name collision.
 */
export interface PropertyRow {
  guid: string;
  pset_name: string;
  prop_name: string;
  value: string | null;
  value_type: string | null;
  source: string;
}

/** One classification reference — `classificationsJson()`.
 *
 * `identification` is the normalised code: IFC4's
 * `IfcClassificationReference.Identification` and IFC2x3's `.ItemReference`
 * both land here, so a lookup reads one column whatever the schema is.
 *
 * Two provenance columns, easily confused: `source` is
 * `IfcClassification.Source`, the publishing body ("CSI (Construction
 * Specifications Institute)"); `assignment_source` is the `instance` / `type`
 * flag the property rows call `source`.
 */
export interface ClassificationRow {
  guid: string;
  system_name: string | null;
  edition: string | null;
  identification: string | null;
  name: string | null;
  location: string | null;
  source: string | null;
  assignment_source: string;
}

export interface StoreyRow {
  guid: string;
  name: string | null;
  /** In FILE units, not metres — see ifcfast#180. Convert with unit_scale. */
  elevation: number | null;
  building_guid: string | null;
}

export interface SpatialRow {
  guid: string;
  name: string | null;
}

export interface IfcGraph {
  schema: string;
  project_name: string | null;
  products: ProductRow[];
  storeys: StoreyRow[];
  sites: SpatialRow[];
  buildings: SpatialRow[];
  projects: SpatialRow[];
  spaces: SpatialRow[];
  /** Only storey containment. The wasm graph does not report elements
   *  contained directly in a site, building or space, unlike the Python
   *  `contained_in` table which carries a `container_kind`. */
  contained_in: { product_guid: string; storey_guid: string }[];
  aggregates: { child_guid: string; parent_guid: string; parent_kind: string }[];
  storey_building: { storey_guid: string; building_guid: string }[];
  voids: { opening_guid: string; host_guid: string }[];
  /** The three tables that do NOT come out of `graphJson()`: the worker calls
   *  `typeObjectsJson()`, `psetsJson()` and `classificationsJson()` and attaches
   *  them here, so one object carries the whole model and the cache, the restore
   *  worker and the evaluator all read the same thing.
   *
   *  `undefined` and `[]` are DIFFERENT answers and every consumer keeps them
   *  apart: absent means nobody supplied the table (an older cache, a caller
   *  that only read the graph) and the surface says so; empty means the file
   *  declares none. Reporting the first as the second is how a check that
   *  silently stopped working reads as clean. */
  type_objects?: TypeObjectRow[];
  psets?: PropertyRow[];
  classifications?: ClassificationRow[];
}

export interface IfcSummary {
  schema: string;
  path: string;
  size_bytes: number;
  products: number;
  storeys: number;
  project_name: string | null;
  authoring_app: string | null;
  length_unit: string;
  unit_scale: number;
  unit_resolved: boolean;
  duplicate_step_ids: number;
  parse_seconds: number;
  warnings: string[];
  tables: Record<string, { loaded: boolean; rows: number; columns: string[] }>;
}

/** A check either passes, fails, needs a human, or could not run.
 *
 * `not_applicable` is distinct from `pass` on purpose. A check that matched
 * nothing, or whose precondition was not met, has established nothing — and
 * reporting that as green is how a rule that silently stopped working goes
 * unnoticed. ifctester makes exactly that mistake: an IDS specification with
 * zero applicable entities comes back status=true.
 */
export type CheckState = "pass" | "fail" | "review" | "not_applicable";

/** How much a finding on this check means, on ANY project.
 *
 * Orthogonal to `CheckState`, which only says whether the check found
 * anything. Both are needed, because "found something" and "that something is
 * a defect" are different claims: a structural work model with no materials
 * has findings on `element-material` and is not a broken file — it is a fact
 * about maturity. A duplicate GlobalId, with exactly the same state, is.
 *
 *   deviation  wrong in the file itself. Breaks a consumer of the IFC —
 *              federation, issue tracking, filtering, every derived number.
 *   advisory   true of the file, and a legitimate state for a model at some
 *              stage of its life. Surfaced, never scored.
 *
 * The line is deliberately NOT "how annoying is it": it is whether the model
 * could be correct and still be like this. Nothing here grades whoever
 * produced the file.
 */
export type CheckSeverity = "deviation" | "advisory";

/** What the screen prints for a check — Bestått · Advarsel · Avvik · N/A.
 *
 * Derived from state + severity by `verdictOf`, never stored: a verdict that
 * could drift from the state it came from is a verdict nobody can check.
 */
export type Verdict = "pass" | "warn" | "fail" | "na";

/** The shape of the value a check FOUND, as data rather than a sentence.
 *
 * Same discipline as `ReasonCode`: the engine emits a code plus parameters,
 * the UI renders it in Norwegian or English, and an agent reading the JSON
 * branches on the code. `text` is the English rendering the engine already
 * did, so the CLI and the raw JSON stay readable without a lookup.
 *
 *   literal           a token that is the same in every language: "IFC2X3",
 *                     "m", "mm". `params.text`.
 *   share             `params.good` of `params.total` — "0 of 851".
 *   count             `params.n` of `params.noun` — "3 storeys".
 *   unique            `params.unique` distinct out of `params.total`.
 *   shared-elevation  `params.shared` of `params.total` storeys sit at one
 *                     elevation; `params.elevation` (metres) when they all do,
 *                     `params.resolved` 0 when the file's unit is unknown.
 */
export type DisplayCode = "literal" | "share" | "count" | "unique" | "shared-elevation";

/** The nouns `count` can take. Closed, so every one has both languages. */
export type DisplayNoun = "products" | "storeys" | "types" | "stepIds" | "levels";

export interface DisplayValue {
  code: DisplayCode;
  params: Record<string, string | number>;
  /** English rendering of code + params. Derived — localise from `code`. */
  text: string;
}

/** Why one element failed one check.
 *
 * A code plus its parameters, not a sentence. Two consumers need this and
 * prose serves neither: the UI renders it in Norwegian or English, and an
 * agent reading the JSON output wants to branch on the code rather than match
 * a string that may be reworded. `reason` carries the English rendering so
 * the CLI stays readable, but it is derived, never the source of truth.
 */
export type ReasonCode =
  | "no-products"
  | "unit-unresolved"
  | "duplicate-step-ids"
  | "parser-warning"
  | "not-in-storey"
  | "storey-not-in-building"
  | "spatial-level-missing"
  | "shared-elevation"
  | "name-empty"
  | "no-type"
  | "placeholder-type-name"
  | "single-instance-type"
  | "type-unused"
  | "no-material"
  | "guid-duplicate"
  | "storey-mismatch"
  | "far-from-model"
  | "storey-not-in-config"
  | "storey-name-mismatch"
  | "storey-elevation-mismatch"
  | "storey-name-whitespace"
  | "storey-duplicate-match"
  | "storey-count-exceeds";

export interface Finding {
  /** Full GlobalId. Never truncate this for display. */
  guid: string;
  entity: string;
  name: string | null;
  code: ReasonCode;
  /** Values interpolated into the rendered reason, e.g. { typeName, count }. */
  params?: Record<string, string | number>;
  /** English rendering of code + params. Derived — localise from `code`. */
  reason: string;
}

export interface CheckResult {
  id: string;
  state: CheckState;
  /** What findings on this check mean. Constant per check, not per model. */
  severity: CheckSeverity;
  /** The value the check FOUND. The cell prints this; colour says the verdict. */
  displayValue: DisplayValue;
  /** Populated when state is not_applicable: why the check could not run. */
  reason?: string;
  /** How many elements the check looked at. Zero means it matched nothing. */
  applicable: number;
  findings: Finding[];
  /** Short factual line, e.g. "0 of 851 elements linked to a type". */
  detail: string;
}

export interface ModelReport {
  fileName: string;
  sizeBytes: number;
  parseMs: number;
  summary: IfcSummary;
  checks: CheckResult[];
  /** Set when the file could not be parsed at all. */
  error?: string;
}
