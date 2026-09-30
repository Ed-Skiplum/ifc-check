/** The board's two code treemaps and the MMI distribution (edkjo
 *  2026-09-25). Data from the worker (`report-rows.ts`): the treemaps from
 *  `src/engine/code-tree.ts`, the MMI bars from the MMI row's fordeling and
 *  its accepted values (`godtatte`). Every cell and bar is a door: a click
 *  fills Scope and replaces the one filter, as any other number does.
 *
 *  Colour per group (2026-09-28, `../chart-colors.ts`): a class its class
 *  colour (the Graf tab's too), a code its top level's hue with children as
 *  steps of it, MMI levels an ordinal ramp. Status never owns a fill: a
 *  deviating value is an amber outline with its glyph, an object with
 *  nothing red hatching with its glyph. A PredefinedType fallback keeps a
 *  light hatch and its caption, so it never reads as a code.
 *
 *  Under a cross-filter from another view (`iso`) both charts are recomputed
 *  over the matching elements only (2026-09-28, one origin): a cell's count,
 *  volume and area are its elements in the set, a bar's height its elements
 *  in the set; cells and bars with none are not drawn. As the origin, a
 *  chart keeps everything and the tile dims all but the chosen item; `lit`
 *  marks the cells holding the chosen elements (a frame around the chosen
 *  cell, a cell inside a chosen frame). */

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { VERDICT_GLYPH } from "../state-visuals";
import { categorical, classColour, codeColour, css, frameColour, readableCell, type Rgb } from "../chart-colors";
import type { CodeTree, TreeNode } from "../../engine/code-tree";
import type { Requirement } from "../requirements";
import type { DoorProps } from "./Requirements";
import { locale, t, type Lang } from "../i18n";
import { serialiseFocus, type Focus } from "../trace";
import { formatCount, formatQuantity } from "../format";
import type { ElementQuantity, Measure, SourceSplit } from "../../engine/quantities";
import { measureReady, type BoardMeasures } from "../measure-state";
import { squarify, type Rect } from "./treemap";
import { StateBadge } from "./Requirements";
import { barLook, mmiBars, mmiBarsWithin, valueFocus } from "./req-view";
import { useSelectionMarks } from "../selection-context";

/** The box of whichever element the chart renders; a callback ref, so a
 *  chart that swaps its element (MMI columns and rows) keeps measuring the
 *  one on screen. */
