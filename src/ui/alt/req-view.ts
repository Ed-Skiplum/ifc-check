/** The figures, labels and doors the requirement views draw, as plain
 *  functions (so the component files export components only). Every figure
 *  is a field of a report row; the only arithmetic is a share of two of its
 *  counts. */

import type { CodeTree } from "../../engine/code-tree";
import type { ReportRow, ReportState, ReportValue } from "../../engine/report";
import type { Verdict } from "../../engine/types";
import type { Focus } from "../trace";
import type { Lang, StringKey } from "../i18n";
import type { ModelEntry } from "../useModels";
import { requirements, type Requirement } from "../requirements";
import { t, locale } from "../i18n";
import { formatCount } from "../format";
import { VERDICT_GLYPH } from "../state-visuals";
import { css, mmiColour } from "../chart-colors";
import { reqDoor, valueDoorSize } from "../board-doors";

export function stateLook(state: ReportState, lang: Lang): { verdict: Verdict; glyph: string; word: string } {
  switch (state) {
    case "pass":
    case "warn":
    case "fail":
      return { verdict: state, glyph: VERDICT_GLYPH[state], word: t(`verdict.${state}`, lang) };
    case "not_applicable":
      return { verdict: "na", glyph: VERDICT_GLYPH.na, word: t("req.gjelderIkke", lang) };
    case "not_evaluable":
      return { verdict: "warn", glyph: "?", word: t("result.not_evaluable", lang) };
    default:
      return { verdict: "na", glyph: "∅", word: t("req.state.not_configured", lang) };
  }
}

function pct(part: number | null, total: number | null, lang: Lang): string {
  if (part === null || total === null || total <= 0) return "—";
  return (part / total).toLocaleString(locale(lang), { style: "percent", maximumFractionDigits: 1 });
}

/** A row's lead figure and the line under it, per the report block. */
/** The lead figure is the report's «Dekning»: presence, the objects that
 *  carry the value at all, over the objects that should (begreper.md: «the
 *  property there or not per element»). An avvik value is present; whether it
 *  is valid is the fordeling's flag. Where the row has no avvik/mangler split
 *  (an IDS rule), `oppfylt` is what is known. MMI keeps its dekning as a small
 *  line and never a big figure: an MMI reading is not a KPI (begreper.md §7). */
export function figures(req: Requirement, lang: Lang): { figure: string; of: string; label?: StringKey } | null {
  const row = req.row;
  if (!row || row.state === "not_configured" || row.state === "not_evaluable") return null;
  const d = row.dekning;
  if (req.key === "ifc-schema") {
    // The schema as FILE_SCHEMA writes it, then the accepted set in small
    // type, as the report's Nøkkeltall card has it.
    return { figure: row.fordeling?.[0]?.verdi ?? "—", of: (row.godtatte ?? []).join(" · "), label: "kpi.schema" };
  }
  if (req.key === "guid") {
    // Told as counts, not coverage (begreper.md §9): duplicates decide.
    return { figure: d.avvik === null ? "—" : formatCount(d.avvik, lang), of: "", label: "req.duplikater" };
  }
  if (d.grunnlag === null) return { figure: "—", of: "" };
  const present = d.mangler !== null ? d.grunnlag - d.mangler : d.oppfylt;
  const of =
    `${present === null ? "—" : formatCount(present, lang)} ${t("req.av", lang)} ${formatCount(d.grunnlag, lang)}` +
    (d.grunnlag_klasse ? ` ${d.grunnlag_klasse}` : "");
  return { figure: pct(present, d.grunnlag, lang), of };
}

/** The second reading of Objekter i etasje: the storey span, `mesh-placement`. */
export function secondFigure(req: Requirement, lang: Lang): { label: string; figure: string; of: string } | null {
  const row = req.second;
  if (!row) return null;
  const d = row.dekning;
  const judged = d.grunnlag === null || d.gjelder_ikke === null ? null : d.oppfylt === null ? null : d.oppfylt + (d.avvik ?? 0) + (d.mangler ?? 0);
  return {
    label: t("check.mesh-placement", lang),
    figure: judged === null ? "—" : pct(d.oppfylt, judged, lang),
    of: judged === null ? "" : `${formatCount(d.oppfylt ?? 0, lang)} ${t("req.av", lang)} ${formatCount(judged, lang)}`,
  };
}

/** What a value of a fordeling opens: the type or storey it names where the
 *  row is about types or storeys, else the objects the rule read it on. */
export function valueFocus(row: ReportRow, value: string | null, model: ModelEntry): Focus | null {
  if (row.mapping === undefined && (row.id === "element-typed" || row.id === "single-instance-types")) {
    if (value === "") return null;
    return { kind: "type", typeName: value };
  }
  if (row.mapping === undefined && row.id === "storey-containment") {
    if (value === null) return { kind: "storey", storeyGuids: [null] };
    const guids = (model.profile?.storeys ?? []).filter((s) => (s.name ?? s.guid) === value).map((s) => s.guid);
    return guids.length ? { kind: "storey", storeyGuids: guids } : null;
  }
  if (valueDoorSize(model, row, value) === 0) return null;
  return { kind: "req", id: row.mapping ?? row.id, value };
}

