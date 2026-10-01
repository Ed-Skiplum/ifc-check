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

import type { ElementBox } from "../engine/placement.ts";
import { NOMESH_PENDING, type NomeshVerification } from "../engine/body-mesh.ts";
import type { CheckResult, IfcGraph, IfcSummary, ModelReport } from "../engine/types";
import type { BoardData } from "../ui/report-rows.ts";
import {
  excludedOf,
  modelChecks,
  nomeshInput,
  nomeshIssues,
  type HeldModel,
  type HeldRuleset,
} from "../ui/nomesh-checks.ts";
import { evaluateRuleset } from "../ids/evaluate.ts";
import type { ModelGraph, ModelSummary } from "../ids/model.ts";
import type { Ruleset } from "../ids/types.ts";
import type { ImportedIds } from "../ids/import.ts";
import { evaluateIds } from "../ids/ids-report.ts";
import type { ModelWorkerResponse } from "../ui/model-worker";
import { profileOf } from "./rehydrate.ts";
// A restored board must carry the same type facts a freshly parsed one does,
// or the type ledger renders dead on exactly the path the cache exists for.
import { withTypeFacts } from "../ui/types/facts.ts";
import { boardData } from "../ui/report-rows.ts";
import { MeasureChannel, MeasureState, type MeasureBatch } from "../ui/measure-state.ts";
import { psetInventory } from "../engine/pset-inventory.ts";
import { psetChoices, VALUE_CAP } from "../ui/pset-choices.ts";

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
  | { kind: "evaluate"; ruleset: Ruleset }
  | { kind: "ids"; imported: ImportedIds }
  | { kind: "measure"; batch: MeasureBatch | null; total: number }
  | { kind: "nomesh"; verification: NomeshVerification }
  | { kind: "psets" };

let heldGraph: IfcGraph | null = null;
let heldSummary: IfcSummary | null = null;
let heldName = "";
let heldBoxes: Map<string, ElementBox> | null = null;
let heldNoGeometry: string | undefined;
let measures: MeasureChannel | null = null;
let heldVerification: NomeshVerification = NOMESH_PENDING;
let heldRuleset: HeldRuleset | null = null;

function held(): HeldModel | null {
  if (heldGraph === null || heldSummary === null) return null;
  return {
    graph: heldGraph,
    summary: heldSummary,
    name: heldName,
    boxes: heldBoxes,
    noGeometry: heldNoGeometry,
    verification: heldVerification,
  };
}

const post = self.postMessage.bind(self) as (message: ModelWorkerResponse) => void;

function restore(request: Extract<RestoreWorkerRequest, { kind: "restore" }>) {
  try {
    heldGraph = request.graph;
    heldSummary = request.summary;
    heldName = request.fileName;
    heldBoxes = request.boxes;
    heldNoGeometry = request.noGeometry;
    // The cached batches come back one at a time (`measure`), as on the
    // parse path; this worker never holds them.
    measures = new MeasureChannel(
      new MeasureState(request.graph, undefined, request.summary.unit_resolved ? request.summary.unit_scale : null),
    );

    const report: ModelReport = {
      fileName: request.fileName,
      sizeBytes: request.sizeBytes,
      parseMs: request.parseMs,
      summary: request.summary,
      checks: modelChecks(held()!),
    };
    post({
      kind: "parsed",
      report,
      profile: withTypeFacts(profileOf(request.graph), request.graph),
      board: measures.baseBoard(boardData(request.graph, request.summary, request.fileName, report.checks, null, null)),
      // A capped or failed cached mesh has no box per element: no list of
      // what ifcfast left unmeshed, so nothing to hand ifcopenshell.
      nomesh: nomeshInput(request.graph, heldBoxes, heldBoxes === null ? (heldNoGeometry ?? "no-mesh-pass") : null),
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
    heldRuleset = { ruleset, result };
    const checks: CheckResult[] = modelChecks(held()!, excludedOf(result), ruleset);
    const built = boardData(heldGraph, heldSummary, heldName, checks, ruleset, result);
    const board = measures ? measures.currentBoard(built) : built;
    post({ kind: "evaluated", result, checks, board });
  } catch (err) {
    post({
      kind: "evaluate-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** A settled second check, as the parse worker answers it. */
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
    post({
      kind: "nomesh-checked",
      base: { checks: baseChecks, board: measures ? measures.baseBoard(baseBoard) : baseBoard },
      current,
      issues: nomeshIssues(model),
    });
  } catch (err) {
    post({ kind: "evaluate-error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** The IDS tab's run, as the parse worker does it (`model-worker.ts`). */
function evaluateIdsHere(imported: ImportedIds) {
  if (heldGraph === null || heldSummary === null) {
    post({ kind: "ids-error", message: "no restored model in this worker" });
    return;
  }
  try {
    post({ kind: "ids-evaluated", result: evaluateIds(imported, heldGraph, heldSummary, heldName) });
  } catch (err) {
    post({ kind: "ids-error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** Oppsett's property picker, as the parse worker answers it. */
function psetsHere() {
  if (heldGraph === null || heldSummary === null) {
    post({ kind: "psets-error", message: "no restored model in this worker" });
    return;
  }
  try {
    post({ kind: "psets", choices: psetChoices(psetInventory(heldGraph, heldSummary.schema, null, { examples: VALUE_CAP })) });
  } catch (err) {
    post({ kind: "psets-error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<RestoreWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "restore") restore(message);
  else if (message.kind === "psets") psetsHere();
  else if (message.kind === "ids") evaluateIdsHere(message.imported);
  else if (message.kind === "nomesh") nomesh(message.verification);
  else if (message.kind === "measure") {
    if (measures) post(measures.feed(message.batch, message.total));
  } else evaluate(message.ruleset);
};
