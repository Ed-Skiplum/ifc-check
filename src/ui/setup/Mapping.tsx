/** The one mapping layout every mapping step draws (2026-10-05). edkjo: "We
 *  want a certain kind of information. We map it from property A by default.
 *  But we might want to map it from property B. We need to see this in a
 *  clear UI anyway: What we're mapping to + what we're currently mapping
 *  from + options for mapping" · "and, of course: if there are any quality
 *  requirements to the value itself. Mapping is the infrastructure, not the
 *  validity check."
 *
 * Four zones, always present, always in the same place:
 *
 *   TO ← FROM │ OPTIONS   the mapping, read left to right; stacked top to
 *                         bottom on a narrow screen (and in a popover), the
 *                         arrow then ↑
 *   requirement           what the mapped value itself must satisfy, on its
 *                         own surface under the mapping; «Ingen» is a state
 *
 * The result splits the same way and is never one number: MAPPED (elements
 * carrying FROM, of the models' products) sits in FROM, VALID (values
 * passing the requirement) in the requirement zone. A pick in OPTIONS
 * changes FROM; only «Bruk» confirms and moves on.
 *
 * Zones carry no headers but the requirement's «Krav»: position, the arrow
 * and the content name them.
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_FILL } from "../state-visuals";
import type { ExtractPreview } from "../extract-preview";
import type { PsetProp } from "../pset-choices";
import { StateChip, TotalChips } from "./chips";

/** A zone's or a figure's label: small caps, but read at arm's length (it
 *  was 10 px and went unread, 2026-10-05). */
export const LABEL = "text-[12px] font-semibold tracking-[0.1em] text-gold uppercase";

/** A step's name: the decision on screen, the screen's lead. */
export const STEP_TITLE = "m-0 text-[34px] leading-[1.1] font-semibold tracking-tight break-words hyphens-auto text-ink";

/** The entry to fixing the answer («Endre»): quiet beside an answer that
 *  works, the screen's lead when it gives nothing on the loaded models. */
export const fixClass = (lead: boolean) =>
  lead
    ? "w-fit border-2 border-ink bg-panel px-4 py-2 text-[14px] font-semibold text-ink hover:border-green hover:text-green"
    : "w-fit border border-line px-3 py-1 text-[12px] text-ink hover:border-green hover:text-green";

export function Figure({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={LABEL}>{label}</span>
      <span className={"px-1 font-mono text-[13px] tabular-nums " + (bad ? VERDICT_FILL.fail : "text-ink")}>{value}</span>
    </span>
  );
}

export const of = (part: number, whole: number | null, lang: Lang) =>
  whole === null ? formatCount(part, lang) : `${formatCount(part, lang)} / ${formatCount(whole, lang)}`;

/** FROM's look: a source the models carry, one they lack (`0 / N`), none. */
export type FromState = "found" | "missing" | "empty";

const FROM_LOOK: Record<FromState, string> = {
  found: "border-line",
  missing: "border-bad",
  empty: "border-dashed border-line",
};

export function MappingLayout({
  to,
  from,
  fromState,
  fromKey,
  options,
  editor,
  requirement,
  compact = false,
  lang,
}: {
  lang: Lang;
  to: ReactNode;
  from: ReactNode;
  fromState: FromState;
  /** Changes with the source FROM shows, so a new one lands as one. */
  fromKey?: string;
  /** Absent: the zone is not drawn (a step with nothing to choose from). */
  options?: ReactNode;
  /** The full picker, opened from OPTIONS: under the mapping, full width. */
  editor?: ReactNode;
  /** Absent: no requirement zone (TFM: its builder is the step's lead). */
  requirement?: ReactNode;
  /** Stacked, smaller: inside a chip's popover. */
  compact?: boolean;
}) {
  return (
    <div data-mapping className={"flex min-w-0 flex-col " + (compact ? "gap-2" : "gap-4")}>
      <div
        data-mapping-row
        className={
          compact
            ? "flex flex-col gap-2"
            : options
              ? // TO is never narrower than its longest word: «Prosesstatuskode»
                // broke mid-word at 1440 (rendered 2026-10-05).
                "grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(min-content,0.8fr)_auto_minmax(0,1fr)_minmax(0,1.3fr)]"
              : "grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(min-content,0.8fr)_auto_minmax(0,1fr)]"
        }
      >
        {/* Top-aligned: the step's name sits at the same place on every
            step, and FROM is as tall as what it holds. */}
        <div data-zone="to" className="flex min-w-0 flex-col gap-1">
          {to}
        </div>
        <div aria-hidden="true" className={"flex items-center justify-center text-2xl leading-none text-muted " + (compact ? "" : "md:pt-5")}>
          {compact ? (
            "↑"
          ) : (
            <>
              <span className="md:hidden">↑</span>
              <span className="hidden md:inline">←</span>
            </>
          )}
        </div>
        <div
          key={fromKey}
          data-zone="from"
          data-from={fromState}
          className={
            "pick-in flex min-w-0 flex-col gap-2 border-2 bg-panel " +
            (compact ? "p-3 " : "p-4 ") +
            FROM_LOOK[fromState]
          }
        >
          {from}
        </div>
        {options ? (
          <div data-zone="options" className="flex min-w-0 flex-col gap-2">
            {options}
          </div>
        ) : null}
      </div>
      {editor}
      {requirement !== undefined ? (
        <div data-zone="requirement" className={"flex flex-col gap-3 border border-line bg-input " + (compact ? "p-3" : "p-4")}>
          <span className={LABEL}>{t("field.requirement", lang)}</span>
          {requirement}
        </div>
      ) : null}
    </div>
  );
}

