/** One dropped file: its name, state and own facts on one line, then, once it
 *  is read, the active filter bar, the tab strip and the active tab, with the
 *  derivation band under it when a number of this model is open.
 *
 * Each stage appears when it becomes real. A file still being read shows its
 * name and its progress and nothing else; a file that failed shows its error in
 * full, named, never folded away.
 *
 * ── Tabs (2026-09-21, Graf added 2026-09-23) ─────────────────────────────
 * edkjo: "a tabbed experience with the lead values and outputs on the first
 * dash, then more nitty gritty on other tabs." Kontroll is the bento board;
 * Innhold is the census and the type ledger; Graf is the selected element's
 * relationships as a node-link diagram (`GraphTab.tsx`). The tab is in the URL
 * hash, so Back/Forward walk it. The filter bar sits ABOVE the strip because a
 * chip belongs to the model, not to a tab: chips persist across tabs. Every
 * tab stays mounted and the inactive ones are hidden, so the 3D scene and its
 * camera survive a trip to Innhold or Graf and back.
 *
 * The derivation band opens under the active tab, pinned to the bottom of the
 * scrolling page at 38.2 % of the screen, so it is in view wherever the number
 * was clicked. The board itself never shrinks for it: the board's height comes
 * from its width and, where the composition allows, from the page height left
 * under it (2026-09-22) — never from what the band takes. The page scrolls.
 *
 * ── Where the cross-filter is joined ─────────────────────────────────────
 * The same click that opens a derivation makes a chip. `onFocus` still does
 * what it did — open the band for that number — and the chip is added beside
 * it, so the board narrows IN PLACE and nothing navigates. The bar sits here,
 * above the tabs and always rendered, because the filter belongs to the model
 * rather than to any one tile, and because a bar that appears only when a
 * filter is on cannot answer "what am I filtered to?".
 */

import { useCallback, useMemo, type ReactNode } from "react";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Focus } from "./trace";
import type { Lang, StringKey } from "./i18n";
import type { Design } from "./useHashView";
import type { FilterChip, Mode, ModelView } from "./cross-filter";
import { chipOf, resolveFilter } from "./cross-filter";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes, formatCount, formatMs } from "./format";
import { census } from "./profile";
import { Contents } from "./Contents";
import { Dashboard } from "./Dashboard";
import { GraphTab } from "./GraphTab";
import { FilterBar } from "./FilterBar";
import { ReadoutStrip, type Readout } from "./forms";
import { BENTO_MAX_WIDTH } from "./bento-spec";
import { aggregateTypes, meshIndex } from "./types";
import type { FloorConfig } from "../engine/storey-config";
import type { FloorPeer } from "./FloorSetup";

export type Tab = "checks" | "contents" | "graph";
const TABS: readonly Tab[] = ["checks", "contents", "graph"];
const TAB_LABEL: Record<Tab, StringKey> = {
  checks: "tab.checks",
  contents: "tab.contents",
  graph: "tab.graph",
};

