/** The type name step (2026-10-05). edkjo: "Type name can follow that
 *  suggestion or something else. The important thing is that everything is
 *  typed, and it should be possible to set a naming scheme by regex or by
 *  accepted value lists" · "where we build in NS3457-8 and NS3451 as options
 *  to select. Can also be a hybrid: List item one part, regex another part".
 *
 * Two things on one step. Typed: the board's own Typeobjekt row (the
 * `element-typed` fundamental), as the IDS tab reads it; nothing recounted.
 * The scheme: a row of parts in the TFM builder's chip row (`ChipRow.tsx`),
 * each a code list (NS 3457-8, NS 3451), accepted values, a pattern, or
 * text. The suggestion is POFIN's Objekttypenavn, NS 3457-8 + "." + a
 * number (`POFIN_TYPE_NAME`). Live: the loaded models' type Names that
 * match, of all, and the names off it with where each leaves it. «Bruk»
 * writes the `type-name` rule; its report row lands on the next step.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import type { PsetValue } from "../pset-choices";
import type { NamePart } from "../../ids/types.ts";
import { CODE_LISTS } from "../../codelists/index.ts";
import { POFIN_TYPE_NAME, nameMatcher, partExample, partName, sameScheme } from "../../engine/type-name.ts";
import { ChipRow, PILL, type ChipFace, type ChipParse } from "./ChipRow";
import { CONFIRM, Figure } from "./Walk";
import { INPUT, ValuesInput } from "./ValuesInput";

type Kind = "ns3457-8" | "ns3451" | "values" | "regex" | "text";

const KINDS: readonly Kind[] = ["ns3457-8", "ns3451", "values", "regex", "text"];

function kindOf(part: NamePart): Kind {
  if ("list" in part) return part.list;
  if ("values" in part) return "values";
  if ("regex" in part) return "regex";
  return "text";
}

function blankPart(kind: Kind): NamePart {
  if (kind === "ns3457-8" || kind === "ns3451") return { list: kind };
  if (kind === "values") return { values: [] };
  if (kind === "regex") return { regex: "\\d+" };
  return { text: "" };
}

/** A kind as its pill names it: the list's own label, else the existing
 *  field names. */
function kindLabel(kind: Kind, lang: Lang): string {
  if (kind === "ns3457-8" || kind === "ns3451") return CODE_LISTS[kind].meta.label;
  if (kind === "values") return t("field.accepted", lang);
  if (kind === "regex") return t("field.pattern", lang);
  return t("tfm.text", lang);
}

function Kinds({ current, lang, onPick }: { current: Kind | null; lang: Lang; onPick: (kind: Kind) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {KINDS.map((kind) => (
        <button key={kind} type="button" aria-pressed={kind === current} className={PILL} onClick={() => onPick(kind)}>
          {kindLabel(kind, lang)}
        </button>
      ))}
    </div>
  );
}

/** A part's editor: its kind, then what the kind takes. */
function PartEditor({
  part,
  lang,
  onChange,
  onRemove,
}: {
  part: NamePart;
  lang: Lang;
  onChange: (next: NamePart) => void;
  onRemove: () => void;
}) {
  const kind = kindOf(part);
  return (
    <>
      <Kinds current={kind} lang={lang} onPick={(k) => k !== kind && onChange(blankPart(k))} />
      {"values" in part ? (
        <ValuesInput
          values={part.values}
          invalid={part.values.length === 0}
          multiline
          label={kindLabel("values", lang)}
          onChange={(values) => onChange({ values })}
        />
      ) : null}
      {"regex" in part ? (
        <input
          type="text"
          autoFocus
          aria-label={kindLabel("regex", lang)}
          value={part.regex}
          onChange={(e) => onChange({ regex: e.target.value })}
          className={INPUT + " min-h-9 text-[15px]"}
        />
      ) : null}
      {"text" in part ? (
        <input
          type="text"
          autoFocus
          aria-label={kindLabel("text", lang)}
          value={part.text}
          onChange={(e) => onChange({ text: e.target.value })}
          className="min-h-9 border border-line bg-input px-2 font-mono text-[15px] text-ink focus:border-green"
        />
      ) : null}
      <button type="button" onClick={onRemove} className="w-fit px-1 py-1 text-[12px] text-muted hover:text-bad">
        {t("action.remove", lang)}
      </button>
    </>
  );
}

