/** The report contract: one row per requirement × model, the shape the
 * mottakskontroll report builder reads (Ed-Skiplum/ifc-check#1, gap 1).
 *
 * A MAPPING of what the engine already computed, never a second engine: the
 * fundamentals, `storey-config`, `mesh-placement` and the ruleset's rules are
 * run elsewhere and their results are re-expressed here. Where a field cannot
 * be computed honestly from those results it is `null`, never a zero and
 * never a guess. AGENTS.md "Report contract" lists every null and why.
 *
 * Vocabulary (from the HI90 report framework, `docs/begreper.md`):
 *   dekning   whether the value is there. grunnlag = the objects judged,
 *             oppfylt + avvik + mangler = grunnlag whenever all three are set.
 *             mangler = not there; avvik = there, but not an acceptable value;
 *             gjelder_ikke = objects taken out of scope before judging (the
 *             copy-object filter, elements without geometry).
 *   kilder    every source the requirement reads, 0 hits included, tagged
 *             `standard` (where the IFC standard puts it) or `prosjekt` (a
 *             project's own property). The first is `foretrukket`.
 *   fordeling every distinct value found, uncollapsed, with its flag.
 *   funn      one row per finding: `grunn` is a stable CODE, never prose, so
 *             the report renders it in its own language.
 *
 * `state` has six values. `not_configured` is not `not_applicable`: it is a
 * requirement with no home in the IFC standard and no project config (MMI,
 * Kopiobjekt, the floor list), which is a statement about the configuration,
 * not about the file.
 */

import { physicalProducts, verdictOf } from "./fundamentals.ts";
import { standardLayerRows } from "./standard-layer.ts";
import type { CheckResult, Finding, IfcGraph, IfcSummary } from "./types";
import type { ModelResult, RuleResult, ValueCount, Finding as RuleFinding } from "../ids/evaluate.ts";
import type { CodeSource, MappingRole, Rule, Ruleset, Selector } from "../ids/types.ts";

export type ReportState =
  | "pass"
  | "warn"
  | "fail"
  | "not_applicable"
  | "not_evaluable"
  | "not_configured";

export type ReportLayer = "standard" | "prosjekt";

export interface ReportSource {
  navn: string;
  lag: ReportLayer;
  /** Objects this source answered for. null = the engine does not count it. */
  n: number | null;
  foretrukket: boolean;
  /** Which branch of a switched requirement the source belongs to, on the
   *  `material-product` row only: `mengdetype` (what decided the switch),
   *  `telleobjekt` (product) or `mengdeobjekt` (material). `foretrukket` is
   *  then the first source of its branch. */
  gren?: "mengdetype" | "telleobjekt" | "mengdeobjekt";
}

export interface ReportCoverage {
  grunnlag: number | null;
  grunnlag_klasse: string | null;
  oppfylt: number | null;
  avvik: number | null;
  mangler: number | null;
  gjelder_ikke: number | null;
  kilder: ReportSource[];
}

/** `åpen` marks objects whose reading rests on an open ruling (the
 *  `material-product` row): decided by a table row edkjo has not settled. */
export type ReportFlag = "" | "avvik" | "mangler" | "åpen";

export interface ReportValue {
  /** null = the objects carried no value. */
  verdi: string | null;
  n: number;
  flagg: ReportFlag;
}

export interface ReportFinding {
  guid: string;
  klasse: string;
  /** A stable code: the engine's ReasonCode, or the rule finding's code. */
  grunn: string;
  verdi: string | null;
}

export interface ReportModel {
  file: string;
  schema: string;
  sha256: string;
}

export interface ReportRow {
  model: ReportModel;
  id: string;
  /** Set on a project-mapping row: the role, since a rule's `id` is cosmetic. */
  mapping?: MappingRole;
  state: ReportState;
  /** Why the row is not_applicable / not_evaluable / not_configured, in the
   *  engine's own (English) words. Absent otherwise. */
  grunn?: string;
  /** The accepted values, on a standard-layer row that judges against a
   *  list (`ifc-schema`, `phase`): the standard's, or the project layer's
   *  replacement. Absent otherwise. */
  godtatte?: string[];
  /** On `material-product` only: every open ruling on the mengdetype tables,
   *  with the in-scope objects whose mengdetype one of its classes decided.
   *  `n` is null for a ruling with no class, which cannot be told apart per
   *  object. */
  aapne?: { tittel: string; klasser: string[]; n: number | null }[];
  dekning: ReportCoverage;
  /** null = the engine does not produce a distribution for this requirement. */
  fordeling: ReportValue[] | null;
  funn: ReportFinding[];
}

