/** BENTO — the house dashboard grid, mirrored into ifc-check.
 *
 * ── Where this came from ─────────────────────────────────────────────────
 * This is a mirror of `sprucelab/frontend/src/components/Layout/bento-spec.ts`
 * (spec: `sprucelab/docs/plans/2026-08-24-20-29_bento-dashboard-system.md` §1;
 * rulings: `sprucelab/frontend/DESIGN.md` §2d). It is copied rather than
 * imported because the two projects share no package boundary — there is no
 * monorepo link between `toolkit/ifc-check` and `sidehustles/sprucelab`.
 *
 * edkjo, 2026-08-24: *"it has to be a principle and a core that is a
 * foundation and is recognizable across ALL the dashboards we make here"* —
 * *"every DASHBOARD is an instance of ONE grid"*, *"copy one, never a new
 * grid"*. So the arithmetic, the span vocabulary, the band decompositions and
 * every validation rule below are the upstream ones verbatim. If they change
 * upstream they change here; this file is not a place to have opinions about
 * the grid.
 *
 * ── The two deliberate deviations, both in the kind→span registry ────────
 * The registry is the one part of the spec that is CONTENT vocabulary rather
 * than grid structure, and upstream's entries encode which tile is the focal
 * on sprucelab's boards. On ifc-check the focal is a different tile, so two
 * kinds take spans upstream does not give them. Both are named at the entry.
 * Nothing structural moves: the span ladder, the bands, the seams, the fold
 * and the one-focal / one-gauge rules are untouched, and the focal here is
 * still exactly one 8×5.
 */

import type { ReactNode } from "react";

// ── The grid ──────────────────────────────────────────────────────
/**
 * Track counts. 13 = 8 + 5 for 13"–24"; 21 = 13 + 8 for 27"–32" — the next
 * Fibonacci step, whose seams 8|9 and 13|14 are both φ cuts. Scaling up ADDS
 * tracks and rows; a tile keeps its span and roughly its physical size while
 * more tiles become visible. Two AUTHORED layouts per dashboard — no
 * auto-reflow, no portrait variant.
 */
export type BentoCols = 13 | 21;

/** The cell token for deliberate structural air. Never a tile id. */
export const BENTO_EMPTY = ".";

/** φ — the one ratio. Row gap, tile padding and the span ladder all ride it. */
export const PHI = 1.618;

/** `colGap = track / 10`. */
export const BENTO_GAP_DIVISOR = 10;

/** Row unit = track width (square cells), compressed to 0.95× on 13 tracks so
 *  the 8-row fold budget closes at 800 px. Square is the ideal, not a rule. */
export const BENTO_ROW_FACTOR: Record<BentoCols, number> = { 13: 0.95, 21: 1 };

/** Tile aspect bounds, width : height of the rendered tile.
 *
 * The span ladder alone does not guarantee a pleasant tile: with a square cell
 * a 13x1 strip renders at 13:1 and a 2x5 readout at roughly 1:2.4, and the
 * owner's objection is exactly those — "very tall and narrow or very wide and
 * short tiles are not nice".
 *
 * So the CELL is not fixed square. Its aspect flexes within these bounds to
 * suit the viewport, and a tile whose rendered aspect still falls outside them
 * is a layout defect that `validateBentoLayout` reports rather than silently
 * rendering. Strips are the deliberate exception — a strip IS a wide thin band
 * — so they are checked against their own looser ceiling.
 */
export const BENTO_TILE_ASPECT = { min: 0.45, max: 4.2 } as const;
export const BENTO_STRIP_ASPECT_MAX = 24;

/** How far the CELL itself may depart from square to suit the viewport.
 *  Below 1 the cell is taller than wide, above 1 wider than tall. */
export const BENTO_CELL_ASPECT = { min: 0.82, max: 1.3 } as const;

/** Rows visible without scrolling. P0/P1 never live below this line. */
export const BENTO_FOLD_ROWS: Record<BentoCols, number> = { 13: 8, 21: 10 };

