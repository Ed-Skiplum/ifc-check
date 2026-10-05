/** The extract preview's states as the shared verdict fill and glyph, alone
 *  or with their element count. Moved out of `SetupPage.tsx` so the walk
 *  (`Walk.tsx`) and the values list draw one chip. */

import type { Lang } from "../i18n";
import type { Verdict } from "../../engine/types";
import { formatCount } from "../format";
import { VERDICT_FILL, VERDICT_GLYPH } from "../state-visuals";
import type { ExtractPreview, ExtractState } from "../extract-preview";

/** Which elements a state covers: a valid code, no match, a code not in the
 *  list, and (a capped list only) the elements whose values are not listed. */
const EXTRACT_VERDICT: Record<ExtractState | "rest", Verdict> = {
  ok: "pass",
  "no-match": "fail",
  "not-in-list": "warn",
  rest: "na",
};

export function StateChip({ state, count, lang }: { state: ExtractState | "rest"; count?: number; lang: Lang }) {
  // Colour is status: «✓ 0» passes nothing, so it is not green.
  const verdict = state === "ok" && count === 0 ? "na" : EXTRACT_VERDICT[state];
  return (
    <span
      data-state={state}
      className={
        "inline-flex items-center justify-center gap-1.5 font-mono text-[12px] tabular-nums " +
        VERDICT_FILL[verdict] +
        (count === undefined ? " h-5 w-5" : " px-2 py-0.5")
      }
    >
      <span aria-hidden="true">{VERDICT_GLYPH[verdict]}</span>
      {count === undefined ? null : <span>{formatCount(count, lang)}</span>}
    </span>
  );
}

/** A preview's totals: ok, no match, not in list, and the unlisted rest
 *  when there is one. A state with no elements is left out, ok excepted. */
export function TotalChips({ preview, rest = 0, lang }: { preview: ExtractPreview; rest?: number; lang: Lang }) {
  const t = preview.totals;
  return (
    <span data-totals className="flex flex-wrap items-center gap-1.5">
      <StateChip state="ok" count={t.ok} lang={lang} />
      {t["no-match"] > 0 ? <StateChip state="no-match" count={t["no-match"]} lang={lang} /> : null}
      {t["not-in-list"] > 0 ? <StateChip state="not-in-list" count={t["not-in-list"]} lang={lang} /> : null}
      {rest > 0 ? <StateChip state="rest" count={rest} lang={lang} /> : null}
    </span>
  );
}
