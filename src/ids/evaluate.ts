/** Run a ruleset against a parsed model.
 *
 * Coverage is bounded by what the parser exposes, and the boundary is reported
 * rather than hidden. A rule this evaluator cannot answer comes back
 * `not_evaluable` with the reason; it is never reported as a pass. Likewise a
 * rule that matched nothing is `not_applicable`, not `pass`: a check over zero
 * entities has established nothing, which is exactly how a rule that silently
 * stopped working goes unnoticed.
 *
 * What the parser gives us, and therefore what is evaluable:
 *   entity + predefinedType, the attributes GlobalId / Name / ObjectType /
 *   Tag / PredefinedType, materials, storey containment, aggregation, voids,
 *   type linkage, and the three flattened common properties IsExternal /
 *   FireRating / LoadBearing.
 * Not evaluable here: classifications, arbitrary property sets, IFCRELNESTS,
 *   IFCRELASSIGNSTOGROUP, and any attribute outside the list above.
 */

import { entityNameValue } from "./emit.ts";
import { isEnabled } from "./export.ts";
import type { ModelGraph, ModelProduct, ModelSummary } from "./model.ts";
import type {
  AttributeFacet,
  ClassificationFacet,
  IdsValue,
  MaterialFacet,
  PartOfFacet,
  PropertyFacet,
  Requirements,
  Restriction,
  Rule,
  Ruleset,
  Selector,
} from "./types.ts";

export type ResultState = "pass" | "fail" | "not_applicable" | "not_evaluable";

export interface Finding {
  /** Full GlobalId, never truncated. */
  guid: string;
  entity: string;
  name: string | null;
  reason: string;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  kind: "ids" | "extended";
  state: ResultState;
  /** Entities the rule looked at. Zero means it matched nothing. */
  applicable: number;
  /** Entities that failed. Findings may be capped; this count never is. */
  failed: number;
  findings: Finding[];
  /** Short factual line. */
  detail: string;
  /** Set when state is not_evaluable: what the evaluator cannot reach. */
  reason?: string;
  /** Caveats about how the check was run, e.g. a weakened property match. */
  notes?: string[];
}

export interface ModelResult {
  model: string;
  schema: string;
  products: number;
  results: RuleResult[];
  counts: Record<ResultState, number>;
}

export interface EvaluateOptions {
  /** 0 = every finding. */
  maxFindings?: number;
}

/* -------------------------------------------------------------- matching */

class Unsupported extends Error {}

/** XSD regular expressions are implicitly anchored and use a different dialect
 *  from JavaScript's. Anchoring is reproduced; the dialect difference is not,
 *  so an exotic pattern can behave differently here than in a conforming IDS
 *  auditor. Plain character classes, quantifiers and alternation agree. */
function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    throw new Unsupported(`pattern "${pattern}" is not usable as a regular expression`);
  }
}

function matchesRestriction(restriction: Restriction, value: string): boolean {
  if (restriction.enumeration && !restriction.enumeration.includes(value)) return false;
  if (restriction.pattern !== undefined && !matchesPattern(restriction.pattern, value)) {
    return false;
  }
  if (restriction.length !== undefined && value.length !== restriction.length) return false;
  if (restriction.minLength !== undefined && value.length < restriction.minLength) return false;
  if (restriction.maxLength !== undefined && value.length > restriction.maxLength) return false;

  const bounded =
    restriction.minInclusive !== undefined ||
    restriction.maxInclusive !== undefined ||
    restriction.minExclusive !== undefined ||
    restriction.maxExclusive !== undefined;
  if (bounded) {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (restriction.minInclusive !== undefined && n < restriction.minInclusive) return false;
    if (restriction.maxInclusive !== undefined && n > restriction.maxInclusive) return false;
    if (restriction.minExclusive !== undefined && n <= restriction.minExclusive) return false;
    if (restriction.maxExclusive !== undefined && n >= restriction.maxExclusive) return false;
  }
  return true;
}

function matchesValue(constraint: IdsValue, value: string | null): boolean {
  if (value === null) return false;
  if (typeof constraint === "string") return constraint === value;
  return matchesRestriction(constraint.restriction, value);
}