export interface ReportInput {
  model: ReportModel;
  graph: IfcGraph;
  summary: IfcSummary;
  /** Fundamentals, `storey-config` and `mesh-placement`, run with the same
   *  copy-object exclusions as `excluded`. */
  checks: CheckResult[];
  ruleset?: Ruleset | null;
  /** `evaluateRuleset` over the same model, when a ruleset was given. */
  evaluation?: ModelResult | null;
}

/** The two project mappings with no home in the IFC standard. Without a
 *  project config they are `not_configured` rows, never absent: a report that
 *  drops them cannot tell "not asked" from "not there". */
const NO_IFC_HOME: MappingRole[] = ["progress-code", "copy-object"];

const NULL_COVERAGE: ReportCoverage = {
  grunnlag: null,
  grunnlag_klasse: null,
  oppfylt: null,
  avvik: null,
  mangler: null,
  gjelder_ikke: null,
  kilder: [],
};

/* ---------------------------------------------------------------- helpers */

function source(navn: string, n: number | null, lag: ReportLayer = "standard"): ReportSource {
  return { navn, lag, n, foretrukket: true };
}

/** Count values into a fordeling, most frequent first, then by value. */
function tallyValues(
  values: Iterable<string | null>,
  flag: (value: string | null, n: number) => ReportFlag = () => "",
): ReportValue[] {
  const counts = new Map<string | null, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return sortValues([...counts].map(([verdi, n]) => ({ verdi, n, flagg: flag(verdi, n) })));
}

function sortValues(rows: ReportValue[]): ReportValue[] {
  return rows.sort((a, b) => b.n - a.n || String(a.verdi ?? "").localeCompare(String(b.verdi ?? "")));
}

const str = (v: string | number | undefined): string | null => (v === undefined ? null : String(v));

/** The value a fundamental's finding carries, per reason code. */
function findingValue(f: Finding, graph: IfcGraph, unitScale: number): string | null {
  const p = f.params ?? {};
  switch (f.code) {
    case "storey-mismatch":
      return str(p.delta);
    case "far-from-model":
      return str(p.distance);
    case "placeholder-type-name":
    case "single-instance-type":
      return str(p.typeName);
    case "guid-duplicate":
    case "duplicate-step-ids":
    case "storey-count-exceeds":
      return str(p.count);
    case "parser-warning":
      return str(p.message);
    case "type-unused":
      return f.name;
    case "shared-elevation": {
      const storey = graph.storeys.find((s) => s.guid === f.guid);
      return storey?.elevation == null ? null : (storey.elevation * unitScale).toFixed(3);
    }
    case "storey-not-in-config":
    case "storey-name-mismatch":
    case "storey-name-whitespace":
      return str(p.storey);
    case "storey-elevation-mismatch":
      return str(p.elevation);
    case "storey-duplicate-match":
      return str(p.config);
    default:
      return null;
  }
}

function funnOf(check: CheckResult, graph: IfcGraph, unitScale: number): ReportFinding[] {
  return check.findings.map((f) => ({
    guid: f.guid,
    klasse: f.entity,
    // Yellow and red share one ReasonCode in the engine (the UI renders one
    // sentence for both); the contract keeps them apart.
    grunn:
      f.code === "storey-mismatch" && f.params?.band ? `storey-mismatch-${f.params.band}` : f.code,
    verdi: findingValue(f, graph, unitScale),
  }));
}

function stateOf(check: CheckResult): ReportState {
  const verdict = verdictOf(check);
  return verdict === "na" ? "not_applicable" : verdict;
}

/* ---------------------------------------------------------- fundamentals */

