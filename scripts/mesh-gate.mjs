/** Headless proof that the mesh pipeline and the camera fit are real.
 *
 * It streams a real IFC through `streamMeshes` exactly as
 * `src/ui/model-worker.ts` does, then drives the SHIPPED modules — no second
 * copy of any algorithm lives here:
 *
 *   `buildMeshSet`   the guid -> {batch, v0, vn, i0, in} index and the
 *                    per-face element-id arrays
 *   `partitionFaces` the [matched | unmatched] re-order the cross-filter runs
 *   `fitRadius` /
 *   `measureFill`    the fit solver and its measurement
 *
 * Asserted:
 *   1  every mesh range is in bounds of its batch
 *   2  `in / 3` reconciles with the meta `tri` field, per element
 *   3  every face carries an element id
 *   4  a face id resolves back to its own guid, at the first AND last face of
 *      every element's range
 *   5  the same holds AFTER a filter re-orders the index buffer, which is what
 *      makes `faceIndex` trustworthy once anything is filtered
 *   6  the fit CONTAINS the model in the usable viewport after chrome insets,
 *      at 85-92 % of the binding axis
 *
 * Run:  node scripts/mesh-gate.mjs <model.ifc> [productsPerBatch]
 * Exit: 0 all assertions hold, 1 an assertion failed, 2 usage/internal.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { initSync, IfcModel } from "../vendor/ifcfast-wasm/ifcfast_wasm.js";
import { buildMeshSet, framingBox, partitionFaces } from "../src/viewer/mesh-stream.ts";
import { fitRadius, measureFill } from "../src/viewer/camera.ts";

const path = process.argv[2];
const perBatch = Number(process.argv[3] ?? 250);
if (!path) {
  console.error("usage: node scripts/mesh-gate.mjs <model.ifc> [productsPerBatch]");
  process.exit(2);
}

initSync({
  module: readFileSync(new URL("../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm", import.meta.url)),
});

const bytes = readFileSync(path);
const t0 = performance.now();
const model = IfcModel.fromBytes(new Uint8Array(bytes), basename(path));
const parseMs = performance.now() - t0;
const summary = JSON.parse(model.summaryJson());

const batches = [];
let batchNumber = 0;
let lastProgress = null;

const t1 = performance.now();
model.streamMeshes(perBatch, (metaJson, positions, indices, progressJson) => {
  batches.push({
    batch: batchNumber++,
    meta: JSON.parse(metaJson),
    positions,
    indices,
  });
  lastProgress = JSON.parse(progressJson);
});
const meshMs = performance.now() - t1;

const shift = JSON.parse(model.streamShiftJson());
const stats = JSON.parse(model.statsJson());
model.free();

const totalTriangles = batches.reduce((sum, b) => sum + b.indices.length / 3, 0);
const totalElements = batches.reduce((sum, b) => sum + b.meta.length, 0);
const set = buildMeshSet(batches, shift, {
  elements: totalElements,
  totalElements,
  triangles: totalTriangles,
  totalTriangles,
  capped: false,
  ceiling: 4_000_000,
});

/* ------------------------------------------------------------- assertions */

const failures = [];
let outOfBounds = 0;
let triMismatch = 0;
let resolveChecked = 0;
let resolveBad = 0;
let vertices = 0;

for (const [guid, range] of set.index) {
  const batch = set.batches[range.batch];
  vertices += range.vn;
  if (range.i0 < 0 || range.i0 + range.iCount > batch.indices.length) outOfBounds += 1;
  if (range.v0 < 0 || (range.v0 + range.vn) * 3 > batch.positions.length) outOfBounds += 1;

  const meta = batch.meta.find((m) => m.guid === guid);
  if (!meta || range.iCount / 3 !== meta.tri) triMismatch += 1;

  if (range.iCount > 0) {
    const slots = set.faceSlots[range.batch];
    const first = range.i0 / 3;
    const last = (range.i0 + range.iCount) / 3 - 1;
    resolveChecked += 2;
    if (set.slotGuid[slots[first]] !== guid) resolveBad += 1;
    if (set.slotGuid[slots[last]] !== guid) resolveBad += 1;
  }
}

let unassigned = 0;
for (const slots of set.faceSlots) for (const slot of slots) if (slot < 0) unassigned += 1;

/* 5 — the same resolution after a filter re-orders the buffers. The filter
   used is a real one the UI can produce: "every IfcColumn". */
const filterEntity = [...set.index.values()].map((r) => r.entity).sort()[0];
const matched = new Set(
  [...set.index.entries()].filter(([, r]) => r.entity === filterEntity).map(([g]) => g),
);
let reorderChecked = 0;
let reorderBad = 0;
let matchedFacesTotal = 0;
for (const batch of set.batches) {
  const source = batch.indices;
  const sourceSlots = set.faceSlots[batch.batch];
  const working = new Uint32Array(source.length);
  const workingSlots = new Int32Array(sourceSlots.length);
  const head = partitionFaces(source, sourceSlots, set.slotGuid, matched, working, workingSlots);
  matchedFacesTotal += head;
  // Every face now in the matched half must belong to a matched element, and
  // every face past the split must not. That is exactly what the `filter` mode
  // promises when it draws only the first group.
  for (let face = 0; face < workingSlots.length; face += 1) {
    const guid = set.slotGuid[workingSlots[face]];
    const shouldMatch = face < head;
    reorderChecked += 1;
    if (matched.has(guid) !== shouldMatch) reorderBad += 1;
  }
}

