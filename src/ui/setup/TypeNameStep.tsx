/** The type name step (2026-10-05). edkjo: "Type name can follow that
 *  suggestion or something else. The important thing is that everything is
 *  typed, and it should be possible to set a naming scheme by regex or by
 *  accepted value lists" · "where we build in NS3457-8 and NS3451 as options
 *  to select. Can also be a hybrid: List item one part, regex another part".
 *
 * The step decides ONE thing: the naming scheme. It does not draw the mapping
 * layout (rendered live 2026-10-05: with no source to choose, its OPTIONS
 * zone was a lone "–" and its FROM box mixed two unrelated counts). So:
 *
 *   lead     the step's name, the standard's example, the source it reads
 *            (the type's Name attribute, fixed)
 *   answer   the scheme as a row of chips that reads as a sample name (DUZ .
 *            001), edited in place (`ChipRow.tsx`); under it, the type Names
 *            off it, each with the piece it lacks set in where it leaves it
 *   result   beside it: «Typer» n / N, the loaded models' distinct type
 *            Names on the scheme; then, apart, the context: the board's
 *            Typeobjekt row (the `element-typed` fundamental) as the IDS tab
 *            reads it; then «Bruk», filled only when the scheme matches
 *
 * The parts a coordinator builds with, in this order (edkjo: "Most people
 * dont know regex … predefined regexes: 2 digit, 3 digit, etc. This should
 * read as a builder"): a code list (NS 3457-8, NS 3451), digits with a
 * count, letters with a count, text, accepted values, and a pattern last.
 * Digits and letters are stored as their pattern (`digitsPart`,
 * `lettersPart`), so the ruleset format is unchanged and a saved `\d{3}`
 * shows as three digits.
 */

import { useMemo, useState } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_FILL } from "../state-visuals";
import type { PsetValue } from "../pset-choices";
import type { NamePart } from "../../ids/types.ts";
import { CODE_LISTS } from "../../codelists/index.ts";
import {
  POFIN_TYPE_NAME,
  POFIN_TYPE_NAME_EXAMPLE,
  digitsPart,
  lettersPart,
  nameMatcher,
  partExample,
  partShape,
  sameScheme,
  type PartKind,
} from "../../engine/type-name.ts";
import { ChipRow, PILL, type ChipFace, type ChipParse } from "./ChipRow";
import { ReqResult, StepConfirm } from "./Walk";
import type { Requirement } from "../requirements";
import { FromSource, LABEL, MappingLayout, Mapped, ToZone } from "./Mapping";
import { INPUT, ValuesInput } from "./ValuesInput";

/** The order the parts are offered in: lists, digits, letters, text,
 *  accepted values, a pattern last. */
const KINDS: readonly PartKind[] = ["ns3457-8", "ns3451", "digits", "letters", "text", "values", "regex"];

/** The counts offered for digits and letters; null is one or more. */
const COUNTS: readonly (number | null)[] = [null, 1, 2, 3, 4, 5, 6];

function blankPart(kind: PartKind): NamePart {
  if (kind === "ns3457-8" || kind === "ns3451") return { list: kind };
  if (kind === "values") return { values: [] };
  if (kind === "digits") return digitsPart(3);
  if (kind === "letters") return lettersPart(2);
  if (kind === "regex") return { regex: "\\d+" };
  return { text: "" };
}

/** A kind as its pill names it: the list's own label, else the field and
 *  part names the app already has («Siffer», «Tekst», «Godtatte», «Mønster»)
 *  and «Bokstaver». */
function kindLabel(kind: PartKind, lang: Lang): string {
  if (kind === "ns3457-8" || kind === "ns3451") return CODE_LISTS[kind].meta.label;
  if (kind === "digits") return t("tfm.digits", lang);
  if (kind === "letters") return t("tfm.letters", lang);
  if (kind === "values") return t("field.accepted", lang);
  if (kind === "regex") return t("field.pattern", lang);
  return t("tfm.text", lang);
}

