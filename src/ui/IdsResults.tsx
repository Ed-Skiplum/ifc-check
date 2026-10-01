/** The IDS group of the IDS tab's report (`alt/ProjectBoard.tsx`): one row
 *  per specification of the loaded `.ids`, in file order (edkjo 2026-10-01:
 *  *"IDS is a report. No nonsense … display requirement, result"*).
 *  `IdsHead` is the report tile's head, `IdsRows` the group's rows.
 *
 * The file is opened or dropped on the IDS tab, apart from the ruleset: an
 * `.ids` run as written, through `src/ids/import.ts` and the evaluator
 * (`ids-report.ts`).
 *
 * A row is the specification's name, what it asks (its applicability and
 * requirements facets as imported, in IDS terms, `req-view.ts` `idsFacets`),
 * then Aktuelle · Bestått · Avvik · status. A specification whose
 * applicability matched nothing is NOT APPLIED (`ids.notApplied`), never a
 * pass; one the evaluator could not answer is `not_evaluable` with the reason
 * under its facets.
 *
 * A row is a door like every other on the board: the click opens the
 * derivation (the failing elements) in Scope and adds the chip that isolates
 * them in the viewer tile beside the report (the board's one scene, lent).
 */

import type { ReactNode, RefObject } from "react";
import type { ResultState } from "../ids/evaluate.ts";
import type { IdsRule } from "../ids/types.ts";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Focus } from "./trace";
import type { ModelEntry } from "./useModels";
import { copyOnDoubleClick } from "./copy";
import { VERDICT_GLYPH } from "./state-visuals";
import { t as builderT } from "../builder/strings.ts";
import { AskPart, ReportLine, type LineLook } from "./alt/Requirements";
import { idsFacets } from "./alt/req-view";

/** The loaded `.ids`, shared by every model panel. */
export interface IdsSession {
  fileName: string;
  title: string;
  /** The specifications as imported, in file order; null where one could
   *  not be read (`ImportedSpec.unreadable`). */
  rules: (IdsRule | null)[];
}

const IDS_FILE = /\.(ids|xml)$/i;

export function isIdsFile(file: File): boolean {
  return IDS_FILE.test(file.name);
}

function lookOf(state: ResultState, lang: Lang): LineLook {
  switch (state) {
    case "pass":
    case "fail":
      return { verdict: state, glyph: VERDICT_GLYPH[state], word: t(`result.${state}`, lang), state };
    case "not_applicable":
      return { verdict: "na", glyph: VERDICT_GLYPH.na, word: t("ids.notApplied", lang), state };
    default:
      return { verdict: "warn", glyph: "?", word: t("result.not_evaluable", lang), state };
  }
}

const BUTTON =
  "shrink-0 cursor-pointer border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green";

/** The tile head's end: the file's name, open, remove. `input` is the hidden
 *  file input the body's empty state opens too. */
export function IdsHead({
  lang,
  session,
  input,
  onFile,
  onClear,
}: {
  lang: Lang;
  session: IdsSession | null;
  input: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2">
      {session ? (
        <span
          onDoubleClick={copyOnDoubleClick(session.fileName)}
          className="min-w-0 cursor-copy truncate font-mono text-[11px] text-muted"
          title={session.title}
        >
          {session.fileName}
        </span>
      ) : null}
      <input
        ref={input}
        type="file"
        accept=".ids,.xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
        {t("action.openIds", lang)}
      </button>
      {session ? (
        <button type="button" className={BUTTON} onClick={onClear}>
          {t("action.remove", lang)}
        </button>
      ) : null}
    </span>
  );
}


/** What one specification asks: «Gjelder for» its applicability, «Krav» its
 *  requirements, one facet per line, as the builder labels them. */
function IdsAsk({ rule, reason, lang }: { rule: IdsRule | null; reason?: string; lang: Lang }) {
  const parts: [string, string[]][] = rule
    ? [
        [builderT("ids.applicability", lang), idsFacets(rule.applicability)],
        [builderT("ids.requirements", lang), idsFacets(rule.requirements)],
      ]
    : [];
  return (
    <>
      {parts.map(([label, lines]) =>
        lines.length ? (
          <AskPart key={label} label={label}>
            {lines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </AskPart>
        ) : null,
      )}
      {reason ? <span className="font-mono text-[11px] break-words text-muted">{reason}</span> : null}
    </>
  );
}

/** The report's IDS group: the import error in full, then one row per
 *  specification; with no `.ids`, the open button; while it runs,
 *  «Vurderer». `cols` is the report's column count. */
export function IdsRows({
  lang,
  model,
  session,
  error,
  selected,
  onFocus,
  input,
  cols,
}: {
  lang: Lang;
  model: ModelEntry;
  session: IdsSession | null;
  /** The file could not be imported. Shown in full. */
  error: string | null;
  /** The open derivation's focus key, when it is this model's. */
  selected: string | null;
  onFocus: (focus: Focus) => void;
  input: RefObject<HTMLInputElement | null>;
  cols: number;
}) {
  const result = model.ids;
  const failed = error ?? model.idsError ?? null;
  const whole = (body: ReactNode) => (
    <tr>
      <td colSpan={cols} className="p-0">
        {body}
      </td>
    </tr>
  );
  return (
    <>
      {failed
        ? whole(
            <pre
              onDoubleClick={copyOnDoubleClick(failed)}
              className="m-0 cursor-copy bg-bad px-2.5 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream"
            >
              {`${t("error.ids", lang)}: ${failed}`}
            </pre>,
          )
        : null}
      {session && result
        ? result.specs.map((spec) => {
            const counted = spec.state === "pass" || spec.state === "fail";
            return (
              <ReportLine
                key={spec.index}
                name={spec.name}
                ask={<IdsAsk rule={session.rules[spec.index] ?? null} reason={spec.state === "not_evaluable" ? spec.reason : undefined} lang={lang} />}
                counts={{
                  applicable: spec.state === "not_evaluable" ? null : spec.applicable,
                  passed: counted ? spec.passed : null,
                  failed: counted ? spec.failed : null,
                }}
                look={lookOf(spec.state, lang)}
                focus={{ kind: "ids", index: spec.index }}
                title={spec.reason ?? spec.description ?? spec.name}
                lang={lang}
                selected={selected}
                onFocus={onFocus}
                data={{ "data-ids-spec": spec.index }}
              />
            );
          })
        : session && model.idsEvaluating
          ? whole(<div className="px-3 py-2 text-[12px] text-muted">{t("result.evaluating", lang)}</div>)
          : whole(
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="w-full cursor-pointer px-3 py-3 text-[12px] text-muted hover:text-green"
              >
                {t("action.openIds", lang)}
              </button>,
            )}
    </>
  );
}