/* 6 — the fit, against the SAME robust framing box the viewer frames on entry.
   `framingBox` already works in the world frame the camera uses (IFC Z-up
   mapped through the root's -PI/2 about X). The true box is reported beside it
   so the two are comparable: on a model with one broken element they differ by
   orders of magnitude, and that difference is the reason the robust box
   exists. */
const trueMin = new Vector3(Infinity, Infinity, Infinity);
const trueMax = new Vector3(-Infinity, -Infinity, -Infinity);
const point = new Vector3();
for (const batch of set.batches) {
  const p = batch.positions;
  for (let v = 0; v < p.length / 3; v += 1) {
    point.set(p[v * 3], p[v * 3 + 2], -p[v * 3 + 1]);
    trueMin.min(point);
    trueMax.max(point);
  }
}
const framing = framingBox(set);
if (!framing) {
  console.error("framingBox returned null on a model with geometry");
  process.exit(2);
}
const min = new Vector3(...framing.min);
const max = new Vector3(...framing.max);
const centre = new Vector3().addVectors(min, max).multiplyScalar(0.5);
const viewport = { width: 640, height: 560 };
const insets = { top: 26, right: 10, bottom: 10, left: 10 };
const camera = new PerspectiveCamera(45, viewport.width / viewport.height, 0.1, 1000);
const radius = fitRadius(camera, min, max, centre, viewport, insets);
const fill = measureFill(camera, min, max, centre, radius, viewport);
// The insets shrink the usable box; the fit targets that fraction of the FULL
// axis, so the numbers to judge against are the inset-adjusted ones.
const allowedX = (viewport.width - insets.left - insets.right) / viewport.width;
const allowedY = (viewport.height - insets.top - insets.bottom) / viewport.height;
const usableFillX = fill.x / allowedX;
const usableFillY = fill.y / allowedY;
const binding = Math.max(usableFillX, usableFillY);

if (outOfBounds > 0) failures.push(`${outOfBounds} mesh range(s) out of bounds of their batch`);
if (triMismatch > 0) failures.push(`${triMismatch} element(s) where in/3 !== tri`);
if (unassigned > 0) failures.push(`${unassigned} face(s) with no element id`);
if (resolveBad > 0) failures.push(`${resolveBad} of ${resolveChecked} face->guid resolutions wrong`);
if (reorderBad > 0) {
  failures.push(`${reorderBad} of ${reorderChecked} faces on the wrong side of the filter split`);
}
if (set.index.size === 0) failures.push("streamMeshes produced no mesh records");
if (fill.x > allowedX + 1e-6 || fill.y > allowedY + 1e-6) {
  failures.push(`fit does not contain: ${fill.x.toFixed(4)}/${fill.y.toFixed(4)} vs allowed ${allowedX.toFixed(4)}/${allowedY.toFixed(4)}`);
}
if (binding < 0.85 || binding > 0.92) {
  failures.push(`fit fills ${(binding * 100).toFixed(2)} % of the binding usable axis, outside 85-92 %`);
}

const sample = [...set.index.entries()].slice(0, 3);
console.log(
  JSON.stringify(
    {
      file: basename(path),
      sizeBytes: bytes.length,
      schema: summary.schema,
      products: summary.products,
      parseMs: Math.round(parseMs),
      meshMs: Math.round(meshMs),
      productsPerBatch: perBatch,
      batches: set.batches.length,
      elements: set.index.size,
      vertices,
      faces: totalTriangles,
      positionsFloats: set.batches.reduce((s, b) => s + b.positions.length, 0),
      indicesUint32: set.batches.reduce((s, b) => s + b.indices.length, 0),
      shift,
      progressTail: lastProgress,
      engineStats: stats,
      filterProbe: {
        entity: filterEntity,
        elements: matched.size,
        facesKept: matchedFacesTotal,
        facesTotal: totalTriangles,
      },
      fit: {
        viewport,
        insets,
        radius: Number(radius.toFixed(4)),
        framedExtentMetres: Number(new Vector3().subVectors(max, min).length().toFixed(3)),
        trueExtentMetres: Number(new Vector3().subVectors(trueMax, trueMin).length().toFixed(3)),
        framingExcluded: framing.excluded,
        framingTotal: framing.total,
        rawFill: { x: Number(fill.x.toFixed(4)), y: Number(fill.y.toFixed(4)) },
        usableFill: { x: Number(usableFillX.toFixed(4)), y: Number(usableFillY.toFixed(4)) },
        bindingPercent: Number((binding * 100).toFixed(2)),
      },
      assertions: {
        rangesInBounds: outOfBounds === 0,
        triReconciles: triMismatch === 0,
        everyFaceAssigned: unassigned === 0,
        faceIdResolves: `${resolveChecked - resolveBad}/${resolveChecked}`,
        faceIdResolvesAfterFilter: `${reorderChecked - reorderBad}/${reorderChecked}`,
        fitContains: fill.x <= allowedX + 1e-6 && fill.y <= allowedY + 1e-6,
        fitInWindow: binding >= 0.85 && binding <= 0.92,
      },
      sample: sample.map(([guid, r]) => ({
        guid,
        entity: r.entity,
        batch: r.batch,
        v0: r.v0,
        vn: r.vn,
        i0: r.i0,
        in: r.iCount,
        slot: r.slot,
        rgba: r.rgba,
        storey_guid: r.storeyGuid,
      })),
      failures,
    },
    null,
    2,
  ),
);

process.exit(failures.length === 0 ? 0 : 1);
