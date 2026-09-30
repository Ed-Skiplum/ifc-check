/** Which classification codes the model carries, per classification system
 *  (2026-09-30, edkjo: *"in the main page I want to know what classification
 *  codes are present, but no need to show anything weighted"*).
 *
 * Read off the file's own `IfcClassificationReference`s (`classificationsJson()`,
 * `profile.classifications`), the table the type page and the object panel
 * read. Presence only: no counts, no weights. A code's name is the bundled
 * list's where the system is one of them (NS 3451, NS 3457-8), else the
 * file's own. `known` says whether a code is in that list; null where the
 * system has no bundled list.
 *
 * Pure: `ids-cli.ts selftest` drives it.
 */

import type { ModelProfile } from "./profile";
import { CODE_LISTS, type CodeList } from "../codelists/index.ts";

/** The bundled list a classification system names, by its system name (the
 *  type page's reading). */
export function codeListFor(system: string | null | undefined): CodeList | null {
  if (!system) return null;
  if (/3451/.test(system)) return CODE_LISTS.ns3451;
  if (/3457/.test(system)) return CODE_LISTS["ns3457-8"];
  return null;
}

export interface PresentCode {
  /** The reference's Identification; "" when it has none. */
  code: string;
  name: string | null;
  /** In the system's bundled list; null where there is none. */
  known: boolean | null;
}

export interface CodeSystem {
  system: string | null;
  codes: PresentCode[];
}

const byCode = (a: string, b: string) => a.localeCompare(b, "nb", { numeric: true });

/** Every system and the codes it carries, sorted by system, then code. Null
 *  when the table was not supplied (absent, not empty). `within`: only the
 *  references on these elements (the cross-filter from another view). */
export function classificationCodes(
  profile: Pick<ModelProfile, "classifications"> | null | undefined,
  within: ReadonlySet<string> | null = null,
): CodeSystem[] | null {
  const table = profile?.classifications;
  if (!table) return null;
  const systems = new Map<string | null, Map<string, PresentCode>>();
  for (const [guid, refs] of table) {
    if (within && !within.has(guid)) continue;
    for (const ref of refs) {
      const system = ref.system ?? null;
      let codes = systems.get(system);
      if (!codes) {
        codes = new Map();
        systems.set(system, codes);
      }
      const code = ref.code ?? "";
      const at = codes.get(code);
      if (at) {
        if (at.name === null && ref.name) at.name = ref.name;
        continue;
      }
      const list = codeListFor(system);
      const listName = list && code ? (list.codes[code] ?? null) : null;
      codes.set(code, { code, name: listName ?? ref.name ?? null, known: list ? listName !== null : null });
    }
  }
  return [...systems.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byCode(a, b)))
    .map(([system, codes]) => ({ system, codes: [...codes.values()].sort((a, b) => byCode(a.code, b.code)) }));
}

/** The elements that carry `code` in `system`; null when the table was not
 *  supplied. */
export function codeGuids(
  profile: Pick<ModelProfile, "classifications"> | null | undefined,
  system: string | null,
  code: string,
): Set<string> | null {
  const table = profile?.classifications;
  if (!table) return null;
  const out = new Set<string>();
  for (const [guid, refs] of table) {
    if (refs.some((r) => (r.system ?? null) === system && (r.code ?? "") === code)) out.add(guid);
  }
  return out;
}
