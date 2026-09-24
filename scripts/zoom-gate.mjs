/** The zoom gate: does the wheel keep working from one framed element out to
 *  the whole model, and does it zoom AROUND THE CURSOR?
 *
 * edkjo, on the deployed site: *"we get zoom saturated hard"*. Saturation has
 * one meaning worth testing for — the wheel turns and the picture does not
 * move — and exactly one cause in this viewer: the radius window. `setExtent`
 * derives it from the MODEL (`[extent x 0.002, extent x 50]`), and a camera
 * framed on one ELEMENT can land outside that window at either end. Below the
 * floor, a zoom-IN used to clamp to the floor, i.e. answer a zoom in with a
 * jump OUT, and then refuse every tick after it. Above the ceiling — a stray
 * element thousands of kilometres out — the frame itself was clamped, so
 * `zoomToSelection` never reached it and the wheel was dead on arrival.
 *
 * Everything here is measured off the live scene (`ModelScene.probe`), never
 * off pixels: there is no honest way to recover a camera pose from a render.
 * The wheel is driven with real CDP `mouseWheel` events, not a synthetic
 * `WheelEvent` on the handler, because the claim is about the gesture.
 *
 * Asserted, on KNM_ARK:
 *   1  entry            the model is framed; the radius window brackets it
 *   2  frame an element a band row frames one element, closer than the model
 *   3  zoom IN          N ticks, radius strictly DECREASING, each tick within
 *                       the step the constant predicts — and the point under
 *                       the cursor stays under the cursor, which is the
 *                       zoom-to-cursor canon expressed as a measurement
 *   4  the floor        60 ticks in: the radius never once goes UP. That is
 *                       the absorbing-stop rule; the old clamp failed it on
 *                       the first tick from a small framed element
 *   5  zoom OUT         monotone increasing, and it REACHES the whole-model
 *                       view within a sane number of ticks
 *   6  the far outlier  framing a `far-from-model` element reaches it — the
 *                       box projects inside the viewport — and the wheel still
 *                       moves the radius out there
 *
 * RAM: one Chrome at a time, launched only with >= 4 GB free physical memory;
 * kills only the Chrome and the preview server it started.
 *
 * Run:   npm run build && node scripts/zoom-gate.mjs
 *        node scripts/zoom-gate.mjs --url https://ifc-check.skiplum.com
 *        [--model PATH] [--outlier PATH] [--viewport 2112x1267]
 * Exit:  0 every assertion holds · 1 an assertion failed · 2 usage/internal.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(ROOT, "tmp/zoom");
const PORT = 4183;
const CDP = 9337;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MODEL =
  "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14/KNM_ARK.ifc";
/** A model that really carries a stray element today.
 *
 * NOT `KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc`: AGENTS.md's note about five
 * IfcBeam at +-31,847,402 m does not hold for the file on disk (measured
 * 2026-09-23 with `check-cli.ts`, both before and after the placement
 * refactor: 0 of 851 far from the model, cutoff 295.8 m). The Void-demo
 * KNM_ARK export does: 1 of 1 335 far, cutoff 290.3 m. */
const DEFAULT_OUTLIER =
  "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14/KNM_ARK.ifc";

/** One notch of a physical wheel in Chrome, deltaMode 0. */
const TICK = 100;
/** `WHEEL_K` in src/viewer/camera.ts. exp(+-100 * k) per tick. */
const WHEEL_K = 0.0016;
const STEP_IN = Math.exp(-TICK * WHEEL_K);
const STEP_OUT = Math.exp(TICK * WHEEL_K);

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const liveUrl = opt("url");
const modelPath = opt("model") ?? DEFAULT_MODEL;
const outlierPath = opt("outlier") ?? DEFAULT_OUTLIER;
const [vw, vh] = (opt("viewport") ?? "2112x1267").split("x").map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freeGb() {
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
}

const started = [];
function cleanup() {
  for (const child of started) {
    try {
      if (process.platform === "win32")
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
      else child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(2));

async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`not reachable: ${url}`);
}

async function startPreview() {
  if (!existsSync(resolve(ROOT, "dist/index.html"))) {
    console.error("no dist/ — run `npm run build` first");
    process.exit(2);
  }
  const child = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "ignore" },
  );
  started.push(child);
  await waitHttp(`http://localhost:${PORT}/`, 20000);
  return `http://localhost:${PORT}/`;
}

