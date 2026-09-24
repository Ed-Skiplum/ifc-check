/** The Graf tab: the selected element's relationships as a node-link diagram.
 *
 * The object panel prints the same relationships as ROWS — a list answers
 * "what does this element declare". A graph answers the other question, "what
 * is this element attached to", and it is the one question a list cannot draw:
 * a wall, its type, the seventeen walls sharing that type, the openings cut
 * into it and the storey it sits in are one picture, not five rows.
 *
 * ── Only edges the engine really carries ─────────────────────────────────
 * Every edge here is an `IfcRel*` that reached the profile
 * (`src/ui/profile.ts`), and every edge is LABELLED with the relationship it
 * is, the same teaching the object panel does with its dim IFC token. What
 * ifcfast does not expose is not drawn and not stubbed:
 *
 *   · building -> site. `graph.buildings` and `graph.sites` are flat rosters
 *     ({guid, name}); `storey_building` is the only spatial `IfcRelAggregates`
 *     edge the graph reports, and `aggregates` reaches product rows only. So
 *     the model graph LISTS sites and draws no edge into them, exactly as the
 *     object panel calls its site row "the file's site roster" rather than a
 *     claim about a parent.
 *   · element -> site / building / space containment. `contained_in` is storey
 *     containment alone (`src/engine/types.ts`), so an element contained
 *     directly in a building reaches no storey here and gets no spatial edge.
 *
 * ── Nothing selected ─────────────────────────────────────────────────────
 * The spatial structure the profile does carry: sites, buildings, storeys with
 * their element counts, and the no-storey bucket when it holds anything. It is
 * the honest model-level graph — not a whole-model relationship dump, which
 * would be a picture of nothing at 851 products.
 *
 * ── The layout is ALIVE ──────────────────────────────────────────────────
 * The physics lives in `graph-sim.ts` and runs over real frames: the
 * arrangement expands into place, a new selection MOVES the nodes it shares
 * with the old one rather than cutting to a new picture, a node can be dragged
 * and stays where it is put, the wheel magnifies about the pointer and a drag
 * on the field pans. Determinism survives the change — start positions are
 * still an FNV hash of the node id and there is no randomness anywhere, so the
 * same element settles into the same arrangement every time it is opened. See
 * that file's header for why this is not d3-force.
 *
 * `graph-paint.ts` holds the per-direction material. The DRAWING is identical
 * in all four skins; what changes is glyph weight, whether an edge bows,
 * whether a label rides a chip, and how long an edge must be before it names
 * its relationship.
 *
 * Labels only — the node's name and its IFC term, the edge's relationship
 * name. A label that does not fit ellipsizes and carries the full text in
 * `title`, and a label that would land on another label is not drawn at all:
 * the collision pass reserves boxes in rank order, so the centre and the
 * spatial parents keep their names and a property set gives way.
 *
 * Positions are written straight to the DOM by the frame loop. React owns what
 * exists, the loop owns where it is.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { MicroLabel } from "./BentoGrid";
import { Switch } from "./Switch";
import type { ModelProfile, ProductRowLite } from "./profile";
import type { Design } from "./useHashView";
import { GraphSim, fitView, toSim, zoomAt, type GraphView } from "./graph-sim";
import { edgeLabelAt, edgePath, skinOf, type GraphSkin } from "./graph-paint";

/** How many members of one relationship group are drawn before the rest
 *  collapse into a `+N` node. A wall with forty openings is forty labels no
 *  one can read; the count is the honest summary and the panel still has the
 *  full list. */
const MAX_PER_GROUP = 12;
/** Total ceiling, so the O(n²) force sum stays well inside a frame — and the
 *  reason a Barnes-Hut dependency would not pay for itself here. */
const MAX_NODES = 180;

type NodeKind =
  | "self"
  | "element"
  | "storey"
  | "building"
  | "site"
  | "type"
  | "count"
  | "material"
  | "classification"
  | "pset"
  | "quantity";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** The IFC term or the count under the label, dim. */
  sub?: string | null;
  /** Set only on nodes that ARE elements of this model — the only ones a click
   *  may select. A material or a property set is not an element and never
   *  fakes one. */
  guid?: string;
}

interface GraphEdge {
  a: string;
  b: string;
  /** The `IfcRel*` this edge IS. */
  label: string;
}

interface Build {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The node pinned at the origin, or null for the model-level graph. */
  centre: string | null;
}

/* ------------------------------------------------------------------ build */

function elementNode(row: ProductRowLite): GraphNode {
  return {
    id: `e:${row.guid}`,
    kind: "element",
    label: row.name ?? row.guid,
    sub: row.entity,
    guid: row.guid,
  };
}

/** The relationship name the parser reported for this parent link, when it
 *  reported one. `parent_kind` is verbatim from ifcfast and this does not
 *  rewrite it; a value that is not a relationship name falls back to the two
 *  relationships that can produce the link. */
