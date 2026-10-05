/** The ruleset as an Excel workbook (.xlsx), read and written.
 *
 * The ruleset model (types.ts) is the contract; the workbook is a view of it
 * for a person or an agent filling it in a spreadsheet. Every sheet is
 * derived from one part of the model (docs/config-template.md):
 *
 *   IDS, IDS-fasetter      the `ids` rules: one row per specification, one
 *                          row per facet
 *   Klassifikasjon, MMI,   the mapping rules, one row each; MMI-koder is the
 *   MMI-koder, Kopiobjekt  progress-code rule's code list
 *   Etasjeoppsett, Etasjer `storeys`: the matching rules, then the levels
 *   Fag, Modeller          `disciplines`, `models`
 *   Standardkrav, Kilder   `projectLayer`: per part, then per source
 *   Prosjekt               the top-level fields and `info`
 *   Andre regler           every other extended rule, one JSON per row
 *   Lesmeg                 instructions for the agent filling it; never read
 *
 * Nothing the model holds is lost. A rule that no sheet can spell is refused
 * by the writer, naming the rule and the construct; every write reads its
 * own output back and deep-compares it with the input, failing loudly on any
 * difference.
 *
 * Layout. Every data sheet has the Norwegian label in row 1 and the field
 * path in row 2; data starts in row 3. The reader keys columns by row 2
 * only, so columns may be moved, and a column with a blank row 2 is a notes
 * column the reader ignores.
 *
 * Rows. A row whose value cells are all blank is not declared: dropped (a
 * key cell, such as Kilder's Krav or an Aktiv, does not count). A row with a
 * value and a blank required cell is refused at that cell. Aktiv and Rapport
 * take TRUE or FALSE; blank is refused.
 *
 * Rule order out of a workbook is fixed by the sheets: IDS, Klassifikasjon,
 * MMI, Kopiobjekt, Andre regler. `canonicalRuleset` gives that order for a
 * JSON ruleset, which is what a round trip compares against.
 *
 * The zip and the XML are this module's own (fflate for deflate, xml-read.ts
 * for parsing), with a fixed timestamp, so the same ruleset always gives the
 * same bytes.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { CODE_LIST_IDS } from "../codelists/index.ts";
import { t, type StringKey } from "../ui/i18n.ts";
import { CLASS_GROUPS, IFC_VERSIONS, MAPPING_ROLES, PART_OF_RELATIONS } from "./lint.ts";
import { ruleRole } from "./models.ts";
import { parseXml, type XmlElement } from "./xml-read.ts";
import { REQUIREMENT_IDS } from "./types.ts";
import type {
  EntityFacet,
  IdsRule,
  IdsValue,
  MappingRole,
  Rule,
  Ruleset,
} from "./types.ts";

/* ------------------------------------------------------------------ sheets */

export const SHEET = {
  readme: "Lesmeg",
  project: "Prosjekt",
  ids: "IDS",
  facets: "IDS-fasetter",
  classification: "Klassifikasjon",
  mmi: "MMI",
  mmiCodes: "MMI-koder",
  copy: "Kopiobjekt",
  storeySetup: "Etasjeoppsett",
  storeys: "Etasjer",
  disciplines: "Fag",
  models: "Modeller",
  standard: "Standardkrav",
  sources: "Kilder",
  other: "Andre regler",
} as const;

/** Workbook order. */
export const SHEET_ORDER = [
  SHEET.readme,
  SHEET.project,
  SHEET.ids,
  SHEET.facets,
  SHEET.classification,
  SHEET.mmi,
  SHEET.mmiCodes,
  SHEET.copy,
  SHEET.storeySetup,
  SHEET.storeys,
  SHEET.disciplines,
  SHEET.models,
  SHEET.standard,
  SHEET.sources,
  SHEET.other,
] as const;

type Cell = string | number | boolean | null;

/** How a cell spells a model value.
 *   text    a string
 *   number  a number; a text cell holding a plain decimal is that number
 *   mm      a number, or blank = null (no limit)
 *   onOff   TRUE = the field is absent, FALSE = false; blank refused
 *   flag    TRUE / FALSE = true / false; blank refused
 *   list    comma-separated strings
 *   list0   comma-separated strings, blank = the empty list
 *   occurs  a whole number, or "unbounded"
 *   json    JSON
 *   source  a source kind */
type Kind = "text" | "number" | "mm" | "onOff" | "flag" | "list" | "list0" | "occurs" | "json" | "source";

interface Col {
  /** Row 2. */
  field: string;
  label: StringKey;
  kind: Kind;
  allowed?: readonly string[];
  example?: string;
  /** Blank is refused in a row that declares anything. */
  required?: boolean;
  /** Not counted when deciding whether a row is blank. */
  key?: boolean;
}

const LIST_SEPARATOR = ", ";
const SOURCE_KINDS = ["attribute", "property", "classification", "material", "progressCode"] as const;
const SOURCE_LISTS = [
  "phase.sources",
  "material-product.mengdetype",
  "material-product.product",
  "material-product.material",
] as const;
const STANDARD_PARTS = ["ifc-schema", "phase", "material-product"] as const;
const PLANES = ["OKFG", "OKBD"] as const;
const PARTS = ["applicability", "requirements"] as const;
const FACETS = ["entity", "partOf", "classification", "attribute", "property", "material"] as const;
const CARDINALITIES = ["required", "optional", "prohibited"] as const;
const BASES = ["string", "boolean", "integer", "double", "decimal", "date", "dateTime", "duration"] as const;
const ON_OFF = ["TRUE", "FALSE"] as const;

function sourceCols(base: string, example: string): Col[] {
  return [
    { field: base, label: "field.source", kind: "source", allowed: SOURCE_KINDS, example, required: true },
    { field: `${base}.attribute`, label: "field.source.attribute", kind: "text", example: "Name" },
    { field: `${base}.property.propertySet`, label: "field.propertySet", kind: "text", example: "EKS_Project" },
    { field: `${base}.property.name`, label: "field.propertyName", kind: "text", example: "MMI" },
    { field: `${base}.classification.system`, label: "field.system", kind: "text", example: "NS 3451" },
  ];
}

function ruleHead(example: { id: string; name: string }): Col[] {
  return [
    { field: "rules[].id", label: "field.id", kind: "text", example: example.id, required: true, key: true },
    { field: "rules[].name", label: "field.name", kind: "text", example: example.name, required: true },
    { field: "rules[].description", label: "field.description", kind: "text" },
    { field: "rules[].reference", label: "field.reference", kind: "text", example: "BEP §6.12" },
  ];
}

const RULE_TAIL: Col[] = [
  { field: "rules[].enabled", label: "field.enabled", kind: "onOff", allowed: ON_OFF, example: "TRUE", required: true, key: true },
  { field: "rules[].select", label: "field.select", kind: "json", example: '{"entity":{"group":"physicalElement"}}' },
  { field: "rules[].instructions", label: "field.instructions", kind: "text" },
];

const PROJECT_COLS: Col[] = [
  { field: "formatVersion", label: "field.formatVersion", kind: "number", allowed: ["2"], example: "2", required: true },
  { field: "name", label: "field.name", kind: "text", example: "EKS", required: true },
  { field: "description", label: "field.description", kind: "text", example: "BEP 2.0" },
  { field: "ifcVersions", label: "field.ifcVersions", kind: "list", allowed: IFC_VERSIONS, example: "IFC2X3, IFC4", required: true },
  { field: "info.title", label: "field.info.title", kind: "text" },
  { field: "info.version", label: "field.info.version", kind: "text", example: "1.0" },
  { field: "info.description", label: "field.info.description", kind: "text" },
  { field: "info.author", label: "field.info.author", kind: "text", example: "post@example.no" },
  { field: "info.date", label: "field.info.date", kind: "text", example: "2026-09-29" },
  { field: "info.purpose", label: "field.info.purpose", kind: "text" },
  { field: "info.milestone", label: "field.info.milestone", kind: "text" },
  { field: "info.copyright", label: "field.info.copyright", kind: "text" },
  { field: "$schema", label: "field.schemaUrl", kind: "text" },
];

const IDS_COLS: Col[] = [
  ...ruleHead({ id: "eks-material", name: "Physical elements carry a material" }),
  { field: "rules[].instructions", label: "field.instructions", kind: "text" },
  { field: "rules[].identifier", label: "field.identifier", kind: "text" },
  { field: "rules[].ifcVersions", label: "field.ifcVersions", kind: "list", allowed: IFC_VERSIONS },
  { field: "rules[].applicability.minOccurs", label: "field.minOccurs", kind: "number", example: "1" },
  { field: "rules[].applicability.maxOccurs", label: "field.maxOccurs", kind: "occurs", example: "unbounded" },
  { field: "rules[].requirements.description", label: "field.requirementsDescription", kind: "text" },
  { field: "rules[].enabled", label: "field.enabled", kind: "onOff", allowed: ON_OFF, example: "TRUE", required: true, key: true },
];

/** Facet-relative fields: `spec` names the IDS row's id, `part` and `facet`
 *  say which facet list; the rest are that facet's fields. On a partOf row,
 *  classes / group / predefinedType are its entity's. */
const FACET_COLS: Col[] = [
  { field: "spec", label: "field.spec", kind: "text", example: "eks-material", required: true },
  { field: "part", label: "field.part", kind: "text", allowed: PARTS, example: "requirements", required: true },
  { field: "facet", label: "field.facet", kind: "text", allowed: FACETS, example: "material", required: true },
  { field: "classes", label: "field.classes", kind: "list", example: "IFCWALL, IFCSLAB" },
  { field: "group", label: "field.classGroup", kind: "text", allowed: CLASS_GROUPS, example: "physicalElement" },
  { field: "predefinedType", label: "field.predefinedType", kind: "text", example: "SOLIDWALL" },
  { field: "name", label: "field.source.attribute", kind: "text", example: "Name" },
  { field: "propertySet", label: "field.propertySet", kind: "text", example: "Pset_WallCommon" },
  { field: "baseName", label: "field.propertyName", kind: "text", example: "FireRating" },
  { field: "dataType", label: "field.dataType", kind: "text", example: "IFCLABEL" },
  { field: "system", label: "field.system", kind: "text", example: "NS 3451" },
  { field: "relation", label: "field.relation", kind: "text", allowed: PART_OF_RELATIONS, example: "IFCRELCONTAINEDINSPATIALSTRUCTURE" },
  { field: "value", label: "field.value", kind: "text", example: "EI 60" },
  { field: "value.enumeration", label: "field.enumeration", kind: "list", example: "EI 30, EI 60" },
  { field: "value.pattern", label: "field.pattern", kind: "text", example: "EI \\d+" },
  { field: "value.base", label: "field.base", kind: "text", allowed: BASES, example: "double" },
  { field: "value.minInclusive", label: "field.min", kind: "number", example: "0" },
  { field: "value.maxInclusive", label: "field.max", kind: "number", example: "100" },
  { field: "value.minExclusive", label: "field.minExclusive", kind: "number", example: "0" },
  { field: "value.maxExclusive", label: "field.maxExclusive", kind: "number", example: "100" },
  { field: "value.length", label: "field.length", kind: "number", example: "3" },
  { field: "value.minLength", label: "field.minLength", kind: "number", example: "1" },
  { field: "value.maxLength", label: "field.maxLength", kind: "number", example: "20" },
  { field: "uri", label: "field.uri", kind: "text" },
  { field: "cardinality", label: "field.cardinality", kind: "text", allowed: CARDINALITIES, example: "required" },
  { field: "instructions", label: "field.instructions", kind: "text" },
];

