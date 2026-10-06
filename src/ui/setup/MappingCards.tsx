/** A mapping step (Systemkode, Funksjonskode, MMI, Duplikat objekt) as three
 *  cards under its requirement (2026-10-05, edkjo: "I still dont see the UI
 *  with Requirement vs Default vs Manually map to what is in the model. Not a
 *  clear UI, and it's like you've cornered yourself in big boxes with bad
 *  content and lots of whitespace.").
 *
 *   the step's name, the POFIN form example beside it
 *   «Krav»  the code list (or MMI set, or Duplikat values) as a pill, three
 *           of its codes as chips; the pill opens the requirement's controls
 *   three cards, one row, radio semantics, each as tall as it holds:
 *     «Standard»           the POFIN source
 *     «Funnet i modellen»  the model's best candidate, two more as rows
 *     «Velg selv»          any property of the models, searched inline, or
 *                          one they lack typed in, or an attribute or
 *                          classification; a saved source that is neither
 *                          of the others opens here, tagged «Regelsett»
 *
 * Each card shows the same evidence: the source raw, elements carrying it of
 * the elements the rule selects («Fysiske elementer»), the distinct values
 * passing the requirement («Verdier»), five real values. A click on a card
 * selects it; only «Bruk» (the walk's foot, `StepConfirm`) writes it and
 * moves on.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lang, StringKey } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_FILL } from "../state-visuals";
import type { CodeSource } from "../../ids/types";
import type { ExtractPreview } from "../extract-preview";
import type { PsetChoice, PsetProp } from "../pset-choices";
import { StateChip } from "./chips";
import { INPUT } from "./ValuesInput";
import { LABEL, PANEL, STEP_TITLE, of } from "./Mapping";
import { StepConfirm, type CurrentSource } from "./Walk";
import {
  evidence,
  prePick,
  rankCandidates,
  standardOption,
  type Candidate,
  type CardRole,
  type MappingCheck,
  type StandardOption,
} from "./candidates";

/** A value as data: a sample of the source, an example of the list. */
const CHIP = "max-w-48 truncate bg-input px-1.5 py-0.5 font-mono text-[12px] text-ink";

/* ------------------------------------------------------------------ Krav */

/** The requirement, as data on one line: «Krav», the pill naming what the
 *  value must be (a code list, the MMI set, the copy values), three codes of
 *  it. The pill opens the requirement's controls in a panel over the page. */
