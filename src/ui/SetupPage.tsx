/** The project mappings: where this project's IFC carries the concepts every
 *  project has and each stores differently.
 *
 * A mapping is not a construct of its own. Each card edits the one code-lookup
 * rule carrying that `mapping` role in the ruleset, so what is set here is
 * exactly what the ruleset JSON holds and what the evaluator runs. Turning a
 * card off sets the rule's `enabled` to false and keeps what was entered.
 *
 * The on/off is a switch (2026-09-21). edkjo found the old bordered "Aktiv"
 * button non-obvious and asked that double-clicking a card that is off asks
 * whether to enable it; a card that is on ignores double-click, and a
 * double-click inside a live field is the field's own.
 *
 * One section at a time (2026-10-01). edkjo: "the config is a bit hard, so we
 * should have an onboarding, pull me through there". With no ruleset the page
 * opens on a choice: a filled-in config file (or the template to fill), or
 * «Veiled meg». The walk opens an IFC first, so a property source is picked
 * from the sets and properties the model carries, with «Egenskapen er ikke
 * med» for one it lacks. A rail names every step and jumps freely. «Lagre
 * oppsett» keeps the ruleset in the browser (`storage/saved-ruleset.ts`) and
 * returns to the board; "Last ned" stays the file export.
 *
 * Nothing is gated (2026-10-01). edkjo: "Having to activate the field to
 * interact with it isnt working here." Every field is live on every step, and
 * an edit turns its rule on; the switch remains the way to turn one off. A new
 * mapping's source is a property, so the picker is what a step opens on.
 *
 * Click and template, both (2026-10-01). edkjo: "we should have an mmi code
 * builder" and "for MMI and floors, we should have local templates you can
 * download and fill out", then "both though". MMI: «+» on a value adds the
 * code the Uttrekk takes out of it, «Legg til alle» every one the list lacks.
 * Etasjeoppsett: the models' own storeys, «+» and «Legg til alle» the same.
 * Each of the two steps downloads and uploads its own sheet
 * (`step-templates.ts`, `xlsx.ts`). Lint shows at the field, as a label.
 *
 * MMI presets (2026-10-01). A new MMI rule has no codes and Uttrekk
 * `^(0|\d{3})$`, the format alone (edkjo: "our default is 0 or nnn"). The
 * three presets (`codelists/mmi-presets.ts`) are a choice above the table;
 * replacing a list that holds other codes asks first.
 *
 * Type leads (2026-10-01). edkjo: "System, Function, Copy, MMI, Phase,
 * Materials, QTO: these are my main things … the onboarding needs to take
 * you through them." The steps follow that order. Fase and Materiale /
 * Produkt edit the `projectLayer` cascades (`layer-steps.ts`): the
 * standard's sources first, then the project's, picked as a mapping's
 * source is. Mengdetype is no step (2026-10-05, edkjo: "not something to
 * check, but something to assess"): a saved `material-product.mengdetype`
 * list still loads, evaluates and is written back; the walk does not offer
 * it. Gjelder defaults to Typer where the evaluator reads a type,
 * which is an attribute source (the type's Name); a property is read per
 * occurrence.
 *
 * Pull me through (2026-10-05). edkjo: "Too many clicks and options/traces
 * from the original basic config page." A step is now one question with its
 * answer pre-picked (`setup/Walk.tsx`): the saved source, else the loaded
 * models' best candidate (`setup/candidates.ts`), the standard on a layer
 * step, the models' storeys on Etasjeoppsett. «Bruk» takes it and moves on,
 * its result lands on the next step and the bar fills; the summary at the
 * end saves and opens the IDS tab. The cards below are unchanged and sit
 * behind each step's «Avansert» door; the file actions behind «Last ned».
 *
 * POFIN or Egendefinert (2026-10-05). edkjo: "We could also add "POFIN" as a
 * template … POFIN vs egendefinert … even if you pick POFIN, you should be
 * prompted: Gjennomgå/Aksepter oppsett" · "because you might want to seed
 * POFIN, but edit one or two things". The choice leads with the two;
 * «Egendefinert» is the walk as it was («Veiled meg»). «POFIN» lays
 * `withPofin` (`engine/pofin-ruleset.ts`) on the working copy, nothing saved,
 * and opens the `pofin` prompt: what was assigned, with each model's result,
 * then «Gjennomgå» (the walk, every step pinned to its POFIN answer) or
 * «Aksepter oppsett» (the summary). A row of the prompt, or of the summary
 * after POFIN, opens its step, and the step's answer returns to the row's
 * screen (`detour`), not onward.
 *
 * One mapping layout (2026-10-05, `setup/Mapping.tsx`). edkjo: "What we're
 * mapping to + what we're currently mapping from + options for mapping" ·
 * "Mapping is the infrastructure, not the validity check." Every mapping
 * step, the layer steps' cascades, TFM and its Lokasjon binding, and
 * Typenavn draw TO ← FROM │ OPTIONS and, apart, the value requirement, which
 * left «Avansert» for the step (`MappingRequirement`, the TFM builder, the
 * type name scheme). A pick changes FROM; «Bruk» confirms and moves on.
 */

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { CODE_LISTS, CODE_LIST_IDS } from "../codelists/index.ts";
import { hasErrors, lintRuleset } from "../ids/lint.ts";
import { anyRoleRule, defaultCodeList, defaultExtract, everyOwnerName, roleRule } from "../ids/models.ts";
import { NOT_A_MATERIAL, NOT_A_MATERIAL_EXAMPLES, STANDARD_SOURCES, phaseAccepted, type LayerSlot } from "../engine/standard-sources.ts";
import { POFIN_SOURCES, ROLE_STANDARD } from "../engine/pofin-standard.ts";
import { POFIN_ROLES, withPofin } from "../engine/pofin-ruleset.ts";
import { layerJudge, layerPath, layerSources, previewLayer, withLayerSources } from "./layer-steps";
import { MMI_PRESETS, matchingPreset, presetCodes, type MmiPresetId } from "../codelists/mmi-presets.ts";
import type {
  CodeEntry,
  CodeLookupCheck,
  CodeSource,
  CopyObjectCheck,
  ExtendedRule,
  LintIssue,
  MappingRole,
  PhaseSource,
  Ruleset,
  StoreyLevel,
  StoreyPlane,
  StoreySetup,
  TfmCheck,
  TfmPart,
  TfmToken,
  NamePart,
  TypeNameCheck,
} from "../ids/types.ts";
import { STATSBYGG_SEQUENCE, exampleText, formatSequence, tfmRegexSource } from "../engine/tfm.ts";
import type { Lang, StringKey } from "./i18n";
import { hasString, locale, t } from "./i18n";
import { Switch } from "./Switch";
import { CONFIG_TEMPLATE_FILE } from "../ids/config-template.ts";
import { formatCount } from "./format";
import { mergeChoices, type PsetChoice, type PsetProp, type PsetValue } from "./pset-choices";
import { previewExtract, type ExtractPreview } from "./extract-preview";
import { extractFromExample } from "../ids/extract-example.ts";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";
import type { Verdict } from "../engine/types";
import type { ModelEntry } from "./useModels";
import { requirements } from "./requirements";
import { StateChip } from "./setup/chips";
import { INPUT, ValuesInput } from "./setup/ValuesInput";
import { LIST_EXAMPLES, previewTfm, rankPartBindings, rankTfmCandidates, segmentState, type Candidate } from "./setup/candidates";
import { TfmBuilder, TfmResult, type ChipBinding } from "./setup/TfmBuilder";
import { TypeNameStep, partLabel, type TypeNameSource } from "./setup/TypeNameStep";
import { isWalkSelected } from "../engine/walk-selection.ts";
import { partShape } from "../engine/type-name.ts";
import { stateLook } from "./alt/req-view";
import {
  CONFIRM,
  CONFIRM_QUIET,
  ConfirmSlotProvider,
  Door,
  IfcDrop,
  Landed,
  ReqResult,
  STAGE_WIDTH,
  StepConfirm,
  StepNav,
  SummaryRow,
  WalkProgress,
  type CurrentSource,
} from "./setup/Walk";
import { MappingStep } from "./setup/MappingCards";
import { FromSource, MappingLayout, Mapped, OptionCount, OptionList, PANEL, STEP_TITLE, ToZone, Valid, type MapOption } from "./setup/Mapping";
import { PILL } from "./setup/ChipRow";
import type { Requirement } from "./requirements";
import {
  extractedCodes,
  hasLevel,
  levelsTemplate,
  modelLevels,
  templateFileName,
  withCodes,
  withLevels,
} from "./step-templates";

const SOURCE_KINDS = ["attribute", "property", "classification"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];

type MappingCheck = CodeLookupCheck | CopyObjectCheck;

/** The roles a mapping card edits: every mapping but `tfm`, which is its
 *  own step (`setup/TfmBuilder.tsx`). */
type CardRole = Exclude<MappingRole, "tfm" | "type-name">;

function sourceKind(source: CodeSource): SourceKind {
  if ("property" in source) return "property";
  if ("classification" in source) return "classification";
  return "attribute";
}

/** The rule builder's own blank values (builder/RuleEditor.tsx), so a mapping
 *  starts where a hand-added code-lookup starts. */
function blankSource(kind: SourceKind): CodeSource {
  switch (kind) {
    case "attribute":
      return { attribute: "Name" };
    case "property":
      return { property: { propertySet: "", name: "" } };
    case "classification":
      return { classification: {} };
  }
}

function blankCheck(role: CardRole): MappingCheck {
  // A property by default: the walk's picker lists the loaded model's sets.
  const base = { type: "code-lookup", source: blankSource("property") } as const;
  switch (role) {
    case "system-classification":
    case "component-classification":
      return { ...base, list: defaultCodeList(role), target: "occurrence", extract: defaultExtract(role) };
    case "progress-code":
      // No codes: the format alone (`defaultExtract`). A preset is a choice.
      return { ...base, codes: [], extract: defaultExtract(role) };
    case "copy-object":
      return { type: "copy-object", source: blankSource("property"), copy: [], own: [] };
  }
}

/** An MMI preset's name: a proper name, the same in nb and en. */
function presetName(id: MmiPresetId): string {
  return MMI_PRESETS.find((p) => p.id === id)?.name ?? id;
}

