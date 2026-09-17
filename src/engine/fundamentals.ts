/** IFC structure and usability checks. Project-agnostic.
 *
 * Nothing here knows about a specific project's property sets, classification
 * system or delivery stage. These are the properties an IFC needs in order to
 * be usable at all — findable elements, a spatial tree that holds together,
 * identifiers that identify.
 *
 * Several of these cannot be expressed as IDS 1.0 facets, which is why this
 * file exists rather than an .ids. An IDS facet asks a question about one
 * object at a time; "is this typed", "is this GlobalId unique" and "how many
 * elements share this type" are all cross-object questions. IDS 1.0 has no
 * IFCRELDEFINESBYTYPE in its relations enumeration and no uniqueness or
 * cardinality operator, so no version of an .ids file reaches them.
 */

import type { CheckResult, Finding, IfcGraph, IfcSummary, ProductRow } from "./types";

/** Openings are not physical elements; they are subtractions from one. */
function physicalProducts(graph: IfcGraph): ProductRow[] {
  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  return graph.products.filter((p) => !openings.has(p.guid));
}

function result(
  id: string,
  applicable: number,
  findings: Finding[],
  detail: string,
  opts: { review?: boolean } = {},
): CheckResult {
  if (applicable === 0) {
    return {
      id,
      state: "not_applicable",
      reason: "no elements matched this check",
      applicable: 0,
      findings: [],
      detail,
    };
  }
  const state = findings.length === 0 ? "pass" : opts.review ? "review" : "fail";
  return { id, state, applicable, findings, detail };
}

function checkContained(graph: IfcGraph, products: ProductRow[]): CheckResult {
  const contained = new Set(graph.contained_in.map((c) => c.product_guid));
  const findings = products
    .filter((p) => !contained.has(p.guid))
    .map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      reason: "not contained in a storey",
    }));
  return result(
    "storey-containment",
    products.length,
    findings,
    `${products.length - findings.length} of ${products.length} elements sit in a storey`,
  );
}

function checkStoreyInBuilding(graph: IfcGraph): CheckResult {
  const linked = new Set(graph.storey_building.map((sb) => sb.storey_guid));
  const findings = graph.storeys
    .filter((s) => !linked.has(s.guid))
    .map((s) => ({
      guid: s.guid,
      entity: "IfcBuildingStorey",
      name: s.name,
      reason: "storey is not aggregated into a building",
    }));
  return result(
    "storey-in-building",
    graph.storeys.length,
    findings,
    `${graph.storeys.length - findings.length} of ${graph.storeys.length} storeys belong to a building`,
  );
}

function checkNamed(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.name || p.name.trim() === "")
    .map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      reason: "Name is empty",
    }));
  return result(
    "element-named",
    products.length,
    findings,
    `${products.length - findings.length} of ${products.length} elements carry a name`,
  );
}

function checkTyped(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.typed)
    .map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      reason: "no type object",
    }));
  return result(
    "element-typed",
    products.length,
    findings,
    `${products.length - findings.length} of ${products.length} elements linked to a type`,
  );
}

const PLACEHOLDER_TYPE_NAMES = new Set(["unnamed", "default"]);

function checkTypeNames(products: ProductRow[]): CheckResult {
  const typed = products.filter((p) => p.typed && p.type_name);
  const findings = typed
    .filter((p) => PLACEHOLDER_TYPE_NAMES.has((p.type_name as string).trim().toLowerCase()))
    .map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      reason: `placeholder type name "${p.type_name}"`,
    }));
  return result(
    "type-name-placeholder",
    typed.length,
    findings,
    `${typed.length - findings.length} of ${typed.length} typed elements have a real type name`,
  );
}

/** A type used by exactly one element.
 *
 * Not a defect: a genuinely unique component exists, and a shared concept can
 * legitimately have cardinality one in a given file. But it is also the
 * signature of a per-instance throwaway type, which is a real modelling fault.
 * No rule can tell the two apart, so this surfaces for a human instead of
 * failing.
 */
