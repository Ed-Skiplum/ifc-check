/** Headless proof that the ORBIT PIVOT arithmetic is real.
 *
 * The complaint it answers: the camera used to orbit a target set once, at fit
 * time, from the model's framing box. Filter to a handful of elements or select
 * one, drag, and the whole building still swings about a centre somewhere
 * behind them.
 *
 * Like `mesh-gate.mjs` this drives the SHIPPED modules — no second copy of any
 * algorithm lives here:
 *
 *   `buildMeshSet` / `framingBox`   the index and the robust entry box, which
 *                                   now also carries per-element boxes and the
 *                                   outlier verdict
 *   `elementRows` / `pivotBounds`   the pivot precedence and the outlier rule
 *   `Turntable.setPivot`            the camera-preserving re-target
 *
 * Asserted:
 *   1  no filter, no selection  -> the pivot is the framing box centre
 *   2  a filter                 -> the pivot is the matched box centre, and it
 *                                  is NOT the framing centre
 *   3  one selected element     -> the pivot is that element's centre
 *   4  selection beats filter   -> a selection inside a filter wins
 *   5  an outlier inside the visible set does not move the pivot
 *   6  a selection OF an outlier is not suppressed: its BOX reaches the broken
 *      element, and the pivot is stored as that centre (no camera move means
 *      no radius stop to clamp it against)
 *   7  a filter matching nothing returns no bounds, so the caller holds
 *   8  re-targeting does not move the camera: the eye position AND the view
 *      direction are stable across every re-target above (the eye alone is
 *      not enough: holding the eye while re-aiming at the pivot is the
 *      "click shifts the camera" bug), and the polar limits still hold
 *   9  the next orbit turns about the pivot: its screen position is unchanged
 *      by a drag, and the polar limits still hold
 *
 * Run:  node scripts/pivot-gate.mjs <model.ifc> [productsPerBatch]
 * Exit: 0 all assertions hold, 1 an assertion failed, 2 usage/internal.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { initSync, IfcModel } from "../vendor/ifcfast-wasm/ifcfast_wasm.js";
import {
  buildMeshSet,
  elementRows,
  framingBox,
  pivotBounds,
} from "../src/viewer/mesh-stream.ts";
import { POLAR_FLOOR, Turntable, fitRadius } from "../src/viewer/camera.ts";

const path = process.argv[2];
const perBatch = Number(process.argv[3] ?? 250);
if (!path) {
  console.error("usage: node scripts/pivot-gate.mjs <model.ifc> [productsPerBatch]");
  process.exit(2);
}

initSync({
  module: readFileSync(new URL("../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm", import.meta.url)),
});

const bytes = readFileSync(path);
const model = IfcModel.fromBytes(new Uint8Array(bytes), basename(path));
const batches = [];
let batchNumber = 0;
model.streamMeshes(perBatch, (metaJson, positions, indices) => {
  batches.push({ batch: batchNumber++, meta: JSON.parse(metaJson), positions, indices });
});
const shift = JSON.parse(model.streamShiftJson());
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

const framing = framingBox(set);
if (!framing) {
  console.error("framingBox returned null on a model with geometry");
  process.exit(2);
}
const rows = elementRows(framing.elements);

/* ----------------------------------------------------------- the subjects */

const round = (n) => Number(n.toFixed(4));
const centreOf = (box) => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];
const spanOf = (box) => [
  box.max[0] - box.min[0],
  box.max[1] - box.min[1],
  box.max[2] - box.min[2],
];
const show = (box) =>
  box === null
    ? null
    : {
        min: box.min.map(round),
        max: box.max.map(round),
        spanMetres: spanOf(box).map(round),
        pivot: centreOf(box).map(round),
      };

/* The outliers, by the framing pass's own verdict — on KNM_RIB.ifc the five
   IfcBeam at +-31,847,402 m. Named here so the robustness assertions are
   against the real broken elements, not a synthetic one. */
const outlierGuids = framing.elements.guids.filter((_, row) => framing.elements.outlier[row] === 1);

/* A filter the UI can really produce: every IfcColumn. */
const columnGuids = [...set.index.entries()]
  .filter(([, r]) => r.entity === "IfcColumn")
  .map(([g]) => g);
const columns = new Set(columnGuids);

/* One known element: the first column, by guid order, so the number below is
   reproducible rather than whatever the stream happened to hand over first. */
const oneGuid = [...columnGuids].sort()[0];

