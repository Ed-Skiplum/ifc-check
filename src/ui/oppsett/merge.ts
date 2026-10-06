/** Oppsett v2: one requirement per role, one requirement per source
 *  property, and an IDS dropped on the page MERGED into the working ruleset
 *  (2026-10-06, edkjo: "We have to be careful not to create duplication that
 *  can create double work, or worst case conflicting requirements").
 *
 * Pure. Every function takes a ruleset and returns a new one; nothing here
 * reads the DOM or the models.
 *
 * The source key of a requirement is `Pset.Property`, literal set and name
 * only: a code-lookup, copy-object or tfm rule's property source, or an IDS
 * rule's literal property facet. A facet whose set or name is a restriction
 * (`Pset_.*Common`) names no single property, so it has no key and is
 * deduplicated by its whole body instead.
 *
 * An imported specification is first split so each rule carries at most one
 * keyed property facet (`splitSpec`): one rule per literal property facet,
 * and one more holding every other requirement facet. Without the split, a
 * spec whose property is already read elsewhere could not be absorbed
 * without dropping its other facets.
 *
 * Per keyed rule of the drop, against the rule already reading its key:
 *
 *   none                          added, origin IDS
 *   same value rule, scope held   nothing (the existing one covers it)
 *   IDS has no value rule         nothing (presence is implied)
 *   existing has none, and it is
 *   an IDS rule (a facet)         the IDS value rule adopted on it
 *   anything else                 a conflict on the existing row, the IDS
 *                                 rule held aside until one is kept
 *
 * "Scope held": the existing rule selects at least what the IDS rule
 * applies to (`covers`). An IDS rule on another selection is never absorbed
 * silently; it is a conflict, so no requirement is lost without a choice.
 *
 * The origin tag lives in `RuleBase.reference`, the ruleset's existing
 * optional "where the requirement comes from" field: POFIN's template rules
 * already cite `POFIN del 2.1 EIR bygg, …` there, and a merged IDS rule gets
 * `IDS <file name>`. `reference` is in the JSON Schema and the workbook and
 * is never written into an .ids, so `formatVersion: 2` is unchanged.
 */

import type {
  Applicability,
  CodeSource,
  ExtendedRule,
  IdsRule,
  MappingRole,
  PropertyFacet,
  Requirements,
  Rule,
  Ruleset,
  Selector,
} from "../../ids/types.ts";
import type { ImportedIds } from "../../ids/import.ts";
import { anyRoleRule, ruleRole } from "../../ids/models.ts";
import { formatSequence } from "../../engine/tfm.ts";
import { isWalkSelected } from "../../engine/walk-selection.ts";

/* ------------------------------------------------------------------ origin */

export type Origin = "POFIN" | "IDS" | null;

/** The tag a requirement's `reference` gives it. */
export function originOf(reference: string | undefined): Origin {
  if (reference === undefined) return null;
  if (/^POFIN\b/.test(reference)) return "POFIN";
  if (/^IDS\b/.test(reference)) return "IDS";
  return null;
}

/** The `reference` a rule merged from an IDS file carries. */
export const idsReference = (fileName: string) => `IDS ${fileName}`;

/* ------------------------------------------------------------- source keys */

export const keyOf = (propertySet: string, name: string) => `${propertySet}.${name}`;

/** A code source's key; null for anything but a filled-in property. */
export function codeSourceKey(source: CodeSource): string | null {
  if (!("property" in source)) return null;
  const { propertySet, name } = source.property;
  return propertySet.trim() === "" && name.trim() === "" ? null : keyOf(propertySet, name);
}

const isLiteral = (f: PropertyFacet): f is PropertyFacet & { propertySet: string; baseName: string } =>
  typeof f.propertySet === "string" && typeof f.baseName === "string";

/** An IDS rule's literal property facets, in order. */
export function literalFacets(rule: IdsRule): (PropertyFacet & { propertySet: string; baseName: string })[] {
  return (rule.requirements?.property ?? []).filter(isLiteral);
}

