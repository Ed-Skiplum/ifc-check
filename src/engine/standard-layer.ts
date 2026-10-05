/** The standard layer: requirements whose home the IFC standard itself names,
 * shipped with the tool and the same for every project, with a ruleset's
 * `projectLayer` on top (Ed-Skiplum/ifc-check#1, gaps 1, 2 and 4).
 *
 * Modelled on the HI90 mottakskontroll's standard.yaml + krav.yaml, merged by
 * its konfig.py: per requirement, the project's sources are APPENDED after the
 * standard's, so a standard source is always the preferred one and a value
 * found only through project config shows its layer in `kilder`; a list of
 * accepted values the project sets REPLACES the standard's.
 *
 *   ifc-schema  FILE_SCHEMA, folded to its family, against [IFC2X3, IFC4].
 *   phase       Pset_*Common.Status (PEnum_ElementStatus) against
 *               NEW / EXISTING / DEMOLISH / TEMPORARY, then the project's
 *               sources in order.
 *   material-product  Materiale / Produkt, switched by mengdetype (gap 3):
 *               a telleobjekt needs a product, a mengdeobjekt a material.
 *
 * These are report rows (src/engine/report.ts), not fundamentals: nothing
 * here reaches the screen.
 */

import { physicalProducts } from "./fundamentals.ts";
import type { IfcGraph, MaterialRow, ProductRow } from "./types";
import { MENGDETYPE_AAPNE } from "../codelists/mengdetype-ifcklasse.ts";
import { DEFAULT_ACCEPTED_SCHEMAS } from "../ids/lint.ts";
import { cascadeReader, compileExtract, SourceUnreachable, type CascadeSource } from "../ids/evaluate.ts";
import { roleRule } from "../ids/models.ts";
import {
  CLASS_ROWS,
  DECISIVE,
  NS3457_SYSTEM,
  codeRow,
  NOT_A_MATERIAL,
  PHASE_ACCEPTED,
  STANDARD_SOURCES,
  phaseAccepted,
  projectMengdetype,
  usableMaterial,
} from "./standard-sources.ts";
import type { ModelGraph, ModelProduct } from "../ids/model.ts";
import type { CodeSource, PhaseSource, Ruleset } from "../ids/types.ts";
import type {
  ReportCoverage,
  ReportFinding,
  ReportLayer,
  ReportModel,
  ReportRow,
  ReportSource,
  ReportValue,
} from "./report.ts";

/* ------------------------------------------------------------ ifc-schema */

/** The schema family a FILE_SCHEMA belongs to, as HI90's `skjema_grunn`:
 *  the leading `IFC<n>` with an optional `X<n>`. So «IFC4 ADD2 TC1» and
 *  `IFC4ADD2` are IFC4, while IFC4X3_ADD2 is its own family, IFC4X3. Empty
 *  when the value does not start with a schema name. */
export function schemaFamily(written: string): string {
  const m = /^\s*(IFC\d+(?:X\d+)?)/i.exec(written ?? "");
  return m ? m[1].toUpperCase() : "";
}

function schemaRow(model: ReportModel, ruleset: Ruleset | null | undefined): ReportRow {
  const layer = ruleset?.projectLayer?.["ifc-schema"];
  const accepted = layer?.accepted ?? [...DEFAULT_ACCEPTED_SCHEMAS];
  const recommended = layer?.recommended;
  const written = (model.schema ?? "").trim();
  const family = schemaFamily(written);
  const ok = family !== "" && accepted.includes(family);
  // Accepted but not recommended: usable («Kan brukes»), a warn with the
  // value unflagged. Without a recommended list, accepted passes as before.
  const usableOnly = ok && recommended !== undefined && !recommended.includes(family);
  const kilder: ReportSource[] = [
    { navn: "FILE_SCHEMA", lag: "standard", n: written ? 1 : 0, foretrukket: true },
  ];
  const dekning: ReportCoverage = {
    grunnlag: 1,
    // The population is the file itself, which has no IFC class.
    grunnlag_klasse: null,
    oppfylt: ok ? 1 : 0,
    avvik: written && !ok ? 1 : 0,
    mangler: written ? 0 : 1,
    gjelder_ikke: 0,
    kilder,
  };
  return {
    model,
    id: "ifc-schema",
    // Not on the accepted list is a warn, as in the HI90 reference: the file is
    // readable, it is the wrong exchange for this project. No schema at all is
    // a fail.
    state: ok && !usableOnly ? "pass" : written ? "warn" : "fail",
    godtatte: accepted,
    ...(recommended !== undefined ? { anbefalte: [...recommended] } : {}),
    dekning,
    fordeling: written ? [{ verdi: written, n: 1, flagg: ok ? "" : "avvik" }] : [{ verdi: null, n: 1, flagg: "mangler" }],
    funn: [],
  };
}