function literal(value: IdsValue): string {
  return typeof value === "string" ? value : "<restriction>";
}

/* ---------------------------------------------------------- product reads */

const SUPPORTED_ATTRIBUTES = [
  "GlobalId",
  "Name",
  "ObjectType",
  "Tag",
  "PredefinedType",
] as const;

function spatialOnly(product: ModelProduct, what: string): never {
  throw new Unsupported(
    `${what} is not exposed for spatial structure elements; the parser's ` +
      `${product.entity} rows carry GlobalId and Name only`,
  );
}

function readAttribute(product: ModelProduct, name: string): string | null {
  if (product.source === "spatial" && name !== "GlobalId" && name !== "Name") {
    spatialOnly(product, `attribute ${name}`);
  }
  switch (name) {
    case "GlobalId":
      return product.guid;
    case "Name":
      return product.name;
    case "ObjectType":
      return product.object_type;
    case "Tag":
      return product.tag;
    case "PredefinedType":
      return product.predefined_type;
    default:
      throw new Unsupported(
        `attribute "${name}" is not exposed by the parser; evaluable attributes are ` +
          SUPPORTED_ATTRIBUTES.join(", "),
      );
  }
}

const FLATTENED_PROPERTIES = ["IsExternal", "FireRating", "LoadBearing"] as const;

function readProperty(product: ModelProduct, baseName: string): string | null {
  if (product.source === "spatial") spatialOnly(product, "a property");
  switch (baseName) {
    case "IsExternal":
      return product.is_external === null ? null : String(product.is_external);
    case "FireRating":
      return product.fire_rating;
    case "LoadBearing":
      return product.load_bearing === null ? null : String(product.load_bearing);
    default:
      throw new Unsupported(
        `property "${baseName}" is not exposed by the parser; evaluable properties ` +
          `are ${FLATTENED_PROPERTIES.join(", ")}`,
      );
  }
}

function attributeName(facet: AttributeFacet): string {
  if (typeof facet.name !== "string") {
    throw new Unsupported(
      "an attribute facet whose name is a restriction cannot be evaluated here; " +
        "name one attribute",
    );
  }
  return facet.name;
}

function propertyBaseName(facet: PropertyFacet): string {
  if (typeof facet.baseName !== "string") {
    throw new Unsupported(
      "a property facet whose baseName is a restriction cannot be evaluated here; " +
        "name one property",
    );
  }
  return facet.baseName;
}

/* ------------------------------------------------------------ facet tests */

interface Relations {
  containedIn: Map<string, string>;
  aggregateParent: Map<string, string>;
  voidHost: Map<string, string>;
  spatialEntity: Map<string, string>;
}

const SPATIAL_TABLES = [
  ["sites", "IFCSITE"],
  ["buildings", "IFCBUILDING"],
  ["storeys", "IFCBUILDINGSTOREY"],
  ["spaces", "IFCSPACE"],
] as const;

/** The selection universe: the product rows, plus a row per spatial structure
 *  element so an entity facet on IFCSITE / IFCBUILDING / IFCBUILDINGSTOREY /
 *  IFCSPACE matches something. The parser keeps those in their own tables and
 *  they carry a GUID and a name only, which is why they are tagged. */
export function selectableProducts(graph: ModelGraph): ModelProduct[] {
  const out: ModelProduct[] = [...graph.products];
  // Some spatial elements — IfcSpace in particular — already have a product row.
  // Synthesizing a second one would invent duplicate GlobalIds.
  const known = new Set(out.map((p) => p.guid));
  for (const [table, entity] of SPATIAL_TABLES) {
    for (const row of graph[table] ?? []) {
      if (known.has(row.guid)) continue;
      known.add(row.guid);
      out.push({
        source: "spatial",
        guid: row.guid,
        entity,
        name: row.name,
        predefined_type: null,
        object_type: null,
        tag: null,
        storey_guid: null,
        parent_guid: null,
        type_name: null,
        typed: false,
        materials: [],
        is_external: null,
        fire_rating: null,
        load_bearing: null,
      });
    }
  }
  return out;
}

