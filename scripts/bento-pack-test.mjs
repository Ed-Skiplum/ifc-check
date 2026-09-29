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
  MG_STRIPS,
  MG_TALL,
  SIZES,
  canonSize,
  fitSide,
  graphTiles,
  layoutOverview,
  mgGrid,
  mgSpanPx,
} from "../src/ui/alt/module-grid.ts";

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

// The reference: 1440 → 12, 1920 → 16, 2112 → 18, 2560 → 22 columns.
for (const [w, c] of [
  [1440, 12],
  [1920, 16],
  [2112, 18],
  [2560, 22],
]) {
  const g = mgGrid(w, 2000);
  check(g.cols === c, `rule 6: ${w} px gives ${g.cols} columns, the reference ${c}`);
  check(Math.abs(g.u - 100) < 8, `rule 6: ${w} px gives a ${g.u.toFixed(1)} px module, about 100`);
  check(Math.abs(g.cols * g.u + (g.cols - 1) * MG_GAP - (w - 48)) < 1e-6, `rule 6: ${w} px, C·u + (C−1)·16 = W − 48`);
}
// Rows: R = floor((H − chrome − 48 + 16) / (u + 16)); with a 64 px chrome the
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

// The Overview (the one board since 2026-09-28): with a project mapping the
// treemaps are the project tab's (none here), without one both are general.
const contents = {
  mapped: { ifc: 5, counts: 4, trees: [] },
  general: { ifc: 5, counts: 4, trees: ["tree-system", "tree-function"] },
  // The verification as a left sidebar (2026-09-29), at the two widths
  // `sideModules` picks from.
  side4: { ifc: 5, counts: 4, trees: ["tree-system", "tree-function"], side: 4 },
  side5: { ifc: 5, counts: 4, trees: [], side: 5 },
};
const windows = [];
for (let w = 1100; w <= 3440; w += 130) for (let h = 700; h <= 1600; h += 150) windows.push([w, h]);
windows.push([1100, 800], [1280, 800], [1440, 900], [1920, 1080], [2112, 1267], [2560, 1440], [3440, 1440]);
// 2112 × 1300 here is the owner's 2112 × 1267 window as the app lays it
// out (its chrome is less than the 104 px assumed here): 18 × 10.
windows.push([2112, 1300]);
const REFERENCE = [[1440, 900], [1920, 1080], [2112, 1267], [2112, 1300], [2560, 1440], [3440, 1440]];

let count = 0;
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
    const occ = new Map();
    let xl = 0;
    for (const t of out.tiles) {
      const size = canonSize(t.w, t.h, t.id in MG_STRIPS, t.id in MG_TALL);
      check(size !== null, `rule 7: ${at} ${t.id} ${t.w}×${t.h} is no canon size`);
      check(size === t.size, `rule 7: ${at} ${t.id} says ${t.size}, is ${size}`);
      if (size === "XL") xl += 1;
      check(t.x >= 0 && t.y >= 0 && t.x + t.w <= grid.cols && t.y + t.h <= grid.rows, `rule 1: ${at} ${t.id} outside the grid`);
      check(!(t.w >= grid.cols && size !== "strip"), `rule 3: ${at} ${t.id} spans the full width`);
      for (let y = t.y; y < t.y + t.h; y += 1)
        for (let x = t.x; x < t.x + t.w; x += 1) {
          check(!occ.has(`${x},${y}`), `rule 9: ${at} ${t.id} overlaps ${occ.get(`${x},${y}`)}`);
          occ.set(`${x},${y}`, t.id);
        }
    }
    check(xl <= 2, `rule 7: ${at} has ${xl} XL`);
    // Rule 9: the tiles cover the board rectangle exactly, centred.
    let holes = 0;
    for (let y = out.top; y < out.top + out.usedRows; y += 1)
      for (let x = out.offset; x < out.offset + out.used; x += 1) if (!occ.has(`${x},${y}`)) holes += 1;
    check(holes === 0, `rule 9: ${at} has ${holes} holes`);
    check(occ.size === out.used * out.usedRows, `rule 9: ${at} tiles outside the board rectangle`);
    check(Math.abs(out.offset - (grid.cols - out.offset - out.used)) <= 1, `rule 9: ${at} board not centred across`);
    check(Math.abs(out.top - (grid.rows - out.top - out.usedRows)) <= 1, `rule 9: ${at} board not centred down`);
    // The docks and the model are always tiles; the requirements too (a list
    // or c's panels).
    const ids = new Set(out.tiles.map((t) => t.id));
    check(ids.has("viewer") && ids.has("scope"), `${at}: the model or Scope is not a tile`);
    check(ids.has("detail") || out.tiles.some((t) => t.tabs.includes("detail")), `${at}: Detail is neither a tile nor a tab`);
    check(ids.has("reqs") || ids.has("ifc0"), `${at}: the requirements have no tile`);
    check(!ids.has("mmi") && ![...ids].some((id) => /^std\d+$/.test(id)), `${at}: a Standardkrav tile on the Overview`);
    // The KPI row: every IFC-struktur requirement an S card on the TOP row,
    // never a list; the floor sidebar the full height under it, on the right.
    if (!ids.has("reqs")) {
      const cards = out.tiles.filter((t) => /^ifc\d+$/.test(t.id));
      check(cards.length === content.ifc && cards.every((t) => t.y === out.top && t.size === "S"), `${at}: the KPI cards are not one S row on top`);
      const f = out.tiles.find((t) => t.id === "floors");
      check(
        !!f && f.y === out.top + 2 && f.h === out.usedRows - 2 && f.x + f.w === out.offset + out.used,
        `${at}: the floor sidebar is not the full height on the right (${f ? `${f.x},${f.y} ${f.w}×${f.h}` : "none"})`,
      );
    } else check(ids.has("floors") || out.tiles.some((t) => t.tabs.includes("floors")), `${at}: the floors are neither a tile nor a tab`);
    // The verification sidebar: on the left, the board's full height, its
    // width; or, where the columns left seat no board, back in the board.
    if (content.side) {
      const c = out.tiles.find((t) => t.id === "checks");
      if (out.band === "kpis+side")
        check(
          !!c && c.x === out.offset && c.y === out.top && c.h === out.usedRows && c.w === content.side && c.size === "tall",
          `${at}: the verification sidebar is not the full height on the left (${c ? `${c.x},${c.y} ${c.w}×${c.h}` : "none"})`,
        );
      else check(!!c || out.tiles.some((t) => t.tabs.includes("checks")), `${at}: no sidebar, and the checks are neither a tile nor a tab`);
    }
    if (REFERENCE.some(([a, b]) => a === w && b === h))
      console.log(`  ${design} ${w}×${h} ${grid.cols}×${grid.rows}: ${out.band ?? "narrow fallback"} · board ${out.used}×${out.usedRows} · ${ms.toFixed(0)} ms · ${out.tiles.map((t) => `${t.id} ${t.w}×${t.h}@${t.x},${t.y}`).join(" ")}${out.moved.length ? ` · tabs ${out.moved.join(",")}` : ""}`);
    // Rule 8: a tile moved into a tab has lower priority than every tile of
    // its kind that stayed is not asserted (a composition may keep a lower
    // one that fits); every moved tile has a host.
    for (const id of out.moved) check(out.tiles.some((t) => t.tabs.includes(id)), `rule 8: ${at} moved ${id} has no host`);
  }
}

