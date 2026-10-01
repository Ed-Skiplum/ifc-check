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
  layoutContents,
  layoutOverview,
  layoutProject,
  mgAspect,
  mgGrid,
  mgRow,
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

// The reference at the 12 px frame margin (2026-09-30; the canon's table is
// at its 24 px margin): 1440 → 12, 1920 → 16, 2112 → 18, 2560 → 22 columns.
for (const [w, c] of [
  [1440, 12],
  [1920, 16],
  [2112, 18],
  [2560, 22],
]) {
  const g = mgGrid(w, 2000);
  check(g.cols === c, `rule 6: ${w} px gives ${g.cols} columns, the reference ${c}`);
  check(Math.abs(g.u - 100) < 8, `rule 6: ${w} px gives a ${g.u.toFixed(1)} px module, about 100`);
  check(Math.abs(g.cols * g.u + (g.cols - 1) * MG_GAP - (w - 2 * MG_MARGIN)) < 1e-6, `rule 6: ${w} px, C·u + (C−1)·16 = W − 2M`);
}
// Rows: R = floor((H − chrome − 2M + 16) / (u + 16)); with a 64 px chrome the
// reference rows come out: 900 → 6, 1080 → 8, 1267 → 10, 1440 → 11.
for (const [w, h, r] of [
  [1440, 900, 6],
  [1920, 1080, 8],
  [2112, 1267, 10],
  [2560, 1440, 11],
]) {
  const g = mgGrid(w, h - 64);
  check(g.rows === r, `rule 6: ${w}×${h} with a 64 px chrome gives ${g.rows} rows, the reference ${r}`);
}
// The rows take the leftover under the floor (2026-09-30): a row is the
// module or a little more, and the rows end one margin above the foot.
for (let h = 600; h <= 1700; h += 13) {
  const g = mgGrid(1920, h);
  const r = mgRow(g);
  check(r >= g.u - 1e-9 && r < g.u + (g.u + MG_GAP) / g.rows + 1e-9, `rule 6: ${h} px gives a ${r.toFixed(1)} px row on a ${g.u.toFixed(1)} px module`);
  check(Math.abs(g.rows * r + (g.rows - 1) * MG_GAP + 2 * MG_MARGIN - h) < 1e-6, `rule 6: ${h} px, R·r + (R−1)·16 + 2M = H − chrome`);
}

/** The board's inset from the window's frame, left, right, top, bottom:
 *  `avail` is the height under the chrome, margins included (`mgGrid`). The
 *  12 px frame margin on all four sides (2026-09-30). */
