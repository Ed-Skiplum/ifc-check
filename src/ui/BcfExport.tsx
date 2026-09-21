/** The BCF export control in the app bar: max GUIDs per issue, author, export.
 *
 * Every loaded model goes into one archive, so a model carrying IfcSpace can
 * split another model's oversize storey groups by space. Nothing is downloaded
 * unless every document validated against the BCF 2.1 XSDs.
 */

import { useState } from "react";
import type { ModelEntry } from "./useModels";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import { DEFAULT_MAX_GUIDS, type BcfExportResult } from "../bcf/export";

const AUTHOR_KEY = "ifc-check.bcf.author";

function readAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeAuthor(value: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, value);
  } catch {
    // Per-viewer convenience only; the export works without it.
  }
}

function fileNameFor(models: ModelEntry[]): string {
  const ready = models.filter((m) => m.state === "ready");
  const date = new Date().toISOString().slice(0, 10);
  if (ready.length === 1) return `${ready[0].fileName.replace(/\.(ifc|ifczip)$/i, "")}_${date}.bcf`;
  return `ifc-check_${date}.bcf`;
}

interface Outcome {
  result?: BcfExportResult;
  skipped?: string[];
  error?: string;
}

export function BcfExport({ lang, models }: { lang: Lang; models: ModelEntry[] }) {
  const [open, setOpen] = useState(false);
  const [maxGuids, setMaxGuids] = useState(DEFAULT_MAX_GUIDS);
  const [author, setAuthor] = useState(readAuthor);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const ready = models.some((m) => m.state === "ready");
  const canExport = ready && !busy && author.trim().length > 0 && maxGuids >= 1;

  const run = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const { exportBoardBcf, downloadBcf } = await import("../bcf/browser");
      const { result, skipped } = await exportBoardBcf(models, lang, maxGuids, author.trim());
      if (result.invalid.length === 0) downloadBcf(result.bytes, fileNameFor(models));
      setOutcome({ result, skipped });
    } catch (err) {
      setOutcome({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const result = outcome?.result;
  const spaceFrom = result
    ? [...new Set(result.spaceSources.map((s) => s.source).filter((s): s is string => s !== null))]
    : [];

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
        {t("action.bcf", lang)}
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 flex w-72 flex-col gap-2 border border-line bg-panel p-3 text-[12px]">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              {t("bcf.maxGuids", lang)}
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxGuids}
              onChange={(event) => setMaxGuids(Math.max(1, Math.floor(Number(event.target.value) || 0)))}
              className="border border-line bg-input px-2 py-1 font-mono text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              {t("bcf.author", lang)}
            </span>
            <input
              type="text"
              value={author}
              onChange={(event) => {
                setAuthor(event.target.value);
                writeAuthor(event.target.value);
              }}
              className="border border-line bg-input px-2 py-1 text-ink"
            />
          </label>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => void run()}
            className="bg-green px-3 py-1.5 text-cream hover:bg-ink disabled:opacity-40"
          >
            {busy ? "…" : t("bcf.export", lang)}
          </button>

          {outcome?.error ? (
            <pre className="m-0 bg-bad px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-cream">
              {outcome.error}
            </pre>
          ) : null}

          {result ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
              <dt className="text-muted">{t("bcf.topics", lang)}</dt>
              <dd className="m-0 text-ink">{formatCount(result.plan.topics.length, lang)}</dd>
              <dt className="text-muted">{t("bcf.snapshots", lang)}</dt>
              <dd className="m-0 text-ink">{formatCount(result.snapshots, lang)}</dd>
              <dt className="text-muted">{spaceFrom.length > 0 ? t("bcf.spaces", lang) : t("bcf.noSpaces", lang)}</dt>
              <dd className="m-0 break-all text-ink">{spaceFrom.join(", ")}</dd>
              {result.noCamera.map((n) => (
                <FragmentRow key={n.fileName} label={t("bcf.noCamera", lang)} value={`${n.fileName} (${n.reason})`} />
              ))}
              {(outcome?.skipped ?? []).map((name) => (
                <FragmentRow key={name} label="cache_key" value={name} />
              ))}
              {result.invalid.length > 0 ? (
                <FragmentRow
                  label={t("bcf.invalid", lang)}
                  value={`${result.invalid.length} · ${result.invalid[0].path}: ${result.invalid[0].errors[0] ?? ""}`}
                  bad
                />
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FragmentRow({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <>
      <dt className={bad ? "font-semibold text-bad" : "text-muted"}>{label}</dt>
      <dd className={"m-0 break-all " + (bad ? "text-bad" : "text-ink")}>{value}</dd>
    </>
  );
}
