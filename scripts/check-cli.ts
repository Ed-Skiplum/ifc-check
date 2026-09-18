/** Run the fundamentals against IFC files from the command line.
 *
 * A mechanism gate, not a substitute for using the app: it proves the checks
 * produce the counts they should against real models. Node 24 strips the types
 * natively, so this needs no build step and no extra dependency.
 *
 *   node scripts/check-cli.ts <model.ifc> [...]
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { runFundamentals, verdictOf } from "../src/engine/fundamentals.ts";
import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";

const wasmDir = new URL("../vendor/ifcfast-wasm/", import.meta.url);
const { IfcModel, initSync } = await import(new URL("ifcfast_wasm.js", wasmDir).href);
initSync({ module: readFileSync(new URL("ifcfast_wasm_bg.wasm", wasmDir)) });

const VERDICT_WIDTH = 8;
const STATE_WIDTH = 24;

for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const name = basename(path);

  const t0 = performance.now();
  const model = IfcModel.fromBytes(new Uint8Array(bytes), name);
  const parseMs = performance.now() - t0;

  const summary = JSON.parse(model.summaryJson()) as IfcSummary;
  const graph = JSON.parse(model.graphJson()) as IfcGraph;
  const checks = runFundamentals(graph, summary);

  console.log(
    `\n=== ${name} | ${summary.schema} | ${(bytes.length / 1e6).toFixed(1)} MB ` +
      `| ${summary.products} products | parsed in ${parseMs.toFixed(0)} ms ===`,
  );
  for (const c of checks) {
    // Verdict first: it is what the screen leads with, and a gate that prints
    // only the mechanical state cannot show that `fail` + advisory is an
    // Advarsel rather than an Avvik.
    const verdict = verdictOf(c).toUpperCase().padEnd(VERDICT_WIDTH);
    const state = `${c.state}/${c.severity}`.padEnd(STATE_WIDTH);
    const value = c.displayValue.text.padEnd(28);
    const head = `  ${verdict}${c.id.padEnd(24)}${value}${state}`;
    if (c.state === "not_applicable") {
      console.log(`${head}${c.reason}`);
      continue;
    }
    console.log(`${head}${c.findings.length} finding(s)  —  ${c.detail}`);
    for (const f of c.findings.slice(0, 2)) {
      console.log(`      ${f.guid}  ${f.entity.padEnd(22)} ${f.reason}`);
    }
    if (c.findings.length > 2) {
      console.log(`      ... ${c.findings.length - 2} more`);
    }
  }
  model.free();
}
