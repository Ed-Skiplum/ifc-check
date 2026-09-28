/** The ruleset as an Excel workbook (.xlsx), read and written.
 *
 * The JSON stays the interface; the workbook is a second spelling of the same
 * document for a person or an agent filling it in a spreadsheet. Nothing the
 * JSON can say is lost: a part that does not fit its sheet is written as JSON
 * in a cell (a rule in "Andre regler", any other top-level key in "Prosjekt"),
 * and every write reads its own output back and deep-compares it with the
 * input, failing loudly on any difference.
 *
 * Layout. Every data sheet has the Norwegian column header in row 1 and the
 * ruleset field path in row 2; data starts in row 3. The reader keys columns
 * by row 2 only, so columns may be moved, and a column with a blank row 2 is
 * a notes column the reader ignores. "Lesmeg" is a reference table (sheet,
 * column, field path, type, allowed values, example) and is never read.
 *
 * Rule order out of a workbook is fixed by the sheets: Klassifikasjon, MMI,
 * Kopiobjekt, Andre regler. `canonicalRuleset` gives that order for a JSON
 * ruleset, which is what a round trip compares against.
 *
 * The zip and the XML are this module's own (fflate for deflate, xml-read.ts
 * for parsing), with a fixed timestamp, so the same ruleset always gives the
 * same bytes.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { CODE_LIST_IDS } from "../codelists/index.ts";
import { t, type StringKey } from "../ui/i18n.ts";
import { IFC_VERSIONS } from "./lint.ts";
import { parseXml, type XmlElement } from "./xml-read.ts";
import type { MappingRole, Rule, Ruleset } from "./types.ts";

/* ------------------------------------------------------------------ sheets */

export const SHEET = {
  storeys: "Etasjer",
  readme: "Lesmeg",
  classification: "Klassifikasjon",
  mmi: "MMI",
  copy: "Kopiobjekt",
  sources: "Kilder",
  project: "Prosjekt",
  other: "Andre regler",
} as const;

/** Workbook order. */
export const SHEET_ORDER = [
  SHEET.storeys,
  SHEET.readme,
  SHEET.classification,
  SHEET.mmi,
  SHEET.copy,
  SHEET.sources,
  SHEET.project,
  SHEET.other,
] as const;

type Cell = string | number | boolean | null;
type Kind = "text" | "number" | "boolean" | "list" | "json" | "source";

interface Col {
  /** Row 2: the field path. `rules[]`, `storeys[]` and `projectLayer.*[]`
   *  stand for the row's own item. */
  field: string;
  label: StringKey;
  /** Row 1 when there is no label: a top-level key this module does not know. */
  header?: string;
  kind: Kind;
  allowed?: readonly string[];
  example?: string;
}

const SOURCE_KINDS = ["attribute", "property", "classification"] as const;
const SOURCE_LISTS = [
  "phase.sources",
  "material-product.mengdetype",
  "material-product.product",
  "material-product.material",
] as const;

function sourceCols(base: string, example: { kind: string; set?: string; name?: string }): Col[] {
  return [
    { field: base, label: "field.source", kind: "source", allowed: SOURCE_KINDS, example: example.kind },
    { field: `${base}.attribute`, label: "field.source.attribute", kind: "text", example: "Name" },
    { field: `${base}.property.propertySet`, label: "field.propertySet", kind: "text", example: example.set },
    { field: `${base}.property.name`, label: "field.propertyName", kind: "text", example: example.name },
    { field: `${base}.classification.system`, label: "field.system", kind: "text", example: "NS 3451" },
  ];
}

const RULE_TAIL: Col[] = [
  { field: "rules[].enabled", label: "field.enabled", kind: "boolean", allowed: ["TRUE", "FALSE"], example: "FALSE" },
  { field: "rules[].select", label: "field.select", kind: "json", example: '{"entity":{"group":"physicalElement"}}' },
  { field: "rules[].instructions", label: "field.instructions", kind: "text" },
];

function ruleHead(example: { id: string; description: string }): Col[] {
  return [
    { field: "rules[].id", label: "field.id", kind: "text", example: example.id },
    { field: "rules[].name", label: "field.name", kind: "text" },
    { field: "rules[].description", label: "field.description", kind: "text", example: example.description },
  ];
}

