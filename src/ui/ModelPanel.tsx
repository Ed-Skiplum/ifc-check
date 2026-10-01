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
 * hash, so Back/Forward walk it. The filter bar sits on the strip's line, outside the tab panels, because a
 * filter belongs to the model, not to a tab: it persists across tabs. Every
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
 * ONE filter per model, one origin (`filter-state.ts`, edkjo 2026-09-28:
 * *"Original: Highlight, everything else: Isolate"*). Every click here names
 * the view it came from; the reducer replaces the filter and Scope's list in
 * one step. A click on one object only selects it; the filter stays. Every
 * view below is handed the same resolved set (`xf`): the origin keeps all
 * its items and dims the rest, every other view is given the filtered
 * profile, catalogue or census and shows only what matches. The bar sits
 * on the tab line and is always rendered, so "what am I filtered to?" is
 * answerable at a glance.
 */

import { cloneElement, isValidElement, useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { tablistKeys } from "./keys";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Focus } from "./trace";
import type { Lang, StringKey } from "./i18n";
import type { Design } from "./useHashView";
import type { FilterAction, Mode, ModelView, Origin } from "./cross-filter";
import { chooseFocus, filterOf, guidsOfFocus, resolveActive } from "./cross-filter";
import { SelectionMarksContext } from "./selection-context";
import { selectionMarks } from "./selection-marks";
import { serialiseFocus } from "./trace";
import type { Xf } from "./origins";
import type { PickHandler } from "../viewer/ViewerTile";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes, formatCount, formatMs } from "./format";
import { census } from "./profile";
import { Contents } from "./Contents";
import { Dashboard } from "./Dashboard";
import { ObjectPanel } from "./ObjectPanel";
import { GraphTab } from "./GraphTab";
import { TypesTab } from "./TypesTab";
import { MaterialsTab } from "./MaterialsTab";
import type { IdsSession } from "./IdsResults";
import { ProjectBoard } from "./alt/ProjectBoard";
import { RoomsTab } from "./RoomsTab";
import { ModelTab } from "./ModelTab";
import type { Reveal } from "./TypesTab";
import { catalogue as buildCatalogue, typeCodes } from "./type-links";
import { elementFacets } from "./facets";
import type { Ruleset } from "../ids/types.ts";
import { FilterBar } from "./FilterBar";
import { ReadoutStrip, type Readout } from "./forms";
import { BENTO_MAX_WIDTH } from "./bento-spec";
import { aggregateTypes, meshIndex } from "./types";
import type { FloorConfig } from "../engine/storey-config";
import type { FloorPeer } from "./FloorSetup";

export type Tab = "checks" | "model" | "contents" | "graph" | "types" | "materials" | "rooms" | "project";
// Oversikt, IDS, Modell, then the rest; Graf last (edkjo 2026-09-30).
const TABS: readonly Tab[] = ["checks", "project", "model", "contents", "types", "materials", "rooms", "graph"];
const TAB_LABEL: Record<Tab, StringKey> = {
  checks: "tab.checks",
  model: "tile.viewer",
  contents: "tab.contents",
  graph: "tab.graph",
  types: "tile.types",
  materials: "col.materials",
  rooms: "tab.rooms",
  project: "tab.project",
};

