/** The walk's own pieces (2026-10-05): the progress bar, the proposal card
 *  with its evidence, the alternatives, the landed result, the step's way
 *  on and back, and the door every config control sits behind.
 *
 * edkjo: "Too many clicks and options/traces from the original basic config
 * page. Didn't get the full conversion to the super intuitive pull-me-through
 * modern dopamine and gamified onboarding." So a step is one question: the
 * model's best answer pre-picked with what it gives on the loaded model,
 * confirmed by one click that also moves on. The reward is the real result
 * landing and the bar moving, never a badge or a score of our own. The old
 * step bodies (`SetupPage.tsx`) are the «Avansert» door's contents, whole.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_FILL } from "../state-visuals";
import type { PsetChoice, PsetProp } from "../pset-choices";
import type { ExtractPreview } from "../extract-preview";
import type { Requirement } from "../requirements";
import { figures, stateLook } from "../alt/req-view";
import { StateChip, TotalChips } from "./chips";
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

/** The bar: one segment per step, filled once the step is done, the current
 *  one dark; a segment is the jump to its step. Beside it, where the walk is,
 *  `n / N`. */
export function WalkProgress<S extends string>({
  steps,
  current,
  done,
  label,
  onStep,
}: {
  steps: readonly S[];
  /** null: past the last step (the summary). */
  current: S | null;
  done: (step: S) => boolean;
  label: (step: S) => string;
  onStep: (step: S) => void;
}) {
  const at = current === null ? steps.length : steps.indexOf(current) + 1;
  return (
    <nav data-walk-progress className="flex min-w-0 flex-1 items-center gap-3">
      <ol className="m-0 flex min-w-0 flex-1 list-none gap-1 p-0">
        {steps.map((step) => {
          const here = step === current;
          const ok = done(step);
          return (
            <li key={step} className="min-w-0 flex-1">
              <button
                type="button"
                title={label(step)}
                aria-label={label(step)}
                aria-current={here ? "step" : undefined}
                data-done={ok}
                onClick={() => onStep(step)}
                className="group block w-full py-2"
              >
                <span
                  className={
                    "block h-1.5 w-full transition-colors duration-500 motion-reduce:transition-none " +
                    (ok ? "bg-green" : here ? "bg-ink" : "bg-line group-hover:bg-muted")
                  }
                />
              </button>
            </li>
          );
        })}
      </ol>
      <span data-walk-count className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
        {at} / {steps.length}
      </span>
    </nav>
  );
}

/** One door: closed by default, everything the step used to show behind it.
 *  `float` opens it as a panel over the page (the header's file door), so
 *  the bar beside it keeps its row. */
