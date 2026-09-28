/** Reads a dropped ruleset: this tool's `.ruleset.json`, the same ruleset as
 *  an `.xlsx` workbook (src/ids/xlsx.ts), or a buildingSMART IDS 1.0 `.ids`.
 *
 * The `.ids` reader is `src/ids/import.ts` (DOM-free, shared with the CLI),
 * in its strict form: loaded as the RULESET, a file with any specification it
 * cannot read is refused whole, naming the path, because a ruleset that
 * quietly imported three of its four requirements would report a model as
 * clean against rules that were never applied. (The Prosjekt tab's IDS view
 * imports the same file per specification instead, and lists an unreadable
 * one as `not_evaluable`.)
 *
 * `.ruleset.json` and `.xlsx` are linted; an `.xlsx` issue is named at its
 * Sheet!Cell. That format is this tool's own and has a published JSON
 * Schema, so a lint error is an authoring mistake worth stopping for. An
 * `.ids` is a foreign standard document: it is run as written, and a
 * specification that matches nothing comes back `not_applicable`, which is
 * the signal, not a pass.
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
const XLSX_NAME = /\.xlsx$/i;

export function isRulesetFile(file: File): boolean {
  return RULESET_NAME.test(file.name) || IDS_NAME.test(file.name) || XLSX_NAME.test(file.name);
}

/** Throws, naming every lint error, when there is one. */
function refuse(fileName: string, issues: LintIssue[], where: (path: string) => string): void {
  if (!hasErrors(issues)) return;
  const lines = issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${where(issue.path)}: ${issue.message}`);
  throw new Error(`${fileName}\n${lines.join("\n")}`);
}

/* ------------------------------------------------------------------ entry */

export async function readRulesetFile(file: File): Promise<LoadedRuleset> {
  if (IDS_NAME.test(file.name)) {
    return { fileName: file.name, ruleset: parseIdsXml(await file.text(), file.name), issues: [] };
  }

  if (XLSX_NAME.test(file.name)) {
    const { locate, readRulesetXlsx } = await import("../ids/xlsx.ts");
    let read: Awaited<ReturnType<typeof readRulesetXlsx>>;
    try {
      read = readRulesetXlsx(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      throw new Error(`${file.name}\n${(error as Error).message}`);
    }
    const issues = lintRuleset(read.ruleset);
    refuse(file.name, issues, (path) => `${locate(path, read.locations) ?? "-"} ${path}`);
    return { fileName: file.name, ruleset: read.ruleset, issues };
  }

  const text = await file.text();
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
  refuse(file.name, issues, (path) => path);
  return { fileName: file.name, ruleset, issues };
}
