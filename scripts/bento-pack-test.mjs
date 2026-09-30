/** Unit assertions for the module grid and the bento packer
 * (`src/ui/alt/module-grid.ts`), the layout canon's rules 6, 7, 8 and the
 * measurable part of 9, without a browser.
 *
 *   node scripts/bento-pack-test.mjs
 *
 * Exit 0 all hold · 1 an assertion failed.
 */

import {
  MG_ASPECT,
  MG_GAP,
  MG_HEAD,
  MG_MARGIN,
  MG_STRIPS,
  MG_TALL,
  SIZES,
  canonSize,
  layoutOverview,
  layoutProject,
  mgAspect,
  mgGrid,
  mgSpanPx,
  roomTiles,
} from "../src/ui/alt/module-grid.ts";
import { CANVAS_ASPECT, graphStage } from "../src/ui/canvas-aspect.ts";

let failures = 0;
let passes = 0;
const check = (ok, what) => {
  if (ok) passes += 1;
  else {
    failures += 1;
    console.log(`FAIL ${what}`);
  }
};

/* ── rule 6: the formulas and the canon's reference table ─────────────── */

// The reference at the 6 px frame margin (2026-09-30; the canon's table,
// 1920 → 16 × 8, is at its 24 px margin): 1440 → 12, 1920 → 17, 2112 → 18,
// 2560 → 22 columns.
for (const [w, c] of [
  [1440, 12],
  [1920, 17],
  [2112, 18],
  [2560, 22],
]) {
  const g = mgGrid(w, 2000);
  check(g.cols === c, `rule 6: ${w} px gives ${g.cols} columns, the reference ${c}`);
  check(Math.abs(g.u - 100) < 8, `rule 6: ${w} px gives a ${g.u.toFixed(1)} px module, about 100`);
  check(Math.abs(g.cols * g.u + (g.cols - 1) * MG_GAP - (w - 2 * MG_MARGIN)) < 1e-6, `rule 6: ${w} px, C·u + (C−1)·16 = W − 2M`);
}
// Rows: R = floor((H − chrome − 2M + 16) / (u + 16)); with a 64 px chrome the
// reference rows come out: 900 → 6, 1080 → 9, 1267 → 10, 1440 → 11.
for (const [w, h, r] of [
  [1440, 900, 6],
  [1920, 1080, 9],
  [2112, 1267, 10],
  [2560, 1440, 11],
]) {
  const g = mgGrid(w, h - 64);
  check(g.rows === r, `rule 6: ${w}×${h} with a 64 px chrome gives ${g.rows} rows, the reference ${r}`);
}
// Wider = more columns at the same module, never fatter tiles.
let lastCols = 0;
for (let w = 1100; w <= 3840; w += 7) {
  const g = mgGrid(w, 1000);
  check(g.cols >= lastCols, `rule 1: ${w} px has fewer columns than a narrower window`);
  check(g.u >= 88 && g.u <= 112, `rule 1: ${w} px gives a ${g.u.toFixed(1)} px module`);
  lastCols = g.cols;
}

/* ── rule 7: the vocabulary ─────────────────────────────────────────────── */

check(canonSize(2, 2) === "S", "rule 7: 2×2 is S");
check(canonSize(3, 2) === "M" && canonSize(2, 3) === "M", "rule 7: 3×2 and 2×3 are M");
check(canonSize(4, 3) === "L" && canonSize(3, 4) === "L", "rule 7: 4×3 and 3×4 are L");
check(canonSize(6, 4) === "XL" && canonSize(8, 5) === "XL", "rule 7: 6×4 and 8×5 are XL");
check(canonSize(3, 3) === null && canonSize(5, 2) === null, "rule 7: 3×3 and 5×2 are no size");
check(canonSize(6, 1) === null && canonSize(6, 1, true) === "strip", "rule 7: a strip only when named");
check(canonSize(3, 8) === null && canonSize(3, 8, false, true) === "tall", "rule 7: a tall column only when named");
check(canonSize(4, 4, false, true) === null, "rule 7: a square is not tall");
// Every canon size lands inside 1 : 2 to 2 : 1 at any module 88 to 112 px,
// and an XL's canvas (the tile less its head) inside 9 : 16 to 16 : 9.
for (const u of [88, 93, 100, 108, 112]) {
  for (const [name, list] of Object.entries(SIZES)) {
    for (const [w, h] of list) {
      const a = mgSpanPx(w, u) / mgSpanPx(h, u);
      check(a >= 0.5 && a <= 2, `rule 3: ${name} ${w}×${h} at u ${u} renders ${a.toFixed(2)}`);
      if (name === "XL") {
        const c = mgSpanPx(w, u) / (mgSpanPx(h, u) - MG_HEAD);
        check(c >= MG_ASPECT.viewer.min && c <= MG_ASPECT.viewer.max, `rule 4: XL ${w}×${h} canvas at u ${u} is ${c.toFixed(2)}`);
      }
    }
  }
}

