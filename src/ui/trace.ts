/** Derivation behind any number on the screen.
 *
 * No value is a dead end: a KPI, a class count, a floor-matrix cell and a rule
 * verdict all resolve to the same `Trace` — what was asked, how many elements
 * it looked at, how many passed, what the engine could not answer and why, the
 * engine's own caveats, and the rows themselves.
 *
 * It is plain data on purpose. A trace built here can be serialised into a run
 * report without re-parsing or re-evaluating anything; nothing that matters
 * exists only as JSX.
 */

import type { CheckResult, ReasonCode, Verdict } from "../engine/types";
import { verdictOf } from "../engine/fundamentals";
import type { ResultState } from "../ids/evaluate.ts";
import type { StringKey } from "./i18n";
import type { ModelEntry } from "./useModels";
import { cellRows } from "./profile";

/** The two census numbers that have rows behind them but no check of their
 *  own. Everything else on the board drills to a check or to a rule. */
export type KpiFocus = "products" | "storeys";

export type Focus =
  | { kind: "rule"; ruleId: string }
  | { kind: "check"; checkId: string }
  | { kind: "kpi"; kpi: KpiFocus }
  | { kind: "class"; entity: string }
  | { kind: "cell"; storeyGuid: string | null; entity: string };

const KPIS: KpiFocus[] = ["products", "storeys"];

export function serialiseFocus(focus: Focus): string {
  if (focus.kind === "rule") return `rule:${focus.ruleId}`;
  if (focus.kind === "check") return `check:${focus.checkId}`;
  if (focus.kind === "kpi") return `kpi:${focus.kpi}`;
  if (focus.kind === "class") return `class:${focus.entity}`;
  return `cell:${focus.storeyGuid ?? "-"}|${focus.entity}`;
}

export function parseFocus(raw: string | null): Focus | null {
  if (!raw) return null;
  const split = raw.indexOf(":");
  if (split < 0) return null;
  const kind = raw.slice(0, split);
  const rest = raw.slice(split + 1);
  if (kind === "rule") return rest ? { kind: "rule", ruleId: rest } : null;
  if (kind === "check") return rest ? { kind: "check", checkId: rest } : null;
  if (kind === "kpi") {
    return (KPIS as string[]).includes(rest) ? { kind: "kpi", kpi: rest as KpiFocus } : null;
  }
  if (kind === "class") return rest ? { kind: "class", entity: rest } : null;
  if (kind === "cell") {
    const bar = rest.lastIndexOf("|");
    if (bar < 0) return null;
    const storey = rest.slice(0, bar);
    const entity = rest.slice(bar + 1);
    return entity ? { kind: "cell", storeyGuid: storey === "-" ? null : storey, entity } : null;
  }
  return null;
}

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  if (a === null || b === null) return a === b;
  return serialiseFocus(a) === serialiseFocus(b);
}

/** One row behind a number. `code` comes from `src/engine` and is localised on
 *  render; `reason` is the English sentence `src/ids` produced and is data. */
export interface TraceRow {
  guid: string;
  entity: string;
  name: string | null;
  reason?: string;
  code?: ReasonCode;
  params?: Record<string, string | number>;
}

export interface TraceStat {
  label: StringKey;
  value: number;
}

export interface Trace {
  focus: string;
  modelId: string;
  fileName: string;
  /** Rendered as `t(titleKey) · titleText`, either part optional. */
  titleKey?: StringKey;
  titleText?: string;
  /** A project rule's verdict. A KPI, a class and a cell are facts. */
  state?: ResultState;
  /** A universal check's verdict — Bestått / Advarsel / Avvik / N/A. */
  verdict?: Verdict;
  /** Factual line from the engine, already English, never localised here. */
  detail?: string;
  /** Why a verdict could not be reached. The one thing a reader would
   *  otherwise mistake for a pass. */
  reason?: string;
  /** Engine caveats about how the check was run. */
  notes: string[];
  stats: TraceStat[];
  rows: TraceRow[];
  /** False when the engine capped its findings list below `failed`. */
  rowsComplete: boolean;
}

