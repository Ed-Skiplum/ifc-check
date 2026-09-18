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
 * The rule is per element: the centre must be within `SPREAD` times the 98th
 * percentile of centre distances, and the element's own half-diagonal must not
 * exceed that same cutoff. The first catches a stray placement, the second
 * catches geometry that exploded in place.
 */
const FRAMING_SPREAD = 5;
const FRAMING_FLOOR_METRES = 1;

export function framingBox(set: MeshSet): FramingBox | null {
  const centres: [number, number, number][] = [];
  const halves: number[] = [];
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];

  for (const range of set.index.values()) {
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
    boxes.push({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    centres.push([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]);
    halves.push(Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  }
  if (boxes.length === 0) return null;

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const hub: [number, number, number] = [
    median(centres.map((c) => c[0])),
    median(centres.map((c) => c[1])),
    median(centres.map((c) => c[2])),
  ];
  const spread = centres.map((c) =>
    Math.max(Math.abs(c[0] - hub[0]), Math.abs(c[1] - hub[1]), Math.abs(c[2] - hub[2])),
  );
  const sorted = [...spread].sort((a, b) => a - b);
  const p98 = sorted[Math.floor(0.98 * (sorted.length - 1))];
  const cutoff = Math.max(p98 * FRAMING_SPREAD, FRAMING_FLOOR_METRES);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let kept = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    if (spread[i] > cutoff || halves[i] > cutoff) continue;
    kept += 1;
    for (let a = 0; a < 3; a += 1) {
      if (boxes[i].min[a] < min[a]) min[a] = boxes[i].min[a];
      if (boxes[i].max[a] > max[a]) max[a] = boxes[i].max[a];
    }
  }
  // Everything is an outlier only if the model has no bulk at all; then the
  // true box IS the answer and there is nothing to report.
  if (kept === 0) {
    for (const box of boxes) {
      for (let a = 0; a < 3; a += 1) {
        if (box.min[a] < min[a]) min[a] = box.min[a];
        if (box.max[a] > max[a]) max[a] = box.max[a];
      }
    }
    return { min, max, excluded: 0, total: boxes.length };
  }
  return { min, max, excluded: boxes.length - kept, total: boxes.length };
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
