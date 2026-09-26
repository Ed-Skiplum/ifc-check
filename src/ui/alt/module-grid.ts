/** THE MODULE GRID of the design alternatives (`#design=a|b|c`), 2026-09-26.
 *
 * The canon is edkjo's LAYOUT SYSTEM in
 * `C:\workspace\resources\design-system\data-workspace.md`. What this file
 * implements, rule by rule:
 *
 *   1  One grid, sized to the window: a square module of about 100 px, a
 *      16 px gap, a 24 px margin. A wider window gets MORE columns at the same
 *      module, never fatter tiles.
 *   6  The formulas, for a window W × H whose board starts `top` px down:
 *        C = round((W − 48 + 16) / 116)
 *        u = (W − 48 − (C − 1)·16) / C          the module, and the row height
 *        R = floor((H − chrome − 48 + 16) / (u + 16)),  chrome = top − 24
 *      The canon writes `floor` for C, and its own reference table
 *      (2112 → 18, 2560 → 22) is `round`: floor gives 17 and 21 there. The
 *      table is what the canon was checked against, so C rounds; u then stays
 *      within about 93 to 108 px, "about 100". Stated in AGENTS.md.
 *   7  Tile sizes in modules: S 2×2 · M 3×2 / 2×3 · L 4×3 / 3×4 · XL 6×4,
 *      stepping to 8×5 · a strip k×1 / 1×k only for a named content (here the
 *      MMI bars, a bar chart with few items). At most two XL.
 *   8  `mgPack`: each tile has sizes (its canon size, largest first) and a
 *      priority. Tiles pack by priority, row-major; the board is exactly
 *      covered, no holes. Too little room moves the lowest priority into a tab
 *      of a tile that stays; nothing shrinks below its size. More room than
 *      the content fills at its sizes narrows the board (centred on the
 *      grid, whole columns), never stretches a tile. Deterministic: a pure
 *      function of its input.
 *
 * Pure TS, `.ts` imports only, so `scripts/module-grid-gate.mjs` and
 * `scripts/bento-pack-test.mjs` import the same numbers they assert.
 */

import { CANVAS_ASPECT } from "../canvas-aspect.ts";

export const MG_MODULE = 100;
export const MG_GAP = 16;
export const MG_MARGIN = 24;
/** A tile's own head: its label line. */
export const MG_HEAD = 32;

export interface MgGrid {
  /** Columns of the window's grid (rule 6). */
  cols: number;
  /** The module: a column's width and a row's height, px. */
  u: number;
  rows: number;
}

/** Rule 6. `width` is the window's width (the page's content box plus its two
 *  24 px margins); `avail` is the height left for the board, margins
 *  included: H − chrome. */
export function mgGrid(width: number, avail: number): MgGrid {
  const cols = Math.max(1, Math.round((width - 2 * MG_MARGIN + MG_GAP) / (MG_MODULE + MG_GAP)));
  const u = (width - 2 * MG_MARGIN - (cols - 1) * MG_GAP) / cols;
  const rows = Math.max(1, Math.floor((avail - 2 * MG_MARGIN + MG_GAP) / (u + MG_GAP)));
  return { cols, u, rows };
}

/** Rendered px of a span of `n` modules. */
export function mgSpanPx(n: number, u: number): number {
  return n * u + (n - 1) * MG_GAP;
}

/* ── the tile vocabulary ───────────────────────────────────────────────── */

export type MgSize = "S" | "M" | "L" | "XL" | "strip";
export type Wh = readonly [number, number];

export const SIZES: Record<Exclude<MgSize, "strip">, readonly Wh[]> = {
  S: [[2, 2]],
  M: [
    [3, 2],
    [2, 3],
  ],
  L: [
    [4, 3],
    [3, 4],
  ],
  XL: [
    [8, 5],
    [6, 4],
  ],
};

/** The size class of `w × h` modules, or null when it is none. A strip is
 *  only a size for a tile that names why (`MgTileSpec.strip`). */
export function canonSize(w: number, h: number, strip = false): MgSize | null {
  for (const [name, list] of Object.entries(SIZES) as [Exclude<MgSize, "strip">, readonly Wh[]][]) {
    if (list.some(([a, b]) => a === w && b === h)) return name;
  }
  if (strip && (w === 1 || h === 1) && Math.max(w, h) >= 2) return "strip";
  return null;
}

