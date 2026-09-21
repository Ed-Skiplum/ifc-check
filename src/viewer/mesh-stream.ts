/** What `streamMeshes` hands over, and the identity index built from it.
 *
 * ifcfast's wasm `streamMeshes(productsPerBatch, cb)` calls back FOUR times per
 * batch-argument-list:
 *
 *   cb(metaJson: string, positions: Float32Array, indices: Uint32Array,
 *      progressJson: string)
 *
 * `positions` is a COPY into JS memory (not a view into the wasm heap), so the
 * worker may transfer it; `indices` is already offset by each product's `v0`,
 * so a batch uploads as ONE merged `BufferGeometry`. That is why nothing here
 * re-slices geometry per element: the batch IS the draw unit, and an element is
 * a RANGE inside it.
 *
 * Identity to the GPU follows the G55 de-dup viewer
 * (`10027-grønland-55/.../build_dedup_viewer.py`, the merged-mesh + per-face id
 * array + raycast-pick technique this module ports): one Int32Array entry PER
 * FACE, so a raycast's `faceIndex` resolves to an element with no search and no
 * second id space. GUID is the table-facing key; the slot is the GPU-facing one.
 */

import { bulkOutliers } from "../engine/placement.ts";

/** One product's record inside a batch, as `metaJson` parses. */
export interface MeshMetaRow {
  guid: string;
  entity: string;
  storey_guid: string | null;
  type_name: string | null;
  /** `mesh::gltf::resolve_product_color` — the same cascade the glTF writer
   *  paints with. 0..1 per channel. */
  rgba: [number, number, number, number];
  /** Vertex offset / count inside `positions` (xyz triples). */
  v0: number;
  vn: number;
  /** Index offset / count inside `indices`. */
  i0: number;
  in: number;
  /** v1 per-product measures. `tri` reconciles with `in / 3`. */
  tri: number;
  m2: number;
  m3: number;
}

/** One merged batch, exactly as it left the worker. */
export interface MeshBatch {
  batch: number;
  meta: MeshMetaRow[];
  positions: Float32Array;
  indices: Uint32Array;
}

/** Where one element's geometry lives. */
export interface MeshRange {
  batch: number;
  v0: number;
  vn: number;
  i0: number;
  iCount: number;
  entity: string;
  storeyGuid: string | null;
  /** Index into `MeshSet.slotGuid` — what a face resolves to. */
  slot: number;
  rgba: [number, number, number, number];
}

/** What the mesh pass produced versus what it was allowed to keep.
 *
 * A cap is legitimate — crashing the machine is worse than capping — but it may
 * never be silent, and it may never reduce a view of ONE element. Both halves
 * are canon, so both numbers travel with the geometry rather than being
 * recomputed for display.
 */
export interface MeshBudget {
  /** Elements kept / elements the mesh pass produced. */
  elements: number;
  totalElements: number;
  /** Triangles kept / triangles the mesh pass produced. */
  triangles: number;
  totalTriangles: number;
  /** True when anything at all was withheld. */
  capped: boolean;
  ceiling: number;
}

/** The machine-safety ceiling, in triangles.
 *
 * Sized so the retained buffers stay well inside a laptop GPU: at 4M triangles
 * the index buffer alone is 48 MB and positions are up to 48 MB more. The unit
 * of withholding is a whole BATCH, never part of an element — a partial element
 * is the "looks right, is wrong" failure this codebase refuses.
 */
export const MESH_TRIANGLE_CEILING = 4_000_000;

/**
 * Faces above which HOVER picking is switched off.
 *
 * three raycasts a merged mesh face by face — there is no BVH here and adding
 * one would be a dependency the identity scheme does not need. Measured on this
 * box against `KNM_RIB.ifc` (73,386 faces, four merged batches, node 24):
 * **1.49 ms per raycast**, 200 casts in 297 ms. That is linear in faces, so the
 * 4M-triangle ceiling extrapolates to ~81 ms per cast — a third of a second of
 * stall for every pointer move.
 *
 * 400k faces is where a cast costs about 8 ms, half a frame. Above it,
 * mesh-to-row hover is off and the tile says so; row-to-mesh hover keeps
 * working, because that direction is a map lookup and costs nothing. A CLICK
 * still casts at any size: one 80 ms pause on a deliberate action is a cost
 * worth paying, sixty of them a second is not.
 */