interface RuleSheet {
  name: string;
  roles: readonly MappingRole[];
  cols: Col[];
}

const RULE_SHEETS: RuleSheet[] = [
  {
    name: SHEET.classification,
    roles: ["system-classification", "component-classification"],
    cols: [
      {
        field: "rules[].mapping",
        label: "field.mapping",
        kind: "text",
        allowed: ["system-classification", "component-classification"],
        example: "component-classification",
      },
      ...ruleHead({ id: "component-classification", description: "BEP §6.12" }),
      { field: "rules[].check.list", label: "field.list", kind: "text", allowed: CODE_LIST_IDS, example: "ns3457-8" },
      { field: "rules[].check.target", label: "field.target", kind: "text", allowed: ["occurrence", "type"], example: "type" },
      ...sourceCols("rules[].check.source", { kind: "attribute", set: "EKS_Project", name: "RefClass_NS3457-8" }),
      { field: "rules[].check.extract", label: "field.extract", kind: "text", example: "^([A-Z]{2,3})-\\d{2}$" },
      ...RULE_TAIL,
    ],
  },
  {
    name: SHEET.mmi,
    roles: ["progress-code"],
    cols: [
      ...ruleHead({ id: "progress-code", description: "BEP §4.5" }),
      { field: "rules[].check.values", label: "field.values", kind: "list", example: "100, 200, 300, 350, 400, 500, 600" },
      ...sourceCols("rules[].check.source", { kind: "property", set: "EKS_Project", name: "MMI" }),
      { field: "rules[].check.extract", label: "field.extract", kind: "text", example: "^(\\d{3})$" },
      ...RULE_TAIL,
    ],
  },
  {
    name: SHEET.copy,
    roles: ["copy-object"],
    cols: [
      ...ruleHead({ id: "copy-object", description: "BEP §4.6" }),
      { field: "rules[].check.values", label: "field.values", kind: "list", example: "true, false" },
      ...sourceCols("rules[].check.source", { kind: "property", set: "EKS_Project", name: "IsReference" }),
      { field: "rules[].check.extract", label: "field.extract", kind: "text", example: "^(.*)$" },
      ...RULE_TAIL,
    ],
  },
];

const STOREY_COLS: Col[] = [
  { field: "storeys[].name", label: "field.storeyName", kind: "text", example: "Plan 01" },
  { field: "storeys[].elevation", label: "field.storeyElevation", kind: "number", example: "122.5" },
];

const SOURCE_SHEET_COLS: Col[] = [
  { field: "projectLayer", label: "field.requirement", kind: "text", allowed: SOURCE_LISTS, example: "phase.sources" },
  ...sourceCols("projectLayer.*[]", { kind: "property", set: "EKS_Project", name: "Fase" }),
];

const PROJECT_COLS: Col[] = [
  { field: "formatVersion", label: "field.formatVersion", kind: "number", allowed: ["1"], example: "1" },
  { field: "name", label: "field.name", kind: "text", example: "EKS" },
  { field: "description", label: "field.description", kind: "text", example: "BEP 2.0" },
  { field: "ifcVersions", label: "field.ifcVersions", kind: "list", allowed: IFC_VERSIONS, example: "IFC2X3, IFC4" },
  { field: "projectLayer.ifc-schema.accepted", label: "req.ifc-schema", kind: "list", example: "IFC4" },
  { field: "info", label: "field.info", kind: "json", example: '{"version":"1.0"}' },
];

const OTHER_COLS: Col[] = [
  {
    field: "rules[]",
    label: "field.rule",
    kind: "json",
    example: '{"id":"elements-typed","kind":"extended","name":"Typed","select":{"entity":{"group":"physicalElement"}},"check":{"type":"element-typed"}}',
  },
];

/** Top-level keys the Prosjekt columns and the other sheets carry. Any other
 *  key is written as JSON in a Prosjekt column of its own. */
const PROJECT_KEYS = new Set(["formatVersion", "name", "description", "ifcVersions", "info"]);

/* ------------------------------------------------------------ small helpers */

const LIST_SEPARATOR = ", ";

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