function checkOf(model: ModelEntry, id: string) {
  return model.report?.checks.find((c) => c.id === id);
}

/** A universal check's derivation. The verdict is recomputed here from the
 *  check rather than carried alongside it, so the band can never disagree with
 *  the row that opened it. */
function traceOfCheck(
  base: { focus: string; modelId: string; fileName: string },
  check: CheckResult,
): Trace {
  return {
    ...base,
    titleKey: `check.${check.id}` as Trace["titleKey"],
    verdict: verdictOf(check),
    detail: check.detail,
    reason: check.reason,
    notes: [],
    stats: [
      { label: "trace.applicable", value: check.applicable },
      { label: "trace.passed", value: Math.max(0, check.applicable - check.findings.length) },
      { label: "trace.failed", value: check.findings.length },
    ],
    rows: check.findings.map((f) => ({
      guid: f.guid,
      entity: f.entity,
      name: f.name,
      code: f.code,
      params: f.params,
    })),
    rowsComplete: true,
  };
}

export function buildTrace(model: ModelEntry, focus: Focus): Trace | null {
  const base = { focus: serialiseFocus(focus), modelId: model.id, fileName: model.fileName };

  if (focus.kind === "rule") {
    const result = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    if (!result) return null;
    return {
      ...base,
      titleKey: "trace.rule",
      titleText: result.ruleName,
      state: result.state,
      detail: result.detail,
      reason: result.reason,
      notes: result.notes ?? [],
      stats: [
        { label: "trace.applicable", value: result.applicable },
        { label: "trace.passed", value: Math.max(0, result.applicable - result.failed) },
        { label: "trace.failed", value: result.failed },
        { label: "trace.shown", value: result.findings.length },
      ],
      rows: result.findings.map((f) => ({
        guid: f.guid,
        entity: f.entity,
        name: f.name,
        reason: f.reason,
      })),
      rowsComplete: result.findings.length >= result.failed,
    };
  }

  if (focus.kind === "check") {
    const check = checkOf(model, focus.checkId);
    if (!check) return null;
    return traceOfCheck(base, check);
  }

  const profile = model.profile;

  if (focus.kind === "kpi") {
    if (focus.kpi === "products") {
      if (!profile) return null;
      return {
        ...base,
        titleKey: "kpi.products",
        notes: [],
        stats: [{ label: "trace.elements", value: profile.rows.length }],
        rows: profile.rows.map((r) => ({ guid: r.guid, entity: r.entity, name: r.name })),
        rowsComplete: true,
      };
    }
    if (focus.kpi === "storeys") {
      if (!profile) return null;
      return {
        ...base,
        titleKey: "kpi.storeys",
        notes: [],
        stats: [{ label: "trace.elements", value: profile.storeys.length }],
        rows: profile.storeys.map((s) => ({
          guid: s.guid,
          entity: "IfcBuildingStorey",
          name: s.name,
        })),
        rowsComplete: true,
      };
    }
    return null;
  }

  if (!profile) return null;

  if (focus.kind === "class") {
    const rows = profile.rows.filter((r) => r.entity === focus.entity);
    return {
      ...base,
      titleText: focus.entity,
      notes: [],
      stats: [{ label: "trace.elements", value: rows.length }],
      rows: rows.map((r) => ({ guid: r.guid, entity: r.entity, name: r.name })),
      rowsComplete: true,
    };
  }

  const rows = cellRows(profile, focus.storeyGuid, focus.entity);
  const storey = profile.storeys.find((s) => s.guid === focus.storeyGuid);
  return {
    ...base,
    titleKey: focus.storeyGuid === null ? "matrix.noStorey" : undefined,
    titleText:
      focus.storeyGuid === null
        ? focus.entity
        : `${storey?.name ?? focus.storeyGuid} · ${focus.entity}`,
    notes: [],
    stats: [{ label: "trace.elements", value: rows.length }],
    rows: rows.map((r) => ({ guid: r.guid, entity: r.entity, name: r.name })),
    rowsComplete: true,
  };
}
