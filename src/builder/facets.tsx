/** Facet editors: the entity picker, the value editor and one editor per IDS
 *  facet, plus the bag of facet lists shared by applicability, requirements and
 *  an extended rule's selection.
 *
 * Cardinality only appears where the XSD allows it: never on an applicability or
 * selection facet, never on a requirements entity, and without `optional` on
 * partOf. That is enforced here by not rendering the control, and again in the
 * linter for a ruleset that arrives from disk.
 */

import { useMemo, useState } from "react";
import { CLASS_GROUPS, IFC_CLASSES, PART_OF_RELATIONS } from "../ids/index.ts";
import type {
  AttributeFacet,
  Cardinality,
  ClassificationFacet,
  EntityFacet,
  IdsValue,
  IfcVersion,
  MaterialFacet,
  PartOfFacet,
  PropertyFacet,
  Requirements,
  Restriction,
  RestrictionBase,
  Selector,
} from "../ids/index.ts";
import { t, type Lang, type StringKey } from "./strings.ts";

export interface FacetContext {
  lang: Lang;
  versions: IfcVersion[];
  /** Requirements allow cardinality, instructions and uri; applicability does not. */
  inRequirements: boolean;
}

/* ------------------------------------------------------------ value editor */

type ValueMode = "any" | "literal" | "enumeration" | "pattern" | "bounds" | "length";

const BASES: RestrictionBase[] = [
  "string",
  "boolean",
  "integer",
  "double",
  "decimal",
  "date",
  "dateTime",
  "duration",
];

function modeOf(value: IdsValue | undefined): ValueMode {
  if (value === undefined) return "any";
  if (typeof value === "string") return "literal";
  const r = value.restriction;
  if (r.enumeration) return "enumeration";
  if (r.pattern !== undefined) return "pattern";
  if (
    r.length !== undefined ||
    r.minLength !== undefined ||
    r.maxLength !== undefined
  ) {
    return "length";
  }
  return "bounds";
}

function blank(mode: ValueMode, base: RestrictionBase): IdsValue | undefined {
  switch (mode) {
    case "any":
      return undefined;
    case "literal":
      return "";
    case "enumeration":
      return { restriction: { base, enumeration: [""] } };
    case "pattern":
      return { restriction: { base, pattern: "" } };
    case "length":
      return { restriction: { base, minLength: 1 } };
    case "bounds":
      return { restriction: { base: "double", minInclusive: 0 } };
  }
}

