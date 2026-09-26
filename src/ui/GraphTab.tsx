/** The Graf tab: the model as a space you drill into, with the 3D beside it.
 *
 * ── What it draws ────────────────────────────────────────────────────────
 * `graph-model.ts`: the ifcfast demo's drill (building -> storey -> class
 * bucket -> product), with the selected element's relationships blooming out
 * of its node. Only edges the engine really carries; see that file.
 *
 * ── How it looks ─────────────────────────────────────────────────────────
 * `graph-paint.ts`: a dark, deep field, glowing round nodes sized by weight,
 * luminous threads, depth and parallax, ambient drift, and a selection that
 * lights its neighbourhood while the rest falls back. Canvas 2D, so the
 * drawing is one element and the frame loop owns every pixel of it.
 *
 * ── How it behaves (the demo's interaction model) ────────────────────────
 *   · click a storey: it opens into its class buckets, and the storey becomes
 *     the filter (an Etasje chip, the same click as the board's storey row)
 *   · click a bucket: it opens into its products, and storey × class becomes
 *     the filter (a Celle chip, the same click as the census cell)
 *   · click a product: it is selected, exactly as a table row selects; its
 *     relationships bloom out of it. Shift or Ctrl adds to the selection.
 *   · click the empty field: the selection clears
 *   · drag a node: it moves and stays put; drag the field: pan; wheel: zoom
 *     about the pointer. A press that moves is never a click.
 *   · `Tøm alle` folds every drill back to the crown
 *
 * Positions carry across rebuilds, so opening a storey or picking an element
 * moves the picture rather than replacing it: new nodes are born at the node
 * they grow out of. Start positions are an FNV hash of the node id and there
 * is no randomness, so the same drill settles the same way every time.
 *
 * ── The 3D beside it ─────────────────────────────────────────────────────
 * edkjo: *"lets add the viewer here as well … toggle between model and graph
 * as main and the other windowed"*. The board's own scene is lent to the tab
 * (`viewer/dock.ts`) rather than a second one mounted: one GPU copy of the
 * model, one selection. `Modell | Graf` says which surface is main; the other
 * sits in a window in the corner, still live.
 *
 * 2026-09-26, the canvas aspect rule (`canvas-aspect.ts`): both surfaces stay
 * inside 9:16 to 16:9. The tab's field is wider than 16:9 on every desktop
 * screen, so there the main takes the widest 16:9 box and the other sits
 * beside it in the column left over, not over its corner.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { MicroLabel } from "./BentoGrid";
import { Switch } from "./Switch";
import type { ModelProfile } from "./profile";
import type { Design } from "./useHashView";
import type { Focus } from "./trace";
import type { CheckResult } from "../engine/types";
import type { MeshBatch } from "../viewer/mesh-stream";
import { findDock, onDocksChanged } from "../viewer/dock";
import { graphFieldLayout, type FieldRect } from "./canvas-aspect";
import { MG_GAP, MG_MARGIN, graphTiles, mgGrid, mgSpanPx, type MgGrid } from "./alt/module-grid";
import { GraphSim, fitView, seedOf, seededOffset, toSim, zoomAt, type GraphView } from "./graph-sim";
import {
  buildDrill,
  groupId,
  indexProfile,
  storeyId,
  storeyKeyOf,
  tonesOf,
  type Drill,
} from "./graph-model";
import {
  FIELD_BACKGROUND,
  LABEL_RANK,
  colourOf,
  coreSprite,
  glowSprite,
  radiusOf,
  readPalette,
  rgba,
  toneColour,
  type Palette,
  type Rgb,
} from "./graph-paint";

type Main = "graph" | "model";

declare global {
  interface Window {
    /** Graph probes, in mount order. Read only by the headless scripts. */
    __ifcCheckGraphs?: (() => {
      id: string;
      kind: string;
      label: string;
      count: number | null;
      x: number | null;
      y: number | null;
    }[])[];
  }
}

/** Per-node render state, rebuilt with the drill. */
interface Look {
  r: Float32Array;
  zSeed: Float32Array;
  z: Float32Array;
  phase: Float32Array;
  colour: Rgb[];
  /** Screen position and radius as last drawn, for hit testing. */
  sx: Float32Array;
  sy: Float32Array;
  sr: Float32Array;
  adjacency: number[][];
  edgeA: Int32Array;
  edgeB: Int32Array;
}

const HOP_DEPTH = [0, 0.12, 0.42, 0.72];

function hopsFrom(sources: number[], adjacency: number[][], n: number): Int16Array {
  const hops = new Int16Array(n).fill(-1);
  const queue: number[] = [];
  for (const s of sources) {
    if (s >= 0 && hops[s] < 0) {
      hops[s] = 0;
      queue.push(s);
    }
  }
  for (let q = 0; q < queue.length; q += 1) {
    const i = queue[q];
    if (hops[i] >= 3) continue;
    for (const j of adjacency[i]) {
      if (hops[j] < 0) {
        hops[j] = hops[i] + 1;
        queue.push(j);
      }
    }
  }
  return hops;
}

