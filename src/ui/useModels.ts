/** Drives one Web Worker per file, a bounded number parsing at a time.
 *
 * Each file gets its own worker so models process in parallel and a file that
 * blows up takes only its own worker with it. The bytes are transferred rather
 * than copied. Parse concurrency is capped because every worker instantiates
 * its own wasm module, so twenty files at once is twenty parser heaps at once.
 *
 * A worker is NOT terminated when its parse finishes: it holds the graph so a
 * ruleset dropped later can be evaluated without re-reading the file. It is
 * terminated when the model is removed, which is what makes remove and clear
 * real rather than cosmetic.
 *
 * ## The cache
 *
 * A refresh loses the models unless something outlives the page, and the file
 * cannot be the thing that does: the browser hands out no persisted handle for
 * a dropped file, so after a reload there is nothing to re-read. What persists
 * instead is the DERIVED data — summary, graph, mesh buffers — in IndexedDB,
 * keyed by ifcfast's own `cache_key` (`src/storage/model-cache.ts`).
 *
 * Two paths out of it, and they are different things:
 *
 *   refresh   the board record names which models were on screen, in order and
 *             with their ids, so the same board comes back and the `#model=`
 *             drill target in the URL still points at the same model.
 *   re-drop   a file hashed before the parse hits the same entry, so dropping
 *             a model you already looked at skips the parse entirely.
 *
 * Every storage call is optional by construction: it returns null rather than
 * throwing, and every path through this file works with the cache absent. A
 * storage fault costs speed and never a result.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { IfcGraph, IfcSummary, ModelReport } from "../engine/types";
import type { MeshBatch, MeshBudget } from "../viewer/mesh-stream";
import type { ModelResult } from "../ids/evaluate.ts";
import type { Ruleset } from "../ids/types.ts";
import {
  cacheKeyOf,
  clearBoard,
  clearCache as clearStoredModels,
  readBoard,
  readByFile,
  readModel,
  storeModel,
  writeBoard,
  type BoardEntry,
  type CachedMesh,
  type CachedModel,
  type FileLookup,
} from "../storage/model-cache.ts";
import type { RestoreWorkerRequest } from "../storage/restore-worker";
import type { ModelProfile } from "./profile";
import type { ModelWorkerResponse } from "./model-worker";

export type FileState = "queued" | "parsing" | "ready" | "failed";

export interface ModelEntry {
  id: string;
  fileName: string;
  sizeBytes: number;
  state: FileState;
  report?: ModelReport;
  profile?: ModelProfile;
  /** Set when the file could not be read or parsed. Never silently dropped. */
  error?: string;
  /** Set when the file was not an IFC at all — also never silently dropped. */
  rejected?: boolean;
  /** The streamed geometry, once the mesh pass has finished. Transferred out
   *  of the worker, so these arrays are not copies of anything. */
  meshBatches?: MeshBatch[];
  meshShift?: [number, number, number];
  meshBudget?: MeshBudget;
  /** The mesh pass failed. Named and shown, never folded into the parse error
   *  and never left as a blank tile. */
  meshError?: string;
  /** Present once a ruleset has been evaluated against this model. */
  evaluation?: ModelResult;
  evaluationError?: string;
  evaluating?: boolean;
}

const MAX_CONCURRENT = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1));

const ACCEPTED = /\.(ifc|ifczip)$/i;

export function isAcceptedFile(file: File): boolean {
  return ACCEPTED.test(file.name);
}

type SetModels = (update: (current: ModelEntry[]) => ModelEntry[]) => void;

