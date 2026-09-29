/** WHAT the Graf tab draws: the drill, as nodes and edges. Pure, no DOM.
 *
 * The drill is the ifcfast demo's (`ifc-fast-demo/components/drill-graph.tsx`,
 * the graph edkjo called "way better", 2026-09-25). It opens at the spatial
 * crown and expands on click, each level bounded, so the drawing stays small
 * and quick on a model of thousands of products:
 *
 *   building -> storey -> [class bucket] -> product
 *
 * The selected element is where ifc-check's own graph lives on: its
 * relationships bloom out of its node, every edge an `IfcRel*` the profile
 * really carries (type and the siblings sharing it, parent and parts,
 * openings and host, materials, classifications, property and quantity sets).
 * A category whose table is absent gets ONE node reading `ikke levert`, so
 * "nobody supplied this" never draws like "this element has none".
 *
 * Not drawn, because the engine does not carry it (unchanged from the graph
 * this replaces): building -> site (sites are a flat roster and reach no
 * edge), element containment in a site, building or space (`contained_in` is
 * storey-only), and `IfcProject` (a count, no guids). So there is no project
 * node at the crown the way the demo had one.
 */

import type { CheckResult } from "../engine/types";
import { verdictOf } from "../engine/fundamentals";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile, ProductRowLite } from "./profile";

/** The demo's per-group cap: a bucket opens at most this many products and
 *  the rest become one `+N` node. */
export const PER_GROUP_CAP = 400;
/** Ceiling on the whole drawing, so the physics and the paint stay inside a
 *  frame. */
export const MAX_NODES = 2000;
/** Members of one relationship group around the selected element before the
 *  rest collapse into `+N` (ifc-check's cap, kept). */
const MAX_PER_REL = 12;

export type NodeKind =
  | "site"
  | "building"
  | "storey"
  | "bucket"
  | "group"
  | "product"
  | "more"
  | "type"
  | "count"
  | "material"
  | "classification"
  | "pset"
  | "quantity";

export type Tone = "fail" | "warn" | null;

export interface GNode {
  id: string;
  kind: NodeKind;
  /** The text drawn beside the node when it is labelled. */
  label: string;
  /** What hovering it says: the demo's `entity · name` / `name · count`. */
  tip: string;
  /** Set only on nodes that ARE elements of this model. */
  guid?: string;
  entity?: string;
  /** Storey key of a storey, bucket or group: the storey guid, or null for
   *  the no-storey bucket. */
  storey?: string | null;
  count?: number;
  /** Worst verdict among the elements this node stands for. */
  tone: Tone;
  /** The node it grows out of, for where it is born. */
  parent?: string;
  /** Whether a click opens it. */
  expandable: boolean;
}

export interface GEdge {
  a: string;
  b: string;
  /** The `IfcRel*` this edge IS, or "" for the drill's own grouping. */
  label: string;
  rest: number;
}

export interface Drill {
  nodes: GNode[];
  edges: GEdge[];
}

export interface DrillIndex {
  byId: Map<string, ProductRowLite>;
  /** storey key -> entity -> rows, in file order. */
  cells: Map<string | null, Map<string, ProductRowLite[]>>;
  storeyTotal: Map<string | null, number>;
  childrenOf: Map<string, ProductRowLite[]>;
  typeCount: Map<string, number>;
  known: Set<string>;
  entities: string[];
}

export function storeyKeyOf(row: ProductRowLite, known: Set<string>): string | null {
  return row.storeyGuid !== null && known.has(row.storeyGuid) ? row.storeyGuid : null;
}

