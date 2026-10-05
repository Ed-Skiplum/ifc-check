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
 *                        separator, the text; Lokasjon's binding
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

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
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
  moveToken,
  sameSequence,
  tfmMatcher,
} from "../../engine/tfm.ts";
import { ReqResult } from "./Walk";

/** What a chip says about its binding. `bound`: the name of what it reads.
 *  `shape`: nothing to compare, «Kun format». Absent: a part that never
 *  binds (Løpenummer, Komp.nr, ...). */
export type ChipBinding = { kind: "bound"; label: string; title: string } | { kind: "shape" };

export interface BindingChoice {
  set: string;
  name: string;
  n: number;
}

const sepGlyph = (sep: TfmSeparator) => (sep === " " ? "␣" : sep);

function tokenName(token: TfmToken): string {
  if ("part" in token) return token.part;
  if ("sep" in token) return sepGlyph(token.sep);
  return `"${token.text}"`;
}

/** The pills a choice is made with: large, flat, one pressed. */
const PILL =
  "min-h-9 border px-3 py-1 font-mono text-[13px] aria-pressed:border-green aria-pressed:bg-green aria-pressed:text-cream " +
  "border-line bg-input text-ink hover:border-green";

const LABEL = "text-[10px] font-semibold tracking-[0.12em] text-gold uppercase";

/** A popover under a chip or a gap. Closes on Escape and on a press outside
 *  `anchor`. */
function Pop({ anchor, onClose, children }: { anchor: React.RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const away = (event: globalThis.PointerEvent) => {
      if (anchor.current && !anchor.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [anchor, onClose]);
  return (
    <div
      data-tfm-pop
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="pick-in absolute top-full left-0 z-30 mt-2 flex w-max max-w-[min(92vw,30rem)] flex-col gap-3 border border-line bg-panel p-3 shadow-lg"
    >
      {children}
    </div>
  );
}

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
  onChange,
  onBind,
  onRemove,
}: {
  token: TfmToken;
  lang: Lang;
  /** Lokasjon only: the properties sharing its values, and the current one. */
  bindings: readonly BindingChoice[];
  bound: { set: string; name: string } | null;
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
      {token.part === "Lokasjon" ? (
        <div className="flex flex-col gap-1">
          {listed.map((b) => {
            const on = bound !== null && bound.set === b.set && bound.name === b.name;
            return (
              <button
                key={`${b.set}\u0000${b.name}`}
                type="button"
                aria-pressed={on}
                onClick={() => onBind({ set: b.set, name: b.name })}
                className={PILL + " flex items-baseline gap-2 text-left"}
              >
                <span className="truncate text-[11px] opacity-75">{b.set}</span>
                <span className="truncate">{b.name}</span>
                {b.n >= 0 ? <span className="ml-auto pl-3 text-[11px] tabular-nums opacity-75">{formatCount(b.n, lang)}</span> : null}
              </button>
            );
          })}
          <button type="button" aria-pressed={bound === null} onClick={() => onBind(null)} className={PILL + " text-left"}>
            {t("tfm.none", lang)}
          </button>
        </div>
      ) : null}
      {remove}
    </>
  );
}

type Open = { kind: "edit"; index: number } | { kind: "insert"; at: number } | null;

/** A drag in progress: the chip, where it started, where the pointer is,
 *  and the gap it would land in (an index into the sequence without it). */
interface Drag {
  index: number;
  pointer: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  moved: boolean;
  slot: number;
}