/** What a tile holds, for its aspect bound (rule 3, in rendered px). */
export type MgKind = "panel" | "list" | "viewer" | "graph" | "chart";

export const MG_ASPECT: Record<MgKind, { min: number; max: number; why: string }> = {
  panel: { min: 0.5, max: 2, why: "the rule: 1 : 2 to 2 : 1" },
  list: { min: 0.5, max: 2, why: "the rule: a list scrolls inside, it is not taller for it" },
  viewer: {
    min: CANVAS_ASPECT.min,
    max: CANVAS_ASPECT.max,
    why: "rule 4: a 3D canvas is phone to monitor shaped, 9 : 16 to 16 : 9, the tile and the canvas in it",
  },
  graph: { min: CANVAS_ASPECT.min, max: CANVAS_ASPECT.max, why: "rule 4, the same as the viewer" },
  chart: { min: 0.5, max: 2, why: "the rule, as any chart" },
};

/** The named strip exceptions (rule 3): content that thrives in a strip. */
export const MG_STRIPS: Record<string, string> = {
  mmi: "a bar chart with few items: one bar per MMI level, read across",
};

export interface MgTileSpec {
  id: string;
  kind: MgKind;
  /** The sizes it may take, most wanted first; every one a canon size. */
  sizes: readonly Wh[];
  /** Never moved into a tab. */
  required?: boolean;
  /** Where it goes when it is moved into a tab: the first of these that
   *  stayed. Else the lowest priority tile that stayed and is not required. */
  hosts?: readonly string[];
  /** Tiles of one series (the counts) are placed in their order, so the
   *  packer never tries their permutations. */
  series?: string;
  /** A block of equal tiles, one per member, each `unit` modules, laid in
   *  reading order in a block that holds exactly them (a report section's
   *  requirement panels: 5 → 5 × 1 or 1 × 5). The block is not a tile; its
   *  members are, each at the canon size `unit`. */
  members?: readonly string[];
  unit?: Wh;
}

/** A block spec for `members` at `unit`: every arrangement that holds them
 *  exactly, the widest (one band) first. */
export function mgBlock(id: string, kind: MgKind, members: readonly string[], unit: Wh): MgTileSpec {
  const n = members.length;
  const sizes: Wh[] = [];
  for (let across = n; across >= 1; across -= 1) {
    if (n % across === 0) sizes.push([across * unit[0], (n / across) * unit[1]]);
  }
  return { id, kind, sizes, required: true, members, unit };
}

/** One tile, in modules. `x` counts from the grid's own first column. */
export interface MgPlace {
  id: string;
  kind: MgKind;
  x: number;
  y: number;
  w: number;
  h: number;
  size: MgSize;
  priority: number;
  /** Tiles moved into this one, as tabs after its own body. */
  tabs: string[];
}

export interface MgLayout extends MgGrid {
  /** Columns the board covers (≤ cols) and its first one: it centres on the
   *  grid in whole modules when the content cannot fill every one. */
  used: number;
  offset: number;
  /** Rows the board covers (≤ rows) and its first one. */
  usedRows: number;
  top: number;
  tiles: MgPlace[];
  /** Tiles moved into a tab, lowest priority last. */
  moved: string[];
  /** Design a: how the requirement band was composed (`layoutA`). */
  band?: string;
}

/* ── the packer (rule 8) ───────────────────────────────────────────────── */

/** A cover of a rectangle by a run of tiles, as the packer builds it. */
interface Cut {
  cost: number;
  /** A leaf: the run's one tile at size index `k`. */
  k?: number;
  /** Or two parts, cut `vertical`ly or not at `at` modules from the start;
   *  `mid` splits the run. Unflipped the first part (left of or above the
   *  cut) takes the run's first tiles; `flip` gives it the last ones. */
  vertical?: boolean;
  at?: number;
  mid?: number;
  flip?: boolean;
}

type Placed = Omit<MgPlace, "priority" | "tabs">;

/** What a composition choice costs (the packer keeps the cheapest cover):
 *  a tile below its first size, weighted by its rank (a hero most, then the
 *  higher priorities), and a cut that reads a lower priority first. */
