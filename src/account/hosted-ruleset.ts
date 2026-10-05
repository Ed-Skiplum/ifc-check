/** The saved ruleset («Lagre oppsett») following the account.
 *
 * Only when signed in AND the org's plan has hosted state; otherwise the
 * caller never gets here and the browser copy (`storage/saved-ruleset.ts`)
 * is all there is, as before.
 *
 * Address: tool `ifc-check` (the registered app id), kind `ruleset`, key =
 * the saved file name (the name the app already shows for the ruleset),
 * org-wide (no project). Several configs can therefore sit side by side in
 * one account; with several, the most recently updated one is the one
 * loaded. There is no chooser.
 *
 * `data` is the browser copy's own row (`savedRow`): the ruleset JSON and
 * its file name. Never a model, never a result.
 *
 * Pure: the `Konto` carries `fetch`, so the selftest drives this against an
 * in-memory stand-in of the platform.
 */

import { deleteState, getState, listState, putState, type Konto, type PutResult, type StateDoc } from "./konto.ts";
import { parseSavedRow, savedRow, type SavedRuleset } from "../storage/saved-ruleset.ts";

export const TOOL = "ifc-check";
export const KIND = "ruleset";
/** The platform's `MAX_STATE_DOC_BYTES` (1 MB, `plans.ts`). */
export const MAX_DOC_BYTES = 1024 * 1024;

/** The document key of a saved ruleset: its file name, else `default`.
 *  The platform takes any 1–200 character string. */
export function rulesetKey(saved: SavedRuleset): string {
  return saved.fileName.trim().slice(0, 200) || "default";
}

/** Versions known per key, from the last listing and every write since: a
 *  save sends the one it knows as `baseVersion`. */
export type Versions = Map<string, number>;

export type SignInSync =
  /** The account's ruleset, to put on screen (when nothing was touched). */
  | { kind: "remote"; saved: SavedRuleset; key: string; versions: Versions }
  /** The account has none, and there was nothing local to adopt. */
  | { kind: "none"; versions: Versions }
  /** The platform refused or could not be asked: the browser copy stands. */
  | { kind: "local-only"; reason: string };

export type SaveResult = { kind: "saved"; key: string; version: number } | { kind: "local-only"; reason: string };

function refusal(r: PutResult & { ok: false }): string {
  return `${r.status} ${r.error}`.trim();
}

function newest(docs: { doc: StateDoc; saved: SavedRuleset }[]) {
  return docs.reduce((a, b) => (Date.parse(b.doc.updatedAt) > Date.parse(a.doc.updatedAt) ? b : a));
}

/** On sign-in: the browser copy, if any, is offered with `ifAbsent` (what
 *  the account already has under its key wins and is not overwritten), then
 *  the account's most recently updated ruleset is the one to load. On a cold
 *  device (nothing local) that is simply the account's newest. */
export async function syncOnSignIn(k: Konto, org: string, local: SavedRuleset | null): Promise<SignInSync> {
  if (local) {
    const data = savedRow(local);
    if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_DOC_BYTES) {
      return { kind: "local-only", reason: "413 document too large" };
    }
    const adopted = await putState(k, org, TOOL, KIND, rulesetKey(local), { data, ifAbsent: true });
    if (!adopted.ok) return { kind: "local-only", reason: refusal(adopted) };
  }
  const docs = await listState(k, org, TOOL, KIND);
  if (docs === null) return { kind: "local-only", reason: "" };
  const versions: Versions = new Map();
  const readable: { doc: StateDoc; saved: SavedRuleset }[] = [];
  for (const doc of docs) {
    if (doc.project !== null) continue;
    versions.set(doc.key, doc.version);
    const saved = parseSavedRow(doc.data);
    if (saved) readable.push({ doc, saved });
  }
  if (readable.length === 0) return { kind: "none", versions };
  const pick = newest(readable);
  return { kind: "remote", saved: pick.saved, key: pick.doc.key, versions };
}

/** «Lagre oppsett» while signed in, after the browser copy is written. The
 *  known version updates; a create where one exists, or an update on a
 *  version someone else has moved on (409), re-reads the document and writes
 *  the user's edit over it: the edit on screen is the working copy, and the
 *  save was asked for. Two re-reads at most; any other answer is "saved
 *  locally only", with the platform's status and error as the reason. */
export async function saveToAccount(
  k: Konto,
  org: string,
  saved: SavedRuleset,
  versions: ReadonlyMap<string, number>,
): Promise<SaveResult> {
  const key = rulesetKey(saved);
  const data = savedRow(saved);
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_DOC_BYTES) {
    return { kind: "local-only", reason: "413 document too large" };
  }
  let base = versions.get(key);
  let last: PutResult & { ok: false } = { ok: false, status: 0, error: "" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await putState(k, org, TOOL, KIND, key, base === undefined ? { data } : { data, baseVersion: base });
    if (r.ok) return { kind: "saved", key, version: r.doc.version };
    last = r;
    // 409: written (or created) elsewhere since. 404 on an update: removed
    // elsewhere since. Either way, read what is there now and go again.
    if (r.status !== 409 && !(r.status === 404 && base !== undefined)) break;
    const now = await getState(k, org, TOOL, KIND, key);
    if (now === "error") break;
    base = now?.version;
  }
  return { kind: "local-only", reason: refusal(last) };
}

/** «Fjern» while signed in: the account's copy goes too, as the browser's
 *  does, so the removed ruleset does not come back on the next load. Null
 *  once gone. */
export async function removeFromAccount(k: Konto, org: string, key: string): Promise<string | null> {
  const r = await deleteState(k, org, TOOL, KIND, key);
  return r === true ? null : refusal(r as PutResult & { ok: false });
}
