/** Per-element volume and area for the board's treemaps (edkjo 2026-09-28:
 *  *"Go by count, volume and area. Base quantities if possible, calculated if
 *  not."*).
 *
 * Pure. Three halves, each with a selftest in `scripts/ids-cli.ts`:
 *
 *   units      `quantityUnits` reads the project's AREAUNIT / VOLUMEUNIT (and
 *              every other IfcSIUnit, for a quantity that names its own unit)
 *              out of the STEP bytes, chunked, never the whole file as one
 *              string. An SI unit resolves to its factor to m² / m³ (the
 *              prefix applies to the base: MILLI SQUARE_METRE is 1e-6 m²). A
 *              conversion-based unit (square foot) is NOT resolved: its
 *              quantities are skipped, never read as metres. An ifczip has no
 *              readable STEP bytes, so its units are unresolved too.
 *
 *   authored   `qtoQuantities` picks one volume and one area per element from
 *              the exporter's BaseQuantities (`BaseQuantities` or
 *              `Qto_*BaseQuantities`), by the precedence below, instance rows
 *              before type rows at each name. A value that does not parse, is
 *              not > 0, or whose unit is unresolved is skipped and the next
 *              name is tried.
 *
 *   computed   `meshMeasure` measures one element's streamed mesh: volume by
 *              signed tetrahedra, only when the mesh is CLOSED (after welding
 *              vertices at identical coordinates, every directed edge is
 *              matched by its reverse). Area is THE LARGEST FACE DIRECTION:
 *              triangles binned by unit normal (components in steps of 1/20,
 *              about 3°), each bin's area summed, the largest bin taken. That
 *              is a wall's one side, a slab's top, a space's floor. It is an
 *              estimate and always labelled `computed`: a curved face spreads
 *              over many bins and reads low, and openings are not cut in the
 *              wasm mesh (ifcfast v1), so a wall's side and volume are gross.
 *              Chosen over half the surface on HI90_ARK (2026-09-28), against
 *              the elements carrying both, median computed / Qto: slab 1.00
 *              vs 1.04, wall 1.02 vs 1.24, space 1.17 vs 3.19, door 1.34 vs
 *              1.90. Volume there: median 1.00 on slabs, walls, doors,
 *              spaces and windows. An open mesh yields no value: volume and
 *              area are both missing, never zero.
 *
 * `measureTree` folds the three onto a code tree: per node the summed value
 * and the missing and pending counts, per tree the source split.
 */

import type { QuantityRow } from "./types.ts";
import type { CodeTree, TreeNode } from "./code-tree.ts";

/* ── units ──────────────────────────────────────────────────────────────── */

export interface QuantityUnits {
  /** m² per project area unit; null when undeclared or not an SI unit. */
  area: number | null;
  /** m³ per project volume unit; null when undeclared or not an SI unit. */
  volume: number | null;
  /** Every area / volume unit entity by STEP id, for a quantity that names
   *  its own unit (`unit_step_id`). null factor = declared, not resolvable. */
  byId: Record<string, { kind: "area" | "volume"; factor: number | null }>;
}

const PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};

const ENTITY = /#(\d+)\s*=\s*(IFCSIUNIT|IFCCONVERSIONBASEDUNIT|IFCUNITASSIGNMENT|IFCPROJECT)\s*\(/gi;

/** The argument text of a STEP statement from `open` (just past its "("),
 *  quote-aware, up to the ")" that closes it; null when the chunk ends first. */
function argsFrom(text: string, open: number): { args: string; end: number } | null {
  let depth = 1;
  let quoted = false;
  for (let i = open; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 39) {
        if (text.charCodeAt(i + 1) === 39) i += 1;
        else quoted = false;
      }
    } else if (c === 39) quoted = true;
    else if (c === 40) depth += 1;
    else if (c === 41) {
      depth -= 1;
      if (depth === 0) return { args: text.slice(open, i), end: i + 1 };
    }
  }
  return null;
}

