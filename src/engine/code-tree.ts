/** The two code treemaps of the board, as data (edkjo 2026-09-25: *"treemap
 * that defaults to ifctype/class, but when configured shows the project
 * classification code for system. Another for component codes for function
 * that can show predefined type as fallback."*).
 *
 * Pure: it groups what it is handed and computes nothing about the model.
 * With a mapping configured, the per-object readings come from
 * `codeLookupSubjects` (src/ids/evaluate.ts), the same path the mapping rule
 * and its report row count, so a cell and the requirement's fordeling agree.
 *
 *   system    the `system-classification` code (NS 3451), nested by level
 *             (2 → 22 → 226). With no mapping: IFC class, one level, no
 *             further split.
 *   function  the `component-classification` code (NS 3457-8), nested by
 *             level (Q → QL → QLD). An object with no code falls back to its
 *             PredefinedType, as its own kind of cell (`fallback`), never
 *             mixed in with the codes. With no mapping every object falls
 *             back.
 *
 * Values the rule judged deviating get a `deviating` cell per raw value, and
 * an object with nothing to show gets the one `missing` cell. Nothing else is
 * dropped: the leaf counts sum to the objects handed in, less the spaces.
 *
 * Spaces are not in either tree (edkjo 2026-09-28: *"spaces should be kept
 * separate from the treemap"*). An IfcSpace is a volume of air, not a
 * component; on Volum the rooms filled the map (17 100 of about 17 600 m³ on
 * HI90_ARK). They have their own tab, Rom (`rooms.ts`).
 */

export type TreeKind = "code" | "class" | "type" | "fallback" | "deviating" | "missing";

export interface TreeNode {
  /** Unique within the tree, stable across renders: the node's path. */
  key: string;
  /** What the cell prints: a code, a class, a type name or a raw value.
   *  null on `missing`. */
  label: string | null;
  /** The code's name in the bundled list, on `code` nodes that have one. */
  name: string | null;
  kind: TreeKind;
  n: number;
  /** Every object under this node. */
  guids: string[];
  children: TreeNode[];
}

export interface CodeTree {
  axis: "system" | "function";
  /** What grouped the objects: the mapping's codes, or the unconfigured
   *  default. */
  by: "mapping" | "ifc-class" | "predefined-type";
  n: number;
  root: TreeNode[];
}

export interface TreeObject {
  guid: string;
  entity: string;
  typeName: string | null;
  predefinedType: string | null;
}

/** One object as the mapping rule judged it (`CodeLookupSubject`). */
export interface TreeReading {
  guid: string;
  value: string | null;
  code: string | null;
  state: "ok" | "deviating" | "missing";
}

interface Draft {
  node: TreeNode;
  kids: Map<string, Draft>;
}

function draft(key: string, label: string | null, name: string | null, kind: TreeKind): Draft {
  return { node: { key, label, name, kind, n: 0, guids: [], children: [] }, kids: new Map() };
}

function add(level: Map<string, Draft>, key: string, make: () => Draft, guid: string): Draft {
  let d = level.get(key);
  if (!d) {
    d = make();
    level.set(key, d);
  }
  d.node.n += 1;
  d.node.guids.push(guid);
  return d;
}

/** Largest first, the `missing` cell last among equals, then by label, so
 *  the layout is deterministic. */
function finish(level: Map<string, Draft>): TreeNode[] {
  const last = (n: TreeNode) => (n.kind === "missing" ? 1 : 0);
  return [...level.values()]
    .map((d) => ({ ...d.node, children: finish(d.kids) }))
    .sort((a, b) => b.n - a.n || last(a) - last(b) || String(a.label ?? "").localeCompare(String(b.label ?? "")));
}

/** A code's levels, shortest first: every prefix of 1..length characters.
 *  NS 3451 builds 2 → 22 → 226 and NS 3457-8 Q → QL → QLD the same way. */
export function codeLevels(code: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= code.length; i += 1) out.push(code.slice(0, i));
  return out;
}

function addCode(
  top: Map<string, Draft>,
  code: string,
  names: Readonly<Record<string, string>>,
  guid: string,
): void {
  let level = top;
  for (const prefix of codeLevels(code)) {
    const d = add(level, `code:${prefix}`, () => draft(`code:${prefix}`, prefix, names[prefix] ?? null, "code"), guid);
    level = d.kids;
  }
}

function addFallback(top: Map<string, Draft>, value: string | null, guid: string): void {
  if (value === null || value === "") add(top, "missing", () => draft("missing", null, null, "missing"), guid);
  else add(top, `fb:${value}`, () => draft(`fb:${value}`, value, null, "fallback"), guid);
}

/** Classes the treemaps leave out (see the header). */
export const TREE_EXCLUDED: ReadonlySet<string> = new Set(["IfcSpace"]);

/** The objects and readings a tree is built over: every one but the
 *  excluded classes. */
