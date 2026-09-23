/** IFC structure and usability checks. Project-agnostic.
 *
 * Nothing here knows about a specific project's property sets, classification
 * system or delivery stage. These are the properties an IFC needs in order to
 * be usable at all — findable elements, a spatial tree that holds together,
 * identifiers that identify.
 *
 * Because they are universal they can be JUDGED on sight, with no ruleset:
 * three storeys all at kote 0 is a defect on any project, and a duplicate
 * GlobalId is a defect on any project. That judgement is `severity` plus
 * `state`, rendered as one of four verdicts by `verdictOf`. What a judgement
 * is NOT is a score: there is no composite number here and no grade, because
 * one number hiding twelve answers is exactly what the twelve answers are for.
 *
 * Every check also carries `displayValue` — the value it actually found. The
 * screen prints that value and colours it by the verdict, so a red block reads
 * `m` or `0 of 851` rather than just "bad".
 *
 * Several of these cannot be expressed as IDS 1.0 facets, which is why this
 * file exists rather than an .ids. An IDS facet asks a question about one
 * object at a time; "is this typed", "is this GlobalId unique" and "how many
 * elements share this type" are all cross-object questions. IDS 1.0 has no
 * IFCRELDEFINESBYTYPE in its relations enumeration and no uniqueness or
 * cardinality operator, so no version of an .ids file reaches them.
 */

import type {
  CheckResult,
  CheckSeverity,
  DisplayNoun,
  DisplayValue,
  Finding,
  IfcGraph,
  IfcSummary,
  ProductRow,
  ReasonCode,
  Verdict,
} from "./types";

/** English rendering of a reason code. The UI localises from the code; this
 *  keeps the CLI and the raw JSON readable without a lookup. */
const REASON_EN: Record<ReasonCode, (p: Record<string, string | number>) => string> = {
  "no-products":
    () =>
      "no products parsed — the file is empty, or its classes are not " +
      "recognised by the parser (see ifcfast#178)",
  "unit-unresolved": () => "length unit could not be resolved",
  "duplicate-step-ids": (p) => `${p.count} duplicate STEP ids`,
  "parser-warning": (p) => String(p.message),
  "not-in-storey": () => "not contained in a storey",
  "storey-not-in-building": () => "storey is not aggregated into a building",
  "spatial-level-missing": (p) => `no ${p.level} in the file`,
  "shared-elevation": (p) => `elevation shared with ${p.count} other storeys`,
  "name-empty": () => "Name is empty",
  "no-type": () => "no type object",
  "placeholder-type-name": (p) => `placeholder type name "${p.typeName}"`,
  "single-instance-type": (p) => `type "${p.typeName}" is used by one element`,
  "type-unused": () => "declared type object, used by no element",
  "no-material": () => "no material associated",
  "guid-duplicate": (p) => `GlobalId shared by ${p.count} elements`,
  "storey-mismatch": (p) =>
    `mesh bottom ${p.bottom} m, storey "${p.storey}" at ${p.elevation} m, expected "${p.expected}"`,
  "far-from-model": (p) => `mesh ${p.distance} m from the model's main body`,
  "storey-not-in-config": (p) => `"${p.storey}" at ${p.elevation} m is not in the floor config`,
  "storey-name-mismatch": (p) => `name "${p.storey}", config at this elevation is "${p.config}"`,
  "storey-elevation-mismatch": (p) => `elevation ${p.elevation} m, config ${p.config} m`,
  "storey-name-whitespace": (p) => `name "${p.storey}" matches "${p.config}" only after trimming whitespace`,
  "storey-duplicate-match": (p) => `second storey matching config floor "${p.config}"`,
  "storey-count-exceeds": (p) => `${p.count} storeys, config has ${p.config}`,
};

export function finding(
  el: { guid: string; entity: string; name: string | null },
  code: ReasonCode,
  params: Record<string, string | number> = {},
): Finding {
  return {
    guid: el.guid,
    entity: el.entity,
    name: el.name,
    code,
    ...(Object.keys(params).length ? { params } : {}),
    reason: REASON_EN[code](params),
  };
}

/* ------------------------------------------------------------ found value */

const NOUN_EN: Record<DisplayNoun, [one: string, many: string]> = {
  products: ["product", "products"],
  storeys: ["storey", "storeys"],
  types: ["type", "types"],
  stepIds: ["duplicate STEP id", "duplicate STEP ids"],
  levels: ["level", "levels"],
};

