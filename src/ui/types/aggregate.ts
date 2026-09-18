/** The TYPE LEDGER — one row per type, aggregated across the model.
 *
 * Review, not mapping. The G55 QTO-LCA type browser this is ported from
 * (`10027-grønland-55/.../G55_QTO-LCA/02_arbeid/verify_app.html`, `loadInner` /
 * `drawInstances`, and `src/serve.py` `type_card` / `type_instances`) existed to
 * ASSIGN material and scope to a type. Its structure is taken here — the unit is
 * the type, the drill is type to its instances by GlobalId, the density is the
 * same — and everything about assignment, correction and verdict is dropped.
 * Nothing here is editable and nothing here judges a type. It answers: what
 * types does this model have, how many instances does each carry, do they have
 * geometry, what do they declare, and does the type structure hold together.
 *
 * Pure data, no React. The headless gate (`scripts/types-gate.mjs`) runs this
 * exact function over a real file, so what the screen shows and what a shell can
 * print are the same aggregation rather than two that agree by inspection.
 *
 * ── The key is the TYPE NAME ─────────────────────────────────────────────
 * Not `model::entity::type` as in G55, which federated several models in one
 * board. One board is one file here, and `checkSingleInstanceTypes` in
 * `src/engine/fundamentals.ts` keys by `type_name` alone — so keying the same
 * way is what makes the ledger's `65 of 84` the SAME 65 of 84 the verification
 * block prints, rather than a second number a reader has to reconcile. A type
 * name that spans several IFC classes is therefore one row, and that row carries
 * the disagreement, which is the more useful reading of it anyway.
 *
 * ── Void openings ────────────────────────────────────────────────────────
 * Dropped, exactly as `physicalProducts` drops them for every fundamental. Same
 * reason as above: one basis, one set of numbers.
 */

import type { ModelProfile, ProductRowLite } from "../profile";

/** A declared value the instances of one type do not agree on.
 *
 * `variants` counts NOT-DECLARED as one variant of its own. A type where nine
 * instances carry no fire rating and one carries EI60 has two variants, and
 * that is the fault worth seeing: the aggregate would otherwise print "EI60"
 * and hide the nine. */
export type TypeField =
  | "class"
  | "predefinedType"
  | "material"
  | "isExternal"
  | "fireRating"
  | "loadBearing";

export interface TypeDisagreement {
  field: TypeField;
  variants: number;
}

/** What the instances of one type carry for one single-valued attribute. */
export interface Declared {
  /** Distinct declared values, sorted. Empty = no instance declared one. */
  values: string[];
  /** Instances that declared nothing. */
  undeclared: number;
  /** Distinct values PLUS "undeclared" when any instance declared nothing. */
  variants: number;
}

export interface TypeRow {
  /** `null` is the UNTYPED row. It is a row, never an omission. */
  typeName: string | null;
  /** IFC classes the instances are, count descending. */
  classes: { entity: string; count: number }[];
  /** The primary number. */
  instances: number;
  /** Full GlobalIds, in graph order. Never truncated anywhere downstream. */
  guids: string[];
  /** Instances with a mesh in the streamed geometry, and the triangles those
   *  meshes carry. `null` when no geometry has arrived — unknown, not zero. */
  meshed: number | null;
  triangles: number | null;
  predefined: Declared;
  /** Distinct material names across the instances, and how many instances
   *  carry no material at all. `variants` compares whole material SETS: two
   *  instances of one type built from different layers disagree even when the
   *  union of names looks tidy. */
  materials: Declared;
  isExternal: Declared;
  fireRating: Declared;
  loadBearing: Declared;
  /** Every field the instances disagree on. Empty on the untyped row: elements
   *  that share no type are not expected to share anything. */
  disagreements: TypeDisagreement[];
  /** `type_source` values the parser reported, distinct. */
  sources: string[];
}

/** Instances-per-type buckets — the SHAPE of the distribution, which is the
 *  thing a single ratio flattens. Boundaries are ours and are printed. */
export const TYPE_BUCKETS = [
  { min: 1, max: 1 },
  { min: 2, max: 4 },
  { min: 5, max: 9 },
  { min: 10, max: Infinity },
] as const;

export type TypeHealth = "sound" | "watch" | "weak";

/**
 * OUR thresholds on the single-instance share. Not a standard, not a
 * buildingSMART rule, not a number anyone else recognises — the screen prints
 * the boundary beside the band so a reader can disagree with it on sight.
 *
 * Chosen against what a type IS: an `IfcWallType` exists so that every wall
 * built to it is one decision, so a model whose types mostly carry one instance
 * has spent the mechanism without getting the reuse. A minority of
 * cardinality-one types is normal and expected — a genuinely unique component
 * has nowhere else to live — which is why `sound` is not zero.
 */
export const TYPE_HEALTH_BANDS: Record<Exclude<TypeHealth, "sound">, number> = {
  watch: 0.2,
  weak: 0.5,
};

