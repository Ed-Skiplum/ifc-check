/** The Typer type page, as data (2026-09-28). Pure: the page only draws this.
 *
 * Owner: *"build a proper type page, not this stripped down naked thing. What
 * do we need to know about types? Remember we are building an app around
 * 'Type first' and almost all properties are type properties. We want to know
 * type properties, and also what distribution the instances of the type has
 * for instance properties: MMI, QTO, IsReference etc"*, then *"and what
 * instances there are. GUID etc"*. Modelled on his G55 QTO-LCA type viewer
 * (`10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/verify_app.html`):
 * the type's own facts, its material layers, a quantity line, and the
 * instance table beside the 3D.
 *
 * Everything is read from what the panel already holds: the profile (rows,
 * property / quantity / classification tables, material rows), the type card
 * (`type-links.ts`), the board (report rows, the mapping readings, the code
 * trees), the loaded `.ids` result and the element quantities the measure
 * worker resolved (`MeasureState.elements`). Nothing is re-derived that the
 * engine already decided.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 * Where the engine cannot say, a section is `{ absent: reason }`, never empty
 * and never zero:
 *   table-absent              the profile carries no property table.
 *   untyped                   no IfcRelDefinesByType reaches these elements,
 *                             so there is no type object to hold properties.
 *   type-rows-on-occurrences  ifcfast folds a type object's own rows onto the
 *                             occurrences using it (`source: "type"`) and
 *                             keys none by the type's GlobalId (AGENTS.md
 *                             "Pset inventory"). None arrived for these
 *                             instances, so the type's own sets are not
 *                             readable here: absent, not "none".
 *   quantities-not-received   the measure worker has not answered yet.
 */

import type { ModelProfile, ProductRowLite, PsetGroup } from "./profile";
import type { TypeCard, TypeCodes } from "./type-links";
import type { BoardData } from "./report-rows";
import type { ReportState } from "../engine/report";
import type { IdsModelResult } from "../ids/ids-report";
import type { IdsValue, Ruleset } from "../ids/types";
import type { ResultState } from "../ids/evaluate";
import type { ElementQuantity } from "../engine/quantities";
import type { Focus } from "./trace";
import type { StringKey } from "./i18n";
import { focusOfRow, requirements, shownFinding } from "./requirements.ts";
import { nameMatches } from "../engine/pset-inventory.ts";
import { CODE_LISTS } from "../codelists/index.ts";
import { ruleRole } from "../ids/models.ts";

export type AbsentReason = "table-absent" | "untyped" | "type-rows-on-occurrences" | "quantities-not-received";

export interface Absent {
  absent: AbsentReason;
}

export interface ValueCount {
  /** null = the instances carried no value. */
  value: string | null;
  n: number;
}

/** The properties the page singles out (the owner's list). */
export type KeyProp = "mmi" | "copy" | "status" | "isExternal" | "loadBearing" | "fireRating";
export const KEY_ORDER: readonly KeyProp[] = ["mmi", "copy", "status", "isExternal", "loadBearing", "fireRating"];

/** One property over the type's instances. */
export interface PropLine {
  pset: string;
  name: string;
  /** Instances carrying a non-blank value, a blank one, or not carrying it. */
  withValue: number;
  blank: number;
  absent: number;
  /** Non-blank values, most frequent first. */
  values: ValueCount[];
  distinct: number;
  /** The most frequent value, the type's reading of it. */
  typical: string | null;
  key: KeyProp | null;
  /** By nature per instance (MMI, copy object, status): never flagged. */
  perInstance: boolean;
  /** Instances disagree on something the type should settle. */
  disagree: boolean;
  /** `rule:<id>` / `projectLayer:<key>` refs requiring it. */
  requiredBy: string[];
  /** Per instance: its value ("" blank); no entry = not carried. */
  byGuid: Map<string, string>;
}

export interface Required {
  by: string;
  pset: string;
  prop: string;
  /** Instances with a non-blank value on a matching property. */
  withValue: number;
  missing: number;
  /** Where the value was found: rows folded from the type, own rows. */
  level: { type: number; instance: number };
}

