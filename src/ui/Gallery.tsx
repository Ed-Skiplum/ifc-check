/** The gallery surface of the Typer and Materialer tabs (2026-09-26).
 *
 * Owner: "the types and materials tabs need to be galleries, not rows."
 *
 * The cards sit on the module grid of the layout canon
 * (`resources/design-system/data-workspace.md`, LAYOUT SYSTEM): a square
 * module of about 100 px, a 16 px gap, columns by the rule-6 formula on the
 * gallery's OWN width, so a wider window gets more cards, never fatter ones.
 * A gallery is one uniform collection, so every card in it takes the same
 * canon size (`unit`, in modules): rule 2's proportional sizing is for
 * composed dashboards. The columns are trimmed to a whole number of cards and
 * the run is centred, so the grid is fully tiled edge to edge. Overflow
 * scrolls inside the tab, never the page.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { MG_GAP, MG_MODULE } from "./alt/module-grid";

export function Gallery({
  unit,
  children,
  label,
}: {
  /** The card's canon size in modules: S [2, 2], M [3, 2]. */
  unit: readonly [number, number];
  /** Or a function of how many cards fit across, for a card that grows. */
  children: ReactNode | ((across: number) => ReactNode);
  label?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Rule 6 on the gallery's own content box (its padding is the margin).
  const inner = Math.max(0, width - 2 * MG_GAP);
  const cols = Math.max(unit[0], Math.round((inner + MG_GAP) / (MG_MODULE + MG_GAP)));
  const u = (inner - (cols - 1) * MG_GAP) / cols;
  const cards = Math.max(1, Math.floor(cols / unit[0]));
  const cardW = unit[0] * u + (unit[0] - 1) * MG_GAP;
  const cardH = unit[1] * u + (unit[1] - 1) * MG_GAP;

  return (
    <div
      ref={scroller}
      data-gallery={label}
      data-gallery-grid={width > 0 ? `${cols},${u.toFixed(2)},${unit[0]}x${unit[1]}` : undefined}
      className="min-h-0 flex-1 overflow-auto"
      style={{ padding: MG_GAP }}
    >
      {width > 0 ? (
        <div
          className="grid justify-center"
          style={{
            gap: MG_GAP,
            gridTemplateColumns: `repeat(${cards}, ${cardW}px)`,
            gridAutoRows: `${cardH}px`,
            // A grown card leaves holes before it; the cards after fill them.
            gridAutoFlow: "row dense",
          }}
        >
          {typeof children === "function" ? children(cards) : children}
        </div>
      ) : null}
    </div>
  );
}

/** One card: a floating glass tile. A door when `onClick` is given.
 *
 * A door is a `div` with the button role rather than a `<button>`, because a
 * card can carry doors of its own (the link chips, the instance controls) and
 * a button inside a button is not valid HTML. Enter and Space open it when the
 * card itself has focus; a click on an inner control stops there.
 *
 * `span` is the card's size in gallery cells, for the one card that grows (the
 * open type, 2026-09-28). */
export function GalleryCard({
  children,
  onClick,
  active,
  title,
  span,
  cardRef,
  data,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  span?: readonly [number, number];
  cardRef?: Ref<HTMLDivElement>;
  data?: Record<`data-${string}`, string | number | undefined>;
}) {
  const className =
    "gallery-card flex min-h-0 min-w-0 flex-col overflow-hidden text-left" +
    (onClick ? " gallery-door cursor-pointer" : "");
  const style = span ? { gridColumn: `span ${span[0]}`, gridRow: `span ${span[1]}` } : undefined;
  return (
    <div
      ref={cardRef}
      title={title}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-current={onClick && active ? "true" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              onClick();
            }
          : undefined
      }
      className={className}
      style={style}
      {...data}
    >
      {children}
    </div>
  );
}

/** A link to another card: the other end of "what goes with what". A small
 *  pill carrying the name and how many elements carry both ends. */
export function LinkChip({
  label,
  n,
  title,
  onOpen,
  data,
}: {
  label: string;
  n: number;
  title?: string;
  onOpen: () => void;
  data?: Record<`data-${string}`, string | number | undefined>;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-full border border-line bg-panel/70 px-1.5 py-px font-mono text-[10px] leading-[14px] text-ink hover:border-ink"
      {...data}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-muted tabular-nums">{n}</span>
    </button>
  );
}

/** The honest mark for "no geometry for this type": a dashed cube outline,
 *  unmistakably not a render (the sprucelab TypeMesh placeholder). */
export function NoGeometryMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="text-muted/70">
      <path
        d="M24 4 4 14v20l20 10 20-10V14L24 4Z M24 4v20 M4 14l20 10 20-10 M24 44V24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeDasharray="3 3"
      />
    </svg>
  );
}

