/** The two AUTHORED layouts of the model board's first tab, Kontroll. Never
 *  one reflowed.
 *
 * 13 tracks (8 + 5) for 13"–24"; 21 tracks (13 + 8) for 27"–32". Which one
 * renders is decided by `useBentoCols` against the GRID's own inline size, not
 * the viewport — ifc-check runs inside an iframe on skiplum.com, where a
 * viewport unit measures the host page's box.
 *
 * ── Tabs (2026-09-21) ──────────────────────────────────────────────
 * edkjo: "a tabbed experience with the lead values and outputs on the first
 * dash, then more nitty gritty on other tabs." So this bento carries the lead
 * values only: the KPI strip, the verification focal (with the project rules
 * as rows under it), the model, the spatial lamps and ONE floor tile, the
 * config floors against every loaded model. The class bars, the storey ×
 * class census and the type ledger moved to the Innhold tab, which is a flow
 * surface, not a bento. The file's own facts moved to the panel header.
 *
 *   13 tracks × 9 rows               21 tracks × 6 rows
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        C C C C C G G G M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        C C C C C G G G M M M M M V V V V V V V V
 *   E E E E E E E E G G G G G        K K K K K K K K K K K K K K K K K K K K K
 *   E E E E E E E E G G G G G
 *   E E E E E E E E G G G G G        V verify 8×5 (the checks, and the three
 *   K K K K K K K K K K K K K          verdict readouts beside them)
 *                                    M viewer 5×5          E floors 8×3
 *                                    G spatial 5×3 (13), 3×2 (21)
 *                                    C classes 5×2 (21 only)
 *                                    K kpis 13×1 (13), 21×1 (21): the four
 *                                      NEUTRAL counts
 *
 * ── Romlig struktur is not a block (edkjo 2026-09-25) ───────────────
 * "this does not deserve this much space": when the chain is whole the four
 * lamps tell one fact. And the shape rule that came with it: wide/short and
 * narrow/tall tiles are avoided unless the component itself is a strip, so
 * the lamps do not become a one-row band either. They take the compact gauge
 * span 3×2 (about 1.5 : 1) on 21 tracks.
 *
 * Searched exhaustively (every span each kind admits, every seam-legal
 * placement, 6 to 10 rows, one focal, no gauge count): with `spatial` at 3×2
 * the 21-track board closes in exactly four ways, all six rows, all with
 * `classes` at 5×2 and `kpis` at 21×1; this is the one that keeps the floor
 * tile top-left. The 3-wide cut on 21 tracks exists only at tracks 6–8, so
 * the lamps sit beside the class bars rather than under the floors.
 *
 * On 13 tracks the same search finds NO closed board: a 3-wide tile can only
 * sit in the left eight tracks, whose rows are already the focal and the
 * floor tile, so any 3×2 there pushes the floor tile past the 8-row fold, and
 * the 5×3 slot beside the floor tile has no other tile whose registry spans
 * fill it. So the 13-track board keeps `spatial` at 5×3 until a tile is
 * registered for that slot or the lamps move into a header. Not forced here.
 *
 * ── Placement by importance (2026-09-24 layout pass) ────────────────
 * edkjo: "the layout isnt good enough and efficient in terms of what goes
 * where vs importance". The verdicts lead and the counts recede:
 *
 * - The three finding counts (Uten type · Uten etasje · Plassering) are no
 *   longer cards in a strip beside four neutral counts at the same size. They
 *   sit INSIDE the focal, to the right of the check rows they count, as the
 *   only large coloured numerals on the board. The strip keeps the four
 *   neutral counts, quiet, and goes to the LAST row: it is P2 now.
 * - On 13 tracks the focal is top-left (row 1), and the floor tile and the
 *   spatial lamps are rows 6–8, inside the 8-row fold, so both are P1. Only the quiet
 *   strip sits past the fold.
 * - On 21 tracks the focal cannot be top-left. Searched exhaustively (every
 *   span each kind admits, every seam-legal placement, 5 to 11 rows, the
 *   strip at every strip span, with and without the class tile, the focal at
 *   8×5 and 13×8): with a 5×5 viewer and a 5×3 or 3×2 gauge, no closed board
 *   puts the focal in column 1. The 5-wide tiles can only start on track 1
 *   or 9, so the 8-wide focal ends up on 14–21. What moved instead: the
 *   focal starts on row 1 (top-right, beside the viewer), and the top-left
 *   is the Etasjer tile rather than the always-green spatial lamps.
 * - Etasje × klasse was NOT promoted onto the 21-track board to close the
 *   band below it. Its registry spans (8×5 / 13×8) are both focal-class, and a
 *   canvas has one focal; at 8×3 (a third registry deviation) the table's own
 *   minimum width (a 9rem storey column, a count column and one ≥ 2.5rem
 *   column per class, eighteen on KNM_ARK) exceeds eight tracks at 2112 px,
 *   which is a sideways scroll inside a tile. It stays on Innhold.
 *
 * Bands: 13 → 8+5, 8+5, 13; 21 → 8+5+8 (rows 1–3), 5|3|5|8 (rows 4–5; the
 * cuts of 5+8+8 and 8+5+8), 21 (row 6).
 *
 * ── Size: one module, the page scrolls (2026-09-22) ─────────────────
 * The track is derived from the grid's WIDTH only (see `BentoGrid`), so the
 * board is the same composition at every width between breakpoints, scaled;
 * it is taller than a laptop screen and the page scrolls. The composition
 * changes at one width, `BENTO_21_MIN_WIDTH` (1900 px of grid).
 *
 * The ROW unit may grow toward a taller viewport (`bentoRowFactorRange`), and
 * how far is a property of the tiles placed here. On 13 tracks the ceiling is
 * 1.11 (the 5×5 viewer's own aspect floor) — and inert in practice, because
 * nine rows already overflow a laptop screen. On 21 tracks it was exactly 1.0
 * while the class tile sat at 3×3 (a `distribution`, whose usable aspect
 * starts at 1.0); at 5×2 since 2026-09-25 it no longer binds, and the ceiling
 * is the viewer's 1.11 there too.
 *
 * ── The band under a 21-track board is structural ───────────────────
 * Six rows of a 21-track board render about 3.4 : 1 (23 track-widths across,
 * 6.8 down). A 2112 × 1267 window leaves the board about 2080 × 1095 to fill,
 * which is 1.9 : 1, so the board covers the width and about 620 px of the
 * height and roughly 480 px of page below it stays empty (514 px measured at
 * 2112 × 1267 before 2026-09-25; the 1.11 ceiling now takes part of it). No
 * module can close the rest: the track is the width divided by a constant,
 * and growing the row is capped above. It closes only with MORE ROWS OF CONTENT — the nine-row
 * boards above, or tiles promoted from the Innhold tab, which is a decision
 * about what belongs on the Kontroll tab and not one this file can take. The
 * viewport gate measures the band and prints it at every target so it stays a
 * visible number rather than a thing nobody wrote down.
 *
 * ── The fold ──────────────────────────────────────────────────────
 * 13 tracks is 9 rows against an 8-row fold; the ninth is the quiet strip,
 * which is P2 there. Everything that carries a verdict or the file's own
 * structure ends inside the fold. The 21-track board sits inside its 10-row
 * fold at every priority.
 *
 * ── No air, and the KPI strip on 21 tracks ─────────────────────────
 * The class bars (5×2) and the spatial lamps (3×2) close tracks 1–8 under
 * the floor tile. The strip is 21 wide on the last row: with the lamps at
 * 3×2 that is the only strip width that closes, and the floor tile keeps 8×3
 * and its ten floors (the 2026-09-22 "squished floor chart" was a 21×1 strip
 * on row 1 forcing the floor tile to 8×2; on the last row it forces nothing).
 * The four neutral counts it carries are the least decision-relevant numbers
 * on the board, so they read last.
 *
 * The nine-row boards (13×8 focal, `viewer` at 3×3) belonged to the old
 * one-gauge tile set and were not taken; the 2026-09-25 search above, with
 * the lamps at 3×2, finds no board taller than six rows at all.
 *
 * The layouts are checked against all of that at render by
 * `validateBentoLayout`, and headlessly by `node scripts/board-gate.mjs`, so a
 * typo here is a loud failure rather than a quietly wrong board.
 */

