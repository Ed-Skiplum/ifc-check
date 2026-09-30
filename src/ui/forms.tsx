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
import { useLayoutEffect, useRef, useState } from "react";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";
import { useSelectionMarks } from "./selection-context";

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
  // Each level is a row in the focal's grammar: a small filled lamp carrying
  // the glyph, then the name and the count on the tile's own ground. The fill
  // used to be the whole row, which put four large saturated blocks of the
  // PASS colour on a board where colour is how a failure is found; the lamp
  // keeps the verdict and gives the area back to the ground (2026-09-24).
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-input">
      {levels.map((level) => {
        const present = level.size > 0;
        return (
          <span
            key={level.level}
            className={`flex min-h-0 flex-1 items-center gap-2 border-b border-line ${PAD}`}
          >
            <span
              className={
                "flex h-[calc(var(--bento-line)-4px)] w-[2.2em] shrink-0 items-center justify-center font-mono text-[length:var(--bento-fs)] font-bold " +
                (present ? VERDICT_FILL.pass : VERDICT_FILL.fail)
              }
            >
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
  const marks = useSelectionMarks();
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      {classes.map((klass) => (
        <button
          key={klass.entity}
          type="button"
          data-sel={marks.focus({ kind: "class", entity: klass.entity }) ? "" : undefined}
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
  /** `ReadoutStrip` only: when the line runs short, the lowest `drop` leaves
   *  first. None: it never leaves. */
  drop?: number;
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
 *  own facts this way (2026-09-21), where a 3×2 readout tile clipped them.
 *
 *  A pair is shown whole or not at all (2026-09-30 review: «LENGDEENI»,
 *  «PROSJI», «SKJEMA IF…» at 1440 and 1920). When the line runs short the
 *  pairs leave in `drop` order, lowest first, measured from their rendered
 *  widths, never cut mid-word. */
export function ReadoutStrip({ items }: { items: Readout[] }) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<boolean[] | null>(null);
  const key = items.map((i) => `${i.label}|${i.value}|${i.drop ?? ""}`).join(";");
  useLayoutEffect(() => {
    const el = box.current;
    const row = probe.current;
    if (!el || !row) return;
    const fit = () => {
      const widths = Array.from(row.children).map((c) => c.getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const next = fitReadouts(widths, items.map((i) => i.drop), el.getBoundingClientRect().width, gap);
      setShown((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    observer.observe(row);
    return () => observer.disconnect();
    // `key` stands for `items`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div ref={box} className="relative flex min-w-0 flex-1 items-baseline gap-x-3 overflow-hidden">
      {/* The measuring row: every pair at its natural width, never seen. */}
      <div
        ref={probe}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-baseline gap-x-3 whitespace-nowrap"
      >
        {items.map((item) => (
          <span key={item.label} className="flex shrink-0 items-baseline gap-1.5">
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">{item.label}</span>
            <span className={"text-[12px] " + (item.text ? "" : "font-mono tabular-nums")}>{item.value}</span>
          </span>
        ))}
      </div>
      {items.map((item, i) =>
        shown && !shown[i] ? null : (
          <span key={item.label} className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
            <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              {item.label}
            </span>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                title={item.value}
                className="font-mono text-[12px] tabular-nums text-ink underline decoration-line underline-offset-2 hover:text-green"
              >
                {item.value}
              </button>
            ) : (
              <span
                onDoubleClick={copyOnDoubleClick(item.value)}
                title={item.value}
                className={"cursor-copy text-[12px] text-ink " + (item.text ? "" : "font-mono tabular-nums")}
              >
                {item.value}
              </span>
            )}
          </span>
        ),
      )}
    </div>
  );
}

/** Which readouts fit `available` px: every one while they do, then they leave
 *  in ascending `drop` order until the rest fit. A readout with no `drop`
 *  stays. Pure, so the order can be tested without a browser. */
export function fitReadouts(
  widths: readonly number[],
  drop: readonly (number | undefined)[],
  available: number,
  gap: number,
): boolean[] {
  const shown = widths.map(() => true);
  const total = () => {
    let sum = 0;
    let n = 0;
    widths.forEach((w, i) => {
      if (!shown[i]) return;
      sum += w;
      n += 1;
    });
    return sum + gap * Math.max(0, n - 1);
  };
  const order = widths
    .map((_, i) => i)
    .filter((i) => drop[i] !== undefined)
    .sort((a, b) => drop[a]! - drop[b]!);
  for (const i of order) {
    if (total() <= available + 0.5) break;
    shown[i] = false;
  }
  return shown;
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

/** One number per card. Two placements since 2026-09-24:
 *
 *  - `stacked` — the three VERDICT counts, one above the other in the focal's
 *    right-hand section, beside the check rows they count. They are the only
 *    large coloured numerals on the board, so a failure is found by one
 *    channel in one place.
 *  - `quiet` — the four NEUTRAL counts as label·value pairs on one line in the
 *    last-row strip, at list-text size: reference, read after the verdicts,
 *    never competing with them.
 *
 *  Without either it is the old strip of equal cards. */
export function KpiRow({
  cards,
  selected,
  onFocus,
  stacked = false,
  quiet = false,
}: {
  cards: KpiCard[];
  selected: string | null;
  onFocus: (focus: Focus) => void;
  stacked?: boolean;
  quiet?: boolean;
}) {
  if (quiet) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center gap-x-[calc(var(--bento-pad)*3)]">
        {cards.map((card) => (
          <span key={card.key} className="flex min-w-0 items-baseline gap-2">
            <span
              data-essential
              className="shrink-0 leading-tight font-semibold tracking-[0.12em] text-gold uppercase"
              style={{ fontSize: "var(--bento-label)" }}
            >
              {card.label}
            </span>
            <span
              data-essential
              className="shrink-0 font-mono leading-tight font-semibold whitespace-nowrap tabular-nums text-ink"
              style={{ fontSize: "calc(var(--bento-fs) * 1.35)" }}
              title={card.value}
            >
              {card.value}
            </span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div
      className={
        stacked
          ? "grid h-full min-h-0 min-w-0 flex-1 gap-px bg-line"
          : "-mx-[var(--bento-pad)] grid h-full min-w-0 flex-1 gap-px bg-line"
      }
      style={
        stacked
          ? { gridTemplateRows: `repeat(${cards.length}, minmax(0, 1fr))` }
          : { gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }
      }
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
              style={{
                fontSize: stacked
                  ? "var(--bento-value)"
                  : "min(var(--bento-value), calc(var(--bento-row) * 0.45))",
              }}
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