function num(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function ValueEditor({
  value,
  onChange,
  lang,
  allowAny,
}: {
  value: IdsValue | undefined;
  onChange: (next: IdsValue | undefined) => void;
  lang: Lang;
  allowAny: boolean;
}) {
  const mode = modeOf(value);
  const restriction = typeof value === "object" ? value.restriction : undefined;
  const base = restriction?.base ?? "string";

  const setRestriction = (patch: Partial<Restriction>) => {
    onChange({ restriction: { ...restriction, ...patch } });
  };

  const modes: ValueMode[] = allowAny
    ? ["any", "literal", "enumeration", "pattern", "bounds", "length"]
    : ["literal", "enumeration", "pattern", "bounds", "length"];

  return (
    <div className="rb-field">
      <div className="rb-row">
        <span className="rb-label">{t("facet.value", lang)}</span>
        <div className="rb-seg">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onChange(blank(m, base))}
            >
              {t(`value.mode.${m}` as StringKey, lang)}
            </button>
          ))}
        </div>
        {mode !== "any" && mode !== "literal" ? (
          <select
            value={base}
            onChange={(e) => setRestriction({ base: e.target.value as RestrictionBase })}
          >
            {BASES.map((b) => (
              <option key={b} value={b}>
                xs:{b}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {mode === "literal" ? (
        <input
          type="text"
          className="rb-mono"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {mode === "enumeration" ? (
        <div className="rb-field">
          {(restriction?.enumeration ?? []).map((item, i) => (
            <div className="rb-row" key={i}>
              <input
                type="text"
                className="rb-mono"
                style={{ flex: 1 }}
                value={item}
                onChange={(e) => {
                  const next = [...(restriction?.enumeration ?? [])];
                  next[i] = e.target.value;
                  setRestriction({ enumeration: next });
                }}
              />
              <button
                type="button"
                className="rb-btn"
                onClick={() =>
                  setRestriction({
                    enumeration: (restriction?.enumeration ?? []).filter((_, j) => j !== i),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="rb-btn"
            onClick={() =>
              setRestriction({ enumeration: [...(restriction?.enumeration ?? []), ""] })
            }
          >
            + {t("action.add", lang)}
          </button>
        </div>
      ) : null}

      {mode === "pattern" ? (
        <input
          type="text"
          className="rb-mono"
          value={restriction?.pattern ?? ""}
          onChange={(e) => setRestriction({ pattern: e.target.value })}
        />
      ) : null}

      {mode === "bounds" ? (
        <div className="rb-wrap">
          {(["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"] as const).map(
            (key) => (
              <label className="rb-row" key={key}>
                <span className="rb-label">{t(`value.${key}` as StringKey, lang)}</span>
                <input
                  type="number"
                  style={{ width: 90 }}
                  value={restriction?.[key] ?? ""}
                  onChange={(e) => setRestriction({ [key]: num(e.target.value) })}
                />
              </label>
            ),
          )}
        </div>
      ) : null}

      {mode === "length" ? (
        <div className="rb-wrap">
          {(["length", "minLength", "maxLength"] as const).map((key) => (
            <label className="rb-row" key={key}>
              <span className="rb-label">{t(`value.${key}` as StringKey, lang)}</span>
              <input
                type="number"
                style={{ width: 90 }}
                value={restriction?.[key] ?? ""}
                onChange={(e) => setRestriction({ [key]: num(e.target.value) })}
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- entity picker */

export function EntityPicker({
  entity,
  onChange,
  ctx,
  showPredefinedType = true,
}: {
  entity: EntityFacet;
  onChange: (next: EntityFacet) => void;
  ctx: FacetContext;
  showPredefinedType?: boolean;
}) {
  const { lang, versions } = ctx;
  const [query, setQuery] = useState("");
  const mode: "group" | "classes" = entity.group !== undefined ? "group" : "classes";

  const all = useMemo(() => {
    const out = new Set<string>();
    for (const version of versions) {
      for (const name of IFC_CLASSES[version].entities) out.add(name);
    }
    return [...out].sort();
  }, [versions]);

  const selected = entity.classes ?? [];
  const options = useMemo(() => {
    const q = query.trim().toUpperCase();
    return all.filter((c) => !selected.includes(c) && (q === "" || c.includes(q))).slice(0, 400);
  }, [all, query, selected]);

  return (
    <div className="rb-field">
      <div className="rb-row">
        <span className="rb-label">{t("facet.entity", lang)}</span>
        <div className="rb-seg">
          <button
            type="button"
            aria-pressed={mode === "group"}
            onClick={() =>
              onChange({ group: "physicalElement", predefinedType: entity.predefinedType })
            }
          >
            {t("entity.mode.group", lang)}
          </button>
          <button
            type="button"
            aria-pressed={mode === "classes"}
            onClick={() =>
              onChange({ classes: selected.length ? selected : ["IFCWALL"], predefinedType: entity.predefinedType })
            }
          >
            {t("entity.mode.classes", lang)}
          </button>
        </div>
        {mode === "group" ? (
          <select
            value={entity.group}
            onChange={(e) =>
              onChange({
                group: e.target.value as EntityFacet["group"],
                predefinedType: entity.predefinedType,
              })
            }
          >
            {CLASS_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`group.${g}` as StringKey, lang)}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {mode === "group" && entity.group ? (
        <span className="mono rb-muted">
          {IFC_CLASSES[versions[0] ?? "IFC4"].groups[
            entity.group as keyof (typeof IFC_CLASSES)["IFC4"]["groups"]
          ]?.length ?? 0}
          {" × IFC"}
        </span>
      ) : null}

      {mode === "classes" ? (
        <>
          <div className="rb-chips">
            {selected.map((c) => (
              <button
                key={c}
                type="button"
                className="rb-chip"
                onClick={() => onChange({ ...entity, classes: selected.filter((x) => x !== c) })}
              >
                {c} ×
              </button>
            ))}
          </div>
          <input
            type="text"
            className="rb-mono"
            placeholder={t("entity.search", lang)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() !== "" ? (
            <div className="rb-options">
              {options.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rb-option"
                  onClick={() => {
                    onChange({ ...entity, classes: [...selected, c] });
                    setQuery("");
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {showPredefinedType ? (
        <div className="rb-field">
          <span className="rb-label">{t("entity.predefinedType", lang)}</span>
          <ValueEditor
            value={entity.predefinedType}
            onChange={(next) => onChange({ ...entity, predefinedType: next })}
            lang={lang}
            allowAny
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- cardinality */

function CardinalityPicker({
  value,
  onChange,
  lang,
  allowOptional,
}: {
  value: Cardinality | undefined;
  onChange: (next: Cardinality) => void;
  lang: Lang;
  allowOptional: boolean;
}) {
  const options: Cardinality[] = allowOptional
    ? ["required", "optional", "prohibited"]
    : ["required", "prohibited"];
  return (
    <div className="rb-row">
      <span className="rb-label">{t("facet.cardinality", lang)}</span>
      <div className="rb-seg">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={(value ?? "required") === c}
            onClick={() => onChange(c)}
          >
            {t(`cardinality.${c}` as StringKey, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Instructions({
  value,
  onChange,
  lang,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  lang: Lang;
}) {
  return (
    <label className="rb-field">
      <span className="rb-label">{t("rule.instructions", lang)}</span>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </label>
  );
}

/* -------------------------------------------------------------- facet bags */

type FacetKey = "partOf" | "classification" | "attribute" | "property" | "material";

const FACET_KEYS: FacetKey[] = [
  "partOf",
  "classification",
  "attribute",
  "property",
  "material",
];

function blankFacet(key: FacetKey): unknown {
  switch (key) {
    case "partOf":
      return { entity: { classes: ["IFCBUILDINGSTOREY"] }, relation: "IFCRELCONTAINEDINSPATIALSTRUCTURE" };
    case "classification":
      return { system: "" };
    case "attribute":
      return { name: "Name" };
    case "property":
      return { propertySet: "", baseName: "" };
    case "material":
      return {};
  }
}

function FacetShell({
  title,
  onRemove,
  lang,
  children,
}: {
  title: string;
  onRemove: () => void;
  lang: Lang;
  children: React.ReactNode;
}) {
  return (
    <div className="rb-facet">
      <div className="rb-facet-head">
        <span className="rb-label">{title}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="rb-btn" onClick={onRemove}>
          {t("action.remove", lang)}
        </button>
      </div>
      {children}
    </div>
  );
}

export function FacetBags({
  facets,
  onChange,
  ctx,
}: {
  facets: Selector | Requirements;
  onChange: (next: Selector | Requirements) => void;
  ctx: FacetContext;
}) {
  const { lang, inRequirements } = ctx;
  const set = <K extends FacetKey>(key: K, list: unknown[]) =>
    onChange({ ...facets, [key]: list.length > 0 ? list : undefined } as Selector);

  const patch = (key: FacetKey, index: number, next: unknown) => {
    const list = [...((facets as Record<string, unknown[]>)[key] ?? [])];
    list[index] = next;
    set(key, list);
  };
  const drop = (key: FacetKey, index: number) => {
    const list = ((facets as Record<string, unknown[]>)[key] ?? []).filter(
      (_, i) => i !== index,
    );
    set(key, list);
  };

  return (
    <>
      {(facets.partOf ?? []).map((facet: PartOfFacet, i) => (
        <FacetShell
          key={`partOf-${i}`}
          title={t("facet.partOf", lang)}
          onRemove={() => drop("partOf", i)}
          lang={lang}
        >
          <label className="rb-row">
            <span className="rb-label">{t("partOf.relation", lang)}</span>
            <select
              value={facet.relation ?? ""}
              onChange={(e) =>
                patch("partOf", i, {
                  ...facet,
                  relation: e.target.value === "" ? undefined : e.target.value,
                })
              }
            >
              <option value="" />
              {PART_OF_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <EntityPicker
            entity={facet.entity}
            onChange={(entity) => patch("partOf", i, { ...facet, entity })}
            ctx={ctx}
            showPredefinedType={false}
          />
          {inRequirements ? (
            <>
              <CardinalityPicker
                value={facet.cardinality}
                onChange={(c) => patch("partOf", i, { ...facet, cardinality: c })}
                lang={lang}
                allowOptional={false}
              />
              <Instructions
                value={facet.instructions}
                onChange={(v) => patch("partOf", i, { ...facet, instructions: v })}
                lang={lang}
              />
            </>
          ) : null}
        </FacetShell>
      ))}

      {(facets.classification ?? []).map((facet: ClassificationFacet, i) => (
        <FacetShell
          key={`classification-${i}`}
          title={t("facet.classification", lang)}
          onRemove={() => drop("classification", i)}
          lang={lang}
        >
          <div className="rb-field">
            <span className="rb-label">{t("classification.system", lang)}</span>
            <ValueEditor
              value={facet.system}
              onChange={(v) => patch("classification", i, { ...facet, system: v ?? "" })}
              lang={lang}
              allowAny={false}
            />
          </div>
          <ValueEditor
            value={facet.value}
            onChange={(v) => patch("classification", i, { ...facet, value: v })}
            lang={lang}
            allowAny
          />
          {inRequirements ? (
            <CardinalityPicker
              value={facet.cardinality}
              onChange={(c) => patch("classification", i, { ...facet, cardinality: c })}
              lang={lang}
              allowOptional
            />
          ) : null}
        </FacetShell>
      ))}

      {(facets.attribute ?? []).map((facet: AttributeFacet, i) => (
        <FacetShell
          key={`attribute-${i}`}
          title={t("facet.attribute", lang)}
          onRemove={() => drop("attribute", i)}
          lang={lang}
        >
          <div className="rb-field">
            <span className="rb-label">{t("rule.name", lang)}</span>
            <ValueEditor
              value={facet.name}
              onChange={(v) => patch("attribute", i, { ...facet, name: v ?? "" })}
              lang={lang}
              allowAny={false}
            />
          </div>
          <ValueEditor
            value={facet.value}
            onChange={(v) => patch("attribute", i, { ...facet, value: v })}
            lang={lang}
            allowAny
          />
          {inRequirements ? (
            <CardinalityPicker
              value={facet.cardinality}
              onChange={(c) => patch("attribute", i, { ...facet, cardinality: c })}
              lang={lang}
              allowOptional
            />
          ) : null}
        </FacetShell>
      ))}

      {(facets.property ?? []).map((facet: PropertyFacet, i) => (
        <FacetShell
          key={`property-${i}`}
          title={t("facet.property", lang)}
          onRemove={() => drop("property", i)}
          lang={lang}
        >
          <div className="rb-field">
            <span className="rb-label">{t("property.propertySet", lang)}</span>
            <ValueEditor
              value={facet.propertySet}
              onChange={(v) => patch("property", i, { ...facet, propertySet: v ?? "" })}
              lang={lang}
              allowAny={false}
            />
          </div>
          <div className="rb-field">
            <span className="rb-label">{t("property.baseName", lang)}</span>
            <ValueEditor
              value={facet.baseName}
              onChange={(v) => patch("property", i, { ...facet, baseName: v ?? "" })}
              lang={lang}
              allowAny={false}
            />
          </div>
          <ValueEditor
            value={facet.value}
            onChange={(v) => patch("property", i, { ...facet, value: v })}
            lang={lang}
            allowAny
          />
          <label className="rb-row">
            <span className="rb-label">{t("property.dataType", lang)}</span>
            <input
              type="text"
              className="rb-mono"
              value={facet.dataType ?? ""}
              onChange={(e) =>
                patch("property", i, {
                  ...facet,
                  dataType:
                    e.target.value === "" ? undefined : e.target.value.toUpperCase(),
                })
              }
            />
          </label>
          {inRequirements ? (
            <CardinalityPicker
              value={facet.cardinality}
              onChange={(c) => patch("property", i, { ...facet, cardinality: c })}
              lang={lang}
              allowOptional
            />
          ) : null}
        </FacetShell>
      ))}

      {(facets.material ?? []).map((facet: MaterialFacet, i) => (
        <FacetShell
          key={`material-${i}`}
          title={t("facet.material", lang)}
          onRemove={() => drop("material", i)}
          lang={lang}
        >
          <ValueEditor
            value={facet.value}
            onChange={(v) => patch("material", i, { ...facet, value: v })}
            lang={lang}
            allowAny
          />
          {inRequirements ? (
            <CardinalityPicker
              value={facet.cardinality}
              onChange={(c) => patch("material", i, { ...facet, cardinality: c })}
              lang={lang}
              allowOptional
            />
          ) : null}
        </FacetShell>
      ))}

      <div className="rb-wrap">
        {FACET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="rb-btn"
            onClick={() =>
              set(key, [
                ...((facets as Record<string, unknown[]>)[key] ?? []),
                blankFacet(key),
              ])
            }
          >
            + {t(`facet.${key}` as StringKey, lang)}
          </button>
        ))}
      </div>
    </>
  );
}
