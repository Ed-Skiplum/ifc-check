/** Parses one IFC, then stays alive to evaluate rulesets against it.
 *
 * `src/engine/worker.ts` does the parse half of this and discards the graph
 * once the checks have run; the dashboard needs the graph, and a ruleset
 * dropped later needs it again. Re-parsing a 200 MB model to answer a second
 * question is not acceptable, and the engine is out of scope to change — so the
 * worker the UI drives lives here and keeps `graph` + `summary` in worker
 * memory until the model is removed and the worker terminated.
 *
 * The evaluator is `src/ids/evaluate.ts`, driven exactly as `scripts/ids-cli.ts`
 * drives it. There is no second implementation.
 */

import initWasm, { IfcModel } from "../../vendor/ifcfast-wasm/ifcfast_wasm.js";
import wasmUrl from "../../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm?url";
import { collectBoxes, unshiftBoxes, type ElementBox } from "../engine/placement";
import {
  bodyDeclarations,
  NOMESH_PENDING,
  unmeshedGuids,
  type IssueFacts,
  type NomeshVerification,
} from "../engine/body-mesh";
import { excludedOf, modelChecks, nomeshInput, nomeshIssues, type HeldModel, type HeldRuleset } from "./nomesh-checks";
import type { NomeshInput } from "./ifcos-verify";
import { boardData, type BoardData } from "./report-rows";
import type { CheckResult, IfcGraph, IfcSummary, ModelReport } from "../engine/types";
import {
  MESH_PRODUCTS_PER_BATCH,
  MESH_TRIANGLE_CEILING,
  type MeshBatch,
  type MeshBudget,
  type MeshMetaRow,
} from "../viewer/mesh-stream";
import { evaluateRuleset } from "../ids/evaluate.ts";
import type { ModelResult } from "../ids/evaluate.ts";
import type { ModelGraph, ModelSummary } from "../ids/model.ts";
import type { Ruleset } from "../ids/types.ts";
import type { ImportedIds } from "../ids/import.ts";
import { evaluateIds, type IdsModelResult } from "../ids/ids-report.ts";
import { psetInventory } from "../engine/pset-inventory.ts";
import { walkSelection } from "../engine/walk-selection.ts";
import { psetChoices, VALUE_CAP, type PsetChoice } from "./pset-choices";
// The graph -> profile reduction is shared with the restore worker, which must
// not import this module: it would pull the wasm parser into a worker whose
// whole point is that it never parses anything.
import { profileOf } from "../storage/rehydrate.ts";
// The type facts ride ON TOP of that shared reduction rather than inside it:
// they are what the type ledger aggregates, and the restore worker reduces the
// same graph, so widening the shared function would be the wrong place for a
// board-specific payload. See `src/ui/types/facts.ts`.
import { withTypeFacts } from "./types/facts";
import type { ModelProfile } from "./profile";
import { quantityUnits, type MeshMeasure } from "../engine/quantities";
import { spaceLongNames } from "../engine/rooms";
import {
  MeasureChannel,
  MeasureState,
  measureInto,
  type MeasureBatch,
  type MeasuredMessage,
} from "./measure-state";

export type ModelWorkerRequest =
  | { kind: "parse"; fileName: string; bytes: ArrayBuffer }
  | { kind: "evaluate"; ruleset: Ruleset }
  /** An imported `.ids`, run as written (the Prosjekt tab). */
  | { kind: "ids"; imported: ImportedIds }
  /** One mesh batch handed back for the treemap measures, or null for "no
   *  more" (`measure-state.ts`). */
  | { kind: "measure"; batch: MeasureBatch | null; total: number }
  /** The second check has settled (`ifcos-verify.ts`): re-run the checks
   *  with it. */
  | { kind: "nomesh"; verification: NomeshVerification }
  /** Oppsett's property picker (`pset-choices.ts`), asked for on demand. */
  | { kind: "psets" };

