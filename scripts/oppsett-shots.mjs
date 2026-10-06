/** Oppsett v2, rendered (adapted from `walk-shots.mjs`): the page in a real
 *  browser at the owner's screen, screenshotted and measured, so a pass
 *  looks at what it built instead of trusting tsc.
 *
 * One Vite DEV server (its own cache dir under tmp/) and ONE headless Chrome
 * with ONE page, from cleared storage:
 *
 *   01-empty       no model, no ruleset: the sidebar on POFIN, the drop target
 *   02-systemkode  OBF ARK dropped and read, Systemkode selected
 *   03-egenskap    «Legg til krav» → Egenskap, a property picked in I modellen,
 *                  the Krav editor open
 *   04-konflikt    an IDS dropped on the page (a pattern on POFIN's Systemkode
 *                  source, a new property, a spec the importer cannot read):
 *                  the strip, the conflict row selected
 *
 * Measured per shot: page and main-area scroll (no page scroll, ever), the
 * sidebar's width, and the wizard's columns.
 *
 * Output: <out>/<WxH>/<nn>-<name>.png and measure.json. Default <out> is the
 * MAIN checkout's tmp/oppsett-v2, so a worktree's screenshots outlive it.
 *
 * RAM: Chrome starts only with >= 3.5 GB free physical memory. Only the
 * processes this script started are stopped (by PID), on exit and on error.
 *
 * Run:   node scripts/oppsett-shots.mjs [--vp 2560x1440] [--out DIR] [--model PATH]
 * Exit:  0 shots taken, no page scroll · 1 a page scroll · 2 usage/internal.
 * Proves what renders locally, not the deployed site.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const OUT = resolve(opt("out") ?? "C:/workspace/toolkit/ifc-check/tmp/oppsett-v2");
const VIEWPORTS = (opt("vp") ?? "2560x1440").split(",").map((s) => {
  const [w, h] = s.split("x").map(Number);
  return { w, h, name: s };
});
const PORT = Number(opt("port") ?? 5193);
const CDP = Number(opt("cdp") ?? 9343);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MODEL = opt("model") ?? "C:/workspace/skiplum/client-projects/10001-sophies-minde/models/2026-04-30_mmi500/OBF_400520_03_6_ARK.ifc";

if (!existsSync(MODEL)) {
  console.error(`missing input: ${MODEL}`);
  process.exit(2);
}

/** The IDS dropped in state 04: POFIN's Systemkode source with a pattern (a
 *  conflict), a property nobody reads (a new row), and a spec carrying an
 *  element the importer does not know (the strip). */
const IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <ids:info><ids:title>Prosjekt</ids:title></ids:info>
  <ids:specifications>
    <ids:specification name="Systemkode NS 3451 med løpenummer" ifcVersion="IFC4">
      <ids:applicability><ids:entity><ids:name><ids:simpleValue>IFCWALL</ids:simpleValue></ids:name></ids:entity></ids:applicability>
      <ids:requirements><ids:property>
        <ids:propertySet><ids:simpleValue>NONS_Reference</ids:simpleValue></ids:propertySet>
        <ids:baseName><ids:simpleValue>RefPriSysOcc</ids:simpleValue></ids:baseName>
        <ids:value><xs:restriction base="xs:string"><xs:pattern value="[0-9]{3,4}\\.[0-9]{3}"/></xs:restriction></ids:value>
      </ids:property></ids:requirements>
    </ids:specification>
    <ids:specification name="Brannklasse" ifcVersion="IFC4">
      <ids:applicability><ids:entity><ids:name><ids:simpleValue>IFCWALL</ids:simpleValue></ids:name></ids:entity></ids:applicability>
      <ids:requirements><ids:property>
        <ids:propertySet><ids:simpleValue>Pset_WallCommon</ids:simpleValue></ids:propertySet>
        <ids:baseName><ids:simpleValue>FireRating</ids:simpleValue></ids:baseName>
      </ids:property></ids:requirements>
    </ids:specification>
    <ids:specification name="Ukjent fasett" ifcVersion="IFC4">
      <ids:applicability><ids:entity><ids:name><ids:simpleValue>IFCDOOR</ids:simpleValue></ids:name></ids:entity></ids:applicability>
      <ids:somethingElse/>
    </ids:specification>
  </ids:specifications>
