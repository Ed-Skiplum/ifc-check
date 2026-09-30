/** The second check, per model: ifcopenshell on every element ifcfast
 * streamed no mesh for (edkjo 2026-09-30: *"i dont trust ifcfast on that
 * yet, so just add the second check"*).
 *
 * Automatic: `useModels` hands each model's unmeshed GUIDs here once its
 * checks are on screen (`verifyNomesh`). Runs are queued and go one at a
 * time, since Pyodide plus an opened model is a couple of GB; the file is
 * read again from the `File` the user dropped and handed to
 * `ifcos-worker.ts`, which answers in batches. A model restored from the
 * cache after a reload has no file this session: that is `unavailable`, said
 * as such, never a pass. The settled state goes back to the model worker
 * (`NomeshVerification`), which re-runs the checks with it.
 *
 * Where ifcopenshell found geometry ifcfast did not, one ifcfast issue per
 * signature, filed automatically through the relay (`relay/relay.mjs`),
 * once per signature per session. The relay records every report; when it
 * does not file it now (no token there, GitHub failing) it answers 202
 * `logged` and the chip reads «Logget», or the issue number once the
 * relay's listing has one. The relay unreachable or refusing: the
 * unauthenticated GitHub search and the prefilled new-issue link the user
 * opens, as before, marked as a failed filing; when unreachable, the report
 * is also kept in localStorage and sent again on the next load.
 *
 * Held outside React state (a store with `useSyncExternalStore`), so the
 * model list does not re-render for a run's stage changes.
 */

import { useSyncExternalStore } from "react";
import {
  issueSearchUrl,
  matchingIssue,
  newIssueUrl,
  type IfcosVerdict,
  type IssueFacts,
  type NomeshVerification,
} from "../engine/body-mesh";
import type { IfcosResponse, IfcosStage } from "./ifcos-worker";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";

/** The relay that files ifcfast issues (`relay/DEPLOY.md`). Overridable at
 *  build time, for a local relay run against a mock GitHub. */
export const RELAY_URL: string =
  (import.meta.env.VITE_IFCFAST_RELAY as string | undefined) ?? "https://ifc-check.skiplum.com/relay/ifcfast-miss";

export type IssueLink =
  | { state: "posting" }
  /** The relay filed it: a new issue, a comment on the open one, or nothing
   *  (the open one was commented on less than a day ago). */
  | { state: "filed"; url: string; number: number; action: "created" | "commented" | "skipped" }
  /** The relay recorded it and did not file it now (no token there, or
   *  GitHub failed): filed later from its database. The issue, when the
   *  signature already has one. */
  | { state: "logged"; number?: number; url?: string }
  | { state: "searching"; relayError: string }
  | { state: "found"; url: string; number: number; relayError: string }
  | { state: "new"; url: string; relayError: string }
  /** The search did not answer either (rate limit, offline): the new-issue
   *  link is still offered, marked as not checked against existing issues. */
  | { state: "unchecked"; url: string; message: string; relayError: string };

/** What `useModels` knows about a model's unmeshed elements when its checks
 *  land: their GUIDs, or why there is no list (mesh pass failed, capped
 *  cache, ifczip). */
export type NomeshInput = { guids: string[] } | { unavailable: string };