/** The project's quantity units, read from the STEP bytes in chunks. */
export function quantityUnits(bytes: Uint8Array, chunk = 8 << 20): QuantityUnits {
  const units: QuantityUnits = { area: null, volume: null, byId: {} };
  const kinds = new Map<string, { kind: string; factor: number | null }>();
  let assignment: string[] | null = null;
  let projectUnits: string | null = null;
  const decoder = new TextDecoder("latin1");
  let carry = "";
  for (let at = 0; at < bytes.length; at += chunk) {
    const text = carry + decoder.decode(bytes.subarray(at, Math.min(bytes.length, at + chunk)));
    const last = at + chunk >= bytes.length;
    ENTITY.lastIndex = 0;
    let keepFrom = last ? text.length : Math.max(0, text.lastIndexOf(";") + 1);
    for (let m = ENTITY.exec(text); m; m = ENTITY.exec(text)) {
      // A statement in the carried tail is read with the next chunk.
      if (!last && m.index >= keepFrom) break;
      const body = argsFrom(text, m.index + m[0].length);
      if (!body) {
        // The statement runs past this chunk: carry it into the next.
        if (!last) keepFrom = Math.min(keepFrom, m.index);
        break;
      }
      ENTITY.lastIndex = body.end;
      const id = m[1];
      const name = m[2].toUpperCase();
      const args = body.args;
      if (name === "IFCSIUNIT") {
        const kind = /\.(AREAUNIT|VOLUMEUNIT)\./i.exec(args)?.[1]?.toUpperCase();
        if (!kind) continue;
        const parts = args.split(",").map((s) => s.trim());
        const prefix = /^\.(\w+)\.$/.exec(parts[2] ?? "")?.[1]?.toUpperCase();
        const base = /^\.(\w+)\.$/.exec(parts[3] ?? "")?.[1]?.toUpperCase();
        const p = prefix ? PREFIX[prefix] : 1;
        const ok = p !== undefined && (kind === "AREAUNIT" ? base === "SQUARE_METRE" : base === "CUBIC_METRE");
        kinds.set(id, { kind, factor: ok ? (kind === "AREAUNIT" ? p * p : p * p * p) : null });
      } else if (name === "IFCCONVERSIONBASEDUNIT") {
        const kind = /\.(AREAUNIT|VOLUMEUNIT)\./i.exec(args)?.[1]?.toUpperCase();
        if (kind) kinds.set(id, { kind, factor: null });
      } else if (name === "IFCUNITASSIGNMENT") {
        (assignment ??= []).push(`#${id}:${args}`);
      } else if (name === "IFCPROJECT") {
        const refs = args.match(/#\d+/g);
        projectUnits = refs ? refs[refs.length - 1].slice(1) : null;
      }
    }
    carry = last ? "" : text.slice(keepFrom);
  }
  for (const [id, u] of kinds) {
    units.byId[id] = { kind: u.kind === "AREAUNIT" ? "area" : "volume", factor: u.factor };
  }
  // The project's assignment; with no IfcProject reference, the only one.
  const chosen =
    assignment?.find((a) => projectUnits !== null && a.startsWith(`#${projectUnits}:`)) ??
    (assignment?.length === 1 ? assignment[0] : undefined);
  if (chosen) {
    for (const ref of chosen.slice(chosen.indexOf(":") + 1).match(/#\d+/g) ?? []) {
      const u = kinds.get(ref.slice(1));
      if (!u) continue;
      if (u.kind === "AREAUNIT") units.area = u.factor;
      else units.volume = u.factor;
    }
  }
  return units;
}

/* ── authored quantities ────────────────────────────────────────────────── */

/** Volume, every class: net (openings out) before gross. */
export const VOLUME_PRECEDENCE = ["NetVolume", "GrossVolume", "Volume"] as const;

/** Area, by class. The first list whose pattern matches the entity applies. */
export const AREA_PRECEDENCE: readonly { classes: RegExp; names: readonly string[] }[] = [
  { classes: /^Ifc(Wall|WallStandardCase|WallElementedCase|CurtainWall)$/i, names: ["NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "Area"] },
  { classes: /^IfcSpace$/i, names: ["NetFloorArea", "GrossFloorArea", "NetArea", "GrossArea", "Area"] },
  { classes: /^Ifc(Beam|BeamStandardCase|Column|ColumnStandardCase|Member|MemberStandardCase|Pile)$/i, names: ["NetSurfaceArea", "GrossSurfaceArea", "OuterSurfaceArea", "NetArea", "GrossArea", "Area"] },
  { classes: /^/, names: ["NetArea", "GrossArea", "Area", "NetSideArea", "GrossSideArea"] },
];

const BASE_SET = /^(BaseQuantities|Qto_\w*BaseQuantities)$/;

export interface Picked {
  value: number;
  /** The quantity it came from, e.g. `NetSideArea`. */
  name: string;
}

export interface Authored {
  volume: Picked | null;
  area: Picked | null;
}

function areaNames(entity: string): readonly string[] {
  return AREA_PRECEDENCE.find((p) => p.classes.test(entity))!.names;
}

/** One volume and one area per element from its BaseQuantities. Elements with
 *  neither are absent from the map. */
export function qtoQuantities(
  rows: readonly QuantityRow[],
  entityOf: ReadonlyMap<string, string>,
  units: QuantityUnits | null | undefined,
): Map<string, Authored> {
  // guid -> kind -> name -> [instance value, type value]
  const found = new Map<string, Map<string, [number | null, number | null]>>();
  for (const r of rows) {
    if (!BASE_SET.test(r.qto_name)) continue;
    const kind = r.quantity_type === "Volume" ? "volume" : r.quantity_type === "Area" ? "area" : null;
    if (!kind || r.value === null) continue;
    const raw = Number(r.value);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    let factor: number | null = null;
    if (units) {
      if (r.unit_step_id !== null) {
        const own = units.byId[String(r.unit_step_id)];
        factor = own && own.kind === kind ? own.factor : null;
      } else factor = kind === "area" ? units.area : units.volume;
    }
    if (factor === null) continue;
    let byName = found.get(r.guid);
    if (!byName) found.set(r.guid, (byName = new Map()));
    const key = `${kind}:${r.quantity_name}`;
    const slot = byName.get(key) ?? [null, null];
    const at = r.source === "type" ? 1 : 0;
    if (slot[at] === null) slot[at] = raw * factor;
    byName.set(key, slot);
  }
  const out = new Map<string, Authored>();
  for (const [guid, byName] of found) {
    const pick = (kind: string, names: readonly string[]): Picked | null => {
      for (const name of names) {
        const slot = byName.get(`${kind}:${name}`);
        const value = slot ? (slot[0] ?? slot[1]) : null;
        if (value !== null) return { value, name };
      }
      return null;
    };
    const volume = pick("volume", VOLUME_PRECEDENCE);
    const area = pick("area", areaNames(entityOf.get(guid) ?? ""));
    if (volume || area) out.set(guid, { volume, area });
  }
  return out;
}

/* ── computed from the mesh ─────────────────────────────────────────────── */

export interface MeshMeasure {
  closed: boolean;
  /** m³, when closed; else null. */
  volume: number | null;
  /** m², the largest face direction of the closed mesh; else null. */
  area: number | null;
}

/** Normal bins for the face-direction area: each unit-normal component in
 *  steps of 1/20 (about 3° near an axis). */
const FACE_STEPS = 20;
const FACE_SPAN = 2 * FACE_STEPS + 1;

/** One element's range inside a streamed batch (`MeshMetaRow`). `indices`
 *  are batch-local and already offset by the element's `v0`. */
export function meshMeasure(
  positions: Float32Array,
  indices: Uint32Array,
  v0: number,
  vn: number,
  i0: number,
  iCount: number,
): MeshMeasure {
  const none: MeshMeasure = { closed: false, volume: null, area: null };
  if (vn === 0 || iCount < 3) return none;
  // Weld by exact coordinates: a flat-shaded tessellation repeats a corner
  // once per face, at the same float.
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  let size = 1;
  while (size < vn * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const weld = new Int32Array(vn);
  let welded = 0;
  const b = (i: number) => {
    const x = bits[i];
    return x === 0x80000000 ? 0 : x; // -0 is 0
  };
  for (let v = 0; v < vn; v += 1) {
    const at = (v0 + v) * 3;
    const x = b(at);
    const y = b(at + 1);
    const z = b(at + 2);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const slot = table[h];
      if (slot === -1) {
        table[h] = v;
        weld[v] = welded;
        welded += 1;
        break;
      }
      const s = (v0 + slot) * 3;
      if (b(s) === x && b(s + 1) === y && b(s + 2) === z) {
        weld[v] = weld[slot];
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  const tris = Math.floor(iCount / 3);
  const fwd = new Float64Array(tris * 3);
  const rev = new Float64Array(tris * 3);
  let edges = 0;
  let six = 0;
  const faces = new Map<number, number>();
  let largest = 0;
  // Relative to the element's first vertex: keeps the f32 terms small.
  const ox = positions[v0 * 3];
  const oy = positions[v0 * 3 + 1];
  const oz = positions[v0 * 3 + 2];
  for (let t = 0; t < tris; t += 1) {
    const ia = indices[i0 + t * 3];
    const ib = indices[i0 + t * 3 + 1];
    const ic = indices[i0 + t * 3 + 2];
    const a = weld[ia - v0];
    const bb = weld[ib - v0];
    const c = weld[ic - v0];
    if (a === bb || bb === c || a === c) continue;
    const ax = positions[ia * 3] - ox, ay = positions[ia * 3 + 1] - oy, az = positions[ia * 3 + 2] - oz;
    const bx = positions[ib * 3] - ox, by = positions[ib * 3 + 1] - oy, bz = positions[ib * 3 + 2] - oz;
    const cx = positions[ic * 3] - ox, cy = positions[ic * 3 + 1] - oy, cz = positions[ic * 3 + 2] - oz;
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      const key =
        (Math.round((nx / len) * FACE_STEPS) + FACE_STEPS) * FACE_SPAN * FACE_SPAN +
        (Math.round((ny / len) * FACE_STEPS) + FACE_STEPS) * FACE_SPAN +
        (Math.round((nz / len) * FACE_STEPS) + FACE_STEPS);
      const sum = (faces.get(key) ?? 0) + len / 2;
      faces.set(key, sum);
      if (sum > largest) largest = sum;
    }
    fwd[edges] = a * welded + bb;
    rev[edges] = bb * welded + a;
    fwd[edges + 1] = bb * welded + c;
    rev[edges + 1] = c * welded + bb;
    fwd[edges + 2] = c * welded + a;
    rev[edges + 2] = a * welded + c;
    edges += 3;
  }
  if (edges === 0) return none;
  const f = fwd.subarray(0, edges).sort();
  const r = rev.subarray(0, edges).sort();
  for (let i = 0; i < edges; i += 1) if (f[i] !== r[i]) return none;
  return { closed: true, volume: Math.abs(six) / 6, area: largest };
}

/* ── the fold onto a tree ───────────────────────────────────────────────── */

export type Measure = "count" | "volume" | "area";

export interface SourceSplit {
  qto: number;
  computed: number;
  missing: number;
  /** No BaseQuantity and the geometry not measured yet. */
  pending: number;
}

/** Per node: [volume, volume missing, area, area missing]. */
export type NodeMeasure = [number, number, number, number];

export interface TreeMeasures {
  nodes: Record<string, NodeMeasure>;
  volume: SourceSplit;
  area: SourceSplit;
}

/** What the geometry pass has told so far. `complete` = every batch
 *  measured: an element with no entry then has no mesh. */
export interface Computed {
  byGuid: ReadonlyMap<string, MeshMeasure>;
  complete: boolean;
}

type Resolved = { v: number | null; vs: 0 | 1 | 2 | 3; a: number | null; as: 0 | 1 | 2 | 3 }; // 0 qto 1 computed 2 missing 3 pending

function resolve(guid: string, qto: ReadonlyMap<string, Authored>, computed: Computed): Resolved {
  const q = qto.get(guid);
  const m = computed.byGuid.get(guid);
  const one = (authored: Picked | null | undefined, value: number | null | undefined): [number | null, 0 | 1 | 2 | 3] => {
    if (authored) return [authored.value, 0];
    if (m) return value !== null && value !== undefined ? [value, 1] : [null, 2];
    return [null, computed.complete ? 2 : 3];
  };
  const [v, vs] = one(q?.volume, m?.volume);
  const [a, as] = one(q?.area, m?.area);
  return { v, vs, a, as };
}

/** Every node's summed volume and area, the missing counts, and the tree's
 *  source split. Pending elements add nothing and count as neither. */
export function measureTree(
  tree: CodeTree,
  qto: ReadonlyMap<string, Authored>,
  computed: Computed,
): TreeMeasures {
  const per = new Map<string, Resolved>();
  const split = (): SourceSplit => ({ qto: 0, computed: 0, missing: 0, pending: 0 });
  const volume = split();
  const area = split();
  const bump = (s: SourceSplit, k: 0 | 1 | 2 | 3) => {
    if (k === 0) s.qto += 1;
    else if (k === 1) s.computed += 1;
    else if (k === 2) s.missing += 1;
    else s.pending += 1;
  };
  const nodes: Record<string, NodeMeasure> = {};
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      const acc: NodeMeasure = [0, 0, 0, 0];
      for (const guid of node.guids) {
        let r = per.get(guid);
        if (!r) {
          r = resolve(guid, qto, computed);
          per.set(guid, r);
          bump(volume, r.vs);
          bump(area, r.as);
        }
        if (r.v !== null) acc[0] += r.v;
        else if (r.vs === 2) acc[1] += 1;
        if (r.a !== null) acc[2] += r.a;
        else if (r.as === 2) acc[3] += 1;
      }
      nodes[node.key] = acc;
      walk(node.children);
    }
  };
  walk(tree.root);
  return { nodes, volume, area };
}