/** A mapping reading over the type (MMI, copy object). */
export interface Reading {
  role: "progress-code" | "copy-object";
  configured: boolean;
  /** Raw values as the rule read them; null = none. */
  values: ValueCount[];
  /** Instances the rule did not read (excluded from its selection). */
  unread: number;
}

export interface QtoLine {
  kind: "volume" | "area" | "length";
  unit: "m³" | "m²" | "m";
  n: number;
  sum: number | null;
  min: number | null;
  median: number | null;
  max: number | null;
  split: { qto: number; computed: number; missing: number; pending: number };
}

export interface ReqLine {
  id: string;
  /** The requirement's label; null for a report row outside the eleven. */
  label: StringKey | null;
  group: "ifc" | "std" | null;
  state: ReportState;
  /** This type's instances among the row's findings. */
  failed: number;
  grunn: ValueCount[];
  focus: Focus | null;
}

export interface IdsLine {
  index: number;
  name: string;
  state: ResultState;
  failed: number;
  focus: Focus;
}

export interface InstanceRow {
  guid: string;
  name: string | null;
  tag: string | null;
  storey: string | null;
  model: string;
  mmi: string | null;
  copy: string | null;
  status: string | null;
  q: ElementQuantity | null;
}

export interface Layer {
  material: string | null;
  thickness: number | null;
}

export interface TypePage {
  key: string;
  entity: string;
  typeName: string | null;
  source: string | null;
  count: number;
  typeGuids: string[];
  typeClass: ValueCount[];
  predefined: ValueCount[];
  objectType: ValueCount[];
  codes: TypeCodes | null;
  classifications:
    | { system: string | null; code: string | null; name: string | null; listName: string | null; source: string; n: number }[]
    | Absent;
  /** Layer stacks among the instances, most used first. null = the engine
   *  supplied no `materialsJson()` rows. */
  stacks: { layers: Layer[]; total: number | null; n: number }[] | null;
  /** Direct / list materials (not layers). */
  direct: ValueCount[];
  /** Materials of the main stack, or the direct ones: 1 = Diskret. */
  nmat: number | null;
  typeProps: { lines: PropLine[] } | Absent;
  instanceProps: { lines: PropLine[] } | Absent;
  readings: Reading[];
  required: Required[];
  storeys: { guid: string | null; name: string | null; n: number }[];
  models: ValueCount[];
  qto: QtoLine[] | Absent;
  qtoComplete: boolean;
  reqs: ReqLine[];
  ids: IdsLine[] | null;
  instances: InstanceRow[];
}

export interface TypePageInput {
  profile: ModelProfile;
  card: TypeCard;
  model: string;
  codes?: TypeCodes | null;
  board?: BoardData | null;
  ids?: IdsModelResult | null;
  ruleset?: Ruleset | null;
  quantities?: { byGuid: Record<string, ElementQuantity>; complete: boolean } | null;
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

function tally(values: Iterable<string | null>): ValueCount[] {
  const m = new Map<string | null, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => b.n - a.n || (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) || String(a.value).localeCompare(String(b.value)));
}

/** `propertySet` + `baseName` / `name` pairs anywhere in the ENABLED rules and
 *  the project layer: IDS property facets, code-lookup and cascade sources. */
export function requiredProps(ruleset: Ruleset | null | undefined): { by: string; set: IdsValue; prop: IdsValue }[] {
  if (!ruleset) return [];
  const out: { by: string; set: IdsValue; prop: IdsValue }[] = [];
  const walk = (node: unknown, by: string) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, by);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const prop = o.baseName ?? o.name;
    if (o.propertySet !== undefined && prop !== undefined && (typeof prop === "string" || typeof prop === "object")) {
      out.push({ by, set: o.propertySet as IdsValue, prop: prop as IdsValue });
      return;
    }
    for (const value of Object.values(o)) walk(value, by);
  };
  for (const rule of ruleset.rules ?? []) if (rule.enabled !== false) walk(rule, `rule:${rule.id}`);
  for (const [key, layer] of Object.entries(ruleset.projectLayer ?? {})) walk(layer, `projectLayer:${key}`);
  return out;
}

