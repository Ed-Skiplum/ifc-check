/** The Krav row of Oppsett v2 (what a requirement maps TO): its editor,
 *  always open; a requirement without one shows a line of data instead, the
 *  value rule and up to three example values. A conflict from an IDS drop shows both rules here with
 *  the two ways to keep one.
 *
 * The editors are the walk's own where one exists: the mapping cards'
 * requirement (`MappingRequirement`), the TFM builder, the type name scheme.
 * New here: the custom property (set, name, value kind) and the accepted IFC
 * schemas. */

import { useState, type ReactNode } from "react";
import { CODE_LISTS } from "../../codelists/index.ts";
import { matchingPreset } from "../../codelists/mmi-presets.ts";
import { NOT_A_MATERIAL_EXAMPLES, phaseAccepted } from "../../engine/standard-sources.ts";
import { POFIN_SOURCES } from "../../engine/pofin-standard.ts";
import { exampleText } from "../../engine/tfm.ts";
import { roleRule } from "../../ids/models.ts";
import type {
  CodeLookupCheck,
  CopyObjectCheck,
  ExtendedRule,
  IdsRule,
  IdsValue,
  LintIssue,
  NamePart,
  PropertyFacet,
  Rule,
  Ruleset,
  Selector,
  StoreyPlane,
  TfmPart,
  TfmToken,
} from "../../ids/types.ts";
import { t, type Lang } from "../i18n";
import type { PsetValue } from "../pset-choices";
import { IssueLines, MappingRequirement, PropertyPicker, patternParts, presetName, type Picker } from "../SetupPage";
import { LIST_EXAMPLES, rankPartBindings } from "../setup/candidates";
import { PILL } from "../setup/ChipRow";
import { TfmBuilder, type ChipBinding } from "../setup/TfmBuilder";
import { TypeNameScheme, partLabel } from "../setup/TypeNameStep";
import { INPUT, ValuesInput } from "../setup/ValuesInput";
import { idsSubjects, idsValueText, type ReqItem } from "./items";
import { canon, facetValueRule, keyOf, literalFacets, ruleReading, ruleValueRule, type Conflict, type ValueRule } from "./merge";

/** A requirement's Krav as data: the pill naming the value rule, and up to
 *  three of its values. */
export interface KravData {
  pill: string;
  chips: readonly string[];
  /** What an IDS rule applies to, when it is not the physical elements. */
  scope?: string;
}

/** An IDS selection as data: its group, or its classes (two, then +n). */
export function scopeText(selector: Selector | undefined): string | undefined {
  const entity = selector?.entity;
  if (!entity) return undefined;
  if (entity.group) return entity.group === "physicalElement" ? undefined : entity.group;
  const classes = entity.classes ?? (typeof entity.name === "string" ? [entity.name] : (entity.name?.restriction.enumeration ?? null));
  if (classes === null) return entity.name ? idsValueText(entity.name) : undefined;
  return classes.length > 2 ? `${classes.slice(0, 2).join(", ")} +${classes.length - 2}` : classes.join(", ");
}

export function valueRuleData(rule: ValueRule, lang: Lang): KravData {
  switch (rule.kind) {
    case "any":
      return { pill: t("oppsett.anyValue", lang), chips: [] };
    case "list":
      return { pill: CODE_LISTS[rule.list as keyof typeof CODE_LISTS]?.meta.label ?? rule.list, chips: LIST_EXAMPLES[rule.list as keyof typeof LIST_EXAMPLES] ?? [] };
    case "values":
      return { pill: t("field.enumeration", lang), chips: more(rule.values) };
    case "pattern":
      return { pill: t("field.pattern", lang), chips: [rule.pattern] };
    case "tfm":
      return { pill: t("req.tfm", lang), chips: [rule.sequence] };
    case "copy":
      return { pill: t("field.copy", lang), chips: more([...rule.copy, ...rule.own]) };
    case "restriction":
      return { pill: t("field.value", lang), chips: [rule.json] };
    case "prohibited":
      return { pill: t("field.cardinality", lang), chips: ["prohibited"] };
  }
}

function more(values: readonly string[]): string[] {
  return values.length > 3 ? [...values.slice(0, 3), `+${values.length - 3}`] : [...values];
}

