/** JSON Schema for the ruleset format, so an authored ruleset can be validated
 *  before it is run.
 *
 * Hand-maintained alongside types.ts — the two are the same contract stated
 * twice, and the round-trip in scripts/ids-cli.ts asserts that the shipped
 * sample validates against this schema.
 *
 * Write it to disk with:  node scripts/ids-cli.ts schema > ruleset.schema.json
 */

export const RULESET_SCHEMA_ID =
  "https://skiplum.no/ifc-check/ruleset.schema.json";

const idsValue = {
  description:
    "A value constraint: a literal string, or { restriction: { ... } } for an xs:restriction.",
  oneOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      additionalProperties: false,
      required: ["restriction"],
      properties: { restriction: { $ref: "#/$defs/restriction" } },
    },
  ],
} as const;

const entityFacet = {
  type: "object",
  additionalProperties: false,
  description:
    "Exactly one of classes, group or name. The IDS entity facet matches an " +
    "exact class and never a subtype, so an abstract class matches nothing.",
  properties: {
    classes: {
      type: "array",
      minItems: 1,
      items: { type: "string", pattern: "^IFC[A-Z0-9]+$" },
      description: "Concrete IFC class names, uppercase.",
    },
    group: {
      $ref: "#/$defs/classGroup",
      description:
        "Conceptual group, expanded to an explicit enumeration of concrete classes at emit time.",
    },
    name: { $ref: "#/$defs/idsValue" },
    predefinedType: { $ref: "#/$defs/idsValue" },
  },
  oneOf: [
    { required: ["classes"] },
    { required: ["group"] },
    { required: ["name"] },
  ],
} as const;

const cardinality = {
  enum: ["required", "optional", "prohibited"],
  description: "Default required.",
};

const simpleCardinality = {
  enum: ["required", "prohibited"],
  description: "XSD simpleCardinality: optional is not allowed on partOf.",
};

const instructions = { type: "string" };
const uri = { type: "string" };

/** The facet bodies, without the attributes that belong to requirements only.
 *  Two variants are derived from each: an applicability/select facet carries the
 *  body alone, a requirements facet adds cardinality, instructions and uri.
 *  Keeping them as separate definitions is what makes "cardinality on an
 *  applicability facet" unrepresentable rather than merely linted. */
const FACET_BODIES = {
  partOf: {
    required: ["entity"],
    properties: {
      entity: { $ref: "#/$defs/entityFacet" },
      relation: {
        enum: [
          "IFCRELAGGREGATES",
          "IFCRELASSIGNSTOGROUP",
          "IFCRELCONTAINEDINSPATIALSTRUCTURE",
          "IFCRELNESTS",
          "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT",
        ],
        description:
          "The complete IDS 1.0 enumeration. There is no IFCRELDEFINESBYTYPE.",
      },
    },
    requirementExtras: { cardinality: simpleCardinality, instructions },
  },
  classification: {
    required: ["system"],
    properties: {
      system: { $ref: "#/$defs/idsValue" },
      value: { $ref: "#/$defs/idsValue" },
    },
    requirementExtras: { cardinality, instructions, uri },
  },
  attribute: {
    required: ["name"],
    properties: {
      name: { $ref: "#/$defs/idsValue" },
      value: { $ref: "#/$defs/idsValue" },
    },
    requirementExtras: { cardinality, instructions },
  },
  property: {
    required: ["propertySet", "baseName"],
    properties: {
      propertySet: { $ref: "#/$defs/idsValue" },
      baseName: { $ref: "#/$defs/idsValue" },
      value: { $ref: "#/$defs/idsValue" },
      dataType: {
        type: "string",
        pattern: "^[A-Z]+$",
        description: "An IFC defined type, ALL UPPERCASE, e.g. IFCLABEL.",
      },
    },
    requirementExtras: { cardinality, instructions, uri },
  },
  material: {
    required: [],
    properties: { value: { $ref: "#/$defs/idsValue" } },
    requirementExtras: { cardinality, instructions, uri },
  },
} as const;

type FacetName = keyof typeof FACET_BODIES;
const FACET_NAMES = Object.keys(FACET_BODIES) as FacetName[];

function facetDef(name: FacetName, where: "applicability" | "requirement") {
  const body = FACET_BODIES[name];
  return {
    type: "object",
    additionalProperties: false,
    ...(body.required.length > 0 ? { required: [...body.required] } : {}),
    properties:
      where === "requirement"
        ? { ...body.properties, ...body.requirementExtras }
        : { ...body.properties },
  };
}

function facetDefs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of FACET_NAMES) {
    out[`${name}Facet`] = facetDef(name, "applicability");
    out[`${name}Requirement`] = facetDef(name, "requirement");
  }
  return out;
}

function facetBags(where: "applicability" | "requirement"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of FACET_NAMES) {
    out[name] = {
      type: "array",
      items: { $ref: `#/$defs/${name}${where === "requirement" ? "Requirement" : "Facet"}` },
    };
  }
  return out;
}