/** TO: the information wanted, by its name, and the form the standard gives
 *  its value (2341.001), as data. The name is the step's heading; a branch
 *  of a step (Produkt, Materiale) is `h2`, a chip's binding `compact`. */
export function ToZone({
  name,
  form,
  as = "h1",
  compact = false,
}: {
  name: string;
  form?: string;
  as?: "h1" | "h2";
  compact?: boolean;
}) {
  return (
    <>
      {compact ? (
        <span className="text-[15px] font-medium text-ink">{name}</span>
      ) : as === "h2" ? (
        <h2 className="m-0 text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] text-ink">{name}</h2>
      ) : (
        <h1 className={STEP_TITLE}>{name}</h1>
      )}
      {form ? <span data-to-form className={"font-mono text-muted " + (compact ? "text-[13px]" : "text-[16px]")}>{form}</span> : null}
    </>
  );
}

/** FROM: the source raw (`Pset.Name`, or the attribute), its origin tag,
 *  and MAPPED. With nothing mapped, a dash: the zone stays. */
export function FromSource({
  tag,
  head,
  title,
  mapped,
  samples,
  children,
}: {
  /** «Standard», «Regelsett», or none (a candidate, a hand pick). */
  tag?: string | null;
  /** The source kind where it is not a property (Attributt). */
  head?: string;
  /** The source raw; null: nothing mapped. A cascade gives its lines. */
  title: ReactNode | null;
  mapped?: ReactNode;
  /** A few of the source's real values, most frequent first: what FROM
   *  actually holds, so a date or an area reads as one at a glance. */
  samples?: readonly string[];
  children?: ReactNode;
}) {
  return (
    <>
      {tag || head ? (
        <span className="flex flex-wrap items-baseline gap-2">
          {tag ? <span className={LABEL}>{tag}</span> : null}
          {head ? <span className="font-mono text-[12px] text-muted">{head}</span> : null}
        </span>
      ) : null}
      <div className={"flex flex-col font-mono text-[15px] leading-snug [overflow-wrap:anywhere] " + (title === null ? "text-muted" : "text-ink")}>
        {title ?? "–"}
      </div>
      {samples && samples.length > 0 ? (
        <span data-samples className="flex flex-wrap gap-1">
          {samples.slice(0, 5).map((v) => (
            <span key={v} className="max-w-48 truncate bg-input px-1.5 py-0.5 font-mono text-[12px] text-ink">
              {v}
            </span>
          ))}
        </span>
      ) : null}
      {mapped}
      {children}
    </>
  );
}

/** MAPPED: elements carrying the source, of the elements the step's rule
 *  selects (`walk-selection.ts`), named so; red at 0 unless `neutral` (an
 *  absent source that is no fault: Duplikat objekt, blank is own). */
export function Mapped({
  n,
  total,
  neutral = false,
  label,
  lang,
}: {
  n: number;
  total: number | null;
  neutral?: boolean;
  /** What the whole is, where it is not the walk's selection: the report
   *  row's own class (the standard layer counts IfcProduct). */
  label?: string;
  lang: Lang;
}) {
  return <Figure label={label ?? t("walk.selected", lang)} value={of(n, total, lang)} bad={n === 0 && !neutral} />;
}

/** One thing FROM could be. */
export interface MapOption {
  key: string;
  tag?: string | null;
  head?: string;
  title: string;
  /** Its MAPPED count, as data. */
  count?: ReactNode;
  current: boolean;
  onPick: () => void;
}

