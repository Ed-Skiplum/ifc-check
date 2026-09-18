/** Reads a dropped ruleset: this tool's `.ruleset.json`, or a buildingSMART
 *  IDS 1.0 `.ids`.
 *
 * The `.ids` reader is the exact inverse of `src/ids/emit.ts` — same element
 * names, same facet order, same two value forms (`simpleValue` or an inline
 * `xs:restriction`). It is an importer, not a second evaluator: what comes out
 * is a `Ruleset`, which `src/ids/evaluate.ts` then runs.
 *
 * It refuses rather than guesses. An element this reader does not recognise
 * throws, naming the path, because a ruleset that quietly imported three of its
 * four requirements would report a model as clean against rules that were never
 * applied.
 *
 * Only `.ruleset.json` is linted. That format is this tool's own and has a
 * published JSON Schema, so a lint error is an authoring mistake worth
 * stopping for. An `.ids` is a foreign standard document: it is run as written,
 * and a specification that matches nothing comes back `not_applicable`, which
 * is the signal, not a pass.
 */

import { hasErrors, lintRuleset } from "../ids/lint.ts";
import type { LintIssue } from "../ids/types.ts";
import type {
  Applicability,
  AttributeFacet,
  Cardinality,
  ClassificationFacet,
  EntityFacet,
  IdsRule,
  IdsValue,
  IfcVersion,
  MaterialFacet,
  PartOfFacet,
  PartOfRelation,
  PropertyFacet,
  Requirements,
  Restriction,
  RestrictionBase,
  Rule,
  Ruleset,
  RulesetInfo,
} from "../ids/types.ts";

export interface LoadedRuleset {
  fileName: string;
  ruleset: Ruleset;
  issues: LintIssue[];
}

const RULESET_NAME = /\.json$/i;
const IDS_NAME = /\.(ids|xml)$/i;

export function isRulesetFile(file: File): boolean {
  return RULESET_NAME.test(file.name) || IDS_NAME.test(file.name);
}

/* ------------------------------------------------------------------- XML */

function kids(node: Element, name: string): Element[] {
  return [...node.children].filter((child) => child.localName === name);
}

function kid(node: Element, name: string): Element | null {
  return kids(node, name)[0] ?? null;
}

function attr(node: Element, name: string): string | undefined {
  const value = node.getAttribute(name);
  return value === null || value === "" ? undefined : value;
}

const RESTRICTION_BASES: RestrictionBase[] = [
  "string",
  "boolean",
  "integer",
  "double",
  "decimal",
  "date",
  "dateTime",
  "duration",
];

const NUMERIC_FACETS = [
  "minInclusive",
  "maxInclusive",
  "minExclusive",
  "maxExclusive",
  "length",
  "minLength",
  "maxLength",
] as const;

