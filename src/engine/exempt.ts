/** Requirements a model is exempt from (`ModelFact.exempt`) or the setup
 *  ignores (`Ruleset.ignore`): the engine's checks for that model come back
 *  not_applicable with the reason, as its rules do in `evaluateRuleset`.
 *  Applied where the checks are run (the workers, the CLIs), so the screen,
 *  the report and `run` agree. */

import { notApplicable } from "../ids/evaluate.ts";
import type { Ruleset } from "../ids/types.ts";
import { literal } from "./fundamentals.ts";
import type { CheckResult } from "./types";

export function exemptChecks(
  checks: CheckResult[],
  ruleset: Ruleset | null | undefined,
  fileName: string,
): CheckResult[] {
  const off = notApplicable(ruleset, fileName);
  if (off.size === 0) return checks;
  return checks.map((check) => {
    const reason = off.get(check.id);
    return reason !== undefined
      ? {
          id: check.id,
          state: "not_applicable",
          severity: check.severity,
          displayValue: literal("—"),
          reason,
          applicable: 0,
          findings: [],
          detail: reason,
        }
      : check;
  });
}
