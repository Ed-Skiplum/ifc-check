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
 * ── The layout ───────────────────────────────────────────────────────────
 * A small spring embedder written here rather than a dependency: repulsion
 * between every pair, a spring along every edge, a weak pull to the centre, a
 * fixed iteration count and a cooling step cap. Start positions come from a
 * FNV hash of the node id, so the same element lays out the same way every
 * time it is opened — a graph that reshuffles on each visit cannot be read
 * twice. The selected element is pinned at the origin; the result is fitted
 * into the measured container box, so glyphs and labels keep their px size at
 * any width and 1100 px (the skiplum.com iframe) is a normal case.
 *
 * Labels only — the node's name and its IFC term, the edge's relationship
 * name. A label that does not fit ellipsizes and carries the full text in
 * `title`.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { MicroLabel } from "./BentoGrid";
import { Switch } from "./Switch";
import type { ModelProfile, ProductRowLite } from "./profile";

/** How many members of one relationship group are drawn before the rest
 *  collapse into a `+N` node. A wall with forty openings is forty labels no
 *  one can read; the count is the honest summary and the panel still has the
 *  full list. */
const MAX_PER_GROUP = 12;
/** Total ceiling, so the O(n²) embedder stays inside a frame. */
const MAX_NODES = 180;
const ITERATIONS = 360;

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

interface Point {
  x: number;
  y: number;
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

/* ----------------------------------------------------------------- layout */

/** FNV-1a over the node id: the seed for its start position, so the same
 *  element lays out identically every time. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const REPULSION = 11000;
const SPRING = 0.04;
const REST_LENGTH = 92;
const CENTRE_PULL = 0.013;

/** Repulsion between every pair, a spring along every edge, a weak pull to the
 *  origin, a fixed number of iterations and a step that cools linearly. No
 *  randomness anywhere: the seed is the id. */
function layout(nodes: GraphNode[], edges: GraphEdge[], centre: string | null): Map<string, Point> {
  const n = nodes.length;
  const at = new Map(nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const seed = seedOf(nodes[i].id);
    const angle = ((seed % 4096) / 4096) * Math.PI * 2;
    const radius = 24 + (((seed >>> 12) % 1024) / 1024) * 130;
    x[i] = Math.cos(angle) * radius;
    y[i] = Math.sin(angle) * radius;
  }
  const pinned = centre === null ? -1 : (at.get(centre) ?? -1);
  if (pinned >= 0) {
    x[pinned] = 0;
    y[pinned] = 0;
  }

  const links: number[][] = [];
  for (const edge of edges) {
    const a = at.get(edge.a);
    const b = at.get(edge.b);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  for (let step = 0; step < ITERATIONS; step += 1) {
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let ux = x[i] - x[j];
        let uy = y[i] - y[j];
        let d2 = ux * ux + uy * uy;
        if (d2 < 0.01) {
          // Two nodes on the same point have no direction to separate along;
          // take one from the indices rather than from a random number, so the
          // layout stays reproducible.
          ux = ((i * 7 + 3) % 11) - 5;
          uy = ((j * 5 + 1) % 11) - 5;
          d2 = ux * ux + uy * uy || 1;
        }
        const d = Math.sqrt(d2);
        const force = REPULSION / d2;
        fx[i] += (ux / d) * force;
        fy[i] += (uy / d) * force;
        fx[j] -= (ux / d) * force;
        fy[j] -= (uy / d) * force;
      }
    }
    for (const [a, b] of links) {
      const ux = x[b] - x[a];
      const uy = y[b] - y[a];
      const d = Math.sqrt(ux * ux + uy * uy) || 0.001;
      const force = SPRING * (d - REST_LENGTH);
      fx[a] += (ux / d) * force;
      fy[a] += (uy / d) * force;
      fx[b] -= (ux / d) * force;
      fy[b] -= (uy / d) * force;
    }
    const cool = 24 * (1 - step / ITERATIONS) + 0.6;
    for (let i = 0; i < n; i += 1) {
      if (i === pinned) {
        x[i] = 0;
        y[i] = 0;
        continue;
      }
      fx[i] -= x[i] * CENTRE_PULL;
      fy[i] -= y[i] * CENTRE_PULL;
      const len = Math.hypot(fx[i], fy[i]) || 0.000001;
      const take = Math.min(len, cool);
      x[i] += (fx[i] / len) * take;
      y[i] += (fy[i] / len) * take;
    }
  }

  const out = new Map<string, Point>();
  nodes.forEach((node, i) => out.set(node.id, { x: x[i], y: y[i] }));
  return out;
}

/** Fit the laid-out cloud into the measured box. Positions scale; glyphs and
 *  labels do not, so the drawing reads the same at 700 px and at 1440 px. */
