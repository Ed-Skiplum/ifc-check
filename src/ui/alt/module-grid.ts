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
export type MgKind = "panel" | "list" | "viewer" | "band";

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
  band: {
    min: 0.4,
    max: 2.4,
    why: "the derivation table: rows × four columns beside the object panel",
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

/** A group's title line in `c` (a Grafana row): one row, full width, a title
 *  and nothing else, so it is a heading and not a tile. */
export interface MgRowTitle {
  id: string;
  y: number;
}

export interface MgLayout {
  cols: MgColumns;
  pitch: number;
  tiles: MgPlace[];
  titles: MgRowTitle[];
  rows: number;
}

/** What the content needs, measured in lines and px by the board. */
export interface MgNeeds {
  /** The checks list's lines: its header, the checks, the rule section. */
  checkLines: number;
  /** The floor tile's lines (header and floors) and its content width. */
  floorLines: number;
  floorPx: number;
  storeys: number;
  classes: number;
  /** Rows the viewport has left under the board's top edge. */
  rowsAvail: number;
  bandOpen: boolean;
}

/** Content widths, px, at the alternatives' 13 px list type. */
const PX = {
  checks: 470, // name ~ 18 ch + the 18 em verdict cell + the % column
  stat: 140, // a label and a figure such as "339 / 398"
  statLead: 170, // a figure and its verdict badge, "182  ✗ AVVIK"
  verdict: 200,
  viewerMin: 340,
  band: 700,
  inspectorSplit: 1200,
  storey: 150,
  klass: 190,
  // A multiple is 3 rows (128 px) tall, so 2 : 1 caps it at 256 px.
  multipleMax: 256,
  spatial: 240,
};

/** Rows for a list tile of `lines` 32 px lines under its head. */
function listRows(lines: number): number {
  return mgRowsFor(MG_HEAD + lines * MG_ROW);
}

/** The fewest rows that keep a tile of rendered width `px` at or under
 *  `max` : 1. */
function rowsForAspect(px: number, max: number): number {
  return mgRowsFor(px / max);
}

/* ── a · Linear work surface: list | inspector ───────────────────────────── */

export function layoutA(width: number, needs: MgNeeds): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const listW = cols === 12 ? 6 : mgSpan(PX.checks + 70, pitch);
  const iw = cols - listW;
  // The screen's rows, never fewer than keep the model inside its bound.
  const n = Math.max(12, needs.rowsAvail, rowsForAspect(mgWidth(iw, pitch), MG_ASPECT.viewer.max));
  const tiles: MgPlace[] = [{ id: "list", kind: "list", x: 0, y: 0, w: listW, h: n }];
  if (!needs.bandOpen) {
    tiles.push({ id: "viewer", kind: "viewer", x: listW, y: 0, w: iw, h: n });
  } else if (mgWidth(iw, pitch) >= PX.inspectorSplit) {
    const bw = mgSpan(PX.band, pitch);
    tiles.push({ id: "viewer", kind: "viewer", x: listW, y: 0, w: iw - bw, h: n });
    tiles.push({ id: "band", kind: "band", x: cols - bw, y: 0, w: bw, h: n });
  } else {
    // Stacked: the viewer takes the rows that keep it inside its own bound,
    // the band the rest.
    const vh = Math.max(Math.ceil(n / 2), rowsForAspect(mgWidth(iw, pitch), MG_ASPECT.viewer.max));
    tiles.push({ id: "viewer", kind: "viewer", x: listW, y: 0, w: iw, h: vh });
    tiles.push({ id: "band", kind: "band", x: listW, y: vh, w: iw, h: Math.max(4, n - vh) });
  }
  return { cols, pitch, tiles, titles: [], rows: rowsOf(tiles) };
}

/* ── b · Stripe summary: the numbers, then the report ───────────────────── */

