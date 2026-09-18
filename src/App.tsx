/** The flow. Each stage appears when it becomes real.
 *
 *   empty      one centered drop target, nothing else
 *   reading    the files, named, with their progress — and their errors in full
 *   dashboard  what the file IS: KPI tiles, class census, storeys, floor matrix
 *   rules      only once a ruleset says what right looks like
 *   derivation the rows and the arithmetic behind whatever number is open
 *
 * A model's numbers are facts until a rule claims them. Nothing on the
 * dashboard calls a model wrong against a requirement nobody stated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ruleset } from "./ids/types.ts";
import { AppBar, LangToggle } from "./ui/AppBar";
import { kpiClaims } from "./ui/claims";
import { useCrossFilter } from "./ui/cross-filter";
import { DropTarget } from "./ui/DropTarget";
import { ModelPanel } from "./ui/ModelPanel";
import { TraceBand } from "./ui/TraceBand";
import { isRulesetFile, readRulesetFile } from "./ui/ruleset-file";
import { buildTrace, parseFocus, serialiseFocus, type Focus } from "./ui/trace";
import { useHashView } from "./ui/useHashView";
import { isAcceptedFile, useModels } from "./ui/useModels";

export default function App() {
  const [view, setView] = useHashView();
  const { models, addFiles, removeModel, clearModels, applyRuleset } = useModels();
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

  const claims = useMemo(() => kpiClaims(ruleset), [ruleset]);
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
      className="flex h-full flex-col overflow-hidden bg-cream text-ink"
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
          <div className="flex shrink-0 justify-end p-3">
            <LangToggle lang={view.lang} onLang={(lang) => setView({ lang })} />
          </div>
          <DropTarget lang={view.lang} dragging={dragging > 0} onFiles={takeFiles} />
        </>
      ) : (
        <>
          <AppBar
            lang={view.lang}
            onLang={(lang) => setView({ lang })}
            modelCount={models.length}
            onFiles={takeFiles}
            onClearAll={onClearAll}
            rulesetName={rulesetName}
            onRulesetFile={(file) => void loadRuleset(file)}
            onClearRuleset={clearRuleset}
            draggingRuleset={dragging > 0}
          />

          {rulesetError ? (
            <pre className="m-0 shrink-0 bg-bad px-4 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
              {rulesetError}
            </pre>
          ) : null}

          <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-3">
            {models.map((model) => (
              <ModelPanel
                key={model.id}
                lang={view.lang}
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
                onPick={(guid, additive) => cross.pick(model.id, guid, additive)}
                onHover={(guid) => cross.setHover(model.id, guid)}
              />
            ))}
          </main>

          {trace ? (
            <TraceBand
              // A different target is a different list: remount so it starts
              // at the top.
              key={`${trace.modelId}:${trace.focus}`}
              lang={view.lang}
              trace={trace}
              selection={cross.view(trace.modelId).selection}
              hover={cross.view(trace.modelId).hover}
              onPick={(guid, additive) => cross.pick(trace.modelId, guid, additive)}
              onHover={(guid) => cross.setHover(trace.modelId, guid)}
              onClose={() => setView({ model: null, focus: null })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
