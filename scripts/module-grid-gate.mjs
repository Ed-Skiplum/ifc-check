/** The MODULE GRID gate for the design alternatives (`#design=a|b|c`).
 *
 * Drops real KNM models into ONE headless Chrome (a LOCAL `vite preview`
 * build unless `--url`), and at every viewport class, for a, b and c,
 * asserts on the RENDERED board:
 *
 *  - the layout canon (`data-workspace.md`, LAYOUT SYSTEM, 2026-09-26):
 *    rule 6 (C, R, u by the formula from the window, within 1 px), rule 1
 *    (24 px margin, every tile edge on the grid, no page scroll), rule 7
 *    (canon sizes or the named strip, at most two XL), rules 3 and 4 (aspect
 *    per kind, no full-width tile, every canvas 9:16 to 16:9 on Kontroll and
 *    the Graf tab in both swap states), rule 5 (no essential value cut),
 *    rule 8 (a resize round trip gives the same layout), rule 9 (no hole, no
 *    overlap, the board centred); the Graf tab's surfaces on the grid
 *  - the docked panels (2026-09-25): Scope and Detail are tiles of the grid,
 *    empty until used; a requirement click fills Scope, a Scope row fills
 *    Detail, and the tiles do not move while that happens (nothing overlays)
 *
 * Scenarios: KNM_ARK alone; KNM ARK + RIV + RIB with the test floor config at
 * 1440 and 2112; HI90_ARK without and with
 * `examples/hi90-project-layer.test.ruleset.json` (when the HI90 export is on
 * this machine). On a, the requirements must be the KPI band on the board's
 * top row, not a list tile, and no requirement card scrolls (2026-09-26).
 *
 * Screenshots to `--out` (default tmp/panels/):
 * `<design>-<scenario>-<w>x<h>.png`, and `-full.png` when the page is taller
 * than the screen. These are LOCAL builds, not the deployed site.
 *
 *   npm run build && node scripts/module-grid-gate.mjs
 *        [--out dir] [--only 1440x900,2112x1267] [--design a,b,c] [--url …]
 *
 * Exit 0 all hold · 1 an assertion failed · 2 usage / environment.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MG_ASPECT, MG_GAP, MG_MARGIN, MG_MODULE, MG_STRIPS, SIZES } from "../src/ui/alt/module-grid.ts";
import { CANVAS_ASPECT } from "../src/ui/canvas-aspect.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = 4181;
const CDP = 9335;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MODELS =
  "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14";
const HI90_ARK =
  "C:/workspace/skiplum/client-projects/10021-henrik-ibsens-gate-90/underprosjekter/HI90_Mottakskontroll/01_Inn/Dalux-eksport/Export HI90 22. sep. 2026, 1254/HI90_ARK.ifc";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const liveUrl = opt("url");
const modelsDir = opt("models") ?? DEFAULT_MODELS;
const OUT = resolve(opt("out") ?? resolve(ROOT, "tmp/panels"));
const only = opt("only")?.split(",");
const DESIGNS = (opt("design") ?? "a,b,c").split(",");
const onlyScenario = opt("scenario");

/** One per viewport class, plus the owner's own window. */
const VIEWPORTS = [
  { w: 1100, h: 800, cls: "compact, the skiplum.com iframe box" },
  { w: 1280, h: 800, cls: "regular, small laptop" },
  { w: 1440, h: 900, cls: "regular, laptop" },
  { w: 1920, h: 1080, cls: "wide" },
  { w: 2112, h: 1267, cls: "wide, the owner's window" },
  { w: 2560, h: 1440, cls: "wide" },
  { w: 3440, h: 1440, cls: "ultrawide" },
].filter((v) => !only || only.includes(`${v.w}x${v.h}`));

