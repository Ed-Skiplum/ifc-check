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
import { isBooleanValues } from "./lint.ts";
import { CODE_LISTS, CODE_LIST_IDS, type CodeList } from "../codelists/index.ts";
import type { ModelGraph, ModelProduct, ModelSummary } from "./model.ts";
import type {
  AttributeFacet,
  CodeLookupCheck,
  ClassificationFacet,
  ExtendedRule,
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
  /** Set when the finding is about a type object: the GlobalIds of the
   *  elements that use it, so a filter on the finding reaches the model. */
  members?: string[];
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
  /** GlobalIds the copy-object mapping identified as reference/copy objects
   *  and excluded from every other rule's selection. Absent when the ruleset
   *  carries no enabled copy-object mapping; present (possibly empty) when it
   *  does, whether or not the mapping itself was evaluable — fundamentals
   *  should exclude the same set. */
  excludedGuids?: string[];
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

/* ------------------------------------------------------------ code lookup */

/** One thing a code-lookup rule reads a value from: an element, or a type
 *  object together with the elements that use it. */
interface CodeSubject {
  guid: string;
  entity: string;
  name: string | null;
  value: string | null;
  members?: string[];
}

/** A compiled `extract` pattern. Exactly one capture group, or the rule cannot
 *  say which part of the match is the code. */
export function compileExtract(pattern: string): RegExp {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Unsupported(`extract "${pattern}" is not a valid regular expression`);
  }
  // An alternation with the empty pattern always matches "", and the match
  // array then has one slot per capture group in `pattern`.
  const groups = (new RegExp(`${pattern}|`).exec("")?.length ?? 1) - 1;
  if (groups !== 1) {
    throw new Unsupported(
      `extract "${pattern}" has ${groups} capture groups; it needs exactly one`,
    );
  }
  return regex;
}

const TYPE_CLASS = /(TYPE|STYLE)$/;

/** The types of the selected elements, one subject per type Name.
 *
 * The parser exposes a type object only through the product rows that use it:
 * `typed` plus the type's Name. It carries no type GlobalId, no type class and
 * no row for a type nothing uses (ifcfast's `typesJson()` roster is no way
 * round this: its `guid` is a representative OCCURRENCE's GlobalId, not the
 * type's). So a type subject is keyed by Name, its finding carries "-" for a
 * GlobalId it cannot know, and `members` carries the elements. Two type objects
 * sharing one Name are one subject, which gives the same verdict for a
 * Name-based lookup. Typed elements whose type has no Name form one subject. */
function typeSubjects(
  select: Selector,
  products: ModelProduct[],
  attribute: string,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  versions: Ruleset["ifcVersions"],
): CodeSubject[] {
  if (attribute !== "Name") {
    throw new Unsupported(
      `attribute ${attribute} is not exposed for type objects; the parser carries a ` +
        "type's Name only, on the elements that use it",
    );
  }
  const entity = select.entity;
  if (
    entity &&
    (entity.group === "elementType" ||
      entity.group === "typeProduct" ||
      (entity.classes ?? []).some((c) => TYPE_CLASS.test(c.toUpperCase())))
  ) {
    throw new Unsupported(
      "the type object's own class (e.g. IFCWALLTYPE) is not exposed by the parser; " +
        "select types by the class of the elements that use them (e.g. IFCWALL)",
    );
  }
  const groups = new Map<string, ModelProduct[]>();
  for (const product of products) {
    if (product.source === "spatial" || !product.typed) continue;
    if (!selects(select, product, byGuid, relations, versions)) continue;
    const key = product.type_name ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(product);
    else groups.set(key, [product]);
  }
  return [...groups].map(([typeName, members]) => ({
    guid: "-",
    entity: [...new Set(members.map((m) => m.entity))].join(", "),
    name: typeName === "" ? null : typeName,
    value: typeName === "" ? null : typeName,
    members: members.map((m) => m.guid),
  }));
}

/** What a code-lookup checks codes against: a bundled list, or the project's
 *  own `values`. One code path for both, so the findings read the same. */
function resolveLookup(check: CodeLookupCheck): { label: string; has: (code: string) => boolean } {
  if (check.values !== undefined) {
    const allowed = new Set(check.values);
    return { label: `the allowed values (${check.values.join(", ")})`, has: (c) => allowed.has(c) };
  }
  const list =
    check.list === undefined
      ? undefined
      : (CODE_LISTS as Record<string, CodeList | undefined>)[check.list];
  if (!list) {
    throw new Unsupported(
      `code list "${String(check.list)}" is not bundled; bundled lists are ${CODE_LIST_IDS.join(", ")}`,
    );
  }
  return { label: list.meta.label, has: (c) => Object.hasOwn(list.codes, c) };
}