export function literal(text: string): DisplayValue {
  return { code: "literal", params: { text }, text };
}

export function share(good: number, total: number): DisplayValue {
  return { code: "share", params: { good, total }, text: `${good} of ${total}` };
}

function count(n: number, noun: DisplayNoun): DisplayValue {
  const [one, many] = NOUN_EN[noun];
  return { code: "count", params: { n, noun }, text: `${n} ${n === 1 ? one : many}` };
}

function unique(distinct: number, total: number): DisplayValue {
  return {
    code: "unique",
    params: { unique: distinct, total },
    text: `${distinct} unique`,
  };
}

function sharedElevation(
  shared: number,
  total: number,
  elevation: number | null,
  resolved: boolean,
): DisplayValue {
  const params: Record<string, string | number> = { shared, total, resolved: resolved ? 1 : 0 };
  if (elevation !== null) params.elevation = elevation;
  const at = elevation === null ? "" : `, all at ${elevation.toFixed(3)}${resolved ? " m" : ""}`;
  return {
    code: "shared-elevation",
    params,
    text: elevation === null ? `${shared} of ${total} share an elevation` : `${total} storeys${at}`,
  };
}

/** Openings are not physical elements; they are subtractions from one.
 *  `excluded` is the copy-object mapping's reference/copy objects (evaluate.ts
 *  `ModelResult.excludedGuids`) — out of scope for every check here exactly as
 *  for every ruleset rule, never a defect they can be found by. */
function physicalProducts(graph: IfcGraph, excluded?: ReadonlySet<string>): ProductRow[] {
  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  return graph.products.filter((p) => !openings.has(p.guid) && !excluded?.has(p.guid));
}

export function result(
  id: string,
  severity: CheckSeverity,
  applicable: number,
  findings: Finding[],
  displayValue: DisplayValue,
  detail: string,
  opts: { review?: boolean; naValue?: DisplayValue } = {},
): CheckResult {
  if (applicable === 0) {
    return {
      id,
      state: "not_applicable",
      severity,
      displayValue: opts.naValue ?? literal("—"),
      reason: "no elements matched this check",
      applicable: 0,
      findings: [],
      detail,
    };
  }
  const state = findings.length === 0 ? "pass" : opts.review ? "review" : "fail";
  return { id, state, severity, displayValue, applicable, findings, detail };
}

/** The word the screen prints. Derived, never stored (see `Verdict`).
 *
 * `review` is Advarsel by construction: a check that hands the question to a
 * human has not found a defect, and calling it one would be the punch in the
 * face this tool exists to avoid. A failing `advisory` check lands in the same
 * place for the same reason — the finding is real, the file is not broken.
 */
export function verdictOf(check: CheckResult): Verdict {
  if (check.state === "not_applicable") return "na";
  if (check.state === "pass") return "pass";
  if (check.state === "review") return "warn";
  return check.severity === "deviation" ? "fail" : "warn";
}

/* ------------------------------------------------------------ parse trust */

/** Not a check on the model's content, but on whether the parse is trustworthy.
 *
 * DEVIATION. An unresolved length unit or a duplicate STEP id is not a
 * maturity state a model passes through — it makes every number downstream
 * suspect, on any project, at any stage. A file the parser sees no products in
 * is the same claim at full strength.
 *
 * The found value is the length unit, because that is the one parse fact the
 * rest of the screen is denominated in. A harder fault outranks it: zero
 * products, then duplicate STEP ids.
 */
function checkParseIntegrity(summary: IfcSummary): CheckResult {
  const findings: Finding[] = [];
  // A file the parser sees no products in is a finding in itself, never a
  // quiet row of "not applicable". ifcfast currently drops whole classes it
  // does not whitelist — IfcGeographicElement among them (ifcfast#178) — and
  // the result is a model that reads as empty rather than as unsupported.
  if (summary.products === 0) {
    findings.push(finding({ guid: "-", entity: "IfcProduct", name: null }, "no-products"));
  }
  if (!summary.unit_resolved) {
    findings.push(
      finding({ guid: "-", entity: "IfcUnitAssignment", name: null }, "unit-unresolved"),
    );
  }
  if (summary.duplicate_step_ids > 0) {
    findings.push(
      finding({ guid: "-", entity: "STEP", name: null }, "duplicate-step-ids", {
        count: summary.duplicate_step_ids,
      }),
    );
  }
  for (const w of summary.warnings ?? []) {
    findings.push(
      finding({ guid: "-", entity: "parser", name: null }, "parser-warning", { message: w }),
    );
  }

  const value =
    summary.products === 0
      ? count(0, "products")
      : summary.duplicate_step_ids > 0
        ? count(summary.duplicate_step_ids, "stepIds")
        : literal(summary.length_unit || "—");

  return result(
    "parse-integrity",
    "deviation",
    1,
    findings,
    value,
    `${summary.length_unit}, unit scale ${summary.unit_scale}`,
  );
}