function buildRelations(graph: ModelGraph): Relations {
  const spatialEntity = new Map<string, string>();
  for (const [table, entity] of SPATIAL_TABLES) {
    for (const row of graph[table] ?? []) spatialEntity.set(row.guid, entity);
  }
  const aggregateParent = new Map(
    (graph.aggregates ?? []).map((a) => [a.child_guid, a.parent_guid]),
  );
  // The graph reports storey -> building in its own table, not in `aggregates`.
  for (const sb of graph.storey_building ?? []) {
    if (!aggregateParent.has(sb.storey_guid)) {
      aggregateParent.set(sb.storey_guid, sb.building_guid);
    }
  }
  return {
    containedIn: new Map((graph.contained_in ?? []).map((c) => [c.product_guid, c.storey_guid])),
    aggregateParent,
    voidHost: new Map((graph.voids ?? []).map((v) => [v.opening_guid, v.host_guid])),
    spatialEntity,
  };
}

function entityOfGuid(
  guid: string | undefined,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
): string | null {
  if (guid === undefined) return null;
  const product = byGuid.get(guid);
  if (product) return product.entity.toUpperCase();
  return relations.spatialEntity.get(guid) ?? null;
}

function testPartOf(
  facet: PartOfFacet,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  versions: Ruleset["ifcVersions"],
): boolean {
  let parentGuid: string | undefined;
  switch (facet.relation) {
    case undefined:
    case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
      parentGuid = relations.containedIn.get(product.guid);
      break;
    case "IFCRELAGGREGATES":
      parentGuid = relations.aggregateParent.get(product.guid) ?? product.parent_guid ?? undefined;
      break;
    case "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT":
      parentGuid = relations.voidHost.get(product.guid);
      break;
    default:
      throw new Unsupported(
        `partOf relation ${facet.relation} is not exposed by the parser; ` +
          "IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES and " +
          "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT are",
      );
  }
  const parentEntity = entityOfGuid(parentGuid, byGuid, relations);
  if (parentEntity === null) return false;
  return matchesValue(entityNameValue(facet.entity, versions), parentEntity);
}

function testClassification(_facet: ClassificationFacet): never {
  throw new Unsupported(
    "classifications are not exposed by the parser, so a classification facet " +
      "cannot be evaluated here",
  );
}

function testMaterial(facet: MaterialFacet, product: ModelProduct): boolean {
  if (product.source === "spatial") spatialOnly(product, "a material");
  const materials = product.materials ?? [];
  if (facet.value === undefined) return materials.length > 0;
  return materials.some((m) => matchesValue(facet.value as IdsValue, m));
}

function testAttribute(facet: AttributeFacet, product: ModelProduct): boolean {
  const value = readAttribute(product, attributeName(facet));
  if (facet.value === undefined) return value !== null && value !== "";
  return matchesValue(facet.value, value);
}

function testProperty(facet: PropertyFacet, product: ModelProduct): boolean {
  const value = readProperty(product, propertyBaseName(facet));
  if (facet.value === undefined) return value !== null && value !== "";
  return matchesValue(facet.value, value);
}

/** True when the element satisfies every facet in the selector. */
function selects(
  selector: Selector,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  versions: Ruleset["ifcVersions"],
): boolean {
  if (selector.entity) {
    const name = entityNameValue(selector.entity, versions);
    if (!matchesValue(name, product.entity.toUpperCase())) return false;
    if (
      selector.entity.predefinedType !== undefined &&
      !matchesValue(selector.entity.predefinedType, product.predefined_type)
    ) {
      return false;
    }
  }
  for (const facet of selector.partOf ?? []) {
    if (!testPartOf(facet, product, byGuid, relations, versions)) return false;
  }
  for (const facet of selector.classification ?? []) testClassification(facet);
  for (const facet of selector.attribute ?? []) {
    if (!testAttribute(facet, product)) return false;
  }
  for (const facet of selector.property ?? []) {
    if (!testProperty(facet, product)) return false;
  }
  for (const facet of selector.material ?? []) {
    if (!testMaterial(facet, product)) return false;
  }
  return true;
}

