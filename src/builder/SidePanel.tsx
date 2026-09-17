/** Lint findings, the emitted IDS document, and its schema validation state.
 *
 * The lint messages come from the engine in English; they are defect reports,
 * not interface copy, and they are not translated.
 */

import { useEffect, useState } from "react";
import type { LintIssue } from "../ids/index.ts";
import { t, type Lang } from "./strings.ts";
import { validateIdsXml, type ValidationResult } from "./validator.ts";

type State =
  | { status: "none" }
  | { status: "running" }
  | { status: "done"; result: ValidationResult };

export function SidePanel({
  lint,
  xml,
  blocked,
  lang,
}: {
  lint: LintIssue[];
  xml: string | null;
  /** True when lint errors stopped the document from being emitted at all. */
  blocked: boolean;
  lang: Lang;
}) {
  const [state, setState] = useState<State>({ status: "none" });

  useEffect(() => {
    if (xml === null) {
      setState({ status: "none" });
      return;
    }
    let cancelled = false;
    setState({ status: "running" });
    const timer = setTimeout(() => {
      validateIdsXml(xml)
        .then((result) => {
          if (!cancelled) setState({ status: "done", result });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState({
            status: "done",
            result: {
              valid: false,
              errors: [{ message: String(error), line: null }],
              rawOutput: "",
            },
          });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [xml]);

  const errors = lint.filter((i) => i.severity === "error");
  const warnings = lint.filter((i) => i.severity === "warning");

  return (
    <>
      <div className="rb-head">
        <span className="rb-label">{t("validate.title", lang)}</span>
      </div>
      <div className="rb-pad" style={{ flex: "0 0 auto" }}>
        {state.status === "none" ? (
          <div className={`rb-state ${blocked ? "rb-state-bad" : "rb-state-idle"}`}>
            <span>{blocked ? "✕" : "◦"}</span>
            <span>{t(blocked ? "validate.blocked" : "validate.none", lang)}</span>
          </div>
        ) : state.status === "running" ? (
          <div className="rb-state rb-state-idle">
            <span>◦</span>
            <span>{t("validate.running", lang)}</span>
          </div>
        ) : state.result.valid ? (
          <div className="rb-state rb-state-ok">
            <span>✓</span>
            <span>{t("validate.valid", lang)}</span>
          </div>
        ) : (
          <div className="rb-state rb-state-bad">
            <span>✕</span>
            <span>{t("validate.invalid", lang)}</span>
          </div>
        )}
        {state.status === "done" && !state.result.valid
          ? state.result.errors.map((e, i) => (
              <div className="rb-issue" key={i}>
                <span className="rb-tag rb-tag-error">{e.line ?? "—"}</span>
                <span className="mono">{e.message}</span>
              </div>
            ))
          : null}
      </div>

      <div className="rb-head">
        <span className="rb-label">{t("lint.title", lang)}</span>
        {errors.length > 0 ? (
          <span className="rb-badge rb-badge-off" style={{ background: "var(--bad)" }}>
            {errors.length} {t("lint.errors", lang)}
          </span>
        ) : null}
        {warnings.length > 0 ? (
          <span className="rb-badge rb-badge-extended">
            {warnings.length} {t("lint.warnings", lang)}
          </span>
        ) : null}
      </div>
      <div style={{ flex: "0 0 auto", maxHeight: "28vh", overflow: "auto" }}>
        {lint.length === 0 ? (
          <div className="rb-pad rb-muted">{t("lint.clean", lang)}</div>
        ) : (
          lint.map((issue, i) => (
            <div className="rb-issue" key={i}>
              <span className={`rb-tag rb-tag-${issue.severity}`}>{issue.severity}</span>
              <span>
                <code>{issue.path}</code>
                <br />
                {issue.message}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="rb-head">
        <span className="rb-label">{t("preview.title", lang)}</span>
      </div>
      <div className="rb-scroll">
        <pre className="rb-xml">{xml ?? ""}</pre>
      </div>
    </>
  );
}
