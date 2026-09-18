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

  const vars = {
    "--bento-track": `calc(100cqw / ${divisor})`,
    "--bento-colgap": "calc(var(--bento-track) / 10)",
    "--bento-rowgap": `calc(var(--bento-colgap) * ${PHI})`,
    "--bento-pad": `calc(var(--bento-colgap) * ${PHI})`,
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
    <div data-bento-canvas className="w-full min-w-0 [container-type:inline-size]" style={vars}>
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
