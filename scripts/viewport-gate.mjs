/** The viewport gate: does tab 1 read as a whole dashboard at every target
 *  screen, with real models in it?
 *
 * Drops real KNM models into the app in ONE headless Chrome, then walks every
 * target viewport, both tabs, and asserts:
 *
 *   overflow   no horizontal overflow of the page or of the scrolling main
 *   clip       no `[data-essential]` element is cut: neither ellipsized inside
 *              itself (scrollWidth > clientWidth) nor pushed past the edge of
 *              an ancestor that clips (model names, check names, values,
 *              deltas, KPI labels and numbers, gauge levels)
 *   rows       each tile shows at least its kind's minimum of list rows,
 *              fully, without scrolling (focal: every universal check; floors:
 *              every row of the config on the 8×3 tile both boards now carry;
 *              gauge: all four levels; KPI strip: all seven cards)
 *   fill       a board shorter than the page height it was given has its row
 *              unit already at the ceiling its own placed tiles allow — a
 *              surplus that is structural, never a module that declined to
 *              grow. The band is printed either way, passing or not.
 *   hidden     no tile hides content below or beside its box unless the box
 *              scrolls (a scroll container IS the affordance); `overflow:
 *              hidden` with more content than box is a failure
 *
 * Screenshots per viewport and state go to tmp/viewports/: `<state>.png` is
 * the screen as seen, `<state>-full.png` the whole scrolled page (same width,
 * so the layout is identical; only the band's dvh height differs).
 *
 * What it proves: the layout mechanism against a build or a deployed URL.
 * Against the local preview it is NOT proof of the deployed site; pass the
 * live URL for that.
 *
 * RAM: one Chrome at a time, launched only with >= 4 GB free physical memory;
 * the gate kills only the Chrome and the preview server it started.
 *
 * Run:   npm run build && node scripts/viewport-gate.mjs
 *        node scripts/viewport-gate.mjs --url https://ifc-check.skiplum.com
 *        [--only 1280x720,1920x1080] [--scenario one|three] [--models DIR]
 *        [--design a|b|c]   measure a visual direction instead of the default;
 *                           its screenshots land in tmp/viewports/<design>/
 * Exit:  0 every assertion holds · 1 an assertion failed · 2 usage/internal.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFundamentals } from "../src/engine/fundamentals.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_BASE = resolve(ROOT, "tmp/viewports");
const PORT = 4179;
const CDP = 9333;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MODELS =
  "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const liveUrl = opt("url");
const modelsDir = opt("models") ?? DEFAULT_MODELS;
const only = opt("only")?.split(",");
const onlyScenario = opt("scenario");
/** Which visual direction to measure. Absent is the shipped default, and the
 *  default is what the gate has always measured. A direction is a skin over
 *  the same board, so every assertion here applies to it unchanged — a type
 *  scale or a radius that clips a value is exactly what this catches. */
const design = opt("design");
if (design !== undefined && !["a", "b", "c"].includes(design)) {
  console.error(`--design takes a, b or c (given: ${design})`);
  process.exit(2);
}
const hash = design ? `#lang=nb&design=${design}` : "#lang=nb";

/** Screenshots per direction, so a run on b does not overwrite the evidence
 *  from a run on a. */
const OUT = design ? resolve(OUT_BASE, design) : OUT_BASE;

/** CSS px viewports. `iframe` marks the skiplum.com embed boxes: the app lays
 *  out against its own box, so an iframe of that size and a viewport of that
 *  size are the same layout input. */
const VIEWPORTS = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1536, h: 864 },
  { w: 1680, h: 1050 },
  { w: 1920, h: 1080 },
  { w: 1920, h: 1200 },
  { w: 2112, h: 1267 },
  { w: 2560, h: 1440 },
  { w: 2048, h: 1152, dpr: 1.25 },
  { w: 3440, h: 1440 },
  { w: 1100, h: 800, iframe: true },
  { w: 1200, h: 900, iframe: true },
].filter((v) => !only || only.includes(`${v.w}x${v.h}`));

const floorsRuleset = resolve(ROOT, "examples/knm-floors.test.ruleset.json");
const SCENARIOS = [
  { name: "one", files: ["KNM_ARK.ifc"], ruleset: null },
  { name: "three", files: ["KNM_ARK.ifc", "KNM_RIV.ifc", "KNM_RIB.ifc"], ruleset: floorsRuleset },
].filter((s) => !onlyScenario || s.name === onlyScenario);

