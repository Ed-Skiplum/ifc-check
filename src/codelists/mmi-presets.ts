/** Code-list presets for the progress-code (MMI) rule's `codes`. Optional: a
 *  new progress-code rule starts with no codes, which checks the format alone
 *  (edkjo 2026-10-01: "our default is 0 or nnn"). Copied, never invented.
 *
 * Sources:
 *   standard   MMI-veileder 2.0, Tabell 1 «Grunnleggende MMI-nivåer»
 *              (C:\workspace\resources\standards\mmi\MMI-veileder-2.0.txt).
 *              Every defined level; the «Reservert» codes left out; names
 *              verbatim, footnote asterisks dropped (375 carries ***).
 *   forenklet  edkjo, 2026-10-01: codes 100, 200, 300, 350, 400, 500, 600.
 *              Names are the veileder's, except 350, which is edkjo's own
 *              wording and deliberately differs from the veileder.
 *   gjenbruk   edkjo, 2026-10-01: "our version with 0-600 as new, and
 *              7xx,8xx,9xx as phase indicators". 000-600 are the standard's,
 *              phase «Ny». 700 and 900 names from
 *              skiplum/internal/bep/underprosjekter/arkiv/dev/mmi-referanse.md.
 *              7xx-9xx are not subdivided yet (explicitly not wanted).
 */

import type { CodeEntry } from "../ids/types.ts";

export type MmiPresetId = "standard" | "forenklet" | "gjenbruk";

export interface MmiPreset {
  id: MmiPresetId;
  /** A proper name: the same in nb and en. */
  name: string;
  codes: readonly CodeEntry[];
}

/** MMI-veileder 2.0, Tabell 1, without the «Reservert» codes. */
const STANDARD: readonly CodeEntry[] = [
  { code: "000", name: "Tidligfase" },
  { code: "100", name: "Grunnlagsinformasjon" },
  { code: "125", name: "Etablert konsept" },
  { code: "150", name: "Tverrfaglig kontrollert konsept" },
  { code: "175", name: "Valgt konsept" },
  { code: "200", name: "Ferdig konsept" },
  { code: "225", name: "Etablert prinsipielle løsninger" },
  { code: "250", name: "Tverrfaglig kontrollert prinsipielle løsninger" },
  { code: "275", name: "Valgt prinsipielle løsninger" },
  { code: "300", name: "Underlag for detaljering" },
  { code: "325", name: "Etablert detaljerte løsninger" },
  { code: "350", name: "Tverrfaglig kontrollert detaljerte løsninger" },
  { code: "375", name: "Detaljerte løsninger som grunnlag for anbud / bestilling / prefabrikasjon" },
  { code: "400", name: "Arbeidsgrunnlag" },
  { code: "425", name: "Etablert / utført" },
  { code: "450", name: "Kontrollert utførelse" },
  { code: "475", name: "Godkjent utførelse" },
  { code: "500", name: "Som bygget" },
  { code: "600", name: "I drift" },
];

const standardName = (code: string): string => {
  const entry = STANDARD.find((c) => c.code === code);
  if (!entry) throw new Error(`MMI ${code} is not in the standard`);
  return entry.name;
};

/** edkjo's simplified set: the veileder's names, 350 his own. */
const FORENKLET: readonly CodeEntry[] = [
  { code: "100", name: standardName("100") },
  { code: "200", name: standardName("200") },
  { code: "300", name: standardName("300") },
  { code: "350", name: "Klar for siste kontroll før arbeidstegning" },
  { code: "400", name: standardName("400") },
  { code: "500", name: standardName("500") },
  { code: "600", name: standardName("600") },
];

/** The standard as new, then 7xx-9xx as the phase. */
const GJENBRUK: readonly CodeEntry[] = [
  ...STANDARD.map((c) => ({ ...c, phase: "Ny" })),
  { code: "700", name: "Bevares", phase: "Bevares" },
  // [WRITE] 800 name and phase: edkjo
  { code: "800", name: "MMI 800", phase: "MMI 800" },
  { code: "900", name: "Gjenvinning/avfall", phase: "Gjenvinning/avfall" },
];

export const MMI_PRESETS: readonly MmiPreset[] = [
  { id: "standard", name: "Standard MMI-veileder 2.0", codes: STANDARD },
  { id: "forenklet", name: "Forenklet MMI-veileder 2.0", codes: FORENKLET },
  { id: "gjenbruk", name: "MMI for gjenbruk", codes: GJENBRUK },
];

/** A fresh copy of a preset's codes, for a rule to own. */
export function presetCodes(id: MmiPresetId): CodeEntry[] {
  const preset = MMI_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown MMI preset "${id}"`);
  return preset.codes.map((c) => ({ ...c }));
}

const sameEntry = (a: CodeEntry, b: CodeEntry): boolean =>
  a.code === b.code && a.name === b.name && (a.phase ?? "") === (b.phase ?? "");

/** The preset `codes` equals (same entries, any order), or null. */
export function matchingPreset(codes: readonly CodeEntry[]): MmiPresetId | null {
  for (const preset of MMI_PRESETS) {
    if (preset.codes.length !== codes.length) continue;
    if (preset.codes.every((p) => codes.some((c) => sameEntry(p, c)))) return preset.id;
  }
  return null;
}
