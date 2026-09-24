/** The headless entry point for rulesets. Not a test harness — this is how a
 *  ruleset is linted, exported, schema-validated and run without a browser.
 *
 * Node 24 strips the types natively, so there is no build step.
 *
 *   node scripts/ids-cli.ts schema                     > ruleset.schema.json
 *   node scripts/ids-cli.ts sample                     > my.ruleset.json
 *   node scripts/ids-cli.ts lint   my.ruleset.json
 *   node scripts/ids-cli.ts emit   my.ruleset.json --out dist-rules
 *   node scripts/ids-cli.ts run    my.ruleset.json model.ifc [...]
 *   node scripts/ids-cli.ts report [--ruleset my.ruleset.json] model.ifc [...]
 *   node scripts/ids-cli.ts selftest
 *
 * Every command writes one JSON document to stdout. Progress and errors go to
 * stderr, so stdout is always machine-readable.
 *
 * Exit codes
 *   0  clean
 *   1  the thing being checked failed: lint errors, invalid .ids, rule failures
 *   2  usage error, unreadable file, or an internal error
 *   3  nothing failed, but at least one rule could not be evaluated
 *
 * `report` prints the report contract (src/engine/report.ts, AGENTS.md
 * "Report contract"): one row per requirement × model, fundamentals plus
 * `storey-config` plus `mesh-placement` plus the ruleset's rules. Same exit
 * scale: 1 when a row is `fail` or a model could not be read, 3 when a row is
 * `not_evaluable`, else 0.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { validateXML } from "xmllint-wasm";

import { evaluateRuleset } from "../src/ids/evaluate.ts";
import { exportRuleset, partitionRules } from "../src/ids/export.ts";
import { BOOLEAN_VALUES, hasErrors, lintRuleset } from "../src/ids/lint.ts";
import { RULESET_JSON_SCHEMA } from "../src/ids/schema.ts";
import { SAMPLE_RULESET } from "../src/ids/sample.ts";
import { createIdsValidator, type SchemaSources } from "../src/ids/validate.ts";
import type { Ruleset } from "../src/ids/types.ts";
import type { ModelGraph, ModelSummary } from "../src/ids/model.ts";
import { runFundamentals } from "../src/engine/fundamentals.ts";
import {
  checkMeshPlacement,
  collectBoxes,
  storeyBand,
  unshiftBoxes,
  type ElementBox,
} from "../src/engine/placement.ts";
import { checkStoreyConfig } from "../src/engine/storey-config.ts";
import { reportExitCode, reportRows, type ReportRow } from "../src/engine/report.ts";
import { schemaFamily } from "../src/engine/standard-layer.ts";
import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";

process.stdout.setDefaultEncoding?.("utf8");

const schemaDir = new URL("../vendor/ids-schema/", import.meta.url);
const wasmDir = new URL("../vendor/ifcfast-wasm/", import.meta.url);

function readSchemaFile(name: string): string {
  return readFileSync(new URL(name, schemaDir), "utf8");
}

function schemaSources(): SchemaSources {
  return {
    ids: readSchemaFile("ids.xsd"),
    xml: readSchemaFile("xml.xsd"),
    xmlSchema: readSchemaFile("XMLSchema.xsd"),
    xmlSchemaDtd: readSchemaFile("XMLSchema.dtd"),
    datatypesDtd: readSchemaFile("datatypes.dtd"),
  };
}

const validateIds = createIdsValidator(schemaSources(), validateXML as never);

/** JSON Schema validation of the ruleset document itself, so an authored file
 *  is checked against the published contract before anything reads it. */
const AjvCtor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateRulesetShape = ajv.compile(RULESET_JSON_SCHEMA as object);

interface ShapeIssue {
  path: string;
  message: string;
}

function shapeErrors(ruleset: unknown): ShapeIssue[] {
  if (validateRulesetShape(ruleset)) return [];
  return (validateRulesetShape.errors ?? []).map((e) => ({
    path: e.instancePath === "" ? "/" : e.instancePath,
    message: `${e.message ?? "invalid"}${e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : ""}`,
  }));
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function note(line: string): void {
  process.stderr.write(line + "\n");
}

function fail(message: string): never {
  note(`ids-cli: ${message}`);
  process.exit(2);
}

function loadRuleset(path: string | undefined): Ruleset {
  if (!path) fail("no ruleset path given");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Ruleset;
  } catch (error) {
    return fail(`cannot read ruleset ${path}: ${(error as Error).message}`);
  }
}

