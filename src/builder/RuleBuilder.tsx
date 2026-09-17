/** The rule builder. Mount it wherever; it owns its own surface.
 *
 * The state is one Ruleset object — the same shape as the .ruleset.json on
 * disk, so what the UI edits is exactly what an agent authors by hand. Nothing
 * here can express a rule the format cannot.
 */

import { useMemo, useState } from "react";
import {
  IFC_VERSIONS,
  SAMPLE_RULESET,
  emitIdsXml,
  hasErrors,
  lintRuleset,
  partitionRules,
} from "../ids/index.ts";
import type { ExtendedRule, IdsRule, IfcVersion, Rule, Ruleset } from "../ids/index.ts";
import { ExportPopover } from "./ExportPopover.tsx";
import { RuleEditor } from "./RuleEditor.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { t, type Lang } from "./strings.ts";
import "./builder.css";

const EMPTY: Ruleset = {
  formatVersion: 1,
  name: "Regelsett",
  ifcVersions: ["IFC4"],
  rules: [],
};

function freshId(ruleset: Ruleset, stem: string): string {
  const taken = new Set(ruleset.rules.map((r) => r.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function newIdsRule(ruleset: Ruleset): IdsRule {
  return {
    id: freshId(ruleset, "regel"),
    kind: "ids",
    name: "",
    applicability: { entity: { group: "physicalElement" } },
    requirements: { attribute: [{ name: "Name", cardinality: "required" }] },
  };
}

function newExtendedRule(ruleset: Ruleset): ExtendedRule {
  return {
    id: freshId(ruleset, "regel"),
    kind: "extended",
    name: "",
    select: { entity: { group: "physicalElement" } },
    check: { type: "element-typed" },
  };
}

export function RuleBuilder() {
  const [ruleset, setRuleset] = useState<Ruleset>(SAMPLE_RULESET);
  const [selectedId, setSelectedId] = useState<string | null>(
    SAMPLE_RULESET.rules[0]?.id ?? null,
  );
  const [lang, setLang] = useState<Lang>("nb");
  const [exportOpen, setExportOpen] = useState(false);

  const lint = useMemo(() => lintRuleset(ruleset), [ruleset]);
  const lintBroken = hasErrors(lint);

  const xml = useMemo(() => {
    if (lintBroken) return null;
    const { included } = partitionRules(ruleset);
    return included.length > 0 ? emitIdsXml(ruleset, included) : null;
  }, [ruleset, lintBroken]);

  const selected = ruleset.rules.find((r) => r.id === selectedId) ?? null;

  const replaceRule = (next: Rule) => {
    setRuleset((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === selectedId ? next : r)),
    }));
    setSelectedId(next.id);
  };

  const addRule = (rule: Rule) => {
    setRuleset((prev) => ({ ...prev, rules: [...prev.rules, rule] }));
    setSelectedId(rule.id);
  };

  const removeRule = (id: string) => {
    setRuleset((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateRule = (id: string) => {
    const source = ruleset.rules.find((r) => r.id === id);
    if (!source) return;
    const copy = { ...structuredClone(source), id: freshId(ruleset, `${id}-kopi`) };
    addRule(copy);
  };

  const importFile = (file: File) => {
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as Ruleset;
        setRuleset(parsed);
        setSelectedId(parsed.rules?.[0]?.id ?? null);
      } catch {
        // A file that is not JSON is not a ruleset; the lint panel would have
        // nothing to say about it, so leave the current state untouched.
      }
    });
  };

  const toggleVersion = (version: IfcVersion) => {
    setRuleset((prev) => {
      const has = prev.ifcVersions.includes(version);
      const next = has
        ? prev.ifcVersions.filter((v) => v !== version)
        : [...prev.ifcVersions, version];
      return { ...prev, ifcVersions: next.length > 0 ? next : prev.ifcVersions };
    });
  };

  return (
    <div className="rb">
      <div className="rb-bar">
        <span className="rb-label">{t("ruleset.name", lang)}</span>
        <input
          type="text"
          value={ruleset.name}
          style={{ width: 220 }}
          onChange={(e) => setRuleset((prev) => ({ ...prev, name: e.target.value }))}
        />

        <span className="rb-label">{t("ruleset.ifcVersions", lang)}</span>
        <div className="rb-seg">
          {IFC_VERSIONS.map((version) => (
            <button
              key={version}
              type="button"
              aria-pressed={ruleset.ifcVersions.includes(version)}
              onClick={() => toggleVersion(version)}
            >
              {version}
            </button>
          ))}
        </div>

        <span className="rb-bar-spacer" />

        <div className="rb-seg">
          {(["nb", "en"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="rb-btn"
          onClick={() => {
            setRuleset(SAMPLE_RULESET);
            setSelectedId(SAMPLE_RULESET.rules[0]?.id ?? null);
          }}
        >
          {t("action.loadSample", lang)}
        </button>

        <label className="rb-btn">
          {t("action.import", lang)}
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </label>

        <span className="rb-anchor">
          <button
            type="button"
            className="rb-btn rb-btn-primary"
            onClick={() => setExportOpen((open) => !open)}
          >
            {t("action.export", lang)}
          </button>
          {exportOpen ? (
            <ExportPopover
              ruleset={ruleset}
              hasLintErrors={lintBroken}
              lang={lang}
              onClose={() => setExportOpen(false)}
            />
          ) : null}
        </span>
      </div>

      <div className="rb-main">
        <div className="rb-col rb-col-list">
          <div className="rb-head">
            <span className="rb-label">{t("ruleset.rules", lang)}</span>
            <span className="rb-badge rb-badge-off">{ruleset.rules.length}</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="rb-btn"
              title={t("kind.ids", lang)}
              onClick={() => addRule(newIdsRule(ruleset))}
            >
              + {t("kind.ids", lang)}
            </button>
            <button
              type="button"
              className="rb-btn"
              title={t("kind.extended", lang)}
              onClick={() => addRule(newExtendedRule(ruleset))}
            >
              + {t("kind.extended", lang)}
            </button>
          </div>
          <div className="rb-scroll">
            {ruleset.rules.map((rule) => (
              <button
                type="button"
                key={rule.id}
                className={`rb-item${rule.enabled === false ? " rb-item-off" : ""}`}
                aria-current={rule.id === selectedId}
                onClick={() => setSelectedId(rule.id)}
              >
                <span className="rb-row">
                  <span className={`rb-badge rb-badge-${rule.kind}`}>
                    {t(`kind.${rule.kind}`, lang)}
                  </span>
                  <span>{rule.name}</span>
                </span>
                <code className="rb-item-id">{rule.id}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="rb-col rb-col-editor">
          {selected ? (
            <>
              <div className="rb-head">
                <span className="rb-label">{selected.kind === "ids" ? "IDS" : t("kind.extended", lang)}</span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="rb-btn"
                  onClick={() => duplicateRule(selected.id)}
                >
                  {t("action.duplicate", lang)}
                </button>
                <button
                  type="button"
                  className="rb-btn rb-btn-bad"
                  onClick={() => removeRule(selected.id)}
                >
                  {t("action.delete", lang)}
                </button>
              </div>
              <div className="rb-scroll">
                <RuleEditor
                  rule={selected}
                  onChange={replaceRule}
                  lang={lang}
                  versions={ruleset.ifcVersions}
                />
              </div>
            </>
          ) : (
            <div className="rb-head">
              <span className="rb-label">{t("ruleset.rules", lang)}</span>
            </div>
          )}
        </div>

        <div className="rb-col rb-col-side">
          <SidePanel lint={lint} xml={xml} blocked={lintBroken} lang={lang} />
        </div>
      </div>
    </div>
  );
}

export { EMPTY as EMPTY_RULESET };
