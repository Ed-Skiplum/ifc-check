/** The Overview's classification codes (2026-09-30, edkjo: *"in the main page
 *  I want to know what classification codes are present, but no need to show
 *  anything weighted"*): per system the file carries, its codes as chips of
 *  one weight, sorted by code. Presence only, never a count or a size.
 *
 *  A chip is a door like any board number: the tile is the origin (the chosen
 *  code keeps its highlight, the rest dim), every other view isolates to the
 *  code's elements. Under a filter from another view the tile isolates too:
 *  only the codes the matching elements carry. A code outside its system's
 *  bundled list takes the facet pills' deviating colour. */

import { useMemo } from "react";
import { t } from "../i18n";
import { serialiseFocus, type Focus } from "../trace";
import { useSelectionMarks } from "../selection-context";
import { classificationCodes } from "../class-codes";
import type { DoorProps } from "./Requirements";

export function ClassCodes({ iso = null, ...door }: DoorProps & { iso?: Set<string> | null }) {
  const { lang, model, selected, onFocus } = door;
  const marks = useSelectionMarks();
  const systems = useMemo(() => classificationCodes(model.profile, iso), [model.profile, iso]);
  if (systems === null) {
    return (
      <div data-codes="absent" className="px-3 py-2 font-mono text-[11px] text-muted">
        {`classificationsJson() · ${t("type.notSupplied", lang)}`}
      </div>
    );
  }
  if (systems.length === 0) {
    return (
      <div data-codes="none" className="px-3 py-2 text-[12px] text-muted">
        {t("type.none", lang)}
      </div>
    );
  }
  return (
    <div data-codes="list" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
      {systems.map(({ system, codes }) => (
        <div key={system ?? "\u0000"} data-code-system={system ?? ""} className="flex shrink-0 flex-col gap-1">
          <span className="alt-label truncate" title={system ?? "—"}>
            {system ?? "—"}
          </span>
          <div className="flex flex-wrap gap-1">
            {codes.map((c) => {
              const focus: Focus = { kind: "code", system, code: c.code };
              const chosen = selected === serialiseFocus(focus);
              return (
                <button
                  key={c.code}
                  type="button"
                  data-code={c.code}
                  data-sel={marks.size > 0 && marks.focus(focus) ? "" : undefined}
                  title={[system, c.code || "—", c.name].filter(Boolean).join(" · ")}
                  onClick={() => onFocus(focus)}
                  className={
                    "alt-hover inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-full border border-line px-1.5 py-px text-left text-[11px] leading-[16px] " +
                    (chosen ? "alt-chosen" : "")
                  }
                >
                  <span className={"shrink-0 font-mono font-semibold" + (c.known === false ? " text-bad" : "")}>{c.code || "—"}</span>
                  {c.name ? <span className="min-w-0 truncate text-ink">{c.name}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
