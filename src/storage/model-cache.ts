/** What survives a refresh: the DERIVED data, keyed by the file's content.
 *
 * The browser cannot re-read a dropped file after a reload — there is no
 * persisted `File` handle — so caching the bytes would buy nothing. What is
 * cached instead is everything the board was built FROM: the summary, the
 * graph, and the streamed mesh buffers. A restore is then a structured-clone
 * read and a re-run of the checks, with no parse and no wasm.
 *
 * ## The key
 *
 * The primary key is ifcfast's own `cache_key` — a hash over the schema
 * version, the file size and the head and tail of the file, which the engine
 * computes precisely to identify a file's content. Using it means a cache hit
 * is a statement the ENGINE makes about identity, not one made up here.
 *
 * It only exists after a parse, though, and the point of the cache is to skip
 * the parse. So a second, pre-parse key is kept alongside: a SHA-256 over the
 * same file, full for anything up to `FULL_HASH_LIMIT` and over the size plus
 * the head and tail 4 MiB above it. `dropkeys` maps it to the `cache_key`, and
 * that is what makes re-dropping a file you already looked at instant.
 *
 * The windowed form inherits the caveat ifcfast's own key has: a large file
 * edited only in its middle hashes the same. Full-file hashing up to 64 MiB
 * keeps the common case exact, and the mode is part of the stored key so the
 * two never collide.
 *
 * ## What is NOT cached
 *
 * The check results and the profile, though both are derived and both could be
 * stored. A restored board must report what the CURRENT checks say, not what
 * an older build of them said — a verdict from code that no longer exists is
 * exactly the quietly-wrong result this tool is built to refuse. They are
 * recomputed from the stored graph on restore, by the same function the parse
 * path calls.
 *
 * View state is not here either: language, selection and drill target live in
 * the URL hash (`ui/useHashView.ts`), where they belong.
 */

import type { IfcGraph, IfcSummary } from "../engine/types";
import type { MeshBatch, MeshBudget } from "../viewer/mesh-stream";
import { ask, BOARD, DROPKEYS, META, MODELS, transact } from "./idb.ts";

/**
 * The shape of a stored record. Bump this when the STORED shape changes, and
 * every older entry is treated as a miss and re-parsed.
 *
 * A record whose format does not match is never half-read: restoring something
 * this code only partly understands is worse than parsing the file again.
 */
export const CACHE_FORMAT = 1;

/**
 * The ceiling, and why it is where it is.
 *
 * The mesh pass is already capped at 4M triangles (`MESH_TRIANGLE_CEILING`),
 * which is about 96 MB of index and position buffers for a single model.
 * 256 MB therefore holds at least two of the largest models this viewer will
 * ever carry, or a working set of a dozen ordinary ones — while staying far
 * below the origin quota a browser grants (typically a large share of free
 * disk), so the cache is not what runs a machine out of room.
 *
 * Three bounds, all enforced before a write: total bytes, entry count, and age.
 * Eviction is least-recently-USED, not least-recently-written, so the model you
 * keep coming back to is the one that stays.
 */
export const CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const CACHE_MAX_ENTRIES = 12;
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Above this, the pre-parse key hashes the head and tail rather than the file. */
const FULL_HASH_LIMIT = 64 * 1024 * 1024;
const HASH_WINDOW = 4 * 1024 * 1024;

const BOARD_KEY = "board";

export interface CachedMesh {
  batches: MeshBatch[];
  shift: [number, number, number];
  budget: MeshBudget;
}

export interface CachedModel {
  /** ifcfast's `cache_key`. */
  cacheKey: string;
  format: number;
  fileName: string;
  sizeBytes: number;
  /** Milliseconds the ORIGINAL parse took. Stored so a restored tile reads
   *  identically to the one that was there before the refresh. */
  parseMs: number;
  storedAt: number;
  summary: IfcSummary;
  graph: IfcGraph;
  /** Null when the mesh pass failed or produced nothing. */
  mesh: CachedMesh | null;
  meshError: string | null;
}

interface MetaRow {
  cacheKey: string;
  format: number;
  usedAt: number;
  bytes: number;
  /** What the landing lists, copied off the record so listing the cache never
   *  loads a graph. Optional: rows written before these existed are backfilled
   *  from their record once, by `listCached`. */
  fileName?: string;
  sizeBytes?: number;
  schema?: string;
  products?: number;
}

interface DropKeyRow {
  dropKey: string;
  cacheKey: string;
  format: number;
}

/** One model on the board, in board order. The id is carried so the `#model=`
 *  drill target in the URL hash still points at the same model after a
 *  refresh. */
export interface BoardEntry {
  id: string;
  cacheKey: string;
}

interface BoardRow {
  key: string;
  format: number;
  entries: BoardEntry[];
  savedAt: number;
}