const cases = [
  { name: "a. no filter, no selection", selection: [], matched: null },
  { name: "b. filter IfcColumn", selection: [], matched: columns },
  { name: "c. selection of one IfcColumn", selection: [oneGuid], matched: null },
  { name: "d. selection inside the filter", selection: [oneGuid], matched: columns },
  {
    name: "e. filter IfcColumn + one outlier beam",
    selection: [],
    matched: new Set([...columnGuids, ...outlierGuids.slice(0, 1)]),
  },
  { name: "f. selection OF an outlier beam", selection: outlierGuids.slice(0, 1), matched: null },
  { name: "g. filter matching nothing", selection: [], matched: new Set() },
];

/* ------------------------------------------ the camera invariance harness */

const viewport = { width: 640, height: 560 };
const insets = { top: 26, right: 10, bottom: 10, left: 10 };
const camera = new PerspectiveCamera(45, viewport.width / viewport.height, 0.1, 1000);

/* The entry pose, exactly as `ModelScene.load` produces it: extent limits from
   the framing box, then a fit to it. */
const framingMin = new Vector3(...framing.min);
const framingMax = new Vector3(...framing.max);
const framingCentre = new Vector3().addVectors(framingMin, framingMax).multiplyScalar(0.5);
const turntable = new Turntable();
turntable.setExtent(new Vector3().subVectors(framingMax, framingMin).length());
turntable.target.copy(framingCentre);
turntable.radius = fitRadius(camera, framingMin, framingMax, framingCentre, viewport, insets);
turntable.apply(camera);

const entryEye = camera.position.clone();
const results = [];
const failures = [];
let worstEyeDrift = 0;
let worstViewTurn = 0;

for (const probe of cases) {
  const box = pivotBounds(framing, rows, probe.selection, probe.matched);
  // Every case re-targets from the SAME entry pose, so each printed drift is
  // that re-target's own and not an accumulation of the ones before it.
  turntable.target.copy(framingCentre);
  turntable.radius = fitRadius(camera, framingMin, framingMax, framingCentre, viewport, insets);
  turntable.phi = 1.05;
  turntable.theta = Math.PI * 0.25;
  turntable.clearPivot();
  turntable.apply(camera);
  const before = camera.position.clone();
  const lookBefore = camera.getWorldDirection(new Vector3());

  let accepted = false;
  if (box) accepted = turntable.setPivot(new Vector3(...centreOf(box)));
  turntable.apply(camera);
  const after = camera.position.clone();
  const drift = before.distanceTo(after);
  worstEyeDrift = Math.max(worstEyeDrift, drift);
  const turn = lookBefore.angleTo(camera.getWorldDirection(new Vector3()));
  worstViewTurn = Math.max(worstViewTurn, turn);

  // The next drag: the pivot must hold its place on screen.
  let pivotScreenDrift = null;
  if (accepted && turntable.pivot) {
    const pivotNdc = turntable.pivot.clone().project(camera);
    if (Math.abs(pivotNdc.z) < 1) {
      turntable.orbit(37, -21, viewport);
      turntable.apply(camera);
      const moved = turntable.pivot.clone().project(camera);
      pivotScreenDrift = Math.hypot(moved.x - pivotNdc.x, moved.y - pivotNdc.y);
      if (pivotScreenDrift > 1e-6) {
        failures.push(`${probe.name}: orbit moved the pivot on screen by ${pivotScreenDrift} ndc`);
      }
    }
  }

  results.push({
    case: probe.name,
    selection: probe.selection.length,
    matched: probe.matched === null ? null : probe.matched.size,
    box: show(box),
    retargetAccepted: accepted,
    pivotApplied: turntable.pivot
      ? [round(turntable.pivot.x), round(turntable.pivot.y), round(turntable.pivot.z)]
      : null,
    // True when the stored pivot is not the requested box centre. Expected
    // false everywhere now that setPivot stores the point literally.
    pivotClamped: box && turntable.pivot
      ? centreOf(box).some((v, i) => Math.abs(v - turntable.pivot.getComponent(i)) > 1e-3)
      : false,
    eyeBefore: [round(before.x), round(before.y), round(before.z)],
    eyeAfter: [round(after.x), round(after.y), round(after.z)],
    eyeDriftMetres: Number(drift.toExponential(3)),
    viewTurnRadians: Number(turn.toExponential(3)),
    pivotScreenDriftAfterOrbit: pivotScreenDrift === null ? null : Number(pivotScreenDrift.toExponential(3)),
    phi: Number(turntable.phi.toFixed(6)),
    radiusMetres: round(turntable.radius),
  });

  if (drift > 1e-6) failures.push(`${probe.name}: re-target moved the eye by ${drift} m`);
  if (turn > 1e-9) failures.push(`${probe.name}: re-target turned the view by ${turn} rad`);
  if (turntable.phi < POLAR_FLOOR - 1e-9 || turntable.phi > Math.PI - POLAR_FLOOR + 1e-9) {
    failures.push(`${probe.name}: phi ${turntable.phi} outside the polar limits`);
  }
  if (box && !Number.isFinite((turntable.pivot ?? turntable.target).lengthSq())) {
    failures.push(`${probe.name}: pivot is not finite`);
  }
}

