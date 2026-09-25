/** The MODULE GRID gate for the design alternatives (`#design=a|b|c`).
 *
 * Drops real KNM models into ONE headless Chrome (a LOCAL `vite preview`
 * build unless `--url`), and at every viewport class, for a, b and c,
 * asserts on the RENDERED board:
 *
 *  - the column count is the rule's (`mgColumns` of the grid's own width)
 *  - every tile edge lands on the grid: left and top on a whole column / row
 *    pitch from the grid's origin, width w·pitch − gutter, height h·48 − 16,
 *    within 1 px, and no tile past the last column
 *  - every tile's rendered aspect is inside its kind's bounds (`MG_ASPECT`);
 *    a kind not in the vocabulary fails
 *  - a group title row (c) spans the grid and is one row tall
 *  - no `[data-essential]` value is cut inside a tile (cramped content)
 *  - no sideways page scroll
 *
 * Also: `a` with a derivation open (the band docked in the inspector), and
 * the three-model + test-floor-config scenario at 1440 and 2112.
 *
 * Screenshots to `--out` (default tmp/alternatives/):
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
import { MG_ASPECT, MG_GUTTER, MG_MIN_PITCH, MG_PITCH_Y, MG_ROW } from "../src/ui/alt/module-grid.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = 4181;
const CDP = 9335;
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
const OUT = resolve(opt("out") ?? resolve(ROOT, "tmp/alternatives"));
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
  { w: 2560, h: 1440, cls: "wide, capped at 2400" },
].filter((v) => !only || only.includes(`${v.w}x${v.h}`));

const floorsRuleset = resolve(ROOT, "examples/knm-floors.test.ruleset.json");
const SCENARIOS = [
  { name: "one", files: ["KNM_ARK.ifc"], ruleset: null, sizes: null },
  {
    name: "three",
    files: ["KNM_ARK.ifc", "KNM_RIV.ifc", "KNM_RIB.ifc"],
    ruleset: floorsRuleset,
    sizes: ["1440x900", "2112x1267"],
  },
].filter((s) => !onlyScenario || s.name === onlyScenario);

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

const MEASURE = `(() => {
  const ASPECT = ${JSON.stringify(MG_ASPECT)};
  const G = ${MG_GUTTER}, PY = ${MG_PITCH_Y}, ROW = ${MG_ROW}, MINP = ${MG_MIN_PITCH};
  const fails = [];
  const grids = [...document.querySelectorAll('[data-mg-grid]')].filter((g) => g.offsetParent !== null);
  if (grids.length === 0) return { fails: ['no visible [data-mg-grid]'], tiles: [] };
  const tiles = [];
  for (const grid of grids) {
    const cols = Number(grid.dataset.mgCols);
    const g = grid.getBoundingClientRect();
    const pitch = (g.width + G) / cols;
    const want = 12 * Math.min(3, Math.max(1, Math.floor((g.width + G) / (12 * MINP))));
    if (cols !== want) fails.push('grid ' + g.width.toFixed(0) + 'px has ' + cols + ' columns, the rule says ' + want);
    for (const el of grid.querySelectorAll(':scope > [data-mg-tile]')) {
      const r = el.getBoundingClientRect();
      const id = el.dataset.mgTile, kind = el.dataset.mgKind;
      const x = r.left - g.left, y = r.top - g.top;
      const i = Math.round(x / pitch), j = Math.round(y / PY);
      const w = Math.round((r.width + G) / pitch), h = Math.round((r.height + G) / PY);
      const at = id + ' [' + i + ',' + j + ' ' + w + 'x' + h + ']';
      if (Math.abs(x - i * pitch) > 1) fails.push(at + ': left off the column grid by ' + (x - i * pitch).toFixed(1) + 'px');
      if (Math.abs(y - j * PY) > 1) fails.push(at + ': top off the row grid by ' + (y - j * PY).toFixed(1) + 'px');
      if (Math.abs(r.width - (w * pitch - G)) > 1) fails.push(at + ': width ' + r.width.toFixed(1) + ' is not ' + w + ' columns');
      if (Math.abs(r.height - (h * PY - G)) > 1) fails.push(at + ': height ' + r.height.toFixed(1) + ' is not ' + h + ' rows');
      if (i + w > cols) fails.push(at + ': past column ' + cols);
      const aspect = r.width / r.height;
      const b = ASPECT[kind];
      if (!b) fails.push(at + ': kind "' + kind + '" is not in the tile vocabulary');
      else if (aspect < b.min - 0.005 || aspect > b.max + 0.005)
        fails.push(at + ': aspect ' + aspect.toFixed(2) + ' outside ' + kind + ' ' + b.min + '..' + b.max);
      for (const e of el.querySelectorAll('[data-essential]')) {
        if (e.offsetParent === null) continue;
        if (e.scrollWidth > e.clientWidth + 1)
          fails.push(at + ': value cut, "' + e.textContent.trim().slice(0, 40) + '"');
      }
      tiles.push({ id, kind, x: i, y: j, w, h, px: [Math.round(r.width), Math.round(r.height)], aspect: +aspect.toFixed(2) });
    }
    for (const el of grid.querySelectorAll(':scope > [data-mg-row]')) {
      const r = el.getBoundingClientRect();
      const y = r.top - g.top;
      if (Math.abs(r.left - g.left) > 1 || Math.abs(r.width - g.width) > 1) fails.push('row ' + el.dataset.mgRow + ': not full width');
      if (Math.abs(y - Math.round(y / PY) * PY) > 1) fails.push('row ' + el.dataset.mgRow + ': off the row grid');
      if (Math.abs(r.height - ROW) > 1) fails.push('row ' + el.dataset.mgRow + ': not one row tall');
    }
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) fails.push('page scrolls sideways');
  const grid = grids[0];
  return { fails, tiles, cols: Number(grid.dataset.mgCols), pitch: Number(grid.dataset.mgPitch), width: Math.round(grid.getBoundingClientRect().width) };
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
  const summary = m.tiles
    .filter((t) => !/^(storey|class)\d+$/.test(t.id) || /^(storey|class)0$/.test(t.id))
    .map((t) => `${t.id} ${t.w}x${t.h}=${t.px[0]}x${t.px[1]} ${t.aspect}`)
    .join(" · ");
  console.log(
    `${m.fails.length ? "FAIL" : "ok  "} ${name}  C${m.cols} pitch ${Number(m.pitch).toFixed(1)} (${v.cls})\n       ${summary}` +
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

  for (const design of DESIGNS) {
    for (const v of sizes) {
      await viewport(v);
      await setDesign(design);
      await settle();
      const name = `${design}-${scenario.name}-${v.w}x${v.h}`;
      const m = await evaluate(MEASURE);
      await shot(name, v);
      report(name, m, v);

      // a: open the first failing check, so the band docks in the inspector.
      if (design === "a" && scenario.name === "one") {
        await evaluate(`(() => {
          const row = [...document.querySelectorAll('[data-mg-tile="list"] button')].find((b) => /Avvik|Deviation/.test(b.textContent));
          row && row.click();
          return !!row;
        })()`);
        await sleep(800);
        await settle();
        const mb = await evaluate(MEASURE);
        if (!mb.tiles.some((t) => t.id === "band")) mb.fails.push("no docked band after opening a check");
        await shot(`${name}-band`, v);
        report(`${name}-band`, mb, v);
        await setDesign(design);
      }
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
