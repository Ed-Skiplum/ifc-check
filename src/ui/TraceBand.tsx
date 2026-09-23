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
 * see that."* So a row click is not only a selection: it also narrows the
 * cross-filter to that one element, through an `element` chip on the model's
 * own filter bar. Under "Vis kun" the scene is then that element alone, which
 * is the "see that" half. Clicking the same row again drops the chip and the
 * scene is the set the row was drilled from; the chip's ✕ and Tøm filter do
 * what they always did.
 *
 * This is the one place a single element narrows the scene. A pick in the 3D
 * tile still only highlights — a click that hid what the pointer was over
 * would make the scene unusable for the thing it is for.
 *
 * A row click NEVER moves the camera. That is a stated rule, and the two
 * controls that do move it are named buttons on the tile — `Zoom til valg`
 * lights up the moment a row is picked, because an isolated element can be
 * small or off screen and that is the next click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Trace } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { reasonText } from "./reasons";
import { RESULT_FILL, RESULT_GLYPH, VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
const COLUMNS = "23ch 26ch minmax(16ch, 1fr) minmax(28ch, 2fr)";

interface TraceBandProps {
  lang: Lang;
  trace: Trace;
  /** GUIDs selected in this model, whichever side selected them. */
  selection: string[];
  hover: string | null;
  /** Select AND isolate this row's element; same row again steps back out. */
  onPick: (guid: string, name: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  onClose: () => void;
}

export function TraceBand({
  lang,
  trace,
  selection,
  hover,
  onPick,
  onHover,
  onClose,
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
    const top = latestAt * ROW_HEIGHT;
    if (top >= element.scrollTop && top + ROW_HEIGHT <= element.scrollTop + element.clientHeight) {
      return;
    }
    element.scrollTop = Math.max(0, top - element.clientHeight / 2 + ROW_HEIGHT / 2);
  }, [latestAt]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
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
            <span className="font-mono text-[11px] leading-snug text-muted">{trace.detail}</span>
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

      <div
        className="grid shrink-0 items-center border-y border-line bg-panel px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>{t("col.guid", lang)}</span>
        <span>{t("col.class", lang)}</span>
        <span>{t("col.name", lang)}</span>
        <span>{t("col.reason", lang)}</span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto bg-input">
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          {visible.map((row, index) => {
            const at = first + index;
            const reason = row.code
              ? reasonText({ ...row, code: row.code, reason: row.reason ?? "" }, lang)
              : (row.reason ?? "");
            const picked = chosen.has(row.guid);
            const lit = hover === row.guid;
            return (
              <div
                key={`${row.guid}-${at}`}
                data-guid={row.guid}
                onClick={(event) =>
                  onPick(row.guid, row.name, event.shiftKey || event.ctrlKey || event.metaKey)
                }
                onMouseEnter={() => onHover(row.guid)}
                onMouseLeave={() => onHover(null)}
                // Whole-surface colour, never an edge stripe: ink for the
                // selection (the same ink the scene draws its edges in), gold
                // for the hover (the same gold the scene hovers in), so the
                // pairing is legible rather than merely true.
                className={
                  "absolute inset-x-0 grid cursor-pointer items-center gap-x-2 border-b border-line px-3 text-[12px] " +
                  (picked ? "bg-ink text-cream" : lit ? "bg-gold/40" : "hover:bg-palegreen")
                }
                style={{
                  top: at * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  gridTemplateColumns: COLUMNS,
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
                  className={"cursor-copy truncate font-mono text-[12px] " + (picked ? "" : "text-green")}
                >
                  {row.entity}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(row.name ?? "")}
                  className="cursor-copy truncate"
                  title={row.name ?? undefined}
                >
                  {row.name}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(reason)}
                  className={"cursor-copy truncate " + (picked ? "" : "text-muted")}
                  title={reason}
                >
                  {reason}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