/** The Krav line's data for an item. */
export function kravData(item: ReqItem, rule: Rule | null, ruleset: Ruleset, lang: Lang): KravData {
  if (item.kind === "ifc-schema") {
    const accepted = ruleset.projectLayer?.["ifc-schema"]?.accepted;
    return { pill: t(accepted ? "field.accepted" : "setup.standard", lang), chips: accepted ?? ["IFC2X3", "IFC4"] };
  }
  if (item.kind === "phase") return { pill: t("field.accepted", lang), chips: more(phaseAccepted(ruleset)) };
  if (item.kind === "materials") return { pill: "≠", chips: NOT_A_MATERIAL_EXAMPLES.slice(0, 3) };
  if (item.kind === "storeys") {
    const s = ruleset.storeys;
    return { pill: s?.plane || t("field.plane", lang), chips: more((s?.levels ?? []).map((l) => l.name)) };
  }
  if (rule === null) return { pill: "", chips: [] };
  if (rule.kind === "ids") {
    const facets = literalFacets(rule);
    const scope = scopeText(rule.applicability);
    if (item.property && facets[0]) return { ...valueRuleData(facetValueRule(facets[0]), lang), scope };
    const values = (rule.requirements?.property ?? [])
      .map((f) => f.value)
      .concat((rule.requirements?.attribute ?? []).map((f) => f.value))
      .filter((v): v is IdsValue => v !== undefined)
      .map(idsValueText);
    return { pill: t("field.rule", lang), chips: more(values.length > 0 ? values : idsSubjects(rule)), scope };
  }
  const check = rule.check;
  if (check.type === "type-name") return { pill: t("check.type-name-placeholder", lang), chips: check.sequence.map((p) => partLabel(p, lang)) };
  if (check.type === "tfm") return { pill: t("req.tfm", lang), chips: [check.sequence.map(exampleText).join("")] };
  if (check.type === "copy-object") {
    if (check.copy.length === 0 && check.own.length === 0) return { pill: t("tfm.none", lang), chips: [] };
    return check.copy.length > 0
      ? { pill: t("field.copy", lang), chips: more(check.copy) }
      : { pill: t("field.own", lang), chips: more(check.own) };
  }
  if (check.type === "code-lookup") {
    if (check.list !== undefined) return { pill: CODE_LISTS[check.list].meta.label, chips: LIST_EXAMPLES[check.list] };
    const codes = check.codes ?? [];
    if (codes.length === 0) return { pill: t("tfm.shapeOnly", lang), chips: patternParts(check.extract, lang) ?? [check.extract] };
    const preset = matchingPreset(codes);
    return { pill: preset ? presetName(preset) : "MMI", chips: more(codes.map((c) => c.code)) };
  }
  return { pill: "", chips: [] };
}

export const DATUM = "alt-value inline-flex max-w-64 items-center truncate font-mono text-[12px]";
const PILL_DATA = "rounded-[6px] bg-[var(--d-tint-strong)] px-2 py-0.5 font-mono text-[12px] font-semibold whitespace-nowrap text-ink";

export function KravLineData({ data }: { data: KravData }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {data.pill ? <span className={PILL_DATA}>{data.pill}</span> : null}
      {data.chips.map((c, i) => (
        <span key={`${i}\u0000${c}`} className={DATUM} title={c}>
          {c}
        </span>
      ))}
      {data.scope ? <span className="alt-src">{data.scope}</span> : null}
    </span>
  );
}

/** Both rules of one conflict, and the two ways to keep one. */
export function ConflictBlock({
  conflict,
  current,
  lang,
  onKeep,
}: {
  conflict: Conflict;
  current: Rule;
  lang: Lang;
  onKeep: (keep: "ids" | "current") => void;
}) {
  const facet = literalFacets(conflict.incoming)[0];
  const key = facet ? keyOf(facet.propertySet, facet.baseName) : "";
  const theirs: KravData = {
    ...(facet ? valueRuleData(facetValueRule(facet), lang) : { pill: "", chips: [] }),
    scope: conflict.scope ? scopeText(conflict.incoming.applicability) : undefined,
  };
  const ours: KravData = {
    ...valueRuleData(ruleValueRule(current, key), lang),
    scope: conflict.scope ? (scopeText(current.kind === "ids" ? current.applicability : current.select) ?? "physicalElement") : undefined,
  };
  return (
    <div data-conflict className="flex flex-col gap-2 rounded-[10px] p-3 ring-2 ring-bad">
      <div className="grid items-center gap-x-3 gap-y-2 [grid-template-columns:auto_minmax(0,1fr)]">
        <span className="alt-label">{t("oppsett.current", lang)}</span>
        <KravLineData data={ours} />
        <span className="alt-label">{t("filter.kind.ids", lang)}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <KravLineData data={theirs} />
          <span className="truncate font-mono text-[11px] text-muted">{conflict.incoming.name}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-keep="ids" onClick={() => onKeep("ids")} className={BUTTON}>
          {t("oppsett.keepIds", lang)}
        </button>
        <button type="button" data-keep="current" onClick={() => onKeep("current")} className={BUTTON}>
          {t("oppsett.keepCurrent", lang)}
        </button>
      </div>
    </div>
  );
}