/** A part as its chip's second line and the summary name it. */
export function partLabel(part: NamePart, lang: Lang): string {
  const shape = partShape(part);
  const label = kindLabel(shape.kind, lang);
  if (shape.kind === "digits" || shape.kind === "letters") return shape.count == null ? label : `${label} · ${shape.count}`;
  if (shape.kind === "values" && "values" in part) return part.values.join(" | ") || label;
  if (shape.kind === "regex" && "regex" in part) return `/${part.regex}/`;
  if (shape.kind === "text" && "text" in part) return `"${part.text}"`;
  return label;
}

/** A kind's example, on its pill: what the part looks like in a name. */
function kindExample(kind: PartKind): string | null {
  if (kind === "text" || kind === "values" || kind === "regex") return null;
  return partExample(blankPart(kind));
}

function Kinds({ current, lang, onPick }: { current: PartKind | null; lang: Lang; onPick: (kind: PartKind) => void }) {
  return (
    <div data-kinds className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {KINDS.map((kind) => {
        const example = kindExample(kind);
        return (
          <button
            key={kind}
            type="button"
            data-kind={kind}
            aria-pressed={kind === current}
            onClick={() => onPick(kind)}
            className={
              "group flex min-h-14 flex-col items-start justify-center gap-0.5 border px-3 py-1.5 text-left " +
              "border-line bg-input text-ink hover:border-green aria-pressed:border-green aria-pressed:bg-green aria-pressed:text-cream"
            }
          >
            {example !== null ? <span className="font-mono text-[17px] leading-none">{example}</span> : null}
            <span className={"text-[12px] leading-tight " + (example !== null ? "text-muted group-aria-pressed:text-cream/80" : "")}>
              {kindLabel(kind, lang)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** How many digits or letters: one or more, or exactly 1 … 6. A saved
 *  count above 6 stays and shows pressed. */
function Count({
  count,
  make,
  onChange,
}: {
  count: number | null;
  make: (count: number | null) => NamePart;
  onChange: (next: NamePart) => void;
}) {
  const counts = count !== null && !COUNTS.includes(count) ? [...COUNTS, count] : COUNTS;
  return (
    <div data-count className="flex flex-wrap gap-1.5">
      {counts.map((n) => (
        <button
          key={n ?? "any"}
          type="button"
          aria-pressed={n === count}
          title={partExample(make(n))}
          onClick={() => onChange(make(n))}
          className={PILL + " min-w-11"}
        >
          {n === null ? "1+" : n}
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
  const shape = partShape(part);
  return (
    <>
      <Kinds current={shape.kind} lang={lang} onPick={(k) => k !== shape.kind && onChange(blankPart(k))} />
      {shape.kind === "digits" ? <Count count={shape.count ?? null} make={digitsPart} onChange={onChange} /> : null}
      {shape.kind === "letters" ? <Count count={shape.count ?? null} make={lettersPart} onChange={onChange} /> : null}
      {"values" in part ? (
        <ValuesInput
          values={part.values}
          invalid={part.values.length === 0}
          multiline
          label={kindLabel("values", lang)}
          onChange={(values) => onChange({ values })}
        />
      ) : null}
      {shape.kind === "regex" && "regex" in part ? (
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

/** Where the type name is read: the Name attribute of the element's type
 *  object, per IFC type class found (IfcWallType.Name), the elements whose
 *  type carries one of the elements the rule selects. */
export interface TypeNameSource {
  classes: readonly { name: string; n: number }[];
  /** Selected elements whose type object carries a Name. */
  named: number;
  /** The elements the rule selects (`walk-selection.ts`). */
  total: number | null;
}

/** In the one mapping layout, as its siblings (2026-10-05, edkjo, live:
 *  "Doesnt say where they're looking for type name"): TO Typenavn with the
 *  standard's example; FROM the type object's Name, by the IFC type classes
 *  found, with real names; no OPTIONS, because the `type-name` check reads
 *  the type's Name and nothing else (`TypeNameCheck` has no source); the
 *  requirement is the scheme, with «Typer» n / N heading the names off it. */
export function TypeNameStep({
  name,
  saved,
  typeNames,
  source,
  written = null,
  lang,
  onConfirm,
}: {
  /** The type-name rule's report row per model, when the ruleset has one. */
  written?: readonly { model: string; req: Requirement | null }[] | null;
  /** The step's name. */
  name: string;
  /** The ruleset's scheme, or null. */
  saved: readonly NamePart[] | null;
  /** The loaded models' type Names, with the elements using each; null with
   *  no model read. */
  typeNames: readonly PsetValue[] | null;
  /** Where the name is read; null with no model read. */
  source: TypeNameSource | null;
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

  const face = (part: NamePart): ChipFace => {
    const shape = partShape(part);
    return {
      kind: shape.kind,
      big: "text" in part ? part.text : undefined,
      part: !("text" in part),
      dashed: "text" in part,
      bound: false,
      sub: "text" in part ? undefined : <span className="text-[11px] whitespace-nowrap text-muted">{partLabel(part, lang)}</span>,
    };
  };

  const ready = parse !== null && sequence.length > 0 && sequence.every((p) => !("values" in p) || p.values.length > 0);
  // The scheme works on the loaded models, or there are none to say so.
  const lead = typeNames === null || values.length === 0 || matching > 0;
  const shownClasses = source ? source.classes.slice(0, 4) : [];
  const moreClasses = source ? source.classes.length - shownClasses.length : 0;

  return (
    <>
      <MappingLayout
        lang={lang}
        to={<ToZone name={name} form={POFIN_TYPE_NAME_EXAMPLE} />}
        fromState={source && source.named === 0 ? "missing" : "found"}
        from={
          <FromSource
            head={t("field.source.attribute", lang)}
            title={
              shownClasses.length > 0 ? (
                <>
                  {shownClasses.map((c) => (
                    <span key={c.name}>{c.name}.Name</span>
                  ))}
                  {moreClasses > 0 ? <span className="text-muted">+{formatCount(moreClasses, lang)}</span> : null}
                </>
              ) : (
                "Name"
              )
            }
            samples={values.map((v) => v.v)}
            mapped={source ? <Mapped n={source.named} total={source.total} lang={lang} /> : null}
          />
        }
        requirement={
          <div data-scheme={lead ? "found" : "missing"} className="flex flex-col gap-4">
            {tag ? <span className={LABEL}>{tag}</span> : null}
            <ChipRow
              sequence={sequence}
              values={values}
              parse={parse}
              exampleOf={partExample}
              face={face}
              name={(part) => partLabel(part, lang)}
              editor={(part, change, remove) => <PartEditor part={part} lang={lang} onChange={change} onRemove={remove} />}
              palette={(pick) => <Kinds current={null} lang={lang} onPick={(kind) => pick(blankPart(kind))} />}
              typed={(part) =>
                "text" in part ? { empty: part.text === "" } : "values" in part ? { empty: part.values.length === 0 } : "regex" in part ? { empty: part.regex === "" } : null
              }
              standard={POFIN_TYPE_NAME}
              same={sameScheme}
              lang={lang}
              onSequence={setSequence}
              // The rows are type Names off the scheme, headed by the count of
              // Names on it; each row's number is the elements of that type.
              offHead={
                typeNames ? (
                  <span data-valid className="flex items-baseline gap-2">
                    <span className={LABEL}>{t("field.target.type", lang)}</span>
                    <span
                      className={
                        "px-1 font-mono text-[20px] leading-tight tabular-nums " +
                        (values.length > 0 && matching === 0 ? VERDICT_FILL.fail : "text-ink")
                      }
                    >
                      {formatCount(matching, lang)} / {formatCount(values.length, lang)}
                    </span>
                  </span>
                ) : undefined
              }
              countLabel={t("walk.selected", lang)}
            />
            {/* The scheme as the ruleset holds it: its report row, the figures
                the landed strip and the summary print. */}
            {written && saved && sameScheme(sequence, saved) ? (
              <span data-result className="flex flex-wrap items-center gap-3">
                <ReqResult results={written} lang={lang} />
              </span>
            ) : null}
          </div>
        }
      />
      <StepConfirm lead={lead} disabled={!ready} label={t("action.apply", lang)} onClick={() => onConfirm(sequence)} />
    </>
  );
}