function insets(width, avail, layout, grid) {
  const rowPx = layout.rowPx ?? mgRow(grid);
  const left = MG_MARGIN + layout.offset * (grid.u + MG_GAP);
  const boardW = mgSpanPx(layout.used, grid.u);
  const top = MG_MARGIN + layout.top * (rowPx + MG_GAP);
  const boardH = layout.usedRows * rowPx + (layout.usedRows - 1) * MG_GAP;
  return [left, width - left - boardW, top, avail - top - boardH];
}
const inset12 = (i) => i.every((v) => Math.abs(v - MG_MARGIN) < 1e-6);
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
  noCounts: { ifc: 5, counts: 0 },
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
const dockSlots = new Map();
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
        const a = mgAspect(t.kind, t.w, t.h, grid.u, out.rowPx ?? mgRow(grid));
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
    const rowPx = out.rowPx ?? mgRow(grid);
    const gridH = grid.rows * mgRow(grid) + (grid.rows - 1) * MG_GAP;
    check(out.rows <= grid.rows && Math.abs(out.rows * rowPx + (out.rows - 1) * MG_GAP - gridH) < 1e-6, `rule 9: ${at} ${out.rows} rows of ${rowPx.toFixed(1)} px are not the grid's height`);
    const ins = insets(w, h - 104, out, grid);
    check(inset12(ins), `margin: ${at} inset ${ins.map((v) => v.toFixed(1)).join("/")}, not 12 on every side`);
    if (out.rowPx) taller += 1;
    // The arrangement (2026-09-30, the owner: "the scope tile should go
    // below the verification tile on the left margin and let the properties
    // panel take that full height"; "Right edge, full height"). By priority
    // the model, the checks and Detail are always tiles; Scope a tile, or at
    // the narrow break a fixed tab of Detail.
    const ids = new Set(out.tiles.map((t) => t.id));
    const tabbed = (id) => out.tiles.some((t) => t.tabs.includes(id));
    const tile = (id) => out.tiles.find((t) => t.id === id);
    check(ids.has("viewer") && ids.has("checks") && ids.has("detail"), `${at}: the model, the checks or Detail is not a tile`);
    check(ids.has("scope") || tile("detail")?.tabs.includes("scope"), `${at}: Scope is neither a tile nor Detail's tab`);
    for (const t of out.tiles) {
      if (t.id === "detail") check(t.tabs.every((id) => id === "scope"), `${at}: Detail hosts ${t.tabs.join(",")}`);
      else if (t.id === "scope" || t.kind === "viewer") check(t.tabs.length === 0, `${at}: ${t.id} hosts ${t.tabs.join(",")}`);
    }
    const checks = tile("checks");
    const detail = tile("detail");
    const scope = tile("scope");
    if (out.band?.startsWith("columns") || out.band?.startsWith("left")) {
      // The left column: the checks on top, the lower tile under them, the
      // two the full height; Detail the full height on the right edge.
      check(checks.x === 0 && checks.y === 0, `${at}: the checks are not top left (${checks.x},${checks.y})`);
      const lower = out.band.startsWith("columns") ? scope : detail;
      if (lower) check(lower.x === 0 && lower.w === checks.w && lower.y === checks.h && lower.y + lower.h === out.rows, `${at}: ${lower.id} is not under the checks (${lower.x},${lower.y} ${lower.w}×${lower.h})`);
      else check(checks.h === out.rows, `${at}: the checks are not the full height`);
      if (out.band.startsWith("columns"))
        check(detail.x + detail.w === grid.cols && detail.y === 0 && detail.h === out.rows, `${at}: Detail is not the full height on the right edge (${detail.x},${detail.y} ${detail.w}×${detail.h})`);
      // The KPI row: every IFC-struktur requirement an S card on the top row,
      // in order, between the columns.
      if (out.band.includes("kpis")) {
        const cards = out.tiles.filter((t) => /^ifc\d+$/.test(t.id)).sort((a, b) => a.x - b.x);
        check(cards.length === content.ifc && cards.every((t, i) => t.y === 0 && t.size === "S" && t.id === `ifc${i}`), `${at}: the KPI cards are not one S row on top, in order`);
        check(cards[0].x === checks.w, `${at}: the KPI row does not start beside the checks`);
      } else check(ids.has("reqs") || tabbed("reqs"), `${at}: the requirements are neither a tile nor a tab`);
    } else check(ids.has("reqs") || ids.has("ifc0") || tabbed("reqs"), `${at}: the requirements have no tile`);
    check(ids.has("floors") || tabbed("floors"), `${at}: the floors are neither a tile nor a tab`);
    check(ids.has("codes") || tabbed("codes"), `${at}: the classification codes are neither a tile nor a tab`);
    check(!ids.has("mmi") && ![...ids].some((id) => /^std\d+$/.test(id)), `${at}: a Standardkrav tile on the Overview`);
    // No treemap on the Overview (2026-09-30).
    check(![...ids].some((id) => /tree/.test(id)) && !out.tiles.some((t) => t.tabs.some((id) => /tree/.test(id))), `${at}: a treemap on the Overview`);
    // Detail and Scope are fixed per window: the same slot whatever the
    // loaded content's cards.
    const docks = JSON.stringify([detail, scope].map((t) => t && [t.x, t.y, t.w, t.h]));
    const key = `${w}×${h}`;
    if (dockSlots.has(key)) check(dockSlots.get(key) === docks, `stable: ${at} Detail or Scope moves with the content (${docks} vs ${dockSlots.get(key)})`);
    else dockSlots.set(key, docks);
    if (REFERENCE.some(([a, b]) => a === w && b === h))
      console.log(`  ${design} ${w}×${h} ${grid.cols}×${grid.rows}: ${out.band ?? "narrow fallback"} · board ${out.used}×${out.usedRows} · ${ms.toFixed(0)} ms · ${out.tiles.map((t) => `${t.id} ${t.w}×${t.h}@${t.x},${t.y}`).join(" ")}${out.moved.length ? ` · tabs ${out.moved.join(",")}` : ""}`);
    // Rule 8: a tile moved into a tab has lower priority than every tile of
    // its kind that stayed is not asserted (a composition may keep a lower
    // one that fits); every moved tile has a host.
    for (const id of out.moved) check(out.tiles.some((t) => t.tabs.includes(id)), `rule 8: ${at} moved ${id} has no host`);
  }
}