/* ------------------------------------------------------------ requirements */

/** Facet cardinality, applied uniformly: `required` must match, `prohibited`
 *  must not, `optional` passes when the value is absent but fails when it is
 *  present and wrong. */
function applyCardinality(
  matched: boolean,
  present: boolean,
  cardinality: string | undefined,
): boolean {
  switch (cardinality ?? "required") {
    case "prohibited":
      return !matched;
    case "optional":
      return !present || matched;
    default:
      return matched;
  }
}

function requirementFailures(
  req: Requirements,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  versions: Ruleset["ifcVersions"],
): string[] {
  const reasons: string[] = [];

  if (req.entity) {
    const name = entityNameValue(req.entity, versions);
    if (!matchesValue(name, product.entity.toUpperCase())) {
      reasons.push(`class ${product.entity} does not satisfy the required entity`);
    } else if (
      req.entity.predefinedType !== undefined &&
      !matchesValue(req.entity.predefinedType, product.predefined_type)
    ) {
      reasons.push(
        `PredefinedType ${product.predefined_type ?? "(none)"} does not satisfy ` +
          literal(req.entity.predefinedType),
      );
    }
  }

  for (const facet of req.partOf ?? []) {
    const matched = testPartOf(facet, product, byGuid, relations, versions);
    if (!applyCardinality(matched, matched, facet.cardinality)) {
      reasons.push(
        `partOf ${facet.relation ?? "IFCRELCONTAINEDINSPATIALSTRUCTURE"} ` +
          (facet.cardinality === "prohibited" ? "is present but prohibited" : "not satisfied"),
      );
    }
  }

  for (const facet of req.classification ?? []) testClassification(facet);

  for (const facet of req.attribute ?? []) {
    const name = attributeName(facet);
    const value = readAttribute(product, name);
    const present = value !== null && value !== "";
    const matched = testAttribute(facet, product);
    if (!applyCardinality(matched, present, facet.cardinality)) {
      reasons.push(
        facet.cardinality === "prohibited"
          ? `${name} is present but prohibited`
          : `${name} is ${present ? `"${value}"` : "empty"}` +
            (facet.value ? `, required ${literal(facet.value)}` : ", required non-empty"),
      );
    }
  }

  for (const facet of req.property ?? []) {
    const baseName = propertyBaseName(facet);
    const value = readProperty(product, baseName);
    const present = value !== null && value !== "";
    const matched = testProperty(facet, product);
    if (!applyCardinality(matched, present, facet.cardinality)) {
      reasons.push(
        facet.cardinality === "prohibited"
          ? `${baseName} is present but prohibited`
          : `${baseName} is ${present ? `"${value}"` : "absent"}` +
            (facet.value ? `, required ${literal(facet.value)}` : ", required present"),
      );
    }
  }

  for (const facet of req.material ?? []) {
    const present = (product.materials ?? []).length > 0;
    const matched = testMaterial(facet, product);
    if (!applyCardinality(matched, present, facet.cardinality)) {
      reasons.push(
        facet.cardinality === "prohibited"
          ? "material is present but prohibited"
          : `material ${present ? (product.materials ?? []).join(", ") : "absent"} does not satisfy the requirement`,
      );
    }
  }

  return reasons;
}

/** Does the ruleset touch a property facet? Then the propertySet name was not
 *  verified, and the result says so rather than implying it was. */
function propertyNote(rule: Rule): string | null {
  const bags: (Selector | Requirements | undefined)[] =
    rule.kind === "ids" ? [rule.applicability, rule.requirements] : [rule.select];
  for (const bag of bags) {
    if (bag?.property?.length) {
      return (
        "property matched on base name only: the parser exposes IsExternal, " +
        "FireRating and LoadBearing flattened, so the property set name was not verified"
      );
    }
  }
  return null;
}

/* ------------------------------------------------------------- evaluation */

function cap(findings: Finding[], maxFindings: number): Finding[] {
  return maxFindings > 0 ? findings.slice(0, maxFindings) : findings;
}

