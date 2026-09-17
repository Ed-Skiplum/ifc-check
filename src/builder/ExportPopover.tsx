/** The export surface. An anchored popover, not a modal.
 *
 * The one place in this tool where prose is required: which rules went into the
 * .ids and which did not, each with the reason. Dropping an authored rule
 * without saying so is the failure this whole split exists to avoid.
 */

import { exportRuleset, type ExcludedRule, type Ruleset } from "../ids/index.ts";
import { t, type Lang, type StringKey } from "./strings.ts";

const EXCLUDE_KEYS: Record<string, StringKey> = {
  disabled: "exclude.disabled",
  "not-expressible:element-typed": "exclude.element-typed",
  "not-expressible:unique-attribute": "exclude.unique-attribute",
  "not-expressible:type-usage-count": "exclude.type-usage-count",
  "not-expressible:model-metadata": "exclude.model-metadata",
};

function reasonKey(excluded: ExcludedRule): StringKey {
  return EXCLUDE_KEYS[excluded.code] ?? "exclude.unknown";
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportPopover({
  ruleset,
  hasLintErrors,
  lang,
  onClose,
}: {
  ruleset: Ruleset;
  hasLintErrors: boolean;
  lang: Lang;
  onClose: () => void;
}) {
  if (hasLintErrors) {
    return (
      <div className="rb-popover">
        <div className="rb-head">
          <span className="rb-label">{t("export.title", lang)}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="rb-btn" onClick={onClose}>
            {t("action.close", lang)}
          </button>
        </div>
        <div className="rb-pad">
          <div className="rb-state rb-state-bad">
            <span>✕</span>
            <span>{t("export.blocked", lang)}</span>
          </div>
        </div>
      </div>
    );
  }

  const result = exportRuleset(ruleset);

  return (
    <div className="rb-popover">
      <div className="rb-head">
        <span className="rb-label">{t("export.title", lang)}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="rb-btn rb-btn-primary"
          disabled={result.ids === null}
          onClick={() =>
            result.ids !== null &&
            download(result.idsFileName, result.ids, "application/xml")
          }
        >
          {result.idsFileName}
        </button>
        <button
          type="button"
          className="rb-btn rb-btn-primary"
          onClick={() =>
            download(result.rulesetFileName, result.rulesetJson, "application/json")
          }
        >
          {result.rulesetFileName}
        </button>
        <button type="button" className="rb-btn" onClick={onClose}>
          {t("action.close", lang)}
        </button>
      </div>

      <div className="rb-scroll rb-pad">
        {result.ids === null ? (
          <div className="rb-state rb-state-bad" style={{ marginBottom: 8 }}>
            <span>✕</span>
            <span>{t("export.noIds", lang)}</span>
          </div>
        ) : null}

        <div className="rb-head" style={{ position: "static" }}>
          <span className="rb-label">{t("export.included", lang)}</span>
          <span className="rb-badge rb-badge-ids">{result.includedRuleIds.length}</span>
        </div>
        {result.includedRuleIds.map((id) => (
          <div className="rb-issue" key={id}>
            <span className="rb-badge rb-badge-ids">{t("kind.ids", lang)}</span>
            <code>{id}</code>
          </div>
        ))}

        <div className="rb-head" style={{ position: "static", marginTop: 8 }}>
          <span className="rb-label">{t("export.excluded", lang)}</span>
          <span className="rb-badge rb-badge-extended">{result.excluded.length}</span>
        </div>
        {result.excluded.map((excluded) => (
          <div className="rb-issue" key={excluded.ruleId}>
            <span
              className={`rb-badge ${excluded.code === "disabled" ? "rb-badge-off" : "rb-badge-extended"}`}
            >
              {excluded.code === "disabled"
                ? t("rule.enabled", lang)
                : t("kind.extended", lang)}
            </span>
            <span>
              <code>{excluded.ruleId}</code> {excluded.name}
              <br />
              <span className="rb-muted">{t(reasonKey(excluded), lang)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
