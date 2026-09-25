/** THE MODULE GRID of the design alternatives (`#design=a|b|c`), 2026-09-25.
 *
 * edkjo: *"we want to build this around a fixed grid size that is dynamically
 * adjusted to monitors/viewports according to best practice"*, and *"tiles need
 * to have aspect ratios that lend themselves to this. wide/short and
 * narrow/tall is to be avoided"* … *"unless the chart or component explicitly is
 * supposed to be that."* The research and the sources are in AGENTS.md,
 * "Design alternatives 2026-09-25". What this file fixes:
 *
 *   base unit      8 px (Carbon mini unit, Atlassian space.100; Fluent's 4 px
 *                  ramp halves it)
 *   row unit       32 px = 4 units, the dense table row, so a tile of h rows
 *                  holds whole list lines (Grafana: a fixed 30 px row unit)
 *   gutter         16 px = 2 units, both axes; row pitch 48 px
 *   columns        a multiple of 12: 12 · 24 · 36, the largest whose column
 *                  pitch stays at or above 50.67 px (24 columns at 1200 px).
 *                  So the module stays 51–76 px wide from 1200 px up and a
 *                  wider screen gets MORE columns, not fatter ones (Datadog
 *                  high density; Carbon 4 → 8 → 16)
 *   width cap      2400 px; above it the margins grow (Carbon max, Stripe)
 *   height         fixed. A tile is h rows; only a FILL tile (the list and the
 *                  inspector of `a`) takes the rows the viewport has left.
 *
 * Every tile is placed at whole units (x, y, w, h). A tile's width comes from
 * its CONTENT: `mgSpan(px)` is the fewest columns that seat it, and the one
 * fill tile of a row takes what is left. Its height is its content's lines,
 * raised only where that is needed to keep the tile inside its aspect bounds.
 *
 * Pure TS, `.ts` imports only, so `scripts/module-grid-gate.mjs` imports the
 * same numbers and the same vocabulary it asserts.
 */

export const MG_UNIT = 8;
export const MG_ROW = 4 * MG_UNIT; // 32
export const MG_GUTTER = 2 * MG_UNIT; // 16
export const MG_PITCH_Y = MG_ROW + MG_GUTTER; // 48
/** The pitch of 24 columns at 1200 px: the smallest module allowed. */
export const MG_MIN_PITCH = (1200 + MG_GUTTER) / 24;
export const MG_MAX_WIDTH = 2400;
/** A tile's own head: its label line. One row unit. */
export const MG_HEAD = MG_ROW;

export type MgColumns = 12 | 24 | 36;

export function mgColumns(width: number): MgColumns {
  const k = Math.floor((width + MG_GUTTER) / (12 * MG_MIN_PITCH));
  return (12 * Math.min(3, Math.max(1, k))) as MgColumns;
}

export function mgPitch(width: number, cols: number): number {
  return (width + MG_GUTTER) / cols;
}

/** The fewest columns whose span is at least `px` wide. */
export function mgSpan(px: number, pitch: number): number {
  return Math.max(1, Math.ceil((px + MG_GUTTER) / pitch - 1e-6));
}

/** Rendered width of a span of `w` columns. */
export function mgWidth(w: number, pitch: number): number {
  return w * pitch - MG_GUTTER;
}

/** Rendered height of `h` rows. */
export function mgHeight(h: number): number {
  return h * MG_PITCH_Y - MG_GUTTER;
}

/** The fewest rows whose span is at least `px` tall. */
export function mgRowsFor(px: number): number {
  return Math.max(1, Math.ceil((px + MG_GUTTER) / MG_PITCH_Y - 1e-6));
}

/** How many whole rows fit in `px` of height. */
export function mgRowsIn(px: number): number {
  return Math.max(1, Math.floor((px + MG_GUTTER) / MG_PITCH_Y));
}

/* ── The tile vocabulary: kinds and their aspect bounds ────────────────────
 *
 * Aspect = rendered width / rendered height, in px, at the viewport it is
 * drawn at (not in grid units: a unit is 51–76 px wide and 48 px tall).
 *
 * `panel` is the rule: 1 : 2 to 2 : 1. Every other kind is a named exception,
 * and each says what in its CONTENT makes it that shape. Packing convenience
 * is not a reason; `scripts/module-grid-gate.mjs` allows these kinds and no
 * others. */