const show = (v: IdsValue) =>
  typeof v === "string"
    ? v
    : v.restriction.enumeration
      ? v.restriction.enumeration.join(" | ")
      : v.restriction.pattern !== undefined
        ? `/${v.restriction.pattern}/`
        : "…";

/** The property sources a mapping role reads, for tagging its lines. */
function roleSources(ruleset: Ruleset | null | undefined, role: string): { set: string; name: string }[] {
  const out: { set: string; name: string }[] = [];
  for (const rule of ruleset?.rules ?? []) {
    if (rule.enabled === false || rule.kind !== "extended" || ruleRole(rule) !== role) continue;
    const check = rule.check as { source?: unknown };
    const src = check.source as { property?: { propertySet: string; name: string } } | undefined;
    if (src?.property) out.push({ set: src.property.propertySet, name: src.property.name });
  }
  return out;
}

/** The `phase` cascade's property sources after the standard's
 *  Pset_*Common.Status (standard-layer.ts, same order). */
function phaseSources(ruleset: Ruleset | null | undefined): { set: string; name: string }[] {
  const layer = (ruleset?.projectLayer as Record<string, { sources?: unknown[] }> | undefined)?.phase;
  const out: { set: string; name: string }[] = [];
  for (const s of layer?.sources ?? []) {
    const p = (s as { property?: { propertySet: string; name: string } }).property;
    if (p) out.push({ set: p.propertySet, name: p.name });
  }
  return out;
}

const COMMON = /^Pset_\w*Common$/;

