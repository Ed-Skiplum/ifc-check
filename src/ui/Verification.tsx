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
import type { RuleResult } from "../ids/evaluate.ts";
import type { Focus } from "./trace";
import type { Lang, StringKey } from "./i18n";
import { verdictOf } from "../engine/fundamentals";
import { t } from "./i18n";
import { displayText } from "./display";
import { formatCount, formatShare } from "./format";
import { VERDICT_FILL, VERDICT_GLYPH, VERDICT_OF_RESULT } from "./state-visuals";

/** name · the filled verdict cell · the proportion. The verdict cell is a
 *  fixed column so every block starts on the same line and the colour reads as
 *  one stack rather than a ragged edge. */
const COLUMNS = "minmax(0, 1fr) minmax(14ch, 24ch) 5ch";

interface VerificationProps {
  lang: Lang;
  checks: CheckResult[];
  /** A project rule that speaks for a universal check: the row then carries
   *  the RULE's verdict and its arithmetic, and drills into the rule. */
  claimed: Map<string, RuleResult>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}

/** The proportion behind the value, when the value has one. A share and a
 *  uniqueness count do; a length unit does not, and an invented percentage
 *  there would be noise in a column that is otherwise read at a glance. */
function proportion(check: CheckResult, lang: Lang): string {
  const { code, params } = check.displayValue;
  if (code === "share") return formatShare(Number(params.good), Number(params.total), lang);
  if (code === "unique") return formatShare(Number(params.unique), Number(params.total), lang);
  return "";
}

export function Verification({ lang, checks, claimed, selected, onFocus }: VerificationProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-input">
      <div
        className="grid shrink-0 items-center gap-x-2 border-b border-line bg-panel px-[var(--bento-pad)] py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>{t("col.check", lang)}</span>
        <span>{t("col.found", lang)}</span>
        <span className="text-right">%</span>
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
                "grid w-full items-center gap-x-2 border-b border-line px-[var(--bento-pad)] py-1 text-left hover:bg-palegreen " +
                (selected === key ? "outline-2 -outline-offset-2 outline-ink" : "")
              }
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span className="truncate text-[12px] text-ink">
                {t(`check.${check.id}` as StringKey, lang)}
              </span>

              {/* Whole-element fill, always a glyph and the verdict's own name
                  as well as the colour — so the row survives a monochrome
                  print and a colour-blind reader. */}
              <span
                className={`flex items-center gap-2 px-2 py-0.5 text-[11px] ${VERDICT_FILL[verdict]}`}
              >
                <span className="font-mono text-[12px] font-bold">{VERDICT_GLYPH[verdict]}</span>
                <span className="shrink-0 text-[9px] font-semibold tracking-[0.1em] uppercase">
                  {t(`verdict.${verdict}`, lang)}
                </span>
                <span className="ml-auto truncate font-mono text-[12px] font-semibold tabular-nums">
                  {value}
                </span>
              </span>

              <span className="text-right font-mono text-[11px] tabular-nums text-muted">
                {share}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
