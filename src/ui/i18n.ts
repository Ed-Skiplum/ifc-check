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
  "drop.ifc": { nb: "Slipp IFC-filen din her", en: "Drop your IFC file here" },
  "drop.ruleset": { nb: "Slipp regelsett", en: "Drop ruleset" },
  "accept.ifc": { nb: "IFC · IFCZIP", en: "IFC · IFCZIP" },
  "accept.ruleset": { nb: "IDS · RULESET.JSON", en: "IDS · RULESET.JSON" },

  /* -------------------------------------------------------------- landing */
  "app.name": { nb: "ifc-check", en: "ifc-check" },
  "label.recent": { nb: "Nylig kontrollert", en: "Recently checked" },
  "col.used": { nb: "Sist brukt", en: "Last used" },
  "action.open": { nb: "Åpne", en: "Open" },
  "recent.gone": { nb: "Ikke lenger i bufferen", en: "No longer in the cache" },

  /* ------------------------------------------------------------- app bar */
  "action.openIfc": { nb: "Åpne IFC", en: "Open IFC" },
  "action.openRuleset": { nb: "Åpne regelsett", en: "Open ruleset" },
  "action.remove": { nb: "Fjern", en: "Remove" },
  "action.derivation": { nb: "Grunnlag", en: "Derivation" },
  "action.clearAll": { nb: "Tøm alle", en: "Clear all" },
  "action.clearCache": { nb: "Tøm buffer", en: "Clear cache" },
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
  "kpi.types": { nb: "Typer", en: "Types" },
  "kpi.untyped": { nb: "Uten type", en: "Untyped" },
  "kpi.materials": { nb: "Materialer", en: "Materials" },
  "kpi.orphans": { nb: "Uten etasje", en: "Orphans" },
  "kpi.placement": { nb: "Plassering", en: "Placement" },

  /* --------------------------------------------------------- verification */
  // The verdict vocabulary is the one on delivered Skiplum dashboards
  // (Bestått / Advarsel / Avvik / N/A), not terms invented here. `warn` is
  // Advarsel: a finding that is real and is not a defect in the file.
  "verdict.pass": { nb: "Bestått", en: "Pass" },
  "verdict.warn": { nb: "Advarsel", en: "Warning" },
  "verdict.fail": { nb: "Avvik", en: "Deviation" },
  "verdict.na": { nb: "N/A", en: "N/A" },

  // One per fundamental. A check's NAME, never a restatement of what it does.
  "check.parse-integrity": { nb: "Innlesing", en: "Parse integrity" },
  "check.spatial-chain": { nb: "Romlig struktur", en: "Spatial structure" },
  "check.storey-containment": { nb: "Objekt i etasje", en: "Element in storey" },
  "check.storey-in-building": { nb: "Etasje i bygning", en: "Storey in building" },
  "check.storey-elevation": { nb: "Etasjekoter", en: "Storey elevations" },
  "check.guid-unique": { nb: "Unik GlobalId", en: "Unique GlobalId" },
  "check.element-named": { nb: "Navn på objekt", en: "Element name" },
  "check.element-typed": { nb: "Typet objekt", en: "Element typed" },
  "check.type-name-placeholder": { nb: "Typenavn", en: "Type name" },
  "check.single-instance-types": { nb: "Type brukt én gang", en: "Single-instance type" },
  "check.element-material": { nb: "Materiale", en: "Material" },
  "check.mesh-placement": { nb: "Plassering", en: "Placement" },

  /* ---------------------------------------------------------------- tiles */
  "tile.verify": { nb: "Verifikasjon", en: "Verification" },
  "tile.spatial": { nb: "Romlig struktur", en: "Spatial structure" },
  "tile.file": { nb: "Fil", en: "File" },
  "tile.classes": { nb: "Klasser", en: "Classes" },
  "tile.storeys": { nb: "Etasjer", en: "Storeys" },
  "tile.floorMatrix": { nb: "Etasjematrise", en: "Floor matrix" },
  "tile.viewer": { nb: "Modell", en: "Model" },

  /* --------------------------------------------------------------- viewer */
  "viewer.loading": { nb: "Leser geometri", en: "Reading geometry" },
  "viewer.fit": { nb: "Tilpass", en: "Fit" },
  "viewer.zoomSelection": { nb: "Zoom til valg", en: "Zoom to selection" },
  // A cap is allowed, a silent cap is not: these two labels carry the numbers.
  "viewer.budget": { nb: "Budsjett", en: "Budget" },
  "viewer.outside": { nb: "Uten geometri", en: "No geometry" },
  // The entry camera frames the bulk; these are drawn but not framed.
  "viewer.framing": { nb: "Utenfor ramme", en: "Outside framing" },
  // Mesh-to-row hover is off above the raycast budget; row-to-mesh still works.
  "viewer.hoverOff": { nb: "Uthev ved peking av", en: "Pointer hover off" },

  /* ------------------------------------------------------------- crossfilter */
  "filter.label": { nb: "Filter", en: "Filter" },
  "filter.mode.filter": { nb: "Vis kun", en: "Isolate" },
  "filter.mode.highlight": { nb: "Uthev", en: "Highlight" },
  "filter.clear": { nb: "Tøm filter", en: "Clear filter" },
  "filter.remove": { nb: "Fjern", en: "Remove" },
  "filter.kind.class": { nb: "Klasse", en: "Class" },
  "filter.kind.cell": { nb: "Celle", en: "Cell" },
  "filter.kind.check": { nb: "Kontroll", en: "Check" },
  "filter.kind.rule": { nb: "Regel", en: "Rule" },
  // Ready for the `type` facet in `cross-filter.ts`: `FilterBar` renders
  // `filter.kind.<chip.kind>`, so the string has to exist before the chip can.
  "filter.kind.type": { nb: "Type", en: "Type" },

  /* -------------------------------------------------------------- columns */
  "col.class": { nb: "IFC-klasse", en: "IFC class" },
  "col.count": { nb: "Antall", en: "Count" },
  "col.name": { nb: "Navn", en: "Name" },
  "col.elevation": { nb: "Kote", en: "Elevation" },
  "col.elements": { nb: "Objekter", en: "Elements" },
  "col.guid": { nb: "GlobalId", en: "GlobalId" },
  "col.reason": { nb: "Årsak", en: "Reason" },
  "col.check": { nb: "Kontroll", en: "Check" },
  "col.verdict": { nb: "Vurdering", en: "Verdict" },
  "col.found": { nb: "Funnet verdi", en: "Found value" },

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

  /* ----------------------------------------------------------- type ledger */
  // Column heads that are IFC ATTRIBUTE NAMES stay verbatim in both languages:
  // `PredefinedType`, `IsExternal`, `FireRating` and `LoadBearing` are what the
  // schema calls them, and a header is a name rather than a translation.
  "tile.types": { nb: "Typer", en: "Types" },
  "col.type": { nb: "Type", en: "Type" },
  "col.instances": { nb: "Forekomster", en: "Instances" },
  "col.geometry": { nb: "Geometri", en: "Geometry" },
  "col.triangles": { nb: "Trekanter", en: "Triangles" },
  "col.materials": { nb: "Materialer", en: "Materials" },
  "col.properties": { nb: "Egenskaper", en: "Properties" },
  "type.untyped": { nb: "Uten type", en: "Untyped" },
  "type.disagree": { nb: "Ulike verdier", en: "Values differ" },
  "type.perType": { nb: "Forekomster per type", en: "Instances per type" },
  "type.median": { nb: "Median", en: "Median" },
  "type.single": { nb: "Én forekomst", en: "One instance" },
  // OUR band, said to be ours. The boundary itself is printed beside it, so the
  // number a reader would want to argue with is on the screen, not in the code.
  "type.threshold": { nb: "Vår terskel", en: "Our threshold" },
  "type.health.sound": { nb: "God", en: "Sound" },
  "type.health.watch": { nb: "Blandet", en: "Mixed" },
  "type.health.weak": { nb: "Svak", en: "Weak" },
  // Not a blank column: the psets ARE parsed and simply have no JS accessor.
  "type.psets": { nb: "Egenskapssett", en: "Property sets" },
  "type.unavailable": { nb: "utilgjengelig", en: "unavailable" },
  "type.facts": { nb: "Typefakta", en: "Type facts" },
  "type.geometryUnread": { nb: "ikke lest", en: "not read" },
  "type.geometryCapped": { nb: "begrenset", en: "capped" },

  /* ------------------------------------------------------------- setup */
  // Mapping headers are the POFIN names (EIR bygg, alfanumerisk informasjon):
  // Systemkode, Prosesstatuskode (MMI), Duplikat objekt, and NS 3457-8
  // komponentklasser. Field labels match the rule builder's (builder/strings.ts).
  "action.setup": { nb: "Oppsett", en: "Setup" },
  "action.download": { nb: "Last ned", en: "Download" },
  "mapping.system-classification": { nb: "Systemkode", en: "System code" },
  "mapping.component-classification": { nb: "Komponentklasse", en: "Component class" },
  "mapping.progress-code": { nb: "Prosesstatuskode (MMI)", en: "Process status code (MMI)" },
  "mapping.copy-object": { nb: "Duplikat objekt", en: "Duplicate object" },
  "field.enabled": { nb: "Aktiv", en: "Enabled" },
  "field.list": { nb: "Kodeliste", en: "Code list" },
  "field.target": { nb: "Gjelder", en: "Applies to" },
  "field.target.occurrence": { nb: "Forekomster", en: "Occurrences" },
  "field.target.type": { nb: "Typer", en: "Types" },
  "field.source": { nb: "Kilde", en: "Source" },
  "field.source.attribute": { nb: "Attributt", en: "Attribute" },
  "field.source.property": { nb: "Egenskap", en: "Property" },
  "field.source.classification": { nb: "Klassifikasjon", en: "Classification" },
  "field.propertySet": { nb: "Egenskapssett", en: "Property set" },
  "field.propertyName": { nb: "Egenskapsnavn", en: "Property name" },
  "field.system": { nb: "System", en: "System" },
  "field.extract": { nb: "Uttrekk (regex)", en: "Extract (regex)" },
  "field.values": { nb: "Tillatte verdier", en: "Allowed values" },
  "field.copyMode": { nb: "Verditype", en: "Value type" },
  "field.copyMode.boolean": { nb: "Ja/Nei", en: "Yes/No" },
  "field.copyMode.codes": { nb: "Fagkoder", en: "Discipline codes" },

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
