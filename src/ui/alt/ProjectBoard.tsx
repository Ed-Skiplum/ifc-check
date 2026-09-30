/** The project tab («Prosjekt»): project specifics and the IDS (2026-09-28,
 * the owner: *"We have a dash for general model health and a separate tab
 * for project specifics and IDS"*). The Overview is `AltBoard.tsx`.
 *
 * On the same module grid and tile frame as the Overview (`layoutProject` in
 * `module-grid.ts`):
 *
 *   the KPI row   one S card per Standardkrav requirement (Systemkode,
 *                 Funksjonskode, Materiale/Produkt, Kopiobjekt, MMI, Fase),
 *                 in the report's order, never a list, never a scroll
 *   the body      the IDS table, the model (the board's one scene, lent),
 *                 Scope, Detail, the treemaps read through a project mapping
 *                 and the MMI bars
 *
 * A click is the Overview's: `onFocus` replaces the one filter and fills
 * Scope (2026-09-28, one origin). The tile clicked keeps its items and dims
 * all but the chosen one; the lent viewer, the treemaps and the MMI bars
 * isolate to the filter; the KPI cards and the IDS table keep the whole
 * model's figures, marked «Hele modellen». With no ruleset every card reads
 * `not_configured`, the MMI tile «Statuskode ikke konfigurert», and no mapped
 * treemap exists to draw; with no `.ids`, the table is the open button.
 */

import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { ModelEntry } from "../useModels";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { Measure } from "../../engine/quantities";
import type { CodeTree } from "../../engine/code-tree";
import { t } from "../i18n";
import type { Origin } from "../cross-filter";
import { isoOf, xfMark, type Xf } from "../origins";
import { formatCount } from "../format";
import { LentViewer } from "../BoardViewer";
import { IdsHead, IdsResults, isIdsFile, type IdsSession } from "../IdsResults";
import { ReqCard } from "./Requirements";
import { CodeTreemap, MeasureSwitch, MmiChart, StandardkravList } from "./Standardkrav";
import { mmiRequirement, projectTrees, standardRequirements, treeTitle } from "./req-view";
import { MG_GAP, layoutProject, type MgLayout } from "./module-grid";
import { Tile, VARS, useModuleGrid, type Bodies, type TileBody } from "./AltBoard";

export interface ProjectBoardProps {
  lang: Lang;
  model: ModelEntry;
  selected: string | null;
  /** A click on a board number, and the view it came from. */
  onFocus: (focus: Focus, origin: Origin) => void;
  /** The one filter: its origin and the elements it resolves to. */
  xf: Xf;
  /** The chip-free selection, for bringing Detail forward. */
  selection: string[];
  /** The rows behind the last click (the derivation list), or null. */
  scope: ReactNode;
  /** Everything about the selected identity (the object panel), or null. */
  detail: ReactNode;
  /** The tab is on screen: the viewer is lent only then. */
  active: boolean;
  ids: IdsSession | null;
  idsError: string | null;
  onIdsFile: (file: File) => void;
  onClearIds: () => void;
}

const treeId = (tree: CodeTree) => `ptree-${tree.axis}`;

