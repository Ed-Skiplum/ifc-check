/** THE MODULE GRID of the Overview board, 2026-09-26. Since 2026-09-28 the
 * one board (owner: "make b the new main version … we iterate on b"); the
 * a and c compositions are gone.
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
 *      stepping to 8×5 · a strip k×1 / 1×k only for a named content (the
 *      MMI bars, a bar chart with few items) · a tall column only for a named
 *      content (the floor config, a building floor chart). At most two XL.
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

export type MgSize = "S" | "M" | "L" | "XL" | "strip" | "tall";
export type Wh = readonly [number, number];

export const SIZES: Record<Exclude<MgSize, "strip" | "tall">, readonly Wh[]> = {
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
 *  only a size for a tile that names why (`MG_STRIPS`), a tall column only
 *  for one in `MG_TALL`. */
export function canonSize(w: number, h: number, strip = false, tall = false): MgSize | null {
  for (const [name, list] of Object.entries(SIZES) as [Exclude<MgSize, "strip" | "tall">, readonly Wh[]][]) {
    if (list.some(([a, b]) => a === w && b === h)) return name;
  }
  if (strip && (w === 1 || h === 1) && Math.max(w, h) >= 2) return "strip";
  if (tall && w >= 2 && h > w) return "tall";
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

/** The named tall exception (rule 3): a column taller than wide, the full
 *  height under the KPI row. */
export const MG_TALL: Record<string, string> = {
  floors: "a building floor chart: the storeys stacked, read down",
  checks: "the verification sidebar: one check per line, read down, the board's full height",
  detail: "the selected object's fields: one per line, read down, the body's full height when filled",
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
  /** Per size, the canon size it grew from (`mgGrown`), or null for a canon
   *  size. */
  bases?: readonly (Wh | null)[];
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
  /** Grown past its canon size to fill the board's rows (`mgFillRows`): the
   *  size it was packed at, `size` its class. */
  base?: Wh;
}

export interface MgLayout extends MgGrid {
  /** Columns the board covers (≤ cols) and its first one: it centres on the
   *  grid in whole modules when the content cannot fill every one. */
  used: number;
  offset: number;
  /** Rows the board covers (≤ rows) and its first one. */
  usedRows: number;
  top: number;
  /** A row's height, px, where it is not the module: the rows were too many
   *  for the content, so fewer, taller rows fill the same height
   *  (`mgFillRows`). */
  rowPx?: number;
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
      const base = s.bases?.[cut.k] ?? null;
      const [bw, bh] = base ?? [w, h];
      const size = canonSize(bw, bh, s.id in MG_STRIPS, s.id in MG_TALL)!;
      out.push(base ? { id: s.id, kind: s.kind, x, y, w, h, size, base } : { id: s.id, kind: s.kind, x, y, w, h, size });
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

/* ── the full height (rule 9) ──────────────────────────────────────────── */

/** `specs` with each tile's canon sizes grown down, row by row, to `rows`,
 *  while the rendered aspect stays inside its kind's bound; the grown sizes
 *  after the canon ones, the least grown first, so a cover takes them only
 *  where the canon sizes leave rows empty. Never an S card or a block. */
export function mgGrown(specs: readonly MgTileSpec[], rows: number, u: number): MgTileSpec[] {
  return specs.map((s) => {
    if (s.members || s.sizes.every(([w, h]) => canonSize(w, h) === "S")) return s;
    const grown: { wh: Wh; base: Wh; k: number }[] = [];
    for (const [w, h] of s.sizes) {
      if (canonSize(w, h) === "S") continue;
      for (let k = 1; h + k <= rows && mgAspect(s.kind, w, h + k, u) >= MG_ASPECT[s.kind].min - 1e-9; k += 1) {
        if (!s.sizes.some(([a, b]) => a === w && b === h + k) && !grown.some((g) => g.wh[0] === w && g.wh[1] === h + k))
          grown.push({ wh: [w, h + k], base: [w, h], k });
      }
    }
    if (!grown.length) return s;
    grown.sort((p, q) => p.k - q.k);
    return {
      ...s,
      sizes: [...s.sizes, ...grown.map((g) => g.wh)],
      bases: [...s.sizes.map(() => null), ...grown.map((g) => g.base)],
    };
  });
}

/** A tile's rendered aspect, width over height, at `w × h` modules; a canvas
 *  less its tile head. */
export function mgAspect(kind: MgKind, w: number, h: number, u: number, rowPx = u): number {
  const height = h * rowPx + (h - 1) * MG_GAP - (kind === "viewer" || kind === "graph" ? MG_HEAD : 0);
  return mgSpanPx(w, u) / height;
}

/** Whether `t` may take one more row: never an S card (rule 5, a fact does
 *  not grow), a named tall column freely (Detail to about 1 : 2 and never
 *  past a row more than its content, `limit`), any other tile while its
 *  rendered aspect stays inside its kind's bound. */
function mayGrow(t: MgPlace, u: number, limit: Readonly<Record<string, number>>): boolean {
  if (t.size === "S" || limit[t.id] === 0) return false;
  if (t.id in limit && t.h + 1 > limit[t.id]) return false;
  if (t.size === "tall") return t.id !== "detail" || t.h + 1 <= 2 * t.w;
  return mgAspect(t.kind, t.w, t.h + 1, u) >= MG_ASPECT[t.kind].min - 1e-9;
}

/** What one more row costs a tile: how far it moves from its kind's ideal
 *  shape (a canvas 16 : 10, else square). A tall column costs nothing. */
function growCost(t: MgPlace, u: number): number {
  if (t.size === "tall") return 0;
  const ideal = t.kind === "viewer" || t.kind === "graph" ? 1.6 : 1;
  return Math.abs(Math.log(mgAspect(t.kind, t.w, t.h + 1, u) / ideal));
}

/** One more row inside the board (y from 0, `h` rows, columns `x0` on for
 *  `used`), or null. The row goes in at a line `Y`: every tile across the
 *  line grows by it, and on each column where tiles only meet at the line,
 *  the one above or the one below grows into it; the tiles below shift down.
 *  Of every line and choice the cheapest (`growCost`), ties to the first. */
function growOneRow(
  tiles: MgPlace[],
  x0: number,
  used: number,
  h: number,
  u: number,
  limit: Readonly<Record<string, number>>,
): MgPlace[] | null {
  let best: { cost: number; grow: Set<MgPlace>; Y: number } | null = null;
  for (let Y = 0; Y <= h; Y += 1) {
    const across = tiles.filter((t) => t.y < Y && Y < t.y + t.h);
    const above = tiles.filter((t) => t.y + t.h === Y);
    const below = tiles.filter((t) => t.y === Y);
    const walk = (x: number, grow: MgPlace[], cost: number) => {
      if (best && cost >= best.cost) return;
      if (x === x0 + used) {
        best = { cost, grow: new Set(grow), Y };
        return;
      }
      const forced = across.find((t) => t.x === x);
      const options = forced ? [forced] : [above.find((t) => t.x === x), below.find((t) => t.x === x)];
      for (const t of options) if (t && mayGrow(t, u, limit)) walk(x + t.w, [...grow, t], cost + growCost(t, u));
    };
    walk(x0, [], 0);
  }
  if (!best) return null;
  const { grow, Y } = best as { grow: Set<MgPlace>; Y: number };
  return tiles.map((t) => {
    if (grow.has(t)) return { ...t, h: t.h + 1, base: t.base ?? [t.w, t.h] };
    return t.y >= Y ? { ...t, y: t.y + 1 } : t;
  });
}

/** Rule 9, the height: the board takes every row of the grid. A board short
 *  of the grid's rows grows its tiles into them (`growOneRow`, each inside
 *  its bound), row by row; where nothing more can grow, the rows left are
 *  fewer and taller instead (`rowPx`), the same height, so no row stays
 *  empty: as many grown rows as keep every tile inside its bound once the
 *  rows are taller. `limit`: the most rows a tile may grow to (Detail, its
 *  content's). */
export function mgFillRows(layout: MgLayout, limit: Readonly<Record<string, number>> = {}): MgLayout {
  const { rows, u, top } = layout;
  // The KPI row stays the KPI row: its tiles (the cards and a treemap that
  // closes it) keep their two rows, and the body under it grows instead.
  if (layout.band === "kpis" || layout.band === "kpis+side") {
    const fixed: Record<string, number> = { ...limit };
    for (const t of layout.tiles) if (t.y === top && t.h === 2) fixed[t.id] = 0;
    limit = fixed;
  }
  const steps: MgPlace[][] = [layout.tiles.map((t) => ({ ...t, y: t.y - top }))];
  const start = layout.usedRows;
  while (start + steps.length - 1 < rows) {
    const next = growOneRow(steps[steps.length - 1], layout.offset, layout.used, start + steps.length - 1, u, limit);
    if (!next) break;
    steps.push(next);
  }
  const done = (tiles: MgPlace[]) => [...tiles].sort((p, q) => p.y - q.y || p.x - q.x);
  if (start + steps.length - 1 === rows) return { ...layout, tiles: done(steps[steps.length - 1]), top: 0, usedRows: rows };
  const height = mgSpanPx(rows, u);
  for (let g = steps.length - 1; g >= 0; g -= 1) {
    const h = start + g;
    const rowPx = (height - (h - 1) * MG_GAP) / h;
    const fits = steps[g].every((t) => {
      if (t.size === "tall" || t.size === "strip") return true;
      const a = mgAspect(t.kind, t.w, t.h, u, rowPx);
      return a >= MG_ASPECT[t.kind].min - 1e-9 && a <= MG_ASPECT[t.kind].max + 1e-9;
    });
    if (fits || g === 0) return { ...layout, tiles: done(steps[g]), top: 0, rows: h, usedRows: h, rowPx };
  }
  return layout;
}

/* ── the Overview composition ──────────────────────────────────────────── */

/** Each tile's size class (rule 7), its orientations in preference order.
 *  A tile keeps its class at every viewport; only the hero steps, 6 × 4 to
 *  8 × 5, and only where the board seats it. */
const XL: readonly Wh[] = [
  [8, 5],
  [6, 4],
];
/** M landscape only: Scope's GUID column and Detail's lead cards need
 *  the width a 2 × 3 does not have. */
const M_WIDE: readonly Wh[] = [[3, 2]];
/** L landscape only: the checks list, whose name column and verdict column
 *  need 400 px across. */
const L_WIDE: readonly Wh[] = [[4, 3]];
const S: readonly Wh[] = SIZES.S;
/** A list or chart whose content scrolls or scales (Scope, Detail, the
 *  treemaps): L where it fits, else M landscape. */
const LM: readonly Wh[] = [...SIZES.L, [3, 2]];

export interface MgContent {
  /** The IFC-struktur requirements: one S KPI card each, on the top row. */
  ifc: number;
  /** The neutral counts (types, storeys, file size, materials): S tiles. */
  counts: number;
  /** The treemaps that are general (the IFC-class and PredefinedType
   *  fallbacks, `tree-system` / `tree-function`). A treemap read through a
   *  project mapping is not on the Overview. */
  trees: readonly string[];
  /** The verification sidebar's width in modules (`sideModules`), or 0/absent
   *  for the checks as a tile of the board. */
  side?: number;
  /** The rows Detail's content needs (measured, `detailRows`), or 0/absent
   *  while it is empty. */
  detail?: number;
}

/** The rows a tile needs to seat `px` of content under a tile head. */
export function detailRows(px: number, u: number): number {
  return px > 0 ? Math.ceil((px + MG_HEAD + MG_GAP) / (u + MG_GAP)) : 0;
}

/** The verification sidebar's width: the fewest modules, 4 to 5, whose span
 *  seats `needPx` (the rows' own width, measured: the longest check name,
 *  the verdict cell, the % column). Under 4 the rows lose their verdict word
 *  and % column (`compact`); past 5 a name ellipsizes rather than the board
 *  giving up a sixth column. */
export const SIDE_MODULES = [4, 5] as const;
export function sideModules(needPx: number, u: number): number {
  return SIDE_MODULES.find((w) => mgSpanPx(w, u) >= needPx) ?? SIDE_MODULES[SIDE_MODULES.length - 1];
}

function countTiles(content: MgContent): MgTileSpec[] {
  return Array.from({ length: content.counts }, (_, i) => ({
    id: `count${i}`,
    kind: "panel" as MgKind,
    sizes: S,
    series: "count",
  }));
}

function treeTiles(content: MgContent): MgTileSpec[] {
  return content.trees.map((id) => ({ id, kind: "chart" as MgKind, sizes: LM, hosts: ["checks", "scope"] }));
}

/** The tiles under the KPI row, beside the floor sidebar, in priority order. */
function overviewBody(content: MgContent, checks = true): MgTileSpec[] {
  return [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "scope", kind: "list", sizes: LM, required: true },
    // Detail before the checks: a Scope row opens Detail beside the list, not
    // over it. The checks as a tab of Scope show while Scope is empty.
    { id: "detail", kind: "list", sizes: LM, hosts: ["scope"] },
    // L landscape first: its % column; 3 across it draws compact.
    ...(checks ? [{ id: "checks", kind: "list" as MgKind, sizes: [...L_WIDE, [3, 4], [3, 2]] as Wh[], hosts: ["scope"] }] : []),
    ...treeTiles(content),
    ...countTiles(content),
  ];
}

/** Every subset of `pool` (by index), fewest non-count tiles first, then
 *  the fewest tiles, then the pool's order: the KPI row takes counts before
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

/** The floor sidebar's widths, most wanted first: a floor table's name,
 *  kote and one column per loaded model. */
const FLOOR_WIDTHS = [3, 4] as const;
/** The fewest rows under the KPI row: the XL hero's 4. */
const MIN_BODY = 4;

/** The Overview (owner, 2026-09-28: "KPI cards go on top, then sidebar and
 *  larger tiled components"; "show the floor config on the right side as a
 *  tall sidebar"). Three parts, one board:
 *
 *    the KPI row   one S card per IFC-struktur requirement, in the report's
 *                  order, then the neutral counts (S) and, when general, the
 *                  treemaps (M 3 × 2) until the row is closed. Never a list,
 *                  never a scroll.
 *    the sidebar   the floor config (Etasjer), the full height under the
 *                  KPI row on the right: rule 3's named tall exception, a
 *                  building floor chart.
 *    the middle    by priority, the model (hero), Scope, Detail, the checks,
 *                  the general treemaps, the counts the row did not take;
 *                  too little room moves the lowest into a tab of Scope.
 *
 *  Of every board width (whole columns, centred) and body height, the one
 *  whose cover takes the most of the window wins (rule 9: a board, not a
 *  strip), ties to the wider. Where no such board exists (under about 12
 *  columns) the narrow fallback applies. Pure and deterministic.
 *
 *  THE VERIFICATION SIDEBAR (owner, 2026-09-29: "the verification panel
 *  should come out and be a left sidebar. Scrolling inside of the dash when
 *  there is space to go is awkward"). With `content.side` the checks leave
 *  the board and take `side` columns on the left, the board's full height
 *  (KPI row included); the board above packs in the columns left, without
 *  them, and the two centre as one; the sidebar runs the board's full
 *  height, its rows top-aligned, and scrolls only past it. Where the KPI row
 *  and the floor sidebar do not fit in the columns left (12 to 15 columns),
 *  the board packs by priority instead (`packedBoards`), and what it cannot
 *  seat is a tab of the sidebar. The break: under 12 columns or 6 rows the
 *  columns left cannot hold five S cards and the XL model at all, and the
 *  checks go back into the board as a tile or a tab, as without a sidebar
 *  (the narrow fallback). */
export function layoutOverview(grid: MgGrid, content: MgContent): MgLayout {
  const need = content.detail ?? 0;
  const limit: Record<string, number> = need > 0 ? { detail: need + 1 } : {};
  return bestFilled((grow) => {
    const board = composeOverview(grid, content, grow);
    return board && mgFillRows(board, limit);
  });
}

/** Rule 9 by composition: the board at canon sizes, filled (`mgFillRows`);
 *  where that leaves fewer, taller rows, the board composed again with its
 *  tiles free to grow down (`mgGrown`), and the one of the two that takes
 *  the most rows, then the first; never one that loses the verification
 *  sidebar the first has. */
function bestFilled(compose: (grow: boolean) => MgLayout | null): MgLayout {
  const first = compose(false)!;
  if (!first.rowPx) return first;
  const second = compose(true);
  // The verification sidebar stays where the first pass seats it.
  const sided = (l: MgLayout) => l.band === "kpis+side" || l.band === "side-pack";
  if (!second || (sided(first) && !sided(second))) return first;
  return second.rows > first.rows ? second : first;
}

/** `grow`: the second pass (`bestFilled`), the KPI-row boards only, or null;
 *  the packed and narrow boards are the first pass's. */
function composeOverview(grid: MgGrid, content: MgContent, grow = false): MgLayout | null {
  // A sidebar wider than the fewest modules gives a column back before it
  // gives up: a check name ellipsizes rather than the sidebar going.
  const want = content.side ?? 0;
  for (let side = want; side > 0 && side >= Math.min(want, SIDE_MODULES[0]) && grid.cols - side > 0; side -= 1) {
    const region = { ...grid, cols: grid.cols - side };
    const inner = searchOverview(region, content, overviewBody(content, false), grow);
    const withInner = inner ? besideSide(grid, side, inner, "kpis+side", false) : null;
    if (withInner) return withInner;
    if (grow) continue;
    for (const packed of packedBoards(region, content)) {
      const withPacked = besideSide(grid, side, packed, "side-pack", true);
      if (withPacked) return withPacked;
    }
  }
  const board = searchOverview(grid, content, overviewBody(content), grow);
  return board ?? (grow ? null : layoutNarrow(grid, content));
}

/** Where the KPI row and the floor sidebar do not fit beside the checks (a
 *  laptop, 12 to 15 columns): the board packs by priority on the columns
 *  left, the KPI cards first (S, never a list; they wrap under and beside the
 *  model as the columns allow), then the model, Scope, Detail, the floors and
 *  the treemaps; what does not fit is a tab of the sidebar, and a dock comes
 *  forward there when it fills. The counts close the cover: after the docks
 *  where that covers the board, else right after the KPI cards. The full
 *  board first, then the largest that is covered (`mgPack`), centred. */
function* packedBoards(region: MgGrid, content: MgContent): Generator<MgLayout> {
  // The KPI row's two and the model's four: fewer rows is the break.
  if (region.rows < 2 + MIN_BODY) return;
  const kpis = Array.from({ length: content.ifc }, (_, i) => ({ id: `ifc${i}`, kind: "panel" as MgKind, sizes: S, required: true }));
  const rest: MgTileSpec[] = [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "scope", kind: "list", sizes: LM },
    { id: "detail", kind: "list", sizes: LM },
    { id: "floors", kind: "list", sizes: LM },
    ...content.trees.map((id) => ({ id, kind: "chart" as MgKind, sizes: LM })),
  ];
  const orders = [
    [...kpis, ...rest, ...countTiles(content)],
    [...kpis, ...countTiles(content), ...rest],
  ];
  for (const specs of orders) {
    const exact = mgPackExact(region, specs);
    if (exact) yield readingOrder(exact);
  }
  for (const specs of orders) {
    try {
      yield readingOrder(mgPack(region, specs));
    } catch {
      /* no cover at any size */
    }
  }
}

