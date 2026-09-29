/** The tab session the model cache is scoped to.
 *
 * The id lives in `sessionStorage`, so it survives a reload and back or forward
 * in the same tab, and a closed tab ends it. No `sessionStorage` means no id,
 * and the cache then restores nothing.
 *
 * The rules are pure functions here so the selftest can read them without a
 * browser or an IndexedDB.
 */

const SESSION_KEY = "ifc-check.session";

/** How long a record of ANOTHER session is kept after its last use: 2 hours.
 *  Long enough that a second open tab keeps its models while this one starts,
 *  short enough that a closed tab's models go at the next startup that day. */
export const CACHE_SESSION_GRACE_MS = 2 * 60 * 60 * 1000;

let cached: string | null | undefined;

function freshId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** This tab's session id, or null when `sessionStorage` is unavailable. */
export function sessionId(): string | null {
  if (cached !== undefined) return cached;
  let id: string | null = null;
  try {
    const store = globalThis.sessionStorage;
    if (store) {
      id = store.getItem(SESSION_KEY);
      if (!id) {
        id = freshId();
        store.setItem(SESSION_KEY, id);
        // A store that accepts the write and does not keep it is no store.
        if (store.getItem(SESSION_KEY) !== id) id = null;
      }
    }
  } catch {
    id = null;
  }
  cached = id;
  return id;
}

/** A stored row as the session rules see it. */
export interface SessionRow {
  key: string;
  /** The session that wrote or last used the row. Absent on rows written
   *  before sessions existed, which count as another session's. */
  session?: string;
  /** Last write or use, in milliseconds. */
  usedAt: number;
}

/** Offered for restore: only rows of the current session. */
export function offered(row: SessionRow, session: string | null): boolean {
  return session !== null && row.session === session;
}

/**
 * The rows to purge at startup: another session's rows unused for longer than
 * the grace period. The current session's rows stay, and so does anything in
 * `keep` (what this tab's board still points at, even when another tab used it
 * last). Without a session nothing is purged: a tab that cannot tell which rows
 * are its own does not decide for the others.
 */
export function purgeable(
  rows: SessionRow[],
  session: string | null,
  at: number,
  keep: ReadonlySet<string> = new Set(),
  grace: number = CACHE_SESSION_GRACE_MS,
): string[] {
  if (session === null) return [];
  return rows
    .filter((row) => row.session !== session && !keep.has(row.key) && at - row.usedAt > grace)
    .map((row) => row.key);
}
