/** The isolate gate: does a click in a TABLE narrow the 3D, and does a click
 *  in the 3D still only highlight?
 *
 * The rule it holds, edkjo's, settled on the ifcfast-site work and restated
 * for this board: **a click in the UI isolates; a click in the VIEWER
 * highlights.** Neither ever moves the camera — `Zoom til valg` is the named
 * button that does. And the drill has two steps: a row is the SET, a row of
 * the derivation under it is the ONE ELEMENT.
 *
 * Driven with real CDP mouse events against a real model in headless Chrome,
 * because every one of these is a claim about what a click does, and a
 * synthetic `click()` on a React handler would prove the handler, not the
 * gesture.
 *
 * Asserted, in order, on one model:
 *   1  no filter        no chips · the HUD reads the whole model · Zoom til
 *                       valg is disabled
 *   2  a class row      a Klasse chip · the bar reads that class's own count
 *                       over the products · the HUD shows fewer elements than
 *                       the model · the canvas changed
 *   3  the same row     chips gone, the bar and the HUD back to the model, and
 *                       the canvas is PIXEL-IDENTICAL to 1 — which is the
 *                       camera assertion: a filter that had moved the eye
 *                       could not come back to the same image
 *   4  a band row       an Element chip beside the class chip · the bar reads
 *                       1 · the HUD shows at most 1 · Zoom til valg is live
 *   5  the same band row  the element chip alone goes; the class filter, its
 *                       chip and its count are exactly as in 2
 *   6  a canvas click   selects (Zoom til valg goes live) and makes NO chip:
 *                       the filter and the HUD are untouched
 *   7  Tøm filter       back to the whole model
 *   8  a storey row    the Etasjer tile isolates that floor, and clears it
 *  9-10 three models   only the panel's OWN column in the floor matrix is a
 *                      door, and a click there leaves the other panels alone
 *
 * RAM: one Chrome at a time, launched only with >= 4 GB free physical memory;
 * kills only the Chrome and the preview server it started.
 *
 * Run:   npm run build && node scripts/isolate-gate.mjs
 *        node scripts/isolate-gate.mjs --url https://ifc-check.skiplum.com
 *        [--model PATH] [--viewport 2112x1267]
 * Exit:  0 every assertion holds · 1 an assertion failed · 2 usage/internal.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(ROOT, "tmp/isolate");
const PORT = 4181;
const CDP = 9335;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MODEL =
  "C:/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Void-demo/01_inn/export_2026-09-14/KNM_ARK.ifc";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const liveUrl = opt("url");
const modelPath = opt("model") ?? DEFAULT_MODEL;
// 21 tracks, so the Klasser tile is on the Kontroll tab beside the viewer:
// the whole gate then runs on one tab, with the 3D visible throughout.
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
    [
      resolve(ROOT, "node_modules/vite/bin/vite.js"),
      "preview",
      "--port",
      String(PORT),
      "--strictPort",
    ],
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
      logs.push(
        msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
      );
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

/* --------------------------------------------------------- real gestures */

/** A real mouse press and release at a point, then the pointer parked away
 *  from every row — hover is a rendered state in both the list and the scene,
 *  so leaving the pointer on what was clicked would put a hover overlay in
 *  every screenshot that follows. */
async function clickAt(x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
  }
  await park();
  await sleep(500);
}

async function park() {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
  await sleep(250);
}

/** The centre of the first element matching, in CSS pixels. */
async function centre(expr) {
  const box = await evaluate(
    `(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`,
  );
  if (!box) throw new Error(`no clickable box for ${expr}`);
  return box;
}

/** Everything the assertions read, in one pass, for ONE model panel: its
 *  chips, its bar's count, its viewer HUD and the state of the two camera
 *  buttons. Scoped by panel because the filter is per model, and "the other
 *  panels did not move" is one of the things being asserted. */
