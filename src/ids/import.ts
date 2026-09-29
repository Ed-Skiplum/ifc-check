/** IDS 1.0 XML -> the ruleset model. The inverse of `emit.ts`.
 *
 * Same element names, same facet order, same two value forms (`simpleValue` or
 * an inline `xs:restriction`). It is an importer, not a second evaluator: what
 * comes out is a `Ruleset` of `kind: "ids"` rules, which `evaluate.ts` runs.
 *
 * DOM-free (`xml-read.ts`), so `scripts/ids-cli.ts` and the browser import a
 * file through the same code.
 *
 * It refuses rather than guesses, per specification. A construct this reader
 * does not carry (an unknown facet, an `xs:restriction` facet the model has no
 * field for, an unknown base) makes THAT specification unreadable, with the
 * path and the construct named; the rest of the file still imports. An
 * unreadable specification is reported `not_evaluable` by `ids-report.ts`,
 * never dropped: an import that quietly ran three of four specifications would
 * report a model clean against a rule that was never applied.
 */

import { parseXml, XmlSyntaxError, type XmlElement } from "./xml-read.ts";
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
  Ruleset,
  RulesetInfo,
} from "./types.ts";

/** One `<specification>` of the file, in file order. */
export interface ImportedSpec {
  /** 0-based position in the file. */
  index: number;
  name: string;
  description?: string;
  /** The rule id in `ruleset`, or null when the specification could not be read. */
  ruleId: string | null;
  /** Why it could not be read. Set exactly when `ruleId` is null. */
  unreadable?: string;
}

export interface ImportedIds {
  fileName: string;
  /** `info/title`, or the file name. */
  title: string;
  ruleset: Ruleset;
  specs: ImportedSpec[];
}

class Unreadable extends Error {}

function kids(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter((child) => child.localName === name);
}

function kid(node: XmlElement, name: string): XmlElement | null {
  return kids(node, name)[0] ?? null;
}