export const BUTTON =
  "inline-flex min-h-9 items-center gap-2 rounded-[6px] border border-line bg-input px-3 text-[13px] text-ink hover:border-green disabled:cursor-not-allowed disabled:text-muted";

/* ------------------------------------------------------------- editors */

const replaceRule = (ruleset: Ruleset, rule: Rule): Ruleset => ({
  ...ruleset,
  rules: ruleset.rules.map((r) => (r.id === rule.id ? rule : r)),
});

/** The editor of one item's Krav, or null when it has none here. */
export function KravEditor({
  item,
  rule,
  ruleset,
  issues,
  picker,
  typeNames,
  lang,
  onChange,
  onJump,
}: {
  item: ReqItem;
  rule: Rule | null;
  ruleset: Ruleset;
  issues: LintIssue[];
  picker: Picker;
  typeNames: readonly PsetValue[];
  lang: Lang;
  onChange: (next: Ruleset) => void;
  onJump: (ruleId: string) => void;
}): ReactNode {
  if (item.kind === "ifc-schema") return <SchemaKrav ruleset={ruleset} lang={lang} onChange={onChange} />;
  if (item.kind === "storeys") return <PlaneKrav ruleset={ruleset} onChange={onChange} />;
  if (rule === null) return null;
  if (rule.kind === "ids") {
    if (!item.property) return null;
    return <PropertyKrav rule={rule} ruleset={ruleset} issues={issues} lang={lang} onChange={onChange} onJump={onJump} />;
  }
  const check = rule.check;
  if (check.type === "type-name") {
    return (
      <TypeNameScheme
        key={rule.id}
        sequence={[...check.sequence]}
        values={typeNames}
        lang={lang}
        onSequence={(sequence: NamePart[]) => onChange(replaceRule(ruleset, { ...rule, check: { ...check, sequence } }))}
      />
    );
  }
  if (check.type === "tfm") return <TfmKrav rule={rule} check={check} ruleset={ruleset} picker={picker} lang={lang} onChange={onChange} />;
  if ((check.type === "code-lookup" || check.type === "copy-object") && item.role && item.role !== "tfm" && item.role !== "type-name") {
    return (
      <MappingRequirement
        role={item.role}
        check={check as CodeLookupCheck | CopyObjectCheck}
        issues={issues}
        lang={lang}
        onCheck={(next) => onChange(replaceRule(ruleset, { ...rule, check: next }))}
      />
    );
  }
  return null;
}