/** The S cards (the KPI cards, then the counts) are interchangeable slots:
 *  they take the board's S places in reading order, row-major, so the cards
 *  read in the report's order wherever the cover put them. */
function readingOrder(layout: MgLayout): MgLayout {
  const slot = (t: MgPlace) => /^(ifc|count)\d+$/.test(t.id) && t.w === 2 && t.h === 2;
  const places = layout.tiles.filter(slot).sort((a, b) => a.y - b.y || a.x - b.x);
  const cards = places.map((t) => ({ id: t.id, priority: t.priority })).sort((a, b) => a.priority - b.priority);
  const at = new Map(places.map((t, i) => [t, cards[i]]));
  return { ...layout, tiles: layout.tiles.map((t) => (at.has(t) ? { ...t, ...at.get(t)! } : t)) };
}

/** The checks as a column `side` modules wide on the left of `inner` (laid
 *  out on the columns left), the board's full height, the two centred as
 *  one. `adopt`: the tiles `inner` moved are tabs of the sidebar. Null where
 *  the column is no canon shape. */
function besideSide(grid: MgGrid, side: number, inner: MgLayout, band: string, adopt: boolean): MgLayout | null {
  const size = canonSize(side, inner.usedRows, false, true);
  if (!size) return null;
  const used = side + inner.used;
  const offset = Math.floor((grid.cols - used) / 2);
  const shift = offset + side - inner.offset;
  const sidebar: MgPlace = {
    id: "checks",
    kind: "list",
    x: offset,
    y: inner.top,
    w: side,
    h: inner.usedRows,
    size,
    priority: inner.tiles.length,
    // The counts among them are rows of the checks list, never tabs (`Tile`).
    tabs: adopt ? [...inner.moved] : [],
  };
  return {
    ...grid,
    used,
    usedRows: inner.usedRows,
    offset,
    top: inner.top,
    tiles: [sidebar, ...inner.tiles.map((t) => ({ ...t, x: t.x + shift, tabs: adopt ? [] : t.tabs }))].sort(
      (p, q) => p.y - q.y || p.x - q.x,
    ),
    moved: inner.moved,
    band,
  };
}

