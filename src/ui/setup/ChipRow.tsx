/** The chip row a string builder is edited in (2026-10-05): the TFM step's
 *  (`TfmBuilder.tsx`) and the type name's (`TypeNameStep.tsx`). Moved out of
 *  `TfmBuilder.tsx` whole, so both builders handle alike:
 *
 *   drag a chip          reorder (pointer events; the gap it lands in shows)
 *   ← → on a chip        move it one place
 *   Delete / Backspace   remove it (× on the chip with a pointer)
 *   click / Enter        change it in place (`editor`)
 *   + between chips      insert a token there (`palette`)
 *
 * Live under the row: up to five values off the sequence, with where each
 * leaves it marked and the token that does not follow there. The example
 * the chips show is the first real value that parses, else each token's own
 * (`exampleOf`). Generic over the token: what a token is and how it reads is
 * the caller's.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { formatCount } from "../format";
import type { PsetValue } from "../pset-choices";

/** A value read against the sequence: its segment texts, or where it leaves
 *  it (`at`, a character offset) and the token that does not follow there. */
export type ChipParse = { ok: true; texts: string[] } | { ok: false; at: number; token: number };

/** How one chip shows: the big text (null: the example text), the line under
 *  it, whether it is a part (left-aligned) or a separator, text is dashed,
 *  a third line, and a quiet green border when the chip is bound. */
export interface ChipFace {
  kind: string;
  big?: string;
  sub?: ReactNode;
  extra?: ReactNode;
  part: boolean;
  dashed: boolean;
  bound: boolean;
}

/** The pills a choice is made with: large, flat, one pressed. */
export const PILL =
  "min-h-9 border px-3 py-1 font-mono text-[13px] aria-pressed:border-green aria-pressed:bg-green aria-pressed:text-cream " +
  "border-line bg-input text-ink hover:border-green";

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

/** The piece a value lacks, drawn as its chip in small, set into the value
 *  where the value leaves the sequence. */
function WantedChip({ face, text, title }: { face: ChipFace; text: string; title: string }) {
  return (
    <span
      data-wanted={face.kind}
      title={title}
      className={
        "mx-1 inline-flex shrink-0 items-baseline gap-1.5 border-2 bg-palegreen px-2 py-1 leading-none text-green " +
        (face.dashed ? "border-dashed border-green" : "border-green")
      }
    >
      <span className="text-[16px] font-semibold whitespace-pre">{face.big ?? text}</span>
      {face.sub ? <span className="font-sans text-[10px] whitespace-nowrap opacity-80 [&_*]:!text-green">{face.sub}</span> : null}
    </span>
  );
}

type Open ={ kind: "edit"; index: number } | { kind: "insert"; at: number } | null;

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

/** `sequence` with the token at `from` moved to `to` (an index in the
 *  result). */
function moveAt<T>(sequence: readonly T[], from: number, to: number): T[] {
  const next = [...sequence];
  const [token] = next.splice(from, 1);
  if (token === undefined) return [...sequence];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, token);
  return next;
}