function fundamentalRow(
  check: CheckResult,
  input: ReportInput,
  excluded: ReadonlySet<string> | undefined,
): ReportRow {
  const { graph, summary, model } = input;
  const f = check.findings.length;
  const a = check.applicable;
  const base: ReportRow = {
    model,
    id: check.id,
    state: stateOf(check),
    dekning: { ...NULL_COVERAGE, kilder: [] },
    fordeling: null,
    funn: funnOf(check, graph, summary.unit_scale),
  };
  if (check.state === "not_applicable" && check.reason) base.grunn = check.reason;

  const inScope = physicalProducts(graph, excluded);
  const outOfScope = physicalProducts(graph).length - inScope.length;
  const products = (oppfylt: number, avvik: number, mangler: number, kilde: ReportSource): ReportCoverage => ({
    grunnlag: a,
    grunnlag_klasse: "IfcProduct",
    oppfylt,
    avvik,
    mangler,
    gjelder_ikke: outOfScope,
    kilder: [kilde],
  });

  switch (check.id) {
    case "parse-integrity":
      // A file-level check: nothing is covered, so every count is null.
      return base;

    case "spatial-chain": {
      const levels: [string, number][] = [
        ["IfcProject", graph.projects.length],
        ["IfcSite", graph.sites.length],
        ["IfcBuilding", graph.buildings.length],
        ["IfcBuildingStorey", graph.storeys.length],
      ];
      return {
        ...base,
        dekning: { ...NULL_COVERAGE, grunnlag: a, oppfylt: a - f, avvik: 0, mangler: f, gjelder_ikke: 0, kilder: [] },
        fordeling: levels.map(([verdi, n]) => ({ verdi, n, flagg: n === 0 ? "mangler" : "" })),
      };
    }

    case "storey-containment": {
      // Same test as the check (`storey_guid`, resolved through aggregate
      // parents), so null here = its findings. kilder splits direct rows
      // from those reached through IfcRelAggregates.
      const direct = new Set(graph.contained_in.map((c) => c.product_guid));
      const byStorey = new Map(graph.storeys.map((s) => [s.guid, s.name ?? s.guid]));
      const counts = new Map<string, number>();
      for (const s of graph.storeys) counts.set(s.name ?? s.guid, 0);
      let none = 0;
      let viaDirect = 0;
      for (const p of inScope) {
        const at = p.storey_guid;
        if (at == null) {
          none += 1;
          continue;
        }
        if (direct.has(p.guid)) viaDirect += 1;
        const storey = byStorey.get(at) ?? at;
        counts.set(storey, (counts.get(storey) ?? 0) + 1);
      }
      const fordeling: ReportValue[] = sortValues([...counts].map(([verdi, n]) => ({ verdi, n, flagg: "" })));
      if (none > 0) fordeling.push({ verdi: null, n: none, flagg: "mangler" });
      return {
        ...base,
        dekning: {
          ...products(a - f, 0, f, source("IfcRelContainedInSpatialStructure", viaDirect)),
          kilder: [
            source("IfcRelContainedInSpatialStructure", viaDirect),
            { ...source("IfcRelAggregates", a - f - viaDirect), foretrukket: false },
          ],
        },
        fordeling,
      };
    }

    case "storey-in-building": {
      const linked = new Map(graph.storey_building.map((sb) => [sb.storey_guid, sb.building_guid]));
      const buildingName = new Map(graph.buildings.map((b) => [b.guid, b.name ?? b.guid]));
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcBuildingStorey",
          oppfylt: a - f,
          avvik: 0,
          mangler: f,
          gjelder_ikke: 0,
          kilder: [source("IfcRelAggregates", a - f)],
        },
        fordeling: tallyValues(
          graph.storeys.map((s) => {
            const b = linked.get(s.guid);
            return b === undefined ? null : (buildingName.get(b) ?? b);
          }),
          (v) => (v === null ? "mangler" : ""),
        ),
      };
    }

    case "storey-elevation": {
      const total = graph.storeys.length;
      const withElevation = graph.storeys.filter((s) => s.elevation !== null).length;
      return {
        ...base,
        dekning: {
          grunnlag: total,
          grunnlag_klasse: "IfcBuildingStorey",
          oppfylt: withElevation - f,
          avvik: f,
          mangler: total - withElevation,
          gjelder_ikke: 0,
          kilder: [source("IfcBuildingStorey.Elevation", withElevation)],
        },
        // Metres, three decimals, after unit_scale (ifcfast#180).
        fordeling: tallyValues(
          graph.storeys.map((s) =>
            s.elevation === null ? null : (s.elevation * summary.unit_scale).toFixed(3),
          ),
          (v, n) => (v === null ? "mangler" : n > 1 ? "avvik" : ""),
        ),
      };
    }

    case "guid-unique": {
      const all = excluded ? graph.products.filter((p) => !excluded.has(p.guid)) : graph.products;
      const seen = new Map<string, number>();
      for (const p of all) seen.set(p.guid, (seen.get(p.guid) ?? 0) + 1);
      // The distribution of GlobalId multiplicity, counted in objects: "1" is
      // the objects whose GlobalId is theirs alone, "2" the objects in pairs.
      const byMultiplicity = new Map<number, number>();
      for (const k of seen.values()) byMultiplicity.set(k, (byMultiplicity.get(k) ?? 0) + k);
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcProduct",
          oppfylt: a - f,
          avvik: f,
          mangler: 0,
          gjelder_ikke: graph.products.length - all.length,
          kilder: [source("IfcRoot.GlobalId", a)],
        },
        fordeling: sortValues(
          [...byMultiplicity].map(([k, n]) => ({ verdi: String(k), n, flagg: k > 1 ? "avvik" : "" })),
        ),
      };
    }

    case "element-named":
      return {
        ...base,
        dekning: products(a - f, 0, f, source("IfcRoot.Name", a - f)),
        fordeling: tallyValues(
          inScope.map((p) => (p.name && p.name.trim() !== "" ? p.name : null)),
          (v) => (v === null ? "mangler" : ""),
        ),
      };

    case "element-typed":
      return {
        ...base,
        dekning: products(a - f, 0, f, source("IfcRelDefinesByType", a - f)),
        // Untyped = null (mangler); typed with an unnamed type = "".
        fordeling: tallyValues(
          inScope.map((p) => (p.typed ? (p.type_name ?? "") : null)),
          (v) => (v === null ? "mangler" : ""),
        ),
      };

    case "type-name-placeholder": {
      const flagged = new Set(check.findings.map((x) => String(x.params?.typeName ?? "")));
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcProduct",
          oppfylt: a - f,
          avvik: f,
          mangler: 0,
          // Elements with no named type are outside this check's selection.
          gjelder_ikke: inScope.length - a + outOfScope,
          kilder: [source("IfcTypeObject.Name", a)],
        },
        fordeling: tallyValues(
          inScope.filter((p) => p.typed && p.type_name).map((p) => p.type_name as string),
          (v) => (flagged.has(v ?? "") ? "avvik" : ""),
        ),
      };
    }

    case "single-instance-types":
      return {
        ...base,
        dekning: {
          grunnlag: a,
          // Keyed by type NAME, as the check counts (see AGENTS.md "Three
          // numbers about types").
          grunnlag_klasse: "IfcTypeObject",
          oppfylt: a - f,
          avvik: f,
          mangler: 0,
          gjelder_ikke: 0,
          kilder: [source("IfcRelDefinesByType", a)],
        },
        fordeling: tallyValues(
          inScope.filter((p) => p.typed && p.type_name).map((p) => p.type_name as string),
          (_, n) => (n === 1 ? "avvik" : ""),
        ),
      };

    case "type-unused": {
      if (graph.type_objects === undefined) return base;
      const uses = new Map<string, number>();
      for (const p of graph.products) if (p.type_guid) uses.set(p.type_guid, (uses.get(p.type_guid) ?? 0) + 1);
      // Instances per declared type, merged by type Name; 0 is the unused.
      const byName = new Map<string, number>();
      for (const t of graph.type_objects) {
        const key = t.name ?? "";
        byName.set(key, (byName.get(key) ?? 0) + (uses.get(t.guid) ?? 0));
      }
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcTypeObject",
          oppfylt: a - f,
          avvik: f,
          mangler: 0,
          gjelder_ikke: 0,
          kilder: [source("IfcRelDefinesByType", a - f)],
        },
        fordeling: sortValues(
          [...byName].map(([verdi, n]) => ({ verdi, n, flagg: n === 0 ? "avvik" : "" })),
        ),
      };
    }

    case "element-material":
      return {
        ...base,
        dekning: products(a - f, 0, f, source("IfcRelAssociatesMaterial", a - f)),
        // An object with several materials counts once under each.
        fordeling: tallyValues(
          inScope.flatMap((p) => (p.materials && p.materials.length ? p.materials : [null])),
          (v) => (v === null ? "mangler" : ""),
        ),
      };

    case "storey-config": {
      if (check.state === "not_applicable" && check.reason === "no floor config loaded") {
        return { ...base, state: "not_configured" };
      }
      if (check.state === "not_applicable" && check.reason?.startsWith("length unit unresolved")) {
        return { ...base, state: "not_evaluable" };
      }
      if (check.state === "not_applicable") return base;
      const off = new Set(check.findings.map((x) => x.guid));
      const bad = graph.storeys.filter((s) => off.has(s.guid)).length;
      const flaggedNames = new Set(graph.storeys.filter((s) => off.has(s.guid)).map((s) => s.name ?? s.guid));
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcBuildingStorey",
          oppfylt: a - bad,
          avvik: bad,
          mangler: 0,
          gjelder_ikke: 0,
          kilder: [source("IfcBuildingStorey", a)],
        },
        fordeling: tallyValues(
          graph.storeys.map((s) => s.name ?? s.guid),
          (v) => (flaggedNames.has(v ?? "") ? "avvik" : ""),
        ),
      };
    }

    case "mesh-placement": {
      const t = check.tally;
      if (!t) {
        // No geometry: the answer is unknown, not absent.
        return { ...base, state: "not_evaluable", grunn: check.reason ?? "no geometry" };
      }
      const gjelder = t.unmeshed + outOfScope;
      const kilder = [source("IfcRelContainedInSpatialStructure", t.band_ran ? t.green + t.yellow + t.red : null)];
      if (!t.band_ran) {
        // The storey half refused to run: only the far half is known.
        const detail = check.detail.split("; ")[1] ?? check.detail;
        return {
          ...base,
          state: t.far > 0 ? "fail" : "not_evaluable",
          grunn: detail,
          dekning: { ...NULL_COVERAGE, grunnlag: a, grunnlag_klasse: "IfcProduct", gjelder_ikke: gjelder, kilder },
        };
      }
      const fordeling: ReportValue[] = [
        { verdi: "green", n: t.green, flagg: "" },
        { verdi: "yellow", n: t.yellow, flagg: "avvik" },
        { verdi: "red", n: t.red, flagg: "avvik" },
      ];
      if (t.far > 0) fordeling.push({ verdi: "far-from-model", n: t.far, flagg: "avvik" });
      if (t.no_storey > 0) fordeling.push({ verdi: null, n: t.no_storey, flagg: "mangler" });
      return {
        ...base,
        dekning: {
          grunnlag: a,
          grunnlag_klasse: "IfcProduct",
          oppfylt: t.green,
          avvik: t.yellow + t.red + t.far,
          mangler: t.no_storey,
          gjelder_ikke: gjelder,
          kilder,
        },
        fordeling,
      };
    }

    default:
      return base;
  }
}