/* -------------------------------------------------------- spatial structure */

/** Project → Site → Building → Storey, all four present.
 *
 * DEVIATION. The chain is not a convention, it is what IFC's own spatial
 * decomposition is; a file missing a link in it cannot be federated, placed or
 * navigated by anything that reads the standard. Absent levels are named, so
 * the row says WHICH link is gone rather than that something is wrong.
 */
function checkSpatialChain(graph: IfcGraph): CheckResult {
  const levels: { level: string; size: number }[] = [
    { level: "IfcProject", size: graph.projects.length },
    { level: "IfcSite", size: graph.sites.length },
    { level: "IfcBuilding", size: graph.buildings.length },
    { level: "IfcBuildingStorey", size: graph.storeys.length },
  ];
  const findings = levels
    .filter((l) => l.size === 0)
    .map((l) =>
      finding({ guid: "-", entity: l.level, name: null }, "spatial-level-missing", {
        level: l.level,
      }),
    );
  const present = levels.length - findings.length;
  return result(
    "spatial-chain",
    "deviation",
    levels.length,
    findings,
    share(present, levels.length),
    `${present} of ${levels.length} spatial levels present ` +
      `(${levels.map((l) => `${l.level} ${l.size}`).join(", ")})`,
  );
}

function checkContained(graph: IfcGraph, products: ProductRow[]): CheckResult {
  const contained = new Set(graph.contained_in.map((c) => c.product_guid));
  const findings = products
    .filter((p) => !contained.has(p.guid))
    .map((p) => finding(p, "not-in-storey"));
  return result(
    // DEVIATION. An element outside the spatial hierarchy is invisible to
    // every storey filter, every discipline view and every CDE selection —
    // it is in the file and not in the building.
    "storey-containment",
    "deviation",
    products.length,
    findings,
    share(products.length - findings.length, products.length),
    `${products.length - findings.length} of ${products.length} elements sit in a storey`,
  );
}

function checkStoreyInBuilding(graph: IfcGraph): CheckResult {
  const linked = new Set(graph.storey_building.map((sb) => sb.storey_guid));
  const findings = graph.storeys
    .filter((s) => !linked.has(s.guid))
    .map((s) =>
      finding({ guid: s.guid, entity: "IfcBuildingStorey", name: s.name }, "storey-not-in-building"),
    );
  return result(
    // DEVIATION, same reason as containment one level up: a storey outside its
    // building breaks the decomposition the whole tree hangs from.
    "storey-in-building",
    "deviation",
    graph.storeys.length,
    findings,
    share(graph.storeys.length - findings.length, graph.storeys.length),
    `${graph.storeys.length - findings.length} of ${graph.storeys.length} storeys belong to a building`,
  );
}

/** Storeys must sit at distinct elevations.
 *
 * DEVIATION. Several storeys at one elevation means the storey heights were
 * never set — the export carries the names of the floors and none of their
 * positions. Everything derived from elevation is then wrong and silently so:
 * section placement, floor-by-floor quantities, kote on a drawing. It is a
 * defect on any project, at any stage, which is why it is judged here rather
 * than left as a badge on a table.
 *
 * Storeys with no elevation at all are excluded from the comparison: an absent
 * value cannot be shown to collide with another one. A file where that is
 * every storey reports not_applicable, never a pass.
 */
