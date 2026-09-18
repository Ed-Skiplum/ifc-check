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
 */

import { useCallback, useRef, useState } from "react";
import type { ModelReport } from "../engine/types";
import type { ModelResult } from "../ids/evaluate.ts";
import type { Ruleset } from "../ids/types.ts";
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
  setRuleset: (ruleset: Ruleset | null) => void;
}

function createController(setModels: SetModels): Controller {
  const queue: { id: string; file: File }[] = [];
  const workers = new Map<string, Worker>();
  /** Ids still on screen. A model removed mid-read must not spawn a worker
   *  nobody holds a handle to. */
  const live = new Set<string>();
  let active = 0;
  let counter = 0;
  let ruleset: Ruleset | null = null;

  function patch(id: string, next: Partial<ModelEntry>) {
    setModels((current) => current.map((m) => (m.id === id ? { ...m, ...next } : m)));
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
  }

  function ask(id: string, worker: Worker) {
    if (!ruleset) return;
    patch(id, { evaluating: true });
    worker.postMessage({ kind: "evaluate", ruleset });
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

      worker.onmessage = (event: MessageEvent<ModelWorkerResponse>) => {
        const message = event.data;
        if (message.kind === "parsed") {
          releaseSlot();
          patch(id, { state: "ready", report: message.report, profile: message.profile });
          ask(id, worker);
        } else if (message.kind === "parse-error") {
          releaseSlot();
          dispose(id);
          patch(id, { state: "failed", error: message.message });
        } else if (message.kind === "evaluated") {
          patch(id, { evaluating: false, evaluation: message.result, evaluationError: undefined });
        } else {
          patch(id, { evaluating: false, evaluation: undefined, evaluationError: message.message });
        }
      };
      worker.onerror = (event) => {
        releaseSlot();
        dispose(id);
        patch(id, { state: "failed", error: event.message || "worker failed to start" });
      };
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
        counter += 1;
        const accepted = isAcceptedFile(file);
        const entry: ModelEntry = {
          id: `m${counter}`,
          fileName: file.name,
          sizeBytes: file.size,
          // A file this app does not take is still listed, failed and named.
          // Dropping it on the floor is how a user ends up staring at a screen
          // that did nothing and does not say why.
          state: accepted ? "queued" : "failed",
          ...(accepted ? {} : { rejected: true }),
        };
        live.add(entry.id);
        if (accepted) queue.push({ id: entry.id, file });
        return entry;
      });
      setModels((current) => [...current, ...entries]);
      pump();
    },

    remove(id: string) {
      const queued = queue.findIndex((job) => job.id === id);
      if (queued >= 0) queue.splice(queued, 1);
      live.delete(id);
      dispose(id);
      setModels((current) => current.filter((m) => m.id !== id));
    },

    clear() {
      queue.length = 0;
      live.clear();
      for (const id of [...workers.keys()]) dispose(id);
      setModels(() => []);
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

  const addFiles = useCallback((files: File[]) => {
    controller.current?.add(files);
  }, []);
  const removeModel = useCallback((id: string) => {
    controller.current?.remove(id);
  }, []);
  const clearModels = useCallback(() => {
    controller.current?.clear();
  }, []);
  const applyRuleset = useCallback((ruleset: Ruleset | null) => {
    controller.current?.setRuleset(ruleset);
  }, []);

  return { models, addFiles, removeModel, clearModels, applyRuleset };
}
