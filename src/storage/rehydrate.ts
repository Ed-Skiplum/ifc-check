/** The graph -> profile reduction, in one place.
 *
 * Two workers need it and neither may import the other: `ui/model-worker.ts`
 * carries the wasm module, and `storage/restore-worker.ts` deliberately does
 * not — a board restored from the cache must not pay for instantiating a
 * parser it will never call. So the reduction lives here, imported by both,
 * rather than written twice and left to drift.
 *
 * Pure. No storage, no DOM, no wasm.
 */

import type { IfcGraph } from "../engine/types";
import type { ModelProfile } from "../ui/profile";

export function profileOf(graph: IfcGraph): ModelProfile {
  return {
    rows: graph.products.map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      storeyGuid: p.storey_guid,
    })),
    storeys: graph.storeys.map((s) => ({
      guid: s.guid,
      name: s.name,
      elevation: s.elevation,
    })),
    spatial: {
      projects: graph.projects.length,
      sites: graph.sites.length,
      buildings: graph.buildings.length,
      storeys: graph.storeys.length,
    },
  };
}