function evaluateRule(
  rule: Rule,
  products: ModelProduct[],
  summary: ModelSummary,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  ruleset: Ruleset,
  maxFindings: number,
): RuleResult {
  const base = {
    ruleId: rule.id,
    ruleName: rule.name,
    kind: rule.kind,
  } as const;
  const notes: string[] = [];
  const note = propertyNote(rule);
  if (note) notes.push(note);

  const notEvaluable = (reason: string): RuleResult => ({
    ...base,
    state: "not_evaluable",
    applicable: 0,
    failed: 0,
    findings: [],
    detail: "not evaluated",
    reason,
  });

  try {
    if (rule.kind === "extended" && rule.check.type === "model-metadata") {
      const field = rule.check.field;
      const raw = (summary as unknown as Record<string, unknown>)[field];
      const value = raw === null || raw === undefined ? null : String(raw);
      const ok = matchesValue(rule.check.value, value);
      return {
        ...base,
        state: ok ? "pass" : "fail",
        applicable: 1,
        failed: ok ? 0 : 1,
        findings: ok
          ? []
          : [
              {
                guid: "-",
                entity: "model",
                name: field,
                reason: `${field} is ${value === null ? "(none)" : `"${value}"`}, required ${literal(rule.check.value)}`,
              },
            ],
        detail: `${field} = ${value === null ? "(none)" : value}`,
        notes: notes.length ? notes : undefined,
      };
    }

    const selector: Selector =
      rule.kind === "ids" ? rule.applicability : (rule.select ?? {});
    const applicable = products.filter((p) =>
      selects(selector, p, byGuid, relations, ruleset.ifcVersions),
    );

    if (rule.kind === "ids") {
      const { minOccurs, maxOccurs } = rule.applicability;
      const boundFindings: Finding[] = [];
      if (minOccurs !== undefined && applicable.length < minOccurs) {
        boundFindings.push({
          guid: "-",
          entity: "model",
          name: rule.id,
          reason: `${applicable.length} applicable entities, minOccurs is ${minOccurs}`,
        });
      }
      if (
        maxOccurs !== undefined &&
        maxOccurs !== "unbounded" &&
        applicable.length > maxOccurs
      ) {
        boundFindings.push({
          guid: "-",
          entity: "model",
          name: rule.id,
          reason: `${applicable.length} applicable entities, maxOccurs is ${maxOccurs}`,
        });
      }
      if (applicable.length === 0 && boundFindings.length === 0) {
        return {
          ...base,
          state: "not_applicable",
          applicable: 0,
          failed: 0,
          findings: [],
          detail: "no entity matched the applicability",
          notes: notes.length ? notes : undefined,
        };
      }
      const elementFindings: Finding[] = [];
      if (rule.requirements) {
        for (const product of applicable) {
          const reasons = requirementFailures(
            rule.requirements,
            product,
            byGuid,
            relations,
            ruleset.ifcVersions,
          );
          if (reasons.length > 0) {
            elementFindings.push({
              guid: product.guid,
              entity: product.entity,
              name: product.name,
              reason: reasons.join("; "),
            });
          }
        }
      }
      const findings = [...boundFindings, ...elementFindings];
      const detail =
        boundFindings.length > 0
          ? boundFindings.map((f) => f.reason).join("; ")
          : `${applicable.length - elementFindings.length} of ${applicable.length} applicable entities satisfy the requirements`;
      return {
        ...base,
        state: findings.length === 0 ? "pass" : "fail",
        applicable: applicable.length,
        failed: findings.length,
        findings: cap(findings, maxFindings),
        detail,
        notes: notes.length ? notes : undefined,
      };
    }

    if (applicable.length === 0) {
      return {
        ...base,
        state: "not_applicable",
        applicable: 0,
        failed: 0,
        findings: [],
        detail: "no entity matched the selection",
        notes: notes.length ? notes : undefined,
      };
    }

    const check = rule.check;
    const spatial = applicable.find((p) => p.source === "spatial");

    if (check.type === "element-typed") {
      if (spatial) spatialOnly(spatial, "type linkage");
      const findings = applicable
        .filter((p) => !p.typed)
        .map((p) => ({
          guid: p.guid,
          entity: p.entity,
          name: p.name,
          reason: "no type object",
        }));
      return {
        ...base,
        state: findings.length === 0 ? "pass" : "fail",
        applicable: applicable.length,
        failed: findings.length,
        findings: cap(findings, maxFindings),
        detail: `${applicable.length - findings.length} of ${applicable.length} elements are linked to a type`,
        notes: notes.length ? notes : undefined,
      };
    }

    if (check.type === "unique-attribute") {
      const ignoreEmpty = check.ignoreEmpty !== false;
      const scope = check.scope ?? "model";
      const buckets = new Map<string, ModelProduct[]>();
      for (const product of applicable) {
        const value = readAttribute(product, check.attribute);
        if (ignoreEmpty && (value === null || value === "")) continue;
        const key = `${scope === "class" ? product.entity.toUpperCase() : ""} ${value ?? ""}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(product);
        else buckets.set(key, [product]);
      }
      const findings: Finding[] = [];
      for (const [key, bucket] of buckets) {
        if (bucket.length < 2) continue;
        const value = key.split(" ")[1];
        for (const product of bucket) {
          findings.push({
            guid: product.guid,
            entity: product.entity,
            name: product.name,
            reason: `${check.attribute} "${value}" shared by ${bucket.length} elements`,
          });
        }
      }
      return {
        ...base,
        state: findings.length === 0 ? "pass" : "fail",
        applicable: applicable.length,
        failed: findings.length,
        findings: cap(findings, maxFindings),
        detail: `${buckets.size} distinct ${check.attribute} values over ${applicable.length} elements`,
        notes: notes.length ? notes : undefined,
      };
    }

    if (check.type === "type-usage-count") {
      if (spatial) spatialOnly(spatial, "type linkage");
      const counts = new Map<string, ModelProduct[]>();
      for (const product of applicable) {
        const key = product.type_name ?? "";
        if (key === "") continue;
        const bucket = counts.get(key);
        if (bucket) bucket.push(product);
        else counts.set(key, [product]);
      }
      const findings: Finding[] = [];
      for (const [typeName, bucket] of counts) {
        const low = check.min !== undefined && bucket.length < check.min;
        const high = check.max !== undefined && bucket.length > check.max;
        if (!low && !high) continue;
        for (const product of bucket) {
          findings.push({
            guid: product.guid,
            entity: product.entity,
            name: product.name,
            reason: `type "${typeName}" is used by ${bucket.length} element(s), ` +
              (low ? `minimum ${check.min}` : `maximum ${check.max}`),
          });
        }
      }
      return {
        ...base,
        state: findings.length === 0 ? "pass" : "fail",
        applicable: applicable.length,
        failed: findings.length,
        findings: cap(findings, maxFindings),
        detail: `${counts.size} distinct type names over ${applicable.length} elements`,
        notes: notes.length ? notes : undefined,
      };
    }

    return notEvaluable(`unknown extended check "${(check as { type: string }).type}"`);
  } catch (error) {
    if (error instanceof Unsupported) return notEvaluable(error.message);
    throw error;
  }
}

export function evaluateRuleset(
  ruleset: Ruleset,
  graph: ModelGraph,
  summary: ModelSummary,
  modelName: string,
  options: EvaluateOptions = {},
): ModelResult {
  const maxFindings = options.maxFindings ?? 0;
  const products = selectableProducts(graph);
  const byGuid = new Map(products.map((p) => [p.guid, p]));
  const relations = buildRelations(graph);
  const results = ruleset.rules
    .filter(isEnabled)
    .map((rule) =>
      evaluateRule(rule, products, summary, byGuid, relations, ruleset, maxFindings),
    );
  const counts: Record<ResultState, number> = {
    pass: 0,
    fail: 0,
    not_applicable: 0,
    not_evaluable: 0,
  };
  for (const result of results) counts[result.state] += 1;
  return {
    model: modelName,
    schema: summary.schema,
    products: summary.products,
    results,
    counts,
  };
}
