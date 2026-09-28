/** The report's requirements on the board. In use (2026-09-28): `ReqCard`,
 *  the Overview's KPI card, and `ReqBlock`, the report's own block (the
 *  narrow fallback's list and `Standardkrav.tsx`). `ReqRow`, `ReqPanel` and
 *  `ReqSection` were designs a and c; no board mounts them now, they stay
 *  for the project tab to pick from. Every figure is a field of the requirement's report row
 *  (`requirements.ts`); nothing is computed here but a percentage of two of
 *  its counts.
 *
 *  What each shows is what the report block shows (HI90
 *  `docs/rapport-rammeverk.md`, "The block"): the status, the dekning with
 *  the sources it was read «fra», and the fordeling. Labels are the report's
 *  (`docs/begreper.md`). */

import type { ReactNode } from "react";
import type { ReportRow, ReportState, ReportValue } from "../../engine/report";
import type { Verdict } from "../../engine/types";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { ModelEntry } from "../useModels";
import type { Requirement } from "../requirements";
import { t } from "../i18n";
import { serialiseFocus } from "../trace";
import { formatCount } from "../format";
import { figures, mmiBars, orderedValues, secondFigure, stateLook, uniqueCount, valueFocus } from "./req-view";

export interface DoorProps {
  lang: Lang;
  model: ModelEntry;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}

/* ── status ─────────────────────────────────────────────────────────────── */

export function StateBadge({ state, lang }: { state: ReportState; lang: Lang }) {
  const look = stateLook(state, lang);
  return (
    <span data-verdict={look.verdict} data-state={state} className="alt-badge shrink-0">
      <span aria-hidden>{look.glyph}</span> {look.word}
    </span>
  );
}

/* ── figures ────────────────────────────────────────────────────────────── */

/* ── the «fra» line ─────────────────────────────────────────────────────── */

export function Sources({ row, lang }: { row: ReportRow; lang: Lang }) {
  const kilder = row.dekning.kilder;
  if (kilder.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
      <span className="alt-label shrink-0">{t("req.fra", lang)}</span>
      {kilder.map((k) => (
        <span key={`${k.gren ?? ""}${k.navn}`} className="flex min-w-0 items-baseline gap-1.5" title={k.navn}>
          <span className="alt-src shrink-0">{t(`req.lag.${k.lag}`, lang)}</span>
          <span className="truncate font-mono text-ink">{k.navn}</span>
          <span className="shrink-0 font-mono tabular-nums text-muted">{k.n === null ? "—" : formatCount(k.n, lang)}</span>
        </span>
      ))}
    </span>
  );
}

/* ── the fordeling ──────────────────────────────────────────────────────── */

const FLAG_VERDICT: Record<string, Verdict | undefined> = { avvik: "warn", mangler: "fail" };

function valueText(v: ReportValue, lang: Lang): string {
  if (v.verdi === null) return t("req.mangler", lang);
  return v.verdi === "" ? "—" : v.verdi;
}

export function Values({
  req,
  max,
  wrap = true,
  ...door
}: DoorProps & { req: Requirement; max: number; wrap?: boolean }) {
  const row = req.row;
  if (!row || !row.fordeling || row.fordeling.length === 0) return null;
  const all = orderedValues(req);
  const shown = all.slice(0, max);
  const rest = all.length - shown.length;
  return (
    <span className={"flex min-w-0 items-center gap-1.5 " + (wrap ? "flex-wrap" : "overflow-hidden")}>
      {shown.map((v) => (
        <ValueChip key={String(v.verdi)} row={row} value={v} {...door} />
      ))}
      {rest > 0 ? (
        <span className="shrink-0 font-mono text-[11px] text-muted">{`+${formatCount(rest, door.lang)}`}</span>
      ) : null}
    </span>
  );
}

function ValueChip({ row, value, lang, model, selected, onFocus }: DoorProps & { row: ReportRow; value: ReportValue }) {
  const focus = valueFocus(row, value.verdi, model);
  const verdict = value.flagg === "åpen" ? undefined : FLAG_VERDICT[value.flagg];
  const chosen = focus !== null && selected === serialiseFocus(focus);
  const inner = (
    <>
      <span className="truncate">{valueText(value, lang)}</span>
      <span className="shrink-0 tabular-nums opacity-70">{`×${formatCount(value.n, lang)}`}</span>
    </>
  );
  const cls =
    "alt-value flex max-w-full min-w-0 shrink-0 items-center gap-1 font-mono text-[11px] " +
    (value.flagg === "åpen" ? "alt-value-open " : "") +
    (chosen ? "alt-chosen " : "");
  return focus ? (
    <button
      type="button"
      data-verdict={verdict}
      data-value-door=""
      title={`${valueText(value, lang)} ×${value.n}`}
      className={cls + "alt-hover"}
      onClick={() => onFocus(focus)}
    >
      {inner}
    </button>
  ) : (
    <span data-verdict={verdict} title={`${valueText(value, lang)} ×${value.n}`} className={cls}>
      {inner}
    </span>
  );
}