export type ModelWorkerResponse =
  /** `graph` is the parse path handing the raw graph out ONCE, so the main
   *  thread can cache it (`src/storage/model-cache.ts`) and a later session can
   *  restore this model without the file. Absent on the restore path, whose
   *  graph came out of that cache in the first place. */
  /** `board` is the report contract (`src/engine/report.ts`) over the same
   *  checks, the rows the dashboard's requirements read. */
  /** `nomesh` is what the second check is asked about (`ifcos-verify.ts`). */
  | {
      kind: "parsed";
      report: ModelReport;
      profile: ModelProfile;
      board: BoardData;
      graph?: IfcGraph;
      nomesh: NomeshInput;
    }
  /** The checks re-run with a settled second check: with no ruleset
   *  (`base`), and over the last ruleset evaluated (`current`), plus the
   *  ifcfast issues it yields. */
  | {
      kind: "nomesh-checked";
      base: { checks: CheckResult[]; board: BoardData };
      current: { checks: CheckResult[]; board: BoardData } | null;
      issues: IssueFacts[];
    }
  | { kind: "parse-error"; fileName: string; message: string }
  | { kind: "mesh-batch"; batch: MeshBatch }
  | { kind: "mesh-done"; shift: [number, number, number]; budget: MeshBudget }
  | { kind: "mesh-error"; message: string }
  /** `checks` is the fundamentals re-run over this ruleset's exclusions: the
   *  same rows the parse produced when the copy-object mapping is absent or
   *  excludes nothing, filtered when it excludes reference objects. */
  | { kind: "evaluated"; result: ModelResult; checks: CheckResult[]; board: BoardData }
  | { kind: "evaluate-error"; message: string }
  | { kind: "ids-evaluated"; result: IdsModelResult }
  | { kind: "ids-error"; message: string }
  | { kind: "psets"; choices: PsetChoice[] }
  | { kind: "psets-error"; message: string }
  | MeasuredMessage;

let ready: Promise<unknown> | null = null;

function ensureWasm() {
  ready ??= initWasm({ module_or_path: wasmUrl });
  return ready;
}

let heldGraph: IfcGraph | null = null;
let heldSummary: IfcSummary | null = null;
let heldName = "";
/** Per-element world boxes from the mesh stream, kept for `mesh-placement`
 *  so a ruleset's copy-object filter can re-run it without re-meshing. null
 *  when the mesh pass failed: the check then reports it could not run. */
let heldBoxes: Map<string, ElementBox> | null = null;
/** The treemap measures: the numbers only, never the meshes. */
let measures: MeasureChannel | null = null;
/** The second check, as last settled; pending until then. */
let heldVerification: NomeshVerification = NOMESH_PENDING;
/** The ruleset last evaluated, and its result. */
let heldRuleset: HeldRuleset | null = null;

/** `self` inside a module worker is a `DedicatedWorkerGlobalScope`, whose
 *  `postMessage` takes a transfer list. The project compiles against the DOM
 *  lib only, where `self` is a `Window` and the second argument is a target
 *  origin — hence the one narrow cast, at the single place that needs it. */
const post = self.postMessage.bind(self) as (
  message: ModelWorkerResponse,
  transfer?: Transferable[],
) => void;

function send(response: ModelWorkerResponse, transfer?: Transferable[]) {
  if (transfer) post(response, transfer);
  else post(response);
}

/**
 * Stream the mesh pass and hand each merged batch straight to the main thread.
 *
 * Run BEFORE `graphJson()`: that call runs the batch mesh pass itself if no
 * geometry exists yet and reuses the streamed stats if it does, so streaming
 * first is the difference between one tessellation pass and two.
 *
 * The typed arrays are TRANSFERRED, not copied. The wasm docs are explicit that
 * `positions` is already a copy into JS memory rather than a view into the wasm
 * heap, so the buffer is ours to give away.
 *
 * The ceiling drops whole BATCHES, never part of an element, and both the kept
 * and the produced numbers travel with the result. A cap is allowed here —
 * crashing the machine is worse than capping — but it may not be silent, and
 * nothing downstream can reconstruct what was withheld if this does not say so.
 */