/** IFC-skjema: the accepted schema families, replacing the standard's. */
function SchemaKrav({ ruleset, lang, onChange }: { ruleset: Ruleset; lang: Lang; onChange: (next: Ruleset) => void }) {
  const layer = ruleset.projectLayer?.["ifc-schema"];
  const accepted = layer?.accepted ?? ["IFC2X3", "IFC4"];
  const toggle = (family: string) => {
    const next = accepted.includes(family) ? accepted.filter((f) => f !== family) : [...accepted, family];
    const recommended = layer?.recommended?.filter((f) => next.includes(f));
    onChange({
      ...ruleset,
      projectLayer: {
        ...ruleset.projectLayer,
        "ifc-schema": { ...layer, accepted: next, ...(recommended ? { recommended } : {}) },
      },
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="alt-label">{t("field.accepted", lang)}</span>
      {["IFC2X3", "IFC4", "IFC4X3"].map((family) => (
        <button key={family} type="button" aria-pressed={accepted.includes(family)} onClick={() => toggle(family)} className={PILL}>
          {family}
        </button>
      ))}
    </div>
  );
}

/** Etasjeoppsett: the plane the levels are measured to. */
function PlaneKrav({ ruleset, onChange }: { ruleset: Ruleset; onChange: (next: Ruleset) => void }) {
  const setup = ruleset.storeys;
  if (!setup) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {(["OKFG", "OKBD"] as StoreyPlane[]).map((plane) => (
        <button
          key={plane}
          type="button"
          aria-pressed={setup.plane === plane}
          onClick={() => onChange({ ...ruleset, storeys: { ...setup, plane } })}
          className={PILL + " min-w-20"}
        >
          {plane}
        </button>
      ))}
    </div>
  );
}

type ValueKind = "any" | "values" | "pattern";

function valueKind(facet: PropertyFacet): ValueKind {
  const v = facet.value;
  if (v === undefined) return "any";
  if (typeof v === "string") return "values";
  if (v.restriction.pattern !== undefined) return "pattern";
  return "values";
}

/** A custom property: its name, the property set and property it requires
 *  (a requirement can stand for something the model does not carry yet),
 *  and what the value must be. */
function PropertyKrav({
  rule,
  ruleset,
  issues,
  lang,
  onChange,
  onJump,
}: {
  rule: IdsRule;
  ruleset: Ruleset;
  issues: LintIssue[];
  lang: Lang;
  onChange: (next: Ruleset) => void;
  onJump: (ruleId: string) => void;
}) {
  const facet = literalFacets(rule)[0];
  const [draft, setDraft] = useState({ set: facet?.propertySet ?? "", name: facet?.baseName ?? "" });
  const [seen, setSeen] = useState(canon(facet));
  // A source changed from outside (a pick in I modellen) replaces the draft.
  if (seen !== canon(facet)) {
    setSeen(canon(facet));
    setDraft({ set: facet?.propertySet ?? "", name: facet?.baseName ?? "" });
  }
  if (!facet) return null;
  const taken = draft.set !== "" || draft.name !== "" ? ruleReading(ruleset, keyOf(draft.set, draft.name), rule.id) : null;
  const setFacet = (patch: Partial<PropertyFacet>, name?: string) => {
    const next: IdsRule = {
      ...rule,
      ...(name !== undefined ? { name } : {}),
      requirements: {
        ...rule.requirements,
        property: (rule.requirements?.property ?? []).map((f) => (f === facet ? clean({ ...f, ...patch }) : f)),
      },
    };
    onChange(replaceRule(ruleset, next));
  };
  const typeSource = (set: string, name: string) => {
    setDraft({ set, name });
    if (ruleReading(ruleset, keyOf(set, name), rule.id) !== null) return;
    // The name follows the property until it is named otherwise.
    const follows = rule.name === facet.baseName || rule.name === t("field.source.property", lang) || rule.name === "";
    setFacet({ propertySet: set, baseName: name }, follows && name !== "" ? name : undefined);
  };
  const kind = valueKind(facet);
  const restriction = typeof facet.value === "object" ? facet.value.restriction : null;
  const values = typeof facet.value === "string" ? [facet.value] : (restriction?.enumeration ?? []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Labelled label={t("field.name", lang)}>
          <input type="text" className={INPUT + " w-56"} value={rule.name} onChange={(e) => onChange(replaceRule(ruleset, { ...rule, name: e.target.value }))} />
        </Labelled>
        <Labelled label={t("field.propertySet", lang)}>
          <input type="text" className={INPUT + " w-56"} aria-invalid={taken !== null} value={draft.set} onChange={(e) => typeSource(e.target.value, draft.name)} />
        </Labelled>
        <Labelled label={t("field.propertyName", lang)}>
          <input type="text" className={INPUT + " w-56"} aria-invalid={taken !== null} value={draft.name} onChange={(e) => typeSource(draft.set, e.target.value)} />
        </Labelled>
        {taken ? <UsedBy name={taken.name} lang={lang} onClick={() => onJump(taken.id)} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["any", "values", "pattern"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              if (k === kind) return;
              if (k === "any") setFacet({ value: undefined });
              else if (k === "values") setFacet({ value: { restriction: { base: "string", enumeration: [] } } });
              else setFacet({ value: { restriction: { base: "string", pattern: "" } } });
            }}
            className={PILL}
          >
            {t(k === "any" ? "oppsett.anyValue" : k === "values" ? "field.enumeration" : "field.pattern", lang)}
          </button>
        ))}
        {kind === "values" ? (
          <ValuesInput
            values={values}
            invalid={values.length === 0}
            label={t("field.enumeration", lang)}
            onChange={(next) => setFacet({ value: { restriction: { base: "string", enumeration: next } } })}
          />
        ) : null}
        {kind === "pattern" ? (
          <input
            type="text"
            aria-label={t("field.pattern", lang)}
            className={INPUT + " min-w-64"}
            aria-invalid={(restriction?.pattern ?? "") === ""}
            value={restriction?.pattern ?? ""}
            onChange={(e) => setFacet({ value: { restriction: { base: "string", pattern: e.target.value } } })}
          />
        ) : null}
      </div>
      <IssueLines issues={issues} lang={lang} />
    </div>
  );
}

/** A facet with no `value` key when it has none (the schema refuses an
 *  explicit undefined in some writers). */
