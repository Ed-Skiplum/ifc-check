/** The `body-no-mesh` derivation's second-check state, in the band header:
 * where ifcopenshell is (queued, loading, running with its count), how it
 * ended (version, failure, or why it could not run), and one ifcfast issue
 * per signature where ifcopenshell found geometry ifcfast did not, filed
 * through the relay, recorded there for later filing («Logget», or the issue
 * number once it has one), or, failing that, the prefilled link
 * (`ifcos-verify.ts`).
 * The per-element verdicts are drawn on the rows (`ifcosVerdictText`).
 */

import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { retryNomesh, useIfcosRun, useRelayEntry, type IssueLink } from "./ifcos-verify";
import type { IssueFacts } from "../engine/body-mesh";
import type { ModelEntry } from "./useModels";

const CHIP = "flex items-center gap-1.5 px-2 py-0.5 text-[12px]";
const LINK = `${CHIP} border border-line bg-input text-ink hover:border-green hover:text-green`;

function Issue({ lang, facts, link }: { lang: Lang; facts: IssueFacts; link: IssueLink }) {
  const recorded = useRelayEntry(facts.signature);
  if (link.state === "logged") {
    // Recorded by the relay: the issue number once it has one, «Logget» until then.
    const number = link.number ?? recorded?.issueNumber ?? undefined;
    const url = link.url ?? recorded?.issueUrl ?? undefined;
    if (number !== undefined && url) {
      return (
        <a href={url} target="_blank" rel="noreferrer" className={LINK} title={`logged · ${facts.signature}`}>
          <span className="font-semibold">{`${t("ifcos.issue.open", lang)} #${number}`}</span>
          <span className="font-mono text-[11px]">{facts.signature}</span>
        </a>
      );
    }
    return (
      <span className={`${CHIP} border border-line text-ink`} title={recorded ? `${recorded.status} · ${recorded.reports}` : facts.signature}>
        <span className="font-semibold">{t("ifcos.issue.logged", lang)}</span>
        <span className="font-mono text-[11px]">{facts.signature}</span>
      </span>
    );
  }
  if (link.state === "posting" || link.state === "searching") {
    return (
      <span className={`${CHIP} text-muted`} title={link.state === "searching" ? link.relayError : facts.signature}>
        {t(link.state === "posting" ? "ifcos.issue.posting" : "ifcos.issue.searching", lang)}
      </span>
    );
  }
  const numbered = link.state === "filed" || link.state === "found";
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className={LINK}
      title={link.state === "filed" ? `${link.action} · ${facts.signature}` : link.relayError}
    >
      <span className="font-semibold">
        {numbered ? `${t("ifcos.issue.open", lang)} #${link.number}` : t("ifcos.issue.new", lang)}
      </span>
      <span className="font-mono text-[11px]">{facts.signature}</span>
      {link.state !== "filed" ? (
        <span className="bg-gold px-1 text-[10px] text-ink">{t("ifcos.issue.relayFailed", lang)}</span>
      ) : null}
      {link.state === "unchecked" ? (
        <span className="bg-gold px-1 text-[10px] text-ink" title={link.message}>
          {t("ifcos.issue.searchFailed", lang)}
        </span>
      ) : null}
    </a>
  );
}

export function IfcosControl({ lang, model }: { lang: Lang; model: ModelEntry }) {
  const run = useIfcosRun(model.id);
  if (!run) return null;

  if (run.status === "queued" || run.status === "running") {
    const loading = run.status === "queued" || run.stage === "pyodide" || run.stage === "wheel";
    return (
      <span className={`${CHIP} bg-gold text-ink`}>
        <span className="font-mono font-bold">…</span>
        {t(loading ? "ifcos.loading" : "ifcos.running", lang)}
        {run.progress && run.stage === "shapes" ? (
          <span className="font-mono tabular-nums">
            {formatCount(run.progress.done, lang)} / {formatCount(run.progress.total, lang)}
          </span>
        ) : null}
      </span>
    );
  }

  if (run.status === "unavailable") {
    return (
      <span className={`${CHIP} bg-gold text-ink`} title={run.why}>
        <span className="font-mono font-bold">!</span>
        {run.why === "no-file" ? t("ifcos.noFile", lang) : `${t("nomesh.unverified", lang)} (${run.why})`}
      </span>
    );
  }

  if (run.status === "failed") {
    return (
      <>
        <span className={`${CHIP} bg-bad text-cream`} title={run.error}>
          <span className="font-mono font-bold">✗</span>
          {t("ifcos.failed", lang)}
          {run.error ? (
            <span className="font-mono text-[11px]">
              {run.stage ? `${run.stage}: ` : ""}
              {run.error}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => retryNomesh(model.id)}
          className="border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
        >
          {t("ifcos.verify", lang)}
        </button>
      </>
    );
  }

  return (
    <>
      {run.version ? <span className="font-mono text-[12px] text-muted">ifcopenshell {run.version}</span> : null}
      {run.issues?.map(({ facts, link }) => <Issue key={facts.signature} lang={lang} facts={facts} link={link} />)}
    </>
  );
}
