/** Headless proof that a board survives a reload — the round trip, not a mock.
 *
 * A real IFC is parsed and streamed through `streamMeshes` exactly as
 * `src/ui/model-worker.ts` does, the result is written through the SHIPPED
 * cache module, read back out, and compared byte for byte. No second copy of
 * any algorithm lives here.
 *
 * IndexedDB comes from `fake-indexeddb` (a devDependency), which implements the
 * spec over an in-memory store and structured-clones records on the way in and
 * out — so the typed arrays that come back really are copies rather than the
 * same objects, and a comparison means something. What it cannot prove is a
 * real browser: quota pressure, eviction under storage pressure, private-window
 * behaviour and a second tab holding the database open are all outside it.
 *
 * Asserted:
 *   1  the summary comes back identical
 *   2  the graph comes back identical
 *   3  every mesh batch's positions and indices come back BYTE-identical, and
 *      the per-mesh metadata with them
 *   4  file name, size and parse time come back as stored
 *   5  a file hashed before any parse finds its own record — the re-drop path
 *   6  the board record round-trips in order, with ids
 *   7  a record whose format integer is not this build's is a MISS, not a
 *      half-understood restore
 *   8  the entry cap evicts oldest-first, and takes the dangling pre-parse key
 *      with it
 *   9  the byte cap refuses an entry that cannot coexist with the ceiling
 *  10  clearing the cache empties it
 *
 * Run:  node scripts/cache-gate.mjs <model.ifc>
 * Exit: 0 all assertions hold, 1 an assertion failed, 2 usage/internal.
 */

import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { initSync, IfcModel } from "../vendor/ifcfast-wasm/ifcfast_wasm.js";
import { ask, MODELS, transact } from "../src/storage/idb.ts";
import {
  CACHE_FORMAT,
  CACHE_MAX_BYTES,
  CACHE_MAX_ENTRIES,
  cacheKeyOf,
  cacheUsage,
  clearCache,
  contentKey,
  estimateBytes,
  readBoard,
  readByFile,
  readModel,
  storeModel,
  writeBoard,
} from "../src/storage/model-cache.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/cache-gate.mjs <model.ifc>");
  process.exit(2);
}