export function layoutB(width: number, needs: MgNeeds): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const tiles: MgPlace[] = [];
  // The numbers: three verdict counts and four neutral counts, 3v + 4n = C.
  // The neutral values are the longer strings ("339 / 398", "21,5 MB"), so on
  // 36 columns they take the wider share; the verdicts lead by colour and
  // numeral, not by width.
  const [v, nn] = cols === 36 ? [4, 6] : cols === 24 ? [4, 3] : [4, 3];
  const vPx = mgWidth(v, pitch);
  const nPx = mgWidth(nn, pitch);
  let y = 0;
  if (cols === 12) {
    const h1 = Math.max(3, rowsForAspect(vPx, 2));
    for (let i = 0; i < 3; i += 1) tiles.push({ id: `v${i}`, kind: "panel", x: i * v, y, w: v, h: h1 });
    y += h1;
    const h2 = Math.max(3, rowsForAspect(nPx, 2));
    for (let i = 0; i < 4; i += 1) tiles.push({ id: `n${i}`, kind: "panel", x: i * nn, y, w: nn, h: h2 });
    y += h2;
  } else {
    const h = Math.max(3, rowsForAspect(Math.max(vPx, nPx), 2));
    for (let i = 0; i < 3; i += 1) tiles.push({ id: `v${i}`, kind: "panel", x: i * v, y, w: v, h });
    for (let i = 0; i < 4; i += 1)
      tiles.push({ id: `n${i}`, kind: "panel", x: 3 * v + i * nn, y, w: nn, h });
    y += h;
  }
  // The report: checks, then floors, down the main column; the model beside
  // them as the evidence, as tall as the two.
  const m = cols === 12 ? 6 : Math.max(mgSpan(PX.checks, pitch), mgSpan(needs.floorPx, pitch));
  const hc = Math.max(listRows(needs.checkLines), rowsForAspect(mgWidth(m, pitch), 2));
  let hf = Math.max(listRows(needs.floorLines), rowsForAspect(mgWidth(m, pitch), 2));
  const vw = cols - m;
  // Grow the floor tile (it scrolls) until the viewer beside the column is
  // inside its bound.
  while (mgWidth(vw, pitch) / mgHeight(hc + hf) > MG_ASPECT.viewer.max) hf += 1;
  tiles.push({ id: "checks", kind: "panel", x: 0, y, w: m, h: hc });
  tiles.push({ id: "floors", kind: "panel", x: 0, y: y + hc, w: m, h: hf });
  tiles.push({ id: "viewer", kind: "viewer", x: m, y, w: vw, h: hc + hf });
  return { cols, pitch, tiles, titles: [], rows: rowsOf(tiles) };
}

/* ── c · Grafana / Datadog: grouped rows, small multiples ───────────────── */

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

/** Multiples that must fill a band of `height` rows beside a taller lead
 *  (the floor matrix): the row count whose panels land nearest 1.3 : 1 with
 *  the fewest empty slots, every panel inside 1 : 2 to 2 : 1. Null when no
 *  split qualifies. */
function fitMultiples(
  count: number,
  region: number,
  pitch: number,
  height: number,
): { w: number; perRow: number; rows: number } | null {
  let best: { w: number; perRow: number; rows: number; score: number } | null = null;
  for (let rows = 1; rows <= Math.min(count, Math.floor(height / 3)); rows += 1) {
    const perRow = Math.ceil(count / rows);
    const w = Math.floor(region / perRow);
    if (w < 1) continue;
    const aspect = mgWidth(w, pitch) / mgHeight(Math.floor(height / rows));
    if (aspect < 0.5 || aspect > 2) continue;
    const score = rows * perRow - count + Math.abs(Math.log(aspect / 1.3));
    if (!best || score < best.score) best = { w, perRow, rows, score };
  }
  return best;
}