/** The source properties a rule reads, as keys. */
export function ruleKeys(rule: Rule): string[] {
  if (rule.kind === "ids") {
    return literalFacets(rule)
      .filter((f) => f.propertySet.trim() !== "" || f.baseName.trim() !== "")
      .map((f) => keyOf(f.propertySet, f.baseName));
  }
  const check = rule.check;
  if (check.type === "code-lookup" || check.type === "copy-object" || check.type === "tfm") {
    const key = codeSourceKey(check.source);
    return key === null ? [] : [key];
  }
  return [];
}

/** The rule reading `key`, other than `except`; null when none does. */
export function ruleReading(ruleset: Ruleset, key: string, except?: string): Rule | null {
  return ruleset.rules.find((r) => r.id !== except && ruleKeys(r).includes(key)) ?? null;
}

/* ------------------------------------------------------------- value rules */

/** What a requirement says about the value, normalised so two rules can be
 *  compared: none, a bundled code list, a set of values, a pattern, a TFM
 *  sequence, another restriction (as its canonical JSON), or "must not be
 *  there". */
export type ValueRule =
  | { kind: "any" }
  | { kind: "list"; list: string }
  | { kind: "values"; values: string[] }
  | { kind: "pattern"; pattern: string }
  | { kind: "tfm"; sequence: string }
  | { kind: "restriction"; json: string }
  | { kind: "copy"; copy: string[]; own: string[] }
  | { kind: "prohibited" };

/** JSON with object keys sorted, so equal content compares equal. */
export function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();

export function facetValueRule(facet: PropertyFacet): ValueRule {
  if (facet.cardinality === "prohibited") return { kind: "prohibited" };
  const value = facet.value;
  if (value === undefined) return { kind: "any" };
  if (typeof value === "string") return { kind: "values", values: [value] };
  const r = value.restriction;
  const facets = Object.entries(r).filter(([k, v]) => k !== "base" && v !== undefined);
  if (facets.length === 1 && facets[0][0] === "enumeration") return { kind: "values", values: sortedUnique(r.enumeration ?? []) };
  if (facets.length === 1 && facets[0][0] === "pattern") return { kind: "pattern", pattern: r.pattern ?? "" };
  return { kind: "restriction", json: canon(r) };
}

/** The value rule of the requirement reading `key` in `rule`. */
export function ruleValueRule(rule: Rule, key: string): ValueRule {
  if (rule.kind === "ids") {
    const facet = literalFacets(rule).find((f) => keyOf(f.propertySet, f.baseName) === key);
    return facet ? facetValueRule(facet) : { kind: "any" };
  }
  const check = rule.check;
  if (check.type === "code-lookup") {
    if (check.list !== undefined) return { kind: "list", list: check.list };
    if ((check.codes ?? []).length > 0) return { kind: "values", values: sortedUnique((check.codes ?? []).map((c) => c.code)) };
    return { kind: "pattern", pattern: check.extract };
  }
  if (check.type === "copy-object") {
    return check.copy.length === 0 && check.own.length === 0
      ? { kind: "any" }
      : { kind: "copy", copy: sortedUnique(check.copy), own: sortedUnique(check.own) };
  }
  if (check.type === "tfm") return { kind: "tfm", sequence: formatSequence(check.sequence) };
  return { kind: "any" };
}

export const sameValueRule = (a: ValueRule, b: ValueRule) => canon(a) === canon(b);

/* ------------------------------------------------------------------- scope */

/** What a rule selects: an IDS rule's applicability less the occurrence
 *  bounds, an extended rule's `select`. */
export function scopeOf(rule: Rule): Selector | undefined {
  if (rule.kind === "ids") {
    const { minOccurs: _min, maxOccurs: _max, ...rest } = rule.applicability;
    void _min;
    void _max;
    return rest;
  }
  return rule.select;
}

const FACET_KEYS = ["entity", "partOf", "classification", "attribute", "property", "material"] as const;

