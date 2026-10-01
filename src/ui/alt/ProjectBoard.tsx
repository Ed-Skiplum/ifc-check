/** The IDS tab («IDS», `tab.project`): the project's requirements as one
 *  report (2026-10-01, edkjo: *"IDS is a report. No nonsense … Most
 *  important thing about the IDS page is to display requirement, result …
 *  and to be able to understand it by seeing the model and information"*).
 *  The Overview is `AltBoard.tsx`.
 *
 * On the same module grid and tile frame as the Overview (`layoutProject` in
 * `module-grid.ts`):
 *
 *   the report    the dominant tile: one row per requirement, the
 *                 requirement (what it asks) and the result (Aktuelle ·
 *                 Bestått · Avvik · status), in two groups:
 *                   Standardkrav  Systemkode, Funksjonskode,
 *                                 Materiale/Produkt, Kopiobjekt, MMI, Fase,
 *                                 read from the report contract and the
 *                                 ruleset (`Standardkrav.tsx`)
 *                   IDS           one row per specification of the loaded
 *                                 `.ids`, in file order (`IdsResults.tsx`)
 *   the model     the board's one scene, lent
 *   Scope         the rows behind the last click
 *   Detail        everything about the selected element
 *
 * A click on a row is the Overview's: `onFocus` replaces the one filter,
 * fills Scope and isolates the derivation in the viewer; the row stays
 * marked chosen. A click on an element in Scope fills Detail. The report
 * keeps the whole model's figures under a filter from elsewhere, marked
 * «Hele modellen». With no ruleset every Standardkrav row reads
 * `not_configured` (MMI «Statuskode ikke konfigurert»); with no `.ids`, the
 * IDS group is the open button.
 */

import { useMemo, useRef, type DragEvent, type ReactNode, type RefObject } from "react";
import type { ModelEntry } from "../useModels";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { Requirement } from "../requirements";
import type { Ruleset } from "../../ids/types.ts";
import { t } from "../i18n";
import type { Origin } from "../cross-filter";
import { xfMark, type Xf } from "../origins";
import { formatCount } from "../format";
import { LentViewer } from "../BoardViewer";
import { IdsHead, IdsRows, isIdsFile, type IdsSession } from "../IdsResults";
import { StandardkravRows } from "./Standardkrav";
import { standardRequirements } from "./req-view";
import { MG_GAP, layoutProject, mgRow, type MgLayout } from "./module-grid";
import { Tile, VARS, useModuleGrid, type Bodies } from "./AltBoard";

export interface ProjectBoardProps {
  lang: Lang;
  model: ModelEntry;
  /** The loaded ruleset: what a Standardkrav requirement asks (the code
   *  list, the Uttrekk). */
  ruleset: Ruleset | null;
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

/** The report's columns: the requirement, Aktuelle, Bestått, Avvik, the
 *  status. */
const COLS = 5;

function Report({
  props,
  reqs,
  input,
}: {
  props: ProjectBoardProps;
  reqs: Requirement[];
  input: RefObject<HTMLInputElement | null>;
}) {
  const { lang, model, selected, onFocus } = props;
  const group = (label: string) => (
    <tr className="border-b border-line">
      <th colSpan={COLS} className="alt-label px-3 pt-3 pb-1 text-left font-medium">
        {label}
      </th>
    </tr>
  );
  const num = "w-20 px-2 py-1.5 text-right font-medium";
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-report>
      <table className="w-full table-fixed border-collapse text-[12px]">
        <colgroup>
          <col />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-[8.5rem]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-line text-[11px] text-muted">
            <th className="px-3 py-1.5 text-left font-medium">{t("field.requirement", lang)}</th>
            <th className={num}>{t("trace.applicable", lang)}</th>
            <th className={num}>{t("trace.passed", lang)}</th>
            <th className={num}>{t("trace.failed", lang)}</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody data-report-group="std">
          {group(t("req.group.std", lang))}
          <StandardkravRows
            reqs={reqs}
            ruleset={props.ruleset}
            lang={lang}
            model={model}
            selected={selected}
            onFocus={(focus) => onFocus(focus, "reqs")}
          />
        </tbody>
        <tbody data-report-group="ids" data-ids-tab>
          {group(t("ids.heading", lang))}
          <IdsRows
            lang={lang}
            model={model}
            session={props.ids}
            error={props.idsError}
            selected={selected}
            onFocus={(focus) => onFocus(focus, "ids")}
            input={input}
            cols={COLS}
          />
        </tbody>
      </table>
    </div>
  );
}

export function ProjectBoard(props: ProjectBoardProps) {
  const { model, lang, xf } = props;
  const { ref, grid } = useModuleGrid();
  const reqs = useMemo(() => standardRequirements(model), [model]);
  const layout = useMemo<MgLayout | null>(() => (grid ? layoutProject(grid) : null), [grid]);
  const input = useRef<HTMLInputElement>(null);

  // An `.ids` dropped anywhere on the tab is the tab's own: marked handled so
  // the app's drop handler does not also load it as the ruleset.
  const drop = (event: DragEvent) => {
    const file = Array.from(event.dataTransfer.files).find(isIdsFile);
    if (!file) return;
    event.preventDefault();
    props.onIdsFile(file);
  };

  const bodies: Bodies = (id) => {
    if (id === "report") {
      return {
        // The report keeps whole-model figures under a filter from elsewhere.
        xf: xfMark(xf, ["reqs", "ids"], true),
        wholeText: t("filter.wholeModel", lang),
        label: t("tab.project", lang),
        head: <IdsHead lang={lang} session={props.ids} input={input} onFile={props.onIdsFile} onClear={props.onClearIds} />,
        body: <Report props={props} reqs={reqs} input={input} />,
      };
    }
    if (id === "viewer") {
      return {
        label: t("tile.viewer", lang),
        sub: model.meshBudget ? `${formatCount(model.meshBudget.triangles, lang)} tri` : undefined,
        body: <LentViewer meshBatches={model.meshBatches} active={props.active} className="flex-1" />,
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
            gridTemplateRows: `repeat(${layout.rows}, ${layout.rowPx ?? mgRow(grid)}px)`,
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