/* ── rules 7, 8, 9 on every layout, over a sweep of windows ──────────────── */

// The Overview (the one board since 2026-09-28): fundamental IFC health
// only. The treemaps are Innhold's since 2026-09-30; the classification codes
// the file carries are one list tile, always there.
const contents = {
  base: { ifc: 5, counts: 4 },
  fewCounts: { ifc: 5, counts: 2 },
  // The verification as a left sidebar (2026-09-29), at the two widths
  // `sideModules` picks from.
  side4: { ifc: 5, counts: 4, side: 4 },
  side5: { ifc: 5, counts: 4, side: 5 },
};
// STABLE LAYOUT (2026-09-29, the owner: "I dont like this components
// changing places based on what is selected"): the layout is the window's
// and the loaded content's only. What a click changes (Detail filled, a
// Scope row, a filter, a selection) is passed along here and must change
// nothing: Detail's natural height (the input 3892ddf read), a selection, a
// filter's origin and elements.
const STATES = {
  detailFilled: { detail: 12, detailPx: 1250 },
  detailBody: { detail: 5 },
  filtered: { filter: { origin: "codes", matched: ["a", "b"] }, selected: "code:=Uniformat|B2010", scope: true },
  selected: { selection: ["3kZ$example0000000000"], hover: "3kZ$example0000000000" },
};
const windows = [];
for (let w = 1100; w <= 3440; w += 130) for (let h = 700; h <= 1600; h += 150) windows.push([w, h]);
windows.push([1100, 800], [1280, 800], [1440, 900], [1920, 1080], [2112, 1267], [2560, 1440], [3440, 1440]);
// 2112 × 1300 here is the owner's 2112 × 1267 window as the app lays it
// out (its chrome is less than the 104 px assumed here): 18 × 10.
windows.push([2112, 1300]);
const REFERENCE = [[1440, 900], [1920, 1080], [2112, 1267], [2112, 1300], [2560, 1440], [3440, 1440]];