const RULE_KEY_ORDER = ["id", "kind", "mapping", "name", "description", "instructions", "enabled", "select", "check"];
const CHECK_KEY_ORDER = ["type", "list", "values", "target", "source", "extract"];
const RULESET_KEY_ORDER = ["formatVersion", "name", "description", "ifcVersions", "info", "storeys", "projectLayer"];

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
  if (value === undefined) return null;
  switch (kind) {
    case "text":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number":
      return typeof value === "number" || typeof value === "string" ? value : JSON.stringify(value);
    case "boolean":
      return typeof value === "boolean" ? value : JSON.stringify(value);
    case "list":
      return Array.isArray(value) ? value.map(String).join(LIST_SEPARATOR) : JSON.stringify(value);
    case "json":
      return JSON.stringify(value);
    case "source":
      return isPlainObject(value) && Object.keys(value).length === 1 ? Object.keys(value)[0] : JSON.stringify(value);
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** One cell to its JSON value. `undefined` = blank = the key is absent. */
function decodeCell(cell: Cell, kind: Kind, where: string, problems: Problems): unknown {
  if (isBlank(cell)) return undefined;
  switch (kind) {
    case "text":
    case "source":
      return typeof cell === "string" ? cell : String(cell);
    case "number":
      // A text cell that is a plain decimal (comma or point, as the setup
      // page takes it) is the number; anything else is kept as written, so
      // lint names it at its cell instead of it vanishing.
      if (typeof cell === "number") return cell;
      if (typeof cell === "string") {
        const clean = cell.trim().replace(",", ".");
        return DECIMAL.test(clean) ? Number(clean) : cell;
      }
      problems.add(where, `expected a number, found ${String(cell)}`);
      return undefined;
    case "boolean":
      if (typeof cell === "boolean") return cell;
      if (typeof cell === "string" && /^(true|false)$/i.test(cell)) return cell.toLowerCase() === "true";
      problems.add(where, `expected TRUE or FALSE, found ${String(cell)}`);
      return undefined;
    case "list":
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
}

/** A row as its cells keyed by field, plus where each cell is. */
interface Row {
  cells: Map<string, Cell>;
  refs: Map<string, string>;
  /** The row's first cell, for an item-level location. */
  ref: string;
}

/** An item from one row. `prefix` is the item's own field (`rules[]`); the
 *  source column builds the one-key source object from its four columns. */
function decodeItem(row: Row, cols: Col[], prefix: string, problems: Problems): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  const rel = (field: string) => (field === prefix ? "" : field.slice(prefix.length + 1));
  const sourceBases = cols.filter((c) => c.kind === "source").map((c) => c.field);
  for (const col of cols) {
    if (col.kind === "source" || sourceBases.some((base) => col.field.startsWith(`${base}.`))) continue;
    const where = row.refs.get(col.field) ?? row.ref;
    const value = decodeCell(row.cells.get(col.field) ?? null, col.kind, where, problems);
    if (value !== undefined) setPath(item, rel(col.field), value);
  }
  for (const base of sourceBases) {
    const kindCell = row.cells.get(base) ?? null;
    const kind = decodeCell(kindCell, "source", row.refs.get(base) ?? row.ref, problems) as string | undefined;
    const sub = (path: string) => decodeCell(row.cells.get(`${base}.${path}`) ?? null, "text", "", problems) as string | undefined;
    for (const other of SOURCE_KINDS) {
      if (other === kind) continue;
      for (const col of cols) {
        if (col.field.startsWith(`${base}.${other}.`) || col.field === `${base}.${other}`) {
          if (!isBlank(row.cells.get(col.field) ?? null)) {
            problems.add(row.refs.get(col.field) ?? row.ref, `filled, but the source is ${kind ?? "not set"}`);
          }
        }
      }
    }
    if (kind === undefined) continue;
    let source: Record<string, unknown>;
    if (kind === "attribute") {
      source = { attribute: sub("attribute") };
    } else if (kind === "property") {
      source = { property: orderKeys({ propertySet: sub("property.propertySet"), name: sub("property.name") }, ["propertySet", "name"]) };
    } else if (kind === "classification") {
      source = { classification: orderKeys({ system: sub("classification.system") }, ["system"]) };
    } else {
      problems.add(row.refs.get(base) ?? row.ref, `source must be one of ${SOURCE_KINDS.join(", ")}, found ${kind}`);
      continue;
    }
    const at = rel(base);
    if (at === "") Object.assign(item, orderKeys(source, [])); else setPath(item, at, orderKeys(source, []));
  }
  return item;
}

function encodeItem(item: unknown, cols: Col[], prefix: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const rel = (field: string) => (field === prefix ? "" : field.slice(prefix.length + 1));
  for (const col of cols) cells.set(col.field, encodeCell(getPath(item, rel(col.field)), col.kind));
  return cells;
}

/** A free-standing row for the fit test, where nothing has a cell yet. */
function looseRow(cells: Map<string, Cell>): Row {
  return { cells, refs: new Map(), ref: "" };
}

/* --------------------------------------------------------------- the rules */

function ruleFromRow(row: Row, sheet: RuleSheet, problems: Problems): Record<string, unknown> {
  const item = decodeItem(row, sheet.cols, "rules[]", problems);
  item.kind = "extended";
  if (sheet.roles.length === 1) item.mapping = sheet.roles[0];
  const check = isPlainObject(item.check) ? item.check : {};
  item.check = orderKeys({ ...check, type: "code-lookup" }, CHECK_KEY_ORDER);
  return orderKeys(item, RULE_KEY_ORDER);
}

type Placement = RuleSheet | null;

/** The sheet a rule is written to: its mapping's sheet when the row spells
 *  the rule exactly, else Andre regler (null). */
function placeRule(rule: Rule): Placement {
  if (rule.kind !== "extended" || rule.mapping === undefined) return null;
  const sheet = RULE_SHEETS.find((s) => s.roles.includes(rule.mapping!));
  if (!sheet) return null;
  const problems = new Problems();
  const back = ruleFromRow(looseRow(encodeItem(rule, sheet.cols, "rules[]")), sheet, problems);
  return problems.list.length === 0 && rulesetDiff(back, rule) === null ? sheet : null;
}

function placedRules(ruleset: Ruleset): { sheet: Placement; rule: Rule }[] {
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  const placed = rules.map((rule) => ({ sheet: placeRule(rule), rule }));
  const rank = (p: Placement) => (p === null ? RULE_SHEETS.length : RULE_SHEETS.indexOf(p));
  return placed
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => rank(a.sheet) - rank(b.sheet) || a.i - b.i)
    .map(({ sheet, rule }) => ({ sheet, rule }));
}

