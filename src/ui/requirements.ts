/** The dashboard's requirements, in the mottakskontroll report's order.
 *
 * edkjo 2026-09-25, on the design alternatives: *"why not report on what
 * matters first? Remember you're building with the pdf report."* The report
 * (HI90 `docs/rapport-rammeverk.md`, "Model report", sections 3 and 4) reads
 * a model as eleven requirements in two sections, IFC-struktur then
 * Standardkrav, each one a status, a dekning with the sources it was read
 * from, and a fordeling. This file puts the engine's report contract
 * (`src/engine/report.ts`, the rows the worker built) into that order and
 * names each row with the report's own term (`docs/begreper.md`).
 *
 * A MAPPING, never a computation: every number a requirement shows is a
 * field of its report row. What the contract does not carry is not derived
 * here. Two consequences, both stated rather than hidden:
 *
 *  - Produkt and Materiale are ONE row in the contract (`material-product`,
 *    switched per object by mengdetype), so they are one requirement here.
 *    The switch itself is not shown (`shownSources`, `shownFinding`).
 *  - NS 3451 and NS 3457-8 produce a row only when the ruleset configures
 *    their mapping (AGENTS.md "Report contract": no standard-layer cascade for
 *    the classification mappings yet). With none configured the requirement
 *    reads `not_configured`, which is what it is: nothing configured.
 *
 * IFC-skjema is a Nøkkeltall tile in the report, not one of the eleven; it
 * leads the IFC-struktur group here because the board has no Nøkkeltall band.
 */

import type { ReportFinding, ReportRow, ReportSource, ReportState } from "../engine/report";
import type { MappingRole } from "../ids/types.ts";
import type { StringKey } from "./i18n";
import type { Focus } from "./trace";

export type ReqGroup = "ifc" | "std";

interface ReqSpec {
  key: string;
  group: ReqGroup;
  label: StringKey;
  /** The row this requirement reads: a report row id, or a mapping role. */
  id?: string;
  mapping?: MappingRole;
  /** A second reading under the first (Objekter i etasje: the storey span,
   *  `mesh-placement`, the report's «Gyldig» for that requirement). */
  second?: string;
  /** MMI: a distribution, never a KPI (begreper.md §7). */
  distribution?: boolean;
  /** Listed only once the ruleset configures it: TFM is a project's own
   *  convention, not one of the report's eleven. */
  whenConfigured?: boolean;
}

export const REQUIREMENTS: readonly ReqSpec[] = [
  { key: "ifc-schema", group: "ifc", label: "req.ifc-schema", id: "ifc-schema" },
  { key: "typeobjekt", group: "ifc", label: "req.typeobjekt", id: "element-typed" },
  { key: "guid", group: "ifc", label: "req.guid", id: "guid-unique" },
  { key: "etasjedefinisjon", group: "ifc", label: "req.etasjedefinisjon", id: "storey-config" },
  {
    key: "objekter-i-etasje",
    group: "ifc",
    label: "req.objekter-i-etasje",
    id: "storey-containment",
    second: "mesh-placement",
  },
  { key: "systemkode", group: "std", label: "req.systemkode", mapping: "system-classification" },
  { key: "funksjonskode", group: "std", label: "req.funksjonskode", mapping: "component-classification" },
  { key: "materiale-produkt", group: "std", label: "req.materiale-produkt", id: "material-product" },
  { key: "kopiobjekt", group: "std", label: "req.kopiobjekt", mapping: "copy-object" },
  { key: "mmi", group: "std", label: "req.mmi", mapping: "progress-code", distribution: true },
  { key: "fase", group: "std", label: "req.fase", id: "phase" },
  { key: "tfm", group: "std", label: "req.tfm", mapping: "tfm", whenConfigured: true },
];

export const REQ_GROUPS: readonly { group: ReqGroup; label: StringKey }[] = [
  { group: "ifc", label: "req.group.ifc" },
  { group: "std", label: "req.group.std" },
];

export interface Requirement {
  key: string;
  group: ReqGroup;
  label: StringKey;
  /** null: the contract has no row for it (an unconfigured mapping). */
  row: ReportRow | null;
  state: ReportState;
  second: ReportRow | null;
  distribution: boolean;
  /** What a click on the requirement opens, or null when it stands for no
   *  derivation at all. */
  focus: Focus | null;
}