/* ---------------------------------------------------------------- phase */

export { NOT_A_MATERIAL, PHASE_ACCEPTED };

interface NamedSource {
  navn: string;
  lag: ReportLayer;
  source: CascadeSource;
  /** Set on a source that reads through a table rather than as written:
   *  the phase of the object's MMI code. */
  read?: (reader: CascadeReader, p: ModelProduct) => Reading;
}

type CascadeReader = ReturnType<typeof cascadeReader>;

/** The phase through the MMI code: the progress-code rule's source, its
 *  extract, then the code's `phase`. A code with a phase is that phase,
 *  accepted. A value with no phase (no match, not in the table, or a code
 *  the table gives none) is carried but not accepted: the raw value, avvik.
 *  No value is nothing. */
function progressCodePhase(ruleset: Ruleset | null | undefined): NamedSource | null {
  const rule = roleRule(ruleset, "progress-code");
  const check = rule?.check;
  if (!check || check.type !== "code-lookup" || !check.codes) return null;
  const phases = new Map(check.codes.filter((c) => c.phase).map((c) => [c.code, c.phase as string]));
  const regex = compileExtract(check.extract);
  return {
    navn: `${codeSourceName(check.source)} (progress-code)`,
    lag: "prosjekt",
    source: check.source,
    read: (reader, p) => {
      const raw = reader.read(check.source, p);
      if (raw === null || raw.trim() === "") return { value: null };
      const code = regex.exec(raw)?.[1];
      const phase = code === undefined ? undefined : phases.get(code);
      return phase === undefined ? { value: raw, accepted: false } : { value: phase, accepted: true };
    },
  };
}

const PHASE_STANDARD: NamedSource = {
  navn: STANDARD_SOURCES.phase[0],
  lag: "standard",
  source: {
    propertyMatch: { propertySet: { restriction: { pattern: "Pset_\\w*Common" } }, name: "Status" },
  },
};

function codeSourceName(src: CodeSource): string {
  if ("attribute" in src) return src.attribute;
  if ("property" in src) return `${src.property.propertySet}.${src.property.name}`;
  if ("material" in src) return "IfcRelAssociatesMaterial";
  const system = src.classification.system;
  return system === undefined ? "IfcClassificationReference" : `IfcClassificationReference ${system}`;
}

/** What one source read off one object: the value, and whether it is an
 *  accepted one. A source whose acceptance is its own (the MMI phase table)
 *  says so; otherwise the row's accepted list decides. */
interface Reading {
  value: string | null;
  accepted?: boolean;
}

/** The outcome of walking a cascade for one object. */
interface Decision {
  state: "oppfylt" | "avvik" | "mangler";
  /** Index of the source that decided it; -1 for mangler. */
  source: number;
  value: string | null;
}

/** Walk the sources in order, as HI90's blokkdata does for fase: the first
 *  source carrying an ACCEPTED value decides oppfylt; failing that, the first
 *  source carrying any value decides avvik; no value anywhere is mangler. */
function decide(
  readings: Reading[],
  accepted: (v: string) => boolean,
): Decision {
  let firstCarried = -1;
  for (let i = 0; i < readings.length; i++) {
    const v = readings[i].value;
    if (v === null || v.trim() === "") continue;
    if (readings[i].accepted ?? accepted(v)) return { state: "oppfylt", source: i, value: v };
    if (firstCarried < 0) firstCarried = i;
  }
  if (firstCarried >= 0) return { state: "avvik", source: firstCarried, value: readings[firstCarried].value };
  return { state: "mangler", source: -1, value: null };
}