/** Detail as a column the body's full height, `w` wide: only where its
 *  content fills it (a row short at most) and the column is about 1 : 2 or
 *  wider (h ≤ 2w). */
const DETAIL_WIDTHS = [3, 4] as const;

/** The KPI row, the body and the floor sidebar on `grid` (see
 *  `layoutOverview`), or null where no such board exists.
 *
 *  DETAIL, FILLED (2026-09-29, the owner: "Scrolling inside of the dash when
 *  there is space to go is awkward"). Detail's content is far taller than the
 *  M it docks at while empty, so where it fills, it may take a column the
 *  body's full height instead: beside the floor sidebar, or in its place with
 *  the floors a tab of it (the floors are below Detail and Scope in priority,
 *  `packedBoards`). Of one board's covers the one that gives Detail the most
 *  of the rows it needs wins, then the one that keeps Scope largest, then the
 *  first (the floor sidebar as before). The board itself (its width and
 *  height) is chosen as before: Detail never shrinks the board. */
function searchOverview(grid: MgGrid, content: MgContent, body: MgTileSpec[], grow = false): MgLayout | null {
  const { cols, rows } = grid;
  const kpiIds = Array.from({ length: content.ifc }, (_, i) => `ifc${i}`);
  const kpis: MgTileSpec = { ...mgBlock("kpis", "panel", kpiIds, S[0]), sizes: [[2 * content.ifc, 2]] };
  const pool = [...body.filter((t) => t.series === "count"), ...body.filter((t) => content.trees.includes(t.id))];
  const sets = fillerSets(pool);
  const need = content.detail ?? 0;
  let best: MgLayout | null = null;
  // Cells first (the board), then Detail's rows, then Scope's area.
  type Score = [number, number, number];
  let bestScore: Score = [0, 0, 0];
  const better = (a: Score, b: Score) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);
  type Column = { id: string; w: number };
  if (content.ifc > 0 && rows - 2 >= MIN_BODY) {
    for (let used = cols; used >= 2 * content.ifc; used -= 1) {
      if (used * rows < bestScore[0]) break;
      let tried = 0;
      for (const fill of sets) {
        if (tried >= 4) break;
        const bandSpecs = [kpis, ...fill.map((t) => ({ ...t, sizes: t.sizes.filter(([, h]) => h === 2) }))];
        if (bandSpecs.some((t) => t.sizes.length === 0)) continue;
        const band = coverRun(used, 2, bandSpecs);
        if (!band) continue;
        tried += 1;
        const rest = body.filter((t) => !fill.includes(t));
        const restNoDetail = rest.filter((t) => t.id !== "detail");
        for (let r = rows - 2; r >= (grow ? rows - 2 : MIN_BODY); r -= 1) {
          if (used * (r + 2) < bestScore[0]) break;
          // The right-hand columns, left to right: the floor sidebar as
          // before (its first width that covers); Detail beside it; Detail in
          // its place, the floors a tab of it.
          const options: { cols: Column[]; inner: MgTileSpec[] }[] = FLOOR_WIDTHS.map((w) => ({
            cols: [{ id: "floors", w }],
            inner: rest,
          }));
          if (need >= r - 1 && rest.some((t) => t.id === "detail")) {
            for (const dw of DETAIL_WIDTHS)
              for (const w of FLOOR_WIDTHS) options.push({ cols: [{ id: "detail", w: dw }, { id: "floors", w }], inner: restNoDetail });
            for (const dw of DETAIL_WIDTHS) options.push({ cols: [{ id: "detail", w: dw }], inner: restNoDetail });
          }
          let chosen: { lower: MgLayout; cols: Column[]; score: Score } | null = null;
          let floorsDone = false;
          for (const option of options) {
            const floorsOnly = option.cols.length === 1 && option.cols[0].id === "floors";
            if (floorsOnly && floorsDone) continue;
            const side = option.cols.reduce((a, c) => a + c.w, 0);
            if (used - side < 6) continue;
            // A canon L (3 × 4) or the named tall column; 4 × 4 is neither.
            // Detail's column is about 1 : 2 at most.
            if (option.cols.some((c) => !canonSize(c.w, r, false, true) || (c.id === "detail" && r > 2 * c.w))) continue;
            const lower = mgPackExact({ cols: used - side, rows: r, u: grid.u }, grow ? mgGrown(option.inner, r, grid.u) : option.inner);
            if (!lower) continue;
            if (floorsOnly) floorsDone = true;
            const d = option.cols.some((c) => c.id === "detail") ? r : (lower.tiles.find((t) => t.id === "detail")?.h ?? 0);
            const s = lower.tiles.find((t) => t.id === "scope");
            const score: Score = [used * (r + 2), Math.min(d, need), need > 0 && s ? s.w * s.h : 0];
            if (!chosen || better(score, chosen.score)) chosen = { lower, cols: option.cols, score };
            if (need === 0) break;
          }
          if (!chosen) continue;
          if (best && !better(chosen.score, bestScore)) break;
          const { lower, cols: side } = chosen;
          const offset = Math.floor((cols - used) / 2);
          const top = Math.floor((rows - 2 - r) / 2);
          const bandTiles: MgPlace[] = band.map((t, i) => ({ ...t, x: offset + t.x, y: top + t.y, priority: i, tabs: [] }));
          const lowerTiles: MgPlace[] = lower.tiles.map((t) => ({
            ...t,
            x: offset + t.x,
            y: top + 2 + t.y,
            priority: bandTiles.length + t.priority,
          }));
          const floorsGone = !side.some((c) => c.id === "floors");
          let x = offset + used - side.reduce((a, c) => a + c.w, 0);
          const columns: MgPlace[] = side.map((c, i) => {
            const place: MgPlace = {
              id: c.id,
              kind: "list",
              x,
              y: top + 2,
              w: c.w,
              h: r,
              size: canonSize(c.w, r, false, true)!,
              priority: bandTiles.length + lowerTiles.length + i,
              tabs: c.id === "detail" && floorsGone ? ["floors"] : [],
            };
            x += c.w;
            return place;
          });
          best = {
            ...grid,
            used,
            usedRows: r + 2,
            offset,
            top,
            tiles: [...bandTiles, ...lowerTiles, ...columns].sort((p, q) => p.y - q.y || p.x - q.x),
            moved: floorsGone ? [...lower.moved, "floors"] : lower.moved,
            band: "kpis",
          };
          bestScore = chosen.score;
          break;
        }
      }
    }
  }
  return best;
}