/* ----------------------------------------------------------------- rules */

const GROUP_CLASS: Record<string, string> = {
  product: "IfcProduct",
  element: "IfcElement",
  distributionElement: "IfcDistributionElement",
  spatialElement: "IfcSpatialElement",
  featureElement: "IfcFeatureElement",
  elementType: "IfcElementType",
  typeProduct: "IfcTypeProduct",
  group: "IfcGroup",
};

/** The class a rule's population is, when it is one class; null otherwise
 *  (several classes, a group with no single IFC supertype, no selection). */
function selectorClass(select: Selector | undefined): string | null {
  const entity = select?.entity;
  if (!entity) return null;
  if (entity.classes && entity.classes.length === 1) return entity.classes[0];
  if (entity.group) return GROUP_CLASS[entity.group] ?? null;
  return null;
}

/** The IFC standard's own homes are `standard`; anything else a project
 *  declared. A property set named `Pset_*` / `Qto_*` is the standard's. */
function sourceOf(src: CodeSource): { navn: string; lag: ReportLayer } {
  if ("attribute" in src) return { navn: src.attribute, lag: "standard" };
  if ("property" in src) {
    const set = src.property.propertySet;
    return {
      navn: `${set}.${src.property.name}`,
      lag: /^(Pset_|Qto_)/.test(set) ? "standard" : "prosjekt",
    };
  }
  const system = src.classification.system;
  return {
    navn: system === undefined ? "IfcClassificationReference" : `IfcClassificationReference ${system}`,
    lag: "standard",
  };
}

