/** Oppsett v2's two columns under the Krav row:
 *
 *   Kilde       what the requirement maps FROM now: the source, its tag, the
 *               report row's hit figure with a bar, the source's values with
 *               ok / feil against the Krav
 *   I modellen  the model's actual data (edkjo: "what is in the model is
 *               obscure"): the standard source with its count, the ranked
 *               candidates, then every property set as a group, every
 *               property with its fill, distinct count and sample values; a
 *               click makes it the source, a property another requirement
 *               reads says so and jumps there, and «Ikke i modellen» takes a
 *               set and a property typed in */

import { useMemo, useState, type ReactNode } from "react";
import { t, type Lang } from "../i18n";
import { formatCount } from "../format";
import type { PsetChoice } from "../pset-choices";
import type { Picker } from "../SetupPage";
import { INPUT } from "../setup/ValuesInput";
import type { JudgedValue } from "./judge";
import { BUTTON, Labelled, UsedBy } from "./Krav";

export type SourceTag = "standard" | "model" | "custom" | null;

const TAG_LABEL = { standard: "setup.standard", model: "oppsett.fromModel", custom: "setup.custom" } as const;

/** A magnitude bar: the neutral meter of the board. */
export function Meter({ part, whole, className = "" }: { part: number; whole: number; className?: string }) {
  const share = whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
  return (
    <span className={"alt-meter relative block h-1.5 overflow-hidden " + className} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 block" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

export function Kilde({
  title,
  tag,
  figure,
  loaded,
  values,
  lang,
  children,
}: {
  title: string | null;
  tag: SourceTag;
  /** The report row's hits of its basis, summed over the models; null with
   *  no model or no countable row. */
  figure: { hits: number; of: number } | null;
  loaded: boolean;
  /** The source's values, judged; null when none are read. */
  values: JudgedValue[] | null;
  lang: Lang;
  children?: ReactNode;
}) {
  return (
    <div data-kilde className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-3 pb-3">
        <span className="alt-label">{t("oppsett.source", lang)}</span>
        <div className="flex min-w-0 items-baseline gap-3">
          <span data-kilde-source className={"min-w-0 truncate font-mono text-[20px] leading-tight " + (title ? "text-ink" : "text-muted")} title={title ?? undefined}>
            {title ?? t("oppsett.noSource", lang)}
          </span>
          {tag ? <span className="alt-src shrink-0">{t(TAG_LABEL[tag], lang)}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span data-kilde-figure className="font-mono text-[15px] tabular-nums text-ink">
            {loaded && figure ? `${formatCount(figure.hits, lang)} / ${formatCount(figure.of, lang)}` : "—"}
          </span>
          {loaded && figure ? <Meter part={figure.hits} whole={figure.of} /> : null}
        </div>
      </div>
      {children ? <div className="flex min-h-0 shrink-0 flex-col gap-4 overflow-auto px-4 pb-4 [flex-grow:1] [flex-basis:0]">{children}</div> : null}
      {loaded && values && values.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="alt-head grid shrink-0 items-center gap-3 px-4 py-1 [grid-template-columns:minmax(0,1fr)_5rem_1.25rem] [box-shadow:inset_0_1px_0_var(--d-hair),inset_0_-1px_0_var(--d-hair)]">
            <span className="alt-label">{t("field.value", lang)}</span>
            <span className="alt-label text-right">{t("col.count", lang)}</span>
            <span />
          </div>
          <ol data-values className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
            {values.map((row) => (
              <li
                key={row.v}
                data-ok={row.ok === null ? "unknown" : String(row.ok)}
                className="grid items-center gap-3 px-4 py-1 text-[13px] [grid-template-columns:minmax(0,1fr)_5rem_1.25rem]"
              >
                <span className={"min-w-0 truncate font-mono " + (row.ok === false ? "text-bad" : "text-ink")} title={row.v}>
                  {row.v}
                </span>
                <span className="text-right font-mono tabular-nums text-muted">{formatCount(row.n, lang)}</span>
                <span
                  aria-hidden="true"
                  className={"text-center font-mono text-[13px] " + (row.ok === false ? "text-bad" : row.ok ? "text-green" : "text-muted")}
                >
                  {row.ok === null ? "–" : row.ok ? "✓" : "✗"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** One pinned option over the groups: the standard, or a suggestion. */
export interface PinnedOption {
  key: string;
  tag: "standard" | "suggestion";
  set: string;
  name: string;
  /** Elements carrying a value. */
  n: number;
  /** What a pick writes with the source (the standard's or the candidate's
   *  Uttrekk and target). */
  extra?: { extract?: string; target?: "occurrence" | "type" };
}

export function InModel({
  picker,
  current,
  pinned,
  usedBy,
  lang,
  onPick,
  onJump,
}: {
  picker: Picker;
  /** The requirement's current source key, `Pset.Property`. */
  current: string | null;
  pinned: readonly PinnedOption[];
  /** The requirement reading a key, other than this one: its id and name. */
  usedBy: (set: string, name: string) => { id: string; name: string } | null;
  lang: Lang;
  onPick: (set: string, name: string, extra?: PinnedOption["extra"]) => void;
  onJump: (ruleId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(current ? [current.slice(0, current.lastIndexOf("."))] : []));
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState({ set: "", name: "" });
  const q = query.trim().toLowerCase();
  const groups = useMemo((): { choice: PsetChoice; props: PsetChoice["props"] }[] => {
    if (!picker.choices) return [];
    return picker.choices
      .map((choice) => ({
        choice,
        props:
          q === "" || choice.set.toLowerCase().includes(q)
            ? choice.props
            : choice.props.filter((p) => p.name.toLowerCase().includes(q) || p.values.slice(0, 3).some((v) => v.v.toLowerCase().includes(q))),
      }))
      .filter((g) => g.props.length > 0);
  }, [picker.choices, q]);
  const total = picker.total;
  const keyOf = (set: string, name: string) => `${set}.${name}`;
  const typedTaken = typed.set !== "" || typed.name !== "" ? usedBy(typed.set, typed.name) : null;

  const row = (set: string, name: string, n: number, distinct: number | null, extra: ReactNode, onClick: () => void, sub?: ReactNode) => {
    const taken = usedBy(set, name);
    const chosen = current === keyOf(set, name);
    return (
      <li key={`${set}\u0000${name}`}>
        <button
          type="button"
          data-prop={keyOf(set, name)}
          data-taken={taken ? "" : undefined}
          aria-current={chosen || undefined}
          onClick={taken ? () => onJump(taken.id) : onClick}
          className={
            "grid w-full items-center gap-x-3 rounded-[6px] px-3 py-1.5 text-left [grid-template-columns:minmax(0,1fr)_7.5rem_3.5rem] " +
            (chosen ? "alt-chosen" : "alt-hover")
          }
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              {extra}
              <span className={"min-w-0 truncate font-mono text-[13px] " + (taken ? "text-muted" : "text-ink")} title={keyOf(set, name)}>
                {name}
              </span>
            </span>
            {taken ? (
              <span className="truncate text-[11px] text-bad">
                {t("oppsett.usedBy", lang)} {taken.name}
              </span>
            ) : (
              sub
            )}
          </span>
          <span className="flex flex-col items-end gap-1">
            <span className="font-mono text-[12px] tabular-nums text-ink">{formatCount(n, lang)}</span>
            {total !== null && total > 0 ? <Meter part={n} whole={total} className="w-full" /> : null}
          </span>
          <span className="text-right font-mono text-[12px] tabular-nums text-muted">{distinct === null ? "" : formatCount(distinct, lang)}</span>
        </button>
      </li>
    );
  };

  return (
    <div data-in-model className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
        <span className="alt-label">{t("oppsett.inModel", lang)}</span>
        <input
          type="search"
          aria-label={t("oppsett.search", lang)}
          placeholder={t("oppsett.search", lang)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={INPUT + " min-h-9 w-full text-[13px]"}
        />
      </div>
      <div className="grid shrink-0 items-center gap-x-3 px-7 py-1 [grid-template-columns:minmax(0,1fr)_7.5rem_3.5rem] [box-shadow:inset_0_1px_0_var(--d-hair),inset_0_-1px_0_var(--d-hair)]">
        <span className="alt-label">{t("field.source.property", lang)}</span>
        <span className="alt-label text-right">{t("walk.selected", lang)}</span>
        <span className="alt-label text-right">{t("field.values", lang)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {pinned.length > 0 ? (
          <ol data-pinned className="m-0 flex list-none flex-col gap-0.5 p-0 pb-2">
            {pinned.map((p) => {
              const prop = picker.choices?.find((c) => c.set === p.set)?.props.find((x) => x.name === p.name);
              return row(
                p.set,
                p.name,
                p.n,
                prop?.distinct ?? null,
                <span className="alt-src shrink-0">{t(p.tag === "standard" ? "setup.standard" : "oppsett.suggestion", lang)}</span>,
                () => onPick(p.set, p.name, p.extra),
                <PropSub set={p.set} values={prop?.values.slice(0, 3).map((v) => v.v) ?? []} />,
              );
            })}
          </ol>
        ) : null}
        {picker.reading ? <p className="m-0 px-3 py-1 text-[13px] text-muted">{t("file.parsing", lang)}</p> : null}
        <ol data-groups className="m-0 flex list-none flex-col gap-1 p-0">
          {groups.map(({ choice, props }) => {
            const expanded = q !== "" || open.has(choice.set);
            return (
              <li key={choice.set} data-set={choice.set}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((was) => {
                      const next = new Set(was);
                      if (next.has(choice.set)) next.delete(choice.set);
                      else next.add(choice.set);
                      return next;
                    })
                  }
                  className="alt-hover grid w-full items-center gap-x-3 rounded-[6px] px-3 py-1.5 text-left [grid-template-columns:minmax(0,1fr)_7.5rem_3.5rem]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="w-3 shrink-0 font-mono text-[11px] text-muted">
                      {expanded ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-ink">{choice.set}</span>
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums text-muted">{formatCount(choice.objects, lang)}</span>
                  <span />
                </button>
                {expanded ? (
                  <ol className="m-0 flex list-none flex-col gap-0.5 p-0 pl-4">
                    {props.map((p) =>
                      row(choice.set, p.name, p.valued, p.distinct, null, () => onPick(choice.set, p.name), (
                        <PropSub values={p.values.slice(0, 3).map((v) => v.v)} />
                      )),
                    )}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="mt-2 flex flex-col gap-2 px-1">
          <button type="button" data-not-in-model aria-expanded={typing} onClick={() => setTyping((was) => !was)} className="alt-hover w-fit rounded-[6px] px-2 py-1.5 text-left text-[13px] text-ink">
            {t("oppsett.notInModel", lang)}
          </button>
          {typing ? (
            <div className="flex flex-wrap items-end gap-2 px-2">
              <Labelled label={t("field.propertySet", lang)}>
                <input type="text" className={INPUT + " w-48"} value={typed.set} aria-invalid={typedTaken !== null} onChange={(e) => setTyped({ ...typed, set: e.target.value })} />
              </Labelled>
              <Labelled label={t("field.propertyName", lang)}>
                <input type="text" className={INPUT + " w-48"} value={typed.name} aria-invalid={typedTaken !== null} onChange={(e) => setTyped({ ...typed, name: e.target.value })} />
              </Labelled>
              <button
                type="button"
                disabled={typed.set.trim() === "" || typed.name.trim() === "" || typedTaken !== null}
                onClick={() => {
                  onPick(typed.set.trim(), typed.name.trim());
                  setTyping(false);
                  setTyped({ set: "", name: "" });
                }}
                className={BUTTON}
              >
                {t("action.apply", lang)}
              </button>
              {typedTaken ? <UsedBy name={typedTaken.name} lang={lang} onClick={() => onJump(typedTaken.id)} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Under a property's name: its set (pinned rows) and up to three of its
 *  values. */
function PropSub({ set, values }: { set?: string; values: readonly string[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
      {set ? <span className="shrink-0 font-mono">{set}</span> : null}
      {values.map((v) => (
        <span key={v} className="max-w-36 truncate rounded-[4px] bg-[var(--d-tint)] px-1 font-mono text-ink">
          {v}
        </span>
      ))}
    </span>
  );
}
