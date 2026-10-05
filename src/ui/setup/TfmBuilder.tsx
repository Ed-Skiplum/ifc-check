/** The TFM step's string builder (2026-10-05). edkjo: "we also need a TFM
 *  builder there. Tverrfaglig merkesystem. Default is the standard" · "but
 *  we need a very intuitive string builder" · "this is a fun one, since
 *  other properties come into play as components: system, function and
 *  location".
 *
 * The example string is the editor: one row of chips, a chip per part and
 * per separator, each showing its text in a real value of the loaded model
 * when one parses (else the standard's example). Direct manipulation only:
 *
 *   drag a chip          reorder (pointer events; the gap it lands in shows)
 *   ← → on a chip        move it one place
 *   Delete / Backspace   remove it
 *   click / Enter        change it in place: the part, its digit count, the
 *                        separator, the text; Lokasjon's binding, in the
 *                        mapping layout, compact (`LokasjonMapping`)
 *   + between chips      insert a part, a separator or text there
 *
 * A bound chip names what its part is compared with (the step's property,
 * Etasjeoppsett, Lokasjon's own); a part with nothing to compare reads «Kun
 * format». Live under the row: the property's evidence against the sequence
 * as it stands, and the values off it with where they leave it marked.
 * Agreement is not live: it needs each element's own values, which only the
 * check pairs; it lands with the result (`TfmResult`).
 *
 * Pure parsing is `src/engine/tfm.ts`; the ranking is `candidates.ts`.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_FILL } from "../state-visuals";
import type { PsetValue } from "../pset-choices";
import type { ReportRow } from "../../engine/report";
import type { Requirement } from "../requirements";
import type { TfmPart, TfmSeparator, TfmToken } from "../../ids/types.ts";
import {
  DIGIT_PARTS,
  STATSBYGG_SEQUENCE,
  TFM_PARTS,
  TFM_SEPARATORS,
  exampleText,
  sameSequence,
  tfmMatcher,
} from "../../engine/tfm.ts";
import { ReqResult } from "./Walk";
import { ChipRow, PILL, type ChipFace, type ChipParse } from "./ChipRow";
import { OptionList, type MapOption } from "./Mapping";

/** What a chip says about its binding. `bound`: the name of what it reads.
 *  `shape`: nothing to compare, «Kun format». Absent: a part that never
 *  binds (Løpenummer, Komp.nr, ...). */
export type ChipBinding = { kind: "bound"; label: string; title: string } | { kind: "shape" };

export interface BindingChoice {
  set: string;
  name: string;
  n: number;
  /** The standard's source (POFIN: `NONS_Reference.RefPriSysLoc`), listed
   *  first with its count, 0 included. */
  standard?: boolean;
}

const sepGlyph = (sep: TfmSeparator) => (sep === " " ? "␣" : sep);

function tokenName(token: TfmToken): string {
  if ("part" in token) return token.part;
  if ("sep" in token) return sepGlyph(token.sep);
  return `"${token.text}"`;
}

const LABEL = "text-[10px] font-semibold tracking-[0.12em] text-gold uppercase";