let count = 0;
let taller = 0;
for (const [design, content] of Object.entries(contents)) {
  const layout = layoutOverview;
  for (const [w, h] of windows) {
    const grid = mgGrid(w, h - 104);
    const at = `${design} ${w}×${h} (${grid.cols}×${grid.rows})`;
    let out;
    const t0 = performance.now();
    try {
      out = layout(grid, content);
    } catch (error) {
      check(false, `${at}: no layout (${error.message})`);
      continue;
    }
    const ms = performance.now() - t0;
    check(ms < 1500, `${at}: the search took ${ms.toFixed(0)} ms`);
    count += 1;
    // Rule 8: deterministic, the same input gives the same layout.
    check(JSON.stringify(layout({ ...grid }, { ...content })) === JSON.stringify(out), `rule 8: ${at} is not deterministic`);
    // Stable: Detail empty vs filled, no filter vs a filter, the same board.
    for (const [state, extra] of Object.entries(STATES))
      check(JSON.stringify(layout({ ...grid }, { ...content, ...extra })) === JSON.stringify(out), `stable: ${at} moves with ${state}`);
    const occ = new Map();
    let xl = 0;
    for (const t of out.tiles) {
      // A tile grown to cover the board (`mgFillRows`, `mgFlex`) keeps its
      // class: its base is canon, the grown size inside its kind's bound.
      const [bw, bh] = t.base ?? [t.w, t.h];
      const size = canonSize(bw, bh, t.id in MG_STRIPS, t.id in MG_TALL);
      check(size !== null, `rule 7: ${at} ${t.id} ${bw}×${bh} is no canon size`);
      check(size === t.size, `rule 7: ${at} ${t.id} says ${t.size}, is ${size}`);
      if (t.base) check(t.w >= bw && t.h >= bh && t.w * t.h > bw * bh && size !== "S", `rule 5: ${at} ${t.id} grew ${bw}×${bh} to ${t.w}×${t.h}`);
      if (size !== "tall" && size !== "strip") {
        const a = mgAspect(t.kind, t.w, t.h, grid.u, out.rowPx);
        check(a >= MG_ASPECT[t.kind].min - 1e-9 && a <= MG_ASPECT[t.kind].max + 1e-9, `rule 3: ${at} ${t.id} ${t.w}×${t.h} renders ${a.toFixed(2)}`);
      }
      if (size === "XL") xl += 1;
      check(t.x >= 0 && t.y >= 0 && t.x + t.w <= grid.cols && t.y + t.h <= out.rows, `rule 1: ${at} ${t.id} outside the grid`);
      check(!(t.w >= grid.cols && size !== "strip"), `rule 3: ${at} ${t.id} spans the full width`);
      for (let y = t.y; y < t.y + t.h; y += 1)
        for (let x = t.x; x < t.x + t.w; x += 1) {
          check(!occ.has(`${x},${y}`), `rule 9: ${at} ${t.id} overlaps ${occ.get(`${x},${y}`)}`);
          occ.set(`${x},${y}`, t.id);
        }
    }
    check(xl <= 2, `rule 7: ${at} has ${xl} XL`);
    // Rule 9: the tiles cover every cell of the grid, every column and every
    // row (2026-09-30: a board of 16 of 18 columns, centred, and a hole
    // beside Detail went live because only the rows were asserted).
    let holes = 0;
    for (let y = 0; y < out.rows; y += 1) for (let x = 0; x < grid.cols; x += 1) if (!occ.has(`${x},${y}`)) holes += 1;
    check(holes === 0, `rule 9: ${at} has ${holes} empty cells`);
    check(occ.size === grid.cols * out.rows, `rule 9: ${at} tiles outside the grid`);
    check(out.offset === 0 && out.used === grid.cols, `rule 9: ${at} the board takes ${out.used} of ${grid.cols} columns from ${out.offset}`);
    check(out.top === 0 && out.usedRows === out.rows, `rule 9: ${at} the board takes ${out.usedRows} of ${out.rows} rows from ${out.top}`);
    // Fewer, taller rows only where nothing could grow: the same height.
    const rowPx = out.rowPx ?? grid.u;
    check(out.rows <= grid.rows && Math.abs(out.rows * rowPx + (out.rows - 1) * MG_GAP - mgSpanPx(grid.rows, grid.u)) < 1e-6, `rule 9: ${at} ${out.rows} rows of ${rowPx.toFixed(1)} px are not the grid's height`);
    if (out.rowPx) taller += 1;
    // The docks and the model are always tiles; the requirements too (a list
    // or c's panels).
    const ids = new Set(out.tiles.map((t) => t.id));
    const tabbed = (id) => out.tiles.some((t) => t.tabs.includes(id));
    // The docks have a slot of their own: Scope always a tile, Detail a tile
    // wherever the window seats it (12 × 5 and up), under that a fixed tab of
    // Scope. Neither hosts any other tab.
    check(ids.has("viewer") && ids.has("scope"), `${at}: the model or Scope is not a tile`);
    check(
      ids.has("detail") || ((grid.cols < 12 || grid.rows < 5) && out.tiles.find((t) => t.id === "scope")?.tabs.includes("detail")),
      `${at}: Detail is not a tile`,
    );
    for (const t of out.tiles)
      if (t.id === "scope" || t.id === "detail" || t.kind === "viewer")
        check(t.tabs.every((id) => id === "detail" || id.startsWith("count")), `${at}: ${t.id} hosts ${t.tabs.join(",")}`);
    check(ids.has("reqs") || ids.has("ifc0"), `${at}: the requirements have no tile`);
    check(!ids.has("mmi") && ![...ids].some((id) => /^std\d+$/.test(id)), `${at}: a Standardkrav tile on the Overview`);
    // No treemap on the Overview (2026-09-30); the codes a tile or a tab.
    check(![...ids].some((id) => /tree/.test(id)) && !out.tiles.some((t) => t.tabs.some((id) => /tree/.test(id))), `${at}: a treemap on the Overview`);
    check(ids.has("codes") || tabbed("codes"), `${at}: the classification codes are neither a tile nor a tab`);
    // The KPI row: every IFC-struktur requirement an S card on the TOP row,
    // never a list; the floor sidebar the full height under it, on the right.
    if (out.band === "side-pack") {
      const cards = out.tiles.filter((t) => /^ifc\d+$/.test(t.id));
      check(cards.length === content.ifc && cards.every((t) => t.size === "S"), `${at}: the KPI cards are not S cards`);
      const order = [...cards].sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.id).join();
      check(order === cards.map((_, i) => `ifc${i}`).join(), `${at}: the KPI cards do not read in order (${order})`);
      check(ids.has("floors") || tabbed("floors"), `${at}: the floors are neither a tile nor a tab`);
    } else if (!ids.has("reqs")) {
      const cards = out.tiles.filter((t) => /^ifc\d+$/.test(t.id));
      check(cards.length === content.ifc && cards.every((t) => t.y === out.top && t.size === "S"), `${at}: the KPI cards are not one S row on top`);
      // The floor sidebar under the KPI row, or where the row cannot cover
      // the width, the board's full height.
      const f = out.tiles.find((t) => t.id === "floors");
      const full = out.band.endsWith("floors");
      check(
        !!f && f.y === (full ? out.top : out.top + 2) && f.h === (full ? out.usedRows : out.usedRows - 2) && f.x + f.w === out.offset + out.used,
        `${at}: the floor sidebar is not the full height on the right (${f ? `${f.x},${f.y} ${f.w}×${f.h}` : "none"})`,
      );
    } else check(ids.has("floors") || out.tiles.some((t) => t.tabs.includes("floors")), `${at}: the floors are neither a tile nor a tab`);
    // The verification sidebar: on the left, the board's full height, its
    // width; or, where the columns left seat no board, back in the board.
    if (content.side) {
      const c = out.tiles.find((t) => t.id === "checks");
      // Its width is its rows' own, or up to three more where the board
      // beside it covers no other width.
      if (out.band === "kpis+side" || out.band === "kpis+side+floors" || out.band === "side-pack")
        check(
          !!c && c.x === out.offset && c.y === out.top && c.h === out.usedRows && c.w <= content.side + 3 && c.w >= 4 && c.size === "tall",
          `${at}: the verification sidebar is not the full height on the left (${c ? `${c.x},${c.y} ${c.w}×${c.h}` : "none"})`,
        );
      else {
        // The break: the sidebar goes only where the board beside it cannot
        // seat five S cards, the XL model and the two docks as tiles (under
        // 14 columns or 6 rows).
        check(grid.cols < 14 || grid.rows < 6, `${at}: no sidebar at ${grid.cols}×${grid.rows}`);
        check(!!c || tabbed("checks"), `${at}: no sidebar, and the checks are neither a tile nor a tab`);
      }
    }
    if (REFERENCE.some(([a, b]) => a === w && b === h))
      console.log(`  ${design} ${w}×${h} ${grid.cols}×${grid.rows}: ${out.band ?? "narrow fallback"} · board ${out.used}×${out.usedRows} · ${ms.toFixed(0)} ms · ${out.tiles.map((t) => `${t.id} ${t.w}×${t.h}@${t.x},${t.y}`).join(" ")}${out.moved.length ? ` · tabs ${out.moved.join(",")}` : ""}`);
    // Rule 8: a tile moved into a tab has lower priority than every tile of
    // its kind that stayed is not asserted (a composition may keep a lower
    // one that fits); every moved tile has a host.
    for (const id of out.moved) check(out.tiles.some((t) => t.tabs.includes(id)), `rule 8: ${at} moved ${id} has no host`);
  }
}

