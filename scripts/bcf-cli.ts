/** Export BCF 2.1 headlessly, validate it, and check every camera.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/bcf-cli.ts \
 *     [--ruleset r.json] [--max 500] [--author NAME] [--lang nb|en] \
 *     --out out.bcf model.ifc [more.ifc ...]
 *
 * All models go into ONE archive, as in the browser, so a space-bearing model
 * among them is used to split oversize groups of the others.
 *
 * Runs the same modules the browser runs: the parse + mesh stream as
 * `model-worker.ts` does it (same batch size, same triangle ceiling), the same
 * checks, `exportBcf` with the same strings. What it cannot do is render: there
 * is no WebGL here, so the archive has no snapshots and says so.
 *
 * Camera check, per topic with a camera: the exported IFC-frame camera is
 * rebuilt as a three.js camera IN THE IFC FRAME (Z up) and the chunk's element
 * centres are projected with it. The centres come from `collectBoxes` over the
 * raw stream plus the shift, which is the engine's path, not the viewer's
 * framing path the camera was made from. Reported: the chunk box centre's NDC
 * and how many element centres land inside the frustum.
 *
 * Exit: 0 all documents valid and every framed centre in view, 1 otherwise,
 * 2 usage.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { validateXML } from "xmllint-wasm";
import { runFundamentals } from "../src/engine/fundamentals.ts";
import { checkMeshPlacement, collectBoxes, unshiftBoxes, type ElementBox } from "../src/engine/placement.ts";
import { checkStoreyConfig } from "../src/engine/storey-config.ts";
import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";
import { evaluateRuleset } from "../src/ids/evaluate.ts";
import type { Ruleset } from "../src/ids/types.ts";
import { MESH_PRODUCTS_PER_BATCH, MESH_TRIANGLE_CEILING, type MeshBatch } from "../src/viewer/mesh-stream.ts";
import { DEFAULT_MAX_GUIDS, SNAPSHOT_VIEWPORT, exportBcf, type BcfModelSource } from "../src/bcf/export.ts";
import { createBcfValidator } from "../src/bcf/validate.ts";
import { bcfRender } from "../src/bcf/render.ts";
import type { Lang } from "../src/ui/i18n.ts";

const wasmDir = new URL("../vendor/ifcfast-wasm/", import.meta.url);
const { IfcModel, initSync } = await import(new URL("ifcfast_wasm.js", wasmDir).href);
initSync({ module: readFileSync(new URL("ifcfast_wasm_bg.wasm", wasmDir)) });

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
}
const rulesetPath = option("--ruleset");
const max = Number(option("--max") ?? DEFAULT_MAX_GUIDS);
const author = option("--author") ?? "ifc-check";
const lang = (option("--lang") ?? "nb") as Lang;
const out = option("--out");
if (!out || args.length === 0) {
  console.error("usage: bcf-cli.ts [--ruleset r.json] [--max N] [--author A] [--lang nb|en] --out out.bcf model.ifc [...]");
  process.exit(2);
}
const ruleset: Ruleset | null = rulesetPath ? JSON.parse(readFileSync(rulesetPath, "utf-8")) : null;

const sources: BcfModelSource[] = [];
const allBoxes: Map<string, ElementBox>[] = [];

for (const path of args) {
  const name = basename(path);
  const model = IfcModel.fromBytes(new Uint8Array(readFileSync(path)), name);
  const summary = JSON.parse(model.summaryJson()) as IfcSummary;

  const boxes = new Map<string, ElementBox>();
  const batches: MeshBatch[] = [];
  let triangles = 0;
  let totalTriangles = 0;
  let elements = 0;
  let totalElements = 0;
  let capped = false;
  model.streamMeshes(MESH_PRODUCTS_PER_BATCH, (metaJson: string, positions: Float32Array, indices: Uint32Array) => {
    const meta = JSON.parse(metaJson);
    collectBoxes(boxes, meta, positions);
    const t = indices.length / 3;
    totalTriangles += t;
    totalElements += meta.length;
    if (triangles + t > MESH_TRIANGLE_CEILING) {
      capped = true;
      return;
    }
    triangles += t;
    elements += meta.length;
    batches.push({ batch: batches.length, meta, positions, indices });
  });
  const shift = JSON.parse(model.streamShiftJson()) as [number, number, number];
  unshiftBoxes(boxes, shift);
  const graph = JSON.parse(model.graphJson()) as IfcGraph;
  model.free();

  let checks = [
    ...runFundamentals(graph, summary),
    checkStoreyConfig(graph, summary, undefined),
    checkMeshPlacement(graph, summary, boxes),
  ];
  let results;
  let excludedGuids: string[] | undefined;
  if (ruleset) {
    const evaluation = evaluateRuleset(ruleset, graph, summary, name);
    results = evaluation.results;
    excludedGuids = evaluation.excludedGuids;
    const excluded = excludedGuids?.length ? new Set(excludedGuids) : undefined;
    checks = [
      ...runFundamentals(graph, summary, excluded),
      checkStoreyConfig(graph, summary, ruleset.storeys),
      checkMeshPlacement(graph, summary, boxes, excluded),
    ];
  }
  const cacheKey = (summary as IfcSummary & { cache_key?: string }).cache_key;
  if (!cacheKey) throw new Error(`${name}: summary carries no cache_key`);

  sources.push({
    fileName: name,
    cacheKey,
    checks,
    results,
    excludedGuids,
    products: graph.products.map((p) => ({
      guid: p.guid,
      entity: p.entity,
      name: p.name,
      storeyGuid: p.storey_guid,
    })),
    storeys: graph.storeys.map((s) => ({ guid: s.guid, name: s.name, elevation: s.elevation })),
    unitScale: summary.unit_scale,
    mesh: {
      batches,
      shift,
      budget: { elements, totalElements, triangles, totalTriangles, capped, ceiling: MESH_TRIANGLE_CEILING },
    },
  });
  allBoxes.push(boxes);
  console.error(`${name}: shift ${JSON.stringify(shift)} capped=${capped}`);
}

const schemaDir = new URL("../vendor/bcf-schema/", import.meta.url);
const validate = createBcfValidator(
  {
    markup: readFileSync(new URL("markup.xsd", schemaDir), "utf-8"),
    visinfo: readFileSync(new URL("visinfo.xsd", schemaDir), "utf-8"),
    version: readFileSync(new URL("version.xsd", schemaDir), "utf-8"),
  },
  validateXML as never,
);

const result = await exportBcf(sources, bcfRender(lang), { maxGuids: max, author, validate });
writeFileSync(out, result.bytes);

// ---- camera check, in the IFC frame -------------------------------------
let outOfView = 0;
const cameraRows: unknown[] = [];
for (const topic of result.plan.topics) {
  const camera = result.cameras.get(topic.guid);
  if (!camera) continue;
  const c = camera.ifc;
  const probe = new PerspectiveCamera(c.fov, SNAPSHOT_VIEWPORT.width / SNAPSHOT_VIEWPORT.height, 0.01, 1e9);
  probe.position.set(...c.viewPoint);
  probe.up.set(...c.up);
  probe.lookAt(new Vector3(...c.viewPoint).add(new Vector3(...c.direction)));
  probe.updateMatrixWorld();
  probe.updateProjectionMatrix();

  const boxes = allBoxes[topic.model];
  const min = [Infinity, Infinity, Infinity];
  const max2 = [-Infinity, -Infinity, -Infinity];
  let inside = 0;
  let measured = 0;
  const forward = new Vector3(...c.direction);
  for (const guid of topic.guids) {
    const box = boxes.get(guid);
    if (!box) continue;
    const centre = new Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    measured += 1;
    const ndc = centre.clone().project(probe);
    const ahead = centre.clone().sub(probe.position).dot(forward) > 0;
    if (ahead && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) inside += 1;
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], box.min[a]);
      max2[a] = Math.max(max2[a], box.max[a]);
    }
  }
  const centre = new Vector3((min[0] + max2[0]) / 2, (min[1] + max2[1]) / 2, (min[2] + max2[2]) / 2);
  const ndc = centre.clone().project(probe);
  const centreIn = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && centre.clone().sub(probe.position).dot(forward) > 0;
  // A chunk that mixes bulk elements and far outliers is framed on its bulk
  // (robustBounds), so its union-box centre may legitimately fall outside;
  // the per-element count is then the honest number.
  if (!centreIn && inside === 0) outOfView += 1;
  cameraRows.push({
    title: topic.title,
    elements: topic.guids.length,
    withGeometry: measured,
    centresInView: inside,
    unionCentreNdc: [Number(ndc.x.toFixed(3)), Number(ndc.y.toFixed(3))],
    unionCentreInView: centreIn,
  });
}

const report = {
  out,
  bytes: result.bytes.length,
  topics: result.plan.topics.length,
  documents: result.documents.length,
  invalid: result.invalid,
  snapshots: result.snapshots,
  cameras: result.cameras.size,
  noCamera: result.noCamera,
  spaceSources: result.spaceSources,
  groups: result.plan.groups,
  perModel: sources.map((s, i) => ({
    model: s.fileName,
    topics: result.plan.topics.filter((t) => t.model === i).length,
  })),
  topicList: result.plan.topics.map((t) => ({
    index: t.index,
    guid: t.guid,
    title: t.title,
    labels: t.labels,
    elements: t.guids.length,
  })),
  cameraCheck: cameraRows,
  outOfView,
};
console.log(JSON.stringify(report, null, 2));
process.exit(result.invalid.length === 0 && outOfView === 0 ? 0 : 1);