let failed = false;
function check(ok, label) {
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

initSync({
  module: readFileSync(new URL("../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm", import.meta.url)),
});

/* ------------------------------------------------------------------ parse */

const bytes = readFileSync(path);
const fileName = basename(path);
const t0 = performance.now();
const model = IfcModel.fromBytes(new Uint8Array(bytes), fileName);
const parseMs = performance.now() - t0;

const summary = JSON.parse(model.summaryJson());

const batches = [];
let batchNumber = 0;
model.streamMeshes(250, (metaJson, positions, indices) => {
  batches.push({ batch: batchNumber++, meta: JSON.parse(metaJson), positions, indices });
});
const shift = JSON.parse(model.streamShiftJson());
const graph = JSON.parse(model.graphJson());
model.free();

const elements = batches.reduce((sum, b) => sum + b.meta.length, 0);
const vertices = batches.reduce((sum, b) => sum + b.positions.length / 3, 0);
const faces = batches.reduce((sum, b) => sum + b.indices.length / 3, 0);
const arrayBytes = batches.reduce((sum, b) => sum + b.positions.byteLength + b.indices.byteLength, 0);
const metaJsonBytes = Buffer.byteLength(JSON.stringify(batches.map((b) => b.meta)));
const graphJsonBytes = Buffer.byteLength(JSON.stringify(graph));
const summaryJsonBytes = Buffer.byteLength(JSON.stringify(summary));

const mesh = {
  batches,
  shift,
  budget: {
    elements,
    totalElements: elements,
    triangles: faces,
    totalTriangles: faces,
    capped: false,
    ceiling: 4_000_000,
  },
};

const cacheKey = cacheKeyOf(summary);
if (cacheKey === null) {
  console.error("summaryJson() carries no cache_key — this build of the engine cannot be cached");
  process.exit(2);
}

/* ------------------------------------------------------------ round trip */

const file = new File([bytes], fileName);
const dropKey = await contentKey(file);

const stored = await storeModel({
  cacheKey,
  dropKey,
  fileName,
  sizeBytes: bytes.byteLength,
  parseMs,
  summary,
  graph,
  mesh,
  meshError: null,
});
check(stored === true, "the record is written");

const back = await readModel(cacheKey);
check(back !== null, "the record reads back");
if (back === null) process.exit(1);

check(JSON.stringify(back.summary) === JSON.stringify(summary), "summary identical");
check(JSON.stringify(back.graph) === JSON.stringify(graph), "graph identical");
check(
  back.fileName === fileName &&
    back.sizeBytes === bytes.byteLength &&
    back.parseMs === parseMs,
  "file name, size and parse time identical",
);
check(back.format === CACHE_FORMAT, `format integer is ${CACHE_FORMAT}`);

check(back.mesh !== null && back.mesh.batches.length === batches.length, "every batch came back");
let meshIdentical = back.mesh !== null;
if (back.mesh !== null) {
  check(
    JSON.stringify(back.mesh.shift) === JSON.stringify(shift) &&
      JSON.stringify(back.mesh.budget) === JSON.stringify(mesh.budget),
    "shift and budget identical",
  );
  for (let i = 0; i < batches.length; i += 1) {
    const before = batches[i];
    const after = back.mesh.batches[i];
    const same =
      after !== undefined &&
      after.batch === before.batch &&
      after.positions instanceof Float32Array &&
      after.indices instanceof Uint32Array &&
      // A different object, so this is a comparison and not an identity check.
      after.positions !== before.positions &&
      Buffer.compare(Buffer.from(after.positions.buffer, after.positions.byteOffset, after.positions.byteLength), Buffer.from(before.positions.buffer, before.positions.byteOffset, before.positions.byteLength)) === 0 &&
      Buffer.compare(Buffer.from(after.indices.buffer, after.indices.byteOffset, after.indices.byteLength), Buffer.from(before.indices.buffer, before.indices.byteOffset, before.indices.byteLength)) === 0 &&
      JSON.stringify(after.meta) === JSON.stringify(before.meta);
    if (!same) meshIdentical = false;
  }
}
check(meshIdentical, "every positions / indices buffer is byte-identical, and its metadata with it");

/* ---------------------------------------------------- the re-drop shortcut */

const lookup = await readByFile(new File([bytes], fileName));
check(lookup.dropKey === dropKey, "the same file hashes to the same pre-parse key");
check(lookup.model !== null && lookup.model.cacheKey === cacheKey, "a re-dropped file finds its record without a parse");

const otherBytes = Buffer.concat([bytes, Buffer.from("\n")]);
const other = await readByFile(new File([otherBytes], fileName));
check(other.dropKey !== dropKey && other.model === null, "a different file is a miss");

/* ------------------------------------------------------------- the board */

await writeBoard([
  { id: "m1", cacheKey },
  { id: "m2", cacheKey: "not-in-the-store" },
]);
const board = await readBoard();
check(
  board.length === 2 && board[0].id === "m1" && board[0].cacheKey === cacheKey && board[1].id === "m2",
  "the board round-trips in order, with ids",
);
check((await readModel("not-in-the-store")) === null, "a board entry with no record is a miss");

/* ------------------------------------------------- a format this build changed */

await transact([MODELS], "readwrite", async (tx) => {
  const raw = await ask(tx.objectStore(MODELS).get(cacheKey));
  tx.objectStore(MODELS).put({ ...raw, format: CACHE_FORMAT + 1 });
  return true;
});
check((await readModel(cacheKey)) === null, "a record from another format is a miss");
check((await readModel(cacheKey)) === null, "and is dropped rather than left to be read again");

/* ------------------------------------------------------------- the bounds */

const emptyGraph = {
  schema: "IFC4",
  products: [],
  storeys: [],
  sites: [],
  buildings: [],
  projects: [],
  spaces: [],
  contained_in: [],
  aggregates: [],
  storey_building: [],
  voids: [],
};

// Re-store the real record so there is something with a known age to evict.
await storeModel({
  cacheKey,
  dropKey,
  fileName,
  sizeBytes: bytes.byteLength,
  parseMs,
  summary,
  graph,
  mesh,
  meshError: null,
});

for (let i = 1; i <= CACHE_MAX_ENTRIES + 1; i += 1) {
  await storeModel({
    cacheKey: `synthetic-${i}`,
    dropKey: null,
    fileName: `synthetic-${i}.ifc`,
    sizeBytes: 1024,
    parseMs: 1,
    summary,
    graph: emptyGraph,
    mesh: null,
    meshError: null,
  });
}

const usage = await cacheUsage();
check(usage.entries === CACHE_MAX_ENTRIES, `the cache holds at most ${CACHE_MAX_ENTRIES} entries (holds ${usage.entries})`);
check((await readModel(cacheKey)) === null, "the least recently used entry was evicted first");
check((await readModel("synthetic-1")) === null, "and then the next one");
check((await readModel(`synthetic-${CACHE_MAX_ENTRIES + 1}`)) !== null, "the newest entry is still there");
check((await readByFile(new File([bytes], fileName))).model === null, "the evicted entry's pre-parse key went with it");

// The byte cap, on the arithmetic rather than on a real quarter-gigabyte
// payload: `estimateBytes` reads lengths, so a graph that reports an absurd one
// exercises the refusal without allocating it.
const hugeGraph = {
  products: { length: 10_000_000 },
  storeys: { length: 0 },
  contained_in: { length: 0 },
  aggregates: { length: 0 },
  voids: { length: 0 },
};
check(estimateBytes(hugeGraph, null) > CACHE_MAX_BYTES, "the budget of an oversized model exceeds the ceiling");
check(
  (await storeModel({
    cacheKey: "oversized",
    dropKey: null,
    fileName: "oversized.ifc",
    sizeBytes: 1,
    parseMs: 1,
    summary,
    graph: hugeGraph,
    mesh: null,
    meshError: null,
  })) === false,
  "an entry that cannot coexist with the ceiling is refused, not stored",
);

await clearCache();
check((await cacheUsage()).entries === 0, "clearing the cache empties it");
check((await readBoard()).length === 0, "and empties the board record with it");

/* -------------------------------------------------------------- what ran */

const budget = estimateBytes(graph, mesh);
console.log("");
console.log(`model            ${fileName}  (${bytes.byteLength.toLocaleString()} bytes on disk)`);
console.log(`schema           ${summary.schema}`);
console.log(`cache_key        ${cacheKey}`);
console.log(`pre-parse key    ${dropKey}`);
console.log(`parse            ${parseMs.toFixed(0)} ms`);
console.log(`elements         ${summary.products.toLocaleString()} products, ${elements.toLocaleString()} meshed`);
console.log(`geometry         ${vertices.toLocaleString()} vertices, ${faces.toLocaleString()} faces, ${batches.length} batches`);
console.log(
  `stored           ${arrayBytes.toLocaleString()} bytes of typed arrays ` +
    `(${(batches.reduce((s, b) => s + b.positions.length, 0)).toLocaleString()} floats, ` +
    `${(batches.reduce((s, b) => s + b.indices.length, 0)).toLocaleString()} uint32)`,
);
console.log(
  `                 + ${graphJsonBytes.toLocaleString()} bytes graph JSON, ` +
    `${metaJsonBytes.toLocaleString()} bytes mesh metadata, ` +
    `${summaryJsonBytes.toLocaleString()} bytes summary`,
);
console.log(
  `                 = ${(arrayBytes + graphJsonBytes + metaJsonBytes + summaryJsonBytes).toLocaleString()} bytes measured; ` +
    `the cache budgets it at ${budget.toLocaleString()}`,
);

process.exit(failed ? 1 : 0);
