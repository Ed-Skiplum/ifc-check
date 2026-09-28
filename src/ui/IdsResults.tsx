/** The IDS result for one model: one row per specification of the loaded
 *  `.ids`, in file order, and nothing else (edkjo 2026-09-28: *"an IDS tab
 *  that only shows the IDS result"*). Mounted in the Prosjekt tab.
 *
 * The file is opened or dropped HERE, apart from the ruleset: an `.ids` run
 * as written, through `src/ids/import.ts` and the evaluator (`ids-report.ts`).
 *
 * A row is name · Aktuelle · Bestått · Avvik · status. A specification whose
 * applicability matched nothing is NOT APPLIED (`ids.notApplied`), never a
 * pass; one the evaluator could not answer is `not_evaluable` with the reason
 * in the row's title and in the band.
 *
 * A row is a door like every other on the board: the click opens the
 * derivation (the failing elements) and adds the chip that isolates them in
 * the viewer beside the table (`WithViewer`, the board's one scene, lent).
 */

import { useRef, type DragEvent } from "react";
import type { ResultState } from "../ids/evaluate.ts";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Focus } from "./trace";
import type { ModelEntry } from "./useModels";
import { formatCount } from "./format";
import { copyOnDoubleClick } from "./copy";
import { RESULT_FILL, RESULT_GLYPH } from "./state-visuals";
import { LentViewer, useTabGrid, viewerSpan } from "./BoardViewer";
import { useFillHeight } from "./useFillHeight";
import { MG_GAP, mgSpanPx } from "./alt/module-grid";

/** Modules the table keeps beside the viewer: a specification name, three
 *  counts and the state word need about 680 px, six modules. */
const TABLE_MODULES = 6;

/** The loaded `.ids`, shared by every model panel. */
export interface IdsSession {
  fileName: string;
  title: string;
}

const IDS_FILE = /\.(ids|xml)$/i;

function isIdsFile(file: File): boolean {
  return IDS_FILE.test(file.name);
}

function stateWord(state: ResultState, lang: Lang): string {
  return state === "not_applicable" ? t("ids.notApplied", lang) : t(`result.${state}`, lang);
}

const BUTTON =
  "shrink-0 cursor-pointer border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green";
const NUM = "px-2 text-right font-mono text-[11.5px] tabular-nums";