function streamMeshes(
  model: IfcModel,
  boxes: Map<string, ElementBox>,
  withheld: Map<string, MeshMeasure>,
): { shift: [number, number, number]; budget: MeshBudget } {
  let elements = 0;
  let totalElements = 0;
  let triangles = 0;
  let totalTriangles = 0;
  let capped = false;
  let batchNumber = 0;

  model.streamMeshes(MESH_PRODUCTS_PER_BATCH, (
    metaJson: string,
    positions: Float32Array,
    indices: Uint32Array,
  ) => {
    const meta = JSON.parse(metaJson) as MeshMetaRow[];
    // Before the ceiling: a capped viewer still gets a complete placement check.
    collectBoxes(boxes, meta, positions);
    const batchTriangles = indices.length / 3;
    totalElements += meta.length;
    totalTriangles += batchTriangles;

    if (triangles + batchTriangles > MESH_TRIANGLE_CEILING) {
      capped = true;
      // Never reaches the main thread, so it is never handed back for the
      // treemap measures: measured here, then dropped with the batch.
      measureInto(withheld, { meta, positions, indices });
      return;
    }
    elements += meta.length;
    triangles += batchTriangles;

    const batch: MeshBatch = { batch: batchNumber, meta, positions, indices };
    batchNumber += 1;
    send({ kind: "mesh-batch", batch }, [positions.buffer, indices.buffer]);
  });

  return {
    shift: JSON.parse(model.streamShiftJson()) as [number, number, number],
    budget: {
      elements,
      totalElements,
      triangles,
      totalTriangles,
      capped,
      ceiling: MESH_TRIANGLE_CEILING,
    },
  };
}

