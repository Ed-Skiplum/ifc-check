/** The `body-no-mesh` derivation's ifcopenshell control, in the band header:
 * the run button, the run's state, and one ifcfast issue link per signature
 * where ifcopenshell found geometry ifcfast did not (`ifcos-verify.ts`).
 * The per-element verdicts are drawn on the rows (`ifcosVerdictText`).
 */

import type { Lang } from "./i18n";
import { t } from "./i18n";
import { startIfcosRun, useIfcosRun } from "./ifcos-verify";
import type { ModelEntry } from "./useModels";

const CHIP = "flex items-center gap-1.5 px-2 py-0.5 text-[12px]";
const LINK = `${CHIP} border border-line bg-input text-ink hover:border-green hover:text-green`;

export function IfcosControl({ lang, model }: { lang: Lang; model: ModelEntry }) {
  const run = useIfcosRun(model.id);
  const findings = model.report?.checks.find((c) => c.id === "body-no-mesh")?.findings ?? [];
  if (findings.length === 0) return null;

  const start = () => startIfcosRun(model.id, model.file, findings);

  if (run?.status === "running") {
    const loading = run.stage === "pyodide" || run.stage === "wheel";
    return (
      <span className={`${CHIP} bg-gold text-ink`}>
        <span className="font-mono font-bold">…</span>
        {t(loading ? "ifcos.loading" : "ifcos.running", lang)}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
      >
        {t("ifcos.verify", lang)}
      </button>

      {run?.status === "failed" ? (
        <span className={`${CHIP} bg-bad text-cream`} title={run.error}>
          <span className="font-mono font-bold">✗</span>
          {run.noFile ? t("ifcos.noFile", lang) : t("ifcos.failed", lang)}
          {run.error ? <span className="font-mono text-[11px]">{run.stage ? `${run.stage}: ` : ""}{run.error}</span> : null}
        </span>
      ) : null}

      {run?.status === "done" ? (
        <>
          <span className="font-mono text-[12px] text-muted">ifcopenshell {run.version}</span>
          {run.issues?.map(({ facts, link }) =>
            link.state === "searching" ? (
              <span key={facts.signature} className={`${CHIP} text-muted`}>
                {t("ifcos.issue.searching", lang)}
              </span>
            ) : (
              <a
                key={facts.signature}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className={LINK}
                title={link.state === "unchecked" ? link.message : facts.signature}
              >
                <span className="font-semibold">
                  {link.state === "found" ? `${t("ifcos.issue.open", lang)} #${link.number}` : t("ifcos.issue.new", lang)}
                </span>
                <span className="font-mono text-[11px]">{facts.signature}</span>
                {link.state === "unchecked" ? (
                  <span className="bg-gold px-1 text-[10px] text-ink">{t("ifcos.issue.searchFailed", lang)}</span>
                ) : null}
              </a>
            ),
          )}
        </>
      ) : null}
    </>
  );
}