export function IdsResults({
  lang,
  model,
  session,
  error,
  selected,
  onFocus,
  onFile,
  onClear,
}: {
  lang: Lang;
  model: ModelEntry;
  session: IdsSession | null;
  /** The file could not be imported. Shown in full. */
  error: string | null;
  /** The open derivation's focus key, when it is this model's. */
  selected: string | null;
  onFocus: (focus: Focus) => void;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  // The table keeps TABLE_MODULES columns of the tab's grid; the viewer takes
  // the largest canon size beside it (`viewerSpan`, rule 4 and 7).
  const { ref: gridRef, grid } = useTabGrid<HTMLDivElement>();
  const viewer = grid ? viewerSpan(grid, TABLE_MODULES) : ([0, 0] as const);
  const result = model.ids;

  // A drop here is the IDS tab's own: marked handled (`preventDefault`) so the
  // app's drop handler does not also load the file as the ruleset.
  const drop = (event: DragEvent) => {
    const file = Array.from(event.dataTransfer.files).find(isIdsFile);
    if (!file) return;
    event.preventDefault();
    onFile(file);
  };

  const failed = error ?? model.idsError ?? null;

  return (
    <section
      ref={fillRef}
      style={{ height: fillHeight ?? undefined }}
      className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      data-ids-tab
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-1">
        <span className="shrink-0 text-[12px] font-semibold text-ink">{t("ids.heading", lang)}</span>
        {session ? (
          <span
            onDoubleClick={copyOnDoubleClick(session.fileName)}
            className="min-w-0 cursor-copy truncate font-mono text-[11px] text-muted"
            title={session.title}
          >
            {session.fileName}
          </span>
        ) : null}
        <input
          ref={input}
          type="file"
          accept=".ids,.xml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
        <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
          {t("action.openIds", lang)}
        </button>
        {session ? (
          <button type="button" className={BUTTON} onClick={onClear}>
            {t("action.remove", lang)}
          </button>
        ) : null}
      </div>

      {failed ? (
        <pre
          onDoubleClick={copyOnDoubleClick(failed)}
          className="m-0 mx-4 mt-2 shrink-0 cursor-copy bg-bad px-2.5 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream"
        >
          {`${t("error.ids", lang)}: ${failed}`}
        </pre>
      ) : null}

      <div
        ref={gridRef}
        className="flex min-h-0 min-w-0 flex-1"
        data-tab-grid={grid ? `${grid.cols},${grid.rows},${grid.u.toFixed(2)}` : undefined}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ padding: MG_GAP }}>
          <div className="gallery-card flex min-h-0 flex-1 flex-col overflow-hidden">
            {session && result ? (
              <div className="min-h-0 flex-1 overflow-auto" data-ids-table>
                <table className="w-full table-fixed border-collapse text-[12px]">
                  <colgroup>
                    <col />
                    <col className="w-20" />
                    <col className="w-20" />
                    <col className="w-20" />
                    <col className="w-[8.5rem]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-panel">
                    <tr className="border-b border-line text-[11px] text-muted">
                      <th className="px-3 py-1.5 text-left font-medium" />
                      <th className={`${NUM} py-1.5 font-medium`}>{t("trace.applicable", lang)}</th>
                      <th className={`${NUM} py-1.5 font-medium`}>{t("trace.passed", lang)}</th>
                      <th className={`${NUM} py-1.5 font-medium`}>{t("trace.failed", lang)}</th>
                      <th className="px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.specs.map((spec) => {
                      const focus: Focus = { kind: "ids", index: spec.index };
                      const open = selected === `ids:${spec.index}`;
                      const counted = spec.state === "pass" || spec.state === "fail";
                      return (
                        <tr
                          key={spec.index}
                          role="button"
                          tabIndex={0}
                          aria-current={open ? "true" : undefined}
                          title={spec.reason ?? spec.description ?? spec.name}
                          onClick={() => onFocus(focus)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onFocus(focus);
                          }}
                          data-ids-spec={spec.index}
                          data-state={spec.state}
                          className={
                            "cursor-pointer border-b border-line/60 hover:bg-ink/5 " +
                            (open ? "bg-ink/10" : "")
                          }
                        >
                          <td className="truncate px-3 py-1 text-ink">{spec.name}</td>
                          <td className={NUM}>
                            {spec.state === "not_evaluable" ? "–" : formatCount(spec.applicable, lang)}
                          </td>
                          <td className={NUM}>{counted ? formatCount(spec.passed, lang) : "–"}</td>
                          <td className={`${NUM} ${counted && spec.failed > 0 ? "font-semibold text-bad" : ""}`}>
                            {counted ? formatCount(spec.failed, lang) : "–"}
                          </td>
                          <td className="px-2 py-0.5">
                            <span
                              className={
                                "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap " +
                                RESULT_FILL[spec.state]
                              }
                            >
                              <span className="font-mono font-bold">{RESULT_GLYPH[spec.state]}</span>
                              {stateWord(spec.state, lang)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : session && model.idsEvaluating ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
                {t("result.evaluating", lang)}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="flex flex-1 cursor-pointer items-center justify-center text-[12px] text-muted hover:text-green"
              >
                {t("action.openIds", lang)}
              </button>
            )}
          </div>
        </div>
        {grid ? (
          <LentViewer
            meshBatches={model.meshBatches}
            active
            className="shrink-0"
            style={{
              width: mgSpanPx(viewer[0], grid.u),
              height: mgSpanPx(viewer[1], grid.u),
              marginTop: MG_GAP,
              marginRight: MG_GAP,
            }}
            data={{ "data-viewer-span": `${viewer[0]}x${viewer[1]}` }}
          />
        ) : null}
      </div>
    </section>
  );
}
