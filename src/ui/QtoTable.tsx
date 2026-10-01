/** The Innhold tab's QTO table: one row per group of the chosen ear, Antall ·
 *  Volum · Areal · Lengde, a totals row. Data from `qto-table.ts`; this file
 *  only draws it.
 *
 *  The ears (`QtoEars`) sit in the tile head, as the treemaps' measure
 *  switch does. Systemkode and Komponentkode need their mapping, Materiale
 *  the material table: without, the ear is off and says why («ikke
 *  konfigurert», «ikke levert»).
 *
 *  A measure still waiting on the geometry pass shows the treemaps' pending
 *  state (the thin progress bar) in its column head, and no figures until it
 *  is final. Elements with no value add nothing; their count is «mangler»,
 *  in each cell's tooltip and under the totals row's figure.
 *
 *  A row is a door like every other: a click makes its elements the one
 *  filter (`onRow`), the row then outlined. The table body is the tile's one
 *  scroller (TableViewport), the head and the totals row stay. */

import type { ReactNode } from "react";
import { locale, t, type Lang, type StringKey } from "./i18n";
import { formatCount } from "./format";
import { useSelectionMarks } from "./selection-context";
import { QTO_EAR, qtoPending, qtoValue, type QtoBy, type QtoMeasure, type QtoRow, type QtoSort, type QtoTable as Table } from "./qto-table";

const MEASURE_LABEL: Record<QtoMeasure, StringKey> = {
  count: "col.count",
  volume: "measure.volume",
  area: "measure.area",
  length: "inst.length",
};

const UNIT: Record<Exclude<QtoMeasure, "count">, string> = { volume: "m³", area: "m²", length: "m" };

/** The ears. `off` names the ears that cannot group, with the word why. */
export function QtoEars({
  lang,
  by,
  off,
  onBy,
}: {
  lang: Lang;
  by: QtoBy;
  off: Partial<Record<QtoBy, StringKey>>;
  onBy: (by: QtoBy) => void;
}) {
  return (
    <span className="flex min-w-0 shrink items-center overflow-hidden border border-line" data-qto-ears>
      {(Object.keys(QTO_EAR) as QtoBy[]).map((ear) => {
        const why = off[ear];
        return (
          <button
            key={ear}
            type="button"
            data-qto-ear={ear}
            aria-pressed={by === ear}
            // Not `disabled`: a disabled button shows no tooltip, and the
            // tooltip is what says why the ear is off.
            aria-disabled={why ? true : undefined}
            title={why ? `${t(QTO_EAR[ear], lang)} · ${t(why, lang)}` : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (!why) onBy(ear);
            }}
            className={
              "alt-measure shrink-0 px-1.5 py-0.5 text-[10px] whitespace-nowrap " +
              (by === ear ? "bg-green text-cream" : why ? "cursor-not-allowed bg-input text-muted opacity-50" : "bg-input text-muted hover:text-ink")
            }
          >
            {t(QTO_EAR[ear], lang)}
          </button>
        );
      })}
    </span>
  );
}

