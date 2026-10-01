/** The headless entry point for rulesets. Not a test harness — this is how a
 *  ruleset is linted, exported, schema-validated and run without a browser.
 *
 * Node 24 strips the types natively, so there is no build step.
 *
 *   node scripts/ids-cli.ts schema                     > ruleset.schema.json
 *   node scripts/ids-cli.ts sample                     > my.ruleset.json
 *   node scripts/ids-cli.ts lint   my.ruleset.json
 *   node scripts/ids-cli.ts emit   my.ruleset.json|config.xlsx [--out dist-rules] [--ids file.ids]
 *   node scripts/ids-cli.ts run    my.ruleset.json model.ifc [...]
 *   node scripts/ids-cli.ts ids    my.ids model.ifc [...] [--max-findings N]
 *   node scripts/ids-cli.ts report [--ruleset my.ruleset.json] model.ifc [...]
 *   node scripts/ids-cli.ts psets  [--ruleset my.ruleset.json] [--examples N] model.ifc [...]
 *   node scripts/ids-cli.ts xlsx2json config.xlsx          > my.ruleset.json
 *   node scripts/ids-cli.ts json2xlsx my.ruleset.json [--out config.xlsx]
 *   node scripts/ids-cli.ts ids2xlsx spec.ids [--into config.xlsx|my.ruleset.json] [--out config.xlsx]
 *   node scripts/ids-cli.ts selftest
 *
 * Every command that takes a ruleset takes the config workbook (.xlsx) too.
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
 *
 * `psets` prints the pset inventory (src/engine/pset-inventory.ts, AGENTS.md
 * "Pset inventory"): every property and quantity set per model, with its
 * category. Data only, no verdict: 0, or 1 when a model could not be read.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { validateXML } from "xmllint-wasm";

import { CODE_LISTS } from "../src/codelists/index.ts";
import { compileExtract, evaluateRuleset } from "../src/ids/evaluate.ts";
import { extractFromExample } from "../src/ids/extract-example.ts";
import { previewExtract } from "../src/ui/extract-preview.ts";
import { mergeChoices } from "../src/ui/pset-choices.ts";
import { defaultCodeList } from "../src/ids/models.ts";
import { importIds, parseIdsXml, type ImportedIds } from "../src/ids/import.ts";
import { emitIdsXml } from "../src/ids/emit.ts";
import { evaluateIds, type IdsModelResult } from "../src/ids/ids-report.ts";
import { exportRuleset, partitionRules } from "../src/ids/export.ts";
import { hasErrors, lintRuleset } from "../src/ids/lint.ts";
import { RULESET_JSON_SCHEMA } from "../src/ids/schema.ts";
import { SAMPLE_RULESET } from "../src/ids/sample.ts";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { CONFIG_TEMPLATE, CONFIG_TEMPLATE_FILE } from "../src/ids/config-template.ts";
import {
  SHEET_ORDER,
  XlsxRulesetError,
  canonicalRuleset,
  locate,
  readCodesXlsx,
  readLevelsXlsx,
  readRulesetXlsx,
  rulesetDiff,
  withIdsRules,
  writeCodesXlsx,
  writeLevelsXlsx,
  writeRulesetXlsx,
  type XlsxRuleset,
} from "../src/ids/xlsx.ts";
import { extractedCodes, levelsTemplate, modelLevels, templateFileName, withCodes } from "../src/ui/step-templates.ts";
import { exemptChecks } from "../src/engine/exempt.ts";
import { createIdsValidator, type SchemaSources } from "../src/ids/validate.ts";
import { REQUIREMENT_IDS, type IdsRule, type Ruleset } from "../src/ids/types.ts";
import type { ModelGraph, ModelSummary } from "../src/ids/model.ts";
import { detailEn, line as detailLine, runFundamentals } from "../src/engine/fundamentals.ts";
import { detailText } from "../src/ui/display.ts";
import { labelOfFocus } from "../src/ui/requirements.ts";
import {
  checkMeshPlacement,
  collectBoxes,
  storeyBand,
  unshiftBoxes,
  type ElementBox,
} from "../src/engine/placement.ts";
import { checkStoreyConfig, matchStoreys } from "../src/engine/storey-config.ts";
import { reportExitCode, reportRows, type ReportRow } from "../src/engine/report.ts";
import { schemaFamily } from "../src/engine/standard-layer.ts";
import { functionTree, systemTree, type TreeNode } from "../src/engine/code-tree.ts";
import { measureTree, meshMeasure, qtoLengths, qtoQuantities, quantityUnits } from "../src/engine/quantities.ts";
import { psetInventory, requiredSetRefs } from "../src/engine/pset-inventory.ts";
import { MENGDETYPE_AAPNE, MENGDETYPE_IFCKLASSE } from "../src/codelists/mengdetype-ifcklasse.ts";
import { MENGDETYPE_NS3457 } from "../src/codelists/mengdetype-ns3457.ts";
import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";
import { catalogue as typeCatalogue, typeCodes, typeObjectClass } from "../src/ui/type-links.ts";
import { elementFacets, elementItems, facetCounts, narrow, NONE, typeItems, type FacetSelection } from "../src/ui/facets.ts";
import { typePage } from "../src/ui/type-page.ts";
import { EMPTY_FILTER, escapeAll, reduceFilter } from "../src/ui/filter-state.ts";
import { selectionMarks } from "../src/ui/selection-marks.ts";
import { classificationCodes, codeGuids } from "../src/ui/class-codes.ts";
import type { BoardData } from "../src/ui/report-rows.ts";
import type { ElementQuantity } from "../src/engine/quantities.ts";
import type { ModelProfile } from "../src/ui/profile.ts";
import {
  CATEGORICAL,
  censusCell,
  clashesWithStatus,
  classColour,
  codeColour,
  contrast,
  frameColour,
  labelOn,
  luminance,
  mmiColour,
  readableCell,
} from "../src/ui/chart-colors.ts";
import { classRamp } from "../src/ui/graph-paint.ts";
import { layerSection, PX_PER_MM, sectionOrientation, UNKNOWN_PX } from "../src/ui/layer-section.ts";
import { roomSchedule, spaceLongNames } from "../src/engine/rooms.ts";
import {
  bodyDeclarations,
  bodySignature,
  checkBodyWithoutMesh,
  issueBody,
  issueFacts,
  issueTitle,
  matchingIssue,
  newIssueUrl,
  nomeshCounts,
  unmeshedGuids,
  type NomeshVerification,
} from "../src/engine/body-mesh.ts";
import { shapeOf } from "../src/ui/room-plan.ts";
import { profileOf } from "../src/storage/rehydrate.ts";
import { withTypeFacts } from "../src/ui/types/facts.ts";
import { beregn, SENTINEL } from "../src/mottakskontroll/beregn.ts";
import { htmlModell, htmlProsjekt } from "../src/mottakskontroll/html.ts";
import { BLOKKER, ETIKETTER, KPI_TITLER, SEKSJONER, VERDIKT_ORD } from "../src/mottakskontroll/standard.ts";
import { CACHE_SESSION_GRACE_MS, offered, purgeable } from "../src/storage/session.ts";

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

/** A ruleset JSON, or the config workbook: a workbook problem is named at
 *  its Sheet!Cell and stops the command. */
function loadRuleset(path: string | undefined): Ruleset {
  if (!path) fail("no ruleset path given");
  if (/\.xlsx$/i.test(path)) {
    try {
      return readRulesetXlsx(new Uint8Array(readFileSync(path))).ruleset;
    } catch (error) {
      if (error instanceof XlsxRulesetError) {
        for (const problem of error.problems) note(`${path}: ${problem}`);
        return fail(`cannot read ${path}: ${error.problems.length} problem(s)`);
      }
      return fail(`cannot read ${path}: ${(error as Error).message}`);
    }
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Ruleset;
  } catch (error) {
    return fail(`cannot read ruleset ${path}: ${(error as Error).message}`);
  }
}

const VALUE_FLAGS = ["--out", "--max-findings", "--ruleset", "--ids", "--into"];

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
  const idsOut = flagValue(args, "--ids");
  const written: string[] = [];
  if (idsOut && result.ids !== null) {
    writeFileSync(idsOut, result.ids, "utf8");
    written.push(idsOut);
  }
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
    ids: outDir || idsOut ? undefined : result.ids,
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
  materialsJson(): string;
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

/* ------------------------------------------------------------------- ids */

/** Run a buildingSMART `.ids` as written: import it (`src/ids/import.ts`),
 *  evaluate it per model (`src/ids/ids-report.ts`), one row per specification
 *  in file order. `--max-findings N` caps the findings PRINTED per row (default
 *  20; 0 prints every one); the counts are never capped. Exit codes as `run`. */
async function cmdIds(args: string[]): Promise<number> {
  const paths = positionals(args);
  const idsPath = paths[0];
  if (!idsPath) fail("ids needs an .ids path");
  let imported: ImportedIds;
  try {
    imported = importIds(readFileSync(idsPath, "utf8"), basename(idsPath));
  } catch (error) {
    return fail(`cannot import ${idsPath}: ${(error as Error).message}`);
  }
  const modelPaths = paths.slice(1);
  if (modelPaths.length === 0) fail("ids needs at least one .ifc path");
  const shown = Number(flagValue(args, "--max-findings") ?? 20);

  const IfcModel = await loadWasm();
  const models: (IdsModelResult | { model: string; error: string })[] = [];
  for (const path of modelPaths) {
    const name = basename(path);
    try {
      note(`ids: ${name}`);
      const parsed = IfcModel.fromBytes(new Uint8Array(readFileSync(path)), name);
      const summary = JSON.parse(parsed.summaryJson()) as ModelSummary;
      const graph = JSON.parse(parsed.graphJson()) as ModelGraph;
      // The same tables the parse worker attaches (`model-worker.ts`).
      graph.psets = JSON.parse(parsed.psetsJson());
      graph.classifications = JSON.parse(parsed.classificationsJson());
      graph.quantities = JSON.parse(parsed.quantitiesJson());
      graph.materials = JSON.parse(parsed.materialsJson());
      graph.type_objects = JSON.parse(parsed.typeObjectsJson());
      parsed.free();
      const result = evaluateIds(imported, graph, summary, name);
      for (const spec of result.specs) {
        if (shown > 0) spec.findings = spec.findings.slice(0, shown);
      }
      models.push(result);
    } catch (error) {
      models.push({ model: name, error: (error as Error).message });
    }
  }
  const totals = { pass: 0, fail: 0, not_applicable: 0, not_evaluable: 0, error: 0 };
  for (const model of models) {
    if ("error" in model) totals.error += 1;
    else for (const key of ["pass", "fail", "not_applicable", "not_evaluable"] as const) totals[key] += model.counts[key];
  }
  await emitUtf8({
    command: "ids",
    ids: imported.fileName,
    title: imported.title,
    specifications: imported.specs.length,
    unreadable: imported.specs.filter((s) => s.unreadable).map((s) => ({ index: s.index, name: s.name, reason: s.unreadable })),
    totals,
    models,
  });
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
      // Read by the material-product row and by `element-material` (#5).
      graph.materials = JSON.parse(parsed.materialsJson());
      parsed.free();
      // As the parse worker: `body-no-mesh` reads the unmeshed elements' Body
      // declarations from the STEP bytes (not for an ifczip).
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        graph.body_declared = bodyDeclarations(new Uint8Array(bytes), unmeshedGuids(graph, boxes));
      }

      const evaluation = ruleset
        ? evaluateRuleset(ruleset, graph as unknown as ModelGraph, summary as unknown as ModelSummary, name)
        : null;
      // The copy-object exclusions reach the fundamentals exactly as the
      // browser worker applies them, and so do the model's exemptions.
      const excluded = evaluation?.excludedGuids?.length ? new Set(evaluation.excludedGuids) : undefined;
      const checks = exemptChecks(
        [
          ...runFundamentals(graph, summary, excluded),
          checkStoreyConfig(graph, summary, ruleset, name),
          checkMeshPlacement(graph, summary, boxes, excluded),
          checkBodyWithoutMesh(graph, boxes, excluded),
        ],
        ruleset,
        name,
      );
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

/* ----------------------------------------------------------------- psets */

/** The pset inventory, one entry per model. No geometry: the sets are
 *  mesh-free, so the model is parsed without streaming meshes. */
