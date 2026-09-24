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
 *
 * These are report rows (src/engine/report.ts), not fundamentals: nothing
 * here reaches the screen.
 */

import { physicalProducts } from "./fundamentals.ts";
import type { IfcGraph } from "./types";
import { DEFAULT_ACCEPTED_SCHEMAS } from "../ids/lint.ts";
import { cascadeReader, SourceUnreachable, type CascadeSource } from "../ids/evaluate.ts";
import type { ModelGraph, ModelProduct } from "../ids/model.ts";
import type { CodeSource, Ruleset } from "../ids/types.ts";
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
  const accepted = ruleset?.projectLayer?.["ifc-schema"]?.accepted ?? [...DEFAULT_ACCEPTED_SCHEMAS];
  const written = (model.schema ?? "").trim();
  const family = schemaFamily(written);
  const ok = family !== "" && accepted.includes(family);
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
    state: ok ? "pass" : written ? "warn" : "fail",
    godtatte: accepted,
    dekning,
    fordeling: written ? [{ verdi: written, n: 1, flagg: ok ? "" : "avvik" }] : [{ verdi: null, n: 1, flagg: "mangler" }],
    funn: [],
  };
}

/* ---------------------------------------------------------------- phase */

/** PEnum_ElementStatus, less the three that say nothing (OTHER, NOTKNOWN,
 *  UNSET), which are carried but are avvik. */
export const PHASE_ACCEPTED = ["NEW", "EXISTING", "DEMOLISH", "TEMPORARY"] as const;

interface NamedSource {
  navn: string;
  lag: ReportLayer;
  source: CascadeSource;
}

const PHASE_STANDARD: NamedSource = {
  navn: "Pset_*Common.Status",
  lag: "standard",
  source: {
    propertyMatch: { propertySet: { restriction: { pattern: "Pset_\\w*Common" } }, name: "Status" },
  },
};

function codeSourceName(src: CodeSource): string {
  if ("attribute" in src) return src.attribute;
  if ("property" in src) return `${src.property.propertySet}.${src.property.name}`;
  const system = src.classification.system;
  return system === undefined ? "IfcClassificationReference" : `IfcClassificationReference ${system}`;
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
  values: (string | null)[],
  accepted: (v: string) => boolean,
): Decision {
  let firstCarried = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v.trim() === "") continue;
    if (accepted(v)) return { state: "oppfylt", source: i, value: v };
    if (firstCarried < 0) firstCarried = i;
  }
  if (firstCarried >= 0) return { state: "avvik", source: firstCarried, value: values[firstCarried] };
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
      const values = sources.map((s) => reader.read(s.source, p as unknown as ModelProduct));
      const d = decide(values, isAccepted);
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
  const extra = ruleset?.projectLayer?.phase?.sources ?? [];
  return cascadeRow({
    id: "phase",
    model,
    graph,
    excluded,
    sources: [
      PHASE_STANDARD,
      ...extra.map((source): NamedSource => ({ navn: codeSourceName(source), lag: "prosjekt", source })),
    ],
    accepted: PHASE_ACCEPTED,
  });
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
  return [schemaRow(model, ruleset), phaseRow(model, graph, excluded, ruleset)];
}
