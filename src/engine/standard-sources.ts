/** What the standard layer reads before any project source, and how it judges
 *  a value: plain data and pure functions, shared by the engine's rows
 *  (`standard-layer.ts`) and Oppsett's Fase and Materiale / Produkt steps, so
 *  the walk shows exactly what the engine reads; and the mengdetype tables'
 *  lookups, shared by the engine's switch and the type ledger's Ledeenhet.
 */

import { MENGDETYPE_IFCKLASSE } from "../codelists/mengdetype-ifcklasse.ts";
import { MENGDETYPE_NS3457 } from "../codelists/mengdetype-ns3457.ts";
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

/** The IFC class table's rows, keyed by the class in upper case. */
export const CLASS_ROWS = new Map(
  Object.entries(MENGDETYPE_IFCKLASSE.rows).map(([k, v]) => [k.toUpperCase(), v] as const),
);

/** The NS 3457-8 table row for a component code, as HI90's blokkdata looks
 *  it up: the whole value, then its first three, then its first two
 *  characters, so `AB-01` finds AB. */
export function codeRow(code: string) {
  const k = code.trim().toUpperCase();
  for (const n of [k.length, 3, 2]) {
    const row = MENGDETYPE_NS3457.rows[k.slice(0, n)];
    if (row) return row;
  }
  return undefined;
}

export const DECISIVE = new Set(["telleobjekt", "mengdeobjekt", "ikke_relevant"]);

/** An `IfcClassificationReference` system the NS 3457 code is read from. */
export const NS3457_SYSTEM = /3457/;

/** An object's recommended lead unit (`ledeenhet`: stk, m, m2, m3 …) from the
 *  two tables the Materiale / Produkt switch reads, in its order: the IFC
 *  class row when it decides, else the NS 3457 code's row when it decides.
 *  Null when neither decides or the deciding row names no unit. The
 *  project's mengdetype sources carry no unit, so they are not read. */
export function ledeenhet(entity: string, ns3457: string | undefined): string | null {
  const classRow = CLASS_ROWS.get(entity.toUpperCase());
  if (classRow && DECISIVE.has(classRow.mengdetype)) return classRow.ledeenhet;
  const row = ns3457 === undefined ? undefined : codeRow(ns3457);
  return row && DECISIVE.has(row.mengdetype) ? row.ledeenhet : null;
}
