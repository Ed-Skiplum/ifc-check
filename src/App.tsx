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
import { AccountControl, AppBar, LangToggle, SetupToggle } from "./ui/AppBar";
import { useAccount } from "./account/useAccount";
import { signInUrl } from "./account/konto";
import { t } from "./ui/i18n";
import { FIRST_MAPPING_STEP, SetupPage, type SetupStep } from "./ui/SetupPage";
import { forgetSavedRuleset, readSavedRuleset, writeSavedRuleset } from "./storage/saved-ruleset";
import { kpiClaims } from "./ui/claims";
import { chooseFocus, useCrossFilter, type ModelView } from "./ui/cross-filter";
import { originOfFocus } from "./ui/origins";
import { Landing } from "./ui/Landing";
import { ModelPanel } from "./ui/ModelPanel";
import { ModelTabs } from "./ui/ModelTabs";
import { TraceBand } from "./ui/TraceBand";
import type { FloorPeer } from "./ui/FloorSetup";
import { isRulesetFile, readRulesetFile } from "./ui/ruleset-file";
import { isIdsFile, type IdsSession } from "./ui/IdsResults";
import { importIds } from "./ids/import.ts";
import { buildTrace, parseFocus, serialiseFocus } from "./ui/trace";
import { loadDesignFonts } from "./design/fonts";
import { useHashView, type ViewState } from "./ui/useHashView";
import { escapeTarget } from "./ui/keys";
import { isAcceptedFile, useModels } from "./ui/useModels";

/** The hash's `focus` for a model's filter. An element scope of more than
 *  eight guids is not written; it would make the link unreadable. */
function focusKey(scope: ModelView["scope"] | undefined): string | null {
  return scope && !(scope.kind === "element" && scope.guids.length > 8) ? serialiseFocus(scope) : null;
}

/** A model's panel tab, kept while another model's tab is open. */
interface PanelTab {
  tab: ViewState["tab"];
  type: string | null;
}

const EMPTY_RULESET: Ruleset = {
  formatVersion: 2,
  name: "",
  ifcVersions: ["IFC4"],
  rules: [],
};

