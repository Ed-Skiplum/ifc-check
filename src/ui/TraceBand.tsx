/** The derivation behind whatever number is open.
 *
 * It opens under the active tab of its model's panel and takes a fixed 38.2 %
 * of that panel's body (`ModelPanel`), so the tab keeps 61.8 %: opening it
 * costs table rows, never page height, and the band does not resize as the
 * row count changes. The list is
 * windowed — one real model produced 851 rows — but the spacer carries the
 * full height, so the scrollbar still represents the true row count.
 *
 * The header is the derivation itself: the state, the arithmetic, the engine's
 * own factual line, the reason a verdict could not be reached, and the
 * evaluator's caveats. A `not_evaluable` rule reads as `not_evaluable` here,
 * never as a pass.
 *
 * ── The rows are the other half of the selection ─────────────────────────
 * This list and the 3D tile show one selection from two sides. Clicking a row
 * selects its mesh; picking a mesh scrolls this list to that row and fills it.
 * Hovering either lights the other, because shared identity alone is not a
 * visible link — you have to be able to SEE which one it is.
 *
 * ── And the second step of the drill ─────────────────────────────────────
 * edkjo: *"so you click to see rejected instances, then select an instance and
 * see that."* A row click SELECTS that instance: highlighted and framed in
 * the 3D, its info in the object panel. The filter the list came from stays
 * as it was (2026-09-29, `filter-state.ts`: a selection never changes the
 * filter), and so does the list. The same row again keeps it; Esc on the
 * canvas clears it. A pick in the 3D is the same selection.
 *
 * A row click frames what it picked, like every selection: "always frame the
 * selected object. pivot on it and frame it." (edkjo, 2026-09-28). The viewer
 * does that on the selection change (`ModelScene.followChoice`), not here.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Trace } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { detailText } from "./display";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { ObjectPanel } from "./ObjectPanel";
import type { ModelEntry } from "./useModels";
import { reasonText } from "./reasons";
import { RESULT_FILL, RESULT_GLYPH, VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";
import { IfcosControl } from "./IfcosControl";
import { BODY_NO_MESH_FOCUS, ifcosVerdictText, useIfcosRun } from "./ifcos-verify";
import { asButton } from "./keys";

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
/** The GUID column is never cut: a GUID is an identifier and half of one
 *  identifies nothing. The other three were cut when the object panel took
 *  38.2 % of the band (2026-09-23), so the four columns still fit the narrowest
 *  box the app ships in (the 1100 px skiplum.com iframe) without the row list
 *  acquiring a sideways scroll. All three ellipsize by design and carry their
 *  full text in `title`. The columns themselves are built per derivation by
 *  `columnsFor` below. */

/** The list's share of the band, from what its rows actually carry
 *  (2026-09-24). It was a fixed 61.8 %, which at 2000 px left half of every
 *  row empty while the object panel beside it ellipsized its type names. Now
 *  the class column is as wide as the longest class (12–22ch), name and reason
 *  split what remains in proportion to their longest text, and the list takes
 *  what those need, never less than 50 % and never more than the 61.8 % it
 *  had. The object panel takes the rest: 38.2 % to 50 %. The floor is what
 *  keeps the four columns legal in the 1100 px skiplum.com iframe; the
 *  ceiling is the old split, so no box gets a narrower list than before. */