const floorsRuleset = resolve(ROOT, "examples/knm-floors.test.ruleset.json");
const hi90Ruleset = resolve(ROOT, "examples/hi90-project-layer.test.ruleset.json");
const knm = (f) => resolve(modelsDir, f);
const SCENARIOS = [
  { name: "one", files: [knm("KNM_ARK.ifc")], ruleset: null, sizes: null },
  {
    name: "three",
    files: ["KNM_ARK.ifc", "KNM_RIV.ifc", "KNM_RIB.ifc"].map(knm),
    ruleset: floorsRuleset,
    sizes: ["1440x900", "2112x1267"],
  },
  ...(existsSync(HI90_ARK)
    ? [
        { name: "hi90", files: [HI90_ARK], ruleset: null, sizes: ["1440x900", "1920x1080", "2112x1267", "2560x1440"] },
        {
          name: "hi90-fixture",
          files: [HI90_ARK],
          ruleset: hi90Ruleset,
          sizes: ["1440x900", "1920x1080", "2112x1267", "2560x1440", "3440x1440"],
        },
      ]
    : []),
].filter((s) => !onlyScenario || onlyScenario.split(",").includes(s.name));

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
      if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
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
  // A fresh profile per run: the app restores the last session's models from
  // IndexedDB on load, which would put a board on the landing check.
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
      "--hide-scrollbars=false",
      "--window-size=1440,900",
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
const logs = [];

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
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function until(expr, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return;
    await sleep(500);
  }
  throw new Error(`timeout: ${label}`);
}

async function setFiles(selector, paths) {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no element for ${selector}`);
  await send("DOM.setFileInputFiles", { nodeId, files: paths });
}

async function viewport(v, height = v.h) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: v.w,
    height,
    deviceScaleFactor: v.dpr ?? 1,
    mobile: false,
  });
}


async function settle() {
  let last = "";
  for (let i = 0; i < 24; i += 1) {
    await sleep(250);
    const now = await evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-mg-tile]')].map(t => { const r = t.getBoundingClientRect(); return [r.x|0, r.y|0, r.width|0, r.height|0]; }))`,
    );
    if (now === last && now !== "[]") return;
    last = now;
  }
}

async function shot(name, v) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, "base64"));
  const full = await evaluate(
    `(() => { const m = document.querySelector('main'); return m ? Math.ceil(document.documentElement.clientHeight + m.scrollHeight - m.clientHeight) : 0; })()`,
  );
  if (full > v.h + 2) {
    await viewport(v, Math.min(full, 8000));
    await settle();
    const tall = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(OUT, `${name}-full.png`), Buffer.from(tall.data, "base64"));
    await viewport(v);
    await settle();
  }
}

/** Every visible canvas, the 3D and the graph, against the canvas bound.
 *  Reported as pseudo tiles (`canvas:<which>`) so the log shows them. */
const CANVASES = `(() => {
  const B = ${JSON.stringify(CANVAS_ASPECT)};
  const fails = [], canvases = [];
  const all = [...document.querySelectorAll('canvas[data-viewer-canvas], canvas[data-graph]')]
    .filter((c) => c.getClientRects().length > 0 && !c.closest('[hidden]'));
  for (const c of all) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const which = c.hasAttribute('data-graph') ? 'graph' : 'viewer';
    const a = r.width / r.height;
    const id = 'canvas:' + which;
    if (a < B.min - 0.005 || a > B.max + 0.005)
      fails.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': aspect ' + a.toFixed(2) + ' outside ' + B.min.toFixed(4) + '..' + B.max.toFixed(4));
    canvases.push({ id, kind: which, x: 0, y: 0, w: 0, h: 0, px: [Math.round(r.width), Math.round(r.height)], aspect: +a.toFixed(2) });
  }
  return { fails, canvases };
})()`;

/** The layout canon on the RENDERED board (`data-workspace.md`, LAYOUT
 *  SYSTEM), rule by rule. Everything is measured off the DOM: the window
 *  (`main`'s client box), the grid element and each tile's box. */
