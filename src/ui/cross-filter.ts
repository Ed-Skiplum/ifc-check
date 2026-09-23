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
 *
 * Nor is a row whose check NEVER RAN: a `not_applicable` check and a
 * `not_evaluable` rule have no element set, and an empty scene under a `0 /
 * 851` chip would state "these elements" where the honest answer is "this was
 * not answered". Same rule the engine keeps (`not_applicable` is never folded
 * into `pass`), at the filter. The derivation still opens and prints the
 * reason — the row is not dead, it just does not pretend to be a set.
 *
 * ── Two steps, one gesture ───────────────────────────────────────────────
 * edkjo: *"so you click to see rejected instances, then select an instance and
 * see that."* Step one is the chip above. Step two is an ELEMENT chip, made by
 * a row inside the derivation band: it carries its own guid rather than a
 * board number, and because facets AND, `check ∧ element` is that one element.
 * It rides the same bar, the same ✕ and the same Tøm filter as every other
 * chip, so stepping back out is the gesture the user already knows.
 */

import { useCallback, useState } from "react";
import type { Mode } from "../viewer/scene";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { cellRows, storeyNames, storeyRows } from "./profile";
import { serialiseFocus, type Focus } from "./trace";
import { typeGuids } from "./types/aggregate";
import type { ModelEntry } from "./useModels";

export type { Mode };

export type ChipKind = "class" | "cell" | "check" | "rule" | "type" | "storey" | "element";

export interface FilterChip {
  /** `serialiseFocus(focus)` — the same key the hash view uses, so a chip and
   *  an open derivation are recognisably the same thing. An element chip has
   *  no focus, so its key is `element:<guid>`. */
  key: string;
  kind: ChipKind;
  label: string;
  /** The board number this chip was made from. Absent on an element chip: it
   *  comes from a row INSIDE a derivation, and re-targeting the band to that
   *  row would destroy the very list being drilled. */
  focus?: Focus;
  /** The elements this chip stands for, when it carries them itself. */
  guids?: string[];
}

/** One element, from a row of the open derivation. */
export function elementChip(guid: string, label: string | null): FilterChip {
  return { key: `element:${guid}`, kind: "element", label: label || guid, guids: [guid] };
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
  if (focus.kind === "storey") {
    if (!model.profile) return null;
    return {
      key,
      kind: "storey",
      label: storeyNames(model.profile, focus.storeyGuids, t("matrix.noStorey", lang)),
      focus,
    };
  }
  if (focus.kind === "check") {
    // A check that could not run stands for no elements — see the header.
    const check = model.report?.checks.find((c) => c.id === focus.checkId);
    if (!check || check.state === "not_applicable") return null;
    return { key, kind: "check", label: t(`check.${focus.checkId}` as StringKey, lang), focus };
  }
  if (focus.kind === "rule") {
    const rule = model.evaluation?.results.find((r) => r.ruleId === focus.ruleId);
    if (!rule) return null;
    if (rule.state === "not_evaluable" || rule.state === "not_applicable") return null;
    return { key, kind: "rule", label: rule.ruleName ?? focus.ruleId, focus };
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
  if (chip.guids) return new Set(chip.guids);
  const focus = chip.focus;
  const profile = model.profile;
  if (!focus) return null;

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
  if (focus.kind === "storey") {
    if (!profile) return null;
    return new Set(storeyRows(profile, focus.storeyGuids).map((r) => r.guid));
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
  /** How many times a TABLE selection has asked the camera to frame what it
   *  chose. A counter rather than a flag: the same element picked twice is two
   *  requests, and an effect keyed on the number re-runs for the second one.
   *
   *  It is incremented ONLY by `pickElement`, i.e. by a row of the derivation
   *  band. `pick` — the canvas — never touches it, which is the "a viewer click
   *  does not move the camera" rule expressed as data rather than as care. */
  frameSeq: number;
}

export const EMPTY_VIEW: ModelView = {
  mode: "filter",
  chips: [],
  selection: [],
  hover: null,
  frameSeq: 0,
};

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
  /** A row of the derivation: select the element, narrow the filter to it, AND
   *  ask the camera to frame it. Plain click on the element already isolated
   *  steps back out to the set it was drilled from; Shift or Ctrl builds a set
   *  of them. This is the ONE path that narrows on a single element — a pick in
   *  the SCENE only ever highlights, and must not start hiding what the pointer
   *  is over, nor move the camera. */
  pickElement: (modelId: string, chip: FilterChip | null, additive: boolean) => void;
  /** Drop the element refinement, because a different SET was just chosen. An
   *  element chip narrows the set it was drilled from; carried onto the next
   *  set it would AND with a set that does not contain it and draw an empty
   *  scene. The selection goes with it only when it IS the drill's own — a
   *  selection made in the 3D tile is the user's and is left alone. */
  clearElements: (modelId: string) => void;
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
    pickElement: useCallback(
      (modelId, chip, additive) =>
        patch(modelId, (v) => {
          const others = v.chips.filter((c) => c.kind !== "element");
          if (chip === null) return { ...v, chips: others, selection: [] };
          const guid = chip.guids![0];
          const mine = v.chips.filter((c) => c.kind === "element");
          const already = mine.some((c) => c.key === chip.key);
          if (!additive) {
            // Toggle: the same row twice steps back to the set it drilled from.
            const single = already && mine.length === 1;
            return single
              ? { ...v, chips: others, selection: [] }
              : {
                  ...v,
                  chips: [...others, chip],
                  selection: [guid],
                  // Frame it. Stepping back OUT (the branch above) leaves the
                  // camera where it is: there is no single object to frame, and
                  // a second move the user did not ask for would be worse than
                  // none.
                  frameSeq: v.frameSeq + 1,
                };
          }
          const next = already ? mine.filter((c) => c.key !== chip.key) : [...mine, chip];
          return {
            ...v,
            chips: [...others, ...next],
            selection: next.map((c) => c.guids![0]),
            // Shift/Ctrl builds a set, and the frame follows the set it built:
            // the same `zoomToSelection` the named button runs. An emptied
            // selection asks for nothing.
            frameSeq: next.length > 0 ? v.frameSeq + 1 : v.frameSeq,
          };
        }),
      [patch],
    ),
    clearElements: useCallback(
      (modelId) =>
        patch(modelId, (v) => {
          const mine = v.chips.filter((c) => c.kind === "element");
          if (mine.length === 0) return v;
          const guids = new Set(mine.map((c) => c.guids![0]));
          return {
            ...v,
            chips: v.chips.filter((c) => c.kind !== "element"),
            selection: v.selection.every((g) => guids.has(g)) ? [] : v.selection,
          };
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