/** A cascade requirement over the in-scope physical products: one row, with
 *  every source in `kilder` (0 hits included), the full value distribution
 *  and one finding per object not oppfylt. */
function cascadeRow(args: {
  id: string;
  model: ReportModel;
  graph: IfcGraph;
  excluded: ReadonlySet<string> | undefined;
  sources: NamedSource[];
  accepted: readonly string[];
}): ReportRow {
  const { id, model, graph, excluded, sources, accepted } = args;
  const inScope = physicalProducts(graph, excluded);
  const outOfScope = physicalProducts(graph).length - inScope.length;
  const kilder: ReportSource[] = sources.map((s, i) => ({
    navn: s.navn,
    lag: s.lag,
    n: 0,
    foretrukket: i === 0,
  }));
  const base: ReportRow = {
    model,
    id,
    state: "not_evaluable",
    godtatte: [...accepted],
    dekning: {
      grunnlag: inScope.length,
      grunnlag_klasse: "IfcProduct",
      oppfylt: null,
      avvik: null,
      mangler: null,
      gjelder_ikke: outOfScope,
      kilder: sources.map((s, i) => ({ navn: s.navn, lag: s.lag, n: null, foretrukket: i === 0 })),
    },
    fordeling: null,
    funn: [],
  };
  if (inScope.length === 0) {
    return {
      ...base,
      state: "not_applicable",
      grunn: "no elements matched this check",
      dekning: { ...base.dekning, oppfylt: 0, avvik: 0, mangler: 0 },
    };
  }

  const reader = cascadeReader(graph as unknown as ModelGraph);
  const acceptedFolded = new Set(accepted.map((v) => v.toUpperCase()));
  const isAccepted = (v: string) => acceptedFolded.has(v.trim().toUpperCase());
  let oppfylt = 0;
  let avvik = 0;
  let mangler = 0;
  const tally = new Map<string | null, number>();
  const funn: ReportFinding[] = [];
  try {
    for (const p of inScope) {
      const product = p as unknown as ModelProduct;
      const readings = sources.map((s) => (s.read ? s.read(reader, product) : { value: reader.read(s.source, product) }));
      const d = decide(readings, isAccepted);
      if (d.source >= 0) (kilder[d.source].n as number)++;
      tally.set(d.value, (tally.get(d.value) ?? 0) + 1);
      if (d.state === "oppfylt") oppfylt++;
      else if (d.state === "avvik") {
        avvik++;
        funn.push({ guid: p.guid, klasse: p.entity, grunn: "not-in-list", verdi: d.value });
      } else {
        mangler++;
        funn.push({ guid: p.guid, klasse: p.entity, grunn: "empty", verdi: null });
      }
    }
  } catch (error) {
    if (error instanceof SourceUnreachable) return { ...base, grunn: error.message };
    throw error;
  }

  const fordeling: ReportValue[] = [...tally]
    .map(([verdi, n]) => ({
      verdi,
      n,
      flagg: (verdi === null ? "mangler" : isAccepted(verdi) ? "" : "avvik") as ReportValue["flagg"],
    }))
    .sort((a, b) => b.n - a.n || String(a.verdi ?? "").localeCompare(String(b.verdi ?? "")));
  return {
    ...base,
    // A missing or unusable phase is advisory, like a missing material: true
    // of the file, legitimate at some stage. The HI90 builder applies its own
    // thresholds to the counts.
    state: funn.length === 0 ? "pass" : "warn",
    dekning: { ...base.dekning, oppfylt, avvik, mangler, kilder },
    fordeling,
    funn,
  };
}

function phaseRow(
  model: ReportModel,
  graph: IfcGraph,
  excluded: ReadonlySet<string> | undefined,
  ruleset: Ruleset | null | undefined,
): ReportRow {
  const extra: PhaseSource[] = ruleset?.projectLayer?.phase?.sources ?? [];
  const sources: NamedSource[] = [PHASE_STANDARD];
  for (const source of extra) {
    if ("progressCode" in source) {
      // Lint refuses a progressCode source without a progress-code rule
      // carrying phases; an unlinted ruleset gets no source rather than a
      // guessed one.
      const through = progressCodePhase(ruleset);
      if (through) sources.push(through);
    } else sources.push({ navn: codeSourceName(source), lag: "prosjekt", source });
  }
  return cascadeRow({
    id: "phase",
    model,
    graph,
    excluded,
    sources,
    accepted: phaseAccepted(ruleset),
  });
}

