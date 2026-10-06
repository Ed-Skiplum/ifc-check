/** Oppsett v2 (2026-10-06). edkjo on the walk: "extremely painful … super
 *  clunky and unintuitive and verbose" · "What is in the model is obscure."
 *  The shape he chose: one page, a sidebar listing every requirement, and a
 *  wizard for the one selected. "This is a mapping step, where you CAN accept
 *  defaults, but we want to make it easy to map to actual model data, or even
 *  just custom rules that might not be in the model at all yet."
 *
 *   sidebar  the loaded models; the requirements (status, name, hit %, the
 *            source, origin); «Legg til krav» and «Lagre» at the foot
 *   main     before a model and with nothing picked: one drop target for IFC
 *            and IDS together; else the selected requirement: its name, n / N,
 *            Forrige / Neste, delete; the Krav row (what it maps TO); then
 *            Kilde (what it maps FROM now) beside I modellen (the model's data)
 *
 * Every edit goes to the ruleset at once (`onChange`, which re-evaluates), so
 * every figure on the page is the report row the worker wrote. An IDS dropped
 * here is MERGED (`merge.ts`), never loaded in place of the ruleset; a
 * conflict holds «Lagre» until one rule is kept. With no ruleset the page
 * opens on POFIN's (`withPofin`), seeded without marking the ruleset touched.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { importIds } from "../../ids/import.ts";
import { lintRuleset } from "../../ids/lint.ts";
import { everyOwnerName } from "../../ids/models.ts";
import { pofinRuleset, withPofin } from "../../engine/pofin-ruleset.ts";
import { STATSBYGG_SEQUENCE } from "../../engine/tfm.ts";
import { ROLE_STANDARD, POFIN_SOURCES } from "../../engine/pofin-standard.ts";
import { isWalkSelected } from "../../engine/walk-selection.ts";
import type { CodeLookupCheck, CopyObjectCheck, ExtendedRule, IdsRule, Rule, Ruleset, TfmCheck } from "../../ids/types.ts";
import type { ReportRow } from "../../engine/report.ts";
import { t, type Lang } from "../i18n";
import { formatCount } from "../format";
import { mergeChoices, type PsetValue } from "../pset-choices";
import type { ModelEntry } from "../useModels";
import { isIdsFile } from "../IdsResults";
import { layerJudge, layerPath, layerSources, withLayerSources } from "../layer-steps";
import { modelLevels, withLevels } from "../step-templates";
import { LayerList, ModelStoreys, StoreyCard, setupWithLevels, type Picker } from "../SetupPage";
import { CONFIRM, IfcDrop } from "../setup/Walk";
import { rankCandidates, rankTfmCandidates, standardOption, type CardRole } from "../setup/candidates";
import { roleRule } from "../../ids/models.ts";
import {
  addableKinds,
  freshId,
  keyOf,
  literalFacets,
  mergeIds,
  propertyRule,
  resolveConflict,
  ruleReading,
  withSource,
  withoutRule,
  type AddKind,
  type Conflict,
  type Unreadable,
} from "./merge";
import { LAYER_LABEL, ROLE_LABEL, itemStatus, requirementItems, rowOf, sumHits, type ItemStatus, type ReqItem } from "./items";
import { BUTTON, ConflictBlock, KravEditor, KravLineData, kravData } from "./Krav";
import { InModel, Kilde, type PinnedOption, type SourceTag } from "./Columns";
import { judgeValues, shownValues } from "./judge";

export interface OppsettState {
  /** The requirement on screen (`ReqItem.id`); null = none picked. */
  selected: string | null;
  conflicts: Conflict[];
  unreadable: Unreadable[];
}

export const EMPTY_OPPSETT: OppsettState = { selected: null, conflicts: [], unreadable: [] };

const physical = { entity: { group: "physicalElement" as const } };