function useBox() {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () =>
      setBox((prev) => (prev && prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { ref, box };
}

/* ── treemap ────────────────────────────────────────────────────────────── */

const HEADER = 16;
const PAD = 2;

interface Placed {
  node: TreeNode;
  rect: Rect;
  depth: number;
  /** A frame with children drawn inside it; else a leaf cell. */
  frame: boolean;
}

/** A single-child chain (2 → 24 → 243 with nothing beside it) shows as its
 *  deepest node, so a level adds a frame only where it groups something. */
function collapse(node: TreeNode): TreeNode {
  let n = node;
  while (n.children.length === 1) n = n.children[0];
  return n;
}

/** A node's size under the chosen measure. Count is `n`; volume and area
 *  are the node's summed known values (the worker's `measureTree`), so a
 *  node whose every element is missing has no area on screen and is told in
 *  the split under the map instead. */
type ValueOf = (node: TreeNode) => number;

function place(nodes: TreeNode[], rect: Rect, depth: number, out: Placed[], value: ValueOf) {
  const shown = nodes
    .map(collapse)
    .filter((n) => value(n) > 0)
    .sort((a, b) => value(b) - value(a));
  const rects = squarify(shown.map(value), rect);
  shown.forEach((node, i) => {
    const r = rects[i];
    const frame = node.children.filter((c) => value(c) > 0).length > 1 && depth < 3 && r.w > 70 && r.h > HEADER + 24;
    out.push({ node, rect: r, depth, frame });
    if (frame) {
      place(
        node.children,
        { x: r.x + PAD, y: r.y + HEADER, w: Math.max(0, r.w - 2 * PAD), h: Math.max(0, r.h - HEADER - PAD) },
        depth + 1,
        out,
        value,
      );
    }
  });
}

/** Antall / Volum / Areal, in the tile head, with the geometry pass as a thin
 *  bar under it while a measure still waits. */
export function MeasureSwitch({
  tree,
  measures,
  progress,
  measure,
  onMeasure,
  lang,
}: {
  tree: CodeTree;
  measures: BoardMeasures | undefined;
  progress: { done: number; total: number; complete: boolean } | undefined;
  measure: Measure;
  onMeasure: (m: Measure) => void;
  lang: Lang;
}) {
  const options: [Measure, string][] = [
    ["count", t("col.count", lang)],
    ["volume", t("measure.volume", lang)],
    ["area", t("measure.area", lang)],
  ];
  const waiting = !measureReady(tree, measures, "volume") || !measureReady(tree, measures, "area");
  const share = progress && progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <>
      <span className="ml-auto flex shrink-0 items-center gap-0.5" data-measure-switch={tree.axis}>
        {options.map(([m, label]) => {
          const ready = measureReady(tree, measures, m);
          return (
            <button
              key={m}
              type="button"
              data-measure={m}
              aria-pressed={measure === m}
              disabled={!ready}
              onClick={(event) => {
                event.stopPropagation();
                onMeasure(m);
              }}
              className="alt-tab alt-measure shrink-0 px-1.5 py-0.5"
            >
              {label}
            </button>
          );
        })}
      </span>
      {waiting ? (
        <span className="alt-measure-track" data-measure-progress={share.toFixed(3)}>
          <span className="alt-measure-bar" style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      ) : null}
    </>
  );
}

/** The source split under a volume or area map: Qto · beregnet · mangler,
 *  the parts that are not zero. */
export function SourceLine({ split, lang }: { split: SourceSplit; lang: Lang }) {
  const parts: string[] = [];
  if (split.qto) parts.push(`Qto ${formatCount(split.qto, lang)}`);
  if (split.computed) parts.push(`${t("object.derived", lang).toLocaleLowerCase(locale(lang))} ${formatCount(split.computed, lang)}`);
  if (split.missing) parts.push(`${t("req.mangler", lang)} ${formatCount(split.missing, lang)}`);
  return (
    <div data-measure-split className="shrink-0 truncate px-2 pb-1 pt-0.5 font-mono text-[10px] tabular-nums text-muted">
      {parts.join(" · ")}
    </div>
  );
}

function nodeVerdict(node: TreeNode): "warn" | "fail" | undefined {
  if (node.kind === "deviating") return "warn";
  if (node.kind === "missing") return "fail";
  return undefined;
}

/** A cell's fill and label colour (`chart-colors.ts`); none on a status
 *  cell, which the CSS draws as an outline or hatching. */
function cellStyle(node: TreeNode, frame: boolean): Record<string, string> {
  let fill: Rgb;
  if (node.kind === "code") fill = codeColour(node.label ?? "");
  else if (node.kind === "class") fill = classColour(node.label ?? "");
  else if (node.kind === "type" || node.kind === "fallback") fill = categorical(node.label ?? "");
  else return {};
  if (frame) fill = frameColour(fill);
  const cell = readableCell(fill);
  return { "--cell": css(cell.fill), "--cell-ink": css(cell.ink) };
}

/** A node's elements that are in `iso`, counted once per render. */
function isoCounter(iso: Set<string>) {
  const memo = new Map<string, string[]>();
  return (node: TreeNode): string[] => {
    let hit = memo.get(node.key);
    if (!hit) {
      hit = node.guids.filter((g) => iso.has(g));
      memo.set(node.key, hit);
    }
    return hit;
  };
}

export function CodeTreemap({
  tree,
  measure = "count",
  measures,
  iso = null,
  lit = null,
  quantities,
  ...door
}: DoorProps & {
  tree: CodeTree;
  measure?: Measure;
  measures?: BoardMeasures;
  /** The cross-filter from another view: draw only these elements. */
  iso?: Set<string> | null;
  /** This chart is the origin: the chosen elements, for `data-xf-in`. */
  lit?: Set<string> | null;
  /** Per element volume and area, for a measure over `iso`. */
  quantities?: Record<string, ElementQuantity>;
}) {
  const { lang, selected, onFocus } = door;
  const marks = useSelectionMarks();
  const { ref, box } = useBox();
  const ready = measure !== "count" && measureReady(tree, measures, measure);
  // Over `iso` a measure is summed per element, so it needs the elements'
  // own quantities; without them the chart honestly falls back to count.
  const m = ready && (!iso || quantities) ? measures?.[tree.axis] : undefined;
  const shown: Measure = m ? measure : "count";
  const at = shown === "area" ? 2 : 0;
  const inIso = iso ? isoCounter(iso) : null;
  const count = (node: TreeNode) => (inIso ? inIso(node).length : node.n);
  const sum = (node: TreeNode, missing: boolean): number => {
    let total = 0;
    for (const g of inIso!(node)) {
      const q = quantities?.[g];
      if (!q) continue;
      const src = q[at + 1] as number;
      const v = q[at];
      if (missing) total += src === 2 ? 1 : 0;
      else if (src < 2 && typeof v === "number") total += v;
    }
    return total;
  };
  const value: ValueOf = m
    ? inIso
      ? (node) => sum(node, false)
      : (node) => m.nodes[node.key]?.[at] ?? 0
    : count;
  const missingOf = (node: TreeNode) => (m ? (inIso ? sum(node, true) : (m.nodes[node.key]?.[at + 1] ?? 0)) : 0);
  const unit = shown === "area" ? "m²" : "m³";
  const figure = (node: TreeNode) => (m ? formatQuantity(value(node), unit, lang) : formatCount(count(node), lang));
  // The source split under the map, over `iso` when there is one.
  const split = (): SourceSplit | null => {
    if (!m) return null;
    if (!inIso) return m[shown as "volume" | "area"];
    const out: SourceSplit = { qto: 0, computed: 0, missing: 0, pending: 0 };
    for (const node of tree.root)
      for (const g of inIso(node)) {
        const src = quantities?.[g]?.[at + 1];
        if (src === 0) out.qto += 1;
        else if (src === 1) out.computed += 1;
        else if (src === 2) out.missing += 1;
        else out.pending += 1;
      }
    return out;
  };
  const placed: Placed[] = [];
  if (box && box.w > 0 && box.h > 0) place(tree.root, { x: 0, y: 0, w: box.w, h: box.h }, 0, placed, value);
  const label = (node: TreeNode) =>
    node.kind === "missing" ? t("req.mangler", lang) : (node.label ?? "—");
  return (
    <>
    <div ref={ref} data-treemap={tree.axis} data-measure-shown={shown} className="relative min-h-0 flex-1 overflow-hidden">
      {placed.map(({ node, rect, depth, frame }) => {
        const focus: Focus = { kind: "tree", axis: tree.axis, key: node.key };
        const chosen = selected === serialiseFocus(focus);
        const gone = missingOf(node);
        const title = [
          label(node),
          node.name,
          m ? figure(node) : null,
          `×${count(node)}`,
          gone ? `${t("req.mangler", lang)} ${gone}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const small = rect.w < 44 || rect.h < 22;
        const verdict = nodeVerdict(node);
        const glyph = verdict ? VERDICT_GLYPH[verdict] : null;
        return (
          <button
            key={node.key}
            type="button"
            data-tree-cell={node.key}
            data-kind={node.kind}
            data-verdict={verdict}
            data-depth={depth}
            data-xf-in={lit && node.guids.some((g) => lit.has(g)) ? "" : undefined}
            data-sel={marks.size > 0 && marks.any(node.guids) ? "ring" : undefined}
            title={title}
            onClick={(event) => {
              event.stopPropagation();
              onFocus(focus);
            }}
            className={
              "alt-cell absolute flex flex-col items-start overflow-hidden text-left " +
              (frame ? "alt-cell-frame " : "") +
              (chosen ? "alt-chosen" : "")
            }
            style={
              {
                ...cellStyle(node, frame),
                left: rect.x,
                top: rect.y,
                width: Math.max(0, rect.w - 1),
                height: Math.max(0, rect.h - 1),
              } as CSSProperties
            }
          >
            {small ? (
              glyph && rect.w >= 12 && rect.h >= 12 ? (
                <span aria-hidden className="m-auto text-[10px] leading-none font-semibold">
                  {glyph}
                </span>
              ) : null
            ) : (
              <span className="flex w-full min-w-0 items-baseline gap-1 px-1 pt-0.5 text-[10px] leading-tight">
                {glyph ? (
                  <span aria-hidden className="shrink-0 font-semibold">
                    {glyph}
                  </span>
                ) : null}
                {/* The value only: the header names the field (a fallback
                    is marked by its hatch). No opacity on a label: at 10 px
                    it took the ink under 4.5:1 (2026-09-30 review). */}
                <span className="truncate font-mono font-semibold">{label(node)}</span>
                {node.name ? <span className="truncate">{node.name}</span> : null}
                <span className="ml-auto shrink-0 font-mono tabular-nums">{figure(node)}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
    {m ? <SourceLine split={split()!} lang={lang} /> : null}
    </>
  );
}

/* ── MMI ────────────────────────────────────────────────────────────────── */

export function MmiChart({ req, iso = null, ...door }: DoorProps & { req: Requirement; iso?: Set<string> | null }) {
  const { lang, selected, onFocus, model } = door;
  const marks = useSelectionMarks();
  const { ref, box } = useBox();
  const row = req.row;
  if (!row || req.state === "not_configured") {
    // The owner's wording, and nothing else (2026-09-25).
    return (
      <div ref={ref} data-mmi="not-configured" className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted">
        {t("mmi.notConfigured", lang)}
      </div>
    );
  }
  const bars = iso ? mmiBarsWithin(req, model, iso) : mmiBars(req);
  if (bars.length === 0 && iso) return <div ref={ref} data-mmi="none-in-filter" className="min-h-0 flex-1" />;
  if (bars.length === 0) {
    return (
      <div ref={ref} data-mmi="no-values" className="flex min-h-0 flex-1 items-center justify-center">
        <StateBadge state={req.state} lang={lang} />
      </div>
    );
  }
  const peak = Math.max(1, ...bars.map((b) => b.n));
  // The ramp of the whole scale, so a level keeps its shade under a filter.
  const look = barLook(iso ? mmiBars(req) : bars);
  // Columns while every level gets 26 px; else one row per level, read down,
  // which a narrow tile seats (and scrolls, past its height).
  // A strip (one module tall, the canon's named exception) always reads
  // across: rows would show three levels of nine.
  const across = box !== null && (box.w / bars.length >= 26 || box.h < 140);
  if (!across) {
    return (
      <div ref={ref} data-mmi="rows" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
        {bars.map((bar) => {
          const focus = bar.n > 0 ? valueFocus(row, bar.value, model) : null;
          const chosen = focus !== null && selected === serialiseFocus(focus);
          const text = bar.value === null ? t("req.mangler", lang) : bar.value;
          const { verdict, glyph, style } = look(bar);
          const body = (
            <>
              <span className="w-[9ch] shrink-0 truncate font-mono text-[10px]" title={text}>
                {glyph ? <span aria-hidden className="mr-0.5 font-semibold">{glyph}</span> : null}
                {text}
              </span>
              <span className="flex h-2.5 min-w-0 flex-1 items-center">
                <span
                  data-verdict={verdict}
                  className="alt-bar alt-bar-row block h-full"
                  style={{ ...style, width: `${bar.n === 0 ? 0 : Math.max(1, (bar.n / peak) * 100)}%` } as CSSProperties}
                />
              </span>
              <span className="w-[6ch] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
                {formatCount(bar.n, lang)}
              </span>
            </>
          );
          const cls = "flex h-5 shrink-0 items-center gap-2 rounded-[4px] px-1 " + (chosen ? "alt-chosen" : "");
          return focus ? (
            <button
              key={String(bar.value)}
              type="button"
              data-mmi-bar={bar.value ?? "-"}
              data-sel={marks.focus(focus) ? "" : undefined}
              title={`${text} ×${bar.n}`}
              onClick={() => onFocus(focus)}
              className={`${cls} alt-hover text-left`}
            >
              {body}
            </button>
          ) : (
            <span key={String(bar.value)} data-mmi-bar={bar.value ?? "-"} title={`${text} ×${bar.n}`} className={cls}>
              {body}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <div ref={ref} data-mmi="bars" className="flex min-h-0 flex-1 items-stretch gap-1 overflow-x-auto px-3 pt-2 pb-1">
      {bars.map((bar) => {
        const focus = bar.n > 0 ? valueFocus(row, bar.value, model) : null;
        const chosen = focus !== null && selected === serialiseFocus(focus);
        const text = bar.value === null ? t("req.mangler", lang) : bar.value;
        const { verdict, glyph, style } = look(bar);
        const body = (
          <>
            <span className="font-mono text-[10px] tabular-nums text-muted">{formatCount(bar.n, lang)}</span>
            <span className="flex w-full min-h-0 flex-1 items-end">
              <span
                data-verdict={verdict}
                className="alt-bar block w-full"
                style={{ ...style, height: `${bar.n === 0 ? 0 : Math.max(2, (bar.n / peak) * 100)}%` } as CSSProperties}
              />
            </span>
            <span className="w-full truncate text-center font-mono text-[10px]" title={text}>
              {glyph ? <span aria-hidden className="mr-0.5 font-semibold">{glyph}</span> : null}
              {text}
            </span>
          </>
        );
        const cls =
          "flex min-w-[28px] flex-1 basis-0 flex-col items-center gap-1 rounded-[4px] px-0.5 " + (chosen ? "alt-chosen" : "");
        return focus ? (
          <button
            key={String(bar.value)}
            type="button"
            data-mmi-bar={bar.value ?? "-"}
            data-sel={marks.focus(focus) ? "" : undefined}
            title={`${text} ×${bar.n}`}
            onClick={() => onFocus(focus)}
            className={`${cls} alt-hover`}
          >
            {body}
          </button>
        ) : (
          <span key={String(bar.value)} data-mmi-bar={bar.value ?? "-"} title={`${text} ×${bar.n}`} className={cls}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
