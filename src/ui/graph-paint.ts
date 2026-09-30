/** How the Graf tab is PAINTED: a canvas, drawn as a space.
 *
 * edkjo on the flat drawing (2026-09-25): *"very boring looking. square nodes
 * and flat UI. make it feel more like a space with information. Neural
 * network."* So the field is dark and deep, and the drawing is light on it:
 *
 *   · round nodes that glow, sized by the weight they stand for (a storey by
 *     its element count, a class bucket by its members)
 *   · edges as faint luminous threads that thin out with length and depth
 *   · depth: every node has a z; far nodes are smaller, dimmer and softer (a
 *     blurred bokeh rather than a crisp core), and what is far from the
 *     selection falls back into the depth while its neighbourhood comes
 *     forward
 *   · parallax against the pointer, and a slow ambient drift
 *   · a selection lights its neighbourhood, pulses running out along the
 *     edges like firing synapses, while the rest dims
 *
 * What stays legible: the verdict colours (Avvik red, Advarsel amber) keep a
 * floor on their opacity whatever the depth, the class colours are the
 * charts' categorical set, which keeps off the verdict hues, and labels are drawn on focus and
 * hover over a dark outline.
 *
 * Canvas 2D rather than WebGL: the glow is a pre-rendered sprite per colour
 * composited with `lighter`, which is what a shader would do here, at a few
 * milliseconds for two thousand nodes and without a second GL context beside
 * the viewer's.
 */

import type { GNode, NodeKind, Tone } from "./graph-model";
import { classColour } from "./chart-colors.ts";

export type Rgb = readonly [number, number, number];

export interface Palette {
  building: Rgb;
  storey: Rgb;
  bucket: Rgb;
  site: Rgb;
  rel: Record<"type" | "material" | "classification" | "pset" | "quantity" | "count" | "more", Rgb>;
  fail: Rgb;
  warn: Rgb;
  /** The one highlight (`--sel`): the selection and the filter's origin
   *  node alike (2026-09-30). */
  select: Rgb;
  edge: Rgb;
  label: Rgb;
  outline: string;
  mono: string;
  classes: Map<string, Rgb>;
}

function parseColour(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

/** Toward white by `t`, so a token picked for a light page still reads as
 *  light on the dark field. */
function lift(c: Rgb, t: number): Rgb {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}

/** One class, one colour, the same on every model and the same as the
 *  board's charts (`chart-colors.ts`, 2026-09-28). The categorical set keeps
 *  off the verdict hues, so the warm verdicts and the highlight still stand out. */
export function classRamp(entities: string[]): Map<string, Rgb> {
  const ramp = new Map<string, Rgb>();
  for (const entity of new Set(entities)) ramp.set(entity, classColour(entity));
  return ramp;
}

export function readPalette(element: Element, entities: string[]): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: Rgb) => parseColour(style.getPropertyValue(name), fallback);
  const panel = token("--color-panel", [251, 250, 247]);
  const bad = token("--color-bad", [191, 59, 44]);
  const gold = token("--color-gold", [181, 129, 26]);
  return {
    building: panel,
    storey: lift(token("--color-line", [226, 221, 210]), 0.1),
    bucket: token("--color-muted", [109, 103, 93]),
    site: panel,
    rel: {
      type: lift(gold, 0.45),
      material: lift(token("--color-muted", [109, 103, 93]), 0.45),
      classification: lift(token("--color-muted", [109, 103, 93]), 0.3),
      pset: lift(token("--color-muted", [109, 103, 93]), 0.2),
      quantity: lift(token("--color-muted", [109, 103, 93]), 0.12),
      count: lift(token("--color-muted", [109, 103, 93]), 0.08),
      more: lift(token("--color-muted", [109, 103, 93]), 0.08),
    },
    fail: lift(bad, 0.18),
    warn: lift(gold, 0.22),
    select: lift(token("--sel", [29, 138, 138]), 0.3),
    edge: [150, 178, 192],
    label: lift(panel, 0.2),
    outline: "rgba(12, 10, 8, 0.9)",
    mono: style.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
    classes: classRamp(entities),
  };
}

