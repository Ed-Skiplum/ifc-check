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
  "storey-mismatch": {
    nb: (p) => `bunn geometri ${p.bottom} m, etasje «${p.storey}» på ${p.elevation} m, forventet «${p.expected}»`,
    en: (p) => `mesh bottom ${p.bottom} m, storey "${p.storey}" at ${p.elevation} m, expected "${p.expected}"`,
  },
  "far-from-model": {
    nb: (p) => `geometri ${p.distance} m fra modellens hovedvolum`,
    en: (p) => `mesh ${p.distance} m from the model's main body`,
  },
  "storey-not-in-config": {
    nb: (p) => `«${p.storey}» på ${p.elevation} m finnes ikke i etasjeoppsettet`,
    en: (p) => `"${p.storey}" at ${p.elevation} m is not in the floor config`,
  },
  "storey-name-mismatch": {
    nb: (p) => `navn «${p.storey}», etasjeoppsettet har «${p.config}» på denne koten`,
    en: (p) => `name "${p.storey}", config at this elevation is "${p.config}"`,
  },
  "storey-elevation-mismatch": {
    nb: (p) => `kote ${p.elevation} m, etasjeoppsettet ${p.config} m`,
    en: (p) => `elevation ${p.elevation} m, config ${p.config} m`,
  },
  "storey-name-whitespace": {
    nb: (p) => `navn «${p.storey}» er lik «${p.config}» bare uten mellomrom i endene`,
    en: (p) => `name "${p.storey}" matches "${p.config}" only after trimming whitespace`,
  },
  "storey-duplicate-match": {
    nb: (p) => `andre etasje som treffer «${p.config}» i etasjeoppsettet`,
    en: (p) => `second storey matching config floor "${p.config}"`,
  },
  "storey-count-exceeds": {
    nb: (p) => `${p.count} etasjer, etasjeoppsettet har ${p.config}`,
    en: (p) => `${p.count} storeys, config has ${p.config}`,
  },
};

export function reasonText(finding: Finding, lang: Lang): string {
  const entry = REASONS[finding.code];
  if (!entry) return finding.reason;
  return entry[lang](finding.params ?? {});
}
