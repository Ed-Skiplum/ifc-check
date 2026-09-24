/** The graph -> profile TYPE FACTS, added where the graph still exists.
 *
 * `profileOf` (`src/storage/rehydrate.ts`) is the shared reduction both workers
 * run, and it carries identity and spatial placement only. The type ledger needs
 * more per product — the type link, what the element declares, and whether it is
 * a void opening — so this augments the profile in the worker that already holds
 * the graph rather than widening the shared reduction.
 *
 * Pure. No wasm, no DOM, no storage.
 *
 * ── What "declares" can mean here ────────────────────────────────────────
 * `materials` plus `is_external` / `fire_rating` / `load_bearing` are the
 * columns the LEDGER aggregates, one per row and no join. They are a choice,
 * not the boundary: since ifcfast 0.5.3 the whole property table is readable
 * and travels on the profile as `psets` (`profileOf`), which is what the object
 * panel reads. A column here is a column the ledger compares across a type's
 * instances, and those three are the ones that mean something at that grain.
 */

import type { IfcGraph } from "../../engine/types";
import type { ModelProfile, ProductRowLite } from "../profile";

/**
 * Copy the type facts off the graph onto an already-reduced profile.
 *
 * Keyed by GlobalId rather than by index: `profileOf` maps `graph.products` one
 * to one today, but a reduction that ever filters would silently shift every
 * row against its facts, and a wrong type on a right element is the kind of
 * plausible output this codebase refuses. A product with no match keeps its
 * facts absent, which the ledger reports as absent.
 */
export function withTypeFacts(profile: ModelProfile, graph: IfcGraph): ModelProfile {
  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  const byGuid = new Map(graph.products.map((p) => [p.guid, p]));
  // `IfcRelVoidsElement`, read from both ends: an opening knows its host, and a
  // host knows every opening cut into it. One pass, so a wall with forty
  // openings costs the same as one with none.
  const hostOf = new Map<string, string>();
  const openingsOf = new Map<string, string[]>();
  for (const v of graph.voids) {
    hostOf.set(v.opening_guid, v.host_guid);
    const list = openingsOf.get(v.host_guid);
    if (list) list.push(v.opening_guid);
    else openingsOf.set(v.host_guid, [v.opening_guid]);
  }
  // `IfcRelAggregates` / `IfcRelNests`, child -> parent.
  const parentOf = new Map<string, { guid: string; kind: string }>();
  for (const a of graph.aggregates) {
    parentOf.set(a.child_guid, { guid: a.parent_guid, kind: a.parent_kind });
  }

  const rows: ProductRowLite[] = profile.rows.map((row) => {
    const product = byGuid.get(row.guid);
    if (!product) return row;
    return {
      ...row,
      typeName: product.type_name,
      typed: product.typed,
      typeSource: product.type_source,
      typeGuid: product.type_guid ?? null,
      predefinedType: product.predefined_type,
      objectType: product.object_type,
      tag: product.tag,
      materials: product.materials ?? [],
      isExternal: product.is_external,
      fireRating: product.fire_rating,
      loadBearing: product.load_bearing,
      layerSet: product.layer_set,
      parentGuid: parentOf.get(row.guid)?.guid ?? null,
      parentKind: parentOf.get(row.guid)?.kind ?? null,
      openingGuids: openingsOf.get(row.guid) ?? [],
      hostGuid: hostOf.get(row.guid) ?? null,
      isOpening: openings.has(row.guid),
    };
  });

  return { ...profile, rows };
}
