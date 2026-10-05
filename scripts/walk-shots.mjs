/** The Oppsett walk, rendered: every screen of the walk in a real browser, at
 *  the owner's screen and a laptop, screenshotted and measured, so a design
 *  pass looks at what it changed instead of trusting tsc (2026-10-05, edkjo
 *  on two screens built blind: "is this great UI?").
 *
 * One Vite DEV server (its own cache dir under tmp/, so another checkout's
 * dev server is not disturbed) and ONE headless Chrome with ONE page. Three
 * states, each from cleared storage:
 *
 *   a  fresh, no saved ruleset: the choice, «Egendefinert», the IFC stage, a
 *      model dropped, then every step answered with its primary («Bruk», the
 *      pressed plane) to Oppsummering; extras: a chip's popover, the insert
 *      menu, «Endre», «Avansert», TFM's Lokasjon popover
 *   b  a model on the board, «POFIN»: the prompt, «Aksepter oppsett» →
 *      Oppsummering; again from clear, «POFIN» → «Gjennomgå», every step
 *      skipped through (pinned to POFIN's sources)
 *   c  a saved ruleset from another project in localStorage
 *      (tests/fixtures/private/*knm*.ruleset.json): the IFC stage, a Revit
 *      export with free-text type names dropped, every step skipped through
 *
 * Every screen is taken at every viewport before moving on (the step stays,
 * only the window changes). Per screen it measures the walk's content block
 * against the viewport (share of width and height, top offset), whether the
 * walk scrolls, and asserts no horizontal scroll of the page or the walk.
 *
 * Output: <out>/<round>/<WxH>/<state>-<nn>-<step>.png and measure.json, plus
 * a table on stdout. Default <out> is the MAIN checkout's tmp/walk-pass, so a
 * worktree's screenshots outlive it.
 *
 * RAM: Chrome starts only with >= 3.5 GB free physical memory. Only the
 * processes this script started are stopped (by PID), on exit and on error.
 *
 * Run:   node scripts/walk-shots.mjs --round round1
 *        [--states a,b,c] [--vp 2560x1280,1440x900] [--out DIR]
 *        [--model PATH] [--revit PATH] [--saved PATH] [--port 5191]
 * Exit:  0 shots taken, no horizontal scroll · 1 a horizontal scroll ·
 *        2 usage/internal.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const ROUND = opt("round") ?? "round";
const OUT = resolve(opt("out") ?? "C:/workspace/toolkit/ifc-check/tmp/walk-pass", ROUND);
const STATES = (opt("states") ?? "a,b,c,s").split(",");
const VIEWPORTS = (opt("vp") ?? "2092x1165,2560x1280,1440x900").split(",").map((s) => {
  const [w, h] = s.split("x").map(Number);
  return { w, h, name: s };
});
const PORT = Number(opt("port") ?? 5191);
const CDP = Number(opt("cdp") ?? 9341);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MODEL = opt("model") ?? "C:/workspace/skiplum/client-projects/10001-sophies-minde/models/2026-04-30_mmi500/OBF_400520_03_6_ARK.ifc";
const REVIT =
  opt("revit") ?? "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14/KNM_RIB.ifc";
const PRIVATE = existsSync(resolve(ROOT, "tests/fixtures/private"))
  ? resolve(ROOT, "tests/fixtures/private")
  : "C:/workspace/toolkit/ifc-check/tests/fixtures/private";
const SAVED =
  opt("saved") ??
  (existsSync(PRIVATE) ? readdirSync(PRIVATE).filter((f) => /knm.*\.ruleset\.json$/i.test(f)).map((f) => resolve(PRIVATE, f))[0] : undefined);

for (const p of [MODEL, ...(STATES.includes("c") ? [REVIT, SAVED] : [])]) {
  if (!p || !existsSync(p)) {
    console.error(`missing input: ${p}`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------ processes */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freeGb() {
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
  return freemem() / 1024 ** 3;
}

const started = [];
let vite = null;
function cleanup() {
  for (const child of started) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  }
  started.length = 0;
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

async function startVite() {
  const { createServer } = await import(`file:///${resolve(ROOT, "node_modules/vite/dist/node/index.js").replace(/\\/g, "/")}`);
  vite = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, "vite.config.ts"),
    cacheDir: resolve(ROOT, "tmp/.vite-walk"),
    logLevel: "error",
    server: { port: PORT, strictPort: true, host: "127.0.0.1" },
  });
  await vite.listen();
  const url = `http://127.0.0.1:${PORT}/`;
  await waitHttp(url, 30000);
  return url;
}

