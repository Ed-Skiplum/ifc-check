/** The active-filter bar: the ONE filter the board is narrowed to, and how the
 *  narrowing is expressed in 3D.
 *
 * One chip at most (2026-09-28, one origin): the active filter, its kind and
 * label, and its ✕, which clears it. A click elsewhere replaces the chip; it
 * never adds a second one.
 *
 * It rides the right-hand end of the tab strip's line (2026-09-24): on a line
 * of its own it was a band of chrome above the board that said nothing until
 * a click. It never wraps, so the chip appearing moves nothing on the page and
 * the row just clicked is still under the pointer for the click that undoes
 * it.
 *
 * Always rendered, empty or not. The point of the bar is that *"what am I
 * filtered to?"* is answerable at a glance, and a bar that appears only when
 * something is on cannot answer it — you have to already know to look.
 *
 * A row on top, not a sidebar: narrow controls do not earn a permanent column.
 * Chips are flat toggle pills; there are no dropdowns and no accordions. An
 * active mode is a WHOLE-SURFACE colour commitment, never an edge stripe.
 */

import type { ActiveFilter, Mode } from "./cross-filter";
import type { Lang } from "./i18n";
import { t } from "./i18n";

interface FilterBarProps {
  lang: Lang;
  mode: Mode;
  filter: ActiveFilter | null;
  /** The filter's source no longer exists: drawn broken, not dropped. */
  unresolved: boolean;
  /** How many elements the filter resolves to, or `null` with no filter. */
  matchedCount: number | null;
  total: number;
  onMode: (mode: Mode) => void;
  onClear: () => void;
}

export function FilterBar({
  lang,
  mode,
  filter,
  unresolved,
  matchedCount,
  total,
  onMode,
  onClear,
}: FilterBarProps) {
  return (
    <div data-filter-bar className="flex items-center gap-x-2 whitespace-nowrap [&>*]:shrink-0">
      <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
        {t("filter.label", lang)}
      </span>

      <span className="flex">
        <ModeButton
          label={t("filter.mode.filter", lang)}
          active={mode === "filter"}
          onClick={() => onMode("filter")}
        />
        <ModeButton
          label={t("filter.mode.highlight", lang)}
          active={mode === "highlight"}
          onClick={() => onMode("highlight")}
        />
      </span>

      {filter ? (
        <>
          <span
            data-filter-origin={filter.origin}
            className={
              "flex items-center gap-1.5 border px-2 py-0.5 text-[11px] " +
              (unresolved ? "border-bad bg-bad text-cream" : "border-line bg-input text-ink")
            }
          >
            <span className="text-[9px] font-semibold tracking-[0.1em] uppercase opacity-70">
              {t(`filter.kind.${filter.kind}`, lang)}
            </span>
            <span className="font-mono">{filter.label}</span>
            <button
              type="button"
              onClick={onClear}
              aria-label={`${t("filter.clear", lang)} ${filter.label}`}
              title={t("filter.clear", lang)}
              className="font-mono font-bold hover:text-bad"
            >
              ✕
            </button>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {matchedCount === null ? total : matchedCount} / {total}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** Whole-surface fill when active. No accent stripe, on any edge, ever. */
function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "border px-2 py-0.5 text-[11px] " +
        (active
          ? "border-green bg-green text-cream"
          : "border-line bg-input text-ink hover:bg-palegreen")
      }
    >
      {label}
    </button>
  );
}
