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
      isOpening: openings.has(row.guid),
    };
  });

  return { ...profile, rows };
}