/**
 * The container inline-size (px) at or above which a board renders its
 * 21-track layout instead of its 13-track one — the ONE fixed breakpoint.
 *
 * Measured against the GRID's container, never the viewport, so an embedded
 * board picks the layout its own box can carry. That clause is load-bearing
 * here specifically: ifc-check ships as an iframe on skiplum.com, where a
 * viewport unit measures the host page's box and not this app's.
 */
export const BENTO_21_MIN_WIDTH = 1900;

/** The layout a container of `width` px carries. The one breakpoint. */
export function bentoColsForWidth(width: number): BentoCols {
  return width >= BENTO_21_MIN_WIDTH ? 21 : 13;
}

/**
 * The divisor that turns a container width into the track width.
 *
 *   track = W / (cols + (cols − 1)/10)
 *
 * because `W = cols·track + (cols − 1)·colGap` and `colGap = track/10`.
 */
export function bentoTrackDivisor(cols: BentoCols): number {
  return cols + (cols - 1) / BENTO_GAP_DIVISOR;
}

/** The track width the 21-track canvas is allowed to REACH, in px. */
export const BENTO_DESIGN_TRACK = 110;

/**
 * The convergence cap: the widest the CANVAS itself may be. Above it the board
 * centres and the leftover width becomes structural air outside the grid,
 * never more track. Derived through the same divisor the renderer uses, so the
 * cap and the track it produces cannot drift apart.
 */
export const BENTO_MAX_WIDTH = Math.round(BENTO_DESIGN_TRACK * bentoTrackDivisor(21));

/** Band arithmetic that always closes. These decompositions are the ONLY
 *  sanctioned ways to fill a row; the seam lines are derived from them. */
export const BENTO_BANDS: Record<BentoCols, readonly (readonly number[])[]> = {
  13: [[13], [8, 5], [5, 3, 5], [3, 5, 5]],
  21: [[21], [8, 5, 8], [13, 8], [5, 8, 8]],
};

/** 1-based column indexes a tile may START on, derived from `BENTO_BANDS`. */
export function bandStarts(cols: BentoCols): Set<number> {
  const out = new Set<number>();
  for (const band of BENTO_BANDS[cols]) {
    let at = 1;
    for (const width of band) {
      out.add(at);
      at += width;
    }
  }
  return out;
}

/** 1-based column indexes a tile may END on, derived from `BENTO_BANDS`. */
export function bandEnds(cols: BentoCols): Set<number> {
  const out = new Set<number>();
  for (const band of BENTO_BANDS[cols]) {
    let at = 1;
    for (const width of band) {
      at += width;
      out.add(at - 1);
    }
  }
  return out;
}

// ── The span vocabulary ───────────────────────────────────────────
/** Fibonacci only. Adjacent spans differ by one Fibonacci step, so every pair
 *  of tiles relates at ≈φ. */
export const BENTO_WIDTHS: readonly number[] = [2, 3, 5, 8, 13, 21];
export const BENTO_HEIGHTS: readonly number[] = [1, 2, 3, 5, 8];

export interface BentoSpan {
  w: number;
  h: number;
}

export type BentoSpanClass = "focal" | "gauge" | "support" | "strip" | "readout";

/** A span belongs to the FIRST class that lists it: 5×1 is a strip piece (the
 *  8|5 split of a 13-track strip row) rather than a readout. */
export const BENTO_SPAN_CLASSES: Record<BentoSpanClass, readonly BentoSpan[]> = {
  focal: [{ w: 8, h: 5 }, { w: 13, h: 8 }],
  gauge: [{ w: 5, h: 3 }],
  support: [{ w: 5, h: 2 }, { w: 8, h: 2 }, { w: 8, h: 3 }, { w: 3, h: 3 }],
  strip: [{ w: 13, h: 1 }, { w: 21, h: 1 }, { w: 8, h: 1 }, { w: 5, h: 1 }],
  readout: [{ w: 3, h: 2 }, { w: 2, h: 2 }, { w: 3, h: 1 }, { w: 5, h: 1 }],
};

const CLASS_ORDER: readonly BentoSpanClass[] = ["focal", "gauge", "support", "strip", "readout"];