/** The field the drawing floats in: the page's ink, deepened at the rim. */
export const FIELD_BACKGROUND =
  "radial-gradient(ellipse 80% 75% at 50% 42%, color-mix(in oklab, var(--color-ink) 88%, #3a4a52) 0%, color-mix(in oklab, var(--color-ink) 96%, #000) 72%)";

/* ─────────────────────────────────────────────────────────── node look */

/** Radius by the weight a node stands for. */
export function radiusOf(node: GNode, centre: boolean): number {
  const c = node.count ?? 0;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const table: Record<NodeKind, number> = {
    site: 7,
    building: clamp(8 + Math.sqrt(c) * 0.12, 8, 16),
    storey: clamp(3.5 + Math.sqrt(c) * 0.32, 4.5, 13),
    bucket: clamp(3.5 + Math.sqrt(c) * 0.32, 4.5, 13),
    group: clamp(2.6 + Math.sqrt(c) * 0.42, 3.2, 10),
    product: 2.4,
    more: 3.2,
    type: 4.2,
    count: 3.4,
    material: 3.8,
    classification: 3.6,
    pset: 3.2,
    quantity: 3.2,
  };
  return centre ? 5.5 : table[node.kind];
}

export function colourOf(node: GNode, palette: Palette): Rgb {
  if (node.kind === "product" && node.tone) return toneColour(node.tone, palette);
  switch (node.kind) {
    case "building":
      return palette.building;
    case "storey":
      return palette.storey;
    case "bucket":
      return palette.bucket;
    case "site":
      return palette.site;
    case "group":
    case "product":
      return palette.classes.get(node.entity ?? "") ?? palette.edge;
    default:
      return palette.rel[node.kind];
  }
}

export function toneColour(tone: Exclude<Tone, null>, palette: Palette): Rgb {
  return tone === "fail" ? palette.fail : palette.warn;
}

/** Which labels win a collision. Higher is kept. */
export const LABEL_RANK: Record<NodeKind, number> = {
  building: 70,
  site: 68,
  storey: 66,
  bucket: 64,
  group: 50,
  type: 45,
  material: 40,
  classification: 38,
  more: 30,
  count: 28,
  pset: 14,
  quantity: 12,
  product: 8,
};

/* ─────────────────────────────────────────────────────────── sprites */

const SPRITE = 64;
const glowCache = new Map<string, HTMLCanvasElement>();
const coreCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** A soft radial glow in one colour, drawn with `lighter`. */
export function glowSprite(c: Rgb): HTMLCanvasElement {
  const key = c.join(",");
  const hit = glowCache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(SPRITE);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    g.addColorStop(0, `rgba(${key},0.55)`);
    g.addColorStop(0.25, `rgba(${key},0.22)`);
    g.addColorStop(0.6, `rgba(${key},0.06)`);
    g.addColorStop(1, `rgba(${key},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SPRITE, SPRITE);
  }
  glowCache.set(key, canvas);
  return canvas;
}

/** The node's body: a lit sphere, bright at the top left, so a disc reads as
 *  a thing in space rather than a flat mark. */
export function coreSprite(c: Rgb): HTMLCanvasElement {
  const key = c.join(",");
  const hit = coreCache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(SPRITE);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const r = SPRITE / 2 - 1;
    const hi = lift(c, 0.55);
    const g = ctx.createRadialGradient(r * 0.72, r * 0.68, r * 0.08, SPRITE / 2, SPRITE / 2, r);
    g.addColorStop(0, `rgb(${hi.join(",")})`);
    g.addColorStop(0.55, `rgb(${key})`);
    g.addColorStop(1, `rgb(${Math.round(c[0] * 0.55)},${Math.round(c[1] * 0.55)},${Math.round(c[2] * 0.55)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(SPRITE / 2, SPRITE / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
  coreCache.set(key, canvas);
  return canvas;
}

export function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}