export function TfmBuilder({
  sequence,
  values,
  binding,
  lokasjonChoices,
  lokasjon,
  lang,
  onSequence,
  onLokasjon,
}: {
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
  const [open, setOpen] = useState<Open>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const wraps = useRef<(HTMLDivElement | null)[]>([]);
  const suppressClick = useRef(false);
  const openRef = useRef<HTMLElement | null>(null);
  // The chip to focus once a keyboard move or removal has re-rendered.
  const pendingFocus = useRef<number | null>(null);

  const matcher = useMemo(() => {
    try {
      return tfmMatcher(sequence);
    } catch {
      return null;
    }
  }, [sequence]);

  // The example: the first real value that parses, else the standard's.
  const example = useMemo(() => {
    if (matcher) {
      for (const value of values) {
        const parsed = matcher.parse(value.v);
        if (parsed.ok) return parsed.segments.map((s) => s.text);
      }
    }
    return sequence.map(exampleText);
  }, [matcher, values, sequence]);

  // The values off the sequence, where each leaves it.
  const off = useMemo(() => {
    if (!matcher) return [];
    const out: { v: string; n: number; at: number; token: number }[] = [];
    for (const value of values) {
      const parsed = matcher.parse(value.v);
      if (!parsed.ok) out.push({ v: value.v, n: value.n, at: parsed.at, token: parsed.token });
      if (out.length === 5) break;
    }
    return out;
  }, [matcher, values]);

  // Focus follows a chip moved or removed from the keyboard.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    chips.current[Math.min(pendingFocus.current, sequence.length - 1)]?.focus();
    pendingFocus.current = null;
  }, [sequence]);

  const close = () => setOpen(null);
  const replace = (i: number, token: TfmToken) => onSequence(sequence.map((tk, j) => (j === i ? token : tk)));
  const remove = (i: number) => {
    onSequence(sequence.filter((_, j) => j !== i));
    setOpen(null);
  };
  const insert = (at: number, token: TfmToken) => {
    const next = [...sequence];
    next.splice(at, 0, token);
    onSequence(next);
    // A part or separator is placed; text is typed, so its editor opens.
    setOpen("text" in token ? { kind: "edit", index: at } : null);
  };
  // Text left empty is no token.
  const closeEditor = () => {
    if (open?.kind === "edit") {
      const token = sequence[open.index];
      if (token && "text" in token && token.text === "") onSequence(sequence.filter((_, j) => j !== open.index));
    }
    setOpen(null);
  };

  /* --------------------------------------------------------------- drag */

  /** The gap the pointer is over: how many other chips come before it in
   *  reading order (rows wrap). */
  const slotAt = (index: number, x: number, y: number): number => {
    let slot = 0;
    wraps.current.forEach((el, j) => {
      if (!el || j === index || j >= sequence.length) return;
      const r = el.getBoundingClientRect();
      const before = r.bottom < y || (r.top <= y && r.bottom >= y && r.left + r.width / 2 < x);
      if (before) slot += 1;
    });
    return slot;
  };

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ index, pointer: event.pointerId, x0: event.clientX, y0: event.clientY, dx: 0, dy: 0, moved: false, slot: index });
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    const moved = drag.moved || Math.hypot(dx, dy) > 4;
    if (!moved) return;
    if (!drag.moved) setOpen(null);
    setDrag({ ...drag, dx, dy, moved, slot: slotAt(drag.index, event.clientX, event.clientY) });
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.moved) {
      suppressClick.current = true;
      if (drag.slot !== drag.index) onSequence(moveToken(sequence, drag.index, drag.slot));
    }
    setDrag(null);
  };
  // The gap a drag would land in, as a gap of the row it is shown on.
  const dropGap = drag?.moved ? (drag.slot <= drag.index ? drag.slot : drag.slot + 1) : null;

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const to = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= sequence.length) return;
      setOpen(null);
      pendingFocus.current = to;
      onSequence(moveToken(sequence, index, to));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      pendingFocus.current = Math.max(0, index - 1);
      remove(index);
    } else if (event.key === "Escape") {
      closeEditor();
    }
  };

  /* -------------------------------------------------------------- pieces */

  const gap = (at: number) => {
    const here = open?.kind === "insert" && open.at === at;
    const target = dropGap === at;
    return (
      <div
        key={`gap-${at}`}
        ref={(el) => {
          if (here) openRef.current = el;
        }}
        className="relative flex self-stretch"
      >
        <button
          type="button"
          data-tfm-insert={at}
          aria-label={t("action.addRow", lang)}
          aria-expanded={here}
          onClick={() => setOpen(here ? null : { kind: "insert", at })}
          className="group flex w-4 items-center justify-center self-stretch"
        >
          <span
            aria-hidden="true"
            className={
              target
                ? "block h-full w-1 bg-green"
                : "font-mono text-[13px] leading-none text-line group-hover:text-green group-focus-visible:text-green " +
                  (here ? "text-green" : "")
            }
          >
            {target ? null : "+"}
          </span>
        </button>
        {here ? (
          <Pop anchor={openRef} onClose={close}>
            <InsertPalette lang={lang} onPick={(token) => insert(at, token)} />
          </Pop>
        ) : null}
      </div>
    );
  };

  const chip = (token: TfmToken, i: number) => {
    const editing = open?.kind === "edit" && open.index === i;
    const dragging = drag?.moved === true && drag.index === i;
    const text = example[i] ?? exampleText(token);
    const bind = "part" in token ? binding(token.part) : undefined;
    return (
      <div
        key={`chip-${i}`}
        ref={(el) => {
          wraps.current[i] = el;
          if (editing) openRef.current = el;
        }}
        className="relative"
      >
        <button
          ref={(el) => {
            chips.current[i] = el;
          }}
          type="button"
          data-tfm-chip={"part" in token ? token.part : "sep" in token ? "sep" : "text"}
          aria-label={tokenName(token)}
          aria-expanded={editing}
          onPointerDown={onPointerDown(i)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onKeyDown={onKeyDown(i)}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (editing) closeEditor();
            else setOpen({ kind: "edit", index: i });
          }}
          style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
          className={
            "flex min-h-20 cursor-grab touch-none flex-col justify-center gap-1 border-2 bg-input text-left select-none active:cursor-grabbing " +
            ("part" in token ? "items-start px-3 py-2 " : "items-center px-2 py-2 ") +
            ("text" in token ? "border-dashed " : "") +
            (editing ? "border-green " : bind?.kind === "bound" ? "border-green/60 " : "border-line hover:border-green ") +
            (dragging ? "relative z-20 opacity-90 shadow-lg" : "transition-colors motion-reduce:transition-none")
          }
        >
          <span className="font-mono text-[22px] leading-none whitespace-pre text-ink">
            {"sep" in token ? sepGlyph(token.sep) : text}
          </span>
          {"part" in token ? (
            <span className="text-[11px] whitespace-nowrap text-muted">
              {token.part}
              {token.digits ? <span className="font-mono"> ·{token.digits}</span> : null}
            </span>
          ) : null}
          {bind?.kind === "bound" ? (
            <span data-tfm-binding="bound" title={bind.title} className="max-w-40 truncate text-[11px] text-green">
              ⇄ {bind.label}
            </span>
          ) : bind?.kind === "shape" ? (
            <span data-tfm-binding="shape" className="text-[11px] whitespace-nowrap text-muted">
              {t("tfm.shapeOnly", lang)}
            </span>
          ) : null}
        </button>
        {editing ? (
          <Pop anchor={openRef} onClose={closeEditor}>
            <ChipEditor
              token={token}
              lang={lang}
              bindings={lokasjonChoices}
              bound={lokasjon}
              onChange={(next) => replace(i, next)}
              onBind={onLokasjon}
              onRemove={() => remove(i)}
            />
          </Pop>
        ) : null}
      </div>
    );
  };

  const standard = sameSequence(sequence, STATSBYGG_SEQUENCE);

  return (
    <div data-tfm-builder className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div data-tfm-chips className="flex min-w-0 flex-1 flex-wrap items-stretch gap-y-3">
          {gap(0)}
          {sequence.flatMap((token, i) => [chip(token, i), gap(i + 1)])}
        </div>
        {standard ? null : (
          <button
            type="button"
            data-tfm-reset
            onClick={() => {
              setOpen(null);
              onSequence([...STATSBYGG_SEQUENCE]);
            }}
            className="shrink-0 border border-line bg-input px-3 py-1.5 text-[12px] text-ink hover:border-green hover:text-green"
          >
            ↺ {t("setup.standard", lang)}
          </button>
        )}
      </div>
      {off.length > 0 ? (
        <ul data-tfm-off className="m-0 flex list-none flex-col gap-1 p-0">
          {off.map((o) => {
            const wanted = sequence[o.token];
            return (
              <li key={o.v} className="flex items-baseline gap-3 font-mono text-[13px]">
                <span className="min-w-0 truncate whitespace-pre">
                  <span className="text-ink">{o.v.slice(0, o.at)}</span>
                  <mark className={"px-0.5 " + VERDICT_FILL.fail}>{o.v.slice(o.at) || "…"}</mark>
                </span>
                {wanted ? <span className="shrink-0 text-[11px] text-muted">{tokenName(wanted)}</span> : null}
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">{formatCount(o.n, lang)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
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
