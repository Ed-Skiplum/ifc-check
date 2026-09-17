/** One screen: toolbar, matrix, findings band. */

import { useCallback, useEffect, useRef, useState } from "react";
import { FindingsBand } from "./ui/FindingsBand";
import { Matrix } from "./ui/Matrix";
import { Toolbar } from "./ui/Toolbar";
import { useHashView } from "./ui/useHashView";
import { useModels } from "./ui/useModels";

export default function App() {
  const [view, setView] = useHashView();
  const { models, addFiles } = useModels();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Keep the document language in step with the toggle, for screen readers and
  // for the browser's own hyphenation.
  useEffect(() => {
    document.documentElement.lang = view.lang;
  }, [view.lang]);

  const select = useCallback(
    (model: string, check: string) => {
      const same = view.model === model && view.check === check;
      setView(same ? { model: null, check: null } : { model, check });
    },
    [setView, view.model, view.check],
  );

  const selectedModel = models.find((m) => m.id === view.model);
  const selectedCheck =
    selectedModel?.state === "ready"
      ? selectedModel.report?.checks.find((c) => c.id === view.check)
      : undefined;

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-cream text-ink"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <Toolbar
        lang={view.lang}
        onLang={(lang) => setView({ lang })}
        modelCount={models.length}
        dragging={dragging}
        onFiles={addFiles}
      />

      <Matrix
        lang={view.lang}
        models={models}
        selectedModel={view.model}
        selectedCheck={view.check}
        onSelect={select}
      />

      {selectedModel && selectedCheck ? (
        <FindingsBand
          // A different cell is a different list: remount so it starts at the top.
          key={`${selectedModel.id}:${selectedCheck.id}`}
          lang={view.lang}
          fileName={selectedModel.fileName}
          check={selectedCheck}
          onClose={() => setView({ model: null, check: null })}
        />
      ) : null}
    </div>
  );
}