export function layoutC(
  width: number,
  needs: MgNeeds & { matrix: boolean },
): MgLayout {
  const cols = mgColumns(width);
  const pitch = mgPitch(width, cols);
  const tiles: MgPlace[] = [];
  const titles: MgRowTitle[] = [];
  let y = 0;

  // Group 1, Verifikasjon: a block of stat panels (the three verdict counts
  // and Romlig struktur in one column, the four neutral counts in the next),
  // the checks, the model.
  titles.push({ id: "g-verify", y });
  y += 1;
  const vw0 = mgSpan(PX.statLead, pitch);
  const sw = mgSpan(PX.stat, pitch);
  const cw = mgSpan(PX.checks, pitch);
  const compact = cols - vw0 - sw - cw < mgSpan(PX.viewerMin, pitch);
  const hc = listRows(needs.checkLines);
  if (compact) {
    // 12 columns: the stat block and the checks side by side, the model on
    // its own row under them.
    const half = cols / 2;
    const h = Math.max(12, hc);
    statBlock(tiles, 0, y, Math.floor(half / 2), Math.floor(half / 2), h);
    tiles.push({ id: "checks", kind: "panel", x: half, y, w: cols - half, h });
    y += h;
    const vh = rowsForAspect(mgWidth(cols, pitch), 2);
    tiles.push({ id: "viewer", kind: "viewer", x: 0, y, w: cols, h: vh });
    y += vh;
  } else {
    const vw = cols - vw0 - sw - cw;
    const h = Math.max(12, hc, rowsForAspect(mgWidth(vw, pitch), MG_ASPECT.viewer.max));
    statBlock(tiles, 0, y, vw0, sw, h);
    tiles.push({ id: "checks", kind: "panel", x: vw0 + sw, y, w: cw, h });
    tiles.push({ id: "viewer", kind: "viewer", x: vw0 + sw + cw, y, w: vw, h });
    y += h;
  }

  // Group 2, Etasjer: Romlig struktur (the chain from project to storey),
  // then one panel per storey. With a floor config the configured matrix
  // leads instead, with the chain as one line of lamps under its head. The lead
  // panel takes the columns the storey panels leave, so the row closes.
  titles.push({ id: "g-storeys", y });
  y += 1;
  const leadId = needs.matrix ? "matrix" : "spatial";
  const leadMin = needs.matrix ? needs.floorPx : PX.spatial;
  const lw0 = Math.min(cols - 1, mgSpan(leadMin, pitch));
  let sm = rowMultiples(needs.storeys, cols - lw0, pitch, PX.storey);
  const groupH = Math.max(sm.rows * 3, needs.matrix ? listRows(needs.floorLines) : 4);
  if (groupH > sm.rows * 4) sm = fitMultiples(needs.storeys, cols - lw0, pitch, groupH) ?? sm;
  // The columns the storeys leave: first to the lead while it stays inside
  // 2 : 1 at the group's height, then one each to the storey columns from the
  // first, so the row closes on content and never on air.
  let lw = lw0;
  let spare = cols - lw0 - sm.perRow * sm.w;
  while (spare > 0 && mgWidth(lw + 1, pitch) / mgHeight(groupH) <= 2) {
    lw += 1;
    spare -= 1;
  }
  const colW = Array.from({ length: sm.perRow }, () => sm.w);
  for (let k = 0; spare > 0; k = (k + 1) % sm.perRow, spare -= 1) colW[k] += 1;
  const colX = colW.map((_, k) => lw + colW.slice(0, k).reduce((a, b) => a + b, 0));
  const rowH = Math.floor(groupH / sm.rows);
  const rowExtra = groupH % sm.rows;
  const rowY = Array.from({ length: sm.rows }, (_, r) => r * rowH + Math.min(r, rowExtra));
  tiles.push({ id: leadId, kind: "panel", x: 0, y, w: lw, h: groupH });
  for (let i = 0; i < needs.storeys; i += 1) {
    const k = i % sm.perRow;
    const r = Math.floor(i / sm.perRow);
    tiles.push({
      id: `storey${i}`,
      kind: "panel",
      x: colX[k],
      y: y + rowY[r],
      w: colW[k],
      h: rowH + (r < rowExtra ? 1 : 0),
    });
  }
  y += groupH;

  // Group 3, Klasser: one panel per IFC class.
  if (needs.classes > 0) {
    titles.push({ id: "g-classes", y });
    y += 1;
    const km = multiples(needs.classes, cols, pitch, PX.klass);
    for (let i = 0; i < needs.classes; i += 1) {
      tiles.push({
        id: `class${i}`,
        kind: "panel",
        x: (i % km.perRow) * km.w,
        y: y + Math.floor(i / km.perRow) * 3,
        w: km.w,
        h: 3,
      });
    }
    y += km.rows * 3;
  }
  return { cols, pitch, tiles, titles, rows: y };
}

/** The stat block of `c`: two columns sharing the height `h` (the first
 *  panels take the remainder). Column one: the three verdict counts; column
 *  two: the four neutral counts. */
function statBlock(tiles: MgPlace[], x: number, y: number, w0: number, w1: number, h: number) {
  for (const [cx, w, ids] of [
    [x, w0, ["v0", "v1", "v2"]],
    [x + w0, w1, ["n0", "n1", "n2", "n3"]],
  ] as const) {
    let at = y;
    const base = Math.floor(h / ids.length);
    const extra = h % ids.length;
    ids.forEach((id, i) => {
      const hi = base + (i < extra ? 1 : 0);
      tiles.push({ id, kind: "panel", x: cx, y: at, w, h: hi });
      at += hi;
    });
  }
}

function rowsOf(tiles: MgPlace[]): number {
  return tiles.reduce((max, t) => Math.max(max, t.y + t.h), 0);
}