interface ModelPanelProps {
  lang: Lang;
  /** The visual direction, for the one surface painted in SVG rather than in
   *  classes. */
  design: Design | null;
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
  /** Drop the element refinement when a different set is chosen. */
  onClearElements: () => void;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  /** The ruleset's floor config, or null when none is loaded. */
  floors: FloorConfig[] | null;
  /** Every loaded model's storeys, for the floor tile. */
  peers: FloorPeer[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** The derivation band, when the open number is this model's. */
  trace: ReactNode;
}

export function ModelPanel({
  lang,
  design,
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
  onClearElements,
  onPick,
  onHover,
  floors,
  peers,
  tab,
  onTab,
  trace,
}: ModelPanelProps) {
  const profile = model.profile;
  const facts = useMemo(() => (profile ? census(profile) : null), [profile]);
  const reading = model.state === "queued" || model.state === "parsing";
  const ready = model.state === "ready";

  const filter = useMemo(() => resolveFilter(view.chips, model), [view.chips, model]);

  // One pass over the products per (profile, geometry) change, not per render.
  // Triangles come from the STREAMED mesh, the only place a per-element count
  // exists; batches that have not arrived make the geometry columns UNKNOWN
  // rather than zero.
  const ledger = useMemo(
    () =>
      profile
        ? aggregateTypes(profile, {
            mesh: meshIndex(model.meshBatches),
            meshCapped: model.meshBudget?.capped ?? false,
            // The declared roster is the core's own count; the profile cannot
            // hold it, because an unused type reaches no product row.
            typeObjectsDeclared: model.report?.summary.tables?.type_objects?.loaded
              ? model.report.summary.tables.type_objects.rows
              : null,
          })
        : null,
    [profile, model.meshBatches, model.meshBudget, model.report],
  );

  // This model's column first on the floor tile, then the rest as loaded.
  const ownFirst = useMemo(
    () => [...peers.filter((p) => p.id === model.id), ...peers.filter((p) => p.id !== model.id)],
    [peers, model.id],
  );

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
      // A NUMBER was clicked, so the drill starts over: the element chip from
      // the last one refines a set that is no longer the one on screen, and
      // carried across it would AND to nothing. See `clearElements`.
      onClearElements();
      const chip = chipOf(next, model, lang);
      if (!chip) return;
      // Decide from the CHIPS, not from the open derivation. `selected` is the
      // band's focus, restored from the URL hash, and three paths move the
      // chips without touching it: the chip's own x, Tom filter, and a reload
      // against a stale hash. Once they were out of step, the next click on
      // that row was read as "remove a chip that is not there" and silently
      // did nothing — which is what the owner saw.
      if (view.chips.some((c) => c.key === chip.key)) onRemoveChip(chip.key);
      else onAddChip(chip);
    },
    [lang, model, onAddChip, onClearElements, onFocus, onRemoveChip, view.chips],
  );

  // The file's own facts, on the header line beside name · state · size. They
  // were a 3×2 readout tile on the board, where seven values clipped.
  const report = model.report;
  const fileFacts: Readout[] = report
    ? [
        { label: t("kpi.schema", lang), value: report.summary.schema },
        { label: t("kpi.unit", lang), value: report.summary.length_unit || "—" },
        {
          label: t("kpi.products", lang),
          value: formatCount(report.summary.products, lang),
          onClick: () => focus({ kind: "kpi", kpi: "products" }),
        },
        { label: t("kpi.parseTime", lang), value: formatMs(report.parseMs, lang) },
        { label: t("kpi.project", lang), value: report.summary.project_name ?? "—", text: true },
        {
          label: t("kpi.application", lang),
          value: report.summary.authoring_app ?? "—",
          text: true,
        },
      ]
    : [];

  const rules = hasRuleset
    ? {
        evaluation: model.evaluation,
        evaluating: model.evaluating,
        error: model.evaluationError,
      }
    : undefined;

  return (
    // Convergence is a PAGE property (sprucelab DESIGN.md §2): header, filter
    // bar, tabs and board cap together at the canvas's own cap, so on an
    // ultrawide the file line starts where the board starts.
    <section className="mx-auto flex w-full shrink-0 flex-col gap-2" style={{ maxWidth: BENTO_MAX_WIDTH }}>
      <div className="flex min-w-0 items-baseline gap-3">
        <span
          onDoubleClick={copyOnDoubleClick(model.fileName)}
          className="shrink-0 cursor-copy font-mono text-[13px] font-semibold break-all text-gold"
        >
          {model.fileName}
        </span>
        <span
          className={
            "shrink-0 font-mono text-[11px] " +
            (model.state === "failed" ? "font-semibold text-bad" : "text-muted")
          }
        >
          {t(model.rejected ? "file.rejected" : `file.${model.state}`, lang)}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted">
          {formatBytes(model.sizeBytes, lang)}
        </span>
        {fileFacts.length > 0 ? <ReadoutStrip items={fileFacts} /> : null}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto shrink-0 self-center border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
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

      {ready ? (
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

      {ready && facts && ledger ? (
        <>
          <div role="tablist" className="flex shrink-0 items-end gap-px border-b border-line">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => onTab(id)}
                className={
                  "-mb-px border px-3 py-1 text-[12px] " +
                  (tab === id
                    ? "border-line border-b-panel bg-panel font-medium text-ink"
                    : "border-transparent text-muted hover:text-green")
                }
              >
                {t(TAB_LABEL[id], lang)}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div role="tabpanel" hidden={tab !== "checks"} className="flex flex-col">
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
                floors={floors}
                peers={ownFirst}
                rules={rules}
              />
            </div>
            <div role="tabpanel" hidden={tab !== "contents"} className="flex flex-col">
              <Contents
                lang={lang}
                census={facts}
                ledger={ledger}
                selected={selected}
                onFocus={focus}
              />
            </div>
            {/* Same mounted-and-hidden pattern as the other two: the 3D scene
                on Kontroll must survive a trip here and back. */}
            <div role="tabpanel" hidden={tab !== "graph"} className="flex flex-col">
              <GraphTab
                lang={lang}
                design={design}
                profile={profile ?? null}
                selection={view.selection}
                onPick={onPick}
              />
            </div>
            {/* Pinned to the bottom of the scrolling page while this panel
                spans it, so a number clicked at the top of a tall board opens
                its derivation in view; it takes 38.2 % of the screen and the
                board keeps 61.8 %. At the end of the panel it rests in flow. */}
            {trace ? (
              <div className="sticky bottom-0 z-20 flex h-[38.2dvh] min-h-[16rem] flex-col">
                {trace}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
