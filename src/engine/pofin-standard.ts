/** Where POFIN puts the concepts the walk maps: the standard's own sources,
 *  as the suggestion every mapping step offers first (2026-10-05, edkjo:
 *  "You're assuming that all projects use RefClass_NS3451 etc as in KNM.
 *  They dont … suggest the standard as in POFIN, since thats built on NS8360
 *  etc").
 *
 * Plain data, read from POFIN del 2.1 EIR bygg, "Veiledning til krav til
 * alfanumerisk informasjon" (`resources/standards/pofin/02-1-eir-bygg.md`).
 * `extract` is the Uttrekk the standard's value form needs, one capture
 * group = the code the step's list checks; absent, the step's own Uttrekk
 * reads the value (MMI's three digits, Duplikat objekt's owner names).
 */

import type { CodeSource } from "../ids/types.ts";

export type PofinKey =
  | "systemkode"
  | "forekomst"
  | "objekttypenavn"
  | "lokasjon-system"
  | "prosesstatuskode"
  | "duplikat-objekt";

export interface PofinSource {
  key: PofinKey;
  source: CodeSource;
  /** "type": the type object's own attribute, read through its elements. */
  target?: "occurrence" | "type";
  extract?: string;
}

const nons = (propertySet: string, name: string): CodeSource => ({ property: { propertySet, name } });

/** NS 3457-8 component class: one to three capitals (A, AB, ABA; Æ Ø Å
 *  are top-level classes of their own). */
const NS3457_CLASS = "[A-ZÆØÅ]{1,3}";

export const POFIN_SOURCES: Record<PofinKey, PofinSource> = {
  // Systemkode: NS 3451 system class, then a running number and an optional
  // sub number, each after a period (NS 8360-2): 2341.001, 3622.002. The
  // class is the code; NS 3451 classes have one to four digits.
  systemkode: {
    key: "systemkode",
    source: nons("NONS_Reference", "RefPriSysOcc"),
    target: "occurrence",
    extract: "^(\\d{1,4})\\.\\d+(?:\\.\\d+)?$",
  },
  // Forekomst: NS 3457-8 component class, then the occurrence's running
  // number with no separator (NS 3457-7, NS 8360-2): DUZ007. The class is
  // the component code.
  forekomst: {
    key: "forekomst",
    source: nons("NONS_Reference", "RefCompOcc"),
    target: "occurrence",
    extract: `^(${NS3457_CLASS})\\d+$`,
  },
  // Objekttypenavn: IfcRoot.Name on the type object, NS 3457-8 component
  // class + "." + a project-unique type number (NS 8360-1): DUZ.001.
  objekttypenavn: {
    key: "objekttypenavn",
    source: { attribute: "Name" },
    target: "type",
    extract: `^(${NS3457_CLASS})\\.\\d+$`,
  },
  // Lokasjon system: a location code the client sets (NS 3457-7, NS 8360-2):
  // ByggA.
  "lokasjon-system": { key: "lokasjon-system", source: nons("NONS_Reference", "RefPriSysLoc") },
  // Prosesstatuskode (MMI): a three-digit code per the MMI-veileder
  // (NS 8360-1/G1): 400.
  prosesstatuskode: { key: "prosesstatuskode", source: nons("NONS_Process", "ProcessStatus") },
  // Duplikat objekt: the owning discipline's abbreviation, ARK, RIV …
  // (NS 8360-1/G1).
  "duplikat-objekt": { key: "duplikat-objekt", source: nons("NONS_Process", "DuplicateOwnedBy") },
};

/** The standard a mapping step offers first. Funksjonskode is the NS 3457-8
 *  component code, read off Forekomst (edkjo: "NS3457-8 is not the name. The
 *  name can be built from it, but it is the component code"). */
export const ROLE_STANDARD = {
  "system-classification": "systemkode",
  "component-classification": "forekomst",
  "progress-code": "prosesstatuskode",
  "copy-object": "duplikat-objekt",
} as const satisfies Record<string, PofinKey>;