function checkStoreyElevation(graph: IfcGraph, summary: IfcSummary): CheckResult {
  const withElevation = graph.storeys.filter((s) => s.elevation !== null);
  const at = new Map<string, typeof withElevation>();
  for (const s of withElevation) {
    const key = (s.elevation as number).toFixed(6);
    const bucket = at.get(key);
    if (bucket) bucket.push(s);
    else at.set(key, [s]);
  }
  const findings: Finding[] = [];
  for (const bucket of at.values()) {
    if (bucket.length < 2) continue;
    for (const s of bucket) {
      findings.push(
        finding({ guid: s.guid, entity: "IfcBuildingStorey", name: s.name }, "shared-elevation", {
          count: bucket.length - 1,
        }),
      );
    }
  }

  // ifcfast reports elevation in FILE units while geometry is metres
  // (ifcfast#180), so it is scaled before it is printed.
  const only = at.size === 1 ? Number([...at.keys()][0]) * summary.unit_scale : null;
  const value =
    findings.length === 0
      ? count(withElevation.length, "storeys")
      : sharedElevation(findings.length, withElevation.length, only, summary.unit_resolved);

  return result(
    "storey-elevation",
    "deviation",
    withElevation.length,
    findings,
    value,
    `${at.size} distinct elevation(s) across ${withElevation.length} storeys`,
    { naValue: count(graph.storeys.length, "storeys") },
  );
}

/* ---------------------------------------------------------------- identity */

/** GlobalId must be unique across every rooted entity.
 *
 * DEVIATION. A duplicate breaks anything that keys on the GUID — CDE issue
 * tracking, model diffing, federated selection — and breaks it silently,
 * because each consumer simply keeps whichever one it saw last.
 */
function checkGuidUnique(graph: IfcGraph, excluded?: ReadonlySet<string>): CheckResult {
  const products = excluded ? graph.products.filter((p) => !excluded.has(p.guid)) : graph.products;
  const seen = new Map<string, ProductRow[]>();
  for (const p of products) {
    const bucket = seen.get(p.guid);
    if (bucket) bucket.push(p);
    else seen.set(p.guid, [p]);
  }
  const findings: Finding[] = [];
  for (const rows of seen.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      findings.push(finding(row, "guid-duplicate", { count: rows.length }));
    }
  }
  return result(
    "guid-unique",
    "deviation",
    products.length,
    findings,
    unique(seen.size, products.length),
    `${seen.size} distinct GlobalId across ${products.length} products`,
  );
}

/* --------------------------------------------------------------- maturity */

/** ADVISORY. An unnamed element is harder to work with and is also what a
 *  perfectly correct structural export from an analysis tool looks like: the
 *  identity lives on the Tag and the type, and Name was never authored. Real,
 *  worth seeing, not a defect in the file. */
function checkNamed(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.name || p.name.trim() === "")
    .map((p) => finding(p, "name-empty"));
  return result(
    "element-named",
    "advisory",
    products.length,
    findings,
    share(products.length - findings.length, products.length),
    `${products.length - findings.length} of ${products.length} elements carry a name`,
  );
}

/** ADVISORY. A work model has no types because it is a work model. Typing is
 *  a state a model reaches, not a property a valid IFC must already have, and
 *  a project that requires it says so in its ruleset — which is where the
 *  Avvik for it belongs. */
function checkTyped(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.typed)
    .map((p) => finding(p, "no-type"));
  return result(
    "element-typed",
    "advisory",
    products.length,
    findings,
    share(products.length - findings.length, products.length),
    `${products.length - findings.length} of ${products.length} elements linked to a type`,
  );
}

const PLACEHOLDER_TYPE_NAMES = new Set(["unnamed", "default"]);

/** ADVISORY. A type called "Default" still types its elements; what it fails
 *  to do is tell anyone what they are. A naming-quality fact. */
function checkTypeNames(products: ProductRow[]): CheckResult {
  const typed = products.filter((p) => p.typed && p.type_name);
  const findings = typed
    .filter((p) => PLACEHOLDER_TYPE_NAMES.has((p.type_name as string).trim().toLowerCase()))
    .map((p) => finding(p, "placeholder-type-name", { typeName: p.type_name as string }));
  return result(
    "type-name-placeholder",
    "advisory",
    typed.length,
    findings,
    share(typed.length - findings.length, typed.length),
    `${typed.length - findings.length} of ${typed.length} typed elements have a real type name`,
  );
}