/** The fundamentals are checks, a mapping is a rule; both keep the focus they
 *  have on the bento board. A standard-layer row has neither and opens its
 *  own `req` focus over the row's `funn`. */
export function focusOfRow(row: ReportRow): Focus {
  if (row.mapping) return { kind: "rule", ruleId: row.id };
  if (row.id === "ifc-schema" || row.id === "phase" || row.id === "material-product") {
    return { kind: "req", id: row.id };
  }
  return { kind: "check", checkId: row.id };
}

function find(rows: readonly ReportRow[], spec: { id?: string; mapping?: MappingRole }): ReportRow | null {
  if (spec.mapping) return rows.find((r) => r.mapping === spec.mapping) ?? null;
  return rows.find((r) => r.id === spec.id && !r.mapping) ?? null;
}

export function requirements(rows: readonly ReportRow[] | undefined): Requirement[] {
  const all = rows ?? [];
  const listed = REQUIREMENTS.filter((spec) => !spec.whenConfigured || find(all, spec) !== null);
  return listed.map((spec) => {
    const row = find(all, spec);
    const second = spec.second ? find(all, { id: spec.second }) : null;
    // A mapping whose rule is configured but produced no row, or one the
    // contract lists as not_configured: either way, no project config.
    const state: ReportState = row ? row.state : "not_configured";
    return {
      key: spec.key,
      group: spec.group,
      label: spec.label,
      row,
      state,
      second,
      distribution: spec.distribution === true,
      focus: row && row.state !== "not_configured" ? focusOfRow(row) : null,
    };
  });
}

/** Every report row id a requirement reads, so the secondary check list can
 *  leave them out rather than show them twice. */
export function requirementRowIds(reqs: readonly Requirement[]): Set<string> {
  const ids = new Set<string>();
  for (const req of reqs) {
    if (req.row) ids.add(req.row.id);
    if (req.second) ids.add(req.second.id);
  }
  return ids;
}

/** A requirement row by the `req` focus id (the row id, or the mapping role). */
export function rowOfReq(rows: readonly ReportRow[] | undefined, id: string): ReportRow | null {
  return (rows ?? []).find((r) => r.id === id || r.mapping === id) ?? null;
}

/** The requirement card's own label for the check or rule focus it opens, so
 *  the filter chip and the Scope header name the thing the card names
 *  (2026-09-30: card «Typeobjekt», chip «Typet objekt»). Null when no card
 *  opens that focus: the check keeps its own `check.*` label, the rule its
 *  name. */
export function labelOfFocus(focus: Focus, rows: readonly ReportRow[] | undefined): StringKey | null {
  if (focus.kind === "check") {
    return REQUIREMENTS.find((s) => !s.mapping && s.id === focus.checkId)?.label ?? null;
  }
  if (focus.kind === "rule") {
    const row = (rows ?? []).find((r) => r.mapping && r.id === focus.ruleId);
    return row ? labelOfRow(row) : null;
  }
  return null;
}

/** The sources a row shows: its `kilder` less the mengdetype branch.
 *  Mengdetype is assessed, not checked (2026-10-05, edkjo: "not really
 *  anything to put into the report"), so the contract keeps those sources
 *  and their counts, and the screen leaves them out. */
export function shownSources(row: ReportRow): ReportSource[] {
  return row.dekning.kilder.filter((k) => k.gren !== "mengdetype");
}

/** A finding's code and value as the screen shows them. An object the
 *  Materiale / Produkt switch picks no reading for (`mengdetype-undecided`,
 *  verdi the mengdetype) is a mangler with nothing read: shown as `empty`,
 *  the contract's own code for that, without the mengdetype. */
export function shownFinding(f: Pick<ReportFinding, "grunn"> & { verdi?: ReportFinding["verdi"] }): {
  grunn: string;
  verdi: string | null;
} {
  return f.grunn === "mengdetype-undecided" ? { grunn: "empty", verdi: null } : { grunn: f.grunn, verdi: f.verdi ?? null };
}

/** The label of the requirement a row belongs to, for a chip or a title. */
export function labelOfRow(row: ReportRow): StringKey | null {
  const spec = REQUIREMENTS.find((s) =>
    s.mapping ? row.mapping === s.mapping : !row.mapping && (row.id === s.id || row.id === s.second),
  );
  return spec ? spec.label : null;
}
