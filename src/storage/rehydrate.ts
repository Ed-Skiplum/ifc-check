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

import type { ClassificationRow, IfcGraph, PropertyRow, QuantityRow } from "../engine/types";
import type { ClassificationRef, ModelProfile, PsetGroup } from "../ui/profile";

/** The long property table grouped for reading: guid -> set -> properties.
 *
 * Insertion order is the file's order and is kept: the panel prints what the
 * exporter wrote, in the sequence it wrote it, rather than a sort of ours.
 * Returns `undefined` for an absent table so the panel can tell "not supplied"
 * from "this element declares none" — the two are different answers about
 * different things.
 */
export function groupPsets(rows: PropertyRow[] | undefined): Map<string, PsetGroup[]> | undefined {
  if (rows === undefined) return undefined;
  const byGuid = new Map<string, PsetGroup[]>();
  for (const row of rows) {
    let sets = byGuid.get(row.guid);
    if (!sets) {
      sets = [];
      byGuid.set(row.guid, sets);
    }
    let set = sets.find((s) => s.name === row.pset_name);
    if (!set) {
      set = { name: row.pset_name, properties: [] };
      sets.push(set);
    }
    set.properties.push({
      name: row.prop_name,
      value: row.value,
      valueType: row.value_type,
      source: row.source,
    });
  }
  return byGuid;
}

/** `IfcElementQuantity` grouped exactly as the property sets are — same shape,
 *  same absent-vs-empty rule, and the group flagged `quantity` so the panel can
 *  name the entity it is showing rather than calling every set a property set.
 *
 *  `unit_step_id` is carried by the parser and deliberately NOT surfaced: it is
 *  a STEP id with no accessor to resolve it, and a raw entity number printed
 *  where a unit belongs would read as a measurement. */
export function groupQuantities(
  rows: QuantityRow[] | undefined,
): Map<string, PsetGroup[]> | undefined {
  if (rows === undefined) return undefined;
  const byGuid = new Map<string, PsetGroup[]>();
  for (const row of rows) {
    let sets = byGuid.get(row.guid);
    if (!sets) {
      sets = [];
      byGuid.set(row.guid, sets);
    }
    let set = sets.find((s) => s.name === row.qto_name);
    if (!set) {
      set = { name: row.qto_name, properties: [], quantity: true };
      sets.push(set);
    }
    set.properties.push({
      name: row.quantity_name,
      value: row.value,
      valueType: row.quantity_type,
      source: row.source,
    });
  }
  return byGuid;
}

/** The classification table grouped by owner, same absent-vs-empty rule. */
export function groupClassifications(
  rows: ClassificationRow[] | undefined,
): Map<string, ClassificationRef[]> | undefined {
  if (rows === undefined) return undefined;
  const byGuid = new Map<string, ClassificationRef[]>();
  for (const row of rows) {
    const refs = byGuid.get(row.guid);
    const ref: ClassificationRef = {
      system: row.system_name,
      code: row.identification,
      name: row.name,
      edition: row.edition,
      location: row.location,
      publisher: row.source,
      assignmentSource: row.assignment_source,
    };
    if (refs) refs.push(ref);
    else byGuid.set(row.guid, [ref]);
  }
  return byGuid;
}

export function profileOf(graph: IfcGraph): ModelProfile {
  const profile: ModelProfile = {
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
      buildingGuid: s.building_guid,
    })),
    buildings: graph.buildings.map((b) => ({ guid: b.guid, name: b.name })),
    sites: graph.sites.map((b) => ({ guid: b.guid, name: b.name })),
    spatial: {
      projects: graph.projects.length,
      sites: graph.sites.length,
      buildings: graph.buildings.length,
      storeys: graph.storeys.length,
    },
  };
  // Assigned only when the table exists, so `undefined` on the profile keeps
  // meaning "nobody supplied this" rather than "an empty map was built".
  const psets = groupPsets(graph.psets);
  if (psets) profile.psets = psets;
  const classifications = groupClassifications(graph.classifications);
  if (classifications) profile.classifications = classifications;
  const quantities = groupQuantities(graph.quantities);
  if (quantities) profile.quantities = quantities;
  return profile;
}