export type MgKind = "panel" | "list" | "viewer" | "chart";

export const MG_ASPECT: Record<MgKind, { min: number; max: number; why: string }> = {
  panel: {
    min: 0.5,
    max: 2,
    why: "every stat, table, gauge and small multiple",
  },
  list: {
    min: 0.3,
    max: 2,
    why:
      "a long ranked list that scrolls: the rows ARE the content and a list is " +
      "read down, so it may be tall (a's master list, the checks of every rule)",
  },
  viewer: {
    min: 0.5,
    max: 2.4,
    why:
      "a camera: the scene frames whatever box it gets, and a building read " +
      "in elevation is wider than tall, so up to 21 : 9",
  },
  chart: {
    min: 0.5,
    max: 3,
    why:
      "a bar chart over an ordered scale (the MMI levels): the bars read " +
      "across, one per level, so it may be wider than tall",
  },
};

/** One tile, in grid units. */
export interface MgPlace {
  id: string;
  kind: MgKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A group's title line in `c` (a Grafana row): one row, a title and nothing
 *  else, so it is a heading and not a tile. It spans its region, `x` to
 *  `x + w`; the whole grid when the layout has one region. */
export interface MgRowTitle {
  id: string;
  y: number;
  x: number;
  w: number;
}

export interface MgLayout {
  cols: MgColumns;
  pitch: number;
  tiles: MgPlace[];
  titles: MgRowTitle[];
  rows: number;
  /** The charts ride inside the list tile instead of taking tiles of their
   *  own (the compact class, where 12 × 13 cells cannot seat seven tiles at
   *  their aspect bounds). */
  chartsInList: boolean;
}

/** What the board needs, measured by the board. */
export interface MgNeeds {
  /** Rows the viewport has left under the board's top edge. The board is one
   *  screen: every layout fills exactly these rows, and a tile's surplus
   *  scrolls inside it. */
  rowsAvail: number;
}

/** Content widths, px, at the alternatives' 13 px list type. */
const PX = {
  // A requirement row: status badge, the name, the dekning figure and its
  // «x av N», with the fordeling chips wrapping under it.
  reqList: 400,
  // A chart tile (a treemap, the MMI bars): enough for a labelled cell.
  chart: 240,
  // A requirement panel in c: the name on one line and «2 555 av 3 138».
  reqPanel: 150,
  // Scope: GUID (25ch mono) and the class; name and reason ellipsize.
  scope: 300,
  // The object panel's lead cards, two up.
  detail: 240,
  // The check list without its % column: the longest check name, the 18em
  // verdict cell at 13 px, one gap and the padding.
  checks: 392,
  multipleMax: 256,
};

/** The fewest rows that keep a tile of rendered width `px` at or under
 *  `max` : 1. */
function rowsForAspect(px: number, max: number): number {
  return mgRowsFor(px / max);
}

/** Split `total` rows over `n` tiles, the remainder to the first ones. */
function splitRows(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0));
}

/** Split `total` columns over `n` tiles, the remainder to the first ones. */
function splitCols(total: number, n: number): number[] {
  return splitRows(total, n);
}

/** The inspector block every alternative docks: the viewer on top, then
 *  Scope and Detail. Side by side under the viewer when the block is wide
 *  enough to seat both, else stacked. The viewer takes the rows that keep it
 *  inside its own bound and never more than leaves Scope and Detail a usable
 *  height. */
