/** The checks as both model workers run them, with the second check's state
 * (`NomeshVerification`) threaded into the two that make no-mesh statements,
 * and the re-run the workers answer a settled verification with.
 *
 * Shared by `model-worker.ts` and `storage/restore-worker.ts`, so the parse
 * path and the restore path can never disagree on what a verdict does.
 */

import { runFundamentals } from "../engine/fundamentals.ts";
import { checkMeshPlacement, type ElementBox } from "../engine/placement.ts";
import { checkStoreyConfig } from "../engine/storey-config.ts";
import { exemptChecks } from "../engine/exempt.ts";
import {
  checkBodyWithoutMesh,
  issueFacts,
  unmeshedGuids,
  type IssueFacts,
  type NomeshVerification,
} from "../engine/body-mesh.ts";
import type { CheckResult, IfcGraph, IfcSummary } from "../engine/types";
import type { Ruleset } from "../ids/types.ts";
import type { ModelResult } from "../ids/evaluate.ts";
import type { NomeshInput } from "./ifcos-verify.ts";

export interface HeldModel {
  graph: IfcGraph;
  summary: IfcSummary;
  name: string;
  boxes: Map<string, ElementBox> | null;
  /** Why `boxes` is null (restore path); the checks' default otherwise. */
  noGeometry?: string;
  verification: NomeshVerification;
}

/** Every check, over `excluded`, with the ruleset's exemptions when one is
 *  given. */
export function modelChecks(
  held: HeldModel,
  excluded?: ReadonlySet<string>,
  ruleset?: Ruleset | null,
): CheckResult[] {
  const { graph, summary, name, boxes, noGeometry, verification } = held;
  const checks = [
    ...runFundamentals(graph, summary, excluded),
    checkStoreyConfig(graph, summary, ruleset ?? undefined, name),
    checkMeshPlacement(graph, summary, boxes, excluded, noGeometry, verification),
    checkBodyWithoutMesh(graph, boxes, excluded, noGeometry, verification),
  ];
  return ruleset ? exemptChecks(checks, ruleset, name) : checks;
}

/** What the second check is asked about: every in-scope element with no
 *  streamed mesh (`unmeshedGuids`, no exclusions: a ruleset can come and
 *  go, the verdicts stay), or why there is no such list. */
export function nomeshInput(graph: IfcGraph, boxes: ReadonlyMap<string, unknown> | null, why: string | null): NomeshInput {
  if (why !== null) return { unavailable: why };
  if (boxes === null) return { unavailable: "no-mesh-pass" };
  return { guids: [...unmeshedGuids(graph, boxes)] };
}

/** The ifcfast issues a done verification yields: one per signature where
 *  ifcopenshell built geometry, over the whole model (no exclusions). */
export function nomeshIssues(held: HeldModel): IssueFacts[] {
  const v = held.verification;
  if (v.state !== "done" || !v.version) return [];
  const check = checkBodyWithoutMesh(held.graph, held.boxes, undefined, held.noGeometry, v);
  return issueFacts(check.findings, v.verdicts, v.version);
}

/** The ruleset last evaluated in a worker, with its result, so a
 *  verification landing later re-runs the current checks too. */
export interface HeldRuleset {
  ruleset: Ruleset;
  result: ModelResult;
}

export function excludedOf(result: ModelResult | null | undefined): Set<string> | undefined {
  return result?.excludedGuids?.length ? new Set(result.excludedGuids) : undefined;
}