/* ── rule 9 on the Prosjekt and Rom tabs: every row, no holes ───────── */

const projectContents = {
  bare: { std: 5, trees: [] },
  mapped: { std: 5, trees: ["ptree-system", "ptree-function"] },
  few: { std: 3, trees: ["ptree-system"] },
  noMmi: { std: 5, trees: [], mmi: false },
};
for (const [design, content] of Object.entries(projectContents)) {
  for (const [w, h] of windows) {
    const grid = mgGrid(w, h - 104);
    const at = `project ${design} ${w}×${h} (${grid.cols}×${grid.rows})`;
    let out;
    try {
      out = layoutProject(grid, content);
    } catch (error) {
      check(false, `${at}: no layout (${error.message})`);
      continue;
    }
    count += 1;
    if (out.rowPx) taller += 1;
    for (const [state, extra] of Object.entries(STATES))
      check(JSON.stringify(layoutProject({ ...grid }, { ...content, ...extra })) === JSON.stringify(out), `stable: ${at} moves with ${state}`);
    // The docks: tiles from 12 columns up, never hosts; under that fixed tabs.
    if (grid.cols >= 12 && grid.rows >= 6) check(["scope", "detail"].every((id) => out.tiles.some((t) => t.id === id)), `${at}: Scope or Detail is not a tile`);
    // Without MMI no MMI tile (it would be an empty tile).
    if (content.mmi === false) check(!out.tiles.some((t) => t.id === "mmi" || t.tabs.includes("mmi")), `${at}: an MMI tile without MMI`);
    const occ = new Set();
    for (const t of out.tiles) {
      const [bw, bh] = t.base ?? [t.w, t.h];
      check(canonSize(bw, bh, t.id in MG_STRIPS, t.id in MG_TALL) === t.size, `rule 7: ${at} ${t.id} ${bw}×${bh} is not its ${t.size}`);
      if (t.base) check(t.w >= bw && t.h >= bh && t.w * t.h > bw * bh, `rule 5: ${at} ${t.id} grew ${bw}×${bh} to ${t.w}×${t.h}`);
      if (t.size !== "tall" && t.size !== "strip") {
        const a = mgAspect(t.kind, t.w, t.h, grid.u, out.rowPx);
        check(a >= MG_ASPECT[t.kind].min - 1e-9 && a <= MG_ASPECT[t.kind].max + 1e-9, `rule 3: ${at} ${t.id} ${t.w}×${t.h} renders ${a.toFixed(2)}`);
      }
      for (let y = t.y; y < t.y + t.h; y += 1)
        for (let x = t.x; x < t.x + t.w; x += 1) {
          check(!occ.has(`${x},${y}`), `rule 9: ${at} ${t.id} overlaps`);
          occ.add(`${x},${y}`);
        }
    }
    let holes = 0;
    for (let y = 0; y < out.rows; y += 1) for (let x = 0; x < grid.cols; x += 1) if (!occ.has(`${x},${y}`)) holes += 1;
    check(holes === 0 && occ.size === grid.cols * out.rows, `rule 9: ${at} has ${holes} empty cells`);
    check(out.offset === 0 && out.used === grid.cols, `rule 9: ${at} the board takes ${out.used} of ${grid.cols} columns`);
    check(out.top === 0 && out.usedRows === out.rows, `rule 9: ${at} the board takes ${out.usedRows} of ${out.rows} rows`);
    check(Math.abs(out.rows * (out.rowPx ?? grid.u) + (out.rows - 1) * MG_GAP - mgSpanPx(grid.rows, grid.u)) < 1e-6, `rule 9: ${at} rows are not the grid's height`);
  }
}
const roomsUncovered = [];
for (const [w, h] of windows) {
  const grid = mgGrid(w, h - 104);
  const at = `rooms ${w}×${h} (${grid.cols}×${grid.rows})`;
  const { spatial, schedule } = roomTiles(grid);
  {
    const beside = spatial.y === 0 && spatial.h === grid.rows && schedule.y === 0 && schedule.h === grid.rows && schedule.x === spatial.x + spatial.w;
    const stacked = spatial.y === 0 && schedule.y === spatial.h && spatial.h + schedule.h === grid.rows && spatial.w === schedule.w && spatial.x === schedule.x;
    check(beside || stacked, `rule 9: ${at} the tiles are not the full height`);
    // Every column wherever two tiles inside their bounds can cover the grid
    // (beside or stacked). Two tiles cannot cover a board much wider than
    // 16 : 9 + 2 : 1 side by side, nor a near square one (either split puts
    // one tile outside its bound): there the board is the widest that is
    // covered, centred, and the window is listed below.
    const inV = (w, h) => { const a = mgAspect("viewer", w, h, grid.u); return a >= CANVAS_ASPECT.min - 1e-9 && a <= CANVAS_ASPECT.max + 1e-9; };
    const inL = (w, h) => { const a = mgAspect("list", w, h, grid.u); return a >= 0.5 - 1e-9 && a <= 2 + 1e-9; };
    let coverable = false;
    for (let f = 1; f < grid.cols; f += 1) if (inV(f, grid.rows) && inL(grid.cols - f, grid.rows)) coverable = true;
    for (let r = 1; r < grid.rows; r += 1) if (inV(grid.cols, r) && inL(grid.cols, grid.rows - r)) coverable = true;
    const across = beside ? spatial.w + schedule.w : spatial.w;
    if (coverable) check(spatial.x === 0 && across === grid.cols, `rule 9: ${at} the tiles take ${across} of ${grid.cols} columns from ${spatial.x}`);
    else roomsUncovered.push(`${w}×${h} (${grid.cols}×${grid.rows}): ${across} of ${grid.cols}`);
    const v = mgAspect("viewer", spatial.w, spatial.h, grid.u);
    const l = mgAspect("list", schedule.w, schedule.h, grid.u);
    check(v >= CANVAS_ASPECT.min - 1e-9 && v <= CANVAS_ASPECT.max + 1e-9, `rule 4: ${at} spatial ${spatial.w}×${spatial.h} canvas ${v.toFixed(2)}`);
    check(l >= 0.5 - 1e-9 && l <= 2 + 1e-9, `rule 3: ${at} schedule ${schedule.w}×${schedule.h} renders ${l.toFixed(2)}`);
  }
  if (REFERENCE.some(([a, b]) => a === w && b === h))
    console.log(`  rooms ${w}×${h} ${grid.cols}×${grid.rows}: spatial ${spatial.w}×${spatial.h}@${spatial.x},${spatial.y} · schedule ${schedule.w}×${schedule.h}@${schedule.x},${schedule.y}`);
}
console.log(`  fewer, taller rows (nothing could grow): ${taller} of ${count} layouts`);
console.log(`  Rom, no two-tile cover inside the bounds (widest covered, centred): ${roomsUncovered.length} windows${roomsUncovered.length ? ": " + roomsUncovered.join(" · ") : ""}`);