function readRestriction(node: Element, path: string): Restriction {
  const restriction: Restriction = {};
  const base = (attr(node, "base") ?? "xs:string").replace(/^[^:]*:/, "");
  if (!(RESTRICTION_BASES as string[]).includes(base)) {
    throw new Error(`${path}: unsupported xs:restriction base "${base}"`);
  }
  restriction.base = base as RestrictionBase;

  for (const child of [...node.children]) {
    const local = child.localName;
    const value = attr(child, "value");
    if (value === undefined) throw new Error(`${path}/${local}: no value attribute`);
    if (local === "enumeration") {
      (restriction.enumeration ??= []).push(value);
    } else if (local === "pattern") {
      restriction.pattern = value;
    } else if ((NUMERIC_FACETS as readonly string[]).includes(local)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${path}/${local}: "${value}" is not a number`);
      restriction[local as (typeof NUMERIC_FACETS)[number]] = n;
    } else {
      throw new Error(`${path}: unsupported xs:restriction facet "${local}"`);
    }
  }
  return restriction;
}

/** An ids:idsValue wrapper: <name>, <value>, <system>, <propertySet>, … */
function readValue(node: Element, path: string): IdsValue {
  const simple = kid(node, "simpleValue");
  if (simple) return simple.textContent ?? "";
  const restriction = kid(node, "restriction");
  if (restriction) return { restriction: readRestriction(restriction, `${path}/restriction`) };
  throw new Error(`${path}: neither a simpleValue nor an xs:restriction`);
}

function readValueOf(parent: Element, name: string, path: string): IdsValue | undefined {
  const node = kid(parent, name);
  return node ? readValue(node, `${path}/${name}`) : undefined;
}

function readCardinality(node: Element, path: string): Cardinality | undefined {
  const value = attr(node, "cardinality");
  if (value === undefined) return undefined;
  if (value === "required" || value === "optional" || value === "prohibited") return value;
  throw new Error(`${path}: unknown cardinality "${value}"`);
}

/** The entity facet keeps its IDS name value verbatim through the `name`
 *  escape hatch. Re-deriving a `classes` list would be a re-authoring of
 *  someone else's document, and the evaluator matches the name value directly. */
function readEntity(node: Element, path: string): EntityFacet {
  const name = readValueOf(node, "name", path);
  if (name === undefined) throw new Error(`${path}: entity facet has no name`);
  const predefinedType = readValueOf(node, "predefinedType", path);
  return predefinedType === undefined ? { name } : { name, predefinedType };
}

const RELATIONS: PartOfRelation[] = [
  "IFCRELAGGREGATES",
  "IFCRELASSIGNSTOGROUP",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  "IFCRELNESTS",
  "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT",
];

function readPartOf(node: Element, path: string, requirement: boolean): PartOfFacet {
  const entityNode = kid(node, "entity");
  if (!entityNode) throw new Error(`${path}: partOf has no entity`);
  const facet: PartOfFacet = { entity: readEntity(entityNode, `${path}/entity`) };
  const relation = attr(node, "relation");
  if (relation !== undefined) {
    if (!(RELATIONS as string[]).includes(relation)) {
      throw new Error(`${path}: unknown partOf relation "${relation}"`);
    }
    facet.relation = relation as PartOfRelation;
  }
  if (requirement) {
    const cardinality = readCardinality(node, path);
    if (cardinality === "optional") {
      throw new Error(`${path}: cardinality "optional" is not allowed on partOf`);
    }
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

function readClassification(
  node: Element,
  path: string,
  requirement: boolean,
): ClassificationFacet {
  const system = readValueOf(node, "system", path);
  if (system === undefined) throw new Error(`${path}: classification has no system`);
  const facet: ClassificationFacet = { system };
  const value = readValueOf(node, "value", path);
  if (value !== undefined) facet.value = value;
  if (requirement) {
    const uri = attr(node, "uri");
    if (uri) facet.uri = uri;
    const cardinality = readCardinality(node, path);
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

function readAttribute(node: Element, path: string, requirement: boolean): AttributeFacet {
  const name = readValueOf(node, "name", path);
  if (name === undefined) throw new Error(`${path}: attribute facet has no name`);
  const facet: AttributeFacet = { name };
  const value = readValueOf(node, "value", path);
  if (value !== undefined) facet.value = value;
  if (requirement) {
    const cardinality = readCardinality(node, path);
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

function readProperty(node: Element, path: string, requirement: boolean): PropertyFacet {
  const propertySet = readValueOf(node, "propertySet", path);
  const baseName = readValueOf(node, "baseName", path);
  if (propertySet === undefined) throw new Error(`${path}: property has no propertySet`);
  if (baseName === undefined) throw new Error(`${path}: property has no baseName`);
  const facet: PropertyFacet = { propertySet, baseName };
  const value = readValueOf(node, "value", path);
  if (value !== undefined) facet.value = value;
  const dataType = attr(node, "dataType");
  if (dataType) facet.dataType = dataType;
  if (requirement) {
    const uri = attr(node, "uri");
    if (uri) facet.uri = uri;
    const cardinality = readCardinality(node, path);
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

function readMaterial(node: Element, path: string, requirement: boolean): MaterialFacet {
  const facet: MaterialFacet = {};
  const value = readValueOf(node, "value", path);
  if (value !== undefined) facet.value = value;
  if (requirement) {
    const uri = attr(node, "uri");
    if (uri) facet.uri = uri;
    const cardinality = readCardinality(node, path);
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

const FACET_NAMES = ["entity", "partOf", "classification", "attribute", "property", "material"];

function readApplicability(node: Element, path: string): Applicability {
  const app: Applicability = {};
  const min = attr(node, "minOccurs");
  if (min !== undefined) app.minOccurs = Number(min);
  const max = attr(node, "maxOccurs");
  if (max !== undefined) app.maxOccurs = max === "unbounded" ? "unbounded" : Number(max);

  for (const child of [...node.children]) {
    if (!FACET_NAMES.includes(child.localName)) {
      throw new Error(`${path}: unsupported facet "${child.localName}"`);
    }
  }
  const entity = kid(node, "entity");
  if (entity) app.entity = readEntity(entity, `${path}/entity`);
  const partOf = kids(node, "partOf").map((n, i) => readPartOf(n, `${path}/partOf[${i}]`, false));
  if (partOf.length) app.partOf = partOf;
  const classification = kids(node, "classification").map((n, i) =>
    readClassification(n, `${path}/classification[${i}]`, false),
  );
  if (classification.length) app.classification = classification;
  const attribute = kids(node, "attribute").map((n, i) =>
    readAttribute(n, `${path}/attribute[${i}]`, false),
  );
  if (attribute.length) app.attribute = attribute;
  const property = kids(node, "property").map((n, i) =>
    readProperty(n, `${path}/property[${i}]`, false),
  );
  if (property.length) app.property = property;
  const material = kids(node, "material").map((n, i) =>
    readMaterial(n, `${path}/material[${i}]`, false),
  );
  if (material.length) app.material = material;
  return app;
}

function readRequirements(node: Element, path: string): Requirements {
  const req: Requirements = {};
  const description = attr(node, "description");
  if (description) req.description = description;

  for (const child of [...node.children]) {
    if (!FACET_NAMES.includes(child.localName)) {
      throw new Error(`${path}: unsupported facet "${child.localName}"`);
    }
  }
  const entity = kid(node, "entity");
  if (entity) {
    const instructions = attr(entity, "instructions");
    req.entity = instructions
      ? { ...readEntity(entity, `${path}/entity`), instructions }
      : readEntity(entity, `${path}/entity`);
  }
  const partOf = kids(node, "partOf").map((n, i) => readPartOf(n, `${path}/partOf[${i}]`, true));
  if (partOf.length) req.partOf = partOf;
  const classification = kids(node, "classification").map((n, i) =>
    readClassification(n, `${path}/classification[${i}]`, true),
  );
  if (classification.length) req.classification = classification;
  const attribute = kids(node, "attribute").map((n, i) =>
    readAttribute(n, `${path}/attribute[${i}]`, true),
  );
  if (attribute.length) req.attribute = attribute;
  const property = kids(node, "property").map((n, i) =>
    readProperty(n, `${path}/property[${i}]`, true),
  );
  if (property.length) req.property = property;
  const material = kids(node, "material").map((n, i) =>
    readMaterial(n, `${path}/material[${i}]`, true),
  );
  if (material.length) req.material = material;
  return req;
}

const VERSIONS: IfcVersion[] = ["IFC2X3", "IFC4", "IFC4X3_ADD2"];

function readVersions(node: Element): IfcVersion[] {
  const raw = attr(node, "ifcVersion");
  if (raw === undefined) return [];
  return raw
    .split(/\s+/)
    .filter((v) => (VERSIONS as string[]).includes(v))
    .map((v) => v as IfcVersion);
}

const INFO_FIELDS = [
  "title",
  "copyright",
  "version",
  "description",
  "author",
  "date",
  "purpose",
  "milestone",
] as const;

function readInfo(root: Element): RulesetInfo {
  const info: RulesetInfo = {};
  const node = kid(root, "info");
  if (!node) return info;
  for (const field of INFO_FIELDS) {
    const child = kid(node, field);
    const text = child?.textContent?.trim();
    if (text) info[field] = text;
  }
  return info;
}

export function parseIdsXml(xml: string, fileName: string): Ruleset {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`${fileName} is not well-formed XML: ${parserError.textContent?.trim()}`);
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "ids") {
    throw new Error(`${fileName}: root element is <${root?.localName ?? "?"}>, not <ids>`);
  }

  const specsNode = kid(root, "specifications");
  const specs = specsNode ? kids(specsNode, "specification") : [];
  if (specs.length === 0) throw new Error(`${fileName}: no <specification> in the document`);

  const seen = new Set<string>();
  const rules: Rule[] = specs.map((spec, index) => {
    const path = `specification[${index}]`;
    const name = attr(spec, "name") ?? `${path}`;
    const identifier = attr(spec, "identifier");
    let id = identifier ?? `spec-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);

    const applicabilityNode = kid(spec, "applicability");
    if (!applicabilityNode) throw new Error(`${path}: no <applicability>`);
    const requirementsNode = kid(spec, "requirements");

    const rule: IdsRule = {
      kind: "ids",
      id,
      name,
      applicability: readApplicability(applicabilityNode, `${path}/applicability`),
    };
    const versions = readVersions(spec);
    if (versions.length) rule.ifcVersions = versions;
    if (identifier) rule.identifier = identifier;
    const description = attr(spec, "description");
    if (description) rule.description = description;
    const instructions = attr(spec, "instructions");
    if (instructions) rule.instructions = instructions;
    if (requirementsNode) {
      rule.requirements = readRequirements(requirementsNode, `${path}/requirements`);
    }
    return rule;
  });

  const info = readInfo(root);
  const declared = new Set<IfcVersion>();
  for (const rule of rules) {
    if (rule.kind !== "ids") continue;
    for (const version of rule.ifcVersions ?? []) declared.add(version);
  }

  return {
    formatVersion: 1,
    name: info.title ?? fileName,
    ifcVersions: declared.size > 0 ? [...declared] : ["IFC4"],
    info,
    rules,
  };
}

/* ------------------------------------------------------------------ entry */

export async function readRulesetFile(file: File): Promise<LoadedRuleset> {
  const text = await file.text();

  if (IDS_NAME.test(file.name)) {
    return { fileName: file.name, ruleset: parseIdsXml(text, file.name), issues: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file.name} is not valid JSON: ${(error as Error).message}`);
  }
  const ruleset = parsed as Ruleset;
  if (!ruleset || typeof ruleset !== "object" || !Array.isArray(ruleset.rules)) {
    throw new Error(`${file.name}: no "rules" array — this is not a ruleset document`);
  }
  const issues = lintRuleset(ruleset);
  if (hasErrors(issues)) {
    const lines = issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.path}: ${issue.message}`);
    throw new Error(`${file.name}\n${lines.join("\n")}`);
  }
  return { fileName: file.name, ruleset, issues };
}