const VALUE_FLAGS = ["--out", "--max-findings", "--ruleset"];

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Positional arguments: everything that is neither a flag nor a flag's value. */
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.includes(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/* ------------------------------------------------------------------ lint */

async function cmdLint(args: string[]): Promise<number> {
  const ruleset = loadRuleset(positionals(args)[0]);
  const shape = shapeErrors(ruleset);
  const issues = lintRuleset(ruleset);
  emit({
    command: "lint",
    ruleset: ruleset.name,
    rules: ruleset.rules?.length ?? 0,
    schemaValid: shape.length === 0,
    schemaErrors: shape,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    issues,
  });
  return hasErrors(issues) || shape.length > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ emit */

async function cmdEmit(args: string[]): Promise<number> {
  const ruleset = loadRuleset(positionals(args)[0]);
  const issues = lintRuleset(ruleset);
  if (hasErrors(issues)) {
    emit({
      command: "emit",
      ruleset: ruleset.name,
      written: [],
      lint: issues,
      error: "lint errors; nothing was written",
    });
    return 1;
  }

  const result = exportRuleset(ruleset);
  const validation =
    result.ids === null
      ? null
      : await validateIds(result.ids, result.idsFileName);

  const outDir = flagValue(args, "--out");
  const written: string[] = [];
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    if (result.ids !== null) {
      const path = join(outDir, result.idsFileName);
      writeFileSync(path, result.ids, "utf8");
      written.push(path);
    }
    const rulesetPath = join(outDir, result.rulesetFileName);
    writeFileSync(rulesetPath, result.rulesetJson, "utf8");
    written.push(rulesetPath);
  }

  emit({
    command: "emit",
    ruleset: ruleset.name,
    idsFileName: result.idsFileName,
    rulesetFileName: result.rulesetFileName,
    includedRuleIds: result.includedRuleIds,
    excluded: result.excluded,
    validation:
      validation === null
        ? { ran: false, reason: "no rule was expressible in IDS, so no .ids was produced" }
        : { ran: true, valid: validation.valid, errors: validation.errors },
    written,
    lint: issues,
    ids: outDir ? undefined : result.ids,
  });
  if (result.ids === null) return 1;
  return validation && validation.valid ? 0 : 1;
}

/* ------------------------------------------------------------------- run */

interface WasmModel {
  streamMeshes(batch: number, onBatch: (metaJson: string, positions: Float32Array) => void): void;
  streamShiftJson(): string;
  summaryJson(): string;
  graphJson(): string;
  psetsJson(): string;
  classificationsJson(): string;
  quantitiesJson(): string;
  typeObjectsJson(): string;
  free(): void;
}

async function loadWasm(): Promise<{
  fromBytes(bytes: Uint8Array, name: string): WasmModel;
}> {
  const glue = new URL("ifcfast_wasm.js", wasmDir).href;
  const mod = (await import(glue)) as {
    IfcModel: { fromBytes(bytes: Uint8Array, name: string): WasmModel };
    initSync(init: { module: BufferSource }): unknown;
  };
  mod.initSync({ module: readFileSync(new URL("ifcfast_wasm_bg.wasm", wasmDir)) });
  return mod.IfcModel;
}

async function cmdRun(args: string[]): Promise<number> {
  const paths = positionals(args);
  const ruleset = loadRuleset(paths[0]);
  const issues = lintRuleset(ruleset);
  if (hasErrors(issues)) {
    emit({ command: "run", ruleset: ruleset.name, models: [], lint: issues, error: "lint errors" });
    return 1;
  }
  const modelPaths = paths.slice(1);
  if (modelPaths.length === 0) fail("run needs at least one .ifc path");
  const maxFindings = Number(flagValue(args, "--max-findings") ?? 0);

  const IfcModel = await loadWasm();
  const models = [];
  for (const path of modelPaths) {
    const name = basename(path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      models.push({ model: name, error: (error as Error).message });
      continue;
    }
    try {
      const parsed = IfcModel.fromBytes(new Uint8Array(bytes), name);
      const summary = JSON.parse(parsed.summaryJson()) as ModelSummary;
      const graph = JSON.parse(parsed.graphJson()) as ModelGraph;
      // Property sets and classifications are not in `graphJson()`. Attaching
      // them here is what makes a property or classification facet evaluable
      // from the shell, exactly as the browser worker attaches them — one
      // evaluator, one model shape, no second code path to drift.
      graph.psets = JSON.parse(parsed.psetsJson());
      graph.classifications = JSON.parse(parsed.classificationsJson());
      graph.quantities = JSON.parse(parsed.quantitiesJson());
      graph.type_objects = JSON.parse(parsed.typeObjectsJson());
      parsed.free();
      models.push(evaluateRuleset(ruleset, graph, summary, name, { maxFindings }));
    } catch (error) {
      models.push({ model: name, error: (error as Error).message });
    }
  }

  const totals = { pass: 0, fail: 0, not_applicable: 0, not_evaluable: 0, error: 0 };
  for (const model of models) {
    if ("error" in model) {
      totals.error += 1;
      continue;
    }
    for (const key of ["pass", "fail", "not_applicable", "not_evaluable"] as const) {
      totals[key] += model.counts[key];
    }
  }
  emit({ command: "run", ruleset: ruleset.name, totals, models, lint: issues });

  if (totals.fail > 0 || totals.error > 0) return 1;
  return totals.not_evaluable > 0 ? 3 : 0;
}

/* ---------------------------------------------------------------- report */

/** Write one document as UTF-8 bytes and wait until the stream has taken it,
 *  so `process.exit` cannot cut a large document short on a pipe and no
 *  console code page decides how æøå are encoded. */
function emitUtf8(value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  return new Promise((resolve, reject) => {
    process.stdout.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

async function cmdReport(args: string[]): Promise<number> {
  const rulesetPath = flagValue(args, "--ruleset");
  const ruleset = rulesetPath === undefined ? null : loadRuleset(rulesetPath);
  const lint = ruleset ? lintRuleset(ruleset) : [];
  if (ruleset && hasErrors(lint)) {
    await emitUtf8({ command: "report", ruleset: ruleset.name, rows: [], errors: [], lint, error: "lint errors" });
    return 1;
  }
  const modelPaths = positionals(args);
  if (modelPaths.length === 0) fail("report needs at least one .ifc path");

  const IfcModel = await loadWasm();
  const rows: ReportRow[] = [];
  const errors: { file: string; error: string }[] = [];
  for (const path of modelPaths) {
    const name = basename(path);
    try {
      const bytes = readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      note(`report: ${name}`);
      const parsed = IfcModel.fromBytes(new Uint8Array(bytes), name);
      // Geometry first, as the parse worker and check-cli do it.
      const boxes = new Map<string, ElementBox>();
      parsed.streamMeshes(250, (metaJson, positions) => {
        collectBoxes(boxes, JSON.parse(metaJson), positions);
      });
      unshiftBoxes(boxes, JSON.parse(parsed.streamShiftJson()));
      const summary = JSON.parse(parsed.summaryJson()) as IfcSummary;
      const graph = JSON.parse(parsed.graphJson()) as IfcGraph;
      graph.type_objects = JSON.parse(parsed.typeObjectsJson());
      graph.psets = JSON.parse(parsed.psetsJson());
      graph.classifications = JSON.parse(parsed.classificationsJson());
      graph.quantities = JSON.parse(parsed.quantitiesJson());
      parsed.free();

      const evaluation = ruleset
        ? evaluateRuleset(ruleset, graph as unknown as ModelGraph, summary as unknown as ModelSummary, name)
        : null;
      // The copy-object exclusions reach the fundamentals exactly as the
      // browser worker applies them.
      const excluded = evaluation?.excludedGuids?.length ? new Set(evaluation.excludedGuids) : undefined;
      const checks = [
        ...runFundamentals(graph, summary, excluded),
        checkStoreyConfig(graph, summary, ruleset?.storeys),
        checkMeshPlacement(graph, summary, boxes, excluded),
      ];
      rows.push(
        ...reportRows({
          model: { file: name, schema: summary.schema, sha256 },
          graph,
          summary,
          checks,
          ruleset,
          evaluation,
        }),
      );
    } catch (error) {
      errors.push({ file: name, error: (error as Error).message });
    }
  }
  await emitUtf8({ command: "report", ruleset: ruleset?.name ?? null, rows, errors, lint });
  return errors.length > 0 ? 1 : reportExitCode(rows);
}

/* -------------------------------------------------------------- selftest */

/** A validator that has never rejected anything proves nothing, so this asserts
 *  both directions: the emitted document validates, and three documents
 *  carrying the traps this builder exists to prevent do not. */
async function cmdSelftest(): Promise<number> {
  const assertions: { name: string; expected: string; actual: string; ok: boolean }[] = [];
  const record = (name: string, expected: string, actual: string) => {
    assertions.push({ name, expected, actual, ok: expected === actual });
  };

  const issues = lintRuleset(SAMPLE_RULESET);
  record("sample lints clean", "0 errors", `${issues.filter((i) => i.severity === "error").length} errors`);

  // The shipped copy must not drift from the schema the code compiles against.
  const shipped = JSON.parse(
    readFileSync(new URL("../src/ids/ruleset.schema.json", import.meta.url), "utf8"),
  ) as unknown;
  record(
    "shipped ruleset.schema.json is current",
    "current",
    JSON.stringify(shipped) === JSON.stringify(RULESET_JSON_SCHEMA)
      ? "current"
      : "stale — run: node scripts/ids-cli.ts schema > src/ids/ruleset.schema.json",
  );

  const shape = shapeErrors(SAMPLE_RULESET);
  record(
    "sample validates against the JSON Schema",
    "valid",
    shape.length === 0 ? "valid" : `invalid: ${shape.map((e) => `${e.path} ${e.message}`).join(" | ")}`,
  );

  // A JSON Schema that has never rejected anything proves nothing either.
  const malformed = [
    ["unknown rule key", { ...SAMPLE_RULESET, rules: [{ ...SAMPLE_RULESET.rules[0], nonsense: 1 }] }],
    [
      "cardinality on an applicability facet",
      {
        ...SAMPLE_RULESET,
        rules: [
          {
            id: "x",
            kind: "ids",
            name: "x",
            applicability: { attribute: [{ name: "Name", cardinality: "required" }] },
          },
        ],
      },
    ],
    [
      "entity with both classes and group",
      {
        ...SAMPLE_RULESET,
        rules: [
          {
            id: "x",
            kind: "ids",
            name: "x",
            applicability: { entity: { classes: ["IFCWALL"], group: "product" } },
          },
        ],
      },
    ],
    ["lower-case dataType", {
      ...SAMPLE_RULESET,
      rules: [
        {
          id: "x",
          kind: "ids",
          name: "x",
          applicability: { entity: { classes: ["IFCWALL"] } },
          requirements: { property: [{ propertySet: "P", baseName: "B", dataType: "IfcLabel" }] },
        },
      ],
    }],
  ] as const;
  for (const [name, bad] of malformed) {
    record(
      `JSON Schema rejects: ${name}`,
      "rejected",
      shapeErrors(bad).length > 0 ? "rejected" : "accepted",
    );
  }

  // The project mappings ride on code-lookup; the example config must stay
  // valid, and each constraint a mapping adds must actually refuse.
  const knm = JSON.parse(
    readFileSync(new URL("../examples/knm.ruleset.json", import.meta.url), "utf8"),
  ) as Ruleset;
  record(
    "examples/knm.ruleset.json lints clean and validates",
    "0 errors / valid",
    `${lintRuleset(knm).filter((i) => i.severity === "error").length} errors / ` +
      (shapeErrors(knm).length === 0 ? "valid" : "invalid"),
  );
  const mappingRule = (mapping: string, check: Record<string, unknown>, id = mapping) => ({
    id,
    kind: "extended",
    name: id,
    mapping,
    check: { type: "code-lookup", source: { attribute: "ObjectType" }, extract: "^(.+)$", ...check },
  });
  const withRules = (rules: unknown[]) => ({ ...SAMPLE_RULESET, rules }) as unknown as Ruleset;
  const lintCodes = (ruleset: Ruleset) =>
    lintRuleset(ruleset).filter((i) => i.severity === "error").map((i) => i.code).join(",") || "none";
  const mappingNegatives: [string, Ruleset, string][] = [
    ["one mapping on two rules", withRules([
      mappingRule("progress-code", { values: ["300"] }, "a"),
      mappingRule("progress-code", { values: ["300"] }, "b"),
    ]), "mapping-duplicate"],
    ["a classification mapping without a list", withRules([
      mappingRule("system-classification", { values: ["x"] }),
    ]), "mapping-list"],
    ["a code-lookup with both list and values", withRules([
      mappingRule("progress-code", { values: ["300"], list: "ns3457-8" }),
    ]), "code-list-shape"],
    ["an empty values list", withRules([mappingRule("progress-code", { values: [] })]), "code-values-empty"],
    ["a copy-object mapping with an empty values list", withRules([
      mappingRule("copy-object", { values: [] }),
    ]), "code-values-empty"],
  ];
  for (const [name, ruleset, code] of mappingNegatives) {
    record(`lint rejects: ${name}`, code, lintCodes(ruleset));
  }
  record(
    "JSON Schema rejects: code-lookup with neither list nor values",
    "rejected",
    shapeErrors(withRules([mappingRule("progress-code", {})])).length > 0 ? "rejected" : "accepted",
  );
  // copy-object is a scope filter with two value modes, both plain `values`:
  // the boolean pair (unchanged) or the project's own discipline codes. Not a
  // stricter shape than progress-code's, so both lint clean.
  record(
    "lint accepts: copy-object in boolean mode",
    "0 errors",
    `${lintRuleset(withRules([mappingRule("copy-object", { values: [...BOOLEAN_VALUES] })])).filter((i) => i.severity === "error").length} errors`,
  );
  record(
    "lint accepts: copy-object with a discipline-code list",
    "0 errors",
    `${lintRuleset(withRules([mappingRule("copy-object", { values: ["RIV"] })])).filter((i) => i.severity === "error").length} errors`,
  );

  // Evaluation of a values lookup on a synthetic model: one value in the list,
  // one outside it, one empty. A property source stays not_evaluable (#183).
  const wall = (guid: string, objectType: string | null) => ({
    guid, entity: "IFCWALL", name: guid, predefined_type: null, object_type: objectType,
    tag: null, storey_guid: null, parent_guid: null, type_name: null, typed: false,
    materials: [], is_external: null, fire_rating: null, load_bearing: null,
  });
  const graph: ModelGraph = {
    schema: "IFC4",
    products: [wall("w1", "300"), wall("w2", "250"), wall("w3", null)],
    contained_in: [], aggregates: [], voids: [], storeys: [], buildings: [], sites: [], spaces: [],
  };
  const summary: ModelSummary = {
    schema: "IFC4", length_unit: "METRE", unit_scale: 1, unit_resolved: true,
    authoring_app: null, project_name: null, duplicate_step_ids: 0, products: 3,
  };
  const synthetic = evaluateRuleset(withRules([
    mappingRule("progress-code", { values: ["300", "400"] }),
    { ...mappingRule("copy-object", { values: ["true", "false"], extract: "^(.*)$" }),
      check: { type: "code-lookup", values: ["true", "false"], extract: "^(.*)$",
        source: { property: { propertySet: "P", name: "B" } } } },
  ]), graph, summary, "synthetic");
  const [progress, copy] = synthetic.results;
  record(
    "values lookup: in list passes, outside list and empty fail",
    "fail 3/2 [not in values, empty]",
    `${progress.state} ${progress.applicable}/${progress.failed} [` +
      progress.findings
        .map((f) => (f.reason.endsWith("is empty") ? "empty" : f.reason.includes("is not in the allowed values") ? "not in values" : f.reason))
        .join(", ") + "]",
  );
  // The synthetic graph above carries NO property table, which is the "caller
  // supplied none" case and must stay not_evaluable rather than quietly
  // reporting no reference objects. The reachable case is asserted below.
  record("property-sourced mapping with no property table is not_evaluable", "not_evaluable", copy.state);
  record(
    "the not_evaluable reason names the missing property table",
    "true",
    String((copy.reason ?? "").includes("no property table was supplied")),
  );
  record(
    "property-sourced mapping notes that exclusion did not run",
    "true",
    String((copy.notes ?? []).some((n) => n.includes("could not be excluded"))),
  );
  record(
    "a non-evaluable copy-object mapping excludes nothing from another rule",
    "3",
    String(progress.applicable),
  );

  // copy-object is a SCOPE FILTER: an identified reference object is excluded
  // from every other rule's selection, fundamentals included, in BOTH value
  // modes. `progress-code` reads the same synthetic elements' Name so a
  // reference object that would otherwise fail it disappears instead.
  const el = (guid: string, name: string | null, objectType: string | null) => ({
    guid, entity: "IFCWALL", name, predefined_type: null, object_type: objectType,
    tag: null, storey_guid: null, parent_guid: null, type_name: null, typed: false,
    materials: [], is_external: null, fire_rating: null, load_bearing: null,
  });
  const referenceGraph = (rows: [string | null, string | null][]): ModelGraph => ({
    schema: "IFC4",
    products: rows.map(([name, objectType], i) => el(`r${i + 1}`, name, objectType)),
    contained_in: [], aggregates: [], voids: [], storeys: [], buildings: [], sites: [], spaces: [],
  });

  const boolCase = evaluateRuleset(
    withRules([
      mappingRule("progress-code", { source: { attribute: "Name" }, values: ["300"] }),
      mappingRule("copy-object", { values: [...BOOLEAN_VALUES] }),
    ]),
    referenceGraph([
      ["300", "false"], // explicit non-reference: ordinary, in scope
      ["999", "true"], // reference: excluded — would otherwise fail progress-code
      ["300", null], // no flag: ordinary, in scope
    ]),
    summary,
    "boolean-mode",
  );
  const [boolProgress, boolCopy] = boolCase.results;
  record(
    "boolean mode: reference object excluded from another rule's findings",
    "pass 2/0, excluded 1 of 3 objects excluded as reference objects",
    `${boolProgress.state} ${boolProgress.applicable}/${boolProgress.failed}, excluded ${boolCopy.detail}`,
  );

  const codesCase = evaluateRuleset(
    withRules([
      mappingRule("progress-code", { source: { attribute: "Name" }, values: ["300"] }),
      mappingRule("copy-object", { values: ["RIV"] }),
    ]),
    referenceGraph([
      ["300", null], // no code: ordinary, in scope
      ["999", "RIV"], // reference: excluded — would otherwise fail progress-code
      ["300", "ARK"], // not an allowed code: ordinary, in scope
    ]),
    summary,
    "codes-mode",
  );
  const [codesProgress, codesCopy] = codesCase.results;
  record(
    "codes mode: reference object excluded from another rule's findings",
    "pass 2/0, excluded 1 of 3 objects excluded as reference objects",
    `${codesProgress.state} ${codesProgress.applicable}/${codesProgress.failed}, excluded ${codesCopy.detail}`,
  );

  /* ---- property and classification facets, on a graph that carries both ----
   *
   * Property identity is (SET, NAME). The first assertions are the ones that
   * matter: `Other.Status` and `NONS_Process.Status` are different facts, and
   * the evaluator used to match the base name alone and carry a note saying so.
   * The note is gone, so the distinction has to be proved rather than promised.
   *
   * Classification reads `identification`, the column ifcfast normalises across
   * schemas — IFC4 `.Identification` and IFC2x3 `.ItemReference` both land
   * there, so nothing here (and nothing in evaluate.ts) branches on the schema.
   */
  const richGraph: ModelGraph = {
    schema: "IFC4",
    products: [wall("p1", null), wall("p2", null), wall("p3", null)],
    contained_in: [], aggregates: [], voids: [], storeys: [], buildings: [], sites: [], spaces: [],
    psets: [
      { guid: "p1", pset_name: "NONS_Process", prop_name: "Status", value: "300" },
      { guid: "p1", pset_name: "Other", prop_name: "Status", value: "999" },
      { guid: "p2", pset_name: "NONS_Process", prop_name: "Status", value: "999" },
      { guid: "p2", pset_name: "Pset_WallCommon", prop_name: "IsExternal", value: "true" },
      // p3 declares nothing — a real state, and not the same as "not supplied".
    ],
    classifications: [
      { guid: "p1", system_name: "NS 3451", identification: "234", name: "Yttervegger" },
      { guid: "p2", system_name: "NS 3451", identification: "ZZZ", name: null },
      { guid: "p2", system_name: "Uniformat", identification: "246", name: "Kledning" },
    ],
  };
  const richSummary: ModelSummary = { ...summary, products: 3 };

  const facetRuleset = withRules([
    {
      id: "prop-exact", kind: "ids", name: "Status in NONS_Process is 300",
      applicability: { entity: { classes: ["IFCWALL"] } },
      requirements: {
        property: [{ propertySet: "NONS_Process", baseName: "Status", value: "300" }],
      },
    },
    {
      id: "prop-other-set", kind: "ids", name: "Status in Other is 999",
      applicability: { entity: { classes: ["IFCWALL"] } },
      requirements: { property: [{ propertySet: "Other", baseName: "Status", value: "999" }] },
    },
    {
      id: "class-facet", kind: "ids", name: "Carries an NS 3451 code",
      applicability: { entity: { classes: ["IFCWALL"] } },
      requirements: { classification: [{ system: "NS 3451" }] },
    },
    {
      id: "select-by-property", kind: "ids", name: "Only external walls",
      applicability: {
        entity: { classes: ["IFCWALL"] },
        property: [{ propertySet: "Pset_WallCommon", baseName: "IsExternal", value: "true" }],
      },
      requirements: { attribute: [{ name: "Name" }] },
    },
  ]);
  const facets = evaluateRuleset(facetRuleset, richGraph, richSummary, "facets");
  const [propExact, propOther, classFacet, selectByProperty] = facets.results;
  record(
    "property facet matches on SET plus NAME, not base name",
    "fail 3/2",
    `${propExact.state} ${propExact.applicable}/${propExact.failed}`,
  );
  record(
    "the same base name in another set is a different property",
    "fail 3/2",
    `${propOther.state} ${propOther.applicable}/${propOther.failed}`,
  );
  record(
    "a property finding names the qualified property",
    "true",
    String((propExact.findings[0]?.reason ?? "").startsWith("NONS_Process.Status is")),
  );
  record(
    "the base-name caveat is gone",
    "no notes",
    (propExact.notes ?? []).length === 0 ? "no notes" : (propExact.notes ?? []).join(" | "),
  );
  record(
    "classification facet: present in the system passes, absent fails",
    "fail 3/1",
    `${classFacet.state} ${classFacet.applicable}/${classFacet.failed}`,
  );
  record(
    "a property facet SELECTS as well as requires",
    "pass 1/0",
    `${selectByProperty.state} ${selectByProperty.applicable}/${selectByProperty.failed}`,
  );

  // Code lookups off the two new sources, both in `values` mode so the
  // assertion is about the SOURCE and not about a bundled list.
  const sourced = evaluateRuleset(
    withRules([
      { ...mappingRule("progress-code", { values: ["300"] }),
        check: { type: "code-lookup", values: ["300"], extract: "^(.*)$",
          source: { property: { propertySet: "NONS_Process", name: "Status" } } } },
      { ...mappingRule("system-classification", { values: ["234"] }), id: "class-lookup",
        check: { type: "code-lookup", values: ["234"], extract: "^(.*)$",
          source: { classification: { system: "NS 3451" } } } },
    ]),
    richGraph,
    richSummary,
    "sourced",
  );
  const [propLookup, classLookup] = sourced.results;
  record(
    "code-lookup off a property source evaluates",
    "fail 3/2 [not in values, empty]",
    `${propLookup.state} ${propLookup.applicable}/${propLookup.failed} [` +
      propLookup.findings
        .map((f) => (f.reason.endsWith("is empty") ? "empty" : "not in values"))
        .join(", ") + "]",
  );
  record(
    "code-lookup off a classification source evaluates",
    "fail 3/2 [not in values, empty]",
    `${classLookup.state} ${classLookup.applicable}/${classLookup.failed} [` +
      classLookup.findings
        .map((f) => (f.reason.endsWith("is empty") ? "empty" : "not in values"))
        .join(", ") + "]",
  );

  // The copy-object filter off a PROPERTY source. This is the shape POFIN
  // actually specifies (`NONS_Process.DuplicateOwnedBy`), and until the
  // property table was reachable the mapping could not run at all.
  const propertyFilter = evaluateRuleset(
    withRules([
      mappingRule("progress-code", { source: { attribute: "Name" }, values: ["p1", "p3"] }),
      { ...mappingRule("copy-object", { values: ["RIV"] }),
        check: { type: "code-lookup", values: ["RIV"], extract: "^(.*)$",
          source: { property: { propertySet: "NONS_Process", name: "DuplicateOwnedBy" } } } },
    ]),
    {
      ...richGraph,
      psets: [
        ...(richGraph.psets ?? []),
        { guid: "p2", pset_name: "NONS_Process", prop_name: "DuplicateOwnedBy", value: "RIV" },
      ],
    },
    richSummary,
    "property-filter",
  );
  const [filteredProgress, propertyCopy] = propertyFilter.results;
  record(
    "copy-object off a property source excludes the reference object",
    "pass 2/0, excluded 1 of 3 objects excluded as reference objects",
    `${filteredProgress.state} ${filteredProgress.applicable}/${filteredProgress.failed}, ` +
      `excluded ${propertyCopy.detail}`,
  );

  // A graph with no classification table is not a graph with no
  // classifications, and the two never collapse into one answer.
  const noTable = evaluateRuleset(
    withRules([
      { id: "class-facet", kind: "ids", name: "Carries an NS 3451 code",
        applicability: { entity: { classes: ["IFCWALL"] } },
        requirements: { classification: [{ system: "NS 3451" }] } },
    ]),
    graph,
    summary,
    "no-classification-table",
  );
  record(
    "a classification facet with no table supplied is not_evaluable",
    "not_evaluable",
    noTable.results[0].state,
  );
  record(
    "the not_evaluable reason names the missing classification table",
    "true",
    String((noTable.results[0].reason ?? "").includes("no classification table was supplied")),
  );

  // edkjo's storey rule (ifc-check#2): per element against its STATED
  // storey, span [elev, next_elev), top storey open; yellow = bottom up to
  // 0.10 m below with the top at or above elev.
  const levels = [
    { guid: "s0", name: "U1", elevation: 0 },
    { guid: "s1", name: "P1", elevation: 3 },
    { guid: "s1b", name: "P1 split", elevation: 3.0005 },
    { guid: "s2", name: "P2", elevation: 6 },
  ];
  const bandCases: [string, number, number, number, string][] = [
    ["bottom on the storey", 1, 3, 4, "green"],
    ["bottom inside the span", 1, 4.2, 5, "green"],
    ["bottom a float32 hair under the storey", 1, 3 - 4e-6, 4, "green"],
    ["bottom 0.05 m under, top above", 1, 2.95, 4, "yellow"],
    ["bottom 0.10 m under, top above", 1, 2.9, 4, "yellow"],
    ["bottom 0.05 m under, top also under", 1, 2.95, 2.99, "red"],
    ["bottom 0.15 m under", 1, 2.85, 4, "red"],
    ["bottom on the next storey", 1, 6, 7, "red"],
    ["bottom just under the next storey", 1, 5.95, 7, "green"],
    ["top storey is open upward", 3, 40, 41, "green"],
  ];
  for (const [name, level, bottom, top, expected] of bandCases) {
    record(`storey band: ${name}`, expected, storeyBand(levels, levels[level], bottom, top));
  }

  // not_configured is its own state: with no ruleset, MMI and copy-object
  // are rows saying so, never absent and never not_applicable.
  const bare = reportRows({
    model: { file: "synthetic.ifc", schema: "IFC4", sha256: "0".repeat(64) },
    graph: { ...(graph as unknown as IfcGraph), storeys: [], projects: [], storey_building: [] },
    summary: summary as unknown as IfcSummary,
    checks: [],
  });
  record(
    "report: unconfigured no-IFC-home mappings are not_configured rows",
    "progress-code:not_configured,copy-object:not_configured",
    bare.filter((r) => r.mapping).map((r) => `${r.id}:${r.state}`).join(","),
  );
  record(
    "report: phase with no property table is not_evaluable, never mangler",
    "not_evaluable",
    bare.find((r) => r.id === "phase")?.state ?? "absent",
  );

  // Gap 2, the IFC-skjema allowlist. The fold matches HI90's skjema_grunn:
  // an IFC4 addendum is IFC4, IFC4X3 is its own family.
  record(
    "ifc-schema: FILE_SCHEMA folds to its family",
    "IFC2X3,IFC4,IFC4,IFC4,IFC4X3,",
    ["IFC2X3", "IFC4", "IFC4 ADD2 TC1", "IFC4ADD2", "IFC4X3_ADD2", "garbage"].map(schemaFamily).join(","),
  );
  const schemaRowFor = (schema: string, ruleset: Ruleset | null) => {
    const row = reportRows({
      model: { file: "s.ifc", schema, sha256: "0".repeat(64) },
      graph: { ...(graph as unknown as IfcGraph), psets: [] },
      summary: summary as unknown as IfcSummary,
      checks: [],
      ruleset,
    }).find((r) => r.id === "ifc-schema")!;
    const d = row.dekning;
    return `${row.state} ${d.oppfylt}/${d.avvik}/${d.mangler} [${row.godtatte?.join(" ")}] ` +
      (row.fordeling ?? []).map((v) => `${v.verdi}:${v.flagg || "ok"}`).join(",");
  };
  const narrowed = { ...SAMPLE_RULESET, projectLayer: { "ifc-schema": { accepted: ["IFC4"] } } } as Ruleset;
  record("ifc-schema: IFC2X3 passes the standard layer", "pass 1/0/0 [IFC2X3 IFC4] IFC2X3:ok", schemaRowFor("IFC2X3", null));
  record("ifc-schema: an IFC4 addendum passes as IFC4", "pass 1/0/0 [IFC2X3 IFC4] IFC4 ADD2 TC1:ok", schemaRowFor("IFC4 ADD2 TC1", null));
  record("ifc-schema: IFC4X3 is not IFC4", "warn 0/1/0 [IFC2X3 IFC4] IFC4X3_ADD2:avvik", schemaRowFor("IFC4X3_ADD2", null));
  record("ifc-schema: the project layer narrows to IFC4", "warn 0/1/0 [IFC4] IFC2X3:avvik", schemaRowFor("IFC2X3", narrowed));
  record("ifc-schema: no FILE_SCHEMA is a fail and mangler", "fail 0/0/1 [IFC2X3 IFC4] null:mangler", schemaRowFor("", null));

  // Gap 1 (the cascade) and gap 4 (fase). Six walls: accepted in the
  // standard source; OTHER there but accepted in the project source; only a
  // project value outside the list; nothing; a lower-case accepted value; and
  // UNSET, which is carried but says nothing.
  const prop = (guid: string, pset_name: string, prop_name: string, value: string) => ({
    guid, pset_name, prop_name, value, value_type: "IfcLabel", source: "instance",
  });
  const phaseGraph = {
    ...(graph as unknown as IfcGraph),
    products: ["p1", "p2", "p3", "p4", "p5", "p6"].map((g) => wall(g, null)),
    psets: [
      prop("p1", "Pset_WallCommon", "Status", "NEW"),
      prop("p2", "Pset_WallCommon", "Status", "OTHER"),
      prop("p2", "HI90_TFM", "Fase", "EXISTING"),
      prop("p3", "HI90_TFM", "Fase", "Fase 2"),
      prop("p5", "Pset_SlabCommon", "Status", "new"),
      prop("p6", "Pset_WallCommon", "Status", "UNSET"),
      // Not a Common set: never read as the standard source.
      prop("p4", "Pset_WallCommonX", "Status", "NEW"),
    ],
  } as unknown as IfcGraph;
  const phaseRowFor = (projectLayer: Ruleset["projectLayer"] | undefined) => {
    const row = reportRows({
      model: { file: "p.ifc", schema: "IFC4", sha256: "0".repeat(64) },
      graph: phaseGraph,
      summary: summary as unknown as IfcSummary,
      checks: [],
      ruleset: projectLayer ? ({ ...SAMPLE_RULESET, projectLayer } as Ruleset) : null,
    }).find((r) => r.id === "phase")!;
    return row;
  };
  const describe = (row: ReportRow) => {
    const d = row.dekning;
    return `${row.state} ${d.grunnlag}=${d.oppfylt}+${d.avvik}+${d.mangler}`;
  };
  const kilderOf = (row: ReportRow) =>
    row.dekning.kilder.map((k) => `${k.navn}:${k.lag}:${k.n}:${k.foretrukket}`).join(",");
  const withTfm = phaseRowFor({
    phase: { sources: [
      { property: { propertySet: "HI90_TFM", name: "Fase" } },
      { property: { propertySet: "Nowhere", name: "Fase" } },
    ] },
  });
  record("phase: standard layer alone", "warn 6=2+2+2", describe(phaseRowFor(undefined)));
  record("phase: standard layer alone has one source", "Pset_*Common.Status:standard:4:true", kilderOf(phaseRowFor(undefined)));
  record("phase: the project source rescues an OTHER and carries an avvik", "warn 6=3+2+1", describe(withTfm));
  record(
    "cascade: every source in order, layer tagged, 0 hits included, first preferred",
    "Pset_*Common.Status:standard:3:true,HI90_TFM.Fase:prosjekt:2:false,Nowhere.Fase:prosjekt:0:false",
    kilderOf(withTfm),
  );
  record(
    "phase: fordeling carries every decisive value as written, with its flag",
    "null:mangler,EXISTING:ok,Fase 2:avvik,new:ok,NEW:ok,UNSET:avvik",
    (withTfm.fordeling ?? []).map((v) => `${v.verdi}:${v.flagg || "ok"}`).join(","),
  );
  record(
    "phase: one finding per object not oppfylt",
    "p3:not-in-list:Fase 2,p4:empty:null,p6:not-in-list:UNSET",
    withTfm.funn.map((f) => `${f.guid}:${f.grunn}:${f.verdi}`).join(","),
  );

  // The project layer's lint: an id the standard layer does not define is an
  // error (HI90 konfig.py refuses it too), a schema must be a family, and
  // widening past the standard is a warning.
  const layerLint = (projectLayer: unknown) =>
    lintRuleset({ ...SAMPLE_RULESET, projectLayer } as unknown as Ruleset)
      .filter((i) => i.path.startsWith("projectLayer"))
      .map((i) => `${i.severity}:${i.code}`)
      .join(",") || "none";
  record("lint: projectLayer with an unknown requirement id", "error:project-layer-unknown", layerLint({ mmi: {} }));
  record("lint: a schema that is not a family", "error:schema-accepted-form", layerLint({ "ifc-schema": { accepted: ["IFC4 ADD2"] } }));
  record("lint: a schema outside the standard widens it", "warning:schema-accepted-widens", layerLint({ "ifc-schema": { accepted: ["IFC4X3"] } }));
  record("lint: a cascade source with no property name", "error:code-source-empty", layerLint({ phase: { sources: [{ property: { propertySet: "HI90_TFM", name: "" } }] } }));
  record("lint: the HI90 project layer lints clean", "none", layerLint({ "ifc-schema": { accepted: ["IFC4"] }, phase: { sources: [{ property: { propertySet: "HI90_TFM", name: "Fase" } }] } }));
  record(
    "schema: projectLayer validates, and refuses an unknown key",
    "0 / >0",
    `${shapeErrors({ ...SAMPLE_RULESET, projectLayer: { phase: { sources: [{ property: { propertySet: "A", name: "B" } }] } } }).length} / ` +
      (shapeErrors({ ...SAMPLE_RULESET, projectLayer: { mmi: {} } }).length > 0 ? ">0" : "0"),
  );

  const result = exportRuleset(SAMPLE_RULESET);
  const { included, excluded } = partitionRules(SAMPLE_RULESET);
  record("sample splits into both kinds", "6 ids / 4 excluded", `${included.length} ids / ${excluded.length} excluded`);

  const good = result.ids ?? "";
  const valid = await validateIds(good);
  record("emitted .ids validates", "valid", valid.valid ? "valid" : `invalid: ${valid.errors.map((e) => e.message).join(" | ")}`);

  record(
    "no extended rule leaked into the .ids",
    "absent",
    /element-typed|unique-attribute|type-usage-count|model-metadata|code-lookup/.test(good) ? "present" : "absent",
  );
  record(
    "no custom namespace in the .ids",
    "absent",
    /xmlns:(?!ids|xs|xsi)/.test(good) ? "present" : "absent",
  );
  record(
    "abstract class never emitted",
    "absent",
    /IFCBUILDINGELEMENT<|>IFCELEMENT<|>IFCPRODUCT</.test(good) ? "present" : "absent",
  );

  // Negative controls: each is a real authoring trap.
  const negatives: [string, string][] = [
    [
      "minOccurs on <specification> is rejected",
      good.replace("<ids:specification ", '<ids:specification minOccurs="1" '),
    ],
    [
      "cardinality on an applicability facet is rejected",
      good.replace("<ids:applicability", '<ids:applicability cardinality="required"'),
    ],
    [
      "an ifcVersion outside the enumeration is rejected",
      good.replace('ifcVersion="IFC4"', 'ifcVersion="IFC4X3"'),
    ],
  ];
  for (const [name, xml] of negatives) {
    if (xml === good) {
      record(name, "rejected", "control was not applied — the emitter output changed shape");
      continue;
    }
    const bad = await validateIds(xml);
    record(name, "rejected", bad.valid ? "accepted" : "rejected");
  }

  const ok = assertions.every((a) => a.ok);
  emit({
    command: "selftest",
    ok,
    assertions,
    excluded: result.excluded,
    includedRuleIds: result.includedRuleIds,
  });
  return ok ? 0 : 1;
}

/* ------------------------------------------------------------------ main */

const [command, ...rest] = process.argv.slice(2);

let code = 2;
switch (command) {
  case "lint":
    code = await cmdLint(rest);
    break;
  case "emit":
    code = await cmdEmit(rest);
    break;
  case "run":
    code = await cmdRun(rest);
    break;
  case "report":
    code = await cmdReport(rest);
    break;
  case "schema":
    emit(RULESET_JSON_SCHEMA);
    code = 0;
    break;
  case "sample":
    emit(SAMPLE_RULESET);
    code = 0;
    break;
  case "selftest":
    code = await cmdSelftest();
    break;
  default:
    note(
      "usage: node scripts/ids-cli.ts <lint|emit|run|report|schema|sample|selftest> [args]",
    );
    code = 2;
}
process.exit(code);
