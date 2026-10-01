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
import { copyVerdict, everyOwnerName, modelFact, modelLabel, ruleRole } from "./models.ts";
import { CODE_LISTS, CODE_LIST_IDS, type CodeList } from "../codelists/index.ts";
import type {
  ModelClassification,
  ModelGraph,
  ModelMaterial,
  ModelProduct,
  ModelProperty,
  ModelQuantity,
  ModelSummary,
} from "./model.ts";
import type {
  AttributeFacet,
  CodeLookupCheck,
  CodeLookupRole,
  ClassificationFacet,
  CodeSource,
  CopyObjectCheck,
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
  /** Stable key for why it failed, so a consumer branches on it rather than
   *  on `reason`: `empty` · `no-match` · `not-in-list` · `reserved` (code-lookup),
   *  `no-type`, `duplicate`, `type-usage`, `value` (model-metadata),
   *  `requirement` (an ids rule), `occurrence-bounds`. */
  code?: string;
  /** The value the rule read off the subject, raw, when it read one. */
  value?: string | null;
}

/** One distinct value a rule read, with how many subjects carried it and
 *  what the rule made of it. `value` null = the subjects carried none. */
export interface ValueCount {
  value: string | null;
  n: number;
  state: "ok" | "deviating" | "missing";
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
  /** Structured split of `applicable`, for the report contract. Set by the
   *  checks that read a value (code-lookup, the copy-object mapping):
   *  met + deviating + missing = applicable. `sourceHits` = subjects the
   *  source answered with a non-empty value. */
  coverage?: { met: number; deviating: number; missing: number; sourceHits: number };
  /** Every distinct value read, uncollapsed, most frequent first. Same
   *  checks as `coverage`. */
  values?: ValueCount[];
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
  /** Report row ids this model is exempt from (`ModelFact.exempt`). Their
   *  rules came back not_applicable; the report does the same to its rows. */
  exempt?: string[];
}

/** The reason an exempt requirement carries, the same in a rule result and a
 *  report row. */
export function exemptReason(label: string): string {
  return `does not apply to model ${label} (models[].exempt)`;
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

/** How a property value compares, by the IFC type it was written as.
 *
 * ifcfast renders a STEP value as text: an IfcBoolean `.T.` is `True`, a
 * measure is its STEP literal (`3.`). IDS writes values in the XSD lexical
 * space: `true` / `false`, and numbers compare as numbers (`3` is `3.`). So a
 * property value is normalised by its `value_type` before it is compared;
 * anything else compares as the literal string, which is what an attribute,
 * a classification code or a material name is. */
type ValueKind = "boolean" | "number" | "string";

const NUMERIC_TYPES = /^IFC(INTEGER|REAL|POSITIVEINTEGER|[A-Z]*MEASURE)$/;

function valueKind(valueType: string | null | undefined): ValueKind {
  const upper = (valueType ?? "").toUpperCase();
  if (upper === "IFCBOOLEAN" || upper === "IFCLOGICAL") return "boolean";
  // IfcDescriptiveMeasure is a string despite its name.
  if (NUMERIC_TYPES.test(upper) && upper !== "IFCDESCRIPTIVEMEASURE") return "number";
  return "string";
}

function booleanLexical(value: string): string {
  const lower = value.toLowerCase();
  if (lower === ".t." || lower === "1") return "true";
  if (lower === ".f." || lower === "0") return "false";
  if (lower === ".u.") return "unknown";
  return lower;
}

/** Relative tolerance as ifctester applies it to floating point values. */
function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}

function matchesTypedValue(constraint: IdsValue, value: string | null, kind: ValueKind): boolean {
  if (value === null) return false;
  if (kind === "boolean") {
    const v = booleanLexical(value);
    if (typeof constraint === "string") return booleanLexical(constraint) === v;
    const r = constraint.restriction;
    const enumeration = r.enumeration?.map(booleanLexical);
    return matchesRestriction({ ...r, enumeration }, v);
  }
  if (kind === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return matchesValue(constraint, value);
    if (typeof constraint === "string") {
      const c = Number(constraint);
      return Number.isFinite(c) ? sameNumber(c, n) : constraint === value;
    }
    const r = constraint.restriction;
    if (r.enumeration) {
      const hit = r.enumeration.some((e) => {
        const c = Number(e);
        return Number.isFinite(c) ? sameNumber(c, n) : e === value;
      });
      if (!hit) return false;
      return matchesRestriction({ ...r, enumeration: undefined }, value);
    }
    return matchesRestriction(r, value);
  }
  return matchesValue(constraint, value);
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
  if (product.source === "type") {
    throw new Unsupported(
      `${what} is not exposed for type objects; the parser's type object rows ` +
        `(${product.entity}) carry GlobalId, class and Name only`,
    );
  }
  throw new Unsupported(
    `${what} is not exposed for spatial structure elements; the parser's ` +
      `${product.entity} rows carry GlobalId and Name only`,
  );
}

