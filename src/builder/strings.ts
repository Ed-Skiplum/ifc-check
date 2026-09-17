/** Bilingual strings for the rule builder. Flat key -> { nb, en }.
 *
 * Norwegian is the default. To be merged with the app's i18n; kept local for now
 * so this folder stays self-contained.
 */

export type Lang = "nb" | "en";

type Entry = { nb: string; en: string };

export const STRINGS = {
  /* chrome */
  "app.title": { nb: "Regelbygger", en: "Rule builder" },
  "action.newRule": { nb: "Ny regel", en: "New rule" },
  "action.import": { nb: "Importer", en: "Import" },
  "action.export": { nb: "Eksporter", en: "Export" },
  "action.duplicate": { nb: "Dupliser", en: "Duplicate" },
  "action.delete": { nb: "Slett", en: "Delete" },
  "action.add": { nb: "Legg til", en: "Add" },
  "action.remove": { nb: "Fjern", en: "Remove" },
  "action.close": { nb: "Lukk", en: "Close" },
  "action.loadSample": { nb: "Last eksempel", en: "Load sample" },
  "action.download": { nb: "Last ned", en: "Download" },

  /* ruleset */
  "ruleset.name": { nb: "Regelsett", en: "Ruleset" },
  "ruleset.ifcVersions": { nb: "IFC-versjoner", en: "IFC versions" },
  "ruleset.rules": { nb: "Regler", en: "Rules" },

  /* rule */
  "rule.id": { nb: "ID", en: "ID" },
  "rule.name": { nb: "Navn", en: "Name" },
  "rule.description": { nb: "Beskrivelse", en: "Description" },
  "rule.instructions": { nb: "Instruksjon", en: "Instructions" },
  "rule.enabled": { nb: "Aktiv", en: "Enabled" },
  "rule.identifier": { nb: "Identifikator", en: "Identifier" },
  "rule.kind": { nb: "Type", en: "Kind" },
  "kind.ids": { nb: "IDS", en: "IDS" },
  "kind.extended": { nb: "Utvidet", en: "Extended" },

  /* ids rule */
  "ids.applicability": { nb: "Gjelder for", en: "Applicability" },
  "ids.requirements": { nb: "Krav", en: "Requirements" },
  "ids.minOccurs": { nb: "Min", en: "Min" },
  "ids.maxOccurs": { nb: "Maks", en: "Max" },
  "ids.unbounded": { nb: "ubegrenset", en: "unbounded" },

  /* extended rule */
  "ext.select": { nb: "Utvalg", en: "Selection" },
  "ext.check": { nb: "Sjekk", en: "Check" },
  "check.element-typed": { nb: "Elementet har en type", en: "Element is typed" },
  "check.unique-attribute": { nb: "Unik attributtverdi", en: "Unique attribute value" },
  "check.type-usage-count": { nb: "Antall bruk per type", en: "Uses per type" },
  "check.model-metadata": { nb: "Modellmetadata", en: "Model metadata" },
  "check.attribute": { nb: "Attributt", en: "Attribute" },
  "check.scope": { nb: "Omfang", en: "Scope" },
  "check.scope.model": { nb: "Hele modellen", en: "Whole model" },
  "check.scope.class": { nb: "Per klasse", en: "Per class" },
  "check.ignoreEmpty": { nb: "Hopp over tomme", en: "Skip empty" },
  "check.min": { nb: "Min", en: "Min" },
  "check.max": { nb: "Maks", en: "Max" },
  "check.field": { nb: "Felt", en: "Field" },

  /* facets */
  "facet.entity": { nb: "Klasse", en: "Entity" },
  "facet.partOf": { nb: "Del av", en: "Part of" },
  "facet.classification": { nb: "Klassifikasjon", en: "Classification" },
  "facet.attribute": { nb: "Attributt", en: "Attribute" },
  "facet.property": { nb: "Egenskap", en: "Property" },
  "facet.material": { nb: "Materiale", en: "Material" },

  "entity.mode.group": { nb: "Gruppe", en: "Group" },
  "entity.mode.classes": { nb: "Klasser", en: "Classes" },
  "entity.predefinedType": { nb: "PredefinedType", en: "PredefinedType" },
  "entity.search": { nb: "Søk klasse", en: "Search class" },
  "entity.selected": { nb: "Valgt", en: "Selected" },

  "group.product": { nb: "Produkter", en: "Products" },
  "group.element": { nb: "Elementer", en: "Elements" },
  "group.physicalElement": { nb: "Fysiske elementer", en: "Physical elements" },
  "group.builtElement": { nb: "Bygningselementer", en: "Built elements" },
  "group.distributionElement": { nb: "Tekniske elementer", en: "Distribution elements" },
  "group.spatialElement": { nb: "Romlige elementer", en: "Spatial elements" },
  "group.featureElement": { nb: "Utsparinger", en: "Feature elements" },
  "group.elementType": { nb: "Elementtyper", en: "Element types" },
  "group.typeProduct": { nb: "Produkttyper", en: "Product types" },
  "group.group": { nb: "Grupper", en: "Groups" },

  "partOf.relation": { nb: "Relasjon", en: "Relation" },
  "classification.system": { nb: "System", en: "System" },
  "property.propertySet": { nb: "Egenskapssett", en: "Property set" },
  "property.baseName": { nb: "Egenskapsnavn", en: "Property name" },
  "property.dataType": { nb: "Datatype", en: "Data type" },
  "facet.value": { nb: "Verdi", en: "Value" },
  "facet.uri": { nb: "URI", en: "URI" },
  "facet.cardinality": { nb: "Kardinalitet", en: "Cardinality" },
  "cardinality.required": { nb: "Påkrevd", en: "Required" },
  "cardinality.optional": { nb: "Valgfri", en: "Optional" },
  "cardinality.prohibited": { nb: "Forbudt", en: "Prohibited" },

  /* value editor */
  "value.mode.any": { nb: "Uten krav", en: "Unconstrained" },
  "value.mode.literal": { nb: "Eksakt", en: "Exact" },
  "value.mode.enumeration": { nb: "Liste", en: "List" },
  "value.mode.pattern": { nb: "Mønster", en: "Pattern" },
  "value.mode.bounds": { nb: "Grenser", en: "Bounds" },
  "value.mode.length": { nb: "Lengde", en: "Length" },
  "value.base": { nb: "Basistype", en: "Base type" },
  "value.minInclusive": { nb: "≥", en: "≥" },
  "value.maxInclusive": { nb: "≤", en: "≤" },
  "value.minExclusive": { nb: ">", en: ">" },
  "value.maxExclusive": { nb: "<", en: "<" },
  "value.minLength": { nb: "Min lengde", en: "Min length" },
  "value.maxLength": { nb: "Maks lengde", en: "Max length" },
  "value.length": { nb: "Lengde", en: "Length" },

  /* lint + validation */
  "lint.title": { nb: "Kontroll", en: "Lint" },
  "lint.errors": { nb: "Feil", en: "Errors" },
  "lint.warnings": { nb: "Advarsler", en: "Warnings" },
  "lint.clean": { nb: "Ingen funn", en: "No findings" },
  "preview.title": { nb: "IDS-dokument", en: "IDS document" },
  "validate.title": { nb: "Skjemavalidering", en: "Schema validation" },
  "validate.valid": { nb: "Gyldig mot IDS 1.0", en: "Valid against IDS 1.0" },
  "validate.invalid": { nb: "Ugyldig", en: "Invalid" },
  "validate.running": { nb: "Validerer", en: "Validating" },
  "validate.none": { nb: "Ingen IDS-regler", en: "No IDS rules" },
  "validate.blocked": { nb: "Feil i regelsettet", en: "Ruleset has errors" },

  /* export */
  "export.title": { nb: "Eksport", en: "Export" },
  "export.included": { nb: "I .ids", en: "In the .ids" },
  "export.excluded": { nb: "Utelatt fra .ids", en: "Left out of the .ids" },
  "export.blocked": {
    nb: "Rett feilene i kontrollen før eksport.",
    en: "Fix the lint errors before exporting.",
  },
  "export.noIds": {
    nb: "Ingen regel kan uttrykkes i IDS, så ingen .ids blir laget.",
    en: "No rule is expressible in IDS, so no .ids is produced.",
  },
  "exclude.disabled": { nb: "Regelen er slått av.", en: "Rule is disabled." },
  "exclude.element-typed": {
    nb: "IDS 1.0 har ikke IFCRELDEFINESBYTYPE i relasjonslisten, så typekobling kan ikke være et partOf-facet.",
    en: "IDS 1.0 has no IFCRELDEFINESBYTYPE in its relations enumeration, so type linkage cannot be a partOf facet.",
  },
  "exclude.unique-attribute": {
    nb: "IDS 1.0 har ingen operator for unikhet eller sammenligning på tvers av objekter.",
    en: "IDS 1.0 has no uniqueness or cross-instance operator.",
  },
  "exclude.type-usage-count": {
    nb: "IDS 1.0 kan ikke telle på tvers av objekter; minOccurs teller hele utvalget, ikke forekomster per type.",
    en: "IDS 1.0 has no cross-instance counting; minOccurs counts the whole selection, not occurrences per type.",
  },
  "exclude.model-metadata": {
    nb: "IfcUnitAssignment, STEP-headeren og parsestatistikken nås ikke av noe IDS-facet.",
    en: "IfcUnitAssignment, the STEP header and the parse statistics are not reachable by any IDS facet.",
  },
  "exclude.unknown": {
    nb: "Utvidet regel med ukjent sjekk.",
    en: "Extended rule with an unknown check.",
  },
} as const satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}