/** The narrow fallback: the model first and at 6 × 4, the IFC-struktur
 *  requirements and Scope as M beside it; the floors, the checks and Detail
 *  in tabs of those. */
function layoutNarrow(grid: MgGrid, content: MgContent): MgLayout {
  return mgPack(grid, [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "reqs", kind: "list", sizes: M_WIDE, required: true },
    { id: "scope", kind: "list", sizes: M_WIDE, required: true },
    { id: "floors", kind: "list", sizes: M_WIDE, hosts: ["reqs"] },
    { id: "detail", kind: "list", sizes: M_WIDE, hosts: ["scope"] },
    { id: "checks", kind: "list", sizes: M_WIDE, hosts: ["reqs"] },
    ...content.trees.map((id) => ({ id, kind: "chart" as MgKind, sizes: M_WIDE, hosts: ["reqs"] })),
    ...countTiles(content),
  ]);
}

/* ── the project tab («Prosjekt») ──────────────────────────────────────── */

export interface MgProjectContent {
  /** The Standardkrav requirements: one S KPI card each, on the top row. */
  std: number;
  /** The treemaps read through a project mapping (`ptree-system`,
   *  `ptree-function`); none without a mapping. */
  trees: readonly string[];
}

/** The MMI bars: M, or the named strip (`MG_STRIPS.mmi`) across 3 to 8. */
const MMI_SIZES: readonly Wh[] = [[3, 2], [2, 3], ...[8, 6, 5, 4, 3].map((k) => [k, 1] as const)];

