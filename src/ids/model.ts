/** The minimal model shape the evaluator reads.
 *
 * Declared structurally rather than imported from the parser so src/ids stays
 * self-contained and headless. The ifcfast wasm `graphJson()` / `summaryJson()`
 * payloads satisfy these interfaces as they are.
 */

export interface ModelProduct {
  /** Where the row came from. `spatial` rows are synthesized from the graph's
   *  site / building / storey / space tables, which carry a GUID and a name and
   *  nothing else — so a check that needs any other field reports
   *  not_evaluable for them rather than guessing. Absent means `product`. */
  source?: "product" | "spatial";
  guid: string;
  entity: string;
  name: string | null;
  predefined_type: string | null;
  object_type: string | null;
  tag: string | null;
  storey_guid: string | null;
  parent_guid: string | null;
  type_name: string | null;
  typed: boolean;
  materials: string[];
  is_external: boolean | null;
  fire_rating: string | null;
  load_bearing: boolean | null;
}

export interface ModelGraph {
  schema: string;
  products: ModelProduct[];
  contained_in: { product_guid: string; storey_guid: string }[];
  aggregates: { child_guid: string; parent_guid: string; parent_kind: string }[];
  voids: { opening_guid: string; host_guid: string }[];
  storeys: { guid: string; name: string | null }[];
  buildings: { guid: string; name: string | null }[];
  sites: { guid: string; name: string | null }[];
  spaces: { guid: string; name: string | null }[];
  storey_building?: { storey_guid: string; building_guid: string }[];
}

export interface ModelSummary {
  schema: string;
  length_unit: string;
  unit_scale: number;
  unit_resolved: boolean;
  authoring_app: string | null;
  project_name: string | null;
  duplicate_step_ids: number;
  products: number;
  /** Row counts of the parser's internal tables, e.g. `type_objects`. */
  tables?: Record<string, { loaded: boolean; rows: number }>;
}