export function KravLine({
  pill,
  chips,
  more,
  bad = false,
  lang,
  children,
}: {
  pill: string;
  chips: readonly string[];
  /** After the chips, on the same line (Duplikat objekt's own values). */
  more?: ReactNode;
  /** The requirement has lint errors: the pill is outlined red. */
  bad?: boolean;
  lang: Lang;
  /** The controls (`MappingRequirement`). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inside = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    // A press inside the panel, a dialog it opened included (React events
    // bubble through portals), keeps it; any other closes it.
    const down = () => {
      if (!inside.current) setOpen(false);
      inside.current = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div
      data-krav
      className="relative flex flex-wrap items-center gap-x-3 gap-y-2"
      onMouseDown={() => {
        inside.current = true;
      }}
    >
      <span className={LABEL}>{t("field.requirement", lang)}</span>
      <button
        type="button"
        data-krav-pill
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        className={
          "inline-flex min-h-8 items-center gap-2 border bg-input px-3 py-1 font-mono text-[13px] text-ink hover:border-green " +
          (bad ? "border-bad outline-2 -outline-offset-2 outline-bad" : "border-line")
        }
      >
        <span>{pill}</span>
        <span aria-hidden="true" className={"text-[10px] text-muted transition-transform motion-reduce:transition-none " + (open ? "rotate-180" : "")}>
          ▾
        </span>
      </button>
      {chips.length > 0 ? (
        <span data-krav-codes className="flex flex-wrap items-center gap-1">
          {chips.map((c) => (
            <span key={c} className={CHIP}>
              {c}
            </span>
          ))}
        </span>
      ) : null}
      {more}
      {open ? (
        <div
          id={id}
          data-krav-panel
          className="absolute top-full left-0 z-30 mt-2 max-h-[60vh] w-max max-w-[min(92vw,44rem)] overflow-auto border border-line bg-panel p-4 shadow-lg"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- cards */

/** What a card shows: the source and its evidence on the loaded models. */
interface Shown {
  /** Attributt, Klassifikasjon: a source that is not a property. */
  head?: string;
  /** The source raw, `Pset.Name`. */
  title: string;
  /** «Regelsett»: the ruleset's saved source. */
  tag: string | null;
  prop: PsetProp | undefined;
  preview: ExtractPreview | null;
  /** Elements carrying a value; null when it cannot be counted here. */
  hits: number | null;
  error: string | null;
}

type CardKey = "standard" | "model" | "manual";

/** One card: a radio, outlined when selected (the one selection outline,
 *  `outline-ink`); a click anywhere in it selects it. */
function Card({
  k,
  label,
  tag,
  selected,
  disabled = false,
  onSelect,
  aside,
  children,
}: {
  k: CardKey;
  label: string;
  tag?: string | null;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Right of the card's name (Velg selv: the source kind). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-card={k}
      data-selected={selected}
      data-panel
      onClick={() => {
        if (!disabled && !selected) onSelect();
      }}
      className={
        "flex min-w-0 flex-col gap-3 " +
        PANEL +
        (selected ? " outline-2 -outline-offset-2 outline-ink" : disabled ? "" : " cursor-pointer hover:outline-1 hover:-outline-offset-1 hover:outline-green")
      }
    >
      {/* One height for every card's head, the source kind's select
          included, so the three names sit on one line. */}
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="flex min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed"
        >
          <span
            aria-hidden="true"
            className={"flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 " + (disabled ? "border-muted/50" : "border-ink")}
          >
            {selected ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
          </span>
          <span className={LABEL + (disabled ? " opacity-60" : "")}>{label}</span>
          {tag ? <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">{tag}</span> : null}
        </button>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** A card's evidence: the source, the two counts, five values. */
function Evidence({
  shown,
  total,
  absentOk,
  unknown,
  lang,
}: {
  shown: Shown;
  total: number | null;
  /** Duplikat objekt: no property is no fault, its 0 is not red. */
  absentOk: boolean;
  /** No count to give yet (no model, psets being read). */
  unknown: boolean;
  lang: Lang;
}) {
  const n = shown.prop ? shown.prop.valued : !unknown && shown.hits === 0 ? 0 : null;
  // No values, nothing to pass: «Verdier 0 / 0» says nothing.
  const ok =
    shown.preview && shown.prop && shown.prop.distinct > 0 ? shown.preview.rows.filter((r) => r.state === "ok").length : null;
  const figure = (value: string, bad: boolean) => (
    <span className={"w-fit px-1 font-mono text-[13px] tabular-nums " + (bad ? VERDICT_FILL.fail : "text-ink")}>{value}</span>
  );
  return (
    <>
      <div data-source className="font-mono text-[14px] leading-snug [overflow-wrap:anywhere] text-ink">
        {shown.head ? <span className="text-muted">{shown.head} </span> : null}
        {shown.title || "–"}
      </div>
      {n !== null || (ok !== null && shown.prop) ? (
        <div data-counts className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
          {n !== null ? (
            <>
              <span className={LABEL}>{t("walk.selected", lang)}</span>
              {figure(of(n, total, lang), n === 0 && !absentOk)}
            </>
          ) : null}
          {ok !== null && shown.prop ? (
            <>
              <span className={LABEL}>{t("field.values", lang)}</span>
              {figure(
                `${formatCount(ok, lang)} / ${shown.prop.exact ? "" : "≥"}${formatCount(shown.prop.distinct, lang)}`,
                ok === 0 && shown.prop.distinct > 0,
              )}
            </>
          ) : null}
        </div>
      ) : null}
      {shown.prop && shown.prop.values.length > 0 ? (
        <span data-samples className="flex flex-wrap gap-1">
          {shown.prop.values.slice(0, 5).map((v) => (
            <span key={v.v} className={CHIP}>
              {v.v}
            </span>
          ))}
        </span>
      ) : null}
      {shown.error !== null ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{shown.error}</pre>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ Velg selv */

const KINDS = ["property", "attribute", "classification"] as const;
type Kind = (typeof KINDS)[number];

const kindOf = (s: CodeSource): Kind => ("attribute" in s ? "attribute" : "classification" in s ? "classification" : "property");

const blank = (kind: Kind): CodeSource =>
  kind === "attribute"
    ? { attribute: "" }
    : kind === "classification"
      ? { classification: {} }
      : { property: { propertySet: "", name: "" } };

/** A source typed or picked to completion: «Bruk» can write it. */
const complete = (s: CodeSource) =>
  "property" in s
    ? s.property.propertySet.trim() !== "" && s.property.name.trim() !== ""
    : "attribute" in s
      ? s.attribute.trim() !== ""
      : "classification" in s;

/** Every property of the loaded models, filtered as typed, inline: the list
 *  shows while the field has focus. ↑ ↓ move, Enter picks, Escape clears.
 *  Its last row is the way to a property the models lack. */
function PropertySearch({
  choices,
  reading,
  lang,
  onPick,
  onNotInModel,
  onFocus,
}: {
  choices: PsetChoice[] | null;
  reading: boolean;
  lang: Lang;
  onPick: (set: string, name: string) => void;
  onNotInModel: () => void;
  onFocus: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const q = query.trim().toLowerCase();
  const groups = (choices ?? [])
    .map((c) =>
      q === "" || c.set.toLowerCase().includes(q) ? c : { ...c, props: c.props.filter((p) => p.name.toLowerCase().includes(q)) },
    )
    .filter((c) => c.props.length > 0);
  type Option = { kind: "prop"; set: string; name: string } | { kind: "manual" };
  const options: Option[] = [
    ...groups.flatMap((c) => c.props.map((p): Option => ({ kind: "prop", set: c.set, name: p.name }))),
    { kind: "manual" },
  ];
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, c) => n + c.props.length, 0));
  const at = Math.min(active, options.length - 1);
  const optionId = (i: number) => `${baseId}-o${i}`;
  const pick = (option: Option) => {
    setQuery("");
    setActive(-1);
    setOpen(false);
    if (option.kind === "prop") onPick(option.set, option.name);
    else onNotInModel();
  };
  useEffect(() => {
    const list = listRef.current;
    const el = at >= 0 ? document.getElementById(optionId(at)) : null;
    if (!list || !el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  });
  const row = (i: number) =>
    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1 text-[12px] text-ink " + (i === at ? "bg-input" : "hover:bg-input");
  return (
    <div data-search className="flex flex-col border border-line bg-input">
      <div className="flex items-center gap-2 px-3 py-2">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-muted">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-label={t("field.source.property", lang)}
          aria-expanded={open}
          aria-controls={`${baseId}-list`}
          aria-activedescendant={open && at >= 0 ? optionId(at) : undefined}
          value={query}
          onFocus={() => {
            setOpen(true);
            onFocus();
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive(Math.min(at + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(at - 1, 0));
            } else if (e.key === "Enter" && open && at >= 0) {
              e.preventDefault();
              pick(options[at]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (query !== "") setQuery("");
              else setOpen(false);
              setActive(-1);
            }
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
        />
        {reading ? <span className="shrink-0 text-[11px] text-muted">{t("file.parsing", lang)}</span> : null}
      </div>
      {open && choices !== null ? (
        <div ref={listRef} id={`${baseId}-list`} role="listbox" data-search-list className="relative max-h-60 overflow-auto border-t border-line py-1">
          {groups.map((c, g) => (
            <div key={c.set} role="group" aria-label={c.set}>
              <div className="flex items-baseline justify-between gap-3 px-3 pt-1.5 pb-0.5">
                <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-muted">{c.set}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{formatCount(c.objects, lang)}</span>
              </div>
              {c.props.map((p, k) => {
                const i = starts[g] + k;
                return (
                  <div
                    key={p.name}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === at}
                    // Keeps focus in the field until the pick.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick({ kind: "prop", set: c.set, name: p.name })}
                    className={row(i) + " pl-6"}
                  >
                    <span className="min-w-0 truncate font-mono">{p.name}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted">{formatCount(p.valued, lang)}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div
            id={optionId(options.length - 1)}
            role="option"
            aria-selected={at === options.length - 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick({ kind: "manual" })}
            className={row(options.length - 1) + (groups.length > 0 ? " mt-1 border-t border-line" : "")}
          >
            <span>{t("field.notInModel", lang)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A labelled field of the hand-typed source. */
function Typed({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <input type="text" className={INPUT + " w-full"} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ----------------------------------------------------------------- step */

/** One answer the model offers, as card b lists it. */
interface ModelAnswer {
  key: string;
  candidate: Candidate;
  /** The ruleset's saved source: «Bruk» keeps it as it is. */
  saved: boolean;
  shown: Shown;
}

const sourceKey = (s: CurrentSource) => (s.kind === "property" ? `p\u0000${s.set}\u0000${s.name}` : `o\u0000${s.head}\u0000${s.title}`);

export function MappingStep({
  role,
  check,
  current,
  choices,
  reading,
  errors,
  total,
  ownerNames,
  lang,
  name,
  form,
  krav,
  requirement,
  sourceIssues,
  onCandidate,
  onCurrent,
  onStandard,
  onManual,
  pinned = false,
}: {
  role: CardRole;
  check: MappingCheck;
  /** The source the ruleset holds; null when it holds none. */
  current: CurrentSource | null;
  choices: PsetChoice[] | null;
  reading: boolean;
  /** The pset inventory's read errors, per model. */
  errors: readonly string[];
  total: number | null;
  ownerNames: readonly string[];
  lang: Lang;
  /** The step's name, and the standard's example of the value (2341.001). */
  name: string;
  form?: string;
  /** The requirement as data: the pill's text, three of its codes. */
  krav: { pill: string; chips: readonly string[]; more?: ReactNode; bad?: boolean };
  /** The requirement's controls, opened from the pill. */
  requirement: ReactNode;
  /** The written rule's source issues, under the cards. */
  sourceIssues?: ReactNode;
  onCandidate: (candidate: Candidate) => void;
  /** «Bruk» on the saved source, as it is. */
  onCurrent: (preview: ExtractPreview | null) => void;
  /** «Bruk» on the standard: writes its source (and Uttrekk). */
  onStandard: (option: StandardOption) => void;
  /** «Bruk» on a source picked or typed in «Velg selv». */
  onManual: (source: CodeSource) => void;
  /** The saved source is the answer whatever the models carry: a POFIN
   *  template being reviewed opens every step on POFIN's. */
  pinned?: boolean;
}) {
  // The source the step opened on: a different one now was set here.
  const [opened] = useState(() => (current ? sourceKey(current) : null));
  // The card selected, the model card's pick and the hand-picked source;
  // null: the pre-pick. Dropped when the rule's source changes under them
  // (the «Avansert» door writes it).
  const [chosen, setChosen] = useState<CardKey | null>(null);
  const [modelKey, setModelKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<CodeSource | null>(null);
  const [typing, setTyping] = useState(false);
  const nowKey = current ? sourceKey(current) : null;
  const [seenKey, setSeenKey] = useState(nowKey);
  if (seenKey !== nowKey) {
    setSeenKey(nowKey);
    setChosen(null);
    setModelKey(null);
    setDraft(null);
    setTyping(false);
  }

  const candidates = useMemo(
    () => (choices ? rankCandidates(choices, role, check, ownerNames) : []),
    [choices, role, check, ownerNames],
  );
  const standard = useMemo(() => standardOption(role, check, choices, ownerNames), [role, check, choices, ownerNames]);
  const unknown = reading || choices === null;
  const absentOk = role === "copy-object";
  const find = (set: string, prop: string) => choices?.find((c) => c.set === set)?.props.find((p) => p.name === prop);
  const judge = (prop: PsetProp | undefined): { preview: ExtractPreview | null; error: string | null } => {
    if (!prop) return { preview: null, error: null };
    try {
      return { preview: evidence(check, role, prop, ownerNames), error: null };
    } catch (err) {
      return { preview: null, error: err instanceof Error ? err.message : String(err) };
    }
  };

  // The saved source, as the rule holds it.
  const savedIsStandard = current?.kind === "property" && current.set === standard.set && current.name === standard.name;
  const savedProp = current?.kind === "property" ? find(current.set, current.name) : undefined;
  const savedJudged = judge(savedProp);
  const savedShown: Shown | null =
    current === null
      ? null
      : {
          head: current.kind === "property" ? undefined : current.head,
          title: current.kind === "property" ? `${current.set}.${current.name}` : current.title,
          tag: t("label.ruleset", lang),
          prop: savedProp,
          preview: savedJudged.preview,
          hits: current.kind === "property" ? (savedProp?.valued ?? 0) : null,
          error: savedJudged.error,
        };

  // a. The standard. The saved rule reading it keeps its own Uttrekk.
  const stdShown: Shown = {
    title: `${standard.set}.${standard.name}`,
    tag: savedIsStandard ? t("label.ruleset", lang) : null,
    prop: standard.prop,
    preview: savedIsStandard && savedShown ? savedShown.preview : standard.preview,
    hits: standard.hits,
    error: savedIsStandard && savedShown ? savedShown.error : null,
  };

  // b. The model's candidates, the standard left out; the saved source is
  // one of them when it ranks.
  const models: ModelAnswer[] = candidates
    .filter((c) => !(c.set === standard.set && c.name === standard.name))
    .slice(0, 3)
    .map((c) => {
      const saved = current?.kind === "property" && c.set === current.set && c.name === current.name;
      return {
        key: `${c.set}\u0000${c.name}`,
        candidate: c,
        saved,
        shown:
          saved && savedShown
            ? savedShown
            : { title: `${c.set}.${c.name}`, tag: null, prop: c.prop, preview: c.preview, hits: c.prop.valued, error: null },
      };
    });
  const savedModel = models.findIndex((m) => m.saved);
  // c. A saved source that is neither the standard nor a candidate.
  const savedManual = current !== null && !savedIsStandard && savedModel < 0;

  // The pre-pick (`prePick`): the saved source when the models carry it,
  // else the standard when they do, else a strong candidate.
  const setHere = current !== null && (pinned || opened !== sourceKey(current));
  const strong = models.filter((m, i) => m.candidate.strong && i !== savedModel).length;
  const pick = prePick(standard.hits, savedShown ? { hits: savedShown.hits, chosen: setHere } : null, strong);
  const preCard: CardKey =
    pick === "saved" ? (savedIsStandard ? "standard" : savedModel >= 0 ? "model" : "manual") : pick === "candidate" ? "model" : "standard";
  const preModel = Math.max(0, pick === "candidate" ? models.findIndex((_, i) => i !== savedModel) : savedModel);
  const selected = chosen ?? preCard;
  const modelAt = Math.max(0, modelKey !== null ? models.findIndex((m) => m.key === modelKey) : preModel);
  const model = models[modelAt] ?? null;

  // c. What «Velg selv» holds: the hand-picked source, else the saved one
  // that no other card shows.
  const manualSource: CodeSource | null = draft ?? (savedManual ? check.source : null);
  const manualKind = manualSource ? kindOf(manualSource) : "property";
  let manualShown: Shown | null = null;
  if (draft === null && savedManual && savedShown) manualShown = savedShown;
  else if (draft !== null && "property" in draft && complete(draft)) {
    const prop = find(draft.property.propertySet, draft.property.name);
    const judged = judge(prop);
    manualShown = {
      title: `${draft.property.propertySet}.${draft.property.name}`,
      tag: null,
      prop,
      preview: judged.preview,
      hits: prop?.valued ?? 0,
      error: judged.error,
    };
  }
  const showTyped = typing;

  const shown: Shown | null = selected === "standard" ? stdShown : selected === "model" ? (model?.shown ?? null) : manualShown;
  const confirm = (): void => {
    if (selected === "standard") {
      if (savedIsStandard && savedShown) onCurrent(savedShown.preview);
      else onStandard(standard);
    } else if (selected === "model" && model) {
      if (model.saved) onCurrent(model.shown.preview);
      else onCandidate(model.candidate);
    } else if (selected === "manual") {
      if (draft === null && savedManual) onCurrent(savedShown?.preview ?? null);
      else if (draft !== null && complete(draft)) onManual(draft);
    }
  };
  const ready =
    selected === "standard" ||
    (selected === "model" && model !== null) ||
    (selected === "manual" && ((draft === null && savedManual) || (draft !== null && complete(draft))));
  // «Bruk» leads while the answer has hits on the loaded models (mapping is
  // the infrastructure: Verdier does not decide this).
  const lead = unknown || absentOk || (shown?.hits ?? null) !== 0;

  const setManual = (next: CodeSource) => {
    setDraft(next);
    setChosen("manual");
  };

  return (
    <div data-mapping-cards className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className={STEP_TITLE}>{name}</h1>
          {form ? <span data-to-form className="font-mono text-[16px] text-muted">{form}</span> : null}
        </div>
        <KravLine pill={krav.pill} chips={krav.chips} more={krav.more} bad={krav.bad} lang={lang}>
          {requirement}
        </KravLine>
      </div>

      <div role="radiogroup" aria-label={name} data-cards className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
        <Card k="standard" label={t("setup.standard", lang)} tag={stdShown.tag} selected={selected === "standard"} onSelect={() => setChosen("standard")}>
          <Evidence shown={stdShown} total={total} absentOk={absentOk} unknown={unknown} lang={lang} />
        </Card>

        <Card
          k="model"
          label={t("setup.foundInModel", lang)}
          tag={model?.saved ? model.shown.tag : null}
          selected={selected === "model"}
          disabled={model === null}
          onSelect={() => setChosen("model")}
        >
          {model ? (
            <>
              <Evidence shown={model.shown} total={total} absentOk={absentOk} unknown={unknown} lang={lang} />
              {models.length > 1 ? (
                <div data-more-candidates className="flex flex-col border-t border-line pt-2">
                  {models.map((m, i) =>
                    i === modelAt ? null : (
                      <button
                        key={m.key}
                        type="button"
                        data-candidate-row={m.key}
                        onClick={(event) => {
                          event.stopPropagation();
                          setModelKey(m.key);
                          setChosen("model");
                        }}
                        className="flex w-full min-w-0 items-baseline justify-between gap-3 py-1 text-left font-mono text-[12px] text-ink hover:text-green"
                      >
                        <span className="min-w-0 [overflow-wrap:anywhere]">{m.shown.title}</span>
                        <span className={"shrink-0 tabular-nums " + (m.shown.hits === 0 && !absentOk ? VERDICT_FILL.fail + " px-1" : "text-muted")}>
                          {of(m.shown.hits ?? 0, total, lang)}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </>
          ) : reading || choices === null ? (
            <span className="text-[13px] text-muted">{reading ? t("file.parsing", lang) : "–"}</span>
          ) : (
            <span data-no-candidate className="flex items-center gap-2">
              <StateChip state="no-match" lang={lang} />
              <span className="text-[14px] text-ink">{t("setup.noMatch", lang)}</span>
            </span>
          )}
        </Card>

        <Card
          k="manual"
          label={t("setup.chooseSelf", lang)}
          tag={manualShown?.tag ?? null}
          selected={selected === "manual"}
          onSelect={() => setChosen("manual")}
          aside={
            <select
              aria-label={t("field.source", lang)}
              value={manualKind}
              onClick={(event) => event.stopPropagation()}
              onChange={(e) => {
                setTyping(false);
                setManual(blank(e.target.value as Kind));
              }}
              className={INPUT + " h-7 max-w-32 py-0 font-sans"}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`field.source.${k}` as StringKey, lang)}
                </option>
              ))}
            </select>
          }
        >
          {manualKind === "property" ? (
            <PropertySearch
              choices={choices}
              reading={reading}
              lang={lang}
              onFocus={() => setChosen("manual")}
              onPick={(set, prop) => {
                setTyping(false);
                setManual({ property: { propertySet: set, name: prop } });
              }}
              onNotInModel={() => {
                setTyping(true);
                setManual(
                  manualSource && "property" in manualSource ? manualSource : { property: { propertySet: "", name: "" } },
                );
              }}
            />
          ) : null}
          {manualSource && "property" in manualSource && showTyped ? (
            <div className="flex min-w-0 flex-wrap gap-3">
              <Typed
                label={t("field.propertySet", lang)}
                value={manualSource.property.propertySet}
                onChange={(v) => setManual({ property: { ...manualSource.property, propertySet: v } })}
              />
              <Typed
                label={t("field.propertyName", lang)}
                value={manualSource.property.name}
                onChange={(v) => setManual({ property: { ...manualSource.property, name: v } })}
              />
            </div>
          ) : null}
          {manualSource && "attribute" in manualSource ? (
            draft === null && manualShown ? (
              <Evidence shown={manualShown} total={total} absentOk={absentOk} unknown={unknown} lang={lang} />
            ) : (
              <Typed label={t("field.source.attribute", lang)} value={manualSource.attribute} onChange={(v) => setManual({ attribute: v })} />
            )
          ) : null}
          {manualSource && "classification" in manualSource ? (
            draft === null && manualShown ? (
              <Evidence shown={manualShown} total={total} absentOk={absentOk} unknown={unknown} lang={lang} />
            ) : (
              <Typed
                label={t("field.system", lang)}
                value={manualSource.classification.system ?? ""}
                onChange={(v) => setManual({ classification: v === "" ? {} : { system: v } })}
              />
            )
          ) : null}
          {manualShown && manualSource && "property" in manualSource ? (
            <Evidence shown={manualShown} total={total} absentOk={absentOk} unknown={unknown} lang={lang} />
          ) : null}
          {errors.length > 0 ? (
            <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{errors.join("\n")}</pre>
          ) : null}
        </Card>
      </div>
      {sourceIssues}
      <StepConfirm lead={lead} disabled={!ready} label={t("action.apply", lang)} onClick={confirm} />
    </div>
  );
}
