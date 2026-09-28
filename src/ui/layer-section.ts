/** The layer strip's geometry (2026-09-28). Owner: *"For layered material
 * objects, I want a view that shows the material layer and thickness. A
 * sandwich component essentially. 1:20"*, then *"we already kind of have that
 * though, so just make it a bit more apparent."*
 *
 * So the existing strip, made readable: on the type page a piece of the
 * element cut through its thickness at an honest 1:20 (a fixed px per mm, so
 * two sections compare by eye; a set too thick for its tile scrolls, never
 * rescales), on the cards the same colours and hatches in proportion.
 *
 *   order        the engine's `layer_index`, as given. DirectionSense and
 *                OffsetFromReferenceLine are not in `materialsJson()`, so the
 *                side the first layer sits on is the file's order, no more.
 *   no thickness drawn at a nominal width with the "ikke levert" hatch, never
 *                as 0, and the total is then unknown.
 *   category     from the material NAME only where it maps clearly
 *                (isolasjon, betong, gips, tre, …); otherwise `other`, a
 *                stable colour per name and no hatch.
 *
 * Pure: the selftest asserts the px per mm, the order and the total.
 */

import { CATEGORICAL, categorical, type Rgb } from "./chart-colors.ts";

/** CSS px per millimetre of screen (96 px per inch). */
export const SCREEN_PX_PER_MM = 96 / 25.4;
/** The drawing scale's denominator. */
export const SECTION_SCALE = 20;
/** px per millimetre of the element at 1:20: 0.189. */
export const PX_PER_MM = SCREEN_PX_PER_MM / SECTION_SCALE;
/** The length of the piece along the element, in mm. */
export const PIECE_MM = 600;
/** A layer with no thickness is drawn this wide, hatched, not to scale. */
export const UNKNOWN_PX = 8;

export type LayerCategory = "insulation" | "concrete" | "gypsum" | "wood" | "masonry" | "metal" | "membrane" | "air" | "other";

export interface LayerInput {
  material: string | null;
  thickness: number | null;
}

export interface SectionBand {
  index: number;
  material: string | null;
  thickness: number | null;
  category: LayerCategory;
  /** Offset from the first face, px. */
  at: number;
  /** Width through the thickness, px. */
  size: number;
  /** No thickness from the file: drawn nominal and hatched. */
  unknown: boolean;
}

export interface Section {
  bands: SectionBand[];
  /** Sum of the thicknesses, mm; null when any layer has none. */
  totalMm: number | null;
  /** The drawn thickness, px. */
  px: number;
  pxPerMm: number;
}

// Word edges that also hold for æ ø å (a bare \b does not).
const w = (words: string) => new RegExp(`(^|[^a-zæøå])(${words})`, "i");
const RULES: [LayerCategory, RegExp][] = [
  ["insulation", w("isolasjon|mineralull|glassull|steinull|trefiberisol|insulation|rockwool|glava|eps|xps|pir|pur")],
  ["membrane", w("folie|membran|dampsperre|vindsperre|papp|takbelegg|sperre|barrier|membrane|foil|bitumen")],
  ["gypsum", w("gips|gypsum|plasterboard|plaster")],
  ["concrete", w("betong|påstøp|avretting|concrete|screed")],
  ["masonry", w("tegl|murverk|mur|lettklinker|leca|blokk|brick|masonry|block")],
  ["wood", w("tre|treverk|trelast|kledning|bindingsverk|stender|osb|spon|kryssfiner|clt|limtre|massivtre|wood|timber|plywood")],
  ["metal", w("stål|aluminium|alu|metall|steel|metal")],
  ["air", w("luft|lufting|hulrom|air|cavity")],
];

/** A material name's category, only where the name says it clearly. */
export function materialCategory(name: string | null): LayerCategory {
  if (!name) return "other";
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return "other";
}

const CATEGORY_SLOT: Record<Exclude<LayerCategory, "other" | "air">, number> = {
  insulation: 3,
  concrete: 6,
  gypsum: 4,
  wood: 7,
  masonry: 5,
  metal: 0,
  membrane: 1,
};

/** The layer's fill: the category's, else a stable one per material name. */
export function layerFill(material: string | null, category: LayerCategory): Rgb | null {
  if (category === "air") return null;
  if (category === "other") return material ? categorical(material) : CATEGORICAL[6];
  return CATEGORICAL[CATEGORY_SLOT[category]];
}

/** Slabs and roofs cut to horizontal bands, everything else (walls, …) to
 *  vertical ones. */
export function sectionOrientation(entity: string): "horizontal" | "vertical" {
  return /slab|roof/i.test(entity) ? "horizontal" : "vertical";
}

