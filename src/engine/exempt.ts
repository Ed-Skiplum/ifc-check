/** Requirements a model is exempt from (`ModelFact.exempt`): the engine's
 *  checks for that model come back not_applicable with the reason, as its
 *  rules do in `evaluateRuleset`. Applied where the checks are run (the
 *  workers, the CLIs), so the screen, the report and `run` agree. */

import { exemptReason } from "../ids/evaluate.ts";
import { modelFact, modelLabel } from "../ids/models.ts";
import type { Ruleset } from "../ids/types.ts";
import { literal } from "./fundamentals.ts";
import type { CheckResult } from "./types";

export function exemptChecks(
  checks: CheckResult[],
  ruleset: Ruleset | null | undefined,
  fileName: string,
): CheckResult[] {
  const exempt = modelFact(ruleset, fileName)?.exempt;
  if (!exempt || exempt.length === 0) return checks;
  const reason = exemptReason(modelLabel(fileName));
  return checks.map((check) =>
    exempt.includes(check.id)
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
      : check,
  );
}