export const HOVER_FACE_BUDGET = 400_000;

/** Products per streamed batch. Small enough that the cap lands at roughly
 *  0.25 % granularity on a 100k-element model, large enough that a 851-element
 *  model is four batches rather than four hundred postMessages. */
export const MESH_PRODUCTS_PER_BATCH = 250;

/** Batches + the identity index, ready for the scene. */
export interface MeshSet {
  batches: MeshBatch[];
  /** Model-wide shift in METRES that `positions` was reduced by. `[0,0,0]`
   *  within 10 km of the origin. Kept so an absolute coordinate can be
   *  recovered without guessing. */
  shift: [number, number, number];
  index: Map<string, MeshRange>;
  /** Per batch: one element slot per FACE of that batch's index buffer. */
  faceSlots: Int32Array[];
  /** slot -> guid. */
  slotGuid: string[];
  budget: MeshBudget;
}

/**
 * Re-order one batch's faces into [matched | unmatched] and return how many
 * matched.
 *
 * The two halves become two geometry GROUPS with two materials, which is how
 * `filter` (draw the first group only) and `highlight` (draw both, the second
 * ghosted) come out of ONE mechanism rather than two. The per-face id array is
 * permuted in lockstep with the index buffer, which is the whole reason a
 * raycast's `faceIndex` still resolves to the right element after a filter.
 *
 * Pure, and exported, so the headless gate can assert that invariant against
 * the code the viewer actually runs instead of against a second copy of it.
 */
export function partitionFaces(
  source: Uint32Array,
  sourceSlots: Int32Array,
  slotGuid: string[],
  matched: Set<string> | null,
  working: Uint32Array,
  workingSlots: Int32Array,
): number {
  const faces = source.length / 3;
  if (matched === null) {
    working.set(source);
    workingSlots.set(sourceSlots);
    return faces;
  }
  let head = 0;
  let tail = faces - 1;
  for (let face = 0; face < faces; face += 1) {
    const slot = sourceSlots[face];
    const guid = slot >= 0 ? slotGuid[slot] : null;
    const keep: boolean = guid !== null && matched.has(guid);
    const at = keep ? head++ : tail--;
    working[at * 3] = source[face * 3];
    working[at * 3 + 1] = source[face * 3 + 1];
    working[at * 3 + 2] = source[face * 3 + 2];
    workingSlots[at] = slot;
  }
  return head;
}

/** The box the camera frames on entry, and what it had to leave out. */
export interface FramingBox {
  min: [number, number, number];
  max: [number, number, number];
  /** Elements whose geometry is so far from the rest that framing them frames
   *  nothing else. Still DRAWN and still pickable — this is a camera decision,
   *  never a visibility one. */
  excluded: number;
  total: number;
  /** Every element that had geometry, with its own world box and whether the
   *  framing rule threw it out.
   *
   * Kept rather than discarded because the ORBIT PIVOT has to be re-derived
   * every time the filter or the selection changes, and re-walking every vertex
   * on each of those is O(vertices) per user action on a model that may carry
   * four million triangles. From these it is O(elements), and — the point — the
   * pivot inherits the SAME outlier verdict the entry camera used instead of a
   * second, subtly different robustness rule. */
  elements: ElementBoxes;
}

/** Per-element world boxes, parallel arrays rather than objects: one allocation
 *  each instead of one per element on a 100k-element model. */
export interface ElementBoxes {
  guids: string[];
  /** Six floats per element: minX, minY, minZ, maxX, maxY, maxZ. */
  bounds: Float64Array;
  /** 1 where the element failed the framing cutoff. */
  outlier: Uint8Array;
}