const MEASURE = `(() => {
  const ASPECT = ${JSON.stringify(MG_ASPECT)};
  const STRIPS = ${JSON.stringify(Object.keys(MG_STRIPS))};
  const SIZES = ${JSON.stringify(SIZES)};
  const G = ${MG_GAP}, MOD = ${MG_MODULE}, MARGIN = ${MG_MARGIN};
  const fails = [];
  const grids = [...document.querySelectorAll('[data-mg-grid]')].filter((g) => g.offsetParent !== null);
  if (grids.length === 0) return { fails: ['no visible [data-mg-grid]'], tiles: [] };
  const main = document.querySelector('main');
  const W = main.clientWidth;
  const padTop = parseFloat(getComputedStyle(main).paddingTop) || 0;
  const canon = (w, h, id) => {
    for (const [name, list] of Object.entries(SIZES)) if (list.some(([a, b]) => a === w && b === h)) return name;
    if (STRIPS.includes(id) && (w === 1 || h === 1) && Math.max(w, h) >= 2) return 'strip';
    return null;
  };
  const tiles = [];
  let summary = null;
  for (const grid of grids) {
    const g = grid.getBoundingClientRect();
    const panel = grid.closest('main > section');
    const above = g.top - (panel ? panel.getBoundingClientRect().top : g.top);
    // Rule 6: C, u, R by the formula, from the window, within 1 px.
    const C = Math.max(1, Math.round((W - 2 * MARGIN + G) / (MOD + G)));
    const u = (W - 2 * MARGIN - (C - 1) * G) / C;
    const avail = main.clientHeight - padTop - above + MARGIN;
    const R = Math.max(1, Math.floor((avail - 2 * MARGIN + G) / (u + G)));
    const cols = Number(grid.dataset.mgCols), rows = Number(grid.dataset.mgRows), gu = Number(grid.dataset.mgU);
    if (cols !== C) fails.push('rule 6: ' + cols + ' columns, the formula says ' + C + ' at W ' + W);
    if (rows !== R) fails.push('rule 6: ' + rows + ' rows, the formula says ' + R);
    if (Math.abs(gu - u) > 1) fails.push('rule 6: module ' + gu.toFixed(1) + ' px, the formula says ' + u.toFixed(1));
    if (Math.abs(g.width - (C * u + (C - 1) * G)) > 1) fails.push('rule 6: grid ' + g.width.toFixed(1) + ' px wide, C·u + (C−1)·16 is ' + (C * u + (C - 1) * G).toFixed(1));
    if (Math.abs(g.height - (R * u + (R - 1) * G)) > 1) fails.push('rule 6: grid ' + g.height.toFixed(1) + ' px tall, R·u + (R−1)·16 is ' + (R * u + (R - 1) * G).toFixed(1));
    // Rule 1: the margins are the canon's 24 px (the grid is centred in the window).
    const mainBox = main.getBoundingClientRect();
    if (Math.abs(g.left - mainBox.left - MARGIN) > 1) fails.push('rule 1: grid starts ' + (g.left - mainBox.left).toFixed(1) + ' px in, not 24');
    const pitch = gu + G;
    const occ = new Map();
    let xl = 0;
    for (const el of grid.querySelectorAll(':scope > [data-mg-tile]')) {
      const r = el.getBoundingClientRect();
      const id = el.dataset.mgTile, kind = el.dataset.mgKind;
      const x = r.left - g.left, y = r.top - g.top;
      const i = Math.round(x / pitch), j = Math.round(y / pitch);
      const w = Math.round((r.width + G) / pitch), h = Math.round((r.height + G) / pitch);
      const at = id + ' [' + i + ',' + j + ' ' + w + 'x' + h + ']';
      // Rule 1: every edge on the grid, within 1 px.
      if (Math.abs(x - i * pitch) > 1) fails.push('rule 1: ' + at + ' left off the grid by ' + (x - i * pitch).toFixed(1) + 'px');
      if (Math.abs(y - j * pitch) > 1) fails.push('rule 1: ' + at + ' top off the grid by ' + (y - j * pitch).toFixed(1) + 'px');
      if (Math.abs(r.width - (w * pitch - G)) > 1) fails.push('rule 1: ' + at + ' width ' + r.width.toFixed(1) + ' is not ' + w + ' modules');
      if (Math.abs(r.height - (h * pitch - G)) > 1) fails.push('rule 1: ' + at + ' height ' + r.height.toFixed(1) + ' is not ' + h + ' modules');
      if (i + w > cols || j + h > rows) fails.push('rule 1: ' + at + ' past the grid');
      // Rule 7: a canon size, or a named strip.
      const size = canon(w, h, id);
      if (!size) fails.push('rule 7: ' + at + ' is not a canon size (S 2x2, M 3x2/2x3, L 4x3/3x4, XL 6x4/8x5) nor a named strip');
      if (size === 'XL') xl += 1;
      if (el.dataset.mgSize && el.dataset.mgSize !== size) fails.push('rule 7: ' + at + ' says ' + el.dataset.mgSize + ', measures ' + size);
      // Rule 3 and 4: the rendered aspect inside its kind's bound; a strip only named.
      const aspect = r.width / r.height;
      const b = ASPECT[kind];
      if (!b) fails.push('rule 3: ' + at + ': kind "' + kind + '" is not in the vocabulary');
      else if (size !== 'strip' && (aspect < b.min - 0.005 || aspect > b.max + 0.005))
        fails.push('rule 3: ' + at + ' aspect ' + aspect.toFixed(2) + ' outside ' + kind + ' ' + b.min.toFixed(2) + '..' + b.max.toFixed(2));
      if (w >= cols && size !== 'strip' && r.height < innerHeight / 2)
        fails.push('rule 3: ' + at + ' full width at ' + Math.round(r.height) + 'px, under half the viewport height');
      // Rule 5, cramped content: no essential value cut.
      for (const e of el.querySelectorAll('[data-essential]')) {
        if (e.offsetParent === null) continue;
        if (e.scrollWidth > e.clientWidth + 1) fails.push('rule 5: ' + at + ' value cut, "' + e.textContent.trim().slice(0, 40) + '"');
      }
      for (let yy = j; yy < j + h; yy += 1)
        for (let xx = i; xx < i + w; xx += 1) {
          const k = xx + ',' + yy;
          if (occ.has(k)) fails.push('rule 9: ' + id + ' overlaps ' + occ.get(k) + ' at ' + k);
          occ.set(k, id);
        }
      tiles.push({ id, kind, size, x: i, y: j, w, h, px: [Math.round(r.width), Math.round(r.height)], aspect: +aspect.toFixed(2) });
    }
    if (xl > 2) fails.push('rule 7: ' + xl + ' XL tiles, at most two');
    // Rule 9's measurable part: the tiles cover one rectangle exactly, no
    // hole, no ragged edge; the board is that rectangle, centred.
    if (tiles.length) {
      const own = tiles.filter((t) => grid.contains(grid.querySelector('[data-mg-tile="' + t.id + '"]')));
      const x0 = Math.min(...own.map((t) => t.x)), y0 = Math.min(...own.map((t) => t.y));
      const x1 = Math.max(...own.map((t) => t.x + t.w)), y1 = Math.max(...own.map((t) => t.y + t.h));
      let holes = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) if (!occ.has(xx + ',' + yy)) holes += 1;
      if (holes) fails.push('rule 9: ' + holes + ' empty cells inside the board ' + x0 + ',' + y0 + '..' + x1 + ',' + y1);
      const [ox, oy, uc, ur] = (grid.dataset.mgUsed ?? '').split(',').map(Number);
      if (ox !== x0 || oy !== y0 || uc !== x1 - x0 || ur !== y1 - y0) fails.push('rule 9: the board ' + grid.dataset.mgUsed + ' is not the tiles\\' rectangle ' + [x0, y0, x1 - x0, y1 - y0]);
      if (Math.abs(x0 - (cols - x1)) > 1 || Math.abs(y0 - (rows - y1)) > 1) fails.push('rule 9: the board is not centred on the grid');
      summary = { cols, rows, u: +gu.toFixed(1), board: [x1 - x0, y1 - y0], chrome: Math.round(g.top - MARGIN) };
    }
  }
  const cv = ${CANVASES};
  fails.push(...cv.fails);
  tiles.push(...cv.canvases);
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) fails.push('rule 1: the page scrolls sideways');
  if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) fails.push('rule 1: the document scrolls vertically');
  if (grids.length === 1 && main.scrollHeight > main.clientHeight + 1)
    fails.push('rule 1: the page scrolls vertically: ' + main.scrollHeight + ' > ' + main.clientHeight);
  for (const grid of grids) {
    const panel = grid.closest('main > section');
    const top = panel ? panel.getBoundingClientRect().top : 0;
    const bottom = grid.getBoundingClientRect().bottom;
    if (bottom - top > main.clientHeight + 1) fails.push('rule 1: a model board is taller than the screen: ' + Math.round(bottom - top) + ' > ' + main.clientHeight);
  }
  const grid = grids[0];
  return { fails, tiles, summary, cols: Number(grid.dataset.mgCols), u: Number(grid.dataset.mgU), width: Math.round(grid.getBoundingClientRect().width) };
})()`;

