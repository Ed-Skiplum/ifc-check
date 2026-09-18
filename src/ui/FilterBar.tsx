/** The active-filter bar: what the board is narrowed to, and how the narrowing
 *  is expressed in 3D.
 *
 * Always rendered, empty or not. The point of the bar is that *"what am I
 * filtered to?"* is answerable at a glance, and a bar that appears only when
 * something is on cannot answer it — you have to already know to look.
 *
 * A row on top, not a sidebar: narrow controls do not earn a permanent column.
 * Chips are flat toggle pills; there are no dropdowns and no accordions. An
 * active mode is a WHOLE-SURFACE colour commitment, never an edge stripe.
 */

import type { FilterChip, Mode } from "./cross-filter";
import type { Lang } from "./i18n";
import { t } from "./i18n";

interface FilterBarProps {
  lang: Lang;
  mode: Mode;
  chips: FilterChip[];
  /** Chips whose source no longer exists — drawn as broken rather than
   *  quietly dropped. */
  unresolved: string[];
  /** How many elements the filter resolves to, or `null` with no filter. */
  matchedCount: number | null;
  total: number;
  onMode: (mode: Mode) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}

export function FilterBar({
  lang,
  mode,
  chips,
  unresolved,
  matchedCount,
  total,
  onMode,
  onRemove,
  onClear,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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

      {chips.map((chip) => {
        const broken = unresolved.includes(chip.key);
        return (
          <span
            key={chip.key}
            className={
              "flex items-center gap-1.5 border px-2 py-0.5 text-[11px] " +
              (broken ? "border-bad bg-bad text-cream" : "border-line bg-input text-ink")
            }
          >
            <span className="text-[9px] font-semibold tracking-[0.1em] uppercase opacity-70">
              {t(`filter.kind.${chip.kind}`, lang)}
            </span>
            <span className="font-mono">{chip.label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip.key)}
              aria-label={`${t("filter.remove", lang)} ${chip.label}`}
              title={t("filter.remove", lang)}
              className="font-mono font-bold hover:text-bad"
            >
              ✕
            </button>
          </span>
        );
      })}

      {chips.length > 0 ? (
        <>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {matchedCount === null ? total : matchedCount} / {total}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="border border-line bg-input px-2 py-0.5 text-[11px] text-ink hover:border-green hover:text-green"
          >
            {t("filter.clear", lang)}
          </button>
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