export function Door({ label, float = false, children }: { label: string; float?: boolean; children: ReactNode }) {
  return (
    <details data-door className={"group" + (float ? " relative shrink-0" : "")}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-1 text-[13px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
        {label}
      </summary>
      <div
        className={
          float
            ? "absolute top-full right-0 z-20 mt-2 w-max max-w-[min(92vw,34rem)] border border-line bg-panel p-4 shadow-lg"
            : "mt-3"
        }
      >
        {children}
      </div>
    </details>
  );
}

function Figure({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">{label}</span>
      <span className={"px-1 font-mono text-[13px] tabular-nums " + (bad ? VERDICT_FILL.fail : "text-ink")}>{value}</span>
    </span>
  );
}

const of = (part: number, whole: number | null, lang: Lang) =>
  whole === null ? formatCount(part, lang) : `${formatCount(part, lang)} / ${formatCount(whole, lang)}`;

/** A property's evidence: the elements carrying it of the models' products,
 *  the distinct values passing of its distinct values, and the elements per
 *  state of the step's check. */
export function Evidence({
  prop,
  preview,
  total,
  lang,
}: {
  prop: PsetProp;
  preview: ExtractPreview;
  total: number | null;
  lang: Lang;
}) {
  const listed = prop.values.reduce((n, v) => n + v.n, 0);
  const okValues = preview.rows.filter((r) => r.state === "ok").length;
  return (
    <div data-evidence className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Figure label={t("kpi.products", lang)} value={of(prop.n, total, lang)} />
      <Figure
        label={t("field.values", lang)}
        value={`${formatCount(okValues, lang)} / ${prop.exact ? "" : "≥"}${formatCount(prop.distinct, lang)}`}
      />
      <TotalChips preview={preview} rest={Math.max(0, prop.valued - listed)} lang={lang} />
    </div>
  );
}

/** The step's answer: what the source is, its evidence, and «Bruk», which
 *  takes it and moves on. Red when the models lack it, with the count that
 *  says so. Keyed by the caller, so a new answer lands as one. */
export function ProposalCard({
  head,
  title,
  missing = false,
  confirm,
  onConfirm,
  actions,
  children,
}: {
  head?: string;
  title?: string;
  missing?: boolean;
  confirm?: string;
  onConfirm?: () => void;
  /** In place of «Bruk», where the answer is one of several (a plane). */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      data-proposal={missing ? "missing" : "found"}
      className={"pick-in flex flex-col gap-4 border-2 bg-panel p-5 " + (missing ? "border-bad" : "border-green")}
    >
      {head || title ? (
        <div className="flex min-w-0 flex-col gap-1">
          {head ? <span className="truncate font-mono text-[12px] text-muted">{head}</span> : null}
          {title ? <span className="text-2xl leading-tight font-medium [overflow-wrap:anywhere] text-ink">{title}</span> : null}
        </div>
      ) : null}
      {children}
      {actions ?? (
        <button type="button" autoFocus data-step-confirm onClick={onConfirm} className={CONFIRM + " sm:self-end"}>
          {confirm} →
        </button>
      )}
    </div>
  );
}

/** The step's one primary: large, filled, the way on. */
export const CONFIRM =
  "flex min-h-12 items-center justify-center gap-3 bg-green px-8 text-[15px] font-medium text-cream hover:bg-ink";

/** The next candidates, each one click from being the answer. */
export function Alternatives({
  candidates,
  lang,
  onPick,
}: {
  candidates: readonly Candidate[];
  lang: Lang;
  onPick: (candidate: Candidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul data-alternatives className="m-0 flex list-none flex-col gap-1 p-0">
      {candidates.map((c) => (
        <li key={`${c.set}\u0000${c.name}`}>
          <button
            type="button"
            data-alternative
            onClick={() => onPick(c)}
            className="flex w-full items-center gap-3 border border-line bg-panel px-4 py-2 text-left hover:border-green"
          >
            <span className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere] text-ink">
              {c.set}.{c.name}
            </span>
            <TotalChips preview={c.preview} lang={lang} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Back, and the way on without an answer. */
export function StepNav({
  lang,
  onBack,
  forward,
  onForward,
}: {
  lang: Lang;
  onBack?: () => void;
  forward?: string;
  onForward?: () => void;
}) {
  return (
    <div data-step-nav className="flex items-center gap-4">
      {onBack ? (
        <button type="button" onClick={onBack} className="px-1 py-2 text-[13px] text-muted hover:text-ink">
          ← {t("action.previous", lang)}
        </button>
      ) : null}
      {forward && onForward ? (
        <button type="button" data-step-skip onClick={onForward} className="ml-auto px-1 py-2 text-[13px] text-muted hover:text-ink">
          {forward}
        </button>
      ) : null}
    </div>
  );
}

/** What the step just confirmed gave, under the bar on the next step. */
export function Landed({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div data-landed className="pick-in flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-2">
      <span aria-hidden="true" className="text-green">
        ✓
      </span>
      <span className="text-[13px] text-ink">{label}</span>
      {children}
    </div>
  );
}

/** A requirement's result on each model, as the IDS tab reads it: the state
 *  and the figure of its report row. The model's name is the title. */
export function ReqResult({
  results,
  lang,
}: {
  results: readonly { model: string; req: Requirement | null }[];
  lang: Lang;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {results.map(({ model, req }) => {
        if (req === null) return null;
        const look = stateLook(req.state, lang);
        const f = figures(req, lang);
        return (
          <span key={model} title={model} data-req-result={req.state} className="inline-flex items-center gap-2">
            <span className={"inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[12px] " + VERDICT_FILL[look.verdict]}>
              <span aria-hidden="true">{look.glyph}</span>
              <span>{look.word}</span>
            </span>
            {f ? (
              <span className="font-mono text-[12px] tabular-nums text-muted">
                {f.figure}
                {f.of ? ` · ${f.of}` : ""}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** The source a mapping rule holds now, as the step shows it: a property
 *  (found in the models or not), or an attribute or classification. */
export type CurrentSource =
  | { kind: "property"; set: string; name: string }
  | { kind: "other"; head: string; title: string };

/** One answer of a mapping step, in the order the step lists them. */
type Answer = {
  key: string;
  /** «Standard», «Regelsett», or none (a model candidate). */
  tag: string | null;
  head: string;
  title: string;
  prop: PsetProp | undefined;
  preview: ExtractPreview | null;
  /** Elements carrying a value; null when it cannot be counted here. */
  hits: number | null;
  error: string | null;
  onConfirm: () => void;
};

const sourceKey = (s: CurrentSource) => (s.kind === "property" ? `p\u0000${s.set}\u0000${s.name}` : `o\u0000${s.head}\u0000${s.title}`);

/** A mapping step's question (2026-10-05, edkjo: "You're assuming that all
 *  projects use RefClass_NS3451 etc as in KNM … suggest the standard as in
 *  POFIN"). Listed in one order: the standard, the ruleset's saved source,
 *  the model's candidates. The pre-picked one (`prePick`) is the card with
 *  «Bruk»; every other is one click from being the answer. The source itself
 *  is changed here too, by «Endre» (`editor`), never behind «Avansert». */
export function MappingStep({
  role,
  check,
  current,
  choices,
  reading,
  total,
  ownerNames,
  lang,
  onCandidate,
  onCurrent,
  onStandard,
  editor,
}: {
  role: CardRole;
  check: MappingCheck;
  current: CurrentSource | null;
  choices: PsetChoice[] | null;
  reading: boolean;
  total: number | null;
  ownerNames: readonly string[];
  lang: Lang;
  onCandidate: (candidate: Candidate) => void;
  /** «Bruk» on the saved source, with its preview when it has one. */
  onCurrent: (preview: ExtractPreview | null) => void;
  /** «Bruk» on the standard: writes its source (and Uttrekk). */
  onStandard: (option: StandardOption) => void;
  /** The source editor: kind, property picker, a property not in the model. */
  editor: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // The source the step opened on: a different one now was set here.
  const [opened] = useState(() => (current ? sourceKey(current) : null));
  const candidates = useMemo(
    () => (choices ? rankCandidates(choices, role, check, ownerNames) : []),
    [choices, role, check, ownerNames],
  );
  const standard = useMemo(() => standardOption(role, check, choices, ownerNames), [role, check, choices, ownerNames]);
  const known = reading || choices === null;

  let saved: Answer | null = null;
  const savedIsStandard = current?.kind === "property" && current.set === standard.set && current.name === standard.name;
  if (current !== null) {
    const prop =
      current.kind === "property" ? choices?.find((c) => c.set === current.set)?.props.find((p) => p.name === current.name) : undefined;
    let preview: ExtractPreview | null = null;
    let error: string | null = null;
    if (prop) {
      try {
        preview = evidence(check, role, prop, ownerNames);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    saved = {
      key: "saved",
      tag: t("label.ruleset", lang),
      head: current.kind === "property" ? "" : current.head,
      title: current.kind === "property" ? `${current.set}.${current.name}` : current.title,
      prop,
      preview,
      hits: current.kind === "property" ? (prop?.valued ?? 0) : null,
      error,
      onConfirm: () => onCurrent(preview),
    };
  }
  const std: Answer = {
    key: "standard",
    tag: t("setup.standard", lang),
    head: "",
    title: `${standard.set}.${standard.name}`,
    prop: standard.prop,
    preview: savedIsStandard && saved ? saved.preview : standard.preview,
    hits: standard.hits,
    error: savedIsStandard && saved ? saved.error : null,
    // The saved rule reading the standard keeps its own Uttrekk and values.
    onConfirm: savedIsStandard && saved ? saved.onConfirm : () => onStandard(standard),
  };
  const same = (c: Candidate) =>
    (c.set === standard.set && c.name === standard.name) ||
    (current?.kind === "property" && c.set === current.set && c.name === current.name);
  const others = candidates.filter((c) => !same(c)).slice(0, 3);
  const cands: Answer[] = others.map((c) => ({
    key: `c\u0000${c.set}\u0000${c.name}`,
    tag: null,
    head: "",
    title: `${c.set}.${c.name}`,
    prop: c.prop,
    preview: c.preview,
    hits: c.prop.valued,
    error: null,
    onConfirm: () => onCandidate(c),
  }));
  const showSaved = saved !== null && !savedIsStandard ? saved : null;
  const chosen = current !== null && opened !== sourceKey(current);
  let pick = prePick(standard.hits, saved ? { hits: saved.hits, chosen } : null, cands.length);
  if (pick === "saved" && savedIsStandard) pick = "standard";
  const picked = pick === "saved" ? showSaved : pick === "candidate" ? cands[0] : std;
  const answers = [std, ...(showSaved ? [showSaved] : []), ...cands];
  const nothing = !known && answers.every((a) => a.hits === 0);
  const confirm = t("action.apply", lang);

  return (
    <div className="flex flex-col gap-3">
      {reading ? <span className="text-[13px] text-muted">{t("file.parsing", lang)}</span> : null}
      {nothing ? (
        <div data-no-candidate className="flex items-center gap-3">
          <StateChip state="no-match" lang={lang} />
          <span className="text-[15px] text-ink">{t("setup.noMatch", lang)}</span>
        </div>
      ) : null}
      {answers.map((a) =>
        a === picked ? (
          <ProposalCard
            key={a.key + a.title}
            head={[a.tag, a.head].filter(Boolean).join(" · ") || undefined}
            title={a.title}
            missing={!known && a.hits === 0}
            confirm={confirm}
            onConfirm={a.onConfirm}
          >
            {a.prop && a.preview ? <Evidence prop={a.prop} preview={a.preview} total={total} lang={lang} /> : null}
            {!known && a.hits === 0 && !a.prop ? <Figure label={t("kpi.products", lang)} value={of(0, total, lang)} bad /> : null}
            {a.error !== null ? (
              <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{a.error}</pre>
            ) : null}
            <button
              type="button"
              data-source-edit
              aria-expanded={editing}
              onClick={() => setEditing((was) => !was)}
              className="w-fit border border-line px-3 py-1 text-[12px] text-ink hover:border-green hover:text-green"
            >
              {t("action.change", lang)}
            </button>
          </ProposalCard>
        ) : (
          <AnswerRow key={a.key + a.title} answer={a} total={total} known={known} lang={lang} />
        ),
      )}
      {editing ? <div data-source-editor className="border border-line bg-panel p-4">{editor}</div> : null}
    </div>
  );
}

/** An answer not pre-picked: its tag, `Pset.Name`, its count; a click takes
 *  it and moves on. */
function AnswerRow({ answer: a, total, known, lang }: { answer: Answer; total: number | null; known: boolean; lang: Lang }) {
  const zero = !known && a.hits === 0;
  return (
    <button
      type="button"
      data-alternative
      data-answer={a.tag === null ? "candidate" : a.key}
      onClick={a.onConfirm}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-panel px-4 py-2 text-left hover:border-green"
    >
      {a.tag ? <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">{a.tag}</span> : null}
      <span className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere] text-ink">
        {a.head ? <span className="text-muted">{a.head} </span> : null}
        {a.title}
      </span>
      {a.preview ? (
        <TotalChips preview={a.preview} lang={lang} />
      ) : a.hits !== null && !known ? (
        <span className={"px-1 font-mono text-[12px] tabular-nums " + (zero ? VERDICT_FILL.fail : "text-muted")}>
          {of(a.hits, total, lang)}
        </span>
      ) : null}
    </button>
  );
}
