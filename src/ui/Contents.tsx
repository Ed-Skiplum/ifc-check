/** The Innhold tab: the rollup of what the model contains (2026-10-01, edkjo:
 * *"Innhold is a rollup of content, like the treemaps, QTO, etc."*).
 *
 * On the module grid and tile frame of the Overview and the project tab
 * (`layoutContents` in `alt/module-grid.ts`, the LAYOUT SYSTEM canon), tiles
 * by priority, each sized by its share of the board:
 *
 *   qto            the QTO table, the hero (`QtoTable.tsx`, data
 *                  `qto-table.ts`): grouped by the ear in its head, Klasse ·
 *                  Type · Systemkode · Komponentkode · Etasje · Materiale;
 *                  Antall · Volum · Areal · Lengde and a totals row, sortable
 *                  by any column, Antall descending first. It replaced the
 *                  Klasser card: grouped by Klasse it is that list, with the
 *                  quantities beside it.
 *   census         Etasje × klasse (`StoreyClassCensus`).
 *   tree-system    the two code treemaps (`CodeTreemap`, Antall · Volum ·
 *   tree-function  Areal · Lengde in the head): read through the project
 *                  mapping where one exists, else the general ones (IFC
 *                  class, PredefinedType). The board's trees are already
 *                  whichever applies, per axis.
 *   mmi            the MMI bars (`MmiChart`), only where an MMI mapping is
 *                  configured.
 *   ledger         the Typer ledger (`TypeLedgerTile`); the Typer tab is the
 *                  gallery and the type page, this is the ledger's table.
 *
 * Every click is a door, as everywhere: it makes its elements the one filter
 * and opens Scope. Each tile is its own view (origins `qto`, `census`,
 * `tree-system`, `tree-function`, `mmi`): the origin keeps its items and
 * marks the chosen one, the others isolate to the filter. A material row has
 * no board focus, so it is a filter of its own elements, as the Materialer
 * tab's cards are. The layout is a pure function of the window and the
 * loaded content (MMI configured or not), never of selection or filter.
 */

import { useMemo, useState } from "react";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import type { Census } from "./profile";
import { serialiseFocus, type Focus } from "./trace";
import type { ModelEntry } from "./useModels";
import type { FilterAction, Origin } from "./filter-state";
import { isoOf, xfMark, type Xf } from "./origins";
import type { Measure } from "../engine/quantities";
import { CodeTreemap, MeasureSwitch, MmiChart } from "./alt/Charts";
import { mmiRequirement, treeTitle } from "./alt/req-view";
import { formatCount } from "./format";
import { StoreyClassCensus } from "./StoreyClassCensus";
import { TypeLedgerTile, type TypeLedger } from "./types";
import { MG_GAP, layoutContents, mgRow, type MgLayout } from "./alt/module-grid";
import { Tile, VARS, useModuleGrid, type Bodies } from "./alt/AltBoard";
import { QtoEars, QtoTable } from "./QtoTable";
import { QTO_BY, qtoKeyOf, qtoTable, sortQto, type QtoBy, type QtoRow, type QtoSort } from "./qto-table";