async function parse(fileName: string, bytes: ArrayBuffer) {
  try {
    await ensureWasm();

    const t0 = performance.now();
    const model = IfcModel.fromBytes(new Uint8Array(bytes), fileName);
    const parseMs = performance.now() - t0;

    const summary = JSON.parse(model.summaryJson()) as IfcSummary;

    // The units the BaseQuantities are in. No wasm accessor gives them, so
    // they are read from the STEP bytes (chunked). An ifczip is compressed:
    // its units stay unread and its BaseQuantities unused.
    const view = new Uint8Array(bytes);
    const zipped = view[0] === 0x50 && view[1] === 0x4b;
    const units = zipped ? undefined : quantityUnits(view);
    // The spaces' LongName, the room's function, likewise (the Rom tab).
    const longNames = zipped ? undefined : spaceLongNames(view);

    // Geometry first, then the graph — see `streamMeshes`. A mesh failure is
    // reported as itself and does NOT take the checks down with it: the board
    // is a checker that happens to draw, not a viewer that happens to check.
    let boxes: Map<string, ElementBox> | null = new Map();
    const withheld = new Map<string, MeshMeasure>();
    try {
      const meshes = streamMeshes(model, boxes, withheld);
      unshiftBoxes(boxes, meshes.shift);
      send({ kind: "mesh-done", shift: meshes.shift, budget: meshes.budget });
    } catch (err) {
      boxes = null;
      send({ kind: "mesh-error", message: err instanceof Error ? err.message : String(err) });
    }

    // The tables `graphJson()` does not carry. All of them are MESH-FREE —
    // the extractors ran inside `fromBytes`, so each call is a serialise, not a
    // computation — and reading them before `graphJson()` therefore costs
    // nothing and cannot trigger a second tessellation pass. They are attached
    // to the graph so one object carries the whole model: the cache stores it,
    // the restore worker gets them without a parser, and the evaluator reads
    // the same rows the panel does.
    const typeObjects = JSON.parse(model.typeObjectsJson()) as IfcGraph["type_objects"];
    const psets = JSON.parse(model.psetsJson()) as IfcGraph["psets"];
    const classifications = JSON.parse(model.classificationsJson()) as IfcGraph["classifications"];
    const quantities = JSON.parse(model.quantitiesJson()) as IfcGraph["quantities"];
    const materials = JSON.parse(model.materialsJson()) as IfcGraph["materials"];

    const graph = JSON.parse(model.graphJson()) as IfcGraph;
    graph.type_objects = typeObjects;
    graph.psets = psets;
    graph.classifications = classifications;
    graph.quantities = quantities;
    graph.materials = materials;
    if (units) graph.quantity_units = units;
    if (longNames) graph.space_long_names = longNames;
    // The Body declaration of every element that streamed no mesh
    // (`body-no-mesh`): read from the STEP bytes, only for those elements, so
    // a fully meshed model costs one pass. Not read for an ifczip or when the
    // mesh pass failed; the check then says so.
    if (!zipped && boxes) graph.body_declared = bodyDeclarations(view, unmeshedGuids(graph, boxes));
    model.free();
    measures = new MeasureChannel(new MeasureState(graph, withheld, summary.unit_resolved ? summary.unit_scale : null));

    heldGraph = graph;
    heldSummary = summary;
    heldName = fileName;
    heldBoxes = boxes;

    const report: ModelReport = {
      fileName,
      sizeBytes: bytes.byteLength,
      parseMs,
      summary,
      checks: modelChecks(held()!),
    };
    const board = measures.baseBoard(boardData(graph, summary, fileName, report.checks, null, null));
    send({
      kind: "parsed",
      report,
      profile: withTypeFacts(profileOf(graph), graph),
      board,
      graph,
      // ifcopenshell is handed the plain STEP only.
      nomesh: nomeshInput(graph, boxes, zipped ? "ifczip" : null),
    });
  } catch (err) {
    // A file that cannot be parsed is reported as itself, never folded into
    // the others as a pass or dropped from the run.
    send({
      kind: "parse-error",
      fileName,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function evaluate(ruleset: Ruleset) {
  if (heldGraph === null || heldSummary === null) {
    send({ kind: "evaluate-error", message: "no parsed model in this worker" });
    return;
  }
  try {
    const graph: ModelGraph = heldGraph;
    const summary: ModelSummary = heldSummary;
    const result = evaluateRuleset(ruleset, graph, summary, heldName);
    heldRuleset = { ruleset, result };
    const checks = modelChecks(held()!, excludedOf(result), ruleset);
    const built = boardData(heldGraph, heldSummary, heldName, checks, ruleset, result);
    const board = measures ? measures.currentBoard(built) : built;
    send({ kind: "evaluated", result, checks, board });
  } catch (err) {
    send({
      kind: "evaluate-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The held model as `nomesh-checks.ts` reads it. */
function held(): HeldModel | null {
  if (heldGraph === null || heldSummary === null) return null;
  return { graph: heldGraph, summary: heldSummary, name: heldName, boxes: heldBoxes, verification: heldVerification };
}

/** A settled second check: the checks again, base and current. */
function nomesh(verification: NomeshVerification) {
  heldVerification = verification;
  const model = held();
  if (!model) return;
  try {
    const baseChecks = modelChecks(model);
    const baseBoard = boardData(model.graph, model.summary, model.name, baseChecks, null, null);
    let current: { checks: CheckResult[]; board: BoardData } | null = null;
    if (heldRuleset) {
      const { ruleset, result } = heldRuleset;
      const checks = modelChecks(model, excludedOf(result), ruleset);
      const built = boardData(model.graph, model.summary, model.name, checks, ruleset, result);
      current = { checks, board: measures ? measures.currentBoard(built) : built };
    }
    send({
      kind: "nomesh-checked",
      base: { checks: baseChecks, board: measures ? measures.baseBoard(baseBoard) : baseBoard },
      current,
      issues: nomeshIssues(model),
    });
  } catch (err) {
    send({ kind: "evaluate-error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** The IDS tab's run: the imported specifications against the held graph,
 *  by the same evaluator as a ruleset. Independent of any ruleset: it
 *  excludes no reference objects and re-runs no checks. */
function evaluateIdsHere(imported: ImportedIds) {
  if (heldGraph === null || heldSummary === null) {
    send({ kind: "ids-error", message: "no parsed model in this worker" });
    return;
  }
  try {
    send({ kind: "ids-evaluated", result: evaluateIds(imported, heldGraph, heldSummary, heldName) });
  } catch (err) {
    send({ kind: "ids-error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** The picker's sets and properties, from the held graph. */
function psetsHere() {
  if (heldGraph === null || heldSummary === null) {
    send({ kind: "psets-error", message: "no parsed model in this worker" });
    return;
  }
  try {
    // Counted over what the walk's rules select, as their report rows count.
    const owners = walkSelection(heldGraph.products);
    send({ kind: "psets", choices: psetChoices(psetInventory(heldGraph, heldSummary.schema, null, { examples: VALUE_CAP, owners })) });
  } catch (err) {
    send({ kind: "psets-error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<ModelWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "parse") void parse(message.fileName, message.bytes);
  else if (message.kind === "psets") psetsHere();
  else if (message.kind === "ids") evaluateIdsHere(message.imported);
  else if (message.kind === "nomesh") nomesh(message.verification);
  else if (message.kind === "measure") {
    if (measures) send(measures.feed(message.batch, message.total));
  } else evaluate(message.ruleset);
};
