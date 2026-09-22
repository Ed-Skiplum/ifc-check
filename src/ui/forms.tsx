/** The supporting forms of the board — everything that is not the focal.
 *
 * These carry the counts and the census. The owner's own reading of them:
 * *"showing a quantity takeoff of how many elements there are of different
 * types, great, but gives no feedback"* — so they are CONTEXT and sit below
 * the verdicts, not instead of them. They stay because they are good, not
 * because they lead.
 *
 * Every form fills its tile's fixed box: the height comes from the span, the
 * list scrolls inside it, and nothing here resizes with its data.
 */

import type { Verdict } from "../engine/types";
import type { ClassCount } from "./profile";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";

const PAD = "px-[var(--bento-pad)]";

/* ------------------------------------------------------------ the gauge */

/**
 * Project → Site → Building → Storey, against the target IFC itself declares.
 *
 * A gauge answers "how far vs a declared target", and this is the one target
 * on the screen that no project has to state: the spatial decomposition is
 * what IFC IS. Four lamps. The "element in storey" bar that sat under them
 * went (2026-09-21): it repeated the focal's row and the KPI "Uten etasje".
 */
export function SpatialGauge({
  lang,
  levels,
}: {
  lang: Lang;
  levels: { level: string; size: number }[];
}) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-1 overflow-hidden pb-[var(--bento-pad)] ${PAD}`}>
      {levels.map((level) => {
        const present = level.size > 0;
        return (
          <span
            key={level.level}
            className={
              "flex min-h-0 flex-1 items-center gap-2 px-2 " +
              (present ? VERDICT_FILL.pass : VERDICT_FILL.fail)
            }
          >
            <span className="font-mono text-[length:var(--bento-fs)] font-bold">
              {present ? VERDICT_GLYPH.pass : VERDICT_GLYPH.fail}
            </span>
            <span data-essential className="truncate font-mono text-[length:var(--bento-fs)]">
              {level.level}
            </span>
            <span
              data-essential
              className="ml-auto shrink-0 font-mono text-[length:var(--bento-fs)] font-semibold tabular-nums"
            >
              {formatCount(level.size, lang)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- the distribution */

/** The class census as full-tile bars on one accent, ramped by count. A count
 *  is not a verdict, so it never rides the traffic-light alphabet. */
export function ClassDistribution({
  lang,
  classes,
  selected,
  onFocus,
}: {
  lang: Lang;
  classes: ClassCount[];
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const peak = classes.reduce((max, c) => Math.max(max, c.count), 0);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      {classes.map((klass) => (
        <button
          key={klass.entity}
          type="button"
          onClick={() => onFocus({ kind: "class", entity: klass.entity })}
          className={
            "relative flex h-[var(--bento-line,24px)] w-full items-center justify-between gap-2 border-b border-line px-2 text-left hover:bg-palegreen " +
            (selected === `class:${klass.entity}` ? "outline-2 -outline-offset-2 outline-ink" : "")
          }
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-green/15"
            style={{ width: peak > 0 ? `${(klass.count / peak) * 100}%` : "0%" }}
          />
          <span
            title={klass.entity}
            className="relative truncate font-mono text-[length:var(--bento-fs-sm,11px)] text-ink"
          >
            {klass.entity}
          </span>
          <span
            data-essential
            className="relative shrink-0 font-mono text-[length:var(--bento-fs-sm,11px)] tabular-nums text-ink"
          >
            {formatCount(klass.count, lang)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- the readouts */

export interface Readout {
  label: string;
  value: string;
  /** Long free text (a project name, an authoring application) wraps instead
   *  of being set as a figure. */
  text?: boolean;
  /** A door: the value opens a derivation. */
  onClick?: () => void;
}

/** Label-over-value pairs in a fixed box. Used for the file's own facts and
 *  for the project line — a count with a status, not a verdict. */
export function ReadoutList({ items }: { items: Readout[] }) {
  return (
    <div
      className={`grid min-h-0 flex-1 content-start gap-x-3 gap-y-1 overflow-auto pb-[var(--bento-pad)] ${PAD}`}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(9ch, 1fr))" }}
    >
      {items.map((item) => (
        <span key={item.label} className="flex min-w-0 flex-col">
          <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {item.label}
          </span>
          <span
            onDoubleClick={copyOnDoubleClick(item.value)}
            title={item.value}
            className={
              "cursor-copy truncate text-ink " +
              (item.text ? "text-[12px]" : "font-mono text-[14px] tabular-nums")
            }
          >
            {item.value}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The same pairs on one line: the model panel's header carries the file's
 *  own facts this way (2026-09-21), where a 3×2 readout tile clipped them. */
export function ReadoutStrip({ items }: { items: Readout[] }) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-x-3 overflow-hidden">
      {items.map((item) => (
        <span key={item.label} className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {item.label}
          </span>
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              title={item.value}
              className="truncate font-mono text-[12px] tabular-nums text-ink underline decoration-line underline-offset-2 hover:text-green"
            >
              {item.value}
            </button>
          ) : (
            <span
              onDoubleClick={copyOnDoubleClick(item.value)}
              title={item.value}
              className={
                "cursor-copy truncate text-[12px] text-ink " +
                (item.text ? "" : "font-mono tabular-nums")
              }
            >
              {item.value}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ the KPI row */

export interface KpiCard {
  key: string;
  label: string;
  value: string;
  /** Set only where the engine has a verdict for this number; a pure count
   *  stays neutral and never borrows the traffic-light alphabet. */
  verdict?: Verdict;
  /** The check whose findings this number counts. With findings, a click
   *  cross-filters to them through the same `check` focus the focal rows use. */
  checkId?: string;
  findings?: number;
}

/** One number per card, the board's top strip. The cards share the strip's
 *  row, so they are cells of one tile rather than seven tiles: the grid's band
 *  arithmetic cannot seat seven tiles in one row (see `bento-layouts.ts`). */
export function KpiRow({
  cards,
  selected,
  onFocus,
}: {
  cards: KpiCard[];
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  return (
    <div
      className="-mx-[var(--bento-pad)] grid h-full min-w-0 flex-1 gap-px bg-line"
      style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
    >
      {cards.map((card) => {
        const fill = card.verdict ? VERDICT_FILL[card.verdict] : "bg-panel text-ink";
        const clickable = !!card.checkId && (card.findings ?? 0) > 0;
        const key = card.checkId ? `check:${card.checkId}` : null;
        const inner = (
          <>
            <span
              data-essential
              className={
                "truncate leading-tight font-semibold tracking-[0.12em] uppercase " +
                (card.verdict ? "opacity-90" : "text-gold")
              }
              style={{ fontSize: "var(--bento-label)" }}
            >
              {card.verdict ? `${VERDICT_GLYPH[card.verdict]} ` : ""}
              {card.label}
            </span>
            <span
              data-essential
              className="truncate font-mono leading-tight font-semibold tabular-nums"
              style={{ fontSize: "min(var(--bento-value), calc(var(--bento-row) * 0.45))" }}
              title={card.value}
            >
              {card.value}
            </span>
          </>
        );
        const cls =
          `flex min-w-0 flex-col justify-center px-[var(--bento-pad)] text-left ${fill} ` +
          (key && selected === key ? "outline-2 -outline-offset-2 outline-ink" : "");
        return clickable ? (
          <button
            key={card.key}
            type="button"
            aria-label={`${card.label} ${card.value}`}
            onClick={() => onFocus({ kind: "check", checkId: card.checkId! })}
            className={`${cls} hover:brightness-110`}
          >
            {inner}
          </button>
        ) : (
          <span key={card.key} className={cls}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
