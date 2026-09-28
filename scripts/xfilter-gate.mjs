/** The cross-filter gate: one filter, one origin (2026-09-28).
 *
 * edkjo: "cross filter should have one origin: all other views show only the
 * matching results. The clicked origin highlights. So: Original: Highlight,
 * everything else: Isolate."
 *
 * Three real clicks in headless Chrome, each in a different view, against a
 * real model: a treemap cell (Oversikt), a storey node (Graf), a type card
 * (Typer). After each:
 *   - the ORIGIN keeps every item (same count as with no filter there) and
 *     marks the chosen one, the rest dimmed (`data-xf="origin"`)
 *   - the 3D draws exactly the filter's elements that have geometry (the
 *     scene's own `drawnElements()` against the HUD's `shown`)
 *   - no accumulation: the filter is the new click's whole set, not its
 *     intersection with the previous one
 *
 * Mechanism only, on a local preview build: not a claim about the deployed
 * site. One Chrome, launched at >= 4 GB free; kills only its own PIDs.
 *
 * Run:   npm run build && node scripts/xfilter-gate.mjs [--model PATH] [--url URL]
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(ROOT, "tmp/xfilter");
const PORT = 4183;
const CDP = 9337;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MODEL =
  "C:/workspace/skiplum/client-projects/10021-henrik-ibsens-gate-90/underprosjekter/HI90_Mottakskontroll/01_Inn/Dalux-eksport/Export HI90 26. sep. 2026, 0316/HI90_ARK.ifc";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const modelPath = opt("model") ?? DEFAULT_MODEL;
const [vw, vh] = [2112, 1267];
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
function cleanup() {
  for (const child of started) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
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
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`not reachable: ${url}`);
}

let ws;
let seq = 0;
const pending = new Map();
const logs = [];
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
    await sleep(400);
  }
  throw new Error(`timeout: ${label}`);
}
async function clickAt(x, y) {
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
  await sleep(1500);
}
async function centre(expr) {
  const box = await evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  if (!box) throw new Error(`no clickable box for ${expr}`);
  return box;
}
async function tab(name) {
  const at = await centre(`[...document.querySelectorAll('main > section [role=tab]')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`);
  await clickAt(at.x, at.y);
}

/** The filter bar, the HUD and what the scene draws. */
const STATE = `(() => {
  const bar = document.querySelector('[data-filter-bar]');
  const chip = bar?.querySelector('[data-filter-origin]');
  const m = (bar?.textContent ?? '').match(/(\\d[\\d\\u00a0\\u202f ]*)\\s*\\/\\s*(\\d[\\d\\u00a0\\u202f ]*)/);
  const num = (s) => (s == null ? null : Number(String(s).replace(/[^\\d]/g, '')));
  const hud = document.querySelector('[data-mg-tile=viewer] span[title]')?.getAttribute('title') ?? '';
  return {
    origin: chip?.getAttribute('data-filter-origin') ?? null,
    chips: bar ? bar.querySelectorAll('[data-filter-origin]').length : 0,
    matched: chip && m ? num(m[1]) : null,
    hudShown: num(hud.split('/')[0]),
    drawn: (window.__ifcCheckScenes ?? [])[0]?.drawnElements() ?? null,
  };
})()`;