/** OPTIONS: a listbox, the current one filled; ↑ ↓ move, Enter or a click
 *  picks (FROM changes, nothing moves on). `more` is the entry to any other
 *  source: the full picker, «Endre». */
export function OptionList({
  options,
  label,
  more,
  lang,
  children,
}: {
  options: readonly MapOption[];
  label: string;
  /** `lead`: the answer gives nothing, so «Endre» leads the screen. */
  more?: { open: boolean; onToggle: () => void; lead?: boolean };
  lang: Lang;
  /** Above the list: reading, «Ingen treff». */
  children?: ReactNode;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex((o) => o.current));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const now = refs.current.findIndex((el) => el === document.activeElement);
    const from = now < 0 ? at : now;
    const next = event.key === "ArrowDown" ? Math.min(from + 1, options.length - 1) : Math.max(from - 1, 0);
    refs.current[next]?.focus();
  };
  return (
    <>
      {children}
      {options.length > 0 ? (
        <div role="listbox" aria-label={label} data-options onKeyDown={onKey} className="flex flex-col gap-1">
          {options.map((o, i) => (
            <button
              key={o.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={o.current}
              tabIndex={i === at ? 0 : -1}
              data-option={o.key}
              onClick={o.onPick}
              className={
                "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-panel " +
                // Selected by outline and weight, never by a status colour
                // (a green fill carried a red 0 / 84, 2026-10-05).
                (o.current
                  ? "border-2 border-ink bg-panel font-semibold text-ink"
                  : "border-2 border-transparent bg-panel text-ink outline-1 -outline-offset-2 outline-line hover:outline-green")
              }
            >
              {o.tag ? (
                <span className="shrink-0 text-[11px] font-semibold tracking-[0.1em] text-gold uppercase">
                  {o.tag}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">
                {o.head ? <span className="opacity-70">{o.head} </span> : null}
                {o.title}
              </span>
              {o.count}
            </button>
          ))}
        </div>
      ) : null}
      {more ? (
        <button
          type="button"
          data-source-edit
          aria-expanded={more.open}
          onClick={more.onToggle}
          className={fixClass(more.lead === true)}
        >
          {t("action.change", lang)}
        </button>
      ) : null}
    </>
  );
}

/** An option's MAPPED count: `n / N`, red at 0. */
export function OptionCount({
  n,
  total,
  current,
  neutral = false,
  lang,
}: {
  n: number;
  total: number | null;
  current: boolean;
  neutral?: boolean;
  lang: Lang;
}) {
  return (
    <span className={"shrink-0 px-1 font-mono text-[12px] tabular-nums " + (n === 0 && !neutral ? VERDICT_FILL.fail : current ? "" : "text-muted")}>
      {of(n, total, lang)}
    </span>
  );
}

/** VALID: the distinct values passing the requirement, of the distinct
 *  values; the elements per state; and (`failing`) up to five values off it,
 *  the state each takes. */
export function Valid({
  prop,
  preview,
  failing = true,
  total = null,
  lang,
}: {
  prop: PsetProp;
  preview: ExtractPreview;
  failing?: boolean;
  /** The elements the rule selects: those carrying no value are counted as
   *  the report counts them, «mangler», so the chips add up to it. */
  total?: number | null;
  lang: Lang;
}) {
  const listed = prop.values.reduce((n, v) => n + v.n, 0);
  const okValues = preview.rows.filter((r) => r.state === "ok").length;
  const off = failing ? preview.rows.filter((r) => r.state !== "ok").slice(0, 5) : [];
  const missing = total === null ? 0 : Math.max(0, total - prop.valued);
  return (
    <div data-valid className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Figure
          label={t("field.values", lang)}
          value={`${formatCount(okValues, lang)} / ${prop.exact ? "" : "≥"}${formatCount(prop.distinct, lang)}`}
          bad={okValues === 0 && prop.distinct > 0}
        />
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={LABEL}>{t("walk.selected", lang)}</span>
          <TotalChips preview={preview} rest={Math.max(0, prop.valued - listed)} lang={lang} />
          {missing > 0 ? (
            <span data-missing className="inline-flex items-center gap-1.5 border border-line px-2 py-0.5 font-mono text-[12px] tabular-nums text-ink">
              <span>{formatCount(missing, lang)}</span>
              <span className="font-sans">{t("req.mangler", lang)}</span>
            </span>
          ) : null}
        </span>
      </div>
      {off.length > 0 ? (
        <span data-failing className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {off.map((r) => (
            <span key={r.v} className="inline-flex min-w-0 items-center gap-1.5">
              <StateChip state={r.state} lang={lang} />
              <span className="max-w-56 truncate font-mono text-[12px] text-ink">{r.v}</span>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