async function startChrome() {
  const free = freeGb();
  if (free < 4) {
    console.error(`only ${free} GB free physical memory; the gate launches Chrome at >= 4 GB`);
    process.exit(2);
  }
  const profile = resolve(OUT, "_profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const child = spawn(
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
  );
  started.push(child);
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000);
}

/* ------------------------------------------------------------------ CDP */

let ws;
let seq = 0;
const pending = new Map();

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
}

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails)
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function until(expr, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return;
    await sleep(400);
  }
  throw new Error(`timeout: ${label}`);
}

async function setFiles(selector, paths) {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no element for ${selector}`);
  await send("DOM.setFileInputFiles", { nodeId, files: paths });
}

async function clickAt(x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: 1, clickCount: 1 });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
  await sleep(450);
}

/** One notch of a real wheel, at a real point on the page. `deltaMode` is 0,
 *  which is what a mouse reports in Chrome; `camera.ts` normalises it. */
async function wheelAt(x, y, deltaY) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
    pointerType: "mouse",
  });
  await sleep(90);
}

async function centre(expr) {
  const box = await evaluate(
    `(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`,
  );
  if (!box) throw new Error(`no clickable box for ${expr}`);
  return box;
}

const POSE = (guids) => `(() => {
  const scene = (window.__ifcCheckScenes ?? [])[0];
  if (!scene) return null;
  return scene.probe(${JSON.stringify(guids)});
})()`;

const PROJECT = (points) => `(() => {
  const scene = (window.__ifcCheckScenes ?? [])[0];
  if (!scene) return null;
  return scene.project(${JSON.stringify(points)});
})()`;

const CANVAS = `(() => {
  const c = document.querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=viewer] canvas');
  if (!c) return null; const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`;

async function canvasShot(name) {
  const rect = await evaluate(
    `(() => { const c = document.querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=viewer] canvas');
      if (!c) return null; const r = c.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), scale: 1 }; })()`,
  );
  if (!rect) return;
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: rect });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, "base64"));
}

/** NDC (x, y) -> CSS px inside the canvas. */
function ndcToPage(canvas, ndc) {
  return {
    x: canvas.x + ((ndc.x + 1) / 2) * canvas.width,
    y: canvas.y + ((1 - ndc.y) / 2) * canvas.height,
  };
}

function inView(box) {
  return box !== null && box.x0 >= -1 && box.x1 <= 1 && box.y0 >= -1 && box.y1 <= 1;
}

/* ------------------------------------------------------------ assertions */

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

/* ------------------------------------------------------------------ run */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const url = liveUrl ?? (await startPreview());
await startChrome();
await connect();

async function load(path) {
  await send("Page.navigate", { url });
  await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
  await sleep(1200);
  // The app restores the last session from IndexedDB, so a second navigate
  // brings the FIRST model back and the new file is added beside it — and
  // `__ifcCheckScenes[0]` would then still be the first model's scene. Clear
  // first, and wait for the landing, so index 0 is the file this call loaded.
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`,
  );
  await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
  await setFiles('input[type=file][accept=".ifc,.ifczip"]', [resolve(path)]);
  await until(
    `!!document.querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=viewer] canvas')`,
    180000,
    "viewer",
  );
  await until(`((window.__ifcCheckScenes ?? [])[0]?.probe([])?.radius ?? 0) > 0`, 120000, "scene");
  await until(`document.querySelectorAll('main > section').length === 1`, 30000, "one panel");
  await sleep(1500);
  const loaded = await evaluate(
    `document.querySelector('main > section span.font-mono')?.textContent?.trim() ?? null`,
  );
  console.log(`loaded ${loaded}`);
}

/* ── phase 1: KNM_ARK ─────────────────────────────────────────────────── */

await load(modelPath);
const canvas = await evaluate(CANVAS);
const entry = await evaluate(POSE([]));
console.log(
  `model  radius ${entry.radius.toFixed(2)} m · limits ${entry.limits.min.toExponential(3)} .. ` +
    `${entry.limits.max.toExponential(3)} m · near ${entry.near.toExponential(3)} far ${entry.far.toExponential(3)}`,
);
check(
  entry.radius > entry.limits.min && entry.radius < entry.limits.max,
  `1 the entry radius sits inside the wheel's window`,
);