export function indexProfile(profile: ModelProfile): DrillIndex {
  const known = new Set(profile.storeys.map((s) => s.guid));
  const byId = new Map<string, ProductRowLite>();
  const cells = new Map<string | null, Map<string, ProductRowLite[]>>();
  const storeyTotal = new Map<string | null, number>();
  const childrenOf = new Map<string, ProductRowLite[]>();
  const typeCount = new Map<string, number>();
  const entities = new Set<string>();
  for (const row of profile.rows) {
    byId.set(row.guid, row);
    entities.add(row.entity);
    const key = storeyKeyOf(row, known);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = new Map()));
    let list = cell.get(row.entity);
    if (!list) cell.set(row.entity, (list = []));
    list.push(row);
    storeyTotal.set(key, (storeyTotal.get(key) ?? 0) + 1);
    if (row.parentGuid) {
      let kids = childrenOf.get(row.parentGuid);
      if (!kids) childrenOf.set(row.parentGuid, (kids = []));
      kids.push(row);
    }
    const typeKey = row.typeGuid ?? (row.typeName ? `name:${row.typeName}` : null);
    if (typeKey) typeCount.set(typeKey, (typeCount.get(typeKey) ?? 0) + 1);
  }
  return { byId, cells, storeyTotal, childrenOf, typeCount, known, entities: [...entities] };
}

/** Worst verdict per element, from the checks that found it. */
export function tonesOf(checks: CheckResult[] | undefined): Map<string, Tone> {
  const tones = new Map<string, Tone>();
  for (const check of checks ?? []) {
    const verdict = verdictOf(check);
    if (verdict !== "fail" && verdict !== "warn") continue;
    for (const finding of check.findings) {
      if (tones.get(finding.guid) === "fail") continue;
      tones.set(finding.guid, verdict);
    }
  }
  return tones;
}

function worst(a: Tone, b: Tone): Tone {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "warn" || b === "warn") return "warn";
  return null;
}

export const storeyId = (key: string | null) => (key === null ? "s:none" : `s:${key}`);
export const groupId = (key: string | null, entity: string) => `g:${key ?? "none"}:${entity}`;
const elementId = (guid: string) => `e:${guid}`;

function aggregateLabel(kind: string | null | undefined): string {
  return kind && kind.startsWith("IfcRel") ? kind : "IfcRelAggregates · IfcRelNests";
}