export const RULESET_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RULESET_SCHEMA_ID,
  title: "ifc-check ruleset",
  description:
    "A model-checking ruleset. A superset of buildingSMART IDS 1.0: kind 'ids' " +
    "rules export into a valid .ids, kind 'extended' rules cannot be expressed " +
    "in IDS 1.0 and live in this file only.",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "name", "ifcVersions", "rules"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    ifcVersions: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/ifcVersion" },
      description:
        "Default ifcVersion list for every ids rule. Metadata in the .ids: it " +
        "does NOT gate which files a rule runs against.",
    },
    info: { $ref: "#/$defs/info" },
    rules: { type: "array", items: { $ref: "#/$defs/rule" } },
  },

  $defs: {
    ifcVersion: { enum: ["IFC2X3", "IFC4", "IFC4X3_ADD2"] },

    classGroup: {
      enum: [
        "product",
        "element",
        "physicalElement",
        "builtElement",
        "distributionElement",
        "spatialElement",
        "featureElement",
        "elementType",
        "typeProduct",
        "group",
      ],
    },

    restriction: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        base: {
          enum: [
            "string",
            "boolean",
            "integer",
            "double",
            "decimal",
            "date",
            "dateTime",
            "duration",
          ],
          default: "string",
        },
        enumeration: { type: "array", minItems: 1, items: { type: "string" } },
        pattern: {
          type: "string",
          description: "XSD regular expression. XSD anchors implicitly.",
        },
        minInclusive: { type: "number" },
        maxInclusive: { type: "number" },
        minExclusive: { type: "number" },
        maxExclusive: { type: "number" },
        length: { type: "integer", minimum: 0 },
        minLength: { type: "integer", minimum: 0 },
        maxLength: { type: "integer", minimum: 0 },
      },
    },

    idsValue,
    entityFacet,
    entityRequirement: {
      ...entityFacet,
      properties: { ...entityFacet.properties, instructions: { type: "string" } },
      description:
        "An entity facet in requirements. The XSD gives it instructions only: " +
        "there is no cardinality, it is always required.",
    },

    ...facetDefs(),

    applicability: {
      type: "object",
      additionalProperties: false,
      description:
        "minOccurs/maxOccurs belong here, never on the rule: the XSD rejects " +
        "them on <specification>.",
      properties: {
        minOccurs: { type: "integer", minimum: 0 },
        maxOccurs: {
          oneOf: [{ type: "integer", minimum: 0 }, { const: "unbounded" }],
        },
        entity: { $ref: "#/$defs/entityFacet" },
        ...facetBags("applicability"),
      },
    },

    selector: {
      type: "object",
      additionalProperties: false,
      description: "Same facets as an applicability, without occurrence bounds.",
      properties: {
        entity: { $ref: "#/$defs/entityFacet" },
        ...facetBags("applicability"),
      },
    },

    requirements: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string" },
        entity: {
          $ref: "#/$defs/entityRequirement",
          description:
            "A requirements entity facet takes no cardinality; it is always required.",
        },
        ...facetBags("requirement"),
      },
    },

    info: {
      type: "object",
      additionalProperties: false,
      description: "The <info> block of the emitted .ids.",
      properties: {
        title: { type: "string" },
        copyright: { type: "string" },
        version: { type: "string" },
        description: { type: "string" },
        author: {
          type: "string",
          pattern: "^[^@]+@[^.]+\\..+$",
          description: "The XSD requires an e-mail address here.",
        },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        purpose: { type: "string" },
        milestone: { type: "string" },
      },
    },

    idsRule: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "name", "applicability"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { const: "ids" },
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        instructions: { type: "string" },
        enabled: { type: "boolean", default: true },
        ifcVersions: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/ifcVersion" },
        },
        identifier: { type: "string" },
        applicability: { $ref: "#/$defs/applicability" },
        requirements: { $ref: "#/$defs/requirements" },
      },
    },

    extendedRule: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "name", "check"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { const: "extended" },
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        instructions: { type: "string" },
        enabled: { type: "boolean", default: true },
        select: { $ref: "#/$defs/selector" },
        check: { $ref: "#/$defs/extendedCheck" },
      },
    },

    extendedCheck: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          description:
            "Every selected element must be linked to an IfcTypeObject. Not IDS: " +
            "IFCRELDEFINESBYTYPE is absent from the relations enumeration.",
          properties: { type: { const: "element-typed" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "attribute"],
          description:
            "Attribute values must be unique. Not IDS: no cross-instance operator.",
          properties: {
            type: { const: "unique-attribute" },
            attribute: {
              enum: ["GlobalId", "Name", "Tag", "ObjectType", "PredefinedType"],
            },
            scope: { enum: ["model", "class"], default: "model" },
            ignoreEmpty: { type: "boolean", default: true },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          anyOf: [{ required: ["min"] }, { required: ["max"] }],
          description:
            "Each distinct type name must be used by between min and max elements. " +
            "min 2 is 'no types-of-one'. Not IDS: counting is cross-instance.",
          properties: {
            type: { const: "type-usage-count" },
            min: { type: "integer", minimum: 0 },
            max: { type: "integer", minimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "field", "value"],
          description:
            "A model-level fact must satisfy a restriction. Not IDS: no facet " +
            "reaches the header, IfcUnitAssignment or the parse statistics.",
          properties: {
            type: { const: "model-metadata" },
            field: {
              enum: [
                "schema",
                "length_unit",
                "unit_scale",
                "unit_resolved",
                "authoring_app",
                "project_name",
                "duplicate_step_ids",
              ],
            },
            value: { $ref: "#/$defs/idsValue" },
          },
        },
      ],
    },

    rule: {
      oneOf: [{ $ref: "#/$defs/idsRule" }, { $ref: "#/$defs/extendedRule" }],
    },
  },
} as const;
