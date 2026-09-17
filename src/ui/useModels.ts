/** Drives one Web Worker per file, a bounded number at a time.
 *
 * Each file gets its own worker so models process in parallel and a file that
 * blows up takes only its own worker with it. The bytes are transferred rather
 * than copied. Concurrency is capped because every worker instantiates its own
 * wasm module, so twenty files at once is twenty parser heaps at once.
 */

import { useCallback, useRef, useState } from "react";
import type { ModelReport } from "../engine/types";
import type { WorkerResponse } from "../engine/worker";

export type FileState = "queued" | "parsing" | "ready" | "failed";

export interface ModelEntry {
  id: string;
  fileName: string;
  sizeBytes: number;
  state: FileState;
  report?: ModelReport;
  /** Set when the file could not be read or parsed. Never silently dropped. */
  error?: string;
}

const MAX_CONCURRENT = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1));

const ACCEPTED = /\.(ifc|ifczip)$/i;

export function isAcceptedFile(file: File): boolean {
  return ACCEPTED.test(file.name);
}

type SetModels = (update: (current: ModelEntry[]) => ModelEntry[]) => void;

interface Controller {
  add: (files: File[]) => void;
}

function createController(setModels: SetModels): Controller {
  const queue: { id: string; file: File }[] = [];
  let active = 0;
  let counter = 0;

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

  async function run(id: string, file: File) {
    patch(id, { state: "parsing" });
    let worker: Worker | null = null;
    let settled = false;

    const finish = (next: Partial<ModelEntry>) => {
      if (settled) return;
      settled = true;
      patch(id, next);
      worker?.terminate();
      worker = null;
      active -= 1;
      pump();
    };

    try {
      const bytes = await file.arrayBuffer();
      worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.kind === "done") finish({ state: "ready", report: message.report });
        else finish({ state: "failed", error: message.message });
      };
      worker.onerror = (event) => {
        finish({ state: "failed", error: event.message || "worker failed to start" });
      };
      worker.postMessage({ fileName: file.name, bytes }, [bytes]);
    } catch (err) {
      finish({ state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    add(files: File[]) {
      const accepted = files.filter(isAcceptedFile);
      if (accepted.length === 0) return;
      const entries = accepted.map((file) => {
        counter += 1;
        const entry: ModelEntry = {
          id: `m${counter}`,
          fileName: file.name,
          sizeBytes: file.size,
          state: "queued",
        };
        queue.push({ id: entry.id, file });
        return entry;
      });
      setModels((current) => [...current, ...entries]);
      pump();
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

  return { models, addFiles };
}
