/** The findings for one selected cell: one check, one model.
 *
 * Fixed height against the viewport with a sticky header, so the band does not
 * resize as the row count changes. The list is windowed — one real model here
 * produced 851 rows — but the spacer carries the full height, so the scrollbar
 * still represents the true row count.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckResult } from "../engine/types";
import { copyOnDoubleClick } from "./copy";
import type { Lang } from "./i18n";
import { reasonText } from "./reasons";
import { checkLabel, t } from "./i18n";
import { STATE_FILL, STATE_GLYPH } from "./state-visuals";

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
const COLUMNS = "23ch 24ch minmax(16ch, 1fr) minmax(28ch, 2fr)";

interface FindingsBandProps {
  lang: Lang;
  fileName: string;
  check: CheckResult;
  onClose: () => void;
}

export function FindingsBand({ lang, fileName, check, onClose }: FindingsBandProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

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

  const rows = check.findings;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(first, last);

  return (
    <section className="flex h-[36vh] shrink-0 flex-col border-t-2 border-line bg-panel">
      <div className="flex shrink-0 items-center gap-3 px-3 py-1.5">
        <span
          className={
            "flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-medium " +
            STATE_FILL[check.state]
          }
        >
          <span className="font-mono font-bold">{STATE_GLYPH[check.state]}</span>
          {t(`state.${check.state}`, lang)}
        </span>
        <span className="text-[13px] font-semibold text-ink">
          {checkLabel(check.id, lang)}
        </span>
        <span
          onDoubleClick={copyOnDoubleClick(fileName)}
          className="cursor-copy font-mono text-[12px] text-gold"
        >
          {fileName}
        </span>
        <span className="font-mono text-[11px] text-muted">{check.detail}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-gold">
            {t("findings.count", lang)}
          </span>
          <span className="font-mono text-[13px] tabular-nums text-ink">{rows.length}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
          >
            {t("findings.close", lang)}
          </button>
        </span>
      </div>

      <div
        className="grid shrink-0 items-center border-y border-line bg-panel px-3 py-1 text-[11px] font-semibold tracking-wider uppercase text-gold"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>{t("findings.guid", lang)}</span>
        <span>{t("findings.entity", lang)}</span>
        <span>{t("findings.name", lang)}</span>
        <span>{t("findings.reason", lang)}</span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto bg-input">
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          {visible.map((finding, index) => {
            const row = first + index;
            return (
              <div
                key={`${finding.guid}-${row}`}
                className="absolute inset-x-0 grid items-center gap-x-2 border-b border-line px-3 text-[12px]"
                style={{
                  top: row * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  gridTemplateColumns: COLUMNS,
                }}
              >
                <span
                  onDoubleClick={copyOnDoubleClick(finding.guid)}
                  className="cursor-copy font-mono text-[12px] text-ink"
                >
                  {finding.guid}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(finding.entity)}
                  className="cursor-copy truncate font-mono text-[12px] text-green"
                >
                  {finding.entity}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(finding.name ?? "")}
                  className="cursor-copy truncate text-ink"
                  title={finding.name ?? undefined}
                >
                  {finding.name}
                </span>
                <span
                  onDoubleClick={copyOnDoubleClick(reasonText(finding, lang))}
                  className="cursor-copy truncate text-muted"
                  title={reasonText(finding, lang)}
                >
                  {reasonText(finding, lang)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