/** A synthesized row: a spatial structure element or a type object. */
function synthesized(product: ModelProduct): boolean {
  return product.source === "spatial" || product.source === "type";
}

function readAttribute(product: ModelProduct, name: string): string | null {
  if (synthesized(product) && name !== "GlobalId" && name !== "Name") {
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
  if (product.source === "type") throw new Unsupported(TYPE_TABLES);
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
  if (product.source === "type") throw new Unsupported(TYPE_TABLES);
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
  /** `materialsJson()` by owner, or null when the caller supplied none: the
   *  material facet then reads `ModelProduct.materials` (layer sets only). */
  materials: Map<string, ModelMaterial[]> | null;
}

/** Why a type object row cannot answer a property or classification facet. */
const TYPE_TABLES =
  "a type object's own property sets and classifications are not keyed by the type " +
  "in the parsed tables (ifcfast folds them onto the occurrences that inherit them)";

/** IDS reads an `IfcElementQuantity` as a property set, so a quantity joins
 *  the property index as (set, name, value). Its `value_type` is the measure
 *  its kind implies, which is what an IDS `dataType` on a quantity names. */
const QUANTITY_MEASURE: Record<string, string> = {
  LENGTH: "IfcLengthMeasure",
  AREA: "IfcAreaMeasure",
  VOLUME: "IfcVolumeMeasure",
  COUNT: "IfcCountMeasure",
  WEIGHT: "IfcMassMeasure",
  TIME: "IfcTimeMeasure",
};

function quantityProperty(q: ModelQuantity): ModelProperty {
  const kind = (q.quantity_type ?? "").toUpperCase().replace(/^IFCQUANTITY/, "");
  return {
    guid: q.guid,
    pset_name: q.qto_name,
    prop_name: q.quantity_name,
    value: q.value,
    value_type: QUANTITY_MEASURE[kind] ?? null,
    source: q.source,
  };
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
  const propertyRows =
    graph.psets === undefined ? undefined : [...graph.psets, ...(graph.quantities ?? []).map(quantityProperty)];
  return {
    containedIn: new Map((graph.contained_in ?? []).map((c) => [c.product_guid, c.storey_guid])),
    aggregateParent,
    voidHost: new Map((graph.voids ?? []).map((v) => [v.opening_guid, v.host_guid])),
    spatialEntity,
    properties: groupByGuid(propertyRows),
    classifications: groupByGuid(graph.classifications),
    materials: groupByGuid(graph.materials),
  };
}

/** The declared type objects as selectable rows, for IDS rules only: an IDS
 *  entity facet naming IFCWALLTYPE selects the type objects themselves, and
 *  without these rows it would match nothing and read NOT APPLIED where the
 *  file has types. They carry GlobalId, class and Name; every other read on
 *  them is `not_evaluable` (`spatialOnly`, `TYPE_TABLES`). ifcfast spells the
 *  class its own way (`IfcWalltype`, ifcfast#186); matching uppercases it. */
function typeObjectRows(graph: ModelGraph): ModelProduct[] {
  return (graph.type_objects ?? []).map((t) => ({
    source: "type",
    guid: t.guid,
    entity: t.entity,
    name: t.name,
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
  }));
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

/** The aggregate parent of an object: the graph's `aggregates` (and the
 *  storey -> building table), else the product row's own `parent_guid`. */
function aggregateParentOf(
  guid: string,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
): string | undefined {
  return index.aggregateParent.get(guid) ?? byGuid.get(guid)?.parent_guid ?? undefined;
}

/** The spatial container of an object as IDS reads it: its own containment,
 *  or, for a part aggregated into an assembly (a stair flight in a stair, a
 *  plate in a curtain wall), the containment of the nearest aggregate
 *  ancestor that has one. `undefined` when no ancestor has one IN THE PARSED
 *  GRAPH, which carries storey containment only: an element contained
 *  directly in a site, building or space has no container here. */
function containerOf(
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
): string | undefined {
  const seen = new Set<string>();
  let guid: string | undefined = product.guid;
  while (guid !== undefined && !seen.has(guid)) {
    seen.add(guid);
    const container = index.containedIn.get(guid);
    if (container !== undefined) return container;
    guid = aggregateParentOf(guid, byGuid, index);
  }
  return undefined;
}

/** partOf, recursive as IDS 1.0 defines it: the facet's entity may be the
 *  direct parent or any ancestor along the same relation, and a contained
 *  element is also part of the spatial structure above its container (an
 *  element in a storey is part of the building). Voids and fills stay one
 *  step: an opening has one host. */
function testPartOf(
  facet: PartOfFacet,
  product: ModelProduct,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
  versions: Ruleset["ifcVersions"],
): boolean {
  const wanted = entityNameValue(facet.entity, versions);
  const matchesUp = (start: string | undefined): boolean => {
    const seen = new Set<string>();
    let guid = start;
    while (guid !== undefined && !seen.has(guid)) {
      seen.add(guid);
      const entity = entityOfGuid(guid, byGuid, index);
      if (entity !== null && matchesValue(wanted, entity)) return true;
      guid = aggregateParentOf(guid, byGuid, index);
    }
    return false;
  };
  switch (facet.relation) {
    case undefined:
    case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
      return matchesUp(containerOf(product, byGuid, index));
    case "IFCRELAGGREGATES":
      return matchesUp(aggregateParentOf(product.guid, byGuid, index));
    case "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT": {
      const entity = entityOfGuid(index.voidHost.get(product.guid), byGuid, index);
      return entity !== null && matchesValue(wanted, entity);
    }
    default:
      throw new Unsupported(
        `partOf relation ${facet.relation} is not exposed by the parser; ` +
          "IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES and " +
          "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT are",
      );
  }
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

/** The material facet. With `materialsJson()` supplied it reads every
 *  association, the element's own and the one inherited from its type, and a
 *  value matches a material's Name or Category (IDS 1.0). An association
 *  ifcfast does not resolve (`role` `unknown`, constituent and profile sets)
 *  still counts as present. Without the table it reads `ModelProduct.materials`,
 *  which holds layer-set materials only. */
function materialNames(product: ModelProduct, index: ModelIndex): { present: boolean; names: string[] } {
  if (index.materials !== null) {
    // Keyed by owner GlobalId, so a type object or a spatial element reads
    // its own assignments here like any product.
    const rows = index.materials.get(product.guid) ?? [];
    const names = rows.flatMap((r) => [r.material_name, r.category]).filter((n): n is string => !!n);
    return { present: rows.length > 0, names };
  }
  if (synthesized(product)) spatialOnly(product, "a material");
  const names = product.materials ?? [];
  return { present: names.length > 0, names };
}

function testMaterial(facet: MaterialFacet, product: ModelProduct, index: ModelIndex): boolean {
  const { present, names } = materialNames(product, index);
  if (facet.value === undefined) return present;
  return names.some((m) => matchesValue(facet.value as IdsValue, m));
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
  return rows.some((row) => matchesTypedValue(facet.value as IdsValue, row.value, valueKind(row.value_type)));
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
    if (selector.entity.predefinedType !== undefined && product.source === "type") {
      spatialOnly(product, "PredefinedType");
    }
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
    if (!testMaterial(facet, product, index)) return false;
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
    } else if (req.entity.predefinedType !== undefined && product.source === "type") {
      spatialOnly(product, "PredefinedType");
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
      const containment =
        facet.relation === undefined || facet.relation === "IFCRELCONTAINEDINSPATIALSTRUCTURE";
      // Stated on the finding: the graph carries storey containment only, so
      // "no container" may be a site, building or space container it cannot see.
      const unseen =
        containment && facet.cardinality !== "prohibited" && containerOf(product, byGuid, index) === undefined
          ? "; no storey containment found (the parser reports containment in a storey only, " +
            "so a site, building or space container is not visible)"
          : "";
      reasons.push(
        `partOf ${facet.relation ?? "IFCRELCONTAINEDINSPATIALSTRUCTURE"} ` +
          (facet.cardinality === "prohibited" ? "is present but prohibited" : "not satisfied") +
          unseen,
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
    const { present, names } = materialNames(product, index);
    const matched = testMaterial(facet, product, index);
    if (!applyCardinality(matched, present, facet.cardinality)) {
      const carried = names.length > 0 ? [...new Set(names)].join(", ") : "(unnamed)";
      reasons.push(
        facet.cardinality === "prohibited"
          ? "material is present but prohibited"
          : `material ${present ? carried : "absent"} does not satisfy the requirement`,
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
  if ("material" in source) {
    // IfcRelAssociatesMaterial: the object's own association, else its
    // type's; material names only (not the category), in file order.
    if (index.materials === null) {
      throw new Unsupported(
        "no material table was supplied with this graph; the caller must attach " +
          "materialsJson() to it before a material source can be read",
      );
    }
    if (product.source === "type") throw new Unsupported(TYPE_TABLES);
    const rows = index.materials.get(product.guid) ?? [];
    const own = rows.filter((r) => r.source !== "type");
    for (const row of own.length > 0 ? own : rows) {
      const name = row.material_name?.trim();
      if (name && !values.includes(name)) values.push(name);
    }
  } else if ("property" in source) {
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

/** One source of a report cascade (src/engine/standard-layer.ts): a ruleset
 *  `CodeSource`, or a property whose set and name may be restrictions, which
 *  is how the standard layer names `Pset_*Common.Status`. */
export type CascadeSource =
  | CodeSource
  | { propertyMatch: { propertySet: IdsValue; name: IdsValue } };

/** Reads cascade sources off objects by the same path code-lookup reads its
 *  source, so a value means the same thing in a rule and in a report row.
 *  `read` returns the first non-empty value in file order, or null, and
 *  throws `SourceUnreachable` when the table the source needs was not
 *  supplied with the graph. */
export class SourceUnreachable extends Error {}

export function cascadeReader(graph: ModelGraph): {
  read(source: CascadeSource, product: ModelProduct): string | null;
} {
  const index = buildIndex(graph);
  return {
    read(source, product) {
      try {
        if ("propertyMatch" in source) {
          const rows = propertyRows(index, product, {
            propertySet: source.propertyMatch.propertySet,
            baseName: source.propertyMatch.name,
          });
          const row = rows.find((r) => r.value !== null && r.value !== "");
          return row?.value ?? null;
        }
        return codeValue(source, product, index).value;
      } catch (error) {
        if (error instanceof Unsupported) throw new SourceUnreachable(error.message);
        throw error;
      }
    },
  };
}

/** How a code-lookup's source reads on a finding: the attribute name, the
 *  qualified property, or the classification system. */
function sourceLabel(source: CodeSource): string {
  if ("attribute" in source) return source.attribute;
  if ("property" in source) return `${source.property.propertySet}.${source.property.name}`;
  if ("material" in source) return "IfcRelAssociatesMaterial";
  const system = source.classification.system;
  return system === undefined ? "classification" : `classification ${literal(system)}`;
}

/** What a code-lookup checks codes against: a bundled list, or the project's
 *  own `values`. One code path for both, so the findings read the same.
 *  On the progress-code (MMI) rule an empty project list checks the format
 *  alone: every code the Uttrekk takes out is in it. */
export function resolveLookup(check: CodeLookupCheck, role?: CodeLookupRole | null): {
  label: string;
  has: (code: string) => boolean;
  reserved: (code: string) => boolean;
} {
  if (role === "progress-code" && check.codes !== undefined && check.codes.length === 0) {
    return { label: `the format ${check.extract} (no codes listed)`, has: () => true, reserved: () => false };
  }
  if (check.codes !== undefined) {
    const allowed = new Set(check.codes.map((c) => c.code));
    return {
      label: `the project's codes (${check.codes.map((c) => c.code).join(", ")})`,
      has: (c) => allowed.has(c),
      reserved: () => false,
    };
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
  const reserved = new Set(list.reserved ?? []);
  return { label: list.meta.label, has: (c) => Object.hasOwn(list.codes, c), reserved: (c) => reserved.has(c) };
}

function codeLookup(
  check: CodeLookupCheck,
  role: CodeLookupRole | undefined,
  select: Selector,
  products: ModelProduct[],
  summary: ModelSummary,
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
  ruleset: Ruleset,
  notes: string[],
  maxFindings: number,
): Omit<RuleResult, "ruleId" | "ruleName" | "kind"> {
  const lookup = resolveLookup(check, role);
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
  let reservedHits = 0;
  const findings: Finding[] = [];
  const tally = new Map<string | null, ValueCount>();
  for (const subject of subjects) {
    const value = subject.value;
    let reason: string | null = null;
    let why: string | undefined;
    if (value === null || value === "") {
      missing += 1;
      reason = `${label} is empty`;
      why = "empty";
    } else {
      const code = regex.exec(value)?.[1];
      if (code === undefined || code === "") {
        noMatch += 1;
        reason = `${label} "${value}" does not match ${check.extract}`;
        why = "no-match";
      } else if (!lookup.has(code)) {
        unknown += 1;
        reason = `code "${code}" from ${label} "${value}" is not in ${listLabel}`;
        why = "not-in-list";
      } else if (lookup.reserved(code)) {
        reservedHits += 1;
        reason = `code "${code}" from ${label} "${value}" is reserved in ${listLabel}`;
        why = "reserved";
      }
    }
    countValue(
      tally,
      value === "" ? null : value,
      why === undefined ? "ok" : why === "empty" ? "missing" : "deviating",
    );
    if (reason === null) continue;
    const finding: Finding = {
      guid: subject.guid,
      entity: subject.entity,
      name: subject.name,
      reason,
      code: why,
      value: value === "" ? null : value,
    };
    if (subject.members) finding.members = subject.members;
    findings.push(finding);
  }

  if (reservedHits > 0) {
    // Kept apart from "not in the list": the code exists in the standard, which
    // reserves it. Whether a project accepts it is the project's ruling; until
    // a ruleset can say so, it is a finding of its own kind.
    notes.push(
      `${reservedHits} of ${subjects.length} ${noun} carry a code ${listLabel} reserves ` +
        "(reported as reserved, not as unknown)",
    );
  }

  return {
    state: findings.length === 0 ? "pass" : "fail",
    applicable: subjects.length,
    failed: findings.length,
    findings: cap(findings, maxFindings),
    detail:
      `${subjects.length - findings.length} of ${subjects.length} ${noun} carry a code from ` +
      `${listLabel}; ${missing} empty, ${noMatch} no match, ${unknown} not in the list` +
      (reservedHits > 0 ? `, ${reservedHits} reserved` : ""),
    notes: notes.length ? notes : undefined,
    coverage: {
      met: subjects.length - findings.length,
      deviating: noMatch + unknown + reservedHits,
      missing,
      sourceHits: subjects.length - missing,
    },
    values: sortedValues(tally),
  };
}

function countValue(
  tally: Map<string | null, ValueCount>,
  value: string | null,
  state: ValueCount["state"],
): void {
  const row = tally.get(value);
  if (row) row.n += 1;
  else tally.set(value, { value, n: 1, state });
}

/** Most frequent first, then by value, so the order is deterministic. */
function sortedValues(tally: Map<string | null, ValueCount>): ValueCount[] {
  return [...tally.values()].sort(
    (a, b) => b.n - a.n || String(a.value ?? "").localeCompare(String(b.value ?? "")),
  );
}

/* ------------------------------------------------------- reference objects */

/** The copy-object role is a SCOPE FILTER, not a data-quality check: a copy
 *  is excluded from every other rule's selection, fundamentals included, and
 *  never a finding. How one value reads is `copyVerdict` (models.ts): blank,
 *  an own value or one of this model's owner names is the file's own object;
 *  a copy value or any other value is a copy.
 *
 *  The owner names are the model's (`ModelFact.ownerNames`, by file label).
 *  When the ruleset declares `models` and this file is not among them, whose
 *  object it is cannot be told: `Unsupported`, which the caller turns into
 *  not_evaluable with nothing excluded, never a silent "no copies". A source
 *  that cannot be reached (no table supplied) is the same.
 *
 *  The value tally flags a value the project names nowhere (not a copy or
 *  own value, no model's owner name) as `deviating`: still a copy, but worth
 *  seeing. */
function identifyReferenceObjects(
  rule: ExtendedRule,
  check: CopyObjectCheck,
  allProducts: ModelProduct[],
  byGuid: Map<string, ModelProduct>,
  index: ModelIndex,
  ruleset: Ruleset,
  modelName: string,
): { excluded: Set<string>; candidates: number; present: number; values: ValueCount[] } {
  const fact = modelFact(ruleset, modelName);
  if (ruleset.models !== undefined && fact === null) {
    throw new Unsupported(
      `model ${modelLabel(modelName)} is not in models, so whose objects are copies cannot be told`,
    );
  }
  const ownerNames = fact?.ownerNames ?? [];
  const everyOwner = everyOwnerName(ruleset);
  const select = rule.select ?? {};
  const candidates = allProducts.filter((p) =>
    selects(select, p, byGuid, index, ruleset.ifcVersions),
  );
  const excluded = new Set<string>();
  const tally = new Map<string | null, ValueCount>();
  let present = 0;
  for (const product of candidates) {
    const raw = codeValue(check.source, product, index).value;
    const value = raw === "" ? null : raw;
    const { verdict, known } = copyVerdict(check, value, ownerNames, everyOwner);
    countValue(tally, value, known ? "ok" : "deviating");
    if (value !== null) present += 1;
    if (verdict === "copy") excluded.add(product.guid);
  }
  return { excluded, candidates: candidates.length, present, values: sortedValues(tally) };
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
  modelName: string,
): { rule: ExtendedRule; excluded: Set<string>; result: RuleResult } | null {
  const rule = ruleset.rules.find(
    (r): r is ExtendedRule => r.kind === "extended" && ruleRole(r) === "copy-object",
  );
  if (!rule || !isEnabled(rule) || rule.check.type !== "copy-object") return null;
  const check = rule.check;
  const base = { ruleId: rule.id, ruleName: rule.name, kind: rule.kind } as const;
  if (modelFact(ruleset, modelName)?.exempt?.includes("copy-object")) {
    return {
      rule,
      excluded: new Set(),
      result: {
        ...base,
        state: "not_applicable",
        applicable: 0,
        failed: 0,
        findings: [],
        detail: "exempt",
        reason: exemptReason(modelLabel(modelName)),
      },
    };
  }

  try {
    const { excluded, candidates, present, values } = identifyReferenceObjects(
      rule,
      check,
      allProducts,
      byGuid,
      index,
      ruleset,
      modelName,
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
        detail: `${excluded.size} of ${candidates} objects excluded as copies`,
        coverage: {
          met: present - values.filter((v) => v.state === "deviating").reduce((n, v) => n + v.n, 0),
          deviating: values.filter((v) => v.state === "deviating").reduce((n, v) => n + v.n, 0),
          missing: candidates - present,
          sourceHits: present,
        },
        values,
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

/* ------------------------------------------------ per-object code reading */

/** One object a code-lookup rule judges, with what it read and how it was
 *  judged. `code` is the extracted code, set only when the value matched the
 *  extract. `state` is the value tally's own: `ok`, `deviating` (no match,
 *  not in the list, reserved) or `missing` (empty). */
export interface CodeLookupSubject {
  guid: string;
  entity: string;
  value: string | null;
  code: string | null;
  state: ValueCount["state"];
}

/** Every object a code-lookup rule judges, by the path `codeLookup` takes:
 *  the same universe and copy-object exclusion as `evaluateRuleset`, the same
 *  selection, source, extract and list. A type subject is expanded to the
 *  elements that use it. The copy-object mapping itself reads the unfiltered
 *  universe and judges nothing, so its subjects are all `ok`, as its value
 *  tally is. For the board's per-value doors and code treemaps, which must
 *  count what the rule counted. Throws `Unsupported` where the rule would be
 *  `not_evaluable`. */
export function codeLookupSubjects(
  ruleset: Ruleset,
  rule: ExtendedRule,
  graph: ModelGraph,
  modelName: string,
): CodeLookupSubject[] {
  const allProducts = selectableProducts(graph);
  const byGuid = new Map(allProducts.map((p) => [p.guid, p]));
  const index = buildIndex(graph);
  const select = rule.select ?? {};
  if (rule.check.type === "copy-object") {
    // Every value read, as its tally has it: judged nowhere, `deviating` only
    // for a value the project names nowhere. `code` is the verdict.
    const copyCheck = rule.check;
    const ownerNames = modelFact(ruleset, modelName)?.ownerNames ?? [];
    const everyOwner = everyOwnerName(ruleset);
    return allProducts
      .filter((p) => selects(select, p, byGuid, index, ruleset.ifcVersions))
      .map((p) => {
        const raw = codeValue(copyCheck.source, p, index).value;
        const value = raw === "" ? null : raw;
        const { verdict, known } = copyVerdict(copyCheck, value, ownerNames, everyOwner);
        return { guid: p.guid, entity: p.entity, value, code: verdict, state: known ? ("ok" as const) : ("deviating" as const) };
      });
  }
  const check = rule.check;
  if (check.type !== "code-lookup") throw new Unsupported(`${rule.id} is not a code-lookup rule`);
  const regex = compileExtract(check.extract);
  const filter = copyObjectFilter(ruleset, allProducts, byGuid, index, modelName);
  const products =
    filter && filter.excluded.size > 0 ? allProducts.filter((p) => !filter.excluded.has(p.guid)) : allProducts;
  const lookup = resolveLookup(check, rule.mapping);
  const judge = (value: string | null): { code: string | null; state: ValueCount["state"] } => {
    if (value === null || value === "") return { code: null, state: "missing" };
    const code = regex.exec(value)?.[1];
    if (code === undefined || code === "") return { code: null, state: "deviating" };
    if (!lookup.has(code) || lookup.reserved(code)) return { code, state: "deviating" };
    return { code, state: "ok" };
  };
  const out: CodeLookupSubject[] = [];
  if ((check.target ?? "occurrence") === "type") {
    for (const subject of typeSubjects(select, products, check.source, byGuid, index, ruleset.ifcVersions)) {
      const judged = judge(subject.value);
      for (const guid of subject.members ?? []) {
        const member = byGuid.get(guid);
        out.push({ guid, entity: member?.entity ?? subject.entity, value: subject.value, ...judged });
      }
    }
    return out;
  }
  for (const p of products) {
    if (!selects(select, p, byGuid, index, ruleset.ifcVersions)) continue;
    const raw = codeValue(check.source, p, index).value;
    const value = raw === "" ? null : raw;
    out.push({ guid: p.guid, entity: p.entity, value, ...judge(value) });
  }
  return out;
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
                code: "value",
                value,
              },
            ],
        detail: `${field} = ${value === null ? "(none)" : value}`,
        notes: notes.length ? notes : undefined,
        coverage: {
          met: ok ? 1 : 0,
          deviating: !ok && value !== null ? 1 : 0,
          missing: !ok && value === null ? 1 : 0,
          sourceHits: value === null ? 0 : 1,
        },
        values: [{ value, n: 1, state: ok ? "ok" : value === null ? "missing" : "deviating" }],
      };
    }

    if (rule.kind === "extended" && rule.check.type === "code-lookup") {
      return {
        ...base,
        ...codeLookup(
          rule.check,
          rule.mapping,
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
          code: "occurrence-bounds",
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
          code: "occurrence-bounds",
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
              code: "requirement",
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
          code: "no-type",
        }));
      return {
        ...base,
        state: findings.length === 0 ? "pass" : "fail",
        applicable: applicable.length,
        failed: findings.length,
        findings: cap(findings, maxFindings),
        detail: `${applicable.length - findings.length} of ${applicable.length} elements are linked to a type`,
        notes: notes.length ? notes : undefined,
        coverage: {
          met: applicable.length - findings.length,
          deviating: 0,
          missing: findings.length,
          sourceHits: applicable.length - findings.length,
        },
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
            code: "duplicate",
            value,
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
            code: "type-usage",
            value: typeName,
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

  const filter = copyObjectFilter(ruleset, allProducts, byGuid, index, modelName);
  const products =
    filter && filter.excluded.size > 0
      ? allProducts.filter((p) => !filter.excluded.has(p.guid))
      : allProducts;
  const exempt = modelFact(ruleset, modelName)?.exempt ?? [];
  const isExempt = (rule: Rule) => exempt.includes(ruleRole(rule) ?? rule.id);

  // IDS rules also select the declared type objects (`typeObjectRows`). The
  // extended rules keep the element universe they always had: a code-lookup
  // with no selection means every element, never the types.
  const types = typeObjectRows(graph);
  const withTypes = types.length > 0 ? [...products, ...types] : products;

  const results = ruleset.rules
    .filter(isEnabled)
    .map((rule): RuleResult =>
      filter && rule === filter.rule
        ? filter.result
        : isExempt(rule)
          ? {
              ruleId: rule.id,
              ruleName: rule.name,
              kind: rule.kind,
              state: "not_applicable",
              applicable: 0,
              failed: 0,
              findings: [],
              detail: "exempt",
              reason: exemptReason(modelLabel(modelName)),
            }
          : evaluateRule(rule, rule.kind === "ids" ? withTypes : products, summary, byGuid, index, ruleset, maxFindings),
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
    ...(exempt.length > 0 ? { exempt: [...exempt] } : {}),
  };
}
