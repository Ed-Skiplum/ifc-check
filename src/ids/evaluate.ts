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
 *   type linkage, every property set (by SET plus NAME, not base name), and
 *   every classification reference.
 * Not evaluable here: IFCRELNESTS, IFCRELASSIGNSTOGROUP, any attribute outside
 *   the list above, and a facet whose own name is a restriction.
 *
 * Property sets and classifications do not come out of `graphJson()`: the
 * caller attaches `psetsJson()` and `classificationsJson()` to the graph
 * (`ModelGraph.psets` / `.classifications`). A caller that does not is told so
 * — the facet is `not_evaluable` naming the missing table, never a pass.
 */

import { entityNameValue } from "./emit.ts";
import { isEnabled } from "./export.ts";
import { isBooleanValues } from "./lint.ts";
import { CODE_LISTS, CODE_LIST_IDS, type CodeList } from "../codelists/index.ts";
import type {
  ModelClassification,
  ModelGraph,
  ModelProduct,
  ModelProperty,
  ModelSummary,
} from "./model.ts";
import type {
  AttributeFacet,
  CodeLookupCheck,
  ClassificationFacet,
  CodeSource,
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

/** The property rows of one object that satisfy a facet's SET and NAME.
 *
 * Identity is (property set, property name), never the name alone: two sets may
 * both carry `Status` and mean different things, and matching the base name on
 * its own is how a rule quietly reads the wrong one. Both halves are ordinary
 * `IdsValue`s, so a restriction on either side works — `Pset_.*Common` and a
 * literal name is a legal, and useful, facet.
 *
 * The table covers spatial structure elements and the project as readily as
 * products, so nothing here refuses a `spatial` row: KNM_RIB carries 231 of its
 * 337 property rows on the site, the building and the storeys.
 */
function propertyRows(
  index: ModelIndex,
  product: ModelProduct,
  facet: PropertyFacet,
): ModelProperty[] {
  if (index.properties === null) {
    throw new Unsupported(
      "no property table was supplied with this graph; the caller must attach " +
        "psetsJson() to it before a property facet can be evaluated",
    );
  }
  const rows = index.properties.get(product.guid) ?? [];
  return rows.filter(
    (row) =>
      matchesValue(facet.propertySet, row.pset_name) && matchesValue(facet.baseName, row.prop_name),
  );
}

/** The classification references of one object in the facet's system. */
function classificationRows(
  index: ModelIndex,
  product: ModelProduct,
  system: IdsValue | undefined,
): ModelClassification[] {
  if (index.classifications === null) {
    throw new Unsupported(
      "no classification table was supplied with this graph; the caller must " +
        "attach classificationsJson() to it before a classification facet can be evaluated",
    );
  }
  const rows = index.classifications.get(product.guid) ?? [];
  if (system === undefined) return rows;
  return rows.filter((row) => matchesValue(system, row.system_name));
}

/** A property row counts as PRESENT when it carries a non-empty value. A row
 *  with `value: ""` exists in the file and says nothing, which is the state
 *  `optional` cardinality is about. */
function present(rows: ModelProperty[]): boolean {
  return rows.some((row) => row.value !== null && row.value !== "");
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

/** How a property facet reads on a finding: `Pset_WallCommon.IsExternal`, or
 *  `<restriction>` on the side that is one. */
function propertyLabel(facet: PropertyFacet): string {
  return `${literal(facet.propertySet)}.${literal(facet.baseName)}`;
}

/* ------------------------------------------------------------ facet tests */

/** Everything a facet test looks up that is not on the product row itself.
 *
 * The relation maps, plus the two long tables. Both tables are keyed by the
 * OWNER's GlobalId, which may be a product, a spatial structure element or the
 * project — joining them onto the product rows alone silently drops the rest,
 * and a check whose subject vanished reports a clean pass over nothing.
 *
 * `null` on a table is "the caller supplied none", which is not the same claim
 * as an empty map and never collapses into it: the first makes a facet
 * `not_evaluable`, the second lets it fail honestly.
 */
interface ModelIndex {
  containedIn: Map<string, string>;
  aggregateParent: Map<string, string>;
  voidHost: Map<string, string>;
  spatialEntity: Map<string, string>;
  properties: Map<string, ModelProperty[]> | null;
  classifications: Map<string, ModelClassification[]> | null;
}

function groupByGuid<T extends { guid: string }>(rows: T[] | undefined): Map<string, T[]> | null {
  if (rows === undefined) return null;
  const byGuid = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byGuid.get(row.guid);
    if (bucket) bucket.push(row);
    else byGuid.set(row.guid, [row]);
  }
  return byGuid;
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

function buildIndex(graph: ModelGraph): ModelIndex {
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
    properties: groupByGuid(graph.psets),
    classifications: groupByGuid(graph.classifications),
  };
}

function entityOfGuid(
  guid: string | undefined,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
): string | null {
  if (guid === undefined) return null;
  const product = byGuid.get(guid);
  if (product) return product.entity.toUpperCase();
  return index.spatialEntity.get(guid) ?? null;
}

function testPartOf(
  facet: PartOfFacet,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
  versions: Ruleset["ifcVersions"],
): boolean {
  let parentGuid: string | undefined;
  switch (facet.relation) {
    case undefined:
    case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
      parentGuid = index.containedIn.get(product.guid);
      break;
    case "IFCRELAGGREGATES":
      parentGuid = index.aggregateParent.get(product.guid) ?? product.parent_guid ?? undefined;
      break;
    case "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT":
      parentGuid = index.voidHost.get(product.guid);
      break;
    default:
      throw new Unsupported(
        `partOf relation ${facet.relation} is not exposed by the parser; ` +
          "IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES and " +
          "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT are",
      );
  }
  const parentEntity = entityOfGuid(parentGuid, byGuid, index);
  if (parentEntity === null) return false;
  return matchesValue(entityNameValue(facet.entity, versions), parentEntity);
}

/** A classification facet: the object must carry a reference in the named
 *  SYSTEM, and — when the facet names one — a matching code.
 *
 *  The code compared is `identification`, which ifcfast normalises across
 *  schemas: IFC4's `IfcClassificationReference.Identification` and IFC2x3's
 *  `.ItemReference` both land in that one column, so nothing here branches on
 *  the file's schema and a rule written once runs on both. */
function testClassification(
  facet: ClassificationFacet,
  product: ModelProduct,
  index: ModelIndex,
): boolean {
  const rows = classificationRows(index, product, facet.system);
  if (facet.value === undefined) return rows.length > 0;
  return rows.some((row) => matchesValue(facet.value as IdsValue, row.identification));
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

function testProperty(facet: PropertyFacet, product: ModelProduct, index: ModelIndex): boolean {
  let rows = propertyRows(index, product, facet);
  // `dataType` names the IFC measure the value must be written as. ifcfast
  // reports it in its own title case (`IfcText`) and IDS writes it uppercase
  // (`IFCTEXT`), so the comparison is case-insensitive — never a literal one.
  if (facet.dataType !== undefined) {
    const wanted = facet.dataType.toUpperCase();
    rows = rows.filter((row) => (row.value_type ?? "").toUpperCase() === wanted);
  }
  if (facet.value === undefined) return present(rows);
  return rows.some((row) => matchesValue(facet.value as IdsValue, row.value));
}

/** True when the element satisfies every facet in the selector. */
function selects(
  selector: Selector,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
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
    if (!testPartOf(facet, product, byGuid, index, versions)) return false;
  }
  for (const facet of selector.classification ?? []) {
    if (!testClassification(facet, product, index)) return false;
  }
  for (const facet of selector.attribute ?? []) {
    if (!testAttribute(facet, product)) return false;
  }
  for (const facet of selector.property ?? []) {
    if (!testProperty(facet, product, index)) return false;
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
  index: ModelIndex,
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
    const matched = testPartOf(facet, product, byGuid, index, versions);
    if (!applyCardinality(matched, matched, facet.cardinality)) {
      reasons.push(
        `partOf ${facet.relation ?? "IFCRELCONTAINEDINSPATIALSTRUCTURE"} ` +
          (facet.cardinality === "prohibited" ? "is present but prohibited" : "not satisfied"),
      );
    }
  }

  for (const facet of req.classification ?? []) {
    const rows = classificationRows(index, product, facet.system);
    const matched = testClassification(facet, product, index);
    if (!applyCardinality(matched, rows.length > 0, facet.cardinality)) {
      const carried = rows.map((r) => r.identification ?? "(no code)").join(", ");
      reasons.push(
        facet.cardinality === "prohibited"
          ? `classification ${literal(facet.system)} is present but prohibited`
          : rows.length === 0
            ? `no classification in ${literal(facet.system)}`
            : `classification ${literal(facet.system)} is ${carried}` +
              (facet.value ? `, required ${literal(facet.value)}` : ""),
      );
    }
  }

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
    const label = propertyLabel(facet);
    const rows = propertyRows(index, product, facet);
    const has = present(rows);
    const matched = testProperty(facet, product, index);
    if (!applyCardinality(matched, has, facet.cardinality)) {
      const carried = rows
        .filter((row) => row.value !== null && row.value !== "")
        .map((row) => `"${row.value}"`)
        .join(", ");
      // A property row that EXISTS and carries "" is a third state, and it is
      // the common one on a real export: the exporter wrote the property and
      // left it blank. Calling that "absent" would send someone looking for a
      // missing property set that is right there.
      const state = has ? carried : rows.length > 0 ? "present but empty" : "absent";
      reasons.push(
        facet.cardinality === "prohibited"
          ? `${label} is present but prohibited`
          : `${label} is ${state}` +
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

/* The base-name caveat is gone. Until ifcfast 0.5.3 a property facet was matched
 * against three flattened columns with the set name unverified, and every result
 * carried a note saying so. `psetsJson()` now supplies (set, name, value) rows,
 * so a facet is matched on the pair that actually identifies a property and
 * there is nothing left to qualify. */

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
  source: CodeSource,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
  versions: Ruleset["ifcVersions"],
): CodeSubject[] {
  if (!("attribute" in source)) {
    // A property or classification row is keyed by the object that CARRIES it,
    // and ifcfast folds a type's own properties onto the occurrences that
    // inherit them (`source: "type"`, the occurrence's guid). Measured on the
    // KNM export: not one property row of 7 157 is keyed by a type object's
    // GlobalId. So there is nothing to read per type, and saying so beats
    // reading an occurrence's value and calling it the type's.
    throw new Unsupported(
      "a type object's own property sets and classifications are not keyed by " +
        "the type in the parsed tables (they arrive on the occurrences that " +
        "inherit them), so target 'type' reads an attribute",
    );
  }
  const attribute = source.attribute;
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
    if (!selects(select, product, byGuid, index, versions)) continue;
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

/** The value a code-lookup reads off ONE object, whatever the source is.
 *
 * All three sources answer with one value per object, because the check is
 * "this object carries a code from that list" and a subject with two answers is
 * a subject the finding cannot name. An attribute is single-valued by
 * construction; a property is identified by (set, name) and so is single-valued
 * in practice; a classification is not — an element may carry several
 * references in one system.
 *
 * So `extra` counts the additional DISTINCT values that were not read. The rule
 * reports it as a note over the whole selection rather than picking silently:
 * the value used is the first in file order, and how many objects had more is
 * on the result. A source that cannot be reached at all throws `Unsupported`
 * and the rule is `not_evaluable`, never a pass.
 */
function codeValue(
  source: CodeSource,
  product: ModelProduct,
  index: ModelIndex,
): { value: string | null; extra: number } {
  if ("attribute" in source) {
    return { value: readAttribute(product, source.attribute), extra: 0 };
  }
  const values: string[] = [];
  if ("property" in source) {
    const rows = propertyRows(index, product, {
      propertySet: source.property.propertySet,
      baseName: source.property.name,
    });
    for (const row of rows) {
      if (row.value !== null && row.value !== "" && !values.includes(row.value)) {
        values.push(row.value);
      }
    }
  } else {
    const rows = classificationRows(index, product, source.classification.system);
    for (const row of rows) {
      const code = row.identification;
      if (code !== null && code !== "" && !values.includes(code)) values.push(code);
    }
  }
  return { value: values[0] ?? null, extra: Math.max(0, values.length - 1) };
}

/** How a code-lookup's source reads on a finding: the attribute name, the
 *  qualified property, or the classification system. */
function sourceLabel(source: CodeSource): string {
  if ("attribute" in source) return source.attribute;
  if ("property" in source) return `${source.property.propertySet}.${source.property.name}`;
  const system = source.classification.system;
  return system === undefined ? "classification" : `classification ${literal(system)}`;
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
  index: ModelIndex,
  ruleset: Ruleset,
  notes: string[],
  maxFindings: number,
): Omit<RuleResult, "ruleId" | "ruleName" | "kind"> {
  const lookup = resolveLookup(check);
  const source = check.source;
  const label = sourceLabel(source);
  const regex = compileExtract(check.extract);
  const target = check.target ?? "occurrence";

  let subjects: CodeSubject[];
  let extras = 0;
  if (target === "type") {
    subjects = typeSubjects(select, products, source, byGuid, index, ruleset.ifcVersions);
    const declared = summary.tables?.type_objects?.rows;
    notes.push(
      `${subjects.length} type names reached through the selected elements` +
        (declared === undefined ? "" : `; the file declares ${declared} type objects`) +
        ". A type object's Name is reached through the elements that use it",
    );
  } else {
    subjects = products
      .filter((p) => selects(select, p, byGuid, index, ruleset.ifcVersions))
      .map((p) => {
        const read = codeValue(source, p, index);
        if (read.extra > 0) extras += 1;
        return { guid: p.guid, entity: p.entity, name: p.name, value: read.value };
      });
    if (extras > 0) {
      notes.push(
        `${extras} of ${subjects.length} objects carry more than one value for ${label}; ` +
          "the first in file order was used",
      );
    }
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

  const listLabel = lookup.label;
  let missing = 0;
  let noMatch = 0;
  let unknown = 0;
  const findings: Finding[] = [];
  for (const subject of subjects) {
    const value = subject.value;
    let reason: string | null = null;
    if (value === null || value === "") {
      missing += 1;
      reason = `${label} is empty`;
    } else {
      const code = regex.exec(value)?.[1];
      if (code === undefined || code === "") {
        noMatch += 1;
        reason = `${label} "${value}" does not match ${check.extract}`;
      } else if (!lookup.has(code)) {
        unknown += 1;
        reason = `code "${code}" from ${label} "${value}" is not in ${listLabel}`;
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
      `${listLabel}; ${missing} empty, ${noMatch} no match, ${unknown} not in the list`,
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
 *  All three sources are evaluable, same boundary as `codeLookup` — which is
 *  the point of the mapping: POFIN's own `Duplikat objekt` lives at
 *  `NONS_Process.DuplicateOwnedBy`, a PROPERTY, and until ifcfast 0.5.3 the
 *  filter could only be driven off an attribute. A source that still cannot be
 *  reached (no table supplied) throws `Unsupported`, which the caller turns
 *  into `not_evaluable` plus the note that nothing was excluded — never a
 *  silent "no reference objects". */
function identifyReferenceObjects(
  rule: ExtendedRule,
  allProducts: ModelProduct[],
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
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
    selects(select, p, byGuid, index, ruleset.ifcVersions),
  );
  const excluded = new Set<string>();
  for (const product of candidates) {
    const value = codeValue(source, product, index).value;
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
  index: ModelIndex,
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
      index,
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
  index: ModelIndex,
  ruleset: Ruleset,
  maxFindings: number,
): RuleResult {
  const base = {
    ruleId: rule.id,
    ruleName: rule.name,
    kind: rule.kind,
  } as const;
  const notes: string[] = [];

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
          index,
          ruleset,
          notes,
          maxFindings,
        ),
      };
    }

    const selector: Selector =
      rule.kind === "ids" ? rule.applicability : (rule.select ?? {});
    const applicable = products.filter((p) =>
      selects(selector, p, byGuid, index, ruleset.ifcVersions),
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
            index,
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
  const index = buildIndex(graph);

  const filter = copyObjectFilter(ruleset, allProducts, byGuid, index);
  const products =
    filter && filter.excluded.size > 0
      ? allProducts.filter((p) => !filter.excluded.has(p.guid))
      : allProducts;

  const results = ruleset.rules
    .filter(isEnabled)
    .map((rule) =>
      filter && rule === filter.rule
        ? filter.result
        : evaluateRule(rule, products, summary, byGuid, index, ruleset, maxFindings),
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
