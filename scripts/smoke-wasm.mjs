import { readFileSync } from "node:fs";
import init, { IfcModel, initSync } from "./ifcfast/pkg/ifcfast_wasm.js";

const wasmBytes = readFileSync("./ifcfast/pkg/ifcfast_wasm_bg.wasm");
initSync({ module: wasmBytes });

const path = process.argv[2];
const bytes = readFileSync(path);
const t0 = performance.now();
const m = IfcModel.fromBytes(new Uint8Array(bytes), path.split(/[\/]/).pop());
const t1 = performance.now();

const summary = JSON.parse(m.summaryJson());
console.log(`parsed ${(bytes.length / 1e6).toFixed(1)} MB in ${(t1 - t0).toFixed(0)} ms`);
console.log("summary keys:", Object.keys(summary).join(", "));
console.log("schema:", summary.header_schema ?? summary.schema);
console.log("products:", summary.product_count ?? summary.products ?? "?");

const graph = JSON.parse(m.graphJson());
console.log("graph keys:", Object.keys(graph).join(", "));
if (graph.storeys) console.log("storeys:", JSON.stringify(graph.storeys));
if (graph.products) console.log("product rows:", graph.products.length, "| sample:", JSON.stringify(graph.products[0]));
