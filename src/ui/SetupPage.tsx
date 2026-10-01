/** The project mappings: where this project's IFC carries the concepts every
 *  project has and each stores differently.
 *
 * A mapping is not a construct of its own. Each card edits the one code-lookup
 * rule carrying that `mapping` role in the ruleset, so what is set here is
 * exactly what the ruleset JSON holds and what the evaluator runs. Turning a
 * card off sets the rule's `enabled` to false and keeps what was entered.
 *
 * The on/off is a switch (2026-09-21). edkjo found the old bordered "Aktiv"
 * button non-obvious and asked that double-clicking a card that is off asks
 * whether to enable it; a card that is on ignores double-click, and a
 * double-click inside a live field is the field's own.
 *
 * One section at a time (2026-10-01). edkjo: "the config is a bit hard, so we
 * should have an onboarding, pull me through there". With no ruleset the page
 * opens on a choice: a filled-in config file (or the template to fill), or
 * «Veiled meg». The walk opens an IFC first, so a property source is picked
 * from the sets and properties the model carries, with «Egenskapen er ikke
 * med» for one it lacks. A rail names every step and jumps freely. «Lagre
 * oppsett» keeps the ruleset in the browser (`storage/saved-ruleset.ts`) and
 * returns to the board; "Last ned" stays the file export.
 */

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { CODE_LISTS, CODE_LIST_IDS } from "../codelists/index.ts";
import { MAPPING_ROLES, hasErrors, lintRuleset } from "../ids/lint.ts";
import { anyRoleRule } from "../ids/models.ts";
import type {
  CodeEntry,
  CodeLookupCheck,
  CodeSource,
  CopyObjectCheck,
  ExtendedRule,
  LintIssue,
  MappingRole,
  Ruleset,
  StoreyLevel,
  StoreyPlane,
  StoreySetup,
} from "../ids/types.ts";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { Switch } from "./Switch";
import { CONFIG_TEMPLATE_FILE } from "../ids/config-template.ts";
import { formatCount } from "./format";
import { mergeChoices, type PsetChoice } from "./pset-choices";
import type { ModelEntry } from "./useModels";

const SOURCE_KINDS = ["attribute", "property", "classification"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];

type MappingCheck = CodeLookupCheck | CopyObjectCheck;

function sourceKind(source: CodeSource): SourceKind {
  if ("property" in source) return "property";
  if ("classification" in source) return "classification";
  return "attribute";
}

/** The rule builder's own blank values (builder/RuleEditor.tsx), so a mapping
 *  starts where a hand-added code-lookup starts. */
function blankSource(kind: SourceKind): CodeSource {
  switch (kind) {
    case "attribute":
      return { attribute: "Name" };
    case "property":
      return { property: { propertySet: "", name: "" } };
    case "classification":
      return { classification: {} };
  }
}

function blankCheck(role: MappingRole): MappingCheck {
  const base = { type: "code-lookup", source: { attribute: "Name" } } as const;
  switch (role) {
    case "system-classification":
    case "component-classification":
      return { ...base, list: CODE_LIST_IDS[0], target: "occurrence", extract: "^(.+)$" };
    case "progress-code":
      return { ...base, codes: [], extract: "^(.+)$" };
    case "copy-object":
      return { type: "copy-object", source: { attribute: "Name" }, copy: [], own: [] };
  }
}

