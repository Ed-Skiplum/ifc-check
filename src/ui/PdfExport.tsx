/** The PDF export control in the app bar: the mottakskontroll report, one per
 * loaded model and one for the project, each printed on its own click so the
 * browser opens one print dialog per click («Save as PDF»).
 *
 * The report reads what the board already computed (`src/mottakskontroll/`);
 * the renderer and the bundled report CSS load on first use. */

import { useMemo, useState } from "react";
import type { ModelEntry } from "./useModels";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Ruleset } from "../ids/types.ts";
import { beregn, type ModellInput } from "../mottakskontroll/beregn.ts";

/** The models the report can read: parsed, with contract rows. */
function inputs(models: readonly ModelEntry[]): ModellInput[] {
  return models.flatMap((m) =>
    m.state === "ready" && m.report && !m.report.error && m.board
      ? [{ fileName: m.fileName, rows: m.board.rows, summary: m.report.summary, profile: m.profile }]
      : [],
  );
}

export function PdfExport({ lang, models, ruleset }: { lang: Lang; models: ModelEntry[]; ruleset: Ruleset | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runde = useMemo(
    () => (open ? beregn(inputs(models), ruleset, new Date().toISOString().slice(0, 10)) : null),
    [open, models, ruleset],
  );

  const run = async (label: string | null) => {
    if (!runde) return;
    setBusy(true);
    setError(null);
    try {
      const { modellHtml, prosjektHtml, skrivUt } = await import("../mottakskontroll/browser");
      // The Python file names less the project code, which a ruleset does not carry.
      if (label === null) await skrivUt(prosjektHtml(runde), "Mottakskontroll_Prosjekt");
      else await skrivUt(modellHtml(runde, label), `Mottakskontroll_${label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const item =
    "border border-line bg-input px-2 py-1 text-left font-mono text-[11px] text-ink hover:border-green hover:text-green disabled:opacity-40";

  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
        className={
          "border px-2 py-1 text-[12px] " +
          (open
            ? "border-green bg-green text-cream"
            : "border-line bg-input text-ink hover:border-green hover:text-green")
        }
      >
        {t("action.pdf", lang)}
      </button>

      {open && runde ? (
        <div className="absolute top-full left-0 z-30 mt-1 flex w-72 flex-col gap-1 border border-line bg-panel p-3 text-[12px]">
          {runde.modeller.map((m) => (
            <button key={m.label} type="button" disabled={busy} onClick={() => void run(m.label)} className={item}>
              <span className="break-all">{m.label}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy || runde.modeller.length === 0}
            onClick={() => void run(null)}
            className={item}
          >
            {t("kpi.project", lang)}
          </button>

          {error ? (
            <pre className="m-0 bg-bad px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-cream">{error}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
