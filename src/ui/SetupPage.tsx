/** The project mappings: where this project's IFC carries the concepts every
 *  project has and each stores differently.
 *
 * A mapping is not a construct of its own. Each card edits the one code-lookup
 * rule carrying that `mapping` role in the ruleset, so what is set here is
 * exactly what the ruleset JSON holds and what the evaluator runs. Turning a
 * card off sets the rule's `enabled` to false and keeps what was entered.
 */

import { useState } from "react";
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
}: {
  role: MappingRole;
  rule: ExtendedRule | null;
  issues: LintIssue[];
  lang: Lang;
  onToggle: () => void;
  onCheck: (next: CodeLookupCheck) => void;
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

  return (
    <section className="flex flex-col gap-3 border border-line bg-panel p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-sm font-medium text-ink">{t(`mapping.${role}`, lang)}</h2>
        <button
          type="button"
          aria-pressed={active}
          onClick={onToggle}
          className={
            "border px-2 py-0.5 text-[12px] " +
            (active
              ? "border-green bg-green text-cream"
              : "border-line bg-input text-muted hover:border-green hover:text-green")
          }
        >
          {t("field.enabled", lang)}
        </button>
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
  return (
    <section className="flex flex-col gap-3 border border-line bg-panel p-3">
      <h2 className="m-0 text-sm font-medium text-ink">{t("setup.storeys", lang)}</h2>
      {storeys.length > 0 ? (
        <div className="grid items-center gap-x-2 gap-y-1 [grid-template-columns:minmax(0,1fr)_9rem_auto]">
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
        className="w-fit border border-line bg-input px-2 py-0.5 text-[12px] text-muted hover:border-green hover:text-green"
      >
        {t("action.addRow", lang)}
      </button>
      {issues.length > 0 ? (
        <pre className="m-0 bg-bad px-2 py-1.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">
          {issues.map((i) => `${i.path}: ${i.message}`).join("\n")}
        </pre>
      ) : null}
    </section>
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
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3">
      <div className="mx-auto flex w-full max-w-[1136px] flex-wrap items-end gap-3">
        <h1 className="m-0 mr-auto text-base font-medium text-ink">{t("action.setup", lang)}</h1>
        <Field label={t("label.ruleset", lang)}>
          <input
            type="text"
            className={INPUT + " w-64"}
            aria-invalid={nameIssue}
            value={ruleset.name}
            onChange={(e) => onChange({ ...ruleset, name: e.target.value })}
          />
        </Field>
        <button
          type="button"
          disabled={hasErrors(lint)}
          onClick={() => downloadRuleset(ruleset, fileName)}
          className="flex items-center gap-2 bg-green px-3 py-1.5 text-[12px] text-cream hover:bg-ink disabled:bg-muted"
        >
          <span>{t("action.download", lang)}</span>
          <span className="font-mono text-[11px]">{fileName}</span>
        </button>
      </div>
      <div className="grid items-start justify-center gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,560px))]">
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
            />
          );
        })}
      </div>
    </main>
  );
}