export function ProjectBoard(props: ProjectBoardProps) {
  const { model, lang, selected, onFocus, xf } = props;
  const { ref, grid } = useModuleGrid();
  const reqs = useMemo(() => standardRequirements(model), [model]);
  const mmi = useMemo(() => mmiRequirement(model), [model]);
  const trees = useMemo(() => projectTrees(model), [model]);
  const treeKey = trees.map(treeId).join(",");
  const layout = useMemo<MgLayout | null>(
    () => (grid ? layoutProject(grid, { std: reqs.length, trees: trees.map(treeId), mmi: !!mmi }) : null),
    // `trees` is keyed by its ids; the layout is a pure function of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, reqs.length, treeKey, !!mmi],
  );

  const [measure, setMeasure] = useState<{ system: Measure; function: Measure }>({ system: "count", function: "count" });
  const input = useRef<HTMLInputElement>(null);

  // An `.ids` dropped anywhere on the tab is the tab's own: marked handled so
  // the app's drop handler does not also load it as the ruleset.
  const drop = (event: DragEvent) => {
    const file = Array.from(event.dataTransfer.files).find(isIdsFile);
    if (!file) return;
    event.preventDefault();
    props.onIdsFile(file);
  };

  const door = (origin: Origin) => ({ lang, model, selected, onFocus: (focus: Focus) => onFocus(focus, origin) });
  const whole = (self: Origin) => ({ xf: xfMark(xf, self, true), wholeText: t("filter.wholeModel", lang) });
  const board = model.board;

  const bodies: Bodies = (id) => {
    if (id === "viewer") {
      return {
        label: t("tile.viewer", lang),
        sub: model.meshBudget ? `${formatCount(model.meshBudget.triangles, lang)} tri` : undefined,
        body: <LentViewer meshBatches={model.meshBatches} active={props.active} className="flex-1" />,
      };
    }
    if (id === "ids") {
      return {
        ...whole("ids"),
        label: t("ids.heading", lang),
        head: <IdsHead lang={lang} session={props.ids} input={input} onFile={props.onIdsFile} onClear={props.onClearIds} />,
        body: (
          <IdsResults
            lang={lang}
            model={model}
            session={props.ids}
            error={props.idsError}
            selected={selected}
            onFocus={door("ids").onFocus}
            input={input}
          />
        ),
      };
    }
    if (id === "scope")
      return {
        bare: true,
        empty: !props.scope,
        label: t("tile.scope", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="scope">{props.scope}</div>,
      };
    if (id === "detail")
      return {
        bare: true,
        empty: !props.detail,
        label: t("tile.detail", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="detail">{props.detail}</div>,
      };
    if (id === "mmi") {
      return mmi
        ? { xf: xfMark(xf, "mmi"), label: t("req.mmi", lang), body: <MmiChart req={mmi} iso={isoOf(xf, "mmi")} {...door("mmi")} /> }
        : null;
    }
    const tree = trees.find((tr) => treeId(tr) === id);
    if (tree) {
      const axis = tree.axis;
      return {
        xf: xfMark(xf, id),
        label: t(treeTitle(tree), lang),
        head: (
          <MeasureSwitch
            tree={tree}
            measures={board?.measures}
            progress={model.measureProgress}
            measure={measure[axis]}
            onMeasure={(m) => setMeasure((prev) => ({ ...prev, [axis]: m }))}
            lang={lang}
          />
        ),
        body: (
          <CodeTreemap
            tree={tree}
            measure={measure[axis]}
            measures={board?.measures}
            iso={isoOf(xf, id)}
            lit={xfMark(xf, id) === "origin" ? xf.matched : null}
            quantities={model.elementQuantities?.byGuid}
            {...door(id)}
          />
        ),
      };
    }
    const kpi = /^std(\d+)$/.exec(id);
    if (kpi) {
      const req = reqs[Number(kpi[1])];
      return req ? { ...whole("reqs"), bare: true, label: t(req.label, lang), body: <ReqCard req={req} {...door("reqs")} /> } : null;
    }
    // The narrow fallback: the Standardkrav requirements as one list.
    if (id === "reqs") return { ...whole("reqs"), label: t("req.group.std", lang), body: <StandardkravList reqs={reqs} {...door("reqs")} /> } satisfies TileBody;
    return null;
  };

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      {grid && layout ? (
        <div
          data-mg-grid
          data-mg-design="project"
          data-mg-band={layout.band}
          data-mg-cols={grid.cols}
          data-mg-rows={layout.rows}
          data-mg-u={grid.u.toFixed(4)}
          data-mg-used={`${layout.offset},${layout.top},${layout.used},${layout.usedRows}`}
          className="alt-board mx-auto grid"
          style={{
            width: grid.cols * grid.u + (grid.cols - 1) * MG_GAP,
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
            gridTemplateRows: `repeat(${layout.rows}, ${layout.rowPx ?? grid.u}px)`,
            gap: MG_GAP,
          }}
        >
          {layout.tiles.map((place) => (
            <Tile key={place.id} place={place} bodies={bodies} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