function attr(node: XmlElement, name: string): string | undefined {
  const value = node.attrs[name];
  return value === undefined || value === "" ? undefined : value;
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

function readRestriction(node: XmlElement, path: string): Restriction {
  const restriction: Restriction = {};
  const base = (attr(node, "base") ?? "xs:string").replace(/^[^:]*:/, "");
  if (!(RESTRICTION_BASES as string[]).includes(base)) {
    throw new Unreadable(`${path}: xs:restriction base "${base}" is not supported`);
  }
  restriction.base = base as RestrictionBase;

  for (const child of node.children) {
    const local = child.localName;
    const value = child.attrs.value;
    if (value === undefined) throw new Unreadable(`${path}/${local}: no value attribute`);
    if (local === "enumeration") {
      (restriction.enumeration ??= []).push(value);
    } else if (local === "pattern") {
      // Several patterns on one restriction are ORed by XSD; the model has
      // one field, so a second one is refused rather than overwritten.
      if (restriction.pattern !== undefined) {
        throw new Unreadable(`${path}: more than one xs:pattern is not supported`);
      }
      restriction.pattern = value;
    } else if ((NUMERIC_FACETS as readonly string[]).includes(local)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Unreadable(`${path}/${local}: "${value}" is not a number`);
      restriction[local as (typeof NUMERIC_FACETS)[number]] = n;
    } else {
      throw new Unreadable(`${path}: xs:restriction facet "${local}" is not supported`);
    }
  }
  return restriction;
}

/** An ids:idsValue wrapper: <name>, <value>, <system>, <propertySet>, … */
function readValue(node: XmlElement, path: string): IdsValue {
  const simple = kid(node, "simpleValue");
  if (simple) return simple.text;
  const restriction = kid(node, "restriction");
  if (restriction) return { restriction: readRestriction(restriction, `${path}/restriction`) };
  throw new Unreadable(`${path}: neither a simpleValue nor an xs:restriction`);
}

function readValueOf(parent: XmlElement, name: string, path: string): IdsValue | undefined {
  const node = kid(parent, name);
  return node ? readValue(node, `${path}/${name}`) : undefined;
}

function readCardinality(node: XmlElement, path: string): Cardinality | undefined {
  const value = attr(node, "cardinality");
  if (value === undefined) return undefined;
  if (value === "required" || value === "optional" || value === "prohibited") return value;
  throw new Unreadable(`${path}: unknown cardinality "${value}"`);
}

/** The entity facet keeps its IDS name value verbatim through the `name`
 *  escape hatch. Re-deriving a `classes` list would be a re-authoring of
 *  someone else's document, and the evaluator matches the name value directly. */
function readEntity(node: XmlElement, path: string): EntityFacet {
  const name = readValueOf(node, "name", path);
  if (name === undefined) throw new Unreadable(`${path}: entity facet has no name`);
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

function readPartOf(node: XmlElement, path: string, requirement: boolean): PartOfFacet {
  const entityNode = kid(node, "entity");
  if (!entityNode) throw new Unreadable(`${path}: partOf has no entity`);
  const facet: PartOfFacet = { entity: readEntity(entityNode, `${path}/entity`) };
  const relation = attr(node, "relation");
  if (relation !== undefined) {
    if (!(RELATIONS as string[]).includes(relation)) {
      throw new Unreadable(`${path}: unknown partOf relation "${relation}"`);
    }
    facet.relation = relation as PartOfRelation;
  }
  if (requirement) {
    const cardinality = readCardinality(node, path);
    if (cardinality === "optional") {
      throw new Unreadable(`${path}: cardinality "optional" is not allowed on partOf`);
    }
    if (cardinality) facet.cardinality = cardinality;
    const instructions = attr(node, "instructions");
    if (instructions) facet.instructions = instructions;
  }
  return facet;
}

function readClassification(node: XmlElement, path: string, requirement: boolean): ClassificationFacet {
  const system = readValueOf(node, "system", path);
  if (system === undefined) throw new Unreadable(`${path}: classification has no system`);
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

function readAttribute(node: XmlElement, path: string, requirement: boolean): AttributeFacet {
  const name = readValueOf(node, "name", path);
  if (name === undefined) throw new Unreadable(`${path}: attribute facet has no name`);
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

function readProperty(node: XmlElement, path: string, requirement: boolean): PropertyFacet {
  const propertySet = readValueOf(node, "propertySet", path);
  const baseName = readValueOf(node, "baseName", path);
  if (propertySet === undefined) throw new Unreadable(`${path}: property has no propertySet`);
  if (baseName === undefined) throw new Unreadable(`${path}: property has no baseName`);
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

function readMaterial(node: XmlElement, path: string, requirement: boolean): MaterialFacet {
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

function checkFacets(node: XmlElement, path: string): void {
  for (const child of node.children) {
    if (!FACET_NAMES.includes(child.localName)) {
      throw new Unreadable(`${path}: unknown facet "${child.localName}"`);
    }
  }
  if (kids(node, "entity").length > 1) throw new Unreadable(`${path}: more than one entity facet`);
}

function readOccurs(value: string, path: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Unreadable(`${path}: "${value}" is not an occurrence count`);
  return n;
}

function readApplicability(node: XmlElement, path: string): Applicability {
  const app: Applicability = {};
  const min = attr(node, "minOccurs");
  if (min !== undefined) app.minOccurs = readOccurs(min, `${path}@minOccurs`);
  const max = attr(node, "maxOccurs");
  if (max !== undefined) app.maxOccurs = max === "unbounded" ? "unbounded" : readOccurs(max, `${path}@maxOccurs`);

  checkFacets(node, path);
  const entity = kid(node, "entity");
  if (entity) app.entity = readEntity(entity, `${path}/entity`);
  const partOf = kids(node, "partOf").map((n, i) => readPartOf(n, `${path}/partOf[${i}]`, false));
  if (partOf.length) app.partOf = partOf;
  const classification = kids(node, "classification").map((n, i) =>
    readClassification(n, `${path}/classification[${i}]`, false),
  );
  if (classification.length) app.classification = classification;
  const attribute = kids(node, "attribute").map((n, i) => readAttribute(n, `${path}/attribute[${i}]`, false));
  if (attribute.length) app.attribute = attribute;
  const property = kids(node, "property").map((n, i) => readProperty(n, `${path}/property[${i}]`, false));
  if (property.length) app.property = property;
  const material = kids(node, "material").map((n, i) => readMaterial(n, `${path}/material[${i}]`, false));
  if (material.length) app.material = material;
  return app;
}

function readRequirements(node: XmlElement, path: string): Requirements {
  const req: Requirements = {};
  const description = attr(node, "description");
  if (description) req.description = description;

  checkFacets(node, path);
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
  const attribute = kids(node, "attribute").map((n, i) => readAttribute(n, `${path}/attribute[${i}]`, true));
  if (attribute.length) req.attribute = attribute;
  const property = kids(node, "property").map((n, i) => readProperty(n, `${path}/property[${i}]`, true));
  if (property.length) req.property = property;
  const material = kids(node, "material").map((n, i) => readMaterial(n, `${path}/material[${i}]`, true));
  if (material.length) req.material = material;
  return req;
}

const VERSIONS: IfcVersion[] = ["IFC2X3", "IFC4", "IFC4X3_ADD2"];

/** `ifcVersion` is metadata only (it gates nothing, AGENTS.md "Authoring
 *  traps"), so a version outside the model's list is dropped, not refused. */
function readVersions(node: XmlElement): IfcVersion[] {
  const raw = attr(node, "ifcVersion");
  if (raw === undefined) return [];
  return raw
    .split(/\s+/)
    .filter((v) => (VERSIONS as string[]).includes(v))
    .map((v) => v as IfcVersion);
}

const INFO_FIELDS = ["title", "copyright", "version", "description", "author", "date", "purpose", "milestone"] as const;

function readInfo(root: XmlElement): RulesetInfo {
  const info: RulesetInfo = {};
  const node = kid(root, "info");
  if (!node) return info;
  for (const field of INFO_FIELDS) {
    const text = kid(node, field)?.text.trim();
    if (text) info[field] = text;
  }
  return info;
}

/** Import an IDS document. Throws only when the DOCUMENT is unusable (not
 *  XML, not an `<ids>`, no specification); a specification that cannot be
 *  read is listed with the reason and left out of `ruleset`. */
export function importIds(xml: string, fileName: string): ImportedIds {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof XmlSyntaxError) throw new Error(`${fileName} is not well-formed XML: ${error.message}`);
    throw error;
  }
  if (root.localName !== "ids") {
    throw new Error(`${fileName}: root element is <${root.localName}>, not <ids>`);
  }
  const specsNode = kid(root, "specifications");
  const specNodes = specsNode ? kids(specsNode, "specification") : [];
  if (specNodes.length === 0) throw new Error(`${fileName}: no <specification> in the document`);

  const seen = new Set<string>();
  const rules: IdsRule[] = [];
  const specs: ImportedSpec[] = specNodes.map((spec, index) => {
    const path = `specification[${index}]`;
    const name = attr(spec, "name") ?? path;
    const description = attr(spec, "description");
    const identifier = attr(spec, "identifier");
    let id = identifier ?? `spec-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const entry: ImportedSpec = { index, name, ruleId: null };
    if (description) entry.description = description;

    try {
      for (const child of spec.children) {
        if (child.localName !== "applicability" && child.localName !== "requirements") {
          throw new Unreadable(`${path}: unknown element <${child.localName}>`);
        }
      }
      const applicabilityNode = kid(spec, "applicability");
      if (!applicabilityNode) throw new Unreadable(`${path}: no <applicability>`);
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
      if (description) rule.description = description;
      const instructions = attr(spec, "instructions");
      if (instructions) rule.instructions = instructions;
      if (requirementsNode) rule.requirements = readRequirements(requirementsNode, `${path}/requirements`);
      rules.push(rule);
      entry.ruleId = id;
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
      entry.unreadable = error.message;
    }
    return entry;
  });

  const info = readInfo(root);
  const declared = new Set<IfcVersion>();
  for (const rule of rules) for (const version of rule.ifcVersions ?? []) declared.add(version);

  return {
    fileName,
    title: info.title ?? fileName,
    ruleset: {
      formatVersion: 2,
      name: info.title ?? fileName,
      ifcVersions: declared.size > 0 ? [...declared] : ["IFC4"],
      info,
      rules,
    },
    specs,
  };
}

/** The strict form the ruleset loader uses: every specification must import,
 *  or the whole file is refused with the first reason. */
export function parseIdsXml(xml: string, fileName: string): Ruleset {
  const imported = importIds(xml, fileName);
  const bad = imported.specs.find((s) => s.unreadable !== undefined);
  if (bad) throw new Error(`${fileName}: ${bad.unreadable}`);
  return imported.ruleset;
}
