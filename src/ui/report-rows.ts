/** What the board reads from the engine, built in the worker: the report
 * contract rows, the per-value doors of the mapping rows, and the two code
 * treemaps. Shared by the parse worker and the restore worker (which must not
 * import the parse worker: it would pull the wasm parser in).
 *
 * Nothing here is a second computation. The rows are `reportRows`; the doors
 * and the treemaps read the mapping rules through `codeLookupSubjects`, the
 * path the rules themselves count by. */

import { reportRows, type ReportRow } from "../engine/report.ts";
import { physicalProducts } from "../engine/fundamentals.ts";
import { functionTree, systemTree, type CodeTree, type TreeReading } from "../engine/code-tree.ts";
import type { CheckResult, IfcGraph, IfcSummary } from "../engine/types";
import { codeLookupSubjects, type ModelResult } from "../ids/evaluate.ts";
import type { ExtendedRule, MappingRole, Ruleset } from "../ids/types.ts";
import type { ModelGraph } from "../ids/model.ts";
import { CODE_LISTS } from "../codelists/index.ts";

export interface BoardData {
  rows: ReportRow[];
  /** Per mapping row id: every value the rule read (null = none) with the
   *  objects that carry it, so a value in a fordeling is a door. */
  values: Record<string, [string | null, string[]][]>;
  trees: { system: CodeTree; function: CodeTree };
}

export function mappingRule(ruleset: Ruleset | null | undefined, role: MappingRole): ExtendedRule | null {
  const rule = ruleset?.rules.find(
    (r): r is ExtendedRule =>
      r.kind === "extended" && r.mapping === role && r.enabled !== false && r.check.type === "code-lookup",
  );
  return rule ?? null;
}

function readings(
  ruleset: Ruleset | null,
  rule: ExtendedRule | null,
  graph: IfcGraph,
): TreeReading[] | null {
  if (!ruleset || !rule) return null;
  try {
    return codeLookupSubjects(ruleset, rule, graph as unknown as ModelGraph);
  } catch {
    // The rule is not_evaluable and its row says why; the treemap then shows
    // the unconfigured default rather than an invented reading.
    return null;
  }
}

function namesOf(rule: ExtendedRule | null, fallback: "ns3451" | "ns3457-8"): Record<string, string> {
  const check = rule?.check;
  const id = check && check.type === "code-lookup" && check.list ? check.list : fallback;
  return (CODE_LISTS as Record<string, { codes: Record<string, string> } | undefined>)[id]?.codes ?? {};
}

export function boardData(
  graph: IfcGraph,
  summary: IfcSummary,
  file: string,
  checks: CheckResult[],
  ruleset: Ruleset | null,
  evaluation: ModelResult | null,
): BoardData {
  const rows = reportRows({
    // The browser never hashes the file and the board never prints it.
    model: { file, schema: summary.schema, sha256: "" },
    graph,
    summary,
    checks,
    ruleset,
    evaluation,
  });

  const values: BoardData["values"] = {};
  for (const role of ["system-classification", "component-classification", "progress-code", "copy-object"] as const) {
    const rule = mappingRule(ruleset, role);
    const read = readings(ruleset, rule, graph);
    if (!rule || !read) continue;
    const byValue = new Map<string | null, string[]>();
    for (const r of read) {
      const bucket = byValue.get(r.value);
      if (bucket) bucket.push(r.guid);
      else byValue.set(r.value, [r.guid]);
    }
    values[rule.id] = [...byValue];
  }

  const excluded = evaluation?.excludedGuids?.length ? new Set(evaluation.excludedGuids) : undefined;
  const objects = physicalProducts(graph, excluded).map((p) => ({
    guid: p.guid,
    entity: p.entity,
    typeName: p.typed ? p.type_name : null,
    predefinedType: p.predefined_type,
  }));
  const system = mappingRule(ruleset, "system-classification");
  const component = mappingRule(ruleset, "component-classification");
  return {
    rows,
    values,
    trees: {
      system: systemTree(objects, readings(ruleset, system, graph), namesOf(system, "ns3451")),
      function: functionTree(objects, readings(ruleset, component, graph), namesOf(component, "ns3457-8")),
    },
  };
}