function clean(facet: PropertyFacet): PropertyFacet {
  const next = { ...facet };
  if (next.value === undefined) delete next.value;
  return next;
}

export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="alt-label">{label}</span>
      {children}
    </label>
  );
}

/** «Brukt av <navn>»: the property is another requirement's source; a click
 *  goes there. */
export function UsedBy({ name, lang, onClick }: { name: string; lang: Lang; onClick: () => void }) {
  return (
    <button type="button" data-used-by onClick={onClick} className="min-h-9 truncate text-left text-[12px] text-bad underline-offset-2 hover:underline">
      {t("oppsett.usedBy", lang)} {name}
    </button>
  );
}

/** TFM: the sequence builder, with Lokasjon's binding, as the walk's step
 *  drew it, writing to the rule on every change. */
function TfmKrav({
  rule,
  check,
  ruleset,
  picker,
  lang,
  onChange,
}: {
  rule: ExtendedRule;
  check: Extract<ExtendedRule["check"], { type: "tfm" }>;
  ruleset: Ruleset;
  picker: Picker;
  lang: Lang;
  onChange: (next: Ruleset) => void;
}) {
  const write = (patch: { sequence?: TfmToken[]; lokasjon?: { propertySet: string; name: string } | null }) => {
    const next = { ...check };
    if (patch.sequence) next.sequence = patch.sequence;
    if (patch.lokasjon !== undefined) {
      if (patch.lokasjon === null) delete next.bindings;
      else next.bindings = { Lokasjon: { property: patch.lokasjon } };
    }
    onChange(replaceRule(ruleset, { ...rule, check: next }));
  };
  const property = "property" in check.source ? check.source.property : null;
  const prop = property ? picker.choices?.find((c) => c.set === property.propertySet)?.props.find((p) => p.name === property.name) : undefined;
  const lok = check.bindings?.Lokasjon && "property" in check.bindings.Lokasjon ? check.bindings.Lokasjon.property : null;
  const lokStd = POFIN_SOURCES["lokasjon-system"].source as { property: { propertySet: string; name: string } };
  const lokStdN = picker.choices?.find((c) => c.set === lokStd.property.propertySet)?.props.find((p) => p.name === lokStd.property.name)?.valued ?? 0;
  const boundTo = (r: ExtendedRule | null, label: string): ChipBinding => {
    if (!r || r.check.type !== "code-lookup") return { kind: "shape" };
    const source = r.check.source;
    return {
      kind: "bound",
      label: "property" in source ? source.property.name : label,
      title: "property" in source ? `${label} · ${source.property.propertySet}.${source.property.name}` : label,
    };
  };
  const binding = (part: TfmPart): ChipBinding | undefined => {
    switch (part) {
      case "Systemkode":
        return boundTo(roleRule(ruleset, "system-classification"), t("mapping.system-classification", lang));
      case "Komponent":
        return boundTo(roleRule(ruleset, "component-classification"), t("req.funksjonskode", lang));
      case "Etasje":
        return (ruleset.storeys?.levels.length ?? 0) > 0
          ? { kind: "bound", label: t("setup.storeys", lang), title: t("setup.storeys", lang) }
          : { kind: "shape" };
      case "Lokasjon":
        return lok ? { kind: "bound", label: lok.name, title: `${lok.propertySet}.${lok.name}` } : { kind: "shape" };
      case "Rom":
        return { kind: "shape" };
      default:
        return undefined;
    }
  };
  return (
    <TfmBuilder
      sequence={check.sequence}
      values={prop?.values ?? []}
      binding={binding}
      lokasjonChoices={[
        { set: lokStd.property.propertySet, name: lokStd.property.name, n: lokStdN, standard: true },
        ...(picker.choices && prop ? rankPartBindings(picker.choices, check.sequence, prop.values, "Lokasjon") : []).filter(
          (b) => !(b.set === lokStd.property.propertySet && b.name === lokStd.property.name),
        ),
      ]}
      lokasjon={lok ? { set: lok.propertySet, name: lok.name } : null}
      lokasjonEditor={
        <PropertyPicker
          value={lok ?? { propertySet: "", name: "" }}
          choices={picker.choices}
          reading={picker.reading}
          errors={picker.errors}
          total={picker.total}
          invalidSet={false}
          invalidName={false}
          lang={lang}
          onChange={(p) => write({ lokasjon: p.propertySet === "" && p.name === "" ? null : p })}
          onNext={() => {}}
        />
      }
      lang={lang}
      onSequence={(sequence) => write({ sequence })}
      onLokasjon={(b) => write({ lokasjon: b ? { propertySet: b.set, name: b.name } : null })}
    />
  );
}