function columnsFor(rows: { entity: string; name: string | null }[], reasons: string[]) {
  let entity = 0;
  let name = 0;
  let reason = 0;
  rows.forEach((row, i) => {
    entity = Math.max(entity, row.entity.length);
    name = Math.max(name, row.name?.length ?? 0);
    reason = Math.max(reason, reasons[i].length);
  });
  // GUID and class are set in mono and the grid's `ch` is the 12 px SANS
  // digit, which is narrower: a mono character is about 1.1 sans `ch`. The
  // GUID column was 23ch and its 22 mono characters ran into the class column
  // with no gap; it is 25ch now, and the class column is its longest name
  // scaled the same way.
  const classCh = Math.min(24, Math.max(12, Math.ceil(entity * 1.12) + 1));
  const nameCh = Math.min(64, Math.max(12, name));
  const reasonCh = Math.min(96, Math.max(20, reason));
  return {
    columns: `25ch ${classCh}ch minmax(12ch, ${nameCh}fr) minmax(20ch, ${reasonCh}fr)`,
    // four columns, three 0.5rem gaps and the px-3 either side
    width: `clamp(50%, calc(${25 + classCh + nameCh + reasonCh}ch + 3rem), 61.8%)`,
    // Alone (Scope): one line while the GUID, the class and the name are
    // whole and the reason keeps 20ch; the columns sized to them.
    aloneColumns: `25ch ${classCh}ch ${nameCh}ch minmax(20ch, 1fr)`,
    aloneCh: 25 + classCh + nameCh + 20,
  };
}

/** A two-line row (Scope under its one-line width): the GUID and the reason
 *  on the first line, the class and the name on the second. */
const ROW_HEIGHT_TWO = 44;
/** The two-line row's first line: the whole GUID, the reason the rest. */
const TWO_LINE_COLUMNS = "25ch minmax(0, 1fr)";

