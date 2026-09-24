/** How each direction PAINTS the same graph.
 *
 * The nodes, the edges and the labels are the same facts in all four skins —
 * every edge is still an `IfcRel*` the profile really carries, and nothing is
 * added or dropped for looks. What differs is the material: glyph weight, the
 * line, whether an edge bows, whether a label sits on a chip, and how much
 * room a label has to win before it is drawn.
 *
 * Kept out of `GraphTab` because the tab is already the longest file on this
 * surface, and because a skin is a table rather than a branch.
 */

import type { Design } from "./useHashView";

export interface GraphSkin {
  /** Glyph radius multiplier. */
  scale: number;
  /** Edge stroke width in px, at zoom 1. */
  edgeWidth: number;
  /** Edge opacity at rest. */
  edgeAlpha: number;
  /** 0 draws a straight line; above that the edge bows by this fraction of its
   *  own length. */
  bow: number;
  /** A soft ring behind a node, sized from its glyph. Off where the canon
   *  retires the glow vocabulary. */
  halo: number;
  /** Draw the node label on a filled chip rather than bare on the field. */
  chip: boolean;
  /** Corner radius of that chip. */
  chipRadius: number;
  /** Font for the node's name. */
  labelFamily: "mono" | "sans";
  labelWeight: number;
  labelSize: number;
  /** Font for the IFC token under the name, and for the edge's relationship. */
  subFamily: "mono" | "sans";
  subSize: number;
  /** Tracking on the IFC token, in em. */
  subTracking: number;
  /** Edge labels appear once the edge is at least this many px long on screen.
   *  A higher floor is a quieter drawing. */
  edgeLabelFloor: number;
  /** Stroke width of the ring drawn around a selected node. */
  activeWidth: number;
}

const BASE: GraphSkin = {
  scale: 1,
  edgeWidth: 1.25,
  edgeAlpha: 1,
  bow: 0,
  halo: 0,
  chip: false,
  chipRadius: 0,
  labelFamily: "mono",
  labelWeight: 400,
  labelSize: 10,
  subFamily: "mono",
  subSize: 9,
  subTracking: 0,
  edgeLabelFloor: 46,
  activeWidth: 2,
};

export const GRAPH_SKIN: Record<"default" | Design, GraphSkin> = {
  /* The board as it shipped: the drawing is unchanged, only its layout is now
     alive. Nothing about the default's look moves because three mockups
     exist. */
  default: BASE,

  /* A — INSTRUMENT. Thin, exact, everything tracked mono on a dot grid. An
     instrument does not bow its lines. */
  a: {
    ...BASE,
    scale: 0.94,
    edgeWidth: 1,
    edgeAlpha: 0.78,
    labelFamily: "mono",
    labelWeight: 500,
    labelSize: 10,
    subFamily: "mono",
    subSize: 8.5,
    subTracking: 0.16,
    edgeLabelFloor: 52,
    activeWidth: 1.75,
  },

  /* B — PAPIR. Ink on paper: a heavier line, a name set in the page's own
     sans at weight, and no glow at all. 2026-08-07, on a bright base: *"crisp"*
     retires the glow vocabulary, so cues become ink. */
  b: {
    ...BASE,
    scale: 1.08,
    edgeWidth: 1.6,
    edgeAlpha: 0.9,
    labelFamily: "sans",
    labelWeight: 700,
    labelSize: 11,
    subFamily: "mono",
    subSize: 8.5,
    subTracking: 0.08,
    edgeLabelFloor: 58,
    activeWidth: 2.5,
  },

  /* C — SMASH. Depth: the edge bows, the node carries a halo, and the name
     rides a chip so it stays readable over the field's own colour. */
  c: {
    ...BASE,
    scale: 1.14,
    edgeWidth: 1.4,
    edgeAlpha: 0.62,
    bow: 0.14,
    halo: 2.6,
    chip: true,
    chipRadius: 5,
    labelFamily: "sans",
    labelWeight: 600,
    labelSize: 10.5,
    subFamily: "mono",
    subSize: 8.5,
    subTracking: 0.1,
    edgeLabelFloor: 64,
    activeWidth: 2.5,
  },
};

export function skinOf(design: Design | null): GraphSkin {
  return GRAPH_SKIN[design ?? "default"];
}

/** A quadratic bow, perpendicular to the chord. Zero bow returns the straight
 *  path, so one code path draws both. */
export function edgePath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bow: number,
): string {
  if (bow === 0) return `M${ax} ${ay}L${bx} ${by}`;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  return `M${ax} ${ay}Q${mx - dy * bow} ${my + dx * bow} ${bx} ${by}`;
}

/** Where a bowed edge's label sits: on the curve, not on the chord, and two
 *  thirds out rather than at the middle.
 *
 * The reason is the one the old drawing already gave: the graph is a FAN from
 * the selected element, so every edge's midpoint lands in the same crowded
 * ring near the hub. Two thirds out the arc between neighbours is twice as
 * wide and the labels separate on their own.
 */
export function edgeLabelAt(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bow: number,
  at = 0.68,
): { x: number; y: number } {
  if (bow === 0) return { x: ax + (bx - ax) * at, y: ay + (by - ay) * at };
  const mx = (ax + bx) / 2 - (by - ay) * bow;
  const my = (ay + by) / 2 + (bx - ax) * bow;
  const u = 1 - at;
  return {
    x: u * u * ax + 2 * u * at * mx + at * at * bx,
    y: u * u * ay + 2 * u * at * my + at * at * by,
  };
}
