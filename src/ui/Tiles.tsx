/** The dashboard's tile shell and its KPI tile.
 *
 * A tile has a fixed size and either fills or does not: it never collapses,
 * never grows with its content and never becomes a workspace. Clicking one
 * drills into the band below.
 */

import type { ReactNode } from "react";
import type { ResultState } from "../ids/evaluate.ts";
import { copyOnDoubleClick } from "./copy";
import { RESULT_FILL, RESULT_GLYPH } from "./state-visuals";

interface TileProps {
  label: string;
  /** Grid span in [columns, rows] of the dashboard module. */
  span?: [number, number];
  /** Rendered at the right of the label line: a count, a unit, a scope. */
  aside?: ReactNode;
  children: ReactNode;
}

function spanStyle(span: [number, number] | undefined) {
  const [cols, rows] = span ?? [1, 1];
  return { gridColumn: `span ${cols}`, gridRow: `span ${rows}` };
}

export function Tile({ label, span, aside, children }: TileProps) {
  return (
    <section
      style={spanStyle(span)}
      className="flex min-w-0 flex-col overflow-hidden border border-line bg-panel"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2 px-2.5 pt-1.5 pb-1">
        <h2 className="truncate text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {label}
        </h2>
        {aside ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{aside}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A tile that spans the full width of the grid, whatever the column count. */
export function WideTile({ label, rows, aside, children }: {
  label: string;
  rows: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{ gridColumn: "1 / -1", gridRow: `span ${rows}` }}
      className="flex min-w-0 flex-col overflow-hidden border border-line bg-panel"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2 px-2.5 pt-1.5 pb-1">
        <h2 className="truncate text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {label}
        </h2>
        {aside ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{aside}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  /** A share, a unit qualifier, or the word that names an alarm. */
  note?: string;
  /** Whole-element red fill plus a glyph. Never colour on its own. */
  alarm?: boolean;
  /** Set when a loaded rule claims this number: the value carries the rule's
   *  verdict instead of reading as a neutral fact. */
  verdict?: ResultState;
  span?: [number, number];
  /** Present when the number has rows behind it. */
  onOpen?: () => void;
  selected?: boolean;
  /** Long free text (a project name, an authoring application) wraps instead
   *  of being sized as a figure. */
  text?: boolean;
}

export function KpiTile({
  label,
  value,
  note,
  alarm,
  verdict,
  span,
  onOpen,
  selected,
  text,
}: KpiTileProps) {
  const figure = text
    ? "font-sans text-[13px] leading-tight break-words"
    : "font-mono text-[22px] leading-none tabular-nums";

  // All spans: a drillable tile puts this inside a <button>, which takes
  // phrasing content only.
  const body = (
    <span className="flex min-h-0 flex-1 flex-col justify-end gap-1 px-2.5 pb-2">
      {verdict ? (
        <span className={`flex w-fit items-center gap-1.5 px-1.5 py-0.5 ${RESULT_FILL[verdict]}`}>
          <span className="font-mono text-[13px] font-bold">{RESULT_GLYPH[verdict]}</span>
          <span className={figure}>{value}</span>
        </span>
      ) : alarm && note === undefined ? (
        <span className="flex w-fit items-center gap-1.5 bg-bad px-1.5 py-0.5 text-cream">
          <span className="font-mono text-[13px] font-bold">!</span>
          <span className={figure}>{value}</span>
        </span>
      ) : (
        <span
          onDoubleClick={onOpen ? undefined : copyOnDoubleClick(value)}
          className={`${figure} text-ink ${onOpen ? "" : "cursor-copy"}`}
        >
          {value}
        </span>
      )}
      {note !== undefined ? (
        alarm ? (
          <span className="flex w-fit items-center gap-1.5 bg-bad px-1.5 py-0.5 text-[11px] font-medium text-cream">
            <span className="font-mono font-bold">!</span>
            {note}
          </span>
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-muted">{note}</span>
        )
      ) : null}
    </span>
  );

  if (!onOpen) {
    return (
      <Tile label={label} span={span}>
        {body}
      </Tile>
    );
  }

  return (
    <section
      style={spanStyle(span)}
      className={
        "flex min-w-0 flex-col overflow-hidden border bg-panel " +
        (selected ? "border-line outline-2 -outline-offset-2 outline-ink" : "border-line")
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col items-stretch text-left hover:bg-palegreen"
      >
        <span className="flex shrink-0 items-baseline justify-between gap-2 px-2.5 pt-1.5 pb-1">
          <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {label}
          </span>
        </span>
        {body}
      </button>
    </section>
  );
}