/* ── rule 9 on the Prosjekt and Rom tabs: every row, no holes ───────── */

// The IDS tab (2026-10-01): the report, the model, Scope and Detail; a
// function of the window alone.
{
  const design = "report";
  for (const [w, h] of windows) {
    const grid = mgGrid(w, h - 104);
    const at = `project ${design} ${w}×${h} (${grid.cols}×${grid.rows})`;
    let out;
    try {
      out = layoutProject(grid);
    } catch (error) {
      check(false, `${at}: no layout (${error.message})`);
      continue;
    }
    count += 1;
    if (out.rowPx) taller += 1;
    check(JSON.stringify(layoutProject({ ...grid })) === JSON.stringify(out), `rule 8: ${at} is not deterministic`);
    // The report is a tile, the dominant one.
    const report = out.tiles.find((t) => t.id === "report");
    check(!!report, `${at}: the report is not a tile`);
    if (report) check(out.tiles.every((t) => t.w * t.h <= report.w * report.h), `${at}: the report is not the largest tile`);
    check(out.tiles.some((t) => t.id === "viewer"), `${at}: the model is not a tile`);
    // The docks: tiles from 12 columns up, never hosts; under that fixed tabs.
    if (grid.cols >= 12 && grid.rows >= 6) check(["scope", "detail"].every((id) => out.tiles.some((t) => t.id === id)), `${at}: Scope or Detail is not a tile`);
    else check(["scope", "detail"].every((id) => out.tiles.some((t) => t.id === id || t.tabs.includes(id))), `${at}: Scope or Detail is neither a tile nor a tab`);
    if (REFERENCE.some(([a, b]) => a === w && b === h))
      console.log(`  ${at}: ${out.band ?? "packed"} · ${out.tiles.map((t) => `${t.id} ${t.w}×${t.h}@${t.x},${t.y}`).join(" ")}${out.moved.length ? ` · tabs ${out.moved.join(",")}` : ""}`);
    const occ = new Set();
    for (const t of out.tiles) {
      const [bw, bh] = t.base ?? [t.w, t.h];
      check(canonSize(bw, bh, t.id in MG_STRIPS, t.id in MG_TALL) === t.size, `rule 7: ${at} ${t.id} ${bw}×${bh} is not its ${t.size}`);
      if (t.base) check(t.w >= bw && t.h >= bh && t.w * t.h > bw * bh, `rule 5: ${at} ${t.id} grew ${bw}×${bh} to ${t.w}×${t.h}`);
      if (t.size !== "tall" && t.size !== "strip") {
        const a = mgAspect(t.kind, t.w, t.h, grid.u, out.rowPx ?? mgRow(grid));
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
    check(Math.abs(out.rows * (out.rowPx ?? mgRow(grid)) + (out.rows - 1) * MG_GAP - (grid.rows * mgRow(grid) + (grid.rows - 1) * MG_GAP)) < 1e-6, `rule 9: ${at} rows are not the grid's height`);
    const ins = insets(w, h - 104, out, grid);
    check(inset12(ins), `margin: ${at} inset ${ins.map((v) => v.toFixed(1)).join("/")}, not 12 on every side`);
  }
}
/* ── rule 9 on the Innhold tab: every row and column, no holes ────────── */

for (const [design, content] of Object.entries({ plain: { mmi: false }, mmi: { mmi: true } })) {
  for (const [w, h] of windows) {
    const grid = mgGrid(w, h - 104);
    const at = `contents ${design} ${w}×${h} (${grid.cols}×${grid.rows})`;
    let out;
    try {
      out = layoutContents(grid, content);
    } catch (error) {
      check(false, `${at}: no layout (${error.message})`);
      continue;
    }
    count += 1;
    if (out.rowPx) taller += 1;
    check(JSON.stringify(layoutContents({ ...grid }, { ...content })) === JSON.stringify(out), `stable: ${at}`);
    check(out.tiles.some((t) => t.id === "qto") && out.tiles.some((t) => t.id === "census"), `${at}: the QTO table or Etasje × klasse is not a tile`);
    if (!content.mmi) check(!out.tiles.some((t) => t.id === "mmi" || t.tabs.includes("mmi")), `${at}: an MMI tile without MMI`);
    for (const id of out.moved) check(out.tiles.some((t) => t.tabs.includes(id)), `rule 8: ${at} moved ${id} has no host`);
    // The hero is the largest tile (rule 2).
    const qto = out.tiles.find((t) => t.id === "qto");
    if (qto) check(out.tiles.every((t) => t.w * t.h <= qto.w * qto.h), `rule 2: ${at} a tile is larger than the QTO table`);
    const occ = new Set();
    for (const t of out.tiles) {
      const [bw, bh] = t.base ?? [t.w, t.h];
      check(canonSize(bw, bh, t.id in MG_STRIPS, t.id in MG_TALL) === t.size, `rule 7: ${at} ${t.id} ${bw}×${bh} is not its ${t.size}`);
      if (t.size !== "tall" && t.size !== "strip") {
        const a = mgAspect(t.kind, t.w, t.h, grid.u, out.rowPx ?? mgRow(grid));
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
    const ins = insets(w, h - 104, out, grid);
    check(inset12(ins), `margin: ${at} inset ${ins.map((v) => v.toFixed(1)).join("/")}, not 12 on every side`);
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
    const inV = (w, h) => { const a = mgAspect("viewer", w, h, grid.u, mgRow(grid)); return a >= CANVAS_ASPECT.min - 1e-9 && a <= CANVAS_ASPECT.max + 1e-9; };
    const inL = (w, h) => { const a = mgAspect("list", w, h, grid.u, mgRow(grid)); return a >= 0.5 - 1e-9 && a <= 2 + 1e-9; };
    let coverable = false;
    for (let f = 1; f < grid.cols; f += 1) if (inV(f, grid.rows) && inL(grid.cols - f, grid.rows)) coverable = true;
    for (let r = 1; r < grid.rows; r += 1) if (inV(grid.cols, r) && inL(grid.cols, grid.rows - r)) coverable = true;
    const across = beside ? spatial.w + schedule.w : spatial.w;
    if (coverable) check(spatial.x === 0 && across === grid.cols, `rule 9: ${at} the tiles take ${across} of ${grid.cols} columns from ${spatial.x}`);
    else roomsUncovered.push(`${w}×${h} (${grid.cols}×${grid.rows}): ${across} of ${grid.cols}`);
    // The 12 px margin: top and bottom always, left and right wherever the
    // two tiles cover every column.
    const ins = insets(w, h - 104, { offset: spatial.x, used: across, top: 0, usedRows: grid.rows }, grid);
    check(inset12(coverable ? ins : [MG_MARGIN, MG_MARGIN, ins[2], ins[3]]), `margin: ${at} inset ${ins.map((v) => v.toFixed(1)).join("/")}, not 12`);
    const v = mgAspect("viewer", spatial.w, spatial.h, grid.u, mgRow(grid));
    const l = mgAspect("list", schedule.w, schedule.h, grid.u, mgRow(grid));
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
