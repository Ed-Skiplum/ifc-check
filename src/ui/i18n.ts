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
  "kpi.types": { nb: "Typer brukt", en: "Types used" },
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
  "check.type-unused": { nb: "Ubrukt type", en: "Unused type" },
  "check.element-material": { nb: "Materiale", en: "Material" },
  "check.mesh-placement": { nb: "Plassering", en: "Placement" },
  "check.storey-config": { nb: "Etasjeoppsett", en: "Storey setup" },

  /* ---------------------------------------------------------------- tiles */
  "tile.verify": { nb: "Verifikasjon", en: "Verification" },
  "tile.spatial": { nb: "Romlig struktur", en: "Spatial structure" },
  "tile.file": { nb: "Fil", en: "File" },
  "tile.classes": { nb: "Klasser", en: "Classes" },
  "tile.storeys": { nb: "Etasjer", en: "Storeys" },
  "tile.census": { nb: "Etasje × klasse", en: "Storey × class" },
  "tile.viewer": { nb: "Modell", en: "Model" },
  // The docked panels named in a tab (the narrow board): the owner's own
  // words for them, 2026-09-25.
  "tile.scope": { nb: "Scope", en: "Scope" },
  "tile.detail": { nb: "Detail", en: "Detail" },

  /* ----------------------------------------------------------------- tabs */
  "tab.checks": { nb: "Oversikt", en: "Overview" },
  "tab.contents": { nb: "Innhold", en: "Contents" },

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
  // The HUD chips' short forms; the full label above is the chip's title.
  "viewer.framingShort": { nb: "utenfor", en: "outside" },
  "viewer.hoverOffShort": { nb: "peking av", en: "hover off" },

  /* ------------------------------------------------------------- crossfilter */
  "filter.label": { nb: "Filter", en: "Filter" },
  "filter.mode.filter": { nb: "Vis kun", en: "Isolate" },
  "filter.mode.highlight": { nb: "Uthev", en: "Highlight" },
  "filter.clear": { nb: "Tøm filter", en: "Clear filter" },
  "filter.remove": { nb: "Fjern", en: "Remove" },
  // The KPI cards under a filter from another view: their figures stay the
  // whole model's (a requirement's base is not known per element).
  "filter.wholeModel": { nb: "Hele modellen", en: "Whole model" },
  "filter.kind.class": { nb: "Klasse", en: "Class" },
  "filter.kind.cell": { nb: "Celle", en: "Cell" },
  "filter.kind.check": { nb: "Kontroll", en: "Check" },
  "filter.kind.rule": { nb: "Regel", en: "Rule" },
  // Ready for the `type` facet in `cross-filter.ts`: `FilterBar` renders
  // `filter.kind.<chip.kind>`, so the string has to exist before the chip can.
  "filter.kind.type": { nb: "Type", en: "Type" },
  "filter.kind.storey": { nb: "Etasje", en: "Storey" },
  "filter.kind.element": { nb: "Element", en: "Element" },
  "filter.kind.material": { nb: "Materialer", en: "Materials" },
  "filter.kind.tree": { nb: "Klassifikasjon", en: "Classification" },
  "filter.kind.ids": { nb: "IDS", en: "IDS" },

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

  "col.storey": { nb: "Etasje", en: "Storey" },
  // IFC ATTRIBUTE NAMES stay verbatim in both languages, as in the type
  // ledger's column heads: a header is a name, not a translation.
  "col.objectType": { nb: "ObjectType", en: "ObjectType" },
  "col.tag": { nb: "Tag", en: "Tag" },
  "col.predefinedType": { nb: "PredefinedType", en: "PredefinedType" },

  /* --------------------------------------------------------- object panel */
  "tile.object": { nb: "Objekt", en: "Object" },
  "object.attributes": { nb: "Attributter", en: "Attributes" },
  // The object panel's groups. Plain domain label first, the IFC term beside it
  // as a dim token (rendered by the panel, not baked into these strings): the
  // pairing is what teaches the standard over a hundred selections.
  "object.relations": { nb: "Relasjoner", en: "Relationships" },
  "object.data": { nb: "Egenskaper", en: "Properties" },
  "object.derived": { nb: "Beregnet", en: "Derived" },
  "object.profile": { nb: "Profil", en: "Profile" },
  "object.typeObject": { nb: "Typeobjekt", en: "Type object" },
  "object.partOf": { nb: "Del av", en: "Part of" },
  "object.composedOf": { nb: "Består av", en: "Composed of" },
  "object.opening": { nb: "Åpning", en: "Opening" },
  "object.openings": { nb: "Åpninger", en: "Openings" },
  "object.building": { nb: "Bygning", en: "Building" },
  "object.site": { nb: "Tomt", en: "Site" },
  "object.siblings": { nb: "Søsken", en: "Siblings" },
  "object.standardSets": { nb: "Standard", en: "Standard" },
  "object.customSets": { nb: "Prosjekt", en: "Project" },
  "object.dimensions": { nb: "Dimensjoner", en: "Dimensions" },
  "object.centre": { nb: "Senter", en: "Centre" },
  "object.min": { nb: "Min", en: "Min" },
  "object.max": { nb: "Maks", en: "Max" },
  "object.bottom": { nb: "Laveste punkt", en: "Lowest point" },
  "object.storeyByMesh": { nb: "Etasje etter geometri", en: "Storey by geometry" },
  "object.overStorey": { nb: "Over etasjekote", en: "Above storey elevation" },
  "object.fromBody": { nb: "Fra hovedmassen", en: "From the main body" },
  "object.cutoff": { nb: "Grense", en: "Cutoff" },
  "object.room": { nb: "Rom", en: "Room" },
  "object.notComputed": { nb: "ikke beregnet", en: "not computed" },
  "object.noGeometry": { nb: "ingen geometri", en: "no geometry" },

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
  // The Typer instance mode, labels verbatim from the G55 QTO-LCA type viewer
  // (`10027…/G55_QTO-LCA/02_arbeid/verify_app.html`, 2026-06-17).
  "inst.one": { nb: "Per forekomst", en: "Per instance" },
  "inst.all": { nb: "Alle forekomster", en: "All instances" },
  "inst.prev": { nb: "Forrige (↑)", en: "Previous (↑)" },
  "inst.next": { nb: "Neste (↓)", en: "Next (↓)" },
  "inst.close": { nb: "Lukk (Esc)", en: "Close (Esc)" },
  // The type page (2026-09-28), labels verbatim from the same G55 viewer:
  // the type form (`Type / navn`, `Diskret / sammensatt`), the layer panel
  // (`Materialsammensetning · N materiallag`), the quantity line (`Volum ·
  // Areal · Lengde · Antall`), `Mengde i QTO`, `Instanser (N)`, `Verdi`.
  "inst.typeName": { nb: "Type / navn", en: "Type / name" },
  "inst.discreteComposite": { nb: "Diskret / sammensatt", en: "Discrete / composite" },
  "inst.discrete": { nb: "Diskret", en: "Discrete" },
  "inst.composite": { nb: "Sammensatt", en: "Composite" },
  "inst.composition": { nb: "Materialsammensetning", en: "Material composition" },
  "inst.layers": { nb: "materiallag", en: "material layers" },
  "inst.length": { nb: "Lengde", en: "Length" },
  "inst.count": { nb: "Antall", en: "Count" },
  "inst.qto": { nb: "Mengde i QTO", en: "Quantity in QTO" },
  "inst.instances": { nb: "Instanser", en: "Instances" },
  "inst.value": { nb: "Verdi", en: "Value" },
  "inst.property": { nb: "Egenskap", en: "Property" },
  // The current instance's column beside the type's (`Per forekomst`).
  "inst.this": { nb: "Forekomst", en: "Instance" },
  "inst.sum": { nb: "Sum", en: "Sum" },
  "inst.pending": { nb: "venter", en: "pending" },
  // The pset inventory's category for a set a rule names (`krevd`).
  "inst.required": { nb: "krevd", en: "required" },
  // The type card's two classification lines, the owner's words for them.
  "inst.system": { nb: "System", en: "System" },
  "inst.function": { nb: "Funksjon", en: "Function" },
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
  "type.classifications": { nb: "Klassifikasjon", en: "Classification" },
  "type.objects": { nb: "Typeobjekter", en: "Type objects" },
  "type.usedOfDeclared": { nb: "brukt av", en: "used of" },
  "type.names": { nb: "navn", en: "names" },
  "type.unavailable": { nb: "utilgjengelig", en: "unavailable" },
  "type.notSupplied": { nb: "ikke levert", en: "not supplied" },
  "type.none": { nb: "ingen", en: "none" },
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
  "action.enable": { nb: "Aktiver", en: "Enable" },
  "action.cancel": { nb: "Avbryt", en: "Cancel" },
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
  "setup.storeys": { nb: "Etasjeoppsett", en: "Storey setup" },
  "field.storeyName": { nb: "Navn", en: "Name" },
  "field.storeyElevation": { nb: "Kote (m)", en: "Elevation (m)" },
  "action.addRow": { nb: "Legg til", en: "Add" },
  "action.downloadTemplate": { nb: "Last ned mal", en: "Download template" },

  /* ------------------------------------------------- the .xlsx config file */
  // Column headers of src/ids/xlsx.ts. Where the rule builder has the label,
  // it is the builder's word (builder/strings.ts).
  "field.id": { nb: "ID", en: "ID" },
  "field.name": { nb: "Navn", en: "Name" },
  "field.description": { nb: "Beskrivelse", en: "Description" },
  "field.instructions": { nb: "Instruksjon", en: "Instructions" },
  "field.select": { nb: "Utvalg", en: "Selection" },
  "field.mapping": { nb: "Rolle", en: "Role" },
  "field.ifcVersions": { nb: "IFC-versjoner", en: "IFC versions" },
  "field.formatVersion": { nb: "Formatversjon", en: "Format version" },
  "field.info": { nb: "Info", en: "Info" },
  "field.requirement": { nb: "Krav", en: "Requirement" },
  "field.rule": { nb: "Regel", en: "Rule" },
  "xlsx.sheet": { nb: "Ark", en: "Sheet" },
  "xlsx.column": { nb: "Kolonne", en: "Column" },
  "xlsx.field": { nb: "Felt", en: "Field" },
  "xlsx.type": { nb: "Type", en: "Type" },
  "xlsx.example": { nb: "Eksempel", en: "Example" },
  "xlsx.type.text": { nb: "tekst", en: "text" },
  "xlsx.type.number": { nb: "tall", en: "number" },
  "xlsx.type.boolean": { nb: "sann/usann", en: "true/false" },
  "xlsx.type.list": { nb: "liste, kommaseparert", en: "list, comma-separated" },
  "xlsx.type.json": { nb: "JSON", en: "JSON" },

  /* --------------------------------------------------------- requirements */
  // The mottakskontroll report's own terms (HI90 docs/rapport-rammeverk.md and
  // docs/begreper.md), in its order. English is the report's gloss where it
  // gives one (System classification, Function classification, Reference
  // object, Phase), else the plain term.
  "req.group.ifc": { nb: "IFC-struktur", en: "IFC structure" },
  "req.group.std": { nb: "Standardkrav", en: "Standard requirements" },
  "req.ifc-schema": { nb: "IFC-skjema", en: "IFC schema" },
  "req.typeobjekt": { nb: "Typeobjekt", en: "Type object" },
  "req.guid": { nb: "GUID", en: "GUID" },
  "req.etasjedefinisjon": { nb: "Etasjedefinisjon", en: "Storey definition" },
  "req.objekter-i-etasje": { nb: "Objekter i etasje", en: "Objects in storey" },
  "req.systemkode": { nb: "Systemkode NS 3451", en: "System classification NS 3451" },
  "req.funksjonskode": { nb: "Funksjonskode NS 3457-8", en: "Function classification NS 3457-8" },
  "req.materiale-produkt": { nb: "Materiale / Produkt", en: "Material / Product" },
  "req.kopiobjekt": { nb: "Kopiobjekt", en: "Reference object" },
  "req.mmi": { nb: "MMI", en: "MMI" },
  "req.fase": { nb: "Fase", en: "Phase" },
  "req.dekning": { nb: "Dekning", en: "Coverage" },
  "req.fordeling": { nb: "Fordeling", en: "Distribution" },
  "req.fra": { nb: "fra", en: "from" },
  "req.av": { nb: "av", en: "of" },
  "req.avvik": { nb: "avvik", en: "deviating" },
  "req.mangler": { nb: "mangler", en: "missing" },
  "measure.volume": { nb: "Volum", en: "Volume" },
  "measure.area": { nb: "Areal", en: "Area" },
  "req.gjelderIkke": { nb: "gjelder ikke", en: "not applicable" },
  "req.aapen": { nb: "åpen", en: "open" },
  "req.unike": { nb: "unike verdier", en: "unique values" },
  "req.lag.standard": { nb: "IFC", en: "IFC" },
  "req.lag.prosjekt": { nb: "prosjekt", en: "project" },
  "req.state.not_configured": { nb: "ikke konfigurert", en: "not configured" },
  "req.duplikater": { nb: "Duplikater i fila", en: "Duplicates in the file" },
  // edkjo's wording, verbatim (2026-09-25): the MMI tile with no mapping.
  "mmi.notConfigured": { nb: "Statuskode ikke konfigurert", en: "Status code not configured" },

  /* ------------------------------------------------------------------ BCF */
  "action.bcf": { nb: "BCF", en: "BCF" },
  "bcf.maxGuids": { nb: "Maks GUID per sak", en: "Max GUIDs per issue" },
  "bcf.author": { nb: "Forfatter", en: "Author" },
  "bcf.export": { nb: "Eksporter", en: "Export" },
  "bcf.topics": { nb: "Saker", en: "Topics" },
  "bcf.snapshots": { nb: "Bilder", en: "Snapshots" },
  "bcf.invalid": { nb: "Ugyldig mot XSD", en: "Invalid against XSD" },
  "bcf.spaces": { nb: "Rom fra", en: "Spaces from" },
  "bcf.noSpaces": { nb: "Ingen rom", en: "No spaces" },
  "bcf.noCamera": { nb: "Uten kamera", en: "No camera" },

  /* ----------------------------------------------------------------- graph */
  "tab.graph": { nb: "Graf", en: "Graph" },

  /* ------------------------------------------------------------- project */
  // The tab's name is pending the owner (2026-09-28): one key, so a rename
  // is one line.
  "tab.project": { nb: "Prosjekt", en: "Project" },
  "ids.heading": { nb: "IDS", en: "IDS" },
  "action.openIds": { nb: "Åpne IDS", en: "Open IDS" },
  // A specification whose applicability matched nothing. Never a pass.
  "ids.notApplied": { nb: "Ikke anvendt", en: "Not applied" },
  "error.ids": { nb: "IDS-feil", en: "IDS error" },
  "graph.quantitySets": { nb: "Mengdesett", en: "Quantity sets" },

  /* ---------------------------------------------------------------- errors */
  "error.ruleset": { nb: "Regelsettfeil", en: "Ruleset error" },
} as const satisfies Record<string, { nb: string; en: string }>;

export type StringKey = keyof typeof STRINGS;

/** Whether a key is a string of the table (a report row id as `check.<id>`). */
export function hasString(key: string): key is StringKey {
  return Object.prototype.hasOwnProperty.call(STRINGS, key);
}

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}

/** Locale for number formatting. Norwegian uses a comma decimal separator. */
export function locale(lang: Lang): string {
  return lang === "nb" ? "nb-NO" : "en-GB";
}