/** The insert palette: every part, every separator, text. */
function InsertPalette({ lang, onPick }: { lang: Lang; onPick: (token: TfmToken) => void }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {TFM_PARTS.map((part) => (
          <button key={part} type="button" className={PILL} onClick={() => onPick({ part })}>
            {part}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TFM_SEPARATORS.map((sep) => (
          <button key={sep} type="button" className={PILL + " min-w-9"} onClick={() => onPick({ sep })}>
            {sepGlyph(sep)}
          </button>
        ))}
        <button type="button" className={PILL} onClick={() => onPick({ text: "" })}>
          {t("tfm.text", lang)}
        </button>
      </div>
    </>
  );
}

/** A chip's editor: what the token is, changed in place. */
function ChipEditor({
  token,
  lang,
  bindings,
  bound,
  editor,
  onChange,
  onBind,
  onRemove,
}: {
  token: TfmToken;
  lang: Lang;
  /** Lokasjon only: the properties sharing its values, and the current one. */
  bindings: readonly BindingChoice[];
  bound: { set: string; name: string } | null;
  /** Lokasjon only: the full picker, under «Endre». */
  editor?: ReactNode;
  onChange: (token: TfmToken) => void;
  onBind: (source: { set: string; name: string } | null) => void;
  onRemove: () => void;
}) {
  const remove = (
    <button type="button" onClick={onRemove} className="w-fit px-1 py-1 text-[12px] text-muted hover:text-bad">
      {t("action.remove", lang)}
    </button>
  );
  if ("sep" in token) {
    return (
      <>
        <div className="flex flex-wrap gap-1.5">
          {TFM_SEPARATORS.map((sep) => (
            <button key={sep} type="button" aria-pressed={sep === token.sep} className={PILL + " min-w-9"} onClick={() => onChange({ sep })}>
              {sepGlyph(sep)}
            </button>
          ))}
        </div>
        {remove}
      </>
    );
  }
  if ("text" in token) {
    return (
      <>
        <input
          type="text"
          autoFocus
          aria-label={t("tfm.text", lang)}
          value={token.text}
          onChange={(event) => onChange({ text: event.target.value })}
          className="min-h-9 border border-line bg-input px-2 font-mono text-[15px] text-ink focus:border-green"
        />
        {remove}
      </>
    );
  }
  const digitPart = DIGIT_PARTS.includes(token.part);
  const digits = token.digits;
  const withDigits = (n: number | undefined): TfmToken => (n === undefined ? { part: token.part } : { part: token.part, digits: n });
  const listed = bound && !bindings.some((b) => b.set === bound.set && b.name === bound.name) ? [{ ...bound, n: -1 }, ...bindings] : bindings;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {TFM_PARTS.map((part) => (
          <button
            key={part}
            type="button"
            aria-pressed={part === token.part}
            className={PILL}
            onClick={() => onChange(DIGIT_PARTS.includes(part) && digits !== undefined ? { part, digits } : { part })}
          >
            {part}
          </button>
        ))}
      </div>
      {digitPart ? (
        <div className="flex items-center gap-2">
          <span className={LABEL}>{t("tfm.digits", lang)}</span>
          <button
            type="button"
            aria-label="−"
            disabled={digits === undefined}
            onClick={() => onChange(withDigits(digits !== undefined && digits > 1 ? digits - 1 : undefined))}
            className={PILL + " min-w-9 disabled:opacity-40"}
          >
            −
          </button>
          <span data-tfm-digits className="min-w-6 text-center font-mono text-[15px] tabular-nums text-ink">
            {digits ?? "–"}
          </span>
          <button
            type="button"
            aria-label="+"
            disabled={digits !== undefined && digits >= 12}
            onClick={() => onChange(withDigits((digits ?? 0) + 1))}
            className={PILL + " min-w-9 disabled:opacity-40"}
          >
            +
          </button>
        </div>
      ) : null}
      {token.part === "Lokasjon" ? <LokasjonMapping listed={listed} bound={bound} editor={editor} lang={lang} onBind={onBind} /> : null}
      {remove}
    </>
  );
}

/** Lokasjon's binding, compact (2026-10-05, review: the chip's popover
 *  nested a whole mapping step and ran off the viewport): the sources to
 *  pick from, the standard first with its count, the properties sharing the
 *  string's segments, «Ingen»; «Endre» opens any property (typed when the
 *  models lack it). A pick binds; the step's «Bruk» writes it. */