interface Controller {
  add: (files: File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  clearCache: () => void;
  restore: () => void;
  setRuleset: (ruleset: Ruleset | null) => void;
}

/** What a parse has produced so far, held until it is complete enough to cache.
 *
 * The mesh pass finishes before `parsed` arrives, so neither half can write on
 * its own: a record with geometry and no graph would restore a board that
 * cannot answer a ruleset, and one with a graph and no geometry would restore a
 * blank viewer beside a full dashboard. The write happens once both have
 * landed, or not at all.
 */
interface Draft {
  dropKey: string | null;
  fileName: string;
  sizeBytes: number;
  parseMs: number;
  summary: IfcSummary | null;
  graph: IfcGraph | null;
  mesh: CachedMesh | null;
  meshError: string | null;
  meshSettled: boolean;
  parsed: boolean;
}

/** Storage is an optimisation, so a failure inside it is absorbed here rather
 *  than allowed to reach the parse it was meant to save. */
async function lookupCache(file: File): Promise<FileLookup> {
  try {
    return await readByFile(file);
  } catch {
    return { dropKey: null, model: null };
  }
}

function createController(setModels: SetModels): Controller {
  const queue: { id: string; file: File }[] = [];
  const workers = new Map<string, Worker>();
  /** Streamed batches, accumulated OUTSIDE React state and committed once the
   *  pass finishes. A large model streams hundreds of batches, and one state
   *  update per batch would be one full board re-render per batch. */
  const meshes = new Map<string, MeshBatch[]>();
  /** Ids still on screen. A model removed mid-read must not spawn a worker
   *  nobody holds a handle to. */
  const live = new Set<string>();
  /** Board order, held here rather than read back out of React state: the board
   *  record has to be written from callbacks that do not have the list. */
  const order: string[] = [];
  /** Model id -> the cache key its data is stored under. Only ids that really
   *  are in the store, so a board record never points at nothing. */
  const keys = new Map<string, string>();
  const drafts = new Map<string, Draft>();
  let active = 0;
  let counter = 0;
  let ruleset: Ruleset | null = null;
  let restored = false;

  function patch(id: string, next: Partial<ModelEntry>) {
    setModels((current) => current.map((m) => (m.id === id ? { ...m, ...next } : m)));
  }

  /** Reuse the id a restored model had, so the drill target in the URL hash
   *  still resolves; fall back to a fresh one if this session already took it. */
  function takeId(preferred?: string): string {
    if (preferred !== undefined && preferred.startsWith("m") && !live.has(preferred)) {
      const n = Number(preferred.slice(1));
      if (Number.isInteger(n) && n > counter) counter = n;
      return preferred;
    }
    counter += 1;
    while (live.has(`m${counter}`)) counter += 1;
    return `m${counter}`;
  }

  function saveBoard() {
    const entries: BoardEntry[] = [];
    for (const id of order) {
      const cacheKey = keys.get(id);
      if (cacheKey !== undefined) entries.push({ id, cacheKey });
    }
    void writeBoard(entries).catch(() => {});
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      active += 1;
      void run(job.id, job.file);
    }
  }

  /** Frees the parse slot a running job holds, keyed by model id, so removing
   *  a model that is mid-parse hands its slot back instead of stalling the
   *  queue behind it. */
  const slots = new Map<string, () => void>();

  function dispose(id: string) {
    slots.get(id)?.();
    workers.get(id)?.terminate();
    workers.delete(id);
    meshes.delete(id);
    drafts.delete(id);
  }

  function ask(id: string, worker: Worker) {
    if (!ruleset) return;
    patch(id, { evaluating: true });
    worker.postMessage({ kind: "evaluate", ruleset });
  }

  /** Write the record, once the parse has produced every part of it. */
  function commit(id: string) {
    const draft = drafts.get(id);
    if (!draft || !draft.parsed || !draft.meshSettled) return;
    drafts.delete(id);
    if (!live.has(id)) return;
    if (draft.summary === null || draft.graph === null) return;

    // ifcfast's own content key. Without it there is nothing to key on, and a
    // key invented here would be a claim about identity the engine did not make.
    const cacheKey = cacheKeyOf(draft.summary);
    if (cacheKey === null) return;

    void storeModel({
      cacheKey,
      dropKey: draft.dropKey,
      fileName: draft.fileName,
      sizeBytes: draft.sizeBytes,
      parseMs: draft.parseMs,
      summary: draft.summary,
      graph: draft.graph,
      mesh: draft.mesh,
      meshError: draft.meshError,
    })
      .then((stored) => {
        // The board is only told about a model that is really in the store.
        if (!stored || !live.has(id)) return;
        keys.set(id, cacheKey);
        saveBoard();
      })
      .catch(() => {});
  }

