/** One dropped file: its name, state and own facts on one line, then, once it
 *  is read, the active filter bar, the tab strip and the active tab, with the
 *  derivation band under it when a number of this model is open.
 *
 * Each stage appears when it becomes real. A file still being read shows its
 * name and its progress and nothing else; a file that failed shows its error in
 * full, named, never folded away.
 *
 * ── Tabs (2026-09-21) ────────────────────────────────────────────────────
 * edkjo: "a tabbed experience with the lead values and outputs on the first
 * dash, then more nitty gritty on other tabs." Kontroll is the bento board;
 * Innhold is the census and the type ledger. The tab is in the URL hash, so
 * Back/Forward walk it. The filter bar sits ABOVE the strip because a chip
 * belongs to the model, not to a tab: chips persist across tabs. Both tabs
 * stay mounted and the inactive one is hidden, so the 3D scene and its camera
 * survive a trip to Innhold and back.
 *
 * The derivation band opens under the active tab and takes 38.2 % of the
 * panel body, so the tab keeps 61.8 %. It used to take 38vh of the page from
 * below and shrink every tile on the board.
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
import type { Lang } from "./i18n";
import type { FilterChip, Mode, ModelView } from "./cross-filter";
import { chipOf, resolveFilter } from "./cross-filter";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes, formatCount, formatMs } from "./format";
import { census } from "./profile";
import { Contents } from "./Contents";
import { Dashboard } from "./Dashboard";
import { FilterBar } from "./FilterBar";
import { ReadoutStrip, type Readout } from "./forms";
import { aggregateTypes, meshIndex } from "./types";
import type { FloorConfig } from "../engine/storey-config";
import type { FloorPeer } from "./FloorSetup";

export type Tab = "checks" | "contents";
const TABS: readonly Tab[] = ["checks", "contents"];

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
          })
        : null,
    [profile, model.meshBatches, model.meshBudget],
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
    [lang, model, onAddChip, onFocus, onRemoveChip, view.chips],
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
    <section className="flex h-full min-h-0 shrink-0 flex-col gap-2">
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
                {t(id === "checks" ? "tab.checks" : "tab.contents", lang)}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div
              role="tabpanel"
              hidden={tab !== "checks"}
              className="flex min-h-0 flex-[1.618] flex-col"
            >
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
            <div
              role="tabpanel"
              hidden={tab !== "contents"}
              className="flex min-h-0 flex-[1.618] flex-col"
            >
              <Contents
                lang={lang}
                census={facts}
                ledger={ledger}
                selected={selected}
                onFocus={focus}
              />
            </div>
            {trace ? <div className="flex min-h-0 flex-1 flex-col">{trace}</div> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
