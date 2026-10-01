/** One tab per loaded model, under the AppBar (edkjo 2026-10-01: "we could
 *  just add a tab for each model"). The board shows one model at a time; the
 *  others stay mounted and hidden, so their scene and state survive a switch.
 *  Shown with one model too, so the chrome does not change shape on the
 *  second drop. The look is the bar's own: LangToggle's flat segments. */

import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { ModelEntry } from "./useModels";

export function ModelTabs({
  lang,
  models,
  active,
  onActivate,
}: {
  lang: Lang;
  models: ModelEntry[];
  active: string | null;
  onActivate: (id: string) => void;
}) {
  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-1.5 py-1">
      {models.map((model) => {
        const on = model.id === active;
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => onActivate(model.id)}
            aria-pressed={on}
            title={model.fileName}
            data-chrome={on ? "primary" : undefined}
            className={
              "relative flex max-w-[36ch] shrink-0 items-baseline gap-2 overflow-hidden border px-2.5 py-1 font-mono text-[12px] " +
              (on ? "border-green bg-green text-cream" : "border-line bg-input text-muted hover:text-ink")
            }
          >
            <span className="min-w-0 truncate">{model.fileName}</span>
            {/* The load state as the panel prints it, while there is one to
                report: a ready model is the normal case and says nothing. */}
            {model.state === "ready" && !model.rejected ? null : (
              <span
                className={
                  "shrink-0 text-[11px] " +
                  (model.state === "failed" ? "font-semibold " + (on ? "text-cream" : "text-bad") : "")
                }
              >
                {t(model.rejected ? "file.rejected" : `file.${model.state}`, lang)}
              </span>
            )}
            {model.state === "parsing" ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
                <span className={"ifc-sweep block h-full w-1/3 " + (on ? "bg-cream" : "bg-green")} />
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