function inspector(tiles: MgPlace[], x: number, y: number, w: number, h: number, pitch: number, stack = false) {
  const px = mgWidth(w, pitch);
  const sideBySide = !stack && px >= PX.scope + PX.detail + MG_GUTTER;
  const minBelow = sideBySide ? 5 : 8;
  const vh = Math.max(3, Math.min(h - minBelow, rowsForAspect(px, MG_ASPECT.viewer.max)));
  tiles.push({ id: "viewer", kind: "viewer", x, y, w, h: vh });
  const below = h - vh;
  if (sideBySide) {
    const sw = Math.max(mgSpan(PX.scope, pitch), Math.ceil(w / 2));
    tiles.push({ id: "scope", kind: "list", x, y: y + vh, w: sw, h: below });
    tiles.push({ id: "detail", kind: "list", x: x + sw, y: y + vh, w: w - sw, h: below });
  } else {
    const [sh, dh] = splitRows(below, 2);
    tiles.push({ id: "scope", kind: "list", x, y: y + vh, w, h: sh });
    tiles.push({ id: "detail", kind: "list", x, y: y + vh + sh, w, h: dh });
  }
}

/** Scope over Detail in one column (b's rail, c's right region). */
function rail(tiles: MgPlace[], x: number, y: number, w: number, h: number) {
  const [sh, dh] = splitRows(h, 2);
  tiles.push({ id: "scope", kind: "list", x, y, w, h: sh });
  tiles.push({ id: "detail", kind: "list", x, y: y + sh, w, h: dh });
}

const CHARTS = [
  { id: "tree-system", kind: "panel" as MgKind },
  { id: "tree-function", kind: "panel" as MgKind },
  { id: "mmi", kind: "chart" as MgKind },
];

/* ── a · Linear work surface: list | inspector | charts ─────────────────── */

export function layoutA(width: number, needs: MgNeeds): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const n = Math.max(10, needs.rowsAvail);
  const tiles: MgPlace[] = [];
  if (cols === 12) {
    // Compact: the list (the charts inside it) | the inspector.
    const lw = 5;
    tiles.push({ id: "reqs", kind: "list", x: 0, y: 0, w: lw, h: n });
    inspector(tiles, lw, 0, cols - lw, n, pitch);
    return { cols, pitch, tiles, titles: [], rows: n, chartsInList: true };
  }
  const lw = mgSpan(PX.reqList, pitch);
  const cw = Math.max(mgSpan(PX.chart, pitch), Math.round(cols * 0.2));
  tiles.push({ id: "reqs", kind: "list", x: 0, y: 0, w: lw, h: n });
  inspector(tiles, lw, 0, cols - lw - cw, n, pitch);
  // The charts, one column at the right edge, a third of the height each.
  const hs = splitRows(n, 3);
  let y = 0;
  CHARTS.forEach((c, i) => {
    tiles.push({ id: c.id, kind: c.kind, x: cols - cw, y, w: cw, h: hs[i] });
    y += hs[i];
  });
  return { cols, pitch, tiles, titles: [], rows: n, chartsInList: false };
}

/* ── b · Stripe summary: the charts first, then the report ─────────────── */

export function layoutB(width: number, needs: MgNeeds): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const n = Math.max(10, needs.rowsAvail);
  const tiles: MgPlace[] = [];
  if (cols === 12) {
    const lw = 5;
    tiles.push({ id: "reqs", kind: "list", x: 0, y: 0, w: lw, h: n });
    inspector(tiles, lw, 0, cols - lw, n, pitch);
    return { cols, pitch, tiles, titles: [], rows: n, chartsInList: true };
  }
  // The summary row: the two treemaps, then the MMI bars, which read across
  // and take the widest share. Tall enough that a treemap stays inside 2 : 1.
  const tw = Math.round(cols * 0.3);
  const mw = cols - 2 * tw;
  const ch = Math.max(4, rowsForAspect(mgWidth(tw, pitch), MG_ASPECT.panel.max), rowsForAspect(mgWidth(mw, pitch), MG_ASPECT.chart.max));
  tiles.push({ id: "tree-system", kind: "panel", x: 0, y: 0, w: tw, h: ch });
  tiles.push({ id: "tree-function", kind: "panel", x: tw, y: 0, w: tw, h: ch });
  tiles.push({ id: "mmi", kind: "chart", x: 2 * tw, y: 0, w: mw, h: ch });
  // Then the report down one column, the model beside it as the evidence,
  // and the rail: Scope over Detail.
  const h = n - ch;
  const lw = mgSpan(PX.reqList + 60, pitch);
  // The rail: wide enough for Scope, near 1.6 : 1 per half, and never past
  // 2 : 1 for the shorter half.
  let aspectCols = 1;
  while (mgWidth(aspectCols + 1, pitch) <= MG_ASPECT.list.max * mgHeight(Math.floor(h / 2))) aspectCols += 1;
  const rw = Math.max(mgSpan(PX.scope, pitch), Math.min(aspectCols, Math.max(mgSpan(PX.scope + 80, pitch), rowsToCols(h, pitch))));
  const vw = cols - lw - rw;
  tiles.push({ id: "reqs", kind: "list", x: 0, y: ch, w: lw, h });
  tiles.push({ id: "viewer", kind: "viewer", x: lw, y: ch, w: vw, h });
  rail(tiles, lw + vw, ch, rw, h);
  return { cols, pitch, tiles, titles: [], rows: n, chartsInList: false };
}