function freshId(ruleset: Ruleset, stem: string): string {
  const taken = new Set(ruleset.rules.map((r) => r.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function mappingRule(ruleset: Ruleset, role: MappingRole): ExtendedRule | null {
  return anyRoleRule(ruleset, role);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The .xlsx beside the JSON: `EKS.ruleset.json` -> `EKS.xlsx`. */
function xlsxName(fileName: string): string {
  return `${fileName.replace(/(\.ruleset)?\.json$/i, "")}.xlsx`;
}

/** The .ids beside the JSON: `EKS.ruleset.json` -> `EKS.ids`. */
function idsName(fileName: string): string {
  return `${fileName.replace(/(\.ruleset)?\.json$/i, "")}.ids`;
}

/** The enabled ids rules as one IDS 1.0 file (export.ts). Null when there
 *  are none: an .ids with no specification is invalid. */
async function downloadIds(ruleset: Ruleset, fileName: string): Promise<void> {
  const { exportRuleset } = await import("../ids/export.ts");
  const ids = exportRuleset(ruleset).ids;
  if (ids === null) throw new Error("no enabled IDS specification: no .ids to write");
  downloadBlob(new Blob([ids], { type: "application/xml" }), fileName);
}

function downloadRuleset(ruleset: Ruleset, fileName: string): void {
  downloadBlob(new Blob([JSON.stringify(ruleset, null, 2) + "\n"], { type: "application/json" }), fileName);
}

/** The workbook is written by a lazily loaded module, which reads its own
 *  output back and throws on any difference; the throw is shown, not eaten. */
async function downloadXlsx(ruleset: Ruleset, fileName: string): Promise<void> {
  const { writeRulesetXlsx } = await import("../ids/xlsx.ts");
  const bytes = writeRulesetXlsx(ruleset);
  downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** A lint issue as the UI says it: its `lint.<code>` label, or the issue's
 *  own message for a code with no label. Never the ruleset path. */
function issueText(issue: LintIssue, lang: Lang): string {
  const key = `lint.${issue.code}`;
  return hasString(key) ? t(key, lang) : issue.message;
}

/** The issues of one field, under it. `subject` names the row an issue is
 *  on (a code, a storey), when it is on one. */
function IssueLines({
  issues,
  lang,
  subject,
}: {
  issues: LintIssue[];
  lang: Lang;
  subject?: (issue: LintIssue) => string | null;
}) {
  if (issues.length === 0) return null;
  const lines = [
    ...new Set(
      issues.map((issue) => {
        const who = subject?.(issue) ?? null;
        const text = issueText(issue, lang);
        return who === null ? text : `${who}: ${text}`;
      }),
    ),
  ];
  return (
    <div data-issues className="flex flex-col bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug text-cream">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

/** A step's own template: «Last ned mal» writes the step's sheet with its
 *  defaults, «Last opp» reads one back into the step. A refused file names
 *  every problem at its Sheet!Cell and changes nothing. */
function TemplateButtons({
  fileName,
  lang,
  onDownload,
  onUpload,
}: {
  fileName: string;
  lang: Lang;
  onDownload: () => Promise<Uint8Array>;
  onUpload: (bytes: Uint8Array) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fail = (err: unknown) => {
    const problems = (err as { problems?: unknown }).problems;
    setError(Array.isArray(problems) ? problems.join("\n") : err instanceof Error ? err.message : String(err));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-template-download
          onClick={() => {
            setError(null);
            onDownload()
              .then((bytes) => downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), fileName))
              .catch(fail);
          }}
          className={SECONDARY}
        >
          <span>{t("action.downloadTemplate", lang)}</span>
          <span className="font-mono text-[11px]">{fileName}</span>
        </button>
        <button type="button" data-template-upload onClick={() => input.current?.click()} className={SECONDARY}>
          {t("action.upload", lang)}
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError(null);
            file
              .arrayBuffer()
              .then((buffer) => onUpload(new Uint8Array(buffer)))
              .catch(fail);
          }}
        />
      </div>
      {error !== null ? (
        <pre data-template-error className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {error}
        </pre>
      ) : null}
    </div>
  );
}

const LABEL = "text-[12px] font-semibold tracking-[0.1em] text-gold uppercase";
const SECONDARY =
  "flex items-center gap-2 border border-line bg-cream px-3 py-1.5 text-[12px] text-ink hover:border-green hover:text-green";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Seg<T extends string>({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly T[];
  /** null: none of the options is the current value. */
  value: T | null;
  label: (option: T) => string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex w-fit items-center overflow-hidden border border-line">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={
            "px-3 py-1 text-[12px] " +
            (option === value ? "bg-green text-cream" : "bg-input text-muted hover:text-ink")
          }
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/** The project's code list: code, name and, on MMI, the phase. */
function CodesTable({
  codes,
  issues,
  lang,
  onChange,
}: {
  codes: CodeEntry[];
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: CodeEntry[]) => void;
}) {
  const invalid = (i: number, field: string) => issues.some((issue) => issue.path.endsWith(`.check.codes[${i}].${field}`));
  const set = (i: number, patch: Partial<CodeEntry>) =>
    onChange(
      codes.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        if (next.phase === "") delete next.phase;
        return next;
      }),
    );
  return (
    <div className="flex flex-col gap-1">
      {codes.length > 0 ? (
        <div className="grid max-h-40 content-start items-center gap-x-2 gap-y-1 overflow-auto [grid-template-columns:5rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <span className={LABEL}>{t("field.code", lang)}</span>
          <span className={LABEL}>{t("field.name", lang)}</span>
          <span className={LABEL}>{t("field.phase", lang)}</span>
          <span />
          {codes.map((c, i) => (
            <CodeRow key={i} entry={c} lang={lang} invalid={(f) => invalid(i, f)} onChange={(p) => set(i, p)} onRemove={() => onChange(codes.filter((_, j) => j !== i))} />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onChange([...codes, { code: "", name: "" }])}
        className="w-fit border border-line bg-input px-2 py-0.5 text-[12px] text-muted hover:border-green hover:text-green"
      >
        {t("action.addRow", lang)}
      </button>
    </div>
  );
}

function CodeRow({
  entry,
  lang,
  invalid,
  onChange,
  onRemove,
}: {
  entry: CodeEntry;
  lang: Lang;
  invalid: (field: string) => boolean;
  onChange: (patch: Partial<CodeEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input type="text" className={INPUT} aria-invalid={invalid("code")} value={entry.code} onChange={(e) => onChange({ code: e.target.value })} />
      <input type="text" className={INPUT} aria-invalid={invalid("name")} value={entry.name} onChange={(e) => onChange({ name: e.target.value })} />
      <input type="text" className={INPUT} aria-invalid={invalid("phase")} value={entry.phase ?? ""} onChange={(e) => onChange({ phase: e.target.value })} />
      <button type="button" onClick={onRemove} className="px-2 py-0.5 text-[12px] text-muted hover:text-bad">
        {t("action.remove", lang)}
      </button>
    </>
  );
}

/** The property source, picked from the loaded models: every set with its
 *  properties and element counts (`pset-choices.ts`), filtered as you type,
 *  arrows and Enter to pick. «Egenskapen er ikke med» is always the last
 *  option and opens the two fields, so a property the model lacks can be
 *  typed as it should have been. The fields stay open once opened, and are
 *  the only input when no model is loaded.
 *
 * A pick collapses the list into the picked card (2026-10-01, edkjo: "more
 * tactile/intuitive feedback that this has been selected and will be mapped
 * from"): the set, the property, its element count, and «Endre» to reopen
 * the list. A step that opens on a source already set shows the card too, in
 * the bad colour and without a count when the model lacks it. Enter on the
 * card is the step's next. */
function PropertyPicker({
  value,
  choices,
  reading,
  errors,
  invalidSet,
  invalidName,
  lang,
  onChange,
  onNext,
  children,
  total = null,
  manual: manualOption = true,
}: {
  value: { propertySet: string; name: string };
  /** The models' products: a property they lack reads `0 / total`. */
  total?: number | null;
  /** List «Egenskapen er ikke med». The TFM step's first picker leaves it to
   *  «Endre», where the fields can be typed in without the step changing. */
  manual?: boolean;
  /** null: no model on the board, so nothing to pick from. */
  choices: PsetChoice[] | null;
  reading: boolean;
  errors: string[];
  invalidSet: boolean;
  invalidName: boolean;
  lang: Lang;
  onChange: (next: { propertySet: string; name: string }) => void;
  /** Enter on the picked card. */
  onNext: () => void;
  /** Under the card, once the picked property is found in the model. */
  children?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState(false);
  // Bumped on every pick: keys the card, so its arrival transition replays.
  const [picks, setPicks] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const prop = choices?.find((c) => c.set === value.propertySet)?.props.find((p) => p.name === value.name);
  const found = prop !== undefined;
  const blank = value.propertySet === "" && value.name === "";
  // A value the model does not carry can only be shown in the fields.
  const fieldsOpen = manual || (choices === null && !reading) || (!found && !blank && !reading);
  const listable = choices !== null || reading;
  const showCard = listable && !blank && !editing && !manual;

  const q = query.trim().toLowerCase();
  const groups = (choices ?? [])
    .map((c) =>
      q === "" || c.set.toLowerCase().includes(q)
        ? c
        : { ...c, props: c.props.filter((p) => p.name.toLowerCase().includes(q)) },
    )
    .filter((c) => c.props.length > 0);
  type Option = { kind: "prop"; set: string; name: string } | { kind: "manual" };
  const options: Option[] = [
    ...groups.flatMap((c) => c.props.map((p): Option => ({ kind: "prop", set: c.set, name: p.name }))),
    ...(manualOption ? [{ kind: "manual" } as const] : []),
  ];
  // Each group's first index in `options`.
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, c) => n + c.props.length, 0));
  const optionId = (i: number) => `${baseId}-o${i}`;
  const at = Math.min(active, options.length - 1);

  const pick = (option: Option) => {
    if (option.kind === "prop") {
      setManual(false);
      setEditing(false);
      setQuery("");
      setActive(-1);
      setPicks((n) => n + 1);
      onChange({ propertySet: option.set, name: option.name });
      requestAnimationFrame(() => cardRef.current?.focus());
    } else {
      setManual(true);
      requestAnimationFrame(() => setRef.current?.focus());
    }
  };

  const change = () => {
    setEditing(true);
    setQuery("");
    setActive(-1);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  // The keyboard's option, or on first show the picked one, scrolled into
  // view inside the list, never by scrolling the page.
  const listed = choices !== null && !showCard;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = at >= 0 ? document.getElementById(`${baseId}-o${at}`) : list.querySelector<HTMLElement>("[aria-selected=true]");
    if (!el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [at, baseId, listed]);

  // Picked is the one green fill; the keyboard cursor and hover are a quiet
  // neutral, so a cursor never reads as a pick.
  const row = (selected: boolean, i: number) =>
    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[12px] " +
    (selected ? "bg-green text-cream" : i === at ? "bg-panel text-ink" : "text-ink hover:bg-panel");

  const cardState = found ? "found" : reading ? "reading" : "missing";
  const cardFill =
    cardState === "found" ? "bg-green text-cream" : cardState === "missing" ? "bg-bad text-cream" : "border border-line bg-input text-ink";

  return (
    <div className="flex flex-col gap-3">
      {showCard ? (
        <div
          key={picks}
          ref={cardRef}
          tabIndex={0}
          data-picked={cardState}
          aria-label={`${value.propertySet} ${value.name}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) {
              e.preventDefault();
              onNext();
            }
          }}
          className={
            "flex items-center gap-4 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-panel " +
            cardFill +
            (picks > 0 ? " pick-in" : "")
          }
        >
          {cardState === "found" ? (
            <span aria-hidden="true" className="shrink-0 text-xl leading-none">
              ✓
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-mono text-[11px] opacity-70">{value.propertySet}</span>
            <span className="truncate text-lg leading-tight font-medium">{value.name}</span>
          </div>
          {prop ? (
            <span className="shrink-0 font-mono text-[13px] tabular-nums">{formatCount(prop.n, lang)}</span>
          ) : reading ? (
            <span className="shrink-0 text-[11px] text-muted">{t("file.parsing", lang)}</span>
          ) : (
            // Why it is red: no element of the models carries it.
            <span data-missing-count className="shrink-0 font-mono text-[13px] tabular-nums">
              {total === null ? formatCount(0, lang) : `${formatCount(0, lang)} / ${formatCount(total, lang)}`}
            </span>
          )}
          <button
            type="button"
            onClick={change}
            className={
              "shrink-0 border px-3 py-1 text-[12px] " +
              (cardState === "reading"
                ? "border-line text-ink hover:border-green hover:text-green"
                : "border-cream/50 text-cream hover:bg-cream hover:text-ink")
            }
          >
            {t("action.change", lang)}
          </button>
        </div>
      ) : listable ? (
        <div className="flex flex-col border border-line bg-input">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-muted">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-label={t("field.source.property", lang)}
              aria-expanded="true"
              aria-controls={`${baseId}-list`}
              aria-activedescendant={at >= 0 ? optionId(at) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(Math.min(at + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(Math.max(at - 1, 0));
                } else if (e.key === "Enter" && at >= 0) {
                  e.preventDefault();
                  pick(options[at]);
                } else if (e.key === "Escape" && query !== "") {
                  e.preventDefault();
                  setQuery("");
                  setActive(-1);
                }
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
            />
            {reading ? <span className="shrink-0 text-[11px] text-muted">{t("file.parsing", lang)}</span> : null}
          </div>
          <div ref={listRef} id={`${baseId}-list`} role="listbox" className="relative max-h-72 overflow-auto py-1">
            {groups.map((c, g) => (
              <div key={c.set} role="group" aria-label={c.set}>
                <div className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-1">
                  <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-muted">{c.set}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                    {formatCount(c.objects, lang)}
                  </span>
                </div>
                {c.props.map((p, k) => {
                  const i = starts[g] + k;
                  const selected = value.propertySet === c.set && value.name === p.name;
                  return (
                    <div
                      key={p.name}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      // Keeps focus in the search field.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick({ kind: "prop", set: c.set, name: p.name })}
                      className={row(selected, i) + " pl-6"}
                    >
                      <span className="min-w-0 truncate font-mono">{p.name}</span>
                      <span className="shrink-0 font-mono tabular-nums">{formatCount(p.n, lang)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {manualOption ? (
              <div
                id={optionId(options.length - 1)}
                role="option"
                aria-selected={fieldsOpen && !found}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick({ kind: "manual" })}
                className={row(fieldsOpen && !found, options.length - 1) + (groups.length > 0 ? " mt-1 border-t border-line" : "")}
              >
                <span>{t("field.notInModel", lang)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {showCard && found ? children : null}
      {errors.length > 0 ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {errors.join("\n")}
        </pre>
      ) : null}
      {fieldsOpen ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("field.propertySet", lang)}>
            <input
              ref={setRef}
              type="text"
              className={INPUT}
              aria-invalid={invalidSet}
              value={value.propertySet}
              onChange={(e) => onChange({ ...value, propertySet: e.target.value })}
            />
          </Field>
          <Field label={t("field.propertyName", lang)}>
            <input
              type="text"
              className={INPUT}
              aria-invalid={invalidName}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** The picked property's distinct values, most frequent first, and on a
 *  code-lookup what the current `extract` makes of each (`extract-preview.ts`).
 *  A capped list says so in its count, «N / M». A click on a value is the
 *  example's pick. On a project-layer source, `judge` is the live check
 *  (`layer-steps.ts`), with no code column: the value is read whole. */
function ValuesPanel({
  prop,
  check,
  role,
  judge,
  lang,
  onPick,
  onAdd,
}: {
  prop: PsetProp;
  check?: MappingCheck;
  role?: CardRole;
  judge?: (value: string) => boolean;
  lang: Lang;
  onPick?: (value: string) => void;
  /** The project's own code list (MMI): «+» on a value adds the code it
   *  extracts, «Legg til alle» every one the list lacks. */
  onAdd?: (codes: string[]) => void;
}) {
  let preview: ExtractPreview | null = null;
  let error: string | null = null;
  if (judge) preview = previewLayer(prop.values, judge);
  else if (check?.type === "code-lookup") {
    try {
      preview = previewExtract(check, prop.values, role === "copy-object" ? null : role);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const listedRows = prop.values.reduce((n, v) => n + v.n, 0);
  const rest = Math.max(0, prop.valued - listedRows);
  const partial = prop.values.length < prop.distinct || !prop.exact;
  const rows = preview?.rows ?? prop.values.map((v) => ({ ...v, code: null, state: null }));
  // The codes a click adds: extracted, and not in the project's list yet.
  const listed = new Set(check?.type === "code-lookup" ? (check.codes ?? []).map((c) => c.code) : []);
  const addable = (code: string | null): code is string => onAdd !== undefined && code !== null && !listed.has(code);
  const missing = [...new Set(rows.map((r) => r.code).filter(addable))];
  const cols = judge
    ? "[grid-template-columns:minmax(0,1fr)_1.25rem_4rem]"
    : preview
      ? "[grid-template-columns:minmax(0,1fr)_minmax(0,8rem)_1.25rem_4rem]"
      : "[grid-template-columns:minmax(0,1fr)_4rem]";
  return (
    <div className="flex flex-col gap-2" data-values-panel>
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>{t("field.values", lang)}</span>
        <span data-values-count className="font-mono text-[11px] tabular-nums text-muted">
          {partial
            ? `${formatCount(prop.values.length, lang)} / ${prop.exact ? "" : "≥"}${formatCount(prop.distinct, lang)}`
            : formatCount(prop.distinct, lang)}
        </span>
        {onAdd && preview ? (
          <button
            type="button"
            data-add-all
            disabled={missing.length === 0}
            onClick={() => onAdd(missing)}
            className="border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-line"
          >
            {t("action.addAll", lang)}
          </button>
        ) : null}
        {preview ? (
          <span data-totals className="ml-auto flex flex-wrap items-center gap-1.5">
            <StateChip state="ok" count={preview.totals.ok} lang={lang} />
            <StateChip state="no-match" count={preview.totals["no-match"]} lang={lang} />
            <StateChip state="not-in-list" count={preview.totals["not-in-list"]} lang={lang} />
            {rest > 0 ? <StateChip state="rest" count={rest} lang={lang} /> : null}
          </span>
        ) : null}
      </div>
      {error !== null ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{error}</pre>
      ) : null}
      {rows.length > 0 ? (
        <div className="flex max-h-56 flex-col overflow-auto border border-line bg-input py-1">
          {rows.map((r) => {
            const cells = (
              <>
                <span className="min-w-0 truncate font-mono">{r.v}</span>
                {preview ? (
                  <>
                    {judge ? null : <span className="min-w-0 truncate font-mono text-muted">{r.code ?? ""}</span>}
                    {r.state ? <StateChip state={r.state} lang={lang} /> : <span />}
                  </>
                ) : null}
                <span className="text-right font-mono tabular-nums text-muted">{formatCount(r.n, lang)}</span>
              </>
            );
            const rowClass = `grid w-full items-center gap-3 px-3 py-1 text-left text-[12px] text-ink ${cols}`;
            const main = onPick ? (
              <button type="button" onClick={() => onPick(r.v)} className={rowClass + " min-w-0 flex-1 hover:bg-panel"}>
                {cells}
              </button>
            ) : (
              <div className={rowClass + " min-w-0 flex-1"}>{cells}</div>
            );
            return (
              <div key={r.v} data-value={r.v} className="flex items-center">
                {main}
                {onAdd ? (
                  addable(r.code) ? (
                    <button
                      type="button"
                      data-add={r.code}
                      aria-label={`${t("action.addRow", lang)} ${r.code}`}
                      onClick={() => onAdd([r.code as string])}
                      className="w-7 shrink-0 py-1 text-center font-mono text-[14px] leading-none text-muted hover:text-green"
                    >
                      +
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" />
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Uttrekk from an example: typed, or picked from the property's real values
 *  (the suggestions under the field, or a click in the values list). The
 *  selected part of the example is the code, no selection the whole value
 *  (`extract-example.ts`). The pattern it would give shows beside «Bruk»;
 *  nothing changes Uttrekk until «Bruk» is pressed. */
function ExampleField({
  example,
  values,
  current,
  lang,
  inputRef,
  onExample,
  onApply,
}: {
  example: string;
  values: PsetValue[];
  current: string;
  lang: Lang;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onExample: (next: string) => void;
  onApply: (pattern: string) => void;
}) {
  const listId = useId();
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  // A new example, typed or picked, starts unmarked: the whole value.
  const [seen, setSeen] = useState(example);
  if (seen !== example) {
    setSeen(example);
    setSel([0, 0]);
  }
  const candidate = example === "" ? null : extractFromExample(example, sel[0], sel[1]);
  const track = (el: HTMLInputElement) => setSel([el.selectionStart ?? 0, el.selectionEnd ?? 0]);
  return (
    <>
      <Field label={t("field.example", lang)}>
        <input
          ref={inputRef}
          type="text"
          list={listId}
          className={INPUT + " w-56"}
          value={example}
          onChange={(e) => onExample(e.target.value)}
          onSelect={(e) => track(e.currentTarget)}
        />
        <datalist id={listId}>
          {values.map((v) => (
            <option key={v.v} value={v.v} />
          ))}
        </datalist>
      </Field>
      {candidate !== null ? (
        <span data-candidate className="self-end py-1 font-mono text-[12px] text-muted">
          {candidate}
        </span>
      ) : null}
      <button
        type="button"
        disabled={candidate === null || candidate === current}
        onClick={() => candidate !== null && onApply(candidate)}
        className={SECONDARY + " self-end disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-line"}
      >
        {t("action.apply", lang)}
      </button>
    </>
  );
}

function MappingCard({
  role,
  rule,
  issues,
  lang,
  rulesetName,
  onToggle,
  onCheck,
  onAskEnable,
  picker,
}: {
  role: CardRole;
  rule: ExtendedRule | null;
  issues: LintIssue[];
  lang: Lang;
  /** Names the step's template file. */
  rulesetName: string;
  /** What the values list reads, from the loaded models. */
  picker: Picker;
  onToggle: () => void;
  onCheck: (next: MappingCheck) => void;
  /** Double-click on the card while it is off. */
  onAskEnable: () => void;
}) {
  const active = rule !== null && rule.enabled !== false;
  const check: MappingCheck =
    rule && (rule.check.type === "code-lookup" || rule.check.type === "copy-object") ? rule.check : blankCheck(role);
  const source = check.source;
  const invalid = (suffix: string) => issues.some((i) => i.path.includes(`.check.${suffix}`));
  // Each issue at the field it concerns; the rest at the card's foot. The
  // source's print at the step's editor, the list's, codes' and values' in
  // the step's requirement zone.
  const fieldOf = (issue: LintIssue) => /\.check\.(source|extract|codes|list|copy|own)(?=[.[]|$)/.exec(issue.path)?.[1] ?? null;
  const at = (field: string | null) => (active ? issues.filter((i) => fieldOf(i) === field) : []);
  const classification = role === "system-classification" || role === "component-classification";
  // The picked property as the model has it: its values feed the values
  // list, the extract preview and the example's suggestions.
  const prop =
    "property" in source
      ? picker.choices
          ?.find((c) => c.set === source.property.propertySet)
          ?.props.find((p) => p.name === source.property.name)
      : undefined;
  // The example defaults to the property's most frequent value, so a pattern
  // always shows; a typed or picked one replaces it until the property changes.
  const propKey = "property" in source ? `${source.property.propertySet}\u0000${source.property.name}` : "";
  const [typed, setTyped] = useState<{ key: string; value: string } | null>(null);
  const example = typed !== null && typed.key === propKey ? typed.value : (prop?.values[0]?.v ?? "");
  const setExample = (value: string) => setTyped({ key: propKey, value });
  const exampleRef = useRef<HTMLInputElement>(null);
  const pickExample = (value: string) => {
    setExample(value);
    requestAnimationFrame(() => {
      const el = exampleRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // Never hijack a double-click meant for a live control.
  const onLive = (event: MouseEvent<HTMLElement>) =>
    (event.target as HTMLElement).closest(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
    ) !== null;
  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (active || onLive(event)) return;
    onAskEnable();
  };

  return (
    <section
      onDoubleClick={onDoubleClick}
      // The second press of a double-click on an OFF card would otherwise
      // select the word under the pointer behind the dialog.
      onMouseDown={(event) => {
        if (!active && event.detail > 1 && !onLive(event)) event.preventDefault();
      }}
      className="flex flex-col gap-4 border border-line bg-panel p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className={"m-0 text-sm font-medium " + (active ? "text-ink" : "text-muted")}>
          {stepLabel(role, lang)}
        </h2>
        <Switch on={active} label={t("field.enabled", lang)} onChange={onToggle} />
      </div>

      {classification && check.type === "code-lookup" ? (
        <div className="flex flex-wrap gap-3">
          {/* Every bundled list: the step itself offers its own only. */}
          <div className="flex flex-col gap-1">
            <span className={LABEL}>{t("field.list", lang)}</span>
            <Seg
              options={CODE_LIST_IDS}
              value={check.list ?? defaultCodeList(role)}
              label={(id) => CODE_LISTS[id].meta.label}
              onChange={(list) => onCheck({ ...check, list, codes: undefined })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>{t("field.target", lang)}</span>
            <Seg
              options={["occurrence", "type"] as const}
              value={check.target ?? "occurrence"}
              label={(o) => t(`field.target.${o}`, lang)}
              onChange={(target) => onCheck({ ...check, target })}
            />
          </div>
        </div>
      ) : null}

      {/* The source itself is the step's own («Velg selv»,
          `MappingCards.tsx`); here, the values it reads. */}
      {prop ? (
        <ValuesPanel
          prop={prop}
          check={check}
          role={role}
          lang={lang}
          onPick={check.type === "code-lookup" ? pickExample : undefined}
          onAdd={
            role === "progress-code" && check.type === "code-lookup"
              ? (codes) => onCheck({ ...check, codes: withCodes(check.codes ?? [], codes) })
              : undefined
          }
        />
      ) : null}

      {check.type === "code-lookup" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("field.extract", lang)}>
              <input
                type="text"
                className={INPUT + " w-56"}
                aria-invalid={invalid("extract")}
                value={check.extract}
                onChange={(e) => onCheck({ ...check, extract: e.target.value })}
              />
            </Field>
            <ExampleField
              example={example}
              values={prop?.values ?? []}
              current={check.extract}
              lang={lang}
              inputRef={exampleRef}
              onExample={setExample}
              onApply={(extract) => onCheck({ ...check, extract })}
            />
          </div>
          <IssueLines issues={at("extract")} lang={lang} />
          {/* The codes themselves are the step's requirement zone
              (`MappingRequirement`); their sheet, a file action, stays. */}
          {role === "progress-code" ? (
            <TemplateButtons
              fileName={templateFileName(rulesetName, "mmi")}
              lang={lang}
              onDownload={async () => {
                const { writeCodesXlsx } = await import("../ids/xlsx.ts");
                const extracted = prop ? extractedCodes(check.extract, prop.values) : [];
                return writeCodesXlsx(withCodes(check.codes ?? [], extracted));
              }}
              onUpload={async (bytes) => {
                const { readCodesXlsx } = await import("../ids/xlsx.ts");
                onCheck({ ...check, codes: readCodesXlsx(bytes) });
              }}
            />
          ) : null}
        </div>
      ) : null}

      <IssueLines issues={at(null)} lang={lang} />
    </section>
  );
}

/** A mapping step's value requirement, on the step (2026-10-05, edkjo:
 *  "if there are any quality requirements to the value itself. Mapping is
 *  the infrastructure, not the validity check"): what the rule can already
 *  say, edited where it is shown. Systemkode, Funksjonskode: the bundled
 *  code list (lint wants one, so there is no «Ingen»). MMI: «Kun format»
 *  (`codes: []`, the Uttrekk's format alone, shown), a preset, or the
 *  project's own codes. Duplikat objekt: the copy and own values, «Ingen»
 *  when both are empty. Its issues print here. */
function MappingRequirement({
  role,
  check,
  issues,
  lang,
  onCheck,
}: {
  role: CardRole;
  check: MappingCheck;
  issues: LintIssue[];
  lang: Lang;
  onCheck: (next: MappingCheck) => void;
}) {
  // The MMI codes waiting on the replace ask, and what they are named by.
  const [replacing, setReplacing] = useState<{ title: string; codes: CodeEntry[] } | null>(null);
  const at = (field: string) => issues.filter((i) => new RegExp(`\\.check\\.${field}(?=[.[]|$)`).test(i.path));
  if (check.type === "copy-object") {
    const none = check.copy.length === 0 && check.own.length === 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            aria-pressed={none}
            onClick={() => onCheck({ ...check, copy: [], own: [] })}
            className={PILL + " self-end"}
          >
            {t("tfm.none", lang)}
          </button>
          <Field label={t("field.copy", lang)}>
            <ValuesInput
              values={check.copy}
              invalid={at("copy").length > 0}
              onChange={(copy) => onCheck({ ...check, copy })}
            />
          </Field>
          <Field label={t("field.own", lang)}>
            <ValuesInput values={check.own} invalid={at("own").length > 0} onChange={(own) => onCheck({ ...check, own })} />
          </Field>
        </div>
        <IssueLines issues={[...at("copy"), ...at("own")]} lang={lang} />
      </div>
    );
  }
  if (role === "progress-code") {
    const codes = check.codes ?? [];
    const preset = matchingPreset(codes);
    // Never replace a list silently: one that holds other codes asks.
    const take = (title: string, next: CodeEntry[]) => {
      if (codes.length === 0 || (next.length > 0 && matchingPreset(next) === preset)) onCheck({ ...check, codes: next });
      else setReplacing({ title, codes: next });
    };
    const codeSubject = (issue: LintIssue) => {
      const m = /\.check\.codes\[(\d+)\]/.exec(issue.path);
      if (!m) return null;
      const i = Number(m[1]);
      return codes[i]?.code || `#${i + 1}`;
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={codes.length === 0} onClick={() => take(t("tfm.shapeOnly", lang), [])} className={PILL}>
            {t("tfm.shapeOnly", lang)}
          </button>
          {MMI_PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => take(presetName(p.id), presetCodes(p.id))} className={PILL}>
              {presetName(p.id)}
            </button>
          ))}
        </div>
        {codes.length === 0 ? (
          // The format in plain parts («0» · «Siffer · 3»); a pattern that
          // does not read so is shown raw, as before. The raw pattern is
          // also behind «Avansert» (Uttrekk).
          <span data-format className="flex flex-wrap items-center gap-1.5">
            {(patternParts(check.extract, lang) ?? [check.extract]).map((part, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden="true" className="font-mono text-[13px] text-muted">|</span> : null}
                <span className="border border-line bg-panel px-2 py-1 font-mono text-[13px] text-ink">{part}</span>
              </span>
            ))}
          </span>
        ) : null}
        <CodesTable codes={codes} issues={issues} lang={lang} onChange={(next) => onCheck({ ...check, codes: next })} />
        <IssueLines issues={at("codes")} lang={lang} subject={codeSubject} />
        {replacing !== null ? (
          <EnableDialog
            title={replacing.title}
            confirm="action.apply"
            lang={lang}
            onCancel={() => setReplacing(null)}
            onConfirm={() => {
              const next = replacing.codes;
              setReplacing(null);
              onCheck({ ...check, codes: next });
            }}
          />
        ) : null}
      </div>
    );
  }
  // The step's own list leads (Systemkode NS 3451, Funksjonskode NS 3457-8),
  // with the one the rule holds if it is another; the other lists are a
  // switch behind «Avansert» (`MappingCard`).
  const own = role === "system-classification" || role === "component-classification" ? defaultCodeList(role) : null;
  const shown = CODE_LIST_IDS.filter((id) => id === own || id === check.list);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={check.list === id}
            onClick={() => onCheck({ ...check, list: id, codes: undefined })}
            className={PILL}
          >
            {CODE_LISTS[id].meta.label}
          </button>
        ))}
      </div>
      <IssueLines issues={at("list")} lang={lang} />
    </div>
  );
}

/** A pattern as the walk shows it on its main surface: an alternation of
 *  plain parts (`^(0|\d{3})$` reads «0» or «Siffer · 3»), each as the type
 *  name builder's chip would name it; null when the pattern is not that
 *  simple (it then stays behind «Avansert»). */
function patternParts(pattern: string, lang: Lang): string[] | null {
  const m = /^\^\((.*)\)\$$/.exec(pattern) ?? /^\^(.*)\$$/.exec(pattern);
  if (!m) return null;
  const parts = m[1].split("|");
  const out: string[] = [];
  for (const raw of parts) {
    if (/^[\p{L}\p{N} ._-]+$/u.test(raw)) {
      out.push(raw);
      continue;
    }
    const shape = partShape({ regex: raw });
    if (shape.kind !== "digits" && shape.kind !== "letters") return null;
    out.push(partLabel({ regex: raw }, lang));
  }
  return out;
}

/** What the pickers list, and the models' products: `total`, null with no
 *  model read. */
type Picker = { choices: PsetChoice[] | null; reading: boolean; errors: string[]; total: number | null };

/** The standard layer's sources for a cascade, read before any project
 *  source (`standard-sources.ts`). A pick keeps the step at the standard:
 *  what «configured» is for a step with no project source. */
function StandardPick({
  names,
  picked,
  lang,
  onPick,
}: {
  names: readonly string[];
  picked: boolean;
  lang: Lang;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-standard
      aria-pressed={picked}
      onClick={onPick}
      className={
        "flex items-center gap-4 px-4 py-3 text-left " +
        (picked ? "bg-green text-cream" : "border border-line bg-panel text-ink hover:border-green")
      }
    >
      {picked ? (
        <span aria-hidden="true" className="shrink-0 text-xl leading-none">
          ✓
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase opacity-70">
          {t("setup.standard", lang)}
        </span>
        {names.map((name) => (
          <span key={name} className="truncate font-mono text-[13px]">
            {name}
          </span>
        ))}
      </div>
    </button>
  );
}

/** One project source of a cascade: its kind, then the property picker with
 *  the values list and the slot's live check, as on the mapping steps.
 *  `source` null is the next source, not in the list yet: a pick adds it. */
function LayerSourceCard({
  source,
  picker,
  issues,
  judge,
  lang,
  onChange,
  onRemove,
  onNext,
}: {
  source: CodeSource | null;
  picker: Picker;
  issues: LintIssue[];
  judge: (value: string) => boolean;
  lang: Lang;
  onChange: (next: CodeSource) => void;
  onRemove?: () => void;
  onNext: () => void;
}) {
  const shown = source ?? blankSource("property");
  const kind = sourceKind(shown);
  const invalid = (suffix: string) => issues.some((i) => i.path.endsWith(suffix));
  const prop =
    "property" in shown
      ? picker.choices?.find((c) => c.set === shown.property.propertySet)?.props.find((p) => p.name === shown.property.name)
      : undefined;
  return (
    <section data-layer-source className="flex flex-col gap-4 border border-line bg-panel p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("field.source", lang)}>
          <select
            className={INPUT}
            value={kind}
            onChange={(e) => {
              const next = e.target.value as SourceKind;
              // A blank property is no source yet: the pick adds it.
              if (source === null && next === "property") return;
              onChange(blankSource(next));
            }}
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`field.source.${k}` as StringKey, lang)}
              </option>
            ))}
          </select>
        </Field>
        {"attribute" in shown ? (
          <Field label={t("field.source.attribute", lang)}>
            <input
              type="text"
              className={INPUT}
              aria-invalid={invalid(".attribute")}
              value={shown.attribute}
              onChange={(e) => onChange({ attribute: e.target.value })}
            />
          </Field>
        ) : null}
        {"classification" in shown ? (
          <Field label={t("field.system", lang)}>
            <input
              type="text"
              className={INPUT}
              value={shown.classification.system ?? ""}
              onChange={(e) =>
                onChange({ classification: e.target.value === "" ? {} : { system: e.target.value } })
              }
            />
          </Field>
        ) : null}
        {onRemove ? (
          <button type="button" onClick={onRemove} className="ml-auto px-2 py-1 text-[12px] text-muted hover:text-bad">
            {t("action.remove", lang)}
          </button>
        ) : null}
      </div>
      {"property" in shown ? (
        <PropertyPicker
          value={shown.property}
          choices={picker.choices}
          reading={picker.reading}
          errors={picker.errors}
          total={picker.total}
          invalidSet={invalid(".property.propertySet")}
          invalidName={invalid(".property.name")}
          lang={lang}
          onChange={(property) => onChange({ property })}
          onNext={onNext}
        >
          {prop ? <ValuesPanel prop={prop} judge={judge} lang={lang} /> : null}
        </PropertyPicker>
      ) : null}
      <IssueLines issues={issues} lang={lang} />
    </section>
  );
}