/** The ruleset in the order a workbook gives it back: rules by sheet
 *  (Klassifikasjon, MMI, Kopiobjekt, Andre regler), each sheet in the
 *  ruleset's own order. */
export function canonicalRuleset(ruleset: Ruleset): Ruleset {
  return { ...ruleset, rules: placedRules(ruleset).map((p) => p.rule) };
}

/* ------------------------------------------------- storeys and projectLayer */

function storeysFromRows(rows: Row[], problems: Problems): Record<string, unknown>[] {
  return rows.map((row) => orderKeys(decodeItem(row, STOREY_COLS, "storeys[]", problems), ["name", "elevation"]));
}

function storeysFit(storeys: unknown): boolean {
  if (!Array.isArray(storeys) || storeys.length === 0) return false;
  const problems = new Problems();
  const back = storeysFromRows(storeys.map((s) => looseRow(encodeItem(s, STOREY_COLS, "storeys[]"))), problems);
  return problems.list.length === 0 && rulesetDiff(back, storeys) === null;
}

interface LayerCells {
  accepted: Cell;
  rows: Map<string, Cell>[];
}

function encodeLayer(layer: Record<string, unknown>): LayerCells {
  const rows: Map<string, Cell>[] = [];
  for (const list of SOURCE_LISTS) {
    const sources = getPath(layer, list);
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const cells = encodeItem(source, SOURCE_SHEET_COLS.slice(1), "projectLayer.*[]");
      cells.set("projectLayer", list);
      rows.push(cells);
    }
  }
  return { accepted: encodeCell(getPath(layer, "ifc-schema.accepted"), "list"), rows };
}