export function TypeNameStep({
  saved,
  typeNames,
  typed,
  lang,
  onConfirm,
}: {
  /** The ruleset's scheme, or null. */
  saved: readonly NamePart[] | null;
  /** The loaded models' type Names, with the elements using each; null with
   *  no model read. */
  typeNames: readonly PsetValue[] | null;
  /** The Typeobjekt row's result, per model. */
  typed: ReactNode;
  lang: Lang;
  onConfirm: (sequence: NamePart[]) => void;
}) {
  const [sequence, setSequence] = useState<NamePart[]>(() => [...(saved ?? POFIN_TYPE_NAME)]);

  const parse = useMemo(() => {
    try {
      const matcher = nameMatcher(sequence);
      return (value: string): ChipParse => {
        const parsed = matcher.parse(value);
        return parsed.ok ? parsed : { ok: false, at: parsed.at, token: parsed.part };
      };
    } catch {
      return null;
    }
  }, [sequence]);

  const values = typeNames ?? [];
  const matching = parse ? values.filter((v) => parse(v.v).ok).length : 0;
  const tag = sameScheme(sequence, POFIN_TYPE_NAME)
    ? t("setup.standard", lang)
    : saved && sameScheme(sequence, saved)
      ? t("label.ruleset", lang)
      : null;

  const face = (part: NamePart): ChipFace => ({
    kind: kindOf(part),
    big: "text" in part ? part.text : undefined,
    part: !("text" in part),
    dashed: "text" in part,
    bound: false,
    sub: "text" in part ? undefined : <span className="text-[11px] whitespace-nowrap text-muted">{kindLabel(kindOf(part), lang)}</span>,
  });

  const ready = parse !== null && sequence.length > 0 && sequence.every((p) => !("values" in p) || p.values.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div data-typed className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">{t("req.typeobjekt", lang)}</span>
        {typed}
      </div>
      <div data-proposal={typeNames && values.length > 0 && matching === 0 ? "missing" : "found"} className={"flex flex-col gap-4 border-2 bg-panel p-5 " + (typeNames && values.length > 0 && matching === 0 ? "border-bad" : "border-green")}>
        {tag ? <span className="font-mono text-[12px] text-muted">{tag}</span> : null}
        {typeNames ? (
          <Figure
            label={t("field.target.type", lang)}
            value={`${formatCount(matching, lang)} / ${formatCount(values.length, lang)}`}
            bad={values.length > 0 && matching === 0}
          />
        ) : null}
        <ChipRow
          sequence={sequence}
          values={values}
          parse={parse}
          exampleOf={partExample}
          face={face}
          name={partName}
          editor={(part, change, remove) => <PartEditor part={part} lang={lang} onChange={change} onRemove={remove} />}
          palette={(pick) => <Kinds current={null} lang={lang} onPick={(kind) => pick(blankPart(kind))} />}
          typed={(part) =>
            "text" in part ? { empty: part.text === "" } : "values" in part ? { empty: part.values.length === 0 } : "regex" in part ? { empty: part.regex === "" } : null
          }
          standard={POFIN_TYPE_NAME}
          same={sameScheme}
          lang={lang}
          onSequence={setSequence}
        />
        <button
          type="button"
          autoFocus
          data-step-confirm
          disabled={!ready}
          onClick={() => onConfirm(sequence)}
          className={CONFIRM + " disabled:cursor-not-allowed disabled:opacity-40 sm:self-end"}
        >
          {t("action.apply", lang)} →
        </button>
      </div>
    </div>
  );
}