function isEmptySelector(s: Selector | undefined): boolean {
  return s === undefined || FACET_KEYS.every((k) => s[k] === undefined || (Array.isArray(s[k]) && (s[k] as unknown[]).length === 0));
}

/** The concrete classes an entity facet names, when it names a list of
 *  them; null for a group or a pattern. */
function entityClasses(s: Selector): string[] | null {
  const entity = s.entity;
  if (!entity) return null;
  if (entity.classes) return entity.classes;
  if (typeof entity.name === "string") return [entity.name];
  if (entity.name && typeof entity.name === "object" && entity.name.restriction.enumeration) {
    const r = entity.name.restriction;
    const others = Object.entries(r).filter(([k, v]) => k !== "base" && k !== "enumeration" && v !== undefined);
    return others.length === 0 ? (r.enumeration ?? null) : null;
  }
  return null;
}

/** Whether `existing` selects at least everything `incoming` applies to:
 *  the same selection, a selection of everything, or the physical elements
 *  when every class the incoming rule names is one. Anything else is not
 *  provable here, so it is not covered. */
export function covers(existing: Selector | undefined, incoming: Selector | undefined): boolean {
  if (canon(existing ?? {}) === canon(incoming ?? {})) return true;
  if (isEmptySelector(existing)) return true;
  if (incoming === undefined) return false;
  const onlyPhysical =
    existing?.entity?.group === "physicalElement" &&
    existing.entity.predefinedType === undefined &&
    FACET_KEYS.filter((k) => k !== "entity").every((k) => existing[k] === undefined);
  if (!onlyPhysical) return false;
  if (incoming.entity?.group === "physicalElement") return true;
  const classes = entityClasses(incoming);
  return classes !== null && classes.length > 0 && classes.every((c) => isWalkSelected(c));
}

/* ------------------------------------------------------------ the IDS drop */

/** A spec as rules with at most one keyed property facet each (see the
 *  module's head). A spec that already has that shape is returned as is. */
export function splitSpec(rule: IdsRule): IdsRule[] {
  const req: Requirements = rule.requirements ?? {};
  const facets = req.property ?? [];
  const literal = facets.filter(isLiteral);
  const unkeyed = facets.filter((f) => !isLiteral(f));
  const rest: Requirements = { ...req };
  if (unkeyed.length > 0) rest.property = unkeyed;
  else delete rest.property;
  const hasRest = FACET_KEYS.some((k) => rest[k] !== undefined && !(Array.isArray(rest[k]) && (rest[k] as unknown[]).length === 0));
  if (literal.length === 0 || (literal.length === 1 && !hasRest)) return [rule];
  const parts: IdsRule[] = literal.map((facet, i) => ({
    ...rule,
    id: `${rule.id}-${i + 1}`,
    name: `${rule.name} · ${facet.propertySet}.${facet.baseName}`,
    requirements: { ...(req.description ? { description: req.description } : {}), property: [facet] },
  }));
  if (hasRest) parts.push({ ...rule, id: `${rule.id}-${literal.length + 1}`, requirements: rest });
  return parts;
}

/** A dropped spec waiting on a choice: it reads the same property as
 *  `ruleId` with another value rule, or applies to another selection. */
export interface Conflict {
  /** Stable over re-drops: the existing rule and the incoming body. */
  id: string;
  ruleId: string;
  incoming: IdsRule;
  /** The incoming rule applies to a selection the existing one does not
   *  cover (as against only the value rule differing). */
  scope: boolean;
}

/** A specification the importer could not read, with its reason. */
export interface Unreadable {
  file: string;
  name: string;
  reason: string;
}

export interface MergeResult {
  ruleset: Ruleset;
  /** Every pending conflict: the ones passed in, then the new ones. */
  conflicts: Conflict[];
  unreadable: Unreadable[];
  /** Rule ids added by this drop. */
  added: string[];
  /** Rule ids that took the IDS value rule. */
  adopted: string[];
}

