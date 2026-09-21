/** Cross-filter: the same click that opens a derivation also narrows the 3D.
 *
 * The ruling this implements, verbatim from the canon: *"Crossfilter = FILTER
 * IN PLACE, not cross-navigate: clicking a dashboard class narrows every panel
 * (KPIs, Topp-20, 3D) to that class and STAYS on the dash, surfaced as a
 * removable filter chip"*, plus *"show an ACTIVE-FILTER CHIP BAR so 'what am I
 * filtered to?' is always answerable at a glance"*.
 *
 * So a `Focus` — the thing the board already produces when a class row, a
 * matrix cell, a universal check or a project rule is clicked — becomes a
 * CHIP. Nothing new has to be clicked, and no tile learns a second gesture.
 *
 * ── How chips combine ────────────────────────────────────────────────────
 * OR within a facet, AND across facets. Two class chips mean "either class";
 * a class chip and a check chip mean "this class AND failing that check". That
 * is the semantics the sprucelab embed contract encodes by giving each facet an
 * array (`ifc_class?: string[]`) and intersecting the facets, and it is the
 * only combination rule that makes a second click feel like a refinement
 * rather than a replacement.
 *
 * ── What is deliberately NOT a filter ────────────────────────────────────
 * `kpi:products` is every product and `kpi:storeys` is not a product set at
 * all. Neither narrows anything, so neither makes a chip. A chip that silently
 * means "no constraint" is worse than no chip.
 */

import { useCallback, useState } from "react";
import type { Mode } from "../viewer/scene";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { cellRows } from "./profile";
import { serialiseFocus, type Focus } from "./trace";
import { typeGuids } from "./types/aggregate";
import type { ModelEntry } from "./useModels";

export type { Mode };

export type ChipKind = "class" | "cell" | "check" | "rule" | "type";

export interface FilterChip {
  /** `serialiseFocus(focus)` — the same key the hash view uses, so a chip and
   *  an open derivation are recognisably the same thing. */
  key: string;
  kind: ChipKind;
  label: string;
  focus: Focus;
}

/** A focus that narrows nothing returns `null` rather than an empty chip. */
export function chipOf(focus: Focus, model: ModelEntry, lang: Lang): FilterChip | null {
  const key = serialiseFocus(focus);
  if (focus.kind === "class") {
    return { key, kind: "class", label: focus.entity, focus };
  }
  if (focus.kind === "cell") {
    const storey = model.profile?.storeys.find((s) => s.guid === focus.storeyGuid);
    const where =
      focus.storeyGuid === null
        ? t("matrix.noStorey", lang)
        : (storey?.name ?? focus.storeyGuid);
    return { key, kind: "cell", label: `${where} · ${focus.entity}`, focus };
  }
  if (focus.kind === "check") {
    return { key, kind: "check", label: t(`check.${focus.checkId}` as StringKey, lang), focus };
  }
  if (focus.kind === "rule") {
    const rule = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    return { key, kind: "rule", label: rule?.ruleName ?? focus.ruleId, focus };
  }
  if (focus.kind === "type") {
    return { key, kind: "type", label: focus.typeName ?? t("type.untyped", lang), focus };
  }
  return null;
}

/** The elements one chip stands for, or `null` when the chip's source is gone
 *  (a rule chip outliving its ruleset). `null` is reported, never folded into
 *  "matches everything" — a filter that quietly stops constraining is the same
 *  failure as a check that quietly stops matching. */
function guidsOf(chip: FilterChip, model: ModelEntry): Set<string> | null {
  const focus = chip.focus;
  const profile = model.profile;

  if (focus.kind === "class") {
    if (!profile) return null;
    return new Set(profile.rows.filter((r) => r.entity === focus.entity).map((r) => r.guid));
  }
  if (focus.kind === "cell") {
    if (!profile) return null;
    return new Set(cellRows(profile, focus.storeyGuid, focus.entity).map((r) => r.guid));
  }
  if (focus.kind === "check") {
    const check = model.report?.checks.find((c) => c.id === focus.checkId);
    if (!check) return null;
    return new Set(check.findings.map((f) => f.guid));
  }
  if (focus.kind === "rule") {
    const rule = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    if (!rule) return null;
    // A finding about a type object names the type; its members are the
    // elements in the model.
    return new Set(rule.findings.flatMap((f) => f.members ?? [f.guid]));
  }
  if (focus.kind === "type") {
    if (!profile) return null;
    return typeGuids(profile, focus.typeName);
  }
  // `kpi` never reaches here — `chipOf` refuses to make a chip out of it — and
  // the exhaustive fallthrough is what keeps that true if a focus kind is added.
  return null;
}