function layerFromCells(
  accepted: Cell,
  acceptedRef: string,
  rows: Row[],
  problems: Problems,
  locations: Map<string, string>,
): Record<string, unknown> | undefined {
  const layer: Record<string, unknown> = {};
  const list = decodeCell(accepted, "list", acceptedRef, problems);
  if (list !== undefined) {
    layer["ifc-schema"] = { accepted: list };
    locations.set("projectLayer.ifc-schema", acceptedRef);
    locations.set("projectLayer.ifc-schema.accepted", acceptedRef);
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const where = row.refs.get("projectLayer") ?? row.ref;
    const name = decodeCell(row.cells.get("projectLayer") ?? null, "text", where, problems) as string | undefined;
    if (name === undefined || !(SOURCE_LISTS as readonly string[]).includes(name)) {
      problems.add(where, `${SHEET.sources} needs one of ${SOURCE_LISTS.join(", ")}, found ${name ?? "nothing"}`);
      continue;
    }
    const n = counts.get(name) ?? 0;
    counts.set(name, n + 1);
    const source = decodeItem(row, SOURCE_SHEET_COLS.slice(1), "projectLayer.*[]", problems);
    const [part, key] = name.split(".");
    const holder = (layer[part] ??= {}) as Record<string, unknown>;
    ((holder[key] ??= []) as unknown[]).push(source);
    const real = `projectLayer.${name}[${n}]`;
    if (n === 0) locations.set(`projectLayer.${name}`, where);
    locations.set(`projectLayer.${part}`, locations.get(`projectLayer.${part}`) ?? where);
    for (const col of SOURCE_SHEET_COLS.slice(1)) {
      const ref = row.refs.get(col.field);
      if (ref) locations.set(col.field.replace("projectLayer.*[]", real), ref);
    }
  }
  if (Object.keys(layer).length === 0) return undefined;
  return orderKeys(layer, ["ifc-schema", "phase", "material-product"]);
}