async function cmdPsets(args: string[]): Promise<number> {
  const rulesetPath = flagValue(args, "--ruleset");
  const ruleset = rulesetPath === undefined ? null : loadRuleset(rulesetPath);
  const lint = ruleset ? lintRuleset(ruleset) : [];
  if (ruleset && hasErrors(lint)) {
    await emitUtf8({ command: "psets", ruleset: ruleset.name, models: [], errors: [], lint, error: "lint errors" });
    return 1;
  }
  const examplesFlag = flagValue(args, "--examples");
  const examples = examplesFlag === undefined ? 5 : Number(examplesFlag);
  if (!Number.isInteger(examples) || examples < 0) fail("--examples takes a whole number >= 0");
  const modelPaths = positionals(args);
  if (modelPaths.length === 0) fail("psets needs at least one .ifc path");

  const IfcModel = await loadWasm();
  const models = [];
  const errors: { file: string; error: string }[] = [];
  for (const path of modelPaths) {
    const name = basename(path);
    try {
      const bytes = readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      note(`psets: ${name}`);
      const parsed = IfcModel.fromBytes(new Uint8Array(bytes), name);
      const summary = JSON.parse(parsed.summaryJson()) as IfcSummary;
      const graph = JSON.parse(parsed.graphJson()) as IfcGraph;
      graph.type_objects = JSON.parse(parsed.typeObjectsJson());
      graph.psets = JSON.parse(parsed.psetsJson());
      graph.quantities = JSON.parse(parsed.quantitiesJson());
      parsed.free();
      models.push({
        model: { file: name, schema: summary.schema, sha256 },
        ...psetInventory(graph, summary.schema, ruleset, { examples }),
      });
    } catch (error) {
      errors.push({ file: name, error: (error as Error).message });
    }
  }
  await emitUtf8({
    command: "psets",
    ruleset: ruleset?.name ?? null,
    krevd_kilder: requiredSetRefs(ruleset),
    models,
    errors,
    lint,
  });
  return errors.length > 0 ? 1 : 0;
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
  for (const name of exampleRulesets()) {
    const example = JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")) as Ruleset;
    record(
      `examples/${name} lints clean and validates`,
      "0 errors / valid",
      `${lintRuleset(example).filter((i) => i.severity === "error").length} errors / ` +
        (shapeErrors(example).length === 0 ? "valid" : "invalid"),
    );
  }
  const mappingRule = (mapping: string, check: Record<string, unknown>, id = mapping) => ({
    id,
    kind: "extended",
    name: id,
    mapping,
    check: { type: "code-lookup", source: { attribute: "ObjectType" }, extract: "^(.+)$", ...check },
  });
  /** A project code list from bare codes; each code names itself. */
  const codesOf = (...codes: string[]) => codes.map((code) => ({ code, name: code }));
  /** The copy-object role: its own check type, no mapping field. */
  const copyRule = (check: Record<string, unknown>, id = "copy-object") => ({
    id,
    kind: "extended",
    name: id,
    check: { type: "copy-object", source: { attribute: "ObjectType" }, copy: [], own: [], ...check },
  });
  const withRules = (rules: unknown[]) => ({ ...SAMPLE_RULESET, rules }) as unknown as Ruleset;
  const lintCodes = (ruleset: Ruleset) =>
    lintRuleset(ruleset).filter((i) => i.severity === "error").map((i) => i.code).join(",") || "none";
  const mappingNegatives: [string, Ruleset, string][] = [
    ["one mapping on two rules", withRules([
      mappingRule("progress-code", { codes: codesOf("300") }, "a"),
      mappingRule("progress-code", { codes: codesOf("300") }, "b"),
    ]), "mapping-duplicate"],
    ["two copy-object rules", withRules([copyRule({ copy: ["x"] }, "a"), copyRule({ copy: ["x"] }, "b")]), "mapping-duplicate"],
    ["a classification mapping without a list", withRules([
      mappingRule("system-classification", { codes: codesOf("x") }),
    ]), "mapping-list"],
    ["a code-lookup with both list and codes", withRules([
      mappingRule("progress-code", { codes: codesOf("300"), list: "ns3457-8" }),
    ]), "code-list-shape"],
    ["an empty codes list", withRules([mappingRule("progress-code", { codes: [] })]), "code-values-empty"],
    ["a code with no name", withRules([mappingRule("progress-code", { codes: [{ code: "300", name: "" }] })]), "code-name-empty"],
    ["a phase on a classification's codes", withRules([
      mappingRule("system-classification", { list: "ns3451" }),
      { id: "x", kind: "extended", name: "x", check: { type: "code-lookup", codes: [{ code: "1", name: "a", phase: "NY" }], source: { attribute: "Name" }, extract: "^(.+)$" } },
    ]), "code-phase-role"],
    ["mapping copy-object on a code-lookup", withRules([mappingRule("copy-object", { codes: codesOf("RIV") })]), "mapping-unknown"],
    ["a value both copy and own", withRules([copyRule({ copy: ["Ja"], own: [" ja "] })]), "copy-own-overlap"],
    ["a material source on copy-object", withRules([copyRule({ source: { material: {} }, copy: ["x"] })]), "material-source-slot"],
    ["enabled: true", withRules([{ ...mappingRule("system-classification", { list: "ns3451" }), enabled: true }]), "enabled-not-false"],
    ["an unfilled template placeholder", withRules([
      mappingRule("progress-code", { codes: codesOf("300"), source: { property: { propertySet: "<FROM PROJECT>", name: "MMI" } } }),
    ]), "from-project"],
  ];
  record(
    "lint: a placeholder is located at its path and on its rule",
    "rules[0].check.source.property.propertySet progress-code",
    lintRuleset(withRules([
      mappingRule("progress-code", { codes: codesOf("300"), source: { property: { propertySet: "<FROM PROJECT>", name: "MMI" } } }),
    ])).filter((i) => i.code === "from-project").map((i) => `${i.path} ${i.ruleId}`).join(" | "),
  );
  for (const [name, ruleset, code] of mappingNegatives) {
    record(`lint rejects: ${name}`, code, lintCodes(ruleset));
  }
  record(
    "JSON Schema rejects: code-lookup with neither list nor codes",
    "rejected",
    shapeErrors(withRules([mappingRule("progress-code", {})])).length > 0 ? "rejected" : "accepted",
  );
  record(
    "JSON Schema rejects: enabled true",
    "rejected",
    shapeErrors(withRules([{ ...mappingRule("system-classification", { list: "ns3451" }), enabled: true }])).length > 0 ? "rejected" : "accepted",
  );
  record(
    "JSON Schema rejects: formatVersion 1",
    "rejected",
    shapeErrors({ ...SAMPLE_RULESET, formatVersion: 1 }).length > 0 ? "rejected" : "accepted",
  );
  record(
    "lint rejects: formatVersion 1",
    "format-version",
    lintCodes({ ...SAMPLE_RULESET, formatVersion: 1 } as unknown as Ruleset),
  );
  // copy-object: the G55 Ja/Nei flag and the POFIN owner code are both
  // copy and own lists. Both lint clean.
  record(
    "lint accepts: copy-object as a Ja/Nei flag",
    "none",
    lintCodes(withRules([copyRule({ copy: ["true"], own: ["false"] })])),
  );
  record(
    "lint accepts: copy-object with owner codes only",
    "none",
    lintCodes(withRules([copyRule({})])),
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
    mappingRule("progress-code", { codes: codesOf("300", "400") }),
    copyRule({ copy: ["true"], own: ["false"], source: { property: { propertySet: "P", name: "B" } } }),
  ]), graph, summary, "synthetic");
  const [progress, copy] = synthetic.results;
  record(
    "codes lookup: in list passes, outside list and empty fail",
    "fail 3/2 [not in codes, empty]",
    `${progress.state} ${progress.applicable}/${progress.failed} [` +
      progress.findings
        .map((f) => (f.reason.endsWith("is empty") ? "empty" : f.reason.includes("is not in the project's codes") ? "not in codes" : f.reason))
        .join(", ") + "]",
  );
  // NS 3451: known codes, a reserved code, an unknown code, and a table free
  // of the damage the earlier extraction left (mojibake, "overflåte").
  const ns3451 = CODE_LISTS.ns3451;
  record(
    "ns3451: known codes by name",
    "Bygning|Kledning og overflate|Utendørs tilknytning til eksterne nett for vannforsyning, avløp og fjernvarme|Armaturer for brannslokking med vanntåke",
    ["2", "226", "783", "3334"].map((c) => ns3451.codes[c]).join("|"),
  );
  record("ns3451: 813 codes, 125 reserved", "813 125", `${Object.keys(ns3451.codes).length} ${ns3451.reserved?.length}`);
  record("ns3451: meta count matches", "813 125", `${ns3451.meta.count} ${ns3451.meta.reservedCount}`);
  record("ns3451: nothing left unverified", "0", String(ns3451.meta.unverified?.length));
  const damage = /Ã|â€|Â|\(cid:|overflåte|fjernvårme|åmfier|tåblåer|småvåre|trånsport|behåndling|vanntåk ke|Oppforet/;
  record(
    "ns3451: no mojibake or known-damaged spelling in any name",
    "none",
    Object.entries(ns3451.codes).filter(([, n]) => damage.test(n)).map(([c]) => c).join(",") || "none",
  );
  // NS 3457-8: the names re-read off the page renders (2026-09-25), OPZ which
  // the transcription had dropped, and no mojibake anywhere.
  const ns3457List = CODE_LISTS["ns3457-8"];
  record("ns3457-8: 910 codes, meta count matches", "910 910", `${Object.keys(ns3457List.codes).length} ${ns3457List.meta.count}`);
  record(
    "ns3457-8: page-verified names",
    "Avstivningsstag|Ramperepos|PBX|AV-opptakere|Uttak el|Oppbyggende, utforende",
    ["AFC", "CGC", "OPZ", "RA", "UEA", "AO"].map((c) => ns3457List.codes[c]).join("|"),
  );
  record(
    "ns3457-8: every correction in meta is what the list carries",
    "13 true",
    `${ns3457List.meta.corrections?.length} ${String(ns3457List.meta.corrections?.every((k) => ns3457List.codes[k.code] === k.now))}`,
  );
  record(
    "ns3457-8: no mojibake in any name",
    "none",
    Object.entries(ns3457List.codes).filter(([, n]) => /Ã|â€|Â|\(cid:|�/.test(n)).map(([c]) => c).join(",") || "none",
  );
  const nsGraph: ModelGraph = {
    ...graph,
    products: [wall("n1", "226"), wall("n2", "227"), wall("n3", "999"), wall("n4", "2344")],
  };
  const nsResult = evaluateRuleset(withRules([
    mappingRule("system-classification", { list: "ns3451", extract: "^(\\d{2,4})$" }),
  ]), nsGraph, { ...summary, products: 4 }, "ns3451").results[0];
  record("lint accepts: system-classification on ns3451", "none", lintCodes(withRules([
    mappingRule("system-classification", { list: "ns3451", extract: "^(\\d{2,4})$" }),
  ])));
  record(
    "ns3451 lookup: known passes, reserved and unknown are kinds of their own",
    "fail 4/2 [n2:reserved, n3:not-in-list]",
    `${nsResult.state} ${nsResult.applicable}/${nsResult.failed} [` +
      nsResult.findings.map((f) => `${f.guid}:${f.code}`).join(", ") + "]",
  );
  record(
    "ns3451 lookup: the detail line counts reserved apart from unknown",
    "true",
    String(nsResult.detail.endsWith("1 not in the list, 1 reserved")),
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
      mappingRule("progress-code", { source: { attribute: "Name" }, codes: codesOf("300") }),
      copyRule({ copy: ["true"], own: ["false"] }),
    ]),
    referenceGraph([
      ["300", "false"], // explicit own: in scope
      ["999", "true"], // a copy: excluded, would otherwise fail progress-code
      ["300", null], // no flag: own, in scope
    ]),
    summary,
    "boolean-mode",
  );
  const [boolProgress, boolCopy] = boolCase.results;
  record(
    "copy-object as a flag: the copy is excluded from another rule's findings",
    "pass 2/0, excluded 1 of 3 objects excluded as copies",
    `${boolProgress.state} ${boolProgress.applicable}/${boolProgress.failed}, excluded ${boolCopy.detail}`,
  );

  // Ownership (#7 point 7): the value names the owner. This file's own name
  // is its own object; another discipline's name, or a value from the copy
  // set, is a copy; case and whitespace do not count.
  const ownership = (file: string) =>
    evaluateRuleset(
      {
        ...withRules([
          mappingRule("progress-code", { source: { attribute: "Name" }, codes: codesOf("300") }),
          copyRule({ copy: ["kopi"] }),
        ]),
        disciplines: [{ code: "ARK" }, { code: "RIB" }],
        models: [
          { label: "P_ARK", discipline: "ARK", ownerNames: ["ARK"] },
          { label: "P_RIB", discipline: "RIB", ownerNames: ["RIB"] },
        ],
      },
      referenceGraph([
        ["300", null], // no value: own
        ["999", "RIB"], // RIB's in the ARK file: a copy
        ["300", " ark "], // the file's own name, spaced and lower-case: own
        ["999", "KOPI"], // the copy set: a copy
        ["999", "LARK"], // named nowhere: a copy, tallied deviating
      ]),
      summary,
      file,
    );
  const inArk = ownership("P_ARK.ifc");
  record(
    "copy-object ownership: another owner, the copy set and an unknown name are copies",
    "pass 2/0, 3 of 5 objects excluded as copies, deviating LARK",
    `${inArk.results[0].state} ${inArk.results[0].applicable}/${inArk.results[0].failed}, ${inArk.results[1].detail}, deviating ` +
      (inArk.results[1].values ?? []).filter((v) => v.state === "deviating").map((v) => v.value).join(","),
  );
  const inRib = ownership("P_RIB.ifc");
  record(
    "copy-object ownership: the same values read from RIB's file",
    "3 of 5 objects excluded as copies",
    inRib.results[1].detail,
  );
  const unlisted = ownership("P_RIV.ifc");
  record(
    "copy-object ownership: a file not in models is not_evaluable, nothing excluded",
    "not_evaluable 0",
    `${unlisted.results[1].state} ${unlisted.excludedGuids?.length}`,
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
      { ...mappingRule("progress-code", { codes: codesOf("300") }),
        check: { type: "code-lookup", codes: codesOf("300"), extract: "^(.*)$",
          source: { property: { propertySet: "NONS_Process", name: "Status" } } } },
      { ...mappingRule("system-classification", { codes: codesOf("234") }), id: "class-lookup",
        check: { type: "code-lookup", codes: codesOf("234"), extract: "^(.*)$",
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
      mappingRule("progress-code", { source: { attribute: "Name" }, codes: codesOf("p1", "p3") }),
      copyRule({ source: { property: { propertySet: "NONS_Process", name: "DuplicateOwnedBy" } } }),
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
    "copy-object off a property source excludes the copy",
    "pass 2/0, excluded 1 of 3 objects excluded as copies",
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
    ["bottom a float32 hair under the storey (0 mm slack, edkjo 2026-09-25)", 1, 3 - 4e-6, 4, "yellow"],
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

  // The Overview's classification codes (src/ui/class-codes.ts): presence
  // per system, sorted by code, the bundled list's name for NS 3451, an
  // unknown code marked, absent kept apart from none.
  {
    const refs = (system: string | null, code: string | null, name: string | null) => ({ system, code, name });
    const profile = {
      classifications: new Map([
        ["a", [refs("NS 3451:2022", "226", null), refs("Uniformat", "B2010", "Exterior Walls")]],
        ["b", [refs("NS 3451:2022", "22", null), refs("NS 3451:2022", "999", "x")]],
        ["c", [refs("Uniformat", "B2010", null), refs("Uniformat", "A1010", "Standard Foundations")]],
      ]),
    };
    const all = classificationCodes(profile) ?? [];
    record(
      "class codes: per system, sorted by code, no counts",
      "NS 3451:2022=22,226,999 Uniformat=A1010,B2010",
      all.map((s) => `${s.system}=${s.codes.map((c) => c.code).join(",")}`).join(" "),
    );
    const ns = all[0]?.codes ?? [];
    record(
      "class codes: NS 3451 names from the bundled list, an unknown code marked",
      `${CODE_LISTS.ns3451.codes["226"]}|true|false|x`,
      `${ns.find((c) => c.code === "226")?.name}|${ns.find((c) => c.code === "226")?.known}|${ns.find((c) => c.code === "999")?.known}|${ns.find((c) => c.code === "999")?.name}`,
    );
    record("class codes: a system with no bundled list has no known state", "null", String(all[1]?.codes[0]?.known));
    record(
      "class codes: within a filter, only the codes its elements carry",
      "Uniformat=A1010,B2010",
      (classificationCodes(profile, new Set(["c"])) ?? []).map((s) => `${s.system}=${s.codes.map((c) => c.code).join(",")}`).join(" "),
    );
    record("class codes: a code's elements", "a,c", [...(codeGuids(profile, "Uniformat", "B2010") ?? [])].sort().join(","));
    record("class codes: absent table is null, empty is none", "null|0", `${classificationCodes({})}|${classificationCodes({ classifications: new Map() })?.length}`);
  }

  // The board's code treemaps (src/engine/code-tree.ts): nesting by level,
  // deviating and missing values kept as their own cells, the PredefinedType
  // fallback kept apart from the codes, and no object dropped.
  {
    const objects = [
      { guid: "a", entity: "IfcWall", typeName: "W1", predefinedType: "STANDARD" },
      { guid: "b", entity: "IfcWall", typeName: "W1", predefinedType: null },
      { guid: "c", entity: "IfcSlab", typeName: null, predefinedType: "FLOOR" },
      { guid: "d", entity: "IfcSlab", typeName: "S1", predefinedType: "FLOOR" },
    ];
    const readings = [
      { guid: "a", value: "226", code: "226", state: "ok" as const },
      { guid: "b", value: "227", code: "227", state: "ok" as const },
      { guid: "c", value: "24-", code: null, state: "deviating" as const },
      { guid: "d", value: null, code: null, state: "missing" as const },
    ];
    const describe = (nodes: TreeNode[]): string =>
      nodes.map((n) => `${n.key}=${n.n}${n.children.length ? `(${describe(n.children)})` : ""}`).join(" ");
    const leaves = (nodes: TreeNode[]): number =>
      nodes.reduce((sum, n) => sum + (n.children.length ? leaves(n.children) : n.n), 0);
    const sys = systemTree(objects, readings, { "2": "Bygning", "22": "Bæresystemer", "226": "x" });
    record(
      "code tree: system codes nest by level, deviating and missing keep their own cells",
      "code:2=2(code:22=2(code:226=1 code:227=1)) dev:24-=1 missing=1",
      describe(sys.root),
    );
    record("code tree: a code cell carries its list name", "Bæresystemer", sys.root[0].children[0].name ?? "");
    const byClass = systemTree(objects, null, {});
    record(
      "code tree: no mapping groups by IFC class, one level, no entity or type split under it",
      "class:IfcSlab=2 class:IfcWall=2",
      describe(byClass.root),
    );
    const fn = functionTree(
      objects,
      [
        { guid: "a", value: "QLD", code: "QLD", state: "ok" as const },
        { guid: "b", value: null, code: null, state: "missing" as const },
        { guid: "c", value: null, code: null, state: "missing" as const },
        { guid: "d", value: "ZZ9", code: null, state: "deviating" as const },
      ],
      {},
    );
    record(
      "code tree: no component code falls back to PredefinedType, per object, as its own kind",
      "fb:FLOOR=1:fallback code:Q=1(code:QL=1(code:QLD=1)):code dev:ZZ9=1:deviating missing=1:missing",
      fn.root.map((n) => `${describe([n])}:${n.kind}`).join(" "),
    );
    record("code tree: leaf counts sum to the objects handed in", "4,4,4", [leaves(sys.root), leaves(byClass.root), leaves(fn.root)].join(","));

    // The Rom tab (src/engine/rooms.ts, src/ui/room-plan.ts): spaces are
    // out of both treemaps, with or without a mapping.
    const withSpace = [...objects, { guid: "r", entity: "IfcSpace", typeName: null, predefinedType: "INTERNAL" }];
    record(
      "rooms: IfcSpace is in neither treemap, mapped or not",
      "4,4,4,4",
      [
        leaves(systemTree(withSpace, null, {}).root),
        leaves(systemTree(withSpace, [...readings, { guid: "r", value: "2", code: "2", state: "ok" as const }], {}).root),
        leaves(functionTree(withSpace, null, {}).root),
        systemTree(withSpace, null, {}).n,
      ].join(","),
    );
    const spaceStep = new TextEncoder().encode(
      [
        "#1=IFCSPACE('g1',#2,'',$,$,#3,#4,'M\\X\\F8terom',.ELEMENT.,.INTERNAL.,0.);",
        "#5=IFCSPACE('g2',#2,'101','d',$,#3,#4,$,.ELEMENT.,.INTERNAL.,$);",
        "#6=IFCSPACETYPE('t1',#2,'Type',$,$,$,$,$,$,.SPACE.,$);",
        "#7=IFCSPACE('g3',#2,'102',$,$,#3,#4,'K\\X2\\00F8\\X0\\kken (it''s)',.ELEMENT.,.INTERNAL.,0.);",
      ].join("\n"),
    );
    const longNames = spaceLongNames(spaceStep, 50);
    record(
      "rooms: LongName read from the STEP bytes across chunks, escapes decoded, $ is null, a space type is not a space",
      "g1=Møterom g2=null g3=Køkken (it's) t1=absent",
      `g1=${longNames.g1} g2=${longNames.g2} g3=${longNames.g3} t1=${"t1" in longNames ? "present" : "absent"}`,
    );
    const roomRows = [
      { guid: "a", name: "1", longName: "WC", storeyGuid: "s1" },
      { guid: "b", name: "2", longName: "WC", storeyGuid: "s2" },
      { guid: "c", name: "3", longName: null, storeyGuid: "s2" },
      { guid: "d", name: null, longName: null, storeyGuid: null },
    ];
    const roomQ: Record<string, ElementQuantity> = {
      a: [30, 0, 10, 0, null, 2],
      b: [12, 1, 4, 1, null, 2],
      c: [null, 2, null, 3, null, 2],
    };
    const roomStoreys = [
      { guid: "s1", name: "01", elevation: 0 },
      { guid: "s2", name: "02", elevation: 3 },
    ];
    const show = (gs: ReturnType<typeof roomSchedule>) =>
      gs.map((g) => `${g.label}:${g.guids.length}:${g.area.value}/${g.area.missing}/${g.area.pending}:${g.volume.value}/${g.volume.missing}/${g.volume.pending}`).join(" ");
    record(
      "rooms: the schedule by name (LongName, else Name) and by storey (top first); sums leave missing and pending out and count them",
      "WC:2:14/0/0:42/0/0 3:1:0/0/1:0/1/0 null:1:0/0/1:0/0/1 | 02:2:4/0/1:12/1/0 01:1:10/0/0:30/0/0 null:1:0/0/1:0/0/1",
      `${show(roomSchedule(roomRows, "name", roomQ, roomStoreys))} | ${show(roomSchedule(roomRows, "storey", roomQ, roomStoreys))}`,
    );
    {
      // The 2 x 3 x 4 box below, one foreign vertex first: its plan is its
      // floor, a 2 x 3 rectangle, outlined by four edges.
      const corners = [[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], [0, 0, 4], [2, 0, 4], [2, 3, 4], [0, 3, 4]];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      const pos: number[] = [9, 9, 9];
      const idx: number[] = [];
      for (const f of faces) {
        const base = pos.length / 3;
        for (const c of f) pos.push(...corners[c]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const plan = shapeOf("x", new Float32Array(pos), new Uint32Array(idx), 0, 36);
      record(
        "rooms: a space's plan is its floor (lower half, horizontal faces), outlined by its boundary edges",
        "2,4,6,1,1.5",
        plan ? [plan.tris.length / 6, plan.outline.length / 4, plan.area, ...plan.centre].join(",") : "null",
      );
    }

    // The treemap measures (src/engine/quantities.ts).
    const step = new TextEncoder().encode(
      [
        "#1=IFCPROJECT('g',#2,'P',$,$,$,$,(#9),#10);",
        "#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);",
        "#4=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);",
        "#5=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);",
        "#6=IFCSIUNIT(*,.AREAUNIT.,.CENTI.,.SQUARE_METRE.);",
        "#7=IFCCONVERSIONBASEDUNIT(#8,.AREAUNIT.,'square foot',#11);",
        "#10=IFCUNITASSIGNMENT((#3,#4,#5));",
      ].join("\n"),
    );
    // A 40-byte chunk forces statements across chunk edges.
    const units = quantityUnits(step, 40);
    record(
      "quantities: project units resolve with their prefix (MILLI CUBIC_METRE = 1e-9 m³), a conversion unit does not",
      "1,1e-9,0.0001,null",
      [units.area, units.volume, units.byId["6"]?.factor, units.byId["7"]?.factor].map(String).join(","),
    );
    const q = (guid: string, qto_name: string, quantity_name: string, value: string, type: string, source = "instance", unit: number | null = null) => ({
      guid, qto_name, quantity_name, value, quantity_type: type, unit_step_id: unit, source,
    });
    const qto = qtoQuantities(
      [
        q("w", "Qto_WallBaseQuantities", "GrossVolume", "3000000000", "Volume"),
        q("w", "Qto_WallBaseQuantities", "NetVolume", "2000000000", "Volume"),
        q("w", "Qto_WallBaseQuantities", "NetArea", "9", "Area"),
        q("w", "Qto_WallBaseQuantities", "NetSideArea", "10", "Area", "type"),
        q("w", "Qto_WallBaseQuantities", "NetSideArea", "12", "Area"),
        q("s", "BaseQuantities", "GrossArea", "50000", "Area", "instance", 6),
        q("s", "BaseQuantities", "NetArea", "0", "Area"),
        q("s", "Pset_Custom", "NetVolume", "5", "Volume"),
        q("f", "Qto_WallBaseQuantities", "NetArea", "3", "Area", "instance", 7),
      ],
      new Map([["w", "IfcWall"], ["s", "IfcSlab"], ["f", "IfcSlab"]]),
      units,
    );
    const pk = (p: { value: number; name: string } | null | undefined) => (p ? `${p.name}=${+p.value.toPrecision(6)}` : "-");
    record(
      "quantities: precedence (net before gross, instance before type, per-class area), unit scale, skips",
      "w:NetVolume=2,NetSideArea=12 s:-,GrossArea=5 f:absent",
      `w:${pk(qto.get("w")?.volume)},${pk(qto.get("w")?.area)} s:${pk(qto.get("s")?.volume)},${pk(qto.get("s")?.area)} f:${qto.has("f") ? "present" : "absent"}`,
    );
    // A 2 x 3 x 4 box, flat-shaded: 24 vertices, every corner repeated per face.
    const corners = [
      [0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], [0, 0, 4], [2, 0, 4], [2, 3, 4], [0, 3, 4],
    ];
    const faces = [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ];
    const pos: number[] = [9, 9, 9]; // one foreign vertex first: v0 is not 0
    const idx: number[] = [];
    for (const f of faces) {
      const base = pos.length / 3;
      for (const c of f) pos.push(...corners[c]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const box = meshMeasure(new Float32Array(pos), new Uint32Array(idx), 1, 24, 0, 36);
    record("quantities: a closed box's volume by signed tetrahedra, area as its largest face direction", "true,24,12", `${box.closed},${box.volume},${box.area}`);
    const open = meshMeasure(new Float32Array(pos), new Uint32Array(idx.slice(0, 30)), 1, 24, 0, 30);
    record("quantities: an open mesh has no volume and no area, never zero", "false,null,null", `${open.closed},${open.volume},${open.area}`);
    const tree = systemTree(
      [
        { guid: "w", entity: "IfcWall", typeName: null, predefinedType: null },
        { guid: "b", entity: "IfcWall", typeName: null, predefinedType: null },
        { guid: "o", entity: "IfcWall", typeName: null, predefinedType: null },
        { guid: "n", entity: "IfcWall", typeName: null, predefinedType: null },
      ],
      null,
      {},
    );
    const meshes = new Map([
      ["b", box],
      ["o", open],
    ]);
    const running = measureTree(tree, qto, { byGuid: meshes, complete: false });
    const done = measureTree(tree, qto, { byGuid: meshes, complete: true });
    record(
      "quantities: the fold keeps Qto, computed, missing and pending apart; an element with no mesh is missing once complete",
      "run v 1/1/1/1 · done v 1/1/2/0 · node 26,2,24,2",
      `run v ${running.volume.qto}/${running.volume.computed}/${running.volume.missing}/${running.volume.pending} · ` +
        `done v ${done.volume.qto}/${done.volume.computed}/${done.volume.missing}/${done.volume.pending} · ` +
        `node ${done.nodes["class:IfcWall"].map((x) => +x.toPrecision(6)).join(",")}`,
    );
  }

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

  // Gap 3, Materiale / Produkt switched by mengdetype. One object per path:
  // a door (class telleobjekt, and a code saying mengdeobjekt, which the
  // class overrides) with a ModelReference; furniture with only an
  // ArticleNumber, and with nothing; a wall with a layered Betong, and with
  // «Innervegg»; a covering whose only material is a RAL colour, and one whose
  // material is in a project property; proxies (class avhenger) decided by an
  // NS 3457 code with a suffix, by a project property, and by nothing; a part
  // (ikke_relevant); a slab with a direct material; a class the table lacks.
  const mpEl = (guid: string, entity: string) => ({ ...wall(guid, null), entity });
  const mat = (guid: string, role: string, name: string, thickness: number | null) => ({
    guid, role, layer_index: role === "layer" ? 0 : -1, material_name: name,
    layer_thickness_mm: thickness, category: null, fraction: null, source: "instance",
  });
  const ns3457 = (guid: string, identification: string) => ({
    guid, system_name: "NS 3457-8", edition: null, identification, name: null, location: null,
    source: null, assignment_source: "instance",
  });
  const mpGraph = {
    ...(graph as unknown as IfcGraph),
    products: [
      mpEl("d1", "IFCDOOR"), mpEl("f2", "IFCFURNISHINGELEMENT"), mpEl("f3", "IFCFURNISHINGELEMENT"),
      mpEl("w1", "IFCWALL"), mpEl("w2", "IFCWALL"), mpEl("c1", "IFCCOVERING"), mpEl("c2", "IFCCOVERING"),
      mpEl("x1", "IFCBUILDINGELEMENTPROXY"), mpEl("x2", "IFCBUILDINGELEMENTPROXY"),
      mpEl("x3", "IFCBUILDINGELEMENTPROXY"), mpEl("b1", "IFCBUILDINGELEMENTPART"), mpEl("s1", "IFCSLAB"),
      mpEl("u1", "IFCNOTACLASS"),
    ],
    psets: [
      prop("d1", "Pset_ManufacturerTypeInformation", "ModelReference", "D-10"),
      prop("f2", "Pset_ManufacturerTypeInformation", "ArticleNumber", "A-9"),
      prop("c2", "HI90_Prosjektinfo", "HI90_Material", "Gips"),
      prop("x2", "NOSKI_Mengde", "Mengdetype", "Telleobjekt"),
    ],
    classifications: [ns3457("d1", "AB"), ns3457("x1", "ABA-01")],
    materials: [
      mat("w1", "layer", "Betong", 200), mat("w2", "layer", "Innervegg", 100),
      mat("c1", "direct", "RAL 9010", null), mat("s1", "direct", "Betong", null),
    ],
  } as unknown as IfcGraph;
  const mpLayer: Ruleset["projectLayer"] = {
    "material-product": {
      mengdetype: [{ property: { propertySet: "NOSKI_Mengde", name: "Mengdetype" } }],
      product: [{ property: { propertySet: "Identity Data", name: "MC Product Code" } }],
      material: [{ property: { propertySet: "HI90_Prosjektinfo", name: "HI90_Material" } }],
    },
  };
  const mpRowFor = (projectLayer: Ruleset["projectLayer"] | undefined, g: IfcGraph = mpGraph) =>
    reportRows({
      model: { file: "m.ifc", schema: "IFC4", sha256: "0".repeat(64) },
      graph: g,
      summary: summary as unknown as IfcSummary,
      checks: [],
      ruleset: projectLayer ? ({ ...SAMPLE_RULESET, projectLayer } as Ruleset) : null,
    }).find((r) => r.id === "material-product")!;
  const mpStd = mpRowFor(undefined);
  const mpPrj = mpRowFor(mpLayer);
  record("material-product: standard layer alone", "warn 12=4+2+6 gjelder_ikke 1", `${describe(mpStd)} gjelder_ikke ${mpStd.dekning.gjelder_ikke}`);
  record("material-product: the project layer adds a material and decides a proxy", "warn 12=5+2+5", describe(mpPrj));
  record(
    "material-product: kilder per branch, the class deciding first, 0 hits included",
    "mengdetype:IFC-klasse:standard:9:true,mengdetype:IfcClassificationReference NS 3457:standard:1:false," +
      "mengdetype:NOSKI_Mengde.Mengdetype:prosjekt:1:false," +
      "telleobjekt:Pset_ManufacturerTypeInformation.ModelReference:standard:1:true," +
      "telleobjekt:Pset_ManufacturerTypeInformation.ArticleNumber:standard:1:false," +
      "telleobjekt:Identity Data.MC Product Code:prosjekt:0:false," +
      "mengdeobjekt:IfcMaterial:standard:2:true,mengdeobjekt:IfcMaterialLayerSet:standard:2:false," +
      "mengdeobjekt:HI90_Prosjektinfo.HI90_Material:prosjekt:1:false",
    mpPrj.dekning.kilder.map((k) => `${k.gren}:${k.navn}:${k.lag}:${k.n}:${k.foretrukket}`).join(","),
  );
  record(
    "material-product: one finding per object not oppfylt, by branch",
    "f3:product-missing:null,w2:material-unusable:Innervegg,c1:material-unusable:RAL 9010," +
      "x1:material-missing:null,x2:product-missing:null,x3:mengdetype-undecided:avhenger,u1:mengdetype-undecided:ukjent",
    mpPrj.funn.map((f) => `${f.guid}:${f.grunn}:${f.verdi}`).join(","),
  );
  record(
    "material-product: the open rulings, counted where the class decided, never dropped",
    "Dør og vindu:1,Dekke og tak:1,Trappeløp og rampeløp:0,Prefab-moduler:null / Dør og vindu:1,Dekke og tak:1",
    (mpPrj.aapne ?? []).map((a) => `${a.tittel}:${a.n}`).join(",") + " / " +
      (mpPrj.fordeling ?? []).filter((v) => v.flagg === "åpen").map((v) => `${v.verdi}:${v.n}`).join(","),
  );
  record(
    "material-product: fordeling, values with their flag",
    "null:mangler:5,Betong:ok:2,A-9:ok:1,D-10:ok:1,Gips:ok:1,Innervegg:avvik:1,RAL 9010:avvik:1",
    (mpPrj.fordeling ?? []).filter((v) => v.flagg !== "åpen").map((v) => `${v.verdi}:${v.flagg || "ok"}:${v.n}`).join(","),
  );
  const onlyDoor = { ...mpGraph, products: [mpEl("d1", "IFCDOOR")] } as unknown as IfcGraph;
  record(
    "material-product: an open ruling keeps a clean object off pass",
    "warn 1=1+0+0",
    describe(mpRowFor(undefined, onlyDoor)),
  );
  const noMaterials = { ...mpGraph, materials: undefined } as unknown as IfcGraph;
  record(
    "material-product: no material table is not_evaluable, never mangler",
    "not_evaluable",
    mpRowFor(undefined, noMaterials).state,
  );
  // element-material (#5): a layer-set column, a direct IfcMaterial row, a row
  // ifcfast could not name, and nothing. Only the first two carry a material.
  const emGraph = {
    ...(graph as unknown as IfcGraph),
    projects: [], storey_building: [],
    products: [{ ...wall("L", null), materials: ["Betong"] }, wall("D", null), wall("U", null), wall("N", null)],
    materials: [
      mat("D", "direct", "Eik", null),
      { ...mat("U", "unknown", "", null), material_name: null },
    ],
  } as unknown as IfcGraph;
  const emCheck = (g: IfcGraph) =>
    runFundamentals(g, summary as unknown as IfcSummary).find((c) => c.id === "element-material")!;
  const em = emCheck(emGraph);
  record(
    "element-material: a direct IfcMaterial counts, an unnamed row does not",
    "fail 2/4 U,N",
    `${em.state} ${em.applicable - em.findings.length}/${em.applicable} ${em.findings.map((f) => f.guid).join(",")}`,
  );
  const emRow = reportRows({
    model: { file: "m.ifc", schema: "IFC4", sha256: "0".repeat(64) },
    graph: emGraph,
    summary: summary as unknown as IfcSummary,
    checks: [em],
    ruleset: null,
  }).find((r) => r.id === "element-material")!;
  record(
    "element-material: the report row tallies the direct material too",
    "null:2,Betong:1,Eik:1",
    (emRow.fordeling ?? []).map((v) => `${v.verdi}:${v.n}`).join(","),
  );
  record(
    "element-material: no material table is not_applicable, never layer sets alone",
    "not_applicable",
    emCheck({ ...emGraph, materials: undefined }).state,
  );
  record(
    "material-product: the bundled tables carry their provenance",
    "155 classes, 789 codes, 4 rulings, sha256 64/64/64",
    `${MENGDETYPE_IFCKLASSE.meta.count} classes, ${MENGDETYPE_NS3457.meta.count} codes, ` +
      `${MENGDETYPE_AAPNE.meta.count} rulings, sha256 ` +
      [MENGDETYPE_IFCKLASSE, MENGDETYPE_NS3457, MENGDETYPE_AAPNE].map((t) => t.meta.sha256.length).join("/"),
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
  record("lint: a material-product branch with no source", "error:cascade-sources-empty", layerLint({ "material-product": { product: [] } }));
  record("lint: the HI90 material-product layer lints clean", "none", layerLint(mpLayer));
  record(
    "schema: projectLayer validates, and refuses an unknown key",
    "0 / >0",
    `${shapeErrors({ ...SAMPLE_RULESET, projectLayer: { phase: { sources: [{ property: { propertySet: "A", name: "B" } }] } } }).length} / ` +
      (shapeErrors({ ...SAMPLE_RULESET, projectLayer: { mmi: {} } }).length > 0 ? ">0" : "0"),
  );

  // Gap 5, the pset inventory. Two walls of one type (w2 inherits Status
  // from it), an untyped slab, a storey, a declared type nothing uses.
  const pRow = (guid: string, pset_name: string, prop_name: string, value: string | null, source = "instance") => ({
    guid, pset_name, prop_name, value, value_type: "IfcLabel", source,
  });
  const invGraph = {
    ...(graph as unknown as IfcGraph),
    products: [
      { ...wall("w1", null), entity: "IfcWall", type_guid: "T1" },
      { ...wall("w2", null), entity: "IfcWall", type_guid: "T1" },
      { ...wall("s1", null), entity: "IfcSlab", type_guid: null },
    ],
    storeys: [{ guid: "st1", name: "P1", elevation: 0, building_guid: null }],
    type_objects: [
      { guid: "T1", entity: "IfcWalltype", name: "V1", step_id: 1 },
      { guid: "T2", entity: "IfcWalltype", name: "V2", step_id: 2 },
    ],
    psets: [
      pRow("w1", "Pset_WallCommon", "Status", "NEW"),
      pRow("w1", "Pset_WallCommon", "IsExternal", ""),
      pRow("w2", "Pset_WallCommon", "Status", "NEW", "type"),
      pRow("s1", "HI90_TFM", "Fase", "F1"),
      pRow("st1", "HI90_TFM", "Fase", null),
      pRow("w1", "Pset_Fake", "X", "a"),
    ],
    quantities: [{ guid: "w1", qto_name: "Qto_WallBaseQuantities", quantity_name: "Length", value: "3.",
      quantity_type: "IfcQuantityLength", unit_step_id: null, source: "instance" }],
  } as unknown as IfcGraph;
  const invRuleset = {
    ...SAMPLE_RULESET,
    rules: [
      { id: "r-wall", name: "wall status", kind: "ids", applicability: { entity: { classes: ["IFCWALL"] } },
        requirements: { property: [{ propertySet: { restriction: { pattern: "Pset_Wall.*" } }, baseName: "Status" }] } },
      { id: "r-off", name: "off", kind: "extended", enabled: false,
        check: { type: "code-lookup", codes: [{ code: "a", name: "a" }], extract: "^(.*)$", source: { property: { propertySet: "Pset_Fake", name: "X" } } } },
    ],
    projectLayer: { phase: { sources: [{ property: { propertySet: "HI90_TFM", name: "Fase" } }] } },
  } as unknown as Ruleset;
  const inv = psetInventory(invGraph, "IFC2X3", invRuleset);
  const invSet = (n: string) => inv.psett.find((e) => e.navn === n)!;
  record(
    "psets: category by template definition, IFC4 fallback for Qto on IFC2X3, sorted by category then objects",
    "Pset_WallCommon:pset:ifc,Qto_WallBaseQuantities:qto:ifc,HI90_TFM:pset:krevd,Pset_Fake:pset:annen",
    inv.psett.map((e) => `${e.navn}:${e.art}:${e.kategori}`).join(","),
  );
  record(
    "psets: krevd_av names every enabled reference, a disabled rule none",
    "Pset_WallCommon=rule:r-wall|HI90_TFM=projectLayer:phase|Pset_Fake=",
    ["Pset_WallCommon", "HI90_TFM", "Pset_Fake"].map((n) => `${n}=${invSet(n).krevd_av.join("+")}`).join("|"),
  );
  const wc = invSet("Pset_WallCommon");
  record(
    "psets: objects split by origin, used types behind the type rows",
    "2 f1 t1 typer1 IfcWall:2",
    `${wc.objekter} f${wc.objekter_forekomst} t${wc.objekter_type} typer${wc.typer} ` +
      wc.klasser.map((k) => `${k.klasse}:${k.n}`).join(","),
  );
  record(
    "psets: fill per property is med_verdi/tom/mangler over the set's objects",
    "Status 2/0/0 f1 t1 NEW:2|IsExternal 0/1/1 f1 t0 ",
    wc.egenskaper.map((e) =>
      `${e.navn} ${e.med_verdi}/${e.tom}/${e.mangler} f${e.kilde.forekomst} t${e.kilde.type} ` +
      e.eksempler.map((x) => `${x.verdi}:${x.n}`).join(",")).join("|"),
  );
  const tfm = invSet("HI90_TFM");
  record(
    "psets: a null value is tom, a spatial owner keeps its class, no type rows gives typer null",
    "1/1/0 IfcBuildingStorey:1,IfcSlab:1 typer=null",
    `${tfm.egenskaper[0].med_verdi}/${tfm.egenskaper[0].tom}/${tfm.egenskaper[0].mangler} ` +
      tfm.klasser.map((k) => `${k.klasse}:${k.n}`).join(",") + ` typer=${tfm.typer}`,
  );
  record(
    "psets: the engine limits are stated with their counts",
    "type-rows-on-occurrences:1,unused-type-sets-unreadable:1 typer 2/1",
    inv.grenser.map((g) => `${g.kode}:${g.n}`).join(",") + ` typer ${inv.typer_deklarert}/${inv.typer_ubrukt}`,
  );
  const noTables = psetInventory({ ...(graph as unknown as IfcGraph) }, "IFC4", null);
  record(
    "psets: an absent table is null and a stated limit, never an empty inventory",
    "null/null table-absent:psets,table-absent:quantities,table-absent:type_objects",
    `${noTables.tabeller.psets}/${noTables.tabeller.quantities} ` +
      noTables.grenser.filter((g) => g.kode.startsWith("table-absent")).map((g) => g.kode).join(","),
  );

  // What goes with what (Typer ↔ Materialer, 2026-09-28): the instance order
  // and the three link maps, on a synthetic profile where every answer is
  // known. Storey L2 is ABOVE L1 but listed first, and the GlobalIds are out
  // of order in the rows, so a sort that trusted either would fail.
  {
    const p = (guid: string, entity: string, storeyGuid: string | null, typeName: string | null, materials: string[]) =>
      ({ guid, entity, name: null, storeyGuid, typeName, typeGuid: typeName ? `T-${typeName}` : null, materials });
    const profile = {
      storeys: [
        { guid: "L2", name: "02", elevation: 3 },
        { guid: "L1", name: "01", elevation: 0 },
      ],
      spatial: { projects: 1, sites: 1, buildings: 1, storeys: 2, spaces: 0 },
      rows: [
        p("w-c", "IfcWall", "L2", "V1", ["Betong", "Gips"]),
        p("w-b", "IfcWall", null, "V1", ["Betong"]),
        p("w-a", "IfcWall", "L1", "V1", ["Betong"]),
        p("w-d", "IfcWall", "L1", "V1", ["Betong"]),
        p("s-1", "IfcSlab", "L1", null, ["Betong"]),
        p("d-1", "IfcDoor", "L1", "D9", ["Tre"]),
      ],
      materialRows: [
        { guid: "w-a", role: "layer", layer_index: 0, material_name: "Betong", layer_thickness_mm: 200, category: null, fraction: null, source: "t" },
        { guid: "w-d", role: "layer", layer_index: 0, material_name: "Betong", layer_thickness_mm: 200, category: null, fraction: null, source: "t" },
        { guid: "s-1", role: "layer", layer_index: 0, material_name: "Betong", layer_thickness_mm: 200, category: null, fraction: null, source: "t" },
      ],
    } as unknown as ModelProfile;
    const cat = typeCatalogue(profile);
    const wall = cat.types.find((c) => c.key === "IfcWall::V1");
    record(
      "type instances: by storey from the lowest, then GlobalId, no storey last",
      "w-a,w-d,w-c,w-b",
      wall ? wall.guids.join(",") : "no IfcWall::V1 card",
    );
    const show = (m: Map<string, { key: string; n: number }[]>, k: string) =>
      (m.get(k) ?? []).map((l) => `${l.key}×${l.n}`).join(",");
    record("type → materials, most elements first", "Betong×4,Gips×1", show(cat.typeMaterials, "IfcWall::V1"));
    record(
      "material → types, an untyped class as its own card",
      "IfcWall::V1×4,IfcSlab::×1",
      show(cat.materialTypes, "Betong"),
    );
    const set = cat.sets?.[0];
    record(
      "layer set → the types that use it",
      "3 IfcWall::V1×2,IfcSlab::×1",
      set ? `${set.count} ${show(cat.setTypes, set.key)}` : "no set",
    );
    record("type_guid carried per card", "T-V1", wall ? wall.typeGuids.join(",") : "");
  }

  // The Typer type page (2026-09-28): `typePage` and `typeCodes` on a
  // synthetic model where every answer is known. Four walls of type V1 (w-a,
  // w-d on L1, w-c on L2, w-b in no storey), a slab with no type.
  {
    const p = (guid: string, entity: string, storeyGuid: string | null, typeName: string | null, extra: object = {}) => ({
      guid, entity, name: `N-${guid}`, storeyGuid, typeName, typeGuid: typeName ? `T-${typeName}` : null,
      typeEntity: typeName ? "IfcWalltype" : null, materials: [], ...extra,
    });
    const prop = (name: string, value: string | null, source = "instance") => ({ name, value, source });
    const psets = new Map([
      ["w-a", [
        { name: "Pset_WallCommon", properties: [prop("IsExternal", "True"), prop("Status", "NEW"), prop("AcousticRating", "R40", "type")] },
        { name: "HI90_Prosjektinfo", properties: [prop("HI90_MMI", "300"), prop("Etasje", "01")] },
      ]],
      ["w-d", [
        { name: "Pset_WallCommon", properties: [prop("IsExternal", "True"), prop("AcousticRating", "R40", "type")] },
        { name: "HI90_Prosjektinfo", properties: [prop("HI90_MMI", "700"), prop("Etasje", "01")] },
      ]],
      ["w-c", [
        { name: "Pset_WallCommon", properties: [prop("IsExternal", "False"), prop("AcousticRating", "R40", "type")] },
        { name: "HI90_Prosjektinfo", properties: [prop("HI90_MMI", ""), prop("Etasje", "02")] },
      ]],
      ["w-b", [{ name: "Pset_WallCommon", properties: [prop("AcousticRating", "R40", "type")] }]],
      ["s-1", [{ name: "Pset_SlabCommon", properties: [prop("IsExternal", "False")] }]],
    ]);
    const profile = {
      storeys: [
        { guid: "L2", name: "02", elevation: 3 },
        { guid: "L1", name: "01", elevation: 0 },
      ],
      spatial: { projects: 1, sites: 1, buildings: 1, storeys: 2 },
      rows: [
        p("w-c", "IfcWallStandardCase", "L2", "V1", { predefinedType: "PARTITIONING" }),
        p("w-b", "IfcWallStandardCase", null, "V1"),
        p("w-a", "IfcWallStandardCase", "L1", "V1", { predefinedType: "PARTITIONING" }),
        p("w-d", "IfcWallStandardCase", "L1", "V1", { predefinedType: "PARTITIONING" }),
        p("s-1", "IfcSlab", "L1", null),
      ],
      psets,
      quantities: new Map(),
      classifications: new Map([["w-a", [{ system: "NS 3451", code: "243", name: null, assignmentSource: "type" }]]]),
      materialRows: [
        { guid: "w-a", role: "layer", layer_index: 1, material_name: "Gips", layer_thickness_mm: 13, category: null, fraction: null, source: "type" },
        { guid: "w-a", role: "layer", layer_index: 0, material_name: "Stål", layer_thickness_mm: 70, category: null, fraction: null, source: "type" },
        { guid: "w-d", role: "layer", layer_index: 0, material_name: "Stål", layer_thickness_mm: 70, category: null, fraction: null, source: "type" },
        { guid: "w-d", role: "layer", layer_index: 1, material_name: "Gips", layer_thickness_mm: 13, category: null, fraction: null, source: "type" },
      ],
    } as unknown as ModelProfile;
    const cat = typeCatalogue(profile);
    const wall = cat.types.find((c) => c.key === "IfcWallStandardCase::V1")!;
    const slab = cat.types.find((c) => c.key === "IfcSlab::")!;
    const objects = profile.rows.map((r) => ({ guid: r.guid, entity: r.entity, typeName: r.typeName ?? null, predefinedType: r.predefinedType ?? null }));
    const trees = {
      system: systemTree(
        objects,
        [
          { guid: "w-a", value: "243", code: "243", state: "ok" as const },
          { guid: "w-d", value: "243", code: "243", state: "ok" as const },
          { guid: "w-c", value: "243", code: "243", state: "ok" as const },
          { guid: "w-b", value: null, code: null, state: "missing" as const },
          { guid: "s-1", value: "251", code: "251", state: "ok" as const },
        ],
        { "2": "Bygning", "24": "Innervegger", "243": "Systemvegger" },
      ),
      function: functionTree(objects, null, {}),
    };
    const board = {
      rows: [
        { model: {}, id: "element-typed", state: "fail", dekning: {}, fordeling: [], funn: [{ guid: "s-1", klasse: "IfcSlab", grunn: "no-type", verdi: null }] },
        { model: {}, id: "storey-containment", state: "fail", dekning: {}, fordeling: [], funn: [{ guid: "w-b", klasse: "IfcWallStandardCase", grunn: "not-in-storey", verdi: null }] },
        { model: {}, id: "hi90-mmi", mapping: "progress-code", state: "warn", dekning: {}, fordeling: [], funn: [
          { guid: "w-c", klasse: "IfcWallStandardCase", grunn: "empty", verdi: null },
          { guid: "w-b", klasse: "IfcWallStandardCase", grunn: "empty", verdi: null },
        ] },
      ],
      values: { "hi90-mmi": [["300", ["w-a"]], ["700", ["w-d"]], [null, ["w-c", "w-b"]]] },
      trees,
    } as unknown as BoardData;
    const ruleset = {
      formatVersion: 2, name: "t", ifcVersions: ["IFC4"],
      rules: [
        { id: "hi90-mmi", kind: "extended", mapping: "progress-code", name: "MMI", check: { type: "code-lookup", codes: [{ code: "300", name: "300" }, { code: "700", name: "700" }], source: { property: { propertySet: "HI90_Prosjektinfo", name: "HI90_MMI" } }, extract: "^(\\d{3})$" } },
        { id: "req-ac", kind: "ids", name: "ac", applicability: { entity: { classes: ["IFCWALL"] } }, requirements: { property: [{ propertySet: "Pset_WallCommon", baseName: "AcousticRating" }, { propertySet: "Pset_WallCommon", baseName: "FireRating" }] } },
      ],
    } as unknown as Ruleset;
    const ids = {
      model: "m", schema: "IFC4", title: "t", counts: {},
      specs: [{ index: 0, name: "Spec on the type", state: "fail", applicable: 1, passed: 0, failed: 1, findings: [{ guid: "T-V1", entity: "IfcWallType", name: null, reason: "", code: "requirement" }], detail: "" }],
    } as unknown as IdsModelResult;
    const quantities = {
      complete: true,
      byGuid: {
        "w-a": [1, 0, 10, 0, 4, 0], "w-d": [3, 1, 30, 1, null, 2], "w-c": [2, 0, null, 2, 5, 0], "w-b": [null, 2, null, 2, null, 2],
      },
    } as unknown as { byGuid: Record<string, ElementQuantity>; complete: boolean };
    const lengths = qtoLengths(
      [
        { guid: "a", qto_name: "Qto_WallBaseQuantities", quantity_name: "Length", value: "3000", quantity_type: "Length", unit_step_id: null, source: "type" },
        { guid: "a", qto_name: "Qto_WallBaseQuantities", quantity_name: "Length", value: "2500", quantity_type: "Length", unit_step_id: null, source: "instance" },
        { guid: "b", qto_name: "BaseQuantities", quantity_name: "Width", value: "200", quantity_type: "Length", unit_step_id: null, source: "instance" },
        { guid: "c", qto_name: "BaseQuantities", quantity_name: "Length", value: "10", quantity_type: "Length", unit_step_id: 99, source: "instance" },
        { guid: "e", qto_name: "BaseQuantities", quantity_name: "Length", value: "4000", quantity_type: "Length", unit_step_id: 17, source: "instance" },
        { guid: "d", qto_name: "AC_Pset", quantity_name: "Length", value: "10", quantity_type: "Length", unit_step_id: null, source: "instance" },
      ],
      { area: 1, volume: 1, length: null, byId: { "17": { kind: "length", factor: 0.001 }, "99": { kind: "length", factor: null } } },
      0.001,
    );
    record(
      "QTO length: Length only, scaled to m by its own unit or the project's, instance before type; an unresolved unit and non-base sets skipped",
      "a=2.5,e=4",
      [...lengths].map(([g, v]) => `${g}=${v.value}`).join(","),
    );
    const codes = typeCodes(profile, cat.types, trees);
    record(
      "type object class: ifcfast's IfcWalltype given the IFC spelling against the instance class",
      "IfcWallType IfcDoorStyle IfcFootingtype",
      `${typeObjectClass("IfcWalltype", "IfcWallStandardCase")} ${typeObjectClass("IfcDoorstyle", "IfcDoor")} ${typeObjectClass("IfcFootingtype", "IfcSlab")}`,
    );
    const page = typePage({ profile, card: wall, model: "M.ifc", codes: codes.get(wall.key), board, ids, ruleset, quantities });

    const sys = codes.get(wall.key)!.system;
    const fn = codes.get(wall.key)!.function;
    record(
      "type codes: the majority code with its list name, the others kept, the type object as fallback",
      "code 243 Systemvegger ×3 +fallback IfcWallType ×1",
      `${sys.kind} ${sys.value} ${sys.name} ×${sys.n} ` + sys.others.map((o) => `+${o.kind} ${o.value} ×${o.n}`).join(" "),
    );
    record(
      "type codes: no function mapping falls back to PredefinedType, the instance without one kept",
      "fallback PARTITIONING ×3 +missing ×1",
      `${fn.kind} ${fn.value} ×${fn.n} ` + fn.others.map((o) => `+${o.kind}${o.value ? ` ${o.value}` : ""} ×${o.n}`).join(" "),
    );
    // The Typer and Materialer facets (src/ui/facets.ts, 2026-09-28) on the
    // same model: w-a external, one declared type object no element uses.
    {
      const withRoster = {
        ...profile,
        rows: profile.rows.map((r) => (r.guid === "w-a" ? { ...r, isExternal: true } : r)),
        typeObjects: [
          { guid: "T-V1", entity: "IfcWalltype", name: "V1" },
          { guid: "T-U", entity: "IfcWalltype", name: "U" },
        ],
      } as ModelProfile;
      const c2 = typeCatalogue(withRoster);
      const index = elementFacets(withRoster, trees);
      const fi = typeItems(c2.types, c2.unused ?? [], index);
      const shows = (sel: FacetSelection) => [...narrow(fi.items, sel)].sort().join(",");
      record("facets: the unused type object is a card of its own, class in the IFC spelling", "unused:IfcWallType::U", (c2.unused ?? []).map((c) => c.key).join(","));
      record("facets: no choice shows the instances' cards, not the unused one", "IfcSlab::,IfcWallStandardCase::V1", shows({}));
      record("facets: Én forekomst", "IfcSlab::", shows({ use: ["single"] }));
      record("facets: Ubrukt shows the unused card", "unused:IfcWallType::U", shows({ use: ["unused"] }));
      record("facets: OR within a facet", "IfcSlab::,unused:IfcWallType::U", shows({ use: ["single", "unused"] }));
      record(
        "facets: Systemkode counts, the fallback a value of its own; under Ubrukt only the unused card, none",
        "243:1,251:1,IfcWallType:1 | none:1",
        [{}, { use: ["unused"] }]
          .map((sel) => facetCounts(fi, sel, "system").map((v) => `${v.value.key === NONE ? "none" : v.value.key}:${v.n}`).join(","))
          .join(" | "),
      );
      record("facets: a card answers to every value its instances carry", "IfcWallStandardCase::V1", shows({ ext: ["true"] }));
      record("facets: AND across facets", "", shows({ system: ["251"], ext: ["true"] }));
      record(
        "facets: a value's count applies the other facets, not its own",
        "none:1",
        facetCounts(fi, { system: ["251"] }, "ext").map((v) => `${v.value.key === NONE ? "none" : v.value.key}:${v.n}`).join(","),
      );
      const mats = elementItems([{ key: "Stål", guids: ["w-a", "w-d"] }, { key: "Betong", guids: ["s-1"] }], index);
      record("facets: a material answers through its elements", "Betong", [...narrow(mats.items, { entity: ["IfcSlab"] })].join(","));
    }
    const tp = page.typeProps;
    record(
      "type page: rows folded from the type are the type's properties, one value over four instances",
      "Pset_WallCommon.AcousticRating R40×4 disagree=false",
      "lines" in tp ? tp.lines.map((l) => `${l.pset}.${l.name} ${l.values.map((v) => `${v.value}×${v.n}`).join(",")} disagree=${l.disagree}`).join(" | ") : `absent ${tp.absent}`,
    );
    const slabPage = typePage({ profile, card: slab, model: "M.ifc" });
    record(
      "type page: an untyped card has no type properties, with the reason, never an empty list",
      "untyped",
      "absent" in slabPage.typeProps ? slabPage.typeProps.absent : "lines",
    );
    const noTypeRows = typePage({ profile: { ...profile, psets: new Map([...psets].map(([g, groups]) => [g, groups.map((gr) => ({ ...gr, properties: gr.properties.filter((x) => x.source !== "type") }))])) } as ModelProfile, card: wall, model: "M.ifc" });
    record(
      "type page: a typed card with no row folded from its type says so (the engine limit)",
      "type-rows-on-occurrences",
      "absent" in noTypeRows.typeProps ? noTypeRows.typeProps.absent : "lines",
    );
    const ip = "lines" in page.instanceProps ? page.instanceProps.lines : [];
    const line = (name: string) => ip.find((l) => l.name === name);
    record(
      "type page: instance properties, key ones first, a split IsExternal flagged, MMI per instance not flagged",
      "HI90_MMI:mmi 300×1,700×1 blank1 absent1 flag=false | Status:status NEW×1 absent3 | IsExternal:isExternal True×2,False×1 absent1 flag=true",
      ["HI90_MMI", "Status", "IsExternal"]
        .map((n) => {
          const l = line(n);
          if (!l) return `${n}:none`;
          return `${n}:${l.key} ${l.values.map((v) => `${v.value}×${v.n}`).join(",")}${l.blank ? ` blank${l.blank}` : ""}${l.absent ? ` absent${l.absent}` : ""}${l.key === "status" ? "" : ` flag=${l.disagree}`}`;
        })
        .join(" | "),
    );
    record(
      "type page: a property carrying each instance's own storey name is placement, not flagged",
      "01×2,02×1 perInstance=true disagree=false",
      (() => {
        const l = line("Etasje");
        return l ? `${l.values.map((v) => `${v.value}×${v.n}`).join(",")} perInstance=${l.perInstance} disagree=${l.disagree}` : "none";
      })(),
    );
    record(
      "type page: the order is the key properties first (MMI, status, IsExternal)",
      "HI90_MMI,Status,IsExternal",
      ip.slice(0, 3).map((l) => l.name).join(","),
    );
    record(
      "type page: required properties marked, present from the type, missing counted",
      "Pset_WallCommon.FireRating 0/4 | Pset_WallCommon.AcousticRating 4/0 type4 | HI90_Prosjektinfo.HI90_MMI 2/2 instance2",
      page.required
        .filter((r) => r.by !== "")
        .map((r) => `${r.pset}.${r.prop} ${r.withValue}/${r.missing}${r.level.type ? ` type${r.level.type}` : ""}${r.level.instance ? ` instance${r.level.instance}` : ""}`)
        .sort()
        .reverse()
        .join(" | "),
    );
    record(
      "type page: distribution by storey from the lowest, no storey last, one model",
      "01×2,02×1,-×1 M.ifc×4",
      page.storeys.map((s) => `${s.name ?? "-"}×${s.n}`).join(",") + " " + page.models.map((m) => `${m.value}×${m.n}`).join(","),
    );
    const q = "absent" in page.qto ? [] : page.qto;
    record(
      "type page: QTO sum, min, median, max with the source split per quantity",
      "volume 6 1/2/3 q2c1m1 | area 40 10/20/30 q1c1m2 | length 9 4/4.5/5 q2c0m2",
      q.map((l) => `${l.kind} ${l.sum} ${l.min}/${l.median}/${l.max} q${l.split.qto}c${l.split.computed}m${l.split.missing}`).join(" | "),
    );
    record(
      "type page: no quantities yet is absent, not zero",
      "quantities-not-received",
      "absent" in slabPage.qto ? slabPage.qto.absent : "lines",
    );
    record(
      "type page: requirements count this type's instances among the findings",
      "typeobjekt 0 | objekter-i-etasje 1 not-in-storey | mmi 2 empty×2",
      page.reqs
        .filter((r) => ["element-typed", "storey-containment", "hi90-mmi"].includes(r.id))
        .map((r) => `${r.label?.replace("req.", "")} ${r.failed}${r.grunn.map((g) => ` ${g.value}${g.n > 1 ? `×${g.n}` : ""}`).join("")}`)
        .join(" | "),
    );
    record(
      "type page: an IDS finding on the type object fails every instance",
      "Spec on the type 4",
      (page.ids ?? []).map((s) => `${s.name} ${s.failed}`).join(","),
    );
    record(
      "type page: the MMI reading over the type, the unread counted",
      "configured null×2,300×1,700×1 unread0 | copy-object unconfigured",
      `configured ${page.readings[0].values.map((v) => `${v.value}×${v.n}`).join(",")} unread${page.readings[0].unread} | copy-object ${page.readings[1].configured ? "configured" : "unconfigured"}`,
    );
    record(
      "type page: instances in the navigator order with MMI, status and quantities",
      "w-a 01 300 NEW 1 | w-d 01 700 - 3 | w-c 02 - - 2 | w-b - - - -",
      page.instances.map((r) => `${r.guid} ${r.storey ?? "-"} ${r.mmi ?? "-"} ${r.status ?? "-"} ${r.q?.[0] ?? "-"}`).join(" | "),
    );
    record(
      "type page: identity, the layer stack in order, discrete or composite, the classification with its list name",
      "IfcWalltype×4 | Stål 70/Gips 13 = 83 ×2 | nmat 2 | NS 3451 243 Systemvegger og glassfelt type×1",
      `${page.typeClass.map((v) => `${v.value}×${v.n}`).join(",")} | ${(page.stacks ?? []).map((s) => `${s.layers.map((l) => `${l.material} ${l.thickness}`).join("/")} = ${s.total} ×${s.n}`).join(",")} | nmat ${page.nmat} | ` +
        ("absent" in page.classifications ? "absent" : page.classifications.map((c) => `${c.system} ${c.code} ${c.listName} ${c.source}×${c.n}`).join(",")),
    );
  }

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

  // The IDS importer (src/ids/import.ts) and the IDS tab's run
  // (src/ids/ids-report.ts). The emitted sample round-trips: imported and
  // emitted again, the document is the same.
  const roundTrip = importIds(good, "sample.ids");
  record(
    "import: the emitted sample round-trips to the same document",
    "same",
    emitIdsXml(roundTrip.ruleset, roundTrip.ruleset.rules.filter((r): r is IdsRule => r.kind === "ids")) === good
      ? "same"
      : "differs",
  );
  const spec = (name: string, body: string) =>
    `<specification name="${name}" ifcVersion="IFC4">${body}</specification>`;
  const entity = (cls: string) => `<entity><name><simpleValue>${cls}</simpleValue></name></entity>`;
  const idsDoc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    "<info><title>T &amp; S</title></info><specifications>",
    // 0: a pass
    spec("wall name", `<applicability>${entity("IFCWALL")}</applicability><requirements><attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute></requirements>`),
    // 1: nothing matches: NOT APPLIED, never a pass
    spec("doors", `<applicability>${entity("IFCDOOR")}</applicability><requirements><attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute></requirements>`),
    // 2: the type object itself (ifcfast spells it IfcWalltype)
    spec("type name", `<applicability>${entity("IFCWALLTYPE")}</applicability><requirements><attribute cardinality="prohibited"><name><simpleValue>Name</simpleValue></name><value><xs:restriction base="xs:string"><xs:enumeration value="Default"/></xs:restriction></value></attribute></requirements>`),
    // 3: a boolean compared in the XSD lexical space ("True" is true)
    spec("is external", `<applicability>${entity("IFCWALL")}</applicability><requirements><property dataType="IFCBOOLEAN" cardinality="required"><propertySet><xs:restriction base="xs:string"><xs:pattern value="Pset_.*Common"/></xs:restriction></propertySet><baseName><simpleValue>IsExternal</simpleValue></baseName><value><xs:restriction base="xs:boolean"><xs:enumeration value="true"/><xs:enumeration value="false"/></xs:restriction></value></property></requirements>`),
    // 4: a quantity read as a property, compared as a number
    spec("length", `<applicability>${entity("IFCWALL")}</applicability><requirements><property cardinality="required"><propertySet><simpleValue>Qto_WallBaseQuantities</simpleValue></propertySet><baseName><simpleValue>Length</simpleValue></baseName><value><simpleValue>3</simpleValue></value></property></requirements>`),
    // 5: any material association, from the materials table
    spec("material", `<applicability>${entity("IFCWALL")}</applicability><requirements><material cardinality="required"/></requirements>`),
    // 6: a part of a contained assembly is contained, and in the building
    spec("contained", `<applicability>${entity("IFCMEMBER")}</applicability><requirements><partOf relation="IFCRELCONTAINEDINSPATIALSTRUCTURE" cardinality="required">${entity("IFCBUILDING")}</partOf></requirements>`),
    // 7: a relation the parser does not expose
    spec("grouped", `<applicability>${entity("IFCWALL")}</applicability><requirements><partOf relation="IFCRELASSIGNSTOGROUP" cardinality="required">${entity("IFCSYSTEM")}</partOf></requirements>`),
    // 8: an XSD facet the model has no field for: this spec only is unreadable
    spec("white space", `<applicability><entity><name><xs:restriction base="xs:string"><xs:whiteSpace value="collapse"/></xs:restriction></name></entity></applicability>`),
    // 9: a type object's own property set is not in the parsed tables
    spec("type pset", `<applicability>${entity("IFCWALLTYPE")}</applicability><requirements><property cardinality="required"><propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet><baseName><simpleValue>Reference</simpleValue></baseName></property></requirements>`),
    "</specifications></ids>",
  ].join("");
  const imported = importIds(idsDoc, "t.ids");
  record(
    "import: default namespace, entities decoded, one unreadable spec kept in place",
    "T & S|10|9|8:whiteSpace",
    `${imported.title}|${imported.specs.length}|${imported.ruleset.rules.length}|` +
      imported.specs.filter((s) => s.unreadable).map((s) => `${s.index}:${/whiteSpace/.test(s.unreadable ?? "") ? "whiteSpace" : s.unreadable}`).join(","),
  );
  let strict = "accepted";
  try {
    parseIdsXml(idsDoc, "t.ids");
  } catch (error) {
    strict = /whiteSpace/.test((error as Error).message) ? "refused" : (error as Error).message;
  }
  record("import: the strict ruleset form refuses the whole file", "refused", strict);
  const idsProduct = (guid: string, entity: string, extra: Record<string, unknown> = {}) => ({
    guid, entity, name: guid, predefined_type: null, object_type: null, tag: null,
    storey_guid: null, parent_guid: null, type_name: null, typed: false, materials: [],
    is_external: null, fire_rating: null, load_bearing: null, ...extra,
  });
  const idsGraph: ModelGraph = {
    schema: "IFC4",
    products: [
      idsProduct("w1", "IfcWall", { type_guid: "t1", typed: true }),
      idsProduct("w2", "IfcWall"),
      idsProduct("cw", "IfcCurtainWall"),
      idsProduct("m1", "IfcMember"),
    ],
    contained_in: [{ product_guid: "cw", storey_guid: "s1" }],
    aggregates: [{ child_guid: "m1", parent_guid: "cw", parent_kind: "product" }],
    storey_building: [{ storey_guid: "s1", building_guid: "b1" }],
    voids: [], storeys: [{ guid: "s1", name: "01" }], buildings: [{ guid: "b1", name: "B" }], sites: [], spaces: [],
    type_objects: [{ guid: "t1", entity: "IfcWalltype", name: "Default" }],
    psets: [
      { guid: "w1", pset_name: "Pset_WallCommon", prop_name: "IsExternal", value: "True", value_type: "IfcBoolean" },
      { guid: "w2", pset_name: "Pset_WallCommon", prop_name: "IsExternal", value: "False", value_type: "IfcBoolean" },
    ],
    classifications: [],
    quantities: [{ guid: "w1", qto_name: "Qto_WallBaseQuantities", quantity_name: "Length", value: "3.", quantity_type: "Length" }],
    materials: [{ guid: "w1", role: "unknown", material_name: null, category: null, source: "type" }],
  };
  const idsRun = evaluateIds(imported, idsGraph, { ...summary, products: 4 }, "t");
  const row = (i: number) => {
    const s = idsRun.specs[i];
    return `${s.state} ${s.applicable}/${s.passed}/${s.failed}`;
  };
  record("ids: a pass", "pass 2/2/0", row(0));
  record("ids: zero applicable is not_applicable (NOT APPLIED), never pass", "not_applicable 0/0/0", row(1));
  record(
    "ids: an IFCWALLTYPE entity selects the declared type object, its finding carries the elements using it",
    "fail 1/0/1 w1",
    `${row(2)} ${idsRun.specs[2].findings[0]?.members?.join(",")}`,
  );
  record("ids: an IfcBoolean \"True\" / \"False\" satisfies xs:boolean true, false", "pass 2/2/0", row(3));
  record("ids: a quantity is a property, \"3.\" equals 3; absent fails", "fail 2/1/1 w2", `${row(4)} ${idsRun.specs[4].findings.map((f) => f.guid).join(",")}`);
  record("ids: any material association counts, even an unresolved one from the type", "fail 2/1/1 w2", `${row(5)} ${idsRun.specs[5].findings.map((f) => f.guid).join(",")}`);
  record("ids: a part of a contained assembly is contained, up to the building", "pass 1/1/0", row(6));
  record(
    "ids: IFCRELASSIGNSTOGROUP is not_evaluable with the reason",
    "not_evaluable IFCRELASSIGNSTOGROUP",
    `${idsRun.specs[7].state} ${/IFCRELASSIGNSTOGROUP is not exposed/.test(idsRun.specs[7].reason ?? "") ? "IFCRELASSIGNSTOGROUP" : idsRun.specs[7].reason}`,
  );
  record(
    "ids: an unreadable spec is not_evaluable in its place, with the import reason",
    "not_evaluable whiteSpace",
    `${idsRun.specs[8].state} ${/whiteSpace/.test(idsRun.specs[8].reason ?? "") ? "whiteSpace" : idsRun.specs[8].reason}`,
  );
  record("ids: a type object's own pset is not_evaluable, not a fail", "not_evaluable", idsRun.specs[9].state);
  record(
    "ids: counts per state",
    "pass 3 fail 3 not_applicable 1 not_evaluable 3",
    `pass ${idsRun.counts.pass} fail ${idsRun.counts.fail} not_applicable ${idsRun.counts.not_applicable} not_evaluable ${idsRun.counts.not_evaluable}`,
  );

  // Chart colour (src/ui/chart-colors.ts): one class, one colour, in the
  // charts and the Graf tab alike; no category on a status hue; every fill a
  // label reads on at AA.
  const rgb = (c: readonly number[]) => c.join(",");
  const graphRamp = classRamp(["IfcWall", "IfcSlab", "IfcDoor", "IfcBuildingElementProxy", "IfcFlowTerminal"]);
  record(
    "colour: the graph's class colour is the chart's, for every class",
    "same",
    [...graphRamp.entries()].every(([e, c]) => rgb(c) === rgb(classColour(e))) ? "same" : "differs",
  );
  record(
    "colour: IfcWall, IFCWALL and IfcWallStandardCase are one colour",
    "1",
    String(new Set(["IfcWall", "IFCWALL", "IfcWallStandardCase"].map((e) => rgb(classColour(e)))).size),
  );
  record(
    "colour: walls, slabs, doors, windows and frame members are five colours",
    "5",
    String(new Set(["IfcWall", "IfcSlab", "IfcDoor", "IfcWindow", "IfcBeam"].map((e) => rgb(classColour(e)))).size),
  );
  record(
    "colour: no category sits on a status or accent hue",
    "none",
    CATEGORICAL.map(clashesWithStatus).filter(Boolean).join(",") || "none",
  );
  const codes = ["2", "22", "221", "222", "223", "224", "23", "24", "25", "3", "31", "32", "33", "4", "5", "6", "7", "Q", "QL", "QLD", "QLE", "QLF", "QLG", "A", "B", "Z"];
  const fills = [...CATEGORICAL, ...codes.map(codeColour), ...CATEGORICAL.map(frameColour)];
  record(
    "colour: every category, code shade and frame holds AA (4.5:1) for its label",
    "all",
    fills.every((f) => contrast(f, labelOn(f)) >= 4.5) ? "all" : fills.filter((f) => contrast(f, labelOn(f)) < 4.5).map(rgb).join(" "),
  );
  record(
    "colour: a code's child stays in its parent's family, siblings differ",
    "family distinct",
    `${codeColour("22")[2] > codeColour("22")[0] === codeColour("2")[2] > codeColour("2")[0] ? "family" : "drift"} ${rgb(codeColour("22")) !== rgb(codeColour("23")) ? "distinct" : "same"}`,
  );
  record(
    "colour: the MMI ramp darkens with the level",
    "ordered",
    [0, 1, 2, 3, 4, 5, 6].every((i) => i === 0 || luminance(mmiColour(i, 7)) < luminance(mmiColour(i - 1, 7))) ? "ordered" : "not",
  );
  // The ink flip (2026-09-30): the label's ink is computed from the cell's
  // own colour, and a fill where neither ink reaches AA moves out of that
  // band, so every labelled cell reads at 4.5:1.
  {
    const census = [1, 7, 40, 154, 1500].flatMap((peak) =>
      Array.from({ length: 41 }, (_, i) => censusCell(Math.round((peak * i) / 40), peak)),
    );
    const low = census.filter((c) => contrast(c.fill, c.ink) < 4.5);
    record(
      "ink flip: every Etasje × klasse cell on the ramp holds 4.5:1",
      "all",
      low.length === 0 ? "all" : low.map((c) => `${rgb(c.fill)}/${rgb(c.ink)}`).join(" "),
    );
    const one = Array.from({ length: 41 }, (_, i) => censusCell(Math.round((154 * i) / 40), 154));
    record(
      "ink flip: the census ramp keeps its order (more elements, darker)",
      "ordered",
      one.every((c, i) => i === 0 || luminance(c.fill) <= luminance(one[i - 1].fill)) ? "ordered" : "not",
    );
    const greys = Array.from({ length: 52 }, (_, i) => [i * 5, i * 5, i * 5] as const);
    const cells = [...greys, ...CATEGORICAL, ...CATEGORICAL.map(frameColour), ...codes.map(codeColour)].map((f) =>
      readableCell(f),
    );
    const bad = cells.filter((c) => contrast(c.fill, c.ink) < 4.5);
    record(
      "ink flip: a treemap cell of any fill, the dead band included, holds 4.5:1",
      "all",
      bad.length === 0 ? "all" : bad.map((c) => rgb(c.fill)).join(" "),
    );
  }

  // The cross-filter reducer (src/ui/filter-state.ts, 2026-09-28): one
  // filter, one origin. A click replaces, the chosen item again clears, and
  // nothing is ever the intersection of two clicks.
  {
    const cell = (key: string, guids: string[]) =>
      ({ type: "choose", origin: "tree-system", key, filter: { kind: "tree", label: key, guids }, scope: null }) as const;
    const a = reduceFilter(EMPTY_FILTER, cell("A", ["g1", "g2", "g3"]));
    const b = reduceFilter(a, {
      type: "choose",
      origin: "graph",
      key: "storey:s1",
      filter: { kind: "storey", label: "s1", guids: ["g3", "g4"] },
      scope: null,
    });
    const f = (s: typeof a) => (s.filter ? `${s.filter.origin}:${s.filter.key}=${(s.filter.guids ?? []).join(",")}` : "none");
    record("xfilter: a click sets the one filter and its origin", "tree-system:A=g1,g2,g3", f(a));
    record("xfilter: a click in another view REPLACES it (not the intersection g3)", "graph:storey:s1=g3,g4", f(b));
    record("xfilter: the chosen item again clears it", "none", f(reduceFilter(b, { type: "choose", origin: "graph", key: "storey:s1", filter: null, scope: null })));
    record("xfilter: another item in the same view replaces", "tree-system:B=g9", f(reduceFilter(a, cell("B", ["g9"]))));
    const pick = (s: typeof a, origin: string, guid: string | null, additive = false) =>
      reduceFilter(s, { type: "element", origin, guid, label: null, additive });
    const p1 = pick(b, "viewer", "g7");
    record("xfilter: a canvas pick is the 3D's own filter, selected", "viewer:element:g7=g7 sel g7", `${f(p1)} sel ${p1.selection.join(",")}`);
    const p2 = pick(p1, "viewer", "g8", true);
    record("xfilter: Shift adds within the same view", "viewer:element:g7+g8=g7,g8", f(p2));
    record("xfilter: Shift in ANOTHER view replaces", "graph:element:g5=g5", f(pick(p2, "graph", "g5", true)));
    record("xfilter: the lone element again clears", "none", f(pick(p1, "viewer", "g7")));
    const s1 = pick(a, "scope", "g2");
    record("xfilter: a Scope pick keeps Scope's list and isolates the element", "scope:element:g2=g2", f(s1));
    record("xfilter: the same Scope row again steps back to the list's filter", "tree-system:A=g1,g2,g3", f(pick(s1, "scope", "g2")));
    record("xfilter: Tøm clears", "none", f(reduceFilter(b, { type: "clear" })));

    // The selection is its own state (2026-09-29): a click on an object
    // selects and never touches the filter.
    const sel = (s: typeof a, guid: string | null, additive = false) => reduceFilter(s, { type: "select", guid, additive });
    const esc = (s: typeof a) => reduceFilter(s, { type: "escape" });
    const g = (s: typeof a) => `${f(s)} @${s.origin} sel ${s.selection.join(",")}`;
    const c1 = sel(a, "g2");
    record("select: a click under a filter keeps it and selects", "tree-system:A=g1,g2,g3 @tree-system sel g2", g(c1));
    record("select: outside the set (highlight mode) the filter stays", "tree-system:A=g1,g2,g3 @tree-system sel g9", g(sel(a, "g9")));
    record("select: a double-click (the same object twice) keeps it", "tree-system:A=g1,g2,g3 @tree-system sel g2", g(sel(c1, "g2")));
    record("select: the second click is a new request (a new array)", "new", sel(c1, "g2").selection !== c1.selection ? "new" : "same");
    record("select: empty space clears the selection only", "tree-system:A=g1,g2,g3 @tree-system sel ", g(sel(c1, null)));
    record("select: Esc once clears the selection, the filter stays", "tree-system:A=g1,g2,g3 @tree-system sel ", g(esc(c1)));
    record("select: Esc twice clears the filter", "none @null sel ", g(esc(esc(c1))));
    const c2 = sel(c1, "g3", true);
    record("select: Shift adds to the selection, not the filter", "tree-system:A=g1,g2,g3 @tree-system sel g2,g3", g(c2));
    record("select: Shift on a selected one takes it out", "tree-system:A=g1,g2,g3 @tree-system sel g3", g(sel(c2, "g2", true)));
    record("select: a plain click replaces a multi-selection", "tree-system:A=g1,g2,g3 @tree-system sel g1", g(sel(c2, "g1")));
    record("select: Scope's list stays", "same", sel({ ...a, scope: { kind: "element", guids: ["g1"] } }, "g2").scope?.kind === "element" ? "same" : "lost");
    record("select: with no filter it selects and filters nothing", "none @null sel g4", g(sel(EMPTY_FILTER, "g4")));
    record("select: Tøm clears the filter and keeps the selection", "none @null sel g2", g(reduceFilter(c1, { type: "clear" })));

    // Esc from anywhere (2026-09-30, ESC ESCALATES): one window-level path
    // over every model. A check row's filter, then a Scope row's selection:
    // the first Esc clears the selection only, the second the filter.
    const check = reduceFilter(EMPTY_FILTER, {
      type: "choose",
      origin: "checks",
      key: "check:type-unused",
      filter: { kind: "check", label: "Ubrukt type", guids: ["t1", "t2"] },
      scope: { kind: "check", checkId: "type-unused" },
    });
    const scoped = sel(check, "t2");
    const two = { m1: scoped, m2: a };
    const e1 = escapeAll(two);
    record("esc: first Esc clears the selection, both filters stay", "checks:check:type-unused=t1,t2 @checks sel  | tree-system:A=g1,g2,g3 @tree-system sel ", `${g(e1.m1)} | ${g(e1.m2)}`);
    record("esc: the first Esc leaves a model without a selection untouched", "same", e1.m2 === a ? "same" : "new");
    record("esc: first Esc keeps Scope's list", "check", e1.m1.scope?.kind ?? "none");
    const e2 = escapeAll(e1);
    record("esc: second Esc clears every filter (the chip's ✕)", "none @null sel  | none @null sel ", `${g(e2.m1)} | ${g(e2.m2)}`);
    record("esc: second Esc clears Scope", "none", e2.m1.scope?.kind ?? "none");
    record("esc: at rest Esc changes nothing (same object)", "same", escapeAll(e2) === e2 ? "same" : "new");
    record("esc: a filter with no selection clears on the first Esc", "none @null sel ", g(escapeAll({ m: check }).m));
  }
  {
    // Which containers hold the selection (src/ui/selection-marks.ts): the
    // one mark every view carries, over the row facts and a resolver.
    const rows = [
      { guid: "w1", entity: "IfcWall", name: null, storeyGuid: "s1", typed: true, typeName: "Vegg A" },
      { guid: "w2", entity: "IfcWall", name: null, storeyGuid: "s2", typed: true, typeName: "Vegg B" },
      { guid: "d1", entity: "IfcDoor", name: null, storeyGuid: "gone", typed: false, typeName: null },
      { guid: "o1", entity: "IfcOpeningElement", name: null, storeyGuid: "s1", typed: true, typeName: "Hull", isOpening: true },
    ];
    const profile = { rows, storeys: [{ guid: "s1" }, { guid: "s2" }] } as unknown as ModelProfile;
    const asked: string[] = [];
    const resolve = (focus: { kind: string }) => {
      asked.push(focus.kind);
      return focus.kind === "check" ? new Set(["w2", "x"]) : null;
    };
    const m = (sel: string[]) => selectionMarks(sel, profile, resolve);
    const one = m(["w1"]);
    const yes = (b: boolean) => (b ? "y" : "n");
    record(
      "selmark: class, cell, storey, type of the selected wall",
      "y n | y n | y n | y n",
      [
        `${yes(one.focus({ kind: "class", entity: "IfcWall" }))} ${yes(one.focus({ kind: "class", entity: "IfcDoor" }))}`,
        `${yes(one.focus({ kind: "cell", storeyGuid: "s1", entity: "IfcWall" }))} ${yes(one.focus({ kind: "cell", storeyGuid: "s2", entity: "IfcWall" }))}`,
        `${yes(one.focus({ kind: "storey", storeyGuids: ["s1"] }))} ${yes(one.focus({ kind: "storey", storeyGuids: ["s2"] }))}`,
        `${yes(one.focus({ kind: "type", typeName: "Vegg A" }))} ${yes(one.focus({ kind: "type", typeName: "Vegg B" }))}`,
      ].join(" | "),
    );
    const door = m(["d1"]);
    record(
      "selmark: an element on an unknown storey is in the no-storey cell, untyped in the untyped row",
      "y y n y",
      [
        door.focus({ kind: "cell", storeyGuid: null, entity: "IfcDoor" }),
        door.focus({ kind: "storey", storeyGuids: [null] }),
        door.focus({ kind: "storey", storeyGuids: ["gone"] }),
        door.focus({ kind: "type", typeName: null }),
      ].map(yes).join(" "),
    );
    record("selmark: an opening is in no type", "n n", [m(["o1"]).focus({ kind: "type", typeName: "Hull" }), m(["o1"]).focus({ kind: "type", typeName: null })].map(yes).join(" "));
    const multi = m(["w1", "w2"]);
    record(
      "selmark: multi-select marks every container",
      "y y y",
      [multi.focus({ kind: "storey", storeyGuids: ["s1"] }), multi.focus({ kind: "storey", storeyGuids: ["s2"] }), multi.focus({ kind: "type", typeName: "Vegg B" })].map(yes).join(" "),
    );
    asked.length = 0;
    const via = [multi.focus({ kind: "check", checkId: "c" }), multi.focus({ kind: "check", checkId: "c" }), one.focus({ kind: "check", checkId: "c" })];
    record("selmark: other foci through the resolver, once per selection", "y y n | check,check", `${via.map(yes).join(" ")} | ${asked.join(",")}`);
    record("selmark: a set with no elements, and a kpi, hold nothing", "n n", [multi.focus({ kind: "rule", ruleId: "r" }), multi.focus({ kind: "kpi", kpi: "products" })].map(yes).join(" "));
    record("selmark: a card's guids, and an element focus", "y n y", [multi.any(["x", "w2"]), multi.any(["x"]), multi.focus({ kind: "element", guids: ["w1"] })].map(yes).join(" "));
    const none = m([]);
    record("selmark: nothing selected marks nothing", "0 n n", `${none.size} ${yes(none.focus({ kind: "class", entity: "IfcWall" }))} ${yes(none.any(["w1"]))}`);
  }
  // The layer section (src/ui/layer-section.ts): an honest 1:20, the file's
  // order, the total, and a layer with no thickness never drawn as 0.
  record("layers: px per mm at 1:20 (96 px per inch)", "0.1890", PX_PER_MM.toFixed(4));
  const cut = layerSection([
    { material: "Gips 12,5", thickness: 12.5 },
    { material: "Mineralull", thickness: 200 },
    { material: "Betong B35", thickness: 150 },
  ]);
  record(
    "layers: order kept, bands abut at scale, total the sum",
    "0,12.5,212.5|362.5|68.50|gypsum,insulation,concrete",
    `${cut.bands.map((b) => +(b.at / PX_PER_MM).toFixed(2)).join(",")}|${cut.totalMm}|${cut.px.toFixed(2)}|${cut.bands.map((b) => b.category).join(",")}`,
  );
  const gap = layerSection([
    { material: "Trekledning", thickness: 22 },
    { material: null, thickness: null },
  ]);
  record(
    "layers: a layer with no thickness is drawn nominal and hatched, the total unknown",
    `unknown ${UNKNOWN_PX} null wood`,
    `${gap.bands[1].unknown ? "unknown" : "known"} ${gap.bands[1].size} ${gap.totalMm} ${gap.bands[0].category}`,
  );
  record("layers: walls stand, slabs and roofs lie", "vertical horizontal horizontal", ["IfcWallStandardCase", "IfcSlab", "IfcRoof"].map(sectionOrientation).join(" "));

  {
    // body-no-mesh: the Body declaration read from the STEP bytes, across
    // 64-byte chunks. A mapped item is followed into its mapped
    // representation, a clipping result into its first operand; a FootPrint
    // alone and no representation at all are both "no Body".
    const step = new TextEncoder().encode(
      [
        "#1=IFCWALL('0aaaaaaaaaaaaaaaaaaaaa',#2,'Vegg A',$,$,#3,#10,$);",
        "#10=IFCPRODUCTDEFINITIONSHAPE($,$,(#11,#12));",
        "#11=IFCSHAPEREPRESENTATION(#20,'Axis','Curve2D',(#30));",
        "#12=IFCSHAPEREPRESENTATION(#20,'Body','MappedRepresentation',(#13));",
        "#13=IFCMAPPEDITEM(#14,#15);",
        "#14=IFCREPRESENTATIONMAP(#16,#17);",
        "#17=IFCSHAPEREPRESENTATION(#20,'Body','Brep',(#18,#19));",
        "#18=IFCFACETEDBREP(#40);",
        "#19=IFCFACETEDBREP(#41);",
        "#5=IFCSLAB('1bbbbbbbbbbbbbbbbbbbbb',#2,'Dekke',$,$,#3,#50,$,$);",
        "#50=IFCPRODUCTDEFINITIONSHAPE($,$,(#51));",
        "#51=IFCSHAPEREPRESENTATION(#20,'Body','Clipping',(#52));",
        "#52=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#53,#54);",
        "#53=IFCEXTRUDEDAREASOLID(#60,#61,#62,3.);",
        "#6=IFCBUILDINGELEMENTPROXY('2ccccccccccccccccccccc',#2,'P',$,$,#3,#70,$,$);",
        "#70=IFCPRODUCTDEFINITIONSHAPE($,$,(#71));",
        "#71=IFCSHAPEREPRESENTATION(#20,'FootPrint','Curve2D',(#72));",
        "#7=IFCELEMENTASSEMBLY('3ddddddddddddddddddddd',#2,'Assy',$,$,#3,$,$,$,$);",
        "#8=IFCWALL('9zzzzzzzzzzzzzzzzzzzzz',#2,'Not asked',$,$,#3,#10,$);",
      ].join("\n"),
    );
    const asked = new Set(["0aaaaaaaaaaaaaaaaaaaaa", "1bbbbbbbbbbbbbbbbbbbbb", "2ccccccccccccccccccccc", "3ddddddddddddddddddddd"]);
    const declared = bodyDeclarations(step, asked, 64);
    const show = (g: string) => {
      const d = declared[g];
      return d === undefined ? "absent" : d === null ? "null" : `${d.identifier}:${d.type}:${d.items.join("|")}`;
    };
    record(
      "body-no-mesh: Body read from the STEP bytes across chunks, mapped items and clipping followed, FootPrint alone and no representation are no Body, an unasked element is not read",
      "Body:MappedRepresentation:IfcMappedItem>IfcFacetedBrep Body:Clipping:IfcBooleanClippingResult>IfcExtrudedAreaSolid null null absent",
      [...asked, "9zzzzzzzzzzzzzzzzzzzzz"].map(show).join(" "),
    );

    const product = (guid: string, entity: string, name: string) => ({ guid, entity, name });
    const graph = {
      products: [
        product("0aaaaaaaaaaaaaaaaaaaaa", "IfcWall", "Vegg A"),
        product("1bbbbbbbbbbbbbbbbbbbbb", "IfcSlab", "Dekke"),
        product("2ccccccccccccccccccccc", "IfcBuildingElementProxy", "P"),
        product("3ddddddddddddddddddddd", "IfcElementAssembly", "Assy"),
        product("4eeeeeeeeeeeeeeeeeeeee", "IfcWall", "Meshed"),
      ],
      voids: [],
      body_declared: declared,
    } as unknown as IfcGraph;
    const boxes = new Map([["4eeeeeeeeeeeeeeeeeeeee", { min: [0, 0, 0], max: [1, 1, 1] }]]);
    const checked = checkBodyWithoutMesh(graph, boxes);
    const unread = checkBodyWithoutMesh({ ...graph, body_declared: undefined }, boxes);
    const noMesh = checkBodyWithoutMesh(graph, null);
    record(
      "body-no-mesh: Body declared and no mesh is a finding, no Body is not; not read or no geometry is not_applicable, never a pass",
      "fail 1 of 3 0aaaaaaaaaaaaaaaaaaaaa,1bbbbbbbbbbbbbbbbbbbbb | not_applicable | not_applicable",
      `${checked.state} ${checked.displayValue.text} ${checked.findings.map((f) => f.guid).join(",")} | ${unread.state} | ${noMesh.state}`,
    );

    // The issue: one signature per element class + item chain, only where
    // ifcopenshell found geometry, and NO CLIENT DATA in title or body.
    const secretFile = "KNM_ARK_Kistefos.ifc";
    const hostile = {
      ...checked.findings[1],
      params: { ...checked.findings[1].params, type: "Kistefos Hall 2" },
    };
    const facts = issueFacts(
      [checked.findings[0], hostile],
      {
        "0aaaaaaaaaaaaaaaaaaaaa": { kind: "geometry", vertices: 24, faces: 12 },
        "1bbbbbbbbbbbbbbbbbbbbb": { kind: "geometry", vertices: 8, faces: 12 },
      },
      "0.8.5",
    );
    const issueText = facts.map((f) => `${issueTitle(f)}\n${issueBody(f)}\n${decodeURIComponent(newIssueUrl(f))}`).join("\n");
    const leaks = [
      "0aaaaaaaaaaaaaaaaaaaaa",
      "1bbbbbbbbbbbbbbbbbbbbb",
      "Vegg A",
      "Dekke",
      "Kistefos",
      secretFile,
      "KNM",
    ].filter((s) => issueText.includes(s));
    record(
      "body-no-mesh: the ifcfast issue carries the signature and counts, and no GUID, element name, file name or free-text representation type",
      `IfcWall / IfcMappedItem>IfcFacetedBrep / ifcfast ${bodySignature("IfcWall", "IfcMappedItem>IfcFacetedBrep").split(" / ifcfast ")[1]}|IfcSlab / IfcBooleanClippingResult>IfcExtrudedAreaSolid / ifcfast ${bodySignature("IfcSlab", "x").split(" / ifcfast ")[1]} | leaks: none | type: (other)`,
      `${facts.map((f) => f.signature).join("|")} | leaks: ${leaks.length ? leaks.join(",") : "none"} | type: ${facts[1]?.types.join(",")}`,
    );
    const sig = facts[0].signature;
    record(
      "body-no-mesh: an existing issue counts only when its title carries the signature verbatim",
      "#7 null",
      `#${matchingIssue(sig, [{ title: "IfcWall IfcFacetedBrep", html_url: "u1", number: 3 }, { title: `Body declared, no mesh: ${sig}`, html_url: "u2", number: 7 }])?.number} ${matchingIssue(sig, [{ title: "IfcWall / IfcFacetedBrep", html_url: "u", number: 1 }])}`,
    );

    // The second check (edkjo 2026-09-30): ifcopenshell on every element
    // ifcfast left unmeshed. Pending: ifcfast's findings, every line marked
    // unverified. Done: an element ifcopenshell meshed is an ifcfast miss
    // (Body or not); a Body it also finds nothing for stays a finding; no
    // Body and nothing is counted, never a finding. Failed with nothing
    // found is review, never a pass.
    const done: NomeshVerification = {
      state: "done",
      version: "0.8.5",
      verdicts: {
        "0aaaaaaaaaaaaaaaaaaaaa": { kind: "geometry", vertices: 24, faces: 12 },
        "1bbbbbbbbbbbbbbbbbbbbb": { kind: "none", why: "empty" },
        "2ccccccccccccccccccccc": { kind: "geometry", vertices: 8, faces: 6 },
        "3ddddddddddddddddddddd": { kind: "none", why: "no-representation" },
      },
    };
    const verified = checkBodyWithoutMesh(graph, boxes, undefined, undefined, done);
    const verdictOfFinding = verified.findings.map((f) => `${f.entity}:${f.params?.verdict}:${f.params?.items}`).join(" ");
    record(
      "second check: ifcopenshell geometry is an ifcfast miss with or without a Body; Body and nothing stays; no Body and nothing is counted",
      "fail IfcWall:geometry:IfcMappedItem>IfcFacetedBrep IfcSlab:none:IfcBooleanClippingResult>IfcExtrudedAreaSolid IfcBuildingElementProxy:geometry:(no Body) | miss 2 bodyNoMesh 1 noBody 1 | done 0.8.5",
      `${verified.state} ${verdictOfFinding} | miss ${verified.detailLine?.params.miss} bodyNoMesh ${verified.detailLine?.params.bodyNoMesh} noBody ${verified.detailLine?.params.noBody} | ${verified.detailLine?.params.verify} ${verified.detailLine?.params.ifcos}`,
    );
    const onlyAssembly = { ...graph, products: graph.products.filter((p) => p.guid.startsWith("3") || p.guid.startsWith("4")) } as IfcGraph;
    const failed = checkBodyWithoutMesh(onlyAssembly, boxes, undefined, undefined, { state: "failed", stage: "wheel", message: "404" });
    const pendingPass = checkBodyWithoutMesh(onlyAssembly, boxes);
    const unavailable = checkBodyWithoutMesh(onlyAssembly, boxes, undefined, undefined, { state: "unavailable", why: "no-file" });
    const agreed = checkBodyWithoutMesh(onlyAssembly, boxes, undefined, undefined, done);
    record(
      "second check: failed or unavailable with unmeshed elements and nothing found is review, never a pass; done and agreed is a pass",
      "review review pass(unverified) pass",
      `${failed.state} ${unavailable.state} ${pendingPass.state}(${pendingPass.detailLine?.params.verify === "pending" ? "unverified" : "?"}) ${agreed.state}`,
    );
    record(
      "second check: the lines say unverified, failed or the version, in both languages",
      "; ikke verifisert | ; ifcopenshell feilet (wheel) | ; ikke verifisert (IFC-filen er ikke åpnet i denne økten) | 1 med mesh; 2 ifcfast-feil; 1 med Body uten geometri; 1 uten geometri og uten Body; ifcopenshell 0.8.5 | 1 meshed; 2 ifcfast miss",
      [
        detailText(checked.detailLine!, "nb", "").slice(detailText(checked.detailLine!, "nb", "").lastIndexOf(";")),
        detailText(failed.detailLine!, "nb", "").slice(detailText(failed.detailLine!, "nb", "").lastIndexOf(";")),
        detailText(unavailable.detailLine!, "nb", "").slice(detailText(unavailable.detailLine!, "nb", "").lastIndexOf(";")),
        detailText(verified.detailLine!, "nb", ""),
        detailText(verified.detailLine!, "en", "").split("; ").slice(0, 2).join("; "),
      ].join(" | "),
    );
    record(
      "second check: nomeshCounts splits ifcfast's unmeshed count by verdict, all unverified before done",
      "none 2 miss 2 errors 0 unverified 1 | unverified 5",
      (() => {
        const guids = [...Object.keys(done.verdicts), "5fffffffffffffffffffff"];
        const c = nomeshCounts(guids, done);
        return `none ${c.none} miss ${c.miss} errors ${c.errors} unverified ${c.unverified} | unverified ${nomeshCounts(guids).unverified}`;
      })(),
    );
    const missFacts = issueFacts(verified.findings, done.verdicts, "0.8.5");
    const missText = missFacts.map((f) => `${issueTitle(f)}\n${issueBody(f)}`).join("\n");
    record(
      "second check: a miss with no Body files as its own signature and title; still no GUID, name or file name",
      `IfcBuildingElementProxy / (no Body) / ifcfast ${bodySignature("IfcX", "x").split(" / ifcfast ")[1]}|No Body, no mesh | leaks: none`,
      `${missFacts.find((f) => f.elementClass === "IfcBuildingElementProxy")?.signature}|${missText.includes("No Body, no mesh: IfcBuildingElementProxy") ? "No Body, no mesh" : "?"} | leaks: ${
        ["0aaaaaaaaaaaaaaaaaaaaa", "2ccccccccccccccccccccc", "Vegg A", "Assy", ">P<"].filter((x) => missText.includes(x)).join(",") || "none"
      }`,
    );
  }

  {
    // The model cache is tab-session scoped: only the current session's rows
    // are offered; other sessions' rows go after the grace period, unless this
    // tab's board still points at them; rows from before sessions count as
    // another session's; no session purges nothing and offers nothing.
    const at = 10 * CACHE_SESSION_GRACE_MS;
    const old = at - CACHE_SESSION_GRACE_MS - 1;
    const recent = at - CACHE_SESSION_GRACE_MS + 1;
    const rows = [
      { key: "mine-old", session: "A", usedAt: old },
      { key: "mine-new", session: "A", usedAt: recent },
      { key: "other-old", session: "B", usedAt: old },
      { key: "other-new", session: "B", usedAt: recent },
      { key: "other-old-on-board", session: "B", usedAt: old },
      { key: "legacy-old", usedAt: old },
      { key: "legacy-new", usedAt: recent },
    ];
    record(
      "model cache: startup purges other sessions' rows unused past the grace period, keeps own rows and own board's",
      "other-old,legacy-old",
      purgeable(rows, "A", at, new Set(["other-old-on-board"])).join(","),
    );
    record(
      "model cache: only the current session's rows are offered for restore",
      "mine-old,mine-new",
      rows.filter((row) => offered(row, "A")).map((row) => row.key).join(","),
    );
    record(
      "model cache: without sessionStorage nothing is purged and nothing offered",
      "0 0",
      `${purgeable(rows, null, at).length} ${rows.filter((row) => offered(row, null)).length}`,
    );
    record("model cache: the grace period is 2 hours", "7200000", String(CACHE_SESSION_GRACE_MS));
  }

  // One name per thing, one language per screen (2026-09-30).
  {
    const typed = detailLine("typed", { good: 1388, total: 1389 });
    record(
      "detail line: the English `detail` is unchanged by the code",
      "1388 of 1389 elements linked to a type",
      detailEn(typed),
    );
    // `toLocaleString` groups with a no-break space; the words are what is tested.
    record(
      "detail line: Norwegian from the code",
      "1 388 av 1 389 objekter med typeobjekt",
      detailText(typed, "nb", "").replace(/\s/g, " "),
    );
    record(
      "label: a requirement card's check focus takes the card's name, a plain check its own",
      "req.typeobjekt req.guid none",
      [
        labelOfFocus({ kind: "check", checkId: "element-typed" }, []),
        labelOfFocus({ kind: "check", checkId: "guid-unique" }, []),
        labelOfFocus({ kind: "check", checkId: "spatial-chain" }, []) ?? "none",
      ].join(" "),
    );
  }

  await xlsxSelftest(record);
  configSelftest(record);
  mottakskontrollSelftest(record);
  setupWalkSelftest(record);
  stepTemplateSelftest(record);

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

/* ------------------------------------------------------- Oppsett's walk */

/** The pure seams under Oppsett's property step: the extract generated from an
 *  example, the extract preview over real values, the value cap's honesty,
 *  and each classification role's default list. */
/** Oppsett's per-step templates: the MMI-koder and Etasjer sheets alone
 *  (`src/ids/xlsx.ts`), and their defaults (`src/ui/step-templates.ts`). */
function stepTemplateSelftest(record: (name: string, expected: string, actual: string) => void): void {
  const refused = (read: () => unknown): string => {
    try {
      read();
      return "accepted";
    } catch (error) {
      return error instanceof XlsxRulesetError
        ? error.problems.map((p) => p.split(": ")[0]).join(" ")
        : (error as Error).message;
    }
  };
  const sheetNames = (bytes: Uint8Array) =>
    [...strFromU8(unzipSync(bytes)["xl/workbook.xml"]).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]).join(",");

  const codes = [
    { code: "100", name: "MMI 100" },
    { code: "300", name: "Detaljprosjektert", phase: "NY" },
  ];
  const codesFile = writeCodesXlsx(codes);
  record("step template MMI: the one sheet", "MMI-koder", sheetNames(codesFile));
  record("step template MMI: round trip", JSON.stringify(codes), JSON.stringify(readCodesXlsx(codesFile)));

  const levels = [
    { name: "Kjeller", elevation: -3.2 },
    { name: "Plan 01", elevation: 0 },
    { name: "Plan 02", elevation: 3.6 },
  ];
  const levelsFile = writeLevelsXlsx(levels, "OKFG");
  record("step template Etasjer: the one sheet", "Etasjer", sheetNames(levelsFile));
  record("step template Etasjer: round trip", JSON.stringify(levels), JSON.stringify(readLevelsXlsx(levelsFile)));
  record(
    "step template Etasjer: the Kote header names the plane",
    "true",
    String(strFromU8(unzipSync(levelsFile)["xl/worksheets/sheet1.xml"]).includes(">Kote OKFG (m)<")),
  );

  // A full config workbook: the matching sheet, nothing else read.
  const eks = JSON.parse(readFileSync(new URL("../examples/eks-project-layer.test.ruleset.json", import.meta.url), "utf8")) as Ruleset;
  const full = writeRulesetXlsx(eks);
  const eksMmi = eks.rules.find((r) => r.kind === "extended" && r.mapping === "progress-code");
  const eksCodes = eksMmi && eksMmi.kind === "extended" && eksMmi.check.type === "code-lookup" ? eksMmi.check.codes : undefined;
  record("step template MMI: from the full workbook", JSON.stringify(eksCodes), JSON.stringify(readCodesXlsx(full)));
  record("step template Etasjer: from the full workbook", JSON.stringify(eks.storeys?.levels), JSON.stringify(readLevelsXlsx(full)));

  // Defaults.
  const values = [
    { v: "100", n: 574 },
    { v: "300", n: 12 },
    { v: "Skisse", n: 3 },
    { v: "100", n: 1 },
  ];
  record(
    "step template MMI defaults: the list, then each extracted code it lacks as MMI <code>",
    '[{"code":"100","name":"Skisse"},{"code":"300","name":"MMI 300"}]',
    JSON.stringify(withCodes([{ code: "100", name: "Skisse" }], extractedCodes("^(\\d{3})$", values))),
  );
  const fromModels = modelLevels([
    { unitScale: 0.001, unitResolved: true, storeys: [{ name: "Plan 01", elevation: 0 }, { name: "Plan 02", elevation: 3600 }, { name: null, elevation: 7200 }] },
    { unitScale: 1, unitResolved: true, storeys: [{ name: "Plan 02", elevation: 3.6 }, { name: "Kjeller", elevation: -3.2 }, { name: "Tak", elevation: null }] },
    { unitScale: 1, unitResolved: false, storeys: [{ name: "Loft", elevation: 9 }] },
  ]);
  record("step template Etasjer defaults: the models' storeys, merged, deduplicated, lowest first", JSON.stringify(levels), JSON.stringify(fromModels));
  record("step template Etasjer defaults: no levels takes the models'", "3", String(levelsTemplate([], fromModels).length));
  record(
    "step template Etasjer defaults: levels set keep them",
    "Plan 09",
    levelsTemplate([{ name: "Plan 09", elevation: 30 }], fromModels).map((l) => l.name).join(","),
  );
  record("step template file names", "regelsett.mmi.xlsx EKS.etasjer.xlsx", `${templateFileName(" ", "mmi")} ${templateFileName("EKS", "etasjer")}`);

  // Refusals, at the cell, nothing half read.
  record("step template MMI refuses: a code with no name", "MMI-koder!B4", refused(() => readCodesXlsx(writeCodesXlsx([...codes.slice(0, 1), { code: "200", name: "" }]))));
  const textKote = (() => {
    const files = unzipSync(levelsFile);
    const part = "xl/worksheets/sheet1.xml";
    files[part] = strToU8(strFromU8(files[part]).replace(/<c r="B4"><v>0<\/v><\/c>/, '<c r="B4" t="inlineStr"><is><t>null</t></is></c>'));
    return zipSync(files);
  })();
  record("step template Etasjer refuses: a Kote that is not a number", "Etasjer!B4", refused(() => readLevelsXlsx(textKote)));
  record("step template Etasjer refuses: a file without the sheet", "Etasjer", refused(() => readLevelsXlsx(codesFile)));
}

function setupWalkSelftest(record: (name: string, expected: string, actual: string) => void): void {
  const cases: { example: string; mark: [number, number]; want: string | null; code: string }[] = [
    { example: "231 Bærevegger", mark: [0, 3], want: "^(\\d{3}).*", code: "231" },
    { example: "AB-01", mark: [0, 5], want: "^([A-ZÆØÅ]{2}-\\d{2})", code: "AB-01" },
    { example: "AB-01", mark: [0, 0], want: "^([A-ZÆØÅ]{2}-\\d{2})", code: "AB-01" },
    { example: "AB-01", mark: [0, 2], want: "^([A-ZÆØÅ]{2})-\\d{2}", code: "AB" },
    { example: "Bæ.21-x", mark: [3, 5], want: null, code: "21" },
    { example: "KNM 432.11 Dør", mark: [4, 10], want: null, code: "432.11" },
  ];
  for (const c of cases) {
    const pattern = extractFromExample(c.example, c.mark[0], c.mark[1]);
    if (c.want !== null) record(`extract from example "${c.example}" [${c.mark}]`, c.want, pattern);
    let captured: string;
    try {
      captured = compileExtract(pattern).exec(c.example)?.[1] ?? "(no match)";
    } catch (err) {
      captured = `(throws: ${err instanceof Error ? err.message : String(err)})`;
    }
    record(`extract from example "${c.example}" [${c.mark}] captures the mark`, c.code, captured);
  }

  const preview = previewExtract({ extract: "^(\\d{2})", codes: [{ code: "23", name: "x" }] }, [
    { v: "231 Bærevegger", n: 5 },
    { v: "24 Søyler", n: 2 },
    { v: "Vegg", n: 1 },
  ]);
  record(
    "extract preview: ok / no-match / not-in-list",
    "23:ok 24:not-in-list -:no-match | 5 1 2",
    `${preview.rows.map((r) => `${r.code ?? "-"}:${r.state}`).join(" ")} | ${preview.totals.ok} ${preview.totals["no-match"]} ${preview.totals["not-in-list"]}`,
  );
  let invalid = "no throw";
  try {
    previewExtract({ extract: "^(\\d", list: "ns3451" }, [{ v: "1", n: 1 }]);
  } catch {
    invalid = "throws";
  }
  record("extract preview: an invalid pattern throws, never a stale preview", "throws", invalid);

  const capped = mergeChoices([
    [{ set: "S", objects: 3, props: [{ name: "P", n: 3, valued: 3, values: [{ v: "a", n: 2 }], distinct: 2, exact: true }] }],
  ])[0].props[0];
  const twoCapped = mergeChoices([
    [{ set: "S", objects: 3, props: [{ name: "P", n: 3, valued: 3, values: [{ v: "a", n: 2 }], distinct: 2, exact: true }] }],
    [{ set: "S", objects: 3, props: [{ name: "P", n: 3, valued: 3, values: [{ v: "b", n: 2 }], distinct: 2, exact: true }] }],
  ])[0].props[0];
  const twoWhole = mergeChoices([
    [{ set: "S", objects: 1, props: [{ name: "P", n: 1, valued: 1, values: [{ v: "a", n: 1 }], distinct: 1, exact: true }] }],
    [{ set: "S", objects: 1, props: [{ name: "P", n: 1, valued: 1, values: [{ v: "a", n: 1 }], distinct: 1, exact: true }] }],
  ])[0].props[0];
  record(
    "pset choices: a capped value list keeps its true distinct count",
    "1/2 exact | 2/2 lower-bound | 1/1 exact",
    [capped, twoCapped, twoWhole].map((p) => `${p.values.length}/${p.distinct} ${p.exact ? "exact" : "lower-bound"}`).join(" | "),
  );

  record(
    "classification roles start on their own list",
    "system-classification:ns3451 component-classification:ns3457-8",
    `system-classification:${defaultCodeList("system-classification")} component-classification:${defaultCodeList("component-classification")}`,
  );
}

/* ------------------------------------------------------------------ xlsx */

function exampleRulesets(): string[] {
  return readdirSync(new URL("../examples/", import.meta.url)).filter((f) => f.endsWith(".json")).sort();
}

/** The ruleset as .xlsx (src/ids/xlsx.ts): the ruleset JSON on stdout. Lint
 *  issues go to stderr at their Sheet!Cell; exit 1 when one is an error, and
 *  the JSON is written anyway so it can be read. */
async function cmdXlsx2json(args: string[]): Promise<number> {
  const path = positionals(args)[0];
  if (!path) fail("no .xlsx path given");
  let read: XlsxRuleset;
  try {
    read = readRulesetXlsx(new Uint8Array(readFileSync(path)));
  } catch (error) {
    if (error instanceof XlsxRulesetError) {
      for (const problem of error.problems) note(`${path}: ${problem}`);
      return 1;
    }
    return fail(`cannot read ${path}: ${(error as Error).message}`);
  }
  emit(read.ruleset);
  const issues = lintRuleset(read.ruleset);
  for (const issue of issues) {
    note(`${issue.severity} ${locate(issue.path, read.locations) ?? "-"} ${issue.path} [${issue.code}] ${issue.message}`);
  }
  return hasErrors(issues) ? 1 : 0;
}

/** An .ids into the IDS sheets of a config: the .ids's specifications replace
 *  the config's `ids` rules (`withIdsRules`); with no --into, a config holding
 *  only them. Written to --out (default: the .ids name with .xlsx). Every
 *  specification must import, and every one must fit the sheets, or nothing
 *  is written. */
async function cmdIds2xlsx(args: string[]): Promise<number> {
  const path = positionals(args)[0];
  if (!path) fail("no .ids path given");
  let imported: Ruleset;
  try {
    imported = parseIdsXml(readFileSync(path, "utf8"), basename(path));
  } catch (error) {
    return fail(`cannot import ${path}: ${(error as Error).message}`);
  }
  const into = flagValue(args, "--into");
  const base: Ruleset = into ? loadRuleset(into) : { ...imported, rules: [] };
  const out = flagValue(args, "--out") ?? `${path.replace(/\.(ids|xml)$/i, "")}.xlsx`;
  let bytes: Uint8Array;
  let merged: Ruleset;
  try {
    merged = withIdsRules(base, imported.rules as IdsRule[]);
    bytes = writeRulesetXlsx(merged);
  } catch (error) {
    return fail((error as Error).message);
  }
  writeFileSync(out, bytes);
  emit({ command: "ids2xlsx", ids: basename(path), into: into ?? null, out, specifications: imported.rules.length, rules: merged.rules.length });
  return 0;
}

/** A ruleset JSON to .xlsx, written to --out (default: the input's name with
 *  .xlsx). The writer reads its own output back and fails on any difference. */
async function cmdJson2xlsx(args: string[]): Promise<number> {
  const path = positionals(args)[0];
  const ruleset = loadRuleset(path);
  const out = flagValue(args, "--out") ?? `${path!.replace(/(\.ruleset)?\.json$/i, "")}.xlsx`;
  let bytes: Uint8Array;
  try {
    bytes = writeRulesetXlsx(ruleset);
  } catch (error) {
    return fail((error as Error).message);
  }
  writeFileSync(out, bytes);
  emit({ command: "json2xlsx", ruleset: ruleset.name, out, bytes: bytes.length, sheets: [...SHEET_ORDER] });
  return 0;
}

type Record_ = (name: string, expected: string, actual: string) => void;

/** The PDF report (src/mottakskontroll/): the strings are standard.yaml's,
 *  and both reports render from a small synthetic model with every block. */
function mottakskontrollSelftest(record: Record_): void {
  // Drift: every label, verdict word, title and requirement text the browser
  // prints is standard.yaml's, verbatim.
  const yaml = readFileSync(new URL("../mottakskontroll/standard/standard.yaml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const has = (key: string, value: string) =>
    // Block entries, or a flow mapping (`seksjoner`).
    [`${key}: ${value}\n`, `${key}: '${value}'\n`, `${key}: ${value}}`].some((line) => yaml.includes(line));
  const strings: [string, string][] = [
    ...Object.entries(ETIKETTER),
    ...Object.entries(VERDIKT_ORD),
    ...Object.values(KPI_TITLER).map((v): [string, string] => ["tittel", v]),
    ...SEKSJONER.map((x): [string, string] => ["tittel", x.tittel]),
    ...BLOKKER.flatMap((b): [string, string][] => [["tittel", b.tittel], ["krav_tekst", b.krav_tekst]]),
  ];
  record(
    "mottakskontroll: every string the browser report prints is in standard.yaml",
    "none missing",
    strings.filter(([k, v]) => !has(k, v)).map(([k, v]) => `${k}: ${v}`).join(" | ") || "none missing",
  );

  const row = (guid: string, entity: string, over: Record<string, unknown> = {}) => ({
    guid, entity, name: guid, predefined_type: null, object_type: null, tag: null,
    storey_guid: "s1", parent_guid: null, type_name: null, type_source: "none", typed: false,
    type_guid: null, materials: [], layer_set: null, is_external: null, fire_rating: null, load_bearing: null,
    ...over,
  });
  const typed = (name: string, typeGuid: string) => ({ typed: true, type_name: name, type_guid: typeGuid, type_source: "type" });
  const graph = {
    schema: "IFC4", project_name: null,
    products: [
      row("a", "IFCWALL", typed("Vegg 200", "t1")),
      row("b", "IFCWALL", typed("Vegg 200", "t1")),
      row("c", "IFCDOOR", { ...typed("", "t2"), storey_guid: "s2" }),
      row("d", "IFCSLAB", { storey_guid: null }),
      row("e", "IFCWALL"),
      row("e", "IFCWALL"),
    ],
    storeys: [
      { guid: "s1", name: "Plan 1", elevation: 0, building_guid: null },
      { guid: "s2", name: "Plan 2", elevation: 3.002, building_guid: null },
      { guid: "s3", name: "Plan 9", elevation: 9, building_guid: null },
    ],
    sites: [], buildings: [], projects: [], spaces: [],
    contained_in: [{ product_guid: "a", storey_guid: "s1" }], aggregates: [], storey_building: [], voids: [],
    psets: [
      { guid: "a", pset_name: "P", prop_name: "MMI", value: "300", value_type: "IfcLabel", source: "instance" },
      { guid: "b", pset_name: "P", prop_name: "MMI", value: "999", value_type: "IfcLabel", source: "instance" },
    ],
    classifications: [], quantities: [],
    // A carried material: Materiale's Gyldig is then not measured.
    materials: [{ guid: "a", role: "direct", layer_index: 0, material_name: "Betong", layer_thickness_mm: null, category: null, fraction: null, source: "instance" }],
    type_objects: [
      { guid: "t1", entity: "IfcWallType", name: "Vegg 200", step_id: 1 },
      { guid: "t2", entity: "IfcDoorType", name: "", step_id: 2 },
    ],
  } as unknown as IfcGraph;
  const summary = {
    schema: "IFC4", length_unit: "METRE", unit_scale: 1, unit_resolved: true, authoring_app: null,
    project_name: null, duplicate_step_ids: 0, products: 6, storeys: 3, path: "", size_bytes: 0,
    parse_seconds: 0, warnings: [], tables: {},
  } as unknown as IfcSummary;
  const ruleset = {
    ...SAMPLE_RULESET,
    name: "Prosjekt X",
    info: { title: "Prosjekt X" },
    storeys: {
      plane: "OKFG", tolerance: { aboveMm: 5, belowMm: 5 }, nameWindowMm: 1000, nearMm: 200,
      levels: [{ name: "Plan 1", elevation: 0 }, { name: "Plan 2", elevation: 3 }, { name: "Plan 3", elevation: 6 }],
    },
    disciplines: [{ code: "ARK" }],
    models: [{ label: "X_ARK", discipline: "ARK" }],
    rules: [{
      id: "progress-code", kind: "extended", mapping: "progress-code", name: "MMI",
      check: { type: "code-lookup", extract: "^(\\d{3})$", source: { property: { propertySet: "P", name: "MMI" } }, codes: [{ code: "300", name: "Tre" }] },
    }],
  } as unknown as Ruleset;
  const file = "X_ARK.ifc";
  const evaluation = evaluateRuleset(ruleset, graph as unknown as ModelGraph, summary as unknown as ModelSummary, file);
  const checks = [...runFundamentals(graph, summary), checkStoreyConfig(graph, summary, ruleset, file)];
  const rows = reportRows({ model: { file, schema: "IFC4", sha256: "" }, graph, summary, checks, ruleset, evaluation });
  const profile = withTypeFacts(profileOf(graph), graph);
  const runde = beregn([{ fileName: file, rows, summary, profile }], ruleset, "2026-10-01");
  const m = runde.modeller[0];
  const assets = { tokens: "/* tokens */", css: "/* css */", merke: '<svg viewBox="0 0 1 1"></svg>' };

  record(
    "mottakskontroll: verdicts per block",
    "typeobjekt:kan_brukes guid:ikke_oppfylt etasjedefinisjon:ikke_oppfylt etasjer:kan_brukes " +
      "systemkode:ikke_konfigurert funksjonskode:ikke_konfigurert produkt:ikke_oppfylt materiale:ukjent " +
      "kopiobjekt:ikke_konfigurert mmi:ikke_oppfylt fase:ikke_oppfylt",
    m.blokker.map((b) => `${b.id}:${b.verdikt}`).join(" "),
  );
  record(
    "mottakskontroll: GUID counts the extra occurrences; the etasjematrise has a mangler level and an extra storey",
    "dup 1 | Plan 1:som_registeret Plan 2:som_registeret Plan 3:mangler :andre_nivaaer",
    `dup ${m.guid.duplikater} | ` + m.etasjer.em.rader.map((r) => `${r.k_navn}:${r.kode}`).join(" "),
  );
  record(
    "mottakskontroll: Nøkkeltall over every product row, types by class and name",
    "2/ 6/IfcProduct 1,5/3 / 2 1/50 % 3/50 %",
    m.kpi.map((k) => `${k.tekst}/${k.under}`).join(" ").replace(/ /g, " "),
  );

  const html = htmlModell(runde, m, assets);
  const blokker = BLOKKER.filter((b) => b.id !== "guid" && b.id !== "etasjedefinisjon");
  const mangler = [
    ...blokker.filter((b) => !html.includes(`</span>${b.tittel}</div>`)).map((b) => b.tittel),
    ...[ETIKETTER.duplikater_i_fila, ETIKETTER.etasjedefinisjon, ETIKETTER.seksjon_nokkeltall, ETIKETTER.seksjon_merknader, ...SEKSJONER.map((x) => x.tittel)]
      .filter((x) => !html.includes(x)),
  ];
  record("mottakskontroll: the model report renders every block and component", "all present", mangler.join(", ") || "all present");
  record(
    "mottakskontroll: the model report numbers nine blocks and draws the floor component",
    "9 1",
    `${(html.match(/<section class="blokk krav"><div class="kvadrat/g) ?? []).length} ` +
      `${(html.match(/<section class="blokk krav etg-komp">/g) ?? []).length}`,
  );
  const prosjekt = htmlProsjekt(runde, assets);
  record(
    "mottakskontroll: the project report has Leveransen and a Krav × modell row per block",
    `${ETIKETTER.seksjon_leveransen} ${BLOKKER.length}`,
    `${prosjekt.includes(ETIKETTER.seksjon_leveransen) ? ETIKETTER.seksjon_leveransen : "-"} ` +
      String((prosjekt.match(/<td class="krav">/g) ?? []).length),
  );
  record(
    "mottakskontroll: a verdict the browser cannot decide prints the sentinel, never a guess",
    "1",
    String(html.split(`<span class="kord">${SENTINEL}</span>`).length - 1),
  );
  record("mottakskontroll: no mojibake in either report", "clean", /Ã|â€|Â/.test(html + prosjekt) ? "mojibake" : "clean");
}

/** Private fixtures: `tests/fixtures/private/*.json` and `*.xlsx`, never
 *  committed. Absent is fine: the cases that need one are skipped. */
function privateFixtures(): { json: [string, Ruleset][]; xlsx: [string, Uint8Array][] } {
  const dir = new URL("../tests/fixtures/private/", import.meta.url);
  if (!existsSync(dir)) return { json: [], xlsx: [] };
  const names = readdirSync(dir).sort();
  return {
    json: names.filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Ruleset]),
    xlsx: names.filter((f) => f.endsWith(".xlsx")).map((f) => [f, new Uint8Array(readFileSync(new URL(f, dir)))]),
  };
}

/** The workbook with some cells emptied: `refs` like `Kilder!B3`. */
function blankCells(bytes: Uint8Array, refs: string[]): Uint8Array {
  const files = unzipSync(bytes);
  for (const ref of refs) {
    const [sheet, cell] = ref.split("!");
    const part = `xl/worksheets/sheet${(SHEET_ORDER as readonly string[]).indexOf(sheet) + 1}.xml`;
    const text = strFromU8(files[part]);
    const re = new RegExp(`<c r="${cell}"[^>]*>(?:(?!</c>).)*</c>`);
    if (!re.test(text)) throw new Error(`no cell ${ref}`);
    files[part] = strToU8(text.replace(re, ""));
  }
  return zipSync(files);
}

function refusedAt(bytes: Uint8Array): string {
  try {
    readRulesetXlsx(bytes);
    return "accepted";
  } catch (error) {
    return error instanceof XlsxRulesetError
      ? error.problems.map((p) => p.split(": ")[0]).join(" ")
      : (error as Error).message;
  }
}

async function xlsxSelftest(record: Record_): Promise<void> {
  // The committed template files are what the generator writes today.
  const template = writeRulesetXlsx(CONFIG_TEMPLATE);
  for (const dir of ["examples", "public"]) {
    let current = "missing";
    try {
      const committed = readFileSync(new URL(`../${dir}/${CONFIG_TEMPLATE_FILE}`, import.meta.url));
      current = Buffer.compare(committed, Buffer.from(template)) === 0 ? "current" : "stale";
    } catch {
      // stays "missing"
    }
    record(
      `${dir}/${CONFIG_TEMPLATE_FILE} is current`,
      "current",
      current === "current" ? current : `${current}: run node scripts/gen-config-template.ts`,
    );
  }
  record(
    "xlsx: two writes of one ruleset give the same bytes",
    "same",
    Buffer.compare(Buffer.from(template), Buffer.from(writeRulesetXlsx(CONFIG_TEMPLATE))) === 0 ? "same" : "differ",
  );
  record(
    "xlsx: the sheets, Lesmeg first",
    SHEET_ORDER.join(","),
    (() => {
      const wb = strFromU8(unzipSync(template)["xl/workbook.xml"]);
      return [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]).join(",");
    })(),
  );

  // json -> xlsx -> json, deep equal, for every ruleset the repo carries.
  const roundTrip = (ruleset: Ruleset) => {
    try {
      const back = readRulesetXlsx(writeRulesetXlsx(ruleset)).ruleset;
      return rulesetDiff(back, canonicalRuleset(ruleset)) ?? "equal";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const fixtures = privateFixtures();
  const inputs: [string, Ruleset][] = [["the template", CONFIG_TEMPLATE], ["SAMPLE_RULESET", SAMPLE_RULESET]];
  for (const name of exampleRulesets()) {
    inputs.push([`examples/${name}`, JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"))]);
  }
  for (const [name, ruleset] of fixtures.json) inputs.push([`tests/fixtures/private/${name}`, ruleset]);
  for (const [name, ruleset] of inputs) record(`xlsx round trip: ${name}`, "equal", roundTrip(ruleset));
  // xlsx -> json -> xlsx: a filled workbook reads, lints clean and writes back
  // to what it read.
  for (const [name, bytes] of fixtures.xlsx) {
    let result: string;
    try {
      const read = readRulesetXlsx(bytes).ruleset;
      const errors = lintRuleset(read).filter((i) => i.severity === "error");
      result = errors.length
        ? `lint: ${errors.map((i) => `${i.path} ${i.code}`).join(" | ")}`
        : (rulesetDiff(readRulesetXlsx(writeRulesetXlsx(read)).ruleset, canonicalRuleset(read)) ?? "equal");
    } catch (error) {
      result = (error as Error).message;
    }
    record(`xlsx round trip, lint clean: tests/fixtures/private/${name}`, "equal", result);
  }

  // Each rule lands on its sheet; the unfilled template is refused at its cells.
  const read = readRulesetXlsx(template);
  record(
    "xlsx: the template's rules sit on their sheets",
    "IDS Klassifikasjon Klassifikasjon MMI Kopiobjekt",
    read.ruleset.rules.map((_, i) => (locate(`rules[${i}]`, read.locations) ?? "-").split("!")[0]).join(" "),
  );
  const placed = lintRuleset(read.ruleset).filter((i) => i.code === "from-project");
  const cases: [string, string][] = [
    ["rules[3].check.codes[0].code", "MMI-koder!A3"],
    ["storeys.levels[0].elevation", "Etasjer!B3"],
    ["storeys.plane", "Etasjeoppsett!B3"],
    ["storeys.disciplines[0].discipline", "Etasjeoppsett!A4"],
    ["projectLayer.phase.sources[0].property.propertySet", "Kilder!D3"],
    ["projectLayer.ifc-schema.recommended[0]", "Standardkrav!D3"],
    ["models[0].label", "Modeller!A3"],
    ["disciplines[0].code", "Fag!A3"],
    ["rules[0].requirements.property[0].propertySet", "IDS-fasetter!H4"],
    ["rules[4].check.copy[0]", "Kopiobjekt!J3"],
  ];
  record(
    "xlsx: the template lints from-project, located at Sheet!Cell",
    cases.map(([, cell]) => cell).join(" "),
    cases.map(([path]) => (placed.some((i) => i.path === path) ? (locate(path, read.locations) ?? "-") : "not linted")).join(" "),
  );
  record(
    "xlsx: the Kote header names the plane",
    "Kote OKFG (m)",
    (() => {
      const bytes = writeRulesetXlsx({ ...SAMPLE_RULESET, storeys: { plane: "OKFG", tolerance: { aboveMm: 0, belowMm: 0 }, nameWindowMm: null, nearMm: 0, levels: [{ name: "P1", elevation: 0 }] } });
      const part = strFromU8(unzipSync(bytes)[`xl/worksheets/sheet${(SHEET_ORDER as readonly string[]).indexOf("Etasjer") + 1}.xml`]);
      return /Kote OKFG \(m\)/.test(part) ? "Kote OKFG (m)" : "missing";
    })(),
  );

  // What no role sheet spells goes to Andre regler as JSON; an IDS rule the
  // IDS sheets cannot take is refused, naming the rule.
  const odd = {
    ...SAMPLE_RULESET,
    rules: [
      { id: "mmi", kind: "extended", mapping: "progress-code", name: "MMI", list: undefined,
        check: { type: "code-lookup", list: "ns3451", source: { attribute: "Name" }, extract: "^(.+)$" } },
      { id: "sys", kind: "extended", mapping: "system-classification", name: "S", enabled: false,
        select: { entity: { group: "physicalElement" } },
        check: { type: "code-lookup", list: "ns3451", source: { classification: {} }, extract: "^(.+)$" } },
    ],
  } as unknown as Ruleset;
  let oddResult: string;
  try {
    const oddRead = readRulesetXlsx(writeRulesetXlsx(odd));
    oddResult =
      `${rulesetDiff(oddRead.ruleset, canonicalRuleset(odd)) ?? "equal"} ` +
      ["rules[0]", "rules[1]"].map((p) => (locate(p, oddRead.locations) ?? "-").split("!")[0]).join(" ");
  } catch (error) {
    oddResult = (error as Error).message;
  }
  record(
    "xlsx: a role rule its sheet cannot spell goes to Andre regler; a selection stays on its sheet",
    "equal Klassifikasjon Andre regler",
    oddResult,
  );
  const misfit = (rule: Record<string, unknown>) => {
    try {
      writeRulesetXlsx({ ...SAMPLE_RULESET, rules: [rule] } as unknown as Ruleset);
      return "written";
    } catch (error) {
      return (error as Error).message.split("\n")[0];
    }
  };
  record(
    "xlsx refuses: an IDS rule with a restriction on a name",
    "rule p: applicability.property[0].propertySet is a restriction; the sheet takes a literal there",
    misfit({ id: "p", kind: "ids", name: "p", applicability: { property: [{ propertySet: { restriction: { pattern: "Pset_.*" } }, baseName: "X" }] } }),
  );
  record(
    "xlsx refuses: an IDS rule with an entity name",
    "rule e: applicability.entity.name is set; the sheet takes classes (IFC-klasse) or a group (Klassegruppe)",
    misfit({ id: "e", kind: "ids", name: "e", applicability: { entity: { name: "IFCWALL" } } }),
  );

  // Blank and half-filled rows (#7 point 1).
  const phaseRow = locate("projectLayer.phase.sources[0]", read.locations)!.split("!")[1].replace(/\D/g, "");
  const onlyKrav = readRulesetXlsx(blankCells(template, ["B", "D", "E"].map((c) => `Kilder!${c}${phaseRow}`))).ruleset;
  record(
    "xlsx: a row with only its key cell (Krav) is not declared, and dropped",
    '{"reference":"<FROM PROJECT>"}',
    JSON.stringify(onlyKrav.projectLayer?.phase),
  );
  record(
    "xlsx refuses: a half-filled row, at its blank required cell",
    `Kilder!B${phaseRow} Kilder!D${phaseRow} Kilder!E${phaseRow}`,
    refusedAt(blankCells(template, [`Kilder!B${phaseRow}`])),
  );
  const mmiAktiv = locate("rules[3].enabled", read.locations)!;
  record("xlsx refuses: a blank Aktiv", mmiAktiv, refusedAt(blankCells(template, [mmiAktiv])));
  const fullyBlank = (() => {
    const files = unzipSync(template);
    const part = `xl/worksheets/sheet${(SHEET_ORDER as readonly string[]).indexOf("IDS-fasetter") + 1}.xml`;
    files[part] = strToU8(strFromU8(files[part]).replace(/<c r="[A-Z]+4"[^>]*>(?:(?!<\/c>).)*<\/c>/g, ""));
    return zipSync(files);
  })();
  record(
    "xlsx: a fully blank facet row is dropped",
    "no requirements",
    (() => {
      try {
        const rule = readRulesetXlsx(fullyBlank).ruleset.rules[0] as IdsRule;
        return rule.requirements ? "requirements" : "no requirements";
      } catch (error) {
        return (error as Error).message;
      }
    })(),
  );

  // The reader refuses a broken workbook at the cell, all problems at once.
  const edit = (bytes: Uint8Array, part: string, from: string, to: string) => {
    const files = unzipSync(bytes);
    const text = strFromU8(files[part]);
    if (!text.includes(from)) return new Uint8Array();
    files[part] = strToU8(text.replace(from, to));
    return zipSync(files);
  };
  const sheetPart = (name: string) => `xl/worksheets/sheet${(SHEET_ORDER as readonly string[]).indexOf(name) + 1}.xml`;
  record("xlsx refuses: an unknown sheet", "Kildr", refusedAt(edit(template, "xl/workbook.xml", 'name="Kilder"', 'name="Kildr"')));
  record(
    "xlsx refuses: an unknown field path in row 2, and the required column it was",
    "MMI!J2 MMI!N2",
    refusedAt(edit(template, sheetPart("MMI"), ">rules[].check.extract<", ">rules[].check.extrakt<")),
  );
  record(
    "xlsx refuses: property cells filled under an attribute source",
    `Kilder!D${phaseRow} Kilder!E${phaseRow}`,
    refusedAt(edit(template, sheetPart("Kilder"), ">property<", ">attribute<")),
  );
  const withOther = writeRulesetXlsx({
    ...SAMPLE_RULESET,
    rules: [{ id: "t", kind: "extended", name: "t", select: { entity: { group: "physicalElement" } }, check: { type: "element-typed" } }],
  });
  record(
    "xlsx refuses: a JSON cell that is not JSON",
    "Andre regler!A3",
    refusedAt(edit(withOther, sheetPart("Andre regler"), "{&quot;id&quot;", "{id")),
  );

  // The IDS sheets and the .ids: a workbook's IDS rules emit the same .ids
  // as the JSON's, the export re-imports to the same IDS model, and an
  // imported .ids goes into the IDS sheets.
  const idsOf = (ruleset: Ruleset) => {
    const included = partitionRules(ruleset).included;
    return included.length ? emitIdsXml(ruleset, included) : null;
  };
  const sampleIds = idsOf(SAMPLE_RULESET)!;
  const viaXlsx = readRulesetXlsx(writeRulesetXlsx(SAMPLE_RULESET)).ruleset;
  record("IDS sheets -> .ids: the workbook emits the JSON's .ids", "same", idsOf(viaXlsx) === sampleIds ? "same" : "differ");
  const once = importIds(sampleIds, "sample.ids").ruleset;
  const twice = importIds(idsOf(once)!, "sample.ids").ruleset;
  record(
    ".ids export re-imports to the same IDS model",
    "equal same-xml",
    `${rulesetDiff(twice.rules, once.rules) ?? "equal"} ${idsOf(once) === sampleIds ? "same-xml" : "xml-differs"}`,
  );
  let intoSheets: string;
  try {
    const merged = withIdsRules(CONFIG_TEMPLATE, once.rules as IdsRule[]);
    const back = readRulesetXlsx(writeRulesetXlsx(merged)).ruleset;
    intoSheets = `${back.rules.filter((r) => r.kind === "ids").length} ${idsOf(back) === idsOf({ ...merged, rules: once.rules }) ? "same-xml" : "xml-differs"}`;
  } catch (error) {
    intoSheets = (error as Error).message;
  }
  record(
    ".ids into the IDS sheets (ids2xlsx): every specification, the same .ids back",
    `${once.rules.length} same-xml`,
    intoSheets,
  );
  record(
    "withIdsRules refuses a rule id the config already has",
    "rule ids in both the config and the .ids: system-classification",
    (() => {
      try {
        withIdsRules(CONFIG_TEMPLATE, [{ id: "system-classification", kind: "ids", name: "x", applicability: {} }]);
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    })(),
  );
  // The standalone .ids of every config the repo carries validates against
  // the bundled IDS XSD (vendor/ids-schema, offline).
  const toValidate: [string, Ruleset][] = [["SAMPLE_RULESET via xlsx", viaXlsx]];
  for (const name of exampleRulesets()) {
    const ruleset = JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")) as Ruleset;
    if (partitionRules(ruleset).included.length) toValidate.push([`examples/${name}`, ruleset]);
  }
  for (const [name, ruleset] of fixtures.json) if (partitionRules(ruleset).included.length) toValidate.push([name, ruleset]);
  for (const [name, bytes] of fixtures.xlsx) {
    try {
      const r = readRulesetXlsx(bytes).ruleset;
      if (partitionRules(r).included.length) toValidate.push([name, r]);
    } catch {
      // reported above
    }
  }
  for (const [name, ruleset] of toValidate) {
    const xml = idsOf(ruleset)!;
    const validation = await validateIds(xml, `${name}.ids`);
    record(`.ids export of ${name} is valid against the IDS XSD`, "valid", validation.valid ? "valid" : JSON.stringify(validation.errors).slice(0, 300));
  }
}

/** The rules #7 added to the model, each on a small synthetic graph. */
function configSelftest(record: Record_): void {
  const product = (guid: string, entity = "IFCWALL") => ({
    guid, entity, name: guid, predefined_type: null, object_type: null, tag: null,
    storey_guid: null, parent_guid: null, type_name: null, type_source: "none", typed: false,
    type_guid: null, materials: [], layer_set: null, is_external: null, fire_rating: null, load_bearing: null,
  });
  const summary = {
    schema: "IFC4", length_unit: "METRE", unit_scale: 1, unit_resolved: true,
    authoring_app: null, project_name: null, duplicate_step_ids: 0, products: 4,
  } as unknown as IfcSummary;
  const base = (over: Record<string, unknown> = {}) =>
    ({
      schema: "IFC4", project_name: null, products: [], storeys: [], sites: [], buildings: [], projects: [], spaces: [],
      contained_in: [], aggregates: [], storey_building: [], voids: [], psets: [], classifications: [], quantities: [],
      materials: [], type_objects: [],
      ...over,
    }) as unknown as IfcGraph;
  const ruleset = (over: Record<string, unknown>) => ({ ...SAMPLE_RULESET, rules: [], ...over }) as unknown as Ruleset;

  // The engine's own report row ids are exactly REQUIREMENT_IDS, so an
  // exemption can name every one of them and nothing else.
  {
    const g = base({ products: [product("a")] });
    const checks = [
      ...runFundamentals(g, summary),
      checkStoreyConfig(g, summary, null, "m.ifc"),
      checkMeshPlacement(g, summary, null),
      checkBodyWithoutMesh(g, null),
    ];
    const ids = reportRows({ model: { file: "m.ifc", schema: "IFC4", sha256: "" }, graph: g, summary, checks }).filter((r) => !r.mapping).map((r) => r.id);
    record("REQUIREMENT_IDS are the report rows the engine emits", [...REQUIREMENT_IDS].sort().join(","), [...ids].sort().join(","));
  }

  // Storeys (#7 points 3, 11): tolerance, the two windows, the discipline
  // override with requireAllNames.
  {
    const storey = (guid: string, name: string, elevation: number) => ({ guid, name, elevation, building_guid: null });
    const setup = {
      plane: "OKFG", tolerance: { aboveMm: 5, belowMm: 5 }, nameWindowMm: 1000, nearMm: 200,
      levels: [{ name: "P1", elevation: 10 }, { name: "P2", elevation: 13 }],
      disciplines: [{ discipline: "RIB", plane: "OKBD", tolerance: { aboveMm: 5, belowMm: null }, requireAllNames: true }],
    };
    const rs = ruleset({
      storeys: setup,
      disciplines: [{ code: "ARK" }, { code: "RIB" }],
      models: [{ label: "X_ARK", discipline: "ARK" }, { label: "X_RIB", discipline: "RIB" }],
    });
    const run = (file: string, storeys: ReturnType<typeof storey>[]) => {
      const g = base({ storeys });
      const check = checkStoreyConfig(g, summary, rs, file);
      const row = reportRows({ model: { file, schema: "IFC4", sha256: "" }, graph: g, summary, checks: [check], ruleset: rs }).find((r) => r.id === "storey-config")!;
      return `${check.state} ${check.findings.map((f) => `${f.guid}:${f.code}`).join(",") || "-"} ${row.referanseplan} ${row.toleranse_mm?.over}/${row.toleranse_mm?.under}`;
    };
    record(
      "storeys: within tolerance matches; same name past it is an elevation mismatch; another name near is a name mismatch",
      "fail b:storey-elevation-mismatch,c:storey-name-mismatch,-:storey-count-exceeds OKFG 5/5",
      run("X_ARK.ifc", [storey("a", "P1", 10.004), storey("b", "P2", 13.02), storey("c", "Plan 2", 13.15)]),
    );
    record(
      "storeys: a same-named storey outside the name window is not in the config",
      "fail a:storey-not-in-config OKFG 5/5",
      run("X_ARK.ifc", [storey("a", "P1", 11.5)]),
    );
    record(
      "storeys: RIB's override (OKBD, lower accepted) holds when every name matches",
      "pass - OKBD 5/null",
      run("X_RIB.ifc", [storey("a", "P1", 9.9), storey("b", "P2", 12.85)]),
    );
    record(
      "storeys: RIB's override does not hold with a level missing by name",
      "fail a:storey-elevation-mismatch OKBD 5/5",
      run("X_RIB.ifc", [storey("a", "P1", 9.9)]),
    );
    record(
      "storeys: exact matching without the setup's windows (the earlier behaviour)",
      "match,elevation-mismatch,name-mismatch",
      matchStoreys([storey("a", "P1", 10), storey("b", "P2", 13.001), storey("c", "X", 10)], 1, setup.levels).map((m) => m.state).join(","),
    );
    record(
      "lint rejects: a storey setup without a plane, a discipline override for an unknown discipline",
      "storey-plane,discipline-unknown",
      lintRuleset(ruleset({ storeys: { ...setup, plane: "" }, disciplines: [{ code: "ARK" }] })).filter((i) => i.severity === "error").map((i) => i.code).join(","),
    );
  }

  // Recommended against accepted schema (#7 point 5).
  {
    const rs = ruleset({ projectLayer: { "ifc-schema": { accepted: ["IFC2X3", "IFC4"], recommended: ["IFC4"] } } });
    const row = (schema: string) => {
      const r = reportRows({ model: { file: "s.ifc", schema, sha256: "" }, graph: base(), summary, checks: [], ruleset: rs }).find((x) => x.id === "ifc-schema")!;
      return `${r.state} ${r.dekning.oppfylt} ${(r.fordeling ?? []).map((v) => v.flagg || "ok").join(",")} [${r.anbefalte?.join(" ")}]`;
    };
    record("ifc-schema: recommended passes", "pass 1 ok [IFC4]", row("IFC4"));
    record("ifc-schema: accepted only is a warn, the value unflagged («Kan brukes»)", "warn 1 ok [IFC4]", row("IFC2X3"));
    record(
      "lint rejects: a recommended schema that is not accepted",
      "schema-recommended-not-accepted",
      lintCodes(ruleset({ projectLayer: { "ifc-schema": { accepted: ["IFC4"], recommended: ["IFC2X3"] } } })),
    );
  }

  // Phase through the MMI code (#7 point 4), and code names (#7 point 6).
  {
    const mmi = {
      id: "progress-code", kind: "extended", mapping: "progress-code", name: "MMI",
      check: {
        type: "code-lookup", extract: "^(\\d{3})$", source: { property: { propertySet: "P", name: "MMI" } },
        codes: [{ code: "300", name: "Detaljert", phase: "NY" }, { code: "700", name: "Eksisterende", phase: "Bevares" }, { code: "800", name: "Kode 800" }],
      },
    };
    const rs = ruleset({ rules: [mmi], projectLayer: { phase: { sources: [{ progressCode: {} }] } } });
    const prop = (guid: string, value: string) => ({ guid, pset_name: "P", prop_name: "MMI", value, value_type: "IfcLabel", source: "instance" });
    const g = base({ products: ["a", "b", "c", "d"].map((x) => product(x)), psets: [prop("a", "300"), prop("b", "700"), prop("c", "800")] });
    const evaluation = evaluateRuleset(rs, g as unknown as ModelGraph, summary as unknown as ModelSummary, "m.ifc");
    const rows = reportRows({ model: { file: "m.ifc", schema: "IFC4", sha256: "" }, graph: g, summary, checks: [], ruleset: rs, evaluation });
    const phase = rows.find((r) => r.id === "phase")!;
    record(
      "phase through MMI: a code with a phase is oppfylt, a code without one avvik, no MMI mangler",
      "warn 4=2+1+1 null:mangler,800:avvik,Bevares:ok,NY:ok",
      `${phase.state} ${phase.dekning.grunnlag}=${phase.dekning.oppfylt}+${phase.dekning.avvik}+${phase.dekning.mangler} ` +
        (phase.fordeling ?? []).map((v) => `${v.verdi}:${v.flagg || "ok"}`).join(","),
    );
    record(
      "phase through MMI: the table's phases are accepted",
      "NEW,EXISTING,DEMOLISH,TEMPORARY,NY,Bevares",
      (phase.godtatte ?? []).join(","),
    );
    const row = rows.find((r) => r.mapping === "progress-code")!;
    record(
      "progress-code row carries the code list with names and phases",
      "300 Detaljert NY|700 Eksisterende Bevares|800 Kode 800 -",
      (row.koder ?? []).map((k) => `${k.kode} ${k.navn} ${k.fase ?? "-"}`).join("|"),
    );
    record(
      "lint rejects: progressCode with no progress-code phases",
      "progress-code-no-phase",
      lintCodes(ruleset({ projectLayer: { phase: { sources: [{ progressCode: {} }] } } })),
    );
  }

  // Material through IfcRelAssociatesMaterial as a source (#7 point 2).
  {
    const mat = (guid: string, name: string, source = "instance") =>
      ({ guid, role: "direct", layer_index: 0, material_name: name, layer_thickness_mm: null, category: null, fraction: null, source });
    const rule = {
      id: "mat", kind: "extended", name: "mat",
      check: { type: "code-lookup", source: { material: {} }, extract: "^(.+)$", codes: [{ code: "Betong", name: "Betong" }] },
    };
    const g = base({
      products: ["a", "b", "c", "d"].map((x) => product(x)),
      materials: [mat("a", "Betong"), mat("b", "Stål"), mat("c", "Betong", "type"), mat("c", "Tre")],
    });
    const r = evaluateRuleset(ruleset({ rules: [rule] }), g as unknown as ModelGraph, summary as unknown as ModelSummary, "m.ifc").results[0];
    record(
      "material source: the own association first, else the type's; none is empty",
      "fail 4/3 b:not-in-list,c:not-in-list,d:empty",
      `${r.state} ${r.applicable}/${r.failed} ${r.findings.map((f) => `${f.guid}:${f.code}`).join(",")}`,
    );
    record(
      "lint rejects: a material source under material-product.material",
      "material-source-slot",
      lintCodes(ruleset({ projectLayer: { "material-product": { material: [{ material: {} }] } } })),
    );
  }

  // Per-model facts (#7 point 8): discipline, group, no report, exemptions.
  {
    const rs = ruleset({
      disciplines: [{ code: "RIE" }, { code: "BIMK", report: false }],
      models: [
        { label: "X_RIE", discipline: "RIE", group: "RIE" },
        { label: "X_RIE_Utsparinger", discipline: "RIE", group: "RIE", exempt: ["progress-code", "phase", "element-material"] },
        { label: "X_BIMK", discipline: "BIMK" },
      ],
      rules: [{ id: "progress-code", kind: "extended", mapping: "progress-code", name: "MMI", check: { type: "code-lookup", source: { attribute: "Name" }, extract: "^(.+)$", codes: [{ code: "a", name: "a" }] } }],
    });
    const g = base({ products: [product("a")] });
    const facts = (file: string) => {
      const evaluation = evaluateRuleset(rs, g as unknown as ModelGraph, summary as unknown as ModelSummary, file);
      const checks = exemptChecks(runFundamentals(g, summary), rs, file);
      const rows = reportRows({ model: { file, schema: "IFC4", sha256: "" }, graph: g, summary, checks, ruleset: rs, evaluation });
      const m = rows[0].model;
      const st = (id: string) => rows.find((r) => r.id === id || r.mapping === id)?.state;
      return `${m.label} ${m.discipline} ${m.group} ${m.report} mmi:${st("progress-code")} phase:${st("phase")} material:${st("element-material")}`;
    };
    record(
      "model facts: label, discipline and group; nothing exempt",
      "X_RIE RIE RIE true mmi:pass phase:warn material:warn",
      facts("X_RIE.ifc"),
    );
    record(
      "model facts: an exempt model's requirements are not_applicable",
      "X_RIE_Utsparinger RIE RIE true mmi:not_applicable phase:not_applicable material:not_applicable",
      facts("X_RIE_Utsparinger.ifc"),
    );
    record("model facts: a discipline without a report", "X_BIMK BIMK X_BIMK false", facts("X_BIMK.ifc").split(" ").slice(0, 4).join(" "));
    record(
      "lint rejects: an exemption naming no requirement, a model of an unknown discipline",
      "exempt-unknown,discipline-unknown",
      lintCodes(ruleset({ disciplines: [{ code: "RIE" }], models: [{ label: "A", discipline: "RIE", exempt: ["nope"] }, { label: "B", discipline: "XX" }] })),
    );
    record(
      "lint accepts: one owner name on two models (read one file at a time); refuses an empty one",
      "owner-name-empty",
      lintCodes(ruleset({ disciplines: [{ code: "A" }], models: [{ label: "A1", discipline: "A", ownerNames: ["CUT"] }, { label: "A2", discipline: "A", ownerNames: [" cut", " "] }] })),
    );
  }
}

function lintCodes(ruleset: Ruleset): string {
  return lintRuleset(ruleset).filter((i) => i.severity === "error").map((i) => i.code).join(",") || "none";
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
  case "ids":
    code = await cmdIds(rest);
    break;
  case "psets":
    code = await cmdPsets(rest);
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
  case "xlsx2json":
    code = await cmdXlsx2json(rest);
    break;
  case "json2xlsx":
    code = await cmdJson2xlsx(rest);
    break;
  case "ids2xlsx":
    code = await cmdIds2xlsx(rest);
    break;
  default:
    note(
      "usage: node scripts/ids-cli.ts <lint|emit|run|ids|report|psets|xlsx2json|json2xlsx|ids2xlsx|schema|sample|selftest> [args]",
    );
    code = 2;
}
process.exit(code);