const FLAG_OF: Record<ValueCount["state"], ReportFlag> = { ok: "", deviating: "avvik", missing: "mangler" };

function ruleFunn(findings: RuleFinding[]): ReportFinding[] {
  return findings.map((f) => ({
    guid: f.guid,
    klasse: f.entity,
    grunn: f.code ?? f.reason,
    verdi: f.value ?? null,
  }));
}

function ruleRow(rule: Rule, result: RuleResult, input: ReportInput, excludedAny: boolean): ReportRow {
  const row: ReportRow = {
    model: input.model,
    id: result.ruleId,
    ...(rule.kind === "extended" && rule.mapping ? { mapping: rule.mapping } : {}),
    state: result.state,
    dekning: { ...NULL_COVERAGE, kilder: [] },
    fordeling: null,
    funn: ruleFunn(result.findings),
  };
  if (result.state === "not_evaluable") {
    row.grunn = result.reason ?? result.detail;
    return row;
  }
  if (result.state === "not_applicable") {
    row.grunn = result.reason ?? result.detail;
  }

  const a = result.applicable;
  const gjelderIkke = excludedAny ? null : 0;
  const cov = result.coverage;
  let klasse: string | null;
  let kilder: ReportSource[] = [];
  let oppfylt: number | null = a - result.failed;
  let avvik: number | null = null;
  let mangler: number | null = null;

  if (rule.kind === "ids") {
    klasse = selectorClass(rule.applicability);
    // Occurrence-bound findings are about the selection, not an element.
    const bound = result.findings.filter((f) => f.code === "occurrence-bounds").length;
    oppfylt = a - (result.failed - bound);
  } else {
    const check = rule.check;
    klasse =
      check.type === "model-metadata"
        ? null
        : check.type === "code-lookup" && check.target === "type"
          ? "IfcTypeObject"
          : selectorClass(rule.select);
    if (check.type === "code-lookup") {
      const s = sourceOf(check.source);
      kilder = [{ ...s, n: cov ? cov.sourceHits : null, foretrukket: true }];
    } else if (check.type === "element-typed") {
      kilder = [source("IfcRelDefinesByType", cov ? cov.sourceHits : null)];
    } else if (check.type === "type-usage-count") {
      kilder = [source("IfcRelDefinesByType", null)];
    } else if (check.type === "unique-attribute") {
      kilder = [source(check.attribute, null)];
      avvik = result.failed;
    } else if (check.type === "model-metadata") {
      kilder = [source(check.field, cov ? cov.sourceHits : null)];
    }
    if (check.type === "type-usage-count") avvik = result.failed;
  }
  if (cov) {
    oppfylt = cov.met;
    avvik = cov.deviating;
    mangler = cov.missing;
  } else if (a === 0) {
    // Nothing matched: every split of zero is zero, which is a count, not a guess.
    avvik = 0;
    mangler = 0;
  }
  row.dekning = {
    grunnlag: a,
    grunnlag_klasse: klasse,
    oppfylt,
    avvik,
    mangler,
    gjelder_ikke: gjelderIkke,
    kilder,
  };
  if (result.values) {
    row.fordeling = result.values.map((v) => ({ verdi: v.value, n: v.n, flagg: FLAG_OF[v.state] }));
  }
  return row;
}

