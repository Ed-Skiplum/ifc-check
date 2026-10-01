/** What a code-lookup rule's `extract` makes of the property's real values,
 *  judged the way `codeLookup` (`src/ids/evaluate.ts`) judges an element:
 *  the first capture group is the code, an empty or absent one is no match,
 *  and the code must be in the rule's list (bundled or the project's own) and
 *  not reserved there.
 *
 * Pure. An invalid pattern or an unknown list throws the evaluator's own
 * error, so the step shows that error instead of a stale preview.
 */

import { compileExtract, resolveLookup } from "../ids/evaluate.ts";
import type { CodeLookupCheck } from "../ids/types.ts";
import type { PsetValue } from "./pset-choices.ts";

/** `ok` a valid code · `no-match` the pattern yields no code · `not-in-list`
 *  a code the list lacks or reserves. */
export type ExtractState = "ok" | "no-match" | "not-in-list";

export interface ExtractRow extends PsetValue {
  code: string | null;
  state: ExtractState;
}

export interface ExtractPreview {
  rows: ExtractRow[];
  /** Elements per state, over the listed values. */
  totals: Record<ExtractState, number>;
}

export function previewExtract(check: Pick<CodeLookupCheck, "extract" | "list" | "codes">, values: PsetValue[]): ExtractPreview {
  const regex = compileExtract(check.extract);
  const lookup = resolveLookup(check as CodeLookupCheck);
  const totals: Record<ExtractState, number> = { ok: 0, "no-match": 0, "not-in-list": 0 };
  const rows = values.map((value): ExtractRow => {
    const code = regex.exec(value.v)?.[1];
    const state: ExtractState =
      code === undefined || code === ""
        ? "no-match"
        : !lookup.has(code) || lookup.reserved(code)
          ? "not-in-list"
          : "ok";
    totals[state] += value.n;
    return { ...value, code: code === undefined || code === "" ? null : code, state };
  });
  return { rows, totals };
}