/** The span class a span belongs to, or `null` when it is outside the ladder. */
export function bentoSpanClass(span: BentoSpan): BentoSpanClass | null {
  for (const cls of CLASS_ORDER) {
    if (BENTO_SPAN_CLASSES[cls].some((s) => s.w === span.w && s.h === span.h)) return cls;
  }
  return null;
}

// ── Kinds ─────────────────────────────────────────────────────────
export type BentoKind =
  | "matrix"
  | "gauge"
  | "distribution"
  | "ladder"
  | "tellTales"
  | "roster"
  | "pulse"
  | "readout"
  | "treemap"
  | "viewer";

export interface BentoKindEntry {
  /** The question the tile answers — the reason the kind exists. */
  question: string;
  /** Usable width : height range for THIS kind's content.
   *
   *  A span that is legal on the ladder can still be a bad home for a given
   *  content: a viewer stops being navigable outside a fairly narrow range, a
   *  treemap needs a squarish field or its cells degenerate into slivers, and a
   *  ladder is a band by design. So the bound belongs to the kind, not to the
   *  grid — the owner: "a viewer works best within a certain aspect ratio
   *  range, then it becomes unuseable or awkward. A treemap works best in the
   *  square or viewer like rectangles, not in strips." */
  aspect: { min: number; max: number };
  /** Every span this form may occupy. Anything else fails validation. */
  spans: readonly BentoSpan[];
}