interface ModelPanelProps {
  lang: Lang;
  /** The visual direction, for the one surface painted in SVG rather than in
   *  classes. */
  design: Design | null;
  model: ModelEntry;
  hasRuleset: boolean;
  /** The loaded ruleset, for the type page's required-property marks. */
  ruleset: Ruleset | null;
  claims: KpiClaims;
  onRemove: () => void;
  /** This model's one filter, Scope's list and the selection. */
  view: ModelView;
  onMode: (mode: Mode) => void;
  onDispatch: (action: FilterAction) => void;
  onHover: (guid: string | null) => void;
  /** The ruleset's floor config, or null when none is loaded. */
  floors: FloorConfig[] | null;
  /** Every loaded model's storeys, for the floor tile. */
  peers: FloorPeer[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** The Typer type page's key from the URL hash, or null. */
  typePage: string | null;
  onTypePage: (key: string | null, replace?: boolean) => void;
  /** The derivation band, when the open number is this model's. */
  trace: ReactNode;
  /** The loaded `.ids` (Prosjekt tab), shared by every panel. */
  ids: IdsSession | null;
  idsError: string | null;
  onIdsFile: (file: File) => void;
  onClearIds: () => void;
}

export function ModelPanel({
  lang,
  design,
  model,
  hasRuleset,
  ruleset,
  claims,
  onRemove,
  view,
  onMode,
  onDispatch,
  onHover,
  floors,
  peers,
  tab,
  onTab,
  typePage,
  onTypePage,
  trace,
  ids,
  idsError,
  onIdsFile,
  onClearIds,
}: ModelPanelProps) {
  const profile = model.profile;
  const facts = useMemo(() => (profile ? census(profile) : null), [profile]);
  const reading = model.state === "queued" || model.state === "parsing";
  const ready = model.state === "ready";

  // The one filter, resolved once; every view reads THIS, never a copy.
  const filter = useMemo(() => resolveActive(view.filter, model), [view.filter, model]);
  const xf = useMemo<Xf>(() => ({ origin: view.origin, matched: filter.matched }), [view.origin, filter.matched]);
  const selected = view.scope ? serialiseFocus(view.scope) : null;
  // The model as the isolating views see it: only the matching rows.
  const scopedProfile = useMemo(
    () => (profile && filter.matched ? { ...profile, rows: profile.rows.filter((r) => filter.matched!.has(r.guid)) } : null),
    [profile, filter.matched],
  );
  const isolating = (self: Origin) => scopedProfile !== null && view.origin !== self;
  // What holds the selection, for every view's mark (`selection-marks.ts`).
  // A mark only: the filter above decides what each view shows.
  const marks = useMemo(
    () => selectionMarks(view.selection, profile ?? null, (f) => guidsOfFocus(f, model)),
    [view.selection, profile, model],
  );

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

  // Typer and Materialer: the collections and what goes with what, once per
  // profile (`type-links.ts`). A link chip on one tab opens the other tab on
  // the linked card.
  const catalogue = useMemo(() => (profile ? buildCatalogue(profile) : null), [profile]);
  const scopedCatalogue = useMemo(() => (scopedProfile ? buildCatalogue(scopedProfile) : null), [scopedProfile]);
  // Innhold and the floor sidebar, over the matching rows.
  const scopedFacts = useMemo(() => (scopedProfile ? census(scopedProfile) : null), [scopedProfile]);
  const scopedLedger = useMemo(
    () =>
      scopedProfile
        ? aggregateTypes(scopedProfile, {
            mesh: meshIndex(model.meshBatches),
            meshCapped: model.meshBudget?.capped ?? false,
            typeObjectsDeclared: null,
          })
        : null,
    [scopedProfile, model.meshBatches, model.meshBudget],
  );
  const [revealMaterial, setRevealMaterial] = useState<Reveal | null>(null);
  // Each type card's system and function line, off the board's code trees.
  const board = model.board;
  const codes = useMemo(
    () => (profile && catalogue ? typeCodes(profile, catalogue.types, board?.trees) : null),
    [profile, catalogue, board],
  );
  // Each element's facet values, for the Typer and Materialer facets.
  const facetIndex = useMemo(() => (profile ? elementFacets(profile, board?.trees) : null), [profile, board]);
  // What the type page reads beside its card (`type-page.ts`).
  const pageInput = useMemo(
    () => ({
      model: model.fileName,
      board: board ?? null,
      ids: model.ids ?? null,
      ruleset,
      quantities: model.elementQuantities ?? null,
    }),
    [model.fileName, board, model.ids, ruleset, model.elementQuantities],
  );
  // A type link opens that type's page (its own route).
  const openType = useCallback((key: string) => onTypePage(key), [onTypePage]);
  const openMaterial = useCallback(
    (key: string) => {
      setRevealMaterial((r) => ({ key, seq: (r?.seq ?? 0) + 1 }));
      onTab("materials");
    },
    [onTab],
  );

  // This model's column first on the floor tile, then the rest as loaded.
  const ownFirst = useMemo(
    () => [...peers.filter((p) => p.id === model.id), ...peers.filter((p) => p.id !== model.id)],
    [peers, model.id],
  );

  /** A click on a board number, from the view `origin`: it REPLACES the
   *  filter and Scope's list in one step, or clears both when it is the
   *  chosen item again. */
  const focus = useCallback(
    (next: Focus, origin: Origin) => onDispatch(chooseFocus(origin, next, model, lang)),
    [lang, model, onDispatch],
  );
  /** A click on one object in the 3D: the selection only, never the filter
   *  (`filter-state.ts`, 2026-09-29). Esc clears the selection, then the
   *  filter. */
  const pickViewer = useCallback<PickHandler>(
    (guid, additive, escape) => onDispatch(escape ? { type: "escape" } : { type: "select", guid, additive }),
    [onDispatch],
  );
  /** A graph product: the selection only, like a pick in the 3D. */
  const pickGraph = useCallback(
    (guid: string | null, additive: boolean) => onDispatch({ type: "select", guid, additive }),
    [onDispatch],
  );

  // The file's own facts, on the header line beside name · state · size. They
  // were a 3×2 readout tile on the board, where seven values clipped.
  // When the line runs short they leave whole, in `drop` order (Lesetid and
  // Program first, Skjema last; edkjo 2026-09-30), and one with no value
  // takes its label with it.
  const report = model.report;
  const fileFacts: Readout[] = (
    report
      ? [
          { label: t("kpi.schema", lang), value: report.summary.schema ?? "", drop: 6 },
          { label: t("kpi.unit", lang), value: report.summary.length_unit ?? "", drop: 4 },
          {
            label: t("kpi.products", lang),
            value: formatCount(report.summary.products, lang),
            onClick: () => focus({ kind: "kpi", kpi: "products" }, "checks"),
            drop: 5,
          },
          { label: t("kpi.parseTime", lang), value: formatMs(report.parseMs, lang), drop: 1 },
          { label: t("kpi.project", lang), value: report.summary.project_name ?? "", text: true, drop: 3 },
          {
            label: t("kpi.application", lang),
            value: report.summary.authoring_app ?? "",
            text: true,
            drop: 2,
          },
        ]
      : []
  ).filter((fact) => fact.value.trim() !== "");

  // The filter bar, on the tab strip's line (see there).
  const filterProps = {
    lang,
    mode: view.mode,
    filter: view.filter,
    unresolved: filter.unresolved,
    matchedCount: filter.matched?.size ?? null,
    total: profile?.rows.length ?? 0,
    onMode,
    onClear: () => onDispatch({ type: "clear" }),
  };

  // The design alternatives dock two panels on Kontroll (2026-09-25; edkjo:
  // *"When clicking an object it makes no sense to open a table that hides
  // half the page"*): Scope, the rows behind the last click, and Detail, the
  // selected identity. Neither overlays the board and both are always there;
  // empty, they show nothing. Innhold and Graf keep the band at the foot.
  // The project tab docks them too, on its own module grid (2026-09-28).
  // The tab strip's ids (WAI-ARIA tabs: aria-controls / aria-labelledby).
  const uid = useId();
  const panel = (id: Tab) => ({ id: `${uid}-panel-${id}`, "aria-labelledby": `${uid}-tab-${id}` });
  const docked = (design !== null && tab === "checks") || tab === "project";
  const scope =
    docked && view.scope && isValidElement(trace)
      ? cloneElement(trace as ReactElement<{ alone?: boolean; origin?: boolean }>, { alone: true, origin: view.origin === "scope" })
      : null;
  // Detail is never an empty tile: with nothing selected the panel keeps its
  // frame (edkjo 2026-09-30, *"dont let it go blank when nothing is selected"*).
  const detail = docked ? <ObjectPanel lang={lang} model={model} selection={view.selection} /> : null;

  const rules = hasRuleset
    ? {
        evaluation: model.evaluation,
        evaluating: model.evaluating,
        error: model.evaluationError,
      }
    : undefined;

  // The design alternatives: the file line and the tab strip share one
  // row, so the chrome over the module grid is one line (the layout canon,
  // rule 6: the chrome is what the rows are counted under).
  const oneLine = design !== null && ready && !!facts && !!ledger;
  const nameLine = (
      <div className={"flex min-w-0 items-baseline gap-3" + (oneLine ? " flex-1 overflow-hidden" : "")}>
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
  );

  return (
    // Convergence is a PAGE property (sprucelab DESIGN.md §2): header, filter
    // bar, tabs and board cap together at the canvas's own cap, so on an
    // ultrawide the file line starts where the board starts.
    // The design alternatives lay out on the window's own module grid, which
    // adds columns on a wider window rather than capping it (the layout
    // canon, rule 1).
    <SelectionMarksContext.Provider value={marks}>
    <section className="mx-auto flex h-full min-h-0 w-full shrink-0 flex-col gap-3" style={{ maxWidth: design ? undefined : BENTO_MAX_WIDTH }}>
      {oneLine ? null : nameLine}

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


      {ready && facts && ledger ? (
        <>
          {/* The filter bar shares the tab strip's line, right-aligned over its
              empty end: it belongs to the model, not to a tab, so it sits
              outside the tab panels, and it no longer costs a line of its own
              above the board (2026-09-24). */}
          <div className={oneLine ? "flex min-w-0 shrink-0 items-center gap-4" : "relative shrink-0"}>
          <div role="tablist" onKeyDown={tablistKeys} className="flex shrink-0 items-end gap-px border-b border-line">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${uid}-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`${uid}-panel-${id}`}
                // Roving tabindex (WAI-ARIA tabs): one stop, the arrows move.
                tabIndex={tab === id ? 0 : -1}
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
            {oneLine ? nameLine : null}
            <div
              className={
                oneLine
                  ? "flex max-w-[50%] shrink-0 items-center overflow-x-auto"
                  : "absolute inset-y-0 right-0 flex max-w-[calc(100%-16rem)] items-center overflow-x-auto"
              }
            >
              <FilterBar {...filterProps} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div role="tabpanel" {...panel("checks")} hidden={tab !== "checks"} className="flex min-h-0 flex-1 flex-col">
              <Dashboard
                lang={lang}
                model={model}
                census={facts}
                scopedCensus={isolating("floors") ? scopedFacts : null}
                claims={claims}
                selected={selected}
                onFocus={focus}
                view={view}
                xf={xf}
                onPick={pickViewer}
                onHover={onHover}
                floors={floors}
                peers={ownFirst}
                rules={rules}
                design={design}
                scope={tab === "checks" ? scope : null}
                detail={tab === "checks" ? detail : null}
              />
            </div>
            <div role="tabpanel" {...panel("model")} hidden={tab !== "model"} className="flex min-h-0 flex-1 flex-col">
              <ModelTab lang={lang} model={model} view={view} active={tab === "model"} />
            </div>
            <div role="tabpanel" {...panel("contents")} hidden={tab !== "contents"} className="flex min-h-0 flex-1 flex-col">
              <Contents
                lang={lang}
                model={model}
                census={isolating("census") && scopedFacts ? scopedFacts : facts}
                ledger={isolating("census") && scopedLedger ? scopedLedger : ledger}
                selected={selected}
                xf={xf}
                onFocus={focus}
                onDispatch={onDispatch}
              />
            </div>
            {/* Same mounted-and-hidden pattern as the other two: the 3D scene
                on Kontroll must survive a trip here and back. */}
            <div role="tabpanel" {...panel("graph")} hidden={tab !== "graph"} className="flex min-h-0 flex-1 flex-col">
              <GraphTab
                lang={lang}
                design={design}
                profile={profile ?? null}
                scopedProfile={isolating("graph") ? scopedProfile : null}
                chosen={view.origin === "graph" ? selected : null}
                checks={model.report?.checks}
                meshBatches={model.meshBatches}
                selection={view.selection}
                onPick={pickGraph}
                onFocus={(next) => focus(next, "graph")}
              />
            </div>
            <div role="tabpanel" {...panel("types")} hidden={tab !== "types"} className="flex min-h-0 flex-1 flex-col">
              <TypesTab
                lang={lang}
                profile={profile ?? null}
                catalogue={catalogue}
                scopedCatalogue={isolating("types") ? scopedCatalogue : null}
                meshBatches={model.meshBatches}
                selection={view.selection}
                view={view}
                page={typePage}
                onDispatch={onDispatch}
                onMode={onMode}
                onPage={onTypePage}
                onOpenMaterial={openMaterial}
                pageInput={pageInput}
                codes={codes}
                facetIndex={facetIndex}
                onOpenType={openType}
                onScope={(next, target, within) => {
                  // The line's findings among the type's instances: ONE
                  // filter, not a type AND a requirement.
                  const made = filterOf(next, model, lang);
                  const all = resolveActive(made ? { origin: "typepage", key: "", ...made } : null, model).matched;
                  const guids = within.filter((g) => all?.has(g));
                  onDispatch({
                    type: "choose",
                    origin: "typepage",
                    key: `${serialiseFocus(next)}@type`,
                    filter: made ? { kind: made.kind, label: made.label, guids } : null,
                    scope: made ? { kind: "element", guids } : next,
                  });
                  onTab(target);
                }}
              />
            </div>
            <div role="tabpanel" {...panel("materials")} hidden={tab !== "materials"} className="flex min-h-0 flex-1 flex-col">
              <MaterialsTab
                lang={lang}
                profile={profile ?? null}
                catalogue={catalogue}
                scopedCatalogue={isolating("materials") ? scopedCatalogue : null}
                facetIndex={facetIndex}
                meshBatches={model.meshBatches}
                view={view}
                reveal={revealMaterial}
                onDispatch={onDispatch}
                onOpenType={openType}
              />
            </div>
            <div role="tabpanel" {...panel("rooms")} hidden={tab !== "rooms"} className="flex min-h-0 flex-1 flex-col">
              <RoomsTab
                lang={lang}
                model={model}
                view={view}
                xf={xf}
                active={tab === "rooms"}
                onDispatch={onDispatch}
              />
            </div>
            <div role="tabpanel" {...panel("project")} hidden={tab !== "project"} className="flex min-h-0 flex-1 flex-col">
              <ProjectBoard
                lang={lang}
                model={model}
                ruleset={ruleset}
                selected={selected}
                onFocus={focus}
                xf={xf}
                selection={view.selection}
                scope={tab === "project" ? scope : null}
                detail={tab === "project" ? detail : null}
                active={tab === "project"}
                ids={ids}
                idsError={idsError}
                onIdsFile={onIdsFile}
                onClearIds={onClearIds}
              />
            </div>
            {/* The foot of the panel, inside the window: it takes 38.2 % of
                the screen and the tab above keeps the rest, measured off its
                own panel (`roomBelow`), so the tab shrinks into what is left
                and neither pushes the band out of view nor sits under it. */}
            {/* Not on Rom: its two tiles fit the window (the layout canon,
                rule 1), and a foot band would cover them. Not on Graf, the
                showpiece stage (2026-09-29). Not on Modell: its panel is the
                selection's info. Not on Typer and Materialer: the band
                opened on a click and shrank the gallery and the viewer
                (STABLE LAYOUT, 2026-09-30: nothing resizes on a selection
                or a filter). */}
            {trace && !docked && tab !== "rooms" && tab !== "graph" && tab !== "model" && tab !== "types" && tab !== "materials" ? (
              <div className="flex h-[38.2dvh] min-h-[16rem] shrink-0 flex-col">
                {trace}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
    </SelectionMarksContext.Provider>
  );
}
