/** Parity of the fundamentals on two inputs of the same model version: the
 * ifcfast wasm parse of the IFC (what the browser runs) and the platform
 * substrate's L1 tables through `l1ToGraph` (what a check runner reads).
 *
 *   node scripts/l1-parity.ts [qa/_data/<file id> ...]
 *
 * Each directory is what `scripts/l1-fetch.ts` writes: the seven Parquet
 * tables, `manifest.json` and `source.ifc`. With no argument every such
 * directory under `qa/_data/` is run. The Parquet reader (hyparquet, fzstd) is
 * a dev dependency used here only; the browser bundle never imports it.
 *
 * Prints, per check, verdict, state, applicable and finding count on both
 * sides, then the graph facts behind any difference: which products, which
 * field. Exit 1 when any check differs, so a difference cannot scroll by.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parquetReadObjects } from "hyparquet";
import { decompress } from "fzstd";
import { runFundamentals, verdictOf } from "../src/engine/fundamentals.ts";
import { l1ToGraph, type L1Manifest, type L1Tables } from "../src/engine/l1-graph.ts";
import type { CheckResult, IfcGraph, IfcSummary, ProductRow } from "../src/engine/types.ts";

const wasmDir = new URL("../vendor/ifcfast-wasm/", import.meta.url);
const { IfcModel, initSync } = await import(new URL("ifcfast_wasm.js", wasmDir).href);
initSync({ module: readFileSync(new URL("ifcfast_wasm_bg.wasm", wasmDir)) });

const TABLES = ["elements", "types", "spatial", "properties", "quantities", "materials", "classifications"] as const;

async function readTable(dir: string, name: string): Promise<Record<string, unknown>[]> {
  const buf = readFileSync(join(dir, `${name}.parquet`));
  return parquetReadObjects({
    file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    compressors: { ZSTD: (input: Uint8Array) => decompress(input) },
  });
}

function wasmSide(dir: string): { graph: IfcGraph; summary: IfcSummary } {
  const bytes = readFileSync(join(dir, "source.ifc"));
  const model = IfcModel.fromBytes(new Uint8Array(bytes), "source.ifc");
  try {
    const summary = JSON.parse(model.summaryJson()) as IfcSummary;
    const graph = JSON.parse(model.graphJson()) as IfcGraph;
    // The tables graphJson() does not carry, attached as the parse worker does.
    graph.type_objects = JSON.parse(model.typeObjectsJson());
    graph.psets = JSON.parse(model.psetsJson());
    graph.classifications = JSON.parse(model.classificationsJson());
    graph.quantities = JSON.parse(model.quantitiesJson());
    graph.materials = JSON.parse(model.materialsJson());
    return { graph, summary };
  } finally {
    model.free();
  }
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);

function checkLine(c: CheckResult | undefined): string {
  if (!c) return "missing";
  return `${verdictOf(c)} ${c.state} a=${c.applicable} f=${c.findings.length} "${c.displayValue.text}"`;
}

function sameCheck(a: CheckResult, b: CheckResult): boolean {
  return (
    a.state === b.state &&
    a.applicable === b.applicable &&
    a.findings.length === b.findings.length &&
    a.displayValue.text === b.displayValue.text &&
    a.detail === b.detail
  );
}

function findingDiff(a: CheckResult, b: CheckResult): string[] {
  const key = (f: { guid: string; code: string }) => `${f.guid} ${f.code}`;
  const ka = new Set(a.findings.map(key));
  const kb = new Set(b.findings.map(key));
  const onlyA = [...ka].filter((k) => !kb.has(k));
  const onlyB = [...kb].filter((k) => !ka.has(k));
  const out: string[] = [];
  if (onlyA.length) out.push(`only wasm (${onlyA.length}): ${onlyA.slice(0, 5).join(", ")}`);
  if (onlyB.length) out.push(`only L1 (${onlyB.length}): ${onlyB.slice(0, 5).join(", ")}`);
  if (a.detail !== b.detail) out.push(`detail: wasm "${a.detail}" / L1 "${b.detail}"`);
  return out;
}

/** The graph facts the fundamentals read, compared product by product. */
function graphDiff(w: IfcGraph, l: IfcGraph): string[] {
  const out: string[] = [];
  const count = (name: string, a: number, b: number) => {
    if (a !== b) out.push(`${name}: wasm ${a} / L1 ${b}`);
  };
  count("products", w.products.length, l.products.length);
  count("storeys", w.storeys.length, l.storeys.length);
  count("projects", w.projects.length, l.projects.length);
  count("sites", w.sites.length, l.sites.length);
  count("buildings", w.buildings.length, l.buildings.length);
  count("spaces", w.spaces.length, l.spaces.length);
  count("contained_in", w.contained_in.length, l.contained_in.length);
  count("aggregates", w.aggregates.length, l.aggregates.length);
  count("storey_building", w.storey_building.length, l.storey_building.length);
  count("voids", w.voids.length, l.voids.length);
  count("type_objects", w.type_objects?.length ?? -1, l.type_objects?.length ?? -1);
  count("psets", w.psets?.length ?? -1, l.psets?.length ?? -1);
  count("quantities", w.quantities?.length ?? -1, l.quantities?.length ?? -1);
  count("materials", w.materials?.length ?? -1, l.materials?.length ?? -1);
  count("classifications", w.classifications?.length ?? -1, l.classifications?.length ?? -1);

  const voidKey = (v: { opening_guid: string; host_guid: string }) => `${v.opening_guid}>${v.host_guid}`;
  const lv = new Set(l.voids.map(voidKey));
  const vMiss = w.voids.filter((v) => !lv.has(voidKey(v)));
  if (vMiss.length) out.push(`voids in wasm not in L1: ${vMiss.length} (${vMiss.slice(0, 3).map(voidKey).join(", ")})`);

  const byGuid = new Map<string, ProductRow>();
  for (const p of l.products) byGuid.set(p.guid, p);
  const fields: (keyof ProductRow)[] = [
    "entity", "name", "predefined_type", "object_type", "tag", "storey_guid", "parent_guid",
    "typed", "type_guid", "type_name", "type_source", "materials", "is_external", "load_bearing", "fire_rating",
  ];
  const tally = new Map<string, string[]>();
  let absent = 0;
  for (const p of w.products) {
    const q = byGuid.get(p.guid);
    if (!q) {
      absent += 1;
      continue;
    }
    for (const f of fields) {
      if (JSON.stringify(p[f]) === JSON.stringify(q[f])) continue;
      const list = tally.get(f) ?? [];
      list.push(`${p.guid} ${p.entity}: wasm ${JSON.stringify(p[f])} / L1 ${JSON.stringify(q[f])}`);
      tally.set(f, list);
    }
  }
  if (absent) out.push(`wasm products absent from L1: ${absent}`);
  for (const [f, list] of tally) {
    out.push(`products.${f} differs on ${list.length}:`);
    for (const s of list.slice(0, 4)) out.push(`    ${s}`);
  }
  return out;
}

