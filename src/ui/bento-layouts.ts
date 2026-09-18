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
 * has to declare. Below the fold sit the census tiles and the storey × class
 * matrix, which are context rather than verdicts.
 *
 *   13 tracks, 13 rows (fold 8)          21 tracks, 11 rows (fold 10)
 *   ┌───────────────┬─────────┐          ┌───────────────┬─────────┬───────────────┐
 *   │ verify   8×5  │ viewer  │          │ verify   8×5  │ viewer  │ classes  8×3  │
 *   │               │  5×5    │          │               │  5×5    │               │
 *   │               │         │          │               │         ├───────────────┤
 *   ├───────────────┤         │          │               │         │ project  8×2  │
 *   │ classes  8×3  │         │          ├───────────────┼─────────┼───────────────┤
 *   │               ├─────────┤          │ storeys  8×3  │ spatial │ file     8×2  │
 *   │               │ spatial │          │               │  5×3    ├───────────────┤
 *   ├──────┬────────┼─────────┤          │               │         │      .        │
 *   │ file │ project│ storeys │          ├───────────────┴─────────┼───────────────┤
 *   │ 5×2  │  3×2   │  5×2    │          │ matrix          13×3    │      .        │
 *   ├──────┴────────┴─────────┤          └─────────────────────────┴───────────────┘
 *   │ matrix           13×3   │
 *   └─────────────────────────┘
 *
 * Every band closes on a sanctioned decomposition: 13 → 8+5, 5+3+5 and 13;
 * 21 → 8+5+8 and 13+8. The 21-track board carries an 8×4 block of structural
 * air bottom-right: with eight tiles and a 13-wide matrix there is no tiling of
 * 21×11 that closes without it, and the alternative — a 21×3 matrix — renders
 * at 7:1 against that kind's 4.0 ceiling. Air below the fold is cheaper than a
 * tile that cannot be read.
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
    ...rows(2, [["file", 5], ["project", 3], ["storeys", 5]]),
    ...rows(3, [["matrix", 13]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 11,
  layout: [
    ...rows(3, [["verify", 8], ["viewer", 5], ["classes", 8]]),
    ...rows(2, [["verify", 8], ["viewer", 5], ["project", 8]]),
    ...rows(2, [["storeys", 8], ["spatial", 5], ["file", 8]]),
    ...rows(1, [["storeys", 8], ["spatial", 5], [BENTO_EMPTY, 8]]),
    ...rows(3, [["matrix", 13], [BENTO_EMPTY, 8]]),
  ],
};