export const BENTO_KINDS: Record<BentoKind, BentoKindEntry> = {
  matrix: {
    question: "where does a condition hold (axis × axis)",
    // A heat grid tolerates a wide band — rows are the long axis.
    //
    // BOUND RAISED 4.0 → 4.6 (2026-09-18). A census grid's width is driven by
    // its COLUMN COUNT, and this board's columns are the IFC-class axis: the
    // reference model carries 18 of them against 8 storeys, so the tile wants
    // to be wide. 13×3 is the widest shape either canvas can give it without
    // taking a focal span, and it renders 4.33:1 on 21 tracks and 4.56:1 on 13
    // — which means 4.0 rejected the only span this kind can actually occupy
    // on this board, rather than describing a tile that reads badly. 4.6 admits
    // it and still refuses 21×3 (7.0:1), where the cells stop being cells.
    aspect: { min: 0.5, max: 4.6 },
    // DEVIATION FROM UPSTREAM (1 of 2). Upstream gives `matrix` the focal
    // spans only, because on every sprucelab board the matrix IS the focal.
    // Here the focal is the verification block, and the storey × class census
    // is supporting context below the fold — the owner's own framing: "showing
    // a quantity takeoff of how many elements there are of different types,
    // great, but gives no feedback". So it takes the full band of its canvas,
    // a shape a heat grid fills exactly as well as it fills a focal.
    spans: [{ w: 8, h: 5 }, { w: 13, h: 8 }, { w: 13, h: 3 }, { w: 21, h: 3 }],
  },
  gauge: {
    question: "how far vs a declared target",
    // a dial or bar pair wants room either side of the number
    aspect: { min: 0.9, max: 2.6 },
    spans: [{ w: 5, h: 3 }, { w: 3, h: 2 }, { w: 5, h: 2 }],
  },
  distribution: {
    question: "how is X spread",
    // horizontal bars read along the long axis
    aspect: { min: 1.0, max: 4.5 },
    spans: [{ w: 5, h: 2 }, { w: 8, h: 2 }, { w: 8, h: 3 }, { w: 3, h: 3 }],
  },
  ladder: {
    question: "how far along an ordered state set",
    // a band by design; it fails when it becomes squarish
    aspect: { min: 2.0, max: 24 },
    spans: [
      { w: 13, h: 1 },
      { w: 21, h: 1 },
      { w: 8, h: 1 },
      { w: 5, h: 1 },
      { w: 5, h: 2 },
      { w: 8, h: 2 },
    ],
  },
  tellTales: {
    question: "is anything wrong (silence = fine)",
    // a column of rows, each carrying evidence — not a strip
    aspect: { min: 0.7, max: 2.2 },
    // DEVIATION FROM UPSTREAM (2 of 2). Upstream gives `tellTales` strip spans
    // only — a row of lamps. Here it is the focal: eleven universal checks,
    // each carrying the VALUE it found beside its verdict, which is a column
    // of evidence rather than a row of lamps and does not fit one row. Taking
    // a focal span is what makes it the canvas's single focal, so the
    // one-focal rule keeps holding by the same arithmetic as everywhere else.
    spans: [
      { w: 5, h: 1 },
      { w: 8, h: 1 },
      { w: 13, h: 1 },
      { w: 21, h: 1 },
      { w: 8, h: 5 },
      { w: 13, h: 8 },
    ],
  },
  roster: {
    question: "which ones, by identity",
    // A list with a sticky header.
    //
    // BOUND RAISED 2.4 → 2.9 (2026-09-18). At 2.4 this kind could not be
    // satisfied by any span it owns: 5×2, its narrowest, renders 2.5:1 on 21
    // tracks and 2.63:1 on 13, and 8×3 renders 2.67:1 and 2.81:1. A ceiling no
    // member of the kind's own vocabulary can meet is a wrong bound, not a
    // wrong board — it fired on every layout ever authored here. 2.9 admits
    // 5×2 and 8×3, the two shapes that show a whole storey list, and still
    // refuses 8×2 (4.0:1 / 4.21:1), where a sticky header plus two visible
    // rows is genuinely too short to be a roster.
    aspect: { min: 0.6, max: 2.9 },
    spans: [{ w: 5, h: 2 }, { w: 8, h: 2 }, { w: 8, h: 3 }],
  },
  pulse: {
    question: "what changed, at what rhythm",
    // a band
    aspect: { min: 2.0, max: 24 },
    spans: [
      { w: 5, h: 2 },
      { w: 8, h: 2 },
      { w: 8, h: 3 },
      { w: 3, h: 2 },
      { w: 8, h: 1 },
      { w: 13, h: 1 },
      { w: 21, h: 1 },
    ],
  },
  readout: {
    question: "a count with a status",
    // one value and its label
    aspect: { min: 0.8, max: 3.0 },
    spans: [
      { w: 3, h: 2 },
      { w: 2, h: 2 },
      { w: 3, h: 1 },
      { w: 5, h: 1 },
      { w: 5, h: 2 },
      { w: 8, h: 2 },
    ],
  },
  treemap: {
    question: "whole-vs-parts with magnitude",
    // squarish or it degenerates into slivers
    aspect: { min: 0.75, max: 1.8 },
    spans: [{ w: 5, h: 2 }, { w: 8, h: 2 }, { w: 8, h: 3 }, { w: 3, h: 3 }],
  },
  viewer: {
    question: "what does the model look like, from here",
    // a 3D scene stops being navigable outside this. The bound is kept as
    // authored: the G55 de-dup viewer this board's 3D is ported from ran at
    // roughly 1.3:1 per pane and degraded exactly as described when the split
    // halved it, so 0.9-2.2 matches the working reference rather than
    // contradicting it.
    aspect: { min: 0.9, max: 2.2 },
    // DEVIATION FROM UPSTREAM (3 of 3). `5x5` is added because NONE of the
    // four upstream spans can satisfy this kind's own aspect bound on either
    // canvas: 5x2 renders 2.6:1, 8x3 2.8:1 and 8x2 4.2:1, all outside 2.2, and
    // only the 3x3 fits — at nine cells, which cannot carry the model on a
    // board whose focal is forty. 5x5 renders 1.05:1 on 13 tracks and 1.00:1
    // on 21, and at twenty-five cells it is the second-largest tile after the
    // focal, which is where the owner asked the 3D to sit. It is in no span
    // CLASS, so it competes with neither the one focal nor the one gauge.
    spans: [
      { w: 5, h: 2 },
      { w: 8, h: 2 },
      { w: 8, h: 3 },
      { w: 3, h: 3 },
      { w: 5, h: 5 },
    ],
  },
};

export function kindAllowsSpan(kind: BentoKind, span: BentoSpan): boolean {
  return BENTO_KINDS[kind].spans.some((s) => s.w === span.w && s.h === span.h);
}