/** The tiles under the KPI row, in priority order. The IDS table needs about
 *  680 px across (a name, three counts, the state), so it is XL, never
 *  narrower than 6: with the model, the board's two XL. */
function projectBody(content: MgProjectContent): MgTileSpec[] {
  return [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "ids", kind: "list", sizes: [[6, 4], [8, 5]], required: true },
    { id: "scope", kind: "list", sizes: LM, hosts: ["ids"] },
    { id: "detail", kind: "list", sizes: LM, hosts: ["scope", "ids"] },
    ...content.trees.map((id) => ({ id, kind: "chart" as MgKind, sizes: LM, hosts: ["ids"] })),
    { id: "mmi", kind: "chart", sizes: MMI_SIZES, hosts: ["ids"] },
  ];
}

/** The project tab: the Standardkrav KPI row on top (one S card each, never
 *  a list), then the IDS table, the model, Scope, Detail, the mapped
 *  treemaps and the MMI bars by priority. The row is closed with M tiles
 *  (the MMI bars, a treemap) where the board is wider than the cards; too
 *  little room moves the lowest into a tab of the IDS table. Of every board
 *  width and body height the one that takes the most of the window wins, as
 *  on the Overview. Under that (about 12 columns), the narrow fallback. */
export function layoutProject(grid: MgGrid, content: MgProjectContent): MgLayout {
  return bestFilled((grow) => {
    const board = composeProject(grid, content, grow);
    return board && mgFillRows(board);
  });
}