/* ── the Graf tab: one main surface, the other a small window ───────── */

// The tab is the window less its chrome (104 px assumed, as above) and the
// main's frame margins. Both swap states are the same boxes, only which
// surface is in which, so one layout per window covers both.
const inBound = (r) => r.width / r.height >= CANVAS_ASPECT.min - 1e-9 && r.width / r.height <= CANVAS_ASPECT.max + 1e-9;
for (const [w, h] of windows) for (const second of [true, false]) {
  const sw = w - 2 * MG_MARGIN;
  const sh = h - 104 - 2 * MG_MARGIN;
  const g = graphStage(sw, sh, second);
  const at = `graf ${w}×${h}${second ? "" : " alone"}`;
  check(inBound(g.main), `${at}: main aspect ${(g.main.width / g.main.height).toFixed(2)}`);
  // At least 70 % of the tab, except where the tab is so wide that a 16:9
  // box cannot be (an ultrawide): there it is that box at full height.
  const share = (g.main.width * g.main.height) / (sw * sh);
  const widest = sw / sh > CANVAS_ASPECT.max / 0.7;
  check(widest ? g.main.height === sh && g.main.width === Math.floor(sh * CANVAS_ASPECT.max) : share >= 0.7, `${at}: main ${(100 * share).toFixed(0)} % of the tab`);
  check(g.main.left >= 0 && g.main.left + g.main.width <= sw && g.main.height <= sh, `${at}: main outside the stage`);
  if (!second) continue;
  const win = g.window;
  check(win !== null && inBound(win), `${at}: window aspect ${win ? (win.width / win.height).toFixed(2) : "none"}`);
  check(win.left >= 0 && win.top >= 0 && win.left + win.width <= sw && win.top + win.height <= sh, `${at}: window outside the stage`);
  check(win.width * win.height <= 0.2 * sw * sh, `${at}: window is not small`);
  if (g.beside) check(win.left >= g.main.left + g.main.width, `${at}: the window beside covers the main`);
}

console.log(`bento-pack-test: ${passes} assertions hold, ${failures} fail (${count} layouts)`);
process.exit(failures ? 1 : 0);
