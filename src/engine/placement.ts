/** Does an element's GEOMETRY sit where the file says it is?
 *
 * The spatial tree says which storey owns an element; the mesh says where the
 * element actually is. When the two part ways, every storey filter, floor
 * quantity and section that trusts the tree is wrong, silently. IDS cannot ask
 * this (no facet reaches geometry), and neither can the eleven fundamentals in
 * `fundamentals.ts`, which run on the graph alone. This one needs the streamed
 * meshes, so it is its own module and runs wherever geometry exists: the parse
 * worker, the restore worker (boxes rebuilt from the cached batches) and
 * `scripts/check-cli.ts`. Without complete geometry (mesh pass failed, or a
 * restored cache whose batches were capped) it reports `not_applicable` with
 * the reason, never a pass.
 *
 * Two independent findings, one per element (far wins, because a mesh that is
 * kilometres away has no meaningful storey band):
 *
 *   far-from-model   the mesh centre, or the mesh's own extent, is beyond the
 *                    bulk cutoff: FAR_SPREAD x the 98th percentile of centre
 *                    distances from the median centre (Chebyshev, per axis),
 *                    floored at FAR_FLOOR_M. This is the SAME rule the viewer's
 *                    entry camera uses to decide what not to frame
 *                    (`src/viewer/mesh-stream.ts` `framingBox` calls
 *                    `bulkOutliers` below), so "drawn but not framed" and
 *                    "placement mismatch" can never disagree about which
 *                    elements are strays.
 *
 *   storey-mismatch  the storey the mesh BOTTOM falls in is not the stated
 *                    storey. Expected storey = the storey with the greatest
 *                    elevation still <= bottom + STOREY_TOLERANCE_M. Method and
 *                    tolerance from `KNM_Mottakskontroll/02_arbeid/ids/
 *                    storey_check.py`: the bottom, not the centroid, because
 *                    columns, facades and shafts legitimately span storeys and
 *                    start in the one that owns them.
 *
 * ── Units and frames ──────────────────────────────────────────────────────
 * Streamed positions are world METRES minus `streamShiftJson()`; the shift is
 * added back here. Storey elevation is in FILE units (ifcfast#180) and is
 * scaled by `summary.unit_scale` before any comparison.
 *
 * IFC defines Elevation relative to the building, and the mesh is in world
 * coordinates, so the two are only comparable when the file puts them in one
 * frame. Measured on the KNM exports (ARK, RIV, RIB, 2026-09-14) they are: the
 * storeys carry absolute NN2000 heights (118.6, 122.5, ...) and each storey's
 * median mesh bottom lands on its own elevation. A file where they are not
 * (building placed at z = 100, storeys at 0 / 3 / 6) would flag every element
 * as being on the top storey, so when the span of the stated elevations and
 * the span of the mesh bottoms do not overlap at all the storey half refuses
 * to run and says why, rather than reporting that as findings. A share-based
 * test was tried first and rejected: KNM_RIV has 564 of 652 elements genuinely
 * 0.68 m under their storey (ducts in the ceiling void below), in one frame.
 *
 * ── What it cannot see ────────────────────────────────────────────────────
 * "Far from its OWN placement origin" is not measurable here: ifcfast computes
 * a per-product `drift` table (placement vs centroid, `drift_distance_m`) in
 * the core, but the wasm build exposes only its row count in `summaryJson`, no
 * accessor. Far is therefore judged against the model's main body only.
 */

import type { CheckResult, Finding, IfcGraph, IfcSummary, ProductRow } from "./types";
import { finding, literal, result, share } from "./fundamentals.ts";

/** Metres. Screed, finish build-up and modelling slop put a mesh bottom a few
 *  centimetres under its storey level; 0.1 m absorbs that and stays an order
 *  of magnitude under any real storey spacing. From storey_check.py. */
export const STOREY_TOLERANCE_M = 0.1;

/** Elevations closer than this are one level (a split level modelled as two
 *  storeys is not a mismatch for elements in either). */
export const LEVEL_EPSILON_M = 0.001;

/** The framing rule's constants, moved here so camera and check share them. */
export const FAR_SPREAD = 5;
export const FAR_FLOOR_M = 1;

/** One element's world box, Z-up metres (shift added back). */
export interface ElementBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** Fold one streamed batch into `into`. `positions` are xyz triples in metres
 *  minus `shift`; `meta` rows carry each element's vertex range. Call it from
 *  the stream callback BEFORE any triangle ceiling drops the batch: a capped
 *  viewer still has a complete check. */
