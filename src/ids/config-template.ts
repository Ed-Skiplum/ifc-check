/** The config template: the ruleset `examples/eks-config-template.xlsx` and
 *  its `public/` copy are written from (`node scripts/gen-config-template.ts`;
 *  the selftest asserts both files are current).
 *
 * The same parts as the JSONC template in docs/agent-guide.md. Every value a
 * project must supply is `<FROM PROJECT>`, so lint (`from-project`) refuses the
 * template until each one is filled or its part deleted.
 */

import type { CodeSource, Ruleset } from "./types.ts";

const P = "<FROM PROJECT>";
const property = (): CodeSource => ({ property: { propertySet: P, name: P } });

export const CONFIG_TEMPLATE_FILE = "eks-config-template.xlsx";

export const CONFIG_TEMPLATE: Ruleset = {
  formatVersion: 1,
  name: P,
  description: P,
  ifcVersions: ["IFC2X3", "IFC4"],
  // A placeholder where a number goes: lint names it, the reader keeps it.
  storeys: [{ name: P, elevation: P as unknown as number }],
  projectLayer: {
    "ifc-schema": { accepted: [P] },
    phase: { sources: [property()] },
    "material-product": { mengdetype: [property()], product: [property()], material: [property()] },
  },
  rules: [
    {
      id: "system-classification",
      kind: "extended",
      mapping: "system-classification",
      name: P,
      description: P,
      check: { type: "code-lookup", list: "ns3451", source: property(), extract: P },
    },
    {
      id: "component-classification",
      kind: "extended",
      mapping: "component-classification",
      name: P,
      description: P,
      check: { type: "code-lookup", list: "ns3457-8", target: "occurrence", source: property(), extract: P },
    },
    {
      id: "progress-code",
      kind: "extended",
      mapping: "progress-code",
      name: P,
      description: P,
      check: { type: "code-lookup", values: [P], source: property(), extract: P },
    },
    {
      id: "copy-object",
      kind: "extended",
      mapping: "copy-object",
      name: P,
      description: P,
      check: { type: "code-lookup", values: ["true", "false"], source: property(), extract: P },
    },
  ],
};