function codeLookup(
  check: CodeLookupCheck,
  select: Selector,
  products: ModelProduct[],
  summary: ModelSummary,
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  ruleset: Ruleset,
  notes: string[],
  maxFindings: number,
): Omit<RuleResult, "ruleId" | "ruleName" | "kind"> {
  const lookup = resolveLookup(check);
  const source = check.source;
  if ("property" in source) {
    throw new Unsupported(
      "property values are parsed but have no accessor in the wasm build " +
        "(ifcfast#183), so a property source cannot be evaluated here",
    );
  }
  if ("classification" in source) {
    throw new Unsupported(
      "classification references are parsed but have no accessor in the wasm build " +
        "(ifcfast#183), so a classification source cannot be evaluated here",
    );
  }
  const attribute = source.attribute;
  const regex = compileExtract(check.extract);
  const target = check.target ?? "occurrence";

  let subjects: CodeSubject[];
  if (target === "type") {
    subjects = typeSubjects(select, products, attribute, byGuid, relations, ruleset.ifcVersions);
    const declared = summary.tables?.type_objects?.rows;
    notes.push(
      `${subjects.length} type names reached through the selected elements` +
        (declared === undefined ? "" : `; the file declares ${declared} type objects`) +
        ". A type no element uses is not exposed by the parser",
    );
  } else {
    subjects = products
      .filter((p) => selects(select, p, byGuid, relations, ruleset.ifcVersions))
      .map((p) => ({
        guid: p.guid,
        entity: p.entity,
        name: p.name,
        value: readAttribute(p, attribute),
      }));
  }
  const noun = target === "type" ? "types" : "elements";

  if (subjects.length === 0) {
    return {
      state: "not_applicable",
      applicable: 0,
      failed: 0,
      findings: [],
      detail: `no ${noun} matched the selection`,
      notes: notes.length ? notes : undefined,
    };
  }

  const label = lookup.label;
  let missing = 0;
  let noMatch = 0;
  let unknown = 0;
  const findings: Finding[] = [];
  for (const subject of subjects) {
    const value = subject.value;
    let reason: string | null = null;
    if (value === null || value === "") {
      missing += 1;
      reason = `${attribute} is empty`;
    } else {
      const code = regex.exec(value)?.[1];
      if (code === undefined || code === "") {
        noMatch += 1;
        reason = `${attribute} "${value}" does not match ${check.extract}`;
      } else if (!lookup.has(code)) {
        unknown += 1;
        reason = `code "${code}" from ${attribute} "${value}" is not in ${label}`;
      }
    }
    if (reason === null) continue;
    const finding: Finding = {
      guid: subject.guid,
      entity: subject.entity,
      name: subject.name,
      reason,
    };
    if (subject.members) finding.members = subject.members;
    findings.push(finding);
  }

  return {
    state: findings.length === 0 ? "pass" : "fail",
    applicable: subjects.length,
    failed: findings.length,
    findings: cap(findings, maxFindings),
    detail:
      `${subjects.length - findings.length} of ${subjects.length} ${noun} carry a code from ` +
      `${label}; ${missing} empty, ${noMatch} no match, ${unknown} not in the list`,
    notes: notes.length ? notes : undefined,
  };
}

/* ------------------------------------------------------- reference objects */

/** The copy-object mapping is a SCOPE FILTER, not a data-quality check: an
 *  object whose mapped value matches is a reference/copy object and is
 *  excluded from every other rule's selection, fundamentals included. A
 *  missing or empty value is an ordinary, in-scope object — never a finding.
 *  `extract` not matching the value is the same: the object stays in scope
 *  rather than failing anything, because this rule no longer reports on data
 *  quality.
 *
 *  Two value modes, both stored as `values` (see `isBooleanValues`):
 *    boolean  a Ja/Nei flag. "true" is a reference; "false" is an ordinary
 *             object saying so explicitly, not a second reference value.
 *    codes    the project's own discipline codes (POFIN's
 *             `NONS_Process.DuplicateOwnedBy`). Any of them is a reference —
 *             there is no "opposite" value in this mode.
 *
 *  Only an attribute source is evaluable, same boundary as `codeLookup`
 *  (ifcfast#183); a property or classification source throws `Unsupported`,
 *  caught by the caller and turned into `not_evaluable`. */
