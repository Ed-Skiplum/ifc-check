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
 * Both layouts are the Kontroll tab's; the Innhold tab is a flow surface, not
 * a bento, and has nothing for this gate to check.
 *
 * Run:  node scripts/board-gate.mjs
 * Exit: 0 both layouts valid, 1 a layout is invalid, 2 internal.
 */

import {
  BENTO_KINDS,
  BENTO_ROW_FACTOR,
  BENTO_STRIP_ASPECT_MAX,
  bentoSpanClass,
  formatBentoErrors,
  generateGridPositions,
  validateBentoLayout,
} from "../src/ui/bento-spec.ts";
import { LAYOUT_13, LAYOUT_21 } from "../src/ui/bento-layouts.ts";

/** id -> [kind, priority], mirroring `Dashboard.tsx` (tab 1, Kontroll).
 *  Everything else about a tile is read off the layout. Air (".") is not a
 *  tile. */
const TILES = {
  kpis: ["tellTales", "P0"],
  verify: ["tellTales", "P0"],
  viewer: ["viewer", "P0"],
  // On 13 tracks the board is 9 rows against an 8-row fold, so the two tiles
  // in the last band are P2 there (see `bento-layouts.ts`). Keyed per canvas.
  spatial: ["gauge", { 13: "P2", 21: "P0" }],
  floors: ["roster", { 13: "P2", 21: "P1" }],
  // 21 tracks only.
  classes: ["distribution", "P1"],
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
      priority: typeof entry[1] === "string" ? entry[1] : entry[1][definition.cols],
      span: { w: position.colSpan, h: position.rowSpan },
    };
  });

  const errors = validateBentoLayout(definition, tiles);
  const rowFactor = BENTO_ROW_FACTOR[definition.cols];
  const aspects = tiles.map((tile) => {
    const ratio = tile.span.w / (tile.span.h * rowFactor);
    const { min } = BENTO_KINDS[tile.kind].aspect;
    // A strip-class span is checked against the strip ceiling, as the spec
    // states at BENTO_STRIP_ASPECT_MAX ("a strip IS a wide thin band").
    const max =
      bentoSpanClass(tile.span) === "strip"
        ? BENTO_STRIP_ASPECT_MAX
        : BENTO_KINDS[tile.kind].aspect.max;
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

  console.log(`── tab 1 (Kontroll) · ${definition.cols} tracks, ${definition.rows} rows`);
  console.log(`   tiles ${tiles.length} · air ${air}/${cells} cells (${((air / cells) * 100).toFixed(1)} %)`);
  console.log(`   validateBentoLayout: ${errors.length === 0 ? "clean" : "FAILED"}`);
  if (errors.length > 0) {
    failed = true;
    console.log(formatBentoErrors(errors).split("\n").map((line) => `     ${line}`).join("\n"));
  }
  // Every kind the layout's tiles use must exist in the registry, and no
  // tile may still be a `matrix`: that kind is back to its upstream spans.
  for (const tile of tiles) {
    if (!BENTO_KINDS[tile.kind]) {
      failed = true;
      console.log(`     unknown kind "${tile.kind}" on "${tile.id}"`);
    }
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