/** The Graf tab's two surfaces as XL tiles on the same grid (rules 4, 6, 7):
 *  every field's tiles land on the grid and are canon sizes. */
const GRAF = `(() => {
  const SIZES = ${JSON.stringify(SIZES)};
  const G = ${MG_GAP};
  const fails = [];
  for (const wrap of document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-mg-graf]')) {
    const [cols, rows, u] = wrap.dataset.mgGraf.split(',').map(Number);
    const g = wrap.getBoundingClientRect();
    const pitch = u + G;
    const field = wrap.querySelector('[data-graph-field]');
    const boxes = [...field.children].filter((c) => c.getClientRects().length > 0 && c.getBoundingClientRect().width > 2);
    const f = field.getBoundingClientRect();
    if (Math.abs((f.left - g.left) / pitch - Math.round((f.left - g.left) / pitch)) * pitch > 1) fails.push('graf: the field is off the grid');
    for (const box of boxes) {
      const r = box.getBoundingClientRect();
      const x = r.left - g.left, y = r.top - g.top;
      const i = Math.round(x / pitch), w = Math.round((r.width + G) / pitch), h = Math.round((r.height + G) / pitch);
      if (Math.abs(x - i * pitch) > 1 || Math.abs(r.width - (w * pitch - G)) > 1 || Math.abs(r.height - (h * pitch - G)) > 1)
        fails.push('graf: a surface ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' is off the grid');
      const size = Object.entries(SIZES).find(([, list]) => list.some(([a, b]) => a === w && b === h))?.[0];
      if (!size) fails.push('graf: a surface ' + w + 'x' + h + ' is not a canon size');
      if (i + w > cols || Math.round(y / pitch) + h > rows) fails.push('graf: a surface is past the grid');
    }
  }
  return fails;
})()`;

