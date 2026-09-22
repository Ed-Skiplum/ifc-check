/** The verification block — the board's focal tile.
 *
 * One row per UNIVERSAL check: the checks that can be judged on sight, with no
 * ruleset. Three storeys all at kote 0 is a defect on any project; so is a
 * duplicate GlobalId, an unresolved length unit, a broken spatial chain. What
 * needs a project to say so — MMI, classification, naming conventions,
 * required property sets — stays behind the ruleset drop and is not here.
 *
 * ── The pattern ──────────────────────────────────────────────────────────
 * THE CELL SHOWS THE FOUND VALUE; THE COLOUR SHOWS THE VERDICT. Taken from
 * the delivered Skiplum reports (`skiplum-reports/projects/kistefos`, the
 * Modell × Krav matrix, whose result contract carries a `display_value`
 * alongside `status`). A red block says "bad"; a red block reading `m` or
 * `0 av 851` says what is wrong without a click.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 * There is no composite score and no grade. Eleven answers do not compress
 * into one number without losing the only thing that makes them useful.
 * And a verdict at ELEMENT granularity does not belong here: "851 elements
 * have no name" is ONE row reading `0 av 851`, and the 851 rows live behind
 * the drill-in.
 */

import type { CheckResult } from "../engine/types";
import type { ModelResult, RuleResult } from "../ids/evaluate.ts";
import type { Focus } from "./trace";
import type { Lang, StringKey } from "./i18n";
import { verdictOf } from "../engine/fundamentals";
import { t } from "./i18n";
import { displayText } from "./display";
import { formatCount, formatShare } from "./format";
import {
  RESULT_FILL,
  RESULT_GLYPH,
  VERDICT_FILL,
  VERDICT_GLYPH,
  VERDICT_OF_RESULT,
} from "./state-visuals";

/** name · the filled verdict cell · the proportion. The verdict cell is a
 *  fixed column so every block starts on the same line and the colour reads as
 *  one stack rather than a ragged edge. In `em` of the row's own type, so it
 *  scales with the list line: 18em seats glyph · ADVARSEL · "12 345 av
 *  123 456" without cutting the value, which is never truncated. */
const COLUMNS = "minmax(0, 1fr) 18em 4.5em";

interface VerificationProps {
  lang: Lang;
  checks: CheckResult[];
  /** A project rule that speaks for a universal check: the row then carries
   *  the RULE's verdict and its arithmetic, and drills into the rule. */
  claimed: Map<string, RuleResult>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  /** Only when a ruleset is loaded: the project rules, as rows under a
   *  section rule. This replaced the separate rule strip under the board
   *  (2026-09-21), which squeezed every tile above it. */
  rules?: {
    evaluation?: ModelResult;
    evaluating?: boolean;
    error?: string;
  };
}

// Row and type ride the grid's list line (`--bento-line`, a fixed fraction of
// the track), so the focal shows the same rows at every size between
// breakpoints instead of 24 px rows and a void on a big screen.
const ROW =
  "grid h-[var(--bento-line)] w-full text-[length:var(--bento-fs)] items-center gap-x-2 border-b border-line px-[var(--bento-pad)] text-left";
const CELL =
  "flex h-[calc(var(--bento-line)-4px)] items-center gap-2 px-2 text-[length:var(--bento-fs-sm)]";
const NAME = "truncate text-[length:var(--bento-fs)] text-ink";
const GLYPH = "font-mono text-[length:var(--bento-fs)] font-bold";
const WORD = "shrink-0 text-[length:var(--bento-fs-sm)] font-semibold tracking-[0.1em] uppercase";
const VALUE =
  "ml-auto shrink-0 font-mono text-[length:var(--bento-fs)] font-semibold whitespace-nowrap tabular-nums";
const SHARE = "text-right font-mono text-[length:var(--bento-fs-sm)] whitespace-nowrap tabular-nums text-muted";
const SECTION =
  "flex h-[var(--bento-line)] items-center gap-2 border-line bg-panel px-[var(--bento-pad)] text-[length:var(--bento-fs-sm)] font-semibold tracking-[0.12em] text-gold uppercase";

/** The proportion behind the value, when the value has one. A share and a
 *  uniqueness count do; a length unit does not, and an invented percentage
 *  there would be noise in a column that is otherwise read at a glance. */
function proportion(check: CheckResult, lang: Lang): string {
  const { code, params } = check.displayValue;
  if (code === "share") return formatShare(Number(params.good), Number(params.total), lang);
  if (code === "unique") return formatShare(Number(params.unique), Number(params.total), lang);
  return "";
}