function layerFits(layer: unknown): boolean {
  if (!isPlainObject(layer)) return false;
  try {
    const cells = encodeLayer(layer);
    const problems = new Problems();
    const back = layerFromCells(cells.accepted, "", cells.rows.map(looseRow), problems, new Map());
    return problems.list.length === 0 && rulesetDiff(back, layer) === null;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------- ruleset <-> sheets */

interface SheetData {
  name: string;
  /** Row 1 header, row 2 fields (absent on Lesmeg), then data. */
  rows: Cell[][];
  /** Rows frozen at the top. */
  frozen: number;
}

function tableSheet(name: string, cols: Col[], data: Map<string, Cell>[]): SheetData {
  return {
    name,
    rows: [
      cols.map((c) => c.header ?? t(c.label, "nb")),
      cols.map((c) => c.field),
      ...data.map((cells) => cols.map((c) => cells.get(c.field) ?? null)),
    ],
    frozen: 2,
  };
}

const KIND_LABEL: Record<Kind, StringKey> = {
  text: "xlsx.type.text",
  number: "xlsx.type.number",
  boolean: "xlsx.type.boolean",
  list: "xlsx.type.list",
  json: "xlsx.type.json",
  source: "xlsx.type.text",
};

function readmeSheet(): SheetData {
  const rows: Cell[][] = [
    (["xlsx.sheet", "xlsx.column", "xlsx.field", "xlsx.type", "field.values", "xlsx.example"] as StringKey[]).map((k) => t(k, "nb")),
  ];
  const add = (sheet: string, cols: Col[]) => {
    for (const col of cols) {
      rows.push([
        sheet,
        t(col.label, "nb"),
        col.field,
        t(KIND_LABEL[col.kind], "nb"),
        col.allowed ? col.allowed.join(LIST_SEPARATOR) : null,
        col.example ?? null,
      ]);
    }
  };
  add(SHEET.storeys, STOREY_COLS);
  for (const sheet of RULE_SHEETS) add(sheet.name, sheet.cols);
  add(SHEET.sources, SOURCE_SHEET_COLS);
  add(SHEET.project, PROJECT_COLS);
  add(SHEET.other, OTHER_COLS);
  return { name: SHEET.readme, rows, frozen: 1 };
}

function rulesetToSheets(ruleset: Ruleset): SheetData[] {
  const record = ruleset as unknown as Record<string, unknown>;
  const extras: Col[] = [];
  const project = new Map<string, Cell>();
  for (const col of PROJECT_COLS) {
    if (col.field !== "projectLayer.ifc-schema.accepted") project.set(col.field, encodeCell(record[col.field], col.kind));
  }

  const storeyRows: Map<string, Cell>[] = [];
  if (record.storeys !== undefined) {
    if (storeysFit(record.storeys)) {
      for (const storey of record.storeys as unknown[]) storeyRows.push(encodeItem(storey, STOREY_COLS, "storeys[]"));
    } else extras.push({ field: "storeys", label: "field.info", header: "storeys", kind: "json" });
  }

  let sourceRows: Map<string, Cell>[] = [];
  if (record.projectLayer !== undefined) {
    if (layerFits(record.projectLayer)) {
      const cells = encodeLayer(record.projectLayer as Record<string, unknown>);
      project.set("projectLayer.ifc-schema.accepted", cells.accepted);
      sourceRows = cells.rows;
    } else extras.push({ field: "projectLayer", label: "field.info", header: "projectLayer", kind: "json" });
  }

  for (const key of Object.keys(record)) {
    if (PROJECT_KEYS.has(key) || key === "rules" || key === "storeys" || key === "projectLayer") continue;
    extras.push({ field: key, label: "field.info", header: key, kind: "json" });
  }
  for (const col of extras) project.set(col.field, encodeCell(record[col.field], "json"));
  const projectCols = [...PROJECT_COLS, ...extras];

  const byRuleSheet = new Map<string, Map<string, Cell>[]>();
  const other: Map<string, Cell>[] = [];
  for (const { sheet, rule } of placedRules(ruleset)) {
    if (sheet === null) other.push(new Map([["rules[]", JSON.stringify(rule)]]));
    else {
      const rows = byRuleSheet.get(sheet.name) ?? [];
      rows.push(encodeItem(rule, sheet.cols, "rules[]"));
      byRuleSheet.set(sheet.name, rows);
    }
  }

  const sheets = new Map<string, SheetData>();
  sheets.set(SHEET.storeys, tableSheet(SHEET.storeys, STOREY_COLS, storeyRows));
  sheets.set(SHEET.readme, readmeSheet());
  for (const sheet of RULE_SHEETS) sheets.set(sheet.name, tableSheet(sheet.name, sheet.cols, byRuleSheet.get(sheet.name) ?? []));
  sheets.set(SHEET.sources, tableSheet(SHEET.sources, SOURCE_SHEET_COLS, sourceRows));
  sheets.set(SHEET.project, tableSheet(SHEET.project, projectCols, [project]));
  sheets.set(SHEET.other, tableSheet(SHEET.other, OTHER_COLS, other));
  return SHEET_ORDER.map((name) => sheets.get(name)!);
}

/** A data sheet's rows keyed by row 2. Unknown and duplicate fields are
 *  problems; blank rows are skipped. */
function keyedRows(
  sheet: { name: string; rows: Cell[][] },
  known: (field: string) => boolean,
  problems: Problems,
): Row[] {
  const fields = sheet.rows[1] ?? [];
  const columns: { index: number; field: string }[] = [];
  const seen = new Set<string>();
  fields.forEach((cell, index) => {
    if (isBlank(cell)) return;
    const field = String(cell).trim();
    const where = `${sheet.name}!${colName(index)}2`;
    if (!known(field)) problems.add(where, `unknown field path "${field}"`);
    else if (seen.has(field)) problems.add(where, `field path "${field}" appears twice`);
    else {
      seen.add(field);
      columns.push({ index, field });
    }
  });
  const rows: Row[] = [];
  for (let r = 2; r < sheet.rows.length; r += 1) {
    const cells = new Map<string, Cell>();
    const refs = new Map<string, string>();
    let filled = false;
    for (const { index, field } of columns) {
      const cell = sheet.rows[r]?.[index] ?? null;
      cells.set(field, cell);
      refs.set(field, `${sheet.name}!${colName(index)}${r + 1}`);
      if (!isBlank(cell)) filled = true;
    }
    if (!filled) continue;
    const first = columns[0];
    rows.push({ cells, refs, ref: `${sheet.name}!${first ? colName(first.index) : "A"}${r + 1}` });
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
  const fieldsOf = (cols: Col[]) => new Set(cols.map((c) => c.field));
  const out: Record<string, unknown> = {};

  // Prosjekt: one data row. A field it does not know is a top-level key as
  // JSON, if it is a plain key.
  const projectSheet = byName.get(SHEET.project);
  let accepted: Cell = null;
  let acceptedRef = "";
  if (projectSheet) {
    const known = fieldsOf(PROJECT_COLS);
    const rows = keyedRows(projectSheet, (f) => known.has(f) || /^[$A-Za-z_][\w$-]*$/.test(f), problems);
    if (rows.length > 1) problems.add(rows[1].ref, `${SHEET.project} takes one data row`);
    const row = rows[0];
    if (row) {
      for (const [field, cell] of row.cells) {
        const where = row.refs.get(field)!;
        if (field === "projectLayer.ifc-schema.accepted") {
          accepted = cell;
          acceptedRef = where;
          continue;
        }
        const col = PROJECT_COLS.find((c) => c.field === field);
        if (!col && field === "rules") {
          problems.add(where, "rules are written in the rule sheets");
          continue;
        }
        const value = decodeCell(cell, col ? col.kind : "json", where, problems);
        locations.set(field, where);
        if (value !== undefined) out[field] = value;
      }
    }
  }

  const storeySheet = byName.get(SHEET.storeys);
  if (storeySheet) {
    const known = fieldsOf(STOREY_COLS);
    const rows = keyedRows(storeySheet, (f) => known.has(f), problems);
    if (rows.length > 0) {
      if (out.storeys !== undefined) problems.add(rows[0].ref, `storeys are set both here and in ${SHEET.project}`);
      out.storeys = storeysFromRows(rows, problems);
      locations.set("storeys", rows[0].ref);
      rows.forEach((row, i) => {
        locations.set(`storeys[${i}]`, row.ref);
        for (const [field, ref] of row.refs) locations.set(field.replace("storeys[]", `storeys[${i}]`), ref);
      });
    }
  }

  const sourceSheet = byName.get(SHEET.sources);
  const sourceRows = sourceSheet ? keyedRows(sourceSheet, (f) => fieldsOf(SOURCE_SHEET_COLS).has(f), problems) : [];
  const layer = layerFromCells(accepted, acceptedRef, sourceRows, problems, locations);
  if (layer !== undefined) {
    if (out.projectLayer !== undefined) {
      problems.add(sourceRows[0]?.ref ?? acceptedRef, `projectLayer is set both here and as JSON in ${SHEET.project}`);
    }
    out.projectLayer = layer;
  }

  const rules: unknown[] = [];
  for (const sheet of RULE_SHEETS) {
    const data = byName.get(sheet.name);
    if (!data) continue;
    const known = fieldsOf(sheet.cols);
    for (const row of keyedRows(data, (f) => known.has(f), problems)) {
      const i = rules.length;
      rules.push(ruleFromRow(row, sheet, problems));
      locations.set(`rules[${i}]`, row.ref);
      for (const [field, ref] of row.refs) locations.set(field.replace("rules[]", `rules[${i}]`), ref);
    }
  }
  const otherSheet = byName.get(SHEET.other);
  if (otherSheet) {
    for (const row of keyedRows(otherSheet, (f) => f === "rules[]", problems)) {
      const where = row.refs.get("rules[]")!;
      const rule = decodeCell(row.cells.get("rules[]") ?? null, "json", where, problems);
      if (rule === undefined) continue;
      if (!isPlainObject(rule)) {
        problems.add(where, "a rule is a JSON object");
        continue;
      }
      locations.set(`rules[${rules.length}]`, where);
      rules.push(rule);
    }
  }
  out.rules = rules;

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

/** Read a workbook. Throws XlsxRulesetError naming every problem at its
 *  Sheet!Cell. The result is NOT linted; lint it and place each issue with
 *  `locate`. */
export function readRulesetXlsx(bytes: Uint8Array): XlsxRuleset {
  return sheetsToRuleset(readWorkbook(bytes));
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

