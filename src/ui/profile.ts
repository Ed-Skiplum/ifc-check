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

/** One product, reduced to what the dashboard and its drill-downs read. */
export interface ProductRowLite {
  guid: string;
  entity: string;
  name: string | null;
  storeyGuid: string | null;
}

export interface StoreyRowLite {
  guid: string;
  name: string | null;
  /** In FILE units — scale by `unitScale` before reading it as metres. */
  elevation: number | null;
}

/** The raw payload the worker sends alongside the check results. */
export interface ModelProfile {
  rows: ProductRowLite[];
  storeys: StoreyRowLite[];
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
