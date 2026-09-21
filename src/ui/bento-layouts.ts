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
 *   K K K K K K K K K K K K K        K K K K K K K K K K K K K K K K K K K K K
 *   V V V V V V V V M M M M M        M M M M M . . . G G G G G V V V V V V V V
 *   V V V V V V V V M M M M M        M M M M M . . . G G G G G V V V V V V V V
 *   V V V V V V V V M M M M M        M M M M M . . . G G G G G V V V V V V V V
 *   V V V V V V V V M M M M M        M M M M M . . . E E E E E V V V V V V V V
 *   V V V V V V V V M M M M M        M M M M M . . . E E E E E V V V V V V V V
 *   E E E E E E E E G G G G G
 *   E E E E E E E E G G G G G        K kpis 13×1 / 21×1   V verify 8×5
 *   E E E E E E E E G G G G G        M viewer 5×5         G spatial 5×3
 *                                    E floors 8×3 / 5×2
 *
 * Bands: 13 → 13, 8+5; 21 → 21, 5|3|5|8 (the cuts of 5+8+8 and 8+5+8).
 *
 * ── The fold ──────────────────────────────────────────────────────
 * 13 tracks is 9 rows against an 8-row fold, so the floor tile and the gauge
 * end past it and are P2 there, the same concession the KPI strip forced on
 * the previous board. Whether a KPI strip should count against the fold is
 * an upstream question for sprucelab, not something to fork here. The
 * 21-track board sits inside its 10-row fold at every priority.
 *
 * ── The air ───────────────────────────────────────────────────────
 * 21 tracks leaves cols 6–8 empty for five rows (15 of 126 cells): the only
 * legal starts beside a 5-wide viewer are 6 and 9, and nothing on this tab is
 * a 3-wide tile. It is structural air by default; if it reads as a void on
 * the live site, the file readout (3×2) is the tile that fits it.
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
    ...rows(1, [["kpis", 21]]),
    ...rows(3, [["viewer", 5], [".", 3], ["spatial", 5], ["verify", 8]]),
    ...rows(2, [["viewer", 5], [".", 3], ["floors", 5], ["verify", 8]]),
  ],
};
