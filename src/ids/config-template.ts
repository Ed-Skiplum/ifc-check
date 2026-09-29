/** The config template: the ruleset `examples/eks-config-template.xlsx` and
 *  its `public/` copy are written from (`node scripts/gen-config-template.ts`;
 *  the selftest asserts both files are current).
 *
 * One row of every part the workbook takes, so the agent filling it sees
 * each sheet's shape (docs/config-template.md). Every value a project must
 * supply is `<FROM PROJECT>`, so lint (`from-project`) refuses the template
 * until each one is filled or its row deleted. The storey matching ships
 * exact (tolerance 0 and 0, any-distance name window, 0 near window): the
 * tool's own matching until the project states its tolerances.
 */

import type { CodeSource, Ruleset, StoreyPlane } from "./types.ts";

const P = "<FROM PROJECT>";
const property = (): CodeSource => ({ property: { propertySet: P, name: P } });
/** A placeholder where a number goes: lint names it, the reader keeps it. */
const N = P as unknown as number;

export const CONFIG_TEMPLATE_FILE = "eks-config-template.xlsx";

export const CONFIG_TEMPLATE: Ruleset = {
  formatVersion: 2,
  name: P,
  description: P,
  ifcVersions: ["IFC2X3", "IFC4"],
  storeys: {
    reference: P,
    plane: P as StoreyPlane,
    tolerance: { aboveMm: 0, belowMm: 0 },
    nameWindowMm: null,
    nearMm: 0,
    levels: [{ name: P, elevation: N }],
    disciplines: [{ discipline: P, plane: P as StoreyPlane, tolerance: { aboveMm: 0, belowMm: 0 }, requireAllNames: true }],
  },
  disciplines: [{ code: P }],
  models: [{ label: P, discipline: P, group: P, ownerNames: [P], exempt: [P] }],
  projectLayer: {
    "ifc-schema": { reference: P, accepted: [P], recommended: [P] },
    phase: { reference: P, sources: [property()] },
    "material-product": { reference: P, mengdetype: [property()], product: [property()] },
  },
  rules: [
    {
      id: P,
      kind: "ids",
      name: P,
      reference: P,
      applicability: { entity: { group: "physicalElement" } },
      requirements: { property: [{ propertySet: P, baseName: P, cardinality: "required" }] },
    },
    {
      id: "system-classification",
      kind: "extended",
      mapping: "system-classification",
      name: P,
      reference: P,
      check: { type: "code-lookup", list: "ns3451", source: property(), extract: P },
    },
    {
      id: "component-classification",
      kind: "extended",
      mapping: "component-classification",
      name: P,
      reference: P,
      check: { type: "code-lookup", list: "ns3457-8", target: "occurrence", source: property(), extract: P },
    },
    {
      id: "progress-code",
      kind: "extended",
      mapping: "progress-code",
      name: P,
      reference: P,
      check: { type: "code-lookup", codes: [{ code: P, name: P, phase: P }], source: property(), extract: P },
    },
    {
      id: "copy-object",
      kind: "extended",
      name: P,
      reference: P,
      check: { type: "copy-object", source: property(), copy: [P], own: [P] },
    },
  ],
};
