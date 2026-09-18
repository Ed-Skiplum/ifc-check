/** Every UI string, in one flat map.
 *
 * Labels and names only. The engine's own `detail` and `reason` lines are data
 * and pass through untranslated — they come from `src/engine` and `src/ids`,
 * which this module does not own.
 */

export type Lang = "nb" | "en";

export const LANGS: readonly Lang[] = ["nb", "en"] as const;

const STRINGS = {
  /* ------------------------------------------------------------- entrance */
  "drop.ifc": { nb: "Slipp IFC-filer her", en: "Drop IFC files here" },
  "drop.ruleset": { nb: "Slipp regelsett", en: "Drop ruleset" },
  "accept.ifc": { nb: "IFC · IFCZIP", en: "IFC · IFCZIP" },
  "accept.ruleset": { nb: "IDS · RULESET.JSON", en: "IDS · RULESET.JSON" },

  /* ------------------------------------------------------------- app bar */
  "action.openIfc": { nb: "Åpne IFC", en: "Open IFC" },
  "action.openRuleset": { nb: "Åpne regelsett", en: "Open ruleset" },
  "action.remove": { nb: "Fjern", en: "Remove" },
  "action.clearAll": { nb: "Tøm alle", en: "Clear all" },
  "label.models": { nb: "Modeller", en: "Models" },
  "label.ruleset": { nb: "Regelsett", en: "Ruleset" },
  "label.rules": { nb: "Regler", en: "Rules" },

  /* ------------------------------------------------------------ file state */
  "file.queued": { nb: "I kø", en: "Queued" },
  "file.parsing": { nb: "Leser", en: "Parsing" },
  "file.ready": { nb: "Klar", en: "Ready" },
  "file.failed": { nb: "Feilet", en: "Failed" },
  "file.rejected": { nb: "Ikke IFC", en: "Not IFC" },

  /* ------------------------------------------------------------------ KPI */
  "kpi.products": { nb: "Produkter", en: "Products" },
  "kpi.storeys": { nb: "Etasjer", en: "Storeys" },
  "kpi.schema": { nb: "Skjema", en: "Schema" },
  "kpi.unit": { nb: "Lengdeenhet", en: "Length unit" },
  "kpi.classes": { nb: "Antall klasser", en: "Distinct classes" },
  "kpi.typed": { nb: "Typet", en: "Typed" },
  "kpi.material": { nb: "Med materiale", en: "With material" },
  "kpi.parseTime": { nb: "Lesetid", en: "Parse time" },
  "kpi.size": { nb: "Filstørrelse", en: "File size" },
  "kpi.application": { nb: "Program", en: "Application" },
  "kpi.project": { nb: "Prosjekt", en: "Project" },
  "kpi.duplicateStepIds": { nb: "Dupliserte STEP-id", en: "Duplicate STEP ids" },
  "kpi.unresolved": { nb: "Uavklart", en: "Unresolved" },

  /* ---------------------------------------------------------------- tiles */
  "tile.classes": { nb: "Klasser", en: "Classes" },
  "tile.storeys": { nb: "Etasjer", en: "Storeys" },
  "tile.floorMatrix": { nb: "Etasjematrise", en: "Floor matrix" },

  /* -------------------------------------------------------------- columns */
  "col.class": { nb: "IFC-klasse", en: "IFC class" },
  "col.count": { nb: "Antall", en: "Count" },
  "col.name": { nb: "Navn", en: "Name" },
  "col.elevation": { nb: "Kote", en: "Elevation" },
  "col.elements": { nb: "Objekter", en: "Elements" },
  "col.guid": { nb: "GlobalId", en: "GlobalId" },
  "col.reason": { nb: "Årsak", en: "Reason" },

  "matrix.noStorey": { nb: "Uten etasje", en: "No storey" },
  "storey.shared": { nb: "Delt kote", en: "Shared elevation" },

  /* --------------------------------------------------------- rule results */
  // Verdict words follow the Skiplum reports vocabulary already in use on
  // delivered dashboards (Bestått / Advarsel / Avvik / N/A) rather than terms
  // invented here.
  "result.pass": { nb: "Bestått", en: "Pass" },
  "result.fail": { nb: "Avvik", en: "Deviation" },
  "result.not_applicable": { nb: "N/A", en: "N/A" },
  "result.not_evaluable": { nb: "Kan ikke vurderes", en: "Not evaluable" },
  "result.pass.sub": { nb: "Kravet er oppfylt", en: "Requirement met" },
  "result.fail.sub": { nb: "Må utbedres", en: "Must be corrected" },
  "result.not_applicable.sub": { nb: "Ikke relevant", en: "Not relevant" },
  "result.not_evaluable.sub": { nb: "Mangler data", en: "Data unavailable" },
  "result.evaluating": { nb: "Vurderer", en: "Evaluating" },

  /* ------------------------------------------------------------- findings */
  "findings.count": { nb: "Funn", en: "Findings" },
  "findings.close": { nb: "Lukk", en: "Close" },

  /* ---------------------------------------------------------- derivation */
  "trace.applicable": { nb: "Aktuelle", en: "Applicable" },
  "trace.failed": { nb: "Avvik", en: "Failed" },
  "trace.passed": { nb: "Bestått", en: "Passed" },
  "trace.elements": { nb: "Objekter", en: "Elements" },
  "trace.shown": { nb: "Vist", en: "Shown" },
  "trace.notes": { nb: "Forbehold", en: "Caveats" },
  "trace.reason": { nb: "Begrunnelse", en: "Reason" },
  "trace.rule": { nb: "Regel", en: "Rule" },

  /* ---------------------------------------------------------------- errors */
  "error.ruleset": { nb: "Regelsettfeil", en: "Ruleset error" },
} as const satisfies Record<string, { nb: string; en: string }>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}

/** Locale for number formatting. Norwegian uses a comma decimal separator. */
export function locale(lang: Lang): string {
  return lang === "nb" ? "nb-NO" : "en-GB";
}
