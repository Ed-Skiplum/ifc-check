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
import { runFundamentals } from "../engine/fundamentals";
import type { IfcGraph, IfcSummary, ModelReport } from "../engine/types";
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
// The graph -> profile reduction is shared with the restore worker, which must
// not import this module: it would pull the wasm parser into a worker whose
// whole point is that it never parses anything.
import { profileOf } from "../storage/rehydrate.ts";
import type { ModelProfile } from "./profile";

export type ModelWorkerRequest =
  | { kind: "parse"; fileName: string; bytes: ArrayBuffer }
  | { kind: "evaluate"; ruleset: Ruleset };

export type ModelWorkerResponse =
  /** `graph` is the parse path handing the raw graph out ONCE, so the main
   *  thread can cache it (`src/storage/model-cache.ts`) and a later session can
   *  restore this model without the file. Absent on the restore path, whose
   *  graph came out of that cache in the first place. */
  | { kind: "parsed"; report: ModelReport; profile: ModelProfile; graph?: IfcGraph }
  | { kind: "parse-error"; fileName: string; message: string }
  | { kind: "mesh-batch"; batch: MeshBatch }
  | { kind: "mesh-done"; shift: [number, number, number]; budget: MeshBudget }
  | { kind: "mesh-error"; message: string }
  | { kind: "evaluated"; result: ModelResult }
  | { kind: "evaluate-error"; message: string };

let ready: Promise<unknown> | null = null;

function ensureWasm() {
  ready ??= initWasm({ module_or_path: wasmUrl });
  return ready;
}

let heldGraph: IfcGraph | null = null;
let heldSummary: IfcSummary | null = null;
let heldName = "";

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
function streamMeshes(model: IfcModel): { shift: [number, number, number]; budget: MeshBudget } {
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
    const batchTriangles = indices.length / 3;
    totalElements += meta.length;
    totalTriangles += batchTriangles;

    if (triangles + batchTriangles > MESH_TRIANGLE_CEILING) {
      capped = true;
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

    // Geometry first, then the graph — see `streamMeshes`. A mesh failure is
    // reported as itself and does NOT take the checks down with it: the board
    // is a checker that happens to draw, not a viewer that happens to check.
    try {
      const meshes = streamMeshes(model);
      send({ kind: "mesh-done", shift: meshes.shift, budget: meshes.budget });
    } catch (err) {
      send({ kind: "mesh-error", message: err instanceof Error ? err.message : String(err) });
    }

    const graph = JSON.parse(model.graphJson()) as IfcGraph;
    model.free();

    heldGraph = graph;
    heldSummary = summary;
    heldName = fileName;

    const report: ModelReport = {
      fileName,
      sizeBytes: bytes.byteLength,
      parseMs,
      summary,
      checks: runFundamentals(graph, summary),
    };
    send({ kind: "parsed", report, profile: profileOf(graph), graph });
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
    send({ kind: "evaluated", result: evaluateRuleset(ruleset, graph, summary, heldName) });
  } catch (err) {
    send({
      kind: "evaluate-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (event: MessageEvent<ModelWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "parse") void parse(message.fileName, message.bytes);
  else evaluate(message.ruleset);
};