/** Minimum list rows fully visible per tile, by tile id.
 *
 * `floors` is the one that is not constant. Both boards seat the Etasjer tile
 * at 8×3 and the scenario's config is ten floors; five of ten behind an inner
 * scrollbar is exactly what edkjo reported on 2026-09-22 ("squished floor
 * chart"), so from 1440 px of viewport up the tile owes its WHOLE content.
 * Below that the tile's box, minus a header that does not scale, cannot hold
 * every line without dropping the row under the 20 px legibility floor, so
 * the requirement is the old six and the rest scrolls. The scenario's own row
 * count caps both, so a smaller fixture cannot pass this vacuously.
 *
 * `10` is the fixture, not a constant of the tile: a fifteen-floor project
 * scrolls, and that is the tile's honest capacity, not a defect. */

/** The rows the verification tile owes with no ruleset loaded: the twelve
 *  fundamentals plus `mesh-placement` and `storey-config`. Derived from the
 *  shipped list rather than typed, so adding a fundamental cannot leave this
 *  gate measuring the old count and reporting a full tile. */
const UNIVERSAL_CHECKS =
  runFundamentals(
    { products: [], storeys: [], sites: [], buildings: [], projects: [], spaces: [],
      contained_in: [], aggregates: [], storey_building: [], voids: [], schema: "IFC4",
      project_name: null },
    { schema: "IFC4", path: "", size_bytes: 0, products: 0, storeys: 0, project_name: null,
      authoring_app: null, length_unit: "METRE", unit_scale: 1, unit_resolved: true,
      duplicate_step_ids: 0, parse_seconds: 0, warnings: [], tables: {} },
  ).length + 2;
const MIN_ROWS = { verify: UNIVERSAL_CHECKS, floors: 6, spatial: 4, kpis: 7 };
const FLOORS_FULL_FROM_WIDTH = 1440;
const FLOORS_FULL_ROWS = 10;
const minRowsFor = (v) => ({
  ...MIN_ROWS,
  floors: v.w >= FLOORS_FULL_FROM_WIDTH ? FLOORS_FULL_ROWS : MIN_ROWS.floors,
});

/* ------------------------------------------------------------ processes */

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

/** Wait until layout stops moving: two identical measurements in a row. */
async function settle() {
  let last = "";
  for (let i = 0; i < 20; i += 1) {
    await sleep(250);
    const now = await evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-tile-id]')].map(t => { const r = t.getBoundingClientRect(); return [r.width|0, r.height|0]; }))`,
    );
    if (now === last) return;
    last = now;
  }
}

async function shot(name, v) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, "base64"));
  // The page scrolls inside <main>, so a full-page capture sees one screen.
  // Grow the viewport to the content height instead: the width is unchanged,
  // so the board's layout (width-derived) is identical.
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

/* ----------------------------------------------------------- assertions */