function aggregateLabel(kind: string | null | undefined): string {
  return kind && kind.startsWith("IfcRel") ? kind : "IfcRelAggregates · IfcRelNests";
}

function elementGraph(
  profile: ModelProfile,
  guid: string,
  lang: Lang,
  show: { psets: boolean; quantities: boolean },
): Build {
  const row = profile.rows.find((r) => r.guid === guid);
  if (!row) return { nodes: [], edges: [], centre: null };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (node: GraphNode): string => {
    if (!seen.has(node.id) && nodes.length < MAX_NODES) {
      seen.add(node.id);
      nodes.push(node);
    }
    return node.id;
  };

  const self = add({
    id: `e:${row.guid}`,
    kind: "self",
    label: row.name ?? row.guid,
    sub: row.entity,
    guid: row.guid,
  });

  /** One relationship group, capped: the first `MAX_PER_GROUP` as their own
   *  nodes, the remainder as a single `+N`. */
  const linkRows = (rows: ProductRowLite[], label: string, from: string) => {
    for (const other of rows.slice(0, MAX_PER_GROUP)) {
      edges.push({ a: from, b: add(elementNode(other)), label });
    }
    const rest = rows.length - MAX_PER_GROUP;
    if (rest > 0) {
      const id = add({
        id: `${from}:${label}:rest`,
        kind: "count",
        label: `+${formatCount(rest, lang)}`,
        sub: null,
      });
      edges.push({ a: from, b: id, label });
    }
  };

  // IfcRelContainedInSpatialStructure: element -> storey, then the one spatial
  // aggregation the graph reports, storey -> building.
  const storey = profile.storeys.find((s) => s.guid === row.storeyGuid);
  if (storey) {
    const storeyId = add({
      id: `s:${storey.guid}`,
      kind: "storey",
      label: storey.name ?? storey.guid,
      sub: "IfcBuildingStorey",
    });
    edges.push({ a: self, b: storeyId, label: "IfcRelContainedInSpatialStructure" });
    const building = profile.buildings?.find((b) => b.guid === storey.buildingGuid);
    if (building) {
      const buildingId = add({
        id: `b:${building.guid}`,
        kind: "building",
        label: building.name ?? building.guid,
        sub: "IfcBuilding",
      });
      edges.push({ a: storeyId, b: buildingId, label: "IfcRelAggregates" });
    }
  }

  // IfcRelDefinesByType: the type object, and the siblings that share it.
  if (row.typeGuid || row.typeName) {
    const key = row.typeGuid ?? row.typeName ?? "";
    const typeId = add({
      id: `t:${key}`,
      kind: "type",
      label: row.typeName ?? key,
      sub: row.typeSource ?? "IfcTypeObject",
    });
    edges.push({ a: self, b: typeId, label: "IfcRelDefinesByType" });
    const siblings = profile.rows.filter(
      (r) =>
        r.guid !== row.guid &&
        (row.typeGuid ? r.typeGuid === row.typeGuid : r.typeName === row.typeName),
    ).length;
    if (siblings > 0) {
      const id = add({
        id: `t:${key}:siblings`,
        kind: "count",
        label: formatCount(siblings, lang),
        sub: t("object.siblings", lang),
      });
      edges.push({ a: typeId, b: id, label: "IfcRelDefinesByType" });
    }
  }

  // IfcRelAggregates / IfcRelNests, both ends.
  const parent = row.parentGuid ? profile.rows.find((r) => r.guid === row.parentGuid) : undefined;
  if (parent) {
    edges.push({ a: add(elementNode(parent)), b: self, label: aggregateLabel(row.parentKind) });
  }
  const children = profile.rows.filter((r) => r.parentGuid === row.guid);
  if (children.length > 0) {
    linkRows(children, aggregateLabel(children[0].parentKind), self);
  }

  // IfcRelVoidsElement, both ends.
  const openings = (row.openingGuids ?? [])
    .map((g) => profile.rows.find((r) => r.guid === g))
    .filter((r): r is ProductRowLite => r !== undefined);
  if (openings.length > 0) linkRows(openings, "IfcRelVoidsElement", self);
  const host = row.hostGuid ? profile.rows.find((r) => r.guid === row.hostGuid) : undefined;
  if (host) {
    edges.push({ a: add(elementNode(host)), b: self, label: "IfcRelVoidsElement" });
  }

  // IfcRelAssociatesMaterial: one node per material name.
  for (const material of row.materials ?? []) {
    const id = add({
      id: `m:${material}`,
      kind: "material",
      label: material,
      sub: "IfcMaterial",
    });
    edges.push({ a: self, b: id, label: "IfcRelAssociatesMaterial" });
  }

  /** A table the profile never carried is not an element with none of them,
   *  and the two must not draw the same. `undefined` gets ONE node in the
   *  object panel's own word — a label, not a sentence — so the category is
   *  visible as unanswered rather than silently absent. */
  const absent = (id: string, kind: NodeKind, ifc: string, label: string) => {
    const nodeId = add({ id, kind, label: ifc, sub: t("type.notSupplied", lang) });
    edges.push({ a: self, b: nodeId, label });
  };

  // IfcRelAssociatesClassification: one node per system.
  if (profile.classifications === undefined) {
    absent("c:absent", "classification", "IfcClassification", "IfcRelAssociatesClassification");
  } else {
    const systems: string[] = [];
    for (const ref of profile.classifications.get(row.guid) ?? []) {
      const system = ref.system ?? ref.code ?? "";
      if (system && !systems.includes(system)) systems.push(system);
    }
    for (const system of systems) {
      const id = add({
        id: `c:${system}`,
        kind: "classification",
        label: system,
        sub: "IfcClassification",
      });
      edges.push({ a: self, b: id, label: "IfcRelAssociatesClassification" });
    }
  }

  // IfcRelDefinesByProperties: one node per set. Property sets and quantity
  // sets are different entities in the standard and stay apart here.
  if (show.psets) {
    if (profile.psets === undefined) {
      absent("p:absent", "pset", "IfcPropertySet", "IfcRelDefinesByProperties");
    } else {
      for (const group of profile.psets.get(row.guid) ?? []) {
        const id = add({
          id: `p:${group.name}`,
          kind: group.quantity ? "quantity" : "pset",
          label: group.name,
          sub: group.quantity ? "IfcElementQuantity" : "IfcPropertySet",
        });
        edges.push({ a: self, b: id, label: "IfcRelDefinesByProperties" });
      }
    }
  }
  if (show.quantities) {
    if (profile.quantities === undefined) {
      absent("q:absent", "quantity", "IfcElementQuantity", "IfcRelDefinesByProperties");
    } else {
      for (const group of profile.quantities.get(row.guid) ?? []) {
        const id = add({
          id: `q:${group.name}`,
          kind: "quantity",
          label: group.name,
          sub: "IfcElementQuantity",
        });
        edges.push({ a: self, b: id, label: "IfcRelDefinesByProperties" });
      }
    }
  }

  return { nodes, edges, centre: self };
}

