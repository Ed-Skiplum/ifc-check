/** One entry per rule in the loaded ruleset, for one model.
 *
 * A model-wide miss is one fact, not N findings: the entry carries the
 * proportion, so `851 / 851` cannot be mistaken for `3 / 851`. Every entry is
 * rendered, including the ones the evaluator could not answer — a
 * `not_evaluable` rule hidden from this strip is the exact failure the tool
 * exists to prevent.
 */

import type { ModelResult } from "../ids/evaluate.ts";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { RESULT_FILL, RESULT_GLYPH } from "./state-visuals";

interface RuleStripProps {
  lang: Lang;
  evaluation?: ModelResult;
  evaluating?: boolean;
  evaluationError?: string;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}

export function RuleStrip({
  lang,
  evaluation,
  evaluating,
  evaluationError,
  selected,
  onFocus,
}: RuleStripProps) {
  if (evaluationError) {
    return (
      <div className="border border-line bg-panel">
        <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {t("error.ruleset", lang)}
        </div>
        <pre className="m-0 bg-bad px-2.5 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {evaluationError}
        </pre>
      </div>
    );
  }

  if (!evaluation) {
    if (!evaluating) return null;
    return (
      <div className="border border-line bg-panel px-2.5 py-2 font-mono text-[12px] text-muted">
        {t("result.evaluating", lang)}
      </div>
    );
  }

  return (
    <div className="border border-line bg-panel">
      <div className="flex items-baseline gap-3 px-2.5 pt-1.5 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {t("label.rules", lang)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted">
          {formatCount(evaluation.results.length, lang)}
        </span>
      </div>
      <div className="flex flex-wrap gap-px bg-line p-px">
        {evaluation.results.map((result) => {
          const key = `rule:${result.ruleId}`;
          return (
            <button
              key={result.ruleId}
              type="button"
              onClick={() => onFocus({ kind: "rule", ruleId: result.ruleId })}
              className={
                "flex items-center gap-2 px-2 py-1 text-left " +
                RESULT_FILL[result.state] +
                (selected === key ? " outline-2 -outline-offset-[3px] outline-ink" : "")
              }
            >
              <span className="font-mono text-[13px] font-bold">
                {RESULT_GLYPH[result.state]}
              </span>
              <span className="text-[12px] font-medium">{result.ruleName}</span>
              <span className="font-mono text-[11px] tabular-nums">
                {result.state === "not_evaluable"
                  ? t("result.not_evaluable", lang)
                  : `${formatCount(result.failed, lang)} / ${formatCount(result.applicable, lang)}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