/* ── the verification sidebar's height (`fitSide`) ─────────────────────── */

{
  const grid = mgGrid(1920, 1080 - 104);
  const out = layoutOverview(grid, { ifc: 5, counts: 4, trees: [], side: 4 });
  const col = out.tiles.find((t) => t.id === "checks");
  const rowsPx = (n) => mgSpanPx(n, grid.u);
  for (const need of [100, rowsPx(3), rowsPx(3) + 1, rowsPx(4), rowsPx(col.h) - 1, rowsPx(col.h) + 400]) {
    const fit = fitSide(out, need);
    const c = fit.tiles.find((t) => t.id === "checks");
    const size = canonSize(c.w, c.h, false, true);
    check(size !== null && size === c.size, `fitSide ${need.toFixed(0)} px: ${c.w}×${c.h} is no canon size`);
    check(c.h <= col.h && c.x === col.x && c.y === col.y, `fitSide ${need.toFixed(0)} px: left its column`);
    check(rowsPx(c.h) >= need || c.h === col.h, `fitSide ${need.toFixed(0)} px: ${c.h} rows do not seat it`);
    check(c.h === col.h || c.h === 3 || !canonSize(c.w, c.h - 1, false, true) || rowsPx(c.h - 1) < need, `fitSide ${need.toFixed(0)} px: ${c.h} rows, fewer would do`);
    check(JSON.stringify(fit.tiles.filter((t) => t.id !== "checks")) === JSON.stringify(out.tiles.filter((t) => t.id !== "checks")), `fitSide: moved another tile`);
  }
}

/* ── the Graf tab ───────────────────────────────────────────────────────── */

for (const [w, h] of windows) {
  const grid = mgGrid(w, h - 104);
  const g = graphTiles(grid);
  for (const t of [g.main, g.second]) {
    const size = canonSize(t.w, t.h);
    check(size === "XL" || (grid.cols < 12 && size === "L" && t === g.second), `graf ${w}×${h}: ${t.id} ${t.w}×${t.h} is ${size}`);
    check(t.x + t.w <= grid.cols, `graf ${w}×${h}: ${t.id} outside the grid`);
    const a = mgSpanPx(t.w, grid.u) / mgSpanPx(t.h, grid.u);
    check(a >= MG_ASPECT.graph.min && a <= MG_ASPECT.graph.max, `graf ${w}×${h}: ${t.id} aspect ${a.toFixed(2)}`);
  }
}

console.log(`bento-pack-test: ${passes} assertions hold, ${failures} fail (${count} layouts)`);
process.exit(failures ? 1 : 0);