/** Wall-clock with sub-millisecond resolution, so two writes in the same
 *  millisecond still order. Plain `Date.now()` ties, and a tie in an LRU is an
 *  arbitrary eviction. */
function now(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * ifcfast's content key, off the summary.
 *
 * `summaryJson()` carries `cache_key`, but `src/engine/types.ts` — which this
 * module may not change — does not declare it. Read defensively rather than
 * asserted: a build of the engine without it degrades to no cache, not to a
 * cache keyed on `undefined`.
 */
export function cacheKeyOf(summary: IfcSummary): string | null {
  const value = (summary as IfcSummary & { cache_key?: unknown }).cache_key;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The pre-parse key for a dropped file, or null if it cannot be computed.
 *
 * `crypto.subtle` needs a secure context. Over plain http the key is simply
 * unavailable: the file is parsed, the result is still cached under its
 * `cache_key`, and a refresh still restores it — only the re-drop shortcut is
 * gone. It costs speed, never a result.
 */
export async function contentKey(file: File): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    if (file.size <= FULL_HASH_LIMIT) {
      const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
      return `full:${file.size}:${hex(digest)}`;
    }
    const head = new Uint8Array(await file.slice(0, HASH_WINDOW).arrayBuffer());
    const tail = new Uint8Array(await file.slice(file.size - HASH_WINDOW).arrayBuffer());
    const joined = new Uint8Array(head.byteLength + tail.byteLength);
    joined.set(head, 0);
    joined.set(tail, head.byteLength);
    const digest = await subtle.digest("SHA-256", joined);
    return `window:${file.size}:${hex(digest)}`;
  } catch {
    return null;
  }
}

/**
 * The payload budget for one record, in bytes.
 *
 * Exact for the typed arrays — which are the bulk, and the whole reason the
 * cap exists — and a structural estimate for the JSON. `JSON.stringify` on a
 * 300k-product graph would cost a second and a hundred-megabyte string to
 * measure something the eviction rule only needs to the nearest few per cent.
 * The number is a budget, and is never reported as a measured size.
 *
 * The per-row constants are calibrated against `KNM_RIB.ifc` (583 bytes of
 * graph JSON and 217 bytes of mesh metadata per product) and rounded UP: a
 * budget that runs low is a cap that does not hold.
 */
export function estimateBytes(graph: IfcGraph, mesh: CachedMesh | null): number {
  let bytes = 8 * 1024;
  bytes += graph.products.length * 600;
  bytes += graph.storeys.length * 200;
  bytes += (graph.contained_in.length + graph.aggregates.length + graph.voids.length) * 100;
  for (const batch of mesh?.batches ?? []) {
    bytes += batch.positions.byteLength + batch.indices.byteLength + batch.meta.length * 240;
  }
  return bytes;
}

function validMesh(mesh: unknown): mesh is CachedMesh {
  if (mesh === null || typeof mesh !== "object") return false;
  const candidate = mesh as CachedMesh;
  if (!Array.isArray(candidate.batches)) return false;
  if (!Array.isArray(candidate.shift) || candidate.shift.length !== 3) return false;
  if (candidate.budget === null || typeof candidate.budget !== "object") return false;
  if (typeof candidate.budget.triangles !== "number") return false;
  return candidate.batches.every(
    (batch) =>
      batch !== null &&
      typeof batch === "object" &&
      typeof batch.batch === "number" &&
      Array.isArray(batch.meta) &&
      batch.positions instanceof Float32Array &&
      batch.indices instanceof Uint32Array,
  );
}

/**
 * A stored record, or null if it is not one this code understands.
 *
 * Checked field by field rather than trusted. The format integer catches a
 * shape this build changed; the rest catches a record that was written by a
 * build that shared the integer and not the meaning.
 */
function validate(raw: unknown): CachedModel | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as CachedModel;
  if (record.format !== CACHE_FORMAT) return null;
  if (typeof record.cacheKey !== "string" || record.cacheKey.length === 0) return null;
  if (typeof record.fileName !== "string") return null;
  if (typeof record.sizeBytes !== "number" || typeof record.parseMs !== "number") return null;
  if (record.summary === null || typeof record.summary !== "object") return null;
  if (record.graph === null || typeof record.graph !== "object") return null;
  if (!Array.isArray(record.graph.products) || !Array.isArray(record.graph.storeys)) return null;
  if (record.mesh !== null && !validMesh(record.mesh)) return null;
  return record;
}