async function startChrome() {
  const free = freeGb();
  if (free < 3.5) {
    console.error(`only ${free} GB free physical memory; Chrome starts at >= 3.5 GB`);
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
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  started.push(child);
  console.log(`chrome pid ${child.pid}`);
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000);
}

/* ------------------------------------------------------------------ CDP */

let ws;
let seq = 0;
const pending = new Map();
const errors = [];

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
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  // Reduced motion: the pick-in animation is not mid-flight in a shot.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
}

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function until(expr, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return;
    await sleep(300);
  }
  throw new Error(`timeout: ${label}`);
}

async function setFiles(selector, paths) {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no element for ${selector}`);
  await send("DOM.setFileInputFiles", { nodeId, files: paths.map((p) => resolve(p)) });
}

async function viewport(v) {
  await send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false });
}

/** The walk's content block: everything between the optical-centre spacers. */
const CONTENT = `(document.querySelector('[data-walk-content]') || document.querySelector('[data-walk] > div > div:nth-child(2)'))`;

async function settle() {
  let last = "";
  for (let i = 0; i < 20; i += 1) {
    await sleep(200);
    const now = await evaluate(
      `(() => { const c = ${CONTENT}; if (!c) return 'none'; const r = c.getBoundingClientRect(); return [r.x|0, r.y|0, r.width|0, r.height|0, document.querySelectorAll('*').length].join(','); })()`,
    );
    if (now === last) return;
    last = now;
  }
}

/** One grid for every box on a step (2026-10-05, edkjo: "misaligned boxes"):
 *  the step's panels (`[data-panel]`, outermost only) grouped in rows by
 *  top edge; in a row the bottoms agree and the gaps are equal; the row's
 *  right edge is the frame's, and its left edge too unless the step's name
 *  (TO) holds the left; the progress bar and the action row share the
 *  frame's edges; the gaps between rows are equal. 1 px tolerance. */
const GRID = `(() => {
  const T = 1;
  const content = document.querySelector('[data-walk-content]');
  if (!content) return { pass: true, fails: [], rows: 0 };
  const f = content.getBoundingClientRect();
  const fails = [];
  const vis = (el) => el.getClientRects().length > 0;
  const panels = [...content.querySelectorAll('[data-panel]')].filter((el) => vis(el) && !el.parentElement.closest('[data-panel]'));
  const boxes = panels.map((el) => ({ el, r: el.getBoundingClientRect() }));
  const rows = [];
  for (const b of boxes.sort((a, c) => a.r.top - c.r.top || a.r.left - c.r.left)) {
    const row = rows.find((r) => Math.abs(r[0].r.top - b.r.top) <= T);
    if (row) row.push(b); else rows.push([b]);
  }
  rows.forEach((row, i) => {
    row.sort((a, c) => a.r.left - c.r.left);
    const bottoms = row.map((b) => b.r.bottom);
    if (Math.max(...bottoms) - Math.min(...bottoms) > T) fails.push('row ' + i + ' bottoms ' + bottoms.map(Math.round).join('/'));
    const gaps = row.slice(1).map((b, k) => b.r.left - row[k].r.right);
    if (gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) > T) fails.push('row ' + i + ' gaps ' + gaps.map(Math.round).join('/'));
    const last = row[row.length - 1].r;
    if (Math.abs(last.right - f.right) > T) fails.push('row ' + i + ' right ' + Math.round(last.right) + ' vs ' + Math.round(f.right));
    const first = row[0].r;
    const to = row[0].el.closest('[data-mapping-row]')?.querySelector('[data-zone=to]');
    const left = to && to.getBoundingClientRect().top <= first.bottom ? to.getBoundingClientRect().left : first.left;
    if (Math.abs(left - f.left) > T) fails.push('row ' + i + ' left ' + Math.round(left) + ' vs ' + Math.round(f.left));
  });
  const vgaps = rows.slice(1).map((row, i) => Math.round(row[0].r.top - Math.max(...rows[i].map((b) => b.r.bottom))));
  if (vgaps.length > 1 && Math.max(...vgaps) - Math.min(...vgaps) > T) fails.push('row gaps ' + vgaps.join('/'));
  for (const [name, sel] of [['bar', '[data-walk-progress]'], ['actions', '[data-walk-actions]']]) {
    const el = document.querySelector(sel);
    if (!el || !vis(el)) continue;
    const r = (name === 'bar' ? el.parentElement : el).getBoundingClientRect();
    if (Math.abs(r.left - f.left) > T || Math.abs(r.right - f.right) > T) fails.push(name + ' edges ' + Math.round(r.left) + '..' + Math.round(r.right) + ' vs ' + Math.round(f.left) + '..' + Math.round(f.right));
  }
  return { pass: fails.length === 0, fails, rows: rows.length, vgaps };
})()`;

const MEASURE = `(() => {
  const de = document.documentElement;
  const walk = document.querySelector('[data-walk]');
  const c = ${CONTENT};
  const vw = de.clientWidth, vh = de.clientHeight;
  const r = c ? c.getBoundingClientRect() : null;
  const sec = document.querySelector('[data-walk] section[aria-label]');
  return {
    step: sec ? sec.getAttribute('aria-label') : null,
    vw, vh,
    x: r ? Math.round(r.x) : null, y: r ? Math.round(r.y) : null,
    w: r ? Math.round(r.width) : null, h: r ? Math.round(r.height) : null,
    pageScrollX: de.scrollWidth > de.clientWidth + 1,
    walkScrollX: walk ? walk.scrollWidth > walk.clientWidth + 1 : false,
    walkScrollsY: walk ? walk.scrollHeight > walk.clientHeight + 1 : false,
    titleY: (() => { const h = document.querySelector('[data-walk] h1'); return h ? Math.round(h.getBoundingClientRect().top) : null; })(),
    confirmInView: (() => { const b = document.querySelector('[data-step-confirm], [data-pofin-accept]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.bottom <= vh && r.top >= 0; })(),
    // The action row with the content: its gap to what is above it.
    actionsGap: (() => {
      const a = document.querySelector('[data-walk-actions]');
      const sec = document.querySelector('[data-walk] section[aria-label]');
      if (!a || !sec) return null;
      return Math.round(a.getBoundingClientRect().top - sec.getBoundingClientRect().bottom);
    })(),
    actionsStuck: (() => {
      const a = document.querySelector('[data-walk-actions]');
      const sec = document.querySelector('[data-walk] section[aria-label]');
      if (!a || !sec) return null;
      return a.getBoundingClientRect().top < sec.getBoundingClientRect().bottom - 1;
    })(),
    grid: ${GRID},
    bar: [...document.querySelectorAll('header button, header a')].filter((b) => b.getClientRects().length > 0).map((b) => (b.textContent || '').trim()).filter(Boolean),
  };
})()`;

const rows = [];
const checks = [];
let failed = false;

/** The summary's row for a step: set (●) or not, and its text. */
const summaryRow = (label) =>
  evaluate(`(() => { const li = document.querySelector('[data-row="${label}"]'); return li ? { done: li.getAttribute('data-done'), text: li.textContent.trim() } : null; })()`);

const slug = (s) =>
  (s ?? "none")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The screen as it stands, at every viewport, then back to the first. */
async function shoot(state, name) {
  for (const v of VIEWPORTS) {
    await viewport(v);
    await settle();
    const m = await evaluate(MEASURE);
    const dir = resolve(OUT, v.name);
    mkdirSync(dir, { recursive: true });
    const file = `${state}-${name}.png`;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(dir, file), Buffer.from(data, "base64"));
    rows.push({ state, name, vp: v.name, file, ...m });
    if (m.pageScrollX || m.walkScrollX) failed = true;
  }
  await viewport(VIEWPORTS[0]);
  await settle();
}

async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
  if (!ok) throw new Error(`no element to click: ${selector}`);
  await settle();
}

const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
const stepName = () => evaluate(`document.querySelector('[data-walk] section[aria-label]')?.getAttribute('aria-label') ?? null`);

async function fresh(url, hash, before = null) {
  const origin = new URL(url).origin;
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await send("Page.navigate", { url: `${url}#lang=nb` });
  await until(`document.readyState === 'complete' && !!document.querySelector('header')`, 30000, "app");
  if (before) {
    await evaluate(before);
  }
  await send("Page.navigate", { url: `${url}${hash}` });
  await sleep(200);
  await send("Page.reload", { ignoreCache: false });
  await until(`document.readyState === 'complete' && !!document.querySelector('header')`, 30000, "app reload");
  await settle();
}

/** Psets read: the walk's lists are filled, nothing says «Leser». */
async function readyForSteps() {
  await until(`!!document.querySelector('[data-walk] section[aria-label]') && document.querySelector('[data-walk] section[aria-label]').getAttribute('aria-label') !== 'Last opp IFC'`, 60000, "model read, walk moved on");
  await until(`!/\\bLeser\\b/.test(document.querySelector('[data-walk]')?.textContent ?? '')`, 60000, "psets read");
  await sleep(500);
  await settle();
}

/** Walk on from the current step to Oppsummering, a shot per step. `mode`:
 *  "apply" takes each step's primary, "skip" its «Hopp over». */
async function walkOn(state, mode, extras = {}) {
  let n = 10;
  for (let guard = 0; guard < 20; guard += 1) {
    const step = await stepName();
    const name = `${String(n).padStart(2, "0")}-${slug(step)}`;
    await shoot(state, name);
    if (extras[step]) await extras[step](name);
    if (step === "Oppsummering") return;
    n += 1;
    if (mode === "apply") {
      // Etasjeoppsett: the plane is a choice; pick one if none is, then «Bruk».
      if ((await exists("[data-plane]")) && !(await exists("[data-plane][aria-checked=true]"))) await click("[data-plane]");
      if (await exists("[data-step-confirm]:not([disabled])")) await click("[data-step-confirm]:not([disabled])");
      else await click("[data-step-skip]");
    } else {
      await click("[data-step-skip]");
    }
    await sleep(300);
    await settle();
  }
  throw new Error("the walk did not reach Oppsummering");
}

const escape = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await settle();
};

/* ---------------------------------------------------------------- states */

async function stateA(url) {
  await fresh(url, "#lang=nb&page=setup");
  await shoot("a", "00-valg");
  await click("[data-choice=custom]");
  await shoot("a", "01-last-opp-ifc");
  await setFiles('[data-walk] input[type=file][accept=".ifc,.ifczip"]', [MODEL]);
  await readyForSteps();
  await walkOn("a", "apply", {
    Typenavn: async (name) => {
      if (await exists("[data-tfm-chip]")) {
        await click("[data-tfm-chip]");
        await shoot("a", `${name}-x-chip`);
        await click("[data-tfm-chip][aria-expanded=true]");
      }
      if (await exists('[data-tfm-insert="1"]')) {
        await click('[data-tfm-insert="1"]');
        await shoot("a", `${name}-x-insert`);
        await click('[data-tfm-insert="1"]');
      }
    },
    Systemkode: async (name) => {
      if (await exists("[data-source-edit]")) {
        await click("[data-source-edit]");
        await shoot("a", `${name}-x-endre`);
        await click("[data-source-edit]");
      }
      if (await exists("[data-walk] details[data-door]")) {
        await evaluate(`document.querySelector('[data-walk] details[data-door]').open = true`);
        await settle();
        await evaluate(`document.querySelector('[data-walk] details[data-door]').scrollIntoView({block:'start'})`);
        await shoot("a", `${name}-x-avansert`);
        await evaluate(`document.querySelector('[data-walk] details[data-door]').open = false`);
      }
    },
    TFM: async (name) => {
      if (await exists('[data-tfm-chip="Lokasjon"]')) {
        await click('[data-tfm-chip="Lokasjon"]');
        await shoot("a", `${name}-x-lokasjon`);
        await click('[data-tfm-chip][aria-expanded=true]');
      }
    },
  });
  // The IFC step with a model loaded: its segment on the bar.
  if (await exists('[data-walk-progress] button[aria-label="Last opp IFC"]')) {
    await click('[data-walk-progress] button[aria-label="Last opp IFC"]');
    await shoot("a", "30-last-opp-ifc-lastet");
  }
}

/** Skip on Typenavn from a fresh walk: no type-name rule, ○ in the summary. */
async function stateS(url) {
  await fresh(url, "#lang=nb&page=setup");
  await click("[data-choice=custom]");
  await setFiles('[data-walk] input[type=file][accept=".ifc,.ifczip"]', [MODEL]);
  await readyForSteps();
  const at = await stepName();
  await click("[data-step-skip]");
  const after = await stepName();
  checks.push({ name: "s: Hopp over on Typenavn moves on", ok: at === "Typenavn" && after !== "Typenavn", got: `${at} -> ${after}` });
  for (let i = 0; i < 12 && (await stepName()) !== "Oppsummering"; i += 1) await click("[data-step-skip]");
  const row = await summaryRow("Typenavn");
  checks.push({ name: "s: a skipped Typenavn is not set (○, no rule)", ok: row?.done === "false" && /–/.test(row?.text ?? ""), got: JSON.stringify(row) });
  await shoot("s", "19-oppsummering-hoppet");
}

async function loadOnBoard(url, file) {
  await fresh(url, "#lang=nb");
  await setFiles('input[type=file][accept=".ifc,.ifczip"]', [file]);
  await until(`!!document.querySelector('[role=tablist]') && !/Leser|I kø/.test(document.body.innerText)`, 90000, "board");
  await sleep(500);
}

async function stateB(url) {
  await loadOnBoard(url, MODEL);
  await evaluate(`location.hash = '#lang=nb&page=setup'`);
  await until(`!!document.querySelector('[data-choice=pofin]')`, 20000, "choice");
  await settle();
  await shoot("b", "00-valg-med-modell");
  await click("[data-choice=pofin]");
  await until(`!/\\bLeser\\b/.test(document.querySelector('[data-walk]')?.textContent ?? '')`, 60000, "psets read");
  await sleep(1500);
  await shoot("b", "01-pofin");
  await click("[data-pofin-accept]");
  await sleep(1000);
  await shoot("b", "02-pofin-oppsummering");

  await loadOnBoard(url, MODEL);
  await evaluate(`location.hash = '#lang=nb&page=setup'`);
  await until(`!!document.querySelector('[data-choice=pofin]')`, 20000, "choice");
  await click("[data-choice=pofin]");
  await click("[data-pofin-review]");
  await until(`!/\\bLeser\\b/.test(document.querySelector('[data-walk]')?.textContent ?? '')`, 60000, "psets read");
  await sleep(800);
  await walkOn("b", "skip");
  const row = await summaryRow("Typenavn");
  checks.push({ name: "b: Typenavn skipped under POFIN keeps POFIN's rule (set by the template, not the step)", ok: row?.done === "true", got: JSON.stringify(row) });
}

async function stateC(url) {
  const ruleset = JSON.parse(readFileSync(SAVED, "utf8"));
  const row = JSON.stringify({ format: 1, fileName: basename(SAVED), ruleset });
  await fresh(url, "#lang=nb&page=setup", `localStorage.setItem('ifc-check.ruleset', ${JSON.stringify(row)})`);
  await shoot("c", "01-last-opp-ifc");
  await setFiles('[data-walk] input[type=file][accept=".ifc,.ifczip"]', [REVIT]);
  await readyForSteps();
  await walkOn("c", "skip");
  const typeRow = await summaryRow("Typenavn");
  checks.push({ name: "c: Typenavn skipped on a saved ruleset without one: not set", ok: typeRow?.done === "false", got: JSON.stringify(typeRow) });
}

/* ------------------------------------------------------------------ run */

mkdirSync(OUT, { recursive: true });
let code = 0;
try {
  const url = await startVite();
  console.log(`vite ${url} (in this process, pid ${process.pid})`);
  await startChrome();
  await connect();
  await viewport(VIEWPORTS[0]);
  if (STATES.includes("a")) await stateA(url);
  if (STATES.includes("b")) await stateB(url);
  if (STATES.includes("c")) await stateC(url);
  if (STATES.includes("s")) await stateS(url);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  code = 2;
} finally {
  writeFileSync(resolve(OUT, `measure-${STATES.join("")}.json`), JSON.stringify({ rows, errors }, null, 2));
  const pct = (a, b) => (a === null ? "  -" : String(Math.round((100 * a) / b)).padStart(3));
  console.log("\nvp         state  shot                              w%  h%  title  bruk  act-gap  scrollY  scrollX  grid");
  for (const r of rows) {
    console.log(
      `${r.vp.padEnd(10)} ${r.state.padEnd(6)} ${r.name.slice(0, 32).padEnd(33)} ${pct(r.w, r.vw)} ${pct(r.h, r.vh)}  ${String(r.titleY ?? "-").padStart(5)}  ${r.confirmInView === null ? "  - " : r.confirmInView ? " in " : "OUT "}  ${String(r.actionsGap ?? "-").padStart(5)}${r.actionsStuck ? "s" : " "}  ${r.walkScrollsY ? "yes" : " no"}      ${r.pageScrollX || r.walkScrollX ? "YES" : " no"}      ${r.grid?.pass ? "pass" : "FAIL " + (r.grid?.fails ?? []).join("; ")}`,
    );
  }
  const gridFails = rows.filter((r) => r.grid && !r.grid.pass).length;
  console.log(`\ngrid: ${rows.length - gridFails} pass, ${gridFails} fail of ${rows.length} screens`);
  for (const c of checks) console.log(`check ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.got}`);
  if (errors.length > 0) console.log(`\npage errors:\n${errors.slice(0, 10).join("\n")}`);
  try {
    ws?.close();
  } catch {
    /* closed */
  }
  cleanup();
  await vite?.close();
}
process.exit(code !== 0 ? code : failed ? 1 : 0);