// Explicit `.ts` so `scripts/board-gate.mjs` can import this straight into
// Node, which resolves ESM specifiers literally and has no bundler to guess
// the extension for it.
import type { BentoLayoutDefinition } from "./bento-spec.ts";

/** Build a `rows × cols` map from one id per band segment. Written out this
 *  way rather than as literal arrays of 13 or 21 strings per row: the segment
 *  widths ARE the band decomposition, so a row that does not close is a
 *  mistake this catches while the layout is being authored. */
function rows(count: number, bands: [string, number][]): string[][] {
  const row = bands.flatMap(([id, width]) => Array.from({ length: width }, () => id));
  return Array.from({ length: count }, () => [...row]);
}

export const LAYOUT_13: BentoLayoutDefinition = {
  cols: 13,
  rows: 9,
  layout: [
    ...rows(5, [["verify", 8], ["viewer", 5]]),
    ...rows(3, [["floors", 8], ["spatial", 5]]),
    ...rows(1, [["kpis", 13]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 6,
  layout: [
    ...rows(3, [["floors", 8], ["viewer", 5], ["verify", 8]]),
    ...rows(2, [["classes", 5], ["spatial", 3], ["viewer", 5], ["verify", 8]]),
    ...rows(1, [["kpis", 21]]),
  ],
};