function identifyReferenceObjects(
  rule: ExtendedRule,
  allProducts: ModelProduct[],
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
  ruleset: Ruleset,
): { excluded: Set<string>; candidates: number } {
  const check = rule.check;
  if (check.type !== "code-lookup") {
    throw new Unsupported(
      `mapping copy-object needs a code-lookup check, not ${check.type}`,
    );
  }
  if (check.target === "type") {
    throw new Unsupported(
      "copy-object applies to occurrences, not types; target must be omitted or occurrence",
    );
  }
  const source = check.source;
  if ("property" in source) {
    throw new Unsupported(
      "property values are parsed but have no accessor in the wasm build " +
        "(ifcfast#183), so a property source cannot be evaluated here",
    );
  }
  if ("classification" in source) {
    throw new Unsupported(
      "classification references are parsed but have no accessor in the wasm build " +
        "(ifcfast#183), so a classification source cannot be evaluated here",
    );
  }
  const attribute = source.attribute;
  const regex = compileExtract(check.extract);
  const values = check.values ?? [];
  // Boolean mode reads a Ja/Nei flag: "true" is a reference, "false" is an
  // ordinary object saying so explicitly, not a second reference value. Codes
  // mode has no such opposite — any of the project's own codes is a match.
  const boolMode = isBooleanValues(values);
  const allowed = new Set(values);
  const isReference = (code: string) => (boolMode ? code === "true" : allowed.has(code));
  const select = rule.select ?? {};
  const candidates = allProducts.filter((p) =>
    selects(select, p, byGuid, relations, ruleset.ifcVersions),
  );
  const excluded = new Set<string>();
  for (const product of candidates) {
    const value = readAttribute(product, attribute);
    if (value === null || value === "") continue;
    const code = regex.exec(value)?.[1];
    if (code === undefined || code === "") continue;
    if (isReference(code)) excluded.add(product.guid);
  }
  return { excluded, candidates: candidates.length };
}

/** Runs the copy-object mapping (if any, and enabled) and returns both the
 *  GlobalIds to exclude from every other rule and the mapping's own result: a
 *  count, never a finding. A source that cannot be evaluated excludes nothing
 *  and says so plainly, on the rule itself and in a note — never silently. */
function copyObjectFilter(
  ruleset: Ruleset,
  allProducts: ModelProduct[],
  byGuid: Map<string, ModelProduct>,
  relations: Relations,
): { rule: ExtendedRule; excluded: Set<string>; result: RuleResult } | null {
  const rule = ruleset.rules.find(
    (r): r is ExtendedRule => r.kind === "extended" && r.mapping === "copy-object",
  );
  if (!rule || !isEnabled(rule)) return null;

  const base = { ruleId: rule.id, ruleName: rule.name, kind: rule.kind } as const;
  try {
    const { excluded, candidates } = identifyReferenceObjects(
      rule,
      allProducts,
      byGuid,
      relations,
      ruleset,
    );
    return {
      rule,
      excluded,
      result: {
        ...base,
        state: "pass",
        applicable: candidates,
        failed: 0,
        findings: [],
        detail: `${excluded.size} of ${candidates} objects excluded as reference objects`,
      },
    };
  } catch (error) {
    if (error instanceof Unsupported) {
      return {
        rule,
        excluded: new Set(),
        result: {
          ...base,
          state: "not_evaluable",
          applicable: 0,
          failed: 0,
          findings: [],
          detail: "not evaluated",
          reason: error.message,
          notes: ["reference objects could not be excluded from other rules' findings"],
        },
      };
    }
    throw error;
  }
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

    if (rule.kind === "extended" && rule.check.type === "code-lookup") {
      return {
        ...base,
        ...codeLookup(
          rule.check,
          rule.select ?? {},
          products,
          summary,
          byGuid,
          relations,
          ruleset,
          notes,
          maxFindings,
        ),
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
  // The full, unfiltered universe: the copy-object mapping identifies
  // reference objects from it, and byGuid/relations resolve partOf lookups
  // even when the other end is a reference object.
  const allProducts = selectableProducts(graph);
  const byGuid = new Map(allProducts.map((p) => [p.guid, p]));
  const relations = buildRelations(graph);

  const filter = copyObjectFilter(ruleset, allProducts, byGuid, relations);
  const products =
    filter && filter.excluded.size > 0
      ? allProducts.filter((p) => !filter.excluded.has(p.guid))
      : allProducts;

  const results = ruleset.rules
    .filter(isEnabled)
    .map((rule) =>
      filter && rule === filter.rule
        ? filter.result
        : evaluateRule(rule, products, summary, byGuid, relations, ruleset, maxFindings),
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
    excludedGuids: filter ? [...filter.excluded] : undefined,
  };
}