/** The bands of a layer set, in order, at `pxPerMm` (1:20 by default). */
export function layerSection(layers: LayerInput[], pxPerMm = PX_PER_MM): Section {
  let at = 0;
  const bands: SectionBand[] = layers.map((l, index) => {
    const unknown = l.thickness === null || !(l.thickness > 0);
    const size = unknown ? UNKNOWN_PX : (l.thickness as number) * pxPerMm;
    const band = { index, material: l.material, thickness: l.thickness, category: materialCategory(l.material), at, size, unknown };
    at += size;
    return band;
  });
  const totalMm = bands.every((b) => !b.unknown) ? bands.reduce((s, b) => s + (b.thickness ?? 0), 0) : null;
  return { bands, totalMm, px: at, pxPerMm };
}

/** Labels beside the bands: each at its band's centre, pushed apart to at
 *  least `gap` px in order. */
export function labelSlots(centres: number[], gap: number, start = 0): number[] {
  const out: number[] = [];
  for (const c of centres) out.push(Math.max(c, start, out.length ? out[out.length - 1] + gap : -Infinity));
  return out;
}

const ROW = 13;
const CHAR = 6.1; // 10 px mono
/** The scale bar's length, mm. */
export const BAR_MM = 500;

export interface SectionFrame {
  width: number;
  height: number;
  /** The cut piece: x, y, w, h in px. */
  piece: { x: number; y: number; w: number; h: number };
  orientation: "horizontal" | "vertical";
  /** Per band: the leader polyline (first point inside the band) and where
   *  its label text starts. */
  labels: { points: [number, number][]; tx: number; ty: number }[];
  /** The dimension chain: its line and the tick positions along it. */
  dim: { x1: number; y1: number; x2: number; y2: number; ticks: number[]; tx: number; ty: number };
  bar: { x: number; y: number; len: number };
}

/** Where everything goes, for label texts of `labelChars` characters. The
 *  piece is PIECE_MM long at the section's scale; walls stand (layers left to
 *  right, labels under, leaders nested so none cross), slabs lie (layers top
 *  to bottom, labels to the right). */
export function sectionFrame(section: Section, orientation: "horizontal" | "vertical", labelChars: number[]): SectionFrame {
  const len = PIECE_MM * section.pxPerMm;
  const T = section.px;
  const bar = BAR_MM * section.pxPerMm;
  const labelW = Math.max(0, ...labelChars) * CHAR;
  const n = section.bands.length;
  if (orientation === "vertical") {
    const piece = { x: 12, y: 24, w: T, h: len };
    const bottom = piece.y + piece.h;
    const tx = piece.x + T + 10;
    const labels = section.bands.map((b, i) => {
      const cx = piece.x + b.at + b.size / 2;
      const y = bottom + 12 + (n - 1 - i) * ROW;
      return { points: [[cx, bottom - 8], [cx, y], [tx - 2, y]] as [number, number][], tx, ty: y + 3.5 };
    });
    const barY = bottom + 12 + n * ROW + 4;
    return {
      width: Math.max(tx + labelW, piece.x + bar + 64) + 8,
      height: barY + 18,
      piece,
      orientation,
      labels,
      dim: { x1: piece.x, y1: 16, x2: piece.x + T, y2: 16, ticks: section.bands.map((b) => piece.x + b.at).concat(piece.x + T), tx: piece.x, ty: 10 },
      bar: { x: piece.x, y: barY, len: bar },
    };
  }
  const piece = { x: 34, y: 10, w: len, h: T };
  const tx = piece.x + len + 18;
  const slots = labelSlots(
    section.bands.map((b) => piece.y + b.at + b.size / 2),
    ROW,
    piece.y + 4,
  );
  const labels = section.bands.map((b, i) => {
    const cy = piece.y + b.at + b.size / 2;
    return { points: [[piece.x + len - 12, cy], [piece.x + len + 8, slots[i]], [tx - 2, slots[i]]] as [number, number][], tx, ty: slots[i] + 3.5 };
  });
  const barY = Math.max(piece.y + T, slots.length ? slots[slots.length - 1] : 0) + 18;
  return {
    width: Math.max(tx + labelW, piece.x + bar + 64) + 8,
    height: barY + 18,
    piece,
    orientation,
    labels,
    dim: { x1: 22, y1: piece.y, x2: 22, y2: piece.y + T, ticks: section.bands.map((b) => piece.y + b.at).concat(piece.y + T), tx: 14, ty: piece.y + T / 2 },
    bar: { x: piece.x, y: barY, len: bar },
  };
}