// ── The tile spec ─────────────────────────────────────────────────
export type BentoPriority = "P0" | "P1" | "P2" | "config";

/** What a tile DOES when it is touched. It lives on the SPEC rather than
 *  inside a renderer so a board declares its interaction the same way it
 *  declares its span; the page owns the router and the filter bus. */
export interface BentoClick {
  /** The tile is a DOOR. `label` names the destination — the arrow carries no
   *  copy of its own. */
  drill?: { label: string; run: () => void };
}

/** A tile whose DATA is missing, loading or broken says so IN ITS OWN SLOT.
 *  The grid is fixed-size, so there is no collapsing a tile and no neighbour
 *  may grow into the gap; a query that failed must never render as a calm zero. */
export interface BentoTileStatus {
  kind: "loading" | "empty" | "error";
  /** Already-translated text — this module authors no copy. */
  message: string;
}

export interface BentoTileSpec {
  /** Must match a cell name in the layout. */
  id: string;
  kind: BentoKind;
  priority: BentoPriority;
  /** Redundant with the layout rectangle ON PURPOSE — the two are
   *  cross-checked, so a layout edit that silently resizes a tile is a
   *  validation failure rather than a squashed form. */
  span: BentoSpan;
  /** Tile chrome label. Optional only for a 1-row strip. */
  label?: string;
  /** Right-hand side of the header rule — a count, a mono note, a verdict. */
  sub?: string;
  /** The form. Rendered inside the tile's fixed box. */
  body?: ReactNode;
  click?: BentoClick;
  status?: BentoTileStatus;
}

export interface BentoLayoutDefinition {
  cols: BentoCols;
  rows: number;
  /** `rows` × `cols` of tile ids and `BENTO_EMPTY`. */
  layout: string[][];
}

// ── Placement ─────────────────────────────────────────────────────
export interface GridPosition {
  gridColumn: string;
  gridRow: string;
  colSpan: number;
  rowSpan: number;
}

/** Named-area map → CSS grid placements, with `BENTO_EMPTY` skipped so
 *  structural air produces no placement. */
export function generateGridPositions(layout: string[][]): Record<string, GridPosition> {
  const positions: Record<string, GridPosition> = {};
  const seen = new Set<string>();

  layout.forEach((row, rowIndex) => {
    row.forEach((cellName, colIndex) => {
      if (cellName === BENTO_EMPTY || seen.has(cellName)) return;

      let maxCol = colIndex;
      let maxRow = rowIndex;

      for (let c = colIndex + 1; c < row.length; c++) {
        if (row[c] === cellName) maxCol = c;
        else break;
      }
      for (let r = rowIndex + 1; r < layout.length; r++) {
        if (layout[r][colIndex] === cellName) maxRow = r;
        else break;
      }

      positions[cellName] = {
        gridColumn: `${colIndex + 1} / ${maxCol + 2}`,
        gridRow: `${rowIndex + 1} / ${maxRow + 2}`,
        colSpan: maxCol - colIndex + 1,
        rowSpan: maxRow - rowIndex + 1,
      };
      seen.add(cellName);
    });
  });

  return positions;
}

/** 1-based first column of a placement (`gridColumn` is `"3 / 8"`). */
export function colStart(position: GridPosition): number {
  return Number(position.gridColumn.split(" / ")[0]);
}

/** 1-based first row of a placement. */
export function rowStart(position: GridPosition): number {
  return Number(position.gridRow.split(" / ")[0]);
}

/** Do two placements occupy at least one track in common? */
function sharesColumn(a: GridPosition, b: GridPosition): boolean {
  const aStart = colStart(a);
  const bStart = colStart(b);
  return aStart <= bStart + b.colSpan - 1 && bStart <= aStart + a.colSpan - 1;
}

interface Cell {
  row: number;
  col: number;
}

function occurrences(layout: string[][]): { name: string; cells: Cell[] }[] {
  const map = new Map<string, Cell[]>();
  layout.forEach((row, rowIndex) =>
    row.forEach((cellName, colIndex) => {
      if (cellName === BENTO_EMPTY) return;
      const list = map.get(cellName) ?? [];
      list.push({ row: rowIndex, col: colIndex });
      map.set(cellName, list);
    }),
  );
  return [...map.entries()].map(([name, cells]) => ({ name, cells }));
}