function freshId(ruleset: Ruleset, stem: string): string {
  const taken = new Set(ruleset.rules.map((r) => r.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function mappingRule(ruleset: Ruleset, role: MappingRole): ExtendedRule | null {
  return anyRoleRule(ruleset, role);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The .xlsx beside the JSON: `EKS.ruleset.json` -> `EKS.xlsx`. */
function xlsxName(fileName: string): string {
  return `${fileName.replace(/(\.ruleset)?\.json$/i, "")}.xlsx`;
}

/** The .ids beside the JSON: `EKS.ruleset.json` -> `EKS.ids`. */
function idsName(fileName: string): string {
  return `${fileName.replace(/(\.ruleset)?\.json$/i, "")}.ids`;
}

/** The enabled ids rules as one IDS 1.0 file (export.ts). Null when there
 *  are none: an .ids with no specification is invalid. */
async function downloadIds(ruleset: Ruleset, fileName: string): Promise<void> {
  const { exportRuleset } = await import("../ids/export.ts");
  const ids = exportRuleset(ruleset).ids;
  if (ids === null) throw new Error("no enabled IDS specification: no .ids to write");
  downloadBlob(new Blob([ids], { type: "application/xml" }), fileName);
}

function downloadRuleset(ruleset: Ruleset, fileName: string): void {
  downloadBlob(new Blob([JSON.stringify(ruleset, null, 2) + "\n"], { type: "application/json" }), fileName);
}

/** The workbook is written by a lazily loaded module, which reads its own
 *  output back and throws on any difference; the throw is shown, not eaten. */
async function downloadXlsx(ruleset: Ruleset, fileName: string): Promise<void> {
  const { writeRulesetXlsx } = await import("../ids/xlsx.ts");
  const bytes = writeRulesetXlsx(ruleset);
  downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const LABEL = "text-[10px] font-semibold tracking-[0.12em] text-gold uppercase";
const SECONDARY =
  "flex items-center gap-2 border border-line bg-cream px-3 py-1.5 text-[12px] text-ink hover:border-green hover:text-green";
const INPUT =
  "border border-line bg-input px-2 py-1 font-mono text-[12px] text-ink " +
  "disabled:text-muted aria-[invalid=true]:border-bad";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Seg<T extends string>({
  options,
  value,
  disabled,
  label,
  onChange,
}: {
  options: readonly T[];
  value: T;
  disabled: boolean;
  label: (option: T) => string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex w-fit items-center overflow-hidden border border-line">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={
            "px-3 py-1 text-[12px] " +
            (option === value ? "bg-green text-cream" : "bg-input text-muted hover:text-ink") +
            " disabled:opacity-60"
          }
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/** The project's code list: code, name and, on MMI, the phase. */
function CodesTable({
  codes,
  disabled,
  issues,
  lang,
  onChange,
}: {
  codes: CodeEntry[];
  disabled: boolean;
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: CodeEntry[]) => void;
}) {
  const invalid = (i: number, field: string) => issues.some((issue) => issue.path.endsWith(`.check.codes[${i}].${field}`));
  const set = (i: number, patch: Partial<CodeEntry>) =>
    onChange(
      codes.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        if (next.phase === "") delete next.phase;
        return next;
      }),
    );
  return (
    <div className="flex flex-col gap-1">
      {codes.length > 0 ? (
        <div className="grid max-h-40 content-start items-center gap-x-2 gap-y-1 overflow-auto [grid-template-columns:5rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <span className={LABEL}>{t("field.code", lang)}</span>
          <span className={LABEL}>{t("field.name", lang)}</span>
          <span className={LABEL}>{t("field.phase", lang)}</span>
          <span />
          {codes.map((c, i) => (
            <CodeRow key={i} entry={c} disabled={disabled} lang={lang} invalid={(f) => invalid(i, f)} onChange={(p) => set(i, p)} onRemove={() => onChange(codes.filter((_, j) => j !== i))} />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...codes, { code: "", name: "" }])}
        className="w-fit border border-line bg-input px-2 py-0.5 text-[12px] text-muted hover:border-green hover:text-green disabled:opacity-60"
      >
        {t("action.addRow", lang)}
      </button>
    </div>
  );
}

function CodeRow({
  entry,
  disabled,
  lang,
  invalid,
  onChange,
  onRemove,
}: {
  entry: CodeEntry;
  disabled: boolean;
  lang: Lang;
  invalid: (field: string) => boolean;
  onChange: (patch: Partial<CodeEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input type="text" className={INPUT} disabled={disabled} aria-invalid={invalid("code")} value={entry.code} onChange={(e) => onChange({ code: e.target.value })} />
      <input type="text" className={INPUT} disabled={disabled} aria-invalid={invalid("name")} value={entry.name} onChange={(e) => onChange({ name: e.target.value })} />
      <input type="text" className={INPUT} disabled={disabled} aria-invalid={invalid("phase")} value={entry.phase ?? ""} onChange={(e) => onChange({ phase: e.target.value })} />
      <button type="button" disabled={disabled} onClick={onRemove} className="px-2 py-0.5 text-[12px] text-muted hover:text-bad disabled:opacity-60">
        {t("action.remove", lang)}
      </button>
    </>
  );
}

/** Comma-separated codes. The draft keeps what is typed, trailing comma and
 *  all; the rule gets the parsed list on every keystroke. */
function ValuesInput({
  values,
  disabled,
  invalid,
  onChange,
}: {
  values: string[];
  disabled: boolean;
  invalid: boolean;
  onChange: (next: string[]) => void;
}) {
  const joined = values.join(", ");
  const [draft, setDraft] = useState(joined);
  // A new list from outside (a loaded file) replaces the draft; the list this
  // draft itself produced does not.
  const [seen, setSeen] = useState(joined);
  if (seen !== joined) {
    setSeen(joined);
    if (parseValues(draft).join(", ") !== joined) setDraft(joined);
  }
  return (
    <input
      type="text"
      className={INPUT}
      disabled={disabled}
      aria-invalid={invalid}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseValues(e.target.value));
      }}
    />
  );
}

function parseValues(text: string): string[] {
  return text
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** The property source, picked from the loaded models: every set with its
 *  properties and element counts (`pset-choices.ts`), filtered as you type,
 *  arrows and Enter to pick. «Egenskapen er ikke med» is always the last
 *  option and opens the two fields, so a property the model lacks can be
 *  typed as it should have been. The fields stay open once opened, and are
 *  the only input when no model is loaded. */
function PropertyPicker({
  value,
  choices,
  reading,
  errors,
  disabled,
  invalidSet,
  invalidName,
  lang,
  onChange,
}: {
  value: { propertySet: string; name: string };
  /** null: no model on the board, so nothing to pick from. */
  choices: PsetChoice[] | null;
  reading: boolean;
  errors: string[];
  disabled: boolean;
  invalidSet: boolean;
  invalidName: boolean;
  lang: Lang;
  onChange: (next: { propertySet: string; name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [manual, setManual] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const found =
    choices?.some((c) => c.set === value.propertySet && c.props.some((p) => p.name === value.name)) ?? false;
  const blank = value.propertySet === "" && value.name === "";
  // A value the model does not carry can only be shown in the fields.
  const fieldsOpen = manual || (choices === null && !reading) || (!found && !blank && !reading);

  const q = query.trim().toLowerCase();
  const groups = (choices ?? [])
    .map((c) =>
      q === "" || c.set.toLowerCase().includes(q)
        ? c
        : { ...c, props: c.props.filter((p) => p.name.toLowerCase().includes(q)) },
    )
    .filter((c) => c.props.length > 0);
  type Option = { kind: "prop"; set: string; name: string } | { kind: "manual" };
  const options: Option[] = [
    ...groups.flatMap((c) => c.props.map((p): Option => ({ kind: "prop", set: c.set, name: p.name }))),
    { kind: "manual" },
  ];
  // Each group's first index in `options`.
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, c) => n + c.props.length, 0));
  const optionId = (i: number) => `${baseId}-o${i}`;
  const at = Math.min(active, options.length - 1);

  const pick = (option: Option) => {
    if (option.kind === "prop") {
      setManual(false);
      onChange({ propertySet: option.set, name: option.name });
    } else {
      setManual(true);
      requestAnimationFrame(() => setRef.current?.focus());
    }
  };

  // The keyboard's option, or on first show the picked one, scrolled into
  // view inside the list, never by scrolling the page.
  const listed = choices !== null;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = at >= 0 ? document.getElementById(`${baseId}-o${at}`) : list.querySelector<HTMLElement>("[aria-selected=true]");
    if (!el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [at, baseId, listed]);

  const row = (selected: boolean, i: number) =>
    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[12px] " +
    (selected ? "bg-green text-cream" : i === at ? "bg-palegreen text-ink" : "text-ink hover:bg-palegreen");

  return (
    <div className="flex flex-col gap-3">
      {choices !== null || reading ? (
        <div className={"flex flex-col border border-line bg-input" + (disabled ? " opacity-60" : "")}>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-muted">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              role="combobox"
              aria-label={t("field.source.property", lang)}
              aria-expanded="true"
              aria-controls={`${baseId}-list`}
              aria-activedescendant={at >= 0 ? optionId(at) : undefined}
              disabled={disabled}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(Math.min(at + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(Math.max(at - 1, 0));
                } else if (e.key === "Enter" && at >= 0) {
                  e.preventDefault();
                  pick(options[at]);
                } else if (e.key === "Escape" && query !== "") {
                  e.preventDefault();
                  setQuery("");
                  setActive(-1);
                }
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
            />
            {reading ? <span className="shrink-0 text-[11px] text-muted">{t("file.parsing", lang)}</span> : null}
          </div>
          <div ref={listRef} id={`${baseId}-list`} role="listbox" className="relative max-h-72 overflow-auto py-1">
            {groups.map((c, g) => (
              <div key={c.set} role="group" aria-label={c.set}>
                <div className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-1">
                  <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-muted">{c.set}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                    {formatCount(c.objects, lang)}
                  </span>
                </div>
                {c.props.map((p, k) => {
                  const i = starts[g] + k;
                  const selected = value.propertySet === c.set && value.name === p.name;
                  return (
                    <div
                      key={p.name}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      // Keeps focus in the search field.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => !disabled && pick({ kind: "prop", set: c.set, name: p.name })}
                      className={row(selected, i) + " pl-6"}
                    >
                      <span className="min-w-0 truncate font-mono">{p.name}</span>
                      <span className="shrink-0 font-mono tabular-nums">{formatCount(p.n, lang)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div
              id={optionId(options.length - 1)}
              role="option"
              aria-selected={fieldsOpen && !found}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !disabled && pick({ kind: "manual" })}
              className={row(fieldsOpen && !found, options.length - 1) + (groups.length > 0 ? " mt-1 border-t border-line" : "")}
            >
              <span>{t("field.notInModel", lang)}</span>
            </div>
          </div>
        </div>
      ) : null}
      {errors.length > 0 ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {errors.join("\n")}
        </pre>
      ) : null}
      {fieldsOpen ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("field.propertySet", lang)}>
            <input
              ref={setRef}
              type="text"
              className={INPUT}
              disabled={disabled}
              aria-invalid={invalidSet}
              value={value.propertySet}
              onChange={(e) => onChange({ ...value, propertySet: e.target.value })}
            />
          </Field>
          <Field label={t("field.propertyName", lang)}>
            <input
              type="text"
              className={INPUT}
              disabled={disabled}
              aria-invalid={invalidName}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function MappingCard({
  role,
  rule,
  issues,
  lang,
  onToggle,
  onCheck,
  onAskEnable,
  picker,
}: {
  role: MappingRole;
  rule: ExtendedRule | null;
  issues: LintIssue[];
  lang: Lang;
  /** What the property picker lists, from the loaded models. */
  picker: { choices: PsetChoice[] | null; reading: boolean; errors: string[] };
  onToggle: () => void;
  onCheck: (next: MappingCheck) => void;
  /** Double-click on the card while it is off. */
  onAskEnable: () => void;
}) {
  const active = rule !== null && rule.enabled !== false;
  const check: MappingCheck =
    rule && (rule.check.type === "code-lookup" || rule.check.type === "copy-object") ? rule.check : blankCheck(role);
  const source = check.source;
  const kind = sourceKind(source);
  const off = !active;
  const invalid = (suffix: string) => issues.some((i) => i.path.includes(`.check.${suffix}`));
  const classification = role === "system-classification" || role === "component-classification";

  // Never hijack a double-click meant for a live control.
  const onLive = (event: MouseEvent<HTMLElement>) =>
    (event.target as HTMLElement).closest(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
    ) !== null;
  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (active || onLive(event)) return;
    onAskEnable();
  };

  return (
    <section
      onDoubleClick={onDoubleClick}
      // The second press of a double-click on an OFF card would otherwise
      // select the word under the pointer behind the dialog.
      onMouseDown={(event) => {
        if (!active && event.detail > 1 && !onLive(event)) event.preventDefault();
      }}
      className="flex flex-col gap-4 border border-line bg-panel p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className={"m-0 text-sm font-medium " + (active ? "text-ink" : "text-muted")}>
          {t(`mapping.${role}`, lang)}
        </h2>
        <Switch on={active} label={t("field.enabled", lang)} onChange={onToggle} />
      </div>

      {classification && check.type === "code-lookup" ? (
        <div className="flex flex-wrap gap-3">
          <Field label={t("field.list", lang)}>
            <select
              className={INPUT}
              disabled={off}
              aria-invalid={invalid("list")}
              value={check.list ?? ""}
              onChange={(e) =>
                onCheck({
                  ...check,
                  list: e.target.value as CodeLookupCheck["list"],
                  codes: undefined,
                })
              }
            >
              {check.list === undefined ? <option value="" /> : null}
              {CODE_LIST_IDS.map((id) => (
                <option key={id} value={id}>
                  {CODE_LISTS[id].meta.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>{t("field.target", lang)}</span>
            <Seg
              options={["occurrence", "type"] as const}
              value={check.target ?? "occurrence"}
              disabled={off}
              label={(o) => t(`field.target.${o}`, lang)}
              onChange={(target) => onCheck({ ...check, target })}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("field.source", lang)}>
          <select
            className={INPUT}
            disabled={off}
            value={kind}
            onChange={(e) => onCheck({ ...check, source: blankSource(e.target.value as SourceKind) })}
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`field.source.${k}` as StringKey, lang)}
              </option>
            ))}
          </select>
        </Field>
        {"attribute" in source ? (
          <Field label={t("field.source.attribute", lang)}>
            <input
              type="text"
              className={INPUT}
              disabled={off}
              aria-invalid={invalid("source")}
              value={source.attribute}
              onChange={(e) => onCheck({ ...check, source: { attribute: e.target.value } })}
            />
          </Field>
        ) : null}
        {"classification" in source ? (
          <Field label={t("field.system", lang)}>
            <input
              type="text"
              className={INPUT}
              disabled={off}
              value={source.classification.system ?? ""}
              onChange={(e) =>
                onCheck({
                  ...check,
                  source: {
                    classification: e.target.value === "" ? {} : { system: e.target.value },
                  },
                })
              }
            />
          </Field>
        ) : null}
      </div>

      {"property" in source ? (
        <PropertyPicker
          value={source.property}
          choices={picker.choices}
          reading={picker.reading}
          errors={picker.errors}
          disabled={off}
          invalidSet={invalid("source.property.propertySet")}
          invalidName={invalid("source.property.name")}
          lang={lang}
          onChange={(property) => onCheck({ ...check, source: { property } })}
        />
      ) : null}

      {check.type === "code-lookup" ? (
        <div className="flex flex-col gap-3">
          <Field label={t("field.extract", lang)}>
            <input
              type="text"
              className={INPUT}
              disabled={off}
              aria-invalid={invalid("extract")}
              value={check.extract}
              onChange={(e) => onCheck({ ...check, extract: e.target.value })}
            />
          </Field>
          {role === "progress-code" ? (
            <CodesTable
              codes={check.codes ?? []}
              disabled={off}
              issues={issues}
              lang={lang}
              onChange={(codes) => onCheck({ ...check, codes })}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("field.copy", lang)}>
            <ValuesInput
              values={check.copy}
              disabled={off}
              invalid={invalid("copy")}
              onChange={(copy) => onCheck({ ...check, copy })}
            />
          </Field>
          <Field label={t("field.own", lang)}>
            <ValuesInput
              values={check.own}
              disabled={off}
              invalid={invalid("own")}
              onChange={(own) => onCheck({ ...check, own })}
            />
          </Field>
        </div>
      )}

      {active && issues.length > 0 ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {issues.map((i) => `${i.path}: ${i.message}`).join("\n")}
        </pre>
      ) : null}
    </section>
  );
}

/** The floor config: ordered levels, name + elevation in metres, measured to
 *  the plane. Stored as the ruleset's `storeys`, checked by `storey-config`.
 *  The plane has no default; a new config matches exactly (tolerance 0 and 0,
 *  a same-named storey at any distance, another name at the same mm), and the
 *  workbook or JSON sets the tolerances. An empty list is no config. */
function StoreyCard({
  setup,
  issues,
  lang,
  onChange,
}: {
  setup: StoreySetup | undefined;
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: StoreySetup | undefined) => void;
}) {
  const storeys = setup?.levels ?? [];
  const invalid = (i: number, field: string) =>
    issues.some((issue) => issue.path === `storeys.levels[${i}].${field}` && issue.severity === "error");
  const planeInvalid = issues.some((issue) => issue.path === "storeys.plane");
  const setLevels = (levels: StoreyLevel[]) => {
    if (levels.length === 0) return onChange(undefined);
    onChange(
      setup
        ? { ...setup, levels }
        : {
            // No plane is chosen for the user: lint refuses the blank until one is.
            plane: "" as StoreyPlane,
            tolerance: { aboveMm: 0, belowMm: 0 },
            nameWindowMm: null,
            nearMm: 0,
            levels,
          },
    );
  };
  const set = (i: number, patch: Partial<StoreyLevel>) =>
    setLevels(storeys.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const plane = setup?.plane;
  const elevationLabel: StringKey =
    plane === "OKFG" || plane === "OKBD" ? `field.storeyElevation.${plane}` : "field.storeyElevation";
  // A FIXED, viewport-derived card (DESIGN.md §1): the rows scroll inside
  // it, so adding a floor never moves the cards below.
  return (
    <section className="flex h-[clamp(15rem,40vh,34rem)] flex-col gap-3 border border-line bg-panel p-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <h2 className="m-0 text-sm font-medium text-ink">{t("setup.storeys", lang)}</h2>
        {setup ? (
          <Field label={t("field.plane", lang)}>
            <select
              className={INPUT}
              aria-invalid={planeInvalid}
              value={setup.plane}
              onChange={(e) => onChange({ ...setup, plane: e.target.value as StoreyPlane })}
            >
              {setup.plane === ("" as StoreyPlane) ? <option value="" /> : null}
              <option value="OKFG">OKFG</option>
              <option value="OKBD">OKBD</option>
            </select>
          </Field>
        ) : null}
      </div>
      {storeys.length > 0 ? (
        <div className="grid min-h-0 content-start items-center gap-x-2 gap-y-1 overflow-auto [grid-template-columns:minmax(0,1fr)_9rem_auto]">
          <span className={LABEL}>{t("field.storeyName", lang)}</span>
          <span className={LABEL}>{t(elevationLabel, lang)}</span>
          <span />
          {storeys.map((storey, i) => (
            <StoreyRow
              key={i}
              storey={storey}
              lang={lang}
              nameInvalid={invalid(i, "name")}
              elevationInvalid={invalid(i, "elevation")}
              onChange={(patch) => set(i, patch)}
              onRemove={() => setLevels(storeys.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setLevels([...storeys, { name: "", elevation: Number.NaN }])}
        className="w-fit shrink-0 border border-line bg-input px-2 py-0.5 text-[12px] text-muted hover:border-green hover:text-green"
      >
        {t("action.addRow", lang)}
      </button>
      {issues.length > 0 ? (
        <pre className="m-0 max-h-24 shrink-0 overflow-auto bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {issues.map((i) => `${i.path}: ${i.message}`).join("\n")}
        </pre>
      ) : null}
    </section>
  );
}

/** Enable a card that is off: its name, and the two answers. Nothing else. */
function EnableDialog({
  title,
  lang,
  onConfirm,
  onCancel,
}: {
  title: string;
  lang: Lang;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onCancel();
      }}
      className="m-auto border border-line bg-panel p-0 text-ink backdrop:bg-ink/30"
    >
      <div className="flex min-w-64 flex-col gap-3 p-4">
        <h2 className="m-0 text-sm font-medium text-ink">{title}</h2>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-line bg-input px-3 py-1 text-[12px] text-ink hover:border-green hover:text-green"
          >
            {t("action.cancel", lang)}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="bg-green px-3 py-1 text-[12px] text-cream hover:bg-ink"
          >
            {t("action.enable", lang)}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The elevation keeps its own draft so "-" or "118," can be typed on the way
 *  to a number; the ruleset gets the parsed value (NaN while incomplete, which
 *  lint refuses, so an unfinished row cannot be downloaded). */
function StoreyRow({
  storey,
  lang,
  nameInvalid,
  elevationInvalid,
  onChange,
  onRemove,
}: {
  storey: StoreyLevel;
  lang: Lang;
  nameInvalid: boolean;
  elevationInvalid: boolean;
  onChange: (patch: Partial<StoreyLevel>) => void;
  onRemove: () => void;
}) {
  const shown = Number.isFinite(storey.elevation) ? String(storey.elevation) : "";
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    if (parseElevation(draft) !== storey.elevation) setDraft(shown);
  }
  return (
    <>
      <input
        type="text"
        className={INPUT}
        aria-invalid={nameInvalid}
        value={storey.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <input
        type="text"
        inputMode="decimal"
        className={INPUT + " text-right"}
        aria-invalid={elevationInvalid}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange({ elevation: parseElevation(e.target.value) });
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="px-2 py-0.5 text-[12px] text-muted hover:text-bad"
      >
        {t("action.remove", lang)}
      </button>
    </>
  );
}

/** Comma or point decimal; anything else is NaN. */
function parseElevation(text: string): number {
  const clean = text.trim().replace(",", ".");
  return clean === "" || !/^-?\d+(\.\d+)?$/.test(clean) ? Number.NaN : Number(clean);
}

/** Oppsett's steps, in order. `start` is the choice between a filled-in
 *  config file and the guided walk; `ifc` opens a model, so the property
 *  pickers have something to list. The names are the sections' own. */
export type SetupStep = "start" | "ifc" | MappingRole | "storeys";

const STEPS: SetupStep[] = ["start", "ifc", ...MAPPING_ROLES, "storeys"];

/** Where the walk goes once a model is on the board. */
export const FIRST_MAPPING_STEP: SetupStep = MAPPING_ROLES[0];

function stepLabel(step: SetupStep, lang: Lang): string {
  if (step === "start") return t("action.setup", lang);
  if (step === "ifc") return t("action.openIfc", lang);
  if (step === "storeys") return t("setup.storeys", lang);
  return t(`mapping.${step}`, lang);
}

const PRIMARY = "flex items-center gap-2 bg-green px-4 py-1.5 text-[12px] text-cream hover:bg-ink";
const TILE = "flex min-h-44 flex-col border border-line bg-panel p-6 text-left";

/** The step rail: every step, freely clickable. The current one is filled,
 *  a configured one carries a check in place of its number. Above the step
 *  on a narrow screen, beside it from md up. */
function StepRail({
  current,
  done,
  lang,
  onStep,
}: {
  current: SetupStep;
  done: (step: SetupStep) => boolean;
  lang: Lang;
  onStep: (step: SetupStep) => void;
}) {
  return (
    <nav className="shrink-0 md:w-56">
      <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible">
        {STEPS.map((step, i) => {
          const here = step === current;
          const ok = !here && done(step);
          return (
            <li key={step} className="shrink-0">
              <button
                type="button"
                aria-current={here ? "step" : undefined}
                onClick={() => onStep(step)}
                className={
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] " +
                  (here ? "bg-green text-cream" : "text-ink hover:bg-panel")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "w-4 shrink-0 text-center font-mono text-[11px] tabular-nums " +
                    (here ? "text-cream" : ok ? "text-green" : "text-muted")
                  }
                >
                  {i === 0 ? "" : ok ? "✓" : i}
                </span>
                <span className="whitespace-nowrap">{stepLabel(step, lang)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SetupPage({
  lang,
  ruleset,
  rulesetLoaded,
  fileName,
  models,
  step,
  onStep,
  onChange,
  onOpen,
  onFiles,
  onSave,
}: {
  lang: Lang;
  ruleset: Ruleset;
  /** A ruleset is loaded or being edited: the walk skips the choice. */
  rulesetLoaded: boolean;
  fileName: string;
  models: ModelEntry[];
  /** The step on screen; null until one is chosen, then the default. */
  step: SetupStep | null;
  onStep: (step: SetupStep) => void;
  onChange: (next: Ruleset) => void;
  /** A ruleset file picked here: .ruleset.json, .xlsx or .ids. True once it
   *  loaded. */
  onOpen: (file: File) => Promise<boolean>;
  /** IFC files picked on the IFC step. */
  onFiles: (files: File[]) => void;
  /** «Lagre oppsett»: null once saved, else the storage's error. */
  onSave: () => string | null;
}) {
  const lint = lintRuleset(ruleset);
  const nameIssue = lint.some((i) => i.ruleId === null && i.path === "name");
  // The name field is marked invalid only once it has been touched or a
  // download was attempted, never on a page nobody has typed on yet.
  const [nameTouched, setNameTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [asking, setAsking] = useState<MappingRole | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const ifcInput = useRef<HTMLInputElement>(null);
  const blocked = hasErrors(lint);
  const hasIds = ruleset.rules.some((r) => r.kind === "ids" && r.enabled !== false);
  const downloadClass = (off: boolean) => SECONDARY + (off ? " cursor-not-allowed text-muted hover:border-line hover:text-muted" : "");

  const firstStep: SetupStep = models.length === 0 ? "ifc" : FIRST_MAPPING_STEP;
  const current: SetupStep = step ?? (rulesetLoaded ? firstStep : "start");
  const at = STEPS.indexOf(current);
  const last = at === STEPS.length - 1;

  // The picker's list: every model that has answered, merged. null while no
  // model is on the board; reading while one is still being read or asked.
  const picker = useMemo(() => {
    const answered = models.filter((m) => m.psets !== undefined).map((m) => m.psets!);
    const reading = models.some(
      (m) => m.state === "queued" || m.state === "parsing" || (m.state === "ready" && !m.psets && !m.psetsError),
    );
    return {
      choices: answered.length > 0 ? mergeChoices(answered) : models.length > 0 && reading ? [] : null,
      reading,
      errors: models.filter((m) => m.psetsError).map((m) => `${m.fileName}: ${m.psetsError}`),
    };
  }, [models]);

  const done = (s: SetupStep): boolean => {
    if (s === "start") return false;
    if (s === "ifc") return models.some((m) => m.state === "ready");
    if (s === "storeys")
      return (ruleset.storeys?.levels.length ?? 0) > 0 && !hasErrors(lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys")));
    const rule = mappingRule(ruleset, s);
    return rule !== null && rule.enabled !== false && !hasErrors(lint.filter((i) => i.ruleId === rule.id));
  };

  const toggle = (role: MappingRole) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) {
      const created: ExtendedRule = {
        id: freshId(ruleset, role),
        kind: "extended",
        // The copy-object role is its check type; the others are a mapping.
        ...(role === "copy-object" ? {} : { mapping: role }),
        name: t(`mapping.${role}`, lang),
        select: { entity: { group: "physicalElement" } },
        check: blankCheck(role),
      };
      onChange({ ...ruleset, rules: [...ruleset.rules, created] });
      return;
    }
    const next: ExtendedRule = { ...rule };
    if (rule.enabled === false) delete next.enabled;
    else next.enabled = false;
    onChange({ ...ruleset, rules: ruleset.rules.map((r) => (r === rule ? next : r)) });
  };

  const setCheck = (role: MappingRole, check: MappingCheck) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) return;
    onChange({
      ...ruleset,
      rules: ruleset.rules.map((r) => (r === rule ? { ...rule, check } : r)),
    });
  };

  const save = () => {
    setExportError(null);
    const error = onSave();
    if (error !== null) setExportError(error);
  };

  // One primary per step: the choice tiles on the first, «Åpne IFC» while
  // no model is open, «Lagre oppsett» on the last, Neste otherwise.
  const nextPrimary = current !== "start" && !(current === "ifc" && models.length === 0);

  let body: React.ReactNode;
  if (current === "start") {
    body = (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={TILE + " gap-4 has-[button:hover]:border-green"}>
          <button
            type="button"
            onClick={() => openInput.current?.click()}
            className="flex flex-1 flex-col items-start justify-center gap-2 text-left"
          >
            <span className="text-lg font-medium text-ink">{t("action.openRuleset", lang)}</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{t("accept.ruleset", lang)}</span>
          </button>
          <a
            href={`${import.meta.env.BASE_URL}${CONFIG_TEMPLATE_FILE}`}
            download={CONFIG_TEMPLATE_FILE}
            className={SECONDARY + " w-fit"}
          >
            {t("action.downloadTemplate", lang)}
          </a>
          <input
            ref={openInput}
            type="file"
            accept=".json,.xlsx,.ids,.xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onOpen(file).then((ok) => ok && onStep(firstStep));
              event.target.value = "";
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => onStep(firstStep)}
          className={TILE + " items-start justify-center hover:border-green"}
        >
          <span className="text-lg font-medium text-ink">{t("action.guideMe", lang)}</span>
        </button>
      </div>
    );
  } else if (current === "ifc") {
    body = (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => ifcInput.current?.click()}
          className={
            "flex min-h-44 flex-col items-start justify-center gap-2 p-6 text-left " +
            (models.length === 0
              ? "bg-green text-cream hover:bg-ink"
              : "border border-line bg-panel text-ink hover:border-green")
          }
        >
          <span className="text-lg font-medium">{t("action.openIfc", lang)}</span>
          <span className="font-mono text-[11px] tracking-wide opacity-75">{t("accept.ifc", lang)}</span>
        </button>
        <input
          ref={ifcInput}
          type="file"
          multiple
          accept=".ifc,.ifczip"
          className="hidden"
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        {models.length > 0 ? (
          <ul className="m-0 flex list-none flex-col border border-line bg-panel p-0">
            {models.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-b-0">
                <span className="min-w-0 truncate font-mono text-[12px] text-ink">{m.fileName}</span>
                <span className={"shrink-0 text-[12px] " + (m.state === "failed" ? "text-bad" : "text-muted")}>
                  {t(m.rejected ? "file.rejected" : `file.${m.state}`, lang)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  } else if (current === "storeys") {
    body = (
      <StoreyCard
        setup={ruleset.storeys}
        issues={lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys"))}
        lang={lang}
        onChange={(storeys) => {
          const next: Ruleset = { ...ruleset, storeys };
          if (storeys === undefined) delete next.storeys;
          onChange(next);
        }}
      />
    );
  } else {
    const role = current;
    const rule = mappingRule(ruleset, role);
    body = (
      <MappingCard
        key={role}
        role={role}
        rule={rule}
        issues={rule ? lint.filter((i) => i.ruleId === rule.id) : []}
        lang={lang}
        picker={picker}
        onToggle={() => toggle(role)}
        onCheck={(check) => setCheck(role, check)}
        onAskEnable={() => setAsking(role)}
      />
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-4">
      {/* ONE bounded container for the header, the rail and the step, so
          their edges align at every width. */}
      <div className="mx-auto flex w-full max-w-[1136px] flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="m-0 mr-auto text-base font-medium text-ink">{t("action.setup", lang)}</h1>
          <Field label={t("label.ruleset", lang)}>
            <input
              type="text"
              className={INPUT + " w-64"}
              aria-invalid={nameIssue && (nameTouched || attempted)}
              value={ruleset.name}
              onBlur={() => setNameTouched(true)}
              onChange={(e) => onChange({ ...ruleset, name: e.target.value })}
            />
          </Field>
          <button
            type="button"
            aria-disabled={blocked}
            onClick={() => {
              setAttempted(true);
              if (!blocked) downloadRuleset(ruleset, fileName);
            }}
            className={downloadClass(blocked)}
          >
            <span>{t("action.download", lang)}</span>
            <span className="font-mono text-[11px]">{fileName}</span>
          </button>
          <button
            type="button"
            aria-disabled={blocked}
            onClick={() => {
              setAttempted(true);
              if (blocked) return;
              setExportError(null);
              downloadXlsx(ruleset, xlsxName(fileName)).catch((error: unknown) =>
                setExportError(error instanceof Error ? error.message : String(error)),
              );
            }}
            className={downloadClass(blocked)}
          >
            <span>{t("action.download", lang)}</span>
            <span className="font-mono text-[11px]">{xlsxName(fileName)}</span>
          </button>
          <button
            type="button"
            aria-disabled={blocked || !hasIds}
            onClick={() => {
              setAttempted(true);
              if (blocked || !hasIds) return;
              setExportError(null);
              downloadIds(ruleset, idsName(fileName)).catch((error: unknown) =>
                setExportError(error instanceof Error ? error.message : String(error)),
              );
            }}
            className={downloadClass(blocked || !hasIds)}
          >
            <span>{t("action.download", lang)}</span>
            <span className="font-mono text-[11px]">{idsName(fileName)}</span>
          </button>
        </div>

        {exportError !== null ? (
          <pre className="m-0 bg-bad px-3 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
            {exportError}
          </pre>
        ) : null}

        <div className="flex flex-1 flex-col gap-6 md:flex-row md:items-start md:gap-8">
          <StepRail current={current} done={done} lang={lang} onStep={onStep} />
          <section aria-label={stepLabel(current, lang)} className="flex min-w-0 flex-1 flex-col">
            {body}
          </section>
        </div>

        {/* The way through and the way back, pinned to the bottom of the page
            so it is in reach on every step. */}
        <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-ground px-4 py-3">
          <button
            type="button"
            disabled={at === 0}
            onClick={() => onStep(STEPS[at - 1])}
            className={SECONDARY + " disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-line"}
          >
            {t("action.previous", lang)}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" onClick={save} className={last ? PRIMARY : SECONDARY}>
              {t("action.saveSetup", lang)}
            </button>
            {last || current === "start" ? null : (
              <button
                type="button"
                onClick={() => onStep(STEPS[at + 1])}
                className={nextPrimary ? PRIMARY : SECONDARY}
              >
                {t("action.next", lang)}
              </button>
            )}
          </div>
        </div>
      </div>

      {asking ? (
        <EnableDialog
          title={t(`mapping.${asking}`, lang)}
          lang={lang}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const role = asking;
            setAsking(null);
            const rule = mappingRule(ruleset, role);
            // Only ever turns a card ON: it was off when the dialog opened.
            if (rule === null || rule.enabled === false) toggle(role);
          }}
        />
      ) : null}
    </main>
  );
}
