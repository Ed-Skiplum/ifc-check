/** The Skiplum account platform (konto.skiplum.com), as ifc-check calls it.
 *
 * Built against the platform's app contract
 * (`skiplum/internal/platform/docs/app-contract.md`) and its `src/server/app.ts`:
 *
 *   GET  /api/me             session cookie; 401 = signed out
 *   GET  /api/continue?to=   return-URL sign-in (a navigation, not a fetch)
 *   POST /api/auth/sign-out  Better Auth; Origin must be allowlisted
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
