/** What the file IS, derived from `graphJson()`.
 *
 * `src/engine/worker.ts` keeps the graph inside the worker and returns only the
 * check results, and the engine is out of scope to change — so the parse worker
 * this UI drives lives in `src/ui/model-worker.ts` and ships the two raw tables
 * the dashboard needs. Everything else (class census, floor matrix, shared
 * elevations) is derived here, on demand, rather than sent twice.
 *
 * Only fields that come from real data appear. The wasm API exposes no
 * `IfcMapConversion`, no `IfcProjectedCRS` and no site lat/lon, so there is no
 * georeferencing here: the tool cannot determine it, and a "not georeferenced"
 * line would be an invention.
 */

/** One product, reduced to what the dashboard and its drill-downs read.
 *
 * The TYPE FACTS at the bottom are optional, and their absence is a real state
 * rather than a missing value: `profileOf` in `src/storage/rehydrate.ts` is the
 * shared graph -> profile reduction and does not carry them, so a profile that
 * has not been through `withTypeFacts` (`src/ui/types/facts.ts`) arrives
 * without them. The type ledger reports that as "not supplied by this profile"
 * and never as "this model has no types" — the two are different answers and
 * only one of them is about the file.
 *
 * The three flattened common properties below are a CONVENIENCE, not the
 * boundary: since ifcfast 0.5.3 the whole property table is readable and rides
 * on the profile as `psets` (see `ModelProfile`). They stay because the
 * fundamentals and the type ledger read them per row without a join.
 */
export interface ProductRowLite {
  guid: string;
  entity: string;
  name: string | null;
  storeyGuid: string | null;
  /** `ProductRow.type_name` — the type object's Name, null when untyped. */
  typeName?: string | null;
  /** `ProductRow.typed` — an IfcRelDefinesByType reached this element. */
  typed?: boolean;
  /** `ProductRow.type_source`, verbatim from the parser. */
  typeSource?: string;
  /** `ProductRow.type_guid` — the GlobalId of the type object, null when the
   *  element is untyped. It is what makes "declared but used by nothing"
   *  answerable, so it is carried per row rather than derived from the name. */
  typeGuid?: string | null;
  predefinedType?: string | null;
  objectType?: string | null;
  /** `ProductRow.tag` — the authoring tool's own element id, not a GlobalId. */
  tag?: string | null;
  materials?: string[];
  /** `ProductRow.layer_set` — the material layer set's own name, when the
   *  material association is an `IfcMaterialLayerSetUsage`. */
  layerSet?: string | null;
  /** `IfcRelAggregates` / `IfcRelNests`: what this element is a part of, and
   *  what the parser calls that parent. */
  parentGuid?: string | null;
  parentKind?: string | null;
  /** `IfcRelVoidsElement` seen from the element the opening sits in. */
  openingGuids?: string[];
  /** `IfcRelVoidsElement` seen from the opening: the element it voids. */
  hostGuid?: string | null;
  isExternal?: boolean | null;
  fireRating?: string | null;
  loadBearing?: boolean | null;
  /** This product is the opening of an `IfcRelVoidsElement`. The fundamentals
   *  drop these before counting (`physicalProducts`), so the type ledger drops
   *  them too and its `n of m` is the same arithmetic the verification block
   *  prints for `single-instance-types` rather than a second, near-miss one. */
  isOpening?: boolean;
}

export interface StoreyRowLite {
  guid: string;
  name: string | null;
  /** In FILE units — scale by `unitScale` before reading it as metres. */
  elevation: number | null;
  /** `IfcRelAggregates`, storey -> building (`graph.storey_building`). */
  buildingGuid?: string | null;
}

/** How many entities the graph holds at each level of the spatial chain.
 *
 * Sent as counts rather than rows: the chain gauge asks whether each level
 * EXISTS and how many there are, and the graph's site / building / project
 * tables carry nothing else the board reads. The products list cannot supply
 * this — it has no spatial parent above the storey.
 */