const DOCKS = `(() => {
  const grid = document.querySelector('[data-mg-grid]');
  // A dock may be a tab of another tile (rule 8, the narrow board): the
  // dock is its [data-dock] body wherever it is.
  const scope = grid?.querySelector('[data-dock="scope"]');
  const detail = grid?.querySelector('[data-dock="detail"]');
  return {
    scopeRows: scope ? scope.querySelectorAll('[data-guid]').length : 0,
    detail: !!detail?.querySelector('[data-object-panel]'),
    band: !!document.querySelector('main .sticky.bottom-0'),
  };
})()`;

async function openEmpty(design) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#lang=nb&design=${design}` });
  await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
  await sleep(1500);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`);
  await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
}

async function setDesign(design) {
  await evaluate(`(() => { const h = new URLSearchParams(location.hash.slice(1)); h.set('design', ${JSON.stringify(design)}); h.delete('focus'); h.delete('model'); location.hash = h.toString(); document.querySelector('main')?.scrollTo(0, 0); return true; })()`);
  await sleep(600);
}

/** Click every model's tab named `re` (one per model panel). */
async function tab(re) {
  await evaluate(`(() => {
    for (const b of document.querySelectorAll('[role=tab]')) if (${re}.test(b.textContent) && b.getAttribute('aria-selected') !== 'true') b.click();
    document.querySelector('main')?.scrollTo(0, 0);
    return true;
  })()`);
  await sleep(800);
}

/** The Graf tab in both swap states, then back to Kontroll. The graph and the
 *  borrowed 3D canvas are measured in every model panel on the page. */
async function graf(name, v) {
  await tab("/^(Graf|Graph)$/");
  for (const [i, state] of [[1, "graphmain"], [0, "modelmain"]]) {
    await evaluate(`(() => {
      for (const p of document.querySelectorAll('[role=tabpanel]:not([hidden])')) {
        const b = p.querySelectorAll('[role=group] button[aria-pressed]')[${i}];
        if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
      }
      return true;
    })()`);
    await sleep(1200);
    const m = await evaluate(CANVASES);
    m.fails.push(...(await evaluate(GRAF)));
    const n = m.canvases.length;
    const want = await evaluate(`document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-graph-field]').length`);
    if (m.canvases.filter((c) => c.kind === "graph").length < want) m.fails.push(`graph canvas missing (${n} canvases, ${want} fields)`);
    const gname = `${name}-graf-${state}`;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(OUT, `${gname}.png`), Buffer.from(data, "base64"));
    results.push({ state: gname, ...m });
    if (m.fails.length) failed = true;
    console.log(
      `${m.fails.length ? "FAIL" : "ok  "} ${gname}  ` + m.canvases.map((c) => `${c.id} ${c.px[0]}x${c.px[1]} ${c.aspect}`).join(" · ") +
        (m.fails.length ? "\n  " + m.fails.join("\n  ") : ""),
    );
  }
  await tab("/^(Kontroll|Checks)$/");
}