const COST_FLIP = 6;
const COST_HERO_STEP = 8;

/** The cheapest guillotine cover of `cols × rows` by ALL of `specs`, in
 *  their order, as placed tiles (x and y from 0), or null. */
function coverRun(cols: number, rows: number, specs: readonly MgTileSpec[]): Placed[] | null {
  const n = specs.length;
  const areas = specs.map((s) => s.sizes.map(([w, h]) => w * h));
  const minPre = [0];
  const maxPre = [0];
  specs.forEach((_, i) => {
    minPre.push(minPre[i] + Math.min(...areas[i]));
    maxPre.push(maxPre[i] + Math.max(...areas[i]));
  });
  if (cols * rows < minPre[n] || cols * rows > maxPre[n]) return null;
  const weight = specs.map((s, i) =>
    s.sizes.some(([w, h]) => canonSize(w, h) === "XL") ? COST_HERO_STEP : 1 + (2 * (n - i)) / n,
  );
  const memo = new Map<number, Cut | null>();
  const fitsRun = (cells: number, i: number, j: number) =>
    cells >= minPre[j] - minPre[i] && cells <= maxPre[j] - maxPre[i];

  const best = (w: number, h: number, i: number, j: number): Cut | null => {
    const id = ((w * 64 + h) * 64 + i) * 64 + j;
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    let out: Cut | null = null;
    if (fitsRun(w * h, i, j)) {
      if (j - i === 1) {
        const k = specs[i].sizes.findIndex(([a, b]) => a === w && b === h);
        if (k >= 0) out = { cost: k * weight[i], k };
      } else {
        for (const flip of [false, true]) {
          for (const vertical of [true, false]) {
            const span = vertical ? w : h;
            const other = vertical ? h : w;
            for (let at = 1; at < span; at += 1) {
              const aCells = at * other;
              for (let mid = i + 1; mid < j; mid += 1) {
                // The first part's run: [i, mid) unflipped, [mid, j) flipped.
                const [ai, aj, bi, bj] = flip ? [mid, j, i, mid] : [i, mid, mid, j];
                if (!fitsRun(aCells, ai, aj)) continue;
                const a = vertical ? best(at, h, ai, aj) : best(w, at, ai, aj);
                if (!a) continue;
                const b = vertical ? best(w - at, h, bi, bj) : best(w, h - at, bi, bj);
                if (!b) continue;
                const cost = a.cost + b.cost + (flip ? COST_FLIP : 0);
                if (!out || cost < out.cost) out = { cost, vertical, at, mid, flip };
              }
            }
          }
        }
      }
    }
    memo.set(id, out);
    return out;
  };

  const root = best(cols, rows, 0, n);
  if (!root) return null;
  const out: Placed[] = [];
  const walk = (cut: Cut, x: number, y: number, w: number, h: number, i: number, j: number) => {
    if (cut.k !== undefined) {
      const s = specs[i];
      if (s.members && s.unit) {
        const [uw, uh] = s.unit;
        const across = w / uw;
        s.members.forEach((id, m) => {
          const cx = x + (m % across) * uw;
          const cy = y + Math.floor(m / across) * uh;
          out.push({ id, kind: s.kind, x: cx, y: cy, w: uw, h: uh, size: canonSize(uw, uh)! });
        });
        return;
      }
      out.push({ id: s.id, kind: s.kind, x, y, w, h, size: canonSize(w, h, s.id in MG_STRIPS)! });
      return;
    }
    const at = cut.at!;
    const mid = cut.mid!;
    const [ai, aj, bi, bj] = cut.flip ? [mid, j, i, mid] : [i, mid, mid, j];
    if (cut.vertical) {
      walk(best(at, h, ai, aj)!, x, y, at, h, ai, aj);
      walk(best(w - at, h, bi, bj)!, x + at, y, w - at, h, bi, bj);
    } else {
      walk(best(w, at, ai, aj)!, x, y, w, at, ai, aj);
      walk(best(w, h - at, bi, bj)!, x, y + at, w, h - at, bi, bj);
    }
  };
  walk(root, 0, 0, cols, rows, 0, n);
  return out;
}