function fit(points: Map<string, Point>, width: number, height: number): Map<string, Point> {
  const pad = 54;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return points;
  const scale = Math.min(
    (width - pad * 2) / Math.max(1, maxX - minX),
    (height - pad * 2) / Math.max(1, maxY - minY),
    1.5,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out = new Map<string, Point>();
  for (const [id, point] of points) {
    out.set(id, {
      x: width / 2 + (point.x - cx) * scale,
      y: height / 2 + (point.y - cy) * scale,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- drawing */

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

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
      fill="var(--color-cream)"
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

function Edge({ from, to, label }: { from: Point; to: Point; label: string }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  // 8 px mono is ~4.9 px per character; the label never runs past its own edge.
  const room = Math.max(0, Math.floor((length - 26) / 4.9));
  const text = room >= 4 ? clip(label, room) : "";
  // Not the midpoint: the graph is a FAN from the selected element, so every
  // edge's midpoint lands in the same crowded ring near the hub and the labels
  // overprint each other. Two thirds out, the arc between neighbouring edges is
  // twice as wide and they separate on their own.
  const at = { x: from.x + dx * 0.68, y: from.y + dy * 0.68 };
  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="var(--color-line)"
        strokeWidth={1.25}
      />
      {text ? (
        <text
          x={at.x}
          y={at.y - 3.5}
          transform={`rotate(${angle} ${at.x} ${at.y - 3.5})`}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={8}
          fill="var(--color-muted)"
        >
          {text.length < label.length ? <title>{label}</title> : null}
          {text}
        </text>
      ) : null}
    </g>
  );
}

function Node({
  node,
  point,
  active,
  labelMax,
  onPick,
}: {
  node: GraphNode;
  point: Point;
  active: boolean;
  /** Characters a non-centre label may take before it ellipsizes. Measured at
   *  1100 px the embedder leaves ~90 px between neighbours on an element graph
   *  and ~48 px on a forty-storey model graph, so a crowded graph gets the
   *  shorter cap rather than overlapping labels. The full text is in `title`. */
  labelMax: number;
  onPick: (guid: string, additive: boolean) => void;
}) {
  const guid = node.guid ?? null;
  const label = clip(node.label, node.kind === "self" ? 30 : labelMax);
  const subFull = node.sub ?? null;
  const sub = subFull ? clip(subFull, 24) : null;
  return (
    <g
      transform={`translate(${point.x} ${point.y})`}
      data-node={guid ?? undefined}
      role={guid ? "button" : undefined}
      tabIndex={guid ? 0 : undefined}
      aria-label={guid ? node.label : undefined}
      className={guid ? "cursor-pointer" : undefined}
      onClick={
        guid
          ? (event) => onPick(guid, event.shiftKey || event.ctrlKey || event.metaKey)
          : undefined
      }
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
      {active && node.kind !== "self" ? (
        <circle r={13} fill="none" stroke="var(--color-gold)" strokeWidth={2} />
      ) : null}
      {GLYPH[node.kind]}
      <text
        y={node.kind === "self" ? 26 : 21}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={node.kind === "self" ? 11 : 10}
        fontWeight={node.kind === "self" ? 600 : 400}
        fill="var(--color-ink)"
      >
        {label.length < node.label.length ? <title>{node.label}</title> : null}
        {label}
      </text>
      {sub && subFull ? (
        <text
          y={node.kind === "self" ? 38 : 32}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--color-muted)"
        >
          {sub.length < subFull.length ? <title>{subFull}</title> : null}
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ panel */

export function GraphTab({
  lang,
  profile,
  selection,
  onPick,
}: {
  lang: Lang;
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

  // The tab is `hidden` while another tab is active, so it has no box at all
  // until it is shown. A zero measurement keeps the LAST size — so reopening
  // the tab does not repaint at a different width — but clears `shown`, and
  // the embedder below runs only while shown: a selection made on Kontroll
  // must not cost a layout pass for a graph nobody is looking at.
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

  const points = useMemo(() => {
    if (build.nodes.length === 0 || !size || !shown) return null;
    return fit(layout(build.nodes, build.edges, build.centre), size.width, size.height);
  }, [build, size, shown]);

  const pick = useCallback(
    (guid: string, additive: boolean) => onPick(guid, additive),
    [onPick],
  );

  const selected = new Set(selection);

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
        <div ref={box} className="min-h-0 min-w-0 flex-1 bg-cream">
          <svg
            data-graph
            width={size?.width ?? 0}
            height={size?.height ?? 0}
            viewBox={`0 0 ${size?.width ?? 0} ${size?.height ?? 0}`}
            className="block"
          >
            {points ? (
              <>
                {build.edges.map((edge, i) => {
                  const from = points.get(edge.a);
                  const to = points.get(edge.b);
                  if (!from || !to) return null;
                  return (
                    <Edge
                      key={`${edge.a}->${edge.b}:${edge.label}:${i}`}
                      from={from}
                      to={to}
                      label={edge.label}
                    />
                  );
                })}
                {build.nodes.map((node) => {
                  const point = points.get(node.id);
                  if (!point) return null;
                  return (
                    <Node
                      key={node.id}
                      node={node}
                      point={point}
                      active={node.guid !== undefined && selected.has(node.guid)}
                      labelMax={build.nodes.length > 28 ? 12 : 22}
                      onPick={pick}
                    />
                  );
                })}
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
