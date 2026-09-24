/** Does an element's GEOMETRY sit where the file says it is?
 *
 * The spatial tree says which storey owns an element; the mesh says where the
 * element actually is. When the two part ways, every storey filter, floor
 * quantity and section that trusts the tree is wrong, silently. IDS cannot ask
 * this (no facet reaches geometry), and neither can the twelve fundamentals in
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
  /** METRES — `unit_scale` already applied (ifcfast#180). */
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

/** What `placementContext` needs, named rather than taken as a whole graph.
 *
 * The check builds it from `IfcGraph`; the object panel builds it from the
 * UI's reduced profile. Neither owns the arithmetic — that is the point: one
 * hub, one cutoff, one storey band, one tolerance, whoever is asking. */
export interface PlacementInput {
  /** Already scope-filtered: openings and copy-object exclusions dropped. */
  products: readonly { guid: string; storeyGuid: string | null }[];
  /** `elevation` in FILE units, exactly as the parser reports it. */
  storeys: readonly { guid: string; name: string | null; elevation: number | null }[];
  unitScale: number;
  unitResolved: boolean;
}

/**
 * Everything the placement question needs that is a property of the MODEL
 * rather than of one element: the main body's hub and cutoff, which elements
 * are strays, the storey band, and whether the band can be compared at all.
 *
 * Built once per model. `checkMeshPlacement` runs off it and so does the
 * object panel's derived group, so a value shown beside one element and the
 * check's verdict on the same element cannot come from two different rules.
 */
export interface PlacementContext {
  boxes: ReadonlyMap<string, ElementBox>;
  /** In-scope products that have geometry, in input order. */
  meshed: readonly { guid: string; storeyGuid: string | null }[];
  hub: [number, number, number];
  cutoff: number;
  far: ReadonlySet<string>;
  /** Lowest first, metres. */
  levels: Level[];
  storeyByGuid: ReadonlyMap<string, Level>;
  /** Null when the storey band CAN be compared; otherwise the reason it
   *  cannot, in the engine's own words. */
  storeyReason: string | null;
  /** Elements the band was compared for. */
  compared: number;
  /** Products with no geometry at all. */
  unmeshed: number;
  /** guid -> index into `meshed`, so a per-element lookup is not a scan. */
  at: ReadonlyMap<string, number>;
}

export function placementContext(
  input: PlacementInput,
  boxes: ReadonlyMap<string, ElementBox>,
): PlacementContext {
  const meshed = input.products.filter((p) => boxes.has(p.guid));
  const at = new Map(meshed.map((p, i) => [p.guid, i]));

  const centres = meshed.map((p) => {
    const b = boxes.get(p.guid)!;
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as const;
  });
  const halves = meshed.map((p) => {
    const b = boxes.get(p.guid)!;
    return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  });
  const { outlier, cutoff } = bulkOutliers(centres, halves);
  const hub = meshed.length ? bulkHub(centres) : ([0, 0, 0] as [number, number, number]);
  const far = new Set<string>();
  meshed.forEach((p, i) => {
    if (outlier[i]) far.add(p.guid);
  });

  const levels: Level[] = input.storeys
    .filter((s) => s.elevation !== null)
    .map((s) => ({ guid: s.guid, name: s.name, elevation: (s.elevation as number) * input.unitScale }))
    .sort((a, b) => a.elevation - b.elevation);
  const storeyByGuid = new Map(levels.map((l) => [l.guid, l]));
  const distinct: number[] = [];
  for (const l of levels) {
    if (!distinct.length || Math.abs(l.elevation - distinct[distinct.length - 1]) > LEVEL_EPSILON_M) {
      distinct.push(l.elevation);
    }
  }

  let storeyReason: string | null = null;
  let compared = 0;
  if (!input.unitResolved) {
    storeyReason = "storey comparison not run: length unit unresolved";
  } else if (distinct.length < 2) {
    storeyReason =
      `storey comparison not run: ${levels.length} storey elevation(s) are not distinguishable` +
      (distinct.length === 1 ? ` (all at ${distinct[0].toFixed(3)} m)` : "");
  } else {
    let elevLo = Infinity;
    let elevHi = -Infinity;
    let bottomLo = Infinity;
    let bottomHi = -Infinity;
    for (const p of meshed) {
      if (far.has(p.guid) || !p.storeyGuid) continue;
      const stated = storeyByGuid.get(p.storeyGuid);
      if (!stated) continue;
      compared += 1;
      elevLo = Math.min(elevLo, stated.elevation);
      elevHi = Math.max(elevHi, stated.elevation);
      const bottom = boxes.get(p.guid)!.min[2];
      bottomLo = Math.min(bottomLo, bottom);
      bottomHi = Math.max(bottomHi, bottom);
    }
    const band = STOREY_TOLERANCE_M;
    if (compared > 0 && (bottomHi < elevLo - band || bottomLo > elevHi + band)) {
      storeyReason =
        `storey comparison not run: mesh bottoms ${bottomLo.toFixed(2)}..${bottomHi.toFixed(2)} m ` +
        `and storey elevations ${elevLo.toFixed(2)}..${elevHi.toFixed(2)} m do not overlap, ` +
        "so they are not in one frame";
    }
  }

  return {
    boxes,
    meshed,
    hub,
    cutoff,
    far,
    levels,
    storeyByGuid,
    storeyReason,
    compared,
    unmeshed: input.products.length - meshed.length,
    at,
  };
}