</ids:ids>`;

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
  // Resolved as Node resolves it: a worktree inside the checkout finds the
  // checkout's node_modules.
  const { createServer } = await import("vite");
  vite = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, "vite.config.ts"),
    cacheDir: resolve(ROOT, "tmp/.vite-oppsett"),
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

async function settle() {
  let last = "";
  for (let i = 0; i < 20; i += 1) {
    await sleep(250);
    const now = await evaluate(`document.querySelectorAll('*').length + ':' + document.body.innerText.length`);
    if (now === last) return;
    last = now;
  }
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const page = document.querySelector('[data-oppsett]');
  const side = document.querySelector('[data-sidebar]');
  const cols = document.querySelector('[data-columns]');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  // Text cut by its box without an ellipsis: a child wider than an
  // overflow-hidden parent that does not truncate.
  const clipped = [...document.querySelectorAll('[data-oppsett] *')].filter((el) => {
    if (!el.childElementCount && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      return cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
    }
    return false;
  }).slice(0, 8).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
  return {
    vw: de.clientWidth, vh: de.clientHeight,
    pageScrollX: de.scrollWidth > de.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1,
    pageScrollY: de.scrollHeight > de.clientHeight + 1 || document.body.scrollHeight > document.body.clientHeight + 1,
    mainScroll: page ? (page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1) : null,
    oppsett: r(page), sidebar: r(side), columns: cols ? [...cols.children].map(r) : null,
    selected: document.querySelector('[data-wizard]')?.getAttribute('data-wizard') ?? null,
    clipped,
  };
})()`;

const rows = [];
let failed = false;

async function shoot(name) {
  for (const v of VIEWPORTS) {
    await viewport(v);
    await settle();
    const m = await evaluate(MEASURE);
    const dir = resolve(OUT, v.name);
    mkdirSync(dir, { recursive: true });
    const file = `${name}.png`;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(dir, file), Buffer.from(data, "base64"));
    rows.push({ name, vp: v.name, file, ...m });
    if (m.pageScrollX || m.pageScrollY || m.mainScroll) failed = true;
  }
  await viewport(VIEWPORTS[0]);
  await settle();
}

async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'nearest'}); el.click(); return true; })()`);
  if (!ok) throw new Error(`no element to click: ${selector}`);
  await settle();
}

async function run(url) {
  const origin = new URL(url).origin;
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await send("Page.navigate", { url: `${url}#lang=nb&page=setup` });
  await until(`document.readyState === 'complete' && !!document.querySelector('[data-oppsett]')`, 30000, "oppsett");
  await until(`document.querySelectorAll('[data-req]').length > 0`, 10000, "sidebar");
  await shoot("01-empty");

  await setFiles('[data-stage] input[type=file]', [MODEL]);
  await until(`!!document.querySelector('[data-wizard]')`, 90000, "model read, first requirement selected");
  await click('[data-req="rule:system-classification"]');
  await until(`!/\\bLeser\\b/.test(document.querySelector('[data-oppsett]')?.textContent ?? '') && !!document.querySelector('[data-groups] [data-set]')`, 90000, "psets read");
  await sleep(1500);
  await shoot("02-systemkode");

  await click("[data-add]");
  await click('[data-add-kind="property"]');
  await click("[data-groups] [data-set] > button");
  await click("[data-groups] [data-set] [data-prop]:not([data-taken])");
  await click("[data-krav]");
  await sleep(1500);
  await shoot("03-egenskap");

  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(IDS)}], "prosjekt.ids", { type: "application/xml" }));
    const target = document.querySelector('[data-oppsett]');
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await until(`!!document.querySelector('[data-conflict-mark]')`, 10000, "conflict marked");
  await click('[data-req="rule:system-classification"]');
  await sleep(1500);
  await shoot("04-konflikt");
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
  await run(url);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  code = 2;
} finally {
  writeFileSync(resolve(OUT, "measure.json"), JSON.stringify({ rows, errors }, null, 2));
  for (const r of rows) {
    console.log(
      `${r.vp.padEnd(10)} ${r.name.padEnd(15)} pageScroll ${r.pageScrollX || r.pageScrollY ? "YES" : "no"}  mainScroll ${r.mainScroll ? "YES" : "no"}  sidebar ${JSON.stringify(r.sidebar)}  columns ${JSON.stringify(r.columns)}  selected ${r.selected}  clipped ${r.clipped.length ? r.clipped.join(" | ") : "none"}`,
    );
  }
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
