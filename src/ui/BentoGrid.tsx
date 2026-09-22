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
  BENTO_GAP_DIVISOR,
  BENTO_MAX_WIDTH,
  BENTO_KINDS,
  BENTO_STRIP_ASPECT_MAX,
  bentoRowFactorRange,
  bentoSpanClass,
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
  /** Px of page the board may occupy before the page has to scroll, or `null`
   *  when it has not been measured yet. Surplus goes into the ROW unit, never
   *  into the track; a shortfall is ignored, because shrinking to fit is the
   *  squeeze this grid refuses. See `bentoRowFactorRange`. */
  space?: number | null;
  /** Draw the fold line. Authoring aid; never on in a shipped board. */
  debug?: boolean;
}

export function BentoGrid({ definition, tiles, space = null, debug = false }: BentoGridProps) {
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

  // The TRACK is derived from the WIDTH alone, as upstream does it
  // (2026-09-22, re-aligned). The local variant bounded it by the height too,
  // `min(100cqw / divisor, 100cqh / rows)`, so the board always fit one
  // screen. That is what made it "stunted" (edkjo): on a 16:9 or 16:10 laptop
  // the height term won, every tile shrank below its content, and the Etasjer
  // headers read "KNM…" while the focal hid its rules behind an inner
  // scrollbar. edkjo, the direction that replaced it: "a grid of tiles …
  // that way we can resize to monitor size easily as everything is
  // proportional", "bento box, not a matrix". So one module, the track,
  // derived from the grid's own width; every tile an integer number of
  // tracks; the page scrolls vertically when the board is taller than the
  // screen, and the composition changes only at the one breakpoint
  // (`BENTO_21_MIN_WIDTH`). Between breakpoints everything scales together.
  //
  // The ROW unit is the track times a factor, and THAT is where a taller
  // viewport is spent (2026-09-22, second pass). edkjo on the same board in a
  // tall window: "why the large band at the bottom and squished floor chart in
  // the middle?" — a width-derived board on a screen taller than itself left
  // the surplus as dead cream, and a two-row tile could not reach it. So the
  // row grows toward `space` until either the board covers it or the factor
  // hits the ceiling the PLACED tiles allow (`bentoRowFactorRange`). It never
  // goes below the authored factor, so nothing can be squeezed and no row can
  // be clipped; the direction of travel is the whole difference between this
  // and the rule that was reverted.
  const rowRange = bentoRowFactorRange(definition, tiles);
  const rowFactor = rowRange.min;
  const gapUnits = (definition.rows - 1) * (PHI / BENTO_GAP_DIVISOR);
  // Track-relative, so the whole ladder stays one calc chain off `100cqw`.
  const rowFloor = `calc(var(--bento-track) * ${rowRange.min})`;
  const rowCeiling = `calc(var(--bento-track) * ${rowRange.max})`;
  const rowUnit =
    space && space > 0 && rowRange.max > rowRange.min
      ? `clamp(${rowFloor}, calc((${Math.round(space)}px - var(--bento-track) * ${gapUnits.toFixed(4)}) / ${definition.rows}), ${rowCeiling})`
      : rowFloor;

  // A span that is legal on the ladder can still render as an unpleasant tile:
  // with a near-square cell a 13x1 is about 13:1. Report those in dev rather
  // than shipping them — the fix belongs in the layout, not in a runtime nudge.
  if (import.meta.env.DEV) {
    for (const spec of tiles) {
      const pos = positions[spec.id];
      if (!pos) continue;
      // The row unit travels inside `rowRange`, so a tile is widest-looking at
      // the floor and tallest-looking at the ceiling. The ceiling is DERIVED
      // from these same minima, so only the floor can break a max bound —
      // checking both ends costs nothing and keeps the warning honest if the
      // range ever gains another term.
      const aspect = pos.colSpan / (pos.rowSpan * rowFactor);
      const aspectTall = pos.colSpan / (pos.rowSpan * rowRange.max);
      // The bound belongs to the KIND: a treemap degenerates into slivers
      // outside a squarish field, a viewer stops being navigable, a ladder is a
      // band by design. A global bound would have to admit all three and so
      // would catch none of them.
      const { min } = BENTO_KINDS[spec.kind].aspect;
      // A strip-class span answers to the strip ceiling the spec declares
      // (`BENTO_STRIP_ASPECT_MAX`), not to its kind's tile bound.
      const max =
        bentoSpanClass({ w: pos.colSpan, h: pos.rowSpan }) === "strip"
          ? BENTO_STRIP_ASPECT_MAX
          : BENTO_KINDS[spec.kind].aspect.max;
      // The ceiling is computed FROM `min`, so the binding tile lands exactly
      // on its own bound and only float noise can put it under: epsilon.
      if (aspect > max + 1e-6 || aspectTall < min - 1e-6) {
        console.warn(
          `[bento] tile "${spec.id}" (${spec.kind}) renders at ${aspectTall.toFixed(2)}..${aspect.toFixed(2)}:1 — ` +
            `outside this kind's usable ${min}..${max}. Re-span it.`,
        );
      }
    }
  }

  const vars = {
    "--bento-track": `calc(100cqw / ${divisor})`,
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
    "--bento-row": rowUnit,
    // The list line: one row of a tile's list (a check, a floor, a lamp) is a
    // fixed fraction of the track, so a tile shows the SAME number of rows at
    // every size between breakpoints and its contents keep their proportions
    // instead of leaving a void under 24 px rows on a big screen. Clamped at
    // both ends like the type below.
    //
    // 0.27 → 0.25 (2026-09-22). At 0.27 the 8×3 floor tile came out ONE row
    // short of a ten-floor config at every size — 9 of 10, measured at 1440,
    // 1920 and 2112 — and a row there is a whole storey. Measured, a tile's
    // list gets its box less a header rule of about 36 px that does NOT scale
    // with the track (the drill button's own box sets it), so eleven lines of
    // 0.27 track overran by a few px at every size at once. 0.25 buys the row
    // back with about a third of a line to spare at the tightest 13-track
    // size, and it seats ten floors from 1280 px of viewport upward; below
    // that the 20 px clamp floor holds the row legible and the rest scrolls.
    // The 8×5 focal gains rows it does not need, which is the right direction
    // for the tile that grows a "Regler" row per project rule.
    "--bento-line": "clamp(20px, calc(var(--bento-track) * 0.25), 36px)",
    // List type rides the line: body text at half a line, small caps and mono
    // counts at four tenths.
    "--bento-fs": "clamp(11px, calc(var(--bento-line) * 0.5), 16px)",
    "--bento-fs-sm": "clamp(9px, calc(var(--bento-line) * 0.4), 13px)",
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
      // What the height flex was allowed to do, published for the viewport
      // gate: it asserts that a board shorter than its space is a board whose
      // row unit is already at its ceiling, never a board that left the height
      // unused. Numbers, not a verdict — the gate does the judging.
      data-bento-cols={definition.cols}
      data-bento-rows={definition.rows}
      data-bento-row-range={`${rowRange.min}:${rowRange.max.toFixed(4)}`}
      data-bento-space={space && space > 0 ? Math.round(space) : ""}
      // `inline-size` containment: `100cqw` is this grid's width, and the
      // grid takes its height from its rows, never from its parent. The page
      // scrolls when the board is taller than the screen.
      className="w-full min-w-0 [container-type:inline-size]"
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
    <span
      data-essential
      className="truncate text-[length:var(--bento-label,10px)] font-semibold tracking-[0.12em] text-gold uppercase"
    >
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
          <span className="ml-auto shrink-0 font-mono text-[length:var(--bento-label,10px)] tabular-nums text-muted">
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
