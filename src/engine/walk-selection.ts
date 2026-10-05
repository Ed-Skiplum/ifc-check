/** What the Oppsett walk's rules select, so the walk counts over the same
 *  elements the report rows count (2026-10-05, rendered: a step showed
 *  39 / 84, every product row, while the rule it wrote reported 37 av 80,
 *  the physical elements its `select` names).
 *
 * Every rule the walk writes selects `{entity: {group: "physicalElement"}}`
 * (`SetupPage.tsx` `newRule`, `pofin-ruleset.ts`), which the evaluator
 * expands per schema from `IFC_CLASSES`. The walk holds models of any
 * schema, so the set here is the union over the schemas. Pure.
 */

import { IFC_CLASSES } from "../ids/ifc-classes.ts";

const PHYSICAL = new Set<string>(
  Object.values(IFC_CLASSES).flatMap((schema) => [...(schema.groups.physicalElement as readonly string[])]),
);

/** Whether an element of this class is one the walk's rules select. */
export function isWalkSelected(entity: string): boolean {
  return PHYSICAL.has(entity.toUpperCase());
}

/** The GlobalIds of the products the walk's rules select. */
export function walkSelection(products: readonly { guid: string; entity: string }[]): Set<string> {
  return new Set(products.filter((p) => isWalkSelected(p.entity)).map((p) => p.guid));
}
