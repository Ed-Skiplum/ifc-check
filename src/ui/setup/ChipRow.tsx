/** The chip row a string builder is edited in (2026-10-05): the TFM step's
 *  (`TfmBuilder.tsx`) and the type name's (`TypeNameStep.tsx`). Moved out of
 *  `TfmBuilder.tsx` whole, so both builders handle alike:
 *
 *   drag a chip          reorder (pointer events; the gap it lands in shows)
 *   ← → on a chip        move it one place
 *   Delete / Backspace   remove it
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
import { VERDICT_FILL } from "../state-visuals";
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
}: {
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
        className="relative"
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
            "flex min-h-20 cursor-grab touch-none flex-col justify-center gap-1 border-2 bg-input text-left select-none active:cursor-grabbing " +
            (f.part ? "items-start px-3 py-2 " : "items-center px-2 py-2 ") +
            (f.dashed ? "border-dashed " : "") +
            (editing ? "border-green " : f.bound ? "border-green/60 " : "border-line hover:border-green ") +
            (dragging ? "relative z-20 opacity-90 shadow-lg" : "transition-colors motion-reduce:transition-none")
          }
        >
          <span className="font-mono text-[22px] leading-none whitespace-pre text-ink">{text}</span>
          {f.sub ?? null}
          {f.extra ?? null}
        </button>
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
        <div data-tfm-chips className="flex min-w-0 flex-1 flex-wrap items-stretch gap-y-3">
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
                {wanted !== undefined ? <span className="shrink-0 text-[11px] text-muted">{name(wanted)}</span> : null}
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">{formatCount(o.n, lang)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