export interface SpatialCounts {
  projects: number;
  sites: number;
  buildings: number;
  storeys: number;
}

/** One property set as the object panel reads it: the set NAME kept, because a
 *  property is identified by set plus name and not by name alone. */
export interface PsetGroup {
  name: string;
  properties: PropertyLite[];
  /** `IfcElementQuantity` rather than `IfcPropertySet`. The two are different
   *  entities in the standard and the panel says which it is showing. */
  quantity?: boolean;
}

/** One property or quantity as the panel reads it. `source` is ifcfast's own
 *  `instance` / `type` flag: a set inherited from the type object is a real
 *  distinction in the standard, not a detail. `valueType` is the STEP value
 *  type (`IfcLabel`, `IfcAreaMeasure`, ...), kept verbatim. */
export interface PropertyLite {
  name: string;
  value: string | null;
  valueType?: string | null;
  source?: string;
}

/** One classification reference. `code` is the schema-normalised identification
 *  — IFC4 `.Identification` and IFC2x3 `.ItemReference` both land there. */
export interface ClassificationRef {
  system: string | null;
  code: string | null;
  name: string | null;
  edition?: string | null;
  location?: string | null;
  /** `IfcClassification.Source` — the publishing body. */
  publisher?: string | null;
  /** `instance` / `type`, the same flag the property rows call `source`. */
  assignmentSource?: string;
}

/** The raw payload the worker sends alongside the check results.
 *
 * `psets` and `classifications` are keyed by GlobalId, and the key set is NOT
 * the product rows: a property set sits on a site, a building, a storey or the
 * project as readily as on a wall (KNM_ARK carries both of its property rows on
 * `IfcProject`; KNM_RIB carries 231 of 337 on spatial elements). Keying by guid
 * rather than joining onto `rows` is what keeps those reachable.
 *
 * Both are OPTIONAL, and absent is a different answer from empty: absent means
 * this profile was built from a graph that carried no property table at all, and
 * the panel says that instead of printing "none". A guid with no entry in a
 * table that IS present declares nothing, which is the other answer.
 */
export interface ModelProfile {
  rows: ProductRowLite[];
  storeys: StoreyRowLite[];
  spatial: SpatialCounts;
  psets?: Map<string, PsetGroup[]>;
  classifications?: Map<string, ClassificationRef[]>;
  /** `IfcElementQuantity` (`Qto_*`), the same absent-vs-empty rule as `psets`. */
  quantities?: Map<string, PsetGroup[]>;
  /** Named spatial containers, so a relationship row can print a NAME rather
   *  than only the GlobalId it points at. */
  buildings?: { guid: string; name: string | null }[];
  sites?: { guid: string; name: string | null }[];
}

export interface ClassCount {
  entity: string;
  count: number;
}

export interface StoreyFact extends StoreyRowLite {
  elements: number;
  /** How many storeys sit at this exact elevation. 1 means it is its own. */
  sharedWith: number;
}

export interface MatrixRow {
  /** null is the row for elements the graph places in no storey. */
  storeyGuid: string | null;
  label: string | null;
  counts: Map<string, number>;
  total: number;
}

export interface Census {
  classes: ClassCount[];
  storeys: StoreyFact[];
  matrix: MatrixRow[];
  /** Largest single cell in the matrix, for the magnitude ramp. */
  matrixPeak: number;
}

/** Storeys sorted top-down by elevation, nulls last, then products bucketed by
 *  storey and class. One pass over the rows; everything else reads the buckets. */
