/** Run the fundamentals against IFC files from the command line.
 *
 * A mechanism gate, not a substitute for using the app: it proves the checks
 * produce the counts they should against real models. Node 24 strips the types
 * natively, so this needs no build step and no extra dependency.
 *
 *   node scripts/check-cli.ts [--ruleset <file.ruleset.json|config.xlsx>] <model.ifc> [...]
 *
 * `--ruleset` supplies the floor config (`storeys`) for `storey-config` and
 * the model facts (`models`: the file's discipline, its exemptions); without
 * it that check is not_applicable.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { elementMaterialNames, runFundamentals, verdictOf } from "../src/engine/fundamentals.ts";
import {
  checkMeshPlacement,
  collectBoxes,
  unshiftBoxes,
  type ElementBox,
} from "../src/engine/placement.ts";
import { modelKpis } from "../src/engine/kpis.ts";
import { bodyDeclarations, checkBodyWithoutMesh, unmeshedGuids } from "../src/engine/body-mesh.ts";
import { checkStoreyConfig } from "../src/engine/storey-config.ts";
import { exemptChecks } from "../src/engine/exempt.ts";
import { readRulesetXlsx } from "../src/ids/xlsx.ts";
import type { Ruleset } from "../src/ids/types.ts";
import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";

const wasmDir = new URL("../vendor/ifcfast-wasm/", import.meta.url);
const { IfcModel, initSync } = await import(new URL("ifcfast_wasm.js", wasmDir).href);
initSync({ module: readFileSync(new URL("ifcfast_wasm_bg.wasm", wasmDir)) });

const VERDICT_WIDTH = 8;
const STATE_WIDTH = 24;

const args = process.argv.slice(2);
let ruleset: Ruleset | undefined;
const at = args.indexOf("--ruleset");
if (at >= 0) {
  const path = args[at + 1];
  ruleset = /\.xlsx$/i.test(path)
    ? readRulesetXlsx(new Uint8Array(readFileSync(path))).ruleset
    : (JSON.parse(readFileSync(path, "utf-8")) as Ruleset);
  args.splice(at, 2);
}

for (const path of args) {
  const bytes = readFileSync(path);
  const name = basename(path);

  const t0 = performance.now();
  const model = IfcModel.fromBytes(new Uint8Array(bytes), name);
  const parseMs = performance.now() - t0;

  // Geometry first, exactly as the parse worker does it: `graphJson()` then
  // reuses the streamed stats instead of running a second mesh pass.
  const boxes = new Map<string, ElementBox>();
  model.streamMeshes(250, (metaJson: string, positions: Float32Array) => {
    collectBoxes(boxes, JSON.parse(metaJson), positions);
  });
  unshiftBoxes(boxes, JSON.parse(model.streamShiftJson()));

  const summary = JSON.parse(model.summaryJson()) as IfcSummary;
  const graph = JSON.parse(model.graphJson()) as IfcGraph;
  // The three mesh-free tables `graphJson()` does not carry, attached exactly
  // as `src/ui/model-worker.ts` attaches them — `type-unused` reads the type
  // roster off the graph and would otherwise report "not supplied" here while
  // the board answers it.
  graph.type_objects = JSON.parse(model.typeObjectsJson());
  graph.psets = JSON.parse(model.psetsJson());
  graph.classifications = JSON.parse(model.classificationsJson());
  graph.quantities = JSON.parse(model.quantitiesJson());
  graph.materials = JSON.parse(model.materialsJson());
  // As the parse worker: the Body declarations of the unmeshed elements, from
  // the STEP bytes (not for an ifczip).
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    graph.body_declared = bodyDeclarations(new Uint8Array(bytes), unmeshedGuids(graph, boxes));
  }
  const checks = exemptChecks(
    [
      ...runFundamentals(graph, summary),
      checkStoreyConfig(graph, summary, ruleset, name),
      checkMeshPlacement(graph, summary, boxes),
      checkBodyWithoutMesh(graph, boxes),
    ],
    ruleset,
    name,
  );
  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  const materialNames = elementMaterialNames(graph);
  const kpis = modelKpis({
    summary,
    checks,
    sizeBytes: bytes.length,
    storeys: graph.storeys.length,
    products: graph.products.map((p) => ({
      ...p,
      materials: materialNames?.get(p.guid) ?? p.materials,
      typeGuid: p.type_guid,
      isOpening: openings.has(p.guid),
    })),
  });

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
  const show = (v: number | null) => (v === null ? "n/a" : String(v));
  console.log(
    `  KPI  types ${show(kpis.typesUsed)}/${show(kpis.typesDeclared)} used/declared · ` +
      `untyped ${show(kpis.untyped)} · floors ${kpis.floors} · ` +
      `size ${(kpis.sizeBytes / 1e6).toFixed(1)} MB · materials ${kpis.materials} · ` +
      `orphans ${show(kpis.orphans)} · placement ${show(kpis.placement)}`,
  );
  model.free();
}