function checkSingleInstanceTypes(products: ProductRow[]): CheckResult {
  const byType = new Map<string, ProductRow[]>();
  for (const p of products) {
    if (!p.typed || !p.type_name) continue;
    const key = p.type_name;
    const bucket = byType.get(key);
    if (bucket) bucket.push(p);
    else byType.set(key, [p]);
  }
  const findings = [...byType.entries()]
    .filter(([, rows]) => rows.length === 1)
    .map(([typeName, rows]) => ({
      guid: rows[0].guid,
      entity: rows[0].entity,
      name: rows[0].name,
      reason: `type "${typeName}" is used by one element`,
    }));
  return result(
    "single-instance-types",
    byType.size,
    findings,
    `${findings.length} of ${byType.size} types used by exactly one element`,
    { review: true },
  );
}

function checkMaterials(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.materials || p.materials.length === 0)
    .map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      reason: "no material associated",
    }));
  return result(
    "element-material",
    products.length,
    findings,
    `${products.length - findings.length} of ${products.length} elements carry a material`,
  );
}

/** GlobalId must be unique across every rooted entity.
 *
 * A duplicate breaks anything that keys on the GUID — CDE issue tracking,
 * model diffing, federated selection — and breaks it silently, because each
 * consumer simply keeps whichever one it saw last.
 */
function checkGuidUnique(graph: IfcGraph): CheckResult {
  const seen = new Map<string, ProductRow[]>();
  for (const p of graph.products) {
    const bucket = seen.get(p.guid);
    if (bucket) bucket.push(p);
    else seen.set(p.guid, [p]);
  }
  const findings: Finding[] = [];
  for (const [guid, rows] of seen) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      findings.push({
        guid,
        entity: row.entity,
        name: row.name,
        reason: `GlobalId shared by ${rows.length} elements`,
      });
    }
  }
  return result(
    "guid-unique",
    graph.products.length,
    findings,
    `${seen.size} distinct GlobalId across ${graph.products.length} products`,
  );
}

/** Not a check on the model's content, but on whether the parse is trustworthy.
 *
 * ifcfast reports unresolved units and duplicate STEP ids on the summary. Both
 * mean every downstream number is suspect, so they are surfaced rather than
 * left in a field nobody reads.
 */
function checkParseIntegrity(summary: IfcSummary): CheckResult {
  const findings: Finding[] = [];
  // A file the parser sees no products in is a finding in itself, never a
  // quiet row of "not applicable". ifcfast currently drops whole classes it
  // does not whitelist — IfcGeographicElement among them (ifcfast#178) — and
  // the result is a model that reads as empty rather than as unsupported.
  if (summary.products === 0) {
    findings.push({
      guid: "-",
      entity: "IfcProduct",
      name: null,
      reason:
        "no products parsed — the file is empty, or its classes are not " +
        "recognised by the parser (see ifcfast#178)",
    });
  }
  if (!summary.unit_resolved) {
    findings.push({
      guid: "-",
      entity: "IfcUnitAssignment",
      name: null,
      reason: "length unit could not be resolved",
    });
  }
  if (summary.duplicate_step_ids > 0) {
    findings.push({
      guid: "-",
      entity: "STEP",
      name: null,
      reason: `${summary.duplicate_step_ids} duplicate STEP ids`,
    });
  }
  for (const w of summary.warnings ?? []) {
    findings.push({ guid: "-", entity: "parser", name: null, reason: w });
  }
  return result(
    "parse-integrity",
    1,
    findings,
    `${summary.length_unit}, unit scale ${summary.unit_scale}`,
  );
}

export function runFundamentals(graph: IfcGraph, summary: IfcSummary): CheckResult[] {
  const products = physicalProducts(graph);
  return [
    checkParseIntegrity(summary),
    checkContained(graph, products),
    checkStoreyInBuilding(graph),
    checkNamed(products),
    checkTyped(products),
    checkTypeNames(products),
    checkSingleInstanceTypes(products),
    checkMaterials(products),
    checkGuidUnique(graph),
  ];
}