/** One element's placement facts, as the check would judge them.
 *
 * Every field is what was MEASURED and nothing more. `null` is never a zero:
 * an element with no mesh has no box, no bottom and no distance, and an
 * element whose model cannot have its storey band compared has no `expected`
 * — `storeyReason` says which of those it is. */
export interface ElementPlacement {
  box: ElementBox | null;
  centre: [number, number, number] | null;
  /** Euclidean distance from the model's main-body hub, metres. */
  distance: number | null;
  cutoff: number;
  far: boolean;
  /** Mesh bottom, metres (world Z). */
  bottom: number | null;
  /** The storey the file says contains it, elevation in metres. */
  stated: Level | null;
  /** The storey the mesh bottom falls in. */
  expected: Level | null;
  /** bottom - stated elevation, metres, signed. */
  delta: number | null;
  /** Why `expected` could not be computed, in the engine's own words. */
  storeyReason: string | null;
}

export function placementOf(guid: string, ctx: PlacementContext): ElementPlacement {
  const box = ctx.boxes.get(guid) ?? null;
  const index = ctx.at.get(guid);
  const statedGuid = index === undefined ? null : ctx.meshed[index].storeyGuid;
  const statedLevel = statedGuid === null ? null : (ctx.storeyByGuid.get(statedGuid) ?? null);
  if (!box) {
    return {
      box: null,
      centre: null,
      distance: null,
      cutoff: ctx.cutoff,
      far: false,
      bottom: null,
      stated: statedLevel,
      expected: null,
      delta: null,
      storeyReason: ctx.storeyReason,
    };
  }
  const centre: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const bottom = box.min[2];
  const far = ctx.far.has(guid);
  // Far wins: a mesh kilometres away has no meaningful storey band, which is
  // exactly the precedence `checkMeshPlacement` applies to its findings.
  const canBand = ctx.storeyReason === null && !far;
  const expected = canBand ? expectedLevel(ctx.levels, bottom) : null;
  return {
    box,
    centre,
    distance: Math.hypot(centre[0] - ctx.hub[0], centre[1] - ctx.hub[1], centre[2] - ctx.hub[2]),
    cutoff: ctx.cutoff,
    far,
    bottom,
    stated: statedLevel,
    expected,
    delta: statedLevel ? bottom - statedLevel.elevation : null,
    storeyReason: far ? "far from the model" : ctx.storeyReason,
  };
}

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
  const byGuid = new Map(products.map((p) => [p.guid, p]));
  const ctx = placementContext(
    {
      products: products.map((p) => ({ guid: p.guid, storeyGuid: p.storey_guid })),
      storeys: graph.storeys,
      unitScale: summary.unit_scale,
      unitResolved: summary.unit_resolved,
    },
    boxes,
  );

  const findings: Finding[] = [];
  for (const p of ctx.meshed) {
    if (!ctx.far.has(p.guid)) continue;
    const place = placementOf(p.guid, ctx);
    findings.push(
      finding(byGuid.get(p.guid)!, "far-from-model", {
        distance: round(place.distance ?? 0, 0),
        cutoff: round(ctx.cutoff, 1),
      }),
    );
  }

  let storeyNote: string;
  if (ctx.storeyReason !== null) {
    storeyNote = ctx.storeyReason;
  } else {
    let off = 0;
    for (const p of ctx.meshed) {
      if (ctx.far.has(p.guid) || !p.storeyGuid) continue;
      const stated = ctx.storeyByGuid.get(p.storeyGuid);
      if (!stated) continue;
      const place = placementOf(p.guid, ctx);
      const expected = place.expected;
      if (expected && Math.abs(expected.elevation - stated.elevation) <= LEVEL_EPSILON_M) continue;
      off += 1;
      findings.push(
        finding(byGuid.get(p.guid)!, "storey-mismatch", {
          bottom: round(place.bottom ?? 0),
          storey: stated.name ?? stated.guid,
          elevation: round(stated.elevation),
          expected: expected ? (expected.name ?? expected.guid) : "-",
        }),
      );
    }
    storeyNote = `${off} of ${ctx.compared} off their storey (tolerance ${STOREY_TOLERANCE_M} m)`;
  }

  return result(
    id,
    "deviation",
    ctx.meshed.length,
    findings,
    share(ctx.meshed.length - findings.length, ctx.meshed.length),
    `${ctx.far.size} of ${ctx.meshed.length} far from the model (cutoff ${round(ctx.cutoff, 1)} m); ` +
      `${storeyNote}; ${ctx.unmeshed} without geometry`,
  );
}
