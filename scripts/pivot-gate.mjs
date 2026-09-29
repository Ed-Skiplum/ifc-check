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
 *  10  a wheel dolly anchored on the pivot keeps it fixed, in the world and on
 *      screen, while the radius closes (the viewer's wheel with a selection)
 *
 * Then, unless `--no-browser`, phase 2 (B1-B16, see `browserPhase` below): the
 * same rule through the real UI in headless Chrome against `dist/`: "we always
 * have to orbit selected objects" (edkjo, 2026-09-26) on every path that can
 * change the selection or move the camera under one.
 *
 * Run:  npm run build && node scripts/pivot-gate.mjs <model.ifc> [productsPerBatch]
 *       [--no-browser] [--url <deployed>] [--design a] [--viewport 2112x1267]
 *       Use a model phase 1 passes on: KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc.
 *       The Void-demo export fails assertion 6 (pre-existing, its stray
 *       element sits 476 m out, not the 100x bulk the assertion asks for).
 * Exit: 0 all assertions hold, 1 an assertion failed, 2 usage/internal.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PerspectiveCamera, Vector3 } from "three";
import { initSync, IfcModel } from "../vendor/ifcfast-wasm/ifcfast_wasm.js";
import {
  buildMeshSet,
  elementRows,
  framingBox,
  pivotBounds,
} from "../src/viewer/mesh-stream.ts";
import { FIT_FRACTION, POLAR_FLOOR, Turntable, fitRadius } from "../src/viewer/camera.ts";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--url", "--viewport", "--design"].includes(args[i - 1])));
const path = positional[0];
const perBatch = Number(positional[1] ?? 250);
if (!path) {
  console.error("usage: node scripts/pivot-gate.mjs <model.ifc> [productsPerBatch] [--no-browser] [--url U] [--design a]");
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

/* 10  a wheel dolly anchored on the pivot (what the viewer does while
   something is selected) leaves the pivot exactly where it was, in the world
   AND on screen, while the radius closes. */
{
  const box = pivotBounds(framing, rows, [oneGuid], null);
  turntable.target.copy(framingCentre);
  turntable.radius = fitRadius(camera, framingMin, framingMax, framingCentre, viewport, insets);
  turntable.phi = 1.05;
  turntable.theta = Math.PI * 0.25;
  turntable.setPivot(new Vector3(...centreOf(box)));
  turntable.apply(camera);
  const pivotBefore = turntable.pivot.clone();
  const ndcBefore = pivotBefore.clone().project(camera);
  const radiusBefore = turntable.radius;
  for (let tick = 0; tick < 6; tick += 1) turntable.zoom(-100, turntable.pivot);
  turntable.apply(camera);
  const ndcAfter = turntable.pivot.clone().project(camera);
  const drift = Math.hypot(ndcAfter.x - ndcBefore.x, ndcAfter.y - ndcBefore.y);
  if (turntable.pivot.distanceTo(pivotBefore) > 0) failures.push("10: the wheel moved the pivot");
  if (drift > 1e-6) failures.push(`10: a dolly toward the pivot moved it on screen by ${drift} ndc`);
  if (!(turntable.radius < radiusBefore)) failures.push("10: six ticks in did not close the radius");
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
        wheelTowardPivotHoldsIt: !failures.some((f) => f.startsWith("10")),
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

/* ====================================================================== */
/* Phase 2: the orbit goes around the SELECTION, on every path that can    */
/* change the selection or move the camera under one.                      */
/*                                                                        */
/* edkjo, 2026-09-26: "we always have to orbit selected objects." Phase 1  */
/* proves the arithmetic; this proves the WIRING, in headless Chrome with  */
/* real CDP mouse, key and wheel events against the production build, on  */
/* the design-alternative board (`#design=a`), whose Scope panel, treemaps */
/* and requirements are the paths a row, a cell and a requirement take.    */
/*                                                                        */
/* Per path, three claims, all read off the live scene (`ModelScene.probe`,*/
/* `ModelScene.project`), never off pixels:                                */
/*   F  the selection is FRAMED: its projected box sits inside the         */
/*      viewport within FIT_FRACTION and fills it, and the target is the   */
/*      pivot (edkjo 2026-09-28: "always frame the selected object. pivot  */
/*      on it and frame it.")                                              */
/*   P  the pivot IS the selection's centre (and `orbitsSelection` holds)  */
/*   O  a real left-drag orbit leaves the selection's centre where it was  */
/*      on screen (< 1e-3 NDC) while the eye moves                        */
/* plus: clearing (Escape, the last chip) does not                        */
/* move the eye, and a set with nothing selected frames the set.           */
/*                                                                        */
/*   B1 canvas pick           B2 wheel away from the selection            */
/*   B3 pan                   B4 treemap cell   B5 requirement            */
/*   B6 Scope row             B7 undo on a second click: Shift again      */
/*                               drops only that one, the lone row again  */
/*                               keeps it                                 */
/*   B8 chip removed (its x)  B9 Kontroll -> Graf, viewer windowed        */
/*   B10 graph pick, viewer windowed   B11 Graf with the viewer main      */
/*   B12 graph pick, viewer main       B13 Graf -> Kontroll               */
/*   B14 no selection: the wheel keeps the cursor rule                    */
/*   B15 treemap cell, nothing selected: the set is framed                */
/*   B16 Typer gallery card (viewer hidden): framed when it comes back    */
/* ====================================================================== */

async function browserPhase() {
  const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const OUT = resolve(ROOT, "tmp/pivot");
  const PORT = 4184;
  const CDP = 9338;
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const liveUrl = opt("url");
  const design = opt("design") ?? "a";
  const [vw, vh] = (opt("viewport") ?? "2112x1267").split("x").map(Number);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let fails = 0;
  const check = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) fails += 1;
  };

  const freeGb = () => {
    if (process.platform === "win32") {
      try {
        const out = execSync(
          'powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"',
          { encoding: "utf8" },
        );
        const gb = Number(out.trim().replace(",", "."));
        if (Number.isFinite(gb)) return gb;
      } catch {
        /* fall through */
      }
    }
    return freemem() / 1024 ** 3;
  };

  const started = [];
  const cleanup = () => {
    for (const child of started.splice(0)) {
      try {
        if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
        else child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  process.on("exit", cleanup);

  const waitHttp = async (url, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if ((await fetch(url)).ok) return;
      } catch {
        /* not up yet */
      }
      await sleep(300);
    }
    throw new Error(`not reachable: ${url}`);
  };

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let base = liveUrl;
  if (!base) {
    if (!existsSync(resolve(ROOT, "dist/index.html"))) {
      console.error("no dist/ — run `npm run build` first, or pass --no-browser");
      return 1;
    }
    const child = spawn(
      process.execPath,
      [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"],
      { cwd: ROOT, stdio: "ignore" },
    );
    started.push(child);
    await waitHttp(`http://localhost:${PORT}/`, 20000);
    base = `http://localhost:${PORT}/`;
  }
  const free = freeGb();
  if (free < 3) {
    console.error(`only ${free} GB free physical memory; the browser phase launches Chrome at >= 3 GB`);
    cleanup();
    return 1;
  }
  const profile = resolve(OUT, "_profile");
  mkdirSync(profile, { recursive: true });
  started.push(
    spawn(
      CHROME,
      [
        "--headless=new",
        `--remote-debugging-port=${CDP}`,
        `--user-data-dir=${profile}`,
        "--enable-unsafe-swiftshader",
        "--no-first-run",
        "--no-default-browser-check",
        `--window-size=${vw},${vh}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    ),
  );
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000);

  /* ---- CDP ---- */
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const until = async (expr, ms, label) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expr)) return;
      await sleep(400);
    }
    throw new Error(`timeout: ${label}`);
  };
  const mouse = (type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, clickCount: 1, ...extra });
  const park = async () => {
    await mouse("mouseMoved", 3, 3, { buttons: 0 });
    await sleep(250);
  };
  const clickAt = async (x, y, modifiers = 0) => {
    await mouse("mousePressed", x, y, { button: "left", buttons: 1, modifiers });
    await mouse("mouseReleased", x, y, { button: "left", buttons: 0, modifiers });
    await park();
    await sleep(350);
  };
  const dragOn = async (x, y, dx, dy, button = "left") => {
    const buttons = button === "left" ? 1 : 2;
    await mouse("mousePressed", x, y, { button, buttons });
    for (let i = 1; i <= 8; i += 1) {
      await mouse("mouseMoved", x + (dx * i) / 8, y + (dy * i) / 8, { button, buttons });
      await sleep(16);
    }
    await mouse("mouseReleased", x + dx, y + dy, { button, buttons: 0 });
    await sleep(200);
  };
  const wheelAt = async (x, y, deltaY) => {
    await mouse("mouseMoved", x, y, { buttons: 0 });
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, pointerType: "mouse" });
    await sleep(90);
  };
  const centre = async (expr) => {
    const box = await evaluate(
      `(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`,
    );
    if (!box) throw new Error(`no clickable box for ${expr}`);
    return box;
  };

  /* The scene whose canvas is on screen, wherever it has been lent to. */
  const SCENE = `((window.__ifcCheckScenes ?? []).find((s) => { const r = s.canvas.getBoundingClientRect(); return s.canvas.isConnected && r.width > 1 && r.height > 1; }) ?? null)`;
  const pose = (guids) => evaluate(`(() => { const s = ${SCENE}; return s ? s.probe(${JSON.stringify(guids)}) : null; })()`);
  const project = (points) =>
    evaluate(`(() => { const s = ${SCENE}; return s ? s.project(${JSON.stringify(points)}) : null; })()`);
  const canvasRect = () =>
    evaluate(`(() => { const s = ${SCENE}; if (!s) return null; const r = s.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const eyeMoved = (a, b) =>
    Math.hypot(b.eye[0] - a.eye[0], b.eye[1] - a.eye[1], b.eye[2] - a.eye[2]) / Math.max(1e-6, a.radius);
  const mid = (w) => [0, 1, 2].map((i) => (w.min[i] + w.max[i]) / 2);
  const diag = (w) => Math.hypot(...[0, 1, 2].map((i) => w.max[i] - w.min[i]));
  const sameSet = (a, b) => a.length === b.length && a.every((g) => b.includes(g));
  const record = [];

  /** P and O for the current selection. */
  async function orbitHolds(label, guids) {
    const p = await pose(guids);
    if (!p || !p.world || guids.length === 0) {
      check(false, `${label}: a selection with geometry in the scene (${JSON.stringify(guids)})`);
      return;
    }
    const want = mid(p.world);
    const off = p.pivot ? Math.hypot(...want.map((v, i) => v - p.pivot[i])) : Infinity;
    const tol = Math.max(1e-4, diag(p.world) * 1e-3);
    check(sameSet(p.selection, guids), `${label}: the selection is ${guids.length} element(s) (${p.selection.length})`);
    check(
      p.orbitsSelection && off <= tol,
      `${label}: P the pivot is the selection's centre (${off.toExponential(2)} m off, orbitsSelection ${p.orbitsSelection})`,
    );
    const rect = await canvasRect();
    const [before] = await project([want]);
    await dragOn(rect.x + rect.w * 0.5, rect.y + rect.h * 0.55, 90, -35);
    const [after] = await project([want]);
    const q = await pose(guids);
    const drift = Math.hypot(after.x - before.x, after.y - before.y);
    check(
      eyeMoved(p, q) > 1e-3 && drift < 1e-3,
      `${label}: O a real orbit drag turns about it (eye moved ${eyeMoved(p, q).toFixed(3)} of the radius, the selection moved ${drift.toExponential(2)} NDC on screen)`,
    );
    check(sameSet(q.selection, guids), `${label}: the drag selected nothing`);
    record.push({ path: label, pivotOffMetres: off, orbitsSelection: p.orbitsSelection, screenDriftNdc: drift, eyeMoved: eyeMoved(p, q) });
  }

  /** F: the selection is FRAMED. Read before any drag: its projected box sits
   *  inside the viewport with the framing margin (every NDC component within
   *  FIT_FRACTION), it fills the frame rather than sitting in it from a mile
   *  away, and the look-at target is the pivot, which is what `frameBox`
   *  leaves behind and nothing else does. */
  const onPivot = (p) =>
    p.pivot !== null && Math.hypot(...p.pivot.map((v, i) => v - p.target[i])) <= Math.max(1e-4, p.radius * 1e-6);
  async function framedOn(label, guids) {
    const p = await pose(guids);
    if (!p?.box) {
      check(false, `${label}: F the selection has a box in the scene`);
      return;
    }
    const reach = Math.max(Math.abs(p.box.x0), Math.abs(p.box.x1), Math.abs(p.box.y0), Math.abs(p.box.y1));
    check(
      reach <= FIT_FRACTION + 0.01 && reach >= 0.5 && onPivot(p),
      `${label}: F the selection is framed (reaches ${reach.toFixed(3)} NDC of <= ${FIT_FRACTION}, target on the pivot ${onPivot(p)})`,
    );
    record.push({ path: label, framedReachNdc: reach });
  }
  /** F for a SET with nothing selected: the eye moved, and the frame is on the
   *  pivot, which is the set's robust centre (phase 1, assertion 2 and 5). */
  async function framedSet(label, before) {
    const p = await pose([]);
    check(
      p.selection.length === 0 && !p.orbitsSelection && eyeMoved(before, p) > 1e-3 && onPivot(p),
      `${label}: F the set is framed about its own centre (eye moved ${eyeMoved(before, p).toFixed(3)} of the radius, target on the pivot ${onPivot(p)})`,
    );
  }
  /** Clearing never moves the camera. */
  async function stillAfter(label, before) {
    const p = await pose([]);
    check(eyeMoved(before, p) < 1e-9, `${label}: the eye did not move`);
  }

  const STATE = `(() => {
    const bar = document.querySelector('main > section [data-filter-bar]');
    const chips = bar ? [...bar.querySelectorAll(':scope > span.border')].map((s) => s.textContent.replace(/✕$/, '').trim()) : [];
    const scope = document.querySelector('[data-mg-tile="scope"]');
    return { chips, scopeRows: scope ? scope.querySelectorAll('[data-guid]').length : -1 };
  })()`;

  /* ---- load ---- */
  await send("Page.navigate", { url: `${base}#lang=nb&design=${design}` });
  await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
  await sleep(1200);
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`,
  );
  await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type=file][accept=".ifc,.ifczip"]' });
  await send("DOM.setFileInputFiles", { nodeId, files: [resolve(path)] });
  await until(
    `(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && !!document.querySelector('[data-mg-grid] canvas'); })()`,
    300000,
    "model ready",
  );
  await until(`(() => { const s = ${SCENE}; return !!s && s.probe([]).radius > 0; })()`, 120000, "scene");
  await sleep(3000);
  await park();
  console.log(`\nbrowser phase: ${basename(path)} on ${base}#design=${design} at ${vw}x${vh}`);

  /* B1 canvas pick */
  let rect = await canvasRect();
  const e0 = await pose([]);
  let picked = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.6], [0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.35, 0.6], [0.65, 0.4]]) {
    await clickAt(rect.x + rect.w * fx, rect.y + rect.h * fy);
    picked = (await pose([])).selection;
    if (picked.length > 0) break;
  }
  const e1 = await pose([]);
  check(picked.length === 1, `B1 a canvas pick selects one element (${picked[0]})`);
  if (picked.length !== 1) {
    ws.close();
    cleanup();
    return fails;
  }
  check(eyeMoved(e0, e1) > 1e-3, `B1 the canvas pick moved the eye to frame it (${eyeMoved(e0, e1).toFixed(3)} of the radius)`);
  await framedOn("B1 canvas pick", picked);
  await orbitHolds("B1 canvas pick", picked);

  /* B2 wheel, at a point AWAY from the selection */
  {
    const p0 = await pose(picked);
    const at = mid(p0.world);
    rect = await canvasRect();
    const [s0] = await project([at]);
    const cursor = { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.25 };
    for (let i = 0; i < 4; i += 1) await wheelAt(cursor.x, cursor.y, -100);
    await park();
    const p1 = await pose(picked);
    const [s1] = await project([at]);
    const drift = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    check(p1.radius < p0.radius, `B2 four ticks in closed the radius (${p0.radius.toFixed(3)} -> ${p1.radius.toFixed(3)} m)`);
    check(drift < 1e-3, `B2 with a selection the dolly goes toward it: it holds its screen place (${drift.toExponential(2)} NDC)`);
    check(
      p1.pivot !== null && Math.hypot(...p1.pivot.map((v, i) => v - p0.pivot[i])) < 1e-9,
      `B2 the wheel did not pull the pivot off the selection`,
    );
    await orbitHolds("B2 after a wheel zoom", picked);
  }

  /* B3 pan (right-drag) */
  rect = await canvasRect();
  await dragOn(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, -70, 40, "right");
  await orbitHolds("B3 after a pan", picked);

  /* B4 treemap cell: a SET; the canvas selection stays, and it is what is framed */
  {
    const has = await evaluate(`!!document.querySelector('[data-mg-grid] [data-tree-cell]')`);
    if (!has) check(false, "B4 a treemap cell is on the board");
    else {
      const at = await centre(`document.querySelector('[data-mg-grid] [data-tree-cell]')`);
      await clickAt(at.x, at.y);
      const st = await evaluate(STATE);
      check(st.chips.length === 1, `B4 a treemap cell makes a chip (${JSON.stringify(st.chips)})`);
      await framedOn("B4 treemap cell", picked);
      await orbitHolds("B4 treemap cell", picked);
      await clickAt(at.x, at.y);
      await framedOn("B4 the cell again (chip gone)", picked);
    }
  }

  /* B5 requirement */
  let reqAt = null;
  {
    const reqs = await evaluate(`[...document.querySelectorAll('[data-mg-grid] button[data-req]')].map((b) => b.dataset.req)`);
    for (const key of reqs.filter((k) => k !== "ifc-schema")) {
      const at = await centre(`document.querySelector('[data-mg-grid] button[data-req="${key}"]')`);
      await clickAt(at.x, at.y);
      const st = await evaluate(STATE);
      if (st.chips.length === 1 && st.scopeRows > 1) {
        reqAt = { key, at };
        break;
      }
      await clickAt(at.x, at.y);
    }
    check(reqAt !== null, `B5 a requirement makes a chip and fills Scope (${reqAt?.key})`);
    if (reqAt) {
      await framedOn(`B5 requirement ${reqAt.key}`, picked);
      await orbitHolds(`B5 requirement ${reqAt.key}`, picked);
    }
  }

  /* B6 Scope row: ONE element frames, and the orbit is about it */
  let rowA = null;
  if (reqAt) {
    const rows = await evaluate(`[...document.querySelectorAll('[data-mg-tile="scope"] [data-guid]')].map((r) => r.getAttribute('data-guid'))`);
    // Rows with geometry in the scene, so there is something to orbit.
    const withMesh = [];
    for (const g of rows.slice(0, 40)) {
      const p = await pose([g]);
      if (p?.world) withMesh.push(g);
      if (withMesh.length === 2) break;
    }
    if (withMesh.length < 2) check(false, `B6 two Scope rows with geometry (${withMesh.length})`);
    else {
      rowA = withMesh[0];
      const rowB = withMesh[1];
      // Scrolled into the Scope list's view first: a row below its fold has a
      // box, and a click there lands on whatever covers it.
      const row = async (g) => {
        await evaluate(`document.querySelector('[data-mg-tile="scope"] [data-guid="${g}"]').scrollIntoView({ block: 'center' })`);
        await sleep(150);
        return centre(`document.querySelector('[data-mg-tile="scope"] [data-guid="${g}"]')`);
      };
      const a = await pose([]);
      let at = await row(rowA);
      await clickAt(at.x, at.y);
      const b = await pose([rowA]);
      check(eyeMoved(a, b) > 1e-3, `B6 a Scope row frames its element (eye moved ${eyeMoved(a, b).toFixed(3)} of the radius)`);
      await framedOn("B6 Scope row", [rowA]);
      await orbitHolds("B6 Scope row", [rowA]);

      /* B7 undo on a second click */
      at = await row(rowB);
      await clickAt(at.x, at.y, 8);
      await framedOn("B7 Shift adds a second Scope row", [rowA, rowB]);
      await orbitHolds("B7 Shift adds a second Scope row", [rowA, rowB]);
      at = await row(rowB);
      await clickAt(at.x, at.y, 8);
      await framedOn("B7 Shift on it again undoes it; what remains is framed", [rowA]);
      await orbitHolds("B7 Shift on it again undoes it; the orbit returns to the one left", [rowA]);
      // The lone row again KEEPS it (2026-09-29: a selection is not the
      // filter, and a double-click is two clicks that must not clear).
      at = await row(rowA);
      await clickAt(at.x, at.y);
      await framedOn("B7 the lone row again keeps it selected", [rowA]);
      await orbitHolds("B7 the lone row again keeps it selected", [rowA]);
    }
  }

  /* B8 a chip removed with its x (the requirement's, not the element's) */
  if (reqAt && rowA) {
    const x = await evaluate(`(() => {
      const bar = document.querySelector('main > section [data-filter-bar]');
      const b = [...bar.querySelectorAll('button[aria-label^="Fjern"]')][0];
      if (!b) return null; b.setAttribute('data-gate-x', ''); return b.getAttribute('aria-label');
    })()`);
    if (!x) check(false, "B8 a chip carries its x");
    else {
      const at = await centre(`document.querySelector('[data-gate-x]')`);
      await clickAt(at.x, at.y);
      await framedOn(`B8 chip removed (${x}); the selection is framed`, [rowA]);
      await orbitHolds("B8 chip removed", [rowA]);
    }
  }
  const held = rowA ? [rowA] : picked;

  /* B9..B13 the Graf tab */
  const tab = async (name) => {
    const at = await centre(`[...document.querySelectorAll('main > section [role=tab]')].find((b) => b.textContent.trim().startsWith('${name}'))`);
    await clickAt(at.x, at.y);
    await sleep(1200);
  };
  await tab("Graf");
  await until(`!!document.querySelector('[data-graph-viewer] canvas')`, 10000, "viewer lent to Graf");
  await orbitHolds("B9 Kontroll -> Graf, viewer windowed", held);

  const graphPick = async (label, avoid) => {
    const g = await evaluate(`(() => {
      const probe = (window.__ifcCheckGraphs ?? []).find((f) => f().length > 0);
      const c = document.querySelector('canvas[data-graph]'); const r = c.getBoundingClientRect();
      const avoid = ${JSON.stringify(avoid)};
      const nodes = probe ? probe() : [];
      // On the graph canvas AND on top there: the viewer window covers part
      // of it when the graph is main, and all of it but a window when not.
      const n = nodes.find((n) => n.kind === 'product' && n.x !== null && !avoid.some((g) => n.id.endsWith(g))
        && n.x > 8 && n.y > 8 && n.x < r.width - 8 && n.y < r.height - 8
        && document.elementFromPoint(r.left + n.x, r.top + n.y) === c);
      return n ? { id: n.id, x: r.left + n.x, y: r.top + n.y } : null;
    })()`);
    if (!g) {
      check(false, `${label}: a product node is on the graph, clear of the viewer window`);
      return null;
    }
    await clickAt(g.x, g.y);
    await sleep(400);
    const sel = (await pose([])).selection;
    check(sel.length === 1 && !avoid.includes(sel[0]), `${label}: the node selected its element (${sel[0]})`);
    return sel.length === 1 ? sel : null;
  };
  const g1 = await graphPick("B10 graph pick, viewer windowed", held);
  if (g1) {
    await framedOn("B10 graph pick, viewer windowed", g1);
    await orbitHolds("B10 graph pick, viewer windowed", g1);
  }

  const toMain = await centre(`[...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent.trim() === 'Modell')`);
  await clickAt(toMain.x, toMain.y);
  await sleep(800);
  const sel11 = (await pose([])).selection;
  await orbitHolds("B11 Graf, viewer main", sel11);
  const g2 = await graphPick("B12 graph pick, viewer main", sel11);
  if (g2) {
    await framedOn("B12 graph pick, viewer main", g2);
    await orbitHolds("B12 graph pick, viewer main", g2);
  }

  const sel13 = (await pose([])).selection;
  await tab("Kontroll");
  await until(`!!document.querySelector('[data-mg-grid] [data-mg-tile=viewer] canvas')`, 10000, "viewer home");
  await orbitHolds("B13 Graf -> Kontroll", sel13);

  /* B14 no selection: the wheel keeps the cursor rule */
  {
    rect = await canvasRect();
    await evaluate(`(() => { const s = ${SCENE}; s.canvas.focus(); return true; })()`);
    const beforeEscape = await pose([]);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(400);
    const p0 = await pose(sel13);
    check(p0.selection.length === 0 && !p0.orbitsSelection, `B14 Escape cleared the selection`);
    await stillAfter("B14 Escape", beforeEscape);
    // A world point that is ON the cursor ray, off the screen centre: the
    // scene's own `planePoint` for that cursor. Zoom-to-cursor keeps every
    // point of that ray in place; a zoom toward anything else moves it.
    const s0 = { x: 0.3, y: 0.2 };
    const at = await evaluate(`(() => { const s = ${SCENE}; const p = s.turntable.planePoint(${JSON.stringify(s0)}, s.camera); return [p.x, p.y, p.z]; })()`);
    const cursor = { x: rect.x + ((s0.x + 1) / 2) * rect.w, y: rect.y + ((1 - s0.y) / 2) * rect.h };
    for (let i = 0; i < 3; i += 1) await wheelAt(cursor.x, cursor.y, -100);
    await park();
    const p1 = await pose(sel13);
    const [s1] = await project([at]);
    const drift = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    check(
      p1.radius < p0.radius && drift < 1e-3,
      `B14 no selection: the point under the cursor stays under it (${drift.toExponential(2)} NDC, radius ${p0.radius.toFixed(2)} -> ${p1.radius.toFixed(2)} m)`,
    );
    check(
      p0.pivot !== null && p1.pivot !== null && Math.hypot(...p1.pivot.map((v, i) => v - p0.pivot[i])) < 1e-9,
      `B14 no selection: the wheel leaves the pivot where it was, as before`,
    );
  }

  /* B15 a SET with nothing selected: the treemap cell frames the set */
  {
    const cell = `document.querySelector('[data-mg-grid] [data-tree-cell]')`;
    if (!(await evaluate(`!!${cell}`))) check(false, "B15 a treemap cell is on the board");
    else {
      const at = await centre(cell);
      const a = await pose([]);
      await clickAt(at.x, at.y);
      await framedSet("B15 treemap cell, nothing selected", a);
      const b = await pose([]);
      await clickAt(at.x, at.y);
      await stillAfter("B15 the cell again (no filter left)", b);
    }
  }

  /* B16 a Typer gallery card: chosen while the viewer tile is hidden, framed
     when the tile comes back */
  {
    const a = await pose([]);
    await tab("Typer");
    const card = `document.querySelector('[data-gallery="types"] button')`;
    if (!(await evaluate(`!!${card}`))) check(false, "B16 a Typer card is in the gallery");
    else {
      const at = await centre(card);
      await clickAt(at.x, at.y);
      await tab("Kontroll");
      await until(`!!document.querySelector('[data-mg-grid] [data-mg-tile=viewer] canvas')`, 10000, "viewer home");
      await sleep(400);
      // A card makes a Type chip; a card that opens on one of its instances
      // also selects it, and then it is the selection that is framed.
      const chosen = (await pose([])).selection;
      if (chosen.length > 0) await framedOn("B16 Typer card", chosen);
      else await framedSet("B16 Typer card", a);
    }
  }

  if (exceptions.length) {
    console.log(`page exceptions (${exceptions.length}):\n  ${exceptions.slice(0, 5).join("\n  ")}`);
    fails += 1;
  }
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify({ base, model: path, design, record, exceptions }, null, 2));
  ws.close();
  cleanup();
  return fails;
}

if (args.includes("--no-browser")) process.exit(failures.length === 0 ? 0 : 1);
const browserFailures = await browserPhase();
console.log(
  failures.length + browserFailures === 0
    ? "pivot gate: all assertions hold"
    : `pivot gate: FAILED (${failures.length} arithmetic, ${browserFailures} browser)`,
);
process.exit(failures.length + browserFailures === 0 ? 0 : 1);