export function Verification({
  lang,
  checks,
  claimed,
  selected,
  onFocus,
  rules,
}: VerificationProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-input">
      <div
        className="grid h-[var(--bento-line)] shrink-0 items-center gap-x-2 border-b border-line bg-panel px-[var(--bento-pad)] text-[length:var(--bento-fs)] font-semibold tracking-[0.12em] text-gold uppercase"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span className="truncate text-[length:var(--bento-fs-sm)]">{t("col.check", lang)}</span>
        <span className="truncate text-[length:var(--bento-fs-sm)]">{t("col.found", lang)}</span>
        <span className="text-right text-[length:var(--bento-fs-sm)]">%</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {checks.map((check) => {
          const rule = claimed.get(check.id);
          const verdict = rule ? VERDICT_OF_RESULT[rule.state] : verdictOf(check);
          const value = rule
            ? `${formatCount(Math.max(0, rule.applicable - rule.failed), lang)} / ${formatCount(rule.applicable, lang)}`
            : displayText(check.displayValue, lang);
          const share = rule
            ? formatShare(Math.max(0, rule.applicable - rule.failed), rule.applicable, lang)
            : proportion(check, lang);
          const focus: Focus = rule
            ? { kind: "rule", ruleId: rule.ruleId }
            : { kind: "check", checkId: check.id };
          const key = rule ? `rule:${rule.ruleId}` : `check:${check.id}`;

          return (
            <button
              key={check.id}
              type="button"
              onClick={() => onFocus(focus)}
              title={rule ? rule.ruleName : check.detail}
              className={
                `${ROW} hover:bg-palegreen ` +
                (selected === key ? "outline-2 -outline-offset-2 outline-ink" : "")
              }
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span data-essential className={NAME}>
                {t(`check.${check.id}` as StringKey, lang)}
              </span>

              {/* Whole-element fill, always a glyph and the verdict's own name
                  as well as the colour — so the row survives a monochrome
                  print and a colour-blind reader. */}
              <span className={`${CELL} ${VERDICT_FILL[verdict]}`}>
                <span className={GLYPH}>{VERDICT_GLYPH[verdict]}</span>
                <span data-essential className={WORD}>
                  {t(`verdict.${verdict}`, lang)}
                </span>
                <span data-essential className={VALUE}>
                  {value}
                </span>
              </span>

              <span data-essential className={SHARE}>
                {share}
              </span>
            </button>
          );
        })}

        {rules ? <RuleRows lang={lang} rules={rules} selected={selected} onFocus={onFocus} /> : null}
      </div>
    </div>
  );
}

/** The project rules, one row each, in the check rows' shape. Every rule is
 *  rendered, including the ones the evaluator could not answer: a
 *  `not_evaluable` rule hidden from here is the exact failure the tool exists
 *  to prevent. */
function RuleRows({
  lang,
  rules,
  selected,
  onFocus,
}: {
  lang: Lang;
  rules: NonNullable<VerificationProps["rules"]>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const results = rules.evaluation?.results;
  return (
    <>
      <div
        className={`sticky top-0 z-10 border-y ${SECTION}`}
      >
        <span>{t("label.rules", lang)}</span>
        {results ? (
          <span className="ml-auto font-mono tabular-nums text-muted">
            {formatCount(results.length, lang)}
          </span>
        ) : null}
      </div>

      {rules.error ? (
        <pre className="m-0 bg-bad px-[var(--bento-pad)] py-1 font-mono text-[length:var(--bento-fs-sm)] leading-snug whitespace-pre-wrap text-cream">
          {t("error.ruleset", lang)}: {rules.error}
        </pre>
      ) : !results ? (
        rules.evaluating ? (
          <div className={`${ROW} font-mono text-[length:var(--bento-fs-sm)] text-muted`}>
            {t("result.evaluating", lang)}
          </div>
        ) : null
      ) : (
        results.map((result) => {
          const key = `rule:${result.ruleId}`;
          const evaluable = result.state !== "not_evaluable";
          return (
            <button
              key={result.ruleId}
              type="button"
              onClick={() => onFocus({ kind: "rule", ruleId: result.ruleId })}
              title={result.ruleName}
              className={
                `${ROW} hover:bg-palegreen ` +
                (selected === key ? "outline-2 -outline-offset-2 outline-ink" : "")
              }
              style={{ gridTemplateColumns: COLUMNS }}
            >
              {/* A rule name is the author's free text and can be a sentence:
                  it ellipsizes by design, full name in the row's title. */}
              <span className={NAME}>{result.ruleName}</span>
              <span className={`${CELL} ${RESULT_FILL[result.state]}`}>
                <span className={GLYPH}>{RESULT_GLYPH[result.state]}</span>
                <span data-essential className={WORD}>
                  {t(`result.${result.state}`, lang)}
                </span>
                {evaluable ? (
                  <span data-essential className={VALUE}>
                    {formatCount(Math.max(0, result.applicable - result.failed), lang)} /{" "}
                    {formatCount(result.applicable, lang)}
                  </span>
                ) : null}
              </span>
              <span data-essential className={SHARE}>
                {evaluable && result.applicable > 0
                  ? formatShare(Math.max(0, result.applicable - result.failed), result.applicable, lang)
                  : ""}
              </span>
            </button>
          );
        })
      )}
    </>
  );
}
