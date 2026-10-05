/** POFIN as a template (2026-10-05, edkjo: "We could also add "POFIN" as a
 *  template where you just say "POFIN" as a blanket input and then get
 *  assigned the POFIN required properties and attributes").
 *
 * Only what POFIN del 2.1 EIR bygg (`resources/standards/pofin/02-1-eir-bygg.md`)
 * states AND this tool evaluates today, each through the rule shape the
 * Oppsett walk writes for the same step. Left out, and why:
 *
 *   Lokasjon system (3.5.4)  Tabell 1 asks it of RIV and RIE only; a rule
 *                            carries no discipline, and the project's
 *                            `models` are not POFIN's to state.
 *   Beskrivende navn type    IfcRoot.Description on the type object, which
 *   (3.5.2)                  the evaluator cannot read on a type.
 *   Utvendig, Brannmotstand, Akustisk egenskap, U-verdi, Bærende
 *   (3.5.8 to 3.5.12)        POFIN names the property but gives the object
 *                            classes as examples only ("f.eks.", "og mer").
 *   Mengdeegenskaper, Georeferering, Nullpunkt, Bruttoareal, SI-enheter,
 *   romarealer, Systemtilhørighet, Predefinerte undertyper,
 *   Nullpunkts- og kontrollobjekter: no rule kind reaches them.
 *
 * Forekomst (3.5.3) is Funksjonskode's source: the component-classification
 * rule reads NONS_Reference.RefCompOcc whole, so it is not a second rule.
 */

import { POFIN_SOURCES } from "./pofin-standard.ts";
import { POFIN_TYPE_NAME } from "./type-name.ts";
import { ruleRole } from "../ids/models.ts";
import type { ExtendedRule, MappingRole, ProjectLayer, Ruleset } from "../ids/types.ts";

const EIR = "POFIN del 2.1 EIR bygg";
const physical = { entity: { group: "physicalElement" as const } };

/** The template. Rule ids are the role names, as the walk names them. */
export function pofinRuleset(): Ruleset {
  const rules: ExtendedRule[] = [
    // 3.5.1 Objekttypenavn: IfcRoot.Name on the type object, NS 3457-8
    // component class "." a project-unique type number (NS 8360-1). Tabell 1:
    // every discipline, steg 4 on.
    {
      id: "type-name",
      kind: "extended",
      name: "Objekttypenavn",
      reference: `${EIR}, 3.5.1 Objekttypenavn`,
      select: physical,
      check: { type: "type-name", sequence: [...POFIN_TYPE_NAME] },
    },
    // 3.5.5 Systemkode: NONS_Reference.RefPriSysOcc, NS 3451 system class,
    // then a running number and an optional sub number after periods
    // (NS 8360-2). Tabell 1: every discipline, steg 5 on.
    {
      id: "system-classification",
      kind: "extended",
      mapping: "system-classification",
      name: "Systemkode",
      reference: `${EIR}, 3.5.5 Systemkode`,
      select: physical,
      check: {
        type: "code-lookup",
        list: "ns3451",
        target: "occurrence",
        source: POFIN_SOURCES.systemkode.source,
        extract: POFIN_SOURCES.systemkode.extract!,
      },
    },
    // 3.5.3 Forekomst: NONS_Reference.RefCompOcc, NS 3457-8 component class
    // then the occurrence's running number (NS 3457-7, NS 8360-2): the
    // Funksjonskode step's standard. Tabell 1: every discipline, steg 6 on.
    {
      id: "component-classification",
      kind: "extended",
      mapping: "component-classification",
      name: "Forekomst",
      reference: `${EIR}, 3.5.3 Forekomst`,
      select: physical,
      check: {
        type: "code-lookup",
        list: "ns3457-8",
        target: "occurrence",
        source: POFIN_SOURCES.forekomst.source,
        extract: POFIN_SOURCES.forekomst.extract!,
      },
    },
    // 3.5.7 Duplikat objekt: NONS_Process.DuplicateOwnedBy, the owning
    // discipline's abbreviation (NS 8360-1/G1). Any value names another
    // owner; which names are a model's own is the project's `models`.
    // Tabell 1: ARK, steg 4 on.
    {
      id: "copy-object",
      kind: "extended",
      name: "Duplikat objekt",
      reference: `${EIR}, 3.5.7 Duplikat objekt`,
      select: physical,
      check: { type: "copy-object", source: POFIN_SOURCES["duplikat-objekt"].source, copy: [], own: [] },
    },
    // 3.5.6 Prosesstatuskode (MMI): NONS_Process.ProcessStatus, "bare med
    // tre-siffer kode iht. veilederens koder eller egendefinerte koder": the
    // format, no code list (the codes are the veileder's or the project's).
    // Tabell 1: every discipline, steg 4 on.
    {
      id: "progress-code",
      kind: "extended",
      mapping: "progress-code",
      name: "Prosesstatuskode (MMI)",
      reference: `${EIR}, 3.5.6 Prosesstatuskode (MMI)`,
      select: physical,
      check: { type: "code-lookup", codes: [], source: POFIN_SOURCES.prosesstatuskode.source, extract: "^(\\d{3})$" },
    },
  ];
  const projectLayer: ProjectLayer = {
    // IFC-standard: "det benyttes IFC4 eller senere versjoner for utveksling".
    "ifc-schema": { reference: `${EIR}, IFC-standard`, accepted: ["IFC4", "IFC4X3"] },
  };
  return { formatVersion: 2, name: "POFIN", ifcVersions: ["IFC4", "IFC4X3_ADD2"], projectLayer, rules };
}

/** The roles the template assigns, in the walk's order. */
export const POFIN_ROLES: readonly MappingRole[] = pofinRuleset().rules.map((r) => ruleRole(r)!);

/** The template on a working copy: its rules take the place of the copy's
 *  rules of the same roles, its project-layer parts replace the copy's,
 *  everything else stays (the name, unless blank, storeys, models, other
 *  rules). */
export function withPofin(base: Ruleset): Ruleset {
  const pofin = pofinRuleset();
  const roles = new Set(POFIN_ROLES);
  const kept = base.rules.filter((r) => {
    const role = ruleRole(r);
    return role === null || !roles.has(role);
  });
  const taken = new Set(kept.map((r) => r.id));
  const added = pofin.rules.map((r) => {
    let id = r.id;
    for (let i = 2; taken.has(id); i += 1) id = `${r.id}-${i}`;
    taken.add(id);
    return { ...r, id };
  });
  return {
    ...base,
    name: base.name.trim() === "" ? pofin.name : base.name,
    projectLayer: { ...base.projectLayer, ...pofin.projectLayer },
    rules: [...kept, ...added],
  };
}
