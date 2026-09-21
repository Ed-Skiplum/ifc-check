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
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { CODE_LISTS, CODE_LIST_IDS } from "../codelists/index.ts";
import { BOOLEAN_VALUES, MAPPING_ROLES, hasErrors, isBooleanValues, lintRuleset } from "../ids/lint.ts";
import type {
  CodeLookupCheck,
  CodeSource,
  ExtendedRule,
  LintIssue,
  MappingRole,
  Ruleset,
  StoreyConfig,
} from "../ids/types.ts";
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { Switch } from "./Switch";

const SOURCE_KINDS = ["attribute", "property", "classification"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];

/** copy-object's two value modes — never a rule field, only how the card
 *  reads and writes the mapping's `values`. See `isBooleanValues`. */
const COPY_MODES = ["boolean", "codes"] as const;
type CopyMode = (typeof COPY_MODES)[number];

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

function blankCheck(role: MappingRole): CodeLookupCheck {
  const base = { type: "code-lookup", source: { attribute: "Name" } } as const;
  switch (role) {
    case "system-classification":
    case "component-classification":
      return { ...base, list: CODE_LIST_IDS[0], target: "occurrence", extract: "^(.+)$" };
    case "progress-code":
      return { ...base, values: [], extract: "^(.+)$" };
    case "copy-object":
      return { ...base, values: [...BOOLEAN_VALUES], extract: "^(.*)$" };
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
  for (const rule of ruleset.rules) {
    if (rule.kind === "extended" && rule.mapping === role) return rule;
  }
  return null;
}

function downloadRuleset(ruleset: Ruleset, fileName: string): void {
  const blob = new Blob([JSON.stringify(ruleset, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const LABEL = "text-[10px] font-semibold tracking-[0.12em] text-gold uppercase";
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

function MappingCard({
  role,
  rule,
  issues,
  lang,
  onToggle,
  onCheck,
  onAskEnable,
}: {
  role: MappingRole;
  rule: ExtendedRule | null;
  issues: LintIssue[];
  lang: Lang;
  onToggle: () => void;
  onCheck: (next: CodeLookupCheck) => void;
  /** Double-click on the card while it is off. */
  onAskEnable: () => void;
}) {
  const active = rule !== null && rule.enabled !== false;
  const check =
    rule && rule.check.type === "code-lookup" ? rule.check : blankCheck(role);
  const source = check.source;
  const kind = sourceKind(source);
  const off = !active;
  const invalid = (suffix: string) => issues.some((i) => i.path.includes(`.check.${suffix}`));
  const classification = role === "system-classification" || role === "component-classification";
  const copyMode: CopyMode = isBooleanValues(check.values) ? "boolean" : "codes";

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
      className="flex flex-col gap-3 border border-line bg-panel p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className={"m-0 text-sm font-medium " + (active ? "text-ink" : "text-muted")}>
          {t(`mapping.${role}`, lang)}
        </h2>
        <Switch on={active} label={t("field.enabled", lang)} onChange={onToggle} />
      </div>

      {classification ? (
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
                  values: undefined,
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
        {"property" in source ? (
          <>
            <Field label={t("field.propertySet", lang)}>
              <input
                type="text"
                className={INPUT}
                disabled={off}
                aria-invalid={invalid("source.property.propertySet")}
                value={source.property.propertySet}
                onChange={(e) =>
                  onCheck({
                    ...check,
                    source: { property: { ...source.property, propertySet: e.target.value } },
                  })
                }
              />
            </Field>
            <Field label={t("field.propertyName", lang)}>
              <input
                type="text"
                className={INPUT}
                disabled={off}
                aria-invalid={invalid("source.property.name")}
                value={source.property.name}
                onChange={(e) =>
                  onCheck({
                    ...check,
                    source: { property: { ...source.property, name: e.target.value } },
                  })
                }
              />
            </Field>
          </>
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
        {kind !== "attribute" ? (
          // The evaluator's own state for these sources, named as the board
          // names it, with the issue that gates it.
          <span className="flex items-baseline gap-2 py-1 text-[12px] text-bad">
            <span>{t("result.not_evaluable", lang)}</span>
            <span className="font-mono">ifcfast#183</span>
          </span>
        ) : null}
      </div>

      {role !== "copy-object" ? (
        <div className="flex flex-wrap gap-3">
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
            <Field label={t("field.values", lang)}>
              <ValuesInput
                values={check.values ?? []}
                disabled={off}
                invalid={invalid("values")}
                onChange={(values) => onCheck({ ...check, values })}
              />
            </Field>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>{t("field.copyMode", lang)}</span>
            <Seg
              options={COPY_MODES}
              value={copyMode}
              disabled={off}
              label={(o) => t(`field.copyMode.${o}` as StringKey, lang)}
              onChange={(mode) =>
                onCheck({ ...check, values: mode === "boolean" ? [...BOOLEAN_VALUES] : [] })
              }
            />
          </div>
          {copyMode === "codes" ? (
            <Field label={t("field.values", lang)}>
              <ValuesInput
                values={check.values ?? []}
                disabled={off}
                invalid={invalid("values")}
                onChange={(values) => onCheck({ ...check, values })}
              />
            </Field>
          ) : null}
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

/** The floor config: ordered floors, name + elevation in metres. Stored as the
 *  ruleset's `storeys`, checked by `storey-config`. No defaults: the list
 *  starts empty, and an empty list is no config. */
function StoreyCard({
  storeys,
  issues,
  lang,
  onChange,
}: {
  storeys: StoreyConfig[];
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: StoreyConfig[]) => void;
}) {
  const invalid = (i: number, field: string) =>
    issues.some((issue) => issue.path === `storeys[${i}].${field}` && issue.severity === "error");
  const set = (i: number, patch: Partial<StoreyConfig>) =>
    onChange(storeys.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // A FIXED, viewport-derived card (DESIGN.md §1): the rows scroll inside
  // it, so adding a floor never moves the cards below.
  return (
    <section className="flex h-[clamp(15rem,40vh,34rem)] flex-col gap-3 border border-line bg-panel p-3">
      <h2 className="m-0 shrink-0 text-sm font-medium text-ink">{t("setup.storeys", lang)}</h2>
      {storeys.length > 0 ? (
        <div className="grid min-h-0 content-start items-center gap-x-2 gap-y-1 overflow-auto [grid-template-columns:minmax(0,1fr)_9rem_auto]">
          <span className={LABEL}>{t("field.storeyName", lang)}</span>
          <span className={LABEL}>{t("field.storeyElevation", lang)}</span>
          <span />
          {storeys.map((storey, i) => (
            <StoreyRow
              key={i}
              storey={storey}
              lang={lang}
              nameInvalid={invalid(i, "name")}
              elevationInvalid={invalid(i, "elevation")}
              onChange={(patch) => set(i, patch)}
              onRemove={() => onChange(storeys.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onChange([...storeys, { name: "", elevation: Number.NaN }])}
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
  storey: StoreyConfig;
  lang: Lang;
  nameInvalid: boolean;
  elevationInvalid: boolean;
  onChange: (patch: Partial<StoreyConfig>) => void;
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

export function SetupPage({
  lang,
  ruleset,
  fileName,
  onChange,
}: {
  lang: Lang;
  ruleset: Ruleset;
  fileName: string;
  onChange: (next: Ruleset) => void;
}) {
  const lint = lintRuleset(ruleset);
  const nameIssue = lint.some((i) => i.ruleId === null && i.path === "name");
  // The name field is marked invalid only once it has been touched or a
  // download was attempted, never on a page nobody has typed on yet.
  const [nameTouched, setNameTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [asking, setAsking] = useState<MappingRole | null>(null);
  const blocked = hasErrors(lint);

  const toggle = (role: MappingRole) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) {
      const created: ExtendedRule = {
        id: freshId(ruleset, role),
        kind: "extended",
        mapping: role,
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

  const setCheck = (role: MappingRole, check: CodeLookupCheck) => {
    const rule = mappingRule(ruleset, role);
    if (rule === null) return;
    onChange({
      ...ruleset,
      rules: ruleset.rules.map((r) => (r === rule ? { ...rule, check } : r)),
    });
  };


  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
      {/* ONE bounded container for the header and the cards, so the title,
          the name field and the download button align with the cards' edges
          at every width. */}
      <div className="mx-auto flex w-full max-w-[1136px] flex-col gap-4">
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
            className={
              "flex items-center gap-2 px-3 py-1.5 text-[12px] text-cream " +
              (blocked ? "cursor-not-allowed bg-muted" : "bg-green hover:bg-ink")
            }
          >
            <span>{t("action.download", lang)}</span>
            <span className="font-mono text-[11px]">{fileName}</span>
          </button>
        </div>

        <StoreyCard
          storeys={ruleset.storeys ?? []}
          issues={lint.filter((i) => i.ruleId === null && i.path.startsWith("storeys"))}
          lang={lang}
          onChange={(storeys) => {
            const next: Ruleset = { ...ruleset, storeys };
            if (storeys.length === 0) delete next.storeys;
            onChange(next);
          }}
        />

        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
          {MAPPING_ROLES.map((role) => {
            const rule = mappingRule(ruleset, role);
            return (
              <MappingCard
                key={role}
                role={role}
                rule={rule}
                issues={rule ? lint.filter((i) => i.ruleId === rule.id) : []}
                lang={lang}
                onToggle={() => toggle(role)}
                onCheck={(check) => setCheck(role, check)}
                onAskEnable={() => setAsking(role)}
              />
            );
          })}
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
