/** Puts a cached model back to work, without a parser.
 *
 * `ui/model-worker.ts` stays alive after a parse because it HOLDS the graph: a
 * ruleset dropped later is evaluated against a model already in memory rather
 * than by reading the file again. A model restored from the cache needs exactly
 * the same thing, and the file it came from is gone — the browser cannot re-read
 * a dropped file after a reload.
 *
 * So this is that worker, minus the parse. It takes the stored graph and
 * summary, re-runs the fundamentals and the profile reduction — the same
 * functions the parse path calls, never a second copy of them — and then holds
 * the graph for `evaluate` exactly as the parse worker does. It imports no wasm,
 * so restoring a board costs nothing beyond the structured clone.
 *
 * It answers in `ModelWorkerResponse` messages so the controller drives one
 * worker protocol rather than two.
 */

import { runFundamentals } from "../engine/fundamentals.ts";
import { checkMeshPlacement, type ElementBox } from "../engine/placement.ts";
import type { CheckResult, IfcGraph, IfcSummary, ModelReport } from "../engine/types";
import { evaluateRuleset } from "../ids/evaluate.ts";
import type { ModelGraph, ModelSummary } from "../ids/model.ts";
import type { Ruleset } from "../ids/types.ts";
import type { ModelWorkerResponse } from "../ui/model-worker";
import { profileOf } from "./rehydrate.ts";
// A restored board must carry the same type facts a freshly parsed one does,
// or the type ledger renders dead on exactly the path the cache exists for.
import { withTypeFacts } from "../ui/types/facts.ts";

export type RestoreWorkerRequest =
  | {
      kind: "restore";
      fileName: string;
      sizeBytes: number;
      /** What the ORIGINAL parse cost. Carried through so the restored tile
       *  reports the file's parse time and not a fabricated zero. */
      parseMs: number;
      summary: IfcSummary;
      graph: IfcGraph;
      /** Per-element world boxes rebuilt from the cached mesh batches on the
       *  main thread (`boxesFromBatches`), so `mesh-placement` reads the same
       *  geometry the fresh parse did. null when the cache cannot supply the
       *  whole model; `noGeometry` then says why. */
      boxes: Map<string, ElementBox> | null;
      noGeometry?: string;
    }
  | { kind: "evaluate"; ruleset: Ruleset };

let heldGraph: IfcGraph | null = null;
let heldSummary: IfcSummary | null = null;
let heldName = "";
let heldBoxes: Map<string, ElementBox> | null = null;
let heldNoGeometry: string | undefined;

const post = self.postMessage.bind(self) as (message: ModelWorkerResponse) => void;

function restore(request: Extract<RestoreWorkerRequest, { kind: "restore" }>) {
  try {
    heldGraph = request.graph;
    heldSummary = request.summary;
    heldName = request.fileName;
    heldBoxes = request.boxes;
    heldNoGeometry = request.noGeometry;

    const report: ModelReport = {
      fileName: request.fileName,
      sizeBytes: request.sizeBytes,
      parseMs: request.parseMs,
      summary: request.summary,
      checks: [
        ...runFundamentals(request.graph, request.summary),
        checkMeshPlacement(request.graph, request.summary, heldBoxes, undefined, heldNoGeometry),
      ],
    };
    post({
      kind: "parsed",
      report,
      profile: withTypeFacts(profileOf(request.graph), request.graph),
    });
  } catch (err) {
    // A restore that cannot be completed fails as loudly as a parse that
    // cannot. Silently showing an empty tile would be the same file looking
    // like a different one after a refresh.
    post({
      kind: "parse-error",
      fileName: request.fileName,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function evaluate(ruleset: Ruleset) {
  if (heldGraph === null || heldSummary === null) {
    post({ kind: "evaluate-error", message: "no restored model in this worker" });
    return;
  }
  try {
    const graph: ModelGraph = heldGraph;
    const summary: ModelSummary = heldSummary;
    const result = evaluateRuleset(ruleset, graph, summary, heldName);
    const excluded = result.excludedGuids?.length ? new Set(result.excludedGuids) : undefined;
    const checks: CheckResult[] = [
      ...runFundamentals(heldGraph, heldSummary, excluded),
      checkMeshPlacement(heldGraph, heldSummary, heldBoxes, excluded, heldNoGeometry),
    ];
    post({ kind: "evaluated", result, checks });
  } catch (err) {
    post({
      kind: "evaluate-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (event: MessageEvent<RestoreWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "restore") restore(message);
  else evaluate(message.ruleset);
};
