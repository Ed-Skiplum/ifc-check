/** The ifcopenshell run behind the `body-no-mesh` check, per model.
 *
 * On demand (the control in the derivation band): the file is read again
 * from the `File` the user dropped, handed to `ifcos-worker.ts` with the
 * check's GUIDs, and the verdicts come back per element. Where ifcopenshell
 * found geometry ifcfast did not, one ifcfast issue per signature: first the
 * unauthenticated GitHub search for an open issue carrying that signature in
 * its title, then either that issue's link or a prefilled new-issue link the
 * user opens. Nothing is filed from here; a public page holds no token.
 *
 * Held outside React state (a store with `useSyncExternalStore`), so the
 * model list does not re-render for a run's stage changes.
 */

import { useSyncExternalStore } from "react";
import {
  issueFacts,
  issueSearchUrl,
  matchingIssue,
  newIssueUrl,
  type IfcosVerdict,
  type IssueFacts,
} from "../engine/body-mesh";
import type { Finding } from "../engine/types";
import type { IfcosResponse, IfcosStage } from "./ifcos-worker";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";

export type IssueLink =
  | { state: "searching" }
  | { state: "found"; url: string; number: number }
  | { state: "new"; url: string }
  /** The search did not answer (rate limit, offline): the new-issue link is
   *  still offered, marked as not checked against existing issues. */
  | { state: "unchecked"; url: string; message: string };

export interface IfcosRun {
  status: "running" | "done" | "failed";
  stage?: IfcosStage;
  /** The failure, as the stage that failed reported it. */
  error?: string;
  /** The model was restored from the cache: this session never had its
   *  bytes, so there is nothing to hand ifcopenshell. */
  noFile?: boolean;
  version?: string;
  verdicts?: Record<string, IfcosVerdict>;
  issues?: { facts: IssueFacts; link: IssueLink }[];
}

const runs = new Map<string, IfcosRun>();
const listeners = new Set<() => void>();

function set(modelId: string, next: IfcosRun) {
  runs.set(modelId, next);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current run for a model, outside React. */
export function ifcosRunOf(modelId: string): IfcosRun | undefined {
  return runs.get(modelId);
}

export function useIfcosRun(modelId: string): IfcosRun | undefined {
  return useSyncExternalStore(subscribe, () => runs.get(modelId));
}

export function clearIfcosRun(modelId: string) {
  if (runs.delete(modelId)) for (const l of listeners) l();
}

async function lookupIssue(facts: IssueFacts): Promise<IssueLink> {
  const url = newIssueUrl(facts);
  try {
    const response = await fetch(issueSearchUrl(facts.signature), {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return { state: "unchecked", url, message: `GitHub search ${response.status}` };
    const body = (await response.json()) as { items?: { title?: string; html_url?: string; number?: number }[] };
    const hit = matchingIssue(facts.signature, body.items ?? []);
    return hit ? { state: "found", ...hit } : { state: "new", url };
  } catch (err) {
    return { state: "unchecked", url, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Run ifcopenshell on the check's findings. `file` absent = a model restored
 *  from the cache, whose bytes this session never had: the run fails and
 *  says so. */
export function startIfcosRun(modelId: string, file: File | undefined, findings: readonly Finding[]) {
  const current = runs.get(modelId);
  if (current?.status === "running") return;
  if (!file) {
    set(modelId, { status: "failed", noFile: true });
    return;
  }
  const guids = [...new Set(findings.map((f) => f.guid))];
  set(modelId, { status: "running", stage: "pyodide" });
  void (async () => {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (err) {
      set(modelId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const worker = new Worker(new URL("./ifcos-worker.ts", import.meta.url), { type: "module" });
    worker.onerror = (event) => {
      worker.terminate();
      set(modelId, { status: "failed", error: event.message || "worker error" });
    };
    worker.onmessage = (event: MessageEvent<IfcosResponse>) => {
      const message = event.data;
      if (message.kind === "stage") {
        set(modelId, { status: "running", stage: message.stage });
        return;
      }
      worker.terminate();
      if (message.kind === "failed") {
        set(modelId, { status: "failed", stage: message.stage, error: message.message });
        return;
      }
      const facts = issueFacts(findings, message.verdicts, message.version);
      const issues = facts.map((f) => ({ facts: f, link: { state: "searching" } as IssueLink }));
      set(modelId, { status: "done", version: message.version, verdicts: message.verdicts, issues });
      // The search API allows ten unauthenticated queries a minute: one per
      // signature, sequentially.
      void (async () => {
        const done = [...issues];
        for (let i = 0; i < done.length; i += 1) {
          done[i] = { facts: done[i].facts, link: await lookupIssue(done[i].facts) };
          const latest = runs.get(modelId);
          if (!latest || latest.verdicts !== message.verdicts) return;
          set(modelId, { ...latest, issues: [...done] });
        }
      })();
    };
    worker.postMessage({ kind: "verify", bytes, guids }, [bytes]);
  })();
}

export const BODY_NO_MESH_FOCUS = "check:body-no-mesh";

/** One element's verdict, appended to its row's reason. */
export function ifcosVerdictText(verdict: IfcosVerdict | undefined, lang: Lang): string {
  if (!verdict) return "";
  if (verdict.kind === "geometry") {
    return (
      `${t("ifcos.geometry", lang)} · ${formatCount(verdict.vertices, lang)} ${t("ifcos.vertices", lang)} · ` +
      `${formatCount(verdict.faces, lang)} ${t("ifcos.faces", lang)}`
    );
  }
  if (verdict.kind === "none") return t("ifcos.none", lang);
  return `${t("ifcos.error", lang)}: ${verdict.message}`;
}