/* ------------------------------------------------------ material-product */

// The tables' lookups (`CLASS_ROWS`, `codeRow`, `DECISIVE`) live in
// standard-sources.ts, shared with the type ledger's Ledeenhet.

type MaterialKind = "material" | "materiallag" | "";

/** The object's material association as HI90 reads it: its own rows, else
 *  those it inherits from its type; «materiallag» when a layer set has a layer
 *  thicker than zero, «material» for any other association, names folded per
 *  material in order. */
function materialOf(rows: MaterialRow[] | undefined): { kind: MaterialKind; names: string[] } {
  if (!rows || rows.length === 0) return { kind: "", names: [] };
  const own = rows.filter((r) => r.source !== "type");
  const use = own.length ? own : rows;
  const layered = use.some((r) => r.role === "layer" && (r.layer_thickness_mm ?? 0) > 0);
  const names: string[] = [];
  for (const r of use) {
    const n = (r.material_name ?? "").trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return { kind: layered ? "materiallag" : "material", names };
}

/** Materiale / Produkt, switched by mengdetype (HI90 begreper.md §6, blokkdata
 *  «6 Materiale / Produkt»). Per in-scope physical product:
 *
 *   1. mengdetype: the IFC class table, then the NS 3457 component code
 *      (IfcClassificationReference in a system naming 3457) against the code
 *      table, then the project's sources (a value `telleobjekt` /
 *      `mengdeobjekt`). The first decisive answer wins, so the class wins
 *      where both answer. `avhenger` is not decisive; with nothing decisive the
 *      class row's own value stands (`avhenger`, or `ukjent` for a class the
 *      table lacks).
 *   2. ikke_relevant is gjelder_ikke. A telleobjekt needs a product:
 *      Pset_ManufacturerTypeInformation.ModelReference, then ArticleNumber,
 *      then the project's sources; none is mangler. A mengdeobjekt needs a
 *      material: IfcMaterial, then a layer set, then the project's sources; a
 *      usable name is oppfylt, only unusable names is avvik, none is mangler.
 *      avhenger and ukjent have neither reading: mangler.
 *
 *  An object whose mengdetype the class table decided for a class under an
 *  open ruling counts toward that ruling: `aapne` on the row, and a fordeling
 *  entry flagged `åpen` per ruling that touches objects. */
function materialProductRow(
  model: ReportModel,
  graph: IfcGraph,
  excluded: ReadonlySet<string> | undefined,
  ruleset: Ruleset | null | undefined,
): ReportRow {
  const layer = ruleset?.projectLayer?.["material-product"];
  const project = (list: CodeSource[] | undefined): NamedSource[] =>
    (list ?? []).map((source) => ({ navn: codeSourceName(source), lag: "prosjekt", source }));
  const mengdetypeProject = project(layer?.mengdetype);
  const productSources: NamedSource[] = [
    { navn: STANDARD_SOURCES.product[0], lag: "standard",
      source: { property: { propertySet: "Pset_ManufacturerTypeInformation", name: "ModelReference" } } },
    { navn: STANDARD_SOURCES.product[1], lag: "standard",
      source: { property: { propertySet: "Pset_ManufacturerTypeInformation", name: "ArticleNumber" } } },
    ...project(layer?.product),
  ];
  const materialProject = project(layer?.material);

  const branch = (
    gren: NonNullable<ReportSource["gren"]>,
    names: { navn: string; lag: ReportLayer }[],
  ): ReportSource[] => names.map((s, i) => ({ navn: s.navn, lag: s.lag, n: 0, foretrukket: i === 0, gren }));
  const kMengdetype = branch("mengdetype", [
    { navn: STANDARD_SOURCES.mengdetype[0], lag: "standard" },
    { navn: STANDARD_SOURCES.mengdetype[1], lag: "standard" },
    ...mengdetypeProject,
  ]);
  const kProduct = branch("telleobjekt", productSources);
  const kMaterial = branch("mengdeobjekt", [
    { navn: STANDARD_SOURCES.material[0], lag: "standard" },
    { navn: STANDARD_SOURCES.material[1], lag: "standard" },
    ...materialProject,
  ]);
  const kilder = [...kMengdetype, ...kProduct, ...kMaterial];

  const inScope = physicalProducts(graph, excluded);
  const outOfScope = physicalProducts(graph).length - inScope.length;
  const base: ReportRow = {
    model,
    id: "material-product",
    state: "not_evaluable",
    dekning: {
      grunnlag: null,
      grunnlag_klasse: "IfcProduct",
      oppfylt: null,
      avvik: null,
      mangler: null,
      gjelder_ikke: null,
      kilder: kilder.map((k) => ({ ...k, n: null })),
    },
    fordeling: null,
    funn: [],
  };
  const missing = [
    graph.psets === undefined ? "psetsJson()" : "",
    graph.classifications === undefined ? "classificationsJson()" : "",
    graph.materials === undefined ? "materialsJson()" : "",
  ].filter(Boolean);
  if (missing.length) {
    return { ...base, grunn: `no ${missing.join(", ")} table was supplied with this graph` };
  }

  const reader = cascadeReader(graph as unknown as ModelGraph);
  const read = (s: NamedSource, p: ProductRow) => {
    const v = reader.read(s.source, p as unknown as ModelProduct);
    return v === null || v.trim() === "" ? null : v;
  };
  const codes = new Map<string, string>();
  for (const c of graph.classifications ?? []) {
    if (codes.has(c.guid) || !NS3457_SYSTEM.test(c.system_name ?? "")) continue;
    if (c.identification && c.identification.trim()) codes.set(c.guid, c.identification);
  }
  const materialRows = new Map<string, MaterialRow[]>();
  for (const r of graph.materials ?? []) {
    const list = materialRows.get(r.guid);
    if (list) list.push(r);
    else materialRows.set(r.guid, [r]);
  }
  const rulings = MENGDETYPE_AAPNE.rulings.map((r) => ({
    tittel: r.tittel,
    klasser: new Set(r.klasser.map((k) => k.toUpperCase())),
    n: 0,
  }));

  let oppfylt = 0;
  let avvik = 0;
  let mangler = 0;
  let ikkeRelevant = 0;
  const tally = new Map<string | null, { n: number; flagg: ReportValue["flagg"] }>();
  const count = (verdi: string | null, flagg: ReportValue["flagg"]) => {
    const t = tally.get(verdi);
    if (t) t.n++;
    else tally.set(verdi, { n: 1, flagg });
  };
  const funn: ReportFinding[] = [];
  try {
    for (const p of inScope) {
      // 1. The switch.
      const classRow = CLASS_ROWS.get(p.entity.toUpperCase());
      let mt: string | null = null;
      let decidedBy = -1;
      if (classRow && DECISIVE.has(classRow.mengdetype)) {
        mt = classRow.mengdetype;
        decidedBy = 0;
      }
      if (mt === null) {
        const code = codes.get(p.guid);
        const row = code === undefined ? undefined : codeRow(code);
        if (row && DECISIVE.has(row.mengdetype)) {
          mt = row.mengdetype;
          decidedBy = 1;
        }
      }
      for (let i = 0; mt === null && i < mengdetypeProject.length; i++) {
        const v = projectMengdetype(read(mengdetypeProject[i], p));
        if (v !== null) {
          mt = v;
          decidedBy = 2 + i;
        }
      }
      if (mt === null) mt = classRow?.mengdetype ?? "ukjent";
      if (decidedBy >= 0) (kMengdetype[decidedBy].n as number)++;
      if (decidedBy === 0) {
        for (const r of rulings) if (r.klasser.has(p.entity.toUpperCase())) r.n++;
      }

      // 2. The reading the switch demands.
      if (mt === "ikke_relevant") {
        ikkeRelevant++;
      } else if (mt === "telleobjekt") {
        let hit = -1;
        let value: string | null = null;
        for (let i = 0; i < productSources.length && hit < 0; i++) {
          value = read(productSources[i], p);
          if (value !== null) hit = i;
        }
        if (hit >= 0) {
          oppfylt++;
          (kProduct[hit].n as number)++;
          count(value, "");
        } else {
          mangler++;
          count(null, "mangler");
          funn.push({ guid: p.guid, klasse: p.entity, grunn: "product-missing", verdi: null });
        }
      } else if (mt === "mengdeobjekt") {
        const { kind, names } = materialOf(materialRows.get(p.guid));
        let ok: { source: number; names: string[] } | null = null;
        let bad: { source: number; names: string[] } | null = null;
        const kinds: MaterialKind[] = ["material", "materiallag"];
        for (let i = 0; i < kinds.length && !ok; i++) {
          if (kind !== kinds[i] || names.length === 0) continue;
          const usable = names.filter(usableMaterial);
          if (usable.length) ok = { source: i, names: usable };
          else bad ??= { source: i, names };
        }
        for (let i = 0; i < materialProject.length && !ok; i++) {
          const v = read(materialProject[i], p);
          if (v === null) continue;
          if (usableMaterial(v)) ok = { source: 2 + i, names: [v] };
          else bad ??= { source: 2 + i, names: [v] };
        }
        if (ok) {
          oppfylt++;
          (kMaterial[ok.source].n as number)++;
          for (const n of ok.names) count(n, "");
        } else if (bad) {
          avvik++;
          (kMaterial[bad.source].n as number)++;
          for (const n of bad.names) count(n, "avvik");
          funn.push({ guid: p.guid, klasse: p.entity, grunn: "material-unusable", verdi: bad.names.join(" + ") });
        } else {
          mangler++;
          count(null, "mangler");
          funn.push({ guid: p.guid, klasse: p.entity, grunn: "material-missing", verdi: null });
        }
      } else {
        // avhenger / ukjent: the switch picks no reading, so neither is there.
        mangler++;
        count(null, "mangler");
        funn.push({ guid: p.guid, klasse: p.entity, grunn: "mengdetype-undecided", verdi: mt });
      }
    }
  } catch (error) {
    if (error instanceof SourceUnreachable) return { ...base, grunn: error.message };
    throw error;
  }

  const grunnlag = inScope.length - ikkeRelevant;
  const aapne = rulings.map((r, i) => ({
    tittel: r.tittel,
    klasser: [...MENGDETYPE_AAPNE.rulings[i].klasser],
    // A ruling with no class cannot be told apart per object.
    n: r.klasser.size === 0 ? null : r.n,
  }));
  const fordeling: ReportValue[] = [...tally]
    .map(([verdi, t]) => ({ verdi, n: t.n, flagg: t.flagg }))
    .sort((a, b) => b.n - a.n || String(a.verdi ?? "").localeCompare(String(b.verdi ?? "")));
  // The open rulings follow the values: they count objects, not values, so
  // they are not part of the value distribution's sum.
  for (const r of aapne) if (r.n) fordeling.push({ verdi: r.tittel, n: r.n, flagg: "åpen" });
  const touched = aapne.some((r) => r.n);
  const dekning: ReportCoverage = {
    grunnlag,
    grunnlag_klasse: "IfcProduct",
    oppfylt,
    avvik,
    mangler,
    gjelder_ikke: outOfScope + ikkeRelevant,
    kilder,
  };
  if (grunnlag === 0) {
    return {
      ...base,
      state: "not_applicable",
      grunn: inScope.length === 0 ? "no elements matched this check" : "every element is ikke_relevant",
      aapne,
      dekning,
      fordeling,
    };
  }
  return {
    ...base,
    // Advisory, like element-material and phase. Never a pass while an open
    // ruling decides any object's reading: that reading is not settled.
    state: funn.length === 0 && !touched ? "pass" : "warn",
    aapne,
    dekning,
    fordeling,
    funn,
  };
}

/* ------------------------------------------------------------------ entry */

/** The standard-layer rows for one model, in report order. */
export function standardLayerRows(args: {
  model: ReportModel;
  graph: IfcGraph;
  excluded: ReadonlySet<string> | undefined;
  ruleset: Ruleset | null | undefined;
}): ReportRow[] {
  const { model, graph, excluded, ruleset } = args;
  return [
    schemaRow(model, ruleset),
    phaseRow(model, graph, excluded, ruleset),
    materialProductRow(model, graph, excluded, ruleset),
  ];
}
