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
 *   K K K K K K K K K K K K K        G G G G G C C C K K K K K K K K K K K K K
 *   V V V V V V V V M M M M M        G G G G G C C C M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        G G G G G C C C M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   V V V V V V V V M M M M M        E E E E E E E E M M M M M V V V V V V V V
 *   E E E E E E E E G G G G G
 *   E E E E E E E E G G G G G        K kpis 13×1          V verify 8×5
 *   E E E E E E E E G G G G G        M viewer 5×5         G spatial 5×3
 *                                    E floors 8×3         C classes 3×3 (21 only)
 *
 * Bands: 13 → 13, 8+5; 21 → 5|3|13 (the cuts of 5+8+8 and 8+5+8 meeting the
 * 13 of 13+8), 5|3|5|8 and 8|5|8.
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
 * 13 tracks is 9 rows against an 8-row fold, so the floor tile and the gauge
 * end past it and are P2 there, the same concession the KPI strip forced on
 * the previous board. Whether a KPI strip should count against the fold is
 * an upstream question for sprucelab, not something to fork here. The
 * 21-track board sits inside its 10-row fold at every priority.
 *
 * ── No air, and why the KPI strip is 13 wide on 21 tracks ──────────
 * Beside a 5-wide viewer the only legal starts are 6 and 9, so the four
 * tiles alone leave cols 6–8 empty on 21 tracks (it read as a void). The
 * class bars (3×3) close it. The four tiles cannot on their own: 40 + 25 +
 * 15 + 24 = 104 of 105 cells.
 *
 * The strip's width is what pays for the floor tile's third row. Searched
 * exhaustively (every span each kind admits, every seam-legal placement, 4
 * to 11 rows, one focal and one gauge): on 21 tracks with THESE tiles the
 * board closes at six rows two ways and at nine rows only with a 3×3 viewer.
 * Of the two six-row boards, a 21×1 strip forces the floor tile to 8×2 —
 * five floors of ten, which is what edkjo saw as the "squished floor chart"
 * — and a 13×1 strip leaves the other eight tracks of row 1 to the floor
 * tile, making it 8×3 and seating ten. So the strip gives up the full width
 * and the Etasjer matrix gets the row. Band 13+8 is a sanctioned 21-track
 * decomposition, and the seven KPI cards still share ONE tile; they are
 * simply laid over 13 tracks rather than 21.
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
    ...rows(1, [["kpis", 13]]),
    ...rows(5, [["verify", 8], ["viewer", 5]]),
    ...rows(3, [["floors", 8], ["spatial", 5]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 6,
  layout: [
    ...rows(1, [["spatial", 5], ["classes", 3], ["kpis", 13]]),
    ...rows(2, [["spatial", 5], ["classes", 3], ["viewer", 5], ["verify", 8]]),
    ...rows(3, [["floors", 8], ["viewer", 5], ["verify", 8]]),
  ],
};