export default function App() {
  const [view, setView] = useHashView();
  const { models, addFiles, removeModel, clearModels, clearCache, applyRuleset, applyIds, openCached, requestPsets } =
    useModels();
  // The ruleset «Lagre oppsett» kept, read once, before the first render.
  const [saved] = useState(readSavedRuleset);
  // The Prosjekt tab's `.ids`: run as written, apart from the ruleset.
  const [ids, setIds] = useState<IdsSession | null>(null);
  const [idsError, setIdsError] = useState<string | null>(null);
  const [ruleset, setRuleset] = useState<Ruleset | null>(saved?.ruleset ?? null);
  const [rulesetName, setRulesetName] = useState<string | null>(saved?.fileName ?? null);
  const [rulesetError, setRulesetError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(0);
  // Cross-filter and selection live HERE, above both the boards and the
  // derivation band, because a row in the band and a mesh in a tile are two
  // views of one selection. Held per model id, so two files on screen do not
  // share a filter.
  const cross = useCrossFilter();
  // The Skiplum account: asked on load and on focus, never awaited.
  const { konto, account, signOut } = useAccount();
  const accountControl = (
    <AccountControl
      lang={view.lang}
      account={account}
      signInHref={konto ? signInUrl(konto.base, window.location.href) : null}
      onSignOut={signOut}
    />
  );

  /* ── One model on the board at a time ───────────────────────────────────
   *
   * The open tab is the hash's `model`, so a link names it and Back walks
   * model tabs as it walks panel tabs. A hash naming no loaded model falls
   * back to the newest. The panel tab and the type page are each model's
   * own: the hash carries the open model's, `panelTabs` keeps the rest. */
  const activeId = models.find((m) => m.id === view.model)?.id ?? models.at(-1)?.id ?? null;
  const [panelTabs, setPanelTabs] = useState<Record<string, PanelTab>>({});
  useEffect(() => {
    if (!activeId) return;
    setPanelTabs((p) =>
      p[activeId]?.tab === view.tab && p[activeId]?.type === view.type
        ? p
        : { ...p, [activeId]: { tab: view.tab, type: view.type } },
    );
  }, [activeId, view.tab, view.type]);
  const activate = useCallback(
    (id: string, replace = false) => {
      const own = panelTabs[id];
      setView(
        { model: id, focus: focusKey(cross.views[id]?.scope), tab: own?.tab ?? null, type: own?.type ?? null },
        replace,
      );
    },
    [cross.views, panelTabs, setView],
  );

  // Esc escalates from anywhere in the app (2026-09-30): the selection first,
  // then the filter, the same as the chip's ✕. ONE window-level path, so the
  // focus can be in a list, on a row, on the canvas or nowhere; a text field,
  // an open dialog, or a component that handled the key keeps it
  // (`escapeTarget`). It acts on the open model only: a hidden one's
  // selection is not cleared by a key pressed on another.
  const escape = cross.escape;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (activeId && escapeTarget(event)) escape(activeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escape, activeId]);

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

  // The saved ruleset goes to the models as a loaded one would; the models
  // restored from the cache are evaluated against it as they arrive.
  useEffect(() => {
    if (saved) applyRuleset(saved.ruleset);
  }, [saved, applyRuleset]);

  /** True once the file loaded. */
  const loadRuleset = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const loaded = await readRulesetFile(file);
        setRulesetError(null);
        setRulesetName(loaded.fileName);
        setRuleset(loaded.ruleset);
        applyRuleset(loaded.ruleset);
        return true;
      } catch (error) {
        // Loudly, in full, named. A ruleset that half-loaded would report a
        // model clean against rules that were never applied.
        setRulesetName(null);
        setRuleset(null);
        setRulesetError(error instanceof Error ? error.message : String(error));
        applyRuleset(null);
        return false;
      }
    },
    [applyRuleset],
  );

  const loadIds = useCallback(
    async (file: File) => {
      try {
        const imported = importIds(await file.text(), file.name);
        setIds({
          fileName: imported.fileName,
          title: imported.title,
          rules: imported.specs.map((spec) => {
            const rule = imported.ruleset.rules.find((r) => r.id === spec.ruleId);
            return rule?.kind === "ids" ? rule : null;
          }),
        });
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
    // A removed ruleset does not come back on the next load.
    forgetSavedRuleset();
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
  // The step Oppsett is on, held here: the page remounts when the first
  // model lands (the empty and the board layouts are two trees). null =
  // the page picks its first step. Each opening starts afresh.
  const [setupStep, setSetupStep] = useState<SetupStep | null>(null);
  // «POFIN» was picked on the choice: held here with the step, for the same
  // remount, and dropped with it.
  const [setupPofin, setSetupPofin] = useState(false);
  const [setupWasOpen, setSetupWasOpen] = useState(setupOpen);
  if (setupWasOpen !== setupOpen) {
    setSetupWasOpen(setupOpen);
    if (!setupOpen) {
      setSetupStep(null);
      setSetupPofin(false);
    }
  }
  // The picker's sets are computed only once Oppsett has been opened.
  useEffect(() => {
    if (setupOpen) requestPsets();
  }, [setupOpen, requestPsets]);
  // The IFC step done: the walk moves on to the first mapping.
  const hadModels = useRef(models.length > 0);
  useEffect(() => {
    const has = models.length > 0;
    if (has && !hadModels.current) setSetupStep((s) => (s === "ifc" ? FIRST_MAPPING_STEP : s));
    hadModels.current = has;
  }, [models.length]);
  const setupFileName = rulesetName && /\.json$/i.test(rulesetName)
    ? rulesetName
    : `${(rulesetName ?? ruleset?.name ?? "regelsett").replace(/\.(ids|xml|xlsx)$/i, "")}.ruleset.json`;
  const setupPage = setupOpen ? (
    <SetupPage
      lang={view.lang}
      ruleset={ruleset ?? EMPTY_RULESET}
      rulesetLoaded={ruleset !== null}
      fileName={setupFileName}
      models={models}
      step={setupStep}
      onStep={setSetupStep}
      onChange={editRuleset}
      onOpen={loadRuleset}
      onFiles={takeFiles}
      pofin={setupPofin}
      onPofin={setSetupPofin}
      onSave={() => {
        try {
          writeSavedRuleset(ruleset ? { fileName: setupFileName, ruleset } : null);
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        // Onto the IDS tab, where the Standardkrav rows show what the setup
        // gives on the model (2026-10-05).
        setView({ page: null, tab: "project", type: null });
        return null;
      }}
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
   * `scope`. The hash carries the open model and its focus so a view is a
   * link: restored once on load, as a click from the view the focus belongs
   * to, and written back with `replace` on every change. Back/Forward walk
   * tabs and the type page, not filters: a filter the hash could step back
   * into would be a second source of truth. */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    if (!view.model) {
      restored.current = true;
      return;
    }
    // The link's model is the open tab as soon as it is loaded (`activeId`).
    const target = models.find((m) => m.id === view.model);
    const focus = parseFocus(view.focus);
    // Wait for the model the link names to be read.
    if (!target || (focus && target.state !== "ready")) {
      if (models.length > 0 && !target) restored.current = true;
      return;
    }
    restored.current = true;
    if (!focus) return;
    if (focus.kind === "element") {
      for (const [i, guid] of focus.guids.entries())
        cross.dispatch(target.id, { type: "element", origin: "viewer", guid, label: null, additive: i > 0 });
    } else cross.dispatch(target.id, chooseFocus(originOfFocus(focus), focus, target, view.lang));
  }, [cross, models, view.model, view.focus, view.lang]);

  useEffect(() => {
    if (!restored.current) return;
    const key = activeId ? focusKey(cross.views[activeId]?.scope) : null;
    if (view.model !== activeId || view.focus !== key) setView({ model: activeId, focus: key }, true);
  }, [activeId, cross.views, setView, view.model, view.focus]);

  // A model that arrives becomes the open tab, unless the link names it (it
  // is then open already). Several at once: the last of them.
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = models.filter((m) => !knownIds.current.has(m.id)).map((m) => m.id);
    knownIds.current = new Set(models.map((m) => m.id));
    if (fresh.length === 0 || (view.model && fresh.includes(view.model))) return;
    activate(fresh[fresh.length - 1], true);
  }, [models, view.model, activate]);

  const onRemove = useCallback(
    (id: string) => {
      // The open tab removed: its neighbour opens, the next one, else the one
      // before.
      if (id === activeId) {
        const at = models.findIndex((m) => m.id === id);
        const next = models[at + 1] ?? models[at - 1];
        if (next) activate(next.id, true);
      }
      cross.dispatch(id, { type: "clear" });
      removeModel(id);
    },
    [activate, activeId, cross, models, removeModel],
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
              {accountControl}
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
            ruleset={ruleset}
            rulesetName={rulesetName}
            onClearRuleset={clearRuleset}
            setupOpen={setupOpen}
            onSetup={toggleSetup}
            account={accountControl}
          />

          {setupPage ? null : (
            <ModelTabs lang={view.lang} models={models} active={activeId} onActivate={(id) => activate(id)} />
          )}

          {rulesetError ? (
            <pre className="m-0 shrink-0 bg-bad px-4 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
              {rulesetError}
            </pre>
          ) : null}

          {setupPage ?? (
          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
            {models.map((model) => {
              // Inactive panels stay mounted and hidden: their scene, tabs and
              // filter are there when their tab opens again.
              const active = model.id === activeId;
              const own: PanelTab = active
                ? { tab: view.tab, type: view.type }
                : (panelTabs[model.id] ?? { tab: null, type: null });
              return (
              <div key={model.id} className={active ? "contents" : "hidden"}>
              <ModelPanel
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
                tab={own.tab ?? "checks"}
                onTab={(tab) => setView({ tab: tab === "checks" ? null : tab, type: null })}
                typePage={own.type}
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
                      // A Scope row ISOLATES its element and frames it; Scope's
                      // list stays (the pick keeps its `base`), and the same
                      // row again steps back to the list's filter. edkjo
                      // 2026-10-01: "Always isolate and focus on the object
                      // in question" (a highlight in full context is lost).
                      onPick={(guid, name, additive) =>
                        cross.dispatch(model.id, { type: "element", origin: "scope", guid, label: name, additive })
                      }
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
              </div>
              );
            })}
          </main>
          )}

        </>
      )}
    </div>
  );
}
