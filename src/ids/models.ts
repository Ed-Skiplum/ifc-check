/** Per-model facts and roles, resolved from a ruleset: which `ModelFact` a
 *  file is, its discipline, and which rule plays which mapping role. Pure
 *  lookups, shared by lint, the evaluator, the report and the UI, so they
 *  all resolve a file and a role the same way. */

import type { CodeListId } from "../codelists/index.ts";
import type {
  CopyObjectCheck,
  ExtendedRule,
  MappingRole,
  ModelFact,
  Rule,
  Ruleset,
  StoreyPlane,
  StoreyTolerance,
} from "./types.ts";

/** The IFC file name without directory and extension: `EKS_ARK.ifc` and
 *  `C:\x\EKS_ARK.IFC` are `EKS_ARK`. What `ModelFact.label` is matched
 *  against, exactly. */
export function modelLabel(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.(ifc|ifczip|ifcxml)$/i, "");
}

/** The ruleset's fact for this file, or null when it declares none. */
export function modelFact(ruleset: Ruleset | null | undefined, fileName: string): ModelFact | null {
  const label = modelLabel(fileName);
  return ruleset?.models?.find((m) => m.label === label) ?? null;
}

/** The copy-object comparison key: case and whitespace do not count. */
export function ownerKey(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase("nb");
}

/** The role a rule plays, or null. A code-lookup rule's role is its
 *  `mapping`; a copy-object check is the `copy-object` role. */
export function ruleRole(rule: Rule): MappingRole | null {
  if (rule.kind !== "extended") return null;
  if (rule.check?.type === "copy-object") return "copy-object";
  return rule.mapping ?? null;
}

/** The ENABLED rule playing `role`, or null. */
export function roleRule(ruleset: Ruleset | null | undefined, role: MappingRole): ExtendedRule | null {
  for (const rule of ruleset?.rules ?? []) {
    if (rule.kind === "extended" && rule.enabled !== false && ruleRole(rule) === role) return rule;
  }
  return null;
}

/** The bundled list a new classification mapping starts on: NS 3451 holds
 *  the system codes, NS 3457-8 the component codes. */
export function defaultCodeList(role: "system-classification" | "component-classification"): CodeListId {
  return role === "system-classification" ? "ns3451" : "ns3457-8";
}

/** The Uttrekk a new code-lookup mapping starts on. MMI: a three-digit code
 *  or 0, the format the veileder sets (edkjo 2026-10-01: "our default is 0 or
 *  nnn"); with no codes listed, that format is the whole check. Others: the
 *  whole value. */
export function defaultExtract(role: "system-classification" | "component-classification" | "progress-code"): string {
  return role === "progress-code" ? "^(0|\\d{3})$" : "^(.+)$";
}

/** The rule playing `role`, enabled or not, or null. */
export function anyRoleRule(ruleset: Ruleset | null | undefined, role: MappingRole): ExtendedRule | null {
  for (const rule of ruleset?.rules ?? []) {
    if (rule.kind === "extended" && ruleRole(rule) === role) return rule;
  }
  return null;
}

export type CopyVerdict = "own" | "copy";

/** How a copy-object check reads one value in one model. `ownerNames` is
 *  that model's (empty when the ruleset states none); `everyOwnerName` is
 *  every model's. `known` is false for a value the project names nowhere
 *  (not a copy value, not an own value, no model's owner name): still a
 *  copy, and tallied as deviating. */
export function copyVerdict(
  check: CopyObjectCheck,
  value: string | null,
  ownerNames: readonly string[],
  everyOwnerName: readonly string[],
): { verdict: CopyVerdict; known: boolean } {
  if (value === null || value.trim() === "") return { verdict: "own", known: true };
  const key = ownerKey(value);
  if (check.own.some((v) => ownerKey(v) === key)) return { verdict: "own", known: true };
  if (ownerNames.some((v) => ownerKey(v) === key)) return { verdict: "own", known: true };
  if (check.copy.some((v) => ownerKey(v) === key)) return { verdict: "copy", known: true };
  return { verdict: "copy", known: everyOwnerName.some((v) => ownerKey(v) === key) };
}

/** Every owner name any model declares. */
export function everyOwnerName(ruleset: Ruleset | null | undefined): string[] {
  return (ruleset?.models ?? []).flatMap((m) => m.ownerNames ?? []);
}

/** The storey matching a model gets: the setup's, or its discipline's
 *  override. `override` is set when a discipline rule exists for the model;
 *  whether its tolerance holds (requireAllNames) is the check's to decide. */
export interface StoreyPolicy {
  plane: StoreyPlane;
  tolerance: StoreyTolerance;
  nameWindowMm: number | null;
  nearMm: number;
  override: { plane: StoreyPlane; tolerance: StoreyTolerance; requireAllNames: boolean } | null;
}

export function storeyPolicy(ruleset: Ruleset | null | undefined, fileName: string): StoreyPolicy | null {
  const setup = ruleset?.storeys;
  if (!setup) return null;
  const discipline = modelFact(ruleset, fileName)?.discipline;
  const rule = discipline === undefined ? undefined : setup.disciplines?.find((d) => d.discipline === discipline);
  return {
    plane: setup.plane,
    tolerance: setup.tolerance,
    nameWindowMm: setup.nameWindowMm,
    nearMm: setup.nearMm,
    override: rule ? { plane: rule.plane, tolerance: rule.tolerance, requireAllNames: rule.requireAllNames } : null,
  };
}