/** The fewest columns that keep a rail half of `h` rows at or under 2 : 1
 *  is the wrong question; the rail is read down, so it needs only to be wide
 *  enough for Scope. Kept as the width that makes each half near 1.6 : 1. */
function rowsToCols(h: number, pitch: number): number {
  return mgSpan(mgHeight(Math.floor(h / 2)) * 1.6, pitch);
}

/* ── c · Grafana / Datadog: the report's groups as rows of panels ──────── */

export function layoutC(width: number, needs: MgNeeds & { ifc: number; std: number }): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const n = Math.max(10, needs.rowsAvail);
  const tiles: MgPlace[] = [];
  const titles: MgRowTitle[] = [];
  if (cols === 12) {
    // Compact: the groups and the charts in one scrolling list, the
    // inspector beside it. 12 × 13 cells cannot seat eleven panels, three
    // charts and the inspector at their bounds.
    const lw = 5;
    tiles.push({ id: "reqs", kind: "list", x: 0, y: 0, w: lw, h: n });
    inspector(tiles, lw, 0, cols - lw, n, pitch);
    return { cols, pitch, tiles, titles, rows: n, chartsInList: true };
  }
  const rw = Math.round(cols / 4);
  const lw = cols - rw;
  let y = 0;
  // One group row per report section, then the charts row. Panel heights
  // keep every panel inside 2 : 1.
  const group = (id: string, count: number, prefix: string) => {
    titles.push({ id, y, x: 0, w: lw });
    y += 1;
    const ws = splitCols(lw, count);
    const h = Math.max(3, rowsForAspect(mgWidth(Math.max(...ws), pitch), MG_ASPECT.panel.max));
    let x = 0;
    ws.forEach((w, i) => {
      tiles.push({ id: `${prefix}${i}`, kind: "panel", x, y, w, h });
      x += w;
    });
    y += h;
  };
  group("g-ifc", needs.ifc, "ifc");
  group("g-std", needs.std, "std");
  // The charts row carries no title: its tiles name themselves. The check
  // list takes what its name and verdict columns need; the MMI bars a third
  // of the rest (they turn into rows when narrow); the two treemaps split the
  // remainder.
  const ch = n - y;
  const kw = mgSpan(PX.checks, pitch);
  const rest = lw - kw;
  // The treemaps side by side, or stacked in one column when side by side
  // would make them tall and narrow: whichever puts a treemap nearer square.
  const side = { tw: Math.floor((rest - Math.max(3, Math.round(rest / 3))) / 2), th: ch };
  let stackTw = Math.ceil(rest * 0.55);
  while (stackTw > 3 && mgWidth(stackTw, pitch) > MG_ASPECT.panel.max * mgHeight(Math.floor(ch / 2))) stackTw -= 1;
  const off = (w: number, h: number) => Math.abs(Math.log(mgWidth(w, pitch) / mgHeight(h)));
  const stacked = ch >= 6 && off(stackTw, Math.floor(ch / 2)) < off(side.tw, side.th);
  if (stacked) {
    const [h1, h2] = splitRows(ch, 2);
    tiles.push({ id: "tree-system", kind: "panel", x: 0, y, w: stackTw, h: h1 });
    tiles.push({ id: "tree-function", kind: "panel", x: 0, y: y + h1, w: stackTw, h: h2 });
    tiles.push({ id: "mmi", kind: "chart", x: stackTw, y, w: rest - stackTw, h: ch });
  } else {
    const mw = rest - 2 * side.tw;
    tiles.push({ id: "tree-system", kind: "panel", x: 0, y, w: side.tw, h: ch });
    tiles.push({ id: "tree-function", kind: "panel", x: side.tw, y, w: side.tw, h: ch });
    tiles.push({ id: "mmi", kind: "chart", x: 2 * side.tw, y, w: mw, h: ch });
  }
  tiles.push({ id: "checks", kind: "list", x: rest, y, w: kw, h: ch });
  // The right region: the model over Scope over Detail.
  const vh = Math.max(4, Math.min(Math.floor(n / 3), rowsForAspect(mgWidth(rw, pitch), MG_ASPECT.viewer.max)));
  tiles.push({ id: "viewer", kind: "viewer", x: lw, y: 0, w: rw, h: vh });
  rail(tiles, lw, vh, rw, n - vh);
  return { cols, pitch, tiles, titles, rows: n, chartsInList: false };
}

