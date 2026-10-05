/** The ruleset Oppsett saved («Lagre oppsett»), kept in the browser so it
 *  survives a reload, and put back on load as the board record puts models
 *  back (`model-cache.ts`).
 *
 * localStorage rather than IndexedDB: a ruleset is a few kilobytes, the read
 * is synchronous so the first render already has it, and it is not scoped to
 * the tab session the way the model cache is: a saved setup is the user's,
 * not one tab's. "Last ned" stays the file export.
 *
 * Reading never throws: no storage, a blocked store or a row this build does
 * not read all come back null, as a cache miss does. Writing throws, so a
 * save that did not happen is shown and never mistaken for one that did.
 */

import type { Ruleset } from "../ids/types.ts";

const KEY = "ifc-check.ruleset";
const FORMAT = 1;

export interface SavedRuleset {
  fileName: string;
  ruleset: Ruleset;
}

/** The stored row: the same shape here and in the account's state doc
 *  (`account/hosted-ruleset.ts`). */
export function savedRow(saved: SavedRuleset): { format: number; fileName: string; ruleset: Ruleset } {
  return { format: FORMAT, ...saved };
}

/** A stored row read back; null for anything this build does not read. */
export function parseSavedRow(value: unknown): SavedRuleset | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { format?: number; fileName?: unknown; ruleset?: Ruleset };
  if (row.format !== FORMAT || typeof row.fileName !== "string") return null;
  if (!row.ruleset || typeof row.ruleset !== "object" || !Array.isArray(row.ruleset.rules)) return null;
  return { fileName: row.fileName, ruleset: row.ruleset };
}

export function readSavedRuleset(): SavedRuleset | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    return parseSavedRow(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Null forgets what was saved. */
export function writeSavedRuleset(saved: SavedRuleset | null): void {
  const store = globalThis.localStorage;
  if (!store) throw new Error("localStorage is not available");
  if (saved === null) {
    store.removeItem(KEY);
    return;
  }
  store.setItem(KEY, JSON.stringify(savedRow(saved)));
}

/** Forget, for a ruleset that was removed; a storage fault costs nothing. */
export function forgetSavedRuleset(): void {
  try {
    writeSavedRuleset(null);
  } catch {
    // nothing stored, nothing to forget
  }
}