/* ---------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true });
const base = liveUrl ?? (await startPreview());
await startChrome();
await connect();

const results = [];
let failed = false;
const report = (name, m, v) => {
  results.push({ state: name, ...m });
  if (m.fails.length) failed = true;
  const summary = m.tiles.map((t) => `${t.id} ${t.size ?? ""} ${t.w}x${t.h}=${t.px[0]}x${t.px[1]} ${t.aspect}`).join(" · ");
  const s = m.summary;
  const head = s ? `C${s.cols} u${s.u} R${s.rows} board ${s.board[0]}x${s.board[1]} chrome ${s.chrome}` : "";
  console.log(
    `${m.fails.length ? "FAIL" : "ok  "} ${name}  ${head} (${v.cls})\n       ${summary}` +
      (m.fails.length ? "\n  " + m.fails.slice(0, 14).join("\n  ") : ""),
  );
};

for (const scenario of SCENARIOS) {
  const sizes = VIEWPORTS.filter((v) => !scenario.sizes || scenario.sizes.includes(`${v.w}x${v.h}`));
  if (sizes.length === 0) continue;
  await viewport({ w: 1440, h: 900 });
  await openEmpty(DESIGNS[0]);
  if (scenario.ruleset) {
    await setFiles('input[type=file][accept=".ids,.xml,.json"]', [scenario.ruleset]);
    await sleep(500);
  }
  await setFiles('input[type=file][accept=".ifc,.ifczip"]', scenario.files);
  await until(
    `(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && document.querySelectorAll('canvas').length >= ${scenario.files.length}; })()`,
    300000,
    `${scenario.name}: models ready`,
  );
  await sleep(3000);

  for (const design of DESIGNS) {
    for (const v of sizes) {
      await viewport(v);
      await setDesign(design);
      await settle();
      const name = `${design}-${scenario.name}-${v.w}x${v.h}`;
      const m = await evaluate(MEASURE);
      // a (2026-09-26): the requirements are a band of KPI cards on the TOP
      // row of the board, never a list beside the model, and no card
      // scrolls (owner: "add a row of KPI cards at the top rather than the
      // dense left sidebar that needs scrolling").
      if (design === "a") {
        const band = await evaluate(`(() => {
          const grid = document.querySelector('[data-mg-grid]');
          const tiles = [...grid.querySelectorAll(':scope > [data-mg-tile]')];
          const req = tiles.filter((t) => /^(ifc|std)\\d+$|^g-(ifc|std)$/.test(t.dataset.mgTile));
          const top = Math.min(...tiles.map((t) => Number(t.dataset.mgAt.split(',')[1])));
          const scrolls = req.filter((t) => [...t.querySelectorAll('*')].some((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)));
          return {
            mode: grid.dataset.mgBand ?? null,
            list: tiles.some((t) => t.dataset.mgTile === 'reqs'),
            n: req.length,
            onTop: req.every((t) => Number(t.dataset.mgAt.split(',')[1]) === top),
            scrolls: scrolls.map((t) => t.dataset.mgTile),
          };
        })()`);
        if (band.list) m.fails.push("a: the requirements are a list tile, not the KPI band");
        else {
          if (band.n === 0 || !band.onTop) m.fails.push(`a: the requirement cards are not on the top row (${JSON.stringify(band)})`);
          if (band.scrolls.length) m.fails.push(`a: a requirement card scrolls (${band.scrolls.join(", ")})`);
        }
        console.log(`       a band: ${band.mode ?? "narrow fallback"} (${band.n} cards)`);
      }
      await shot(name, v);
      // Rule 8, determinism: another window and back gives the same layout.
      const placeOf = (mm) => JSON.stringify(mm.tiles.filter((t) => !t.id.startsWith("canvas:")).map((t) => [t.id, t.x, t.y, t.w, t.h]));
      await viewport(v.w === 1100 ? { w: 1440, h: 900 } : { w: 1100, h: 800 });
      await settle();
      await viewport(v);
      await settle();
      const again = await evaluate(MEASURE);
      if (placeOf(again) !== placeOf(m)) m.fails.push("rule 8: the same window gave a different layout after a resize round trip");
      report(name, m, v);
      // The Graf tab at rest, both swap states: every canvas inside the bound.
      await graf(name, v);
      await settle();

      // The docked panels: a requirement fills Scope, a Scope row fills
      // Detail, and the grid does not move while it happens. Both empty
      // before; nothing overlays the board after.
      const place = placeOf;
      const grid0 = place(m);
      const empty = await evaluate(DOCKS);
      if (empty.scopeRows !== 0 || empty.detail) m.fails.push(`Scope/Detail not empty at rest (${JSON.stringify(empty)})`);
      const opened = await evaluate(`(() => {
        const first = document.querySelector('[data-mg-grid]');
        const reqs = [...first.querySelectorAll('button[data-req]')];
        const state = (b) => b.querySelector('[data-state]')?.dataset.state ?? '';
        const pick = reqs.find((b) => /fail|warn/.test(state(b)) && b.dataset.req !== 'ifc-schema') ?? reqs[0];
        if (!pick) return null;
        pick.click();
        return pick.dataset.req;
      })()`);
      await sleep(900);
      await settle();
      const mr = await evaluate(MEASURE);
      const docks = await evaluate(DOCKS);
      if (!opened) mr.fails.push("no requirement to click");
      if (docks.scopeRows <= 0) mr.fails.push(`a requirement click (${opened}) left Scope empty`);
      if (docks.band) mr.fails.push("a band overlays the board");
      if (place(mr) !== grid0) mr.fails.push("the tiles moved when Scope filled");
      report(`${name}-req`, mr, v);
      await evaluate(`(() => { const r = document.querySelector('[data-dock="scope"] [data-guid]'); r && r.click(); return !!r; })()`);
      await sleep(900);
      await settle();
      const ms = await evaluate(MEASURE);
      const picked = await evaluate(DOCKS);
      if (!picked.detail) ms.fails.push("a Scope row left Detail empty");
      if (place(ms) !== grid0) ms.fails.push("the tiles moved when Detail filled");
      await shot(`${name}-selected`, v);
      report(`${name}-selected`, ms, v);
      // Step back out (the same row again), clear, for the next state.
      await evaluate(`(() => { const r = document.querySelector('[data-dock="scope"] [data-guid]'); r && r.click(); return true; })()`);
      await sleep(400);
      await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm filter|Clear filter)$/.test(x.textContent.trim())); b && b.click(); return true; })()`);
      await setDesign(design);
    }
  }
}

writeFileSync(resolve(OUT, "report.json"), JSON.stringify({ base, results, exceptions: logs }, null, 2));
if (logs.length) {
  console.log(`page exceptions (${logs.length}):\n  ${logs.slice(0, 5).join("\n  ")}`);
  failed = true;
}
console.log(failed ? "module grid gate: FAILED" : "module grid gate: all states pass");
ws.close();
process.exit(failed ? 1 : 0);