function summaryDiff(w: IfcSummary, l: IfcSummary): string[] {
  const keys: (keyof IfcSummary)[] = [
    "schema", "products", "storeys", "length_unit", "unit_scale", "unit_resolved", "duplicate_step_ids", "warnings",
  ];
  return keys
    .filter((k) => JSON.stringify(w[k]) !== JSON.stringify(l[k]))
    .map((k) => `summary.${k}: wasm ${JSON.stringify(w[k])} / L1 ${JSON.stringify(l[k])}`);
}

const root = new URL("../qa/_data/", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(rootPath)
      .map((d) => join(rootPath, d))
      .filter((d) => existsSync(join(d, "manifest.json")) && existsSync(join(d, "source.ifc")));
if (dirs.length === 0) {
  console.error("no data: run scripts/l1-fetch.ts <file id> first");
  process.exit(2);
}

let differing = 0;
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as L1Manifest;
  const raw: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) raw[t] = await readTable(dir, t);
  const l1 = l1ToGraph(raw as unknown as L1Tables, manifest);
  const wasm = wasmSide(dir);

  const wChecks = runFundamentals(wasm.graph, wasm.summary);
  const lChecks = runFundamentals(l1.graph, l1.summary);

  console.log(
    `\n=== ${manifest.source?.filename} | ${manifest.ifcSchema} | ${manifest.parser} vs vendored wasm ===`,
  );
  console.log(`  ${pad("check", 24)}${pad("wasm", 52)}${pad("L1", 52)}`);
  for (const w of wChecks) {
    const l = lChecks.find((c) => c.id === w.id);
    const same = l !== undefined && sameCheck(w, l);
    if (!same) differing += 1;
    console.log(`  ${same ? "  " : "!!"}${pad(w.id, 22)}${pad(checkLine(w), 52)}${pad(checkLine(l), 52)}`);
    if (!same && l) for (const s of findingDiff(w, l)) console.log(`        ${s}`);
  }
  const facts = [...summaryDiff(wasm.summary, l1.summary), ...graphDiff(wasm.graph, l1.graph)];
  console.log(facts.length ? "\n  graph and summary differences:" : "\n  graph and summary: no differences");
  for (const s of facts) console.log(`    ${s}`);
  console.log("\n  not observable in L1:");
  for (const s of l1.unobserved) console.log(`    ${s}`);
}

process.exit(differing ? 1 : 0);
