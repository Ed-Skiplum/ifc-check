/** Rows are the nine checks, columns are the dropped models.
 *
 * All nine rows render from the first frame, before a file exists — the view
 * never opens with rows culled.
 */

import type { CheckResult } from "../engine/types";
import { copyOnDoubleClick } from "./copy";
import type { Lang } from "./i18n";
import { CHECK_IDS, checkLabel, t } from "./i18n";
import { STATE_FILL, STATE_GLYPH } from "./state-visuals";
import type { ModelEntry } from "./useModels";

interface MatrixProps {
  lang: Lang;
  models: ModelEntry[];
  selectedModel: string | null;
  selectedCheck: string | null;
  onSelect: (model: string, check: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`;
  return `${bytes} B`;
}

function ModelHead({ lang, model }: { lang: Lang; model: ModelEntry }) {
  const summary = model.report?.summary;
  return (
    <th
      scope="col"
      className="sticky top-0 z-10 w-60 min-w-60 border-b border-l border-line bg-panel px-2 py-1.5 text-left align-top"
    >
      <div
        onDoubleClick={copyOnDoubleClick(model.fileName)}
        title={model.fileName}
        className="cursor-copy break-all font-mono text-[12px] leading-tight font-semibold text-gold"
      >
        {model.fileName}
      </div>
      <div className="mt-1 flex items-baseline gap-2 font-mono text-[11px] leading-tight">
        <span
          className={
            model.state === "failed"
              ? "font-semibold text-bad"
              : model.state === "parsing"
                ? "animate-pulse font-semibold text-green"
                : "text-muted"
          }
        >
          {t(`file.${model.state}`, lang)}
        </span>
        <span className="text-muted">{formatBytes(model.sizeBytes)}</span>
      </div>
      {summary ? (
        <div className="mt-0.5 font-mono text-[11px] leading-tight text-muted">
          {summary.schema} · {summary.products} {t("summary.products", lang)} ·{" "}
          {Math.round(model.report?.parseMs ?? 0)} ms
        </div>
      ) : null}
      {model.error ? (
        <div
          onDoubleClick={copyOnDoubleClick(model.error)}
          className="mt-1 cursor-copy rounded-sm bg-bad px-1.5 py-1 font-mono text-[11px] leading-snug break-words text-cream"
        >
          {model.error}
        </div>
      ) : null}
    </th>
  );
}

function Cell({
  lang,
  model,
  check,
  selected,
  onSelect,
}: {
  lang: Lang;
  model: ModelEntry;
  check: CheckResult | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  if (model.state !== "ready" || !check) {
    return (
      <td className="h-11 border-b border-l border-line bg-input p-0">
        <div className="flex h-full items-center px-2 font-mono text-[12px] text-muted">
          {model.state === "failed" ? "—" : t(`file.${model.state}`, lang)}
        </div>
      </td>
    );
  }

  return (
    <td className="h-11 border-b border-l border-line p-0">
      <button
        type="button"
        onClick={onSelect}
        className={
          "flex h-full w-full items-center gap-2 px-2 text-left " +
          STATE_FILL[check.state] +
          (selected ? " outline-2 -outline-offset-[3px] outline-ink" : "")
        }
      >
        <span className="w-3 shrink-0 text-center font-mono text-[13px] font-bold">
          {STATE_GLYPH[check.state]}
        </span>
        <span className="truncate text-[12px] font-medium">
          {t(`state.${check.state}`, lang)}
        </span>
        {check.findings.length > 0 ? (
          <span className="ml-auto font-mono text-[12px] tabular-nums">
            {check.findings.length}
          </span>
        ) : null}
      </button>
    </td>
  );
}

export function Matrix({
  lang,
  models,
  selectedModel,
  selectedCheck,
  onSelect,
}: MatrixProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-20 w-64 min-w-64 border-b border-line bg-panel px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase align-bottom text-gold"
            >
              {t("matrix.check", lang)}
            </th>
            {models.map((model) => (
              <ModelHead key={model.id} lang={lang} model={model} />
            ))}
          </tr>
        </thead>
        <tbody>
          {CHECK_IDS.map((id) => (
            <tr key={id}>
              <th
                scope="row"
                className="sticky left-0 z-10 w-64 min-w-64 border-b border-line bg-cream px-3 py-1 text-left align-middle"
              >
                <div className="text-[13px] font-medium text-ink">{checkLabel(id, lang)}</div>
                <div className="font-mono text-[10px] text-muted">{id}</div>
              </th>
              {models.map((model) => {
                const check = model.report?.checks.find((c) => c.id === id);
                return (
                  <Cell
                    key={model.id}
                    lang={lang}
                    model={model}
                    check={check}
                    selected={selectedModel === model.id && selectedCheck === id}
                    onSelect={() => onSelect(model.id, id)}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