async function forget(cacheKeys: string[]): Promise<void> {
  if (cacheKeys.length === 0) return;
  const gone = new Set(cacheKeys);
  await transact([MODELS, META, DROPKEYS], "readwrite", async (tx) => {
    for (const key of gone) {
      tx.objectStore(MODELS).delete(key);
      tx.objectStore(META).delete(key);
    }
    const links = await ask<DropKeyRow[]>(tx.objectStore(DROPKEYS).getAll());
    for (const link of links) {
      if (gone.has(link.cacheKey)) tx.objectStore(DROPKEYS).delete(link.dropKey);
    }
    return true;
  });
}

/** Mark an entry as used. Written to `meta` only — touching the model record
 *  would rewrite a hundred megabytes to move a timestamp. */
async function touch(cacheKey: string): Promise<void> {
  await transact([META], "readwrite", async (tx) => {
    const store = tx.objectStore(META);
    const row = await ask<MetaRow | undefined>(store.get(cacheKey));
    if (row) store.put({ ...row, usedAt: now() });
    return true;
  });
}

/**
 * Make room for `incoming` bytes: stale formats and expired entries first, then
 * least-recently-used until both the byte and the count bound hold.
 */
async function evict(incoming: number, keep: string): Promise<void> {
  const rows = await transact([META], "readonly", (tx) =>
    ask<MetaRow[]>(tx.objectStore(META).getAll()),
  );
  if (rows === null) return;

  const at = now();
  const victims: string[] = [];
  const fresh: MetaRow[] = [];
  for (const row of rows) {
    if (row.cacheKey === keep) continue;
    if (row.format !== CACHE_FORMAT || at - row.usedAt > CACHE_MAX_AGE_MS) {
      victims.push(row.cacheKey);
      continue;
    }
    fresh.push(row);
  }

  fresh.sort((a, b) => a.usedAt - b.usedAt);
  let bytes = incoming + fresh.reduce((sum, row) => sum + row.bytes, 0);
  let count = fresh.length + 1;
  while (fresh.length > 0 && (bytes > CACHE_MAX_BYTES || count > CACHE_MAX_ENTRIES)) {
    const oldest = fresh.shift();
    if (!oldest) break;
    victims.push(oldest.cacheKey);
    bytes -= oldest.bytes;
    count -= 1;
  }

  await forget(victims);
}

export interface StoreInput {
  cacheKey: string;
  /** The pre-parse key, when one could be computed for this file. */
  dropKey: string | null;
  fileName: string;
  sizeBytes: number;
  parseMs: number;
  summary: IfcSummary;
  graph: IfcGraph;
  mesh: CachedMesh | null;
  meshError: string | null;
}

/** True only when the record is actually in the store. */
export async function storeModel(input: StoreInput): Promise<boolean> {
  const bytes = estimateBytes(input.graph, input.mesh);
  // One entry that cannot coexist with the ceiling is not stored at all,
  // rather than stored by emptying the cache of everything else first.
  if (bytes > CACHE_MAX_BYTES) return false;

  await evict(bytes, input.cacheKey);

  const at = now();
  const record: CachedModel = {
    cacheKey: input.cacheKey,
    format: CACHE_FORMAT,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    parseMs: input.parseMs,
    storedAt: at,
    summary: input.summary,
    graph: input.graph,
    mesh: input.mesh,
    meshError: input.meshError,
  };
  const meta: MetaRow = {
    cacheKey: input.cacheKey,
    format: CACHE_FORMAT,
    usedAt: at,
    bytes,
    ...listedFields(record),
  };

  const written = await transact([MODELS, META, DROPKEYS], "readwrite", async (tx) => {
    tx.objectStore(MODELS).put(record);
    tx.objectStore(META).put(meta);
    if (input.dropKey !== null) {
      const link: DropKeyRow = {
        dropKey: input.dropKey,
        cacheKey: input.cacheKey,
        format: CACHE_FORMAT,
      };
      tx.objectStore(DROPKEYS).put(link);
    }
    return true;
  });
  return written === true;
}

export async function readModel(cacheKey: string): Promise<CachedModel | null> {
  const raw = await transact([MODELS], "readonly", (tx) =>
    ask<unknown>(tx.objectStore(MODELS).get(cacheKey)),
  );
  if (raw === null || raw === undefined) return null;
  const record = validate(raw);
  if (record === null) {
    // Present but not understood. Dropped rather than half-restored.
    void forget([cacheKey]);
    return null;
  }
  void touch(cacheKey);
  return record;
}

export interface FileLookup {
  /** Null when no pre-parse key could be computed for this file. */
  dropKey: string | null;
  model: CachedModel | null;
}

/** The cached model for a file that has not been parsed yet, plus the key to
 *  store it under if it turns out to be a miss. */
