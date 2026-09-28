/** The facet row of the Typer and Materialer galleries (2026-09-28, data
 *  `facets.ts`).
 *
 * A row on top, not a sidebar, and flat toggle pills, no dropdowns: one pill
 * per facet, which opens its values as a strip of pills under the row (one
 * facet open at a time), each value with its count. A facet with a choice is
 * filled. Ubrukt and Én forekomst are two values only, so they sit in the row
 * as pills of their own. ✕ clears every facet; the one cross filter is not a
 * facet and is left alone.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { anyChosen, facetCounts, NONE, toggle, type ElementFacetId, type FacetId, type FacetItems, type FacetSelection, type FacetValue } from "./facets";

function facetLabel(facet: ElementFacetId, lang: Lang): string {
  switch (facet) {
    case "entity":
      return t("col.class", lang);
    case "system":
      return t("mapping.system-classification", lang);
    case "function":
      return t("facet.function", lang);
    // IFC attribute names, verbatim in both languages as on the card.
    case "ext":
      return "IsExternal";
    case "lb":
      return "LoadBearing";
    case "fire":
      return "FireRating";
  }
}

function valueLabel(facet: FacetId, value: FacetValue, lang: Lang): string {
  if (value.key === NONE) return t("type.none", lang);
  if (facet === "ext" || facet === "lb") return value.key === "true" ? "✓" : value.key === "false" ? "✗" : value.key;
  if (facet === "use") return value.key === "unused" ? t("facet.unused", lang) : t("type.single", lang);
  return value.name ? `${value.key} ${value.name}` : value.key;
}

const PILL = "shrink-0 rounded-full border px-2 py-px text-[11px] ";
const ON = "border-ink bg-ink text-panel";
const OFF = "border-line bg-input text-muted hover:text-ink";

export function FacetBar({
  lang,
  facets,
  items,
  sel,
  onChange,
  lead,
  trail,
  className = "",
}: {
  lang: Lang;
  /** The element facets this gallery offers, in order; `use` adds the two
   *  Typer pills. */
  facets: readonly FacetId[];
  items: FacetItems;
  sel: FacetSelection;
  onChange: (next: FacetSelection) => void;
  /** What sits before the pills and at the far end (the tab's own controls). */
  lead?: ReactNode;
  trail?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState<ElementFacetId | null>(null);
  const groups = facets.filter((f): f is ElementFacetId => f !== "use" && items.values.has(f));
  const shownOpen = open && groups.includes(open) ? open : null;
  const strip = shownOpen ? facetCounts(items, sel, shownOpen) : [];
  const chosenIn = (facet: FacetId) => new Set(sel[facet] ?? []);
  const use = facets.includes("use") ? facetCounts(items, sel, "use") : [];

  return (
    <div className={"shrink-0 px-4 pt-1 " + className} data-facets>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {lead}
        {groups.map((facet) => {
          const n = sel[facet]?.length ?? 0;
          return (
            <button
              key={facet}
              type="button"
              aria-expanded={shownOpen === facet}
              data-facet={facet}
              onClick={() => setOpen(shownOpen === facet ? null : facet)}
              className={PILL + (n > 0 ? ON : shownOpen === facet ? "border-ink bg-input text-ink" : OFF)}
            >
              {facetLabel(facet, lang)}
              {n > 0 ? <span className="ml-1 font-mono tabular-nums">{n}</span> : null}
            </button>
          );
        })}
        {use.map(({ value, n }) => {
          const on = chosenIn("use").has(value.key);
          return (
            <button
              key={value.key}
              type="button"
              aria-pressed={on}
              data-facet-value={`use:${value.key}`}
              onClick={() => onChange(toggle(sel, "use", value.key))}
              className={PILL + (on ? ON : OFF)}
            >
              {valueLabel("use", value, lang)}
              <span className="ml-1 font-mono tabular-nums opacity-70">{formatCount(n, lang)}</span>
            </button>
          );
        })}
        {anyChosen(sel) ? (
          <button
            type="button"
            onClick={() => onChange({})}
            aria-label={t("filter.clear", lang)}
            title={t("filter.clear", lang)}
            className="shrink-0 font-mono text-[11px] font-bold text-muted hover:text-bad"
          >
            ✕
          </button>
        ) : null}
        {trail ? <span className="ml-auto shrink-0">{trail}</span> : null}
      </div>
      {shownOpen ? (
        <div className="mt-1 flex max-h-[3.6rem] flex-wrap gap-1 overflow-auto" data-facet-strip={shownOpen}>
          {strip.map(({ value, n }) => {
            const on = chosenIn(shownOpen).has(value.key);
            const label = valueLabel(shownOpen, value, lang);
            return (
              <button
                key={value.key}
                type="button"
                aria-pressed={on}
                title={value.key === NONE ? label : value.key}
                data-facet-value={`${shownOpen}:${value.key === NONE ? "none" : value.key}`}
                onClick={() => onChange(toggle(sel, shownOpen, value.key))}
                className={
                  "inline-flex max-w-[18rem] min-w-0 items-baseline gap-1 rounded-full border px-1.5 py-px font-mono text-[10px] leading-[14px] " +
                  (on ? ON : "border-line bg-panel/70 text-ink hover:border-ink")
                }
              >
                <span
                  className={
                    "min-w-0 truncate" +
                    (value.kind === "fallback" ? " italic" : "") +
                    (!on && value.kind === "deviating" ? " text-bad" : "") +
                    (!on && (value.kind === "fallback" || value.key === NONE) ? " text-muted" : "")
                  }
                >
                  {label}
                </span>
                <span className="shrink-0 tabular-nums opacity-70">{formatCount(n, lang)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
