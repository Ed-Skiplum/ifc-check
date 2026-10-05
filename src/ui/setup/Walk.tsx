/** The walk's own pieces (2026-10-05): the progress bar, the proposal card,
 *  the mapping step (in the one mapping layout, `Mapping.tsx`), the landed
 *  result, the step's way on and back, and the door the rest of the config
 *  sits behind.
 *
 * edkjo: "Too many clicks and options/traces from the original basic config
 * page. Didn't get the full conversion to the super intuitive pull-me-through
 * modern dopamine and gamified onboarding." So a step is one question: the
 * model's best answer pre-picked with what it gives on the loaded model,
 * confirmed by one click that also moves on. The reward is the real result
 * landing and the bar moving, never a badge or a score of our own. The old
 * step bodies (`SetupPage.tsx`) are the «Avansert» door's contents, whole.
 */

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { VERDICT_FILL } from "../state-visuals";
import type { PsetChoice, PsetProp } from "../pset-choices";
import type { ExtractPreview } from "../extract-preview";
import type { Requirement } from "../requirements";
import { figures, stateLook } from "../alt/req-view";
import { StateChip } from "./chips";
import { FromSource, MappingLayout, Mapped, OptionCount, OptionList, ToZone, Valid, type MapOption } from "./Mapping";
import {
  evidence,
  prePick,
  rankCandidates,
  standardOption,
  type Candidate,
  type CardRole,
  type MappingCheck,
  type SegmentState,
  type StandardOption,
} from "./candidates";

export { Figure, STEP_TITLE, fixClass } from "./Mapping";

/** A segment's look: green done (`segmentState`), the current one dark, a
 *  saved answer not yet checked against a model hatched, an open one the
 *  bare track. */
const SEGMENT: Record<SegmentState | "here", string> = {
  done: "bg-green",
  here: "bg-ink",
  saved: "bg-[image:repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)] group-hover:bg-muted",
  open: "bg-muted/25 group-hover:bg-muted",
};

/** The bar: one segment per step in its `segmentState`, the current one dark
 *  unless done; a segment is the jump to its step. Beside it, where the walk
 *  is, `n / N`. */