export interface TypeLedger {
  rows: TypeRow[];
  /** Distinct type names. The denominator. */
  types: number;
  /** Types carried by exactly one instance. The numerator. */
  singles: number;
  /** `singles / types`, or `null` when there are no types at all — a model
   *  with zero types has no ratio, and 0 % would read as a clean bill. */
  singleShare: number | null;
  health: TypeHealth | null;
  /** Types per bucket of `TYPE_BUCKETS`, same order. */
  buckets: number[];
  /** Median instances per type. `null` with no types. */
  median: number | null;
  /** Elements with no type at all, and the products the ledger looked at. */
  untyped: number;
  products: number;
  /** False when the profile carried no type facts — the ledger is then EMPTY
   *  because nothing was supplied, which is a different answer from "this file
   *  has no types" and is reported as itself. */
  factsPresent: boolean;
  /** True when the mesh pass withheld batches: a type reading zero geometry may
   *  be a type whose geometry was capped away. */
  meshCapped: boolean;
  /** True when no geometry has been streamed at all. */
  meshUnknown: boolean;
}

/** Separator for the material SET signature. Built rather than written: a raw
 *  NUL in a source file is invisible, survives a copy, and makes the file read
 *  as binary to every tool that looks at it. */
const UNIT_SEP = String.fromCharCode(31);

function renderBool(value: boolean): string {
  return value ? "true" : "false";
}

/** A value that IS declared and IS blank. Found on a real model the first time
 *  this ran: `OBF_400520_03_6_ARK.ifc` carries `FireRating = " "` on 34 of its
 *  84 products. Folding that into "not declared" hides a modelling fact, and
 *  printing it raw renders as an empty cell that reads as a bug in this tile —
 *  so it gets a token of its own and stays visible as what it is. */
export const BLANK_VALUE = '""';

function declared(values: (string | null)[]): Declared {
  const seen = new Set<string>();
  let undeclaredCount = 0;
  for (const value of values) {
    if (value === null) undeclaredCount += 1;
    else seen.add(value.trim() === "" ? BLANK_VALUE : value);
  }
  return {
    values: [...seen].sort((a, b) => a.localeCompare(b)),
    undeclared: undeclaredCount,
    variants: seen.size + (undeclaredCount > 0 ? 1 : 0),
  };
}

/** Materials are a SET per instance, so the variant count compares sets. The
 *  `values` list stays the union, because that is what the cell prints. */