interface RuleSheet {
  name: string;
  roles: readonly MappingRole[];
  cols: Col[];
}

const CLASSIFICATION_SHEET: RuleSheet = {
  name: SHEET.classification,
  roles: ["system-classification", "component-classification"],
  cols: [
    {
      field: "rules[].mapping",
      label: "field.mapping",
      kind: "text",
      allowed: ["system-classification", "component-classification"],
      example: "component-classification",
      required: true,
      key: true,
    },
    ...ruleHead({ id: "component-classification", name: "Komponentklasse" }),
    { field: "rules[].check.list", label: "field.list", kind: "text", allowed: CODE_LIST_IDS, example: "ns3457-8", required: true },
    { field: "rules[].check.target", label: "field.target", kind: "text", allowed: ["occurrence", "type"], example: "type" },
    ...sourceCols("rules[].check.source", "attribute"),
    { field: "rules[].check.extract", label: "field.extract", kind: "text", example: "^([A-Z]{2,3})-\\d{2}$", required: true },
    ...RULE_TAIL,
  ],
};

const MMI_SHEET: RuleSheet = {
  name: SHEET.mmi,
  roles: ["progress-code"],
  cols: [
    ...ruleHead({ id: "progress-code", name: "MMI" }),
    ...sourceCols("rules[].check.source", "property"),
    { field: "rules[].check.extract", label: "field.extract", kind: "text", example: "^(\\d{3})$", required: true },
    ...RULE_TAIL,
  ],
};

const COPY_SHEET: RuleSheet = {
  name: SHEET.copy,
  roles: ["copy-object"],
  cols: [
    ...ruleHead({ id: "copy-object", name: "Kopiobjekt" }),
    ...sourceCols("rules[].check.source", "property"),
    { field: "rules[].check.copy", label: "field.copy", kind: "list0", example: "true, ja, kopi" },
    { field: "rules[].check.own", label: "field.own", kind: "list0", example: "false, nei" },
    ...RULE_TAIL,
  ],
};

const RULE_SHEETS: RuleSheet[] = [CLASSIFICATION_SHEET, MMI_SHEET, COPY_SHEET];

const CODE_COLS: Col[] = [
  { field: "rules[].check.codes[].code", label: "field.code", kind: "text", example: "300", required: true },
  { field: "rules[].check.codes[].name", label: "field.name", kind: "text", example: "Detaljprosjektert", required: true },
  { field: "rules[].check.codes[].phase", label: "field.phase", kind: "text", example: "NY" },
];

/** Relative to `storeys` on the row with Fagkode blank, to
 *  `storeys.disciplines[]` on a row with one. */
const STOREY_SETUP_COLS: Col[] = [
  { field: "discipline", label: "field.discipline", kind: "text", example: "RIB" },
  { field: "plane", label: "field.plane", kind: "text", allowed: PLANES, example: "OKFG", required: true },
  { field: "tolerance.aboveMm", label: "field.toleranceAbove", kind: "mm", example: "5" },
  { field: "tolerance.belowMm", label: "field.toleranceBelow", kind: "mm", example: "5" },
  { field: "nameWindowMm", label: "field.nameWindow", kind: "mm", example: "1000" },
  { field: "nearMm", label: "field.near", kind: "number", example: "200" },
  { field: "requireAllNames", label: "field.requireAllNames", kind: "flag", allowed: ON_OFF, example: "TRUE" },
  { field: "reference", label: "field.reference", kind: "text", example: "BEP §3.2" },
];

const LEVEL_COLS: Col[] = [
  { field: "storeys.levels[].name", label: "field.storeyName", kind: "text", example: "Plan 01", required: true },
  { field: "storeys.levels[].elevation", label: "field.storeyElevation", kind: "number", example: "24.15", required: true },
];

const DISCIPLINE_COLS: Col[] = [
  { field: "disciplines[].code", label: "field.discipline", kind: "text", example: "ARK", required: true },
  { field: "disciplines[].report", label: "field.report", kind: "onOff", allowed: ON_OFF, example: "TRUE", required: true, key: true },
];

const MODEL_COLS: Col[] = [
  { field: "models[].label", label: "field.model", kind: "text", example: "EKS_ARK", required: true },
  { field: "models[].discipline", label: "field.discipline", kind: "text", example: "ARK", required: true },
  { field: "models[].group", label: "field.group", kind: "text", example: "ARK" },
  { field: "models[].ownerNames", label: "field.ownerNames", kind: "list", example: "EKS_ARK, ARK" },
  { field: "models[].exempt", label: "field.exempt", kind: "list", example: "system-classification, phase" },
];

const STANDARD_COLS: Col[] = [
  { field: "projectLayer", label: "field.requirement", kind: "text", allowed: STANDARD_PARTS, example: "ifc-schema", required: true, key: true },
  { field: "reference", label: "field.reference", kind: "text", example: "BEP §3" },
  { field: "accepted", label: "field.accepted", kind: "list", example: "IFC2X3, IFC4" },
  { field: "recommended", label: "field.recommended", kind: "list", example: "IFC4" },
];

const SOURCE_SHEET_COLS: Col[] = [
  { field: "projectLayer", label: "field.requirement", kind: "text", allowed: SOURCE_LISTS, example: "phase.sources", required: true, key: true },
  ...sourceCols("source", "property"),
];

const OTHER_COLS: Col[] = [
  {
    field: "rules[]",
    label: "field.rule",
    kind: "json",
    example: '{"id":"elements-typed","kind":"extended","name":"Typed","select":{"entity":{"group":"physicalElement"}},"check":{"type":"element-typed"}}',
    required: true,
  },
];

/* ------------------------------------------------------------ small helpers */

function isBlank(cell: Cell | undefined): boolean {
  return cell === null || cell === undefined || cell === "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPath(item: unknown, path: string): unknown {
  if (path === "") return item;
  let at: unknown = item;
  for (const key of path.split(".")) {
    if (!isPlainObject(at)) return undefined;
    at = at[key];
  }
  return at;
}

function setPath(item: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = item;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(at[key])) at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = value;
}

/** The first path where two JSON values differ, or null when they are equal.
 *  Key order is ignored; a key whose value is undefined counts as absent. */