export interface IfcosRun {
  status: "queued" | "running" | "done" | "failed" | "unavailable";
  stage?: IfcosStage;
  /** Elements answered so far, of those asked. */
  progress?: { done: number; total: number };
  /** The failure, as the stage that failed reported it. */
  error?: string;
  /** `unavailable`: why (`no-file`, `ifczip`, or the mesh pass's reason). */
  why?: string;
  version?: string;
  /** Per element, filled batch by batch while running. */
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

export function useIfcosRun(modelId: string | undefined): IfcosRun | undefined {
  return useSyncExternalStore(subscribe, () => (modelId === undefined ? undefined : runs.get(modelId)));
}

/** The run as the checks read it. */
export function verificationOf(run: IfcosRun | undefined): NomeshVerification {
  if (!run) return { state: "pending" };
  if (run.status === "done") return { state: "done", version: run.version ?? "", verdicts: run.verdicts ?? {} };
  if (run.status === "failed") return { state: "failed", stage: run.stage ?? "pyodide", message: run.error ?? "" };
  if (run.status === "unavailable") return { state: "unavailable", why: run.why ?? "" };
  return { state: "pending" };
}

/* ── the queue: one ifcopenshell at a time ──────────────────────────────── */

interface Job {
  modelId: string;
  file: File;
  guids: string[];
  settled: (verification: NomeshVerification) => void;
}

const queue: Job[] = [];
let active: { modelId: string; worker: Worker | null } | null = null;

export function clearIfcosRun(modelId: string) {
  const at = queue.findIndex((j) => j.modelId === modelId);
  if (at >= 0) queue.splice(at, 1);
  if (active?.modelId === modelId) {
    active.worker?.terminate();
    active = null;
    pump();
  }
  inputs.delete(modelId);
  generations.delete(modelId);
  if (runs.delete(modelId)) for (const l of listeners) l();
}

function pump() {
  if (active || queue.length === 0) return;
  const job = queue.shift()!;
  active = { modelId: job.modelId, worker: null };
  void run(job);
}

function finish(job: Job, next: IfcosRun) {
  if (active?.modelId !== job.modelId) return;
  active.worker?.terminate();
  active = null;
  set(job.modelId, next);
  job.settled(verificationOf(next));
  pump();
}

async function run(job: Job) {
  const { modelId } = job;
  set(modelId, { status: "running", stage: "pyodide", progress: { done: 0, total: job.guids.length }, verdicts: {} });
  let bytes: ArrayBuffer;
  try {
    bytes = await job.file.arrayBuffer();
  } catch (err) {
    finish(job, { status: "failed", stage: "open", error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (active?.modelId !== modelId) return;
  const worker = new Worker(new URL("./ifcos-worker.ts", import.meta.url), { type: "module" });
  active.worker = worker;
  worker.onerror = (event) => {
    const current = runs.get(modelId);
    finish(job, { status: "failed", stage: current?.stage ?? "pyodide", error: event.message || "worker error" });
  };
  worker.onmessage = (event: MessageEvent<IfcosResponse>) => {
    const message = event.data;
    const current = runs.get(modelId);
    if (!current || active?.modelId !== modelId) return;
    if (message.kind === "stage") {
      set(modelId, { ...current, stage: message.stage });
    } else if (message.kind === "batch") {
      set(modelId, {
        ...current,
        progress: { done: message.done, total: message.total },
        verdicts: { ...current.verdicts, ...message.verdicts },
      });
    } else if (message.kind === "failed") {
      finish(job, { status: "failed", stage: message.stage, error: message.message });
    } else {
      finish(job, { status: "done", version: message.version, verdicts: current.verdicts ?? {}, progress: current.progress });
    }
  };
  worker.postMessage({ kind: "verify", bytes, guids: job.guids }, [bytes]);
}

/**
 * Start the second check for a model. `settled` receives the verification
 * once it is final (done, failed, unavailable), to hand to the model worker.
 * `file` absent = a model restored from the cache after a reload.
 */
export function verifyNomesh(
  modelId: string,
  file: File | undefined,
  input: NomeshInput,
  settled: (verification: NomeshVerification) => void,
) {
  inputs.set(modelId, { file, input, settled });
  const current = runs.get(modelId);
  if (current && current.status !== "failed" && current.status !== "unavailable") return;
  const unavailable = (why: string) => {
    const next: IfcosRun = { status: "unavailable", why };
    set(modelId, next);
    settled(verificationOf(next));
  };
  if ("unavailable" in input) return unavailable(input.unavailable);
  if (input.guids.length === 0) {
    // Nothing without a mesh: nothing for ifcopenshell to confirm.
    const next: IfcosRun = { status: "done", verdicts: {}, progress: { done: 0, total: 0 } };
    set(modelId, next);
    settled(verificationOf(next));
    return;
  }
  if (!file) return unavailable("no-file");
  set(modelId, { status: "queued", progress: { done: 0, total: input.guids.length } });
  queue.push({ modelId, file, guids: input.guids, settled });
  pump();
}

/** What each model was started with, so a failed run can be run again. */
const inputs = new Map<
  string,
  { file: File | undefined; input: NomeshInput; settled: (verification: NomeshVerification) => void }
>();

/** Run a failed second check again (the control in the derivation band). */
export function retryNomesh(modelId: string) {
  const held = inputs.get(modelId);
  const current = runs.get(modelId);
  if (!held || current?.status !== "failed") return;
  verifyNomesh(modelId, held.file, held.input, held.settled);
}

/* ── filing ─────────────────────────────────────────────────────────────── */

/** Signature -> the filing started for it this session: once per signature,
 *  whichever model found it first. */
const filed = new Map<string, Promise<IssueLink>>();
/** The latest `fileIssues` per model: an older one stops writing. */
const generations = new Map<string, number>();

async function lookupIssue(facts: IssueFacts, relayError: string): Promise<IssueLink> {
  const url = newIssueUrl(facts);
  try {
    const response = await fetch(issueSearchUrl(facts.signature), {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return { state: "unchecked", url, message: `GitHub search ${response.status}`, relayError };
    const body = (await response.json()) as { items?: { title?: string; html_url?: string; number?: number }[] };
    const hit = matchingIssue(facts.signature, body.items ?? []);
    return hit ? { state: "found", ...hit, relayError } : { state: "new", url, relayError };
  } catch (err) {
    return { state: "unchecked", url, message: err instanceof Error ? err.message : String(err), relayError };
  }
}

type Posted = { link: IssueLink } | { relayError: string; retry: boolean };

/** POST the facts (nothing else: `IssueFacts` has no field for client data)
 *  to the relay. `retry`: the relay did not get it (unreachable, down behind
 *  the proxy, rate limited), so it is worth sending again later. */
async function post(facts: IssueFacts): Promise<Posted> {
  try {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facts),
    });
    const body = (await response.json().catch(() => ({}))) as {
      action?: string;
      url?: string;
      number?: number;
      error?: string;
    };
    if (
      response.status === 200 &&
      (body.action === "created" || body.action === "commented" || body.action === "skipped") &&
      typeof body.url === "string" &&
      typeof body.number === "number"
    ) {
      return { link: { state: "filed", url: body.url, number: body.number, action: body.action } };
    }
    if (response.status === 202 && body.action === "logged") {
      const issue = typeof body.number === "number" && typeof body.url === "string" ? { number: body.number, url: body.url } : {};
      return { link: { state: "logged", ...issue } };
    }
    return {
      relayError: `relay ${response.status}${body.error ? `: ${body.error}` : ""}`,
      retry: response.status === 429 || response.status >= 500,
    };
  } catch (err) {
    return { relayError: `relay unreachable: ${err instanceof Error ? err.message : String(err)}`, retry: true };
  }
}

/** To the relay; when it did not get the report, kept for the next load,
 *  and meanwhile the search and the prefilled link. */
async function file(facts: IssueFacts): Promise<IssueLink> {
  const posted = await post(facts);
  if ("link" in posted) return posted.link;
  if (posted.retry) enqueue(facts);
  return lookupIssue(facts, posted.relayError);
}

/* ── reports the relay did not get: kept per viewer, sent on the next load ── */

const QUEUE_KEY = "ifc-check.ifcfast-miss.queue";
const QUEUE_MAX = 50;

function readQueue(): IssueFacts[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((f): f is IssueFacts => typeof f === "object" && f !== null && typeof (f as IssueFacts).signature === "string")
      : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: IssueFacts[]) {
  try {
    if (queue.length) window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_MAX)));
    else window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Storage blocked or full: the report is not kept; the link still is.
  }
}

