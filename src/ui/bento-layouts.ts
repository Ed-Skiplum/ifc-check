/** The two AUTHORED layouts of the model board. Never one reflowed.
 *
 * 13 tracks (8 + 5) for 13"–24"; 21 tracks (13 + 8) for 27"–32". Which one
 * renders is decided by `useBentoCols` against the GRID's own inline size, not
 * the viewport — ifc-check runs inside an iframe on skiplum.com, where a
 * viewport unit measures the host page's box.
 *
 * ── The composition, and why it is this one ──────────────────────────────
 * The focal is the VERIFICATION block, top-left: the eleven universal checks
 * with the value each one found. That is the ruling this board exists to
 * implement — the first screen gives feedback.
 *
 * Beside it, on both canvases, is the MODEL. 3D is folded into the board as a
 * tile rather than given a mode of its own, and at 5×5 it is the second-largest
 * thing on the screen after the focal — the two of them form the top band, so
 * "what is wrong" and "which objects" are read side by side without a click.
 * A row click narrows the model; it never navigates anywhere and never moves
 * the camera.
 *
 * The gauge is the spatial chain, the one target on the screen that no project
 * has to declare. Then the census tiles, and last the storey × class matrix,
 * which is context rather than a verdict.
 *
 *   13 tracks × 13 rows          21 tracks × 8 rows
 *   1 . . . . . . . . . . 13     1 . . . . . . . . . . . . . . . . . . . 21
 *   V V V V V V V V M M M M M    V V V V V V V V M M M M M C C C C C C C C   1
 *   V V V V V V V V M M M M M    V V V V V V V V M M M M M C C C C C C C C   2
 *   V V V V V V V V M M M M M    V V V V V V V V M M M M M S S S S S S S S   3
 *   V V V V V V V V M M M M M    V V V V V V V V M M M M M S S S S S S S S   4
 *   V V V V V V V V M M M M M    V V V V V V V V M M M M M S S S S S S S S   5
 *   C C C C C C C C G G G G G    G G G G G F F F X X X X X X X X X X X X X   6
 *   C C C C C C C C G G G G G    G G G G G F F F X X X X X X X X X X X X X   7
 *   C C C C C C C C G G G G G    G G G G G . . . X X X X X X X X X X X X X   8
 *   . . . S S S S S F F F F F
 *   . . . S S S S S F F F F F      V verify  8×5   M viewer  5×5
 *   X X X X X X X X X X X X X      C classes       G spatial 5×3
 *   X X X X X X X X X X X X X      S storeys       F file
 *   X X X X X X X X X X X X X      X matrix 13×3   . structural air
 *
 * Every band closes on a sanctioned decomposition: 13 → 8+5, 3+5+5 and 13;
 * 21 → 8+5+8 and 5+3+13 (the 5|6, 8|9 and 13|14 cuts of 5+8+8, 8+5+8 and 13+8).
 *
 * ── Why the 21-track board is SHORTER than the 13-track one ─────────────
 * Because a wider canvas carries more per row. The same seven tiles close in 8
 * rows on 21 tracks and need 13 on 13 tracks, and the grid fits the box by
 * ROW COUNT (see `BentoGrid`), so the wide board's track comes out far larger
 * — which is right for the screen it is chosen on.
 *
 * ── The air, and where it is ─────────────────────────────────────────────
 * 13 tracks: a 3×2 notch at the left edge of the storeys band (6 of 169 cells,
 * 3.6 %). 21 tracks: a 3×1 notch on the bottom edge under the file readout
 * (3 of 168 cells, 1.8 %). Both are gutter-scale steps in an edge. The 8×4
 * block this replaces on the 21-track board was 13.9 % of the canvas and read
 * as a void, which is the thing air is not allowed to do.
 *
 * The layouts are checked against all of that at render by
 * `validateBentoLayout`, so a typo here is a loud failure rather than a quietly
 * wrong board.
 */

// Explicit `.ts` so `scripts/board-gate.mjs` can import this straight into
// Node, which resolves ESM specifiers literally and has no bundler to guess
// the extension for it.
import { BENTO_EMPTY, type BentoLayoutDefinition } from "./bento-spec.ts";

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
  rows: 13,
  layout: [
    ...rows(5, [["verify", 8], ["viewer", 5]]),
    ...rows(3, [["classes", 8], ["spatial", 5]]),
    ...rows(2, [[BENTO_EMPTY, 3], ["storeys", 5], ["file", 5]]),
    ...rows(3, [["matrix", 13]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 8,
  layout: [
    ...rows(2, [["verify", 8], ["viewer", 5], ["classes", 8]]),
    ...rows(3, [["verify", 8], ["viewer", 5], ["storeys", 8]]),
    ...rows(2, [["spatial", 5], ["file", 3], ["matrix", 13]]),
    ...rows(1, [["spatial", 5], [BENTO_EMPTY, 3], ["matrix", 13]]),
  ],
};