/** Rule 8, `specs` in priority order, highest first.
 *
 *  THE COVER. The board is cut, edge to edge, into two rectangles, and each
 *  of those again, until every rectangle is one tile at one of its canon
 *  sizes (a guillotine cover: every tile edge runs on to a cut, so the tiles
 *  line up into clean stacks and bands). The tiles are split between the two
 *  parts as RUNS of the priority order: the first part (left of or above the
 *  cut) takes the first tiles, the second the rest; the other way round
 *  costs. So the tiles pack by priority, reading row-major. Of all covers
 *  the packer keeps the cheapest: a tile below its first size costs, the
 *  hero most (so it steps up to 8 × 5 where the board seats it), then by
 *  priority; ties go to the first cut tried (unflipped, vertical, nearer the
 *  start). Exact: every cell is inside one tile, no holes, no ragged edge.
 *
 *  THE BREAKS. When the tiles cannot cover the board, the lowest priority
 *  tile that is not required moves into a tab of one that stays, then the
 *  next lowest, until a cover exists: nothing shrinks below its sizes. When
 *  the tiles kept cannot fill the board even at their largest (more room
 *  than content), the board shrinks, whole modules at a time, to the largest
 *  rectangle they do cover that keeps the grid's shape (by the smaller of
 *  its column and row shares), centred on the grid: no
 *  tile is stretched past its size.
 *
 *  `mirror` reads the board from the right edge (a composition choice: where
 *  the first tiles sit). Pure and deterministic: the same input gives the
 *  same layout, which `scripts/bento-pack-test.mjs` asserts. */
export function mgPack(grid: MgGrid, specs: readonly MgTileSpec[], mirror = false): MgLayout {
  return packImpl(grid, specs, mirror, false)!;
}

/** `mgPack` on the FULL board only: the cover of exactly `cols × rows`, with
 *  tiles moved into tabs as needed, or null where none exists. Never shrinks
 *  the board. */
export function mgPackExact(grid: MgGrid, specs: readonly MgTileSpec[]): MgLayout | null {
  return packImpl(grid, specs, false, true);
}