/** One entry per signature, the latest report. */
function enqueue(facts: IssueFacts) {
  writeQueue([...readQueue().filter((f) => f.signature !== facts.signature), facts]);
}

/** Send what an earlier session could not; what still does not reach the
 *  relay stays for the next load. Then the listing, fresh. */
async function flushQueue() {
  const queue = readQueue();
  if (queue.length === 0) return;
  const kept: IssueFacts[] = [];
  for (const facts of queue) {
    const posted = await post(facts);
    if (!("link" in posted) && posted.retry) kept.push(facts);
  }
  // A report queued during the flush is not dropped.
  const added = readQueue().filter((f) => !queue.some((q) => q.signature === f.signature));
  writeQueue([...kept, ...added]);
  if (kept.length < queue.length) void loadListing(true);
}

/* ── what the relay has recorded (GET), by signature ─────────────────────── */

export interface RelayEntry {
  signature: string;
  reports: number;
  status: "pending" | "filed" | "skipped" | "failed";
  issueNumber: number | null;
  issueUrl: string | null;
}

let listing: ReadonlyMap<string, RelayEntry> | null = null;
let listingLoaded = false;
const listingListeners = new Set<() => void>();

async function loadListing(force = false) {
  if (listingLoaded && !force) return;
  listingLoaded = true;
  try {
    const response = await fetch(RELAY_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const body = (await response.json()) as { misses?: RelayEntry[] };
    if (!Array.isArray(body.misses)) return;
    listing = new Map(body.misses.filter((m) => typeof m?.signature === "string").map((m) => [m.signature, m]));
    for (const l of listingListeners) l();
  } catch {
    // Unreachable: the chips keep what the POST said.
  }
}

function subscribeListing(listener: () => void) {
  listingListeners.add(listener);
  void loadListing();
  return () => listingListeners.delete(listener);
}

/** The relay's record of a signature, once the listing has answered. */
export function useRelayEntry(signature: string): RelayEntry | undefined {
  return useSyncExternalStore(subscribeListing, () => listing?.get(signature));
}

// The next load after a report could not be sent: send it.
if (typeof window !== "undefined") window.setTimeout(() => void flushQueue(), 3000);

/** File the ifcfast misses the model worker grouped (`issueFacts`), one
 *  signature at a time. */
export function fileIssues(modelId: string, facts: readonly IssueFacts[]) {
  const current = runs.get(modelId);
  if (!current || facts.length === 0) return;
  const issues = facts.map((f) => ({ facts: f, link: { state: "posting" } as IssueLink }));
  const generation = (generations.get(modelId) ?? 0) + 1;
  generations.set(modelId, generation);
  set(modelId, { ...current, issues });
  void (async () => {
    const done = [...issues];
    for (let i = 0; i < done.length; i += 1) {
      const signature = done[i].facts.signature;
      let pending = filed.get(signature);
      if (!pending) {
        pending = file(done[i].facts);
        filed.set(signature, pending);
      }
      done[i] = { facts: done[i].facts, link: await pending };
      const latest = runs.get(modelId);
      if (!latest || generations.get(modelId) !== generation) return;
      set(modelId, { ...latest, issues: [...done] });
    }
  })();
}

export const BODY_NO_MESH_FOCUS = "check:body-no-mesh";

/** One element's verdict, appended to its row's reason; «ikke verifisert»
 *  until ifcopenshell has answered for it, or the run's failure. */
export function ifcosVerdictText(run: IfcosRun | undefined, guid: string, lang: Lang): string {
  const verdict = run?.verdicts?.[guid];
  if (!verdict) {
    if (run?.status === "failed") return t("ifcos.failed", lang);
    return t("nomesh.unverified", lang);
  }
  if (verdict.kind === "geometry") {
    return (
      `${t("ifcos.geometry", lang)} · ${formatCount(verdict.vertices, lang)} ${t("ifcos.vertices", lang)} · ` +
      `${formatCount(verdict.faces, lang)} ${t("ifcos.faces", lang)}`
    );
  }
  if (verdict.kind === "none") return t("ifcos.none", lang);
  return `${t("ifcos.error", lang)}: ${verdict.message}`;
}