/* --------------------------------------------------------- the assertions */

const byName = Object.fromEntries(results.map((r) => [r.case[0], r]));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const samePoint = (a, b, tol) => a.every((v, i) => near(v, b[i], tol));

const framingPivot = centreOf({ min: framing.min, max: framing.max });
const columnPivot = byName.b.box.pivot;
const onePivot = byName.c.box.pivot;

if (!samePoint(byName.a.box.pivot, framingPivot.map(round), 1e-3)) {
  failures.push("1: unfiltered pivot is not the framing box centre");
}
if (samePoint(columnPivot, byName.a.box.pivot, 1e-3)) {
  failures.push("2: the filtered pivot equals the unfiltered one — the filter did not move it");
}
{
  // The selected element's own box, straight out of the framing pass.
  const row = rows.get(oneGuid);
  const b = framing.elements.bounds;
  const own = {
    min: [b[row * 6], b[row * 6 + 1], b[row * 6 + 2]],
    max: [b[row * 6 + 3], b[row * 6 + 4], b[row * 6 + 5]],
  };
  if (!samePoint(onePivot, centreOf(own).map(round), 1e-3)) {
    failures.push("3: the single-selection pivot is not that element's own centre");
  }
}
if (!samePoint(byName.d.box.pivot, onePivot, 1e-9)) {
  failures.push("4: a selection inside a filter did not win the precedence");
}
if (!samePoint(byName.e.box.pivot, columnPivot, 1e-9)) {
  failures.push("5: an outlier inside the visible set moved the pivot");
}
if (outlierGuids.length > 0) {
  // Not suppressing the broken element is deliberate: the framing box refuses
  // to FRAME it, the pivot refuses to be DRAGGED by it, and a user who selects
  // it outright is not told it does not exist. What is asserted is the BOX.
  const away = Math.hypot(
    ...byName.f.box.pivot.map((v, i) => v - framingPivot[i]),
  );
  const bulk = Math.max(...spanOf({ min: framing.min, max: framing.max }));
  if (!(away > bulk * 100)) {
    failures.push(`6: a selection OF an outlier did not reach it (${away.toFixed(1)} m from the bulk centre)`);
  }
}
if (byName.g.box !== null) {
  failures.push("7: a filter matching nothing produced bounds instead of null");
}
if (byName.g.retargetAccepted) failures.push("7: an empty filter re-targeted the pivot");

console.log(
  JSON.stringify(
    {
      file: basename(path),
      elements: set.index.size,
      faces: totalTriangles,
      viewport,
      insets,
      entryEye: [round(entryEye.x), round(entryEye.y), round(entryEye.z)],
      framing: {
        min: framing.min.map(round),
        max: framing.max.map(round),
        pivot: framingPivot.map(round),
        excluded: framing.excluded,
        total: framing.total,
        outlierGuids,
      },
      filter: { entity: "IfcColumn", elements: columns.size, of: set.index.size },
      selectedGuid: oneGuid,
      cases: results,
      assertions: {
        unfilteredPivotIsFramingCentre: !failures.some((f) => f.startsWith("1")),
        filterMovesPivot: !failures.some((f) => f.startsWith("2")),
        selectionPivotIsElementCentre: !failures.some((f) => f.startsWith("3")),
        selectionBeatsFilter: !failures.some((f) => f.startsWith("4")),
        outlierDoesNotWreckPivot: !failures.some((f) => f.startsWith("5")),
        outlierSelectionBoxReachesIt: !failures.some((f) => f.startsWith("6")),
        emptyFilterHoldsPivot: !failures.some((f) => f.startsWith("7")),
        cameraUnchangedAcrossRetarget: worstEyeDrift <= 1e-6 && worstViewTurn <= 1e-9,
        worstViewTurnRadians: Number(worstViewTurn.toExponential(3)),
        worstEyeDriftMetres: Number(worstEyeDrift.toExponential(3)),
      },
      failures,
    },
    null,
    2,
  ),
);

process.exit(failures.length === 0 ? 0 : 1);