export function collectBoxes(
  into: Map<string, ElementBox>,
  meta: readonly { guid: string; v0: number; vn: number }[],
  positions: Float32Array,
): void {
  for (const row of meta) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = row.v0; v < row.v0 + row.vn; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    if (x0 > x1) continue;
    const prev = into.get(row.guid);
    if (prev) {
      // One product can arrive in more than one meta row; widen, never replace.
      prev.min = [Math.min(prev.min[0], x0), Math.min(prev.min[1], y0), Math.min(prev.min[2], z0)];
      prev.max = [Math.max(prev.max[0], x1), Math.max(prev.max[1], y1), Math.max(prev.max[2], z1)];
    } else {
      into.set(row.guid, { min: [x0, y0, z0], max: [x1, y1, z1] });
    }
  }
}

/** Add the stream shift back, so boxes are absolute world metres. Separate
 *  from `collectBoxes` because the shift is only known once the stream ends. */
export function unshiftBoxes(boxes: Map<string, ElementBox>, shift: readonly number[]): void {
  if (!shift.some((s) => s !== 0)) return;
  for (const box of boxes.values()) {
    for (let a = 0; a < 3; a += 1) {
      box.min[a] += shift[a];
      box.max[a] += shift[a];
    }
  }
}

/** Symmetric median (mean of the two middles for an even count), so negating
 *  an axis negates the result exactly: the camera runs this in Y-up with
 *  z = -y, the check in IFC Z-up, and both must reach the same verdict. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The model's main-body centre: the per-axis median of element centres. */
export function bulkHub(centres: readonly (readonly [number, number, number])[]): [number, number, number] {
  return [0, 1, 2].map((a) => median(centres.map((c) => c[a]))) as [number, number, number];
}

/** The bulk-vs-stray rule, over element centres and half-extents in ANY one
 *  frame (the distance is per-axis max, so an axis permutation does not change
 *  it). Returns 1 per stray. When everything would be a stray the model has no
 *  bulk, which is not the same as every element being broken, so all flags
 *  clear. */
export function bulkOutliers(
  centres: readonly (readonly [number, number, number])[],
  halves: readonly number[],
): { outlier: Uint8Array; cutoff: number } {
  const n = centres.length;
  const outlier = new Uint8Array(n);
  if (n === 0) return { outlier, cutoff: 0 };
  const hub = bulkHub(centres);
  const spread = centres.map((c) =>
    Math.max(Math.abs(c[0] - hub[0]), Math.abs(c[1] - hub[1]), Math.abs(c[2] - hub[2])),
  );
  const sorted = [...spread].sort((a, b) => a - b);
  const p98 = sorted[Math.floor(0.98 * (sorted.length - 1))];
  const cutoff = Math.max(p98 * FAR_SPREAD, FAR_FLOOR_M);
  let kept = 0;
  for (let i = 0; i < n; i += 1) {
    if (spread[i] > cutoff || halves[i] > cutoff) outlier[i] = 1;
    else kept += 1;
  }
  if (kept === 0) outlier.fill(0);
  return { outlier, cutoff };
}

interface Level {
  guid: string;
  name: string | null;
  elevation: number;
}

/** The storey the mesh bottom falls in, lowest-first `levels`. null = below
 *  every storey. */
function expectedLevel(levels: Level[], bottom: number): Level | null {
  let found: Level | null = null;
  for (const level of levels) {
    if (level.elevation <= bottom + STOREY_TOLERANCE_M) found = level;
    else break;
  }
  return found;
}

const round = (v: number, d = 2) => Number(v.toFixed(d));

/**
 * `boxes` null = no geometry in this session (the restore path): the check
 * cannot run and says so. `excluded` is the copy-object scope filter, applied
 * exactly as `runFundamentals` applies it.
 */
