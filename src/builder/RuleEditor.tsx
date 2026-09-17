/** Editor for one rule. An ids rule gets an applicability and requirements; an
 *  extended rule gets a selection and a check. The kind is not switchable after
 *  creation — the two carry different bodies, and silently reinterpreting one as
 *  the other loses work. */

import { EntityPicker, FacetBags, ValueEditor, type FacetContext } from "./facets.tsx";
import { t, type Lang, type StringKey } from "./strings.ts";
import type {
  ExtendedCheck,
  ExtendedRule,
  IdsRule,
  IfcVersion,
  Requirements,
  Rule,
  Selector,
  UniqueAttributeCheck,
} from "../ids/index.ts";

const CHECK_TYPES: ExtendedCheck["type"][] = [
  "element-typed",
  "unique-attribute",
  "type-usage-count",
  "model-metadata",
];

const UNIQUE_ATTRIBUTES: UniqueAttributeCheck["attribute"][] = [
  "GlobalId",
  "Name",
  "Tag",
  "ObjectType",
  "PredefinedType",
];

const METADATA_FIELDS = [
  "schema",
  "length_unit",
  "unit_scale",
  "unit_resolved",
  "authoring_app",
  "project_name",
  "duplicate_step_ids",
] as const;

function blankCheck(type: ExtendedCheck["type"]): ExtendedCheck {
  switch (type) {
    case "element-typed":
      return { type };
    case "unique-attribute":
      return { type, attribute: "GlobalId" };
    case "type-usage-count":
      return { type, min: 2 };
    case "model-metadata":
      return { type, field: "length_unit", value: "METRE" };
  }
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rb-block">
      <div className="rb-block-head">
        <span className="rb-label">{title}</span>
      </div>
      <div className="rb-block-body">{children}</div>
    </div>
  );
}