export function GraphTab({
  lang,
  design,
  profile,
  checks,
  meshBatches,
  selection,
  onPick,
  onFocus,
}: {
  lang: Lang;
  design: Design | null;
  profile: ModelProfile | null;
  /** The model's check results, for the verdict colours. */
  checks?: CheckResult[];
  /** The key the board's 3D scene is lent under (`viewer/dock.ts`). */
  meshBatches?: MeshBatch[];
  /** The panel's `view.selection`. The FIRST guid is the one whose
   *  relationships are drawn. */
  selection: string[];
  onPick: (guid: string | null, additive: boolean) => void;
  /** The board's own click: a storey or a storey × class becomes the filter. */
  onFocus?: (focus: Focus) => void;
}) {
  const [psets, setPsets] = useState(true);
  const [quantities, setQuantities] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [main, setMain] = useState<Main>("graph");
  const [shown, setShown] = useState(false);
  const [fieldSize, setFieldSize] = useState<{ w: number; h: number } | null>(null);
  const [, bumpDocks] = useState(0);

  const field = useRef<HTMLDivElement>(null);
  const graphBox = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerSlot = useRef<HTMLDivElement>(null);

  const centreGuid = selection.length > 0 ? selection[0] : null;

  const index = useMemo(() => (profile ? indexProfile(profile) : null), [profile]);
  const tones = useMemo(() => tonesOf(checks), [checks]);

  // The field is `hidden` while another tab is active: nothing runs then.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      setShown((current) => (current === visible ? current : visible));
      if (visible) {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        setFieldSize((current) => (current && current.w === w && current.h === h ? current : { w, h }));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The design alternatives: the two surfaces are XL tiles on the window's
  // module grid (the layout canon, 2026-09-26), measured as the Kontroll
  // board measures it.
  const gridWrap = useRef<HTMLDivElement>(null);
  const [mg, setMg] = useState<MgGrid | null>(null);
  useLayoutEffect(() => {
    const el = gridWrap.current;
    if (!design || !el || typeof ResizeObserver === "undefined") return;
    const main = el.closest("main");
    const measure = () => {
      if (!main || el.getBoundingClientRect().width === 0) return;
      const panel = el.closest("main > section") ?? el;
      const above = el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      const padTop = parseFloat(getComputedStyle(main).paddingTop) || 0;
      const next = mgGrid(main.clientWidth, main.clientHeight - padTop - above + MG_MARGIN);
      setMg((prev) =>
        prev && prev.cols === next.cols && prev.rows === next.rows && Math.abs(prev.u - next.u) < 0.01 ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (main) observer.observe(main);
    return () => observer.disconnect();
  }, [design]);

  // A selection made elsewhere (the 3D, a table) drills to where it lives, so
  // its node exists and its relationships can bloom.
  useEffect(() => {
    if (!centreGuid || !index) return;
    const row = index.byId.get(centreGuid);
    if (!row) return;
    const key = storeyKeyOf(row, index.known);
    const path = [storeyId(key), groupId(key, row.entity)];
    setExpanded((current) => {
      if (path.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of path) next.add(id);
      return next;
    });
  }, [centreGuid, index]);

  const drill = useMemo<Drill>(() => {
    if (!profile || !index || !shown) return { nodes: [], edges: [] };
    return buildDrill(profile, index, tones, expanded, centreGuid, { psets, quantities }, lang);
  }, [profile, index, tones, expanded, centreGuid, psets, quantities, lang, shown]);

  /* ── The viewer, borrowed ──────────────────────────────────────────────── */

  useEffect(() => onDocksChanged(() => bumpDocks((n) => n + 1)), []);
  const dock = findDock(meshBatches);
  const hasViewer = dock !== null;
  const graphIsMain = main === "graph" || !hasViewer;

  useLayoutEffect(() => {
    const slot = viewerSlot.current;
    if (!dock || !slot || !shown) return;
    slot.appendChild(dock.canvas);
    const size = () => {
      const rect = slot.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) dock.scene.resize(rect.width, rect.height);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(slot);
    return () => {
      observer.disconnect();
      dock.restore();
    };
  }, [dock, shown]);

  /* ── The live part ─────────────────────────────────────────────────────
   * React owns what exists; the frame loop owns where it is and how it
   * looks. Everything below is refs. */

  const simRef = useRef<GraphSim | null>(null);
  const lookRef = useRef<Look | null>(null);
  const drillRef = useRef<Drill>(drill);
  const viewRef = useRef<GraphView>({ k: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const paletteRef = useRef<Palette | null>(null);
  const carried = useRef(new Map<string, { x: number; y: number; pinned: boolean }>());
  const framed = useRef(false);
  const dragging = useRef<{ index: number; moved: boolean; x: number; y: number } | null>(null);
  const panning = useRef<{ x: number; y: number; moved: boolean; sx: number; sy: number } | null>(null);
  const hovered = useRef(-1);
  const pointer = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const selHops = useRef<Int16Array>(new Int16Array(0));
  const hoverHops = useRef<Int16Array>(new Int16Array(0));
  const selected = useRef(new Set<number>());
  const raf = useRef(0);
  const shownRef = useRef(false);
  const textWidth = useRef(new Map<string, number>());
  const drillRefIds = useRef<Map<string, number> | null>(null);
  const expandedRef = useRef(expanded);

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    shownRef.current = shown;
    expandedRef.current = expanded;
  }, [shown, expanded]);

  // The palette reads the page's tokens, so it follows the design direction.
  useEffect(() => {
    const element = field.current;
    if (!element || !index) return;
    paletteRef.current = readPalette(element, design !== null, index.entities);
  }, [design, index]);

  const recomputeFocus = useCallback(() => {
    const look = lookRef.current;
    const nodes = drillRef.current.nodes;
    if (!look) return;
    const picked = new Set(selection);
    const chosen = new Set<number>();
    nodes.forEach((node, i) => {
      if (node.guid && picked.has(node.guid)) chosen.add(i);
    });
    selected.current = chosen;
    const centre = nodes.findIndex((node) => node.guid !== undefined && node.guid === centreGuid);
    selHops.current = hopsFrom(centre >= 0 ? [centre] : [], look.adjacency, nodes.length);
    hoverHops.current = hopsFrom([hovered.current], look.adjacency, nodes.length);
  }, [selection, centreGuid]);

  /* ── Drawing ───────────────────────────────────────────────────────────── */

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const sim = simRef.current;
      const look = lookRef.current;
      const palette = paletteRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !sim || !look || !palette) return;
      const { w, h, dpr } = sizeRef.current;
      const nodes = drillRef.current.nodes;
      const edges = drillRef.current.edges;
      const n = nodes.length;
      const view = viewRef.current;
      const sel = selHops.current;
      const hov = hoverHops.current;
      const hasSel = sel.some((v) => v >= 0);
      const hasHover = hovered.current >= 0;
      const motion = reducedMotion ? 0 : 1;
      /** An edge the selection fires along: out of the selected node, and on
       *  from a neighbour that is not itself a hub (a bucket's hundreds of
       *  products are its members, not the selection's neighbourhood). */
      const firing = (a: number, b: number) => {
        const ha = sel[a];
        const hb = sel[b];
        if (ha < 0 || hb < 0 || Math.abs(ha - hb) !== 1) return false;
        const low = ha < hb ? a : b;
        const hop = Math.min(ha, hb);
        if (hop === 0) return true;
        return hop === 1 && look.adjacency[low].length <= 24;
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Depth: every node eases toward its target z, so a new focus sinks the
      // rest of the space back rather than cutting to it.
      for (let i = 0; i < n; i += 1) {
        let target = look.zSeed[i] * 0.55;
        if (hasSel || hasHover) {
          const hs = sel[i] ?? -1;
          const hh = hov[i] ?? -1;
          const hop = hs < 0 ? hh : hh < 0 ? hs : Math.min(hs, hh);
          const depth = hop < 0 ? 1 : HOP_DEPTH[Math.min(3, hop)];
          target = Math.min(1, depth + look.zSeed[i] * 0.2);
        }
        look.z[i] += (target - look.z[i]) * 0.12;
      }

      // Screen positions: the view, the parallax against the pointer, and a
      // slow drift, all stronger for what is nearer.
      const px = pointer.current.px;
      const py = pointer.current.py;
      for (let i = 0; i < n; i += 1) {
        const node = sim.nodes[i];
        const near = 0.5 - look.zSeed[i];
        const ph = look.phase[i];
        const drift = motion * (1.4 + look.zSeed[i] * 1.6);
        look.sx[i] =
          node.x * view.k + view.tx + px * near * 14 + Math.sin(now * 0.00041 + ph) * drift;
        look.sy[i] =
          node.y * view.k + view.ty + py * near * 10 + Math.cos(now * 0.00037 + ph * 1.7) * drift;
        look.sr[i] = look.r[i] * (1 - 0.38 * look.z[i]);
      }

      ctx.globalCompositeOperation = "lighter";

      // Edges: threads that fade with length and depth, bucketed by opacity so
      // two thousand of them are a handful of strokes.
      const LEVELS = 8;
      const plain: number[][] = Array.from({ length: LEVELS }, () => []);
      const lit: number[] = [];
      for (let e = 0; e < look.edgeA.length; e += 1) {
        const a = look.edgeA[e];
        const b = look.edgeB[e];
        if (a < 0 || b < 0) continue;
        const inFocus = hasSel && firing(a, b);
        const inHover = hasHover && (hov[a] === 0 || hov[b] === 0);
        if (inFocus || inHover) {
          lit.push(e);
          continue;
        }
        const len = Math.hypot(look.sx[b] - look.sx[a], look.sy[b] - look.sy[a]);
        const lenFade = 1 / (1 + len / 260);
        const depth = 1 - 0.7 * Math.max(look.z[a], look.z[b]);
        const alpha = 0.42 * lenFade * depth * (hasSel ? 0.55 : 1);
        const level = Math.min(LEVELS - 1, Math.floor(alpha * LEVELS * 2));
        plain[level].push(e);
      }
      ctx.lineWidth = 0.8;
      for (let level = 0; level < LEVELS; level += 1) {
        const bucket = plain[level];
        if (bucket.length === 0) continue;
        ctx.strokeStyle = rgba(palette.edge, (level + 0.5) / (LEVELS * 2));
        ctx.beginPath();
        for (const e of bucket) {
          ctx.moveTo(look.sx[look.edgeA[e]], look.sy[look.edgeA[e]]);
          ctx.lineTo(look.sx[look.edgeB[e]], look.sy[look.edgeB[e]]);
        }
        ctx.stroke();
      }
      if (lit.length > 0) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(palette.accent, 0.55);
        ctx.beginPath();
        for (const e of lit) {
          ctx.moveTo(look.sx[look.edgeA[e]], look.sy[look.edgeA[e]]);
          ctx.lineTo(look.sx[look.edgeB[e]], look.sy[look.edgeB[e]]);
        }
        ctx.stroke();
      }

      // Nodes, far to near: a glow, then a lit body. Far nodes lose the crisp
      // body and keep only the glow — the blur of what is out of focus.
      const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => look.z[q] - look.z[p]);
      for (const i of order) {
        const node = nodes[i];
        const z = look.z[i];
        const r = look.sr[i];
        const x = look.sx[i];
        const y = look.sy[i];
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
        const toned = node.tone !== null && node.kind === "product";
        const floor = toned ? 0.6 : 0.16;
        const alpha = Math.max(floor, 1 - 0.78 * z);
        const colour = look.colour[i];
        const glowR = r * (3.2 + 2.4 * z);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha * (node.kind === "product" ? 0.7 : 0.9);
        ctx.drawImage(glowSprite(colour), x - glowR, y - glowR, glowR * 2, glowR * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha * (1 - 0.55 * z);
        if (node.kind === "site") {
          ctx.strokeStyle = rgba(colour, 0.8);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.drawImage(coreSprite(colour), x - r, y - r, r * 2, r * 2);
        }
        // A bucket or storey that holds findings carries the verdict as a
        // thin ring, so the colour reads before the drill is opened.
        if (node.tone && node.kind !== "product") {
          ctx.strokeStyle = rgba(toneColour(node.tone, palette), 0.9);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, r + 2.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (selected.current.has(i)) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "lighter";
          const pulse = 1 + 0.18 * Math.sin(now * 0.004) * motion;
          const halo = (r + 10) * pulse;
          ctx.drawImage(glowSprite(palette.accent), x - halo * 1.8, y - halo * 1.8, halo * 3.6, halo * 3.6);
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = rgba(palette.accent, 1);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Synapses: pulses running outward from the selection, hop by hop.
      if (motion && hasSel) {
        ctx.globalCompositeOperation = "lighter";
        const spark = glowSprite(palette.accent);
        let drawn = 0;
        for (let e = 0; e < look.edgeA.length && drawn < 360; e += 1) {
          const a = look.edgeA[e];
          const b = look.edgeB[e];
          const ha = sel[a];
          const hb = sel[b];
          if (!firing(a, b)) continue;
          const from = ha < hb ? a : b;
          const to = ha < hb ? b : a;
          const hop = Math.min(ha, hb);
          const f = (((now / 1500 - hop * 0.33 + look.phase[to] * 0.05) % 1) + 1) % 1;
          const x = look.sx[from] + (look.sx[to] - look.sx[from]) * f;
          const y = look.sy[from] + (look.sy[to] - look.sy[from]) * f;
          const s = 7 * (1 - f * 0.5);
          ctx.globalAlpha = 0.9 * (1 - f * 0.6);
          ctx.drawImage(spark, x - s, y - s, s * 2, s * 2);
          drawn += 1;
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";

      // Labels: the crown always, a bucket once there is room, and everything
      // in the focus. A collision pass in rank order decides which are drawn.
      const font = palette.mono;
      const measure = (text: string, size: number) => {
        const key = `${size}|${text}`;
        let width = textWidth.current.get(key);
        if (width === undefined) {
          ctx.font = `500 ${size}px ${font}`;
          width = ctx.measureText(text).width;
          textWidth.current.set(key, width);
        }
        return width;
      };
      const clip = (text: string, max: number) =>
        text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
      const candidates: { i: number; rank: number; text: string; size: number }[] = [];
      for (let i = 0; i < n; i += 1) {
        const node = nodes[i];
        const hs = sel[i] ?? -1;
        const focus = (hs >= 0 && hs <= 1) || selected.current.has(i);
        let show = false;
        if (node.kind === "building" || node.kind === "site" || node.kind === "storey" || node.kind === "bucket") {
          show = true;
        } else if (node.kind === "group") {
          show = view.k >= 0.9 || focus || expandedRef.current.has(node.id);
        } else if (node.kind === "product") {
          show = selected.current.has(i);
        } else {
          show = focus || hs === 2;
        }
        if (!show || i === hovered.current) continue;
        const rank = LABEL_RANK[node.kind] + (focus ? 100 : 0) + (selected.current.has(i) ? 50 : 0);
        candidates.push({ i, rank, text: clip(node.label, 26), size: node.kind === "group" ? 9 : 10 });
      }
      candidates.sort((p, q) => q.rank - p.rank);
      const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const free = (box: { x0: number; y0: number; x1: number; y1: number }) =>
        box.x0 > 2 &&
        box.x1 < w - 2 &&
        box.y0 > 2 &&
        box.y1 < h - 2 &&
        !boxes.some((o) => box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      for (const c of candidates.slice(0, 220)) {
        const width = measure(c.text, c.size);
        const x = look.sx[c.i];
        const y = look.sy[c.i] - look.sr[c.i] - 5;
        const box = { x0: x - width / 2 - 2, y0: y - c.size, x1: x + width / 2 + 2, y1: y + 3 };
        if (!free(box)) continue;
        boxes.push(box);
        const a = Math.max(0.45, 1 - 0.7 * look.z[c.i]);
        ctx.font = `500 ${c.size}px ${font}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette.outline;
        ctx.globalAlpha = a;
        ctx.strokeText(c.text, x, y);
        ctx.fillStyle = rgba(palette.label, 1);
        ctx.fillText(c.text, x, y);
      }
      ctx.globalAlpha = 1;

      // The relationship each lit edge IS, where the edge is long enough.
      if (hasSel) {
        ctx.font = `400 8.5px ${font}`;
        for (const e of lit) {
          const edge = edges[e];
          if (!edge.label) continue;
          const a = look.edgeA[e];
          const b = look.edgeB[e];
          const ax = look.sx[a];
          const ay = look.sy[a];
          const bx = look.sx[b];
          const by = look.sy[b];
          const len = Math.hypot(bx - ax, by - ay);
          const width = measure(edge.label, 8.5);
          if (len < width + 40) continue;
          const x = ax + (bx - ax) * 0.55;
          const y = ay + (by - ay) * 0.55;
          const half = width / 2;
          const box = { x0: x - half, y0: y - half - 4, x1: x + half, y1: y + half };
          if (!free(box)) continue;
          boxes.push(box);
          let angle = Math.atan2(by - ay, bx - ax);
          if (angle > Math.PI / 2) angle -= Math.PI;
          if (angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.lineWidth = 3;
          ctx.strokeStyle = palette.outline;
          ctx.strokeText(edge.label, 0, -3);
          ctx.fillStyle = rgba(palette.accent, 0.95);
          ctx.fillText(edge.label, 0, -3);
          ctx.restore();
        }
      }

      // The hovered node says what it is: the demo's tip, drawn in place.
      const hi = hovered.current;
      if (hi >= 0 && hi < n) {
        const text = clip(nodes[hi].tip, 64);
        ctx.font = `500 11px ${font}`;
        const width = ctx.measureText(text).width;
        let x = look.sx[hi] + 12;
        let y = look.sy[hi] - look.sr[hi] - 22;
        if (x + width + 12 > w) x = w - width - 12;
        if (y < 4) y = look.sy[hi] + look.sr[hi] + 8;
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(14, 12, 10, 0.86)";
        ctx.strokeStyle = rgba(look.colour[hi], 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - 6, y - 1, width + 12, 18, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = rgba(palette.label, 1);
        ctx.fillText(text, x, y + 12);
      }
    },
    [reducedMotion],
  );

  const frame = useCallback(
    function step(now: number) {
      raf.current = 0;
      const sim = simRef.current;
      if (!sim || !shownRef.current || document.hidden) return;
      const held = dragging.current !== null;
      if (sim.running || held) sim.tick();

      // The drawing frames itself while it settles, until the reader takes
      // the view (a pan, a wheel, a drag).
      let moving = false;
      const { w, h } = sizeRef.current;
      if (!framed.current && w > 0) {
        const target = fitView(sim.bounds(), w, h);
        const view = viewRef.current;
        const rate = sim.running ? 0.12 : 0.25;
        const k = view.k + (target.k - view.k) * rate;
        const tx = view.tx + (target.tx - view.tx) * rate;
        const ty = view.ty + (target.ty - view.ty) * rate;
        moving =
          Math.abs(k - view.k) > 0.0004 || Math.abs(tx - view.tx) > 0.15 || Math.abs(ty - view.ty) > 0.15;
        viewRef.current = moving ? { k, tx, ty } : target;
      }
      // Parallax eases toward the pointer.
      const p = pointer.current;
      p.px += (p.x - p.px) * 0.06;
      p.py += (p.y - p.py) * 0.06;

      draw(now);

      if (!reducedMotion || sim.running || held || moving) {
        raf.current = requestAnimationFrame(step);
      } else {
        carried.current = new Map(
          sim.nodes.map((node) => [node.id, { x: node.x, y: node.y, pinned: node.fx !== null }]),
        );
      }
    },
    [draw, reducedMotion],
  );

  const wake = useCallback(() => {
    if (raf.current === 0) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [wake]);

  // The canvas follows its box; the drawing buffer is sized in device px.
  useLayoutEffect(() => {
    const box = graphBox.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || typeof ResizeObserver === "undefined") return;
    const size = () => {
      const rect = box.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      simRef.current?.fitTo(rect.width / rect.height);
      framed.current = false;
      wake();
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(box);
    return () => observer.disconnect();
  }, [wake]);

  /* A new drill: build the simulation, carrying every node that was already
   * there, and giving each new one a place beside the node it grows from. */
  useLayoutEffect(() => {
    drillRef.current = drill;
    shownRef.current = shown;
    const sim = simRef.current;
    if (sim) {
      carried.current = new Map(
        sim.nodes.map((node) => [node.id, { x: node.x, y: node.y, pinned: node.fx !== null }]),
      );
    }
    if (!shown || drill.nodes.length === 0) {
      simRef.current = null;
      lookRef.current = null;
      return;
    }
    const n = drill.nodes.length;
    const radius = drill.nodes.map((node) => radiusOf(node, node.guid !== undefined && node.guid === centreGuid));
    const next = new GraphSim(
      drill.nodes.map((node, i) => ({ id: node.id, r: radius[i] + 4 })),
      drill.edges,
    );
    let kept = 0;
    const placed = new Map<string, { x: number; y: number }>();
    drill.nodes.forEach((node, i) => {
      const at = next.nodes[i];
      const was = carried.current.get(node.id);
      if (was) {
        at.x = was.x;
        at.y = was.y;
        if (was.pinned) next.pin(i, was.x, was.y);
        kept += 1;
      } else if (node.parent) {
        const from = placed.get(node.parent);
        if (from) {
          const offset = seededOffset(node.id, 18 + radius[i] * 2);
          at.x = from.x + offset.x;
          at.y = from.y + offset.y;
        }
      }
      placed.set(node.id, { x: at.x, y: at.y });
    });
    const warm = kept / n > 0.5;
    if (warm) next.alpha = 0.5;
    else next.settle(reducedMotion ? 300 : 12);
    if (reducedMotion) next.alpha = Math.min(next.alpha, 0.05);
    const { w, h } = sizeRef.current;
    if (w > 0) next.fitTo(w / h);
    simRef.current = next;

    const index = new Map(drill.nodes.map((node, i) => [node.id, i]));
    const adjacency: number[][] = Array.from({ length: n }, () => []);
    const edgeA = new Int32Array(drill.edges.length);
    const edgeB = new Int32Array(drill.edges.length);
    drill.edges.forEach((edge, e) => {
      const a = index.get(edge.a) ?? -1;
      const b = index.get(edge.b) ?? -1;
      edgeA[e] = a;
      edgeB[e] = b;
      if (a >= 0 && b >= 0) {
        adjacency[a].push(b);
        adjacency[b].push(a);
      }
    });
    const palette = paletteRef.current;
    const zSeed = new Float32Array(n);
    const phase = new Float32Array(n);
    drill.nodes.forEach((node, i) => {
      const seed = seedOf(node.id);
      zSeed[i] = ((seed >>> 20) % 1000) / 1000;
      phase[i] = ((seed >>> 8) % 6283) / 1000;
    });
    const previous = lookRef.current;
    const previousIds = previous ? drillRefIds.current : null;
    const z = new Float32Array(n);
    drill.nodes.forEach((node, i) => {
      const j = previousIds?.get(node.id);
      z[i] = previous && j !== undefined ? previous.z[j] : zSeed[i] * 0.55;
    });
    drillRefIds.current = index;
    lookRef.current = {
      r: Float32Array.from(radius),
      zSeed,
      z,
      phase,
      colour: palette ? drill.nodes.map((node) => colourOf(node, palette)) : drill.nodes.map(() => [200, 200, 200] as Rgb),
      sx: new Float32Array(n),
      sy: new Float32Array(n),
      sr: new Float32Array(n),
      adjacency,
      edgeA,
      edgeB,
    };
    hovered.current = -1;
    if (!warm) framed.current = false;
    recomputeFocus();
    wake();
    // `recomputeFocus` changes with the selection, and the selection effect
    // below owns that; rebuilding the physics on it would re-throw the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, shown, wake, reducedMotion]);

  // The palette arrived after the look was built, or the design changed.
  useEffect(() => {
    const look = lookRef.current;
    const palette = paletteRef.current;
    if (!look || !palette) return;
    look.colour = drillRef.current.nodes.map((node) => colourOf(node, palette));
    wake();
  }, [design, index, drill, wake]);

  // A selection restyles in place; it never rebuilds the physics.
  useEffect(() => {
    recomputeFocus();
    wake();
  }, [recomputeFocus, wake]);

  useEffect(
    () => () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  // A read-only handle for the headless scripts, which cannot see inside a
  // canvas: where each node was last drawn, in the canvas's own px.
  useEffect(() => {
    const probe = () => {
      const look = lookRef.current;
      return drillRef.current.nodes.map((node, i) => ({
        id: node.id,
        kind: node.kind,
        label: node.label,
        count: node.count ?? null,
        x: look ? look.sx[i] : null,
        y: look ? look.sy[i] : null,
      }));
    };
    const registry = (window.__ifcCheckGraphs ??= []);
    registry.push(probe);
    return () => {
      const at = registry.indexOf(probe);
      if (at >= 0) registry.splice(at, 1);
    };
  }, []);

  /* ── Gestures ─────────────────────────────────────────────────────────── */

  const localPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  }, []);

  const hit = useCallback((x: number, y: number): number => {
    const look = lookRef.current;
    if (!look) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < look.sx.length; i += 1) {
      const reach = Math.max(look.sr[i] + 3, 7);
      const d = Math.hypot(look.sx[i] - x, look.sy[i] - y);
      if (d < reach && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clickNode = useCallback(
    (i: number, additive: boolean) => {
      const node = drillRef.current.nodes[i];
      if (!node) return;
      if (node.kind === "storey" || node.kind === "bucket") {
        toggle(node.id);
        onFocus?.({ kind: "storey", storeyGuids: [node.storey ?? null] });
      } else if (node.kind === "group" && node.entity) {
        toggle(node.id);
        onFocus?.({ kind: "cell", storeyGuid: node.storey ?? null, entity: node.entity });
      } else if (node.guid) {
        onPick(node.guid, additive);
      }
    },
    [onFocus, onPick, toggle],
  );

  const onWheel = useCallback(
    (event: WheelEvent) => {
      // Always the graph's: over the field the wheel never scrolls the page,
      // not even before there is a graph to zoom.
      event.preventDefault();
      if (!simRef.current) return;
      const at = localPoint(event);
      viewRef.current = zoomAt(viewRef.current, at.x, at.y, Math.exp(-event.deltaY * 0.0016));
      framed.current = true;
      wake();
    },
    [localPoint, wake],
  );

  // Native and non-passive: React attaches `onWheel` as a passive listener, so
  // its preventDefault is ignored and the page scrolled while the graph zoomed
  // (edkjo 2026-09-26: "the page scroller is active at the same time as model
  // zoom"). On the graph's whole box, not the canvas alone, so a label laid
  // over the canvas routes the wheel to the graph too.
  useEffect(() => {
    const box = graphBox.current;
    if (!box) return;
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || !simRef.current) return;
      const at = localPoint(event);
      canvasRef.current?.setPointerCapture(event.pointerId);
      const i = hit(at.x, at.y);
      if (i >= 0) {
        dragging.current = { index: i, moved: false, x: at.x, y: at.y };
      } else {
        panning.current = {
          x: at.x - viewRef.current.tx,
          y: at.y - viewRef.current.ty,
          moved: false,
          sx: at.x,
          sy: at.y,
        };
        canvasRef.current?.setAttribute("data-panning", "true");
      }
      wake();
    },
    [hit, localPoint, wake],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const at = localPoint(event);
      const { w, h } = sizeRef.current;
      if (w > 0) {
        pointer.current.x = (at.x / w) * 2 - 1;
        pointer.current.y = (at.y / h) * 2 - 1;
      }
      const held = dragging.current;
      if (held) {
        if (!held.moved && Math.hypot(at.x - held.x, at.y - held.y) < 3) return;
        const sim = simRef.current;
        if (!sim) return;
        held.moved = true;
        const inSim = toSim(viewRef.current, at.x, at.y);
        sim.pin(held.index, inSim.x, inSim.y);
        sim.reheat();
        framed.current = true;
        wake();
        return;
      }
      const pan = panning.current;
      if (pan) {
        if (!pan.moved && Math.hypot(at.x - pan.sx, at.y - pan.sy) < 3) return;
        pan.moved = true;
        viewRef.current = { ...viewRef.current, tx: at.x - pan.x, ty: at.y - pan.y };
        framed.current = true;
        wake();
        return;
      }
      const i = hit(at.x, at.y);
      if (i !== hovered.current) {
        hovered.current = i;
        const look = lookRef.current;
        if (look) hoverHops.current = hopsFrom([i], look.adjacency, look.sx.length);
        const node = i >= 0 ? drillRef.current.nodes[i] : null;
        const clickable = node !== null && (node.guid !== undefined || node.expandable);
        if (canvasRef.current) canvasRef.current.style.cursor = clickable ? "pointer" : "";
      }
      wake();
    },
    [hit, localPoint, wake],
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
      canvasRef.current?.removeAttribute("data-panning");
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const pan = panning.current;
      panning.current = null;
      if (pan) {
        // A press on the empty field that did not move: the demo's clear.
        if (!pan.moved && event.type === "pointerup" && selection.length > 0) onPick(null, false);
        return;
      }
      const held = dragging.current;
      dragging.current = null;
      if (!held) return;
      const sim = simRef.current;
      if (!sim) return;
      if (held.moved) {
        // A node the reader placed stays placed.
        sim.reheat(0.2);
        wake();
        return;
      }
      if (event.type !== "pointerup") return;
      sim.unpin(held.index);
      clickNode(held.index, additive);
      wake();
    },
    [clickNode, onPick, selection.length, wake],
  );

  const onPointerLeave = useCallback(() => {
    hovered.current = -1;
    hoverHops.current = new Int16Array(0);
    pointer.current.x = 0;
    pointer.current.y = 0;
    wake();
  }, [wake]);

  /* ── Layout ───────────────────────────────────────────────────────────── */

  // The canvas aspect rule (`canvas-aspect.ts`): the main surface is never
  // wider than 16:9. On a field wider than that the second surface sits
  // beside the main instead of over its corner.
  const tiles = design && mg ? graphTiles(mg) : null;
  const px = (n: number) => (mg ? mgSpanPx(n, mg.u) : 0);
  const geo = tiles
    ? {
        main: { left: 0, top: 0, width: px(tiles.main.w), height: px(tiles.main.h) },
        second: hasViewer
          ? { left: px(tiles.main.w) + MG_GAP, top: 0, width: px(tiles.second.w), height: px(tiles.second.h) }
          : null,
        beside: true,
      }
    : fieldSize
      ? graphFieldLayout(fieldSize.w, fieldSize.h, hasViewer)
      : null;
  const fieldBox =
    tiles && mg
      ? {
          marginLeft: tiles.offset * (mg.u + MG_GAP),
          width: hasViewer ? px(tiles.used) : px(tiles.main.w),
          height: px(Math.max(tiles.main.h, hasViewer ? tiles.second.h : 0)),
        }
      : null;
  const rect = (r: FieldRect | null | undefined) =>
    r ? { left: r.left, top: r.top, width: r.width, height: r.height } : undefined;
  const mainStyle = rect(geo?.main);
  const secondStyle = rect(geo?.second);
  const windowed =
    "absolute z-10 overflow-hidden rounded-[10px] ring-1 ring-white/15 " +
    (geo?.beside ? "" : "shadow-[0_10px_30px_rgba(0,0,0,0.45)] ") +
    (secondStyle ? "" : "top-3 right-3 aspect-[4/3] w-[min(34%,26rem)] min-w-[13rem]");
  const full = mainStyle ? "absolute" : "absolute inset-0";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <section
        className={
          design
            ? "alt-graf flex min-w-0 shrink-0 flex-col gap-2"
            : "flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border border-line bg-panel"
        }
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1.5 pb-1">
          <MicroLabel>{t("object.relations", lang)}</MicroLabel>
          {centreGuid ? (
            <>
              <Switch on={psets} label={t("type.psets", lang)} onChange={() => setPsets((on) => !on)} />
              <Switch
                on={quantities}
                label={t("graph.quantitySets", lang)}
                onChange={() => setQuantities((on) => !on)}
              />
            </>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">
            {`${formatCount(drill.nodes.length, lang)} · ${formatCount(drill.edges.length, lang)}`}
          </span>
          {expanded.size > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="shrink-0 font-mono text-[10px] text-muted hover:text-ink"
            >
              {t("action.clearAll", lang)}
            </button>
          ) : null}
          {hasViewer ? (
            <div role="group" className="flex shrink-0 overflow-hidden rounded-[6px] border border-line">
              {(["model", "graph"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={main === id}
                  onClick={() => setMain(id)}
                  className={
                    "px-2 py-0.5 text-[11px] " +
                    (main === id ? "bg-ink text-panel" : "bg-input text-muted hover:text-ink")
                  }
                >
                  {t(id === "model" ? "tile.viewer" : "tab.graph", lang)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div
          ref={gridWrap}
          data-mg-graf={mg ? `${mg.cols},${mg.rows},${mg.u.toFixed(4)}` : undefined}
          data-mg-graf-at={
            tiles
              ? [tiles.main, tiles.second].map((t) => `${t.x},${t.y},${t.w},${t.h}`).join(";")
              : undefined
          }
          className={design ? "w-full min-w-0 shrink-0" : "flex min-h-0 min-w-0 flex-1 flex-col"}
        >
        <div
          ref={field}
          data-graph-field
          className={
            design
              ? "alt-graf-field relative min-w-0 overflow-hidden"
              : "relative min-h-0 min-w-0 flex-1 overflow-hidden"
          }
          style={{ background: FIELD_BACKGROUND, ...(design ? (fieldBox ?? { height: 0 }) : {}) }}
        >
          <div
            ref={graphBox}
            className={graphIsMain ? full : windowed}
            style={graphIsMain ? mainStyle : { ...secondStyle, background: FIELD_BACKGROUND }}
          >
            <canvas
              ref={canvasRef}
              data-graph
              className="block h-full w-full touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onPointerLeave={onPointerLeave}
            />
            {drill.nodes.length === 0 && shown ? (
              <span className="absolute top-1/2 left-3 font-mono text-[11px] text-muted">
                {profile ? t("type.none", lang) : t("type.notSupplied", lang)}
              </span>
            ) : null}
          </div>
          {hasViewer ? (
            <div
              ref={viewerSlot}
              data-graph-viewer
              className={graphIsMain ? windowed : full}
              style={{ ...(graphIsMain ? secondStyle : mainStyle), background: "var(--color-ground)" }}
            />
          ) : null}
        </div>
        </div>
      </section>
    </div>
  );
}
