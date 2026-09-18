/** One dropped file: its name and state, then, once it is read, the active
 *  filter bar, the dashboard and — only if a ruleset is loaded — the rule strip.
 *
 * Each stage appears when it becomes real. A file still being read shows its
 * name and its progress and nothing else; a file that failed shows its error in
 * full, named, never folded away.
 *
 * ── Where the cross-filter is joined ─────────────────────────────────────
 * The same click that opens a derivation makes a chip. `onFocus` still does
 * what it did — open the band for that number — and the chip is added beside
 * it, so the board narrows IN PLACE and nothing navigates. The bar sits here,
 * above the grid and always rendered, because the filter belongs to the model
 * rather than to any one tile, and because a bar that appears only when a
 * filter is on cannot answer "what am I filtered to?".
 */

import { useCallback, useMemo } from "react";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import type { FilterChip, Mode, ModelView } from "./cross-filter";
import { chipOf, resolveFilter } from "./cross-filter";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes } from "./format";
import { census } from "./profile";
import { Dashboard } from "./Dashboard";
import { FilterBar } from "./FilterBar";
import { RuleStrip } from "./RuleStrip";

interface ModelPanelProps {
  lang: Lang;
  model: ModelEntry;
  hasRuleset: boolean;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  onRemove: () => void;
  view: ModelView;
  onMode: (mode: Mode) => void;
  onAddChip: (chip: FilterChip) => void;
  onRemoveChip: (key: string) => void;
  onClearChips: () => void;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
}

export function ModelPanel({
  lang,
  model,
  hasRuleset,
  claims,
  selected,
  onFocus,
  onRemove,
  view,
  onMode,
  onAddChip,
  onRemoveChip,
  onClearChips,
  onPick,
  onHover,
}: ModelPanelProps) {
  const profile = model.profile;
  const facts = useMemo(() => (profile ? census(profile) : null), [profile]);
  const reading = model.state === "queued" || model.state === "parsing";

  const filter = useMemo(() => resolveFilter(view.chips, model), [view.chips, model]);

  /** One click, two consequences, kept in step.
   *
   * `onFocus` opens the derivation for this number, or CLOSES it when the same
   * number is already open. The chip follows that same decision, so a chip is
   * present exactly while its derivation is — clicking A, then B, then A again
   * cannot leave the band showing A while the filter has dropped it. A chip can
   * still outlive its band, by design: the ✕ is the only other way off, and
   * closing the band by its own Close button leaves the filter alone. */
  const focus = useCallback(
    (next: Focus) => {
      onFocus(next);
      const chip = chipOf(next, model, lang);
      if (!chip) return;
      if (selected === chip.key) onRemoveChip(chip.key);
      else onAddChip(chip);
    },
    [lang, model, onAddChip, onFocus, onRemoveChip, selected],
  );

  return (
    <section className="flex h-full min-h-0 shrink-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <span
          onDoubleClick={copyOnDoubleClick(model.fileName)}
          className="cursor-copy font-mono text-[13px] font-semibold break-all text-gold"
        >
          {model.fileName}
        </span>
        <span
          className={
            "font-mono text-[11px] " +
            (model.state === "failed" ? "font-semibold text-bad" : "text-muted")
          }
        >
          {t(model.rejected ? "file.rejected" : `file.${model.state}`, lang)}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {formatBytes(model.sizeBytes, lang)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
        >
          {t("action.remove", lang)}
        </button>
      </div>

      {reading ? (
        <div className="h-1 w-full overflow-hidden bg-line">
          <div
            className={model.state === "parsing" ? "ifc-sweep h-full w-1/3 bg-green" : "h-full w-0"}
          />
        </div>
      ) : null}

      {model.error ? (
        <pre
          onDoubleClick={copyOnDoubleClick(model.error)}
          className="m-0 cursor-copy bg-bad px-2.5 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream"
        >
          {model.error}
        </pre>
      ) : null}

      {model.state === "ready" ? (
        <FilterBar
          lang={lang}
          mode={view.mode}
          chips={view.chips}
          unresolved={filter.unresolved}
          matchedCount={filter.matched?.size ?? null}
          total={profile?.rows.length ?? 0}
          onMode={onMode}
          onRemove={onRemoveChip}
          onClear={onClearChips}
        />
      ) : null}

      {facts && model.state === "ready" ? (
        <Dashboard
          lang={lang}
          model={model}
          census={facts}
          claims={claims}
          selected={selected}
          onFocus={focus}
          view={view}
          matched={filter.matched}
          onPick={onPick}
          onHover={onHover}
        />
      ) : null}

      {hasRuleset && model.state === "ready" ? (
        <RuleStrip
          lang={lang}
          evaluation={model.evaluation}
          evaluating={model.evaluating}
          evaluationError={model.evaluationError}
          selected={selected}
          onFocus={focus}
        />
      ) : null}
    </section>
  );
}
