/** Renders a Finding's reason code in the active language.
 *
 * The engine emits a code plus parameters rather than a sentence, so the same
 * finding reads Norwegian or English here and stays machine-readable in the
 * JSON an agent consumes. `finding.reason` is the English fallback the engine
 * already rendered — used only if a code arrives that this map has not caught
 * up with, so a new check never renders blank.
 */

import type { Finding, ReasonCode } from "../engine/types";
import type { Lang } from "./i18n";

type Render = (p: Record<string, string | number>) => string;

const REASONS: Record<ReasonCode, Record<Lang, Render>> = {
  "no-products": {
    nb: () =>
      "ingen produkter lest — filen er tom, eller klassene blir ikke gjenkjent " +
      "av parseren (se ifcfast#178)",
    en: () =>
      "no products parsed — the file is empty, or its classes are not " +
      "recognised by the parser (see ifcfast#178)",
  },
  "unit-unresolved": {
    nb: () => "lengdeenheten kunne ikke bestemmes",
    en: () => "length unit could not be resolved",
  },
  "duplicate-step-ids": {
    nb: (p) => `${p.count} dupliserte STEP-id-er`,
    en: (p) => `${p.count} duplicate STEP ids`,
  },
  "parser-warning": {
    nb: (p) => String(p.message),
    en: (p) => String(p.message),
  },
  "not-in-storey": {
    nb: () => "ligger ikke i en etasje",
    en: () => "not contained in a storey",
  },
  "storey-not-in-building": {
    nb: () => "etasjen hører ikke til en bygning",
    en: () => "storey is not aggregated into a building",
  },
  "spatial-level-missing": {
    nb: (p) => `filen har ingen ${p.level}`,
    en: (p) => `no ${p.level} in the file`,
  },
  "shared-elevation": {
    nb: (p) => `koten deles med ${p.count} andre etasjer`,
    en: (p) => `elevation shared with ${p.count} other storeys`,
  },
  "name-empty": {
    nb: () => "Name er tom",
    en: () => "Name is empty",
  },
  "no-type": {
    nb: () => "ingen typeobjekt",
    en: () => "no type object",
  },
  "placeholder-type-name": {
    nb: (p) => `plassholdernavn på type: «${p.typeName}»`,
    en: (p) => `placeholder type name "${p.typeName}"`,
  },
  "single-instance-type": {
    nb: (p) => `typen «${p.typeName}» brukes av ett element`,
    en: (p) => `type "${p.typeName}" is used by one element`,
  },
  "no-material": {
    nb: () => "ingen tilknyttet materiale",
    en: () => "no material associated",
  },
  "guid-duplicate": {
    nb: (p) => `GlobalId deles av ${p.count} elementer`,
    en: (p) => `GlobalId shared by ${p.count} elements`,
  },
};

export function reasonText(finding: Finding, lang: Lang): string {
  const entry = REASONS[finding.code];
  if (!entry) return finding.reason;
  return entry[lang](finding.params ?? {});
}
