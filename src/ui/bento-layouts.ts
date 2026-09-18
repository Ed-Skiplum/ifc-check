/** The two AUTHORED layouts of the model board. Never one reflowed.
 *
 * 13 tracks (8 + 5) for 13"–24"; 21 tracks (13 + 8) for 27"–32". Which one
 * renders is decided by `useBentoCols` against the GRID's own inline size, not
 * the viewport — ifc-check runs inside an iframe on skiplum.com, where a
 * viewport unit measures the host page's box.
 *
 * ── The composition, and why it is this one ──────────────────────────────
 * The focal is the VERIFICATION block, top-left, rows 1–5: the eleven
 * universal checks with the value each one found. That is the ruling this
 * board exists to implement — the first screen gives feedback, and the counts
 * are the context underneath it, not the lead.
 *
 * The gauge is the spatial chain, the one target on the screen that no project
 * has to declare. Then the file's own facts, the class census and the storeys
 * fill the rest of the fold; the storey × class matrix takes the first band
 * below it. Eye path is a Z, P0 and P1 never below the fold.
 *
 *   13 tracks, 11 rows (fold 8)          21 tracks, 8 rows (fold 10)
 *   ┌───────────────┬─────────┐          ┌───────────────┬─────────┬───────────────┐
 *   │ verify   8×5  │ spatial │          │ verify   8×5  │ spatial │ project  8×2  │
 *   │               │  5×3    │          │               │  5×3    ├───────────────┤
 *   │               ├─────────┤          │               ├─────────┤ classes  8×3  │
 *   │               │ file 5×2│          │               │ file 5×2│               │
 *   ├───────────────┼─────────┤          ├───────────────┴─────────┼───────────────┤
 *   │ classes  8×3  │ storeys │          │ matrix          13×3    │ storeys  8×3  │
 *   │               │  5×2    │          └─────────────────────────┴───────────────┘
 *   │               ├─────────┤
 *   │               │proj 5×1 │
 *   ├───────────────┴─────────┤
 *   │ matrix           13×3   │
 *   └─────────────────────────┘
 *
 * Every band closes: 13 → 8+5 and 13; 21 → 8+5+8 and 13+8. Every tile starts
 * and ends on a band cut. The layouts are checked against all of that at
 * render by `validateBentoLayout`, so a typo here is a loud failure rather
 * than a quietly wrong board.
 */

import type { BentoLayoutDefinition } from "./bento-spec";

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
  rows: 11,
  layout: [
    ...rows(3, [["verify", 8], ["spatial", 5]]),
    ...rows(2, [["verify", 8], ["file", 5]]),
    ...rows(2, [["classes", 8], ["storeys", 5]]),
    ...rows(1, [["classes", 8], ["project", 5]]),
    ...rows(3, [["matrix", 13]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 8,
  layout: [
    ...rows(2, [["verify", 8], ["spatial", 5], ["project", 8]]),
    ...rows(1, [["verify", 8], ["spatial", 5], ["classes", 8]]),
    ...rows(2, [["verify", 8], ["file", 5], ["classes", 8]]),
    ...rows(3, [["matrix", 13], ["storeys", 8]]),
  ],
};