export function rulesetDiff(a: unknown, b: unknown, path = ""): string | null {
  const here = path === "" ? "(root)" : path;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return here;
    if (a.length !== b.length) return `${here} (length ${a.length} against ${b.length})`;
    for (let i = 0; i < a.length; i += 1) {
      const diff = rulesetDiff(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return here;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      if (a[key] === undefined && b[key] === undefined) continue;
      const diff = rulesetDiff(a[key], b[key], path === "" ? key : `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return Object.is(a, b) ? null : here;
}

function orderKeys<T extends Record<string, unknown>>(value: T, order: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const key of order) if (value[key] !== undefined) out[key] = value[key];
  for (const key of Object.keys(value)) if (!(key in out) && value[key] !== undefined) out[key] = value[key];
  return out as T;
}

const RULE_KEY_ORDER = [
  "id", "kind", "mapping", "name", "description", "reference", "instructions", "enabled",
  "ifcVersions", "identifier", "select", "applicability", "requirements", "check",
];
const CHECK_KEY_ORDER = ["type", "list", "codes", "target", "source", "extract", "copy", "own"];
const RULESET_KEY_ORDER = [
  "$schema", "formatVersion", "name", "description", "ifcVersions", "info", "storeys",
  "disciplines", "models", "projectLayer", "rules",
];

/* --------------------------------------------------------- the cell codec */

/** Errors are collected, never thrown one at a time, so a user sees every
 *  problem in the workbook at once. */
class Problems {
  list: string[] = [];
  add(where: string, message: string): void {
    this.list.push(`${where}: ${message}`);
  }
}

function encodeCell(value: unknown, kind: Kind): Cell {
  switch (kind) {
    case "onOff":
      return value === undefined ? true : value === false ? false : JSON.stringify(value);
    case "flag":
      return typeof value === "boolean" ? value : value === undefined ? null : JSON.stringify(value);
    case "mm":
      return value === null || value === undefined ? null : typeof value === "number" || typeof value === "string" ? value : JSON.stringify(value);
    default:
      break;
  }
  if (value === undefined) return null;
  switch (kind) {
    case "text":
    case "source":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number":
    case "occurs":
      return typeof value === "number" || typeof value === "string" ? value : JSON.stringify(value);
    case "list":
    case "list0":
      return Array.isArray(value) ? value.map(String).join(LIST_SEPARATOR) : JSON.stringify(value);
    case "json":
      return JSON.stringify(value);
  }
  return null;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A number cell: a number, or a text cell that is a plain decimal (comma or
 *  point). Anything else is kept as written, so lint names it at its cell
 *  instead of it vanishing (a `<FROM PROJECT>` placeholder, say). */
function numberOf(cell: Cell): unknown {
  if (typeof cell === "number") return cell;
  if (typeof cell === "string") {
    const clean = cell.trim().replace(",", ".");
    return DECIMAL.test(clean) ? Number(clean) : cell;
  }
  return cell;
}

/** One cell to its model value. `undefined` = blank = the key is absent. */
function decodeCell(cell: Cell, kind: Kind, where: string, problems: Problems): unknown {
  if (kind === "mm") return isBlank(cell) ? null : numberOf(cell);
  if (kind === "list0" && isBlank(cell)) return [];
  if (kind === "onOff" || kind === "flag") {
    const b = typeof cell === "boolean" ? cell : typeof cell === "string" && /^(true|false)$/i.test(cell.trim()) ? cell.trim().toLowerCase() === "true" : null;
    if (b === null) {
      problems.add(where, isBlank(cell) ? "TRUE or FALSE; blank is refused" : `expected TRUE or FALSE, found ${String(cell)}`);
      return undefined;
    }
    return kind === "flag" ? b : b ? undefined : false;
  }
  if (isBlank(cell)) return undefined;
  switch (kind) {
    case "text":
    case "source":
      return typeof cell === "string" ? cell : String(cell);
    case "number":
      return numberOf(cell);
    case "occurs":
      return typeof cell === "string" && cell.trim() === "unbounded" ? "unbounded" : numberOf(cell);
    case "list":
    case "list0":
      return String(cell).split(",").map((part) => part.trim());
    case "json":
      if (typeof cell !== "string") return cell;
      try {
        return JSON.parse(cell) as unknown;
      } catch (error) {
        problems.add(where, `not valid JSON: ${(error as Error).message}`);
        return undefined;
      }
  }
  return undefined;
}

/** A row as its cells keyed by field, plus where each cell is. */
interface Row {
  cells: Map<string, Cell>;
  refs: Map<string, string>;
  /** The row's first cell, for an item-level location. */
  ref: string;
}

function cellOf(row: Row, field: string): Cell {
  return row.cells.get(field) ?? null;
}

function refOf(row: Row, field: string): string {
  return row.refs.get(field) ?? row.ref;
}

function decodeField(row: Row, col: Col, problems: Problems): unknown {
  return decodeCell(cellOf(row, col.field), col.kind, refOf(row, col.field), problems);
}

/** The source object built from a Kildetype column and its four value
 *  columns. A value column filled for another kind is a problem at its cell. */
function decodeSource(row: Row, base: string, problems: Problems): Record<string, unknown> | undefined {
  const kindCell = cellOf(row, base);
  const kind = isBlank(kindCell) ? undefined : String(kindCell).trim();
  const sub = (path: string) => {
    const cell = cellOf(row, `${base}.${path}`);
    return isBlank(cell) ? undefined : String(cell);
  };
  const owned: Record<string, string[]> = {
    attribute: ["attribute"],
    property: ["property.propertySet", "property.name"],
    classification: ["classification.system"],
    material: [],
    progressCode: [],
  };
  for (const path of ["attribute", "property.propertySet", "property.name", "classification.system"]) {
    if (!isBlank(cellOf(row, `${base}.${path}`)) && !(kind !== undefined && owned[kind]?.includes(path))) {
      problems.add(refOf(row, `${base}.${path}`), `filled, but the source kind is ${kind ?? "not set"}`);
    }
  }
  if (kind === undefined) return undefined;
  switch (kind) {
    case "attribute":
      return { attribute: sub("attribute") };
    case "property":
      return { property: orderKeys({ propertySet: sub("property.propertySet"), name: sub("property.name") }, ["propertySet", "name"]) };
    case "classification":
      return { classification: orderKeys({ system: sub("classification.system") }, ["system"]) };
    case "material":
      return { material: {} };
    case "progressCode":
      return { progressCode: {} };
    default:
      problems.add(refOf(row, base), `source kind must be one of ${SOURCE_KINDS.join(", ")}, found ${kind}`);
      return undefined;
  }
}

function encodeSource(source: unknown, base: string, cells: Map<string, Cell>): void {
  if (!isPlainObject(source)) {
    cells.set(base, source === undefined ? null : JSON.stringify(source));
    return;
  }
  const keys = Object.keys(source);
  cells.set(base, keys.length === 1 ? keys[0] : JSON.stringify(source));
  cells.set(`${base}.attribute`, encodeCell(source.attribute, "text"));
  cells.set(`${base}.property.propertySet`, encodeCell(getPath(source, "property.propertySet"), "text"));
  cells.set(`${base}.property.name`, encodeCell(getPath(source, "property.name"), "text"));
  cells.set(`${base}.classification.system`, encodeCell(getPath(source, "classification.system"), "text"));
}

/** An item from one row, by the columns' paths relative to `prefix`; source
 *  columns build their source object. Records each cell's model path. */
function decodeItem(
  row: Row,
  cols: Col[],
  prefix: string,
  problems: Problems,
  at: string,
  locations: Map<string, string>,
): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  const rel = (field: string) => (field === prefix ? "" : prefix === "" ? field : field.slice(prefix.length + 1));
  const sourceBases = cols.filter((c) => c.kind === "source").map((c) => c.field);
  for (const col of cols) {
    if (col.kind === "source" || sourceBases.some((base) => col.field.startsWith(`${base}.`))) continue;
    const value = decodeField(row, col, problems);
    const path = rel(col.field);
    if (row.refs.has(col.field)) locations.set(path === "" ? at : `${at}.${path}`, refOf(row, col.field));
    if (value !== undefined) setPath(item, path, value);
  }
  for (const base of sourceBases) {
    const source = decodeSource(row, base, problems);
    const path = rel(base);
    const here = path === "" ? at : `${at}.${path}`;
    locations.set(here, refOf(row, base));
    for (const sub of ["attribute", "property.propertySet", "property.name", "classification.system"]) {
      if (row.refs.has(`${base}.${sub}`)) locations.set(`${here}.${sub}`, refOf(row, `${base}.${sub}`));
    }
    if (source !== undefined) {
      if (path === "") Object.assign(item, source);
      else setPath(item, path, source);
    }
  }
  return item;
}

function encodeItem(item: unknown, cols: Col[], prefix: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const rel = (field: string) => (field === prefix ? "" : prefix === "" ? field : field.slice(prefix.length + 1));
  const sourceBases = cols.filter((c) => c.kind === "source").map((c) => c.field);
  for (const col of cols) {
    if (col.kind === "source" || sourceBases.some((base) => col.field.startsWith(`${base}.`))) continue;
    cells.set(col.field, encodeCell(getPath(item, rel(col.field)), col.kind));
  }
  for (const base of sourceBases) encodeSource(getPath(item, rel(base)), base, cells);
  return cells;
}

/** A free-standing row for the fit test, where nothing has a cell yet. */
function looseRow(cells: Map<string, Cell>): Row {
  return { cells, refs: new Map(), ref: "" };
}

/* --------------------------------------------------------- mapping rules */

function ruleFromRow(row: Row, sheet: RuleSheet, problems: Problems, at: string, locations: Map<string, string>): Record<string, unknown> {
  const item = decodeItem(row, sheet.cols, "rules[]", problems, at, locations);
  item.kind = "extended";
  if (sheet === MMI_SHEET) item.mapping = "progress-code";
  const check = isPlainObject(item.check) ? item.check : {};
  if (sheet === COPY_SHEET) {
    item.check = orderKeys({ ...check, type: "copy-object" }, CHECK_KEY_ORDER);
    delete item.mapping;
  } else {
    item.check = orderKeys({ ...check, type: "code-lookup" }, CHECK_KEY_ORDER);
  }
  return orderKeys(item, RULE_KEY_ORDER);
}

/** The sheet an extended rule is written to: its role's sheet when a row
 *  spells the rule exactly, else null (Andre regler, as JSON). The codes of a
 *  progress-code rule ride on MMI-koder, so they are set aside for the test. */
function placeRule(rule: Rule): RuleSheet | null {
  if (rule.kind !== "extended") return null;
  const role = ruleRole(rule);
  const sheet = role === null ? undefined : RULE_SHEETS.find((s) => s.roles.includes(role));
  if (!sheet) return null;
  const problems = new Problems();
  const probe: Rule =
    sheet === MMI_SHEET && rule.check.type === "code-lookup"
      ? { ...rule, check: { ...rule.check, codes: undefined } }
      : rule;
  const back = ruleFromRow(looseRow(encodeItem(probe, sheet.cols, "rules[]")), sheet, problems, "", new Map());
  if (sheet === MMI_SHEET && rule.check.type === "code-lookup") {
    const codes = rule.check.codes;
    if (!Array.isArray(codes) || !codes.every(codeFits)) return null;
    (back.check as Record<string, unknown>).codes = codes;
  }
  return problems.list.length === 0 && rulesetDiff(back, rule) === null ? sheet : null;
}

function codeFits(entry: unknown): boolean {
  const problems = new Problems();
  const back = decodeItem(looseRow(encodeItem(entry, CODE_COLS, "rules[].check.codes[]")), CODE_COLS, "rules[].check.codes[]", problems, "", new Map());
  return problems.list.length === 0 && rulesetDiff(orderKeys(back, ["code", "name", "phase"]), entry) === null;
}

/** 0 ids, 1 Klassifikasjon, 2 MMI, 3 Kopiobjekt, 4 Andre regler. */
function rank(rule: Rule): number {
  if (rule.kind === "ids") return 0;
  const sheet = placeRule(rule);
  return sheet === null ? 4 : 1 + RULE_SHEETS.indexOf(sheet);
}

/** The ruleset in the order a workbook gives it back: rules by sheet (IDS,
 *  Klassifikasjon, MMI, Kopiobjekt, Andre regler), each sheet in the
 *  ruleset's own order. */
export function canonicalRuleset(ruleset: Ruleset): Ruleset {
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  const ranked = rules.map((rule, i) => ({ rule, i, r: rank(rule) }));
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  return { ...ruleset, rules: ranked.map((x) => x.rule) };
}

/* ------------------------------------------------------------- IDS rules */

/** The restriction facets a value column takes: every one IDS 1.0 has. */
const VALUE_FACETS = [
  "base", "enumeration", "pattern", "minInclusive", "maxInclusive", "minExclusive", "maxExclusive",
  "length", "minLength", "maxLength",
] as const;

/** Why an ids rule does not fit the IDS sheets, or null when it does. The
 *  sheets take literal names, an entity as classes or a group, and a value as
 *  a literal or a restriction (every facet IDS 1.0 has). */
function idsMisfit(rule: IdsRule): string | null {
  const literal = (v: IdsValue | undefined, where: string) =>
    v === undefined || typeof v === "string" ? null : `${where} is a restriction; the sheet takes a literal there`;
  const entity = (e: EntityFacet | undefined, where: string): string | null => {
    if (!e) return null;
    if (e.name !== undefined) return `${where}.name is set; the sheet takes classes (IFC-klasse) or a group (Klassegruppe)`;
    return literal(e.predefinedType, `${where}.predefinedType`);
  };
  const value = (v: IdsValue | undefined, where: string): string | null => {
    if (v === undefined || typeof v === "string") return null;
    const extra = Object.keys(v.restriction).filter((k) => !(VALUE_FACETS as readonly string[]).includes(k));
    return extra.length ? `${where}.restriction.${extra[0]} has no column` : null;
  };
  for (const part of PARTS) {
    const facets = part === "applicability" ? rule.applicability : rule.requirements;
    if (!facets) continue;
    const p = `${part}`;
    const found =
      entity(facets.entity, `${p}.entity`) ??
      (facets.partOf ?? []).map((f, i) => entity(f.entity, `${p}.partOf[${i}].entity`)).find((x) => x) ??
      (facets.classification ?? []).map((f, i) => literal(f.system, `${p}.classification[${i}].system`) ?? value(f.value, `${p}.classification[${i}].value`)).find((x) => x) ??
      (facets.attribute ?? []).map((f, i) => literal(f.name, `${p}.attribute[${i}].name`) ?? value(f.value, `${p}.attribute[${i}].value`)).find((x) => x) ??
      (facets.property ?? []).map((f, i) =>
        literal(f.propertySet, `${p}.property[${i}].propertySet`) ??
        literal(f.baseName, `${p}.property[${i}].baseName`) ??
        value(f.value, `${p}.property[${i}].value`),
      ).find((x) => x) ??
      (facets.material ?? []).map((f, i) => value(f.value, `${p}.material[${i}].value`)).find((x) => x);
    if (found) return found;
  }
  return null;
}

type Facet = Record<string, unknown>;

/** One facet to its row. */
function facetRow(spec: string, part: string, facet: string, f: Facet): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  cells.set("spec", spec);
  cells.set("part", part);
  cells.set("facet", facet);
  const entity = (facet === "partOf" ? f.entity : facet === "entity" ? f : undefined) as EntityFacet | undefined;
  if (entity) {
    cells.set("classes", encodeCell(entity.classes, "list"));
    cells.set("group", encodeCell(entity.group, "text"));
    cells.set("predefinedType", encodeCell(entity.predefinedType, "text"));
  }
  for (const key of ["name", "propertySet", "baseName", "dataType", "system", "relation", "uri", "cardinality", "instructions"]) {
    if (key === "name" && facet === "entity") continue;
    cells.set(key, encodeCell(f[key], "text"));
  }
  const v = f.value as IdsValue | undefined;
  if (typeof v === "string") cells.set("value", v);
  else if (v !== undefined) {
    const r = v.restriction as Record<string, unknown>;
    for (const key of VALUE_FACETS) {
      cells.set(`value.${key}`, encodeCell(r[key], key === "enumeration" ? "list" : key === "base" || key === "pattern" ? "text" : "number"));
    }
  }
  return cells;
}

function idsRows(rule: IdsRule): { spec: Map<string, Cell>; facets: Map<string, Cell>[] } {
  const spec = encodeItem(rule, IDS_COLS, "rules[]");
  const facets: Map<string, Cell>[] = [];
  for (const part of PARTS) {
    const holder = part === "applicability" ? rule.applicability : rule.requirements;
    if (!holder) continue;
    if (holder.entity) facets.push(facetRow(rule.id, part, "entity", holder.entity as unknown as Facet));
    for (const facet of FACETS.slice(1)) {
      for (const f of (holder[facet as keyof typeof holder] as Facet[] | undefined) ?? []) facets.push(facetRow(rule.id, part, facet, f));
    }
  }
  return { spec, facets };
}

/** A facet from its row. `at` is its model path; each cell's path is
 *  recorded. */
function facetFromRow(row: Row, facet: string, problems: Problems, at: string, locations: Map<string, string>): Facet {
  const get = (field: string, kind: Kind = "text") => {
    const col = FACET_COLS.find((c) => c.field === field)!;
    return decodeCell(cellOf(row, field), kind === "text" ? col.kind : kind, refOf(row, field), problems);
  };
  const where = (field: string, path: string) => {
    if (row.refs.has(field)) locations.set(`${at}.${path}`, refOf(row, field));
  };
  const allowedFields: Record<string, string[]> = {
    entity: ["classes", "group", "predefinedType", "instructions"],
    partOf: ["classes", "group", "predefinedType", "relation", "cardinality", "instructions"],
    classification: ["system", "value", "uri", "cardinality", "instructions"],
    attribute: ["name", "value", "cardinality", "instructions"],
    property: ["propertySet", "baseName", "value", "dataType", "uri", "cardinality", "instructions"],
    material: ["value", "uri", "cardinality", "instructions"],
  };
  const allowed = allowedFields[facet] ?? [];
  for (const col of FACET_COLS.slice(3)) {
    const own = col.field.startsWith("value.") ? "value" : col.field;
    if (!isBlank(cellOf(row, col.field)) && !allowed.includes(own)) {
      problems.add(refOf(row, col.field), `a ${facet} facet takes no ${t(col.label, "nb")}`);
    }
  }
  const out: Facet = {};
  const entity: Facet = {};
  for (const [field, key] of [["classes", "classes"], ["group", "group"], ["predefinedType", "predefinedType"]] as const) {
    const v = get(field);
    if (v !== undefined) entity[key] = v;
  }
  if (facet === "entity") {
    Object.assign(out, entity);
    for (const f of ["classes", "group", "predefinedType"]) where(f, f);
  } else if (facet === "partOf") {
    out.entity = orderKeys(entity, ["classes", "group", "predefinedType"]);
    for (const f of ["classes", "group", "predefinedType"]) where(f, `entity.${f}`);
  }
  for (const key of ["name", "propertySet", "baseName", "system", "dataType", "relation", "uri", "cardinality", "instructions"]) {
    if (!allowed.includes(key)) continue;
    const v = get(key);
    where(key, key);
    if (v !== undefined) out[key] = v;
  }
  if (allowed.includes("value")) {
    const literal = get("value");
    const r: Record<string, unknown> = {};
    for (const key of VALUE_FACETS) {
      const v = get(`value.${key}`);
      if (v !== undefined) r[key] = v;
    }
    const restricted = Object.keys(r).length > 0;
    if (literal !== undefined && restricted) {
      problems.add(refOf(row, "value"), "a value is a literal (Verdi) or a restriction, not both");
    }
    where("value", "value");
    for (const key of VALUE_FACETS) where(`value.${key}`, `value.restriction.${key}`);
    if (literal !== undefined) out.value = literal;
    else if (restricted) out.value = { restriction: orderKeys(r, VALUE_FACETS) };
  }
  const order: Record<string, string[]> = {
    entity: ["classes", "group", "predefinedType", "instructions"],
    partOf: ["entity", "relation", "cardinality", "instructions"],
    classification: ["system", "value", "uri", "cardinality", "instructions"],
    attribute: ["name", "value", "cardinality", "instructions"],
    property: ["propertySet", "baseName", "value", "dataType", "uri", "cardinality", "instructions"],
    material: ["value", "uri", "cardinality", "instructions"],
  };
  return orderKeys(out, order[facet] ?? []);
}

/* ------------------------------------------------------ writer: the sheets */

interface SheetData {
  name: string;
  /** Row 1 header, row 2 fields (absent on Lesmeg), then data. */
  rows: Cell[][];
  /** Rows frozen at the top. */
  frozen: number;
}

function tableSheet(name: string, cols: Col[], data: Map<string, Cell>[], labels?: Map<string, string>): SheetData {
  return {
    name,
    rows: [
      cols.map((c) => labels?.get(c.field) ?? t(c.label, "nb")),
      cols.map((c) => c.field),
      ...data.map((cells) => cols.map((c) => cells.get(c.field) ?? null)),
    ],
    frozen: 2,
  };
}

/** Everything the writer cannot spell, all at once. */
class Unwritable extends Error {}

function rulesetToSheets(ruleset: Ruleset): SheetData[] {
  const record = ruleset as unknown as Record<string, unknown>;
  const refuse: string[] = [];
  for (const key of Object.keys(record)) {
    if (!RULESET_KEY_ORDER.includes(key)) refuse.push(`"${key}" is not a ruleset field`);
  }

  const project = encodeItem(record, PROJECT_COLS, "");

  // IDS and the rule sheets.
  const idsSpecs: Map<string, Cell>[] = [];
  const idsFacets: Map<string, Cell>[] = [];
  const byRuleSheet = new Map<RuleSheet, Map<string, Cell>[]>();
  const other: Map<string, Cell>[] = [];
  const codes: Map<string, Cell>[] = [];
  for (const rule of canonicalRuleset(ruleset).rules) {
    if (rule.kind === "ids") {
      const misfit = idsMisfit(rule);
      if (misfit) {
        refuse.push(`rule ${rule.id}: ${misfit}`);
        continue;
      }
      const { spec, facets } = idsRows(rule);
      idsSpecs.push(spec);
      idsFacets.push(...facets);
      continue;
    }
    const sheet = placeRule(rule);
    if (sheet === null) {
      other.push(new Map([["rules[]", JSON.stringify(rule)]]));
      continue;
    }
    const rows = byRuleSheet.get(sheet) ?? [];
    rows.push(encodeItem(rule, sheet.cols, "rules[]"));
    byRuleSheet.set(sheet, rows);
    if (sheet === MMI_SHEET && rule.kind === "extended" && rule.check.type === "code-lookup") {
      if (rows.length > 1) refuse.push(`rule ${rule.id}: a second progress-code rule (lint mapping-duplicate)`);
      for (const entry of rule.check.codes ?? []) codes.push(encodeItem(entry, CODE_COLS, "rules[].check.codes[]"));
    }
  }

  // Storeys: the project row, then one per discipline; then the levels.
  const setupRows: Map<string, Cell>[] = [];
  const levelRows: Map<string, Cell>[] = [];
  const setup = ruleset.storeys;
  const levelLabels = new Map<string, string>();
  if (setup !== undefined) {
    const main = encodeItem(setup, STOREY_SETUP_COLS, "");
    main.set("discipline", null);
    main.set("requireAllNames", null);
    setupRows.push(main);
    for (const d of setup.disciplines ?? []) setupRows.push(encodeItem(d, STOREY_SETUP_COLS, ""));
    for (const level of setup.levels ?? []) levelRows.push(encodeItem(level, LEVEL_COLS, "storeys.levels[]"));
    if (setup.plane === "OKFG" || setup.plane === "OKBD") {
      levelLabels.set("storeys.levels[].elevation", t(`field.storeyElevation.${setup.plane}`, "nb"));
    }
  }

  const disciplineRows = (ruleset.disciplines ?? []).map((d) => encodeItem(d, DISCIPLINE_COLS, "disciplines[]"));
  const modelRows = (ruleset.models ?? []).map((m) => encodeItem(m, MODEL_COLS, "models[]"));

  // The project layer: one Standardkrav row per part that says more than its
  // sources, one Kilder row per source.
  const standardRows: Map<string, Cell>[] = [];
  const sourceRows: Map<string, Cell>[] = [];
  const layer = (ruleset.projectLayer ?? {}) as Record<string, Record<string, unknown> | undefined>;
  if (ruleset.projectLayer !== undefined && Object.keys(layer).length === 0) refuse.push("projectLayer is empty; leave it out");
  for (const key of Object.keys(layer)) {
    if (!(STANDARD_PARTS as readonly string[]).includes(key)) refuse.push(`projectLayer.${key} is not a standard requirement`);
  }
  for (const part of STANDARD_PARTS) {
    const entry = layer[part];
    if (entry === undefined) continue;
    if (!isPlainObject(entry) || Object.keys(entry).length === 0) {
      refuse.push(`projectLayer.${part} is empty; leave it out`);
      continue;
    }
    const cells = encodeItem(entry, STANDARD_COLS, "");
    cells.set("projectLayer", part);
    const lists = SOURCE_LISTS.filter((l) => l.startsWith(`${part}.`));
    const said = ["reference", "accepted", "recommended"].some((k) => entry[k] !== undefined);
    const anySource = lists.some((l) => Array.isArray(entry[l.split(".")[1]]));
    if (said || !anySource) standardRows.push(cells);
    for (const list of lists) {
      const sources = entry[list.split(".")[1]];
      if (!Array.isArray(sources)) continue;
      for (const source of sources) {
        const row = new Map<string, Cell>([["projectLayer", list]]);
        encodeSource(source, "source", row);
        sourceRows.push(row);
      }
    }
  }

  if (refuse.length > 0) throw new Unwritable(refuse.join("\n"));

  const sheets = new Map<string, SheetData>();
  sheets.set(SHEET.readme, readmeSheet());
  sheets.set(SHEET.project, tableSheet(SHEET.project, PROJECT_COLS, [project]));
  sheets.set(SHEET.ids, tableSheet(SHEET.ids, IDS_COLS, idsSpecs));
  sheets.set(SHEET.facets, tableSheet(SHEET.facets, FACET_COLS, idsFacets));
  for (const sheet of RULE_SHEETS) sheets.set(sheet.name, tableSheet(sheet.name, sheet.cols, byRuleSheet.get(sheet) ?? []));
  sheets.set(SHEET.mmiCodes, tableSheet(SHEET.mmiCodes, CODE_COLS, codes));
  sheets.set(SHEET.storeySetup, tableSheet(SHEET.storeySetup, STOREY_SETUP_COLS, setupRows));
  sheets.set(SHEET.storeys, tableSheet(SHEET.storeys, LEVEL_COLS, levelRows, levelLabels));
  sheets.set(SHEET.disciplines, tableSheet(SHEET.disciplines, DISCIPLINE_COLS, disciplineRows));
  sheets.set(SHEET.models, tableSheet(SHEET.models, MODEL_COLS, modelRows));
  sheets.set(SHEET.standard, tableSheet(SHEET.standard, STANDARD_COLS, standardRows));
  sheets.set(SHEET.sources, tableSheet(SHEET.sources, SOURCE_SHEET_COLS, sourceRows));
  sheets.set(SHEET.other, tableSheet(SHEET.other, OTHER_COLS, other));
  return SHEET_ORDER.map((name) => sheets.get(name)!);
}

/* ------------------------------------------------------------------ Lesmeg */

/** Lesmeg: for the agent filling the workbook. English, imperative, tables. */
function readmeSheet(): SheetData {
  const rows: Cell[][] = [["ifc-check project config: instructions for the agent filling this workbook"]];
  const blank = () => rows.push([]);
  const head = (...cells: string[]) => rows.push(cells);

  blank();
  head("Decision rule");
  rows.push(["1", "IDS 1.0 can test it on one object at a time (entity, attribute, property, classification, material, partOf): write it in IDS and IDS-fasetter."]);
  rows.push(["2", "Otherwise write it in the rule sheets: code lists, copy objects, storeys, schema, value cascades, model files, counts across objects."]);
  rows.push(["3", "Write each requirement once. Never in both."]);
  rows.push(["4", "No sheet below takes it: tell the user. Do not write it anywhere."]);

  blank();
  head("Requirement", "Sheet", "Columns");
  const map: [string, string, string][] = [
    ["Property exists, has a value", "IDS, IDS-fasetter", "Fasett property, Egenskapssett, Egenskap, Kardinalitet"],
    ["Property value from a list, matching a pattern, in a range, of a length", "IDS-fasetter", "Verdi, Verdiliste, Mønster, Min, Maks, Over, Under, lengths"],
    ["Attribute set or valued (Name, Description, ObjectType, Tag)", "IDS-fasetter", "Fasett attribute, Attributt, Verdi"],
    ["Element class, predefined type", "IDS-fasetter", "Fasett entity, IFC-klasse or Klassegruppe, PredefinedType"],
    ["Element contained in a storey, part of an assembly", "IDS-fasetter", "Fasett partOf, IFC-klasse, Relasjon"],
    ["Classification reference in a system, or a given code", "IDS-fasetter", "Fasett classification, System, Verdi"],
    ["Material assigned, or named", "IDS-fasetter", "Fasett material, Verdi"],
    ["Code from NS 3451 or NS 3457-8, extracted from a value", "Klassifikasjon", "Rolle, Kodeliste, Kildetype, Uttrekk"],
    ["MMI code from the project's table, its names", "MMI, MMI-koder", "Kode, Navn"],
    ["Phase implied by the MMI code", "MMI-koder, Kilder", "Fase; Kilder phase.sources with Kildetype progressCode"],
    ["Copy and reference objects", "Kopiobjekt, Modeller", "Kopiverdier, Egne verdier, Eierverdier"],
    ["Storey names and elevations", "Etasjer, Etasjeoppsett", "Navn, Kote; Referanseplan, tolerances"],
    ["A discipline measuring storeys to another plane", "Etasjeoppsett", "one row with Fagkode"],
    ["Accepted and recommended IFC schema", "Standardkrav", "Krav ifc-schema, Godtatte, Anbefalte"],
    ["Where phase, mengdetype, product or material is read", "Kilder", "Krav, Kildetype"],
    ["Model file: discipline, report group, no report, exemptions", "Modeller, Fag", "Modell, Fagkode, Gruppe, Gjelder ikke; Rapport"],
    ["Every element typed, unique attribute, type used N times, header or unit fact", "Andre regler", "one JSON rule per row (docs: AGENTS.md Rulesets)"],
  ];
  for (const r of map) rows.push(r);

  blank();
  head("Conventions");
  const rules = [
    "Row 1 is the label, row 2 the field path, data from row 3. Never edit row 2. Columns may move. A column with a blank row 2 is a note, never read.",
    "Replace every <FROM PROJECT>. Lint refuses the file while one remains.",
    "No evidence in the BEP, EIR or manual for a row: delete the row. Never copy a value from a model as the requirement.",
    "A row with only key cells filled (Krav, Rolle, ID, Aktiv, Rapport) is not declared and is dropped. A row with a value and a blank required cell is refused at that cell.",
    "Aktiv, Rapport and Alle navn må stemme take TRUE or FALSE. Blank is refused. Aktiv FALSE keeps the rule and switches it off.",
    "Lists are comma-separated. A value containing a comma cannot be written in a list.",
    "Rule IDs are unique across IDS, Klassifikasjon, MMI, Kopiobjekt and Andre regler.",
    "Referanse is the citation (BEP §3.2). Beskrivelse says what the rule checks.",
    "Kote is metres, measured to Referanseplan: OKFG (OK ferdig gulv) or OKBD (OK bærende dekke).",
    "Tolerances and windows are millimetres, file minus level. Blank = no limit. 0 = exact.",
    "Etasjeoppsett: one row with Fagkode blank for the project. One more row per discipline measuring to another plane, with Alle navn må stemme.",
    "Modell is the IFC file name without extension, exact (EKS_ARK for EKS_ARK.ifc).",
    "Kopiobjekt: compared ignoring case and whitespace. Blank, an own value or this model's Eierverdier = the file's own object. A copy value or any other value = a copy.",
    "Kildetype: attribute, property, classification, material, progressCode. material only in the rule sheets. Never material under material-product.material: IfcRelAssociatesMaterial is read first already. progressCode only under phase.sources.",
    "Uttrekk is a JavaScript regex with exactly one capture group: the code.",
    "IDS-fasetter: Spesifikasjon names an IDS row's ID. Del is applicability or requirements. Kardinalitet only under requirements; partOf takes required or prohibited.",
    "IDS-fasetter: a value is Verdi, or a restriction (Grunntype, Verdiliste, Mønster, Min, Maks, Over, Under, Lengde, Min lengde, Maks lengde). A non-empty value is Min lengde 1. Names (Attributt, Egenskapssett, Egenskap, System) are literal.",
    "IFC-klasse: concrete classes, uppercase (IFCWALL). An abstract class matches nothing: use Klassegruppe.",
    `Gjelder ikke takes requirement ids: ${[...REQUIREMENT_IDS, ...MAPPING_ROLES].join(", ")}, or an Andre regler rule ID.`,
  ];
  for (const r of rules) rows.push(["-", r]);

  blank();
  head("Sheet", "Column", "Field", "Type", "Required", "Allowed", "Example");
  const kindName: Record<Kind, string> = {
    text: "text",
    number: "number",
    mm: "mm, blank = no limit",
    onOff: "TRUE / FALSE",
    flag: "TRUE / FALSE",
    list: "list",
    list0: "list, blank = none",
    occurs: "whole number or unbounded",
    json: "JSON",
    source: "source kind",
  };
  const add = (sheet: string, cols: Col[]) => {
    for (const col of cols) {
      rows.push([
        sheet,
        t(col.label, "nb"),
        col.field,
        kindName[col.kind],
        col.required ? "yes" : null,
        col.allowed ? col.allowed.join(LIST_SEPARATOR) : null,
        col.example ?? null,
      ]);
    }
  };
  add(SHEET.project, PROJECT_COLS);
  add(SHEET.ids, IDS_COLS);
  add(SHEET.facets, FACET_COLS);
  for (const sheet of RULE_SHEETS) {
    add(sheet.name, sheet.cols);
    if (sheet === MMI_SHEET) add(SHEET.mmiCodes, CODE_COLS);
  }
  add(SHEET.storeySetup, STOREY_SETUP_COLS);
  add(SHEET.storeys, LEVEL_COLS);
  add(SHEET.disciplines, DISCIPLINE_COLS);
  add(SHEET.models, MODEL_COLS);
  add(SHEET.standard, STANDARD_COLS);
  add(SHEET.sources, SOURCE_SHEET_COLS);
  add(SHEET.other, OTHER_COLS);
  return { name: SHEET.readme, rows, frozen: 1 };
}

/* ------------------------------------------------------ reader: the sheets */

/** A data sheet's declared rows keyed by row 2. Unknown and duplicate
 *  fields are problems. A row whose non-key cells are all blank is not
 *  declared and is skipped; a declared row with a blank required cell is a
 *  problem at that cell. */
function keyedRows(sheet: { name: string; rows: Cell[][] }, cols: Col[], problems: Problems): Row[] {
  const known = new Map(cols.map((c) => [c.field, c]));
  const fields = sheet.rows[1] ?? [];
  const columns: { index: number; field: string }[] = [];
  const seen = new Set<string>();
  fields.forEach((cell, index) => {
    if (isBlank(cell)) return;
    const field = String(cell).trim();
    const where = `${sheet.name}!${colName(index)}2`;
    if (!known.has(field)) problems.add(where, `unknown field path "${field}"`);
    else if (seen.has(field)) problems.add(where, `field path "${field}" appears twice`);
    else {
      seen.add(field);
      columns.push({ index, field });
    }
  });
  const missing = cols.filter((c) => c.required && !seen.has(c.field));
  const rows: Row[] = [];
  for (let r = 2; r < sheet.rows.length; r += 1) {
    const cells = new Map<string, Cell>();
    const refs = new Map<string, string>();
    let declared = false;
    for (const { index, field } of columns) {
      const cell = sheet.rows[r]?.[index] ?? null;
      cells.set(field, cell);
      refs.set(field, `${sheet.name}!${colName(index)}${r + 1}`);
      if (!isBlank(cell) && !known.get(field)!.key) declared = true;
    }
    if (!declared) continue;
    const first = columns[0];
    const row: Row = { cells, refs, ref: `${sheet.name}!${first ? colName(first.index) : "A"}${r + 1}` };
    for (const col of cols) {
      if (!col.required || !refs.has(col.field)) continue;
      if (isBlank(cells.get(col.field) ?? null) && col.kind !== "onOff" && col.kind !== "flag") {
        problems.add(refs.get(col.field)!, `${t(col.label, "nb")} is required`);
      }
    }
    rows.push(row);
  }
  if (rows.length > 0) {
    for (const col of missing) problems.add(`${sheet.name}!${colName(fields.length)}2`, `the required column ${col.field} is missing`);
  }
  return rows;
}

export interface XlsxRuleset {
  ruleset: Ruleset;
  /** Ruleset path (`rules[2].check.extract`) to its cell (`MMI!L3`). */
  locations: Map<string, string>;
}

export class XlsxRulesetError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}

function sheetsToRuleset(sheets: { name: string; rows: Cell[][] }[]): XlsxRuleset {
  const problems = new Problems();
  const locations = new Map<string, string>();
  const byName = new Map<string, { name: string; rows: Cell[][] }>();
  for (const sheet of sheets) {
    if (!(SHEET_ORDER as readonly string[]).includes(sheet.name)) {
      problems.add(sheet.name, `unknown sheet; the sheets are ${SHEET_ORDER.join(", ")}`);
    } else byName.set(sheet.name, sheet);
  }
  const rowsOf = (name: string, cols: Col[]) => {
    const sheet = byName.get(name);
    return sheet ? keyedRows(sheet, cols, problems) : [];
  };
  const out: Record<string, unknown> = {};

  // Prosjekt: one row.
  const projectRows = rowsOf(SHEET.project, PROJECT_COLS);
  if (projectRows.length > 1) problems.add(projectRows[1].ref, `${SHEET.project} takes one data row`);
  if (projectRows[0]) Object.assign(out, decodeItem(projectRows[0], PROJECT_COLS, "", problems, "", locations));
  if (isPlainObject(out.info)) out.info = orderKeys(out.info, ["title", "copyright", "version", "description", "author", "date", "purpose", "milestone"]);
  for (const [k, v] of [...locations]) if (k.startsWith(".")) {
    locations.delete(k);
    locations.set(k.slice(1), v);
  }

  // Etasjeoppsett and Etasjer.
  const setupRows = rowsOf(SHEET.storeySetup, STOREY_SETUP_COLS);
  const levelRows = rowsOf(SHEET.storeys, LEVEL_COLS);
  const mains = setupRows.filter((r) => isBlank(cellOf(r, "discipline")));
  const overrides = setupRows.filter((r) => !isBlank(cellOf(r, "discipline")));
  if (mains.length > 1) problems.add(mains[1].ref, `${SHEET.storeySetup} takes one row with Fagkode blank`);
  if (mains.length === 0 && (overrides.length > 0 || levelRows.length > 0)) {
    problems.add((overrides[0] ?? levelRows[0]).ref, `${SHEET.storeySetup} needs its row with Fagkode blank`);
  }
  const main = mains[0];
  if (main) {
    if (!isBlank(cellOf(main, "requireAllNames"))) {
      problems.add(refOf(main, "requireAllNames"), "Alle navn må stemme belongs on a row with Fagkode");
    }
    const setup = decodeItem(main, STOREY_SETUP_COLS.filter((c) => c.field !== "requireAllNames" && c.field !== "discipline"), "", problems, "storeys", locations);
    if (setup.nearMm === undefined) problems.add(refOf(main, "nearMm"), `${t("field.near", "nb")} is required`);
    const disciplines = overrides.map((row, i) => {
      for (const f of ["nameWindowMm", "nearMm", "reference"]) {
        if (!isBlank(cellOf(row, f))) problems.add(refOf(row, f), "set on the row with Fagkode blank only");
      }
      const d = decodeItem(row, STOREY_SETUP_COLS.filter((c) => ["discipline", "plane", "tolerance.aboveMm", "tolerance.belowMm", "requireAllNames"].includes(c.field)), "", problems, `storeys.disciplines[${i}]`, locations);
      locations.set(`storeys.disciplines[${i}]`, row.ref);
      return orderKeys(d, ["discipline", "plane", "tolerance", "requireAllNames"]);
    });
    const levels = levelRows.map((row, i) => {
      locations.set(`storeys.levels[${i}]`, row.ref);
      return orderKeys(decodeItem(row, LEVEL_COLS, "storeys.levels[]", problems, `storeys.levels[${i}]`, locations), ["name", "elevation"]);
    });
    locations.set("storeys", main.ref);
    locations.set("storeys.levels", levelRows[0]?.ref ?? main.ref);
    if (isPlainObject(setup.tolerance)) setup.tolerance = orderKeys(setup.tolerance, ["aboveMm", "belowMm"]);
    for (const d of disciplines) if (isPlainObject(d.tolerance)) d.tolerance = orderKeys(d.tolerance as Record<string, unknown>, ["aboveMm", "belowMm"]);
    out.storeys = orderKeys(
      { ...setup, levels, ...(disciplines.length ? { disciplines } : {}) },
      ["reference", "plane", "tolerance", "nameWindowMm", "nearMm", "levels", "disciplines"],
    );
  }

  // Fag and Modeller.
  const disciplineRows = rowsOf(SHEET.disciplines, DISCIPLINE_COLS);
  if (disciplineRows.length) {
    out.disciplines = disciplineRows.map((row, i) => {
      locations.set(`disciplines[${i}]`, row.ref);
      return orderKeys(decodeItem(row, DISCIPLINE_COLS, "disciplines[]", problems, `disciplines[${i}]`, locations), ["code", "report"]);
    });
  }
  const modelRows = rowsOf(SHEET.models, MODEL_COLS);
  if (modelRows.length) {
    out.models = modelRows.map((row, i) => {
      locations.set(`models[${i}]`, row.ref);
      return orderKeys(decodeItem(row, MODEL_COLS, "models[]", problems, `models[${i}]`, locations), ["label", "discipline", "group", "ownerNames", "exempt"]);
    });
  }

  // Standardkrav and Kilder.
  const layer: Record<string, Record<string, unknown>> = {};
  for (const row of rowsOf(SHEET.standard, STANDARD_COLS)) {
    const part = String(cellOf(row, "projectLayer") ?? "").trim();
    if (!(STANDARD_PARTS as readonly string[]).includes(part)) {
      problems.add(refOf(row, "projectLayer"), `Krav is one of ${STANDARD_PARTS.join(", ")}, found ${part || "nothing"}`);
      continue;
    }
    if (layer[part]) {
      problems.add(refOf(row, "projectLayer"), `${part} has two rows`);
      continue;
    }
    if (part !== "ifc-schema") {
      for (const f of ["accepted", "recommended"]) {
        if (!isBlank(cellOf(row, f))) problems.add(refOf(row, f), "ifc-schema only");
      }
    }
    const cols = STANDARD_COLS.slice(1).filter((c) => part === "ifc-schema" || c.field === "reference");
    layer[part] = decodeItem(row, cols, "", problems, `projectLayer.${part}`, locations);
    locations.set(`projectLayer.${part}`, row.ref);
  }
  const counts = new Map<string, number>();
  for (const row of rowsOf(SHEET.sources, SOURCE_SHEET_COLS)) {
    const name = String(cellOf(row, "projectLayer") ?? "").trim();
    if (!(SOURCE_LISTS as readonly string[]).includes(name)) {
      problems.add(refOf(row, "projectLayer"), `Krav is one of ${SOURCE_LISTS.join(", ")}, found ${name || "nothing"}`);
      continue;
    }
    const n = counts.get(name) ?? 0;
    counts.set(name, n + 1);
    const [part, key] = name.split(".");
    const at = `projectLayer.${name}[${n}]`;
    const source = decodeSource(row, "source", problems);
    locations.set(at, refOf(row, "source"));
    for (const sub of ["attribute", "property.propertySet", "property.name", "classification.system"]) {
      locations.set(`${at}.${sub}`, refOf(row, `source.${sub}`));
    }
    if (n === 0) locations.set(`projectLayer.${name}`, row.ref);
    if (!locations.has(`projectLayer.${part}`)) locations.set(`projectLayer.${part}`, row.ref);
    const holder = (layer[part] ??= {});
    ((holder[key] ??= []) as unknown[]).push(source ?? {});
  }
  const layerOut: Record<string, unknown> = {};
  for (const part of STANDARD_PARTS) {
    if (!layer[part]) continue;
    const order =
      part === "ifc-schema" ? ["reference", "accepted", "recommended"] : part === "phase" ? ["reference", "sources"] : ["reference", "mengdetype", "product", "material"];
    layerOut[part] = orderKeys(layer[part], order);
  }
  if (Object.keys(layerOut).length) out.projectLayer = layerOut;

  // The rules: IDS, Klassifikasjon, MMI (+ MMI-koder), Kopiobjekt, Andre regler.
  const rules: Record<string, unknown>[] = [];
  const specRows = rowsOf(SHEET.ids, IDS_COLS);
  const facetRows = rowsOf(SHEET.facets, FACET_COLS);
  const specIndex = new Map<string, number>();
  for (const row of specRows) {
    const i = rules.length;
    const rule = decodeItem(row, IDS_COLS, "rules[]", problems, `rules[${i}]`, locations);
    rule.kind = "ids";
    locations.set(`rules[${i}]`, row.ref);
    const id = typeof rule.id === "string" ? rule.id : "";
    if (specIndex.has(id)) problems.add(refOf(row, "rules[].id"), `specification ${id} appears twice`);
    specIndex.set(id, i);
    if (!isPlainObject(rule.applicability)) rule.applicability = {};
    rules.push(rule);
  }
  const facetCount = new Map<string, number>();
  for (const row of facetRows) {
    const spec = String(cellOf(row, "spec") ?? "").trim();
    const part = String(cellOf(row, "part") ?? "").trim();
    const facet = String(cellOf(row, "facet") ?? "").trim();
    const i = specIndex.get(spec);
    if (i === undefined) {
      problems.add(refOf(row, "spec"), `no IDS row has the ID ${spec}`);
      continue;
    }
    if (!(PARTS as readonly string[]).includes(part)) {
      problems.add(refOf(row, "part"), `Del is ${PARTS.join(" or ")}, found ${part}`);
      continue;
    }
    if (!(FACETS as readonly string[]).includes(facet)) {
      problems.add(refOf(row, "facet"), `Fasett is one of ${FACETS.join(", ")}, found ${facet}`);
      continue;
    }
    if (part === "applicability") {
      for (const f of ["cardinality", "uri", "instructions"]) {
        if (!isBlank(cellOf(row, f))) problems.add(refOf(row, f), "an applicability facet takes no " + f + "; it belongs under requirements");
      }
    }
    const rule = rules[i];
    const holder = (isPlainObject(rule[part]) ? rule[part] : (rule[part] = {})) as Record<string, unknown>;
    if (facet === "entity") {
      if (holder.entity !== undefined) {
        problems.add(refOf(row, "facet"), `${spec} has a second entity facet under ${part}`);
        continue;
      }
      holder.entity = facetFromRow(row, facet, problems, `rules[${i}].${part}.entity`, locations);
      locations.set(`rules[${i}].${part}.entity`, row.ref);
    } else {
      const key = `${i}.${part}.${facet}`;
      const n = facetCount.get(key) ?? 0;
      facetCount.set(key, n + 1);
      const at = `rules[${i}].${part}.${facet}[${n}]`;
      ((holder[facet] ??= []) as unknown[]).push(facetFromRow(row, facet, problems, at, locations));
      locations.set(at, row.ref);
    }
  }
  for (const rule of rules) {
    for (const part of PARTS) {
      if (isPlainObject(rule[part])) rule[part] = orderKeys(rule[part] as Record<string, unknown>, part === "applicability" ? ["minOccurs", "maxOccurs", ...FACETS] : ["description", ...FACETS]);
    }
  }

  for (const sheet of RULE_SHEETS) {
    const rows = rowsOf(sheet.name, sheet.cols);
    if (sheet === MMI_SHEET && rows.length > 1) problems.add(rows[1].ref, `${SHEET.mmi} takes one rule; MMI-koder belongs to it`);
    for (const row of rows) {
      const i = rules.length;
      rules.push(ruleFromRow(row, sheet, problems, `rules[${i}]`, locations));
      locations.set(`rules[${i}]`, row.ref);
      if (sheet === MMI_SHEET && i === rules.length - 1 && rows.indexOf(row) === 0) {
        const codeRows = rowsOf(SHEET.mmiCodes, CODE_COLS);
        const check = rules[i].check as Record<string, unknown>;
        check.codes = codeRows.map((r, j) => {
          locations.set(`rules[${i}].check.codes[${j}]`, r.ref);
          return orderKeys(decodeItem(r, CODE_COLS, "rules[].check.codes[]", problems, `rules[${i}].check.codes[${j}]`, locations), ["code", "name", "phase"]);
        });
        // MMI-koder with no row is `codes: []`, a format-only MMI (the Uttrekk
        // decides). The sheet has no list column, so codes are never absent.
        if (codeRows.length) locations.set(`rules[${i}].check.codes`, codeRows[0].ref);
        else locations.set(`rules[${i}].check.codes`, row.ref);
        rules[i].check = orderKeys(check, CHECK_KEY_ORDER);
      }
    }
    if (sheet === MMI_SHEET && rows.length === 0) {
      const codeRows = rowsOf(SHEET.mmiCodes, CODE_COLS);
      if (codeRows.length) problems.add(codeRows[0].ref, `MMI-koder belongs to the rule on ${SHEET.mmi}, which has none`);
    }
  }
  for (const row of rowsOf(SHEET.other, OTHER_COLS)) {
    const where = refOf(row, "rules[]");
    const rule = decodeField(row, OTHER_COLS[0], problems);
    if (rule === undefined) continue;
    if (!isPlainObject(rule)) {
      problems.add(where, "a rule is a JSON object");
      continue;
    }
    locations.set(`rules[${rules.length}]`, where);
    rules.push(rule);
  }
  out.rules = rules.map((r) => orderKeys(r, RULE_KEY_ORDER));

  if (problems.list.length > 0) throw new XlsxRulesetError(problems.list);
  return { ruleset: orderKeys(out, RULESET_KEY_ORDER) as unknown as Ruleset, locations };
}

/** Where a lint path sits in the workbook: the cell of the longest prefix of
 *  the path that has one, or null. */
export function locate(path: string, locations: Map<string, string>): string | null {
  let at = path;
  for (;;) {
    const hit = locations.get(at);
    if (hit) return hit;
    const shorter = at.replace(/(\.[^.[\]]+|\[\d+\])$/, "");
    if (shorter === at || shorter === "") return null;
    at = shorter;
  }
}

/** A ruleset whose IDS sheets hold the rules of an imported .ids: its own
 *  `ids` rules are replaced by them, in the .ids's order; everything else is
 *  kept. An entity named by a literal or an enumeration of class names
 *  becomes `classes`, which emits the same XML; any other rule the sheets
 *  cannot take is refused by the writer. Rule ids that collide are refused
 *  here. */
export function withIdsRules(ruleset: Ruleset, idsRules: IdsRule[]): Ruleset {
  const kept = ruleset.rules.filter((r) => r.kind !== "ids");
  const taken = new Set(kept.map((r) => r.id));
  const clash = idsRules.filter((r) => taken.has(r.id)).map((r) => r.id);
  if (clash.length) throw new Error(`rule ids in both the config and the .ids: ${clash.join(", ")}`);
  return { ...ruleset, rules: [...idsRules.map(classesForm), ...kept] };
}

const CLASS_NAME = /^IFC[A-Z0-9]+$/;

function classesOf(name: IdsValue | undefined): string[] | null {
  if (typeof name === "string") return CLASS_NAME.test(name) ? [name] : null;
  const r = name?.restriction;
  if (!r || Object.keys(r).some((k) => k !== "base" && k !== "enumeration") || (r.base ?? "string") !== "string") return null;
  return r.enumeration && r.enumeration.length > 1 && r.enumeration.every((c) => CLASS_NAME.test(c)) ? [...r.enumeration] : null;
}

function entityClasses<T extends EntityFacet>(entity: T | undefined): T | undefined {
  if (!entity || entity.name === undefined) return entity;
  const classes = classesOf(entity.name);
  if (!classes) return entity;
  const { name: _name, ...rest } = entity;
  return orderKeys({ classes, ...rest } as Record<string, unknown>, ["classes", "predefinedType", "instructions"]) as unknown as T;
}

function classesForm(rule: IdsRule): IdsRule {
  const fix = <H extends { entity?: EntityFacet; partOf?: { entity: EntityFacet }[] }>(h: H | undefined): H | undefined =>
    h && {
      ...h,
      ...(h.entity ? { entity: entityClasses(h.entity) } : {}),
      ...(h.partOf ? { partOf: h.partOf.map((p) => ({ ...p, entity: entityClasses(p.entity)! })) } : {}),
    };
  return { ...rule, applicability: fix(rule.applicability)!, ...(rule.requirements ? { requirements: fix(rule.requirements) } : {}) };
}

/* ------------------------------------------------------------------- OOXML */

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_WORKSHEET = `${NS_REL}/worksheet`;
const REL_STYLES = `${NS_REL}/styles`;
const REL_SHARED = `${NS_REL}/sharedStrings`;
const REL_DOCUMENT = `${NS_REL}/officeDocument`;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Excel's own limit on the characters in one cell. */
const CELL_MAX = 32767;
/** Fixed, in local time fields, so the zip bytes never depend on the clock or
 *  the time zone. */
const ZIP_TIME = new Date(2026, 0, 1, 0, 0, 0);

function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escapeText(value: string): string {
  return value
    .replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeText(value: string): string {
  return value.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function worksheetXml(sheet: SheetData): string {
  const widths: number[] = [];
  for (const row of sheet.rows) {
    row.forEach((cell, i) => {
      const len = cell === null ? 0 : String(cell).length;
      widths[i] = Math.max(widths[i] ?? 8, Math.min(60, len + 2));
    });
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const style = r === 0 ? ' s="1"' : r === 1 && sheet.frozen === 2 ? ' s="2"' : "";
    const cells = row.map((cell, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (cell === null) return "";
      if (typeof cell === "number") return `<c r="${ref}"${style}><v>${String(cell)}</v></c>`;
      if (typeof cell === "boolean") return `<c r="${ref}"${style} t="b"><v>${cell ? 1 : 0}</v></c>`;
      if (cell.length > CELL_MAX) {
        throw new Error(`${sheet.name}!${ref}: ${cell.length} characters, over Excel's ${CELL_MAX} per cell`);
      }
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeText(cell)}</t></is></c>`;
    });
    return `<row r="${r + 1}">${cells.join("")}</row>`;
  });
  const pane =
    `<pane ySplit="${sheet.frozen}" topLeftCell="A${sheet.frozen + 1}" activePane="bottomLeft" state="frozen"/>`;
  return (
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows.join("")}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  `<fonts count="3">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `<font><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookBytes(sheets: SheetData[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => {
    files[path] = strToU8(xml);
  };
  put(
    "[Content_Types].xml",
    XML_HEAD +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  );
  put(
    "_rels/.rels",
    XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_DOCUMENT}" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  put(
    "xl/workbook.xml",
    XML_HEAD +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<bookViews><workbookView activeTab="0"/></bookViews>` +
      `<sheets>` +
      sheets.map((s, i) => `<sheet name="${escapeText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets>` +
      `</workbook>`,
  );
  put(
    "xl/_rels/workbook.xml.rels",
    XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_WORKSHEET}" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  put("xl/styles.xml", STYLES_XML);
  sheets.forEach((sheet, i) => put(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(sheet)));
  return zipSync(files, { level: 6, mtime: ZIP_TIME });
}

function children(element: XmlElement | undefined, local: string): XmlElement[] {
  return element ? element.children.filter((c) => c.localName === local) : [];
}

function child(element: XmlElement | undefined, local: string): XmlElement | undefined {
  return element?.children.find((c) => c.localName === local);
}

/** Every `<t>` under a string item, rich-text runs included; phonetic runs
 *  (`<rPh>`) are not part of the value. */
function stringItem(element: XmlElement): string {
  let out = "";
  for (const c of element.children) {
    if (c.localName === "t") out += c.text;
    else if (c.localName === "r") out += stringItem(c);
  }
  return unescapeText(out);
}

function relAttr(element: XmlElement, local: string): string | undefined {
  for (const [name, value] of Object.entries(element.attrs)) {
    if (name.includes(":") && name.slice(name.indexOf(":") + 1) === local) return value;
  }
  return undefined;
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function readWorkbook(bytes: Uint8Array): { name: string; rows: Cell[][] }[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new XlsxRulesetError([`not an .xlsx workbook (${(error as Error).message})`]);
  }
  const byLower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
  const text = (path: string): string | undefined => {
    const key = byLower.get(path.toLowerCase());
    return key === undefined ? undefined : strFromU8(files[key]);
  };
  const xml = (path: string): XmlElement | undefined => {
    const source = text(path);
    return source === undefined ? undefined : parseXml(source);
  };

  const rootRels = xml("_rels/.rels");
  const docRel = children(rootRels, "Relationship").find((r) => r.attrs.Type === REL_DOCUMENT);
  const workbookPath = docRel ? resolvePart("", docRel.attrs.Target) : "xl/workbook.xml";
  const workbook = xml(workbookPath);
  if (!workbook) throw new XlsxRulesetError([`not an .xlsx workbook (no ${workbookPath})`]);
  const relsPath = resolvePart(workbookPath, `_rels/${workbookPath.split("/").pop()}.rels`);
  const rels = new Map(
    children(xml(relsPath), "Relationship").map((r) => [r.attrs.Id, r] as const),
  );

  let shared: string[] = [];
  for (const rel of rels.values()) {
    if (rel.attrs.Type === REL_SHARED) {
      shared = children(xml(resolvePart(workbookPath, rel.attrs.Target)), "si").map(stringItem);
    }
  }

  const out: { name: string; rows: Cell[][] }[] = [];
  for (const sheet of children(child(workbook, "sheets"), "sheet")) {
    const name = sheet.attrs.name ?? "";
    const rel = rels.get(relAttr(sheet, "id") ?? "");
    if (!rel) throw new XlsxRulesetError([`${name}: the workbook names no part for this sheet`]);
    const part = xml(resolvePart(workbookPath, rel.attrs.Target));
    if (!part) throw new XlsxRulesetError([`${name}: ${rel.attrs.Target} is missing from the file`]);
    const rows: Cell[][] = [];
    const errors: string[] = [];
    let rowIndex = -1;
    for (const row of children(child(part, "sheetData"), "row")) {
      rowIndex = row.attrs.r ? Number(row.attrs.r) - 1 : rowIndex + 1;
      const cells: Cell[] = (rows[rowIndex] = []);
      let colAt = -1;
      for (const c of children(row, "c")) {
        const ref = c.attrs.r;
        colAt = ref ? colIndex(ref.replace(/\d+$/, "")) : colAt + 1;
        const type = c.attrs.t ?? "n";
        const v = child(c, "v")?.text;
        let value: Cell = null;
        if (type === "s") value = v === undefined ? null : (shared[Number(v)] ?? null);
        else if (type === "inlineStr") value = child(c, "is") ? stringItem(child(c, "is")!) : null;
        else if (type === "str") value = v === undefined ? null : unescapeText(v);
        else if (type === "b") value = v === undefined ? null : v.trim() === "1";
        else if (type === "e") errors.push(`${name}!${colName(colAt)}${rowIndex + 1}: the cell holds an error (${v ?? "?"})`);
        else if (type === "d") value = v ?? null;
        else if (v !== undefined && v.trim() !== "") value = Number(v);
        cells[colAt] = value;
      }
    }
    if (errors.length > 0) throw new XlsxRulesetError(errors);
    for (let r = 0; r < rows.length; r += 1) {
      rows[r] = Array.from({ length: rows[r]?.length ?? 0 }, (_, i) => rows[r]?.[i] ?? null);
    }
    out.push({ name, rows });
  }
  return out;
}

/* ------------------------------------------------------------------ public */
/* ------------------------------------------------------------------ public */

/** Read a workbook. Throws XlsxRulesetError naming every problem at its
 *  Sheet!Cell. The result is NOT linted; lint it and place each issue with
 *  `locate`. */
export function readRulesetXlsx(bytes: Uint8Array): XlsxRuleset {
  return sheetsToRuleset(readWorkbook(bytes));
}

/* ------------------------------------------------- one step, one sheet */

/** Oppsett's per-step templates (2026-10-01, edkjo: "for MMI and floors, we
 *  should have local templates you can download and fill out rather than
 *  clicking"): a workbook holding ONLY the MMI-koder or the Etasjer sheet, in
 *  the full workbook's own layout, columns and codec. The reader takes that
 *  file or a full config workbook, and reads the matching sheet only. */

/** The cells written equal the cells read, so the file says what was handed
 *  in. Required cells are not enforced here: a template may go out half
 *  filled; the reader refuses it until it is filled. */
function stepSheetBytes(sheet: SheetData): Uint8Array {
  const bytes = workbookBytes([sheet]);
  const back = readWorkbook(bytes).find((s) => s.name === sheet.name);
  const trim = (rows: Cell[][]) => rows.map((row) => {
    const out = [...row];
    while (out.length > 0 && out[out.length - 1] === null) out.pop();
    return out;
  }).filter((row, i, all) => row.length > 0 || all.slice(i).some((r) => r.length > 0));
  const diff = back ? rulesetDiff(trim(back.rows), trim(sheet.rows)) : "(the sheet)";
  if (diff !== null) throw new Error(`the ${sheet.name} template does not read back: ${diff} differs`);
  return bytes;
}

/** The step's sheet out of a single-sheet file or a full workbook; its
 *  declared rows, or every problem at its Sheet!Cell. */
function stepRows(bytes: Uint8Array, name: string, cols: Col[], problems: Problems): Row[] {
  const sheet = readWorkbook(bytes).find((s) => s.name === name);
  if (!sheet) throw new XlsxRulesetError([`${name}: no such sheet in the file`]);
  return keyedRows(sheet, cols, problems);
}

/** The MMI-koder sheet alone. A code row with neither code nor name is not
 *  written. */
export function writeCodesXlsx(codes: readonly { code: string; name: string; phase?: string }[]): Uint8Array {
  const rows = codes
    .filter((c) => c.code !== "" || c.name !== "" || (c.phase ?? "") !== "")
    .map((c) => encodeItem(c, CODE_COLS, "rules[].check.codes[]"));
  return stepSheetBytes(tableSheet(SHEET.mmiCodes, CODE_COLS, rows));
}

/** The MMI-koder sheet's codes, in its order. Throws XlsxRulesetError naming
 *  every problem at its cell; nothing is returned half read. */
export function readCodesXlsx(bytes: Uint8Array): { code: string; name: string; phase?: string }[] {
  const problems = new Problems();
  const rows = stepRows(bytes, SHEET.mmiCodes, CODE_COLS, problems);
  const codes = rows.map(
    (row) => orderKeys(decodeItem(row, CODE_COLS, "rules[].check.codes[]", problems, "", new Map()), ["code", "name", "phase"]) as { code: string; name: string; phase?: string },
  );
  if (problems.list.length > 0) throw new XlsxRulesetError(problems.list);
  return codes;
}

/** The Etasjer sheet alone; the Kote header names `plane` when it is OKFG or
 *  OKBD. An elevation that is not a finite number is a blank cell, and a row
 *  with neither name nor elevation is not written. */
export function writeLevelsXlsx(levels: readonly { name: string; elevation: number }[], plane?: string): Uint8Array {
  const rows = levels
    .filter((l) => l.name !== "" || Number.isFinite(l.elevation))
    .map((l) => encodeItem({ name: l.name, elevation: Number.isFinite(l.elevation) ? l.elevation : undefined }, LEVEL_COLS, "storeys.levels[]"));
  const labels = new Map<string, string>();
  if (plane === "OKFG" || plane === "OKBD") labels.set("storeys.levels[].elevation", t(`field.storeyElevation.${plane}`, "nb"));
  return stepSheetBytes(tableSheet(SHEET.storeys, LEVEL_COLS, rows, labels));
}

/** The Etasjer sheet's levels, in its order. A Kote that is not a number is
 *  refused at its cell, beside the reader's own refusals. */
export function readLevelsXlsx(bytes: Uint8Array): { name: string; elevation: number }[] {
  const problems = new Problems();
  const rows = stepRows(bytes, SHEET.storeys, LEVEL_COLS, problems);
  const levels = rows.map((row) => {
    const level = decodeItem(row, LEVEL_COLS, "storeys.levels[]", problems, "", new Map());
    const elevation = level.elevation;
    if (elevation !== undefined && (typeof elevation !== "number" || !Number.isFinite(elevation))) {
      problems.add(refOf(row, "storeys.levels[].elevation"), `${t("field.storeyElevation", "nb")} is a number in metres, found ${String(elevation)}`);
    }
    return orderKeys(level, ["name", "elevation"]) as { name: string; elevation: number };
  });
  if (problems.list.length > 0) throw new XlsxRulesetError(problems.list);
  return levels;
}

/** Write a workbook, read it back and deep-compare with the ruleset in its
 *  canonical order. Throws on any difference rather than hand over a file
 *  that says something else. */
export function writeRulesetXlsx(ruleset: Ruleset): Uint8Array {
  const bytes = workbookBytes(rulesetToSheets(ruleset));
  let back: Ruleset;
  try {
    back = readRulesetXlsx(bytes).ruleset;
  } catch (error) {
    throw new Error(`the .xlsx export does not read back: ${(error as Error).message}`);
  }
  const diff = rulesetDiff(back, canonicalRuleset(ruleset));
  if (diff !== null) throw new Error(`the .xlsx export does not round-trip: ${diff} differs`);
  return bytes;
}

