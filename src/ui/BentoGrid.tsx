/** BENTO GRID — the ONE dashboard composition primitive, mirrored here.
 *
 * Mirror of `sprucelab/frontend/src/components/Layout/BentoGrid.tsx`; the
 * model and the invariants live in `./bento-spec.ts`. See that file's header
 * for why this is a copy rather than an import, and for the two registry
 * deviations. The chrome is ifc-check's own (`Instrument`, `MicroLabel` and
 * `QueryError` are sprucelab components and do not exist here), built from the
 * same ATELIER tokens: cream base, forest primary, gold section labels, ink.
 *
 * ── Why the rows are SQUARE, and why they are computed in CSS ────────────
 * The base cell is square: row unit = track width, and the track width is a
 * pure function of the container width,
 *
 *   track = W / (cols + (cols − 1)/10)        (because colGap = track/10)
 *
 * which container-query units express directly — `100cqw` is the container's
 * inline size, so the whole ladder (track → colGap → rowGap → padding → row)
 * falls out of one `calc` chain with no measurement pass and no resize
 * listener. A JS-measured grid is correct on the SECOND paint; this one is
 * correct on the first.
 *
 * The container, not the viewport, is what it measures. ifc-check runs inside
 * an iframe on skiplum.com, where a `vw` unit measures the host page's box —
 * the grid module this replaced used `13vw` and was wrong there by
 * construction.
 *
 * ── Failure is loud ──────────────────────────────────────────────────────
 * Every invariant is checked at render. In dev the component THROWS with the
 * whole list; in prod each faulty tile renders an error tile in its own slot
 * and canvas-wide faults render above the grid. There is no silent reflow and
 * no fabricated layout — a broken board says it is broken.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  BENTO_FOLD_ROWS,
  BENTO_MAX_WIDTH,
  BENTO_ROW_FACTOR,
  BENTO_KINDS,
  PHI,
  bentoTrackDivisor,
  formatBentoErrors,
  generateGridPositions,
  validateBentoLayout,
  type BentoLayoutDefinition,
  type BentoTileSpec,
  type BentoValidationError,
  type GridPosition,
} from "./bento-spec";

/**
 * A browser without container queries silently resolves `100cqw` to nothing,
 * `gridAutoRows` collapses to content height, and the board renders as a stack
 * of ragged boxes that still LOOKS like a dashboard. That is precisely the
 * plausible-but-wrong failure this codebase refuses, so the capability is
 * asserted rather than assumed. Environments with no `CSS` object (SSR, jsdom)
 * are not browsers and are not evidence either way.
 */
function containerQueriesUnsupported(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return !CSS.supports("width: 1cqw");
}

const CQ_MESSAGE =
  "BentoGrid needs CSS container queries (`1cqw`): every track, gap and row " +
  "height is derived from the container inline size. This browser reports no " +
  "support, so the grid would size its rows from content instead.";

export interface BentoGridProps {
  definition: BentoLayoutDefinition;
  tiles: BentoTileSpec[];
  /** Draw the fold line. Authoring aid; never on in a shipped board. */
  debug?: boolean;
}