export function ChipRow<T>({
  sequence,
  values,
  parse,
  exampleOf,
  face,
  name,
  editor,
  palette,
  typed,
  standard,
  same,
  lang,
  onSequence,
  offHead,
  countLabel,
}: {
  /** Over the values off the sequence, on the left: what the rows are. */
  offHead?: ReactNode;
  /** Over their counts, on the right: what the count counts. */
  countLabel: string;
  sequence: readonly T[];
  /** The property's listed values, most frequent first. */
  values: readonly PsetValue[];
  /** Null when the sequence does not compile. */
  parse: ((value: string) => ChipParse) | null;
  exampleOf: (token: T) => string;
  face: (token: T) => ChipFace;
  /** The token as the off list and the chip's label name it. */
  name: (token: T) => string;
  /** The chip's editor, in place. */
  editor: (token: T, change: (next: T) => void, remove: () => void) => ReactNode;
  /** The insert palette at a gap. */
  palette: (pick: (token: T) => void) => ReactNode;
  /** A token typed into (text): inserting one opens its editor, and one left
   *  empty is dropped when the editor closes. */
  typed: (token: T) => { empty: boolean } | null;
  /** The suggestion «↺ Standard» resets to. */
  standard: readonly T[];
  same: (a: readonly T[], b: readonly T[]) => boolean;
  lang: Lang;
  onSequence: (next: T[]) => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const wraps = useRef<(HTMLDivElement | null)[]>([]);
  const suppressClick = useRef(false);
  const openRef = useRef<HTMLElement | null>(null);
  // The chip to focus once a keyboard move or removal has re-rendered.
  const pendingFocus = useRef<number | null>(null);

  // The example: the first real value that parses, else each token's own.
  const example = useMemo(() => {
    if (parse) {
      for (const value of values) {
        const parsed = parse(value.v);
        if (parsed.ok) return parsed.texts;
      }
    }
    return sequence.map(exampleOf);
  }, [parse, values, sequence, exampleOf]);

  // The values off the sequence, where each leaves it.
  const off = useMemo(() => {
    if (!parse) return [];
    const out: { v: string; n: number; at: number; token: number }[] = [];
    for (const value of values) {
      const parsed = parse(value.v);
      if (!parsed.ok) out.push({ v: value.v, n: value.n, at: parsed.at, token: parsed.token });
      if (out.length === 5) break;
    }
    return out;
  }, [parse, values]);

  // Focus follows a chip moved or removed from the keyboard.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    chips.current[Math.min(pendingFocus.current, sequence.length - 1)]?.focus();
    pendingFocus.current = null;
  }, [sequence]);

  const close = () => setOpen(null);
  const replace = (i: number, token: T) => onSequence(sequence.map((tk, j) => (j === i ? token : tk)));
  const remove = (i: number) => {
    onSequence(sequence.filter((_, j) => j !== i));
    setOpen(null);
  };
  const insert = (at: number, token: T) => {
    const next = [...sequence];
    next.splice(at, 0, token);
    onSequence(next);
    // A part or separator is placed; text is typed, so its editor opens.
    setOpen(typed(token) ? { kind: "edit", index: at } : null);
  };
  // Text left empty is no token.
  const closeEditor = () => {
    if (open?.kind === "edit") {
      const token = sequence[open.index];
      if (token !== undefined && typed(token)?.empty) onSequence(sequence.filter((_, j) => j !== open.index));
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
    // A press starts a new gesture: a drag that ended without a click (a
    // touch drag fires none) must not swallow this press's click.
    suppressClick.current = false;
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
      if (drag.slot !== drag.index) onSequence(moveAt(sequence, drag.index, drag.slot));
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
      onSequence(moveAt(sequence, index, to));
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
    // The gaps inside the row show their + on hover or focus only; the end
    // of the row always does. A + between every chip read as noise.
    const quiet = !here && at !== sequence.length;
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
          // One width open or not, so opening a gap moves no chip.
          className="group flex w-7 cursor-pointer items-center justify-center self-stretch outline-none"
        >
          {target ? (
            <span aria-hidden="true" className="block h-full w-1 bg-green" />
          ) : (
            <span
              aria-hidden="true"
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center border transition-[color,background-color,border-color,opacity] motion-reduce:transition-none " +
                (quiet ? "opacity-0 group-hover/row:opacity-100 group-focus-visible:opacity-100 " : "") +
                "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-green " +
                (here
                  ? "border-green bg-green text-cream"
                  : "border-muted bg-input text-ink group-hover:border-green group-hover:bg-green group-hover:text-cream")
              }
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </button>
        {here ? (
          <Pop anchor={openRef} onClose={close}>
            {palette((token) => insert(at, token))}
          </Pop>
        ) : null}
      </div>
    );
  };

  const chip = (token: T, i: number) => {
    const editing = open?.kind === "edit" && open.index === i;
    const dragging = drag?.moved === true && drag.index === i;
    const f = face(token);
    const text = f.big ?? example[i] ?? exampleOf(token);
    return (
      <div
        key={`chip-${i}`}
        ref={(el) => {
          wraps.current[i] = el;
          if (editing) openRef.current = el;
        }}
        className="group/chip relative"
      >
        <button
          ref={(el) => {
            chips.current[i] = el;
          }}
          type="button"
          data-tfm-chip={f.kind}
          aria-label={name(token)}
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
            "relative flex min-h-20 touch-none flex-col justify-center gap-1 border-2 text-left select-none " +
            "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green " +
            (f.part ? "items-start py-2 pr-2.5 pl-2 " : "items-center px-2 py-2 ") +
            (f.dashed ? "border-dashed " : "") +
            (editing
              ? "border-green bg-palegreen "
              : (f.bound ? "border-green/60 " : "border-line ") + "bg-input hover:border-green hover:bg-palegreen ") +
            (dragging
              ? "z-20 cursor-grabbing opacity-90 shadow-lg"
              : "cursor-pointer transition-colors motion-reduce:transition-none")
          }
        >
          <span className="flex items-center gap-1.5">
            {/* The drag area's mark: the whole chip drags, this says so. */}
            <svg aria-hidden="true" viewBox="0 0 6 12" className={"h-3.5 w-1.5 shrink-0 text-muted " + (dragging ? "cursor-grabbing" : "cursor-grab")}>
              <circle cx="1.25" cy="2" r="1" fill="currentColor" />
              <circle cx="4.75" cy="2" r="1" fill="currentColor" />
              <circle cx="1.25" cy="6" r="1" fill="currentColor" />
              <circle cx="4.75" cy="6" r="1" fill="currentColor" />
              <circle cx="1.25" cy="10" r="1" fill="currentColor" />
              <circle cx="4.75" cy="10" r="1" fill="currentColor" />
            </svg>
            <span className="font-mono text-[22px] leading-none whitespace-pre text-ink">{text}</span>
            {/* Opens: the chip is a menu of its own options. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className={
                "h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none " +
                (editing ? "rotate-180 text-green" : "text-muted group-hover/chip:text-green")
              }
            >
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {f.sub ?? null}
          {f.extra ?? null}
        </button>
        {dragging ? null : (
          <button
            type="button"
            tabIndex={-1}
            data-tfm-remove={i}
            aria-label={`${t("action.remove", lang)} ${name(token)}`}
            onClick={() => remove(i)}
            className={
              "absolute -top-3 -right-3 z-10 flex h-6 w-6 cursor-pointer items-center justify-center border border-muted bg-input text-ink " +
              "transition-colors hover:border-bad hover:bg-bad hover:text-cream motion-reduce:transition-none " +
              (editing ? "visible" : "invisible group-focus-within/chip:visible group-hover/chip:visible")
            }
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {editing ? (
          <Pop anchor={openRef} onClose={closeEditor}>
            {editor(
              token,
              (next) => replace(i, next),
              () => remove(i),
            )}
          </Pop>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div data-tfm-chips className="group/row flex min-w-0 flex-1 flex-wrap items-stretch gap-y-3">
          {gap(0)}
          {sequence.flatMap((token, i) => [chip(token, i), gap(i + 1)])}
        </div>
        {same(sequence, standard) ? null : (
          <button
            type="button"
            data-tfm-reset
            onClick={() => {
              setOpen(null);
              onSequence([...standard]);
            }}
            className="shrink-0 border border-line bg-input px-3 py-1.5 text-[12px] text-ink hover:border-green hover:text-green"
          >
            ↺ {t("setup.standard", lang)}
          </button>
        )}
      </div>
      {off.length > 0 || offHead ? (
        // A value off the sequence in human terms (2026-10-05, edkjo on one
        // unmarked letter, the rest in red and a stray `"."`): the value as
        // it is, the piece the sequence wanted where it leaves it set into
        // it as that piece's own chip. Headed as a table: on the left what
        // the rows are (`offHead`, the caller's: Typenavn puts its «Typer»
        // n / N there), on the right what the count counts (`countLabel`).
        <div data-tfm-off className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-4 border-b border-line pb-1.5">
            <span className="min-w-0">{offHead ?? null}</span>
            {off.length > 0 ? (
              <span className="shrink-0 text-[12px] font-semibold tracking-[0.1em] text-gold uppercase">{countLabel}</span>
            ) : null}
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {off.map((o) => {
              const wanted = sequence[o.token];
              const rest = o.v.slice(o.at);
              // The part-level diff only where the value nearly fits: at
              // least its first two pieces take the sequence. Short of that a
              // lone letter that happens to be a code (the «B» of
              // «Betongsøyle») is no match, and the value is shown whole with
              // one mark (2026-10-05, review).
              if (o.token < 2) {
                return (
                  <li key={o.v} data-off-at="whole" className="flex items-center gap-3 font-mono text-[14px]">
                    <span aria-hidden="true" className="shrink-0 font-sans text-[13px] text-bad">
                      ✗
                    </span>
                    <span className="min-w-0 truncate whitespace-pre text-ink">{o.v}</span>
                    <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted">{formatCount(o.n, lang)}</span>
                  </li>
                );
              }
              return (
                // One mark: the wanted piece set in where the value leaves the
                // sequence; the value itself stays whole and readable.
                <li key={o.v} data-off-at={o.at} className="flex items-center gap-3 font-mono text-[14px]">
                  <span className="flex min-w-0 items-center overflow-hidden whitespace-pre">
                    {o.at > 0 ? <span className="shrink-0 text-ink">{o.v.slice(0, o.at)}</span> : null}
                    {wanted !== undefined ? <WantedChip face={face(wanted)} text={exampleOf(wanted)} title={name(wanted)} /> : null}
                    {rest ? (
                      <span className="min-w-0 truncate text-ink">
                        {rest}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted">{formatCount(o.n, lang)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