function packImpl(grid: MgGrid, specs: readonly MgTileSpec[], mirror: boolean, exact: boolean): MgLayout | null {
  const { cols, rows } = grid;
  const largest = (s: MgTileSpec) => Math.max(...s.sizes.map(([w, h]) => w * h));
  const smallest = (s: MgTileSpec) => Math.min(...s.sizes.map(([w, h]) => w * h));
  const movable = specs.map((s, i) => (s.required ? -1 : i)).filter((i) => i >= 0);
  const m = movable.length;
  const settle = (found: Placed[], gone: Set<number>, used: number, usedRows: number): MgLayout => {
    const offset = Math.floor((cols - used) / 2);
    const top = Math.floor((rows - usedRows) / 2);
    const tiles: MgPlace[] = found
      .map((t) => ({
        ...t,
        x: offset + (mirror ? used - t.x - t.w : t.x),
        y: top + t.y,
        priority: specs.findIndex((s) => s.id === t.id || (s.members?.includes(t.id) ?? false)),
        tabs: [] as string[],
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const moved = [...gone].sort((a, b) => a - b).map((i) => specs[i].id);
    for (const id of moved) {
      const spec = specs.find((s) => s.id === id)!;
      const byPriority = [...tiles].sort((a, b) => b.priority - a.priority);
      const host =
        spec.hosts?.map((h) => tiles.find((t) => t.id === h)).find((t) => t) ??
        byPriority.find((t) => !specs[t.priority].required) ??
        byPriority[0];
      host.tabs.push(id);
    }
    return { ...grid, used, usedRows, offset, top, tiles, moved };
  };
  const keep = (gone: Set<number>) => specs.filter((_, i) => !gone.has(i));
  // The set moved is a bit mask over the movable tiles, the LOWEST priority
  // the least significant bit, tried in increasing order: a tile moves only
  // when no cover keeps it with every tile of lower priority moved instead.
  // Fixed caps keep it fast and deterministic.
  const masks: number[] = [];
  for (let mask = 0; mask < 1 << m && masks.length < 4096; mask += 1) masks.push(mask);
  const goneOf = (mask: number) => new Set(movable.filter((_, j) => mask & (1 << (m - 1 - j))));
  let tries = 0;
  // The full board first.
  for (const mask of masks) {
    const kept = keep(goneOf(mask));
    const cells = cols * rows;
    if (kept.reduce((a, s) => a + largest(s), 0) < cells) continue;
    if (kept.reduce((a, s) => a + smallest(s), 0) > cells) continue;
    if ((tries += 1) > 80) break;
    const found = coverRun(cols, rows, kept);
    if (found) return settle(found, goneOf(mask), cols, rows);
  }
  if (exact) return null;
  // More room than the content: the tiles kept cannot fill the board even at
  // their largest, so the board shrinks to the largest rectangle they cover
  // that keeps the grid's shape (the smaller of its column and row shares
  // first, then the area, then the width; an odd margin counts a little
  // against), centred on the grid. Moving tiles out is tried lowest first,
  // as a run.
  const share = ([c, r]: [number, number]) =>
    Math.min(c / cols, r / rows) - ((cols - c) % 2) * 0.04 - ((rows - r) % 2) * 0.04;
  for (let drop = 0; drop <= m; drop += 1) {
    const gone = new Set(movable.slice(m - drop));
    const kept = keep(gone);
    const most = kept.reduce((a, s) => a + largest(s), 0);
    const boards: [number, number][] = [];
    for (let c = cols; c >= 1; c -= 1) for (let r = rows; r >= 1; r -= 1) if (c * r <= most && c * r < cols * rows) boards.push([c, r]);
    boards.sort((p, q) => share(q) - share(p) || q[0] * q[1] - p[0] * p[1] || q[0] - p[0]);
    for (const [used, usedRows] of boards) {
      const found = coverRun(used, usedRows, kept);
      if (found) return settle(found, gone, used, usedRows);
    }
  }
  throw new Error(`mgPack: no cover of ${cols} × ${rows} for ${specs.map((s) => s.id).join(", ")}`);
}

/* ── the three compositions ────────────────────────────────────────────── */

/** Each tile's size class (rule 7), its orientations in preference order.
 *  A tile keeps its class at every viewport; only the hero steps, 6 × 4 to
 *  8 × 5, and only where the board seats it. */
const XL: readonly Wh[] = [
  [8, 5],
  [6, 4],
];
const L: readonly Wh[] = SIZES.L;
/** M landscape only: Scope's GUID column and Detail's lead cards need
 *  the width a 2 × 3 does not have. */
const M_WIDE: readonly Wh[] = [[3, 2]];
/** L landscape only: a list whose rows need 400 px across (the requirement
 *  rows and blocks, the checks with their verdict column). */
const L_WIDE: readonly Wh[] = [[4, 3]];
const S: readonly Wh[] = SIZES.S;
/** A list or chart whose content scrolls or scales (Scope, Detail, the
 *  treemaps, the other checks): L where it fits, else M landscape. Its class
 *  is "L or M" because its content is: a scope of 3 rows or of 3 000. */
const LM: readonly Wh[] = [...SIZES.L, [3, 2]];

/** The MMI bars: M, or a strip (rule 3's named exception: a bar chart with
 *  few items reads across a strip). */
function mmiSizes(cols: number): Wh[] {
  const strips: Wh[] = [];
  for (let k = Math.min(cols - 1, 8); k >= 3; k -= 1) strips.push([k, 1]);
  return [[3, 2], ...strips];
}

/** The narrow fallback: under 11 columns the lists step down to M, the only
 *  way a 9 × 5 board seats the model beside them. */
function narrow(grid: MgGrid): boolean {
  return grid.cols < 11;
}

export interface MgContent {
  /** Requirements per report group, for c's panels. */
  ifc: number;
  std: number;
  /** The neutral counts (objects, types, …): S tiles, one fact each. */
  counts: number;
}

function countTiles(content: MgContent): MgTileSpec[] {
  return Array.from({ length: content.counts }, (_, i) => ({
    id: `count${i}`,
    kind: "panel" as MgKind,
    sizes: S,
    series: "count",
  }));
}

/** The narrow fallback, the same for all three: the model first and at
 *  6 × 4, the requirements and Scope as M beside it, the MMI bars a strip
 *  under both; everything else in tabs of those. */
function layoutNarrow(grid: MgGrid, content: MgContent, mirror: boolean): MgLayout {
  return mgPack(
    grid,
    [
      { id: "viewer", kind: "viewer", sizes: XL, required: true },
      { id: "reqs", kind: "list", sizes: M_WIDE, required: true },
      { id: "scope", kind: "list", sizes: M_WIDE, required: true },
      { id: "mmi", kind: "chart", sizes: [...mmiSizes(grid.cols), [grid.cols, 1]], hosts: ["reqs"] },
      { id: "detail", kind: "list", sizes: M_WIDE, hosts: ["scope"] },
      { id: "tree-system", kind: "chart", sizes: M_WIDE, hosts: ["reqs"] },
      { id: "tree-function", kind: "chart", sizes: M_WIDE, hosts: ["tree-system", "reqs"] },
      { id: "checks", kind: "list", sizes: M_WIDE, hosts: ["reqs"] },
      ...countTiles(content),
    ],
    mirror,
  );
}

/** A composition, or the narrow fallback where the board cannot seat it
 *  (two XL heroes need 12 columns). */
function orNarrow(grid: MgGrid, content: MgContent, mirror: boolean, pack: () => MgLayout): MgLayout {
  try {
    return pack();
  } catch {
    return layoutNarrow(grid, content, mirror);
  }
}

/** a · Linear work surface, with the requirements as a row of KPI cards on
 *  top (owner, 2026-09-26: "I like A best, but add a row of KPI cards at the
 *  top rather than the dense left sidebar that needs scrolling"). Under the
 *  band, by priority: the model (the hero), Scope and Detail, the treemaps
 *  and the MMI bars, the other checks, the counts.
 *
 *  THE BAND. Nothing in it scrolls and nothing shrinks below S. Three modes;
 *  of each one's first full cover the one covering the most of the window
 *  wins, ties in this order:
 *    1  one S card per requirement, in the report's order, in ONE row
 *       (2 modules × 11 = 22 columns, so from about 2560 px);
 *    2  one card per report section (IFC-struktur, Standardkrav) at M 3 × 2,
 *       its requirements as compact rows inside;
 *    3  the same at L 4 × 3.
 *  Wrapping the S cards onto a second row was tried on paper and left out:
 *  at 16 to 18 columns it leaves two or three cards alone on a row, and at
 *  12 it takes four of the six rows. Where a band is narrower than the board,
 *  the rest of its row is filled from the tiles below (the counts first,
 *  then the MMI bars and the treemaps), so the band stays one clean row.
 *  The board may narrow by whole columns, centred, so band and body share
 *  one edge (rule 9). Under 11 columns the narrow fallback applies. */
export function layoutA(grid: MgGrid, content: MgContent): MgLayout {
  if (narrow(grid)) return layoutNarrow(grid, content, false);
  return aBand(grid, content) ?? layoutNarrow(grid, content, false);
}

/** The tiles under the band, in priority order. */
function aBody(grid: MgGrid, content: MgContent): MgTileSpec[] {
  return [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "scope", kind: "list", sizes: LM, required: true },
    { id: "detail", kind: "list", sizes: LM, required: true },
    { id: "tree-system", kind: "chart", sizes: LM },
    { id: "tree-function", kind: "chart", sizes: LM, hosts: ["tree-system"] },
    { id: "mmi", kind: "chart", sizes: mmiSizes(grid.cols), hosts: ["tree-system"] },
    { id: "checks", kind: "list", sizes: L_WIDE, hosts: ["tree-system"] },
    ...countTiles(content),
  ];
}

/** Every subset of `pool` (by index), fewest non-count tiles first, then
 *  the fewest tiles, then the pool's order: the band takes counts before
 *  charts. */
function fillerSets(pool: readonly MgTileSpec[]): MgTileSpec[][] {
  const sets: MgTileSpec[][] = [];
  const n = Math.min(pool.length, 10);
  for (let mask = 0; mask < 1 << n; mask += 1) sets.push(pool.filter((_, i) => i < n && mask & (1 << i)));
  const charts = (set: MgTileSpec[]) => set.filter((t) => t.series !== "count").length;
  return sets
    .map((set, i) => ({ set, i }))
    .sort((p, q) => charts(p.set) - charts(q.set) || p.set.length - q.set.length || p.i - q.i)
    .map((e) => e.set);
}

function aBand(grid: MgGrid, content: MgContent): MgLayout | null {
  const { cols } = grid;
  const n = content.ifc + content.std;
  const cards = [
    ...Array.from({ length: content.ifc }, (_, i) => `ifc${i}`),
    ...Array.from({ length: content.std }, (_, i) => `std${i}`),
  ];
  const modes: { name: string; h: number; specs: MgTileSpec[] }[] = [];
  if (cols >= 2 * n) {
    modes.push({ name: "cards", h: 2, specs: [{ ...mgBlock("kpis", "panel", cards, S[0]), sizes: [[2 * n, 2]] }] });
  }
  modes.push({
    name: "sections-m",
    h: 2,
    specs: [
      { id: "g-ifc", kind: "list", sizes: M_WIDE, required: true },
      { id: "g-std", kind: "list", sizes: M_WIDE, required: true },
    ],
  });
  modes.push({
    name: "sections-l",
    h: 3,
    specs: [
      { id: "g-ifc", kind: "list", sizes: L_WIDE, required: true },
      { id: "g-std", kind: "list", sizes: L_WIDE, required: true },
    ],
  });
  const body = aBody(grid, content);
  // What may fill the band beside the cards: the counts, the MMI bars, the
  // treemaps. Never the model, Scope or Detail.
  const pool = [...body.filter((t) => t.series === "count"), ...body.filter((t) => ["mmi", "tree-system", "tree-function"].includes(t.id))];
  const sets = fillerSets(pool);
  const MIN_BODY = 4;
  // Each mode's first cover; the one that covers the most of the window
  // wins (rule 9: a board that fills the screen, not a strip in the middle
  // of it), ties to the mode order.
  let best: MgLayout | null = null;
  for (const mode of modes) {
    const found = aMode(grid, mode, body, sets, MIN_BODY);
    if (found && (!best || found.used * found.usedRows > best.used * best.usedRows)) best = found;
  }
  return best;
}

function aMode(
  grid: MgGrid,
  mode: { name: string; h: number; specs: MgTileSpec[] },
  body: MgTileSpec[],
  sets: MgTileSpec[][],
  MIN_BODY: number,
): MgLayout | null {
  const { cols, rows } = grid;
  {
    if (rows - mode.h < MIN_BODY) return null;
    const cardCols = mode.specs.reduce((a, t) => a + t.sizes[0][0], 0);
    for (let used = cols; used >= Math.max(cardCols, cols - 8); used -= 1) {
      // The first few fillings that close the band; each costs a body pack.
      let tried = 0;
      for (const fill of sets) {
        if (tried >= 4) break;
        const bandSpecs = [...mode.specs, ...fill.map((t) => ({ ...t, sizes: t.sizes.filter(([, h]) => h <= mode.h) }))];
        if (bandSpecs.some((t) => t.sizes.length === 0)) continue;
        const bandCover = coverRun(used, mode.h, bandSpecs);
        if (!bandCover) continue;
        tried += 1;
        const rest = body.filter((t) => !fill.includes(t));
        for (let r = rows - mode.h; r >= MIN_BODY; r -= 1) {
          const lower = mgPackExact({ cols: used, rows: r, u: grid.u }, rest);
          if (!lower) continue;
          const offset = Math.floor((cols - used) / 2);
          const top = Math.floor((rows - mode.h - r) / 2);
          const bandTiles: MgPlace[] = bandCover.map((t, i) => ({
            ...t,
            x: offset + t.x,
            y: top + t.y,
            priority: i,
            tabs: [],
          }));
          const lowerTiles: MgPlace[] = lower.tiles.map((t) => ({
            ...t,
            x: offset + t.x,
            y: top + mode.h + t.y,
            priority: bandTiles.length + t.priority,
          }));
          return {
            ...grid,
            used,
            usedRows: mode.h + r,
            offset,
            top,
            tiles: [...bandTiles, ...lowerTiles].sort((p, q) => p.y - q.y || p.x - q.x),
            moved: lower.moved,
            band: mode.name,
          };
        }
      }
    }
  }
  return null;
}

/** b · Stripe summary. The summary leads, top-left: the two treemaps and
 *  the MMI bars; one hero, the model, beside them; then the report as
 *  blocks, Scope and Detail, the other checks, the counts. */
export function layoutB(grid: MgGrid, content: MgContent): MgLayout {
  if (narrow(grid)) return layoutNarrow(grid, content, true);
  return orNarrow(grid, content, true, () =>
    mgPack(grid, [
      { id: "tree-system", kind: "chart", sizes: LM, hosts: ["reqs"] },
      { id: "tree-function", kind: "chart", sizes: LM, hosts: ["tree-system", "reqs"] },
      { id: "mmi", kind: "chart", sizes: mmiSizes(grid.cols), hosts: ["tree-system", "reqs"] },
      { id: "viewer", kind: "viewer", sizes: XL, required: true },
      { id: "reqs", kind: "list", sizes: L, required: true },
      { id: "scope", kind: "list", sizes: LM, required: true },
      { id: "detail", kind: "list", sizes: LM, required: true },
      { id: "checks", kind: "list", sizes: L_WIDE, hosts: ["reqs"] },
      ...countTiles(content),
    ]),
  );
}

/** c · Grafana / Datadog. One S panel per requirement in the report's order,
 *  top-left; the model the hero; Scope and Detail beside it; then the
 *  charts, the other checks, the counts. Where the board cannot seat the
 *  panels beside the model and the two docks, the requirements are one list
 *  instead. */
export function layoutC(grid: MgGrid, content: MgContent): MgLayout {
  if (narrow(grid)) return layoutNarrow(grid, content, true);
  const ifc = Array.from({ length: content.ifc }, (_, i) => `ifc${i}`);
  const std = Array.from({ length: content.std }, (_, i) => `std${i}`);
  const rest: MgTileSpec[] = [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "scope", kind: "list", sizes: LM, required: true },
    { id: "detail", kind: "list", sizes: LM, required: true },
    { id: "tree-system", kind: "chart", sizes: LM },
    { id: "tree-function", kind: "chart", sizes: LM, hosts: ["tree-system"] },
    { id: "mmi", kind: "chart", sizes: mmiSizes(grid.cols), hosts: ["tree-system"] },
    { id: "checks", kind: "list", sizes: L_WIDE },
    ...countTiles(content),
  ];
  return orNarrow(grid, content, true, () => {
    try {
      return mgPack(grid, [mgBlock("g-ifc", "panel", ifc, S[0]), mgBlock("g-std", "panel", std, S[0]), ...rest]);
    } catch {
      // No cover with the panels: the requirements are one list.
      return mgPack(grid, [{ id: "reqs", kind: "list", sizes: L, required: true }, ...rest]);
    }
  });
}

/* ── the Graf tab: the graph and the model as two XL tiles ─────────────── */

/** The two surfaces of the Graf tab on the same grid (rules 4 and 7), side
 *  by side from the top-left corner of the board: both XL, at 8 × 5 where
 *  the board seats two of them, else 6 × 4. Where two XL cannot sit side by
 *  side (under 12 columns) the second is an L, 3 × 4, the largest canon size
 *  left beside a 6 × 4. `main` is first; the swap only changes which surface
 *  is which. Centred in whole columns. */
export function graphTiles(grid: MgGrid): { main: MgPlace; second: MgPlace; used: number; offset: number } {
  const { cols, rows } = grid;
  const pair = ([w, h]: Wh) => 2 * w <= cols && h <= rows;
  const xl = XL.find(pair);
  const main: Wh = xl ?? [6, 4];
  const second: Wh = xl ?? [3, 4];
  const used = Math.min(cols, main[0] + second[0]);
  const offset = Math.floor((cols - used) / 2);
  const at = (id: string, x: number, [w, h]: Wh, priority: number): MgPlace => ({
    id,
    kind: "viewer",
    x,
    y: 0,
    w,
    h,
    size: canonSize(w, h) ?? "XL",
    priority,
    tabs: [],
  });
  return { main: at("main", offset, main, 0), second: at("second", offset + main[0], second, 1), used, offset };
}