export function freshId(rules: readonly Rule[], stem: string): string {
  const taken = new Set(rules.map((r) => r.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What an IDS rule requires, without its name, id or citation. */
const body = (rule: IdsRule) => canon({ applicability: rule.applicability, requirements: rule.requirements ?? {} });

export function mergeIds(ruleset: Ruleset, imported: ImportedIds, pending: readonly Conflict[] = []): MergeResult {
  const rules: Rule[] = [...ruleset.rules];
  const conflicts: Conflict[] = [...pending];
  const added: string[] = [];
  const adopted: string[] = [];
  const unreadable: Unreadable[] = imported.specs
    .filter((s) => s.unreadable !== undefined)
    .map((s) => ({ file: imported.fileName, name: s.name, reason: s.unreadable! }));
  const reference = idsReference(imported.fileName);

  const add = (rule: IdsRule) => {
    const id = freshId(rules, rule.id);
    rules.push({ ...rule, id, reference });
    added.push(id);
  };

  for (const spec of imported.ruleset.rules) {
    if (spec.kind !== "ids") continue;
    for (const part of splitSpec(spec)) {
      const facet = literalFacets(part)[0];
      if (facet === undefined) {
        // No source key: the same body already there is the same requirement.
        if (rules.some((r) => r.kind === "ids" && body(r) === body(part))) continue;
        add(part);
        continue;
      }
      const key = keyOf(facet.propertySet, facet.baseName);
      const existing = rules.find((r) => ruleKeys(r).includes(key));
      if (existing === undefined) {
        add(part);
        continue;
      }
      const incomingRule = facetValueRule(facet);
      const current = ruleValueRule(existing, key);
      const scopeHeld = covers(scopeOf(existing), scopeOf(part));
      if (scopeHeld && (sameValueRule(current, incomingRule) || (incomingRule.kind === "any" && current.kind !== "prohibited"))) {
        continue;
      }
      if (scopeHeld && current.kind === "any" && existing.kind === "ids") {
        const next: IdsRule = {
          ...existing,
          requirements: {
            ...existing.requirements,
            property: (existing.requirements?.property ?? []).map((f) =>
              isLiteral(f) && keyOf(f.propertySet, f.baseName) === key
                ? { ...f, ...(facet.value !== undefined ? { value: facet.value } : {}), ...(facet.cardinality ? { cardinality: facet.cardinality } : {}) }
                : f,
            ),
          },
        };
        rules[rules.indexOf(existing)] = next;
        adopted.push(existing.id);
        continue;
      }
      const conflict: Conflict = {
        id: `${existing.id}\u0000${body(part)}`,
        ruleId: existing.id,
        incoming: { ...part, reference },
        scope: !scopeHeld,
      };
      if (!conflicts.some((c) => c.id === conflict.id)) conflicts.push(conflict);
    }
  }
  return { ruleset: { ...ruleset, rules }, conflicts, unreadable, added, adopted };
}

/** One conflict decided. «Behold IDS»: the incoming rule takes the existing
 *  rule's place (and every other conflict on that rule now stands against
 *  it). «Behold nåværende»: the incoming rule is dropped. */
export function resolveConflict(
  ruleset: Ruleset,
  conflicts: readonly Conflict[],
  id: string,
  keep: "ids" | "current",
): { ruleset: Ruleset; conflicts: Conflict[] } {
  const conflict = conflicts.find((c) => c.id === id);
  const rest = conflicts.filter((c) => c.id !== id);
  if (!conflict || keep === "current") return { ruleset, conflicts: rest };
  const at = ruleset.rules.findIndex((r) => r.id === conflict.ruleId);
  if (at < 0) return { ruleset, conflicts: rest };
  const others = ruleset.rules.filter((_, i) => i !== at);
  const newId = freshId(others, conflict.incoming.id);
  const rules = [...ruleset.rules];
  rules[at] = { ...conflict.incoming, id: newId };
  return {
    ruleset: { ...ruleset, rules },
    conflicts: rest.map((c) => (c.ruleId === conflict.ruleId ? { ...c, ruleId: newId } : c)),
  };
}

/** The conflicts left once `ruleId` is gone. */
export const withoutRule = (conflicts: readonly Conflict[], ruleId: string) => conflicts.filter((c) => c.ruleId !== ruleId);

/* ------------------------------------------------------- adding and fixing */

/** The fixed kinds, in the walk's order (`SetupPage.tsx` STEPS). */
export const FIXED_ROLES: readonly MappingRole[] = [
  "type-name",
  "system-classification",
  "component-classification",
  "copy-object",
  "progress-code",
  "tfm",
];

/** What «Legg til krav» offers: the fixed roles no rule plays, the floor
 *  config when there is none, then a custom property, always. */
export type AddKind = MappingRole | "storeys" | "property";

export function addableKinds(ruleset: Ruleset): AddKind[] {
  return [
    ...FIXED_ROLES.filter((role) => anyRoleRule(ruleset, role) === null),
    ...(ruleset.storeys === undefined ? (["storeys"] as const) : []),
    "property",
  ];
}

/** A custom property requirement: on the physical elements, the walk's own
 *  selection, as an IDS rule, so the engine, the report and the .ids export
 *  take it as they take any. Blank set and name until filled in. */
export function propertyRule(ruleset: Ruleset, name: string): IdsRule {
  return {
    id: freshId(ruleset.rules, "egenskap"),
    kind: "ids",
    name,
    applicability: { entity: { group: "physicalElement" } },
    requirements: { property: [{ propertySet: "", baseName: "", cardinality: "required" }] },
  };
}

/** Whether a rule is edited as a custom property: an IDS rule whose
 *  requirement is exactly one literal property facet. */
export function isPropertyRequirement(rule: Rule): rule is IdsRule {
  if (rule.kind !== "ids") return false;
  const req = rule.requirements ?? {};
  const facets = req.property ?? [];
  return (
    facets.length === 1 &&
    isLiteral(facets[0]) &&
    FACET_KEYS.filter((k) => k !== "property").every((k) => req[k] === undefined)
  );
}

/** The rule with its source property set to `set.name`. Refused (null) when
 *  another rule already reads it. A code-lookup rule may take a new Uttrekk
 *  with it (`extract`, a candidate's), and reads a property per occurrence. */
export function withSource(
  ruleset: Ruleset,
  ruleId: string,
  property: { propertySet: string; name: string },
  extra: { extract?: string; target?: "occurrence" | "type" } = {},
): Ruleset | null {
  const key = keyOf(property.propertySet, property.name);
  if (ruleReading(ruleset, key, ruleId) !== null) return null;
  const rules = ruleset.rules.map((rule): Rule => {
    if (rule.id !== ruleId) return rule;
    if (rule.kind === "ids") {
      const facets = rule.requirements?.property ?? [];
      const at = facets.findIndex(isLiteral);
      if (at < 0) return rule;
      return {
        ...rule,
        requirements: {
          ...rule.requirements,
          property: facets.map((f, i) => (i === at ? { ...f, propertySet: property.propertySet, baseName: property.name } : f)),
        },
      };
    }
    const check = rule.check;
    if (check.type === "code-lookup") {
      const next: ExtendedRule = {
        ...rule,
        check: {
          ...check,
          source: { property },
          ...(extra.extract !== undefined ? { extract: extra.extract } : {}),
          ...(check.list !== undefined || extra.target ? { target: extra.target ?? "occurrence" } : {}),
        },
      };
      delete next.enabled;
      return next;
    }
    if (check.type === "copy-object" || check.type === "tfm") {
      const next: ExtendedRule = { ...rule, check: { ...check, source: { property } } };
      delete next.enabled;
      return next;
    }
    return rule;
  });
  return { ...ruleset, rules };
}

/** The role a rule plays, re-exported so the page reads one module. */
export { ruleRole };

/** Whether `applicability` selects what a custom property requirement does:
 *  the physical elements and nothing narrower. */
export function isPhysical(applicability: Applicability): boolean {
  return canon(scopeOf({ kind: "ids", id: "", name: "", applicability }) ?? {}) === canon({ entity: { group: "physicalElement" } });
}
