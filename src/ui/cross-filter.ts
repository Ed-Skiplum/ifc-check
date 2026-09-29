/** Cross-filter: ONE active filter per model, one origin (2026-09-28).
 *
 * edkjo: *"cross filter should have one origin: all other views show only the
 * matching results. The clicked origin highlights. So: Original: Highlight,
 * everything else: Isolate."* The state and its reducer are
 * `filter-state.ts`; this file turns a board click into a filter, resolves a
 * filter to its elements, and holds the per-model state for React.
 *
 * A click on one OBJECT (the 3D, a Scope row, a room) is not a filter: it
 * selects, and the filter stays (2026-09-29, `filter-state.ts`).
 *
 * It replaced facet chips that OR-ed within a facet and AND-ed across facets
 * (2026-09-23 to 2026-09-28). A second click then refined the first, a
 * treemap cell AND a graph storey AND a type card, and the owner read the
 * result as *"cumulative somehow"*. Now a click replaces.
 *
 * ── What is deliberately NOT a filter ────────────────────────────────────
 * `kpi:products` is every product and `kpi:storeys` is not a product set at
 * all. Neither narrows anything. Nor is a row whose check NEVER RAN: a
 * `not_applicable` check and a `not_evaluable` rule have no element set, and
 * an empty scene under it would state "these elements" where the honest
 * answer is "this was not answered". Such a click still opens Scope and
 * prints the reason; it clears the filter, since it is a new click.
 */

import { useCallback, useState } from "react";
import type { Mode } from "../viewer/scene";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { cellRows, storeyNames, storeyRows } from "./profile";
import { serialiseFocus, type Focus } from "./trace";
import { typeGuids } from "./types/aggregate";
import { reqDoor, treeDoor } from "./board-doors";
import { labelOfRow } from "./requirements";
import { findNode } from "../engine/code-tree";
import type { ModelEntry } from "./useModels";
import { EMPTY_FILTER, reduceFilter, type ActiveFilter, type ChipKind, type FilterAction, type FilterState, type Origin } from "./filter-state";

export type { Mode, ActiveFilter, ChipKind, FilterAction, FilterState, Origin };

/** What a board click narrows to, or `null` when it is not an element set. */
export function filterOf(focus: Focus, model: ModelEntry, lang: Lang): { kind: ChipKind; label: string; focus: Focus } | null {
  if (focus.kind === "class") return { kind: "class", label: focus.entity, focus };
  if (focus.kind === "cell") {
    const storey = model.profile?.storeys.find((s) => s.guid === focus.storeyGuid);
    const where = focus.storeyGuid === null ? t("matrix.noStorey", lang) : (storey?.name ?? focus.storeyGuid);
    return { kind: "cell", label: `${where} · ${focus.entity}`, focus };
  }
  if (focus.kind === "storey") {
    if (!model.profile) return null;
    return { kind: "storey", label: storeyNames(model.profile, focus.storeyGuids, t("matrix.noStorey", lang)), focus };
  }
  if (focus.kind === "check") {
    const check = model.report?.checks.find((c) => c.id === focus.checkId);
    if (!check || check.state === "not_applicable") return null;
    return { kind: "check", label: t(`check.${focus.checkId}` as StringKey, lang), focus };
  }
  if (focus.kind === "rule") {
    const rule = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    if (!rule || rule.state === "not_evaluable" || rule.state === "not_applicable") return null;
    return { kind: "rule", label: rule.ruleName ?? focus.ruleId, focus };
  }
  if (focus.kind === "type") return { kind: "type", label: focus.typeName ?? t("type.untyped", lang), focus };
  if (focus.kind === "req") {
    const door = reqDoor(model, focus);
    if (!door.row) return null;
    const state = door.row.state;
    if (state === "not_configured" || state === "not_evaluable" || state === "not_applicable") return null;
    if (focus.value !== undefined && door.guids.length === 0) return null;
    const name = labelOfRow(door.row);
    const head = name ? t(name, lang) : door.row.id;
    return { kind: "check", label: focus.value === undefined ? head : `${head} · ${focus.value ?? "—"}`, focus };
  }
  if (focus.kind === "tree") {
    const tree = model.board?.trees[focus.axis];
    const node = tree ? findNode(tree.root, focus.key) : null;
    return node ? { kind: "tree", label: node.label ?? "—", focus } : null;
  }
  if (focus.kind === "ids") {
    const spec = model.ids?.specs[focus.index];
    if (!spec || spec.state === "not_applicable" || spec.state === "not_evaluable") return null;
    return { kind: "ids", label: spec.name, focus };
  }
  // `kpi` and `element`: neither is a set a board number narrows to.
  return null;
}

