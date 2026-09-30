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
 * The viewer is a canon span wide, the widest that leaves a card column and
 * fits the column's height inside 16 : 9, and takes the column's height
 * (2026-09-30: an 8 × 5 canvas left 300 to 600 px empty under it at 1920 and
 * 2112), inside the 9 : 16 to 16 : 9 bound of rule 4. What is kept under it
 * (the Typer's material row) is always there, so nothing under the canvas is
 * empty and nothing moves on a click.
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

/** A slot the board's viewer is lent into while `active` and on screen. */
export function LentViewer({
  meshBatches,
  active,
  className,
  style,
  data,
  empty,
}: {
  meshBatches: MeshBatch[] | undefined;
  active: boolean;
  className?: string;
  style?: CSSProperties;
  data?: Record<`data-${string}`, string | number | undefined>;
  /** This surface's own state word over the canvas (the Rom tab's «Ingen
   *  rom»), in place of the home tile's. */
  empty?: string | null;
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
        active && shown ? <EmptyMark text={empty ?? dock.empty} /> : null
      ) : (
        <div className="flex h-full items-center justify-center">
          <NoGeometryMark />
        </div>
      )}
    </div>
  );
}

/** The canvas in a column `roomPx` tall (the column less what is kept
 *  under it): the widest canon span leaving `keep` columns that fits the
 *  room inside 16 : 9, the column's height up to 9 : 16 (rule 4). So the
 *  canvas fills its column and nothing under it is empty (2026-09-30: 227 to
 *  249 px empty under the Typer viewer). By the window alone. */
export function viewerBox(grid: TabGrid, keep: number, roomPx: number): { span: Wh; width: number; height: number } {
  const fits = VIEWER_SIZES.filter(([w]) => grid.cols - w >= keep);
  const pick = fits.find(([w]) => mgSpanPx(w, grid.u) / CANVAS_ASPECT.max <= roomPx) ?? fits[fits.length - 1] ?? [2, 2];
  const width = mgSpanPx(pick[0], grid.u);
  const height = Math.floor(Math.max(width / CANVAS_ASPECT.max, Math.min(roomPx, width / CANVAS_ASPECT.min)));
  return { span: pick, width, height };
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
   *  Typer's one row of 2 × 2 material cards. The row is always there and
   *  takes the rest of the column, drawn empty until a type is chosen. */
  underRows?: number;
}) {
  const { ref, grid } = useTabGrid<HTMLDivElement>();
  // The column less the canvas's top margin and a gap under it; the rows
  // kept for `under` with their gallery's padding. One card column (2
  // modules) is kept for the gallery beside.
  const room = grid ? grid.height - 2 * MG_GAP - (underRows > 0 ? mgSpanPx(underRows, grid.u) + MG_GAP : 0) : 0;
  const box = grid ? viewerBox(grid, 2, room) : null;
  const [w, h] = box ? box.span : [0, 0];
  const canvasW = box ? box.width : 0;
  const canvasH = box ? box.height : 0;
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
          {underRows > 0 ? (
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ width: mgSpanPx(w, grid.u) + 2 * MG_GAP, marginLeft: -MG_GAP }}
              data-under-viewer={under ? "" : "empty"}
            >
              {under ?? <div className="min-h-0 flex-1 rounded-[10px] bg-panel" style={{ margin: MG_GAP }} />}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