/** Filled AND contiguous — testing only `rows × cols === count` passes for two
 *  disjoint blocks of the same name, an overlap the grid would then render as
 *  one impossible tile. */
function isRectangle(cells: Cell[]): boolean {
  const rows = new Set(cells.map((c) => c.row));
  const cols = new Set(cells.map((c) => c.col));
  if (rows.size * cols.size !== cells.length) return false;
  const rowVals = [...rows];
  const colVals = [...cols];
  const rowSpan = Math.max(...rowVals) - Math.min(...rowVals) + 1;
  const colSpan = Math.max(...colVals) - Math.min(...colVals) + 1;
  return rowSpan === rows.size && colSpan === cols.size;
}

// ── Validation ────────────────────────────────────────────────────
export type BentoErrorCode =
  | "shape"
  | "rectangle"
  | "orphan"
  | "unknown-tile"
  | "missing-tile"
  | "span-mismatch"
  | "fibonacci"
  | "kind-span"
  | "seam"
  | "fold"
  | "zone"
  | "focal-count"
  | "gauge-count";

export interface BentoValidationError {
  code: BentoErrorCode;
  message: string;
  /** Set when the fault belongs to one tile; absent for canvas-wide faults. */
  tileId?: string;
}

/** Every invariant, evaluated at render time. Returns the COMPLETE list — an
 *  author fixing a layout should see all of it at once. */