/** The spatial structure, when nothing is selected. Sites are listed and
 *  reach no edge — see the header. */
function modelGraph(profile: ModelProfile, lang: Lang): Build {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const known = new Set(profile.storeys.map((s) => s.guid));
  const counts = new Map<string, number>();
  let orphans = 0;
  for (const row of profile.rows) {
    if (row.storeyGuid !== null && known.has(row.storeyGuid)) {
      counts.set(row.storeyGuid, (counts.get(row.storeyGuid) ?? 0) + 1);
    } else {
      orphans += 1;
    }
  }

  for (const site of profile.sites ?? []) {
    nodes.push({
      id: `site:${site.guid}`,
      kind: "site",
      label: site.name ?? site.guid,
      sub: "IfcSite",
    });
  }
  for (const building of profile.buildings ?? []) {
    nodes.push({
      id: `b:${building.guid}`,
      kind: "building",
      label: building.name ?? building.guid,
      sub: "IfcBuilding",
    });
  }

  const storeys = profile.storeys.slice(0, Math.max(0, MAX_NODES - nodes.length - 2));
  for (const storey of storeys) {
    nodes.push({
      id: `s:${storey.guid}`,
      kind: "storey",
      label: storey.name ?? storey.guid,
      sub: formatCount(counts.get(storey.guid) ?? 0, lang),
    });
    if (storey.buildingGuid && profile.buildings?.some((b) => b.guid === storey.buildingGuid)) {
      edges.push({
        a: `s:${storey.guid}`,
        b: `b:${storey.buildingGuid}`,
        label: "IfcRelAggregates",
      });
    }
  }
  const rest = profile.storeys.length - storeys.length;
  if (rest > 0) {
    nodes.push({ id: "s:rest", kind: "count", label: `+${formatCount(rest, lang)}`, sub: null });
  }
  if (orphans > 0) {
    nodes.push({
      id: "s:none",
      kind: "count",
      label: formatCount(orphans, lang),
      sub: t("matrix.noStorey", lang),
    });
  }

  return { nodes, edges, centre: null };
}

/* ---------------------------------------------------------------- drawing */

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** Glyph per kind, in `currentColor` and the palette vars so one set of shapes
 *  serves all four skins. The SHAPE says what a thing is — a storey is a
 *  square, a type a diamond, a capped remainder a dashed circle — and the
 *  shape is what survives a colour-blind reader and a black-and-white print. */