export function BentoGrid({ definition, tiles, debug = false }: BentoGridProps) {
  const errors = validateBentoLayout(definition, tiles);
  const noContainerQueries = containerQueriesUnsupported();

  // Dev: stop the author at the point of the mistake, with every fault at
  // once. Prod: never take a user's dashboard away over a layout bug — render
  // it and say exactly what is wrong, in place.
  if (errors.length > 0 && import.meta.env.DEV) {
    throw new Error(
      `BentoGrid — invalid layout (${definition.cols} tracks):\n${formatBentoErrors(errors)}`,
    );
  }
  if (noContainerQueries && import.meta.env.DEV) throw new Error(CQ_MESSAGE);

  const positions = generateGridPositions(definition.layout);
  const canvasErrors = errors.filter((e) => !e.tileId);
  const tileErrors = new Map<string, BentoValidationError[]>();
  for (const e of errors) {
    if (!e.tileId) continue;
    tileErrors.set(e.tileId, [...(tileErrors.get(e.tileId) ?? []), e]);
  }

  const divisor = bentoTrackDivisor(definition.cols);
  const fold = BENTO_FOLD_ROWS[definition.cols];

  // The track is bounded by BOTH axes.
  //
  // Upstream derives the track from width alone and lets the fold budget
  // scroll. Here the dashboard has to FIT its box: the owner asked twice for
  // the grid to scale to the viewport, and a board that runs off the bottom is
  // the thing he was pointing at. So the track is the SMALLER of what the width
  // affords and what the height affords, which keeps the cell square and the
  // span ladder intact.
  //
  // It divides by the layout's ACTUAL row count, not by `fold`. Dividing by
  // `fold` sizes the track so that the first `fold` rows fill the box, which
  // means every row past the fold is outside it — on the 13-track board that
  // was rows 9..13, and the storey x class matrix lives in 11..13, so the
  // densest tile on the canvas could not be seen at all. The alternative was
  // to author both boards within the fold, and on 13 tracks that is
  // arithmetically impossible: 8 rows is 104 cells, and the smallest legal
  // set of these seven tiles is 126 (focal 8x5 = 40, one gauge 5x3 = 15,
  // viewer 3x3 = 9, distribution 3x3 = 9, roster 5x2 = 10, readout 2x2 = 4,
  // matrix 13x3 = 39). A board that cannot be authored is not a board.
  //
  // `fold` keeps the job the spec gives it — "P0/P1 never live below this
  // line" — and `validateBentoLayout` still enforces exactly that. It is a
  // reading-order rule; it is no longer the number the fit divides by.
  //
  // Heights are all multiples of the track — row = track x rowFactor and
  // rowGap = track x PHI/10 — so `rows` rows occupy
  //   track x (rows x rowFactor + (rows - 1) x PHI/10)
  // and inverting that gives the height-afforded track below.
  const rowFactor = BENTO_ROW_FACTOR[definition.cols];
  const heightDivisor =
    definition.rows * rowFactor + ((definition.rows - 1) * PHI) / 10;

  // A span that is legal on the ladder can still render as an unpleasant tile:
  // with a near-square cell a 13x1 is about 13:1. Report those in dev rather
  // than shipping them — the fix belongs in the layout, not in a runtime nudge.
  if (import.meta.env.DEV) {
    for (const spec of tiles) {
      const pos = positions[spec.id];
      if (!pos) continue;
      const aspect = pos.colSpan / (pos.rowSpan * rowFactor);
      // The bound belongs to the KIND: a treemap degenerates into slivers
      // outside a squarish field, a viewer stops being navigable, a ladder is a
      // band by design. A global bound would have to admit all three and so
      // would catch none of them.
      const { min, max } = BENTO_KINDS[spec.kind].aspect;
      if (aspect > max || aspect < min) {
        console.warn(
          `[bento] tile "${spec.id}" (${spec.kind}) renders at ${aspect.toFixed(2)}:1 — ` +
            `outside this kind's usable ${min}..${max}. Re-span it.`,
        );
      }
    }
  }

  const vars = {
    // `100cqh` needs `container-type: size`, which in turn needs a definite
    // height on this box — see the wrapper below.
    "--bento-track": `min(calc(100cqw / ${divisor}), calc(100cqh / ${heightDivisor.toFixed(4)}))`,
    "--bento-colgap": "calc(var(--bento-track) / 10)",
    "--bento-rowgap": `calc(var(--bento-colgap) * ${PHI})`,
    "--bento-pad": `calc(var(--bento-colgap) * ${PHI})`,
    // Content sizes WITH the tile. The track is the one length everything else
    // derives from, so type derives from it too — otherwise a grid that halves
    // its track keeps 13px labels and the tile stops being legible as a
    // composition. Clamped at both ends: below the floor text stops being
    // readable, above the ceiling a single stat inflates into a poster.
    "--bento-label": "clamp(9px, calc(var(--bento-track) * 0.085), 12px)",
    "--bento-text": "clamp(11px, calc(var(--bento-track) * 0.105), 15px)",
    "--bento-value": "clamp(17px, calc(var(--bento-track) * 0.32), 42px)",
    "--bento-row": `calc(var(--bento-track) * ${BENTO_ROW_FACTOR[definition.cols]})`,
    // The convergence cap lands on the CONTAINER-QUERY ROOT on purpose:
    // `100cqw` reads whatever box carries `container-type`, so capping
    // anywhere else would leave the track ladder measuring the uncapped width
    // and every tile would overflow its slot.
    maxWidth: BENTO_MAX_WIDTH,
    marginInline: "auto",
  } as CSSProperties;

  return (
    // `container-type: inline-size` is what makes `100cqw` mean "this grid's
    // width". Without it the whole ladder silently measures the viewport.
    <div
      data-bento-canvas
      // `container-type: size` rather than `inline-size`: the track ladder now
      // reads `100cqh` as well as `100cqw`, and only size containment resolves
      // the block axis. It also means this box takes its height from its parent
      // and never from its content, so the parent chain must hand it one.
      // Centred on BOTH axes. `margin-inline: auto` only ever balanced the
      // horizontal, so a grid shorter than its box left the whole remainder as
      // dead space at the bottom — the owner's "large empty spaces at the
      // bottom or wherever". Flex centring splits the leftover on each axis, so
      // what is left over reads as margin rather than as a void.
      className="flex h-full w-full min-w-0 items-center justify-center [container-type:size]"
      style={vars}
    >
      {canvasErrors.length > 0 || noContainerQueries ? (
        <div className="mb-[var(--bento-rowgap)] flex flex-col gap-1">
          {noContainerQueries ? <CanvasError>{CQ_MESSAGE}</CanvasError> : null}
          {canvasErrors.map((e) => (
            <CanvasError key={`${e.code}-${e.message}`}>{`[${e.code}] ${e.message}`}</CanvasError>
          ))}
        </div>
      ) : null}
      <div
        className="relative grid w-full min-w-0"
        style={{
          gridTemplateColumns: `repeat(${definition.cols}, minmax(0, 1fr))`,
          gridAutoRows: "var(--bento-row)",
          columnGap: "var(--bento-colgap)",
          rowGap: "var(--bento-rowgap)",
        }}
      >
        {tiles.map((spec) => {
          const position = positions[spec.id];
          if (!position) return null;
          const faults = tileErrors.get(spec.id);
          return faults && faults.length > 0 ? (
            <BentoErrorTile key={spec.id} id={spec.id} errors={faults} position={position} />
          ) : (
            <BentoTile key={spec.id} spec={spec} position={position} />
          );
        })}
        {debug && definition.rows > fold ? <FoldLine row={fold + 1} /> : null}
      </div>
    </div>
  );
}

