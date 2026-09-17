/** Ruleset -> IDS 1.0 XML.
 *
 * Everything the XSD constrains is enforced here rather than left to the author:
 *
 *  - minOccurs/maxOccurs are written on <applicability>, never on
 *    <specification>, which the XSD rejects outright.
 *  - Facets are emitted in the order applicabilityType / requirementsType
 *    declare them (entity, partOf, classification, attribute, property,
 *    material), whatever order the ruleset lists them in.
 *  - A requirements <entity> gets no cardinality attribute; the XSD gives it
 *    `instructions` only.
 *  - A class group expands to an explicit enumeration of concrete classes,
 *    because the entity facet matches an exact class and never a subtype.
 *
 * Only `kind: "ids"` rules reach this file. Extended rules are excluded by
 * exportRuleset and reported; see export.ts.
 */

import { IFC_CLASSES } from "./ifc-classes.ts";
import type {
  Applicability,
  AttributeFacet,
  ClassificationFacet,
  EntityFacet,
  IdsRule,
  IdsValue,
  IfcVersion,
  MaterialFacet,
  PartOfFacet,
  PropertyFacet,
  Requirements,
  Restriction,
  Ruleset,
} from "./types.ts";
import { el, textEl, toXmlDocument, type XmlNode } from "./xml.ts";

export const IDS_NAMESPACE = "http://standards.buildingsmart.org/IDS";
export const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
export const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

/** Expand a conceptual group into concrete class names, unioned over the
 *  schemas the rule declares. A class that only exists in one of them is still
 *  offered: the entity facet is checked per file, not per declaration. */
export function expandGroup(group: string, versions: IfcVersion[]): string[] {
  const out = new Set<string>();
  for (const version of versions) {
    const schema = IFC_CLASSES[version];
    const list = (schema.groups as Record<string, readonly string[]>)[group];
    if (list) for (const name of list) out.add(name);
  }
  return [...out].sort();
}

function restrictionNode(restriction: Restriction): XmlNode {
  const base = `xs:${restriction.base ?? "string"}`;
  const children: XmlNode[] = [];
  for (const value of restriction.enumeration ?? []) {
    children.push(el("xs:enumeration", { value }));
  }
  if (restriction.pattern !== undefined) {
    children.push(el("xs:pattern", { value: restriction.pattern }));
  }
  const bounds = [
    "minInclusive",
    "maxInclusive",
    "minExclusive",
    "maxExclusive",
    "length",
    "minLength",
    "maxLength",
  ] as const;
  for (const key of bounds) {
    const value = restriction[key];
    if (value !== undefined) children.push(el(`xs:${key}`, { value }));
  }
  return el("xs:restriction", { base }, children);
}

/** An ids:idsValue: either a simpleValue or an inline xs:restriction. */
function valueNode(tag: string, value: IdsValue): XmlNode {
  if (typeof value === "string") {
    return el(tag, undefined, [textEl("ids:simpleValue", value)]);
  }
  return el(tag, undefined, [restrictionNode(value.restriction)]);
}

/** Resolve the three authoring forms of an entity name into one IdsValue. */
export function entityNameValue(
  entity: EntityFacet,
  versions: IfcVersion[],
): IdsValue {
  if (entity.name !== undefined) return entity.name;
  const classes = entity.group
    ? expandGroup(entity.group, versions)
    : (entity.classes ?? []);
  if (classes.length === 1) return classes[0];
  return { restriction: { base: "string", enumeration: classes } };
}

function entityNode(
  tag: string,
  entity: EntityFacet,
  versions: IfcVersion[],
  attrs?: XmlNode["attrs"],
): XmlNode {
  const children = [valueNode("ids:name", entityNameValue(entity, versions))];
  if (entity.predefinedType !== undefined) {
    children.push(valueNode("ids:predefinedType", entity.predefinedType));
  }
  return el(tag, attrs, children);
}

function partOfNode(
  facet: PartOfFacet,
  versions: IfcVersion[],
  inRequirements: boolean,
): XmlNode {
  return el(
    "ids:partOf",
    {
      relation: facet.relation,
      cardinality: inRequirements ? facet.cardinality : undefined,
      instructions: inRequirements ? facet.instructions : undefined,
    },
    [entityNode("ids:entity", facet.entity, versions)],
  );
}

function classificationNode(facet: ClassificationFacet, inRequirements: boolean): XmlNode {
  const children: XmlNode[] = [];
  // XSD order inside classificationType: value then system.
  if (facet.value !== undefined) children.push(valueNode("ids:value", facet.value));
  children.push(valueNode("ids:system", facet.system));
  return el(
    "ids:classification",
    inRequirements
      ? { uri: facet.uri, cardinality: facet.cardinality, instructions: facet.instructions }
      : undefined,
    children,
  );
}