/** One cascade: the standard's sources, then the project's in the order
 *  they are read, then the next one. A cascade with no project source opens
 *  on the picker; «Legg til» opens it again. On Fase, «Via MMI» adds the
 *  phase the MMI code implies, once the MMI step's codes carry phases. */
function LayerList({
  slot,
  label,
  sources,
  kept,
  picker,
  issues,
  judge,
  viaMmi,
  lang,
  onChange,
  onKeep,
  onNext,
}: {
  slot: LayerSlot;
  /** The list's own heading, where a step has more than one. */
  label?: string;
  sources: PhaseSource[];
  kept: boolean;
  picker: Picker;
  issues: LintIssue[];
  judge: (value: string) => boolean;
  /** Offer «Via MMI»: the MMI step has phases and the list lacks it. */
  viaMmi: boolean;
  lang: Lang;
  onChange: (next: PhaseSource[]) => void;
  /** The standard's own pick; absent where the standard is an option of
   *  the step's mapping layout. */
  onKeep?: () => void;
  onNext: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const open = adding || sources.length === 0;
  const path = layerPath(slot);
  const issuesAt = (i: number) => issues.filter((issue) => issue.path.startsWith(`${path}[${i}]`));
  const rest = issues.filter((issue) => !/^\[\d+\]/.test(issue.path.slice(path.length)));
  // The next source sits at the index it will take, so a pick keeps its card.
  const items: (PhaseSource | null)[] = open ? [...sources, null] : sources;
  return (
    <div className="flex flex-col gap-3" data-layer={slot}>
      {label ? <h2 className="m-0 text-sm font-medium text-ink">{label}</h2> : null}
      {onKeep ? (
        <StandardPick names={STANDARD_SOURCES[slot]} picked={kept || sources.length > 0} lang={lang} onPick={onKeep} />
      ) : null}
      {items.map((source, i) =>
        source !== null && "progressCode" in source ? (
          <section key={i} data-layer-source className="flex flex-col gap-2 border border-line bg-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{t("setup.viaMmi", lang)}</span>
              <button
                type="button"
                onClick={() => onChange(sources.filter((_, j) => j !== i))}
                className="px-2 py-1 text-[12px] text-muted hover:text-bad"
              >
                {t("action.remove", lang)}
              </button>
            </div>
            <IssueLines issues={issuesAt(i)} lang={lang} />
          </section>
        ) : (
          <LayerSourceCard
            key={i}
            source={source}
            picker={picker}
            issues={issuesAt(i)}
            judge={judge}
            lang={lang}
            onChange={(next) => {
              if (source === null) {
                setAdding(false);
                onChange([...sources, next]);
              } else onChange(sources.map((s, j) => (j === i ? next : s)));
            }}
            onRemove={source === null ? undefined : () => onChange(sources.filter((_, j) => j !== i))}
            onNext={onNext}
          />
        ),
      )}
      <IssueLines issues={rest} lang={lang} />
      <div className="flex flex-wrap gap-2">
        {open ? null : (
          <button type="button" data-layer-add onClick={() => setAdding(true)} className={SECONDARY + " w-fit"}>
            {t("action.addRow", lang)}
          </button>
        )}
        {viaMmi ? (
          <button
            type="button"
            data-via-mmi
            onClick={() => onChange([...sources, { progressCode: {} }])}
            className={SECONDARY + " w-fit"}
          >
            {t("setup.viaMmi", lang)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A layer cascade's result, split as the mapping layout splits it, per
 *  model, off the report row the engine wrote (cascade-aware, so nothing is
 *  counted twice): MAPPED, the elements a source of this cascade answered
 *  for (`dekning.kilder`, the branch's own on `material-product`) of the
 *  products the row judges; VALID, of those, a value the standard layer
 *  takes and one it does not (`avvik`; on `material-product` only a
 *  material can be avvik). */
type LayerSplit = { model: string; mapped: number; of: number; ok: number; bad: number; klasse: string | null };

function layerSplit(slot: LayerSlot, results: readonly { model: string; req: Requirement | null }[]): LayerSplit[] {
  const gren = slot === "product" ? "telleobjekt" : slot === "material" ? "mengdeobjekt" : undefined;
  return results.flatMap(({ model, req }) => {
    const d = req?.row?.dekning;
    if (!d || d.grunnlag === null || !d.kilder) return [];
    const kilder = d.kilder.filter((k) => gren === undefined || k.gren === gren);
    if (kilder.some((k) => k.n === null)) return [];
    const mapped = kilder.reduce((n, k) => n + (k.n ?? 0), 0);
    const bad = slot === "product" ? 0 : (d.avvik ?? 0);
    return [{ model, mapped, of: d.grunnlag, ok: mapped - bad, bad, klasse: d.grunnlag_klasse ?? null }];
  });
}

/** One cascade of a layer step (Fase; Produkt and Materiale, the two
 *  branches of Materiale / Produkt) in the mapping layout (`Mapping.tsx`).
 *  FROM is the cascade as read: the standard's sources, then the project's
 *  (+). OPTIONS: the standard (always read first, so always current; a pick
 *  keeps the step at it), «Via MMI» on Fase once the MMI codes carry
 *  phases, and «Endre», the project's sources (`LayerList`). The
 *  requirement is what the standard layer takes (`layerJudge`), as data:
 *  Fase the accepted phases, Materiale a name none of `NOT_A_MATERIAL`
 *  matches, Produkt «Ingen» (any value is a product, so MAPPED alone). */
function LayerBranch({
  slot,
  to,
  sources,
  accepted,
  picker,
  issues,
  judge,
  viaMmi,
  results,
  kept,
  lang,
  onChange,
  onKeep,
  onNext,
}: {
  slot: LayerSlot;
  to: React.ReactNode;
  sources: PhaseSource[];
  /** Fase: the phases the standard layer takes. */
  accepted: readonly string[];
  picker: Picker;
  issues: LintIssue[];
  judge: (value: string) => boolean;
  /** Offer «Via MMI»: the MMI step's codes carry phases. */
  viaMmi: boolean;
  results: readonly { model: string; req: Requirement | null }[];
  lang: Lang;
  onChange: (next: PhaseSource[]) => void;
  /** The standard picked: kept, or a project source after it. */
  kept: boolean;
  /** The standard's pick, a toggle as `StandardPick`'s: off only with no
   *  project source, and then the step is not done. */
  onKeep: () => void;
  onNext: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const splits = layerSplit(slot, results);
  const standard = STANDARD_SOURCES[slot];
  const hasMmi = sources.some((s) => "progressCode" in s);
  const options: MapOption[] = [
    { key: "standard", tag: t("setup.standard", lang), title: standard.join(" · "), current: kept, onPick: onKeep },
    ...(viaMmi || hasMmi
      ? [
          {
            key: "via-mmi",
            title: t("setup.viaMmi", lang),
            current: hasMmi,
            onPick: () => (hasMmi ? undefined : onChange([...sources, { progressCode: {} }])),
          },
        ]
      : []),
  ];
  const DATUM = "border border-line bg-panel px-2 py-0.5 font-mono text-[12px] text-ink";
  return (
    <MappingLayout
      lang={lang}
      to={to}
      // No status colour of its own: the standard layer's verdict is the
      // report row's, shown once for the step (a red 0 here beside its
      // «Advarsel» said two things).
      fromState="found"
      from={
        <FromSource
          tag={t("setup.standard", lang)}
          title={
            <>
              {standard.map((name) => (
                <span key={name}>{name}</span>
              ))}
              {sources.map((source, i) => (
                <span key={i}>+ {sourceText(source, lang)}</span>
              ))}
            </>
          }
          mapped={
            splits.length > 0 ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {splits.map((s) => (
                  <span key={s.model} title={s.model}>
                    <Mapped n={s.mapped} total={s.of} neutral label={s.klasse ?? undefined} lang={lang} />
                  </span>
                ))}
              </span>
            ) : null
          }
        />
      }
      options={<OptionList options={options} label={t(`field.${slot}` as StringKey, lang)} lang={lang} more={{ open: editing, onToggle: () => setEditing((was) => !was) }} />}
      editor={
        editing ? (
          <div data-source-editor data-panel className={PANEL}>
            <LayerList
              slot={slot}
              sources={sources}
              kept
              picker={picker}
              issues={issues}
              judge={judge}
              viaMmi={false}
              lang={lang}
              onChange={onChange}
              onNext={onNext}
            />
          </div>
        ) : null
      }
      requirement={
        <>
          <div data-layer-requirement={slot} className="flex flex-wrap items-center gap-1.5">
            {slot === "phase" ? (
              accepted.map((v) => (
                <span key={v} className={DATUM}>
                  {v}
                </span>
              ))
            ) : slot === "material" ? (
              <>
                <span aria-hidden="true" className="font-mono text-[15px] text-ink">
                  ≠
                </span>
                {/* What the patterns refuse, by example; the patterns are
                    behind the step's «Avansert». */}
                {NOT_A_MATERIAL_EXAMPLES.map((v) => (
                  <span key={v} className={DATUM}>
                    {v}
                  </span>
                ))}
              </>
            ) : (
              <span className={DATUM}>{t("tfm.none", lang)}</span>
            )}
          </div>
          {slot !== "product" && splits.some((s) => s.ok > 0 || s.bad > 0) ? (
            <span data-valid className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {splits.map((s) => (
                <span key={s.model} title={s.model} className="inline-flex items-center gap-1.5">
                  <StateChip state="ok" count={s.ok} lang={lang} />
                  {s.bad > 0 ? <StateChip state="not-in-list" count={s.bad} lang={lang} /> : null}
                </span>
              ))}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** The floor config: ordered levels, name + elevation in metres, measured to
 *  the plane. Stored as the ruleset's `storeys`, checked by `storey-config`.
 *  The plane has no default; a new config matches exactly (tolerance 0 and 0,
 *  a same-named storey at any distance, another name at the same mm), and the
 *  workbook or JSON sets the tolerances. An empty list is no config. */
function StoreyCard({
  setup,
  issues,
  lang,
  onChange,
}: {
  setup: StoreySetup | undefined;
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: StoreySetup | undefined) => void;
}) {
  const storeys = setup?.levels ?? [];
  const invalid = (i: number, field: string) =>
    issues.some((issue) => issue.path === `storeys.levels[${i}].${field}` && issue.severity === "error");
  const planeInvalid = issues.some((issue) => issue.path === "storeys.plane");
  const setLevels = (levels: StoreyLevel[]) => onChange(setupWithLevels(setup, levels));
  const planeIssues = issues.filter((i) => i.path === "storeys.plane");
  const levelIssues = issues.filter((i) => i.path.startsWith("storeys.levels"));
  const otherIssues = issues.filter((i) => !planeIssues.includes(i) && !levelIssues.includes(i));
  const levelSubject = (issue: LintIssue) => {
    const m = /^storeys\.levels\[(\d+)\]/.exec(issue.path);
    if (!m) return null;
    const i = Number(m[1]);
    return storeys[i]?.name || `#${i + 1}`;
  };
  const set = (i: number, patch: Partial<StoreyLevel>) =>
    setLevels(storeys.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const plane = setup?.plane;
  const elevationLabel: StringKey =
    plane === "OKFG" || plane === "OKBD" ? `field.storeyElevation.${plane}` : "field.storeyElevation";
  // A FIXED, viewport-derived card (DESIGN.md §1): the rows scroll inside
  // it, so adding a floor never moves the cards below.
  return (
    <section className="flex h-[clamp(15rem,40vh,34rem)] flex-col gap-3 border border-line bg-panel p-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <h2 className="m-0 text-sm font-medium text-ink">{t("setup.storeys", lang)}</h2>
        {setup ? (
          <Field label={t("field.plane", lang)}>
            <select
              className={INPUT}
              aria-invalid={planeInvalid}
              value={setup.plane}
              onChange={(e) => onChange({ ...setup, plane: e.target.value as StoreyPlane })}
            >
              {setup.plane === ("" as StoreyPlane) ? <option value="" /> : null}
              <option value="OKFG">OKFG</option>
              <option value="OKBD">OKBD</option>
            </select>
          </Field>
        ) : null}
      </div>
      {storeys.length > 0 ? (
        <div className="grid min-h-0 content-start items-center gap-x-2 gap-y-1 overflow-auto [grid-template-columns:minmax(0,1fr)_9rem_auto]">
          <span className={LABEL}>{t("field.storeyName", lang)}</span>
          <span className={LABEL}>{t(elevationLabel, lang)}</span>
          <span />
          {storeys.map((storey, i) => (
            <StoreyRow
              key={i}
              storey={storey}
              lang={lang}
              nameInvalid={invalid(i, "name")}
              elevationInvalid={invalid(i, "elevation")}
              onChange={(patch) => set(i, patch)}
              onRemove={() => setLevels(storeys.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setLevels([...storeys, { name: "", elevation: Number.NaN }])}
        className="w-fit shrink-0 border border-line bg-input px-2 py-0.5 text-[12px] text-muted hover:border-green hover:text-green"
      >
        {t("action.addRow", lang)}
      </button>
      {issues.length > 0 ? (
        <div className="flex max-h-24 shrink-0 flex-col gap-1 overflow-auto">
          <IssueLines issues={planeIssues} lang={lang} />
          <IssueLines issues={levelIssues} lang={lang} subject={levelSubject} />
          <IssueLines issues={otherIssues} lang={lang} />
        </div>
      ) : null}
    </section>
  );
}

/** `setup` with these levels. No levels is no config; a first level starts
 *  one that matches exactly and has no plane, which lint refuses until one
 *  is chosen. */
function setupWithLevels(setup: StoreySetup | undefined, levels: StoreyLevel[]): StoreySetup | undefined {
  if (levels.length === 0) return undefined;
  return setup
    ? { ...setup, levels }
    : {
        plane: "" as StoreyPlane,
        tolerance: { aboveMm: 0, belowMm: 0 },
        nameWindowMm: null,
        nearMm: 0,
        levels,
      };
}

/** The loaded models' own storeys (`step-templates.ts` `modelLevels`): «+» on
 *  one adds it as a level, «Legg til alle» every one the table lacks. */
function ModelStoreys({
  fromModels,
  levels,
  lang,
  onAdd,
}: {
  fromModels: StoreyLevel[];
  levels: StoreyLevel[];
  lang: Lang;
  onAdd: (levels: StoreyLevel[]) => void;
}) {
  const missing = fromModels.filter((l) => !hasLevel(levels, l));
  const metres = (m: number) =>
    m.toLocaleString(locale(lang), { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return (
    <div className="flex flex-col gap-2" data-model-storeys>
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>{t("kpi.storeys", lang)}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{formatCount(fromModels.length, lang)}</span>
        <button
          type="button"
          data-add-all
          disabled={missing.length === 0}
          onClick={() => onAdd(missing)}
          className="border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-line"
        >
          {t("action.addAll", lang)}
        </button>
      </div>
      <div className="flex max-h-56 flex-col overflow-auto border border-line bg-input py-1">
        {fromModels.map((level) => {
          const added = hasLevel(levels, level);
          return (
            <div
              key={`${level.name}\u0000${level.elevation}`}
              data-storey={level.name}
              className="grid items-center gap-3 px-3 py-1 text-[12px] text-ink [grid-template-columns:minmax(0,1fr)_7rem_1.75rem]"
            >
              <span className="min-w-0 truncate font-mono">{level.name}</span>
              <span className="text-right font-mono tabular-nums text-muted">{metres(level.elevation)}</span>
              {added ? (
                <StateChip state="ok" lang={lang} />
              ) : (
                <button
                  type="button"
                  data-add={level.name}
                  aria-label={`${t("action.addRow", lang)} ${level.name}`}
                  onClick={() => onAdd([level])}
                  className="text-center font-mono text-[14px] leading-none text-muted hover:text-green"
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Enable a card that is off: its name, and the two answers. Nothing else.
 *  The same ask confirms replacing the MMI codes with a preset (`confirm`). */
function EnableDialog({
  title,
  confirm = "action.enable",
  lang,
  onConfirm,
  onCancel,
}: {
  title: string;
  confirm?: StringKey;
  lang: Lang;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onCancel();
      }}
      className="m-auto border border-line bg-panel p-0 text-ink backdrop:bg-ink/30"
    >
      <div className="flex min-w-64 flex-col gap-3 p-4">
        <h2 className="m-0 text-sm font-medium text-ink">{title}</h2>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-line bg-input px-3 py-1 text-[12px] text-ink hover:border-green hover:text-green"
          >
            {t("action.cancel", lang)}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="bg-green px-3 py-1 text-[12px] text-cream hover:bg-ink"
          >
            {t(confirm, lang)}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The elevation keeps its own draft so "-" or "118," can be typed on the way
 *  to a number; the ruleset gets the parsed value (NaN while incomplete, which
 *  lint refuses, so an unfinished row cannot be downloaded). */
function StoreyRow({
  storey,
  lang,
  nameInvalid,
  elevationInvalid,
  onChange,
  onRemove,
}: {
  storey: StoreyLevel;
  lang: Lang;
  nameInvalid: boolean;
  elevationInvalid: boolean;
  onChange: (patch: Partial<StoreyLevel>) => void;
  onRemove: () => void;
}) {
  const shown = Number.isFinite(storey.elevation) ? String(storey.elevation) : "";
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    if (parseElevation(draft) !== storey.elevation) setDraft(shown);
  }
  return (
    <>
      <input
        type="text"
        className={INPUT}
        aria-invalid={nameInvalid}
        value={storey.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <input
        type="text"
        inputMode="decimal"
        className={INPUT + " text-right"}
        aria-invalid={elevationInvalid}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange({ elevation: parseElevation(e.target.value) });
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="px-2 py-0.5 text-[12px] text-muted hover:text-bad"
      >
        {t("action.remove", lang)}
      </button>
    </>
  );
}

/** Comma or point decimal; anything else is NaN. */
function parseElevation(text: string): number {
  const clean = text.trim().replace(",", ".");
  return clean === "" || !/^-?\d+(\.\d+)?$/.test(clean) ? Number.NaN : Number(clean);
}

/** The project-layer steps, and the cascades each one edits. */
type LayerStep = "phase" | "materials";

const LAYER_SLOTS: Record<LayerStep, readonly LayerSlot[]> = {
  phase: ["phase"],
  materials: ["product", "material"],
};

/** Oppsett's steps, in order. `start` is the choice between a filled-in
 *  config file and the guided walk; `ifc` opens a model, so the property
 *  pickers have something to list. Then edkjo's Type-first order (2026-10-01:
 *  "System, Function, Copy, MMI, Phase, Materials, QTO: these are my main
 *  things"; QTO's Mengdetype left the walk 2026-10-05), Etasjeoppsett, and
 *  `end`: what was set, what it gives, Save. `pofin` is the prompt after
 *  «POFIN» on the choice, outside the order. */
export type SetupStep = "start" | "pofin" | "ifc" | MappingRole | LayerStep | "storeys" | "end";

const STEPS: SetupStep[] = [
  "start",
  "ifc",
  "type-name",
  "system-classification",
  "component-classification",
  "copy-object",
  "progress-code",
  "phase",
  "materials",
  "storeys",
  "tfm",
  "end",
];

/** The questions the bar counts: not the choice before them, not the end. */
const WALK: SetupStep[] = STEPS.slice(1, -1);

/** Where the walk goes once a model is on the board. */
export const FIRST_MAPPING_STEP: SetupStep = STEPS[2];

/** A step's name. Where the board has a Standardkrav row for it, the
 *  board's name, so the walk and the board say the same. */
const STEP_LABEL: Partial<Record<SetupStep, StringKey>> = {
  start: "action.setup",
  pofin: "setup.pofin",
  ifc: "action.uploadIfc",
  "type-name": "check.type-name-placeholder",
  "component-classification": "req.funksjonskode",
  phase: "req.fase",
  materials: "req.materiale-produkt",
  storeys: "setup.storeys",
  tfm: "req.tfm",
  end: "setup.summary",
};

/** The requirement (`requirements.ts`) whose report row is a step's result,
 *  as the IDS tab shows it. */
const STEP_REQ: Partial<Record<SetupStep, string>> = {
  "type-name": "typenavn",
  "system-classification": "systemkode",
  "component-classification": "funksjonskode",
  "copy-object": "kopiobjekt",
  "progress-code": "mmi",
  phase: "fase",
  materials: "materiale-produkt",
  storeys: "etasjedefinisjon",
  tfm: "tfm",
};

function stepLabel(step: SetupStep, lang: Lang): string {
  const key = STEP_LABEL[step];
  return key ? t(key, lang) : t(`mapping.${step as CardRole}`, lang);
}

function isLayerStep(step: SetupStep): step is LayerStep {
  return step in LAYER_SLOTS;
}

const MAPPING_ROLES: readonly SetupStep[] = [
  "system-classification",
  "component-classification",
  "copy-object",
  "progress-code",
];

function isMappingStep(step: SetupStep): step is CardRole {
  return MAPPING_ROLES.includes(step);
}

/** The rule's check, or the blank one a first answer starts from. */
function checkOf(rule: ExtendedRule | null, role: CardRole): MappingCheck {
  return rule && (rule.check.type === "code-lookup" || rule.check.type === "copy-object") ? rule.check : blankCheck(role);
}

/** A source as the step and the summary name it. */
function sourceText(source: PhaseSource, lang: Lang): string {
  if ("progressCode" in source) return t("setup.viaMmi", lang);
  if ("property" in source) return `${source.property.propertySet}.${source.property.name}`;
  if ("attribute" in source) return `${t("field.source.attribute", lang)} ${source.attribute}`;
  if ("classification" in source)
    return [t("field.source.classification", lang), source.classification.system ?? ""].join(" ").trim();
  return t("field.source.material", lang);
}

/** The source a rule holds, as the step pre-picks it; null when it holds
 *  none (no rule, or a property not filled in). */
function currentSource(rule: ExtendedRule | null, check: MappingCheck, lang: Lang): CurrentSource | null {
  if (rule === null) return null;
  const source = check.source;
  if ("property" in source) {
    const { propertySet, name } = source.property;
    return propertySet === "" && name === "" ? null : { kind: "property", set: propertySet, name };
  }
  if ("attribute" in source) return { kind: "other", head: t("field.source.attribute", lang), title: source.attribute };
  if ("classification" in source)
    return { kind: "other", head: t("field.source.classification", lang), title: source.classification.system ?? "" };
  return { kind: "other", head: t("field.source", lang), title: t("field.source.material", lang) };
}

function formatMetres(m: number, lang: Lang): string {
  return Number.isFinite(m) ? m.toLocaleString(locale(lang), { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "";
}

/** The TFM step's answer in the making: the property carrying the string,
 *  the sequence, and Lokasjon's binding (the one bound part with no step of
 *  its own). Written to the ruleset by «Bruk» only. */
interface TfmDraft {
  source: CodeSource | null;
  sequence: TfmToken[];
  lokasjon: CodeSource | null;
}

/** A choice tile. No background here: each tile sets its own (a shared
 *  `bg-panel` beat the POFIN tile's `bg-green` in the cascade and left its
 *  cream text on a pale tile, unreadable; seen rendered 2026-10-05). */
const TILE = "flex min-h-36 flex-col border-2 p-8 text-left";
const H1 = STEP_TITLE;
/** The walk's frame, by viewport class: 64rem (the mapping row's width, to a
 *  1535 px laptop), 80rem from 1536 px, 100rem from 2200 px (137.5rem: in
 *  rem, as the named breakpoints are, or Tailwind orders it before `2xl:`
 *  and it never wins; measured 1280 px wide at 2560 before), so a wide
 *  screen gives its width to the step's zones. The bar and the step share it. */
const FRAME = "max-w-5xl 2xl:max-w-7xl min-[137.5rem]:max-w-[100rem]";
/** A mapping step's one column (2026-10-05): the requirement, the three
 *  cards, the actions, «Avansert», 1152 px at most, the frame's below. */
const COLUMN = "mx-auto w-full max-w-[72rem]";
const PLANES: readonly StoreyPlane[] = ["OKFG", "OKBD"];

export function SetupPage({
  lang,
  ruleset,
  rulesetLoaded,
  fileName,
  models,
  step,
  onStep,
  onChange,
  onOpen,
  onFiles,
  dragging,
  onSave,
  pofin,
  onPofin,
}: {
  lang: Lang;
  ruleset: Ruleset;
  /** A ruleset is loaded or being edited: the walk skips the choice. */
  rulesetLoaded: boolean;
  fileName: string;
  models: ModelEntry[];
  /** The step on screen; null until one is chosen, then the default. */
  step: SetupStep | null;
  onStep: (step: SetupStep) => void;
  onChange: (next: Ruleset) => void;
  /** A ruleset file picked here: .ruleset.json, .xlsx or .ids. True once it
   *  loaded. */
  onOpen: (file: File) => Promise<boolean>;
  /** IFC files picked on the IFC step. */
  onFiles: (files: File[]) => void;
  /** A file is held over the page (`App`'s drop takes it anywhere). */
  dragging: boolean;
  /** «Lagre oppsett»: null once saved, else the storage's error. */
  onSave: () => string | null;
  /** «POFIN» was the choice: held by the caller, as the step is, so it
   *  outlives the remount when the first model lands. */
  pofin: boolean;
  onPofin: (on: boolean) => void;
}) {
  const lint = lintRuleset(ruleset);
  const nameIssue = lint.some((i) => i.ruleId === null && i.path === "name");
  // The name field is marked invalid only once it has been touched or a
  // download was attempted, never on a page nobody has typed on yet.
  const [nameTouched, setNameTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [asking, setAsking] = useState<CardRole | null>(null);
  // The cascades explicitly left at the standard: no project source, and
  // the standard picked. Not in the ruleset (an empty entry is refused by
  // the workbook), so it holds for this Oppsett.
  const [kept, setKept] = useState<ReadonlySet<LayerSlot>>(new Set());
  const [exportError, setExportError] = useState<string | null>(null);
  // The step just answered and what it gave, shown on the step it led to.
  // `live`: the result is the step's report row, read when shown (TFM:
  // the check runs once the rule is in the ruleset, after the click).
  const [landed, setLanded] = useState<{ from: SetupStep; to: SetupStep; result: React.ReactNode; live?: boolean } | null>(null);
  // The TFM step's answer while it is being built: the property, the
  // sequence, Lokasjon's binding. Null until touched, so the pre-pick follows
  // the models as they are read; dropped when the step is left.
  const [tfmDraft, setTfmDraft] = useState<TfmDraft | null>(null);
  // The TFM step's source editor, open by «Endre».
  const [tfmEditing, setTfmEditing] = useState(false);
  // Etasjeoppsett's plane, picked on the step; written by «Bruk».
  const [planePick, setPlanePick] = useState<StoreyPlane | null>(null);
  // A step opened from a row of the POFIN prompt or the summary: its answer
  // goes back to that screen, not on. Dropped once the step is left.
  const [detour, setDetour] = useState<{ step: SetupStep; back: SetupStep } | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const blocked = hasErrors(lint);
  const hasIds = ruleset.rules.some((r) => r.kind === "ids" && r.enabled !== false);
  const downloadClass = (off: boolean) => SECONDARY + (off ? " cursor-not-allowed text-muted hover:border-line hover:text-muted" : "");

  // A model read and on the board: until then the walk stays on its IFC
  // step, which `App` leaves for the first mapping once one is.
  const loaded = models.some((m) => m.state === "ready");
  const firstStep: SetupStep = loaded ? FIRST_MAPPING_STEP : "ifc";
  const current: SetupStep = step ?? (rulesetLoaded ? firstStep : "start");
  const at = STEPS.indexOf(current);
  // The IFC step with no model loaded: the stage, the drop target alone.
  const stage = current === "ifc" && !loaded;
  // The steps answered by a click in this Oppsett while a model was loaded:
  // the bar's green (`segmentState`), with the saved sources that hit.
  const [confirmed, setConfirmed] = useState<ReadonlySet<SetupStep>>(new Set());
  const confirmStep = (s: SetupStep) => {
    if (loaded && !confirmed.has(s)) setConfirmed(new Set([...confirmed, s]));
  };

  // The picker's list: every model that has answered, merged. null while no
  // model is on the board; reading while one is still being read or asked.
  const picker = useMemo((): Picker => {
    const answered = models.filter((m) => m.psets !== undefined).map((m) => m.psets!);
    const reading = models.some(
      (m) => m.state === "queued" || m.state === "parsing" || (m.state === "ready" && !m.psets && !m.psetsError),
    );
    const profiled = models.filter((m) => m.profile);
    return {
      choices: answered.length > 0 ? mergeChoices(answered) : models.length > 0 && reading ? [] : null,
      reading,
      errors: models.filter((m) => m.psetsError).map((m) => `${m.fileName}: ${m.psetsError}`),
      // The elements the walk's rules select, the report rows' grunnlag.
      total:
        profiled.length > 0
          ? profiled.reduce((n, m) => n + m.profile!.rows.filter((row) => isWalkSelected(row.entity)).length, 0)
          : null,
    };
  }, [models]);

  // The models' own storeys, for the Etasjeoppsett step.
  const fromModels = useMemo(
    () =>
      modelLevels(
        models.flatMap((m) =>
          m.profile && m.report
            ? [{ storeys: m.profile.storeys, unitScale: m.report.summary.unit_scale, unitResolved: m.report.summary.unit_resolved }]
            : [],
        ),
      ),
    [models],
  );

  const ownerNames = useMemo(() => everyOwnerName(ruleset), [ruleset]);

  // The type step: every type Name the models' typed elements reach, with
  // the elements using it, most first; null with no model profiled.
  const typeNames = useMemo((): PsetValue[] | null => {
    const profiled = models.filter((m) => m.profile);
    if (profiled.length === 0) return null;
    const counts = new Map<string, number>();
    for (const m of profiled) {
      for (const row of m.profile!.rows) {
        // The types the rule reaches: through the elements it selects.
        if (row.typed && row.typeName && isWalkSelected(row.entity)) counts.set(row.typeName, (counts.get(row.typeName) ?? 0) + 1);
      }
    }
    return [...counts].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
  }, [models]);

  // Where Typenavn reads: the Name of each selected element's type object,
  // by the type classes found (ifcfast spells them `IfcWalltype`), and how
  // many selected elements have a type with a Name.
  const typeSource = useMemo((): TypeNameSource | null => {
    const profiled = models.filter((m) => m.profile);
    if (profiled.length === 0) return null;
    const classes = new Map<string, number>();
    let named = 0;
    let total = 0;
    for (const m of profiled) {
      const typeClass = new Map((m.profile!.typeObjects ?? []).map((t) => [t.guid, t.entity]));
      for (const row of m.profile!.rows) {
        if (!isWalkSelected(row.entity)) continue;
        total += 1;
        if (!row.typed || !row.typeName) continue;
        named += 1;
        const raw = row.typeEntity ?? (row.typeGuid ? typeClass.get(row.typeGuid) : undefined) ?? null;
        const cls = raw ? raw.replace(/type$/i, "Type") : null;
        if (cls) classes.set(cls, (classes.get(cls) ?? 0) + 1);
      }
    }
    return {
      classes: [...classes].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
      named,
      total,
    };
  }, [models]);

  // The TFM step: the saved rule's check, and the properties whose values
  // are strings of its sequence (the standard's when none is saved).
  const tfmRule = mappingRule(ruleset, "tfm");
  const tfmSaved = tfmRule && tfmRule.check.type === "tfm" ? tfmRule.check : null;
  const tfmRanked = useMemo(
    () =>
      current === "tfm" && picker.choices ? rankTfmCandidates(picker.choices, tfmSaved?.sequence ?? STATSBYGG_SEQUENCE) : [],
    [current, picker.choices, tfmSaved],
  );
  if (current !== "tfm" && tfmDraft !== null) setTfmDraft(null);
  if (current !== "tfm" && tfmEditing) setTfmEditing(false);
  if (current !== "storeys" && planePick !== null) setPlanePick(null);
  const away = detour !== null && detour.step === current ? detour : null;
  if (detour !== null && away === null) setDetour(null);

  // Each model's requirements as the IDS tab reads them: a step's result.
  const results = useMemo(
    () => models.filter((m) => m.board).map((m) => ({ model: m.fileName, reqs: requirements(m.board!.rows) })),
    [models],
  );
  const resultsFor = (key: string | undefined) =>
    key ? results.map(({ model, reqs }) => ({ model, req: reqs.find((r) => r.key === key) ?? null })) : [];
  const resultOf = (s: SetupStep) => resultsFor(STEP_REQ[s]);

  // The mapping step's rule and check, held still across renders so the
  // candidates are ranked once per answer, not once per keystroke elsewhere.
  const role = isMappingStep(current) ? current : null;
  const rule = role ? mappingRule(ruleset, role) : null;
  const check = useMemo(() => (role ? checkOf(rule, role) : null), [rule, role]);

  const layerIssues = (slot: LayerSlot) => lint.filter((i) => i.ruleId === null && i.path.startsWith(layerPath(slot)));
  const done = (s: SetupStep): boolean => {
    if (s === "start" || s === "pofin" || s === "end") return false;
    if (isLayerStep(s))
      return LAYER_SLOTS[s].every(
        (slot) => (kept.has(slot) || layerSources(ruleset, slot).length > 0) && !hasErrors(layerIssues(slot)),
      );
    if (s === "ifc") return models.some((m) => m.state === "ready");
    if (s === "storeys")
      return (ruleset.storeys?.levels.length ?? 0) > 0 && !hasErrors(lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys")));
    const r = mappingRule(ruleset, s);
    return r !== null && r.enabled !== false && !hasErrors(lint.filter((i) => i.ruleId === r.id));
  };

  // The bar's segments: green only against a loaded model (`segmentState`).
  // A step's saved answer and its hits in the loaded models: elements
  // carrying the property, the project sources' count on the report row,
  // the model storeys the levels match; null where it cannot be counted
  // here or is not read yet.
  const propHits = (source: CodeSource): number | null => {
    if (!("property" in source) || picker.choices === null) return null;
    const { propertySet, name } = source.property;
    return picker.choices.find((c) => c.set === propertySet)?.props.find((p) => p.name === name)?.valued ?? 0;
  };
  const projectHits = (s: LayerStep): number | null => {
    let hits = 0;
    for (const { req } of resultOf(s)) {
      for (const slot of LAYER_SLOTS[s]) {
        const gren = slot === "product" ? "telleobjekt" : slot === "material" ? "mengdeobjekt" : undefined;
        for (const k of req?.row?.dekning?.kilder ?? []) {
          if (k.lag !== "prosjekt" || (gren !== undefined && k.gren !== gren)) continue;
          if (k.n === null) return null;
          hits += k.n;
        }
      }
    }
    return results.length > 0 ? hits : null;
  };
  const savedAnswer = (s: SetupStep): { hits: number | null } | null => {
    if (s === "storeys") {
      const levels = ruleset.storeys?.levels ?? [];
      if (levels.length === 0) return null;
      return { hits: fromModels.length > 0 ? fromModels.filter((l) => hasLevel(levels, l)).length : null };
    }
    if (isLayerStep(s))
      return LAYER_SLOTS[s].some((slot) => layerSources(ruleset, slot).length > 0) ? { hits: projectHits(s) } : null;
    if (s === "type-name") {
      const r = mappingRule(ruleset, "type-name");
      return r && r.enabled !== false && r.check.type === "type-name" ? { hits: typeNames?.length ?? null } : null;
    }
    if (s === "tfm") return tfmRule && tfmRule.enabled !== false && tfmSaved ? { hits: propHits(tfmSaved.source) } : null;
    if (isMappingStep(s)) {
      const r = mappingRule(ruleset, s);
      return r && r.enabled !== false ? { hits: propHits(checkOf(r, s).source) } : null;
    }
    return null;
  };
  const segment = (s: SetupStep) =>
    s === "ifc" ? segmentState(loaded, loaded, null) : segmentState(loaded, confirmed.has(s), savedAnswer(s));

  const newRule = (role: CardRole): ExtendedRule => ({
    id: freshId(ruleset, role),
    kind: "extended",
    // The copy-object role is its check type; the others are a mapping.
    ...(role === "copy-object" ? {} : { mapping: role }),
    name: t(`mapping.${role}`, lang),
    select: { entity: { group: "physicalElement" } },
    check: blankCheck(role),
  });

  const toggle = (role: CardRole) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) {
      onChange({ ...ruleset, rules: [...ruleset.rules, newRule(role)] });
      return;
    }
    const next: ExtendedRule = { ...rule };
    if (rule.enabled === false) delete next.enabled;
    else next.enabled = false;
    onChange({ ...ruleset, rules: ruleset.rules.map((r) => (r === rule ? next : r)) });
  };

  // An edit is a decision: it turns the rule on, creating it if need be.
  const setCheck = (role: CardRole, check: MappingCheck) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) {
      const created: ExtendedRule = { ...newRule(role), check };
      onChange({ ...ruleset, rules: [...ruleset.rules, created] });
      return;
    }
    const next: ExtendedRule = { ...rule, check };
    delete next.enabled;
    onChange({
      ...ruleset,
      rules: ruleset.rules.map((r) => (r === rule ? next : r)),
    });
  };

  const setStoreys = (storeys: StoreySetup | undefined) => {
    const next: Ruleset = { ...ruleset, storeys };
    if (storeys === undefined) delete next.storeys;
    onChange(next);
  };

  const save = () => {
    setExportError(null);
    const error = onSave();
    if (error !== null) setExportError(error);
  };

  // The way on. An answer moves on by itself and its result lands on the
  // next step; «Hopp over» moves on and changes nothing.
  // In a detour both lead back to the screen the step was opened from.
  const next = away?.back ?? STEPS[at + 1] ?? current;
  const back = away ? () => onStep(away.back) : at > 0 ? () => onStep(STEPS[at - 1]) : undefined;
  // The landed strip reads the step's report row when it is shown, the same
  // figures the summary prints (2026-10-05, review: the strip showed the
  // preview's counts, the summary the report's, and they disagreed).
  const advanceLive = () => {
    confirmStep(current);
    setLanded({ from: current, to: next, result: null, live: true });
    onStep(next);
  };
  const skip = () => onStep(next);
  // The walk's foot, one for every step (2026-10-05, review): back on the
  // left; «Hopp over» (on the IFC step with a model, «Neste») and the step's
  // «Bruk» on the right, the latter drawn by the step into `slot`
  // (`StepConfirm`). Nothing of it on the choice and the IFC stage.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const question = current !== "start" && current !== "pofin" && current !== "end" && !stage;
  const footBack = current === "pofin" ? () => onStep("start") : stage ? (step !== null ? back : undefined) : current === "start" ? undefined : back;
  const footForward = question ? t(current === "ifc" ? "action.next" : "action.skip", lang) : undefined;

  // What each step set, as the summary and the POFIN prompt name it.
  const setText = (s: SetupStep): string => {
    if (s === "ifc") return models.map((m) => m.fileName).join(", ");
    if (s === "storeys") {
      const n = ruleset.storeys?.levels.length ?? 0;
      return n > 0 ? `${formatCount(n, lang)} ${t("kpi.storeys", lang)} · ${ruleset.storeys?.plane ?? ""}` : "–";
    }
    if (isLayerStep(s))
      return LAYER_SLOTS[s]
        .map((slot) =>
          [t("setup.standard", lang), ...layerSources(ruleset, slot).map((source) => sourceText(source, lang))].join(" + "),
        )
        .join(" · ");
    if (s === "type-name") {
      const r = mappingRule(ruleset, "type-name");
      return r && r.enabled !== false && r.check.type === "type-name" ? r.check.sequence.map((p) => partLabel(p, lang)).join("  ") : "–";
    }
    if (s === "tfm") {
      return tfmRule && tfmRule.enabled !== false && tfmSaved
        ? `${sourceText(tfmSaved.source, lang)} · ${formatSequence(tfmSaved.sequence)}`
        : "–";
    }
    if (isMappingStep(s)) {
      const r = mappingRule(ruleset, s);
      if (!r || r.enabled === false) return "–";
      const c = checkOf(r, s);
      // A rule read on the type objects says so, as its result's class does
      // (a saved KNM rule reads Funksjonskode from the type's Name).
      const onTypes = c.type === "code-lookup" && c.target === "type" ? ` · ${t("field.target.type", lang)}` : "";
      return `${sourceText(c.source, lang)}${onTypes}`;
    }
    return "";
  };
  // A row of the summary or the prompt; `from` set, a click opens the step
  // as a detour back to `from`.
  const stepRow = (s: SetupStep, from: SetupStep | null) => (
    <SummaryRow
      key={s}
      done={from === "pofin" ? null : done(s)}
      label={stepLabel(s, lang)}
      text={setText(s)}
      results={resultOf(s)}
      lang={lang}
      onClick={() => {
        if (from !== null) setDetour({ step: s, back: from });
        onStep(s);
      }}
    />
  );
  // The IFC schema POFIN sets: a project-layer part with no step, so a row
  // with no click.
  const schema = ruleset.projectLayer?.["ifc-schema"];
  const schemaRow = schema ? (
    <SummaryRow
      key="ifc-schema"
      done={current === "pofin" ? null : (schema.accepted?.length ?? 0) > 0}
      label={t("req.ifc-schema", lang)}
      text={schema.accepted?.join(", ") ?? "–"}
      results={resultsFor("ifc-schema")}
      lang={lang}
    />
  ) : null;

  // The steps whose name is the mapping layout's TO (Materiale / Produkt
  // keeps its heading: its two branches are the TOs).
  const inTo = isMappingStep(current) || current === "type-name" || current === "tfm" || current === "phase";

  let body: React.ReactNode;
  // Under the step's action row (a mapping step's «Avansert»).
  let after: React.ReactNode = null;
  if (current === "start") {
    // «POFIN»: the template on the working copy, nothing saved.
    const takePofin = () => {
      onChange(withPofin(ruleset));
      onPofin(true);
      onStep("pofin");
    };
    body = (
      <>
        <h1 className={H1}>{t("action.setup", lang)}</h1>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <button
            type="button"
            autoFocus
            data-choice="pofin"
            onClick={takePofin}
            className={TILE + " items-start justify-center border-green bg-green text-cream hover:border-ink hover:bg-ink"}
          >
            <span className="text-[28px] leading-tight font-semibold tracking-tight">{t("setup.pofin", lang)} →</span>
          </button>
          <button
            type="button"
            data-choice="custom"
            onClick={() => {
              onPofin(false);
              onStep(firstStep);
            }}
            className={TILE + " items-start justify-center border-line bg-panel text-ink hover:border-green"}
          >
            <span className="text-[28px] leading-tight font-semibold tracking-tight">{t("setup.custom", lang)} →</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => openInput.current?.click()} className={SECONDARY}>
            <span>{t("action.openRuleset", lang)}</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{t("accept.ruleset", lang)}</span>
          </button>
          <a href={`${import.meta.env.BASE_URL}${CONFIG_TEMPLATE_FILE}`} download={CONFIG_TEMPLATE_FILE} className={SECONDARY}>
            {t("action.downloadTemplate", lang)}
          </a>
          <input
            ref={openInput}
            type="file"
            accept=".json,.xlsx,.ids,.xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void onOpen(file).then((ok) => {
                  if (!ok) return;
                  onPofin(false);
                  onStep(firstStep);
                });
              event.target.value = "";
            }}
          />
        </div>
      </>
    );
  } else if (current === "pofin") {
    // What «POFIN» assigned, each row its step, then the two ways on. The
    // filled one follows the result: a POFIN item failing on the loaded
    // models puts «Gjennomgå» first, else «Aksepter oppsett».
    const failing = POFIN_ROLES.some((role) =>
      resultOf(role).some(({ req }) => req !== null && stateLook(req.state, lang).verdict === "fail"),
    );
    body = (
      <div className="flex flex-col gap-4">
        <div data-panel className="border border-line bg-panel">
          <ol data-pofin className="m-0 flex list-none flex-col p-0">
            {POFIN_ROLES.map((role) => stepRow(role, "pofin"))}
            {schemaRow}
          </ol>
        </div>
        {/* The two ways on sit where every step's «Bruk» sits. */}
        {slot
          ? createPortal(
              <>
                <button
                  type="button"
                  autoFocus={failing}
                  data-pofin-review
                  data-lead={failing}
                  onClick={() => onStep(firstStep)}
                  className={failing ? CONFIRM : CONFIRM_QUIET}
                >
                  {t("action.review", lang)} →
                </button>
                <button
                  type="button"
                  autoFocus={!failing}
                  data-pofin-accept
                  data-lead={!failing}
                  onClick={() => onStep("end")}
                  className={failing ? CONFIRM_QUIET : CONFIRM}
                >
                  {t("action.acceptSetup", lang)} →
                </button>
              </>,
              slot,
            )
          : null}
      </div>
    );
  } else if (current === "ifc") {
    // The stage: the target alone, back only to a screen that was there (the
    // choice, or the screen a detour came from). Read: the sweep in the
    // target, and `App` moves on once a model is loaded. A file that failed
    // keeps the stage, with the list saying why.
    const busy = !loaded && models.some((m) => m.state === "queued" || m.state === "parsing");
    body = (
      <div className={"mx-auto flex flex-col gap-4 " + STAGE_WIDTH}>
        <IfcDrop
          label={stepLabel("ifc", lang)}
          accept={t("accept.ifc", lang)}
          dragging={dragging}
          busy={busy}
          onFiles={onFiles}
        />
        {loaded || models.some((m) => m.state === "failed") ? (
          <ul className="m-0 flex list-none flex-col border border-line bg-panel p-0">
            {models.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-b-0">
                <span className="min-w-0 truncate font-mono text-[12px] text-ink">{m.fileName}</span>
                <span className={"shrink-0 text-[12px] " + (m.state === "failed" ? "text-bad" : "text-muted")}>
                  {t(m.rejected ? "file.rejected" : `file.${m.state}`, lang)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {stage && step !== null && back ? <StepNav lang={lang} onBack={back} /> : null}
      </div>
    );
  } else if (isLayerStep(current)) {
    const slots = LAYER_SLOTS[current];
    const mmi = roleRule(ruleset, "progress-code")?.check;
    const mmiPhases = mmi?.type === "code-lookup" && (mmi.codes ?? []).some((c) => c.phase);
    const result = resultOf(current);
    // «Bruk» filled once any branch's sources answer for an element on the
    // loaded models (MAPPED), or no report is read to say otherwise.
    const layerLead = result.every(({ req }) => req === null) || slots.some((slot) => layerSplit(slot, result).some((s) => s.mapped > 0));
    // «Bruk»: every cascade of the step at the standard, with the project's
    // sources, if any, after it.
    const keep = () => {
      setKept((was) => new Set([...was, ...slots]));
      advanceLive();
    };
    // Each cascade in the mapping layout; one «Bruk» for the step. The
    // project's sources, once under «Avansert», are its OPTIONS' «Endre»;
    // nothing else was behind that door, so the step has none.
    body = (
      <div className="flex flex-col gap-4">
        {slots.map((slot) => (
          <LayerBranch
            key={`${current}\u0000${slot}`}
            slot={slot}
            to={
              slots.length > 1 ? (
                <ToZone as="h2" name={t(slot === "product" ? "field.product" : "field.material", lang)} />
              ) : (
                <ToZone name={stepLabel(current, lang)} />
              )
            }
            sources={layerSources(ruleset, slot)}
            accepted={phaseAccepted(ruleset)}
            picker={picker}
            issues={layerIssues(slot)}
            judge={layerJudge(slot, ruleset)}
            viaMmi={slot === "phase" && mmiPhases}
            results={result}
            lang={lang}
            onChange={(nextSources) => onChange(withLayerSources(ruleset, slot, nextSources))}
            kept={kept.has(slot) || layerSources(ruleset, slot).length > 0}
            onKeep={() =>
              setKept((was) => {
                const now = new Set(was);
                if (now.has(slot) && layerSources(ruleset, slot).length === 0) now.delete(slot);
                else now.add(slot);
                return now;
              })
            }
            onNext={keep}
          />
        ))}
        {/* The step's result as the report row has it: the figures the
            landed strip and the summary print. */}
        {result.some(({ req }) => req !== null) ? (
          <div data-result data-panel className={"flex flex-wrap items-center gap-3 " + PANEL}>
            <span className={LABEL}>{stepLabel(current, lang)}</span>
            <ReqResult results={result} lang={lang} />
          </div>
        ) : null}
        <StepConfirm lead={layerLead} label={t("action.apply", lang)} onClick={keep} />
        {slots.includes("material") ? (
          <Door label={t("setup.advanced", lang)}>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{t("field.pattern", lang)}</span>
              <span data-not-material className="flex flex-wrap gap-1.5">
                {NOT_A_MATERIAL.map((r) => (
                  <code key={r.source} className="bg-input px-2 py-0.5 font-mono text-[12px] text-ink">
                    {r.source}
                  </code>
                ))}
              </span>
            </div>
          </Door>
        ) : null}
      </div>
    );
  } else if (current === "storeys") {
    const saved = ruleset.storeys?.levels ?? [];
    // The saved levels when there are some, else the models' own.
    const levels = saved.length > 0 ? saved : fromModels;
    const plane = ruleset.storeys?.plane;
    const matched = fromModels.filter((l) => hasLevel(levels, l)).length;
    const figure = (
      <span className="flex items-baseline gap-2">
        <span className={LABEL}>{t("kpi.storeys", lang)}</span>
        <span className="font-mono text-[13px] tabular-nums text-ink">
          {fromModels.length > 0
            ? `${formatCount(matched, lang)} / ${formatCount(fromModels.length, lang)}`
            : formatCount(levels.length, lang)}
        </span>
      </span>
    );
    // The plane is a choice on the step; «Bruk» writes it with the levels
    // and moves on, as on every step (2026-10-05, review: OKFG / OKBD were
    // the confirm, in another place and style than every other step's).
    const chosen = planePick ?? plane ?? null;
    const take = () => {
      if (chosen === null) return;
      const setup = setupWithLevels(ruleset.storeys, levels);
      if (setup) setStoreys({ ...setup, plane: chosen });
      advanceLive();
    };
    body = (
      <div className="flex flex-col gap-4">
        <h1 className={H1}>{stepLabel("storeys", lang)}</h1>
        {levels.length > 0 ? (
          <div data-storeys className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1.618fr)_minmax(16rem,1fr)]">
            <div data-panel className={"flex min-w-0 flex-col gap-3 " + PANEL}>
              {figure}
              <div className="flex max-h-[38vh] flex-col overflow-auto border border-line bg-input py-1">
                {levels.map((level, i) => (
                  <div
                    key={`${i}\u0000${level.name}`}
                    data-storey={level.name}
                    className="grid items-center gap-3 px-3 py-1 text-[13px] text-ink [grid-template-columns:minmax(0,1fr)_7rem]"
                  >
                    <span className="min-w-0 truncate font-mono">{level.name}</span>
                    <span className="text-right font-mono tabular-nums text-muted">{formatMetres(level.elevation, lang)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div role="radiogroup" aria-label={t("field.plane", lang)} data-panel className={"flex flex-col gap-3 " + PANEL}>
              <span className={LABEL}>{t("field.plane", lang)}</span>
              <div className="flex flex-wrap gap-2">
                {PLANES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={p === chosen}
                    data-plane={p}
                    onClick={() => setPlanePick(p)}
                    className={
                      "flex min-h-12 min-w-28 items-center justify-center px-6 font-mono text-[17px] " +
                      (p === chosen
                        ? "border-2 border-ink bg-panel font-semibold text-ink"
                        : "border-2 border-transparent bg-panel text-ink outline-1 -outline-offset-2 outline-line hover:outline-green")
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div data-no-candidate className="flex items-center gap-3">
            <StateChip state="no-match" lang={lang} />
            <span className="text-[15px] text-ink">{t("setup.noMatch", lang)}</span>
          </div>
        )}
        <StepConfirm lead={levels.length === 0 || fromModels.length === 0 || matched > 0} disabled={chosen === null || levels.length === 0} label={t("action.apply", lang)} onClick={take} />
        <Door label={t("setup.advanced", lang)}>
          <div className="flex flex-col gap-4">
            <StoreyCard
              setup={ruleset.storeys}
              issues={lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys"))}
              lang={lang}
              onChange={setStoreys}
            />
            <TemplateButtons
              fileName={templateFileName(ruleset.name, "etasjer")}
              lang={lang}
              onDownload={async () => {
                const { writeLevelsXlsx } = await import("../ids/xlsx.ts");
                return writeLevelsXlsx(levelsTemplate(saved, fromModels), ruleset.storeys?.plane);
              }}
              onUpload={async (bytes) => {
                const { readLevelsXlsx } = await import("../ids/xlsx.ts");
                setStoreys(setupWithLevels(ruleset.storeys, readLevelsXlsx(bytes)));
              }}
            />
            {fromModels.length > 0 ? (
              <ModelStoreys
                fromModels={fromModels}
                levels={saved}
                lang={lang}
                onAdd={(extra) => setStoreys(setupWithLevels(ruleset.storeys, withLevels(saved, extra)))}
              />
            ) : null}
          </div>
        </Door>
      </div>
    );
  } else if (current === "tfm") {
    // Pre-picked: the saved rule, else the best property against the
    // standard, with the standard's sequence. A model that fits another
    // order is not guessed at: the default stays, and the counts show it.
    const top = tfmRanked[0];
    // Lokasjon's standard (POFIN Lokasjon system), with its real count, 0
    // included; pre-bound on a new rule when the models carry it.
    const lokStd = POFIN_SOURCES["lokasjon-system"].source as { property: { propertySet: string; name: string } };
    const lokStdN =
      picker.choices?.find((c) => c.set === lokStd.property.propertySet)?.props.find((p) => p.name === lokStd.property.name)
        ?.valued ?? 0;
    const draft: TfmDraft = tfmDraft ?? {
      source: tfmSaved?.source ?? (top ? { property: { propertySet: top.set, name: top.name } } : null),
      sequence: tfmSaved ? [...tfmSaved.sequence] : [...STATSBYGG_SEQUENCE],
      lokasjon: tfmSaved ? (tfmSaved.bindings?.Lokasjon ?? null) : lokStdN > 0 ? lokStd : null,
    };
    const update = (patch: Partial<TfmDraft>) => setTfmDraft({ ...draft, ...patch });
    const property = draft.source && "property" in draft.source ? draft.source.property : null;
    const prop = property
      ? picker.choices?.find((c) => c.set === property.propertySet)?.props.find((p) => p.name === property.name)
      : undefined;
    const lokasjonProp = draft.lokasjon && "property" in draft.lokasjon ? draft.lokasjon.property : null;
    const missing = property !== null && !prop && !picker.reading && picker.choices !== null;
    // What each chip is compared with: the step that reads it, as the
    // evaluator binds it (`evaluate.ts` PART_BINDING).
    const boundTo = (rule: ExtendedRule | null, step: SetupStep): ChipBinding => {
      if (!rule || rule.check.type !== "code-lookup") return { kind: "shape" };
      const source = rule.check.source;
      return {
        kind: "bound",
        label: "property" in source ? source.property.name : sourceText(source, lang),
        title: `${stepLabel(step, lang)} · ${sourceText(source, lang)}`,
      };
    };
    const binding = (part: TfmPart): ChipBinding | undefined => {
      switch (part) {
        case "Systemkode":
          return boundTo(roleRule(ruleset, "system-classification"), "system-classification");
        case "Komponent":
          return boundTo(roleRule(ruleset, "component-classification"), "component-classification");
        case "Etasje":
          return (ruleset.storeys?.levels.length ?? 0) > 0
            ? { kind: "bound", label: stepLabel("storeys", lang), title: stepLabel("storeys", lang) }
            : { kind: "shape" };
        case "Lokasjon":
          return draft.lokasjon
            ? { kind: "bound", label: lokasjonProp?.name ?? sourceText(draft.lokasjon, lang), title: sourceText(draft.lokasjon, lang) }
            : { kind: "shape" };
        case "Rom":
          return { kind: "shape" };
        default:
          return undefined;
      }
    };
    const clean = draft.sequence.filter((token) => !("text" in token) || token.text !== "");
    const ready = draft.source !== null && clean.some((token) => "part" in token);
    const confirmTfm = () => {
      if (!ready || draft.source === null) return;
      const check: TfmCheck = {
        type: "tfm",
        source: draft.source,
        sequence: clean,
        ...(draft.lokasjon ? { bindings: { Lokasjon: draft.lokasjon } } : {}),
      };
      const written: ExtendedRule = tfmRule
        ? { ...tfmRule, check }
        : { id: freshId(ruleset, "tfm"), kind: "extended", name: t("req.tfm", lang), select: { entity: { group: "physicalElement" } }, check };
      delete written.enabled;
      onChange({ ...ruleset, rules: tfmRule ? ruleset.rules.map((r) => (r === tfmRule ? written : r)) : [...ruleset.rules, written] });
      setTfmDraft(null);
      confirmStep(current);
      setLanded({ from: current, to: next, result: null, live: true });
      onStep(next);
    };
    const blankProperty = { propertySet: "", name: "" };
    // The mapping layout: FROM the draft's property, OPTIONS the ranked
    // candidates (the draft's own first when they lack it), the sequence
    // builder the requirement zone. A pick swaps the property and moves
    // nothing on: the sequence is half the answer. No standard source: the
    // TFM string is not RefCompOcc.
    const savedProp = tfmSaved && "property" in tfmSaved.source ? tfmSaved.source.property : null;
    const isProp = (p: { propertySet: string; name: string } | null, set: string, name: string) =>
      p !== null && p.propertySet === set && p.name === name;
    const savedTag = (set: string, name: string) => (isProp(savedProp, set, name) ? t("label.ruleset", lang) : null);
    const ranked = tfmRanked.slice(0, 4);
    const tfmOptions: MapOption[] = [
      ...(property && !ranked.some((c) => isProp(property, c.set, c.name))
        ? [
            {
              key: "draft",
              tag: savedTag(property.propertySet, property.name),
              title: `${property.propertySet}.${property.name}`,
              count: picker.choices ? <OptionCount n={prop?.n ?? 0} total={picker.total} current lang={lang} /> : null,
              current: true,
              onPick: () => {},
            },
          ]
        : []),
      ...ranked.map(
        (c): MapOption => ({
          key: `c\u0000${c.set}\u0000${c.name}`,
          tag: savedTag(c.set, c.name),
          title: `${c.set}.${c.name}`,
          count: <OptionCount n={c.prop.valued} total={picker.total} current={isProp(property, c.set, c.name)} lang={lang} />,
          current: isProp(property, c.set, c.name),
          onPick: () => update({ source: { property: { propertySet: c.set, name: c.name } } }),
        }),
      ),
    ];
    // The property tree only behind «Endre» (2026-10-05, review: open by
    // default it made the step a dead end); with nothing proposed «Endre»
    // leads instead.
    const tfmOpen = tfmEditing;
    // «Bruk» filled once the property's values take the sequence on the
    // loaded models, or none are read to say otherwise.
    const tfmPreview = prop ? previewTfm(clean, prop.values) : null;
    const tfmLead =
      draft.source !== null &&
      (picker.choices === null || picker.reading || (tfmPreview !== null && tfmPreview.rows.some((r) => r.state === "ok")));
    // The builder leads (2026-10-05, review): the string as parts, those the
    // earlier steps answered marked with what they read; the property that
    // carries the string is the mapping row under it.
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className={H1}>{stepLabel("tfm", lang)}</h1>
          <span data-to-form className="font-mono text-[16px] text-muted">
            {STATSBYGG_SEQUENCE.map(exampleText).join("")}
          </span>
        </div>
        <div data-tfm-panel data-panel className={"flex flex-col gap-4 " + PANEL}>
          <TfmBuilder
            sequence={draft.sequence}
            values={prop?.values ?? []}
            binding={binding}
            lokasjonChoices={[
              { set: lokStd.property.propertySet, name: lokStd.property.name, n: lokStdN, standard: true },
              ...(picker.choices && prop ? rankPartBindings(picker.choices, clean, prop.values, "Lokasjon") : []).filter(
                (b) => !(b.set === lokStd.property.propertySet && b.name === lokStd.property.name),
              ),
            ]}
            lokasjon={lokasjonProp ? { set: lokasjonProp.propertySet, name: lokasjonProp.name } : null}
            lokasjonEditor={
              <PropertyPicker
                value={lokasjonProp ?? blankProperty}
                choices={picker.choices}
                reading={picker.reading}
                errors={picker.errors}
                total={picker.total}
                invalidSet={false}
                invalidName={false}
                lang={lang}
                onChange={(p) => update({ lokasjon: p.propertySet === "" && p.name === "" ? null : { property: p } })}
                onNext={() => {}}
              />
            }
            lang={lang}
            onSequence={(sequence) => update({ sequence })}
            onLokasjon={(b) => update({ lokasjon: b ? { property: { propertySet: b.set, name: b.name } } : null })}
          />
          {/* VALID: the values off the sequence are the chip row's own. */}
          {prop && tfmPreview ? <Valid prop={prop} preview={tfmPreview} failing={false} total={picker.total} lang={lang} /> : null}
        </div>
        <MappingLayout
          lang={lang}
          to={<ToZone compact name={stepLabel("tfm", lang)} />}
          fromState={draft.source === null ? "empty" : missing ? "missing" : "found"}
          fromKey={property ? `${property.propertySet}\u0000${property.name}` : "tfm"}
          from={
            draft.source === null && picker.choices !== null && !picker.reading ? (
              // Nothing to propose: FROM says so itself.
              <div data-no-candidate className="flex items-center gap-3">
                <StateChip state="no-match" lang={lang} />
                <span className="text-[15px] text-ink">{t("setup.noMatch", lang)}</span>
              </div>
            ) : (
              <FromSource
                tag={property ? savedTag(property.propertySet, property.name) : null}
                title={property ? `${property.propertySet}.${property.name}` : draft.source ? sourceText(draft.source, lang) : null}
                samples={prop?.values.map((v) => v.v)}
                mapped={prop ? <Mapped n={prop.valued} total={picker.total} lang={lang} /> : missing ? <Mapped n={0} total={picker.total} lang={lang} /> : null}
              />
            )
          }
          options={
            <OptionList
              options={tfmOptions}
              label={stepLabel("tfm", lang)}
              lang={lang}
              more={{ open: tfmOpen, onToggle: () => setTfmEditing(!tfmOpen), lead: !tfmOpen && draft.source === null }}
            >
              {picker.reading ? <span className="text-[13px] text-muted">{t("file.parsing", lang)}</span> : null}
            </OptionList>
          }
          editor={
            tfmOpen ? (
              <div data-source-editor data-panel className={PANEL}>
                <PropertyPicker
                  value={property ?? blankProperty}
                  choices={picker.choices}
                  reading={picker.reading}
                  errors={picker.errors}
                  total={picker.total}
                  invalidSet={false}
                  invalidName={false}
                  lang={lang}
                  onChange={(p) => {
                    // Typing a set the models lack keeps the picker open.
                    setTfmEditing(true);
                    update({ source: p.propertySet === "" && p.name === "" ? null : { property: p } });
                  }}
                  onNext={() => {}}
                />
              </div>
            ) : null
          }
        />
        <StepConfirm lead={tfmLead} disabled={!ready} label={t("action.apply", lang)} onClick={confirmTfm} />
        <Door label={t("setup.advanced", lang)}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{t("field.pattern", lang)}</span>
              <code data-tfm-regex className="block bg-input px-2 py-1 font-mono text-[12px] break-all text-ink">
                {tfmRegexSource(clean)}
              </code>
            </div>
          </div>
        </Door>
      </div>
    );
  } else if (current === "type-name") {
    const rule = mappingRule(ruleset, "type-name");
    const saved = rule && rule.check.type === "type-name" ? rule.check.sequence : null;
    const confirmName = (sequence: NamePart[]) => {
      const check: TypeNameCheck = { type: "type-name", sequence };
      const written: ExtendedRule = rule
        ? { ...rule, check }
        : {
            id: freshId(ruleset, "type-name"),
            kind: "extended",
            name: t("check.type-name-placeholder", lang),
            select: { entity: { group: "physicalElement" } },
            check,
          };
      delete written.enabled;
      onChange({ ...ruleset, rules: rule ? ruleset.rules.map((r) => (r === rule ? written : r)) : [...ruleset.rules, written] });
      confirmStep(current);
      setLanded({ from: current, to: next, result: null, live: true });
      onStep(next);
    };
    body = (
      <div className="flex flex-col gap-4">
        <TypeNameStep
          key={saved ? JSON.stringify(saved) : "pofin"}
          name={stepLabel("type-name", lang)}
          saved={saved}
          typeNames={typeNames}
          written={rule && rule.enabled !== false ? resultOf("type-name") : null}
          source={typeSource}
          lang={lang}
          onConfirm={confirmName}
        />
      </div>
    );
  } else if (current === "end") {
    // The outcome: every requirement the walk set, once, on every model;
    // after «POFIN», its IFC schema too.
    const tally: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0, na: 0 };
    const keys = WALK.map((s) => STEP_REQ[s]).filter((k) => k !== undefined);
    for (const key of new Set(pofin && schema ? [...keys, "ifc-schema"] : keys)) {
      for (const { reqs } of results) {
        const req = reqs.find((r) => r.key === key);
        if (req) tally[stateLook(req.state, lang).verdict] += 1;
      }
    }
    body = (
      <div className="flex flex-col gap-4">
        <div data-panel className="border border-line bg-panel">
        <ol data-summary className="m-0 flex list-none flex-col p-0">
          {pofin ? (
            // The prompt's rows first, the same set and order, then the rest
            // of the walk under a heavier rule.
            <>
              {POFIN_ROLES.map((s) => stepRow(s, "end"))}
              {schemaRow}
              <li aria-hidden="true" className="h-0 border-t-2 border-ink" />
              {WALK.filter((s) => !(POFIN_ROLES as readonly SetupStep[]).includes(s)).map((s) => stepRow(s, "end"))}
            </>
          ) : (
            WALK.map((s) => stepRow(s, null))
          )}
        </ol>
        </div>
        {results.length > 0 ? (
          <div data-overall className="flex flex-wrap items-center gap-2">
            {(["pass", "warn", "fail", "na"] as const).map((v) =>
              tally[v] > 0 ? (
                <span
                  key={v}
                  title={t(`verdict.${v}`, lang)}
                  className={"inline-flex items-center gap-2 px-3 py-1 font-mono text-[15px] tabular-nums " + VERDICT_FILL[v]}
                >
                  <span aria-hidden="true">{VERDICT_GLYPH[v]}</span>
                  <span>{formatCount(tally[v], lang)}</span>
                </span>
              ) : null,
            )}
          </div>
        ) : null}
        <StepConfirm label={t("action.saveSetup", lang)} onClick={save} />
      </div>
    );
  } else {
    const r = current;
    const c = check ?? checkOf(rule, r);
    const confirmCandidate = (candidate: Candidate) => {
      const property = { propertySet: candidate.set, name: candidate.name };
      const classification = r === "system-classification" || r === "component-classification";
      setCheck(
        r,
        c.type === "code-lookup"
          ? {
              ...c,
              source: { property },
              ...(candidate.extract !== undefined ? { extract: candidate.extract } : {}),
              // A property is read per occurrence (`typeSubjects`).
              ...(classification && !("property" in c.source) ? { target: "occurrence" as const } : {}),
            }
          : { ...c, source: { property } },
      );
      advanceLive();
    };
    const confirmCurrent = (preview: ExtractPreview | null) => {
      if (rule !== null && rule.enabled === false) toggle(r);
      void preview;
      advanceLive();
    };
    // «Velg selv»: the source picked or typed, written as the source editor
    // wrote it. Type leads for an attribute (the type's Name is what the
    // evaluator can read on a type); a property or classification is read
    // per occurrence (`typeSubjects`).
    const confirmManual = (source: CodeSource) => {
      const classification = r === "system-classification" || r === "component-classification";
      const target = "attribute" in source ? ("type" as const) : ("occurrence" as const);
      setCheck(r, c.type === "code-lookup" && classification ? { ...c, source, target } : { ...c, source });
      advanceLive();
    };
    const ruleIssues = rule && rule.enabled !== false ? lint.filter((i) => i.ruleId === rule.id) : [];
    // What the value must be, as data: the list and three of its codes.
    const ownChips = (values: readonly string[]) =>
      values.slice(0, 3).map((v) => (
        <span key={v} className="max-w-48 truncate bg-input px-1.5 py-0.5 font-mono text-[12px] text-ink">
          {v}
        </span>
      ));
    let krav: { pill: string; chips: readonly string[]; more?: React.ReactNode; bad?: boolean };
    if (c.type === "copy-object") {
      krav =
        c.copy.length === 0 && c.own.length === 0
          ? { pill: t("tfm.none", lang), chips: [] }
          : c.copy.length === 0
            ? { pill: t("field.own", lang), chips: c.own.slice(0, 3) }
            : {
                pill: t("field.copy", lang),
                chips: c.copy.slice(0, 3),
                more:
                  c.own.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className={LABEL + " mr-2"}>{t("field.own", lang)}</span>
                      {ownChips(c.own)}
                    </span>
                  ) : undefined,
              };
    } else if (r === "progress-code") {
      const codes = c.codes ?? [];
      const preset = matchingPreset(codes);
      krav =
        codes.length === 0
          ? { pill: t("tfm.shapeOnly", lang), chips: patternParts(c.extract, lang) ?? [c.extract] }
          : { pill: preset ? presetName(preset) : "MMI", chips: codes.slice(0, 3).map((e) => e.code) };
    } else {
      const list = c.list ?? defaultCodeList(r === "component-classification" ? r : "system-classification");
      krav = { pill: CODE_LISTS[list].meta.label, chips: LIST_EXAMPLES[list] };
    }
    krav.bad = ruleIssues.some((i) => /\.check\.(list|codes|copy|own)(?=[.[]|$)/.test(i.path));
    body = (
      <MappingStep
        key={r}
        role={r}
        check={c}
        current={currentSource(rule, c, lang)}
        choices={picker.choices}
        reading={picker.reading}
        errors={picker.errors}
        total={picker.total}
        ownerNames={ownerNames}
        lang={lang}
        name={stepLabel(r, lang)}
        form={POFIN_SOURCES[ROLE_STANDARD[r]].example}
        pinned={pofin}
        krav={krav}
        requirement={
          <MappingRequirement role={r} check={c} issues={ruleIssues} lang={lang} onCheck={(nextCheck) => setCheck(r, nextCheck)} />
        }
        sourceIssues={
          <IssueLines
            issues={(rule ? lint.filter((i) => i.ruleId === rule.id) : []).filter((i) => /\.check\.source(?=[.[]|$)/.test(i.path))}
            lang={lang}
          />
        }
        onCandidate={confirmCandidate}
        onCurrent={confirmCurrent}
        onStandard={(option) => {
          setCheck(r, option.check);
          advanceLive();
        }}
        onManual={confirmManual}
      />
    );
    // Under the action row: what is neither the mapping nor the value
    // requirement, as before.
    after = (
      <Door label={t("setup.advanced", lang)}>
        <MappingCard
          key={r}
          role={r}
          rule={rule}
          issues={rule ? lint.filter((i) => i.ruleId === rule.id) : []}
          lang={lang}
          rulesetName={ruleset.name}
          picker={picker}
          onToggle={() => toggle(r)}
          onCheck={(nextCheck) => setCheck(r, nextCheck)}
          onAskEnable={() => setAsking(r)}
        />
      </Door>
    );
  }

  return (
    <ConfirmSlotProvider value={slot}>
    <main className="flex min-h-0 flex-1 flex-col">
      {/* The bar, pinned over the walk, in the frame's width. Not on the
          stage: no bar and no door before a model is loaded. */}
      {stage ? null : (
        <div className="shrink-0 px-3 pt-3">
          <div className={"mx-auto flex w-full items-center gap-4 " + FRAME}>
            {current === "start" || current === "pofin" ? (
              <div className="flex-1" />
            ) : (
              <WalkProgress
                steps={WALK}
                current={current === "end" ? null : current}
                state={segment}
                label={(s) => stepLabel(s, lang)}
                onStep={onStep}
              />
            )}
            {/* The file actions, one door: the ruleset's name and its three
                downloads, as the header had them. */}
            <Door label={t("action.download", lang)} float>
              <div className="flex flex-col items-start gap-3">
                <Field label={t("label.ruleset", lang)}>
                  <input
                    type="text"
                    className={INPUT + " w-64"}
                    aria-invalid={nameIssue && (nameTouched || attempted)}
                    value={ruleset.name}
                    onBlur={() => setNameTouched(true)}
                    onChange={(e) => onChange({ ...ruleset, name: e.target.value })}
                  />
                </Field>
                <button
                  type="button"
                  aria-disabled={blocked}
                  onClick={() => {
                    setAttempted(true);
                    if (!blocked) downloadRuleset(ruleset, fileName);
                  }}
                  className={downloadClass(blocked)}
                >
                  <span>{t("action.download", lang)}</span>
                  <span className="font-mono text-[11px]">{fileName}</span>
                </button>
                <button
                  type="button"
                  aria-disabled={blocked}
                  onClick={() => {
                    setAttempted(true);
                    if (blocked) return;
                    setExportError(null);
                    downloadXlsx(ruleset, xlsxName(fileName)).catch((error: unknown) =>
                      setExportError(error instanceof Error ? error.message : String(error)),
                    );
                  }}
                  className={downloadClass(blocked)}
                >
                  <span>{t("action.download", lang)}</span>
                  <span className="font-mono text-[11px]">{xlsxName(fileName)}</span>
                </button>
                <button
                  type="button"
                  aria-disabled={blocked || !hasIds}
                  onClick={() => {
                    setAttempted(true);
                    if (blocked || !hasIds) return;
                    setExportError(null);
                    downloadIds(ruleset, idsName(fileName)).catch((error: unknown) =>
                      setExportError(error instanceof Error ? error.message : String(error)),
                    );
                  }}
                  className={downloadClass(blocked || !hasIds)}
                >
                  <span>{t("action.download", lang)}</span>
                  <span className="font-mono text-[11px]">{idsName(fileName)}</span>
                </button>
              </div>
            </Door>
          </div>
        </div>
      )}

      {/* What the step before gave: a strip of its own height under the bar,
          held empty when there is none, so the step's name sits at the same
          place on every step (2026-10-05, review: it jumped). */}
      {stage ? null : (
        <div className="shrink-0 px-3 pt-2">
          <div data-landed-slot className={"mx-auto flex min-h-12 w-full flex-col justify-center " + FRAME}>
            {landed !== null && landed.to === current ? (
              <div className={role ? COLUMN : "w-full"}>
                <Landed key={landed.from} label={stepLabel(landed.from, lang)}>
                  {landed.live ? <TfmResult results={resultOf(landed.from)} lang={lang} /> : landed.result}
                </Landed>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* The step: one group in the frame (`FRAME`), its name at the top,
          its zones, and its actions right under them (2026-10-05, edkjo,
          live: "Still large distance between UI elements and navigation").
          The actions stick to the walk's foot only when the step is taller
          than the screen, so they stay in view while it scrolls. One gap
          (16 px) between every block. The IFC stage alone is centred (2 : 3
          above and below) and sizes to the walk's height (`STAGE_WIDTH`). */}
      <div data-walk className="min-h-0 flex-1 overflow-auto px-3 pb-3 [container-type:size] [scrollbar-gutter:stable_both-edges]">
        <div className={"mx-auto flex min-h-full w-full flex-col " + FRAME}>
          <div aria-hidden="true" className={stage ? "min-h-6 flex-[2_1_0%]" : "h-4 shrink-0"} />
          <div data-walk-content data-column={role ? "" : undefined} className={"flex min-w-0 flex-col gap-4" + (role ? " " + COLUMN : "")}>
            {exportError !== null ? (
              <pre className="m-0 bg-bad px-3 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
                {exportError}
              </pre>
            ) : null}

            <section aria-label={stepLabel(current, lang)} className="flex min-w-0 flex-col gap-4">
              {/* A step in the mapping layout carries its name in TO; the
                  IFC step's is in its target. */}
              {current === "start" || current === "ifc" || current === "storeys" || inTo ? null : (
                <h1 className={H1}>{stepLabel(current, lang)}</h1>
              )}
              {body}
            </section>

            {/* The step's actions: back on the left; «Hopp over» beside
                «Bruk» on the right, as a button of its own (the owner did
                not find it as grey text at the screen's foot). «Bruk» is the
                step's own (`StepConfirm`, portalled into `slot`). */}
            {stage || current === "start" ? null : (
              <div
                data-walk-actions
                // A panel like the step's own boxes (one treatment), so it
                // also covers what scrolls under it when it sticks.
                className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-3"
              >
                {footBack ? (
                  <button type="button" onClick={footBack} className="min-h-12 px-1 text-[15px] text-muted hover:text-ink">
                    ← {t("action.previous", lang)}
                  </button>
                ) : null}
                <span className="flex-1" />
                {footForward ? (
                  <button
                    type="button"
                    data-step-skip
                    onClick={skip}
                    className="flex min-h-12 items-center border border-line bg-panel px-6 text-[15px] text-ink hover:border-green hover:text-green"
                  >
                    {footForward}
                  </button>
                ) : null}
                <div ref={setSlot} data-confirm-slot className="flex flex-wrap items-center gap-3" />
              </div>
            )}
            {after}
          </div>
          {stage ? <div aria-hidden="true" className="min-h-6 flex-[3_1_0%]" /> : null}
        </div>
      </div>

      {asking ? (
        <EnableDialog
          title={stepLabel(asking, lang)}
          lang={lang}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const role = asking;
            setAsking(null);
            const rule = mappingRule(ruleset, role);
            // Only ever turns a card ON: it was off when the dialog opened.
            if (rule === null || rule.enabled === false) toggle(role);
          }}
        />
      ) : null}
    </main>
    </ConfirmSlotProvider>
  );
}
