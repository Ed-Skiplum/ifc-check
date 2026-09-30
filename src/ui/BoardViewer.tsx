/** The board's ONE 3D viewer beside a gallery (Typer, Materialer), and the
 *  grid both are laid out on (2026-09-28).
 *
 * Owner: *"you didnt add a viewer to my types and materials dash."* The
 * viewer is the board's own scene, lent through `viewer/dock.ts` as the Graf
 * tab lends it: one WebGL context, one copy of the model, one selection. When
 * the tab hides, its slot measures 0 × 0 and the canvas goes back to its tile.
 *
 * The grid is the layout canon's (`resources/design-system/data-workspace.md`,
 * LAYOUT SYSTEM), rule 6 on the tab's own box with the gallery's 16 px
 * padding as the margin, so the gallery beside the viewer lands on the same
 * columns (its own rule-6 pass over the narrower width gives the same module).
 * The viewer is an XL tile's width, 8 modules where that still leaves a card
 * column, else 6, and takes the column's height (2026-09-30: an 8 × 5 canvas
 * left 300 to 600 px empty under it at 1920 and 2112), inside the 9 : 16 to
 * 16 : 9 bound of rule 4.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { MeshBatch } from "../viewer/mesh-stream";
import { findDock, lend, onDocksChanged } from "../viewer/dock";
import { MG_GAP, MG_MODULE, mgSpanPx, type Wh } from "./alt/module-grid";
import { CANVAS_ASPECT } from "./canvas-aspect";
import { NoGeometryMark } from "./Gallery";
import { EmptyMark } from "../viewer/ViewerTile";

export interface TabGrid {
  cols: number;
  u: number;
  rows: number;
  /** The box's own height, px. */
  height: number;
}

/** Rule 6 on an element's own box, its margin the gallery's 16 px padding. */
export function useTabGrid<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [grid, setGrid] = useState<TabGrid | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      const cols = Math.max(1, Math.round((w - MG_GAP) / (MG_MODULE + MG_GAP)));
      const u = (w - 2 * MG_GAP - (cols - 1) * MG_GAP) / cols;
      const rows = Math.max(1, Math.floor((h - MG_GAP) / (u + MG_GAP)));
      setGrid((prev) =>
        prev && prev.cols === cols && prev.rows === rows && Math.abs(prev.u - u) < 0.01 && prev.height === h
          ? prev
          : { cols, u, rows, height: h },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, grid };
}

const VIEWER_SIZES: readonly Wh[] = [
  [8, 5],
  [6, 4],
  [4, 3],
  [3, 2],
  [2, 2],
];

/** The largest canon viewer size that fits the rows and leaves `keep`
 *  columns beside it. */
export function viewerSpan(grid: TabGrid, keep: number): Wh {
  return VIEWER_SIZES.find(([w, h]) => grid.cols - w >= keep && h <= grid.rows) ?? [2, 2];
}

/** A slot the board's viewer is lent into while `active` and on screen. */
export function LentViewer({
  meshBatches,
  active,
  className,
  style,
  data,
}: {
  meshBatches: MeshBatch[] | undefined;
  active: boolean;
  className?: string;
  style?: CSSProperties;
  data?: Record<`data-${string}`, string | number | undefined>;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [, bumpDocks] = useState(0);
  useEffect(() => onDocksChanged(() => bumpDocks((k) => k + 1)), []);
  const dock = findDock(meshBatches);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    // The observer reports once on observe, so no synchronous first call.
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setShown(r.width > 0 && r.height > 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!dock || !el || !shown || !active) return;
    return lend(dock, el);
  }, [dock, shown, active]);

  return (
    <div
      ref={slot}
      data-board-viewer={active && dock && shown ? "lent" : ""}
      className={"relative min-h-0 min-w-0 overflow-hidden rounded-[10px] bg-panel " + (className ?? "")}
      style={style}
      {...data}
    >
      {dock ? (
        active && shown ? <EmptyMark text={dock.empty} /> : null
      ) : (
        <div className="flex h-full items-center justify-center">
          <NoGeometryMark />
        </div>
      )}
    </div>
  );
}

/** The canvas height in a column `columnPx` tall at `widthPx` wide: the
 *  column's, less `reservePx` under it, inside 9 : 16 to 16 : 9 (rule 4); never
 *  under `leastPx`. */
export function viewerHeight(widthPx: number, columnPx: number, reservePx: number, leastPx: number): number {
  const room = columnPx - reservePx;
  const tallest = widthPx / CANVAS_ASPECT.min;
  const lowest = widthPx / CANVAS_ASPECT.max;
  return Math.floor(Math.max(leastPx, lowest, Math.min(room, tallest)));
}

/** A gallery with the viewer beside it on the tab's grid. The gallery scrolls
 *  in its own area; the tab never makes the page scroll. */
export function WithViewer({
  meshBatches,
  active,
  children,
  under,
  underRows = 0,
}: {
  meshBatches: MeshBatch[] | undefined;
  /** False while something else holds the viewer (the full type view). */
  active: boolean;
  children: ReactNode;
  /** What fills the column under the viewer (the Typer gallery: the
   *  selected type's material cards, 2026-09-28). It gets the viewer's width
   *  plus the gallery padding on each side, so a `Gallery` inside lands its
   *  cards on the viewer's own module, and scrolls inside itself. */
  under?: ReactNode;
  /** Rows kept under the viewer for `under`, whether it holds anything or
   *  not, so the canvas does not resize on a click (STABLE LAYOUT): the
   *  Typer's one row of 2 × 2 material cards. */
  underRows?: number;
}) {
  const { ref, grid } = useTabGrid<HTMLDivElement>();
  // Keep one card column (2 modules) for the gallery.
  const [w, h] = grid ? viewerSpan(grid, 2) : [0, 0];
  // The column less the canvas's top margin and a gap under it; the rows
  // kept for `under` with their own gap.
  const canvasW = grid ? mgSpanPx(w, grid.u) : 0;
  const canvasH = grid
    ? viewerHeight(canvasW, grid.height - 2 * MG_GAP, underRows > 0 ? mgSpanPx(underRows, grid.u) + MG_GAP : 0, mgSpanPx(h, grid.u))
    : 0;
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1" data-tab-grid={grid ? `${grid.cols},${grid.rows},${grid.u.toFixed(2)}` : undefined}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {grid ? (
        <div className="flex min-h-0 shrink-0 flex-col" style={{ width: mgSpanPx(w, grid.u) + MG_GAP }}>
          <LentViewer
            meshBatches={meshBatches}
            active={active}
            className="shrink-0"
            style={{ width: canvasW, height: canvasH, marginTop: MG_GAP, marginRight: MG_GAP }}
            data={{ "data-viewer-span": `${w}x${h}` }}
          />
          {under ? (
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ width: mgSpanPx(w, grid.u) + 2 * MG_GAP, marginLeft: -MG_GAP }}
              data-under-viewer
            >
              {under}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