function treeScope(
  all: readonly TreeObject[],
  readings: readonly TreeReading[] | null,
): { objects: readonly TreeObject[]; readings: readonly TreeReading[] | null } {
  const out = new Set(all.filter((o) => TREE_EXCLUDED.has(o.entity)).map((o) => o.guid));
  if (out.size === 0) return { objects: all, readings };
  return {
    objects: all.filter((o) => !out.has(o.guid)),
    readings: readings === null ? null : readings.filter((r) => !out.has(r.guid)),
  };
}

/** The system treemap. `readings` null = no `system-classification` mapping. */
export function systemTree(
  all: readonly TreeObject[],
  allReadings: readonly TreeReading[] | null,
  names: Readonly<Record<string, string>>,
): CodeTree {
  const { objects, readings } = treeScope(all, allReadings);
  const top = new Map<string, Draft>();
  if (readings === null) {
    // One level, the class only (edkjo 2026-09-28: *"the treemap is doing a
    // split by ifcentity that I dont want"*). The type-name level under each
    // class is gone.
    for (const o of objects) add(top, `class:${o.entity}`, () => draft(`class:${o.entity}`, o.entity, null, "class"), o.guid);
    return { axis: "system", by: "ifc-class", n: objects.length, root: finish(top) };
  }
  for (const r of readings) {
    if (r.state === "ok" && r.code) addCode(top, r.code, names, r.guid);
    else if (r.state === "deviating") {
      const v = r.value ?? "";
      add(top, `dev:${v}`, () => draft(`dev:${v}`, v, null, "deviating"), r.guid);
    } else add(top, "missing", () => draft("missing", null, null, "missing"), r.guid);
  }
  return { axis: "system", by: "mapping", n: readings.length, root: finish(top) };
}

/** The function treemap. `readings` null = no `component-classification`
 *  mapping: every object falls back to its PredefinedType. */
export function functionTree(
  all: readonly TreeObject[],
  allReadings: readonly TreeReading[] | null,
  names: Readonly<Record<string, string>>,
): CodeTree {
  const { objects, readings } = treeScope(all, allReadings);
  const top = new Map<string, Draft>();
  const predefined = new Map(objects.map((o) => [o.guid, o.predefinedType]));
  if (readings === null) {
    for (const o of objects) addFallback(top, o.predefinedType, o.guid);
    return { axis: "function", by: "predefined-type", n: objects.length, root: finish(top) };
  }
  for (const r of readings) {
    if (r.state === "ok" && r.code) addCode(top, r.code, names, r.guid);
    else if (r.state === "deviating") {
      const v = r.value ?? "";
      add(top, `dev:${v}`, () => draft(`dev:${v}`, v, null, "deviating"), r.guid);
    } else addFallback(top, predefined.get(r.guid) ?? null, r.guid);
  }
  return { axis: "function", by: "mapping", n: readings.length, root: finish(top) };
}

/** The key suffix of a node's own objects: those coded at its level and
 *  at none under it (a "22" beside a "226"). */
const OWN = "~";

/** A node's objects that none of its children hold, as a node of its own
 *  (same label, name and kind); null when its children hold them all. */
function ownPart(node: TreeNode): TreeNode | null {
  const under = new Set(node.children.flatMap((c) => c.guids));
  const guids = node.guids.filter((g) => !under.has(g));
  return guids.length > 0 ? { ...node, key: `${node.key}${OWN}`, n: guids.length, guids, children: [] } : null;
}

/** One tile of a flat treemap: a leaf, or a node's own objects, with the
 *  nodes above it (outermost first). */
export interface TreeLeaf {
  node: TreeNode;
  path: TreeNode[];
}

/** The tree as one level (edkjo 2026-10-01: *"I just want pure tiles"*):
 *  every leaf, and every inner node's own objects as a tile of that code.
 *  Every object is in exactly one tile. */
export function treeLeaves(nodes: readonly TreeNode[], path: TreeNode[] = []): TreeLeaf[] {
  const out: TreeLeaf[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      out.push({ node, path });
      continue;
    }
    const own = ownPart(node);
    if (own) out.push({ node: own, path });
    out.push(...treeLeaves(node.children, [...path, node]));
  }
  return out;
}

/** A node by its key, anywhere in the tree; a key ending in the own suffix
 *  is that node's own objects (`treeLeaves`). */
export function findNode(nodes: readonly TreeNode[], key: string): TreeNode | null {
  const hit = findExact(nodes, key);
  if (hit || !key.endsWith(OWN)) return hit;
  const base = findExact(nodes, key.slice(0, -OWN.length));
  return base && base.children.length > 0 ? ownPart(base) : null;
}

function findExact(nodes: readonly TreeNode[], key: string): TreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (key.startsWith(node.key)) {
      const hit = findExact(node.children, key);
      if (hit) return hit;
    }
  }
  return null;
}