/** The open rulings of Materiale / Produkt, as the report prints them. */
function Open({ row, lang }: { row: ReportRow; lang: Lang }) {
  if (!row.aapne || row.aapne.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px]">
      <span className="alt-label shrink-0">{t("req.aapen", lang)}</span>
      {row.aapne.map((a) => (
        <span key={a.tittel} className="font-mono text-ink">
          {a.tittel}
          {a.n === null ? "" : ` ×${formatCount(a.n, lang)}`}
        </span>
      ))}
    </span>
  );
}

/** The engine's reason, where the row was not answered. Data, not prose. */
function Why({ row, wrap = false }: { row: ReportRow | null; wrap?: boolean }) {
  if (!row?.grunn || row.state === "not_configured") return null;
  return (
    <span className={(wrap ? "break-words" : "truncate") + " font-mono text-[11px] text-muted"} title={row.grunn}>
      {row.grunn}
    </span>
  );
}

function HeadButton({
  req,
  children,
  className,
  selected,
  onFocus,
}: {
  req: Requirement;
  children: ReactNode;
  className: string;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const chosen = req.focus !== null && selected === serialiseFocus(req.focus);
  if (!req.focus) {
    return (
      <div data-req={req.key} className={className}>
        {children}
      </div>
    );
  }
  const focus = req.focus;
  return (
    <button
      type="button"
      data-req={req.key}
      onClick={() => onFocus(focus)}
      className={`${className} alt-hover ${chosen ? "alt-chosen" : ""}`}
    >
      {children}
    </button>
  );
}

/* ── a: the dense list row ──────────────────────────────────────────────── */

export function ReqRow({ req, ...door }: DoorProps & { req: Requirement }) {
  const { lang } = door;
  const f = figures(req, lang);
  const second = secondFigure(req, lang);
  const row = req.row;
  return (
    <div className="alt-req flex shrink-0 flex-col border-b border-line">
      <HeadButton
        req={req}
        selected={door.selected}
        onFocus={door.onFocus}
        className="flex h-8 w-full min-w-0 shrink-0 items-center gap-2 px-3 text-left"
      >
        <StateBadge state={req.state} lang={lang} />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{t(req.label, lang)}</span>
        {f ? (
          <span className="ml-auto flex shrink-0 items-baseline gap-2">
            {f.label ? <span className="alt-label">{t(f.label, lang)}</span> : null}
            {req.distribution ? null : (
              <span data-essential className="font-mono text-[14px] font-semibold tabular-nums">
                {f.figure}
              </span>
            )}
            {f.of ? <span className="font-mono text-[11px] tabular-nums text-muted">{f.of}</span> : null}
          </span>
        ) : null}
      </HeadButton>
      {row && row.state !== "not_configured" ? (
        <div className="flex min-w-0 flex-col gap-1 px-3 pb-2">
          <Why row={row} />
          {second ? (
            <span className="flex items-baseline gap-2 text-[11px]">
              <span className="alt-label">{second.label}</span>
              <span className="font-mono font-semibold tabular-nums">{second.figure}</span>
              <span className="font-mono tabular-nums text-muted">{second.of}</span>
            </span>
          ) : null}
          <Sources row={row} lang={lang} />
          <Open row={row} lang={lang} />
          <Values req={req} max={req.distribution ? 12 : 6} {...door} />
        </div>
      ) : null}
    </div>
  );
}

/* ── b: the report's block ──────────────────────────────────────────────── */

export function ReqBlock({ req, index, ...door }: DoorProps & { req: Requirement; index: number }) {
  const { lang } = door;
  const f = figures(req, lang);
  const second = secondFigure(req, lang);
  const row = req.row;
  const look = stateLook(req.state, lang);
  const line = (label: string, body: ReactNode) => (
    <div className="grid min-w-0 grid-cols-[9ch_minmax(0,1fr)] items-baseline gap-2">
      <span className="alt-label truncate">{label}</span>
      <div className="min-w-0">{body}</div>
    </div>
  );
  return (
    <div className="alt-block grid shrink-0 grid-cols-[56px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2.5">
      <HeadButton
        req={req}
        selected={door.selected}
        onFocus={door.onFocus}
        className="alt-square flex h-14 w-14 flex-col items-center justify-center gap-0.5"
      >
        <span data-verdict={look.verdict} data-state={req.state} className="alt-square-fill flex h-full w-full flex-col items-center justify-center rounded-[8px]">
          <span aria-hidden className="font-mono text-[18px] leading-none font-bold">{look.glyph}</span>
          <span className="px-0.5 text-center text-[8px] leading-tight font-semibold uppercase">{look.word}</span>
        </span>
      </HeadButton>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted">{index}</span>
          <span className="truncate text-[14px] font-semibold text-ink">{t(req.label, lang)}</span>
        </span>
        {row && row.state !== "not_configured" ? (
          <>
            <Why row={row} />
            {f
              ? line(
                  f.label ? "" : t("req.dekning", lang),
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    {req.distribution ? null : (
                      <span data-essential className="font-mono text-[18px] leading-none font-semibold tabular-nums">
                        {f.figure}
                      </span>
                    )}
                    {f.label ? <span className="alt-label">{t(f.label, lang)}</span> : null}
                    {f.of ? <span className="font-mono text-[11px] tabular-nums text-muted">{f.of}</span> : null}
                  </span>,
                )
              : null}
            {second
              ? line(
                  second.label,
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] font-semibold tabular-nums">{second.figure}</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted">{second.of}</span>
                  </span>,
                )
              : null}
            {row.dekning.kilder.length > 0 ? <Sources row={row} lang={lang} /> : null}
            <Open row={row} lang={lang} />
            {row.fordeling && row.fordeling.length > 0
              ? line(
                  t("req.fordeling", lang),
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-mono text-[11px] text-muted">{uniqueCount(req, lang)}</span>
                    <Values req={req} max={req.distribution ? 12 : 5} {...door} />
                  </span>,
                )
              : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ── c: the panel ───────────────────────────────────────────────────────── */

export function ReqPanel({ req, ...door }: DoorProps & { req: Requirement }) {
  const { lang } = door;
  const f = figures(req, lang);
  const row = req.row;
  return (
    <div className="alt-stat alt-sized flex h-full min-h-0 min-w-0 flex-col gap-1 px-3 py-2">
      <HeadButton
        req={req}
        selected={door.selected}
        onFocus={door.onFocus}
        className="-mx-1 flex min-w-0 flex-col items-start gap-1 rounded-[6px] px-1 py-0.5 text-left"
      >
        <span className="w-full min-w-0 truncate text-[12px] font-semibold text-ink" title={t(req.label, lang)}>
          {t(req.label, lang)}
        </span>
        <StateBadge state={req.state} lang={lang} />
        {f && !req.distribution ? (
          <span data-essential className="max-w-full truncate font-mono text-[20px] leading-none font-semibold tabular-nums">
            {f.figure}
          </span>
        ) : null}
        {f?.label ? <span className="alt-label w-full truncate">{t(f.label, lang)}</span> : null}
        {f?.of ? <span className="w-full truncate font-mono text-[11px] tabular-nums text-muted">{f.of}</span> : null}
      </HeadButton>
      {row && row.state !== "not_configured" ? (
        <div className="flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden">
          <Why row={row} />
          <Values req={req} max={4} wrap={false} {...door} />
        </div>
      ) : null}
    </div>
  );
}

/* ── a: the KPI band (2026-09-26) ───────────────────────────────────────────
 *
 * Owner: "add a row of KPI cards at the top rather than the dense left
 * sidebar that needs scrolling". One S card per requirement where the row
 * seats eleven; else one card per report section with its requirements as
 * compact rows. The whole card (or row) is the requirement's door, as the
 * list row's head was. MMI is never a single number (begreper.md §7): the
 * owner's «Statuskode ikke konfigurert», or a mini distribution. */

/** The MMI levels as a row of tiny columns, off-scale values flagged. */
function MiniDist({ req, lang }: { req: Requirement; lang: Lang }) {
  const bars = mmiBars(req);
  if (bars.length === 0) return null;
  const peak = Math.max(1, ...bars.map((b) => b.n));
  return (
    <span data-mmi="mini" className="flex h-full min-h-[18px] min-w-0 items-end gap-[2px]">
      {bars.map((bar) => (
        <span
          key={String(bar.value)}
          title={`${bar.value === null ? t("req.mangler", lang) : bar.value} ×${bar.n}`}
          data-verdict={bar.flag === "avvik" ? "warn" : bar.flag === "mangler" ? "fail" : undefined}
          className="alt-bar block w-[6px] min-w-[3px] shrink"
          style={{ height: `${bar.n === 0 ? 0 : Math.max(8, (bar.n / peak) * 100)}%` }}
        />
      ))}
    </span>
  );
}

function MmiReading({ req, lang, wrap = false }: { req: Requirement; lang: Lang; wrap?: boolean }) {
  if (!req.row || req.state === "not_configured")
    return (
      <span className={(wrap ? "break-words leading-tight" : "truncate") + " text-[11px] text-muted"}>{t("mmi.notConfigured", lang)}</span>
    );
  return <MiniDist req={req} lang={lang} />;
}

/** One requirement, an S card: the Overview's KPI row (2026-09-28). Nothing
 *  in it is cut: the name, the «av» line and the second reading wrap, the
 *  figure is one unbroken line. */
export function ReqCard({ req, ...door }: DoorProps & { req: Requirement }) {
  const { lang } = door;
  const f = figures(req, lang);
  const second = secondFigure(req, lang);
  return (
    <HeadButton
      req={req}
      selected={door.selected}
      onFocus={door.onFocus}
      className="alt-stat alt-sized flex h-full min-h-0 w-full min-w-0 flex-col items-start gap-1.5 px-3 py-2.5 text-left"
    >
      <span className="w-full min-w-0 text-[13px] leading-tight font-semibold break-words text-ink">{t(req.label, lang)}</span>
      <StateBadge state={req.state} lang={lang} />
      <span className="mt-auto flex w-full min-w-0 flex-col gap-0.5">
        {req.distribution ? (
          <span className="flex h-9 w-full min-w-0 items-end">
            <MmiReading req={req} lang={lang} wrap />
          </span>
        ) : f ? (
          <>
            <span className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2">
              <span data-essential className="font-mono text-[22px] leading-none font-semibold whitespace-nowrap tabular-nums">
                {f.figure}
              </span>
              {f.label ? <span className="alt-label">{t(f.label, lang)}</span> : null}
            </span>
            {f.of ? <span className="w-full font-mono text-[11px] leading-snug break-words tabular-nums text-muted">{f.of}</span> : null}
          </>
        ) : (
          <Why row={req.row} wrap />
        )}
        {second ? (
          <span className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 pt-1 text-[11px] leading-snug">
            <span className="alt-label">{second.label}</span>
            <span data-essential className="font-mono font-semibold whitespace-nowrap tabular-nums">{second.figure}</span>
            {second.of ? <span className="font-mono whitespace-nowrap tabular-nums text-muted">{second.of}</span> : null}
          </span>
        ) : null}
      </span>
    </HeadButton>
  );
}

/** One report section, an M or L card: its requirements as compact rows,
 *  each its own door. Rows share the height; nothing scrolls. */
export function ReqSection({ reqs, ...door }: DoorProps & { reqs: Requirement[] }) {
  const { lang } = door;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col py-1">
      {reqs.map((req) => {
        const f = figures(req, lang);
        return (
          <HeadButton
            key={req.key}
            req={req}
            selected={door.selected}
            onFocus={door.onFocus}
            className="flex min-h-0 w-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={t(req.label, lang)}>
              {t(req.label, lang)}
            </span>
            {req.distribution ? (
              <span className="flex h-[18px] max-w-[60%] min-w-0 shrink items-end justify-end gap-1.5">
                {req.state === "not_configured" ? (
                  <span data-verdict={stateLook(req.state, lang).verdict} data-state={req.state} className="alt-lamp shrink-0">
                    {stateLook(req.state, lang).glyph}
                  </span>
                ) : (
                  <StateBadge state={req.state} lang={lang} />
                )}
                <MmiReading req={req} lang={lang} />
              </span>
            ) : (
              <>
                <StateBadge state={req.state} lang={lang} />
                <span data-essential className="w-[7ch] shrink-0 text-right font-mono text-[13px] font-semibold whitespace-nowrap tabular-nums">
                  {f ? f.figure : ""}
                </span>
              </>
            )}
          </HeadButton>
        );
      })}
    </div>
  );
}