  /** The one worker protocol, spoken by the parse worker and the restore
   *  worker alike. `release` is the parse slot; a restore holds none. */
  function attach(id: string, worker: Worker, release: () => void) {
    worker.onmessage = (event: MessageEvent<ModelWorkerResponse>) => {
      const message = event.data;
      if (message.kind === "parsed") {
        release();
        patch(id, { state: "ready", report: message.report, profile: message.profile });
        const draft = drafts.get(id);
        if (draft) {
          draft.parsed = true;
          draft.summary = message.report.summary;
          // Absent on the restore path: that graph came OUT of the cache and
          // has no business going back in.
          draft.graph = message.graph ?? null;
          draft.parseMs = message.report.parseMs;
          commit(id);
        }
        ask(id, worker);
      } else if (message.kind === "parse-error") {
        release();
        dispose(id);
        patch(id, { state: "failed", error: message.message });
      } else if (message.kind === "mesh-batch") {
        const held = meshes.get(id) ?? [];
        held.push(message.batch);
        meshes.set(id, held);
      } else if (message.kind === "mesh-done") {
        const batches = meshes.get(id) ?? [];
        patch(id, {
          meshBatches: batches,
          meshShift: message.shift,
          meshBudget: message.budget,
          meshError: undefined,
        });
        meshes.delete(id);
        const draft = drafts.get(id);
        if (draft) {
          draft.mesh = { batches, shift: message.shift, budget: message.budget };
          draft.meshSettled = true;
          commit(id);
        }
      } else if (message.kind === "mesh-error") {
        meshes.delete(id);
        patch(id, { meshError: message.message });
        const draft = drafts.get(id);
        if (draft) {
          draft.meshError = message.message;
          draft.meshSettled = true;
          commit(id);
        }
      } else if (message.kind === "evaluated") {
        // The copy-object mapping's exclusions apply to fundamentals too, so
        // the worker recomputed `checks` alongside the ruleset result; merge
        // rather than patch, since `report` itself is not replaced.
        setModels((current) =>
          current.map((m) =>
            m.id === id
              ? {
                  ...m,
                  evaluating: false,
                  evaluation: message.result,
                  evaluationError: undefined,
                  report: m.report ? { ...m.report, checks: message.checks } : m.report,
                }
              : m,
          ),
        );
      } else {
        patch(id, { evaluating: false, evaluation: undefined, evaluationError: message.message });
      }
    };
    worker.onerror = (event) => {
      release();
      dispose(id);
      patch(id, { state: "failed", error: event.message || "worker failed to start" });
    };
  }