/** A key event's target is a field: the page's arrows and Enter leave it be. */
function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function OppsettPage({
  lang,
  ruleset,
  rulesetLoaded,
  models,
  state,
  onState,
  onChange,
  onSeed,
  onFiles,
  dragging,
  onSave,
}: {
  lang: Lang;
  ruleset: Ruleset;
  /** A ruleset is loaded or being edited; without one, POFIN's is seeded. */
  rulesetLoaded: boolean;
  models: ModelEntry[];
  state: OppsettState;
  onState: (update: (was: OppsettState) => OppsettState) => void;
  /** An edit: the ruleset replaced and re-evaluated. */
  onChange: (next: Ruleset) => void;
  /** The POFIN seed: as `onChange`, without counting as an edit. */
  onSeed: (next: Ruleset) => void;
  /** IFC (and any non-IDS) files dropped or picked: `App`'s own route. */
  onFiles: (files: File[]) => void;
  dragging: boolean;
  /** «Lagre»: null once saved, else the storage's error. */
  onSave: () => string | null;
}) {
  // The working copy: POFIN's until a ruleset exists.
  const shown = useMemo(() => (rulesetLoaded ? ruleset : withPofin(ruleset)), [ruleset, rulesetLoaded]);
  const seeded = useRef(false);
  useEffect(() => {
    if (!rulesetLoaded && !seeded.current) {
      seeded.current = true;
      onSeed(shown);
    }
  }, [rulesetLoaded, shown, onSeed]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const loaded = models.some((m) => m.state === "ready");
  const lint = useMemo(() => lintRuleset(shown), [shown]);
  const items = useMemo(() => requirementItems(shown, state.conflicts), [shown, state.conflicts]);
  const ownerNames = useMemo(() => everyOwnerName(shown), [shown]);

  // What the models carry: the merged property sets, and the elements the
  // walk's rules select (every figure's denominator, as the walk counted).
  const picker = useMemo((): Picker => {
    const answered = models.filter((m) => m.psets !== undefined).map((m) => m.psets!);
    const reading = models.some(
      (m) => m.state === "queued" || m.state === "parsing" || (m.state === "ready" && !m.psets && !m.psetsError),
    );
    const profiled = models.filter((m) => m.profile);
    return {
      choices: answered.length > 0 ? mergeChoices(answered) : models.length > 0 && reading ? [] : null,
      reading,
      errors: models.filter((m) => m.psetsError).map((m) => `${m.fileName}: ${m.psetsError}`),
      total:
        profiled.length > 0
          ? profiled.reduce((n, m) => n + m.profile!.rows.filter((row) => isWalkSelected(row.entity)).length, 0)
          : null,
    };
  }, [models]);

  // Typenavn's values: every type Name the selected elements reach.
  const typeNames = useMemo((): PsetValue[] => {
    const counts = new Map<string, number>();
    for (const m of models) {
      for (const row of m.profile?.rows ?? []) {
        if (row.typed && row.typeName && isWalkSelected(row.entity)) counts.set(row.typeName, (counts.get(row.typeName) ?? 0) + 1);
      }
    }
    return [...counts].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
  }, [models]);

  const fromModels = useMemo(
    () =>
      modelLevels(
        models.flatMap((m) =>
          m.profile && m.report ? [{ storeys: m.profile.storeys, unitScale: m.report.summary.unit_scale, unitResolved: m.report.summary.unit_resolved }] : [],
        ),
      ),
    [models],
  );

  // One report per model, as the board has it.
  const reports = useMemo(() => models.filter((m) => m.board).map((m) => ({ model: m.fileName, rows: m.board!.rows as ReportRow[] })), [models]);
  const rowsOf = (item: ReqItem) => reports.map((r) => rowOf(item, r.rows));

  const selected = items.find((i) => i.id === state.selected) ?? (loaded ? (items[0] ?? null) : null);
  const at = selected ? items.indexOf(selected) : -1;
  const select = (id: string | null) => onState((was) => ({ ...was, selected: id }));
  const jumpToRule = (ruleId: string) => select(`rule:${ruleId}`);

  const blocked = state.conflicts.length > 0;
  const save = () => {
    if (blocked) return;
    setSaveError(null);
    const error = onSave();
    if (error !== null) setSaveError(error);
  };
  const go = (step: 1 | -1) => {
    if (!selected) return;
    if (step === 1 && at === items.length - 1) return save();
    const next = items[at + step];
    if (next) select(next.id);
  };

  // Enter or → = Neste, ← = Forrige, unless a field or an open popover has
  // the key.
  const keys = useRef({ go, selected });
  useEffect(() => {
    keys.current = { go, selected };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || inField(event.target)) return;
      if (!keys.current.selected) return;
      if (event.key === "ArrowRight" || (event.key === "Enter" && !(event.target instanceof HTMLButtonElement))) {
        event.preventDefault();
        keys.current.go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        keys.current.go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── the IDS drop ─────────────────────────────────────────────────── */

  const takeFiles = async (files: File[]) => {
    const idsFiles = files.filter(isIdsFile);
    const rest = files.filter((f) => !isIdsFile(f));
    if (rest.length > 0) onFiles(rest);
    if (idsFiles.length === 0) return;
    let working = shown;
    let conflicts = state.conflicts;
    const unreadable: Unreadable[] = [];
    for (const file of idsFiles) {
      try {
        const merged = mergeIds(working, importIds(await file.text(), file.name), conflicts);
        working = merged.ruleset;
        conflicts = merged.conflicts;
        unreadable.push(...merged.unreadable);
      } catch (error) {
        // A file that is no IDS at all: named, with the importer's reason.
        unreadable.push({ file: file.name, name: file.name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (working !== shown) onChange(working);
    onState((was) => {
      const seen = new Set(was.unreadable.map((u) => `${u.file}\u0000${u.name}\u0000${u.reason}`));
      return {
        ...was,
        conflicts,
        unreadable: [...was.unreadable, ...unreadable.filter((u) => !seen.has(`${u.file}\u0000${u.name}\u0000${u.reason}`))],
      };
    });
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    void takeFiles(Array.from(event.dataTransfer.files));
  };

  /* ── adding and deleting ──────────────────────────────────────────── */

  const add = (kind: AddKind) => {
    let next: Ruleset;
    let id: string;
    if (kind === "property") {
      const rule = propertyRule(shown, t("field.source.property", lang));
      next = { ...shown, rules: [...shown.rules, rule] };
      id = `rule:${rule.id}`;
    } else if (kind === "storeys") {
      next = { ...shown, storeys: setupWithLevels(undefined, fromModels.length > 0 ? fromModels : [{ name: "", elevation: Number.NaN }]) };
      id = "storeys";
    } else if (kind === "tfm") {
      const rule: ExtendedRule = {
        id: freshId(shown.rules, "tfm"),
        kind: "extended",
        name: t("req.tfm", lang),
        select: physical,
        check: { type: "tfm", source: { property: { propertySet: "", name: "" } }, sequence: [...STATSBYGG_SEQUENCE] },
      };
      next = { ...shown, rules: [...shown.rules, rule] };
      id = `rule:${rule.id}`;
    } else {
      // The fixed kinds come back as POFIN states them: the default.
      const template = pofinRuleset().rules.find((r) => r.kind === "extended" && (r.check.type === kind || r.mapping === kind))!;
      const rule = { ...template, id: freshId(shown.rules, template.id) };
      next = { ...shown, rules: [...shown.rules, rule] };
      id = `rule:${rule.id}`;
    }
    onChange(next);
    select(id);
  };

  const canDelete = (item: ReqItem): boolean => {
    if (item.kind === "rule" || item.kind === "storeys") return true;
    if (item.kind === "ifc-schema") return shown.projectLayer?.["ifc-schema"] !== undefined;
    if (item.kind === "phase") return shown.projectLayer?.phase !== undefined;
    return layerSources(shown, "product").length > 0 || layerSources(shown, "material").length > 0;
  };
  const remove = (item: ReqItem) => {
    let next: Ruleset = shown;
    if (item.kind === "rule") next = { ...shown, rules: shown.rules.filter((r) => r.id !== item.ruleId) };
    else if (item.kind === "storeys") {
      next = { ...shown };
      delete next.storeys;
    } else if (item.kind === "ifc-schema" || item.kind === "phase") {
      const layer = { ...shown.projectLayer };
      delete layer[item.kind];
      next = { ...shown, projectLayer: layer };
      if (Object.keys(layer).length === 0) delete next.projectLayer;
    } else next = withLayerSources(withLayerSources(shown, "product", []), "material", []);
    onChange(next);
    const after = items[at + 1] ?? items[at - 1] ?? null;
    onState((was) => ({
      ...was,
      selected: after && after.id !== item.id ? after.id : null,
      conflicts: item.ruleId ? withoutRule(was.conflicts, item.ruleId) : was.conflicts,
    }));
  };

  const resolve = (id: string, keep: "ids" | "current") => {
    const conflict = state.conflicts.find((c) => c.id === id);
    const result = resolveConflict(shown, state.conflicts, id, keep);
    if (result.ruleset !== shown) onChange(result.ruleset);
    const replaced = keep === "ids" && conflict ? result.ruleset.rules[shown.rules.findIndex((r) => r.id === conflict.ruleId)] : null;
    onState((was) => ({ ...was, conflicts: result.conflicts, selected: replaced ? `rule:${replaced.id}` : was.selected }));
  };

  const empty = !loaded && selected === null;

  return (
    <main data-oppsett className="flex min-h-0 flex-1 gap-4 overflow-hidden" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Sidebar
        lang={lang}
        models={models}
        items={items}
        selected={selected?.id ?? null}
        loaded={loaded}
        rowsOf={rowsOf}
        addable={addableKinds(shown)}
        blocked={blocked}
        onSelect={select}
        onAdd={add}
        onSave={save}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {state.unreadable.length > 0 ? (
          <div data-unreadable className="alt-card flex shrink-0 items-start gap-3 px-4 py-2 ring-2 ring-bad">
            <span className="alt-label shrink-0 pt-0.5">{t("oppsett.unreadable", lang)}</span>
            <ul className="m-0 flex max-h-28 min-w-0 flex-1 list-none flex-col gap-0.5 overflow-auto p-0 font-mono text-[12px] text-ink">
              {state.unreadable.map((u) => (
                <li key={`${u.file}\u0000${u.name}\u0000${u.reason}`} className="truncate" title={u.reason}>
                  {u.file} · {u.name} · {u.reason}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => onState((was) => ({ ...was, unreadable: [] }))} className={BUTTON + " shrink-0"}>
              {t("findings.close", lang)}
            </button>
          </div>
        ) : null}
        {saveError !== null ? (
          <pre className="m-0 shrink-0 rounded-[10px] bg-bad px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-cream">{saveError}</pre>
        ) : null}
        {empty || selected === null ? (
          <div data-stage className="alt-card flex min-h-0 flex-1 items-center justify-center p-8 [container-type:size]">
            <div className="w-[min(100%,calc(72cqh*1.6))]">
              <IfcDrop
                label={t("oppsett.drop", lang)}
                accept={t("accept.ifcIds", lang)}
                dragging={dragging}
                busy={models.some((m) => m.state === "queued" || m.state === "parsing")}
                fileTypes=".ifc,.ifczip,.ids,.xml"
                onFiles={(files) => void takeFiles(files)}
              />
            </div>
          </div>
        ) : (
          <Wizard
            key={selected.id}
            lang={lang}
            item={selected}
            index={at}
            count={items.length}
            ruleset={shown}
            lint={lint}
            loaded={loaded}
            rows={rowsOf(selected)}
            reports={reports}
            picker={picker}
            typeNames={typeNames}
            fromModels={fromModels}
            ownerNames={ownerNames}
            models={models}
            conflicts={state.conflicts.filter((c) => c.ruleId === selected.ruleId)}
            canDelete={canDelete(selected)}
            blocked={blocked}
            onChange={onChange}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onDelete={() => remove(selected)}
            onResolve={resolve}
            onJump={jumpToRule}
          />
        )}
      </div>
    </main>
  );
}

/* ================================================================ sidebar */

function Dot({ status }: { status: ItemStatus }) {
  const look: Record<ItemStatus, string> = {
    done: "bg-green",
    fail: "bg-bad",
    saved: "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_2px,transparent_2px_4px)] ring-1 ring-muted",
    open: "ring-1 ring-muted",
  };
  return <span aria-hidden="true" data-status={status} className={"block size-2.5 shrink-0 rounded-full " + look[status]} />;
}

export const itemName = (item: ReqItem, lang: Lang) => (item.label ? t(item.label, lang) : item.name);

function Sidebar({
  lang,
  models,
  items,
  selected,
  loaded,
  rowsOf,
  addable,
  blocked,
  onSelect,
  onAdd,
  onSave,
}: {
  lang: Lang;
  models: ModelEntry[];
  items: ReqItem[];
  selected: string | null;
  loaded: boolean;
  rowsOf: (item: ReqItem) => (ReportRow | null)[];
  addable: AddKind[];
  blocked: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: AddKind) => void;
  onSave: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!adding) return;
    const away = (event: PointerEvent) => {
      if (pop.current && !pop.current.contains(event.target as Node)) setAdding(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [adding]);
  const addLabel = (kind: AddKind) =>
    kind === "property" ? t("field.source.property", lang) : kind === "storeys" ? t(LAYER_LABEL.storeys, lang) : t(ROLE_LABEL[kind], lang);
  return (
    <aside data-sidebar className="alt-card flex w-[320px] shrink-0 flex-col overflow-hidden">
      {models.length > 0 ? (
        <ul data-models className="alt-head m-0 flex shrink-0 list-none flex-col gap-1 px-3 py-2">
          {models.map((m) => (
            <li key={m.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-mono text-ink" title={m.fileName}>
                {m.fileName}
              </span>
              <span className="shrink-0 font-mono text-muted">{m.report?.summary.schema ?? t(m.rejected ? "file.rejected" : `file.${m.state}`, lang)}</span>
              {m.report ? <span className="shrink-0 font-mono tabular-nums text-muted">{formatCount(m.report.summary.products, lang)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ol data-requirements className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-auto p-1.5">
        {items.map((item) => {
          const rows = rowsOf(item);
          const figure = loaded ? sumHits(rows) : null;
          const chosen = item.id === selected;
          return (
            <li key={item.id}>
              <button
                type="button"
                data-req={item.id}
                aria-current={chosen || undefined}
                onClick={() => onSelect(item.id)}
                className={"flex w-full flex-col gap-0.5 rounded-[8px] px-2.5 py-2 text-left " + (chosen ? "alt-chosen" : "alt-hover")}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Dot status={itemStatus(item, loaded, rows)} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{itemName(item, lang)}</span>
                  {item.conflict ? (
                    <span data-conflict-mark aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full bg-bad font-mono text-[11px] font-bold text-cream">
                      !
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                    {figure && figure.of > 0 ? `${Math.round((100 * figure.hits) / figure.of)} %` : "—"}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2 pl-[18px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={item.source ?? undefined}>
                    {item.source ?? t("oppsett.noSource", lang)}
                  </span>
                  {item.origin ? <span className="alt-src shrink-0">{item.origin === "POFIN" ? t("setup.pofin", lang) : t("filter.kind.ids", lang)}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="alt-head relative flex shrink-0 items-center gap-2 px-3 py-3 [box-shadow:inset_0_1px_0_var(--d-hair)]" ref={pop}>
        <button type="button" data-add aria-expanded={adding} onClick={() => setAdding((was) => !was)} className={BUTTON + " flex-1 justify-center"}>
          + {t("oppsett.add", lang)}
        </button>
        <button
          type="button"
          data-save
          disabled={blocked}
          onClick={onSave}
          className={CONFIRM + " min-h-9 flex-1 rounded-[6px] px-4 disabled:cursor-not-allowed disabled:bg-muted"}
        >
          {t("action.save", lang)}
        </button>
        {adding ? (
          <div
            data-add-pop
            role="menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
            }}
            className="alt-card absolute bottom-full left-3 z-30 mb-2 flex w-[calc(100%-1.5rem)] flex-col gap-0.5 p-1.5"
          >
            {addable.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                data-add-kind={kind}
                onClick={() => {
                  setAdding(false);
                  onAdd(kind);
                }}
                className={"alt-hover rounded-[6px] px-3 py-1.5 text-left text-[14px] text-ink " + (kind === "property" ? "mt-1 [box-shadow:inset_0_1px_0_var(--d-hair)] pt-2" : "")}
              >
                {addLabel(kind)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* ================================================================= wizard */

function Wizard({
  lang,
  item,
  index,
  count,
  ruleset,
  lint,
  loaded,
  rows,
  reports,
  picker,
  typeNames,
  fromModels,
  ownerNames,
  models,
  conflicts,
  canDelete,
  blocked,
  onChange,
  onPrev,
  onNext,
  onDelete,
  onResolve,
  onJump,
}: {
  lang: Lang;
  item: ReqItem;
  index: number;
  count: number;
  ruleset: Ruleset;
  lint: ReturnType<typeof lintRuleset>;
  loaded: boolean;
  rows: (ReportRow | null)[];
  reports: { model: string; rows: ReportRow[] }[];
  picker: Picker;
  typeNames: PsetValue[];
  fromModels: ReturnType<typeof modelLevels>;
  ownerNames: string[];
  models: ModelEntry[];
  conflicts: Conflict[];
  canDelete: boolean;
  blocked: boolean;
  onChange: (next: Ruleset) => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete: () => void;
  onResolve: (id: string, keep: "ids" | "current") => void;
  onJump: (ruleId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const trash = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirming) return;
    const away = (event: PointerEvent) => {
      if (trash.current && !trash.current.contains(event.target as Node)) setConfirming(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [confirming]);

  const rule = item.ruleId ? (ruleset.rules.find((r) => r.id === item.ruleId) ?? null) : null;
  const issues = rule ? lint.filter((i) => i.ruleId === rule.id) : [];
  const data = kravData(item, rule, ruleset, lang);
  const editor = KravEditor({ item, rule, ruleset, issues, picker, typeNames, lang, onChange, onJump });
  const last = index === count - 1;
  const figure = sumHits(rows);

  return (
    <section data-wizard={item.id} aria-label={itemName(item, lang)} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="alt-card flex shrink-0 flex-col">
        <div className="flex items-center gap-4 px-5 pt-4 pb-3">
          <h1 data-wizard-name className="m-0 min-w-0 truncate text-[28px] leading-tight font-semibold tracking-tight text-ink" title={itemName(item, lang)}>
            {itemName(item, lang)}
          </h1>
          <span data-position className="shrink-0 font-mono text-[14px] tabular-nums text-muted">
            {index + 1} / {count}
          </span>
          <span className="flex-1" />
          <button type="button" data-prev disabled={index === 0} onClick={onPrev} className={BUTTON}>
            ← {t("action.previous", lang)}
          </button>
          {last ? (
            <button type="button" data-next disabled={blocked} onClick={onNext} className={CONFIRM + " min-h-9 rounded-[6px] px-4 disabled:cursor-not-allowed disabled:bg-muted"}>
              {t("action.save", lang)}
            </button>
          ) : (
            <button type="button" data-next onClick={onNext} className={BUTTON}>
              {t("action.next", lang)} →
            </button>
          )}
          <div className="relative" ref={trash}>
            <button
              type="button"
              data-delete
              aria-label={t("action.delete", lang)}
              aria-expanded={confirming}
              disabled={!canDelete}
              onClick={() => setConfirming((was) => !was)}
              className={BUTTON + " px-2 hover:border-bad hover:text-bad"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
              </svg>
            </button>
            {confirming ? (
              <div data-delete-pop className="alt-card absolute top-full right-0 z-30 mt-2 flex w-max gap-2 p-2">
                <button
                  type="button"
                  autoFocus
                  data-delete-confirm
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                  className="inline-flex min-h-9 items-center rounded-[6px] bg-bad px-3 text-[13px] font-medium text-cream"
                >
                  {t("action.delete", lang)}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
                  {t("action.cancel", lang)}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 pb-4">
          {editor !== null ? (
            <button
              type="button"
              data-krav
              aria-expanded={editing}
              onClick={() => setEditing((was) => !was)}
              className={"flex w-full min-w-0 items-center gap-3 rounded-[8px] px-3 py-2 text-left " + (editing ? "alt-chosen" : "alt-hover [box-shadow:inset_0_0_0_1px_var(--d-hair)]")}
            >
              <span className="alt-label shrink-0">{t("field.requirement", lang)}</span>
              <KravLineData data={data} />
            </button>
          ) : (
            <div data-krav className="flex min-w-0 items-center gap-3 rounded-[8px] px-3 py-2 [box-shadow:inset_0_0_0_1px_var(--d-hair)]">
              <span className="alt-label shrink-0">{t("field.requirement", lang)}</span>
              <KravLineData data={data} />
            </div>
          )}
          {editing && editor !== null ? (
            <div data-krav-editor className="max-h-[45vh] overflow-auto rounded-[8px] p-3 [box-shadow:inset_0_0_0_1px_var(--d-hair)]">
              {editor}
            </div>
          ) : null}
          {rule
            ? conflicts.map((c) => <ConflictBlock key={c.id} conflict={c} current={rule} lang={lang} onKeep={(keep) => onResolve(c.id, keep)} />)
            : null}
        </div>
      </div>
      <Body
        lang={lang}
        item={item}
        rule={rule}
        ruleset={ruleset}
        lint={lint}
        loaded={loaded}
        figure={figure}
        reports={reports}
        picker={picker}
        typeNames={typeNames}
        fromModels={fromModels}
        ownerNames={ownerNames}
        models={models}
        onChange={onChange}
        onJump={onJump}
      />
    </section>
  );
}

/* =================================================================== body */

const isMappingRule = (rule: Rule | null): boolean =>
  rule !== null && rule.kind === "extended" && (rule.check.type === "code-lookup" || rule.check.type === "copy-object" || rule.check.type === "tfm");

function Body({
  lang,
  item,
  rule,
  ruleset,
  lint,
  loaded,
  figure,
  reports,
  picker,
  typeNames,
  fromModels,
  ownerNames,
  models,
  onChange,
  onJump,
}: {
  lang: Lang;
  item: ReqItem;
  rule: Rule | null;
  ruleset: Ruleset;
  lint: ReturnType<typeof lintRuleset>;
  loaded: boolean;
  figure: { hits: number; of: number } | null;
  reports: { model: string; rows: ReportRow[] }[];
  picker: Picker;
  typeNames: PsetValue[];
  fromModels: ReturnType<typeof modelLevels>;
  ownerNames: string[];
  models: ModelEntry[];
  onChange: (next: Ruleset) => void;
  onJump: (ruleId: string) => void;
}) {
  const TILE = "alt-card flex min-h-0 min-w-0 flex-col overflow-hidden";

  /* A property mapping: Kilde beside I modellen. */
  if (rule && (isMappingRule(rule) || item.property)) {
    const facet = rule.kind === "ids" ? literalFacets(rule)[0] : undefined;
    const check = rule.kind === "extended" && isMappingRule(rule) ? (rule.check as CodeLookupCheck | CopyObjectCheck | TfmCheck) : null;
    const source = check ? check.source : null;
    const property =
      rule.kind === "ids"
        ? facet && (facet.propertySet !== "" || facet.baseName !== "")
          ? { propertySet: facet.propertySet, name: facet.baseName }
          : null
        : source && "property" in source && (source.property.propertySet !== "" || source.property.name !== "")
          ? source.property
          : null;
    const key = property ? keyOf(property.propertySet, property.name) : null;
    const prop = property ? picker.choices?.find((c) => c.set === property.propertySet)?.props.find((p) => p.name === property.name) : undefined;
    const role = item.role;
    const standardRole = role && role !== "tfm" && role !== "type-name" ? (role as CardRole) : null;
    const standardSource = standardRole ? POFIN_SOURCES[ROLE_STANDARD[standardRole]].source : null;
    const standardKey = standardSource && "property" in standardSource ? keyOf(standardSource.property.propertySet, standardSource.property.name) : null;
    const tag: SourceTag = key === null ? null : key === standardKey ? "standard" : prop && prop.valued > 0 ? "model" : "custom";
    const sourceTitle = key ?? (source && !("property" in source) ? item.source : null);

    const pinned: PinnedOption[] = [];
    if (picker.choices && check) {
      if (standardRole && (check.type === "code-lookup" || check.type === "copy-object")) {
        const std = standardOption(standardRole, check as CodeLookupCheck | CopyObjectCheck, picker.choices, ownerNames);
        const extract = std.check.type === "code-lookup" ? std.check.extract : undefined;
        const target = std.check.type === "code-lookup" ? std.check.target : undefined;
        pinned.push({ key: "standard", tag: "standard", set: std.set, name: std.name, n: std.hits, extra: { extract, target } });
        for (const c of rankCandidates(picker.choices, standardRole, check as CodeLookupCheck | CopyObjectCheck, ownerNames, 4)) {
          if (c.set === std.set && c.name === std.name) continue;
          pinned.push({ key: `c\u0000${c.set}\u0000${c.name}`, tag: "suggestion", set: c.set, name: c.name, n: c.prop.valued, extra: { extract: c.extract } });
        }
      } else if (check.type === "tfm") {
        for (const c of rankTfmCandidates(picker.choices, check.sequence, 4)) {
          pinned.push({ key: `c\u0000${c.set}\u0000${c.name}`, tag: "suggestion", set: c.set, name: c.name, n: c.prop.valued });
        }
      }
    }
    const pick = (set: string, name: string, extra?: PinnedOption["extra"]) => {
      let next = withSource(ruleset, rule.id, { propertySet: set, name }, extra ?? {});
      if (next === null) return;
      if (rule.kind === "ids" && facet) {
        // The name follows the property until it is named otherwise.
        const follows = rule.name === facet.baseName || rule.name === t("field.source.property", lang) || rule.name === "";
        if (follows) next = { ...next, rules: next.rules.map((r) => (r.id === rule.id ? ({ ...r, name } as IdsRule) : r)) };
      }
      onChange(next);
    };
    const usedBy = (set: string, name: string) => {
      const other = ruleReading(ruleset, keyOf(set, name), rule.id);
      return other ? { id: other.id, name: other.name } : null;
    };
    const judged = prop ? shownValues(judgeValues(rule, prop.values, ownerNames)) : null;
    return (
      <div data-columns className="grid min-h-0 flex-1 gap-4 [grid-template-columns:minmax(0,5fr)_minmax(0,7fr)]">
        <div className={TILE}>
          <Kilde title={sourceTitle} tag={tag} figure={figure} loaded={loaded} values={judged} lang={lang} />
        </div>
        <div className={TILE}>
          <InModel picker={picker} current={key} pinned={pinned} usedBy={usedBy} lang={lang} onPick={pick} onJump={onJump} />
        </div>
      </div>
    );
  }

  /* Typenavn: the type's Name, its values against the scheme. */
  if (rule && rule.kind === "extended" && rule.check.type === "type-name") {
    return (
      <div className={TILE + " flex-1"}>
        <Kilde title="Type.Name" tag={null} figure={figure} loaded={loaded} values={shownValues(judgeValues(rule, typeNames, ownerNames))} lang={lang} />
      </div>
    );
  }

  /* An IDS rule that is not one property: its figure, Krav read-only above. */
  if (rule) {
    return (
      <div className={TILE + " flex-1"}>
        <Kilde title={item.source} tag={null} figure={figure} loaded={loaded} values={null} lang={lang} />
      </div>
    );
  }

  if (item.kind === "ifc-schema") {
    return (
      <div className={TILE + " flex-1"}>
        <Kilde title="FILE_SCHEMA" tag={null} figure={figure} loaded={loaded} values={null} lang={lang}>
          {reports.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {reports.map(({ model, rows }) => {
                const row = rows.find((r) => r.id === "ifc-schema" && !r.mapping) ?? null;
                const entry = models.find((m) => m.fileName === model);
                const verdict = row?.state === "pass" ? "pass" : row?.state === "warn" ? "warn" : row?.state === "fail" ? "fail" : "na";
                return (
                  <li key={model} className="flex items-center gap-3 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-ink">{model}</span>
                    <span className="font-mono text-muted">{entry?.report?.summary.schema ?? ""}</span>
                    <span className="alt-badge" data-verdict={verdict}>
                      {t(`verdict.${verdict}`, lang)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Kilde>
      </div>
    );
  }

  if (item.kind === "phase" || item.kind === "materials") {
    const slots = item.kind === "phase" ? (["phase"] as const) : (["product", "material"] as const);
    const mmi = roleRule(ruleset, "progress-code")?.check;
    const mmiPhases = mmi?.type === "code-lookup" && (mmi.codes ?? []).some((c) => c.phase);
    return (
      <div className={TILE + " flex-1"}>
        <Kilde title={item.source} tag={null} figure={figure} loaded={loaded} values={null} lang={lang}>
          {slots.map((slot) => {
            const sources = layerSources(ruleset, slot);
            return (
              <LayerList
                key={slot}
                slot={slot}
                label={slots.length > 1 ? t(slot === "product" ? "field.product" : "field.material", lang) : undefined}
                sources={sources}
                kept
                picker={picker}
                issues={lint.filter((i) => i.ruleId === null && i.path.startsWith(layerPath(slot)))}
                judge={layerJudge(slot, ruleset)}
                viaMmi={slot === "phase" && mmiPhases && !sources.some((s) => "progressCode" in s)}
                lang={lang}
                onChange={(next) => onChange(withLayerSources(ruleset, slot, next))}
                onNext={() => {}}
              />
            );
          })}
        </Kilde>
      </div>
    );
  }

  if (item.kind === "storeys") {
    const levels = ruleset.storeys?.levels ?? [];
    const setStoreys = (storeys: Ruleset["storeys"]) => {
      const next: Ruleset = { ...ruleset, storeys };
      if (storeys === undefined) delete next.storeys;
      onChange(next);
    };
    return (
      <div className={TILE + " flex-1"}>
        <Kilde title={item.source} tag={null} figure={figure} loaded={loaded} values={null} lang={lang}>
          <StoreyCard setup={ruleset.storeys} issues={lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys"))} lang={lang} onChange={setStoreys} />
          {fromModels.length > 0 ? (
            <ModelStoreys
              fromModels={fromModels}
              levels={levels}
              lang={lang}
              onAdd={(extra) => setStoreys(setupWithLevels(ruleset.storeys, withLevels(levels, extra)))}
            />
          ) : null}
        </Kilde>
      </div>
    );
  }
  return null;
}
