/** Reads a dropped ruleset: this tool's `.ruleset.json`, or a buildingSMART
 *  IDS 1.0 `.ids`.
 *
 * The `.ids` reader is `src/ids/import.ts` (DOM-free, shared with the CLI),
 * in its strict form: loaded as the RULESET, a file with any specification it
 * cannot read is refused whole, naming the path, because a ruleset that
 * quietly imported three of its four requirements would report a model as
 * clean against rules that were never applied. (The Prosjekt tab's IDS view
 * imports the same file per specification instead, and lists an unreadable
 * one as `not_evaluable`.)
 *
 * Only `.ruleset.json` is linted. That format is this tool's own and has a
 * published JSON Schema, so a lint error is an authoring mistake worth
 * stopping for. An `.ids` is a foreign standard document: it is run as written,
 * and a specification that matches nothing comes back `not_applicable`, which
 * is the signal, not a pass.
 */

import { hasErrors, lintRuleset } from "../ids/lint.ts";
import { parseIdsXml } from "../ids/import.ts";
import type { LintIssue, Ruleset } from "../ids/types.ts";

export interface LoadedRuleset {
  fileName: string;
  ruleset: Ruleset;
  issues: LintIssue[];
}

const RULESET_NAME = /\.json$/i;
const IDS_NAME = /\.(ids|xml)$/i;

export function isRulesetFile(file: File): boolean {
  return RULESET_NAME.test(file.name) || IDS_NAME.test(file.name);
}

/* ------------------------------------------------------------------ entry */

export async function readRulesetFile(file: File): Promise<LoadedRuleset> {
  const text = await file.text();

  if (IDS_NAME.test(file.name)) {
    return { fileName: file.name, ruleset: parseIdsXml(text, file.name), issues: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file.name} is not valid JSON: ${(error as Error).message}`);
  }
  const ruleset = parsed as Ruleset;
  if (!ruleset || typeof ruleset !== "object" || !Array.isArray(ruleset.rules)) {
    throw new Error(`${file.name}: no "rules" array — this is not a ruleset document`);
  }
  const issues = lintRuleset(ruleset);
  if (hasErrors(issues)) {
    const lines = issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.path}: ${issue.message}`);
    throw new Error(`${file.name}\n${lines.join("\n")}`);
  }
  return { fileName: file.name, ruleset, issues };
}