function declaredMaterials(rows: ProductRowLite[]): Declared {
  const union = new Set<string>();
  const signatures = new Set<string>();
  let undeclaredCount = 0;
  for (const row of rows) {
    const list = row.materials ?? [];
    if (list.length === 0) {
      undeclaredCount += 1;
      signatures.add(`${UNIT_SEP}none`);
      continue;
    }
    for (const material of list) union.add(material);
    signatures.add([...list].sort((a, b) => a.localeCompare(b)).join(UNIT_SEP));
  }
  return {
    values: [...union].sort((a, b) => a.localeCompare(b)),
    undeclared: undeclaredCount,
    variants: signatures.size,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function healthOf(share: number): TypeHealth {
  if (share >= TYPE_HEALTH_BANDS.weak) return "weak";
  if (share >= TYPE_HEALTH_BANDS.watch) return "watch";
  return "sound";
}

/** Triangles per element, keyed by GlobalId. The mesh stream is the only place
 *  a triangle count exists; `null` means no geometry has arrived. */
export type MeshIndex = Map<string, number> | null;

export interface AggregateOptions {
  mesh: MeshIndex;
  meshCapped: boolean;
}

const NO_MESH: AggregateOptions = { mesh: null, meshCapped: false };

export function aggregateTypes(
  profile: ModelProfile,
  options: AggregateOptions = NO_MESH,
): TypeLedger {
  // A profile that never went through `withTypeFacts` has no `typed` flag on any
  // row. Reporting that as "every element is untyped" would be a fabricated
  // answer about the FILE from a fact about the PLUMBING, so it is reported as
  // what it is and the ledger comes back empty.
  //
  // A profile with NO ROWS is the other way round, and the first run of
  // `scripts/types-gate.mjs` caught this module getting it wrong: an IFC4 file
  // ifcfast parsed to zero products came back as "type facts absent", which
  // blames the plumbing for a fact about the file. An empty model is not a
  // missing payload — `parse-integrity` already fails loudly on it
  // ([ifcfast#178] drops classes its whitelist does not carry) — so the absence
  // of rows leaves the facts PRESENT and the ledger prints an empty roster.
  //
  // [ifcfast#178]: https://github.com/EdvardGK/ifcfast/issues/178
  const factsPresent =
    profile.rows.length === 0 || profile.rows.some((row) => row.typed !== undefined);
  const physical = profile.rows.filter((row) => row.isOpening !== true);
  const mesh = options.mesh;

  if (!factsPresent) {
    return {
      rows: [],
      types: 0,
      singles: 0,
      singleShare: null,
      health: null,
      buckets: TYPE_BUCKETS.map(() => 0),
      median: null,
      untyped: 0,
      products: physical.length,
      factsPresent: false,
      meshCapped: options.meshCapped,
      meshUnknown: mesh === null,
    };
  }

  const byType = new Map<string | null, ProductRowLite[]>();
  for (const row of physical) {
    // Same predicate as `checkSingleInstanceTypes`: a row counts as typed only
    // when the link exists AND the type has a name. A nameless type object
    // cannot be a ledger row, because the ledger's key is the name.
    const key = row.typed && row.typeName ? row.typeName : null;
    const bucket = byType.get(key);
    if (bucket) bucket.push(row);
    else byType.set(key, [row]);
  }

  const rows: TypeRow[] = [...byType.entries()].map(([typeName, members]) => {
    const classCounts = new Map<string, number>();
    for (const member of members) {
      classCounts.set(member.entity, (classCounts.get(member.entity) ?? 0) + 1);
    }
    const classes = [...classCounts.entries()]
      .map(([entity, count]) => ({ entity, count }))
      .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));

    let meshed: number | null = null;
    let triangles: number | null = null;
    if (mesh !== null) {
      meshed = 0;
      triangles = 0;
      for (const member of members) {
        const tri = mesh.get(member.guid);
        if (tri === undefined) continue;
        meshed += 1;
        triangles += tri;
      }
    }

    const predefined = declared(members.map((m) => m.predefinedType ?? null));
    const materials = declaredMaterials(members);
    const isExternal = declared(
      members.map((m) =>
        m.isExternal === null || m.isExternal === undefined ? null : renderBool(m.isExternal),
      ),
    );
    const fireRating = declared(members.map((m) => m.fireRating ?? null));
    const loadBearing = declared(
      members.map((m) =>
        m.loadBearing === null || m.loadBearing === undefined ? null : renderBool(m.loadBearing),
      ),
    );

    const candidates: TypeDisagreement[] = [
      { field: "class", variants: classes.length },
      { field: "predefinedType", variants: predefined.variants },
      { field: "material", variants: materials.variants },
      { field: "isExternal", variants: isExternal.variants },
      { field: "fireRating", variants: fireRating.variants },
      { field: "loadBearing", variants: loadBearing.variants },
    ];
    const disagreements =
      typeName === null ? [] : candidates.filter((entry) => entry.variants > 1);

    const sources = [
      ...new Set(members.map((m) => m.typeSource).filter((s): s is string => !!s)),
    ].sort();

    return {
      typeName,
      classes,
      instances: members.length,
      guids: members.map((m) => m.guid),
      meshed,
      triangles,
      predefined,
      materials,
      isExternal,
      fireRating,
      loadBearing,
      disagreements,
      sources,
    };
  });

  // Count descending, name ascending, and the untyped row last — the same place
  // the floor matrix puts its no-storey row, for the same reason: it is the
  // remainder, and a remainder that sorts into the middle reads as a type.
  rows.sort((a, b) => {
    if (a.typeName === null) return 1;
    if (b.typeName === null) return -1;
    return b.instances - a.instances || a.typeName.localeCompare(b.typeName);
  });
  // The untyped row always renders, empty or not: a model with nothing untyped
  // is a fact worth reading off the same table as one full of untyped elements.
  if (!byType.has(null)) {
    rows.push({
      typeName: null,
      classes: [],
      instances: 0,
      guids: [],
      meshed: mesh === null ? null : 0,
      triangles: mesh === null ? null : 0,
      predefined: declared([]),
      materials: declaredMaterials([]),
      isExternal: declared([]),
      fireRating: declared([]),
      loadBearing: declared([]),
      disagreements: [],
      sources: [],
    });
  }

  const typed = rows.filter((row) => row.typeName !== null);
  const types = typed.length;
  const singles = typed.filter((row) => row.instances === 1).length;
  const singleShare = types > 0 ? singles / types : null;

  const buckets = TYPE_BUCKETS.map(
    (bucket) =>
      typed.filter((row) => row.instances >= bucket.min && row.instances <= bucket.max).length,
  );

  return {
    rows,
    types,
    singles,
    singleShare,
    health: singleShare === null ? null : healthOf(singleShare),
    buckets,
    median: median(typed.map((row) => row.instances)),
    untyped: rows.find((row) => row.typeName === null)?.instances ?? 0,
    products: physical.length,
    factsPresent: true,
    meshCapped: options.meshCapped,
    meshUnknown: mesh === null,
  };
}

/** The elements one ledger row stands for. Exported for the cross-filter: a
 *  type chip resolves through this rather than re-deriving the grouping. */
export function typeGuids(profile: ModelProfile, typeName: string | null): Set<string> {
  const out = new Set<string>();
  for (const row of profile.rows) {
    if (row.isOpening === true) continue;
    const key = row.typed && row.typeName ? row.typeName : null;
    if (key === typeName) out.add(row.guid);
  }
  return out;
}

/** Triangles per GlobalId, off the streamed mesh batches. `null` in, `null`
 *  out — geometry that has not arrived is unknown, never zero. */
export function meshIndex(
  batches: { meta: { guid: string; tri: number }[] }[] | undefined,
): MeshIndex {
  if (!batches) return null;
  const index = new Map<string, number>();
  for (const batch of batches) {
    for (const row of batch.meta) index.set(row.guid, row.tri);
  }
  return index;
}