interface TraceBandProps {
  lang: Lang;
  trace: Trace;
  /** The whole model entry: the object panel beside the table reads the file's
   *  profile AND the streamed mesh (its derived group measures geometry). */
  model: ModelEntry;
  /** GUIDs selected in this model, whichever side selected them. */
  selection: string[];
  hover: string | null;
  /** Select AND isolate this row's element; same row again steps back out. */
  onPick: (guid: string, name: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  onClose: () => void;
  /** The list OVER the object panel instead of beside it: for a band docked
   *  in a tall, narrow inspector (`#design=a` on a wide screen), where side by
   *  side would cut both. Absent, the band is laid out as it always was. */
  stack?: boolean;
  /** The list alone, no object panel beside it: the Scope panel of the design
   *  alternatives, where the object panel is its own docked Detail panel. */
  alone?: boolean;
  /** Scope is the cross-filter's origin (a row was picked here): every row
   *  stays, the picked ones highlighted and the rest dimmed. */
  origin?: boolean;
}

export function TraceBand({
  lang,
  trace,
  model,
  selection,
  hover,
  onPick,
  onHover,
  onClose,
  stack = false,
  alone = false,
  origin = false,
}: TraceBandProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const chosen = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    setScrollTop(scroller.current?.scrollTop ?? 0);
  }, []);

  const rows = trace.rows;
  // `body-no-mesh`: ifcopenshell's verdict per element, once it has run.
  const ifcos = useIfcosRun(model.id);
  const verdicts = trace.focus === BODY_NO_MESH_FOCUS ? ifcos?.verdicts : undefined;
  const reasons = useMemo(
    () =>
      rows.map((row) => {
        const reason = row.code
          ? reasonText({ ...row, code: row.code, reason: row.reason ?? "" }, lang)
          : (row.reason ?? "");
        const verdict = verdicts ? ifcosVerdictText(verdicts[row.guid], lang) : "";
        return verdict ? `${reason} · ${verdict}` : reason;
      }),
    [rows, lang, verdicts],
  );
  const fitted = useMemo(() => columnsFor(rows, reasons), [rows, reasons]);
  // Alone, the list has the panel to itself and may be narrow (a Scope tile
  // of 3 or 4 modules). Where it seats the content's one-line need
  // (`columnsFor`: the GUID, the class and the name whole, the reason 20ch
  // or more), one line in those columns; under it, two lines: the GUID and
  // the reason, then the class and the name (2026-09-30: at 324 px the one
  // line read `Ifc… Ba… !`). The GUID is never cut in either.
  const list = useRef<HTMLDivElement>(null);
  const chProbe = useRef<HTMLSpanElement>(null);
  const [listPx, setListPx] = useState(0);
  const [chPx, setChPx] = useState(0);
  useLayoutEffect(() => {
    if (!alone) return;
    const element = list.current;
    const probe = chProbe.current;
    if (!element || !probe) return;
    const measure = () => {
      setListPx(element.clientWidth);
      setChPx(probe.getBoundingClientRect().width / 100);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [alone]);
  // The four columns' ch, three 0.5rem gaps and the px-3 either side (3rem).
  const twoLine = alone && listPx > 0 && chPx > 0 && listPx < fitted.aloneCh * chPx + 48;
  const rowHeight = twoLine ? ROW_HEIGHT_TWO : ROW_HEIGHT;
  const { columns, width } = alone ? { columns: fitted.aloneColumns, width: "100%" } : fitted;
  // A row that carries a reason IS a finding of the open check or rule, so its
  // reason is drawn in the focal's verdict cell: the same fill and glyph the
  // row above had, read the same way down here (2026-09-24).
  const findingFill = trace.verdict
    ? VERDICT_FILL[trace.verdict]
    : trace.state
      ? RESULT_FILL[trace.state]
      : null;
  const findingGlyph = trace.verdict
    ? VERDICT_GLYPH[trace.verdict]
    : trace.state
      ? RESULT_GLYPH[trace.state]
      : null;

  /* Scroll the most recently selected row into view — the "pick in scene ⇄
     scroll + highlight the row" half of the link. Computed as an OFFSET rather
     than via `scrollIntoView` on a node: the list is windowed, so the row that
     needs scrolling to is usually not in the DOM yet. Skipped when the row is
     already visible, so clicking a row never yanks the list under the cursor. */
  const latest = selection.length > 0 ? selection[selection.length - 1] : null;
  const latestAt = useMemo(
    () => (latest === null ? -1 : rows.findIndex((row) => row.guid === latest)),
    [latest, rows],
  );
  useEffect(() => {
    if (latestAt < 0) return;
    const element = scroller.current;
    if (!element) return;
    const top = latestAt * rowHeight;
    if (top >= element.scrollTop && top + rowHeight <= element.scrollTop + element.clientHeight) {
      return;
    }
    element.scrollTop = Math.max(0, top - element.clientHeight / 2 + rowHeight / 2);
  }, [latestAt, rowHeight]);

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );
  const visible = rows.slice(first, last);

  return (
    <section className="flex h-full min-h-0 flex-col border-t-2 border-line bg-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        {trace.state ? (
          <span
            className={
              "flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium " +
              RESULT_FILL[trace.state]
            }
          >
            <span className="font-mono font-bold">{RESULT_GLYPH[trace.state]}</span>
            {t(`result.${trace.state}`, lang)}
          </span>
        ) : null}

        {trace.verdict ? (
          <span
            className={
              "flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium " +
              VERDICT_FILL[trace.verdict]
            }
          >
            <span className="font-mono font-bold">{VERDICT_GLYPH[trace.verdict]}</span>
            {t(`verdict.${trace.verdict}`, lang)}
          </span>
        ) : null}

        {trace.titleKey ? (
          <span className="text-[11px] font-semibold tracking-[0.12em] text-gold uppercase">
            {t(trace.titleKey, lang)}
          </span>
        ) : null}
        {trace.titleText ? (
          <span className="text-[13px] font-semibold text-ink">{trace.titleText}</span>
        ) : null}

        <span
          onDoubleClick={copyOnDoubleClick(trace.fileName)}
          className="cursor-copy font-mono text-[12px] text-gold"
        >
          {trace.fileName}
        </span>

        {trace.stats.map((stat) => (
          <span key={stat.label} className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              {t(stat.label, lang)}
            </span>
            <span className="font-mono text-[12px] tabular-nums text-ink">
              {formatCount(stat.value, lang)}
            </span>
          </span>
        ))}

        {trace.focus === BODY_NO_MESH_FOCUS ? <IfcosControl lang={lang} model={model} /> : null}

        <button
          type="button"
          onClick={onClose}
          className="ml-auto border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
        >
          {t("findings.close", lang)}
        </button>
      </div>

      {trace.detail || trace.reason || trace.notes.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-1 px-3 pb-1.5">
          {trace.detail ? (
            <span className="font-mono text-[11px] leading-snug text-muted">
              {trace.detailLine ? detailText(trace.detailLine, lang, trace.detail) : trace.detail}
            </span>
          ) : null}
          {trace.reason ? (
            <span className="flex w-fit items-start gap-1.5 bg-gold px-2 py-0.5 font-mono text-[11px] leading-snug text-ink">
              <span className="font-bold">?</span>
              <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">
                {t("trace.reason", lang)}
              </span>
              <span>{trace.reason}</span>
            </span>
          ) : null}
          {trace.notes.map((note) => (
            <span
              key={note}
              className="flex w-fit items-start gap-1.5 border border-line bg-input px-2 py-0.5 font-mono text-[11px] leading-snug text-ink"
            >
              <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                {t("trace.notes", lang)}
              </span>
              <span>{note}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* The split follows the rows' content (`columnsFor`): the list takes
          50 % to 61.8 %, the object panel the rest. The band's own height is
          unchanged; this costs table WIDTH, never rows. */}
      <div className={stack ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1"}>
      <div
        className={
          stack
            ? "relative flex min-h-0 min-w-0 flex-1 flex-col text-[12px]"
            : "relative flex min-h-0 min-w-0 shrink-0 flex-col text-[12px]"
        }
        style={stack ? undefined : { width }}
        data-scope-list={alone ? "" : undefined}
        data-scope-rows={alone ? (twoLine ? "two" : "one") : undefined}
        ref={list}
      >
      {alone ? (
        <span aria-hidden className="pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden">
          <span ref={chProbe} className="block text-[12px]" style={{ width: "100ch" }} />
        </span>
      ) : null}
      {twoLine ? (
        <div className="shrink-0 border-y border-line bg-panel px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          <div className="grid items-center gap-x-2" style={{ gridTemplateColumns: TWO_LINE_COLUMNS }}>
            <span className="truncate">{t("col.guid", lang)}</span>
            <span className="truncate">{t("col.reason", lang)}</span>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <span className="shrink-0">{t("col.class", lang)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{t("col.name", lang)}</span>
          </div>
        </div>
      ) : (
      <div
        // The same `gap-x-2` the rows carry, or every header after the first
        // sits left of the column it names by the accumulated gaps. And the
        // rows' 12 px type on the grid itself, so its `ch` columns are the
        // rows' `ch` columns; the labels are set small inside them.
        className="grid shrink-0 items-center gap-x-2 border-y border-line bg-panel px-3 py-1 text-[12px] font-semibold tracking-[0.12em] text-gold uppercase"
        style={{ gridTemplateColumns: columns }}
      >
        <span className="truncate text-[10px]">{t("col.guid", lang)}</span>
        <span className="truncate text-[10px]">{t("col.class", lang)}</span>
        <span className="truncate text-[10px]">{t("col.name", lang)}</span>
        <span className="truncate text-[10px]">{t("col.reason", lang)}</span>
      </div>
      )}

      <div ref={scroller} onScroll={onScroll} data-xf={origin ? "origin" : undefined} className="min-h-0 flex-1 overflow-auto bg-input">
        <div style={{ height: rows.length * rowHeight, position: "relative" }}>
          {visible.map((row, index) => {
            const at = first + index;
            const reason = reasons[at];
            const picked = chosen.has(row.guid);
            const lit = hover === row.guid;
            const reasonCell =
              reason && findingFill ? (
                <span
                  onDoubleClick={copyOnDoubleClick(reason)}
                  className={`flex h-[${ROW_HEIGHT - 6}px] min-w-0 cursor-copy items-center gap-1.5 px-2 ${findingFill}`}
                  title={reason}
                >
                  <span className="shrink-0 font-mono font-bold">{findingGlyph}</span>
                  <span className="truncate">{reason}</span>
                </span>
              ) : (
                <span
                  onDoubleClick={copyOnDoubleClick(reason)}
                  className="cursor-copy truncate text-muted"
                  title={reason}
                >
                  {reason}
                </span>
              );
            if (twoLine)
              return (
                <div
                  key={`${row.guid}-${at}`}
                  data-guid={row.guid}
                  data-chosen={picked ? "" : undefined}
                  data-sel={picked ? "" : undefined}
                  onClick={(event) =>
                    onPick(row.guid, row.name, event.shiftKey || event.ctrlKey || event.metaKey)
                  }
                  onMouseEnter={() => onHover(row.guid)}
                  onMouseLeave={() => onHover(null)}
                  className={
                    "absolute inset-x-0 flex cursor-pointer flex-col justify-center gap-0.5 border-b border-line px-3 text-[12px] " +
                    (picked ? "" : lit ? "bg-gold/40" : "hover:bg-palegreen")
                  }
                  style={{ top: at * rowHeight, height: rowHeight }}
                >
                  <div className="grid min-w-0 items-center gap-x-2" style={{ gridTemplateColumns: TWO_LINE_COLUMNS }}>
                    {/* Never truncated. */}
                    <span onDoubleClick={copyOnDoubleClick(row.guid)} className="cursor-copy font-mono text-[12px]">
                      {row.guid}
                    </span>
                    {reasonCell}
                  </div>
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      onDoubleClick={copyOnDoubleClick(row.entity)}
                      title={row.entity}
                      className="shrink-0 cursor-copy font-mono text-[12px] text-green"
                      data-scope-class
                    >
                      {row.entity}
                    </span>
                    {row.name ? (
                      <>
                        <span aria-hidden className="text-muted">·</span>
                        <span
                          onDoubleClick={copyOnDoubleClick(row.name)}
                          className="min-w-0 cursor-copy truncate"
                          title={row.name}
                          data-scope-name
                        >
                          {row.name}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            return (
              <div
                key={`${row.guid}-${at}`}
                data-guid={row.guid}
                data-chosen={picked ? "" : undefined}
                data-sel={picked ? "" : undefined}
                onClick={(event) =>
                  onPick(row.guid, row.name, event.shiftKey || event.ctrlKey || event.metaKey)
                }
                {...asButton(() => onPick(row.guid, row.name, false))}
                onMouseEnter={() => onHover(row.guid)}
                onMouseLeave={() => onHover(null)}
                // Whole-surface colour, never an edge stripe: the selection
                // mark (`data-sel`, the teal the scene selects in), gold for
                // the hover (the same gold the scene hovers in), so the
                // pairing is legible rather than merely true.
                className={
                  "absolute inset-x-0 grid cursor-pointer items-center gap-x-2 border-b border-line px-3 text-[12px] " +
                  (picked ? "" : lit ? "bg-gold/40" : "hover:bg-palegreen")
                }
                style={{
                  top: at * rowHeight,
                  height: rowHeight,
                  gridTemplateColumns: columns,
                }}
              >
                {/* Never truncated. A GUID is an identifier, and half of one
                    identifies nothing. */}
                <span
                  onDoubleClick={copyOnDoubleClick(row.guid)}
                  className="cursor-copy font-mono text-[12px]"
                >
                  {row.guid}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(row.entity)}
                  title={row.entity}
                  className="cursor-copy truncate font-mono text-[12px] text-green"
                  data-scope-class
                >
                  {row.entity}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(row.name ?? "")}
                  className="cursor-copy truncate"
                  title={row.name ?? undefined}
                  data-scope-name
                >
                  {row.name}
                </span>
                {reasonCell}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {alone ? null : (
        <div className={stack ? "h-1/2 min-h-0 min-w-0 shrink-0 border-t border-line" : "min-h-0 min-w-0 flex-1"}>
          <ObjectPanel lang={lang} model={model} selection={selection} />
        </div>
      )}
      </div>
    </section>
  );
}