function attributeNode(facet: AttributeFacet, inRequirements: boolean): XmlNode {
  const children = [valueNode("ids:name", facet.name)];
  if (facet.value !== undefined) children.push(valueNode("ids:value", facet.value));
  return el(
    "ids:attribute",
    inRequirements
      ? { cardinality: facet.cardinality, instructions: facet.instructions }
      : undefined,
    children,
  );
}

function propertyNode(facet: PropertyFacet, inRequirements: boolean): XmlNode {
  const children = [
    valueNode("ids:propertySet", facet.propertySet),
    valueNode("ids:baseName", facet.baseName),
  ];
  if (facet.value !== undefined) children.push(valueNode("ids:value", facet.value));
  return el(
    "ids:property",
    inRequirements
      ? {
          dataType: facet.dataType,
          uri: facet.uri,
          cardinality: facet.cardinality,
          instructions: facet.instructions,
        }
      : { dataType: facet.dataType },
    children,
  );
}

function materialNode(facet: MaterialFacet, inRequirements: boolean): XmlNode {
  const children: XmlNode[] = [];
  if (facet.value !== undefined) children.push(valueNode("ids:value", facet.value));
  return el(
    "ids:material",
    inRequirements
      ? { uri: facet.uri, cardinality: facet.cardinality, instructions: facet.instructions }
      : undefined,
    children,
  );
}

function applicabilityNode(app: Applicability, versions: IfcVersion[]): XmlNode {
  const children: XmlNode[] = [];
  if (app.entity) children.push(entityNode("ids:entity", app.entity, versions));
  for (const f of app.partOf ?? []) children.push(partOfNode(f, versions, false));
  for (const f of app.classification ?? []) children.push(classificationNode(f, false));
  for (const f of app.attribute ?? []) children.push(attributeNode(f, false));
  for (const f of app.property ?? []) children.push(propertyNode(f, false));
  for (const f of app.material ?? []) children.push(materialNode(f, false));
  return el(
    "ids:applicability",
    { minOccurs: app.minOccurs, maxOccurs: app.maxOccurs },
    children,
  );
}

function requirementsNode(req: Requirements, versions: IfcVersion[]): XmlNode {
  const children: XmlNode[] = [];
  if (req.entity) {
    children.push(
      entityNode("ids:entity", req.entity, versions, {
        instructions: req.entity.instructions,
      }),
    );
  }
  for (const f of req.partOf ?? []) children.push(partOfNode(f, versions, true));
  for (const f of req.classification ?? []) children.push(classificationNode(f, true));
  for (const f of req.attribute ?? []) children.push(attributeNode(f, true));
  for (const f of req.property ?? []) children.push(propertyNode(f, true));
  for (const f of req.material ?? []) children.push(materialNode(f, true));
  return el("ids:requirements", { description: req.description }, children);
}

export function specificationNode(rule: IdsRule, fallback: IfcVersion[]): XmlNode {
  const versions = rule.ifcVersions ?? fallback;
  const children = [applicabilityNode(rule.applicability, versions)];
  if (rule.requirements) children.push(requirementsNode(rule.requirements, versions));
  return el(
    "ids:specification",
    {
      // Attribute order follows the XSD declaration order for readability only;
      // XML attribute order carries no meaning.
      name: rule.name,
      ifcVersion: versions.join(" "),
      identifier: rule.identifier,
      description: rule.description,
      instructions: rule.instructions,
    },
    children,
  );
}

function infoNode(ruleset: Ruleset): XmlNode {
  const info = ruleset.info ?? {};
  const children: XmlNode[] = [textEl("ids:title", info.title ?? ruleset.name)];
  const optional: [string, string | undefined][] = [
    ["ids:copyright", info.copyright],
    ["ids:version", info.version],
    ["ids:description", info.description ?? ruleset.description],
    ["ids:author", info.author],
    ["ids:date", info.date],
    ["ids:purpose", info.purpose],
    ["ids:milestone", info.milestone],
  ];
  for (const [tag, value] of optional) {
    if (value !== undefined && value !== "") children.push(textEl(tag, value));
  }
  return el("ids:info", undefined, children);
}

/** Emit the IDS document for the given rules. Callers pass only the rules that
 *  belong in it — exportRuleset does the selecting and reports the rest. */
export function emitIdsXml(ruleset: Ruleset, rules: IdsRule[]): string {
  const root = el(
    "ids:ids",
    {
      "xmlns:ids": IDS_NAMESPACE,
      "xmlns:xs": XSD_NAMESPACE,
      "xmlns:xsi": XSI_NAMESPACE,
      "xsi:schemaLocation": `${IDS_NAMESPACE} http://standards.buildingsmart.org/IDS/1.0/ids.xsd`,
    },
    [
      infoNode(ruleset),
      el(
        "ids:specifications",
        undefined,
        rules.map((rule) => specificationNode(rule, ruleset.ifcVersions)),
      ),
    ],
  );
  return toXmlDocument(root);
}
