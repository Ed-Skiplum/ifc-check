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
 * as rows under it), the model, the spatial gauge and ONE floor tile, the
 * config floors against every loaded model. The class bars, the storey ×
 * class census and the type ledger moved to the Innhold tab, which is a flow
 * surface, not a bento. The file's own facts moved to the panel header.
 *
 *   13 tracks × 9 rows               21 tracks × 6 rows
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        G G G G G C C C M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        G G G G G C C C M M M M M V V V V V V V V
 *   E E E E E E E E G G G G G        G G G G G C C C K K K K K K K K K K K K K
 *   E E E E E E E E G G G G G
 *   E E E E E E E E G G G G G        V verify 8×5 (the checks, and the three
 *   K K K K K K K K K K K K K          verdict readouts beside them)
 *                                    M viewer 5×5          E floors 8×3
 *                                    G spatial 5×3         C classes 3×3 (21 only)
 *                                    K kpis 13×1: the four NEUTRAL counts
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
 *   gauge are rows 6–8, inside the 8-row fold, so both are P1. Only the quiet
 *   strip sits past the fold.
 * - On 21 tracks the focal cannot be top-left. Searched exhaustively (every
 *   span each kind admits, every seam-legal placement, 5 to 11 rows, the
 *   strip at every strip span, with and without the class tile, the focal at
 *   8×5 and 13×8): with a 5×5 viewer and the one 5×3 gauge, no closed board
 *   puts the focal in column 1. The 5-wide tiles can only start on track 1
 *   or 9, so the 8-wide focal ends up on 14–21. What moved instead: the
 *   focal starts on row 1 (top-right, beside the viewer), and the top-left
 *   is the Etasjer tile rather than the always-green gauge.
 * - Etasje × klasse was NOT promoted onto the 21-track board to close the
 *   band below it. Its registry spans (8×5 / 13×8) are both focal-class, and a
 *   canvas has one focal; at 8×3 (a third registry deviation) the table's own
 *   minimum width (a 9rem storey column, a count column and one ≥ 2.5rem
 *   column per class, eighteen on KNM_ARK) exceeds eight tracks at 2112 px,
 *   which is a sideways scroll inside a tile. It stays on Innhold.
 *
 * Bands: 13 → 8+5, 8+5, 13; 21 → 8+5+8 (rows 1–3), 5|3|5|8 (rows 4–5; the
 * cuts of 5+8+8 and 8+5+8), 5|3|13 (row 6).
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
 * nine rows already overflow a laptop screen. On 21 tracks it is exactly 1.0:
 * the 3×3 class tile is a `distribution`, whose usable aspect starts at 1.0,
 * so a taller cell would push it out of its own form's range.
 *
 * ── The band under a 21-track board is structural ───────────────────
 * Six rows of a 21-track board render about 3.4 : 1 (23 track-widths across,
 * 6.8 down). A 2112 × 1267 window leaves the board about 2080 × 1095 to fill,
 * which is 1.9 : 1, so the board covers the width and about 620 px of the
 * height and roughly 480 px of page below it stays empty. No module can close
 * that: the track is the width divided by a constant, and growing the row is
 * capped at 1.0 above. It closes only with MORE ROWS OF CONTENT — the nine-row
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
 * ── No air, and why the KPI strip is 13 wide on 21 tracks ──────────
 * Beside a 5-wide viewer the only legal starts are 6 and 9, so the four
 * tiles alone leave cols 6–8 empty on 21 tracks (it read as a void). The
 * class bars (3×3) close it. The four tiles cannot on their own: 40 + 25 +
 * 15 + 24 = 104 of 105 cells.
 *
 * The strip is 13 wide on 21 tracks so the floor tile keeps 8×3 and seats
 * ten floors (a 21×1 strip forces it to 8×2, five of ten, the "squished floor
 * chart" of 2026-09-22). Since 2026-09-24 the strip sits on the LAST row under
 * the viewer and the focal, and the floor tile takes the first three rows of
 * the left column; the four neutral counts it carries are the least
 * decision-relevant numbers on the board, so they read last.
 *
 * The nine-row boards are real and are NOT taken: each needs `viewer` at
 * 3×3 (the only span that lets a 13×8 focal close 21 tracks), which shrinks
 * the 3D from the second-largest tile to the smallest. They would fill a
 * tall screen — see the height note below — and that trade is edkjo's, not
 * this file's.
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
    ...rows(2, [["spatial", 5], ["classes", 3], ["viewer", 5], ["verify", 8]]),
    ...rows(1, [["spatial", 5], ["classes", 3], ["kpis", 13]]),
  ],
};
