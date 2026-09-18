/** Which KPI a loaded rule speaks for.
 *
 * The same number reads differently depending on whether a rule exists for it.
 * `typed 0 / 851` is a fact about the file until something states that elements
 * must be typed; then it is a verdict, and it belongs to the rule that said so.
 *
 * A claim is read off the rule's own shape, never guessed from its name:
 *
 *   typed     an extended `element-typed` check. IDS cannot express this —
 *             IFCRELDEFINESBYTYPE is absent from its relations enumeration —
 *             so only a `.ruleset.json` can claim this tile.
 *   material  an ids rule carrying a material requirement.
 *
 * A KPI no rule claims stays a fact, neutral, drilling to its own rows.
 */

import { isEnabled } from "../ids/export.ts";
import type { Ruleset } from "../ids/types.ts";

export interface KpiClaims {
  /** Rule id, or undefined when nothing in the ruleset claims this KPI. */
  typed?: string;
  material?: string;
}

export function kpiClaims(ruleset: Ruleset | null): KpiClaims {
  const claims: KpiClaims = {};
  if (!ruleset) return claims;
  for (const rule of ruleset.rules) {
    if (!isEnabled(rule)) continue;
    if (rule.kind === "extended" && rule.check.type === "element-typed") {
      claims.typed ??= rule.id;
    }
    if (rule.kind === "ids" && (rule.requirements?.material?.length ?? 0) > 0) {
      claims.material ??= rule.id;
    }
  }
  return claims;
}
