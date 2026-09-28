/** An imported IDS run against one model: one row per specification, in file
 *  order. The IDS tab and `ids-cli.ts ids` both read this.
 *
 * The verdict per row is the evaluator's, never re-derived:
 *
 *   pass            applicable > 0 and every applicable entity satisfies the
 *                   requirements
 *   fail            at least one entity fails, or the applicability's
 *                   minOccurs / maxOccurs is broken
 *   not_applicable  NOTHING matched the applicability. Shown as NOT APPLIED,
 *                   never as a pass: ifctester reports this case status=true,
 *                   which is how a specification that silently stopped
 *                   matching reads green (AGENTS.md "The check result model")
 *   not_evaluable   the specification could not be read (`import.ts`), or it
 *                   asks for something the parser does not expose; `reason`
 *                   names what
 */

import { evaluateRuleset, type Finding, type ResultState } from "./evaluate.ts";
import type { ImportedIds } from "./import.ts";
import type { ModelGraph, ModelSummary } from "./model.ts";

export interface IdsSpecResult {
  /** 0-based position in the file. */
  index: number;
  name: string;
  description?: string;
  state: ResultState;
  /** Entities the applicability selected. */
  applicable: number;
  /** Applicable entities that satisfy every requirement. */
  passed: number;
  /** Applicable entities that fail a requirement. */
  failed: number;
  /** The failing entities, every one. An occurrence-bound breach (a spec-level
   *  finding, GlobalId `-`) is in here too, and counted in neither number. */
  findings: Finding[];
  detail: string;
  reason?: string;
  notes?: string[];
}

export interface IdsModelResult {
  model: string;
  schema: string;
  title: string;
  specs: IdsSpecResult[];
  counts: Record<ResultState, number>;
}

export function evaluateIds(
  imported: ImportedIds,
  graph: ModelGraph,
  summary: ModelSummary,
  modelName: string,
): IdsModelResult {
  const evaluation = evaluateRuleset(imported.ruleset, graph, summary, modelName, { maxFindings: 0 });
  const byRule = new Map(evaluation.results.map((r) => [r.ruleId, r]));
  // A finding on a type object carries the elements that use it, so a click
  // on the specification reaches something the viewer draws.
  const users = new Map<string, string[]>();
  for (const p of graph.products) {
    if (!p.type_guid) continue;
    const bucket = users.get(p.type_guid);
    if (bucket) bucket.push(p.guid);
    else users.set(p.type_guid, [p.guid]);
  }
  const typeGuids = new Set((graph.type_objects ?? []).map((t) => t.guid));
  const withMembers = (f: Finding): Finding =>
    typeGuids.has(f.guid) ? { ...f, members: users.get(f.guid) ?? [] } : f;
  const counts: Record<ResultState, number> = { pass: 0, fail: 0, not_applicable: 0, not_evaluable: 0 };
  const specs = imported.specs.map((spec): IdsSpecResult => {
    const base = { index: spec.index, name: spec.name, ...(spec.description ? { description: spec.description } : {}) };
    const result = spec.ruleId === null ? undefined : byRule.get(spec.ruleId);
    if (!result) {
      counts.not_evaluable += 1;
      return {
        ...base,
        state: "not_evaluable",
        applicable: 0,
        passed: 0,
        failed: 0,
        findings: [],
        detail: "not evaluated",
        reason: spec.unreadable ?? "the specification did not reach the evaluator",
      };
    }
    counts[result.state] += 1;
    const failed = result.findings.filter((f) => f.code === "requirement").length;
    return {
      ...base,
      state: result.state,
      applicable: result.applicable,
      passed: result.state === "not_evaluable" ? 0 : result.applicable - failed,
      failed,
      findings: result.findings.map(withMembers),
      detail: result.detail,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.notes ? { notes: result.notes } : {}),
    };
  });
  return { model: modelName, schema: summary.schema, title: imported.title, specs, counts };
}