const fails = [];
const check = (ok, message) => {
  if (!ok) fails.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

async function run() {
  mkdirSync(OUT, { recursive: true });
  let base = opt("url");
  if (!base) {
    if (!existsSync(resolve(ROOT, "dist/index.html"))) throw new Error("no dist/: run npm run build first");
    const preview = spawn(process.execPath, [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    started.push(preview);
    base = `http://localhost:${PORT}/`;
    await waitHttp(base, 20000);
  }
  const free = freeGb();
  if (free < 4) throw new Error(`only ${free} GB free; Chrome launches at >= 4 GB`);
  const profile = resolve(OUT, "_profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--no-first-run", `--window-size=${vw},${vh}`, "about:blank"], { stdio: "ignore" });
  started.push(chrome);
  console.log(`info chrome pid ${chrome.pid}`);
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000);
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
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
  await send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });

  await send("Page.navigate", { url: `${base}#lang=nb` });
  await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
  await sleep(1200);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`);
  await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type=file][accept=".ifc,.ifczip"]' });
  await send("DOM.setFileInputFiles", { nodeId, files: [resolve(modelPath)] });
  await until(`(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && !!document.querySelector('canvas'); })()`, 300000, "model ready");
  await until(`((window.__ifcCheckScenes ?? [])[0]?.drawnElements() ?? 0) > 0`, 120000, "geometry");
  await sleep(4000);
  const whole = await evaluate(STATE);
  console.log(`info whole model: ${JSON.stringify(whole)}`);

  /* 1 — a treemap cell on Oversikt. */
  const TREE = `document.querySelector('[data-mg-tile^=tree-] [data-treemap]')`;
  const cellsBefore = await evaluate(`${TREE}.querySelectorAll('[data-tree-cell]').length`);
  const cell = await evaluate(`(() => {
    const cells = [...${TREE}.querySelectorAll('[data-tree-cell]')]
      .filter((c) => c.getBoundingClientRect().width > 40 && c.getBoundingClientRect().height > 22)
      .map((c) => ({ c, n: Number((c.title.match(/×(\\d+)/) ?? [])[1] ?? 0) }))
      .filter((x) => x.n >= 5).sort((a, b) => a.n - b.n);
    const pick = cells[Math.floor(cells.length / 2)];
    if (!pick) return null;
    pick.c.setAttribute('data-gate-cell', '');
    return { key: pick.c.dataset.treeCell, n: pick.n };
  })()`);
  check(cell !== null, `1 a treemap cell to click (${cell?.key} ×${cell?.n})`);
  if (!cell) return;
  const cellAt = await centre(`document.querySelector('[data-gate-cell]')`);
  await clickAt(cellAt.x, cellAt.y);
  const s1 = await evaluate(STATE);
  const tree1 = await evaluate(`(() => { const t = ${TREE}; const body = t.closest('[data-xf]');
    return { cells: t.querySelectorAll('[data-tree-cell]').length, xf: body?.getAttribute('data-xf') ?? null,
      chosen: !!t.querySelector('[data-gate-cell].alt-chosen'),
      dimmed: [...t.querySelectorAll('[data-tree-cell]')].filter((c) => getComputedStyle(c).opacity < 0.5).length }; })()`);
  console.log(`info 1 ${JSON.stringify({ s1, tree1 })}`);
  check(s1.origin?.startsWith("tree-") && s1.chips === 1, `1 one filter, origin ${s1.origin}`);
  check(s1.matched === cell.n, `1 the filter is the cell's ${cell.n} elements (${s1.matched})`);
  check(tree1.xf === "origin" && tree1.cells === cellsBefore && tree1.chosen && tree1.dimmed > 0,
    `1 the treemap is the origin: all ${cellsBefore} cells kept (${tree1.cells}), the cell chosen, ${tree1.dimmed} dimmed`);
  check(s1.drawn === s1.hudShown && s1.drawn > 0 && s1.drawn <= s1.matched, `1 the 3D draws the filter: ${s1.drawn} = HUD ${s1.hudShown} (of ${s1.matched})`);

  /* 2 — a storey node on Graf. */
  await tab("Graf");
  await until(`(window.__ifcCheckGraphs ?? []).some((p) => p().some((n) => n.kind === 'storey' && n.x !== null))`, 30000, "graph drawn");
  await sleep(3500);
  const GRAPH = `(window.__ifcCheckGraphs ?? []).map((p) => p()).find((ns) => ns.some((n) => n.x !== null))`;
  const isolated = await evaluate(`${GRAPH}.filter((n) => n.kind === 'storey').map((n) => ({ id: n.id, count: n.count }))`);
  console.log(`info 2 graph under the cell: ${JSON.stringify(isolated)}`);
  const node = isolated.sort((a, b) => b.count - a.count)[0];
  check(!!node && isolated.reduce((s, n) => s + n.count, 0) <= s1.matched, `2 the graph isolates to the cell: storeys ${isolated.length}, elements ${isolated.reduce((s, n) => s + n.count, 0)} of ${s1.matched}`);
  const at = await evaluate(`(() => { const c = [...document.querySelectorAll('canvas[data-graph]')].find((x) => x.getBoundingClientRect().width > 0);
    const r = c.getBoundingClientRect(); const n = ${GRAPH}.find((x) => x.id === ${JSON.stringify(node.id)});
    return { x: r.left + n.x, y: r.top + n.y }; })()`);
  await clickAt(at.x, at.y);
  await sleep(2500);
  const s2 = await evaluate(STATE);
  const full = await evaluate(`${GRAPH}.filter((n) => n.kind === 'storey').map((n) => ({ id: n.id, count: n.count }))`);
  const chosenFull = full.find((n) => n.id === node.id);
  console.log(`info 2 ${JSON.stringify({ s2, storeys: full.length, chosen: chosenFull })}`);
  check(s2.origin === "graph" && s2.chips === 1, `2 one filter, origin ${s2.origin}`);
  check(full.length >= isolated.length && full.length > 0, `2 the graph is the origin: every storey drawn again (${full.length}, was ${isolated.length} isolated)`);
  check(s2.matched === chosenFull?.count, `2 the filter is the WHOLE storey, ${chosenFull?.count} elements (${s2.matched}), not its ${node.count} inside the cell`);
  check(s2.drawn === s2.hudShown && s2.drawn > 0, `2 the 3D draws the filter: ${s2.drawn} = HUD ${s2.hudShown} (of ${s2.matched})`);

  /* 3 — a type card on Typer. */
  await tab("Typer");
  await until(`!!document.querySelector('[data-gallery=types] [data-type-card]')`, 30000, "types gallery");
  await sleep(1500);
  const cardsIso = await evaluate(`document.querySelectorAll('[data-gallery=types] [data-type-card]').length`);
  const card = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-gallery=types] [data-type-card]')].map((c) => ({ c, n: Number(c.dataset.typeCount) })).sort((a, b) => b.n - a.n);
    if (!cards[0]) return null;
    cards[0].c.setAttribute('data-gate-type', '');
    return { key: cards[0].c.dataset.typeCard, n: cards[0].n };
  })()`);
  check(card !== null, `3 the gallery isolates to the storey: ${cardsIso} types (${card?.key} ×${card?.n} within it)`);
  if (!card) return;
  const cardAt = await centre(`document.querySelector('[data-gate-type]')`);
  await clickAt(cardAt.x, cardAt.y);
  await sleep(1500);
  const s3 = await evaluate(STATE);
  const g3 = await evaluate(`(() => { const g = document.querySelector('[data-gallery=types]'); const cards = [...g.querySelectorAll('[data-type-card]')];
    const chosen = cards.find((c) => c.dataset.typeCard === ${JSON.stringify(card.key)});
    return { cards: cards.length, xf: g.closest('[data-xf]')?.getAttribute('data-xf') ?? null, chosen: chosen?.getAttribute('aria-current') === 'true',
      n: Number(chosen?.dataset.typeCount), dimmed: cards.filter((c) => getComputedStyle(c).opacity < 0.5).length }; })()`);
  console.log(`info 3 ${JSON.stringify({ s3, g3 })}`);
  check(s3.origin === "types" && s3.chips === 1, `3 one filter, origin ${s3.origin}`);
  check(g3.xf === "origin" && g3.cards >= cardsIso && g3.chosen && g3.dimmed === g3.cards - 1,
    `3 the gallery is the origin: every type card back (${g3.cards}, was ${cardsIso}), the card chosen, ${g3.dimmed} dimmed`);
  check(s3.matched === g3.n, `3 the filter is the WHOLE type, ${g3.n} instances (${s3.matched}), not its ${card.n} on the storey`);
  check(s3.drawn === s3.hudShown && s3.drawn > 0, `3 the 3D draws the filter: ${s3.drawn} = HUD ${s3.hudShown} (of ${s3.matched})`);
}

try {
  await run();
} catch (error) {
  fails.push(String(error));
  console.log(`FAIL ${error}`);
}
if (logs.length) {
  console.log(`page exceptions (${logs.length}):\n  ${logs.slice(0, 5).join("\n  ")}`);
  fails.push("page exceptions");
}
console.log(fails.length ? `xfilter gate: FAILED (${fails.length})` : "xfilter gate: all assertions hold");
ws?.close();
process.exit(fails.length ? 1 : 0);
