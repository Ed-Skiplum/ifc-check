/** JSON Schema for the ruleset format, so an authored ruleset can be validated
 *  before it is run.
 *
 * Hand-maintained alongside types.ts — the two are the same contract stated
 * twice, and the round-trip in scripts/ids-cli.ts asserts that the shipped
 * sample validates against this schema.
 *
 * Write it to disk with:  node scripts/ids-cli.ts schema > ruleset.schema.json
 */

import { CODE_LIST_IDS } from "../codelists/index.ts";

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
    formatVersion: { const: 2 },
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
    storeys: {
      type: "object",
      additionalProperties: false,
      required: ["plane", "tolerance", "nameWindowMm", "nearMm", "levels"],
      description:
        "The project's floor config (Etasjeoppsett): the level table, the plane its " +
        "elevations are measured to, and how a file storey is matched to a level.",
      properties: {
        reference: { $ref: "#/$defs/reference" },
        plane: { $ref: "#/$defs/storeyPlane" },
        tolerance: { $ref: "#/$defs/storeyTolerance" },
        nameWindowMm: {
          oneOf: [{ type: "number", minimum: 0 }, { type: "null" }],
          description: "A same-named file storey is read as the level within this distance (mm); null = any distance.",
        },
        nearMm: {
          type: "number",
          minimum: 0,
          description: "A differently named file storey is read as the nearest level within this distance (mm).",
        },
        levels: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "elevation"],
            properties: {
              name: { type: "string", minLength: 1 },
              elevation: { type: "number", description: "Metres, measured to plane." },
            },
          },
        },
        disciplines: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["discipline", "plane", "tolerance", "requireAllNames"],
            properties: {
              discipline: { type: "string", minLength: 1 },
              plane: { $ref: "#/$defs/storeyPlane" },
              tolerance: { $ref: "#/$defs/storeyTolerance" },
              requireAllNames: { type: "boolean" },
            },
          },
        },
      },
    },
    disciplines: {
      type: "array",
      minItems: 1,
      description: "The project's discipline codes (fagkoder).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: {
          code: { type: "string", minLength: 1 },
          report: { const: false, description: "The discipline's models get no report of their own." },
        },
      },
    },
    models: {
      type: "array",
      minItems: 1,
      description: "What the project states per model file, keyed by label (file name without extension).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "discipline"],
        properties: {
          label: { type: "string", minLength: 1 },
          discipline: { type: "string", minLength: 1 },
          group: { type: "string", minLength: 1 },
          ownerNames: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          exempt: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        },
      },
    },
    projectLayer: {
      type: "object",
      additionalProperties: false,
      description:
        "This project's layer on the standard requirements, keyed by the requirement's " +
        "report id. A cascade named here is appended after the standard sources; an " +
        "accepted list replaces the standard's.",
      properties: {
        "ifc-schema": {
          type: "object",
          additionalProperties: false,
          properties: {
            reference: { $ref: "#/$defs/reference" },
            recommended: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", pattern: "^IFC\\d+(X\\d+)?$" },
              description: "Recommended schema families, a subset of the accepted: recommended passes, accepted only is a warn.",
            },
            accepted: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", pattern: "^IFC\\d+(X\\d+)?$" },
              description:
                "Accepted schema families (FILE_SCHEMA folded: 'IFC4 ADD2 TC1' is IFC4, " +
                "IFC4X3_ADD2 is IFC4X3). Replaces the standard's [IFC2X3, IFC4].",
            },
          },
        },
        phase: {
          type: "object",
          additionalProperties: false,
          properties: {
            reference: { $ref: "#/$defs/reference" },
            sources: {
              type: "array",
              minItems: 1,
              items: {
                oneOf: [
                  { $ref: "#/$defs/codeSource" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["progressCode"],
                    properties: { progressCode: { type: "object", additionalProperties: false } },
                    description: "The phase the object's MMI code implies (progress-code codes[].phase).",
                  },
                ],
              },
              description: "Read after Pset_*Common.Status, in this order.",
            },
          },
        },
        "material-product": {
          type: "object",
          additionalProperties: false,
          properties: {
            reference: { $ref: "#/$defs/reference" },
            mengdetype: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/codeSource" },
              description:
                "Read after the IFC class table and the NS 3457 code, in this order; a value " +
                "'telleobjekt' or 'mengdeobjekt' decides the switch.",
            },
            product: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/codeSource" },
              description:
                "A telleobjekt's product, read after Pset_ManufacturerTypeInformation " +
                "ModelReference and ArticleNumber, in this order.",
            },
            material: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/codeSource" },
              description:
                "A mengdeobjekt's material, read after IfcMaterial and IfcMaterialLayerSet, in this order.",
            },
          },
        },
      },
    },
    rules: { type: "array", items: { $ref: "#/$defs/rule" } },
  },

  $defs: {
    ifcVersion: { enum: ["IFC2X3", "IFC4", "IFC4X3_ADD2"] },

    reference: {
      type: "string",
      minLength: 1,
      description: "Where the requirement comes from: the BEP or manual section.",
    },

    storeyPlane: {
      enum: ["OKFG", "OKBD"],
      description: "OK ferdig gulv or OK bærende dekke.",
    },

    storeyTolerance: {
      type: "object",
      additionalProperties: false,
      required: ["aboveMm", "belowMm"],
      description: "Millimetres, file minus level. null = no limit that way; 0 and 0 = exact.",
      properties: {
        aboveMm: { oneOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        belowMm: { oneOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
      },
    },

    codeEntry: {
      type: "object",
      additionalProperties: false,
      required: ["code", "name"],
      properties: {
        code: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        phase: {
          type: "string",
          minLength: 1,
          description: "The phase the code implies. progress-code only.",
        },
      },
    },

    codeSource: {
      description:
        "Exactly one of attribute, property, classification or material. A property " +
        "is identified by set plus name; a classification reads the " +
        "schema-normalised identification (IFC4 Identification, IFC2x3 " +
        "ItemReference); material reads the names through IfcRelAssociatesMaterial.",
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["material"],
          properties: { material: { type: "object", additionalProperties: false } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["attribute"],
          properties: { attribute: { type: "string", minLength: 1 } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["property"],
          properties: {
            property: {
              type: "object",
              additionalProperties: false,
              required: ["propertySet", "name"],
              properties: {
                propertySet: { type: "string", minLength: 1 },
                name: { type: "string", minLength: 1 },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["classification"],
          properties: {
            classification: {
              type: "object",
              additionalProperties: false,
              properties: { system: { type: "string", minLength: 1 } },
            },
          },
        },
      ],
    },

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
        reference: { $ref: "#/$defs/reference" },
        instructions: { type: "string" },
        enabled: { const: false, description: "Present only to switch the rule off." },
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
        reference: { $ref: "#/$defs/reference" },
        instructions: { type: "string" },
        enabled: { const: false, description: "Present only to switch the rule off." },
        mapping: {
          enum: ["system-classification", "component-classification", "progress-code"],
          description:
            "Marks this code-lookup rule as one of the project mappings, at most one " +
            "rule per mapping. The two classifications take a list, progress-code " +
            "takes codes. The copy-object role is the copy-object check itself.",
        },
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
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "source", "extract"],
          oneOf: [{ required: ["list"] }, { required: ["codes"] }],
          description:
            "Extract a code from a value and look it up in a bundled code list, or " +
            "in the project's own codes. " +
            "Not IDS: a restriction tests the whole value. target 'type' checks " +
            "the types of the selected elements, one per type Name; a type no " +
            "element uses is not reachable.",
          properties: {
            type: { const: "code-lookup" },
            list: { enum: [...CODE_LIST_IDS] },
            codes: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/codeEntry" },
            },
            target: { enum: ["occurrence", "type"], default: "occurrence" },
            source: {
              $ref: "#/$defs/codeSource",
              description: "target 'type' takes an attribute source only.",
            },
            extract: {
              type: "string",
              minLength: 1,
              description:
                "JavaScript regular expression with exactly one capture group, the " +
                "code. Not anchored implicitly.",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "source", "copy", "own"],
          description:
            "The copy-object role, a scope filter: blank, an own value or one of " +
            "this model's ownerNames is the file's own object; a copy value or any " +
            "other value is a copy, excluded from every other rule. Compared " +
            "ignoring case and whitespace.",
          properties: {
            type: { const: "copy-object" },
            source: { $ref: "#/$defs/codeSource" },
            copy: { type: "array", items: { type: "string", minLength: 1 } },
            own: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      ],
    },

    rule: {
      oneOf: [{ $ref: "#/$defs/idsRule" }, { $ref: "#/$defs/extendedRule" }],
    },
  },
} as const;