/** Runs in the page. Returns a list of failure strings for the visible tab. */
const MEASURE = (minRows) => `(() => {
  const MIN = ${JSON.stringify(minRows)};
  const fails = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) fails.push('overflow: page ' + de.scrollWidth + ' > ' + de.clientWidth);
  const main = document.querySelector('main');
  if (main && main.scrollWidth > main.clientWidth + 1) fails.push('overflow: main ' + main.scrollWidth + ' > ' + main.clientWidth);

  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const clips = (s) => s.overflowX !== 'visible' || s.overflowY !== 'visible';
  const label = (el) => (el.closest('[data-tile-id]')?.getAttribute('data-tile-id') ?? 'page') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"';
  const panel = document.querySelector('[role=tabpanel]:not([hidden])');

  // clip — essential text is never cut.
  for (const el of document.querySelectorAll('[data-essential]')) {
    if (!visible(el)) continue;
    if (el.closest('[role=tabpanel][hidden]')) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      fails.push('clip: ' + label(el) + ' ellipsized ' + el.scrollWidth + ' > ' + el.clientWidth);
      continue;
    }
    const r = el.getBoundingClientRect();
    // A row scrolled out of its list is not cut, it is scrolled; only the
    // horizontal axis is judged against clipping ancestors.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!clips(s)) continue;
      const ar = a.getBoundingClientRect();
      if (r.right > ar.right + 1 || r.left < ar.left - 1) {
        fails.push('clip: ' + label(el) + ' runs past ' + (a.getAttribute('data-tile-id') || a.tagName.toLowerCase()) + ' (' + Math.round(r.right) + ' > ' + Math.round(ar.right) + ')');
        break;
      }
      if (a.hasAttribute('data-tile-id')) break;
    }
  }

  // fill — the board uses the page height it was given, or says why it cannot.
  // A board shorter than its space is honest only when the row unit has
  // already reached the ceiling its own placed tiles admit
  // (\`bentoRowFactorRange\`): then the leftover is structural, the composition
  // having no more rows to give. Any other short board is the dead cream band
  // edkjo hit on 2026-09-22, and it fails here.
  let board = null;
  const canvas = panel?.querySelector('[data-bento-canvas]');
  if (canvas) {
    const box = canvas.getBoundingClientRect();
    const space = Number(canvas.getAttribute('data-bento-space') || 0);
    const cols = Number(canvas.getAttribute('data-bento-cols'));
    const range = (canvas.getAttribute('data-bento-row-range') || '').split(':').map(Number);
    // The track and the row unit are read back off the board itself: the KPI
    // strip is exactly one row tall and the canvas is exactly \`cols\` tracks
    // plus its gaps wide, so no CSS variable has to be resolved by hand.
    const strip = canvas.querySelector('[data-tile-id=kpis]');
    const track = box.width / (cols + (cols - 1) / 10);
    const f = strip && track > 0 ? strip.getBoundingClientRect().height / track : null;
    board = {
      h: Math.round(box.height),
      space,
      band: space > 0 ? Math.round(space - box.height) : null,
      f: f === null ? null : Number(f.toFixed(3)),
      fmax: range[1] ?? null,
    };
    if (space > 0 && box.height < space - 24 && (f === null || f < range[1] - 0.02)) {
      fails.push(
        'fill: board ' + Math.round(box.height) + 'px of ' + space + 'px, row unit ' +
        (f === null ? '?' : f.toFixed(3)) + ' still under its ' + range[1] + ' ceiling',
      );
    }
  }

  // Tiles only exist on tab 1.
  const tiles = [...(panel?.querySelectorAll('[data-tile-id]') ?? [])].filter(visible);
  const stats = {};
  for (const tile of tiles) {
    const id = tile.getAttribute('data-tile-id');
    const tr = tile.getBoundingClientRect();
    stats[id] = { w: Math.round(tr.width), h: Math.round(tr.height) };

    // hidden — a clipping box with more content than room and no scroll.
    const boxes = [tile, ...tile.querySelectorAll('*')].filter(visible);
    for (const box of boxes) {
      if (box.tagName === 'CANVAS' || box.closest('canvas')) continue;
      const s = getComputedStyle(box);
      const hideX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      const hideY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (hideY && box.scrollHeight > box.clientHeight + 2) {
        fails.push('hidden: ' + id + ' ' + box.tagName.toLowerCase() + '.' + (box.className?.toString().split(' ').slice(0, 3).join('.') ?? '') + ' hides ' + (box.scrollHeight - box.clientHeight) + 'px below, no scroll');
      }
      if (hideX && box.scrollWidth > box.clientWidth + 2 && !(s.textOverflow === 'ellipsis')) {
        fails.push('hidden: ' + id + ' ' + box.tagName.toLowerCase() + ' hides ' + (box.scrollWidth - box.clientWidth) + 'px beside, no scroll');
      }
      // Two-axis scroll inside a tile is never allowed.
      const scrollX = (s.overflowX === 'auto' || s.overflowX === 'scroll') && box.scrollWidth > box.clientWidth + 2;
      if (scrollX) fails.push('hscroll: ' + id + ' scrolls sideways ' + box.scrollWidth + ' > ' + box.clientWidth);
    }

    // rows — fully visible inside the tile's own list viewport.
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      let top = tr.top, bottom = tr.bottom;
      for (let a = el.parentElement; a && a !== tile.parentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      // A sticky header over the list covers its first row's slot.
      return r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1;
    };
    let rows = [];
    if (id === 'verify') rows = [...tile.querySelectorAll('button')].slice(0, ${UNIVERSAL_CHECKS});
    else if (id === 'floors') rows = [...tile.querySelectorAll('tbody tr')];
    else if (id === 'spatial') rows = [...tile.querySelectorAll('[data-essential]')].filter((e) => e.classList.contains('truncate'));
    else if (id === 'kpis') rows = [...tile.querySelectorAll(':scope > div > *')];
    const total = rows.length;
    const seen = rows.filter(inside).length;
    const need = Math.min(MIN[id] ?? 0, total);
    stats[id].rows = seen + '/' + total;
    // The row budget in its own terms: what one list row really measures (the
    // \`--bento-line\` ladder plus whatever the markup adds to it) against the
    // scroll box it has to fit in. A tile one row short is otherwise a number
    // with no cause attached.
    if (rows.length > 0) {
      const scroller = rows[0].closest('[class*=overflow-auto]') ?? tile;
      stats[id].line = Math.round(rows[0].getBoundingClientRect().height * 10) / 10;
      stats[id].list = Math.round(scroller.getBoundingClientRect().height);
    }
    if (seen < need) fails.push('rows: ' + id + ' shows ' + seen + ' of ' + total + ', needs ' + need);
  }
  return { fails, stats, board, tab: panel ? (panel.querySelector('[data-tile-id]') ? 'checks' : 'contents') : 'none' };
})()`;