export function checkMeshPlacement(
  graph: IfcGraph,
  summary: IfcSummary,
  boxes: ReadonlyMap<string, ElementBox> | null,
  excluded?: ReadonlySet<string>,
  /** Why `boxes` is null, printed as the not_applicable reason. */
  noGeometry = "no geometry: the mesh pass failed",
): CheckResult {
  const id = "mesh-placement";
  if (boxes === null) {
    return { ...result(id, "deviation", 0, [], literal("—"), noGeometry), reason: noGeometry };
  }

  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  const products: ProductRow[] = graph.products.filter(
    (p) => !openings.has(p.guid) && !excluded?.has(p.guid),
  );
  const meshed = products.filter((p) => boxes.has(p.guid));

  // ── far from the main body
  const centres = meshed.map((p) => {
    const b = boxes.get(p.guid)!;
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as const;
  });
  const halves = meshed.map((p) => {
    const b = boxes.get(p.guid)!;
    return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  });
  const { outlier, cutoff } = bulkOutliers(centres, halves);
  const findings: Finding[] = [];
  const far = new Set<string>();
  const hub = meshed.length ? bulkHub(centres) : [0, 0, 0];
  meshed.forEach((p, i) => {
    if (!outlier[i]) return;
    far.add(p.guid);
    const c = centres[i];
    const distance = Math.hypot(c[0] - hub[0], c[1] - hub[1], c[2] - hub[2]);
    findings.push(finding(p, "far-from-model", { distance: round(distance, 0), cutoff: round(cutoff, 1) }));
  });

  // ── storey band
  const byGuid = new Map(graph.storeys.map((s) => [s.guid, s]));
  const levels: Level[] = graph.storeys
    .filter((s) => s.elevation !== null)
    .map((s) => ({ guid: s.guid, name: s.name, elevation: (s.elevation as number) * summary.unit_scale }))
    .sort((a, b) => a.elevation - b.elevation);
  const distinct: number[] = [];
  for (const l of levels) {
    if (!distinct.length || Math.abs(l.elevation - distinct[distinct.length - 1]) > LEVEL_EPSILON_M) {
      distinct.push(l.elevation);
    }
  }

  let storeyNote: string;
  let compared = 0;
  let elevLo = Infinity, elevHi = -Infinity, bottomLo = Infinity, bottomHi = -Infinity;
  const storeyFindings: Finding[] = [];
  if (!summary.unit_resolved) {
    storeyNote = "storey comparison not run: length unit unresolved";
  } else if (distinct.length < 2) {
    storeyNote =
      `storey comparison not run: ${levels.length} storey elevation(s) are not distinguishable` +
      (distinct.length === 1 ? ` (all at ${distinct[0].toFixed(3)} m)` : "");
  } else {
    for (const p of meshed) {
      if (far.has(p.guid) || !p.storey_guid) continue;
      const stated = byGuid.get(p.storey_guid);
      if (!stated || stated.elevation === null) continue;
      compared += 1;
      const statedElevation = stated.elevation * summary.unit_scale;
      const bottom = boxes.get(p.guid)!.min[2];
      elevLo = Math.min(elevLo, statedElevation);
      elevHi = Math.max(elevHi, statedElevation);
      bottomLo = Math.min(bottomLo, bottom);
      bottomHi = Math.max(bottomHi, bottom);
      const expected = expectedLevel(levels, bottom);
      if (expected && Math.abs(expected.elevation - statedElevation) <= LEVEL_EPSILON_M) continue;
      storeyFindings.push(
        finding(p, "storey-mismatch", {
          bottom: round(bottom),
          storey: stated.name ?? stated.guid,
          elevation: round(statedElevation),
          expected: expected ? (expected.name ?? expected.guid) : "-",
        }),
      );
    }
    const band = STOREY_TOLERANCE_M;
    if (compared > 0 && (bottomHi < elevLo - band || bottomLo > elevHi + band)) {
      storeyNote =
        `storey comparison not run: mesh bottoms ${bottomLo.toFixed(2)}..${bottomHi.toFixed(2)} m ` +
        `and storey elevations ${elevLo.toFixed(2)}..${elevHi.toFixed(2)} m do not overlap, ` +
        "so they are not in one frame";
      storeyFindings.length = 0;
    } else {
      storeyNote = `${storeyFindings.length} of ${compared} off their storey (tolerance ${STOREY_TOLERANCE_M} m)`;
    }
  }
  findings.push(...storeyFindings);

  const unmeshed = products.length - meshed.length;
  return result(
    id,
    "deviation",
    meshed.length,
    findings,
    share(meshed.length - findings.length, meshed.length),
    `${far.size} of ${meshed.length} far from the model (cutoff ${round(cutoff, 1)} m); ` +
      `${storeyNote}; ${unmeshed} without geometry`,
  );
}