/** A type used by exactly one element.
 *
 * ADVISORY, and `review` on top of it. Not a defect: a genuinely unique
 * component exists, and a shared concept can legitimately have cardinality one
 * in a given file. But it is also the signature of a per-instance throwaway
 * type, which is a real modelling fault. No rule can tell the two apart, so
 * this surfaces for a human instead of failing.
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
    .map(([typeName, rows]) => finding(rows[0], "single-instance-type", { typeName }));
  return result(
    "single-instance-types",
    "advisory",
    byType.size,
    findings,
    share(byType.size - findings.length, byType.size),
    `${findings.length} of ${byType.size} types used by exactly one element`,
    { review: true, naValue: count(byType.size, "types") },
  );
}

/** A type object the file DECLARES that no element is defined by.
 *
 * ADVISORY. An unused type is not a broken file: an authoring tool writes out
 * the whole of its loaded template, and a type the project has not placed yet is
 * a type waiting for its element. It is file weight, and it is what a reviewer
 * counting "the model has 398 types" is actually being shown, so it is surfaced
 * as its own number rather than folded into the type roster.
 *
 * It is a FUNDAMENTAL — the question is the same on every project and needs no
 * property set, classification or delivery stage to ask. Until ifcfast 0.5.3
 * exposed `typeObjectsJson()` and the products' `type_guid` it could not be
 * asked at all: the graph reached a type only through the elements using it,
 * which is exactly the set an unused type is not in.
 *
 * Three states, and the difference between the first two is the point:
 *   - the roster was not supplied (an older cache, a caller that read the graph
 *     alone)  ->  not_applicable, saying so. Never a pass.
 *   - the file declares no type objects at all  ->  not_applicable, saying
 *     THAT. A model with no types has no unused ones, which is not a clean
 *     bill of health about type structure.
 *   - the roster is there  ->  used of declared, one finding per unused type.
 *
 * `excluded` is not consulted: the copy-object filter scopes ELEMENTS, and a
 * type object is not an element. A type used only by excluded objects is still
 * a used type, and saying otherwise would make the number depend on a project
 * setting this check is deliberately independent of.
 */
function checkUnusedTypes(graph: IfcGraph): CheckResult {
  const declared = graph.type_objects;
  if (declared === undefined) {
    return {
      id: "type-unused",
      state: "not_applicable",
      severity: "advisory",
      displayValue: literal("—"),
      reason:
        "the declared type roster was not supplied with this graph " +
        "(typeObjectsJson), so used and unused types cannot be separated",
      applicable: 0,
      findings: [],
      detail: "no type roster",
    };
  }
  // ifcfast spells a type class `IfcWalltype` (ifcfast#186), so nothing here
  // compares `entity` to a class name; it is carried through for display only.
  const used = new Set<string>();
  for (const product of graph.products) {
    if (product.type_guid) used.add(product.type_guid);
  }
  const findings = declared
    .filter((type) => !used.has(type.guid))
    .map((type) => finding({ guid: type.guid, entity: type.entity, name: type.name }, "type-unused"));
  const result_ = result(
    "type-unused",
    "advisory",
    declared.length,
    findings,
    share(declared.length - findings.length, declared.length),
    `${declared.length - findings.length} of ${declared.length} declared type objects are used by an element`,
    { naValue: count(0, "types") },
  );
  if (result_.state === "not_applicable") {
    result_.reason = "the file declares no type objects";
    result_.detail = "no type objects declared";
  }
  return result_;
}

/** ADVISORY. Materials arrive when a model is detailed for quantities or LCA;
 *  a structural work model without them is at an earlier stage, not broken.
 *  The gap is surfaced because someone downstream is waiting for it. */
function checkMaterials(products: ProductRow[]): CheckResult {
  const findings = products
    .filter((p) => !p.materials || p.materials.length === 0)
    .map((p) => finding(p, "no-material"));
  return result(
    "element-material",
    "advisory",
    products.length,
    findings,
    share(products.length - findings.length, products.length),
    `${products.length - findings.length} of ${products.length} elements carry a material`,
  );
}

/** The order the verification block reads in: can the parse be trusted, does
 *  the structure hold, do the identifiers identify, then how far the model has
 *  been taken. Deviations first is deliberate — sorting by verdict would move
 *  a row every time a file changed. */
export function runFundamentals(
  graph: IfcGraph,
  summary: IfcSummary,
  excludedGuids?: ReadonlySet<string>,
): CheckResult[] {
  const excluded = excludedGuids && excludedGuids.size > 0 ? excludedGuids : undefined;
  const products = physicalProducts(graph, excluded);
  return [
    checkParseIntegrity(summary),
    checkSpatialChain(graph),
    checkContained(graph, products),
    checkStoreyInBuilding(graph),
    checkStoreyElevation(graph, summary),
    checkGuidUnique(graph, excluded),
    checkNamed(products),
    checkTyped(products),
    checkTypeNames(products),
    checkSingleInstanceTypes(products),
    checkUnusedTypes(graph),
    checkMaterials(products),
  ];
}