const STATE = (panel_index = 0) => `(() => {
  const root = document.querySelectorAll('main > section')[${panel_index}];
  if (!root) return null;
  const panel = root.querySelector('[role=tabpanel]:not([hidden])');
  const bar = root.querySelector(':scope > div.flex.flex-wrap');
  const chips = bar ? [...bar.querySelectorAll(':scope > span.border')]
    .map((s) => s.textContent.replace(/✕$/, '').trim()) : [];
  const barText = bar ? bar.textContent : '';
  const count = barText.match(/(\\d[\\d\\u00a0\\u202f ]*)\\s*\\/\\s*(\\d[\\d\\u00a0\\u202f ]*)/);
  const num = (s) => (s === undefined ? null : Number(s.replace(/[^\\d]/g, '')));
  const tile = panel ? panel.querySelector('[data-tile-id=viewer]') : null;
  const hud = tile ? [...tile.querySelectorAll('span[title]')].map((s) => s.textContent.trim())[0] ?? '' : '';
  const hudNums = hud.split('/').map((p) => num(p.trim())).filter((n) => n !== null);
  const buttons = tile ? [...tile.querySelectorAll('button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })) : [];
  return {
    chips,
    matched: num(count?.[1]),
    total: num(count?.[2]),
    hud,
    hudShown: hudNums[0] ?? null,
    hudTotal: hudNums.length > 1 ? hudNums[1] : hudNums[0] ?? null,
    zoomDisabled: buttons.length > 1 ? buttons[1].disabled : null,
    bandRows: root.querySelectorAll('[data-guid]').length,
  };
})()`;

/** The canvas alone, so the comparison is the 3D and not the page around it. */
async function canvasShot(name) {
  const rect = await evaluate(
    `(() => { const c = document.querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=viewer] canvas');
      if (!c) return null; const r = c.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), scale: 1 }; })()`,
  );
  if (!rect) throw new Error("no viewer canvas");
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: rect });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, "base64"));
  return data;
}

/* ---------------------------------------------------------------- run */

const fails = [];
const check = (ok, message) => {
  if (!ok) fails.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

mkdirSync(OUT, { recursive: true });
const base = liveUrl ?? (await startPreview());
await startChrome();
await connect();

await send("Emulation.setDeviceMetricsOverride", {
  width: vw,
  height: vh,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${base}#lang=nb` });
await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
await sleep(1200);
await evaluate(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`,
);
await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
await setFiles('input[type=file][accept=".ifc,.ifczip"]', [resolve(modelPath)]);
await until(
  `(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && !!document.querySelector('canvas'); })()`,
  300000,
  "model ready",
);
await sleep(4000);
await park();

/* 1 — the whole model. */
const base0 = await evaluate(STATE());
const shot0 = await canvasShot("1-whole-model");
check(base0.chips.length === 0, `1 no chips (${base0.chips.length})`);
check(
  base0.hudShown !== null && base0.hudShown === base0.hudTotal,
  `1 HUD reads the whole model (${base0.hud})`,
);
check(base0.zoomDisabled === true, `1 Zoom til valg disabled with no selection`);

/* 2 — a class row isolates. A class big enough to matter and small enough to
   be a real narrowing: the first under half the model. */
const klass = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-tile-id=classes] button')];
  const read = (b) => Number((b.lastElementChild?.textContent ?? '').replace(/[^\\d]/g, ''));
  const total = rows.reduce((s, b) => s + read(b), 0);
  const pick = rows.find((b) => read(b) > 0 && read(b) < total / 2) ?? rows[0];
  if (!pick) return null;
  pick.setAttribute('data-gate-pick', '');
  return { entity: pick.firstElementChild?.nextElementSibling?.textContent?.trim() ?? pick.textContent.trim(), count: read(pick), total };
})()`);
if (!klass) {
  console.error("no Klasser tile on this board — run at a 21-track viewport");
  process.exit(2);
}
await clickAt(...Object.values(await centre(`document.querySelector('[data-gate-pick]')`)));
const afterClass = await evaluate(STATE());
const shotClass = await canvasShot("2-class-isolated");
check(
  afterClass.chips.length === 1 && afterClass.chips[0].includes(klass.entity),
  `2 one Klasse chip for ${klass.entity} (${JSON.stringify(afterClass.chips)})`,
);
check(
  afterClass.matched === klass.count,
  `2 bar reads the class count ${afterClass.matched} = ${klass.count}`,
);
check(
  afterClass.hudShown !== null && afterClass.hudShown < base0.hudTotal && afterClass.hudShown <= klass.count,
  `2 HUD narrowed to ${afterClass.hud} of ${base0.hudTotal}`,
);
check(shotClass !== shot0, `2 the canvas changed`);
check(afterClass.bandRows > 0, `2 the derivation lists the instances (${afterClass.bandRows} rows)`);

/* 3 — the same row clears it, and the scene comes back to the SAME IMAGE.
   That is the camera assertion: nothing about isolating moved the eye. */
await clickAt(...Object.values(await centre(`document.querySelector('[data-gate-pick]')`)));
const cleared = await evaluate(STATE());
const shotBack = await canvasShot("3-restored");
check(cleared.chips.length === 0, `3 the chip is gone (${JSON.stringify(cleared.chips)})`);
check(cleared.hudShown === base0.hudTotal, `3 HUD back to the whole model (${cleared.hud})`);
check(shotBack === shot0, `3 the canvas is pixel-identical to 1 — the camera never moved`);

/* 4 — the second step: a row of the derivation is ONE element. */
await clickAt(...Object.values(await centre(`document.querySelector('[data-gate-pick]')`)));
const rowAt = await centre(`document.querySelectorAll('[data-guid]')[0]`);
await clickAt(rowAt.x, rowAt.y);
const one = await evaluate(STATE());
const shotOne = await canvasShot("4-one-element");
check(one.chips.length === 2, `4 the element chip joins the class chip (${JSON.stringify(one.chips)})`);
check(one.matched === 1, `4 the bar reads one element (${one.matched})`);
check(one.hudShown !== null && one.hudShown <= 1, `4 the HUD shows at most one element (${one.hud})`);
check(one.zoomDisabled === false, `4 Zoom til valg is live on the picked element`);
check(shotOne !== shotClass, `4 the canvas changed again`);

/* 5 — the same row steps back out to the set it was drilled from. */
await clickAt(rowAt.x, rowAt.y);
const back = await evaluate(STATE());
check(back.chips.length === 1, `5 the element chip alone is dropped (${JSON.stringify(back.chips)})`);
check(back.matched === klass.count, `5 the class filter is intact (${back.matched} = ${klass.count})`);
check(back.hudShown === afterClass.hudShown, `5 the HUD is the class again (${back.hud})`);

/* 6 — a click in the 3D selects and NEVER filters. */
await evaluate(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm filter|Clear filter)$/.test(x.textContent.trim())); b && b.click(); return true; })()`,
);
await sleep(600);
await park();
const beforePick = await evaluate(STATE());
const canvasBox = await evaluate(
  `(() => { const c = document.querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=viewer] canvas'); const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
);
let picked = null;
for (const [dx, dy] of [
  [0.5, 0.5],
  [0.45, 0.55],
  [0.55, 0.45],
  [0.5, 0.6],
  [0.4, 0.5],
]) {
  await clickAt(canvasBox.x + canvasBox.w * dx, canvasBox.y + canvasBox.h * dy);
  const now = await evaluate(STATE());
  if (now.zoomDisabled === false) {
    picked = now;
    break;
  }
  picked = now;
}
await canvasShot("6-viewer-pick");
check(picked.chips.length === 0, `6 a canvas click makes no chip (${JSON.stringify(picked.chips)})`);
check(
  picked.hudShown === beforePick.hudShown,
  `6 the scene still shows everything it did (${picked.hud})`,
);
check(picked.zoomDisabled === false, `6 the canvas click DID select — it highlights, it does not hide`);