function composeProject(grid: MgGrid, content: MgProjectContent, grow = false): MgLayout | null {
  const { cols, rows } = grid;
  const kpiIds = Array.from({ length: content.std }, (_, i) => `std${i}`);
  const kpis: MgTileSpec = { ...mgBlock("kpis", "panel", kpiIds, S[0]), sizes: [[2 * content.std, 2]] };
  const body = projectBody(content);
  const pool = body.filter((t) => t.id === "mmi" || content.trees.includes(t.id));
  const sets = fillerSets(pool);
  let best: MgLayout | null = null;
  let bestCells = 0;
  if (content.std > 0 && rows - 2 >= MIN_BODY) {
    for (let used = cols; used >= 2 * content.std; used -= 1) {
      if (used * rows <= bestCells) break;
      let tried = 0;
      for (const fill of sets) {
        if (tried >= 4) break;
        const bandSpecs = [kpis, ...fill.map((t) => ({ ...t, sizes: t.sizes.filter(([, h]) => h === 2) }))];
        if (bandSpecs.some((t) => t.sizes.length === 0)) continue;
        const band = coverRun(used, 2, bandSpecs);
        if (!band) continue;
        tried += 1;
        const rest = body.filter((t) => !fill.includes(t));
        for (let r = rows - 2; r >= (grow ? rows - 2 : MIN_BODY); r -= 1) {
          if (used * (r + 2) <= bestCells) break;
          const lower = mgPackExact({ cols: used, rows: r, u: grid.u }, grow ? mgGrown(rest, r, grid.u) : rest);
          if (!lower) continue;
          const offset = Math.floor((cols - used) / 2);
          const top = Math.floor((rows - 2 - r) / 2);
          const bandTiles: MgPlace[] = band.map((t, i) => ({ ...t, x: offset + t.x, y: top + t.y, priority: i, tabs: [] }));
          const lowerTiles: MgPlace[] = lower.tiles.map((t) => ({
            ...t,
            x: offset + t.x,
            y: top + 2 + t.y,
            priority: bandTiles.length + t.priority,
          }));
          best = {
            ...grid,
            used,
            usedRows: r + 2,
            offset,
            top,
            tiles: [...bandTiles, ...lowerTiles].sort((p, q) => p.y - q.y || p.x - q.x),
            moved: lower.moved,
            band: "kpis",
          };
          bestCells = used * (r + 2);
          break;
        }
      }
    }
  }
  return best ?? (grow ? null : layoutProjectNarrow(grid, content));
}

