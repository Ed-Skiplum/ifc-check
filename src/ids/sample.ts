/** A worked ruleset: one rule of every kind, used by the round-trip in
 *  scripts/ids-cli.ts and offered in the builder as a starting point.
 *
 * It is deliberately mixed: five rules export into the .ids, four cannot and
 * stay in the .ruleset.json. That is what makes the export report worth
 * reading.
 */

import type { Ruleset } from "./types.ts";

export const SAMPLE_RULESET: Ruleset = {
  formatVersion: 1,
  name: "Mottakskontroll",
  description: "Baseline reception control for an incoming discipline model.",
  ifcVersions: ["IFC4"],
  info: {
    title: "Mottakskontroll",
    version: "1.0",
    purpose: "Reception control",
  },
  rules: [
    {
      id: "one-site",
      kind: "ids",
      name: "The model has exactly one site",
      applicability: {
        minOccurs: 1,
        maxOccurs: 1,
        entity: { classes: ["IFCSITE"] },
      },
    },
    {
      id: "elements-named",
      kind: "ids",
      name: "Physical elements carry a name",
      instructions: "Name every element; an unnamed element cannot be referred to.",
      applicability: {
        entity: { group: "physicalElement" },
      },
      requirements: {
        attribute: [
          {
            name: "Name",
            value: { restriction: { minLength: 1 } },
            cardinality: "required",
          },
        ],
      },
    },
    {
      id: "elements-in-storey",
      kind: "ids",
      name: "Built elements sit in a storey",
      applicability: {
        entity: { group: "builtElement" },
      },
      requirements: {
        partOf: [
          {
            entity: { classes: ["IFCBUILDINGSTOREY"] },
            relation: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
            cardinality: "required",
          },
        ],
      },
    },
    {
      id: "storey-in-building",
      kind: "ids",
      name: "Storeys are aggregated into a building",
      applicability: {
        entity: { classes: ["IFCBUILDINGSTOREY"] },
      },
      requirements: {
        partOf: [
          {
            entity: { classes: ["IFCBUILDING"] },
            relation: "IFCRELAGGREGATES",
            cardinality: "required",
          },
        ],
      },
    },
    {
      id: "external-walls-fire-rated",
      kind: "ids",
      name: "External walls carry a fire rating",
      applicability: {
        entity: { classes: ["IFCWALL", "IFCWALLSTANDARDCASE"] },
        property: [{ propertySet: "Pset_WallCommon", baseName: "IsExternal", value: "true" }],
      },
      requirements: {
        property: [
          {
            propertySet: "Pset_WallCommon",
            baseName: "FireRating",
            dataType: "IFCLABEL",
            cardinality: "required",
          },
        ],
      },
    },
    {
      id: "walls-have-material",
      kind: "ids",
      name: "Walls carry a material",
      applicability: {
        entity: { classes: ["IFCWALL", "IFCWALLSTANDARDCASE"] },
      },
      requirements: {
        material: [{ cardinality: "required" }],
      },
    },
    {
      id: "elements-typed",
      kind: "extended",
      name: "Physical elements are linked to a type",
      select: { entity: { group: "physicalElement" } },
      check: { type: "element-typed" },
    },
    {
      id: "guid-unique",
      kind: "extended",
      name: "GlobalId is unique",
      select: { entity: { group: "product" } },
      check: { type: "unique-attribute", attribute: "GlobalId" },
    },
    {
      id: "no-types-of-one",
      kind: "extended",
      name: "No type is used by a single element",
      select: { entity: { group: "builtElement" } },
      check: { type: "type-usage-count", min: 2 },
    },
    {
      id: "length-unit-metre",
      kind: "extended",
      name: "The length unit is the metre",
      check: {
        type: "model-metadata",
        field: "length_unit",
        value: { restriction: { enumeration: ["METRE", "m"] } },
      },
    },
  ],
};
