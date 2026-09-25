/** The board's two code treemaps and the MMI distribution (edkjo
 *  2026-09-25). Data from the worker (`report-rows.ts`): the treemaps from
 *  `src/engine/code-tree.ts`, the MMI bars from the MMI row's fordeling and
 *  its accepted values (`godtatte`). Every cell and bar is a door: a click
 *  fills Scope and makes a chip, as any other number on the board does.
 *
 *  Colour is status only. Codes, classes and types are one neutral hue; a
 *  value the rule judged deviating is the avvik colour, an object with
 *  nothing the mangler colour. A PredefinedType fallback is hatched and
 *  captioned as what it is, so it never reads as a code. */

import { useLayoutEffect, useRef, useState } from "react";
import type { CodeTree, TreeNode } from "../../engine/code-tree";
import type { Requirement } from "../requirements";
import type { DoorProps } from "./Requirements";
import { t } from "../i18n";
import { serialiseFocus, type Focus } from "../trace";
import { formatCount } from "../format";
import { squarify, type Rect } from "./treemap";
import { StateBadge } from "./Requirements";
import { mmiBars, valueFocus } from "./req-view";

function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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

function place(nodes: TreeNode[], rect: Rect, depth: number, out: Placed[]) {
  const shown = nodes.map(collapse);
  const rects = squarify(
    shown.map((n) => n.n),
    rect,
  );
  shown.forEach((node, i) => {
    const r = rects[i];
    const frame = node.children.length > 1 && depth < 3 && r.w > 70 && r.h > HEADER + 24;
    out.push({ node, rect: r, depth, frame });
    if (frame) {
      place(
        node.children,
        { x: r.x + PAD, y: r.y + HEADER, w: Math.max(0, r.w - 2 * PAD), h: Math.max(0, r.h - HEADER - PAD) },
        depth + 1,
        out,
      );
    }
  });
}

function nodeVerdict(node: TreeNode): string | undefined {
  if (node.kind === "deviating") return "warn";
  if (node.kind === "missing") return "fail";
  return undefined;
}

export function CodeTreemap({ tree, ...door }: DoorProps & { tree: CodeTree }) {
  const { lang, selected, onFocus } = door;
  const { ref, box } = useBox();
  const placed: Placed[] = [];
  if (box && box.w > 0 && box.h > 0) place(tree.root, { x: 0, y: 0, w: box.w, h: box.h }, 0, placed);
  const label = (node: TreeNode) =>
    node.kind === "missing" ? t("req.mangler", lang) : (node.label ?? "—");
  return (
    <div ref={ref} data-treemap={tree.axis} className="relative min-h-0 flex-1 overflow-hidden">
      {placed.map(({ node, rect, depth, frame }) => {
        const focus: Focus = { kind: "tree", axis: tree.axis, key: node.key };
        const chosen = selected === serialiseFocus(focus);
        const title = [label(node), node.name, `×${node.n}`].filter(Boolean).join(" · ");
        const small = rect.w < 44 || rect.h < 22;
        return (
          <button
            key={node.key}
            type="button"
            data-tree-cell={node.key}
            data-kind={node.kind}
            data-verdict={nodeVerdict(node)}
            data-depth={depth}
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
            style={{ left: rect.x, top: rect.y, width: Math.max(0, rect.w - 1), height: Math.max(0, rect.h - 1) }}
          >
            {small ? null : (
              <span className="flex w-full min-w-0 items-baseline gap-1 px-1 pt-0.5 text-[10px] leading-tight">
                {node.kind === "fallback" ? (
                  <span className="shrink-0 font-mono opacity-70">{t("col.predefinedType", lang)}</span>
                ) : null}
                <span className="truncate font-mono font-semibold">{label(node)}</span>
                {node.name ? <span className="truncate opacity-75">{node.name}</span> : null}
                <span className="ml-auto shrink-0 font-mono tabular-nums opacity-70">{formatCount(node.n, lang)}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── MMI ────────────────────────────────────────────────────────────────── */

export function MmiChart({ req, ...door }: DoorProps & { req: Requirement }) {
  const { lang, selected, onFocus, model } = door;
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
  const bars = mmiBars(req);
  if (bars.length === 0) {
    return (
      <div ref={ref} data-mmi="no-values" className="flex min-h-0 flex-1 items-center justify-center">
        <StateBadge state={req.state} lang={lang} />
      </div>
    );
  }
  const peak = Math.max(1, ...bars.map((b) => b.n));
  // Columns while every level gets 26 px; else one row per level, read down,
  // which a narrow tile seats (and scrolls, past its height).
  const across = box !== null && box.w / bars.length >= 26;
  if (!across) {
    return (
      <div ref={ref} data-mmi="rows" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
        {bars.map((bar) => {
          const focus = bar.n > 0 ? valueFocus(row, bar.value, model) : null;
          const chosen = focus !== null && selected === serialiseFocus(focus);
          const text = bar.value === null ? t("req.mangler", lang) : bar.value;
          const verdict = bar.flag === "avvik" ? "warn" : bar.flag === "mangler" ? "fail" : undefined;
          const body = (
            <>
              <span className="w-[9ch] shrink-0 truncate font-mono text-[10px]" title={text}>
                {text}
              </span>
              <span className="flex h-2.5 min-w-0 flex-1 items-center">
                <span
                  data-verdict={verdict}
                  className="alt-bar alt-bar-row block h-full"
                  style={{ width: `${bar.n === 0 ? 0 : Math.max(1, (bar.n / peak) * 100)}%` }}
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
        const verdict = bar.flag === "avvik" ? "warn" : bar.flag === "mangler" ? "fail" : undefined;
        const body = (
          <>
            <span className="font-mono text-[10px] tabular-nums text-muted">{formatCount(bar.n, lang)}</span>
            <span className="flex w-full min-h-0 flex-1 items-end">
              <span
                data-verdict={verdict}
                className="alt-bar block w-full"
                style={{ height: `${bar.n === 0 ? 0 : Math.max(2, (bar.n / peak) * 100)}%` }}
              />
            </span>
            <span className="w-full truncate text-center font-mono text-[10px]" title={text}>
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