export async function readByFile(file: File): Promise<FileLookup> {
  const dropKey = await contentKey(file);
  if (dropKey === null) return { dropKey: null, model: null };

  const link = await transact([DROPKEYS], "readonly", (tx) =>
    ask<DropKeyRow | undefined>(tx.objectStore(DROPKEYS).get(dropKey)),
  );
  if (!link || link.format !== CACHE_FORMAT || typeof link.cacheKey !== "string") {
    return { dropKey, model: null };
  }

  const model = await readModel(link.cacheKey);
  if (model === null) {
    // The link outlived the model it pointed at — an eviction, or a record this
    // build no longer understands. Clear it so it is not followed again.
    await transact([DROPKEYS], "readwrite", async (tx) => {
      tx.objectStore(DROPKEYS).delete(dropKey);
      return true;
    });
  }
  return { dropKey, model };
}

export async function readBoard(): Promise<BoardEntry[]> {
  const raw = await transact([BOARD], "readonly", (tx) =>
    ask<BoardRow | undefined>(tx.objectStore(BOARD).get(BOARD_KEY)),
  );
  if (!raw || raw.format !== CACHE_FORMAT || !Array.isArray(raw.entries)) return [];
  return raw.entries.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.cacheKey === "string",
  );
}

export async function writeBoard(entries: BoardEntry[]): Promise<void> {
  const row: BoardRow = { key: BOARD_KEY, format: CACHE_FORMAT, entries, savedAt: now() };
  await transact([BOARD], "readwrite", async (tx) => {
    tx.objectStore(BOARD).put(row);
    return true;
  });
}

/** Forget what was on the board. The cached models stay, so dropping the same
 *  files again is instant. This is what clearing the board does. */
export async function clearBoard(): Promise<void> {
  await writeBoard([]);
}

/** Forget everything, models included. */
export async function clearCache(): Promise<void> {
  await transact([MODELS, META, DROPKEYS, BOARD], "readwrite", async (tx) => {
    tx.objectStore(MODELS).clear();
    tx.objectStore(META).clear();
    tx.objectStore(DROPKEYS).clear();
    tx.objectStore(BOARD).clear();
    return true;
  });
}

function listedFields(record: CachedModel): Pick<MetaRow, "fileName" | "sizeBytes" | "schema" | "products"> {
  return {
    fileName: record.fileName,
    sizeBytes: record.sizeBytes,
    schema: typeof record.summary.schema === "string" ? record.summary.schema : "",
    products: record.graph.products.length,
  };
}

/** One cached model, as the landing lists it. Every field is read off the
 *  stored record; nothing here is estimated. */
export interface CachedListing {
  cacheKey: string;
  fileName: string;
  sizeBytes: number;
  schema: string;
  products: number;
  /** Last time the model was stored or opened. */
  usedAt: number;
}

/**
 * The models the cache can put back on the board, most recently used first.
 *
 * Only entries this build can actually restore are listed: a stale format or
 * an expired row is left out rather than offered and then refused. A row from
 * before the listing fields existed is filled in from its record once (without
 * touching its LRU time), and one whose record no longer validates is dropped.
 */
export async function listCached(): Promise<CachedListing[]> {
  const rows = await transact([META], "readonly", (tx) =>
    ask<MetaRow[]>(tx.objectStore(META).getAll()),
  );
  if (rows === null) return [];

  const at = now();
  const out: CachedListing[] = [];
  for (const row of rows) {
    if (row.format !== CACHE_FORMAT || at - row.usedAt > CACHE_MAX_AGE_MS) continue;
    let listed = row;
    if (typeof row.fileName !== "string" || typeof row.products !== "number") {
      const raw = await transact([MODELS], "readonly", (tx) =>
        ask<unknown>(tx.objectStore(MODELS).get(row.cacheKey)),
      );
      const record = raw === null || raw === undefined ? null : validate(raw);
      if (record === null) {
        void forget([row.cacheKey]);
        continue;
      }
      listed = { ...row, ...listedFields(record) };
      await transact([META], "readwrite", async (tx) => {
        tx.objectStore(META).put(listed);
        return true;
      });
    }
    out.push({
      cacheKey: listed.cacheKey,
      fileName: listed.fileName ?? "",
      sizeBytes: listed.sizeBytes ?? 0,
      schema: listed.schema ?? "",
      products: listed.products ?? 0,
      usedAt: listed.usedAt,
    });
  }
  return out.sort((a, b) => b.usedAt - a.usedAt);
}

/** Entry count and budgeted bytes, for a caller that wants to say what
 *  clearing the cache would actually clear. */
export async function cacheUsage(): Promise<{ entries: number; bytes: number }> {
  const rows = await transact([META], "readonly", (tx) =>
    ask<MetaRow[]>(tx.objectStore(META).getAll()),
  );
  if (rows === null) return { entries: 0, bytes: 0 };
  return {
    entries: rows.length,
    bytes: rows.reduce((sum, row) => sum + (typeof row.bytes === "number" ? row.bytes : 0), 0),
  };
}