/* 7 — and the bar is still the way back. */
const end = await evaluate(STATE());
check(end.chips.length === 0, `7 no filter is left behind (${JSON.stringify(end.chips)})`);

/* 8 — a storey row on the Etasjer tile is a floor's worth of elements. With
   no ruleset the tile is the file's own storey list, and a storey the graph
   places nothing in is inert by design, so the first LIVE row is the subject
   and a tile of none would fail here. */
const floorRows = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('main > section [role=tabpanel]:not([hidden]) [data-tile-id=floors] tbody tr')];
  rows.forEach((r, i) => r.setAttribute('data-gate-floor', String(i)));
  return rows.length;
})()`);
let storey = null;
for (let i = 0; i < floorRows && storey === null; i += 1) {
  const at = await centre(`document.querySelector('[data-gate-floor="${i}"]')`);
  await clickAt(at.x, at.y);
  const now = await evaluate(STATE());
  if (now.chips.length === 1) storey = { row: i, at, now };
}
await canvasShot("8-storey-isolated");
check(storey !== null, `8 a storey row isolates its floor (${floorRows} rows on the tile)`);
if (storey) {
  check(
    storey.now.chips[0].startsWith("Etasje"),
    `8 the chip is an Etasje chip (${JSON.stringify(storey.now.chips)})`,
  );
  check(
    storey.now.matched > 0 && storey.now.matched < storey.now.total,
    `8 the bar reads that floor alone (${storey.now.matched} / ${storey.now.total})`,
  );
  check(
    storey.now.hudShown !== null && storey.now.hudShown < base0.hudTotal,
    `8 the HUD narrowed to the floor (${storey.now.hud})`,
  );
  await clickAt(storey.at.x, storey.at.y);
  const off = await evaluate(STATE());
  check(off.chips.length === 0, `8 the same row clears it (${JSON.stringify(off.chips)})`);
}

/* ---- phase 2: three models and a floor config -------------------------

   The floor MATRIX, and the cross-model rule: the filter belongs to a model,
   so only this panel's own column — the first — is a door. A cell under
   another file's column describes a storey this panel's viewer does not
   contain, and the other panels are not touched by a click here. */
if (existsSync(resolve(ROOT, "examples/knm-floors.test.ruleset.json"))) {
  const dir = resolve(modelPath, "..");
  const three = ["KNM_ARK.ifc", "KNM_RIV.ifc", "KNM_RIB.ifc"].map((f) => resolve(dir, f));
  if (three.every((f) => existsSync(f))) {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(400);
    await send("Page.navigate", { url: `${base}#lang=nb` });
    await until(`!!document.querySelector('input[type=file][accept=".ifc,.ifczip"]')`, 30000, "app");
    await sleep(1200);
    await evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Tøm alle|Clear all)$/.test(x.textContent.trim())); b && b.click(); return true; })()`,
    );
    await until(`!document.querySelector('[role=tablist]')`, 30000, "empty landing");
    await setFiles(
      'input[type=file][accept=".ids,.xml,.json"]',
      [resolve(ROOT, "examples/knm-floors.test.ruleset.json")],
    );
    await sleep(800);
    await setFiles('input[type=file][accept=".ifc,.ifczip"]', three);
    await until(
      `(() => { const t = document.body.innerText; return !/Leser|I kø/.test(t) && document.querySelectorAll('canvas').length >= 3; })()`,
      420000,
      "three models ready",
    );
    await sleep(5000);
    await park();

    const cols = await evaluate(`(() => {
      const tile = document.querySelectorAll('main > section')[0].querySelector('[role=tabpanel]:not([hidden]) [data-tile-id=floors]');
      if (!tile) return null;
      const rows = [...tile.querySelectorAll('tbody tr')];
      let own = 0, others = 0, ownFirst = null;
      for (const tr of rows) {
        const cells = [...tr.children].slice(2);
        cells.forEach((td, col) => {
          const button = td.querySelector('button');
          if (!button) return;
          if (col === 0) { own += 1; if (!ownFirst) { button.setAttribute('data-gate-cell', ''); ownFirst = true; } }
          else others += 1;
        });
      }
      return { rows: rows.length, own, others, models: rows[0] ? rows[0].children.length - 2 : 0 };
    })()`);
    check(cols !== null && cols.models === 3, `9 the matrix carries one column per model (${cols?.models})`);
    check(cols !== null && cols.own > 0, `9 this panel's own column is clickable (${cols?.own} cells)`);
    check(
      cols !== null && cols.others === 0,
      `9 no cell under another model's column is a door (${cols?.others})`,
    );

    const before = [0, 1, 2].map(() => null);
    for (const i of [0, 1, 2]) before[i] = await evaluate(STATE(i));
    const cell = await centre(`document.querySelector('[data-gate-cell]')`);
    await clickAt(cell.x, cell.y);
    const after = [];
    for (const i of [0, 1, 2]) after.push(await evaluate(STATE(i)));
    await canvasShot("9-matrix-cell");
    check(
      after[0].chips.length === 1 && after[0].chips[0].startsWith("Etasje"),
      `10 a matrix cell isolates that storey here (${JSON.stringify(after[0].chips)})`,
    );
    check(
      after[0].matched > 0 && after[0].matched < after[0].total,
      `10 the bar reads that storey (${after[0].matched} / ${after[0].total})`,
    );
    check(
      after[0].hudShown !== null && after[0].hudShown < before[0].hudTotal,
      `10 this panel's 3D narrowed (${before[0].hud} -> ${after[0].hud})`,
    );
    check(
      after[1].chips.length === 0 && after[2].chips.length === 0,
      `10 the other panels keep their own filter (${JSON.stringify([after[1].chips, after[2].chips])})`,
    );
    check(
      after[1].hudShown === before[1].hudShown && after[2].hudShown === before[2].hudShown,
      `10 the other models' 3D is untouched (${after[1].hud} · ${after[2].hud})`,
    );
  }
}

writeFileSync(
  resolve(OUT, "report.json"),
  JSON.stringify({ base, model: modelPath, klass, states: { base0, afterClass, cleared, one, back, picked }, fails, exceptions: logs }, null, 2),
);
if (logs.length) {
  console.log(`page exceptions (${logs.length}):\n  ${logs.slice(0, 5).join("\n  ")}`);
  fails.push("page exceptions");
}
console.log(fails.length ? `isolate gate: FAILED (${fails.length})` : "isolate gate: all assertions hold");
ws.close();
process.exit(fails.length ? 1 : 0);