const GLYPH: Record<NodeKind, ReactElement> = {
  self: <circle r={11} fill="var(--color-gold)" stroke="var(--color-ink)" strokeWidth={1.5} />,
  element: (
    <circle r={7} fill="var(--color-input)" stroke="var(--color-green)" strokeWidth={1.5} />
  ),
  storey: (
    <rect
      x={-7}
      y={-7}
      width={14}
      height={14}
      fill="var(--color-panel)"
      stroke="var(--color-ink)"
      strokeWidth={1.25}
    />
  ),
  building: (
    <rect
      x={-9}
      y={-9}
      width={18}
      height={18}
      fill="var(--color-panel)"
      stroke="var(--color-ink)"
      strokeWidth={1.5}
    />
  ),
  site: (
    <rect
      x={-10}
      y={-10}
      width={20}
      height={20}
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth={1.25}
    />
  ),
  type: (
    <rect
      x={-7}
      y={-7}
      width={14}
      height={14}
      transform="rotate(45)"
      fill="var(--color-input)"
      stroke="var(--color-gold)"
      strokeWidth={1.75}
    />
  ),
  count: (
    <circle
      r={7}
      fill="var(--color-ground)"
      stroke="var(--color-muted)"
      strokeWidth={1}
      strokeDasharray="2.5 2.5"
    />
  ),
  material: (
    <polygon points="0,-8.5 7.5,5 -7.5,5" fill="none" stroke="var(--color-green)" strokeWidth={1.25} />
  ),
  classification: (
    <polygon points="0,-8 8,0 0,8 -8,0" fill="none" stroke="var(--color-muted)" strokeWidth={1.25} />
  ),
  pset: (
    <rect x={-6} y={-6} width={12} height={12} fill="var(--color-input)" stroke="var(--color-muted)" strokeWidth={1} />
  ),
  quantity: (
    <rect
      x={-6}
      y={-6}
      width={12}
      height={12}
      fill="var(--color-input)"
      stroke="var(--color-muted)"
      strokeWidth={1}
      strokeDasharray="2.5 2.5"
    />
  ),
};

/** Which labels get the room. Higher wins a collision.
 *
 * The centre of the drawing and the spatial parents are what orient a reader;
 * a capped `+N` remainder and a property set are what a reader looks up after
 * they have found their bearings. */
const LABEL_RANK: Record<NodeKind, number> = {
  self: 100,
  building: 70,
  site: 68,
  storey: 66,
  type: 60,
  material: 40,
  classification: 38,
  element: 30,
  count: 20,
  pset: 12,
  quantity: 10,
};

/** Advance width per character, as a fraction of the font size. Measured off
 *  the two faces this drawing uses rather than measured in the DOM: a
 *  `getComputedTextLength` per label per settle frame is a layout flush per
 *  label per frame, which is exactly the stall this rewrite exists to remove.
 *  It is used to RESERVE space, so an approximation that runs slightly wide is
 *  the safe direction. */
const CHAR_W = { mono: 0.61, sans: 0.55 } as const;

function textWidth(text: string, size: number, family: "mono" | "sans"): number {
  return text.length * size * CHAR_W[family];
}

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/* ------------------------------------------------------------------ panel */