export function buildDrill(
  profile: ModelProfile,
  index: DrillIndex,
  tones: Map<string, Tone>,
  expanded: ReadonlySet<string>,
  centre: string | null,
  show: { psets: boolean; quantities: boolean },
  lang: Lang,
  /** The drill's own index (storeys, buckets, products): the cross-filter's
   *  matching rows when another view is the origin, so only matching nodes
   *  and buckets are drawn (2026-09-28). The selected element's relations
   *  still read the whole model (`index`): a type's siblings are its
   *  siblings whatever is filtered. */
  drillIndex: DrillIndex = index,
  /** The whole selection: each one is drawn in its bucket even past the cap,
   *  so a multi-select made in the 3D shows every picked product. */
  picked: readonly string[] = centre ? [centre] : [],
): Drill {
  const isolated = drillIndex !== index;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (node: GNode): string | null => {
    if (seen.has(node.id)) return node.id;
    if (nodes.length >= MAX_NODES) return null;
    seen.add(node.id);
    nodes.push(node);
    return node.id;
  };
  const link = (a: string | null, b: string | null, label: string, rest: number) => {
    if (a && b && a !== b) edges.push({ a, b, label, rest });
  };
  const elementNode = (row: ProductRowLite, parent: string): GNode => ({
    id: elementId(row.guid),
    kind: "product",
    label: row.name || row.guid,
    tip: `${row.entity} · ${row.name || row.guid}`,
    guid: row.guid,
    entity: row.entity,
    tone: tones.get(row.guid) ?? null,
    parent,
    expandable: false,
  });

  const toneOfRows = (rows: ProductRowLite[]): Tone => {
    let tone: Tone = null;
    for (const row of rows) {
      tone = worst(tone, tones.get(row.guid) ?? null);
      if (tone === "fail") break;
    }
    return tone;
  };

  // Crown. Sites are listed and reach no edge (see the header).
  for (const site of profile.sites ?? []) {
    add({
      id: `site:${site.guid}`,
      kind: "site",
      label: site.name ?? site.guid,
      tip: `IfcSite · ${site.name ?? site.guid}`,
      tone: null,
      expandable: false,
    });
  }
  const buildingTotal = new Map<string, number>();
  for (const storey of profile.storeys) {
    if (storey.buildingGuid) {
      buildingTotal.set(
        storey.buildingGuid,
        (buildingTotal.get(storey.buildingGuid) ?? 0) + (drillIndex.storeyTotal.get(storey.guid) ?? 0),
      );
    }
  }
  const buildings = new Set<string>();
  for (const building of profile.buildings ?? []) {
    buildings.add(building.guid);
    add({
      id: `b:${building.guid}`,
      kind: "building",
      label: building.name ?? building.guid,
      tip: `IfcBuilding · ${building.name ?? building.guid}`,
      count: buildingTotal.get(building.guid) ?? 0,
      tone: null,
      expandable: false,
    });
  }

  const storeyKeys: (string | null)[] = profile.storeys
    .map((s) => s.guid)
    .filter((g) => !isolated || (drillIndex.storeyTotal.get(g) ?? 0) > 0);
  if ((drillIndex.storeyTotal.get(null) ?? 0) > 0) storeyKeys.push(null);

  for (const key of storeyKeys) {
    const storey = key === null ? null : profile.storeys.find((s) => s.guid === key);
    const count = drillIndex.storeyTotal.get(key) ?? 0;
    const name = key === null ? t("matrix.noStorey", lang) : (storey?.name ?? key);
    const cell = drillIndex.cells.get(key);
    let tone: Tone = null;
    for (const rows of cell?.values() ?? []) tone = worst(tone, toneOfRows(rows));
    const parent = storey?.buildingGuid && buildings.has(storey.buildingGuid)
      ? `b:${storey.buildingGuid}`
      : undefined;
    const sid = add({
      id: storeyId(key),
      kind: key === null ? "bucket" : "storey",
      label: `${name} · ${formatCount(count, lang)}`,
      tip: `${key === null ? name : "IfcBuildingStorey"} · ${name} · ${formatCount(count, lang)}`,
      storey: key,
      count,
      tone,
      parent,
      expandable: count > 0,
    });
    if (parent) link(parent, sid, "IfcRelAggregates", 46);
    if (!sid || !expanded.has(sid) || !cell) continue;

    const byCount = [...cell.entries()].sort((p, q) => q[1].length - p[1].length);
    for (const [entity, rows] of byCount) {
      const gid = add({
        id: groupId(key, entity),
        kind: "group",
        label: `${entity.replace(/^Ifc/, "")} ${formatCount(rows.length, lang)}`,
        tip: `${entity} · ${formatCount(rows.length, lang)}`,
        entity,
        storey: key,
        count: rows.length,
        tone: toneOfRows(rows),
        parent: sid,
        expandable: true,
      });
      link(sid, gid, key === null ? "" : "IfcRelContainedInSpatialStructure", 34);
      if (!gid || !expanded.has(gid)) continue;
      const shown = rows.slice(0, PER_GROUP_CAP);
      // The selected elements are always drawn, even past the cap.
      if (rows.length > PER_GROUP_CAP) {
        const want = new Set(picked);
        if (centre) want.add(centre);
        for (const r of shown) want.delete(r.guid);
        if (want.size > 0) for (const r of rows) if (want.has(r.guid)) shown.push(r);
      }
      for (const row of shown) link(gid, add(elementNode(row, gid)), "", 26);
      const rest = rows.length - PER_GROUP_CAP;
      if (rest > 0) {
        const mid = add({
          id: `more:${gid}`,
          kind: "more",
          label: `+${formatCount(rest, lang)}`,
          tip: `${entity} · +${formatCount(rest, lang)}`,
          tone: null,
          parent: gid,
          expandable: false,
        });
        link(gid, mid, "", 30);
      }
    }
  }

  const row = centre ? index.byId.get(centre) : undefined;
  if (row && seen.has(elementId(row.guid))) {
    addRelations(row);
  }

  function addRelations(row: ProductRowLite) {
    const self = elementId(row.guid);
    const rel = (node: Omit<GNode, "parent" | "expandable" | "tone"> & { tone?: Tone }) =>
      add({ tone: null, ...node, parent: self, expandable: false });

    const linkRows = (rows: ProductRowLite[], label: string) => {
      for (const other of rows.slice(0, MAX_PER_REL)) {
        link(self, add(elementNode(other, self)), label, 58);
      }
      const rest = rows.length - MAX_PER_REL;
      if (rest > 0) {
        link(
          self,
          rel({
            id: `${self}:${label}:rest`,
            kind: "count",
            label: `+${formatCount(rest, lang)}`,
            tip: `${label} · +${formatCount(rest, lang)}`,
          }),
          label,
          58,
        );
      }
    };

    // IfcRelDefinesByType, and the siblings sharing the type.
    if (row.typeGuid || row.typeName) {
      const key = row.typeGuid ?? `name:${row.typeName}`;
      const typeId = rel({
        id: `t:${key}`,
        kind: "type",
        label: row.typeName ?? key,
        tip: `${row.typeSource ?? "IfcTypeObject"} · ${row.typeName ?? key}`,
      });
      link(self, typeId, "IfcRelDefinesByType", 64);
      const siblings = (index.typeCount.get(key) ?? 1) - 1;
      if (siblings > 0) {
        link(
          typeId,
          rel({
            id: `t:${key}:siblings`,
            kind: "count",
            label: `${t("object.siblings", lang)} ${formatCount(siblings, lang)}`,
            tip: `${t("object.siblings", lang)} · ${formatCount(siblings, lang)}`,
          }),
          "IfcRelDefinesByType",
          40,
        );
      }
    }

    const parent = row.parentGuid ? index.byId.get(row.parentGuid) : undefined;
    if (parent) link(add(elementNode(parent, self)), self, aggregateLabel(row.parentKind), 58);
    const children = index.childrenOf.get(row.guid) ?? [];
    if (children.length > 0) linkRows(children, aggregateLabel(children[0].parentKind));

    const openings = (row.openingGuids ?? [])
      .map((g) => index.byId.get(g))
      .filter((r): r is ProductRowLite => r !== undefined);
    if (openings.length > 0) linkRows(openings, "IfcRelVoidsElement");
    const host = row.hostGuid ? index.byId.get(row.hostGuid) : undefined;
    if (host) link(add(elementNode(host, self)), self, "IfcRelVoidsElement", 58);

    for (const material of row.materials ?? []) {
      link(
        self,
        rel({ id: `m:${material}`, kind: "material", label: material, tip: `IfcMaterial · ${material}` }),
        "IfcRelAssociatesMaterial",
        64,
      );
    }

    const absent = (id: string, kind: NodeKind, ifc: string, label: string) => {
      const text = `${ifc} · ${t("type.notSupplied", lang)}`;
      link(self, rel({ id, kind, label: text, tip: text }), label, 64);
    };

    if (profile.classifications === undefined) {
      absent("c:absent", "classification", "IfcClassification", "IfcRelAssociatesClassification");
    } else {
      const systems: string[] = [];
      for (const ref of profile.classifications.get(row.guid) ?? []) {
        const system = ref.system ?? ref.code ?? "";
        if (system && !systems.includes(system)) systems.push(system);
      }
      for (const system of systems) {
        link(
          self,
          rel({
            id: `c:${system}`,
            kind: "classification",
            label: system,
            tip: `IfcClassification · ${system}`,
          }),
          "IfcRelAssociatesClassification",
          64,
        );
      }
    }

    if (show.psets) {
      if (profile.psets === undefined) {
        absent("p:absent", "pset", "IfcPropertySet", "IfcRelDefinesByProperties");
      } else {
        for (const group of profile.psets.get(row.guid) ?? []) {
          const ifc = group.quantity ? "IfcElementQuantity" : "IfcPropertySet";
          link(
            self,
            rel({
              id: `p:${group.name}`,
              kind: group.quantity ? "quantity" : "pset",
              label: group.name,
              tip: `${ifc} · ${group.name}`,
            }),
            "IfcRelDefinesByProperties",
            52,
          );
        }
      }
    }
    if (show.quantities) {
      if (profile.quantities === undefined) {
        absent("q:absent", "quantity", "IfcElementQuantity", "IfcRelDefinesByProperties");
      } else {
        for (const group of profile.quantities.get(row.guid) ?? []) {
          link(
            self,
            rel({
              id: `q:${group.name}`,
              kind: "quantity",
              label: group.name,
              tip: `IfcElementQuantity · ${group.name}`,
            }),
            "IfcRelDefinesByProperties",
            52,
          );
        }
      }
    }
  }

  return { nodes, edges };
}
