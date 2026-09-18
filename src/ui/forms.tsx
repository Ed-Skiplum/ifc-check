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

import type { ReactNode } from "react";
import type { IfcSummary } from "../engine/types";
import type { ClassCount, StoreyFact } from "./profile";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount, formatElevation, formatShare } from "./format";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";

const PAD = "px-[var(--bento-pad)]";

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={
        "sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

/* ------------------------------------------------------------ the gauge */

/**
 * Project → Site → Building → Storey, against the target IFC itself declares.
 *
 * A gauge answers "how far vs a declared target", and this is the one target
 * on the screen that no project has to state: the spatial decomposition is
 * what IFC IS. The fifth bar is the elements that reached a storey, which is
 * the same chain one level further down.
 */
export function SpatialGauge({
  lang,
  levels,
  contained,
  onFocus,
}: {
  lang: Lang;
  levels: { level: string; size: number }[];
  contained: { good: number; total: number };
  onFocus: (focus: Focus) => void;
}) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-1 overflow-auto pb-[var(--bento-pad)] ${PAD}`}>
      {levels.map((level) => {
        const present = level.size > 0;
        return (
          <span
            key={level.level}
            className={
              "flex items-center gap-2 px-2 py-0.5 " +
              (present ? VERDICT_FILL.pass : VERDICT_FILL.fail)
            }
          >
            <span className="font-mono text-[12px] font-bold">
              {present ? VERDICT_GLYPH.pass : VERDICT_GLYPH.fail}
            </span>
            <span className="truncate font-mono text-[11px]">{level.level}</span>
            <span className="ml-auto font-mono text-[12px] font-semibold tabular-nums">
              {formatCount(level.size, lang)}
            </span>
          </span>
        );
      })}

      {/* The chain one level down: how much of the model actually reached a
          storey. A bar rather than a lamp, because it is a proportion. */}
      <button
        type="button"
        onClick={() => onFocus({ kind: "check", checkId: "storey-containment" })}
        className="mt-auto flex flex-col gap-1 border border-line bg-input px-2 py-1 text-left hover:bg-palegreen"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {t("check.storey-containment", lang)}
          </span>
          <span className="ml-auto font-mono text-[12px] tabular-nums text-ink">
            {formatCount(contained.good, lang)} / {formatCount(contained.total, lang)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {formatShare(contained.good, contained.total, lang)}
          </span>
        </span>
        <span className="h-1.5 w-full bg-line">
          <span
            className="block h-full bg-green"
            style={{
              width:
                contained.total > 0
                  ? `${(contained.good / contained.total) * 100}%`
                  : "0%",
            }}
          />
        </span>
      </button>
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
            "relative flex h-6 w-full items-center justify-between gap-2 border-b border-line px-2 text-left hover:bg-palegreen " +
            (selected === `class:${klass.entity}` ? "outline-2 -outline-offset-2 outline-ink" : "")
          }
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-green/15"
            style={{ width: peak > 0 ? `${(klass.count / peak) * 100}%` : "0%" }}
          />
          <span className="relative truncate font-mono text-[11px] text-ink">{klass.entity}</span>
          <span className="relative shrink-0 font-mono text-[11px] tabular-nums text-ink">
            {formatCount(klass.count, lang)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ the roster */

/** The storeys, by identity: name, kote, how many elements sit there.
 *
 * The gold marker on a shared elevation is the same fact the `storey-elevation`
 * verdict carries; it is kept here because the verdict says THAT storeys
 * collide and this says WHICH.
 */
export function StoreyRoster({
  lang,
  storeys,
  summary,
}: {
  lang: Lang;
  storeys: StoreyFact[];
  summary: IfcSummary;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <Th>{t("col.name", lang)}</Th>
            <Th right>{t("col.elevation", lang)}</Th>
            <Th right>{t("col.elements", lang)}</Th>
          </tr>
        </thead>
        <tbody>
          {storeys.map((storey) => (
            <tr key={storey.guid}>
              {/* A storey with no name falls back to its GlobalId, which is
                  never truncated — so it renders mono and full. */}
              <td
                onDoubleClick={copyOnDoubleClick(storey.name ?? storey.guid)}
                title={storey.name ?? undefined}
                className={
                  "h-6 cursor-copy border-b border-line px-2 text-[12px] text-ink " +
                  (storey.name === null ? "font-mono text-[11px]" : "max-w-0 truncate")
                }
              >
                {storey.name ?? storey.guid}
              </td>
              <td className="h-6 border-b border-line p-0 text-right">
                {storey.sharedWith > 1 ? (
                  <span
                    title={t("storey.shared", lang)}
                    className="flex h-6 items-center justify-end gap-1.5 bg-gold px-2 font-mono text-[11px] tabular-nums text-ink"
                  >
                    <span className="font-bold">!</span>
                    {formatElevation(
                      storey.elevation,
                      summary.unit_scale,
                      summary.unit_resolved,
                      lang,
                    )}
                    <span className="font-semibold">×{storey.sharedWith}</span>
                  </span>
                ) : (
                  <span className="block px-2 font-mono text-[11px] tabular-nums text-ink">
                    {formatElevation(
                      storey.elevation,
                      summary.unit_scale,
                      summary.unit_resolved,
                      lang,
                    )}
                  </span>
                )}
              </td>
              <td className="h-6 border-b border-line px-2 text-right font-mono text-[11px] tabular-nums text-ink">
                {formatCount(storey.elements, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

/** The same pairs on one line, for a 1-row strip that has no header rule. */
export function ReadoutStrip({ items }: { items: Readout[] }) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-x-3 overflow-hidden">
      {items.map((item) => (
        <span key={item.label} className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {item.label}
          </span>
          <span
            onDoubleClick={copyOnDoubleClick(item.value)}
            title={item.value}
            className="cursor-copy truncate text-[12px] text-ink"
          >
            {item.value}
          </span>
        </span>
      ))}
    </div>
  );
}