export interface ResolvedFilter {
  /** `null` means no constraint — show everything. An EMPTY set means the
   *  filter matched nothing, which is a real answer and is drawn as an empty
   *  scene, never as the whole model. */
  matched: Set<string> | null;
  /** Chip keys whose source no longer exists. Rendered as broken chips. */
  unresolved: string[];
}

export function resolveFilter(chips: FilterChip[], model: ModelEntry): ResolvedFilter {
  if (chips.length === 0) return { matched: null, unresolved: [] };

  const byKind = new Map<ChipKind, Set<string>>();
  const unresolved: string[] = [];

  for (const chip of chips) {
    const guids = guidsOf(chip, model);
    if (guids === null) {
      unresolved.push(chip.key);
      continue;
    }
    const existing = byKind.get(chip.kind);
    if (!existing) byKind.set(chip.kind, guids);
    else for (const guid of guids) existing.add(guid);
  }

  if (byKind.size === 0) return { matched: null, unresolved };

  let matched: Set<string> | null = null;
  for (const facet of byKind.values()) {
    if (matched === null) {
      matched = facet;
      continue;
    }
    const next = new Set<string>();
    for (const guid of facet) if (matched.has(guid)) next.add(guid);
    matched = next;
  }
  return { matched, unresolved };
}

/** Per-model interaction state: what is filtered, what is chosen, what the
 *  pointer is over. Selection and hover are separate from the filter on
 *  purpose — selecting in the scene never isolates, and filtering never
 *  selects. */
export interface ModelView {
  mode: Mode;
  chips: FilterChip[];
  selection: string[];
  hover: string | null;
}

export const EMPTY_VIEW: ModelView = { mode: "filter", chips: [], selection: [], hover: null };

export interface CrossFilterApi {
  view: (modelId: string) => ModelView;
  setMode: (modelId: string, mode: Mode) => void;
  /** Idempotent. The caller decides whether a click is opening or closing —
   *  see `ModelPanel` — so that a chip is present exactly when its derivation
   *  is, and one gesture keeps one meaning. */
  addChip: (modelId: string, chip: FilterChip) => void;
  removeChip: (modelId: string, key: string) => void;
  clearChips: (modelId: string) => void;
  setSelection: (modelId: string, guids: string[]) => void;
  /** Plain click replaces; Shift or Ctrl adds/toggles; `null` clears. */
  pick: (modelId: string, guid: string | null, additive: boolean) => void;
  setHover: (modelId: string, guid: string | null) => void;
}

export function useCrossFilter(): CrossFilterApi {
  const [views, setViews] = useState<Record<string, ModelView>>({});

  const patch = useCallback((modelId: string, next: (current: ModelView) => ModelView) => {
    setViews((current) => ({
      ...current,
      [modelId]: next(current[modelId] ?? EMPTY_VIEW),
    }));
  }, []);

  const view = useCallback(
    (modelId: string) => views[modelId] ?? EMPTY_VIEW,
    [views],
  );

  return {
    view,
    setMode: useCallback(
      (modelId, mode) => patch(modelId, (v) => ({ ...v, mode })),
      [patch],
    ),
    addChip: useCallback(
      (modelId, chip) =>
        patch(modelId, (v) =>
          v.chips.some((c) => c.key === chip.key) ? v : { ...v, chips: [...v.chips, chip] },
        ),
      [patch],
    ),
    removeChip: useCallback(
      (modelId, key) =>
        patch(modelId, (v) => ({ ...v, chips: v.chips.filter((c) => c.key !== key) })),
      [patch],
    ),
    clearChips: useCallback(
      (modelId) => patch(modelId, (v) => ({ ...v, chips: [] })),
      [patch],
    ),
    setSelection: useCallback(
      (modelId, guids) => patch(modelId, (v) => ({ ...v, selection: guids })),
      [patch],
    ),
    pick: useCallback(
      (modelId, guid, additive) =>
        patch(modelId, (v) => {
          if (guid === null) return { ...v, selection: [] };
          if (!additive) return { ...v, selection: [guid] };
          return v.selection.includes(guid)
            ? { ...v, selection: v.selection.filter((g) => g !== guid) }
            : { ...v, selection: [...v.selection, guid] };
        }),
      [patch],
    ),
    setHover: useCallback(
      (modelId, guid) =>
        patch(modelId, (v) => (v.hover === guid ? v : { ...v, hover: guid })),
      [patch],
    ),
  };
}
