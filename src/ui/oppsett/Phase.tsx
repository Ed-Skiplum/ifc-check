/** Fase's wizard body (edkjo 2026-10-06: "it should be possible to assign MMI
 *  codes to phases, including setting up your own phases").
 *
 *   main   Status / MMI, where the phase is read from. With MMI, the phase
 *          table: one row per phase, its name editable, its codes as chips,
 *          a delete; «Legg til fase»; then the codes in no phase. A chip
 *          click selects it (several may be), a row click moves the
 *          selection there, a click on the free codes takes it out of its
 *          phase. Any project property source keeps its list (`LayerList`).
 *   Kilde  the values the phase row found, per the report, against the
 *          accepted phases (the MMI table's among them).
 *
 * Every edit writes the ruleset at once, as the rest of the page does. */

import { useMemo, useState } from "react";
import type { ReportRow } from "../../engine/report.ts";
import type { CodeEntry, LintIssue, Ruleset } from "../../ids/types.ts";
import { t, type Lang } from "../i18n";
import { layerJudge, layerPath } from "../layer-steps";
import { LayerList, type Picker } from "../SetupPage";
import { PILL } from "../setup/ChipRow";
import { INPUT } from "../setup/ValuesInput";
import { Kilde } from "./Columns";
import type { JudgedValue } from "./judge";
import { shownValues } from "./judge";
import { BUTTON, DATUM } from "./Krav";
import {
  assignCodes,
  codesOf,
  deletePhase,
  mmiCodes,
  otherPhaseSources,
  phaseMode,
  phaseNameTaken,
  phaseRows,
  renamePhase,
  unassigned,
  withMmiCodes,
  withOtherPhaseSources,
  withPhaseMode,
  type PhaseMode,
} from "./phase-mmi";

/** The phase rows' value distribution over the models, judged as the engine
 *  flagged it: accepted is ok, anything else carried is not. */
function foundValues(rows: readonly (ReportRow | null)[]): JudgedValue[] {
  const by = new Map<string, JudgedValue>();
  for (const row of rows) {
    for (const f of row?.fordeling ?? []) {
      if (f.verdi === null) continue;
      const was = by.get(f.verdi);
      const ok = f.flagg === "";
      by.set(f.verdi, was ? { ...was, n: was.n + f.n, ok: was.ok && ok } : { v: f.verdi, n: f.n, ok });
    }
  }
  return [...by.values()];
}

export function PhaseBody({
  lang,
  ruleset,
  source,
  lint,
  loaded,
  figure,
  rows,
  picker,
  tile,
  onChange,
}: {
  lang: Lang;
  ruleset: Ruleset;
  /** The item's source line, the Kilde title. */
  source: string | null;
  lint: LintIssue[];
  loaded: boolean;
  figure: { hits: number; of: number } | null;
  /** The phase row of each model. */
  rows: readonly (ReportRow | null)[];
  picker: Picker;
  tile: string;
  onChange: (next: Ruleset) => void;
}) {
  const mode = phaseMode(ruleset);
  const others = otherPhaseSources(ruleset);
  const path = layerPath("phase");
  const sources = ruleset.projectLayer?.phase?.sources ?? [];
  // Lint names a source by its index in the whole list; the list below holds
  // the others alone, so the MMI source's index is taken out.
  const mmiAt = sources.findIndex((s) => "progressCode" in s);
  const issues = lint
    .filter((i) => i.ruleId === null && i.path.startsWith(path))
    .flatMap((i) => {
      const m = /^\[(\d+)\]/.exec(i.path.slice(path.length));
      if (!m || mmiAt < 0) return [i];
      const k = Number(m[1]);
      if (k === mmiAt) return [];
      return [{ ...i, path: `${path}[${k > mmiAt ? k - 1 : k}]${i.path.slice(path.length + m[0].length)}` }];
    });
  const values = useMemo(() => shownValues(foundValues(rows)), [rows]);

  return (
    <div data-columns className="grid min-w-0 items-start gap-4 [grid-template-columns:minmax(0,1fr)_300px]">
      <div className={tile}>
        <div data-phase-step className="flex min-h-0 flex-col gap-4 overflow-auto px-4 pt-3 pb-4">
          <div data-phase-mode className="flex flex-wrap gap-2">
            {(["status", "mmi"] as PhaseMode[]).map((m) => (
              <button
                key={m}
                type="button"
                data-mode={m}
                aria-pressed={mode === m}
                onClick={() => (mode === m ? undefined : onChange(withPhaseMode(ruleset, m)))}
                className={PILL + " min-w-20"}
              >
                {t(m === "status" ? "phase.status" : "phase.mmi", lang)}
              </button>
            ))}
          </div>
          {mode === "mmi" ? <PhaseTable lang={lang} codes={mmiCodes(ruleset)} onCodes={(codes) => onChange(withMmiCodes(ruleset, codes))} /> : null}
          {mode === "status" || others.length > 0 ? (
            <LayerList
              slot="phase"
              sources={others}
              kept
              picker={picker}
              issues={issues}
              judge={layerJudge("phase", ruleset)}
              viaMmi={false}
              lang={lang}
              onChange={(next) => onChange(withOtherPhaseSources(ruleset, next))}
              onNext={() => {}}
            />
          ) : null}
        </div>
      </div>
      <div className={tile + " sticky top-0"}>
        <Kilde title={source} tag={null} figure={figure} loaded={loaded} values={values} lang={lang} />
      </div>
    </div>
  );
}

