/** Modell: the board's one 3D viewer and one panel for the selected object
 *  (edkjo 2026-09-30: *"a tab with a pure viewer with only a side panel for
 *  type and instance data of the selected objects. Psets as tabbed 'ears' and
 *  main IFC attributes in the default view"*).
 *
 * The viewer is the board's own scene, lent through `viewer/dock.ts` as the
 * other tabs lend it, so picking, Esc, double-click framing and the teal mark
 * are the scene's own and the selection is the panel's one selection.
 *
 * ── Layout ───────────────────────────────────────────────────────────────
 * Two tiles on the window's module grid (`useModuleGrid`, rule 6), both the
 * full height: the viewer left, the panel right. The panel's width in modules
 * is a function of the grid alone (`modelTiles`), never of the selection
 * (STABLE LAYOUT): the smallest width from a floor of about a quarter of the
 * columns at which the viewer is at most 16 : 9 and the panel at least 1 : 2.
 * Where no width gets the viewer inside 9 : 16 to 16 : 9 (a narrow window),
 * the canvas takes the largest in-bound box inside its area, centred.
 *
 * ── The panel ────────────────────────────────────────────────────────────
 * `ObjectPanel`, the one object panel of the app (2026-09-30, OBJECT PANEL IS
 * TABBED): the same themes and set ears as the Detail dock and the foot band.
 */

import type { Lang } from "./i18n";
import type { ModelEntry } from "./useModels";
import type { ModelView } from "./cross-filter";
import { LentViewer } from "./BoardViewer";
import { ObjectPanel } from "./ObjectPanel";
import { useModuleGrid, VARS } from "./alt/AltBoard";
import { MG_GAP, mgRow, mgSpanPx, type MgGrid } from "./alt/module-grid";
import { CANVAS_ASPECT } from "./canvas-aspect";

/* ── layout ───────────────────────────────────────────────────────────── */

export interface ModelTiles {
  /** Modules. */
  viewerCols: number;
  panelCols: number;
  /** The canvas box inside the viewer's area, px, relative to the area. */
  canvas: { left: number; top: number; width: number; height: number };
}

/** A pure function of the grid: the same window gives the same tiles. */
export function modelTiles(grid: MgGrid): ModelTiles {
  const { cols, rows, u } = grid;
  const height = rows * mgRow(grid) + (rows - 1) * MG_GAP;
  const floor = Math.min(cols - 1, Math.max(4, Math.round(cols * 0.26)));
  let panelCols = floor;
  for (let p = floor; p <= cols - 2; p += 1) {
    const viewer = mgSpanPx(cols - p, u) / height;
    const panel = mgSpanPx(p, u) / height;
    if (viewer < CANVAS_ASPECT.min) break;
    if (viewer <= CANVAS_ASPECT.max + 1e-9 && panel >= 0.5 - 1e-9) {
      panelCols = p;
      break;
    }
  }
  const viewerCols = Math.max(1, cols - panelCols);
  const areaW = mgSpanPx(viewerCols, u);
  let w = areaW;
  let h = height;
  if (w / h > CANVAS_ASPECT.max) w = Math.floor(h * CANVAS_ASPECT.max);
  else if (w / h < CANVAS_ASPECT.min) h = Math.floor(w / CANVAS_ASPECT.min);
  return {
    viewerCols,
    panelCols,
    canvas: { left: Math.floor((areaW - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h },
  };
}

/* ── the tab ──────────────────────────────────────────────────────────── */

export function ModelTab({
  lang,
  model,
  view,
  active,
}: {
  lang: Lang;
  model: ModelEntry;
  view: ModelView;
  /** The tab is on screen: the viewer is lent only then. */
  active: boolean;
}) {
  const { ref, grid } = useModuleGrid();
  const tiles = grid ? modelTiles(grid) : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS} data-model-tab>
      {grid && tiles ? (
        <div
          data-mg-grid
          data-mg-design="model"
          data-mg-cols={grid.cols}
          data-mg-rows={grid.rows}
          data-mg-u={grid.u.toFixed(4)}
          className="alt-board mx-auto grid"
          style={{
            width: grid.cols * grid.u + (grid.cols - 1) * MG_GAP,
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
            gridTemplateRows: `repeat(${grid.rows}, ${mgRow(grid)}px)`,
            gap: MG_GAP,
          }}
        >
          <div
            className="relative min-h-0 min-w-0"
            style={{ gridColumn: `1 / span ${tiles.viewerCols}`, gridRow: `1 / span ${grid.rows}` }}
          >
            <LentViewer
              meshBatches={model.meshBatches}
              active={active}
              className="absolute"
              style={tiles.canvas}
              data={{ "data-model-viewer": "" }}
            />
          </div>
          <div
            data-model-panel=""
            className="alt-card min-h-0 min-w-0 overflow-hidden"
            style={{ gridColumn: `${tiles.viewerCols + 1} / span ${tiles.panelCols}`, gridRow: `1 / span ${grid.rows}` }}
          >
            <ObjectPanel lang={lang} model={model} selection={view.selection} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
