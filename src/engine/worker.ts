/** Parses one IFC and runs the checks, off the main thread.
 *
 * One worker per file so several models process in parallel and a file that
 * blows up takes only its own worker with it. The bytes are transferred, not
 * copied — a 200 MB model would otherwise be duplicated on the way in.
 */

import initWasm, { IfcModel } from "../../vendor/ifcfast-wasm/ifcfast_wasm.js";
import wasmUrl from "../../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm?url";
import { runFundamentals } from "./fundamentals";
import type { IfcGraph, IfcSummary, ModelReport } from "./types";

export interface WorkerRequest {
  fileName: string;
  bytes: ArrayBuffer;
}

export type WorkerResponse =
  | { kind: "done"; report: ModelReport }
  | { kind: "error"; fileName: string; message: string };

let ready: Promise<unknown> | null = null;

function ensureWasm() {
  ready ??= initWasm({ module_or_path: wasmUrl });
  return ready;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { fileName, bytes } = event.data;
  try {
    await ensureWasm();

    const t0 = performance.now();
    const model = IfcModel.fromBytes(new Uint8Array(bytes), fileName);
    const parseMs = performance.now() - t0;

    const summary = JSON.parse(model.summaryJson()) as IfcSummary;
    const graph = JSON.parse(model.graphJson()) as IfcGraph;
    const report: ModelReport = {
      fileName,
      sizeBytes: bytes.byteLength,
      parseMs,
      summary,
      checks: runFundamentals(graph, summary),
    };
    model.free();

    const response: WorkerResponse = { kind: "done", report };
    self.postMessage(response);
  } catch (err) {
    // A file that cannot be parsed is reported as itself, never folded into
    // the others as a pass or dropped from the run.
    const response: WorkerResponse = {
      kind: "error",
      fileName,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
