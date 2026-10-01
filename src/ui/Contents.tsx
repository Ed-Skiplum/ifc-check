/** The Innhold tab: what the file carries, in detail.
 *
 * A flow surface, not a bento (sprucelab ModelWorkspace: one bento overview
 * tab, then working tabs). Two bands that share the tab panel's height
 * 40 : 55, the derivation band's room already taken out of it, so a long
 * class list or ledger costs rows inside its card and never page height
 * (DESIGN.md §1, TableViewport). Each card is the one scroller of its list:
 *
 *   band 1   Klasser (38.2 %) | Etasje × klasse (61.8 %)
 *   band 2   Typer, full width
 *
 * and, beside them (2026-09-30, off the Overview: *"The Innhold page needs a
 * big overhaul, and thats where treemaps and content belongs"*), the two code
 * treemaps stacked in a column of 38.2 %, each with its Antall / Volum / Areal / Lengde
 * switch, where the model's trees are general (the IFC-class and
 * PredefinedType fallbacks; a treemap read through a project mapping is the
 * project tab's). The column is there or not by the loaded content only.
 *
 * Every click cross-filters exactly as it did on the board: a chip, and the
 * derivation band under the tab. The census cards are one view (`census`),
 * each treemap its own (`tree-system`, `tree-function`): the origin dims all
 * but the chosen item, the others isolate.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Census } from "./profile";
import type { Focus } from "./trace";
import type { ModelEntry } from "./useModels";
import type { Origin } from "./filter-state";
import { isoOf, xfMark, type Xf } from "./origins";
import type { Measure } from "../engine/quantities";
import { CodeTreemap, MeasureSwitch } from "./alt/Charts";
import { generalTrees, treeTitle } from "./alt/req-view";
import { formatCount } from "./format";
import { MicroLabel } from "./BentoGrid";
import { ClassDistribution } from "./forms";
import { StoreyClassCensus } from "./StoreyClassCensus";
import { TypeLedgerTile, type TypeLedger } from "./types";

/** The type scale the board derives from its track, fixed here: the ledger
 *  and the tables read the same custom properties on both tabs. */
const SCALE = {
  "--bento-pad": "8px",
  "--bento-label": "10px",
  "--bento-text": "12px",
} as CSSProperties;

function Card({
  label,
  sub,
  head,
  xf,
  className,
  children,
}: {
  label: string;
  sub?: string;
  /** Controls at the head's end, in place of `sub`. */
  head?: ReactNode;
  /** The cross-filter mark of the view this card is (`xfMark`). */
  xf?: "origin" | "whole";
  className: string;
  children: ReactNode;
}) {
  return (
    <section data-xf={xf} className={`flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel ${className}`}>
      <div className="relative flex shrink-0 items-baseline gap-2 px-2 pt-1.5 pb-1">
        <MicroLabel>{label}</MicroLabel>
        {head ?? null}
        {!head && sub ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">{sub}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Contents({
  lang,
  model,
  census,
  ledger,
  selected,
  xf,
  onFocus: onFocusFrom,
}: {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  ledger: TypeLedger;
  selected: string | null;
  xf: Xf;
  /** A click, and the view it came from. */
  onFocus: (focus: Focus, origin: Origin) => void;
}) {
  const onFocus = (focus: Focus) => onFocusFrom(focus, "census");
  const censusXf = xfMark(xf, "census");
  const board = model.board;
  const trees = generalTrees(model);
  // Antall / Volum / Areal / Lengde per treemap. A measure still waiting on the
  // geometry pass draws as count (`CodeTreemap`), so the choice survives it.
  const [measure, setMeasure] = useState<{ system: Measure; function: Measure }>({ system: "count", function: "count" });
  const censusBands = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-[40_1_0] gap-3 [grid-template-columns:minmax(0,38.2fr)_minmax(0,61.8fr)] [grid-template-rows:minmax(0,1fr)]">
        <Card
          label={t("tile.classes", lang)}
          sub={formatCount(census.classes.length, lang)}
          xf={censusXf}
          className="h-full"
        >
          <ClassDistribution
            lang={lang}
            classes={census.classes}
            selected={selected}
            onFocus={onFocus}
          />
        </Card>
        <Card
          label={t("tile.census", lang)}
          sub={`${formatCount(census.storeys.length, lang)} × ${formatCount(census.classes.length, lang)}`}
          xf={censusXf}
          className="h-full"
        >
          <StoreyClassCensus
            lang={lang}
            classes={census.classes}
            matrix={census.matrix}
            storeys={census.storeys}
            peak={census.matrixPeak}
            selected={selected}
            onOpen={(storeyGuid, entity) => onFocus({ kind: "cell", storeyGuid, entity })}
            onStorey={(storeyGuid) => onFocus({ kind: "storey", storeyGuids: [storeyGuid] })}
          />
        </Card>
      </div>

      <Card
        label={t("tile.types", lang)}
        sub={`${formatCount(ledger.singles, lang)} / ${formatCount(ledger.types, lang)}`}
        xf={censusXf}
        className="flex-[55_1_0]"
      >
        {ledger.factsPresent ? (
          <TypeLedgerTile lang={lang} ledger={ledger} selected={selected} onFocus={onFocus} />
        ) : (
          // A profile that never carried the type facts says so in its own
          // slot: "no types" and "nobody supplied the type facts" differ.
          <div className="flex flex-1 items-center px-2 font-mono text-[11px] text-muted">
            {`${t("type.facts", lang)} · ${t("type.unavailable", lang)}`}
          </div>
        )}
      </Card>
    </div>
  );
  if (!board || trees.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={SCALE}>
        {censusBands}
      </div>
    );
  }
  return (
    <div
      className="grid min-h-0 flex-1 gap-3 [grid-template-columns:minmax(0,61.8fr)_minmax(0,38.2fr)] [grid-template-rows:minmax(0,1fr)]"
      style={SCALE}
    >
      {censusBands}
      <div className="flex min-h-0 min-w-0 flex-col gap-3" data-contents-trees>
        {trees.map((id) => {
          const axis = id === "tree-system" ? "system" : "function";
          const tree = board.trees[axis];
          return (
            <Card
              key={id}
              label={t(treeTitle(tree), lang)}
              xf={xfMark(xf, id)}
              className="flex-1 basis-0"
              head={
                <MeasureSwitch
                  tree={tree}
                  measures={board.measures}
                  progress={model.measureProgress}
                  measure={measure[axis]}
                  onMeasure={(m) => setMeasure((prev) => ({ ...prev, [axis]: m }))}
                  lang={lang}
                />
              }
            >
              <CodeTreemap
                tree={tree}
                measure={measure[axis]}
                measures={board.measures}
                iso={isoOf(xf, id)}
                lit={xfMark(xf, id) === "origin" ? xf.matched : null}
                quantities={model.elementQuantities?.byGuid}
                lang={lang}
                model={model}
                selected={selected}
                onFocus={(focus) => onFocusFrom(focus, id)}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