  /** Put a cached record back on the board: its geometry straight into state,
   *  its graph into a worker that can answer a ruleset. */
  function rehydrate(id: string, record: CachedModel) {
    try {
      const worker = new Worker(new URL("../storage/restore-worker.ts", import.meta.url), {
        type: "module",
      });
      workers.set(id, worker);
      attach(id, worker, () => {});

      if (record.mesh !== null) {
        patch(id, {
          meshBatches: record.mesh.batches,
          meshShift: record.mesh.shift,
          meshBudget: record.mesh.budget,
        });
      } else if (record.meshError !== null) {
        patch(id, { meshError: record.meshError });
      }

      const request: RestoreWorkerRequest = {
        kind: "restore",
        fileName: record.fileName,
        sizeBytes: record.sizeBytes,
        parseMs: record.parseMs,
        summary: record.summary,
        graph: record.graph,
      };
      worker.postMessage(request);
    } catch (err) {
      dispose(id);
      patch(id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function run(id: string, file: File) {
    patch(id, { state: "parsing" });
    let parsing = true;

    const releaseSlot = () => {
      if (!parsing) return;
      parsing = false;
      slots.delete(id);
      active -= 1;
      pump();
    };
    slots.set(id, releaseSlot);

    // Before the file is read at all: is this one already parsed once?
    const lookup = await lookupCache(file);
    if (!live.has(id)) {
      releaseSlot();
      return;
    }
    if (lookup.model !== null) {
      releaseSlot();
      keys.set(id, lookup.model.cacheKey);
      rehydrate(id, lookup.model);
      saveBoard();
      return;
    }

    try {
      const bytes = await file.arrayBuffer();
      if (!live.has(id)) {
        releaseSlot();
        return;
      }
      const worker = new Worker(new URL("./model-worker.ts", import.meta.url), {
        type: "module",
      });
      workers.set(id, worker);
      drafts.set(id, {
        dropKey: lookup.dropKey,
        fileName: file.name,
        sizeBytes: file.size,
        parseMs: 0,
        summary: null,
        graph: null,
        mesh: null,
        meshError: null,
        meshSettled: false,
        parsed: false,
      });

      attach(id, worker, releaseSlot);
      worker.postMessage({ kind: "parse", fileName: file.name, bytes }, [bytes]);
    } catch (err) {
      releaseSlot();
      dispose(id);
      patch(id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    add(files: File[]) {
      if (files.length === 0) return;
      const entries = files.map((file) => {
        const accepted = isAcceptedFile(file);
        const entry: ModelEntry = {
          id: takeId(),
          fileName: file.name,
          sizeBytes: file.size,
          // A file this app does not take is still listed, failed and named.
          // Dropping it on the floor is how a user ends up staring at a screen
          // that did nothing and does not say why.
          state: accepted ? "queued" : "failed",
          ...(accepted ? {} : { rejected: true }),
        };
        live.add(entry.id);
        order.push(entry.id);
        if (accepted) queue.push({ id: entry.id, file });
        return entry;
      });
      setModels((current) => [...current, ...entries]);
      pump();
    },

    /** Put back what was on the board last. Asynchronous and unawaited: the
     *  drop target is usable from the first paint, and a model appears as its
     *  record is read rather than after all of them are. */
    restore() {
      if (restored) return;
      restored = true;
      void (async () => {
        let board: BoardEntry[] = [];
        try {
          board = await readBoard();
        } catch {
          return;
        }
        if (board.length === 0) return;

        let missing = false;
        for (const saved of board) {
          let record: CachedModel | null = null;
          try {
            record = await readModel(saved.cacheKey);
          } catch {
            record = null;
          }
          if (record === null) {
            // Evicted, or written by a build whose format this one does not
            // read. It is simply not restored — never restored half-understood.
            missing = true;
            continue;
          }
          const id = takeId(saved.id);
          live.add(id);
          order.push(id);
          keys.set(id, record.cacheKey);
          setModels((current) => [
            ...current,
            {
              id,
              fileName: record.fileName,
              sizeBytes: record.sizeBytes,
              state: "parsing",
            },
          ]);
          rehydrate(id, record);
        }
        if (missing) saveBoard();
      })();
    },

    remove(id: string) {
      const queued = queue.findIndex((job) => job.id === id);
      if (queued >= 0) queue.splice(queued, 1);
      live.delete(id);
      dispose(id);
      const at = order.indexOf(id);
      if (at >= 0) order.splice(at, 1);
      keys.delete(id);
      saveBoard();
      setModels((current) => current.filter((m) => m.id !== id));
    },

    /** Empties the BOARD. The cached models stay, so dropping the same files
     *  again comes back instantly — clearing the cache is a separate action. */
    clear() {
      queue.length = 0;
      live.clear();
      meshes.clear();
      drafts.clear();
      order.length = 0;
      keys.clear();
      for (const id of [...workers.keys()]) dispose(id);
      void clearBoard().catch(() => {});
      setModels(() => []);
    },

    /** Empties the CACHE. What is on screen stays on screen; it is simply no
     *  longer stored, so a refresh from here starts empty. */
    clearCache() {
      keys.clear();
      void clearStoredModels().catch(() => {});
    },

    setRuleset(next: Ruleset | null) {
      ruleset = next;
      if (next === null) {
        setModels((current) =>
          current.map((m) => ({
            ...m,
            evaluating: false,
            evaluation: undefined,
            evaluationError: undefined,
          })),
        );
        return;
      }
      for (const [id, worker] of workers) ask(id, worker);
    },
  };
}

export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const controller = useRef<Controller | null>(null);
  controller.current ??= createController(setModels);

  // Off the first paint on purpose: the board fills in as records are read,
  // and the drop target works the whole time.
  useEffect(() => {
    controller.current?.restore();
  }, []);

  const addFiles = useCallback((files: File[]) => {
    controller.current?.add(files);
  }, []);
  const removeModel = useCallback((id: string) => {
    controller.current?.remove(id);
  }, []);
  const clearModels = useCallback(() => {
    controller.current?.clear();
  }, []);
  const clearCache = useCallback(() => {
    controller.current?.clearCache();
  }, []);
  const applyRuleset = useCallback((ruleset: Ruleset | null) => {
    controller.current?.setRuleset(ruleset);
  }, []);

  return { models, addFiles, removeModel, clearModels, clearCache, applyRuleset };
}
