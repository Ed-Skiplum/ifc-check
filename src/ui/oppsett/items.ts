/** The sidebar's requirements, from the ruleset: what Oppsett v2 lists, in
 *  which order, under which name, reading which source, from which origin.
 *
 * Pure. Order: the walk's (`SetupPage.tsx` STEPS: Typenavn, Systemkode,
 * Funksjonskode, Duplikat objekt, MMI, Fase, Materiale / Produkt,
 * Etasjeoppsett, TFM), then IFC-skjema, then every IDS rule in ruleset order.
 *
 * Presence follows what evaluates. A fixed role is listed when a rule plays
 * it; Etasjeoppsett when the ruleset has a floor config. IFC-skjema, Fase and
 * Materiale / Produkt are the standard layer: their report rows exist on
 * every model whatever the ruleset says, so they are always listed, and
 * deleting one clears the project's layer on it (back to the standard).
 *
 * Every figure a row shows comes from the report row the worker built
 * (`engine/report.ts`), found here by `rowMatch`.
 */

import type { ReportRow } from "../../engine/report.ts";
import { STANDARD_SOURCES } from "../../engine/standard-sources.ts";
import { layerSources } from "../layer-steps.ts";
import type { IdsRule, IdsValue, MappingRole, Rule, Ruleset } from "../../ids/types.ts";
import type { StringKey } from "../i18n.ts";
import { segmentState } from "../setup/candidates.ts";
import {
  FIXED_ROLES,
  canon,
  codeSourceKey,
  isPropertyRequirement,
  literalFacets,
  originOf,
  ruleKeys,
  ruleRole,
  type Conflict,
  type Origin,
} from "./merge.ts";

export type LayerKind = "ifc-schema" | "phase" | "materials" | "storeys";

export interface ReqItem {
  /** `rule:<id>` for a rule, else the layer kind. */
  id: string;
  kind: "rule" | LayerKind;
  ruleId: string | null;
  role: MappingRole | null;
  /** A label key, or the rule's own name (an IDS rule, a custom property). */
  label: StringKey | null;
  name: string;
  /** The source as line 2 shows it; null = none set. */
  source: string | null;
  origin: Origin;
  conflict: boolean;
  /** Edited as a custom property (an IDS rule with one literal property). */
  property: boolean;
}

/** The walk's names for the roles (`SetupPage.tsx` STEP_LABEL). */
export const ROLE_LABEL: Record<MappingRole, StringKey> = {
  "type-name": "check.type-name-placeholder",
  "system-classification": "mapping.system-classification",
  "component-classification": "req.funksjonskode",
  "copy-object": "mapping.copy-object",
  "progress-code": "mapping.progress-code",
  tfm: "req.tfm",
};

export const LAYER_LABEL: Record<LayerKind, StringKey> = {
  "ifc-schema": "req.ifc-schema",
  phase: "req.fase",
  materials: "req.materiale-produkt",
  storeys: "setup.storeys",
};

/** The walk's order, with the standard-layer and floor items in it. */
const ORDER: readonly (MappingRole | LayerKind)[] = [
  "type-name",
  "system-classification",
  "component-classification",
  "copy-object",
  "progress-code",
  "phase",
  "materials",
  "storeys",
  "tfm",
  "ifc-schema",
];

/** An IDS value as data: a literal as is, a pattern between slashes, a
 *  list joined by «|». */
export function idsValueText(value: IdsValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const r = value.restriction;
  if (r.pattern !== undefined) return `/${r.pattern}/`;
  if (r.enumeration) return r.enumeration.join(" | ");
  return canon(r);
}

/** What an IDS rule's requirement reads, as names: each facet's subject. */
export function idsSubjects(rule: IdsRule): string[] {
  const req = rule.requirements ?? {};
  return [
    ...(req.property ?? []).map((f) => `${idsValueText(f.propertySet)}.${idsValueText(f.baseName)}`),
    ...(req.attribute ?? []).map((f) => idsValueText(f.name)),
    ...(req.classification ?? []).map((f) => `IfcClassificationReference ${idsValueText(f.system)}`.trim()),
    ...(req.partOf ?? []).map((f) => f.relation ?? idsValueText(f.entity.name) ?? ""),
    ...(req.material ?? []).map(() => "IfcMaterial"),
    ...(req.entity ? [idsValueText(req.entity.name)] : []),
  ].filter((s) => s !== "");
}

function ruleSource(rule: Rule): string | null {
  if (rule.kind === "ids") {
    const keys = ruleKeys(rule);
    if (keys.length > 0) return keys.join(", ");
    const subjects = idsSubjects(rule);
    return subjects.length > 0 ? subjects.join(", ") : null;
  }
  const check = rule.check;
  if (check.type === "type-name") return "Type.Name";
  if (check.type === "code-lookup" || check.type === "copy-object" || check.type === "tfm") {
    const source = check.source;
    if ("property" in source) return codeSourceKey(source);
    if ("attribute" in source) return source.attribute;
    if ("classification" in source) return ["IfcClassificationReference", source.classification.system ?? ""].join(" ").trim();
    return "IfcRelAssociatesMaterial";
  }
  return null;
}

