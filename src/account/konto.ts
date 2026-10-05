/** The Skiplum account platform (konto.skiplum.com), as ifc-check calls it.
 *
 * Built against the platform's app contract
 * (`skiplum/internal/platform/docs/app-contract.md`) and its `src/server/app.ts`:
 *
 *   GET  /api/me             session cookie; 401 = signed out
 *   GET  /api/continue?to=   return-URL sign-in (a navigation, not a fetch)
 *   POST /api/auth/sign-out  Better Auth; Origin must be allowlisted
 *   GET|PUT|DELETE /api/orgs/:org/state[/:tool/:kind/:key]   state docs
 *
 * The session cookie is the platform's own (`__Host-`, HttpOnly): this app
 * never sees, stores or logs it. Every request goes to ONE origin, the
 * configured base, with `credentials: "include"`; nothing else gets
 * credentials. CSRF on the platform is the Origin allowlist plus a JSON
 * content type on writes, both of which a browser `fetch` from an allowlisted
 * origin satisfies; there is no token to carry.
 *
 * Pure: `fetch` is passed in, so the selftest drives it with a stand-in and
 * never calls the real platform.
 */

const PRODUCTION = "https://konto.skiplum.com";

/** `VITE_KONTO_URL` (staging: https://test.konto.skiplum.com), else
 *  production. An origin only: https, or http on localhost. Anything else
 *  is refused, so a typo in the build cannot send cookies elsewhere. */
export function kontoBase(raw: string | undefined): string | null {
  const value = raw?.trim() || PRODUCTION;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface Konto {
  /** The platform's origin, from `kontoBase`. */
  base: string;
  fetch: typeof fetch;
}

/** What /api/me answered. `unavailable`: the platform could not be asked
 *  (network, CORS, a 5xx, a body that is not the contract's), which is not
 *  the same as signed out, and shows nothing. */
export type MeState =
  | { kind: "unavailable" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; user: KontoUser; org: KontoOrg | null };

export interface KontoUser {
  id: string;
  email: string;
  name: string;
}

export interface KontoOrg {
  id: string;
  hostedState: boolean;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The body of /api/me, read as untrusted: only the fields used, only when
 *  they have the contract's types. */
export function readMe(body: unknown): MeState {
  if (!body || typeof body !== "object") return { kind: "unavailable" };
  const { user, orgs } = body as { user?: unknown; orgs?: unknown };
  if (!user || typeof user !== "object") return { kind: "unavailable" };
  const u = user as Record<string, unknown>;
  const id = str(u.id);
  const email = str(u.email);
  if (!id || email === null) return { kind: "unavailable" };
  const rows = Array.isArray(orgs) ? (orgs as Record<string, unknown>[]) : [];
  // One personal org per account (contract: "Accounts and projects").
  const own = rows.find((o) => o && o.role === "owner" && str(o.id)) ?? rows.find((o) => o && str(o.id));
  return {
    kind: "signed-in",
    user: { id, email, name: str(u.name) ?? "" },
    org: own ? { id: own.id as string, hostedState: own.hosted_state === true } : null,
  };
}

export async function me(k: Konto): Promise<MeState> {
  let res: Response;
  try {
    res = await k.fetch(`${k.base}/api/me`, { credentials: "include", headers: { accept: "application/json" } });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 401) return { kind: "signed-out" };
  if (!res.ok) return { kind: "unavailable" };
  try {
    return readMe(await res.json());
  } catch {
    return { kind: "unavailable" };
  }
}

/** Where «Logg inn» goes: the platform's return-URL sign-in, back to `here`
 *  afterwards. The platform answers 400 for an origin not registered for an
 *  active app (`app_origin`). */
export function signInUrl(base: string, here: string): string {
  return `${base}/api/continue?to=${encodeURIComponent(here)}`;
}

/* ── State documents (contract §2) ─────────────────────────────────────────
 *
 * Org-wide only here (no `?project=`): addressed by (tool, kind, key) under
 * /api/orgs/:org/state. Session + CSRF on every route; `data` is stored and
 * returned verbatim. */

export interface StateDoc {
  project: string | null;
  tool: string;
  kind: string;
  key: string;
  data: unknown;
  version: number;
  updatedAt: string;
}

/** A write's answer. `status` 0 = the platform could not be reached;
 *  `error` is the platform's own envelope text (or the fetch's). */
export type PutResult =
  | { ok: true; status: number; doc: StateDoc }
  | { ok: false; status: number; error: string };

function readDoc(value: unknown): StateDoc | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  if (typeof d.key !== "string" || typeof d.version !== "number") return null;
  return {
    project: typeof d.project === "string" ? d.project : null,
    tool: str(d.tool) ?? "",
    kind: str(d.kind) ?? "",
    key: d.key,
    data: d.data,
    version: d.version,
    updatedAt: str(d.updatedAt) ?? "",
  };
}

const seg = encodeURIComponent;
const docPath = (base: string, org: string, tool: string, kind: string, key: string) =>
  `${base}/api/orgs/${seg(org)}/state/${seg(tool)}/${seg(kind)}/${seg(key)}`;

/** The org's documents of one tool and kind; null when it could not ask. */
export async function listState(k: Konto, org: string, tool: string, kind: string): Promise<StateDoc[] | null> {
  try {
    const res = await k.fetch(`${k.base}/api/orgs/${seg(org)}/state?tool=${seg(tool)}&kind=${seg(kind)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return null;
    return body.map(readDoc).filter((d): d is StateDoc => d !== null);
  } catch {
    return null;
  }
}

/** One document; null when there is none (404), "error" when it could not
 *  ask. */
export async function getState(
  k: Konto,
  org: string,
  tool: string,
  kind: string,
  key: string,
): Promise<StateDoc | null | "error"> {
  try {
    const res = await k.fetch(docPath(k.base, org, tool, kind, key), {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) return "error";
    return readDoc(await res.json()) ?? "error";
  } catch {
    return "error";
  }
}

/** PUT with the contract's semantics: no `baseVersion` creates (`ifAbsent`
 *  returns an existing doc unchanged), a `baseVersion` updates only that
 *  version. */
export async function putState(
  k: Konto,
  org: string,
  tool: string,
  kind: string,
  key: string,
  body: { data: unknown; baseVersion?: number; ifAbsent?: boolean },
): Promise<PutResult> {
  let res: Response;
  try {
    res = await k.fetch(docPath(k.base, org, tool, kind, key), {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.ok) {
    const doc = readDoc(json);
    return doc ? { ok: true, status: res.status, doc } : { ok: false, status: res.status, error: "" };
  }
  const error = json && typeof json === "object" ? str((json as { error?: unknown }).error) : null;
  return { ok: false, status: res.status, error: error ?? "" };
}

/** True once the document is gone (204, or 404: already gone). */
export async function deleteState(k: Konto, org: string, tool: string, kind: string, key: string): Promise<PutResult | true> {
  try {
    const res = await k.fetch(docPath(k.base, org, tool, kind, key), { method: "DELETE", credentials: "include" });
    if (res.ok || res.status === 404) return true;
    const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, status: res.status, error: str(json?.error) ?? "" };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** True once the platform ended the session. */
export async function signOut(k: Konto): Promise<boolean> {
  try {
    const res = await k.fetch(`${k.base}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}