function keyOf(pset: string, name: string, mmi: { set: string; name: string }[], copy: { set: string; name: string }[], phase: { set: string; name: string }[]): KeyProp | null {
  const hit = (list: { set: string; name: string }[]) => list.some((s) => s.set === pset && s.name === name);
  if (hit(mmi)) return "mmi";
  if (hit(copy)) return "copy";
  if ((COMMON.test(pset) && name === "Status") || hit(phase)) return "status";
  if (!COMMON.test(pset)) return null;
  if (name === "IsExternal") return "isExternal";
  if (name === "LoadBearing") return "loadBearing";
  if (name === "FireRating") return "fireRating";
  return null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function typePage(input: TypePageInput): TypePage {
  const { profile, card, model, board, ids, ruleset, quantities } = input;
  const guids = card.guids;
  const inType = new Set(guids);
  const rowOf = new Map(profile.rows.map((r) => [r.guid, r]));
  const rows = guids.map((g) => rowOf.get(g)).filter((r): r is ProductRowLite => r !== undefined);
  const count = guids.length;

  // ── properties ─────────────────────────────────────────────────────────
  const mmiSrc = roleSources(ruleset, "progress-code");
  const copySrc = roleSources(ruleset, "copy-object");
  const phaseSrc = phaseSources(ruleset);
  const required = requiredProps(ruleset);
  const lines = { type: new Map<string, PropLine>(), instance: new Map<string, PropLine>() };
  const order: string[] = [];
  const ordered = new Set<string>();
  const psets = profile.psets;
  if (psets) {
    for (const guid of guids) {
      for (const group of psets.get(guid) ?? ([] as PsetGroup[])) {
        for (const p of group.properties) {
          const level = p.source === "type" ? "type" : "instance";
          const k = `${group.name}\u0000${p.name}`;
          let line = lines[level].get(k);
          if (!line) {
            const key = keyOf(group.name, p.name, mmiSrc, copySrc, phaseSrc);
            line = {
              pset: group.name,
              name: p.name,
              withValue: 0,
              blank: 0,
              absent: 0,
              values: [],
              distinct: 0,
              typical: null,
              key,
              perInstance: key === "mmi" || key === "copy" || key === "status",
              disagree: false,
              requiredBy: required
                .filter((r) => nameMatches(r.set, group.name) && nameMatches(r.prop, p.name))
                .map((r) => r.by),
              byGuid: new Map(),
            };
            lines[level].set(k, line);
            if (!ordered.has(k)) {
              ordered.add(k);
              order.push(k);
            }
          }
          if (!line.byGuid.has(guid)) line.byGuid.set(guid, p.value ?? "");
        }
      }
    }
  }
  // A property whose every value is the instance's own storey name (an
  // exporter's `Etasje`) is placement, per instance by nature: not flagged.
  const storeyNameOf = new Map(profile.storeys.map((s) => [s.guid, s.name]));
  const isStorey = (line: PropLine) => {
    let any = false;
    for (const [guid, v] of line.byGuid) {
      if (blank(v)) continue;
      const sg = rowOf.get(guid)?.storeyGuid;
      if (!sg || storeyNameOf.get(sg) !== v) return false;
      any = true;
    }
    return any;
  };
  const finish = (line: PropLine): PropLine => {
    if (!line.perInstance && isStorey(line)) line.perInstance = true;
    const filled = [...line.byGuid.values()].filter((v) => !blank(v));
    line.withValue = filled.length;
    line.blank = line.byGuid.size - filled.length;
    line.absent = count - line.byGuid.size;
    line.values = tally(filled);
    line.distinct = line.values.length;
    line.typical = line.values[0]?.value ?? null;
    line.disagree = !line.perInstance && line.distinct > 1;
    return line;
  };
  const rank = (l: PropLine) => (l.key ? KEY_ORDER.indexOf(l.key) : KEY_ORDER.length);
  const sortLines = (m: Map<string, PropLine>) =>
    order
      .filter((k) => m.has(k))
      .map((k) => finish(m.get(k)!))
      .sort((a, b) => rank(a) - rank(b) || a.pset.localeCompare(b.pset));

  const typeLines = sortLines(lines.type);
  const typeProps: TypePage["typeProps"] = !psets
    ? { absent: "table-absent" }
    : card.typeGuids.length === 0
      ? { absent: "untyped" }
      : typeLines.length === 0
        ? { absent: "type-rows-on-occurrences" }
        : { lines: typeLines };
  const instanceProps: TypePage["instanceProps"] = psets ? { lines: sortLines(lines.instance) } : { absent: "table-absent" };

  // Required: every (set, prop) the ruleset names, over these instances.
  const req: Required[] = [];
  if (psets) {
    for (const r of required) {
      let withValue = 0;
      const level = { type: 0, instance: 0 };
      for (const guid of guids) {
        let found: string | null = null;
        for (const group of psets.get(guid) ?? []) {
          if (!nameMatches(r.set, group.name)) continue;
          for (const p of group.properties) {
            if (nameMatches(r.prop, p.name) && !blank(p.value)) {
              found = p.source === "type" ? "type" : "instance";
              break;
            }
          }
          if (found) break;
        }
        if (found) {
          withValue += 1;
          level[found as "type" | "instance"] += 1;
        }
      }
      req.push({ by: r.by, pset: show(r.set), prop: show(r.prop), withValue, missing: count - withValue, level });
    }
  }

  // ── the mapping readings: MMI and the copy object ─────────────────────
  const readingOf = (role: "progress-code" | "copy-object") => {
    const row = board?.rows.find((r) => r.mapping === role);
    const values = row ? board?.values[row.id] : undefined;
    const byGuid = new Map<string, string | null>();
    for (const [value, list] of values ?? []) for (const g of list) if (inType.has(g)) byGuid.set(g, value);
    const reading: Reading = {
      role,
      configured: values !== undefined,
      values: tally(byGuid.values()),
      unread: values !== undefined ? count - byGuid.size : 0,
    };
    return { reading, byGuid };
  };
  const mmi = readingOf("progress-code");
  const copy = readingOf("copy-object");

  // ── identity ───────────────────────────────────────────────────────────
  const classifications: TypePage["classifications"] = !profile.classifications
    ? { absent: "table-absent" }
    : (() => {
        const m = new Map<string, { system: string | null; code: string | null; name: string | null; listName: string | null; source: string; n: number }>();
        for (const guid of guids) {
          for (const c of profile.classifications!.get(guid) ?? []) {
            const source = c.assignmentSource ?? "instance";
            const k = `${c.system}\u0000${c.code}\u0000${c.name}\u0000${source}`;
            const at = m.get(k);
            if (at) at.n += 1;
            else {
              const list = /3451/.test(c.system ?? "") ? CODE_LISTS.ns3451 : /3457/.test(c.system ?? "") ? CODE_LISTS["ns3457-8"] : null;
              const codes = list?.codes as Record<string, string> | undefined;
              m.set(k, { system: c.system, code: c.code, name: c.name, listName: c.code && codes ? (codes[c.code] ?? null) : null, source, n: 1 });
            }
          }
        }
        return [...m.values()].sort((a, b) => b.n - a.n);
      })();

  let stacks: TypePage["stacks"] = null;
  let direct: ValueCount[] = [];
  if (profile.materialRows) {
    const layersOf = new Map<string, { index: number; material: string | null; thickness: number | null }[]>();
    const directOf = new Map<string, string[]>();
    for (const r of profile.materialRows) {
      if (!inType.has(r.guid)) continue;
      if (r.role === "layer") {
        let list = layersOf.get(r.guid);
        if (!list) layersOf.set(r.guid, (list = []));
        list.push({ index: r.layer_index, material: r.material_name, thickness: r.layer_thickness_mm });
      } else if (r.material_name) {
        let list = directOf.get(r.guid);
        if (!list) directOf.set(r.guid, (list = []));
        list.push(r.material_name);
      }
    }
    const byStack = new Map<string, { layers: Layer[]; total: number | null; n: number }>();
    for (const list of layersOf.values()) {
      const layers = list.sort((a, b) => a.index - b.index).map((l) => ({ material: l.material, thickness: l.thickness }));
      const k = layers.map((l) => `${l.material}|${l.thickness}`).join("/");
      const at = byStack.get(k);
      if (at) at.n += 1;
      else {
        const known = layers.every((l) => l.thickness !== null);
        byStack.set(k, { layers, total: known ? layers.reduce((s, l) => s + (l.thickness ?? 0), 0) : null, n: 1 });
      }
    }
    stacks = [...byStack.values()].sort((a, b) => b.n - a.n);
    direct = tally([...directOf.values()].flatMap((names) => [...new Set(names)]));
  }
  const nmat = stacks && stacks.length > 0 ? stacks[0].layers.length : direct.length > 0 ? direct.length : null;

  // ── distribution ───────────────────────────────────────────────────────
  const known = new Set(profile.storeys.map((s) => s.guid));
  const perStorey = new Map<string | null, number>();
  for (const r of rows) {
    const k = r.storeyGuid !== null && known.has(r.storeyGuid) ? r.storeyGuid : null;
    perStorey.set(k, (perStorey.get(k) ?? 0) + 1);
  }
  const storeyOrder = [...profile.storeys].sort((a, b) =>
    a.elevation === null && b.elevation === null ? 0 : a.elevation === null ? 1 : b.elevation === null ? -1 : a.elevation - b.elevation,
  );
  const storeys = [
    ...storeyOrder.filter((s) => perStorey.has(s.guid)).map((s) => ({ guid: s.guid, name: s.name, n: perStorey.get(s.guid)! })),
    ...(perStorey.has(null) ? [{ guid: null, name: null, n: perStorey.get(null)! }] : []),
  ];
  const storeyName = new Map(profile.storeys.map((s) => [s.guid, s.name ?? s.guid]));

  // ── QTO ────────────────────────────────────────────────────────────────
  let qto: TypePage["qto"];
  if (!quantities) qto = { absent: "quantities-not-received" };
  else {
    const kinds = [
      ["volume", "m³", 0],
      ["area", "m²", 2],
      ["length", "m", 4],
    ] as const;
    qto = kinds.map(([kind, unit, at]) => {
      const split = { qto: 0, computed: 0, missing: 0, pending: 0 };
      const values: number[] = [];
      for (const guid of guids) {
        const q = quantities.byGuid[guid];
        const src = q ? q[at + 1] : 2;
        if (src === 0) split.qto += 1;
        else if (src === 1) split.computed += 1;
        else if (src === 3) split.pending += 1;
        else split.missing += 1;
        const v = q ? q[at] : null;
        if (v !== null && v !== undefined) values.push(v as number);
      }
      values.sort((a, b) => a - b);
      return {
        kind,
        unit,
        n: values.length,
        sum: values.length ? values.reduce((s, v) => s + v, 0) : null,
        min: values.length ? values[0] : null,
        median: median(values),
        max: values.length ? values[values.length - 1] : null,
        split,
      };
    });
  }

  // ── requirements and IDS ───────────────────────────────────────────────
  const reqs: ReqLine[] = [];
  if (board) {
    const hits = (funn: { guid: string; grunn: string }[]) => {
      const g = new Set<string>();
      const codes: string[] = [];
      for (const f of funn) {
        if (!inType.has(f.guid) || g.has(f.guid)) continue;
        g.add(f.guid);
        codes.push(shownFinding(f).grunn);
      }
      return { failed: g.size, grunn: tally(codes) };
    };
    const seen = new Set<string>();
    for (const r of requirements(board.rows)) {
      const h = r.row ? hits(r.row.funn ?? []) : { failed: 0, grunn: [] };
      reqs.push({ id: r.row?.id ?? r.key, label: r.label, group: r.group, state: r.state, ...h, focus: r.focus });
      if (r.row) seen.add(r.row.id);
      if (r.second) seen.add(r.second.id);
      if (r.second) {
        const s = hits(r.second.funn ?? []);
        if (s.failed > 0) reqs.push({ id: r.second.id, label: null, group: r.group, state: r.second.state, ...s, focus: focusOfRow(r.second) });
      }
    }
    for (const row of board.rows) {
      if (seen.has(row.id)) continue;
      const h = hits(row.funn ?? []);
      if (h.failed > 0) reqs.push({ id: row.id, label: null, group: null, state: row.state, ...h, focus: focusOfRow(row) });
    }
  }
  const idsLines: IdsLine[] | null = ids
    ? ids.specs.map((spec) => {
        const failed = new Set<string>();
        for (const f of spec.findings) {
          if (inType.has(f.guid)) failed.add(f.guid);
          else if (card.typeGuids.includes(f.guid)) for (const g of guids) failed.add(g);
          for (const m of f.members ?? []) if (inType.has(m)) failed.add(m);
        }
        return { index: spec.index, name: spec.name, state: spec.state, failed: failed.size, focus: { kind: "ids", index: spec.index } as Focus };
      })
    : null;

  // ── the instances, in the navigator's order ────────────────────────────
  const statusOf = (guid: string): string | null => {
    const groups = psets?.get(guid) ?? [];
    const read = (test: (set: string, name: string) => boolean) => {
      for (const g of groups) for (const p of g.properties) if (test(g.name, p.name) && !blank(p.value)) return p.value;
      return null;
    };
    const std = read((set, name) => COMMON.test(set) && name === "Status");
    if (std !== null) return std;
    for (const s of phaseSrc) {
      const v = read((set, name) => set === s.set && name === s.name);
      if (v !== null) return v;
    }
    return null;
  };
  const instances: InstanceRow[] = guids.map((guid) => {
    const r = rowOf.get(guid);
    return {
      guid,
      name: r?.name ?? null,
      tag: r?.tag ?? null,
      storey: r?.storeyGuid ? (storeyName.get(r.storeyGuid) ?? null) : null,
      model,
      mmi: mmi.byGuid.get(guid) ?? null,
      copy: copy.byGuid.get(guid) ?? null,
      status: statusOf(guid),
      q: quantities?.byGuid[guid] ?? null,
    };
  });

  return {
    key: card.key,
    entity: card.entity,
    typeName: card.typeName,
    source: card.source,
    count,
    typeGuids: card.typeGuids,
    typeClass: tally(rows.map((r) => r.typeEntity ?? null)),
    predefined: tally(rows.map((r) => (blank(r.predefinedType) ? null : r.predefinedType!))),
    objectType: tally(rows.map((r) => (blank(r.objectType) ? null : r.objectType!))),
    codes: input.codes ?? null,
    classifications,
    stacks,
    direct,
    nmat,
    typeProps,
    instanceProps,
    readings: [mmi.reading, copy.reading],
    required: req,
    storeys,
    models: [{ value: model, n: count }],
    qto,
    qtoComplete: quantities?.complete ?? false,
    reqs,
    ids: idsLines,
    instances,
  };
}
