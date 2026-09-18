/** Runs the bento invariants against both AUTHORED layouts, headlessly.
 *
 * `validateBentoLayout` already runs at render and throws in dev, but that only
 * fires once a browser has the board on screen with a parsed model in it. This
 * runs the same function on the same layouts from a shell, so a layout edit is
 * answered in a second rather than after a build and a drag-and-drop.
 *
 * The spans are DERIVED from the layout rectangles rather than declared here,
 * so `span-mismatch` cannot pass by coincidence and nothing needs to be kept in
 * step with `Dashboard.tsx` except each tile's kind and priority — the two
 * facts a grid cannot infer. Those are the seven lines below.
 *
 * Run:  node scripts/board-gate.mjs
 * Exit: 0 both layouts valid, 1 a layout is invalid, 2 internal.
 */

import {
  BENTO_KINDS,
  BENTO_ROW_FACTOR,
  formatBentoErrors,
  generateGridPositions,
  validateBentoLayout,
} from "../src/ui/bento-spec.ts";
import { LAYOUT_13, LAYOUT_21 } from "../src/ui/bento-layouts.ts";

/** id -> [kind, priority], mirroring `Dashboard.tsx`. Everything else about a
 *  tile is read off the layout. */
const TILES = {
  verify: ["tellTales", "P0"],
  viewer: ["viewer", "P0"],
  spatial: ["gauge", "P0"],
  classes: ["distribution", "P1"],
  file: ["readout", "P2"],
  storeys: ["roster", "P2"],
  matrix: ["matrix", "P2"],
  types: ["roster", "P2"],
};

let failed = false;

for (const definition of [LAYOUT_13, LAYOUT_21]) {
  const positions = generateGridPositions(definition.layout);
  const tiles = Object.entries(positions).map(([id, position]) => {
    const entry = TILES[id];
    if (!entry) {
      console.error(`layout names "${id}", which this gate has no kind for`);
      process.exit(2);
    }
    return {
      id,
      kind: entry[0],
      priority: entry[1],
      span: { w: position.colSpan, h: position.rowSpan },
    };
  });

  const errors = validateBentoLayout(definition, tiles);
  const rowFactor = BENTO_ROW_FACTOR[definition.cols];
  const aspects = tiles.map((tile) => {
    const ratio = tile.span.w / (tile.span.h * rowFactor);
    const { min, max } = BENTO_KINDS[tile.kind].aspect;
    return {
      id: tile.id,
      kind: tile.kind,
      span: `${tile.span.w}x${tile.span.h}`,
      ratio: Number(ratio.toFixed(3)),
      bound: `${min}..${max}`,
      ok: ratio >= min && ratio <= max,
    };
  });

  const cells = definition.rows * definition.cols;
  const air = definition.layout.flat().filter((cell) => cell === ".").length;

  console.log(`── ${definition.cols} tracks, ${definition.rows} rows`);
  console.log(`   tiles ${tiles.length} · air ${air}/${cells} cells (${((air / cells) * 100).toFixed(1)} %)`);
  console.log(`   validateBentoLayout: ${errors.length === 0 ? "clean" : "FAILED"}`);
  if (errors.length > 0) {
    failed = true;
    console.log(formatBentoErrors(errors).split("\n").map((line) => `     ${line}`).join("\n"));
  }
  // Every tile, pass or fail. A section that prints only on failure cannot be
  // told apart from a section that never ran, and "zero aspect warnings" is a
  // claim someone has to be able to check.
  const warns = aspects.filter((aspect) => !aspect.ok).length;
  console.log(`   aspect: ${warns === 0 ? "clean" : `${warns} WARN`}`);
  for (const aspect of aspects) {
    console.log(
      `     ${aspect.ok ? "ok  " : "WARN"} ${aspect.id.padEnd(8)} ${aspect.kind.padEnd(12)} ` +
        `${aspect.span.padEnd(5)} ${String(aspect.ratio).padEnd(6)}:1  bound ${aspect.bound}`,
    );
  }
}

// Aspect findings are reported, not fatal: they are the kind registry's bounds
// against this board's spans, and some of them predate this board.
process.exit(failed ? 1 : 0);