/** The narrow fallback: the model at 6 × 4, the Standardkrav requirements as
 *  one list and the IDS table as M beside it; the rest in tabs of those. */
function layoutProjectNarrow(grid: MgGrid, content: MgProjectContent): MgLayout {
  return mgPack(grid, [
    { id: "viewer", kind: "viewer", sizes: XL, required: true },
    { id: "reqs", kind: "list", sizes: M_WIDE, required: true },
    { id: "ids", kind: "list", sizes: M_WIDE, required: true },
    { id: "scope", kind: "list", sizes: M_WIDE, hosts: ["ids"] },
    { id: "detail", kind: "list", sizes: M_WIDE, hosts: ["ids"] },
    ...content.trees.map((id) => ({ id, kind: "chart" as MgKind, sizes: M_WIDE, hosts: ["reqs"] })),
    { id: "mmi", kind: "chart", sizes: M_WIDE, hosts: ["reqs"] },
  ]);
}

/* ── the Rom tab: the spaces and their schedule ────────────────────────── */

/** The Rom tab on the same grid: the spatial view (3D or plan) and the
 *  schedule, together the board's full height (rule 9: no empty row). Beside
 *  each other, both the full height: the spatial view takes the most columns
 *  that keep its canvas inside 9 : 16 to 16 : 9 and leave the schedule 3 or
 *  more inside the list bound (1 : 2 to 2 : 1). Where no such pair exists (a
 *  narrow, tall window) they stack, the spatial view on top, each inside its
 *  bound. Of every board, the one that takes the most columns, beside before
 *  stacked. Centred in whole columns. Where neither exists (under 3 rows),
 *  they stack as two L. */
