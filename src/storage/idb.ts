/** IndexedDB with the ceremony wrapped up, and never allowed to take the app down.
 *
 * Every entry point here resolves rather than throws: a browser with storage
 * blocked, a private window, a quota refusal and a database that will not open
 * all come back as `null`. The cache is an optimisation — the app parses the
 * file again and is correct — so a storage fault may cost speed and may never
 * cost a result.
 *
 * `globalThis.indexedDB` rather than `window.indexedDB`: this module is read by
 * the headless gate under a fake IndexedDB, and by nothing that assumes a DOM.
 */

const DB_NAME = "ifc-check";
/** Bumped only when the STORES change. The record shape is versioned
 *  separately, inside each record — see `CACHE_FORMAT` in model-cache.ts. */
const DB_VERSION = 1;

/** Parsed models, keyed by ifcfast's own `cache_key`. Large records. */
export const MODELS = "models";
/** `{cacheKey, format, usedAt, bytes}` — everything eviction reads, so a pass
 *  over the cache never has to load a megabyte of geometry to decide. */
export const META = "meta";
/** Our pre-parse content hash -> `cache_key`, so a re-dropped file can be
 *  recognised BEFORE it is parsed. */
export const DROPKEYS = "dropkeys";
/** One record: what was on the board last, in order. */
export const BOARD = "board";

let handle: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let factory: IDBFactory | undefined;
    try {
      factory = globalThis.indexedDB;
    } catch {
      resolve(null);
      return;
    }
    if (!factory) {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODELS)) db.createObjectStore(MODELS, { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains(DROPKEYS)) {
        db.createObjectStore(DROPKEYS, { keyPath: "dropKey" });
      }
      if (!db.objectStoreNames.contains(BOARD)) db.createObjectStore(BOARD, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holds an older version open. Nothing to do but go without.
    request.onblocked = () => resolve(null);
  });
}

/** The one database handle. Opened once; a failure is remembered as a failure
 *  rather than retried on every keystroke. */
export function database(): Promise<IDBDatabase | null> {
  handle ??= openDatabase();
  return handle;
}

export function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/**
 * Run one transaction and resolve with what the body returned, or `null` if
 * anything at all went wrong — including the transaction aborting after the
 * body resolved, which is how a quota refusal arrives.
 */
export async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T | null> {
  const db = await database();
  if (db === null) return null;
  try {
    const tx = db.transaction(stores, mode);
    const settled = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
    // Attached before the body can throw, so a body that fails does not leave
    // this rejection unhandled.
    settled.catch(() => {});
    const value = await body(tx);
    await settled;
    return value;
  } catch {
    return null;
  }
}