const TRASH = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
  </svg>
);

function PhaseTable({ lang, codes, onCodes }: { lang: Lang; codes: CodeEntry[]; onCodes: (codes: CodeEntry[]) => void }) {
  // The table's rows while the page is open: a phase whose codes all went
  // elsewhere, or a new one, stays listed.
  const [order, setOrder] = useState<string[]>(() => phaseRows(codes, []));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null);
  const rows = phaseRows(codes, order);
  const free = unassigned(codes);
  const moving = picked.size > 0;

  const toggle = (code: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const moveTo = (phase: string | null) => {
    if (!moving) return;
    onCodes(assignCodes(codes, picked, phase));
    setOrder(rows);
    setPicked(new Set());
  };
  const rename = (index: number, draft: string) => {
    setEditing({ index, draft });
    const to = draft.trim();
    if (to === "" || phaseNameTaken(rows, index, to) || to === rows[index]) return;
    onCodes(renamePhase(codes, rows[index], to));
    setOrder(rows.map((r, i) => (i === index ? to : r)));
  };
  const remove = (index: number) => {
    setEditing(null);
    if (codesOf(codes, rows[index]).length > 0) onCodes(deletePhase(codes, rows[index]));
    setOrder(rows.filter((_, i) => i !== index));
  };

  const chip = (c: CodeEntry) => (
    <button
      key={c.code}
      type="button"
      data-code={c.code}
      data-sel={picked.has(c.code) ? "" : undefined}
      aria-pressed={picked.has(c.code)}
      title={`${c.code} ${c.name}`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(c.code);
      }}
      className={DATUM + " cursor-pointer"}
    >
      {c.code}
    </button>
  );

  return (
    <div
      data-phase-table
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        if (e.key === "Escape" && moving) {
          e.stopPropagation();
          setPicked(new Set());
        }
      }}
    >
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((phase, i) => {
          const draft = editing?.index === i ? editing.draft : phase;
          const taken = draft.trim() !== "" && phaseNameTaken(rows, i, draft);
          const target = moving && phase !== "";
          return (
            <li
              key={i}
              data-phase={phase}
              onClick={target ? () => moveTo(phase) : undefined}
              className={
                "grid items-center gap-3 rounded-[8px] px-2 py-1.5 [grid-template-columns:12rem_minmax(0,1fr)_auto] [box-shadow:inset_0_0_0_1px_var(--d-hair)] " +
                (target ? "alt-hover cursor-pointer" : "")
              }
            >
              <input
                type="text"
                aria-label={t("field.phase", lang)}
                autoFocus={phase === ""}
                value={draft}
                aria-invalid={taken || draft.trim() === ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => rename(i, e.target.value)}
                onBlur={() => setEditing(null)}
                className={INPUT + " w-full"}
              />
              <span className="flex min-h-9 min-w-0 flex-wrap items-center gap-1.5">{codesOf(codes, phase).map(chip)}</span>
              <button
                type="button"
                data-phase-delete
                aria-label={t("action.delete", lang)}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                className={BUTTON + " px-2 hover:border-bad hover:text-bad"}
              >
                {TRASH}
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        data-phase-add
        disabled={rows.includes("")}
        onClick={() => {
          setPicked(new Set());
          setOrder([...rows, ""]);
        }}
        className={BUTTON + " w-fit"}
      >
        + {t("phase.add", lang)}
      </button>
      {free.length > 0 || moving ? (
        <div
          data-phase-free
          onClick={() => moveTo(null)}
          className={
            "flex min-h-11 flex-wrap items-center gap-1.5 rounded-[8px] px-2 py-1.5 [box-shadow:inset_0_1px_0_var(--d-hair)] " +
            (moving ? "alt-hover cursor-pointer" : "")
          }
        >
          {free.map(chip)}
        </div>
      ) : null}
    </div>
  );
}
