/** The Kontroll tab in the three design alternatives (`#design=a|b|c`).
 *
 * 2026-09-25, second round. edkjo on the first: *"the content dash still
 * sucks. I dont understand the obsession with floor vs ifcclass"* … *"why not
 * report on what matters first? Remember you're building with the pdf
 * report."* So the board leads with the mottakskontroll report's
 * requirements, in its order (`requirements.ts`), read off the report
 * contract the worker built. And *"When clicking an object it makes no sense
 * to open a table that hides half the page"*: nothing overlays the board. Two
 * docked panels are always present, Scope (the identities the last click
 * scoped to) and Detail (the one selected identity).
 *
 *   a  Linear work surface   the requirements as one list | the model over
 *                            Scope and Detail | the charts in a column
 *   b  Stripe summary        the charts first as the summary row, then the
 *                            report as blocks down one column, the model
 *                            beside it, Scope over Detail as a rail
 *   c  Grafana / Datadog     the report's two sections as titled rows of
 *                            panels, the charts and the other checks under
 *                            them; the model, Scope and Detail at the right
 *
 * One screen: the board fills the rows the viewport has, and a tile's
 * surplus scrolls inside the tile. Every body is data the worker built or an
 * existing component; `onFocus` decides what a click means, as on the bento
 * board.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ModelResult } from "../../ids/evaluate.ts";
import type { KpiClaims } from "../claims";
import type { ModelEntry } from "../useModels";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { Design } from "../useHashView";
import type { ModelView } from "../cross-filter";
import type { KpiCard } from "../forms";
import { t } from "../i18n";
import { formatCount } from "../format";
import { Verification } from "../Verification";
import { ViewerTile } from "../../viewer/ViewerTile";
import { VERDICT_GLYPH } from "../state-visuals";
import { boardCards, claimedChecks } from "../board-data";
import { REQ_GROUPS, requirementRowIds, requirements, type Requirement } from "../requirements";
import { ReqBlock, ReqPanel, ReqRow } from "./Requirements";
import { CodeTreemap, MmiChart } from "./Charts";
import { treeTitle } from "./req-view";
import {
  MG_GUTTER,
  MG_MAX_WIDTH,
  MG_ROW,
  layoutA,
  layoutB,
  layoutC,
  mgRowsIn,
  type MgLayout,
  type MgNeeds,
  type MgPlace,
} from "./module-grid";

export interface AltBoardProps {
  design: Design;
  lang: Lang;
  model: ModelEntry;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  view: ModelView;
  matched: Set<string> | null;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  rules?: { evaluation?: ModelResult; evaluating?: boolean; error?: string };
  /** The rows behind the last click (the derivation list), or null. */
  scope: ReactNode;
  /** Everything about the selected identity (the object panel), or null. */
  detail: ReactNode;
}

/** The list components read the bento's size variables; here they are fixed
 *  at the module's own values: a 32 px line, 13 / 11 px type. */
const VARS = {
  "--bento-line": `${MG_ROW}px`,
  "--bento-fs": "13px",
  "--bento-fs-sm": "11px",
  "--bento-pad": "12px",
  "--bento-label": "11px",
  "--bento-text": "13px",
  "--bento-value": "30px",
  "--bento-row": `${MG_ROW}px`,
} as CSSProperties;

/** The grid's box: its width (capped) and the rows the viewport leaves under
 *  it, so the board is one screen per model panel. */
function useModuleBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; rows: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    const measure = () => {
      const width = Math.min(el.clientWidth, MG_MAX_WIDTH);
      let rows = 12;
      if (main) {
        // The page height less what sits above the grid INSIDE its own panel
        // (name line, tabs), so a second model further down the page gets
        // the same board as the first.
        const panel = el.closest("section") ?? el;
        const above = el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        const style = getComputedStyle(main);
        const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        rows = mgRowsIn(main.clientHeight - above - pad);
      }
      setBox((prev) => (prev && prev.width === width && prev.rows === rows ? prev : { width, rows }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, box };
}

export function AltBoard(props: AltBoardProps) {
  const { design, model } = props;
  const { ref, box } = useModuleBox();
  const reqs = useMemo(() => requirements(model.board?.rows), [model.board]);
  const needs: MgNeeds = { rowsAvail: box?.rows ?? 12 };
  const counts = {
    ifc: reqs.filter((r) => r.group === "ifc").length,
    std: reqs.filter((r) => r.group === "std").length,
  };

  let layout: MgLayout | null = null;
  if (box) {
    if (design === "a") layout = layoutA(box.width, needs);
    else if (design === "b") layout = layoutB(box.width, needs);
    else layout = layoutC(box.width, { ...needs, ...counts });
  }
  const bodies = layout ? tileBodies(props, reqs, layout) : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS}>
      {layout && bodies ? (
        <div
          data-mg-grid
          data-mg-design={design}
          data-mg-cols={layout.cols}
          data-mg-pitch={layout.pitch.toFixed(4)}
          className="mx-auto grid"
          style={{
            width: Math.min(box!.width, MG_MAX_WIDTH),
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, ${MG_ROW}px)`,
            gap: MG_GUTTER,
          }}
        >
          {layout.titles.map((title) => (
            <div
              key={title.id}
              data-mg-row={title.id}
              data-mg-span={`${title.x},${title.w}`}
              className="alt-group flex min-w-0 items-end gap-3"
              style={{ gridColumn: `${title.x + 1} / span ${title.w}`, gridRow: `${title.y + 1} / span 1` }}
            >
              <span className="alt-group-title">
                {t(title.id === "g-ifc" ? "req.group.ifc" : "req.group.std", props.lang)}
              </span>
            </div>
          ))}
          {layout.tiles.map((place) => (
            <Tile key={place.id} place={place} body={bodies(place.id)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── the tile frame ─────────────────────────────────────────────────────── */

interface TileBody {
  label?: string;
  sub?: string;
  body: ReactNode;
  /** Bare: no head, the body is the whole tile. */
  bare?: boolean;
}

function Tile({ place, body }: { place: MgPlace; body: TileBody | null }) {
  if (!body) return null;
  return (
    <section
      data-mg-tile={place.id}
      data-mg-kind={place.kind}
      data-mg-at={`${place.x},${place.y},${place.w},${place.h}`}
      className="alt-card flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ gridColumn: `${place.x + 1} / span ${place.w}`, gridRow: `${place.y + 1} / span ${place.h}` }}
    >
      {body.bare ? null : (
        <div className="alt-head flex h-8 shrink-0 items-center gap-2 px-3">
          {body.label ? <span className="alt-label truncate">{body.label}</span> : null}
          {body.sub ? (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{body.sub}</span>
          ) : null}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body.body}</div>
    </section>
  );
}

/* ── bodies ─────────────────────────────────────────────────────────────── */

function tileBodies(props: AltBoardProps, reqs: Requirement[], layout: MgLayout): (id: string) => TileBody | null {
  const { design, lang, model, selected, onFocus, view, matched, onPick, onHover } = props;
  const door = { lang, model, selected, onFocus };
  const board = model.board;
  const mmi = reqs.find((r) => r.key === "mmi")!;

  const viewer: TileBody = {
    label: t("tile.viewer", lang),
    sub: model.meshBudget ? `${formatCount(model.meshBudget.triangles, lang)} tri` : undefined,
    body: (
      <ViewerTile
        lang={lang}
        batches={model.meshBatches}
        shift={model.meshShift}
        budget={model.meshBudget}
        meshError={model.meshError}
        matched={matched}
        mode={view.mode}
        selection={view.selection}
        hover={view.hover}
        frameSeq={view.frameSeq}
        onPick={onPick}
        onHover={onHover}
      />
    ),
  };

  const chart = (id: string): TileBody | null => {
    if (id === "mmi") {
      return { label: t("req.mmi", lang), sub: mmi.row?.fordeling ? formatCount(mmi.row.fordeling.length, lang) : undefined, body: <MmiChart req={mmi} {...door} /> };
    }
    const tree = board?.trees[id === "tree-system" ? "system" : "function"];
    if (!tree) return null;
    return {
      label: t(treeTitle(tree), lang),
      sub: formatCount(tree.n, lang),
      body: <CodeTreemap tree={tree} {...door} />,
    };
  };

  // c's check tile is narrower than a list pane: the check list drops its %.
  const secondary = <Secondary {...props} reqs={reqs} share={!(design === "c" && !layout.chartsInList)} />;

  return (id: string): TileBody | null => {
    if (id === "viewer") return viewer;
    if (id === "scope") return { bare: true, body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="scope">{props.scope}</div> };
    if (id === "detail") return { bare: true, body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="detail">{props.detail}</div> };
    if (id === "tree-system" || id === "tree-function" || id === "mmi") return chart(id);
    if (id === "checks") return { label: t("tile.verify", lang), body: <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{secondary}</div> };
    if (id === "reqs") {
      return {
        bare: true,
        body: (
          <div className="alt-list flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
            {REQ_GROUPS.map((g) => (
              <div key={g.group} className="flex shrink-0 flex-col">
                <GroupHead label={t(g.label, lang)} />
                {reqs
                  .filter((r) => r.group === g.group)
                  .map((req) =>
                    design === "b" ? (
                      <ReqBlock key={req.key} req={req} index={reqs.indexOf(req) + 1} {...door} />
                    ) : (
                      <ReqRow key={req.key} req={req} {...door} />
                    ),
                  )}
              </div>
            ))}
            {layout.chartsInList
              ? (["tree-system", "tree-function", "mmi"] as const).map((c) => {
                  const body = chart(c);
                  return body ? (
                    <div key={c} data-inline-chart={c} className="flex shrink-0 flex-col">
                      <GroupHead label={body.label ?? ""} sub={body.sub} />
                      <div className="flex h-64 shrink-0 flex-col">{body.body}</div>
                    </div>
                  ) : null;
                })
              : null}
            {design === "c" && !layout.chartsInList ? null : (
              <>
                <GroupHead label={t("tile.verify", lang)} />
                {secondary}
              </>
            )}
          </div>
        ),
      };
    }
    const panel = /^(ifc|std)(\d+)$/.exec(id);
    if (panel) {
      const req = reqs.filter((r) => r.group === panel[1])[Number(panel[2])];
      return req ? { bare: true, body: <ReqPanel req={req} {...door} /> } : null;
    }
    return null;
  };
}

/** The checks the report does not carry, and the project rules that are not
 *  a mapping: the rest of what the engine ran, after the requirements. The
 *  existing verification list, less the rows a requirement already shows,
 *  then the neutral counts. */
function Secondary(props: AltBoardProps & { reqs: Requirement[]; share: boolean }) {
  const { lang, model, claims, selected, onFocus, rules, reqs, share } = props;
  const report = model.report!;
  const shown = requirementRowIds(reqs);
  const mappingIds = new Set((model.board?.rows ?? []).filter((r) => r.mapping).map((r) => r.id));
  const results = model.evaluation?.results;
  const claimed = useMemo(() => claimedChecks(claims, results), [claims, results]);
  const rest = report.checks.filter((c) => !shown.has(c.id));
  const restRules = rules
    ? {
        ...rules,
        evaluation: rules.evaluation
          ? { ...rules.evaluation, results: rules.evaluation.results.filter((r) => !mappingIds.has(r.ruleId)) }
          : undefined,
      }
    : undefined;
  const { countCards } = boardCards(model, lang);
  return (
    <div className="flex shrink-0 flex-col">
      <div className="flex shrink-0 flex-col">
        <Verification lang={lang} checks={rest} claimed={claimed} selected={selected} onFocus={onFocus} rules={restRules} fill share={share} />
      </div>
      <div className="alt-group-rule shrink-0" />
      {countCards.map((card: KpiCard) => (
        <div key={card.key} className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
          <span className="alt-label truncate">{card.label}</span>
          <span data-essential className="ml-auto font-mono text-[13px] font-semibold whitespace-nowrap tabular-nums">
            {card.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function GroupHead({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="alt-group-head sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 px-3">
      <span className="alt-label truncate">{label}</span>
      {sub ? <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{sub}</span> : null}
    </div>
  );
}

/* ── kept, off the main dash ───────────────────────────────────────────────
 *
 * The per-storey and per-class small multiple and the chain as a line of
 * lamps, which c and b drew until 2026-09-25. The storey and class views
 * left the main dash for the report's requirements (the owner: *"I dont
 * understand the obsession with floor vs ifcclass"*); Innhold keeps Klasser
 * and Etasje × klasse, and the bento board keeps its Etasjer tile. */

export function Lamps({
  lang,
  levels,
  onOpen,
}: {
  lang: Lang;
  levels: { level: string; size: number }[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("tile.spatial", lang)}
      className="alt-lamps alt-hover flex h-8 shrink-0 items-center gap-3 overflow-hidden border-b border-line px-3 text-left"
    >
      {levels.map((level) => {
        const ok = level.size > 0;
        return (
          <span key={level.level} className="flex min-w-0 shrink items-center gap-1.5">
            <span data-verdict={ok ? "pass" : "fail"} className="alt-lamp">
              {ok ? VERDICT_GLYPH.pass : VERDICT_GLYPH.fail}
            </span>
            <span className="truncate font-mono text-[11px]">{level.level}</span>
            <span data-essential className="font-mono text-[12px] font-semibold tabular-nums">
              {formatCount(level.size, lang)}
            </span>
          </span>
        );
      })}
    </button>
  );
}

export function Multiple({
  name,
  mono = false,
  note,
  value,
  share,
  chosen,
  onOpen,
}: {
  name: string;
  mono?: boolean;
  note?: string;
  value: string;
  share: number;
  chosen: boolean;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          title={name}
          className={"truncate text-ink " + (mono ? "font-mono text-[12px]" : "text-[13px] font-medium")}
        >
          {name}
        </span>
        {note ? <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{note}</span> : null}
      </span>
      <span data-essential className="alt-figure alt-figure-count font-mono leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span aria-hidden className="alt-meter block h-1.5 w-full overflow-hidden">
        <span className="block h-full" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </>
  );
  const cls =
    "alt-stat alt-sized flex h-full min-h-0 min-w-0 flex-1 flex-col justify-between gap-1.5 px-3 py-2.5 text-left " +
    (chosen ? "alt-chosen" : "");
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} alt-hover`}>
      {inner}
    </button>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