export function GraphTab({
  lang,
  design,
  profile,
  selection,
  onPick,
}: {
  lang: Lang;
  /** The visual direction, which decides how the drawing is painted. */
  design: Design | null;
  profile: ModelProfile | null;
  /** The panel's `view.selection`. The FIRST guid is the centre: one graph has
   *  one origin, and drawing several centres at once is a picture of nothing. */
  selection: string[];
  /** The panel's own pick — a UI click selects, exactly as a table row does. */
  onPick: (guid: string | null, additive: boolean) => void;
}) {
  const [psets, setPsets] = useState(true);
  const [quantities, setQuantities] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [shown, setShown] = useState(false);
  const skin = skinOf(design);

  // The tab is `hidden` while another tab is active, so it has no box at all
  // until it is shown. A zero measurement keeps the LAST size — so reopening
  // the tab does not repaint at a different width — but clears `shown`, and
  // the simulation below runs only while shown: a selection made on Kontroll
  // must not cost a frame of physics for a graph nobody is looking at.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const visible = width > 0 && height > 0;
      setShown((current) => (current === visible ? current : visible));
      if (!visible) return;
      setSize((current) =>
        current && current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const centreGuid = selection.length > 0 ? selection[0] : null;

  const build = useMemo<Build>(() => {
    if (!profile || !shown) return { nodes: [], edges: [], centre: null };
    return centreGuid
      ? elementGraph(profile, centreGuid, lang, { psets, quantities })
      : modelGraph(profile, lang);
  }, [profile, shown, centreGuid, lang, psets, quantities]);

  /* ── The live part ───────────────────────────────────────────────────────
   *
   * React renders the node and edge ELEMENTS, once per build. Their positions
   * are written straight to the DOM by the frame loop below, because a
   * `setState` per frame over 180 nodes is a reconcile per frame and the
   * settle drops to about 20 fps. The rule this follows is the one the viewer
   * tile already follows: React owns what exists, the loop owns where it is.
   */
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const labelRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef<(SVGPathElement | null)[]>([]);
  const edgeLabelRefs = useRef<(SVGGElement | null)[]>([]);
  const simRef = useRef<GraphSim | null>(null);
  const viewRef = useRef<GraphView>({ k: 1, tx: 0, ty: 0 });
  /** Screen-independent positions of the last arrangement, so a NEW selection
   *  that shares nodes with the old one moves them from where they were
   *  instead of re-throwing the whole picture. */
  const carried = useRef(new Map<string, { x: number; y: number }>());
  /** Once the reader has panned or zoomed, the drawing stops re-framing itself
   *  under them. */
  const framed = useRef(false);
  const dragging = useRef<{ index: number; id: string; moved: boolean } | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const hovered = useRef<string | null>(null);
  const raf = useRef(0);
  const sinceLabels = useRef(0);

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Decide which node labels are drawn, in rank order, by reserving boxes.
   *  Runs on a cadence rather than per frame — a label that flickers between
   *  two frames of a settle is worse than one that appears a beat late. */
  const relabel = useCallback(() => {
    const sim = simRef.current;
    if (!sim || !size) return;
    const view = viewRef.current;
    const order = build.nodes
      .map((node, i) => ({ node, i }))
      .sort((p, q) => LABEL_RANK[q.node.kind] - LABEL_RANK[p.node.kind]);
    const placed: LabelBox[] = [];
    for (const { node, i } of order) {
      const element = labelRefs.current.get(node.id);
      if (!element) continue;
      const at = sim.nodes[i];
      const x = at.x * view.k + view.tx;
      const y = at.y * view.k + view.ty;
      const size_ = node.kind === "self" ? skin.labelSize + 1 : skin.labelSize;
      const width = textWidth(clip(node.label, node.kind === "self" ? 30 : 22), size_, skin.labelFamily);
      const top = y + (node.kind === "self" ? 18 : 14);
      const height = node.sub ? size_ + skin.subSize + 6 : size_ + 3;
      const wanted: LabelBox = {
        x0: x - width / 2 - 3,
        y0: top,
        x1: x + width / 2 + 3,
        y1: top + height,
      };
      // Outside the box is not a collision, it is off-screen: drop it either
      // way, so a label never hangs half over the tile's edge.
      const inside =
        wanted.x0 > -12 && wanted.x1 < size.width + 12 && wanted.y1 < size.height + 4;
      const free = inside && !placed.some((other) => overlaps(wanted, other));
      // The centre always keeps its name. A drawing whose own subject is
      // unlabelled is not a drawing of anything.
      const show = node.kind === "self" || free;
      if (show) placed.push(wanted);
      element.setAttribute("opacity", show ? "1" : "0");
    }

    /* Edge labels answer to the same reservation, and they answer SECOND: a
     * node's name beats the name of a relationship, because the relationship is
     * also printed as a row in the object panel and the node's name is not
     * printed anywhere else on this surface.
     *
     * Longest edge first, and an edge must be long enough to hold its own
     * label before it is offered one at all. That is what makes the wheel a
     * legibility control: zoom in and the relationships name themselves, zoom
     * out and the shape of the graph is what is left. */
    const byLength = build.edges
      .map((edge, e) => {
        const a = sim.index(edge.a);
        const b = sim.index(edge.b);
        if (a === undefined || b === undefined) return null;
        const ax = sim.nodes[a].x * view.k + view.tx;
        const ay = sim.nodes[a].y * view.k + view.ty;
        const bx = sim.nodes[b].x * view.k + view.tx;
        const by = sim.nodes[b].y * view.k + view.ty;
        return { e, edge, ax, ay, bx, by, length: Math.hypot(bx - ax, by - ay) };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((p, q) => q.length - p.length);

    for (const row of byLength) {
      const element = edgeLabelRefs.current[row.e];
      if (!element) continue;
      const width = textWidth(row.edge.label, skin.subSize, skin.subFamily);
      if (row.length < skin.edgeLabelFloor || row.length < width + 30) {
        element.setAttribute("opacity", "0");
        continue;
      }
      const at = edgeLabelAt(row.ax, row.ay, row.bx, row.by, skin.bow);
      // The label is rotated along its edge; reserving its unrotated box is a
      // deliberate over-reservation, which is the safe direction for a test
      // that decides whether two strings collide.
      const half = Math.max(width, skin.subSize) / 2;
      const wanted: LabelBox = {
        x0: at.x - half,
        y0: at.y - half - 4,
        x1: at.x + half,
        y1: at.y + half,
      };
      const free = !placed.some((other) => overlaps(wanted, other));
      if (free) placed.push(wanted);
      element.setAttribute("opacity", free ? "1" : "0");
    }
  }, [build.edges, build.nodes, size, skin]);

  /** Write the current arrangement to the DOM. No allocation, no React. */
  const paint = useCallback(() => {
    const sim = simRef.current;
    if (!sim || !size) return;
    const view = viewRef.current;
    const nodes = sim.nodes;

    for (let i = 0; i < nodes.length; i += 1) {
      const element = nodeRefs.current.get(build.nodes[i].id);
      if (!element) continue;
      const x = nodes[i].x * view.k + view.tx;
      const y = nodes[i].y * view.k + view.ty;
      element.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    }

    for (let e = 0; e < build.edges.length; e += 1) {
      const path = edgeRefs.current[e];
      if (!path) continue;
      const a = sim.index(build.edges[e].a);
      const b = sim.index(build.edges[e].b);
      if (a === undefined || b === undefined) continue;
      const ax = nodes[a].x * view.k + view.tx;
      const ay = nodes[a].y * view.k + view.ty;
      const bx = nodes[b].x * view.k + view.tx;
      const by = nodes[b].y * view.k + view.ty;
      path.setAttribute("d", edgePath(ax, ay, bx, by, skin.bow));

      const label = edgeLabelRefs.current[e];
      if (!label) continue;
      const at = edgeLabelAt(ax, ay, bx, by, skin.bow);
      let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      label.setAttribute(
        "transform",
        `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)}) rotate(${angle.toFixed(1)})`,
      );
    }
  }, [build.edges, build.nodes, size, skin]);

  /** One frame: step the physics, ease the framing, write the DOM, and stop
   *  when there is nothing left moving. */
  const frame = useCallback(function step() {
    const sim = simRef.current;
    if (!sim || !size) {
      raf.current = 0;
      return;
    }
    const held = dragging.current !== null;
    if (sim.running || held) sim.tick();

    // The drawing frames ITSELF while it settles: the arrangement grows, and
    // the view eases out to keep it whole. Eased rather than snapped, or the
    // board jitters once per frame while the bounds wobble.
    let moving = false;
    if (!framed.current) {
      const target = fitView(sim.bounds(), size.width, size.height);
      const view = viewRef.current;
      const rate = sim.running ? 0.14 : 0.3;
      const k = view.k + (target.k - view.k) * rate;
      const tx = view.tx + (target.tx - view.tx) * rate;
      const ty = view.ty + (target.ty - view.ty) * rate;
      moving =
        Math.abs(k - view.k) > 0.0004 ||
        Math.abs(tx - view.tx) > 0.15 ||
        Math.abs(ty - view.ty) > 0.15;
      viewRef.current = moving ? { k, tx, ty } : target;
    }

    paint();
    sinceLabels.current += 1;
    if (sinceLabels.current >= 5) {
      sinceLabels.current = 0;
      relabel();
    }

    if (sim.running || held || moving) {
      raf.current = requestAnimationFrame(step);
    } else {
      raf.current = 0;
      relabel();
      // Remember where everything came to rest, so the next selection can
      // start from here.
      carried.current = new Map(sim.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    }
  }, [paint, relabel, size]);

  const wake = useCallback(() => {
    if (raf.current === 0) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  /* A new node set, or a new box: build the simulation. Nodes the last
   * arrangement already held keep their place, so changing the selection
   * MOVES the picture instead of replacing it. */
  useLayoutEffect(() => {
    if (!shown || !size || build.nodes.length === 0) {
      simRef.current = null;
      return;
    }
    const sim = new GraphSim(
      build.nodes.map((node) => node.id),
      build.edges.map((edge) => [edge.a, edge.b] as [string, string]),
      build.centre,
    );
    for (const node of sim.nodes) {
      const was = carried.current.get(node.id);
      if (!was || node.fx !== null) continue;
      node.x = was.x;
      node.y = was.y;
    }
    // A few steps before the first paint, so the drawing OPENS as a shape
    // expanding rather than as a knot untying.
    sim.settle(reducedMotion ? 320 : 10);
    if (reducedMotion) sim.alpha = 0;
    // The cloud grows into the shape of the tile it is drawn in.
    sim.fitTo(size.width / Math.max(1, size.height));
    simRef.current = sim;
    framed.current = false;
    viewRef.current = fitView(sim.bounds(), size.width, size.height);
    paint();
    relabel();
    wake();
    return () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [build, shown, size, paint, relabel, wake, reducedMotion]);

  /* ── Gestures ───────────────────────────────────────────────────────────
   * A wheel magnifies about the pointer; a drag on the field pans; a drag on
   * a node pins it under the pointer and reheats its neighbourhood; a press
   * that does NOT move is a click, and a click still selects exactly as a
   * table row does. */

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 };
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      if (!simRef.current) return;
      event.preventDefault();
      const at = pointFromEvent(event);
      // Per notch, not per pixel: a trackpad reports tiny deltas and a mouse
      // reports 100, and a raw multiplier makes one of the two unusable.
      const factor = Math.exp(-event.deltaY * 0.0016);
      viewRef.current = zoomAt(viewRef.current, at.x, at.y, factor);
      framed.current = true;
      paint();
      relabel();
    },
    [paint, pointFromEvent, relabel],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || !simRef.current) return;
      const target = (event.target as Element).closest("[data-node-id]");
      const id = target?.getAttribute("data-node-id") ?? null;
      svgRef.current?.setPointerCapture(event.pointerId);
      if (id !== null) {
        const index = simRef.current.index(id);
        if (index !== undefined) {
          dragging.current = { index, id, moved: false };
          wake();
          return;
        }
      }
      const at = pointFromEvent(event);
      panning.current = { x: at.x - viewRef.current.tx, y: at.y - viewRef.current.ty };
      svgRef.current?.setAttribute("data-panning", "true");
    },
    [pointFromEvent, wake],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const at = pointFromEvent(event);
      const held = dragging.current;
      if (held) {
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
      if (panning.current) {
        viewRef.current = {
          ...viewRef.current,
          tx: at.x - panning.current.x,
          ty: at.y - panning.current.y,
        };
        framed.current = true;
        paint();
        return;
      }
      // Hover: the drawing dims everything the hovered node is not attached
      // to. The neighbourhood is marked in the DOM and the FADE is CSS, so a
      // hover costs one attribute write and no frame.
      const node = (event.target as Element).closest("[data-node-id]");
      const id = node?.getAttribute("data-node-id") ?? null;
      if (id === hovered.current) return;
      hovered.current = id;
      const svg = svgRef.current;
      if (!svg) return;
      svg.setAttribute("data-focused", id === null ? "false" : "true");
      if (id === null) return;
      const near = new Set<string>([id]);
      for (const edge of build.edges) {
        if (edge.a === id) near.add(edge.b);
        else if (edge.b === id) near.add(edge.a);
      }
      for (const [nodeId, element] of nodeRefs.current) {
        element.setAttribute("data-near", near.has(nodeId) ? "true" : "false");
      }
      build.edges.forEach((edge, e) => {
        const path = edgeRefs.current[e]?.parentElement;
        path?.setAttribute("data-near", edge.a === id || edge.b === id ? "true" : "false");
      });
    },
    [build.edges, paint, pointFromEvent, wake],
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      svgRef.current?.removeAttribute("data-panning");
      panning.current = null;
      const held = dragging.current;
      dragging.current = null;
      if (!held) return;
      const sim = simRef.current;
      if (!sim) return;
      if (held.moved) {
        // A node the reader placed STAYS placed. It is the only way to untangle
        // a crowded relationship set by hand, and letting it spring back would
        // undo the one thing a drag is for.
        sim.reheat(0.25);
        wake();
        return;
      }
      // Not a drag: a click. The centre keeps its pin; everything else is
      // released so the arrangement can breathe again.
      const node = build.nodes.find((candidate) => candidate.id === held.id);
      if (node?.id !== build.centre) sim.unpin(held.index);
      if (node?.guid) {
        onPick(node.guid, event.shiftKey || event.ctrlKey || event.metaKey);
      }
      wake();
    },
    [build.centre, build.nodes, onPick, wake],
  );

  const selected = new Set(selection);
  const labelMax = build.nodes.length > 28 ? 14 : 22;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <section className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border border-line bg-panel">
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-2 pt-1.5 pb-1">
          <MicroLabel>{t("object.relations", lang)}</MicroLabel>
          {centreGuid ? (
            <>
              <Switch
                on={psets}
                label={t("type.psets", lang)}
                onChange={() => setPsets((on) => !on)}
              />
              <Switch
                on={quantities}
                label={t("graph.quantitySets", lang)}
                onChange={() => setQuantities((on) => !on)}
              />
            </>
          ) : null}
          <span className="ml-auto shrink-0 self-center font-mono text-[10px] tabular-nums text-muted">
            {`${formatCount(build.nodes.length, lang)} · ${formatCount(build.edges.length, lang)}`}
          </span>
        </div>
        <div
          ref={box}
          data-graph-field
          // The SVG is sized from a MEASUREMENT, and a measurement is one
          // frame behind the box on the frame the derivation band opens under
          // it. Clipping here means a node can never be drawn over the band,
          // whatever the measurement is doing that frame.
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-ground"
        >
          <svg
            ref={svgRef}
            data-graph
            width={size?.width ?? 0}
            height={size?.height ?? 0}
            viewBox={`0 0 ${size?.width ?? 0} ${size?.height ?? 0}`}
            className="block"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onPointerLeave={() => {
              hovered.current = null;
              svgRef.current?.setAttribute("data-focused", "false");
            }}
          >
            {build.nodes.length > 0 ? (
              <>
                <g>
                  {build.edges.map((edge, e) => (
                    <g key={`${edge.a}->${edge.b}:${edge.label}:${e}`} data-edge>
                      <path
                        ref={(element) => {
                          edgeRefs.current[e] = element;
                        }}
                        fill="none"
                        stroke="var(--color-line)"
                        strokeWidth={skin.edgeWidth}
                        strokeOpacity={skin.edgeAlpha}
                      />
                      <g
                        ref={(element) => {
                          edgeLabelRefs.current[e] = element;
                        }}
                        opacity={0}
                      >
                        <text
                          y={-4}
                          textAnchor="middle"
                          fontFamily={`var(--font-${skin.subFamily})`}
                          fontSize={skin.subSize}
                          letterSpacing={`${skin.subTracking}em`}
                          fill="var(--color-muted)"
                        >
                          {edge.label}
                        </text>
                      </g>
                    </g>
                  ))}
                </g>
                <g>
                  {build.nodes.map((node) => (
                    <GraphNode
                      key={node.id}
                      node={node}
                      skin={skin}
                      active={node.guid !== undefined && selected.has(node.guid)}
                      labelMax={labelMax}
                      onNode={(element) => {
                        if (element) nodeRefs.current.set(node.id, element);
                        else nodeRefs.current.delete(node.id);
                      }}
                      onLabel={(element) => {
                        if (element) labelRefs.current.set(node.id, element);
                        else labelRefs.current.delete(node.id);
                      }}
                      onPick={onPick}
                    />
                  ))}
                </g>
              </>
            ) : size && shown ? (
              // The object panel's own vocabulary: no profile at all, versus a
              // profile that declares nothing to draw. Not drawn while the tab
              // is hidden, where "nothing to draw" is about the tab.
              <text
                x={12}
                y={size.height / 2}
                fontFamily="var(--font-mono)"
                fontSize={11}
                fill="var(--color-muted)"
              >
                {profile ? t("type.none", lang) : t("type.notSupplied", lang)}
              </text>
            ) : null}
          </svg>
        </div>
      </section>
    </div>
  );
}