/** The report sorts MMI by code (begreper.md §7); every other fordeling
 *  arrives most frequent first. */
export function orderedValues(req: Requirement): ReportValue[] {
  const values = req.row?.fordeling ?? [];
  if (!req.distribution) return values;
  return [...values].sort((a, b) => {
    const x = Number(a.verdi);
    const y = Number(b.verdi);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    if (a.verdi === null) return 1;
    if (b.verdi === null) return -1;
    return String(a.verdi).localeCompare(String(b.verdi));
  });
}

/** «n unike verdier». */
export function uniqueCount(req: Requirement, lang: Lang): string | null {
  const values = req.row?.fordeling;
  if (!values) return null;
  return `${formatCount(values.length, lang)} ${t("req.unike", lang)}`;
}

/** The Overview's requirements: the IFC-struktur group, in report order. */
export function overviewRequirements(model: ModelEntry): Requirement[] {
  return requirements(model.board?.rows).filter((r) => r.group === "ifc");
}

/** The project tab's: the Standardkrav group, in report order. */
export function standardRequirements(model: ModelEntry): Requirement[] {
  return requirements(model.board?.rows).filter((r) => r.group === "std");
}

/** The MMI requirement (a distribution, never a KPI). */
export function mmiRequirement(model: ModelEntry): Requirement | null {
  return standardRequirements(model).find((r) => r.distribution) ?? null;
}

/** The treemaps read through a project mapping (NS 3451, NS 3457-8): the
 *  project tab's. */
export function projectTrees(model: ModelEntry): CodeTree[] {
  const trees = model.board?.trees;
  return trees ? [trees.system, trees.function].filter((t) => t.by === "mapping") : [];
}

/** The treemaps that are general, read off the IFC class or the
 *  PredefinedType: the Overview's. */
export function generalTrees(model: ModelEntry): ("tree-system" | "tree-function")[] {
  const trees = model.board?.trees;
  if (!trees) return [];
  const out: ("tree-system" | "tree-function")[] = [];
  if (trees.system.by !== "mapping") out.push("tree-system");
  if (trees.function.by !== "mapping") out.push("tree-function");
  return out;
}

export function treeTitle(tree: CodeTree): "req.systemkode" | "req.funksjonskode" | "col.class" | "col.predefinedType" {
  if (tree.by === "mapping") return tree.axis === "system" ? "req.systemkode" : "req.funksjonskode";
  return tree.by === "ifc-class" ? "col.class" : "col.predefinedType";
}

export interface Bar {
  value: string | null;
  n: number;
  flag: "" | "avvik" | "mangler";
}

/** The bars: the values outside the project's list, flagged, and the objects
 *  with no value; then every level the list declares, in numeric order, 0
 *  included. All from the MMI row: its `godtatte` and its fordeling. */
export function mmiBars(req: Requirement): Bar[] {
  const row = req.row;
  if (!row || !row.fordeling) return [];
  const counts = new Map(row.fordeling.map((v) => [v.verdi, v.n]));
  const allowed = [...(row.godtatte ?? [])].sort((a, b) => {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b);
  });
  const bars: Bar[] = allowed.map((v) => ({ value: v, n: counts.get(v) ?? 0, flag: "" }));
  const known = new Set(allowed);
  const outside = row.fordeling
    .filter((v) => v.verdi !== null && !known.has(v.verdi))
    .map((v) => ({ value: v.verdi, n: v.n, flag: "avvik" as const }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true }));
  // Off the scale first, so a narrow tile that scrolls still shows them:
  // values outside the list, then the objects with none, then the scale.
  const none = counts.get(null);
  const off: Bar[] = none ? [...outside, { value: null, n: none, flag: "mangler" }] : outside;
  return [...off, ...bars];
}

/** The bars over the elements of a cross-filter from another view: each
 *  bar's height is its value's elements in `iso` (the same door a click on
 *  the bar opens), and a bar with none is not drawn. */
export function mmiBarsWithin(req: Requirement, model: ModelEntry, iso: Set<string>): Bar[] {
  const row = req.row;
  if (!row) return [];
  return mmiBars(req)
    .map((bar) => ({
      ...bar,
      n: reqDoor(model, { kind: "req", id: row.mapping ?? row.id, value: bar.value }).guids.filter((g) => iso.has(g)).length,
    }))
    .filter((bar) => bar.n > 0);
}

/** How a bar is drawn: a level on the scale takes its step of the ordinal
 *  ramp; an avvik or mangler bar takes no fill (the CSS draws its outline or
 *  hatching) and carries its glyph. */
export interface BarLook {
  verdict: "warn" | "fail" | undefined;
  glyph: string | null;
  style: Record<string, string>;
}

export function barLook(bars: readonly Bar[]): (bar: Bar) => BarLook {
  const scale = bars.filter((b) => b.flag === "");
  return (bar): BarLook => {
    if (bar.flag === "avvik") return { verdict: "warn", glyph: VERDICT_GLYPH.warn, style: {} };
    if (bar.flag === "mangler") return { verdict: "fail", glyph: VERDICT_GLYPH.fail, style: {} };
    const step = scale.findIndex((b) => b.value === bar.value);
    return { verdict: undefined, glyph: null, style: { "--bar": css(mmiColour(step, scale.length)) } };
  };
}