function placement(position: GridPosition): CSSProperties {
  return { gridColumn: position.gridColumn, gridRow: position.gridRow };
}

/** Small-caps, high-letter-spacing section label — the house micro-label. */
export function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
      {children}
    </span>
  );
}

function CanvasError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="m-0 bg-bad px-2.5 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap text-cream"
    >
      {children}
    </p>
  );
}

/**
 * Tile chrome, height fixed by the span, clipping its own overflow.
 *
 * A 1-row strip gets the BARE frame: at one row there is no height for a
 * header rule, so the label rides inline in the row. That is a rule derived
 * from the span, not a per-tile special case.
 */
function BentoTile({ spec, position }: { spec: BentoTileSpec; position: GridPosition }) {
  const bare = spec.span.h === 1;
  const body = spec.status ? <TileStatus status={spec.status} /> : spec.body;
  const drill = spec.click?.drill ? <TileDrill {...spec.click.drill} /> : null;

  if (bare) {
    return (
      <section
        data-tile-id={spec.id}
        style={placement(position)}
        className="flex h-full min-h-0 min-w-0 items-center gap-[var(--bento-pad)] overflow-hidden border border-line bg-panel px-[var(--bento-pad)]"
      >
        {spec.label ? <MicroLabel>{spec.label}</MicroLabel> : null}
        {body}
        {drill}
      </section>
    );
  }

  return (
    <section
      data-tile-id={spec.id}
      style={placement(position)}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel"
    >
      <div className="flex shrink-0 items-baseline gap-2 px-[var(--bento-pad)] pt-1.5 pb-1">
        <MicroLabel>{spec.label}</MicroLabel>
        {spec.sub ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">
            {spec.sub}
          </span>
        ) : null}
        {drill ? <span className={spec.sub ? "shrink-0" : "ml-auto shrink-0"}>{drill}</span> : null}
      </div>
      {body}
    </section>
  );
}

/**
 * The door. An arrow and nothing else: the destination is named in the
 * accessible name and the tooltip, so a board gains a drill without gaining a
 * line of copy. It is a real `<button>` rather than the whole tile so a roster
 * row or a matrix cell inside can stay interactive too.
 */
function TileDrill({ label, run }: { label: string; run: () => void }) {
  return (
    <button
      type="button"
      onClick={run}
      title={label}
      aria-label={label}
      className="inline-flex h-[1.35em] w-[1.35em] shrink-0 items-center justify-center text-[13px] font-semibold text-muted hover:bg-palegreen hover:text-green focus-visible:outline-2 focus-visible:outline-ink"
    >
      <span aria-hidden>→</span>
    </button>
  );
}

/** No data to draw — said in the tile's own rectangle, never as a calm zero. */
function TileStatus({ status }: { status: NonNullable<BentoTileSpec["status"]> }) {
  if (status.kind === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center px-[var(--bento-pad)] pb-[var(--bento-pad)]">
        <span className="bg-bad px-2 py-0.5 font-mono text-[11px] text-cream">
          {status.message}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center px-[var(--bento-pad)] pb-[var(--bento-pad)]">
      <span className="font-mono text-[11px] text-muted">{status.message}</span>
    </div>
  );
}

/** The prod failure affordance: the tile's own slot, occupied and loud. */
function BentoErrorTile({
  id,
  errors,
  position,
}: {
  id: string;
  errors: BentoValidationError[];
  position: GridPosition;
}) {
  return (
    <section
      data-tile-id={id}
      role="alert"
      style={placement(position)}
      className="flex h-full min-h-0 min-w-0 flex-col justify-center gap-1 overflow-auto bg-bad p-[var(--bento-pad)] text-cream"
    >
      <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">{id}</span>
      {errors.map((e) => (
        <span key={e.code} className="font-mono text-[11px] leading-snug">
          [{e.code}] {e.message}
        </span>
      ))}
    </section>
  );
}

/** The fold: everything above it is visible without scrolling. */
function FoldLine({ row }: { row: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative -mt-[calc(var(--bento-rowgap)/2)] h-0 self-start border-t border-dashed border-muted"
      style={{ gridColumn: "1 / -1", gridRow: row }}
    />
  );
}
