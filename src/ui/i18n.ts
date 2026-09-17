/** Every UI string, in one flat map.
 *
 * Labels and names only. The engine's own `detail` and `reason` lines are data
 * and pass through untranslated — they come from `src/engine`, which this
 * module does not own.
 */

export type Lang = "nb" | "en";

export const LANGS: readonly Lang[] = ["nb", "en"] as const;

const STRINGS = {
  "toolbar.open": { nb: "Åpne filer", en: "Open files" },
  "toolbar.accept": { nb: "IFC · IFCZIP", en: "IFC · IFCZIP" },
  "toolbar.models": { nb: "Modeller", en: "Models" },

  "matrix.check": { nb: "Kontroll", en: "Check" },

  "check.parse-integrity": { nb: "Parseintegritet", en: "Parse integrity" },
  "check.storey-containment": { nb: "Etasjetilhørighet", en: "Storey containment" },
  "check.storey-in-building": { nb: "Etasje i bygning", en: "Storey in building" },
  "check.element-named": { nb: "Objektnavn", en: "Element name" },
  "check.element-typed": { nb: "Objekttype", en: "Element type" },
  "check.type-name-placeholder": { nb: "Plassholder-typenavn", en: "Placeholder type name" },
  "check.single-instance-types": { nb: "Typer med én instans", en: "Single-instance types" },
  "check.element-material": { nb: "Objektmateriale", en: "Element material" },
  "check.guid-unique": { nb: "Unik GlobalId", en: "Unique GlobalId" },

  "state.pass": { nb: "Bestått", en: "Pass" },
  "state.fail": { nb: "Feil", en: "Fail" },
  "state.review": { nb: "Vurder", en: "Review" },
  "state.not_applicable": { nb: "Ikke aktuell", en: "Not applicable" },

  "file.queued": { nb: "I kø", en: "Queued" },
  "file.parsing": { nb: "Leser", en: "Parsing" },
  "file.ready": { nb: "Klar", en: "Ready" },
  "file.failed": { nb: "Feilet", en: "Failed" },

  "findings.guid": { nb: "GlobalId", en: "GlobalId" },
  "findings.entity": { nb: "IFC-klasse", en: "IFC class" },
  "findings.name": { nb: "Navn", en: "Name" },
  "findings.reason": { nb: "Årsak", en: "Reason" },
  "findings.count": { nb: "Funn", en: "Findings" },
  "findings.close": { nb: "Lukk", en: "Close" },

  "summary.products": { nb: "produkter", en: "products" },
} as const satisfies Record<string, { nb: string; en: string }>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}

/** Check ids in engine order. Held here so the matrix can show all nine rows
 *  before a single file has been dropped — a row is never hidden. */
export const CHECK_IDS = [
  "parse-integrity",
  "storey-containment",
  "storey-in-building",
  "element-named",
  "element-typed",
  "type-name-placeholder",
  "single-instance-types",
  "element-material",
  "guid-unique",
] as const;

export function checkLabel(id: string, lang: Lang): string {
  const key = `check.${id}` as StringKey;
  return key in STRINGS ? t(key, lang) : id;
}