export function roomTiles(grid: MgGrid): { spatial: MgPlace; schedule: MgPlace; used: number; offset: number } {
  const { cols, rows, u } = grid;
  const place = (id: string, kind: MgKind, x: number, y: number, [w, h]: Wh, priority: number): MgPlace => ({
    id,
    kind,
    x,
    y,
    w,
    h,
    size: canonSize(w, h) ?? (w >= 6 ? "XL" : "L"),
    priority,
    tabs: [],
  });
  const inside = (kind: MgKind, w: number, h: number) => {
    const a = mgAspect(kind, w, h, u);
    return a >= MG_ASPECT[kind].min - 1e-9 && a <= MG_ASPECT[kind].max + 1e-9;
  };
  const board = (used: number) => {
    // Beside: the spatial view as wide as it may be.
    for (let fit = used - 3; fit >= 4; fit -= 1) {
      if (inside("viewer", fit, rows) && inside("list", used - fit, rows)) return { fit: [fit, rows] as Wh, rest: [used - fit, rows] as Wh, stacked: false };
    }
    // Stacked: the spatial view as tall as it may be, the schedule 2 or more.
    for (let h = rows - 2; h >= 3; h -= 1) {
      if (inside("viewer", used, h) && inside("list", used, rows - h)) return { fit: [used, h] as Wh, rest: [used, rows - h] as Wh, stacked: true };
    }
    return null;
  };
  for (let used = cols; used >= 4 && rows >= 3; used -= 1) {
    const b = board(used);
    if (!b) continue;
    const offset = Math.floor((cols - used) / 2);
    return {
      spatial: place("spatial", "viewer", offset, 0, b.fit, 0),
      schedule: place("schedule", "list", b.stacked ? offset : offset + b.fit[0], b.stacked ? b.fit[1] : 0, b.rest, 1),
      used,
      offset,
    };
  }
  const w = Math.min(cols, 4);
  const offset = Math.floor((cols - w) / 2);
  return {
    spatial: place("spatial", "viewer", offset, 0, [w, 3], 0),
    schedule: place("schedule", "list", offset, 3, [w, 3], 1),
    used: w,
    offset,
  };
}