/**
 * A robust framing box, in WORLD space (IFC Z-up already mapped to Y-up).
 *
 * Fit-on-entry against the true bounding box is correct arithmetic and a
 * useless picture the moment a model carries one broken element. Measured on
 * `KNM_RIB.ifc`: 846 of 851 elements sit within ~400 m of the origin and five
 * `IfcBeam` reach +-31,847,402 m, so the true box is 61,636 km across and a
 * fit to it renders the building as a sub-pixel dot.
 *
 * So the ENTRY CAMERA frames the bulk, and the count it left out is printed on
 * the tile. Nothing is hidden: every element is uploaded, drawn and pickable,
 * and selecting an excluded one and pressing zoom-to-selection frames it
 * exactly, because that path uses the true box.
 *
 * The rule is per element (`bulkOutliers`, `src/engine/placement.ts`): the
 * centre must be within `FAR_SPREAD` times the 98th
 * percentile of centre distances, and the element's own half-diagonal must not
 * exceed that same cutoff. The first catches a stray placement, the second
 * catches geometry that exploded in place.
 */

export function framingBox(set: MeshSet): FramingBox | null {
  const centres: [number, number, number][] = [];
  const halves: number[] = [];
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
  const guids: string[] = [];

  for (const [guid, range] of set.index) {
    const positions = set.batches[range.batch].positions;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let v = range.v0; v < range.v0 + range.vn; v += 1) {
      // Model space is Z-up; the scene root carries the -PI/2 rotation about
      // X, so (x, y, z) becomes (x, z, -y).
      const x = positions[v * 3];
      const y = positions[v * 3 + 2];
      const z = -positions[v * 3 + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (minX > maxX) continue;
    guids.push(guid);
    boxes.push({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    centres.push([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]);
    halves.push(Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  }
  if (boxes.length === 0) return null;

  // The stray rule lives in the engine, where `mesh-placement` uses the SAME
  // function: what the camera leaves out of the frame and what the check calls
  // far from the model are one verdict, not two near-miss ones.
  const { outlier: stray } = bulkOutliers(centres, halves);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const bounds = new Float64Array(boxes.length * 6);
  const outlier = new Uint8Array(boxes.length);
  let kept = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      bounds[i * 6 + a] = boxes[i].min[a];
      bounds[i * 6 + 3 + a] = boxes[i].max[a];
    }
    if (stray[i]) {
      outlier[i] = 1;
      continue;
    }
    kept += 1;
    for (let a = 0; a < 3; a += 1) {
      if (boxes[i].min[a] < min[a]) min[a] = boxes[i].min[a];
      if (boxes[i].max[a] > max[a]) max[a] = boxes[i].max[a];
    }
  }
  const elements: ElementBoxes = { guids, bounds, outlier };
  // Everything is an outlier only if the model has no bulk at all; then the
  // true box IS the answer and there is nothing to report. The per-element
  // flags are cleared with it: a rule that rejected every element has not found
  // outliers, it has failed to find a bulk, and a pivot must not inherit that
  // verdict as if five elements were broken.
  if (kept === 0) {
    outlier.fill(0);
    for (const box of boxes) {
      for (let a = 0; a < 3; a += 1) {
        if (box.min[a] < min[a]) min[a] = box.min[a];
        if (box.max[a] > max[a]) max[a] = box.max[a];
      }
    }
    return { min, max, excluded: 0, total: boxes.length, elements };
  }
  return { min, max, excluded: boxes.length - kept, total: boxes.length, elements };
}

/** A world-space box, the shape every camera routine here takes. */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** guid -> row in `ElementBoxes`. Built once per model. */
export function elementRows(elements: ElementBoxes): Map<string, number> {
  const rows = new Map<string, number>();
  for (let row = 0; row < elements.guids.length; row += 1) rows.set(elements.guids[row], row);
  return rows;
}

/**
 * The world box of `guids` (or of every element, when null) with the model's
 * framing outliers left out.
 *
 * It inherits the verdict `framingBox` already reached rather than applying a
 * second, subtly different robustness rule: percentiles over a three-element
 * selection would mean nothing, and the question "is this element broken" is a
 * property of the MODEL, not of whatever happens to be filtered.
 *
 * When every candidate is an outlier the outliers are used. Then the user has
 * deliberately picked a broken element and orbiting it is what they asked for —
 * the same fallback `framingBox` takes when it finds no bulk at all.
 *
 * `null` when nothing in the request has geometry. The caller HOLDS its
 * previous pivot on that: a filter matching nothing must not drop the orbit
 * centre on the origin, and must never produce a NaN.
 */
export function robustBounds(
  elements: ElementBoxes,
  rows: Map<string, number>,
  guids: string[] | null,
): Bounds | null {
  const b = elements.bounds;
  const bulkMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const bulkMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const anyMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const anyMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let bulkSeen = false;
  let anySeen = false;

  const consume = (row: number) => {
    const at = row * 6;
    const bulk = elements.outlier[row] === 0;
    for (let a = 0; a < 3; a += 1) {
      const lo = b[at + a];
      const hi = b[at + 3 + a];
      if (lo < anyMin[a]) anyMin[a] = lo;
      if (hi > anyMax[a]) anyMax[a] = hi;
      if (!bulk) continue;
      if (lo < bulkMin[a]) bulkMin[a] = lo;
      if (hi > bulkMax[a]) bulkMax[a] = hi;
    }
    anySeen = true;
    if (bulk) bulkSeen = true;
  };

  if (guids === null) {
    for (let row = 0; row < elements.guids.length; row += 1) consume(row);
  } else {
    for (const guid of guids) {
      const row = rows.get(guid);
      if (row !== undefined) consume(row);
    }
  }

  if (bulkSeen) return { min: bulkMin, max: bulkMax };
  if (anySeen) return { min: anyMin, max: anyMax };
  return null;
}

/**
 * The box the ORBIT PIVOT is taken from, by precedence:
 *
 *   1  the selection, if there is one
 *   2  otherwise the matched set — what the cross-filter left on screen
 *   3  otherwise the model's robust framing box
 *
 * `highlight` mode still draws the unmatched elements, ghosted, so "the visible
 * set" is genuinely ambiguous there. The MATCHED set is taken in both modes:
 * the ghost is context, not subject, and a user who filtered to six columns is
 * looking at six columns whether the rest is removed or dimmed. Taking the
 * drawn set in `highlight` would also make the mode toggle move the orbit
 * centre, which reads as the toggle having a camera side effect. That is why
 * this function does not take a mode at all.
 *
 * Pure, and exported, so the headless gate asserts against the code the viewer
 * runs rather than against a second copy of it — the same reason
 * `partitionFaces` lives out here.
 */
export function pivotBounds(
  framing: FramingBox,
  rows: Map<string, number>,
  selection: string[],
  matched: Set<string> | null,
): Bounds | null {
  if (selection.length > 0) {
    const chosen = robustBounds(framing.elements, rows, selection);
    if (chosen) return chosen;
  }
  if (matched !== null) return robustBounds(framing.elements, rows, [...matched]);
  return { min: framing.min, max: framing.max };
}

/** Build the index and the per-face id arrays. One pass over the meta rows;
 *  the typed arrays themselves are never copied. */
export function buildMeshSet(
  batches: MeshBatch[],
  shift: [number, number, number],
  budget: MeshBudget,
): MeshSet {
  const index = new Map<string, MeshRange>();
  const slotGuid: string[] = [];
  const faceSlots: Int32Array[] = [];

  for (const batch of batches) {
    const slots = new Int32Array(batch.indices.length / 3).fill(-1);
    for (const row of batch.meta) {
      const slot = slotGuid.length;
      slotGuid.push(row.guid);
      index.set(row.guid, {
        batch: batch.batch,
        v0: row.v0,
        vn: row.vn,
        i0: row.i0,
        iCount: row.in,
        entity: row.entity,
        storeyGuid: row.storey_guid,
        slot,
        rgba: row.rgba,
      });
      const first = row.i0 / 3;
      const last = (row.i0 + row.in) / 3;
      for (let face = first; face < last; face += 1) slots[face] = slot;
    }
    faceSlots.push(slots);
  }

  return { batches, shift, index, faceSlots, slotGuid, budget };
}