export function requirementItems(ruleset: Ruleset, conflicts: readonly Conflict[]): ReqItem[] {
  const conflicted = new Set(conflicts.map((c) => c.ruleId));
  const ruleItem = (rule: Rule): ReqItem => {
    const role = ruleRole(rule);
    return {
      id: `rule:${rule.id}`,
      kind: "rule",
      ruleId: rule.id,
      role,
      label: role ? ROLE_LABEL[role] : null,
      name: rule.name,
      source: ruleSource(rule),
      origin: originOf(rule.reference),
      conflict: conflicted.has(rule.id),
      property: isPropertyRequirement(rule),
    };
  };
  const layerItem = (kind: LayerKind): ReqItem | null => {
    let source: string;
    let reference: string | undefined;
    if (kind === "ifc-schema") {
      source = "FILE_SCHEMA";
      reference = ruleset.projectLayer?.["ifc-schema"]?.reference;
    } else if (kind === "storeys") {
      if (ruleset.storeys === undefined) return null;
      source = "IfcBuildingStorey";
      reference = ruleset.storeys.reference;
    } else {
      const slots = kind === "phase" ? (["phase"] as const) : (["product", "material"] as const);
      const extra = slots.reduce((n, slot) => n + layerSources(ruleset, slot).length, 0);
      source = STANDARD_SOURCES[slots[0]][0] + (extra > 0 ? ` +${extra}` : "");
      reference = kind === "phase" ? ruleset.projectLayer?.phase?.reference : ruleset.projectLayer?.["material-product"]?.reference;
    }
    return {
      id: kind,
      kind,
      ruleId: null,
      role: null,
      label: LAYER_LABEL[kind],
      name: "",
      source,
      origin: originOf(reference),
      conflict: false,
      property: false,
    };
  };

  const out: ReqItem[] = [];
  for (const entry of ORDER) {
    if ((FIXED_ROLES as readonly string[]).includes(entry)) {
      const rule = ruleset.rules.find((r) => ruleRole(r) === entry);
      if (rule) out.push(ruleItem(rule));
    } else {
      const item = layerItem(entry as LayerKind);
      if (item) out.push(item);
    }
  }
  for (const rule of ruleset.rules) if (rule.kind === "ids") out.push(ruleItem(rule));
  return out;
}

/** The report row an item reads, on one model's rows. */
export function rowOf(item: ReqItem, rows: readonly ReportRow[]): ReportRow | null {
  if (item.kind === "rule") {
    if (item.role) return rows.find((r) => r.mapping === item.role) ?? null;
    return rows.find((r) => r.id === item.ruleId && !r.mapping) ?? null;
  }
  const id = item.kind === "materials" ? "material-product" : item.kind === "storeys" ? "storey-config" : item.kind;
  return rows.find((r) => r.id === id && !r.mapping) ?? null;
}

/** The hit figure of one report row: the elements its sources answered for
 *  (the mapping's infrastructure, not the value check) of the elements it
 *  judges. A row whose sources the engine does not count (an IDS rule)
 *  gives the elements meeting it instead. Null when the row has no count. */
export function rowHits(row: ReportRow): { hits: number; of: number } | null {
  const d = row.dekning;
  if (d.grunnlag === null) return null;
  const kilder = d.kilder.filter((k) => k.gren !== "mengdetype");
  if (kilder.length > 0 && kilder.every((k) => k.n !== null)) {
    return { hits: Math.min(d.grunnlag, kilder.reduce((n, k) => n + (k.n ?? 0), 0)), of: d.grunnlag };
  }
  if (d.oppfylt === null) return null;
  return { hits: d.oppfylt, of: d.grunnlag };
}

/** One figure over every model's row, or null when none counts. */
export function sumHits(rows: readonly (ReportRow | null)[]): { hits: number; of: number } | null {
  let hits = 0;
  let of = 0;
  let any = false;
  for (const row of rows) {
    const h = row ? rowHits(row) : null;
    if (!h) continue;
    any = true;
    hits += h.hits;
    of += h.of;
  }
  return any ? { hits, of } : null;
}

/** A row's dot: the walk bar's states (`segmentState`), with red for a row
 *  that fails on a loaded model. `open`: nothing set; `saved`: set, not yet
 *  checked against a model (none loaded, 0 hits, or not countable);
 *  `done`: hits on a loaded model; `fail`: a model's row fails. */
export type ItemStatus = "open" | "saved" | "done" | "fail";

export function itemStatus(item: ReqItem, loaded: boolean, rows: readonly (ReportRow | null)[]): ItemStatus {
  const configured = item.source !== null;
  if (!configured) return "open";
  if (loaded && rows.some((r) => r?.state === "fail")) return "fail";
  const figure = sumHits(rows);
  return segmentState(loaded, false, { hits: figure ? figure.hits : null });
}

/** The facet a custom-property item edits. */
export function propertyFacetOf(rule: Rule) {
  return rule.kind === "ids" ? (literalFacets(rule)[0] ?? null) : null;
}
