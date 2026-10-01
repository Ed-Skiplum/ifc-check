/** What the standard layer reads before any project source, and how it judges
 *  a value: plain data and pure functions, shared by the engine's rows
 *  (`standard-layer.ts`) and Oppsett's Fase, Materiale / Produkt and
 *  Mengdetype steps, so the walk shows exactly what the engine reads.
 */

import { roleRule } from "../ids/models.ts";
import type { Ruleset } from "../ids/types.ts";

/** A project-layer cascade: `phase.sources`, or one branch of
 *  `material-product`. */
export type LayerSlot = "phase" | "mengdetype" | "product" | "material";

/** The standard sources of each cascade, in the order they are read, by the
 *  name the report's `kilder` gives them. A project's sources come after. */
export const STANDARD_SOURCES: Record<LayerSlot, readonly string[]> = {
  phase: ["Pset_*Common.Status"],
  mengdetype: ["IFC-klasse", "IfcClassificationReference NS 3457"],
  product: ["Pset_ManufacturerTypeInformation.ModelReference", "Pset_ManufacturerTypeInformation.ArticleNumber"],
  material: ["IfcMaterial", "IfcMaterialLayerSet"],
};

/** PEnum_ElementStatus, less the three that say nothing (OTHER, NOTKNOWN,
 *  UNSET), which are carried but are avvik. */
export const PHASE_ACCEPTED = ["NEW", "EXISTING", "DEMOLISH", "TEMPORARY"] as const;

/** The phase row's accepted values: PEnum_ElementStatus's four, and the MMI
 *  table's phases when a `progressCode` source reads through it. */
export function phaseAccepted(ruleset: Ruleset | null | undefined): string[] {
  const extra = ruleset?.projectLayer?.phase?.sources ?? [];
  const mmi = roleRule(ruleset, "progress-code")?.check;
  const tablePhases =
    mmi?.type === "code-lookup" && extra.some((s) => "progressCode" in s)
      ? [...new Set((mmi.codes ?? []).flatMap((c) => (c.phase ? [c.phase] : [])))]
      : [];
  return [...PHASE_ACCEPTED, ...tablePhases];
}

/** Not a material, though carried in the material field (HI90 standard.yaml
 *  `ikke_materiale`, begreper.md §4): a colour or finish, an element word, a
 *  bare number or dimension, a tool's placeholder. Carried but unusable is
 *  avvik, never mangler. Case-insensitive, searched anywhere in the name. */
export const NOT_A_MATERIAL: readonly RegExp[] = [
  /\bRAL\b/i,
  /\bNCS\b/i,
  /lakkert/i,
  /^hvit$/i,
  /^(dekke|innervegg|yttervegg|vegg|gulv|tak)$/i,
  /^[\d\s.,x×]+$/i,
  /^default(\(\d+\))?$/i,
  /^MC_\d+_\d+_\d+/i,
  /^<.*>$/i,
];

export const usableMaterial = (name: string): boolean =>
  name.trim() !== "" && !NOT_A_MATERIAL.some((r) => r.test(name));

/** A project mengdetype source's value, when it decides: `telleobjekt` or
 *  `mengdeobjekt`, ignoring case and surrounding space. Anything else does
 *  not decide, and the next source is read. */
export function projectMengdetype(value: string | null): "telleobjekt" | "mengdeobjekt" | null {
  const v = value?.trim().toLowerCase();
  return v === "telleobjekt" || v === "mengdeobjekt" ? v : null;
}
