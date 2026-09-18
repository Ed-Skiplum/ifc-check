/** Shapes returned by ifcfast's wasm `graphJson()` / `summaryJson()`.
 *
 * Hand-written against the module vendored in vendor/ifcfast-wasm (ifcfast
 * main @ 45f4562). The crate ships a .d.ts, but only for the class surface —
 * every accessor returns `string`, so the JSON payloads are untyped there.
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
  materials: string[];
  layer_set: string | null;
  is_external: boolean | null;
  fire_rating: string | null;
  load_bearing: boolean | null;
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
  | "no-material"
  | "guid-duplicate";

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