/* ── kept, off the main dash ─────────────────────────────────────────────
 *
 * The small-multiple packers that laid out c's per-storey and per-class
 * panels until 2026-09-25. The owner: *"I dont understand the obsession with
 * floor vs ifcclass."* Those views left the main dash for the report's
 * requirements; the storey and class numbers stay on Innhold (Klasser,
 * Etasje × klasse) and the bento board. Kept for a drill-down that wants
 * them back. */


/** Small multiples: `count` equal panels per row, the per-row count chosen
 *  from the divisors of the region's columns so every panel is `minPx` to
 *  `PX.multipleMax` wide, the one that leaves the fewest empty slots in the
 *  last row winning (ties: more per row). One size for all, so they compare;
 *  a last row that ends short keeps that size rather than stretching. */
export function multiples(
  count: number,
  regionCols: number,
  pitch: number,
  minPx: number,
): { w: number; perRow: number; rows: number } {
  let best: { w: number; perRow: number; empty: number } | null = null;
  for (let w = 1; w <= regionCols; w += 1) {
    if (regionCols % w !== 0) continue;
    const px = mgWidth(w, pitch);
    if (px < minPx || px > PX.multipleMax) continue;
    const perRow = regionCols / w;
    const empty = count === 0 ? 0 : (perRow - (count % perRow)) % perRow;
    if (!best || empty < best.empty || (empty === best.empty && perRow > best.perRow)) {
      best = { w, perRow, empty };
    }
  }
  const pick = best ?? { w: mgSpan(minPx, pitch), perRow: Math.max(1, Math.floor(regionCols / mgSpan(minPx, pitch))), empty: 0 };
  return { w: pick.w, perRow: pick.perRow, rows: Math.ceil(Math.max(1, count) / pick.perRow) };
}

/** Multiples beside a lead panel: the panel width that leaves the fewest
 *  empty cells in the last row (ties: more per row). The region need not be
 *  divisible; its leftover columns go to the lead panel, so they are content,
 *  not air. */
export function rowMultiples(
  count: number,
  region: number,
  pitch: number,
  minPx: number,
): { w: number; perRow: number; rows: number } {
  let best: { w: number; perRow: number; waste: number } | null = null;
  for (let w = mgSpan(minPx, pitch); w <= region; w += 1) {
    if (mgWidth(w, pitch) > PX.multipleMax) break;
    const perRow = Math.max(1, Math.min(count, Math.floor(region / w)));
    const rows = Math.ceil(Math.max(1, count) / perRow);
    const waste = (rows * perRow - count) * w;
    if (!best || waste < best.waste || (waste === best.waste && perRow > best.perRow)) {
      best = { w, perRow, waste };
    }
  }
  const pick = best ?? { w: mgSpan(minPx, pitch), perRow: 1, waste: 0 };
  return { w: pick.w, perRow: pick.perRow, rows: Math.ceil(Math.max(1, count) / pick.perRow) };
}

