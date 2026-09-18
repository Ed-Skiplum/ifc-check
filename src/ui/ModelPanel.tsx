/** One dropped file: its name and state, then, once it is read, the dashboard
 *  and — only if a ruleset is loaded — the rule strip.
 *
 * Each stage appears when it becomes real. A file still being read shows its
 * name and its progress and nothing else; a file that failed shows its error in
 * full, named, never folded away.
 */

import { useMemo } from "react";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes } from "./format";
import { census } from "./profile";
import { Dashboard } from "./Dashboard";
import { RuleStrip } from "./RuleStrip";

interface ModelPanelProps {
  lang: Lang;
  model: ModelEntry;
  hasRuleset: boolean;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  onRemove: () => void;
}

export function ModelPanel({
  lang,
  model,
  hasRuleset,
  claims,
  selected,
  onFocus,
  onRemove,
}: ModelPanelProps) {
  const profile = model.profile;
  const facts = useMemo(() => (profile ? census(profile) : null), [profile]);
  const reading = model.state === "queued" || model.state === "parsing";

  return (
    <section className="flex flex-col gap-2">
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

      {facts && model.state === "ready" ? (
        <Dashboard
          lang={lang}
          model={model}
          census={facts}
          claims={claims}
          selected={selected}
          onFocus={onFocus}
        />
      ) : null}

      {hasRuleset && model.state === "ready" ? (
        <RuleStrip
          lang={lang}
          evaluation={model.evaluation}
          evaluating={model.evaluating}
          evaluationError={model.evaluationError}
          selected={selected}
          onFocus={onFocus}
        />
      ) : null}
    </section>
  );
}