function LokasjonMapping({
  listed,
  bound,
  editor,
  lang,
  onBind,
}: {
  listed: readonly BindingChoice[];
  bound: { set: string; name: string } | null;
  editor?: ReactNode;
  lang: Lang;
  onBind: (source: { set: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const isBound = (b: { set: string; name: string }) => bound !== null && bound.set === b.set && bound.name === b.name;
  const options: MapOption[] = [
    ...listed.map(
      (b): MapOption => ({
        key: `${b.set}\u0000${b.name}`,
        tag: b.standard ? t("setup.standard", lang) : null,
        title: `${b.set}.${b.name}`,
        count:
          b.n >= 0 ? (
            <span className={"shrink-0 px-1 font-mono text-[12px] tabular-nums " + (b.n === 0 ? VERDICT_FILL.fail : "")}>
              {formatCount(b.n, lang)}
            </span>
          ) : null,
        current: isBound(b),
        onPick: () => onBind({ set: b.set, name: b.name }),
      }),
    ),
    { key: "none", title: t("tfm.none", lang), current: bound === null, onPick: () => onBind(null) },
  ];
  return (
    <div data-lokasjon className="flex w-[min(28rem,80vw)] flex-col gap-2">
      <OptionList options={options} label="Lokasjon" lang={lang} more={editor ? { open, onToggle: () => setOpen((was) => !was) } : undefined} />
      {open ? <div className="max-h-[40vh] overflow-auto">{editor}</div> : null}
    </div>
  );
}

export function TfmBuilder({
  sequence,
  values,
  binding,
  lokasjonChoices,
  lokasjon,
  lokasjonEditor,
  lang,
  onSequence,
  onLokasjon,
}: {
  /** Lokasjon's full picker: any property, or one typed in. */
  lokasjonEditor?: ReactNode;
  sequence: readonly TfmToken[];
  /** The TFM property's listed values, most frequent first; empty with no
   *  property or no model. */
  values: readonly PsetValue[];
  /** Per part: what its chip says it is compared with. */
  binding: (part: TfmPart) => ChipBinding | undefined;
  lokasjonChoices: readonly BindingChoice[];
  lokasjon: { set: string; name: string } | null;
  lang: Lang;
  onSequence: (next: TfmToken[]) => void;
  onLokasjon: (source: { set: string; name: string } | null) => void;
}) {
  const parse = useMemo(() => {
    try {
      const matcher = tfmMatcher(sequence);
      return (value: string): ChipParse => {
        const parsed = matcher.parse(value);
        return parsed.ok ? { ok: true, texts: parsed.segments.map((s) => s.text) } : parsed;
      };
    } catch {
      return null;
    }
  }, [sequence]);

  const face = (token: TfmToken): ChipFace => {
    const bind = "part" in token ? binding(token.part) : undefined;
    return {
      kind: "part" in token ? token.part : "sep" in token ? "sep" : "text",
      big: "sep" in token ? sepGlyph(token.sep) : undefined,
      part: "part" in token,
      dashed: "text" in token,
      bound: bind?.kind === "bound",
      sub:
        "part" in token ? (
          <span className="text-[11px] whitespace-nowrap text-muted">
            {token.part}
            {token.digits ? <span className="font-mono"> ·{token.digits}</span> : null}
          </span>
        ) : undefined,
      extra:
        bind?.kind === "bound" ? (
          <span data-tfm-binding="bound" title={bind.title} className="max-w-40 truncate text-[11px] text-green">
            ⇄ {bind.label}
          </span>
        ) : bind?.kind === "shape" ? (
          <span data-tfm-binding="shape" className="text-[11px] whitespace-nowrap text-muted">
            {t("tfm.shapeOnly", lang)}
          </span>
        ) : undefined,
    };
  };

  return (
    <div data-tfm-builder className="flex flex-col gap-4">
      <ChipRow
        sequence={sequence}
        values={values}
        parse={parse}
        exampleOf={exampleText}
        face={face}
        name={tokenName}
        editor={(token, change, remove) => (
          <ChipEditor
            token={token}
            lang={lang}
            bindings={lokasjonChoices}
            bound={lokasjon}
            editor={lokasjonEditor}
            onChange={change}
            onBind={onLokasjon}
            onRemove={remove}
          />
        )}
        palette={(pick) => <InsertPalette lang={lang} onPick={pick} />}
        typed={(token) => ("text" in token ? { empty: token.text === "" } : null)}
        standard={STATSBYGG_SEQUENCE}
        same={sameSequence}
        lang={lang}
        onSequence={onSequence}
      />
    </div>
  );
}

/** What the TFM step gave, per model: the report row's state and figure (as
 *  the IDS tab reads it), then per part compared, agreeing and disagreeing
 *  elements; a part with nothing to compare, «Kun format». Read off the
 *  rows the board was evaluated with, so it shows once the check has run. */
export function TfmResult({
  results,
  lang,
}: {
  results: readonly { model: string; req: Requirement | null }[];
  lang: Lang;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <ReqResult results={results} lang={lang} />
      {results.map(({ model, req }) => {
        const deler = (req?.row as ReportRow | null | undefined)?.deler ?? [];
        return deler
          .filter((d) => d.kun_form !== "no-binding")
          .map((d, i) => (
            <span key={`${model}\u0000${i}`} title={model} data-tfm-part={d.del} className="inline-flex items-center gap-1.5 font-mono text-[12px]">
              <span className="text-ink">{d.del}</span>
              {d.kun_form ? (
                <span className="text-muted">{t("tfm.shapeOnly", lang)}</span>
              ) : (
                <>
                  <span className={"px-1.5 tabular-nums " + VERDICT_FILL.pass}>✓ {formatCount(d.samsvar, lang)}</span>
                  {d.avvik > 0 ? <span className={"px-1.5 tabular-nums " + VERDICT_FILL.fail}>✗ {formatCount(d.avvik, lang)}</span> : null}
                </>
              )}
            </span>
          ));
      })}
    </span>
  );
}