/** Open the app and empty it: the session a previous scenario left is
 *  restored on load, so "Tøm alle" is pressed until the landing shows. */
async function openEmpty() {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}${hash}` });
  await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
  await sleep(1500);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`);
  await until(`!document.querySelector('[role=tablist]') && !/Tøm alle|Clear all/.test(document.body.innerText)`, 30000, "empty landing");
}

/* ---------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true });
const base = liveUrl ?? (await startPreview());
await startChrome();
await connect();

const results = [];
let failed = false;

// Landing, before any model: the app bar and drop zone at phone width too.
for (const v of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
  await viewport(v);
  await openEmpty();
  await settle();
  const m = await evaluate(MEASURE(minRowsFor(v)));
  const name = `landing-${v.w}x${v.h}`;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, "base64"));
  results.push({ state: name, fails: m.fails });
  if (m.fails.length) failed = true;
  console.log(`${m.fails.length ? "FAIL" : "ok  "} ${name}${m.fails.length ? "\n  " + m.fails.join("\n  ") : ""}`);
}

for (const scenario of SCENARIOS) {
  await viewport(VIEWPORTS[0] ?? { w: 1440, h: 900 });
  await openEmpty();
  if (scenario.ruleset) {
    await setFiles('input[type=file][accept=".ids,.xml,.json"]', [scenario.ruleset]);
    await sleep(500);
  }
  await setFiles(
    'input[type=file][accept=".ifc,.ifczip"]',
    scenario.files.map((f) => resolve(modelsDir, f)),
  );
  await until(
    `(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && document.querySelectorAll('canvas').length >= ${scenario.files.length}; })()`,
    300000,
    `${scenario.name}: models ready`,
  );
  await sleep(3000);

  for (const v of VIEWPORTS) {
    await viewport(v);
    for (const tab of ["checks", "contents"]) {
      await evaluate(`(() => {
        const want = ${JSON.stringify(tab)} === 'checks' ? /Kontroll|Checks/ : /Innhold|Contents/;
        const b = [...document.querySelectorAll('[role=tab]')].find((x) => want.test(x.textContent));
        if (b && b.getAttribute('aria-selected') !== 'true') b.click();
        document.querySelector('main')?.scrollTo(0, 0);
        return true;
      })()`);
      await settle();
      const m = await evaluate(MEASURE(minRowsFor(v)));
      const name = `${scenario.name}-${tab}-${v.w}x${v.h}${v.dpr ? `@${v.dpr}` : ""}${v.iframe ? "-iframe" : ""}`;
      await shot(name, v);
      results.push({ state: name, fails: m.fails, tiles: m.stats, board: m.board });
      if (m.fails.length) failed = true;
      const tiles = Object.entries(m.stats)
        .map(
          ([id, s]) =>
            `${id} ${s.w}x${s.h}${s.rows ? ` ${s.rows}` : ""}${s.line ? ` @${s.line}/${s.list}` : ""}`,
        )
        .join(" · ");
      // The band is printed even when it passes: a surplus the composition
      // cannot take is a real finding about the board, and a number nobody
      // sees is how it goes back to being invisible.
      const b = m.board;
      const band =
        b && b.band !== null
          ? `  board ${b.h}/${b.space}px${b.band > 24 ? ` band ${b.band}px @ row ${b.f}/${b.fmax}` : ""}`
          : "";
      console.log(
        `${m.fails.length ? "FAIL" : "ok  "} ${name}${band}${tiles ? `  [${tiles}]` : ""}` +
          (m.fails.length ? "\n  " + m.fails.slice(0, 12).join("\n  ") : ""),
      );
    }
  }
}

writeFileSync(resolve(OUT, "report.json"), JSON.stringify({ base, results, exceptions: logs }, null, 2));
if (logs.length) {
  console.log(`page exceptions (${logs.length}):\n  ${logs.slice(0, 5).join("\n  ")}`);
  failed = true;
}
console.log(failed ? "viewport gate: FAILED" : "viewport gate: all states pass");
ws.close();
process.exit(failed ? 1 : 0);