export function Contents({
  lang,
  model,
  census,
  ledger,
  selected,
  xf,
  onFocus: onFocusFrom,
  onDispatch,
}: {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  ledger: TypeLedger;
  selected: string | null;
  xf: Xf;
  /** A click, and the view it came from. */
  onFocus: (focus: Focus, origin: Origin) => void;
  /** For a material row: a filter of its own elements (no board focus). */
  onDispatch: (action: FilterAction) => void;
}) {
  const { ref, grid } = useModuleGrid();
  const board = model.board;
  const profile = model.profile;
  const mmi = useMemo(() => mmiRequirement(model), [model]);
  const mmiOn = !!mmi?.row && mmi.state !== "not_configured";
  const layout = useMemo<MgLayout | null>(
    () => (grid ? layoutContents(grid, { mmi: mmiOn, trees: !!board }) : null),
    [grid, mmiOn, board],
  );

  // Antall / Volum / Areal / Lengde per treemap. A measure still waiting on
  // the geometry pass draws as count (`CodeTreemap`), so the choice survives.
  const [measure, setMeasure] = useState<{ system: Measure; function: Measure }>({ system: "count", function: "count" });

  // The QTO table: its ear, and its sort (Antall descending first).
  const [qtoBy, setQtoBy] = useState<QtoBy>("class");
  const [sort, setSort] = useState<{ by: QtoSort; asc: boolean }>({ by: "count", asc: false });
  const keyInput = useMemo(
    () => ({ storeys: profile?.storeys ?? [], trees: board?.trees, materials: profile?.materialRows !== undefined }),
    [profile, board],
  );
  const off = useMemo(() => {
    const out: Partial<Record<QtoBy, StringKey>> = {};
    for (const ear of QTO_BY) {
      if (qtoKeyOf(ear, keyInput)) continue;
      out[ear] = ear === "material" ? "type.notSupplied" : "req.state.not_configured";
    }
    return out;
  }, [keyInput]);
  // An ear that went off (a ruleset cleared) falls back to Klasse.
  const by: QtoBy = off[qtoBy] ? "class" : qtoBy;
  const keyOf = useMemo(() => qtoKeyOf(by, keyInput), [by, keyInput]);
  const qtoIso = isoOf(xf, "qto");
  const table = useMemo(() => {
    if (!profile || !keyOf) return null;
    const out = qtoTable(profile.rows, keyOf, model.elementQuantities, qtoIso);
    return { ...out, rows: sortQto(out.rows, sort.by, sort.asc) };
  }, [profile, keyOf, model.elementQuantities, qtoIso, sort]);

  /** A row's door: the board focus of its group, or for a material its
   *  elements (the whole model's, as every focus resolves). */
  const rowFocus = (row: QtoRow): Focus | null => {
    if (by === "class") return { kind: "class", entity: row.key };
    if (by === "type") return { kind: "type", typeName: row.label };
    if (by === "storey") return { kind: "storey", storeyGuids: [row.key === "" ? null : row.key] };
    if (by === "system" || by === "function") return { kind: "tree", axis: by, key: row.key };
    return null;
  };
  const materialGuids = (row: QtoRow): string[] =>
    !profile || !keyOf ? row.guids : profile.rows.filter((r) => keyOf(r)?.key === row.key).map((r) => r.guid);
  const chosen = (row: QtoRow) => {
    if (xfMark(xf, "qto") !== "origin") return false;
    const focus = rowFocus(row);
    return selected === (focus ? serialiseFocus(focus) : serialiseFocus({ kind: "element", guids: materialGuids(row) }));
  };
  const onRow = (row: QtoRow) => {
    const focus = rowFocus(row);
    if (focus) {
      onFocusFrom(focus, "qto");
      return;
    }
    const guids = materialGuids(row);
    const label = row.label ?? "—";
    onDispatch({
      type: "choose",
      origin: "qto",
      key: `material:${row.key}`,
      filter: { kind: "material", label, guids },
      scope: { kind: "element", guids },
    });
  };

  const door = (origin: Origin) => ({ lang, model, selected, onFocus: (focus: Focus) => onFocusFrom(focus, origin) });

  const bodies: Bodies = (id) => {
    if (id === "qto") {
      return {
        xf: xfMark(xf, "qto"),
        head: <QtoEars lang={lang} by={by} off={off} onBy={setQtoBy} />,
        body: table ? (
          <QtoTable
            lang={lang}
            by={by}
            table={table}
            sort={sort.by}
            asc={sort.asc}
            onSort={(next) =>
              setSort((prev) => (prev.by === next ? { by: next, asc: !prev.asc } : { by: next, asc: next === "label" }))
            }
            progress={model.measureProgress}
            chosen={chosen}
            onRow={onRow}
          />
        ) : (
          <div className="min-h-0 flex-1" />
        ),
      };
    }
    if (id === "census") {
      return {
        xf: xfMark(xf, "census"),
        label: t("tile.census", lang),
        sub: `${formatCount(census.storeys.length, lang)} × ${formatCount(census.classes.length, lang)}`,
        body: (
          <StoreyClassCensus
            lang={lang}
            classes={census.classes}
            matrix={census.matrix}
            storeys={census.storeys}
            peak={census.matrixPeak}
            selected={selected}
            onOpen={(storeyGuid, entity) => onFocusFrom({ kind: "cell", storeyGuid, entity }, "census")}
            onStorey={(storeyGuid) => onFocusFrom({ kind: "storey", storeyGuids: [storeyGuid] }, "census")}
          />
        ),
      };
    }
    if (id === "ledger") {
      return {
        xf: xfMark(xf, "census"),
        label: t("tile.types", lang),
        sub: `${formatCount(ledger.singles, lang)} / ${formatCount(ledger.types, lang)}`,
        body: ledger.factsPresent ? (
          <TypeLedgerTile lang={lang} ledger={ledger} selected={selected} onFocus={(focus) => onFocusFrom(focus, "census")} />
        ) : (
          // A profile that never carried the type facts says so in its own
          // slot: "no types" and "nobody supplied the type facts" differ.
          <div className="flex flex-1 items-center px-2 font-mono text-[11px] text-muted">
            {`${t("type.facts", lang)} · ${t("type.unavailable", lang)}`}
          </div>
        ),
      };
    }
    if (id === "mmi") {
      return mmi && mmiOn
        ? { xf: xfMark(xf, "mmi"), label: t("req.mmi", lang), body: <MmiChart req={mmi} iso={isoOf(xf, "mmi")} {...door("mmi")} /> }
        : null;
    }
    if ((id === "tree-system" || id === "tree-function") && board) {
      const axis = id === "tree-system" ? "system" : "function";
      const tree = board.trees[axis];
      return {
        xf: xfMark(xf, id),
        label: t(treeTitle(tree), lang),
        head: (
          <MeasureSwitch
            tree={tree}
            measures={board.measures}
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
            measures={board.measures}
            iso={isoOf(xf, id)}
            lit={xfMark(xf, id) === "origin" ? xf.matched : null}
            quantities={model.elementQuantities?.byGuid}
            {...door(id)}
          />
        ),
      };
    }
    return null;
  };

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS}>
      {grid && layout ? (
        <div
          data-mg-grid
          data-mg-design="contents"
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