/* ------------------------------------------------------------------ entry */

/** Every row for one model: the engine's checks in their own order, then the
 *  standard-layer rows (`ifc-schema`, `phase`), then the ruleset's enabled rules in the ruleset's order, then a `not_configured` row
 *  for each no-IFC-home mapping the ruleset does not configure. */
export function reportRows(input: ReportInput): ReportRow[] {
  const excludedList = input.evaluation?.excludedGuids;
  const excluded = excludedList && excludedList.length ? new Set(excludedList) : undefined;
  const rows = input.checks.map((check) => fundamentalRow(check, input, excluded));
  rows.push(
    ...standardLayerRows({
      model: input.model,
      graph: input.graph,
      excluded,
      ruleset: input.ruleset,
    }),
  );

  const rules = input.ruleset?.rules ?? [];
  for (const result of input.evaluation?.results ?? []) {
    const rule = rules.find((r) => r.id === result.ruleId);
    if (rule) rows.push(ruleRow(rule, result, input, excluded !== undefined));
  }

  for (const role of NO_IFC_HOME) {
    const configured = rules.some(
      (r) => r.kind === "extended" && r.mapping === role && r.enabled !== false,
    );
    if (configured) continue;
    rows.push({
      model: input.model,
      id: role,
      mapping: role,
      state: "not_configured",
      grunn: "no home in the IFC standard and no project mapping configured",
      dekning: { ...NULL_COVERAGE, kilder: [] },
      fordeling: null,
      funn: [],
    });
  }
  return rows;
}

/** The CLI exit code for a set of rows, on the ids-cli scale: 1 when any row
 *  failed, else 3 when any is not_evaluable, else 0. `warn` and
 *  `not_configured` are answers, not failures and not unknowns. */
export function reportExitCode(rows: readonly ReportRow[]): 0 | 1 | 3 {
  if (rows.some((r) => r.state === "fail")) return 1;
  if (rows.some((r) => r.state === "not_evaluable")) return 3;
  return 0;
}
