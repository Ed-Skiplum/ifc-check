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
 * 2026-09-26, the LAYOUT SYSTEM canon (`data-workspace.md`): one square
 * module grid per window, bento tiles at canon sizes packed by priority
 * (`module-grid.ts`), floating glass tiles (`directions.css`). The three
 * alternatives differ in composition only:
 *
 *   a  Linear work surface   the requirements as a row of KPI cards on top
 *                            (2026-09-26, replacing the list beside the
 *                            model), the model the hero under it; Scope and
 *                            Detail, the charts
 *   b  Stripe summary        the treemaps and the MMI bars lead top-left, the
 *                            model beside them; the report as blocks, Scope
 *                            and Detail under
 *   c  Grafana / Datadog     one S panel per requirement, the report's two
 *                            sections as blocks; the model; Scope and Detail
 *
 * One screen: the board fits the rows the window has, and a tile's surplus
 * scrolls inside the tile. Every body is data the worker built or an existing
 * component; `onFocus` decides what a click means, as on the bento board.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { ReqBlock, ReqCard, ReqPanel, ReqRow, ReqSection } from "./Requirements";
import { CodeTreemap, MmiChart } from "./Charts";
import { treeTitle } from "./req-view";
import {
  MG_GAP,
  MG_HEAD,
  MG_MARGIN,
  layoutA,
  layoutB,
  layoutC,
  mgGrid,
  type MgGrid,
  type MgLayout,
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

/** The list components read the bento's size variables; here they are fixed:
 *  a 32 px line, 13 / 11 px type. */
const VARS = {
  "--bento-line": "32px",
  "--bento-fs": "13px",
  "--bento-fs-sm": "11px",
  "--bento-pad": "12px",
  "--bento-label": "11px",
  "--bento-text": "13px",
  "--bento-value": "30px",
  "--bento-row": "32px",
} as CSSProperties;

/** The window's grid (rule 6): its width is the page's (`main`'s client
 *  width: the window less a scrollbar), its height what the window leaves
 *  under the grid's top edge INSIDE its own model panel, so a second model
 *  further down the page gets the same board as the first. */
function useModuleGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<MgGrid | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    const measure = () => {
      if (!main) return;
      const panel = el.closest("main > section") ?? el;
      const above = el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      const style = getComputedStyle(main);
      const padTop = parseFloat(style.paddingTop) || 0;
      // H − chrome, with the canon's 24 px top margin counted inside it.
      const avail = main.clientHeight - padTop - above + MG_MARGIN;
      const next = mgGrid(main.clientWidth, avail);
      setGrid((prev) =>
        prev && prev.cols === next.cols && prev.rows === next.rows && Math.abs(prev.u - next.u) < 0.01 ? prev : next,
      );
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
  return { ref, grid };
}

export function AltBoard(props: AltBoardProps) {
  const { design, model, lang } = props;
  const { ref, grid } = useModuleGrid();
  const reqs = useMemo(() => requirements(model.board?.rows), [model.board]);
  const counts = useMemo(() => boardCards(model, lang).countCards, [model, lang]);
  const content = {
    ifc: reqs.filter((r) => r.group === "ifc").length,
    std: reqs.filter((r) => r.group === "std").length,
    counts: counts.length,
  };
  const layout = useMemo<MgLayout | null>(() => {
    if (!grid) return null;
    if (design === "a") return layoutA(grid, content);
    if (design === "b") return layoutB(grid, content);
    return layoutC(grid, content);
    // `content` is three numbers; the layout is a pure function of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, design, content.ifc, content.std, content.counts]);

  // A dock that is a tab (the narrow board) comes forward when it fills: a
  // requirement click fills Scope, a selection fills Detail.
  const [prefer, setPrefer] = useState<string | null>(null);
  const selectionKey = props.view.selection.join(",");
  useEffect(() => {
    if (props.selected) setPrefer("scope");
  }, [props.selected]);
  useEffect(() => {
    if (selectionKey) setPrefer("detail");
  }, [selectionKey]);

  const bodies = layout ? tileBodies(props, reqs, counts, layout) : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS}>
      {grid && layout && bodies ? (
        <div
          data-mg-grid
          data-mg-design={design}
          data-mg-band={layout.band}
          data-mg-cols={grid.cols}
          data-mg-rows={grid.rows}
          data-mg-u={grid.u.toFixed(4)}
          data-mg-used={`${layout.offset},${layout.top},${layout.used},${layout.usedRows}`}
          className="alt-board mx-auto grid"
          style={{
            width: grid.cols * grid.u + (grid.cols - 1) * MG_GAP,
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
            gridTemplateRows: `repeat(${grid.rows}, ${grid.u}px)`,
            gap: MG_GAP,
          }}
        >
          {layout.tiles.map((place) => (
            <Tile key={place.id} place={place} bodies={bodies} prefer={prefer} />
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

type Bodies = (id: string) => TileBody | null;

/** One tile. Tiles moved into it (rule 8) are tabs in its head, after its
 *  own; the counts never are (they stay in the checks list), and the
 *  requirements list carries what moves into it inline, after its rows. */
function Tile({ place, bodies, prefer }: { place: MgPlace; bodies: Bodies; prefer: string | null }) {
  const own = bodies(place.id);
  const tabs =
    place.id === "reqs" ? [place.id] : [place.id, ...place.tabs.filter((id) => !id.startsWith("count") && bodies(id))];
  const [active, setActive] = useState(place.id);
  useEffect(() => {
    if (prefer && tabs.includes(prefer)) setActive(prefer);
    // `tabs` is derived from the place; `prefer` is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefer]);
  const shown = tabs.includes(active) ? active : place.id;
  const body = shown === place.id ? own : bodies(shown);
  if (!own || !body) return null;
  const tabbed = tabs.length > 1;
  return (
    <section
      data-mg-tile={place.id}
      data-mg-kind={place.kind}
      data-mg-size={place.size}
      data-mg-tabs={tabbed ? tabs.slice(1).join(",") : undefined}
      data-mg-at={`${place.x},${place.y},${place.w},${place.h}`}
      className="alt-card flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ gridColumn: `${place.x + 1} / span ${place.w}`, gridRow: `${place.y + 1} / span ${place.h}` }}
    >
      {tabbed ? (
        <div className="alt-head flex shrink-0 items-center gap-1 overflow-x-auto px-2" style={{ height: MG_HEAD }}>
          {tabs.map((id) => {
            const b = id === place.id ? own : bodies(id);
            return (
              <button
                key={id}
                type="button"
                data-mg-tab={id}
                aria-pressed={shown === id}
                onClick={() => setActive(id)}
                className="alt-tab shrink-0 truncate px-2 py-0.5"
              >
                {b?.label ?? id}
              </button>
            );
          })}
        </div>
      ) : body.bare ? null : (
        <div className="alt-head flex shrink-0 items-center gap-2 px-3" style={{ height: MG_HEAD }}>
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

function tileBodies(props: AltBoardProps, reqs: Requirement[], counts: KpiCard[], layout: MgLayout): Bodies {
  const { design, lang, model, selected, onFocus, view, matched, onPick, onHover } = props;
  const door = { lang, model, selected, onFocus };
  const board = model.board;
  const mmi = reqs.find((r) => r.key === "mmi")!;
  const placed = new Set(layout.tiles.map((t) => t.id));
  const reqsHost = layout.tiles.find((t) => t.id === "reqs");
  // What the requirements list carries inline after its rows: the tiles moved
  // into it, in the old list order (the charts, then the other checks).
  const inline = new Set(reqsHost?.tabs ?? []);
  const countsInList = counts.filter((_, i) => !placed.has(`count${i}`));

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
        onPick={onPick}
        onHover={onHover}
      />
    ),
  };

  const chart = (id: string): TileBody | null => {
    if (id === "mmi") {
      return {
        label: t("req.mmi", lang),
        sub: mmi.row?.fordeling ? formatCount(mmi.row.fordeling.length, lang) : undefined,
        body: <MmiChart req={mmi} {...door} />,
      };
    }
    const tree = board?.trees[id === "tree-system" ? "system" : "function"];
    if (!tree) return null;
    return {
      label: t(treeTitle(tree), lang),
      sub: formatCount(tree.n, lang),
      body: <CodeTreemap tree={tree} {...door} />,
    };
  };

  const checksTile = layout.tiles.find((t) => t.id === "checks");
  const secondary = (
    <Secondary
      {...props}
      reqs={reqs}
      counts={countsInList}
      share={!checksTile || checksTile.w * layout.u >= 400}
    />
  );

  return (id: string): TileBody | null => {
    if (id === "viewer") return viewer;
    if (id === "scope")
      return {
        bare: true,
        label: t("tile.scope", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="scope">{props.scope}</div>,
      };
    if (id === "detail")
      return {
        bare: true,
        label: t("tile.detail", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="detail">{props.detail}</div>,
      };
    if (id === "tree-system" || id === "tree-function" || id === "mmi") return chart(id);
    if (id === "checks") {
      return {
        label: t("tile.verify", lang),
        body: <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{secondary}</div>,
      };
    }
    const count = /^count(\d+)$/.exec(id);
    if (count) {
      const card = counts[Number(count[1])];
      return card ? { bare: true, label: card.label, body: <CountTile card={card} /> } : null;
    }
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
            {(["tree-system", "tree-function", "mmi"] as const)
              .filter((c) => inline.has(c))
              .map((c) => {
                const body = chart(c);
                return body ? (
                  <div key={c} data-inline-chart={c} className="flex shrink-0 flex-col">
                    <GroupHead label={body.label ?? ""} sub={body.sub} />
                    <div className="flex h-64 shrink-0 flex-col">{body.body}</div>
                  </div>
                ) : null;
              })}
            {placed.has("checks") ? null : (
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
      if (!req) return null;
      return {
        bare: true,
        label: t(req.label, lang),
        body: design === "a" ? <ReqCard req={req} {...door} /> : <ReqPanel req={req} {...door} />,
      };
    }
    const section = /^g-(ifc|std)$/.exec(id);
    if (section) {
      const group = REQ_GROUPS.find((g) => g.group === section[1])!;
      return {
        label: t(group.label, lang),
        body: <ReqSection reqs={reqs.filter((r) => r.group === group.group)} {...door} />,
      };
    }
    return null;
  };
}

/** One neutral count, one fact, an S tile. */
function CountTile({ card }: { card: KpiCard }) {
  return (
    <div className="alt-stat alt-sized flex h-full min-h-0 min-w-0 flex-col gap-2 px-3 py-2.5">
      <span className="alt-label truncate" title={card.label}>
        {card.label}
      </span>
      <span data-essential className="alt-figure alt-figure-count my-auto font-mono leading-none font-semibold whitespace-nowrap tabular-nums">
        {card.value}
      </span>
    </div>
  );
}

/** The checks the report does not carry, and the project rules that are not
 *  a mapping: the rest of what the engine ran, after the requirements. The
 *  existing verification list, less the rows a requirement already shows,
 *  then the neutral counts that are not tiles of their own. */
function Secondary(props: AltBoardProps & { reqs: Requirement[]; counts: KpiCard[]; share: boolean }) {
  const { lang, model, claims, selected, onFocus, rules, reqs, counts, share } = props;
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
  return (
    <div className="flex shrink-0 flex-col">
      <div className="flex shrink-0 flex-col">
        <Verification lang={lang} checks={rest} claimed={claimed} selected={selected} onFocus={onFocus} rules={restRules} fill share={share} />
      </div>
      {counts.length > 0 ? <div className="alt-group-rule shrink-0" /> : null}
      {counts.map((card: KpiCard) => (
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