export function WalkProgress<S extends string>({
  steps,
  current,
  state,
  label,
  onStep,
}: {
  steps: readonly S[];
  /** null: past the last step (the summary). */
  current: S | null;
  state: (step: S) => SegmentState;
  label: (step: S) => string;
  onStep: (step: S) => void;
}) {
  // The count is what the bar's colour says, the steps done of all; where
  // the walk is, the bar says by the tall segment (2026-10-05, review: «1 /
  // 10» beside nine green segments, TFM and the summary both «10 / 10»).
  const doneCount = steps.filter((s) => state(s) === "done").length;
  return (
    <nav data-walk-progress className="flex min-w-0 flex-1 items-center gap-3">
      <ol className="m-0 flex min-w-0 flex-1 list-none gap-1 p-0">
        {steps.map((step) => {
          const here = step === current;
          const s = state(step);
          return (
            <li key={step} className="min-w-0 flex-1">
              <button
                type="button"
                title={label(step)}
                aria-label={label(step)}
                aria-current={here ? "step" : undefined}
                data-segment={s}
                onClick={() => onStep(step)}
                className="group flex h-6 w-full items-center"
              >
                {/* Where the walk is: taller than the rest, whatever its
                    state, so it is told apart by shape as well as colour. */}
                <span
                  className={
                    "block w-full transition-colors duration-500 motion-reduce:transition-none " +
                    (here ? "h-3 " : "h-1.5 ") +
                    SEGMENT[s === "done" || !here ? s : "here"]
                  }
                />
              </button>
            </li>
          );
        })}
      </ol>
      <span data-walk-count className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
        {doneCount} / {steps.length}
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

/** The width of the IFC step's stage: the frame's, held to 72 % of the walk's
 *  height at 16:10 (`cqh`: the walk's scroll area is a size container), so
 *  the target is the screen's one large thing and never runs off it. */
export const STAGE_WIDTH = "w-[min(100%,calc(72cqh*1.6))]";

/** The IFC step's stage (2026-10-05, edkjo on a flat green banner: "is this
 *  great UI?"): one drop target, dashed at rest, the upload glyph, the
 *  step's name once and the formats taken. A file dropped anywhere on the
 *  page lands (`App`'s drop); `dragging` lights the target while one is
 *  held over the page. Click or Enter opens the file dialog. While a model
 *  is read, the sweep runs along its foot. */
export function IfcDrop({
  label,
  accept,
  dragging,
  busy,
  onFiles,
}: {
  label: string;
  accept: string;
  dragging: boolean;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        autoFocus
        data-ifc-drop={dragging ? "over" : busy ? "busy" : "rest"}
        aria-busy={busy}
        onClick={() => input.current?.click()}
        className={
          "group relative flex aspect-[16/10] min-h-44 w-full flex-col items-center justify-center gap-5 overflow-hidden border-2 border-dashed p-6 text-center transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green " +
          (dragging
            ? "border-green bg-palegreen text-green"
            : "border-muted bg-input text-ink hover:border-green hover:text-green")
        }
      >
        <svg
          width="72"
          height="72"
          viewBox="0 0 72 72"
          aria-hidden="true"
          className={"shrink-0 " + (dragging ? "text-green" : "text-muted group-hover:text-green")}
        >
          <path d="M8 46v16h56V46" fill="none" stroke="currentColor" strokeWidth="3" />
          <g
            className={
              "transition-transform duration-150 motion-reduce:transition-none " +
              (dragging ? "-translate-y-1" : "group-hover:-translate-y-0.5")
            }
          >
            <path d="M36 50V12" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M22 26 36 12l14 14" fill="none" stroke="currentColor" strokeWidth="3" />
          </g>
        </svg>
        <span className="text-2xl leading-tight font-medium tracking-tight sm:text-[28px]">{label}</span>
        <span className="font-mono text-[13px] tracking-wide text-muted">{accept}</span>
        {busy ? (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-line">
            <span className="ifc-sweep block h-full w-1/3 bg-green motion-reduce:animate-none!" />
          </span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".ifc,.ifczip"
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </>
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

/** The same action while the answer on screen gives nothing on the loaded
 *  models (2026-10-05, edkjo on «Bruk» leading at 0 / 91): still there, still
 *  the way on, but outlined, so the screen leads with fixing the answer. */
export const CONFIRM_QUIET =
  "flex min-h-12 items-center justify-center gap-3 border-2 border-ink bg-panel px-8 text-[15px] font-medium text-ink hover:border-green hover:text-green";

/** The primary's weight follows the state: `lead` when the answer has a real
 *  result on the loaded models (or none is loaded to say otherwise). */
export const confirmClass = (lead: boolean) => (lead ? CONFIRM : CONFIRM_QUIET);

/** Where «Bruk» goes: one place for every step, the walk's foot, pinned
 *  under the step's scrolling panel (2026-10-05, review: «Bruk» sat in four
 *  places and fell below the fold at 1440 × 900). A step draws its own
 *  `StepConfirm`; it lands in the slot the page provides. */
const ConfirmSlot = createContext<HTMLElement | null>(null);
export const ConfirmSlotProvider = ConfirmSlot.Provider;

export function StepConfirm({
  lead = true,
  disabled = false,
  label,
  onClick,
}: {
  lead?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  const slot = useContext(ConfirmSlot);
  const button = (
    <button
      type="button"
      autoFocus
      data-step-confirm
      data-lead={lead}
      disabled={disabled}
      onClick={onClick}
      className={confirmClass(lead) + " disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-muted"}
    >
      {label} →
    </button>
  );
  return slot ? createPortal(button, slot) : button;
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
    // No mark of its own: the result's state is the only colour (a ✓ beside
    // «Avvik» said two things at once).
    <div data-landed className="pick-in flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-2">
      <span className="text-[13px] font-medium text-ink">{label}</span>
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
        // A mapping row counts what its rule selects and names no class:
        // say what the denominator counts, as the step's own figures do.
        const unnamed = req.row?.mapping !== undefined && !req.row.dekning?.grunnlag_klasse;
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
                {f.of && unnamed ? ` ${t("walk.selected", lang)}` : ""}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** One row of the end summary, and of the POFIN prompt: done or not, the
 *  item's name, what it is set to, and its result on each model. A click
 *  opens the item's step; a row with no step has no click. */
export function SummaryRow({
  done,
  label,
  text,
  results,
  lang,
  onClick,
}: {
  /** Set or not; null: no mark (the POFIN prompt, where every row is set). */
  done: boolean | null;
  label: string;
  text: string;
  results: readonly { model: string; req: Requirement | null }[];
  lang: Lang;
  onClick?: () => void;
}) {
  const cells = (
    <>
      {done === null ? null : (
        // Set or not, in ink: the only colour on the row is the result's.
        <span aria-hidden="true" className={"w-4 shrink-0 text-center text-[12px] " + (done ? "text-ink" : "text-muted")}>
          {done ? "●" : "○"}
        </span>
      )}
      <span className="w-48 shrink-0 text-[14px] text-ink">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{text}</span>
      <ReqResult results={results} lang={lang} />
    </>
  );
  const row = "flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left";
  return (
    <li className="border-b border-line last:border-b-0">
      {onClick ? (
        <button type="button" onClick={onClick} className={row + " hover:bg-input"}>
          {cells}
        </button>
      ) : (
        <div className={row}>{cells}</div>
      )}
    </li>
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
  /** «Bruk» on it: writes it and moves on. */
  onConfirm: () => void;
};

const sourceKey = (s: CurrentSource) => (s.kind === "property" ? `p\u0000${s.set}\u0000${s.name}` : `o\u0000${s.head}\u0000${s.title}`);

/** A mapping step (Systemkode, Funksjonskode, MMI, Duplikat objekt) in the
 *  one mapping layout (`Mapping.tsx`). OPTIONS lists, in one order, the
 *  standard (2026-10-05, edkjo: "suggest the standard as in POFIN"), the
 *  ruleset's saved source, the model's candidates; FROM opens on the
 *  pre-picked one (`prePick`). A pick makes another one FROM without moving
 *  on; «Bruk» writes FROM and moves on. «Endre» opens the full source editor
 *  (`editor`) under the mapping, which writes the rule as it is edited. The
 *  requirement zone holds the step's own value requirement (`requirement`)
 *  and VALID for FROM. */
export function MappingStep({
  role,
  check,
  current,
  choices,
  reading,
  total,
  ownerNames,
  lang,
  name,
  form,
  onCandidate,
  onCurrent,
  onStandard,
  editor,
  requirement,
  pinned = false,
  written,
}: {
  /** The report row of the rule as the ruleset holds it, per model; null
   *  when the ruleset has no live rule for the step. Shown while FROM is
   *  that source. */
  written: readonly { model: string; req: Requirement | null }[] | null;
  role: CardRole;
  check: MappingCheck;
  current: CurrentSource | null;
  choices: PsetChoice[] | null;
  reading: boolean;
  total: number | null;
  ownerNames: readonly string[];
  lang: Lang;
  /** TO: the step's name, and the standard's example of the value. */
  name: string;
  form?: string;
  onCandidate: (candidate: Candidate) => void;
  /** «Bruk» on the saved source, with its preview when it has one. */
  onCurrent: (preview: ExtractPreview | null) => void;
  /** «Bruk» on the standard: writes its source (and Uttrekk). */
  onStandard: (option: StandardOption) => void;
  /** The source editor: kind, property picker, a property not in the model. */
  editor: ReactNode;
  /** The value requirement's controls: code list, codes, values. */
  requirement: ReactNode;
  /** The saved source is the answer whatever the models carry: a POFIN
   *  template being reviewed opens every step on POFIN's. */
  pinned?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // The source the step opened on: a different one now was set here.
  const [opened] = useState(() => (current ? sourceKey(current) : null));
  // The answer picked in OPTIONS: FROM until «Bruk». Dropped when the rule's
  // source changes under it (the editor writes it).
  const [chosen, setChosen] = useState<string | null>(null);
  const nowKey = current ? sourceKey(current) : null;
  const [seenKey, setSeenKey] = useState(nowKey);
  if (seenKey !== nowKey) {
    setSeenKey(nowKey);
    setChosen(null);
  }
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
  const answers = [std, ...(showSaved ? [showSaved] : []), ...cands];
  const setHere = current !== null && (pinned || opened !== sourceKey(current));
  // Only a strong candidate is ever taken for the user (`Candidate.strong`):
  // one that passes by coincidence is listed, never pre-picked.
  const strong = others.filter((c) => c.strong).length;
  let pick = prePick(standard.hits, saved ? { hits: saved.hits, chosen: setHere } : null, strong);
  if (pick === "saved" && savedIsStandard) pick = "standard";
  const prePicked = (pick === "saved" ? showSaved : pick === "candidate" ? cands[0] : std) ?? std;
  const from = answers.find((a) => a.key === chosen) ?? prePicked;
  // Duplikat objekt: a model without the property has no copies, which is
  // no fault (blank is the file's own object), so its absence is not red.
  const absentOk = role === "copy-object";
  const nothing = !known && !absentOk && answers.every((a) => a.hits === 0);
  // Elements carrying a value, as the report row counts presence.
  const count = (a: Answer) => (a.prop ? a.prop.valued : !known && a.hits === 0 ? 0 : null);
  const fromCount = count(from);
  // The answer gives nothing on the loaded models: «Endre» leads, «Bruk»
  // steps back (mapping is the infrastructure: VALID does not decide this).
  const lead = known || absentOk || from.hits !== 0;
  // FROM is what the ruleset holds now: its report row is the step's result,
  // the same figures the landed strip and the summary print.
  const isWritten = written !== null && (from.key === "saved" || (from.key === "standard" && savedIsStandard));

  return (
    <>
      <MappingLayout
        lang={lang}
        to={<ToZone name={name} form={form} />}
        fromState={!known && !absentOk && from.hits === 0 ? "missing" : "found"}
        fromKey={from.key + from.title}
        from={
          <FromSource
            tag={from.tag}
            head={from.head || undefined}
            title={from.title}
            samples={from.prop?.values.map((v) => v.v)}
            mapped={fromCount !== null ? <Mapped n={fromCount} total={total} neutral={absentOk} lang={lang} /> : null}
          />
        }
        options={
          <OptionList
            label={name}
            lang={lang}
            // «Endre» leads only when no listed answer has hits: else the fix
            // is a pick in the list, which is already in view.
            more={{
              open: editing,
              onToggle: () => setEditing((was) => !was),
              lead: !lead && !editing && !answers.some((a) => (a.hits ?? 0) > 0),
            }}
            options={answers.map((a): MapOption => {
              const n = count(a);
              return {
                key: a.key,
                tag: a.tag,
                head: a.head || undefined,
                title: a.title,
                count: n !== null ? <OptionCount n={n} total={total} current={a === from} neutral={absentOk} lang={lang} /> : null,
                current: a === from,
                onPick: () => setChosen(a.key),
              };
            })}
          >
            {reading ? <span className="text-[13px] text-muted">{t("file.parsing", lang)}</span> : null}
            {nothing ? (
              <div data-no-candidate className="flex items-center gap-3">
                <StateChip state="no-match" lang={lang} />
                <span className="text-[15px] text-ink">{t("setup.noMatch", lang)}</span>
              </div>
            ) : null}
          </OptionList>
        }
        editor={editing ? <div data-source-editor className="border border-line bg-panel p-4">{editor}</div> : null}
        requirement={
          <>
            {requirement}
            {isWritten && written ? (
              <span data-result className="flex flex-wrap items-center gap-3">
                <ReqResult results={written} lang={lang} />
              </span>
            ) : null}
            {from.prop && from.preview ? <Valid prop={from.prop} preview={from.preview} total={total} lang={lang} /> : null}
            {from.error !== null ? (
              <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{from.error}</pre>
            ) : null}
          </>
        }
      />
      <StepConfirm lead={lead} label={t("action.apply", lang)} onClick={from.onConfirm} />
    </>
  );
}
