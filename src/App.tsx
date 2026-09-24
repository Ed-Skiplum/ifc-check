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
import { elementChip, useCrossFilter } from "./ui/cross-filter";
import { Landing } from "./ui/Landing";
import { ModelPanel } from "./ui/ModelPanel";
import { TraceBand } from "./ui/TraceBand";
import type { FloorPeer } from "./ui/FloorSetup";
import { isRulesetFile, readRulesetFile } from "./ui/ruleset-file";
import { buildTrace, parseFocus, serialiseFocus, type Focus } from "./ui/trace";
import { loadDesignFonts } from "./design/fonts";
import { useHashView } from "./ui/useHashView";
import { isAcceptedFile, useModels } from "./ui/useModels";

const EMPTY_RULESET: Ruleset = {
  formatVersion: 1,
  name: "",
  ifcVersions: ["IFC4"],
  rules: [],
};

export default function App() {
  const [view, setView] = useHashView();
  const { models, addFiles, removeModel, clearModels, clearCache, applyRuleset, openCached } =
    useModels();
  const [ruleset, setRuleset] = useState<Ruleset | null>(null);
  const [rulesetName, setRulesetName] = useState<string | null>(null);
  const [rulesetError, setRulesetError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(0);
  // Cross-filter and selection live HERE, above both the boards and the
  // derivation band, because a row in the band and a mesh in a tile are two
  // views of one selection. Held per model id, so two files on screen do not
  // share a filter.
  const cross = useCrossFilter();

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
      if (rulesets.length > 0) void loadRuleset(rulesets[0]);
    },
    [addFiles, loadRuleset],
  );

  const clearRuleset = useCallback(() => {
    setRulesetName(null);
    setRuleset(null);
    setRulesetError(null);
    applyRuleset(null);
    if (view.focus?.startsWith("rule:")) setView({ focus: null });
  }, [applyRuleset, setView, view.focus]);

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
    : `${(rulesetName ?? ruleset?.name ?? "regelsett").replace(/\.(ids|xml)$/i, "")}.ruleset.json`;
  const setupPage = setupOpen ? (
    <SetupPage
      lang={view.lang}
      ruleset={ruleset ?? EMPTY_RULESET}
      fileName={setupFileName}
      onChange={editRuleset}
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
  const focus = parseFocus(view.focus);
  const selectedModel = models.find((m) => m.id === view.model);
  const trace = selectedModel && focus ? buildTrace(selectedModel, focus) : null;

  const onFocus = useCallback(
    (modelId: string, next: Focus) => {
      const key = serialiseFocus(next);
      const same = view.model === modelId && view.focus === key;
      setView(same ? { model: null, focus: null } : { model: modelId, focus: key });
    },
    [setView, view.focus, view.model],
  );

  /* ── A SELECTION opens the band (2026-09-23) ──────────────────────────────
   *
   * edkjo: *"where is the properties panel?"* — it lived only behind a drill,
   * so selecting an element in the 3D tile showed nothing. The rule, exactly:
   *
   *   A model's selection opens the band on that model, on an `element` focus
   *   naming the selected GUIDs, WHEN no derivation is open for that model or
   *   when the one that is open is that model's own `element` focus. A real
   *   drill — a check, rule, class, type, storey, cell or KPI — is never
   *   re-targeted by a selection, so clicking down a list of findings keeps
   *   the list. An emptied selection closes the band only when what is open is
   *   that element focus.
   *
   * Driven off the selection rather than off each call site, so every path
   * reaches it: a canvas pick, a band row, Escape, and a shift-click that
   * grows the set. The ref holds the last selection this effect acted on, so
   * re-renders from the hash change it makes do not re-enter, and the FIRST
   * pass only records — a hash restored with an `element` focus rebuilds its
   * selection instead of being closed by an effect that has seen nothing yet.
   */
  const actedOn = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const first = actedOn.current === null;
    const seen = actedOn.current ?? {};
    actedOn.current = seen;
    for (const model of models) {
      const view_ = cross.views[model.id];
      const selection = view_?.selection ?? [];
      // The GESTURE, not only the set: picking the same element again after
      // closing the band is a request to open it again, and the set did not
      // change. `selectSeq` is what makes that visible here.
      const key = `${view_?.selectSeq ?? 0}|${selection.join("+")}`;
      if (seen[model.id] === key) continue;
      seen[model.id] = key;
      if (first) continue;
      const open = view.model === model.id ? parseFocus(view.focus) : null;
      // A drill in progress owns the band.
      if (open !== null && open.kind !== "element") continue;
      if (selection.length > 0) {
        setView({ model: model.id, focus: `element:${selection.join("+")}` });
      }
      else if (open?.kind === "element") setView({ model: null, focus: null });
    }
    if (!first) return;
    // First pass: a restored `element` focus puts its selection back, so the
    // object panel is filled rather than showing a list of rows nothing is
    // selected in.
    const restored = parseFocus(view.focus);
    if (restored?.kind === "element" && view.model) {
      seen[view.model] = `${cross.views[view.model]?.selectSeq ?? 0}|${restored.guids.join("+")}`;
      cross.setSelection(view.model, restored.guids);
    }
  }, [cross, models, setView, view.focus, view.model]);

  const onRemove = useCallback(
    (id: string) => {
      if (view.model === id) setView({ model: null, focus: null });
      removeModel(id);
    },
    [removeModel, setView, view.model],
  );

  const onClearAll = useCallback(() => {
    setView({ model: null, focus: null });
    clearModels();
  }, [clearModels, setView]);

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
        event.preventDefault();
        setDragging(0);
        takeFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {models.length === 0 ? (
        <>
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-2">
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
          {setupPage ?? (
            <Landing
              lang={view.lang}
              dragging={dragging > 0}
              onFiles={takeFiles}
              ruleset={ruleset}
              rulesetName={rulesetName}
              rulesetError={rulesetError}
              onRulesetFile={(file) => void loadRuleset(file)}
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
            onRulesetFile={(file) => void loadRuleset(file)}
            onClearRuleset={clearRuleset}
            draggingRuleset={dragging > 0}
            setupOpen={setupOpen}
            onSetup={toggleSetup}
          />

          {rulesetError ? (
            <pre className="m-0 shrink-0 bg-bad px-4 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
              {rulesetError}
            </pre>
          ) : null}

          {setupPage ?? (
          <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-3">
            {models.map((model) => (
              <ModelPanel
                key={model.id}
                lang={view.lang}
                design={view.design}
                model={model}
                hasRuleset={rulesetName !== null}
                claims={claims}
                selected={view.model === model.id ? view.focus : null}
                onFocus={(next) => onFocus(model.id, next)}
                onRemove={() => onRemove(model.id)}
                view={cross.view(model.id)}
                onMode={(mode) => cross.setMode(model.id, mode)}
                onAddChip={(chip) => cross.addChip(model.id, chip)}
                onRemoveChip={(key) => cross.removeChip(model.id, key)}
                onClearChips={() => cross.clearChips(model.id)}
                onClearElements={() => cross.clearElements(model.id)}
                onPick={(guid, additive) => cross.pick(model.id, guid, additive)}
                onHover={(guid) => cross.setHover(model.id, guid)}
                floors={ruleset?.storeys?.length ? ruleset.storeys : null}
                peers={peers}
                tab={view.tab ?? "checks"}
                onTab={(tab) => setView({ tab: tab === "checks" ? null : tab })}
                trace={
                  trace && trace.modelId === model.id ? (
                    <TraceBand
                      // A different target is a different list: remount so it
                      // starts at the top.
                      key={`${trace.modelId}:${trace.focus}`}
                      lang={view.lang}
                      trace={trace}
                      model={model}
                      selection={cross.view(trace.modelId).selection}
                      hover={cross.view(trace.modelId).hover}
                      // A band row is the second step of the drill: it
                      // selects the element AND narrows the filter to it.
                      onPick={(guid, name, additive) =>
                        cross.pickElement(trace.modelId, elementChip(guid, name), additive)
                      }
                      onHover={(guid) => cross.setHover(trace.modelId, guid)}
                      onClose={() => setView({ model: null, focus: null })}
                    />
                  ) : null
                }
              />
            ))}
          </main>
          )}

        </>
      )}
    </div>
  );
}