function figure(value: number, lang: Lang): string {
  return value.toLocaleString(locale(lang), { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function Th({
  children,
  right,
  sort,
  onSort,
}: {
  children: ReactNode;
  right?: boolean;
  /** This column's sort state, or null when it is not the sort. */
  sort?: "ascending" | "descending" | null;
  onSort?: () => void;
}) {
  return (
    <th
      aria-sort={sort ?? undefined}
      className={
        "sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[length:var(--bento-label)] font-semibold tracking-[0.12em] text-gold uppercase whitespace-nowrap " +
        (right ? "text-right" : "text-left")
      }
    >
      {onSort ? (
        <button type="button" onClick={onSort} className="relative uppercase tracking-[0.12em] hover:text-ink">
          {children}
          {sort ? <span aria-hidden className="ml-1">{sort === "ascending" ? "▲" : "▼"}</span> : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function QtoTable({
  lang,
  by,
  table,
  sort,
  asc,
  onSort,
  progress,
  chosen,
  onRow,
}: {
  lang: Lang;
  by: QtoBy;
  table: Table;
  sort: QtoSort;
  asc: boolean;
  onSort: (sort: QtoSort) => void;
  /** The geometry pass, for a pending column's bar. */
  progress: { done: number; total: number } | undefined;
  /** Whether a row is the filter's chosen item. */
  chosen: (row: QtoRow) => boolean;
  onRow: (row: QtoRow) => void;
}) {
  const marks = useSelectionMarks();
  const measures: QtoMeasure[] = ["count", "volume", "area", "length"];
  const pending = Object.fromEntries(measures.map((m) => [m, qtoPending(table, m)])) as Record<QtoMeasure, boolean>;
  const share = progress && progress.total > 0 ? progress.done / progress.total : 0;
  // The bar behind a row: its share of the sorted measure (count while the
  // sort is the label or a pending measure).
  const barBy: QtoMeasure = sort === "label" || pending[sort] ? "count" : sort;
  const peak = table.rows.reduce((max, row) => Math.max(max, qtoValue(row, barBy)), 0);
  const label = (row: QtoRow): string => {
    if (row.label !== null) return row.label;
    if (by === "type") return t("type.untyped", lang);
    if (by === "storey") return t("matrix.noStorey", lang);
    if (by === "system" || by === "function") return t("req.mangler", lang);
    return "—";
  };
  const cell = (row: QtoRow, m: QtoMeasure, total = false): ReactNode => {
    if (m === "count") return formatCount(row.count, lang);
    if (pending[m]) return null;
    const s = row[m];
    const value = s.sum === 0 && s.missing === row.count ? "—" : figure(s.sum, lang);
    if (!total || s.missing === 0) return value;
    return (
      <span className="flex flex-col items-end leading-tight">
        <span>{value}</span>
        <span className="text-[10px] font-normal text-muted">{`${t("req.mangler", lang)} ${formatCount(s.missing, lang)}`}</span>
      </span>
    );
  };
  const tip = (row: QtoRow, m: QtoMeasure): string | undefined =>
    m !== "count" && !pending[m] && row[m].missing > 0 ? `${t("req.mangler", lang)} ${formatCount(row[m].missing, lang)}` : undefined;
  const head = (m: QtoMeasure) => (m === "count" ? t(MEASURE_LABEL[m], lang) : `${t(MEASURE_LABEL[m], lang)} (${UNIT[m]})`);
  const sortOf = (key: QtoSort) => (sort === key ? (asc ? "ascending" : "descending") : null);
  const td = "border-b border-line px-2 py-0 font-mono text-[length:var(--bento-fs-sm,11px)] tabular-nums whitespace-nowrap";
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input" data-qto-table={by}>
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <Th sort={sortOf("label")} onSort={() => onSort("label")}>
              {t(QTO_EAR[by], lang)}
            </Th>
            {measures.map((m) => (
              <Th key={m} right sort={sortOf(m)} onSort={pending[m] ? undefined : () => onSort(m)}>
                <span className={pending[m] ? "relative text-muted" : undefined} data-qto-pending={pending[m] ? share.toFixed(3) : undefined}>
                  {head(m)}
                  {pending[m] ? (
                    <span className="alt-measure-track" style={{ left: 0, right: 0, bottom: -3 }}>
                      <span className="alt-measure-bar" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                  ) : null}
                </span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr
              key={row.key}
              data-qto-row={row.key}
              data-sel={marks.size > 0 && marks.any(row.guids) ? "" : undefined}
              tabIndex={0}
              onClick={() => onRow(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRow(row);
                }
              }}
              className={"alt-hover h-[var(--bento-line,24px)] cursor-pointer " + (chosen(row) ? "alt-chosen" : "")}
            >
              <td className={`${td} relative max-w-0 w-full`} title={[label(row), row.name].filter(Boolean).join(" · ")}>
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-green/15"
                  style={{ width: peak > 0 ? `${(qtoValue(row, barBy) / peak) * 100}%` : "0%" }}
                />
                <span className="relative block truncate text-ink">
                  {label(row)}
                  {row.name ? <span className="ml-1.5 text-muted">{row.name}</span> : null}
                </span>
              </td>
              {measures.map((m) => (
                <td key={m} className={`${td} text-right text-ink`} title={tip(row, m)}>
                  {cell(row, m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-qto-total>
            <td className={`${td} sticky bottom-0 border-t border-b-0 bg-panel py-1 font-semibold text-ink`}>{t("inst.sum", lang)}</td>
            {measures.map((m) => (
              <td key={m} className={`${td} sticky bottom-0 border-t border-b-0 bg-panel py-1 text-right align-top font-semibold text-ink`}>
                {cell(table.total, m, true)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
