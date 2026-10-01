/** The flow. Each stage appears when it becomes real.
 *
 *   empty      the landing: IFC drop, ruleset, setup, recently checked models
 *   reading    the files, named, with their progress — and their errors in full
 *   Kontroll   the model board: KPIs, verification (+ project rules once a
 *              ruleset says what right looks like), model, spatial, floors
 *   Innhold    the census: classes, storey × class, type ledger
 *   derivation the rows and the arithmetic behind whatever number is open,
 *              under the active tab of that model
 *
 * A model's numbers are facts until a rule claims them. Nothing on the
 * dashboard calls a model wrong against a requirement nobody stated.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ruleset } from "./ids/types.ts";
import { AppBar, LangToggle, SetupToggle } from "./ui/AppBar";
import { t } from "./ui/i18n";
import { SetupPage } from "./ui/SetupPage";
import { kpiClaims } from "./ui/claims";
import { chooseFocus, useCrossFilter } from "./ui/cross-filter";
import { originOfFocus } from "./ui/origins";
import { Landing } from "./ui/Landing";
import { ModelPanel } from "./ui/ModelPanel";
import { TraceBand } from "./ui/TraceBand";
import type { FloorPeer } from "./ui/FloorSetup";
import { isRulesetFile, readRulesetFile } from "./ui/ruleset-file";
import { isIdsFile, type IdsSession } from "./ui/IdsResults";
import { importIds } from "./ids/import.ts";
import { buildTrace, parseFocus, serialiseFocus } from "./ui/trace";
import { loadDesignFonts } from "./design/fonts";
import { useHashView } from "./ui/useHashView";
import { escapeTarget } from "./ui/keys";
import { isAcceptedFile, useModels } from "./ui/useModels";

const EMPTY_RULESET: Ruleset = {
  formatVersion: 2,
  name: "",
  ifcVersions: ["IFC4"],
  rules: [],
};

export default function App() {
  const [view, setView] = useHashView();
  const { models, addFiles, removeModel, clearModels, clearCache, applyRuleset, applyIds, openCached } =
    useModels();
  // The Prosjekt tab's `.ids`: run as written, apart from the ruleset.
  const [ids, setIds] = useState<IdsSession | null>(null);
  const [idsError, setIdsError] = useState<string | null>(null);
  const [ruleset, setRuleset] = useState<Ruleset | null>(null);
  const [rulesetName, setRulesetName] = useState<string | null>(null);
  const [rulesetError, setRulesetError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(0);
  // Cross-filter and selection live HERE, above both the boards and the
  // derivation band, because a row in the band and a mesh in a tile are two
  // views of one selection. Held per model id, so two files on screen do not
  // share a filter.
  const cross = useCrossFilter();

  // Esc escalates from anywhere in the app (2026-09-30): the selection first,
  // then the filter, the same as the chip's ✕. ONE window-level path, so the
  // focus can be in a list, on a row, on the canvas or nowhere; a text field,
  // an open dialog, or a component that handled the key keeps it
  // (`escapeTarget`).
  const escape = cross.escape;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (escapeTarget(event)) escape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escape]);

  // Keep the document language in step with the toggle, for screen readers and
  // for the browser's own hyphenation.
  useEffect(() => {
    document.documentElement.lang = view.lang;
  }, [view.lang]);

  /* The visual direction, published on the document element. Everything about
   * a direction that CSS can carry reads off this attribute (see
   * `src/design/*.css`); the graph reads the same value as a prop, because a
   * node-link drawing is painted in SVG attributes, not in classes. Absent,
   * no attribute is written at all, so the default look is the untouched one
   * every gate measures. */
  useEffect(() => {
    const root = document.documentElement;
    if (view.design) {
      root.dataset.design = view.design;
      loadDesignFonts(view.design);
    } else delete root.dataset.design;
  }, [view.design]);

  const loadRuleset = useCallback(
    async (file: File) => {
      try {
        const loaded = await readRulesetFile(file);
        setRulesetError(null);
        setRulesetName(loaded.fileName);
        setRuleset(loaded.ruleset);
        applyRuleset(loaded.ruleset);
      } catch (error) {
        // Loudly, in full, named. A ruleset that half-loaded would report a
        // model clean against rules that were never applied.
        setRulesetName(null);
        setRuleset(null);
        setRulesetError(error instanceof Error ? error.message : String(error));
        applyRuleset(null);
      }
    },
    [applyRuleset],
  );

  const loadIds = useCallback(
    async (file: File) => {
      try {
        const imported = importIds(await file.text(), file.name);
        setIds({ fileName: imported.fileName, title: imported.title });
        setIdsError(null);
        applyIds(imported);
      } catch (error) {
        // Loudly, in full: nothing is run against a file that did not import.
        setIds(null);
        setIdsError(error instanceof Error ? error.message : String(error));
        applyIds(null);
      }
    },
    [applyIds],
  );

  const clearIds = useCallback(() => {
    setIds(null);
    setIdsError(null);
    applyIds(null);
    // A filter on a specification that is gone would resolve to nothing.
    for (const [id, v] of Object.entries(cross.views)) if (v.scope?.kind === "ids") cross.dispatch(id, { type: "clear" });
  }, [applyIds, cross]);

  // The main page's ruleset slot and drop: an `.ids` goes to the IDS view (the
  // same loader as the IDS tile), a `.json`/`.xlsx` to the ruleset.
  const takeRulesetFile = useCallback(
    (file: File) => void (isIdsFile(file) ? loadIds(file) : loadRuleset(file)),
    [loadIds, loadRuleset],
  );

  const takeFiles = useCallback(
    (files: File[]) => {
      const rulesets: File[] = [];
      const rest: File[] = [];
      for (const file of files) {
        if (!isAcceptedFile(file) && isRulesetFile(file)) rulesets.push(file);
        else rest.push(file);
      }
      // Files this app does not take still land in the list, failed and named.
      if (rest.length > 0) addFiles(rest);
      if (rulesets.length > 0) takeRulesetFile(rulesets[0]);
    },
    [addFiles, takeRulesetFile],
  );

  const clearRuleset = useCallback(() => {
    setRulesetName(null);
    setRuleset(null);
    setRulesetError(null);
    applyRuleset(null);
    for (const [id, v] of Object.entries(cross.views)) if (v.scope?.kind === "rule") cross.dispatch(id, { type: "clear" });
  }, [applyRuleset, cross]);

  // The setup page edits the ruleset in place and the board re-evaluates on
  // every change. The evaluator answers a half-filled mapping with its own
  // states (not_evaluable, a finding per subject); the lint issues show on the
  // page, and a ruleset with lint errors cannot be downloaded.
  const editRuleset = useCallback(
    (next: Ruleset) => {
      setRuleset(next);
      setRulesetError(null);
      setRulesetName((name) => name ?? `${next.name || "regelsett"}.ruleset.json`);
      applyRuleset(next);
    },
    [applyRuleset],
  );
  const setupOpen = view.page === "setup";
  const toggleSetup = useCallback(
    () => setView({ page: setupOpen ? null : "setup" }),
    [setView, setupOpen],
  );
  const setupFileName = rulesetName && /\.json$/i.test(rulesetName)
    ? rulesetName
    : `${(rulesetName ?? ruleset?.name ?? "regelsett").replace(/\.(ids|xml|xlsx)$/i, "")}.ruleset.json`;
  const setupPage = setupOpen ? (
    <SetupPage
      lang={view.lang}
      ruleset={ruleset ?? EMPTY_RULESET}
      fileName={setupFileName}
      onChange={editRuleset}
      onOpen={(file) => void loadRuleset(file)}
    />
  ) : null;

  const claims = useMemo(() => kpiClaims(ruleset), [ruleset]);
  const peers = useMemo<FloorPeer[]>(
    () =>
      models
        .filter((m) => m.profile && m.report)
        .map((m) => ({
          id: m.id,
          fileName: m.fileName,
          storeys: m.profile!.storeys,
          unitScale: m.report!.summary.unit_scale,
          unitResolved: m.report!.summary.unit_resolved,
        })),
    [models],
  );
  /* ── The hash mirrors the filter ─────────────────────────────────────────
   *
   * The one filter lives in `cross` (per model) and Scope lists its
   * `scope`. The hash carries that focus so a view is a link: restored once
   * on load, as a click from the view the focus belongs to, and written back
   * with `replace` on every change. Back/Forward walk tabs and the type page,
   * not filters: a filter the hash could step back into would be a second
   * source of truth. An element scope of more than eight guids is not
   * written; it would make the link unreadable. */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    const focus = parseFocus(view.focus);
    if (!view.model || !focus) {
      restored.current = true;
      return;
    }
    const target = models.find((m) => m.id === view.model);
    // Wait for the model the link names to be read.
    if (!target || target.state !== "ready") {
      if (models.length > 0 && !target) restored.current = true;
      return;
    }
    restored.current = true;
    if (focus.kind === "element") {
      for (const [i, guid] of focus.guids.entries())
        cross.dispatch(target.id, { type: "element", origin: "viewer", guid, label: null, additive: i > 0 });
    } else cross.dispatch(target.id, chooseFocus(originOfFocus(focus), focus, target, view.lang));
  }, [cross, models, view.model, view.focus, view.lang]);

  useEffect(() => {
    if (!restored.current) return;
    const open = models.find((m) => cross.views[m.id]?.scope);
    const scope = open ? cross.views[open.id].scope : null;
    const key = scope && !(scope.kind === "element" && scope.guids.length > 8) ? serialiseFocus(scope) : null;
    const model = key && open ? open.id : null;
    if (view.model !== model || view.focus !== key) setView({ model, focus: key }, true);
  }, [cross.views, models, setView, view.model, view.focus]);

  const onRemove = useCallback(
    (id: string) => {
      cross.dispatch(id, { type: "clear" });
      removeModel(id);
    },
    [cross, removeModel],
  );

  const onClearAll = useCallback(() => {
    for (const id of Object.keys(cross.views)) cross.dispatch(id, { type: "clear" });
    clearModels();
  }, [clearModels, cross]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-ground text-ink"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging((depth) => depth + 1);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        // A drop a panel already took (the IDS tab marks its own handled).
        const taken = event.defaultPrevented;
        event.preventDefault();
        setDragging(0);
        if (!taken) takeFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {models.length === 0 ? (
        <>
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-1.5 py-1">
            <button
              type="button"
              onClick={() => setView({ page: null })}
              className="text-[15px] font-semibold tracking-tight text-ink"
            >
              {t("app.name", view.lang)}
            </button>
            <div className="ml-auto flex items-center gap-3">
              <SetupToggle lang={view.lang} open={setupOpen} onToggle={toggleSetup} />
              <LangToggle lang={view.lang} onLang={(lang) => setView({ lang })} />
            </div>
          </header>
          {setupPage && rulesetError ? (
            <pre className="m-0 shrink-0 bg-bad px-4 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
              {rulesetError}
            </pre>
          ) : null}
          {setupPage ?? (
            <Landing
              lang={view.lang}
              dragging={dragging > 0}
              onFiles={takeFiles}
              ruleset={ruleset}
              rulesetName={rulesetName}
              rulesetError={rulesetError}
              onRulesetFile={takeRulesetFile}
              onClearRuleset={clearRuleset}
              onSetup={toggleSetup}
              onOpenCached={openCached}
            />
          )}
        </>
      ) : (
        <>
          <AppBar
            lang={view.lang}
            onLang={(lang) => setView({ lang })}
            modelCount={models.length}
            models={models}
            onFiles={takeFiles}
            onClearAll={onClearAll}
            onClearCache={clearCache}
            rulesetName={rulesetName}
            onClearRuleset={clearRuleset}
            setupOpen={setupOpen}
            onSetup={toggleSetup}
          />

          {rulesetError ? (
            <pre className="m-0 shrink-0 bg-bad px-4 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
              {rulesetError}
            </pre>
          ) : null}

          {setupPage ?? (
          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
            {models.map((model) => (
              <ModelPanel
                key={model.id}
                lang={view.lang}
                design={view.design}
                model={model}
                hasRuleset={rulesetName !== null}
                ruleset={ruleset}
                claims={claims}
                onRemove={() => onRemove(model.id)}
                view={cross.view(model.id)}
                onMode={(mode) => cross.setMode(model.id, mode)}
                onDispatch={(action) => cross.dispatch(model.id, action)}
                onHover={(guid) => cross.setHover(model.id, guid)}
                floors={ruleset?.storeys?.levels.length ? ruleset.storeys.levels : null}
                peers={peers}
                tab={view.tab ?? "checks"}
                onTab={(tab) => setView({ tab: tab === "checks" ? null : tab, type: null })}
                typePage={view.type}
                onTypePage={(type, replace) => setView({ tab: "types", type }, replace)}
                ids={ids}
                idsError={idsError}
                onIdsFile={(file) => void loadIds(file)}
                onClearIds={clearIds}
                trace={(() => {
                  const v = cross.view(model.id);
                  // With no filter at all, a selection still opens the band
                  // on itself, so its info shows on the tabs that dock no
                  // Detail. (The type page sets a filter and has its own.)
                  const alone = v.origin === null && v.selection.length > 0;
                  const on = v.scope ?? (alone ? { kind: "element" as const, guids: v.selection } : null);
                  const trace = on ? buildTrace(model, on) : null;
                  return trace ? (
                    <TraceBand
                      // A different target is a different list: remount so it
                      // starts at the top.
                      key={`${trace.modelId}:${trace.focus}`}
                      lang={view.lang}
                      trace={trace}
                      model={model}
                      selection={v.selection}
                      hover={v.hover}
                      // A Scope row selects its element; the filter and the
                      // list stay (`filter-state.ts`, 2026-09-29).
                      onPick={(guid, _name, additive) => cross.dispatch(model.id, { type: "select", guid, additive })}
                      onHover={(guid) => cross.setHover(model.id, guid)}
                      // Scope is the filter's derivation: closing it clears
                      // the filter and the selection it was showing.
                      onClose={() => {
                        cross.dispatch(model.id, { type: "clear" });
                        cross.dispatch(model.id, { type: "select", guid: null, additive: false });
                      }}
                    />
                  ) : null;
                })()}
              />
            ))}
          </main>
          )}

        </>
      )}
    </div>
  );
}