function IdsBody({
  rule,
  onChange,
  lang,
  versions,
}: {
  rule: IdsRule;
  onChange: (next: IdsRule) => void;
  lang: Lang;
  versions: IfcVersion[];
}) {
  const app = rule.applicability;
  const appCtx: FacetContext = { lang, versions, inRequirements: false };
  const reqCtx: FacetContext = { lang, versions, inRequirements: true };
  const req: Requirements = rule.requirements ?? {};

  const setApp = (patch: Partial<typeof app>) =>
    onChange({ ...rule, applicability: { ...app, ...patch } });
  const setReq = (next: Requirements) => onChange({ ...rule, requirements: next });

  return (
    <>
      <Block title={t("ids.applicability", lang)}>
        <div className="rb-wrap">
          <label className="rb-row">
            <span className="rb-label">{t("ids.minOccurs", lang)}</span>
            <input
              type="number"
              min={0}
              style={{ width: 70 }}
              value={app.minOccurs ?? ""}
              onChange={(e) =>
                setApp({ minOccurs: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label className="rb-row">
            <span className="rb-label">{t("ids.maxOccurs", lang)}</span>
            <input
              type="text"
              style={{ width: 90 }}
              className="rb-mono"
              value={app.maxOccurs ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                setApp({
                  maxOccurs:
                    raw === ""
                      ? undefined
                      : raw === "unbounded"
                        ? "unbounded"
                        : Number(raw),
                });
              }}
            />
          </label>
        </div>
        {app.entity ? (
          <div className="rb-facet">
            <div className="rb-facet-head">
              <span className="rb-label">{t("facet.entity", lang)}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="rb-btn"
                onClick={() => setApp({ entity: undefined })}
              >
                {t("action.remove", lang)}
              </button>
            </div>
            <EntityPicker
              entity={app.entity}
              onChange={(entity) => setApp({ entity })}
              ctx={appCtx}
            />
          </div>
        ) : (
          <div className="rb-wrap">
            <button
              type="button"
              className="rb-btn"
              onClick={() => setApp({ entity: { group: "physicalElement" } })}
            >
              + {t("facet.entity", lang)}
            </button>
          </div>
        )}
        <FacetBags
          facets={app}
          onChange={(next) => onChange({ ...rule, applicability: { ...app, ...next } })}
          ctx={appCtx}
        />
      </Block>

      <Block title={t("ids.requirements", lang)}>
        {req.entity ? (
          <div className="rb-facet">
            <div className="rb-facet-head">
              <span className="rb-label">{t("facet.entity", lang)}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="rb-btn"
                onClick={() => setReq({ ...req, entity: undefined })}
              >
                {t("action.remove", lang)}
              </button>
            </div>
            <EntityPicker
              entity={req.entity}
              onChange={(entity) => setReq({ ...req, entity })}
              ctx={reqCtx}
            />
          </div>
        ) : (
          <div className="rb-wrap">
            <button
              type="button"
              className="rb-btn"
              onClick={() => setReq({ ...req, entity: { classes: ["IFCWALL"] } })}
            >
              + {t("facet.entity", lang)}
            </button>
          </div>
        )}
        <FacetBags facets={req} onChange={(next) => setReq({ ...req, ...next })} ctx={reqCtx} />
      </Block>
    </>
  );
}

function ExtendedBody({
  rule,
  onChange,
  lang,
  versions,
}: {
  rule: ExtendedRule;
  onChange: (next: ExtendedRule) => void;
  lang: Lang;
  versions: IfcVersion[];
}) {
  const ctx: FacetContext = { lang, versions, inRequirements: false };
  const check = rule.check;
  const select: Selector = rule.select ?? {};
  const modelScoped = check.type === "model-metadata";

  return (
    <>
      <Block title={t("ext.check", lang)}>
        <div className="rb-row">
          <span className="rb-label">{t("rule.kind", lang)}</span>
          <select
            value={check.type}
            onChange={(e) =>
              onChange({ ...rule, check: blankCheck(e.target.value as ExtendedCheck["type"]) })
            }
          >
            {CHECK_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`check.${type}` as StringKey, lang)}
              </option>
            ))}
          </select>
        </div>

        {check.type === "unique-attribute" ? (
          <div className="rb-wrap">
            <label className="rb-row">
              <span className="rb-label">{t("check.attribute", lang)}</span>
              <select
                value={check.attribute}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    check: { ...check, attribute: e.target.value as UniqueAttributeCheck["attribute"] },
                  })
                }
              >
                {UNIQUE_ATTRIBUTES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <div className="rb-row">
              <span className="rb-label">{t("check.scope", lang)}</span>
              <div className="rb-seg">
                {(["model", "class"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={(check.scope ?? "model") === s}
                    onClick={() => onChange({ ...rule, check: { ...check, scope: s } })}
                  >
                    {t(`check.scope.${s}` as StringKey, lang)}
                  </button>
                ))}
              </div>
            </div>
            <label className="rb-row">
              <input
                type="checkbox"
                checked={check.ignoreEmpty !== false}
                onChange={(e) =>
                  onChange({ ...rule, check: { ...check, ignoreEmpty: e.target.checked } })
                }
              />
              <span className="rb-label">{t("check.ignoreEmpty", lang)}</span>
            </label>
          </div>
        ) : null}

        {check.type === "type-usage-count" ? (
          <div className="rb-wrap">
            {(["min", "max"] as const).map((key) => (
              <label className="rb-row" key={key}>
                <span className="rb-label">{t(`check.${key}` as StringKey, lang)}</span>
                <input
                  type="number"
                  min={0}
                  style={{ width: 80 }}
                  value={check[key] ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...rule,
                      check: {
                        ...check,
                        [key]: e.target.value === "" ? undefined : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        ) : null}

        {check.type === "model-metadata" ? (
          <>
            <label className="rb-row">
              <span className="rb-label">{t("check.field", lang)}</span>
              <select
                value={check.field}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    check: { ...check, field: e.target.value as (typeof METADATA_FIELDS)[number] },
                  })
                }
              >
                {METADATA_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <ValueEditor
              value={check.value}
              onChange={(v) => onChange({ ...rule, check: { ...check, value: v ?? "" } })}
              lang={lang}
              allowAny={false}
            />
          </>
        ) : null}
      </Block>

      {modelScoped ? null : (
        <Block title={t("ext.select", lang)}>
          {select.entity ? (
            <div className="rb-facet">
              <div className="rb-facet-head">
                <span className="rb-label">{t("facet.entity", lang)}</span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="rb-btn"
                  onClick={() => onChange({ ...rule, select: { ...select, entity: undefined } })}
                >
                  {t("action.remove", lang)}
                </button>
              </div>
              <EntityPicker
                entity={select.entity}
                onChange={(entity) => onChange({ ...rule, select: { ...select, entity } })}
                ctx={ctx}
              />
            </div>
          ) : (
            <div className="rb-wrap">
              <button
                type="button"
                className="rb-btn"
                onClick={() =>
                  onChange({ ...rule, select: { ...select, entity: { group: "physicalElement" } } })
                }
              >
                + {t("facet.entity", lang)}
              </button>
            </div>
          )}
          <FacetBags
            facets={select}
            onChange={(next) => onChange({ ...rule, select: { ...select, ...next } })}
            ctx={ctx}
          />
        </Block>
      )}
    </>
  );
}

export function RuleEditor({
  rule,
  onChange,
  lang,
  versions,
}: {
  rule: Rule;
  onChange: (next: Rule) => void;
  lang: Lang;
  versions: IfcVersion[];
}) {
  const ruleVersions = rule.kind === "ids" ? (rule.ifcVersions ?? versions) : versions;

  return (
    <div className="rb-pad">
      <div className="rb-block">
        <div className="rb-block-head">
          <span className={`rb-badge rb-badge-${rule.kind}`}>{t(`kind.${rule.kind}`, lang)}</span>
          <code>{rule.id}</code>
          <span style={{ flex: 1 }} />
          <label className="rb-row">
            <input
              type="checkbox"
              checked={rule.enabled !== false}
              onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
            />
            <span className="rb-label">{t("rule.enabled", lang)}</span>
          </label>
        </div>
        <div className="rb-block-body">
          <div className="rb-wrap">
            <label className="rb-field" style={{ flex: "1 1 260px" }}>
              <span className="rb-label">{t("rule.id", lang)}</span>
              <input
                type="text"
                className="rb-mono"
                value={rule.id}
                onChange={(e) => onChange({ ...rule, id: e.target.value })}
              />
            </label>
            <label className="rb-field" style={{ flex: "2 1 420px" }}>
              <span className="rb-label">{t("rule.name", lang)}</span>
              <input
                type="text"
                value={rule.name}
                onChange={(e) => onChange({ ...rule, name: e.target.value })}
              />
            </label>
          </div>
          <label className="rb-field">
            <span className="rb-label">{t("rule.description", lang)}</span>
            <input
              type="text"
              value={rule.description ?? ""}
              onChange={(e) =>
                onChange({ ...rule, description: e.target.value === "" ? undefined : e.target.value })
              }
            />
          </label>
          <label className="rb-field">
            <span className="rb-label">{t("rule.instructions", lang)}</span>
            <input
              type="text"
              value={rule.instructions ?? ""}
              onChange={(e) =>
                onChange({
                  ...rule,
                  instructions: e.target.value === "" ? undefined : e.target.value,
                })
              }
            />
          </label>
        </div>
      </div>

      {rule.kind === "ids" ? (
        <IdsBody
          rule={rule}
          onChange={onChange}
          lang={lang}
          versions={ruleVersions}
        />
      ) : (
        <ExtendedBody rule={rule} onChange={onChange} lang={lang} versions={ruleVersions} />
      )}
    </div>
  );
}