/** The action a click on a board number makes. */
export function chooseFocus(origin: Origin, focus: Focus, model: ModelEntry, lang: Lang): FilterAction {
  return { type: "choose", origin, key: serialiseFocus(focus), filter: filterOf(focus, model, lang), scope: focus };
}

/** The elements a focus stands for, or `null` when its source is gone (a
 *  rule outliving its ruleset). `null` is reported, never folded into
 *  "matches everything". */
function guidsOfFocus(focus: Focus, model: ModelEntry): Set<string> | null {
  const profile = model.profile;
  if (focus.kind === "class") {
    return profile ? new Set(profile.rows.filter((r) => r.entity === focus.entity).map((r) => r.guid)) : null;
  }
  if (focus.kind === "cell") {
    return profile ? new Set(cellRows(profile, focus.storeyGuid, focus.entity).map((r) => r.guid)) : null;
  }
  if (focus.kind === "check") {
    const check = model.report?.checks.find((c) => c.id === focus.checkId);
    return check ? new Set(check.findings.map((f) => f.guid)) : null;
  }
  if (focus.kind === "rule") {
    const rule = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    // A finding about a type object names the type; its members are the
    // elements in the model.
    return rule ? new Set(rule.findings.flatMap((f) => f.members ?? [f.guid])) : null;
  }
  if (focus.kind === "type") return profile ? typeGuids(profile, focus.typeName) : null;
  if (focus.kind === "storey") {
    return profile ? new Set(storeyRows(profile, focus.storeyGuids).map((r) => r.guid)) : null;
  }
  if (focus.kind === "req") {
    const door = reqDoor(model, focus);
    return door.row ? new Set(door.guids) : null;
  }
  if (focus.kind === "tree") {
    const guids = treeDoor(model, focus);
    return guids ? new Set(guids) : null;
  }
  if (focus.kind === "ids") {
    const spec = model.ids?.specs[focus.index];
    if (!spec) return null;
    // An occurrence-bound finding is about the specification, not an element;
    // a type object's finding stands for the elements that use it.
    return new Set(spec.findings.filter((f) => f.guid !== "-").flatMap((f) => f.members ?? [f.guid]));
  }
  if (focus.kind === "element") return new Set(focus.guids);
  return null;
}

export interface ResolvedFilter {
  /** `null` means no constraint. An EMPTY set is a filter that matched
   *  nothing: a real answer, drawn as an empty scene, never as the model. */
  matched: Set<string> | null;
  /** The filter's source no longer exists; the bar draws it broken. */
  unresolved: boolean;
}

export function resolveActive(filter: ActiveFilter | null, model: ModelEntry): ResolvedFilter {
  if (!filter) return { matched: null, unresolved: false };
  if (filter.guids) return { matched: new Set(filter.guids), unresolved: false };
  const guids = filter.focus ? guidsOfFocus(filter.focus, model) : null;
  return guids ? { matched: guids, unresolved: false } : { matched: null, unresolved: true };
}

/** Per-model interaction state: the one filter (with Scope's list and the
 *  selection it implies), the 3D's `Vis kun / Uthev`, and the hover. */
export interface ModelView extends FilterState {
  mode: Mode;
  hover: string | null;
  /** How many times a selection gesture has landed; a watcher keyed on the
   *  selection alone cannot see the same element picked twice. */
  selectSeq: number;
}

export const EMPTY_VIEW: ModelView = { ...EMPTY_FILTER, mode: "filter", hover: null, selectSeq: 0 };

export interface CrossFilterApi {
  view: (modelId: string) => ModelView;
  views: Record<string, ModelView>;
  dispatch: (modelId: string, action: FilterAction) => void;
  setMode: (modelId: string, mode: Mode) => void;
  setHover: (modelId: string, guid: string | null) => void;
}

export function useCrossFilter(): CrossFilterApi {
  const [views, setViews] = useState<Record<string, ModelView>>({});

  const patch = useCallback((modelId: string, next: (current: ModelView) => ModelView) => {
    setViews((current) => ({ ...current, [modelId]: next(current[modelId] ?? EMPTY_VIEW) }));
  }, []);

  const view = useCallback((modelId: string) => views[modelId] ?? EMPTY_VIEW, [views]);

  return {
    view,
    views,
    dispatch: useCallback(
      (modelId, action) =>
        patch(modelId, (v) => {
          const next = reduceFilter(v, action);
          return { ...v, ...next, selectSeq: action.type === "element" || action.type === "select" ? v.selectSeq + 1 : v.selectSeq };
        }),
      [patch],
    ),
    setMode: useCallback((modelId, mode) => patch(modelId, (v) => ({ ...v, mode })), [patch]),
    setHover: useCallback(
      (modelId, guid) => patch(modelId, (v) => (v.hover === guid ? v : { ...v, hover: guid })),
      [patch],
    ),
  };
}
