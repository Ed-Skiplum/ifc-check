/** The two AUTHORED layouts of the model board. Never one reflowed.
 *
 * 13 tracks (8 + 5) for 13"–24"; 21 tracks (13 + 8) for 27"–32". Which one
 * renders is decided by `useBentoCols` against the GRID's own inline size, not
 * the viewport — ifc-check runs inside an iframe on skiplum.com, where a
 * viewport unit measures the host page's box.
 *
 * ── The composition, and why it is this one ────────────────────────
 * The focal is the VERIFICATION block: the eleven universal checks with the
 * value each one found. That is the ruling this board exists to implement — the
 * first screen gives feedback.
 *
 * Beside it, on both canvases, is the MODEL. 3D is folded into the board as a
 * tile rather than given a mode of its own, and at 5×5 it is the second-largest
 * thing on the screen after the focal. A row click narrows the model; it never
 * navigates anywhere and never moves the camera.
 *
 * The gauge is the spatial chain, the one target on the screen that no project
 * has to declare. Then the census tiles — classes, storeys, and the TYPE LEDGER
 * — and last the storey × class matrix, which is context rather than a verdict.
 *
 *   13 tracks × 13 rows          21 tracks × 8 rows
 *   1 . . . . . . . . . . 13     1 . . . . . . . . . . . . . . . . . . . 21
 *   V V V V V V V V M M M M M    M M M M M C C C G G G G G V V V V V V V V   1
 *   V V V V V V V V M M M M M    M M M M M C C C G G G G G V V V V V V V V   2
 *   V V V V V V V V M M M M M    M M M M M C C C G G G G G V V V V V V V V   3
 *   V V V V V V V V M M M M M    M M M M M F F F T T T T T V V V V V V V V   4
 *   V V V V V V V V M M M M M    M M M M M F F F T T T T T V V V V V V V V   5
 *   C C C C C C C C G G G G G    S S S S S S S S X X X X X X X X X X X X X   6
 *   C C C C C C C C G G G G G    S S S S S S S S X X X X X X X X X X X X X   7
 *   C C C C C C C C G G G G G    S S S S S S S S X X X X X X X X X X X X X   8
 *   F F F T T T T T S S S S S
 *   F F F T T T T T S S S S S      V verify  8×5   M viewer  5×5
 *   X X X X X X X X X X X X X      C classes       G spatial 5×3
 *   X X X X X X X X X X X X X      S storeys       F file
 *   X X X X X X X X X X X X X      X matrix 13×3   T types
 *
 * Every band closes on a sanctioned decomposition: 13 → 8+5, 3+5+5 and 13;
 * 21 → 5+3+5+8 (the 5|6, 8|9 and 13|14 cuts of 5+8+8, 8+5+8 and 13+8) and 8+13.
 *
 * ── Adding the type ledger re-authored BOTH boards ─────────────────
 * Both were full and tightly packed — 13 tracks at 3.6 % air, 21 tracks at
 * 1.8 % — and the fit divides by the ROW COUNT (see `BentoGrid`), so buying the
 * new tile with extra rows would have shrunk every track on the board. Neither
 * board pays that here: both keep their row count exactly, and both now close at
 * ZERO air.
 *
 * 13 tracks: the 3×2 notch at the left of the storeys band was the only air on
 * the canvas, and the band was `. . . S S S S S F F F F F`. The file readout
 * moved into the notch at 3×2 — the span it already takes on the wide board,
 * and 1.58:1 against `readout`'s 0.8..3.0 — and the 5 tracks it vacated became
 * the type ledger. The band is now the same `[3, 5, 5]` decomposition with
 * nothing empty in it.
 *
 * 21 tracks: this one could not absorb a tile in place. Its old shape was five
 * rows of `verify | viewer | classes+storeys` over one full three-row band of
 * `spatial | file | matrix`, and that band is exactly full: the gauge and the
 * file readout cover 8 of 21 tracks over three rows, and the remaining 13 are
 * the only shape the matrix can take. An eighth tile therefore needed a THIRD
 * band, of which it could fill at most 8 tracks — 11 rows and 18 % air, which is
 * the void the 8×4 block was removed for. So the top region was re-cut instead.
 * The 8×5 focal moved to cols 14–21 and the viewer to cols 1–5, which opens the
 * 3-track column (6–8) and the 5-track column (9–13) underneath them — the only
 * two places a 3×2 readout and a 5×3 gauge can legally start. `classes` and
 * `file` stack in the first, `spatial` and the type ledger in the second, and
 * the bottom band becomes `storeys | matrix` at 8+13. Eight rows, zero air, and
 * `classes` at 3×3 renders 1.0:1 — inside `distribution`'s own bound, where its
 * old 8×2 read 4.0:1.
 *
 * ── Why the 21-track board is SHORTER than the 13-track one ───────────
 * Because a wider canvas carries more per row. The same eight tiles close in 8
 * rows on 21 tracks and need 13 on 13 tracks, and the grid fits the box by ROW
 * COUNT, so the wide board's track comes out far larger — which is right for the
 * screen it is chosen on.
 *
 * ── Priorities, and the fold ──────────────────────────────────
 * The type ledger is P2 on both canvases. It is a census surface, not a verdict:
 * the verdict it belongs to — `single-instance-types` — is already a row in the
 * focal, and this is where that row's 65 of 84 comes from. P2 also keeps the
 * 13-track board legal, where rows 9–10 sit past the 8-row fold and a P1 there
 * would be a `fold` fault rather than a judgement call.
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
  rows: 13,
  layout: [
    ...rows(5, [["verify", 8], ["viewer", 5]]),
    ...rows(3, [["classes", 8], ["spatial", 5]]),
    ...rows(2, [["file", 3], ["types", 5], ["storeys", 5]]),
    ...rows(3, [["matrix", 13]]),
  ],
};

export const LAYOUT_21: BentoLayoutDefinition = {
  cols: 21,
  rows: 8,
  layout: [
    ...rows(3, [["viewer", 5], ["classes", 3], ["spatial", 5], ["verify", 8]]),
    ...rows(2, [["viewer", 5], ["file", 3], ["types", 5], ["verify", 8]]),
    ...rows(3, [["storeys", 8], ["matrix", 13]]),
  ],
};