export function validateBentoLayout(
  definition: BentoLayoutDefinition,
  tiles: BentoTileSpec[],
): BentoValidationError[] {
  const errors: BentoValidationError[] = [];
  const { cols, rows, layout } = definition;

  // 1 · shape. Everything below reads positions off the grid, so a malformed
  //     grid short-circuits rather than emitting a cascade of nonsense.
  if (layout.length !== rows) {
    errors.push({
      code: "shape",
      message: `layout has ${layout.length} rows, definition declares ${rows}`,
    });
  }
  layout.forEach((row, i) => {
    if (row.length !== cols) {
      errors.push({
        code: "shape",
        message: `row ${i + 1} has ${row.length} cells, grid is ${cols} tracks`,
      });
    }
    row.forEach((cell, j) => {
      if (typeof cell !== "string" || cell.length === 0) {
        errors.push({
          code: "orphan",
          message: `cell (r${i + 1}, c${j + 1}) is unnamed — use "${BENTO_EMPTY}" for structural air`,
        });
      }
    });
  });
  if (errors.length > 0) return errors;

  // 2 · tessellation: filled, contiguous rectangles, no overlap.
  for (const { name, cells } of occurrences(layout)) {
    if (cells.length > 1 && !isRectangle(cells)) {
      errors.push({
        code: "rectangle",
        message: `"${name}" is not one filled rectangle — it overlaps or is split`,
        tileId: name,
      });
    }
  }

  const positions = generateGridPositions(layout);
  const specById = new Map(tiles.map((t) => [t.id, t]));

  for (const name of Object.keys(positions)) {
    if (!specById.has(name)) {
      errors.push({
        code: "unknown-tile",
        message: `layout names "${name}", no tile spec supplies it`,
        tileId: name,
      });
    }
  }
  for (const tile of tiles) {
    if (!positions[tile.id]) {
      errors.push({
        code: "missing-tile",
        message: `tile "${tile.id}" is not placed in the layout`,
        tileId: tile.id,
      });
    }
  }

  const starts = bandStarts(cols);
  const ends = bandEnds(cols);
  const fold = BENTO_FOLD_ROWS[cols];

  for (const tile of tiles) {
    const pos = positions[tile.id];
    if (!pos) continue;

    // 3 · the declared span IS the placed rectangle.
    if (pos.colSpan !== tile.span.w || pos.rowSpan !== tile.span.h) {
      errors.push({
        code: "span-mismatch",
        message: `"${tile.id}" declares ${tile.span.w}×${tile.span.h} but the layout places ${pos.colSpan}×${pos.rowSpan}`,
        tileId: tile.id,
      });
    }

    // 4 · Fibonacci spans only.
    if (!BENTO_WIDTHS.includes(tile.span.w) || !BENTO_HEIGHTS.includes(tile.span.h)) {
      errors.push({
        code: "fibonacci",
        message: `"${tile.id}" span ${tile.span.w}×${tile.span.h} is outside the Fibonacci vocabulary (w ∈ ${BENTO_WIDTHS.join("/")}, h ∈ ${BENTO_HEIGHTS.join("/")})`,
        tileId: tile.id,
      });
    }

    // 5 · the form must fit the shape.
    if (!kindAllowsSpan(tile.kind, tile.span)) {
      errors.push({
        code: "kind-span",
        message: `kind "${tile.kind}" may not be ${tile.span.w}×${tile.span.h} — allowed: ${BENTO_KINDS[
          tile.kind
        ].spans
          .map((s) => `${s.w}×${s.h}`)
          .join(", ")}`,
        tileId: tile.id,
      });
    }

    // 6 · seam-respecting: a tile begins and ends on a line one of the
    //     sanctioned band decompositions actually produces.
    const startCol = colStart(pos);
    const endCol = startCol + pos.colSpan - 1;
    if (!starts.has(startCol) || !ends.has(endCol)) {
      errors.push({
        code: "seam",
        message: `"${tile.id}" runs cols ${startCol}–${endCol}, which is not a band cut on ${cols} tracks`,
        tileId: tile.id,
      });
    }

    // 7 · P0/P1 never below the fold.
    if (tile.priority === "P0" || tile.priority === "P1") {
      const startRow = rowStart(pos);
      const endRow = startRow + pos.rowSpan - 1;
      if (endRow > fold) {
        errors.push({
          code: "fold",
          message: `${tile.priority} tile "${tile.id}" ends on row ${endRow}, past the ${fold}-row fold`,
          tileId: tile.id,
        });
      }
    }
  }

  // 8 · P2 never ABOVE P1 in the same column. Reading down a column has to be
  //     reading down the importance order, or the Z the zones produce
  //     collapses. Starting on the SAME row is a band, not a stack.
  const placed = tiles
    .map((tile) => ({ tile, pos: positions[tile.id] }))
    .filter((entry): entry is { tile: BentoTileSpec; pos: GridPosition } => !!entry.pos);
  const p2s = placed.filter((e) => e.tile.priority === "P2");
  const p1s = placed.filter((e) => e.tile.priority === "P1");
  for (const below of p2s) {
    for (const above of p1s) {
      if (!sharesColumn(below.pos, above.pos)) continue;
      if (rowStart(below.pos) >= rowStart(above.pos)) continue;
      errors.push({
        code: "zone",
        message: `P2 tile "${below.tile.id}" starts on row ${rowStart(below.pos)}, above P1 tile "${above.tile.id}" on row ${rowStart(above.pos)}, in a column they share`,
        tileId: below.tile.id,
      });
    }
  }

  // 9 · exactly one focal, and it is P0; exactly one gauge.
  const focals = tiles.filter((t) => bentoSpanClass(t.span) === "focal");
  if (focals.length !== 1) {
    errors.push({
      code: "focal-count",
      message: `a canvas has exactly one focal tile (8×5 or 13×8) — found ${focals.length}`,
    });
  } else if (focals[0].priority !== "P0") {
    errors.push({
      code: "focal-count",
      message: `the focal "${focals[0].id}" must be P0, not ${focals[0].priority}`,
      tileId: focals[0].id,
    });
  }

  const gauges = tiles.filter((t) => bentoSpanClass(t.span) === "gauge");
  if (gauges.length !== 1) {
    errors.push({
      code: "gauge-count",
      message: `a canvas has exactly one gauge tile (5×3) — found ${gauges.length}`,
    });
  }

  return errors;
}

/** One-line rendering of a validation batch, for a throw or an error tile. */
export function formatBentoErrors(errors: BentoValidationError[]): string {
  return errors.map((e) => `[${e.code}] ${e.message}`).join("\n");
}