export function census(profile: ModelProfile): Census {
  const byClass = new Map<string, number>();
  const byStorey = new Map<string | null, Map<string, number>>();
  const storeyTotals = new Map<string | null, number>();

  const known = new Set(profile.storeys.map((s) => s.guid));

  for (const row of profile.rows) {
    byClass.set(row.entity, (byClass.get(row.entity) ?? 0) + 1);
    const key = row.storeyGuid !== null && known.has(row.storeyGuid) ? row.storeyGuid : null;
    let bucket = byStorey.get(key);
    if (!bucket) {
      bucket = new Map<string, number>();
      byStorey.set(key, bucket);
    }
    bucket.set(row.entity, (bucket.get(row.entity) ?? 0) + 1);
    storeyTotals.set(key, (storeyTotals.get(key) ?? 0) + 1);
  }

  const classes = [...byClass.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));

  const atElevation = new Map<string, number>();
  for (const storey of profile.storeys) {
    if (storey.elevation === null) continue;
    const key = storey.elevation.toFixed(6);
    atElevation.set(key, (atElevation.get(key) ?? 0) + 1);
  }

  const ordered = [...profile.storeys].sort((a, b) => {
    if (a.elevation === null && b.elevation === null) return 0;
    if (a.elevation === null) return 1;
    if (b.elevation === null) return -1;
    return b.elevation - a.elevation;
  });

  const storeys: StoreyFact[] = ordered.map((storey) => ({
    ...storey,
    elements: storeyTotals.get(storey.guid) ?? 0,
    sharedWith:
      storey.elevation === null ? 1 : (atElevation.get(storey.elevation.toFixed(6)) ?? 1),
  }));

  const matrix: MatrixRow[] = storeys.map((storey) => ({
    storeyGuid: storey.guid,
    label: storey.name,
    counts: byStorey.get(storey.guid) ?? new Map<string, number>(),
    total: storey.elements,
  }));
  // The orphan row always renders, empty or not: a model with nothing loose is
  // a fact worth reading off the same matrix as one full of loose elements.
  matrix.push({
    storeyGuid: null,
    label: null,
    counts: byStorey.get(null) ?? new Map<string, number>(),
    total: storeyTotals.get(null) ?? 0,
  });

  let matrixPeak = 0;
  for (const row of matrix) {
    for (const value of row.counts.values()) {
      if (value > matrixPeak) matrixPeak = value;
    }
  }

  return { classes, storeys, matrix, matrixPeak };
}

/** Products the graph places in any of these storeys, in graph order.
 *
 * `null` in the list is the orphan bucket, and a storey guid the file does not
 * declare falls into it exactly as `census` and `cellRows` fold it — one
 * normalisation, so a storey row, a census cell and the floor matrix cannot
 * disagree about which elements are "on" a floor. */
export function storeyRows(
  profile: ModelProfile,
  storeyGuids: readonly (string | null)[],
): ProductRowLite[] {
  const known = new Set(profile.storeys.map((s) => s.guid));
  const wanted = new Set(storeyGuids);
  return profile.rows.filter((row) => {
    const key = row.storeyGuid !== null && known.has(row.storeyGuid) ? row.storeyGuid : null;
    return wanted.has(key);
  });
}

/** How a set of storeys is named on a chip or a derivation header. A storey
 *  with no name falls back to its GlobalId, which identifies it; `orphan` is
 *  the caller's word for the no-storey bucket, because this module does not
 *  localise. */
export function storeyNames(
  profile: ModelProfile,
  storeyGuids: readonly (string | null)[],
  orphan: string,
): string {
  return storeyGuids
    .map((guid) =>
      guid === null ? orphan : (profile.storeys.find((s) => s.guid === guid)?.name ?? guid),
    )
    .join(" · ");
}

/** Products in one matrix cell, in graph order. */
export function cellRows(
  profile: ModelProfile,
  storeyGuid: string | null,
  entity: string,
): ProductRowLite[] {
  const known = new Set(profile.storeys.map((s) => s.guid));
  return profile.rows.filter((row) => {
    if (row.entity !== entity) return false;
    const key = row.storeyGuid !== null && known.has(row.storeyGuid) ? row.storeyGuid : null;
    return key === storeyGuid;
  });
}
