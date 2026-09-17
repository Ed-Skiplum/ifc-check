/** Export: one .ids holding only what IDS can express, one .ruleset.json holding
 *  everything, and a statement of what the difference is.
 *
 * Silently dropping an authored rule is the failure mode this file exists to
 * prevent. Every rule the export leaves out of the .ids comes back in
 * `excluded` with a reason, and a custom namespace is never smuggled into the
 * .ids to make a non-IDS rule look expressible.
 */

import { emitIdsXml } from "./emit.ts";
import { hasErrors, lintRuleset } from "./lint.ts";
import type { ExtendedCheckType, IdsRule, LintIssue, Rule, Ruleset } from "./types.ts";

export type ExclusionCode =
  | "disabled"
  | `not-expressible:${ExtendedCheckType}`
  | "not-expressible:unknown";

export interface ExcludedRule {
  ruleId: string;
  name: string;
  /** Stable key so the UI can localise the reason. */
  code: ExclusionCode;
  /** Factual English reason, for headless output and for the log. */
  reason: string;
}

export interface ExportResult {
  /** The IDS 1.0 document, or null when no rule was expressible: an .ids with
   *  zero specifications is invalid, so none is produced. */
  ids: string | null;
  idsFileName: string;
  /** The complete ruleset, both kinds of rule. */
  rulesetJson: string;
  rulesetFileName: string;
  includedRuleIds: string[];
  excluded: ExcludedRule[];
  lint: LintIssue[];
}

/** Why each extended check cannot be an IDS facet. Stated per check type
 *  because "not expressible" without the reason is not information. */
const EXTENDED_REASONS: Record<ExtendedCheckType, string> = {
  "element-typed":
    "IDS 1.0 has no IFCRELDEFINESBYTYPE in its relations enumeration, so type " +
    "linkage cannot be a partOf facet",
  "unique-attribute":
    "IDS 1.0 has no uniqueness or cross-instance operator; a facet asks about " +
    "one entity at a time",
  "type-usage-count":
    "IDS 1.0 has no cross-instance counting; applicability minOccurs counts the " +
    "whole selection, not occurrences per type",
  "model-metadata":
    "IfcUnitAssignment, the STEP header and the parse statistics are not " +
    "reachable by any IDS facet",
};

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "oe")
    .replace(/[å]/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "ruleset" : s;
}

export function isEnabled(rule: Rule): boolean {
  return rule.enabled !== false;
}

/** Which rules go into the .ids, and why the rest do not. */
export function partitionRules(ruleset: Ruleset): {
  included: IdsRule[];
  excluded: ExcludedRule[];
} {
  const included: IdsRule[] = [];
  const excluded: ExcludedRule[] = [];
  for (const rule of ruleset.rules) {
    if (!isEnabled(rule)) {
      excluded.push({
        ruleId: rule.id,
        name: rule.name,
        code: "disabled",
        reason: "rule is disabled",
      });
      continue;
    }
    if (rule.kind === "ids") {
      included.push(rule);
      continue;
    }
    const type = rule.check?.type;
    const reason = type ? EXTENDED_REASONS[type] : undefined;
    excluded.push({
      ruleId: rule.id,
      name: rule.name,
      code: reason ? `not-expressible:${type}` : "not-expressible:unknown",
      reason: reason ?? "extended rule with an unknown check type",
    });
  }
  return { included, excluded };
}

/** Build both files. Throws on a lint error rather than emitting XML that the
 *  schema will reject — a broken premise is not something to paper over. */
export function exportRuleset(ruleset: Ruleset): ExportResult {
  const lint = lintRuleset(ruleset);
  if (hasErrors(lint)) {
    const first = lint.find((i) => i.severity === "error");
    throw new Error(
      `ruleset has ${lint.filter((i) => i.severity === "error").length} lint ` +
        `error(s); first: ${first?.path} ${first?.message}`,
    );
  }
  const { included, excluded } = partitionRules(ruleset);
  const base = slug(ruleset.name);
  return {
    ids: included.length > 0 ? emitIdsXml(ruleset, included) : null,
    idsFileName: `${base}.ids`,
    rulesetJson: JSON.stringify(ruleset, null, 2) + "\n",
    rulesetFileName: `${base}.ruleset.json`,
    includedRuleIds: included.map((r) => r.id),
    excluded,
    lint,
  };
}
