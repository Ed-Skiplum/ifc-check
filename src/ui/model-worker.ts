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
import { evaluateRuleset } from "../ids/evaluate.ts";
import type { ModelResult } from "../ids/evaluate.ts";
import type { ModelGraph, ModelSummary } from "../ids/model.ts";
import type { Ruleset } from "../ids/types.ts";
import type { ModelProfile } from "./profile";

export type ModelWorkerRequest =
  | { kind: "parse"; fileName: string; bytes: ArrayBuffer }
  | { kind: "evaluate"; ruleset: Ruleset };

export type ModelWorkerResponse =
  | { kind: "parsed"; report: ModelReport; profile: ModelProfile }
  | { kind: "parse-error"; fileName: string; message: string }
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

function profileOf(graph: IfcGraph): ModelProfile {
  return {
    rows: graph.products.map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      storeyGuid: p.storey_guid,
    })),
    storeys: graph.storeys.map((s) => ({
      guid: s.guid,
      name: s.name,
      elevation: s.elevation,
    })),
  };
}

function send(response: ModelWorkerResponse) {
  self.postMessage(response);
}

async function parse(fileName: string, bytes: ArrayBuffer) {
  try {
    await ensureWasm();

    const t0 = performance.now();
    const model = IfcModel.fromBytes(new Uint8Array(bytes), fileName);
    const parseMs = performance.now() - t0;

    const summary = JSON.parse(model.summaryJson()) as IfcSummary;
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
    send({ kind: "parsed", report, profile: profileOf(graph) });
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