/* 2 — frame one element, through the drill the UI already has. */
const klass = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-tile-id=classes] button')];
  const read = (b) => Number((b.lastElementChild?.textContent ?? '').replace(/[^\\d]/g, ''));
  const total = rows.reduce((s, b) => s + read(b), 0);
  const pick = rows.find((b) => read(b) > 0 && read(b) < total / 2) ?? rows[0];
  if (!pick) return null;
  pick.setAttribute('data-gate-pick', '');
  return { count: read(pick) };
})()`);
if (!klass) {
  console.error("no Klasser tile on this board — run at a 21-track viewport");
  process.exit(2);
}
await clickAt(...Object.values(await centre(`document.querySelector('[data-gate-pick]')`)));
const guid = await evaluate(`document.querySelectorAll('[data-guid]')[0].getAttribute('data-guid')`);
const rowAt = await centre(`document.querySelectorAll('[data-guid]')[0]`);
await clickAt(rowAt.x, rowAt.y);
const framed = await evaluate(POSE([guid]));
await canvasShot("1-framed");
console.log(
  `framed ${guid}  radius ${framed.radius.toFixed(4)} m · limits ${framed.limits.min.toExponential(3)} .. ` +
    `${framed.limits.max.toExponential(3)} m`,
);
check(framed.box !== null, `2 the framed element has geometry in the scene`);
check(framed.radius < entry.radius, `2 framing closed in (${framed.radius.toFixed(3)} < ${entry.radius.toFixed(2)} m)`);
check(
  framed.radius > framed.limits.min,
  `2 the frame is INSIDE the window, so the next tick in has somewhere to go ` +
    `(${framed.radius.toFixed(4)} > ${framed.limits.min.toExponential(3)} m)`,
);

/* 3 — zoom IN at the element, and watch ONE WORLD POINT under the cursor.
   The element's world box centre, projected through the scene's own camera:
   the NDC box centre would drift on its own as perspective changes which
   corner is extreme, and that is a measurement artefact, not a camera fault. */
const worldPoint = [0, 1, 2].map((a) => (framed.world.min[a] + framed.world.max[a]) / 2);
const before = (await evaluate(PROJECT([worldPoint])))[0];
const anchor = ndcToPage(canvas, before);
const radii = [framed.radius];
const drifts = [];
for (let tick = 0; tick < 6; tick += 1) {
  await wheelAt(anchor.x, anchor.y, -TICK);
  const pose = await evaluate(POSE([guid]));
  radii.push(pose.radius);
  const now = (await evaluate(PROJECT([worldPoint])))[0];
  drifts.push(Math.hypot(now.x - before.x, now.y - before.y));
}
await canvasShot("2-zoomed-in");
const steps = radii.slice(1).map((r, i) => r / radii[i]);
console.log(
  `zoom in  radii ${radii.map((r) => r.toFixed(4)).join(" -> ")}  steps ${steps
    .map((s) => s.toFixed(4))
    .join(" ")}  (predicted ${STEP_IN.toFixed(4)})`,
);
check(
  steps.every((s) => s < 1),
  `3 every tick in made the radius smaller (${steps.map((s) => s.toFixed(3)).join(", ")})`,
);
check(
  steps.every((s) => Math.abs(s - STEP_IN) < 0.02),
  `3 each tick is the step the constant predicts (${STEP_IN.toFixed(4)} +- 0.02)`,
);
const maxDrift = drifts.length ? Math.max(...drifts) : Infinity;
console.log(`cursor drift ${maxDrift.toFixed(4)} NDC over ${drifts.length} ticks`);
check(
  maxDrift < 0.02,
  `3 the world point under the cursor stayed under the cursor — zoom is ` +
    `around the CURSOR (${maxDrift.toFixed(4)} NDC)`,
);

/* 4 — the floor absorbs. It must never answer a zoom IN with a move OUT. */
const deep = [];
for (let tick = 0; tick < 60; tick += 1) {
  await wheelAt(anchor.x, anchor.y, -TICK);
  if (tick % 6 === 5) deep.push((await evaluate(POSE([guid]))).radius);
}
const floorPose = await evaluate(POSE([guid]));
console.log(
  `60 ticks in  radius ${floorPose.radius.toExponential(3)} m · floor ${floorPose.limits.min.toExponential(3)} m ` +
    `· samples ${deep.map((r) => r.toExponential(2)).join(" ")}`,
);
check(
  deep.every((r, i) => i === 0 || r <= deep[i - 1] + 1e-12),
  `4 the radius never went UP while zooming in (the stop absorbs, it does not reflect)`,
);
check(
  floorPose.radius > 0 && Number.isFinite(floorPose.radius),
  `4 the radius stayed finite and positive (${floorPose.radius.toExponential(3)} m)`,
);

/* 5 — and back out to the whole model, in a countable number of ticks. */
const pageCentre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
let out = [];
let ticks = 0;
let radius = floorPose.radius;
while (ticks < 90) {
  await wheelAt(pageCentre.x, pageCentre.y, TICK);
  ticks += 1;
  const pose = await evaluate(POSE([]));
  out.push(pose.radius);
  radius = pose.radius;
  if (radius >= entry.radius) break;
}
await canvasShot("3-zoomed-out");
console.log(
  `zoom out  ${ticks} ticks from ${floorPose.radius.toExponential(3)} m to ${radius.toFixed(2)} m ` +
    `(model ${entry.radius.toFixed(2)} m, predicted step ${STEP_OUT.toFixed(4)})`,
);
check(
  out.every((r, i) => i === 0 || r >= out[i - 1] - 1e-12),
  `5 the radius rose monotonically on the way out`,
);
check(radius >= entry.radius, `5 the wheel REACHED the whole-model view (${radius.toFixed(2)} m)`);
check(
  ticks <= 80,
  `5 it took ${ticks} ticks, which a hand can actually turn (<= 80)`,
);

/* ── phase 2: the far outlier ─────────────────────────────────────────── */

if (existsSync(resolve(outlierPath))) {
  await load(outlierPath);
  const far = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-tile-id=verify] [role=row], [role=tabpanel]:not([hidden]) [data-tile-id=verify] button')];
    const pick = rows.find((r) => /plassering|placement/i.test(r.textContent));
    if (!pick) return null;
    pick.setAttribute('data-gate-far', '');
    return true;
  })()`);
  if (!far) {
    console.log("skip 6 — no mesh-placement row found on the verification tile");
  } else {
    await clickAt(...Object.values(await centre(`document.querySelector('[data-gate-far]')`)));
    /* The FAR row specifically — a placement check reports two kinds of
       finding and only the far one exercises the ceiling. */
    const outlierGuid = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-guid]')];
      const far = rows.find((r) => /hovedvolum|main body/i.test(r.textContent)) ?? null;
      if (!far) return null;
      far.setAttribute('data-gate-far-row', '');
      return far.getAttribute('data-guid');
    })()`);
    if (!outlierGuid) {
      console.log("skip 6 — no far-from-model finding on this model");
    } else {
      const at = await centre(`document.querySelector('[data-gate-far-row]')`);
      await clickAt(at.x, at.y);
      const pose = await evaluate(POSE([outlierGuid]));
      await canvasShot("4-outlier-framed");
      console.log(
        `outlier ${outlierGuid}  radius ${pose.radius.toExponential(3)} m · ceiling ` +
          `${pose.limits.max.toExponential(3)} m · box ${JSON.stringify(pose.box)}`,
      );
      check(
        pose.box === null || inView(pose.box),
        `6 framing REACHED the far outlier — its box projects inside the viewport`,
      );
      check(
        pose.radius < pose.limits.max,
        `6 the frame is under the ceiling, so the wheel is not dead on arrival ` +
          `(${pose.radius.toExponential(3)} < ${pose.limits.max.toExponential(3)} m)`,
      );
      const c2 = await evaluate(CANVAS);
      const before2 = pose.radius;
      await wheelAt(c2.x + c2.width / 2, c2.y + c2.height / 2, TICK);
      const after2 = (await evaluate(POSE([outlierGuid]))).radius;
      check(after2 > before2, `6 the wheel still moves the radius out there (${before2.toExponential(3)} -> ${after2.toExponential(3)})`);
    }
  }
} else {
  console.log(`skip 6 — no outlier model at ${outlierPath}`);
}

console.log(failures === 0 ? "\nzoom gate: all assertions hold" : `\nzoom gate: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