/** One node: its glyph, its ring when selected, and its label as a separate
 *  group the collision pass can hide without touching the glyph. Keyboard
 *  reaches it the same way it always did. */
function GraphNode({
  node,
  skin,
  active,
  labelMax,
  onNode,
  onLabel,
  onPick,
}: {
  node: GraphNode;
  skin: GraphSkin;
  active: boolean;
  labelMax: number;
  onNode: (element: SVGGElement | null) => void;
  onLabel: (element: SVGGElement | null) => void;
  onPick: (guid: string, additive: boolean) => void;
}) {
  const guid = node.guid ?? null;
  const label = clip(node.label, node.kind === "self" ? 30 : labelMax);
  const subFull = node.sub ?? null;
  const sub = subFull ? clip(subFull, 24) : null;
  const size = node.kind === "self" ? skin.labelSize + 1 : skin.labelSize;
  const chipWidth = textWidth(label, size, skin.labelFamily) + 10;
  return (
    <g
      ref={onNode}
      data-node-id={node.id}
      data-node={guid ?? undefined}
      role={guid ? "button" : undefined}
      tabIndex={guid ? 0 : undefined}
      aria-label={guid ? node.label : undefined}
      className={guid ? "cursor-pointer" : undefined}
      onKeyDown={
        guid
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onPick(guid, event.shiftKey || event.ctrlKey || event.metaKey);
            }
          : undefined
      }
    >
      {skin.halo > 0 ? (
        <circle
          r={(node.kind === "self" ? 11 : 8) * skin.scale + skin.halo * 3}
          fill="var(--color-ink)"
          opacity={0.07}
        />
      ) : null}
      {active && node.kind !== "self" ? (
        <circle
          r={13 * skin.scale}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth={skin.activeWidth}
        />
      ) : null}
      <g transform={skin.scale === 1 ? undefined : `scale(${skin.scale})`}>{GLYPH[node.kind]}</g>
      <g ref={onLabel} opacity={0}>
        {skin.chip ? (
          <rect
            x={-chipWidth / 2}
            y={(node.kind === "self" ? 26 : 21) - size + 1}
            width={chipWidth}
            height={size + 5}
            rx={skin.chipRadius}
            fill="var(--color-panel)"
            opacity={0.86}
          />
        ) : null}
        <text
          y={node.kind === "self" ? 26 : 21}
          textAnchor="middle"
          fontFamily={`var(--font-${skin.labelFamily})`}
          fontSize={size}
          fontWeight={node.kind === "self" ? skin.labelWeight + 100 : skin.labelWeight}
          fill="var(--color-ink)"
        >
          {label.length < node.label.length ? <title>{node.label}</title> : null}
          {label}
        </text>
        {sub && subFull ? (
          <text
            y={node.kind === "self" ? 38 : 32}
            textAnchor="middle"
            fontFamily={`var(--font-${skin.subFamily})`}
            fontSize={skin.subSize}
            letterSpacing={`${skin.subTracking}em`}
            fill="var(--color-muted)"
          >
            {sub.length < subFull.length ? <title>{subFull}</title> : null}
            {sub}
          </text>
        ) : null}
      </g>
    </g>
  );
}
