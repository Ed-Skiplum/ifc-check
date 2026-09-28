/** The Overview tab («Oversikt», was Kontroll): general model health.
 *
 * 2026-09-28, the owner on b: *"Kontroll should be 'Overview' and IDS should
 * be specific to that"* … *"We have a dash for general model health and a
 * separate tab for project specifics and IDS"* … *"the IFC-struktur shouldnt
 * be buried in a truncated scroll list. Keep them visible as KPIs. Use the
 * screen"* … *"KPI cards go on top, then sidebar and larger tiled
 * components"* … *"show the floor config on the right side as a tall
 * sidebar"*. So the board is three parts (`layoutOverview` in
 * `module-grid.ts`):
 *
 *   the KPI row   one S card per IFC-struktur requirement (IFC-skjema,
 *                 Typeobjekt, GUID, Etasjedefinisjon, Objekter i etasje), in
 *                 the report's order, then the neutral counts
 *   the sidebar   the floor config (Etasjer), full height on the right
 *   the middle    the model (hero), Scope, Detail, the checks that are not a
 *                 requirement, and the treemaps where they are general (the
 *                 IFC-class and PredefinedType fallbacks)
 *
 * NOT here, for the project tab: the Standardkrav requirements (Systemkode,
 * Funksjonskode, Materiale/Produkt, Kopiobjekt, MMI, Fase), the MMI bars, a
 * treemap read through a project mapping, and the project's own rules. They
 * are the project tab's board, `ProjectBoard.tsx`.
 *
 * Nothing overlays the board: Scope (the identities the last click scoped
 * to) and Detail (the one selected identity) are docked tiles. Every body is
 * data the worker built or an existing component; `onFocus` decides what a
 * click means.
 *
 * The cross-filter (2026-09-28, one origin): each tile names the view it is
 * (`viewer`, `tree-system`, `tree-function`, `checks`, `reqs`, `floors`).
 * The tile the click came from keeps every item and dims all but the chosen
 * one (`data-xf="origin"`); the 3D, the treemaps and the floor sidebar
 * isolate to the filter; the KPI cards and the checks keep the whole model's
 * figures and say so (`data-xf="whole"`, «Hele modellen»), because a
 * requirement's base is not known per element.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ModelResult } from "../../ids/evaluate.ts";
import type { KpiClaims } from "../claims";
import type { ModelEntry } from "../useModels";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { Design } from "../useHashView";
import type { ModelView, Origin } from "../cross-filter";
import { isoOf, xfMark, type Xf } from "../origins";
import type { KpiCard } from "../forms";
import type { Census } from "../profile";
import type { FloorConfig } from "../../engine/storey-config";
import { matchStoreys } from "../../engine/storey-config";
import { t } from "../i18n";
import { formatCount } from "../format";
import { Verification } from "../Verification";
import { ViewerTile } from "../../viewer/ViewerTile";
import { VERDICT_GLYPH } from "../state-visuals";
import { boardCards } from "../board-data";
import { FloorSetupMatrix, StoreyList, type FloorPeer } from "../FloorSetup";
import { requirementRowIds, requirements, type Requirement } from "../requirements";
import { ReqBlock, ReqCard } from "./Requirements";
import { CodeTreemap, MeasureSwitch } from "./Charts";
import type { Measure } from "../../engine/quantities";
import { generalTrees, overviewRequirements, treeTitle } from "./req-view";
import { MG_GAP, MG_HEAD, MG_MARGIN, layoutOverview, mgGrid, type MgGrid, type MgLayout, type MgPlace } from "./module-grid";

export interface AltBoardProps {
  /** Kept for the callers; there is one composition. */
  design?: Design | null;
  lang: Lang;
  model: ModelEntry;
  claims: KpiClaims;
  selected: string | null;
  /** A click on a board number, and the view it came from. */
  onFocus: (focus: Focus, origin: Origin) => void;
  view: ModelView;
  /** The one filter: its origin and the elements it resolves to. */
  xf: Xf;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  /** The project rules. Not drawn on the Overview (they are the project
   *  tab's); kept so the caller's wiring does not change. */
  rules?: { evaluation?: ModelResult; evaluating?: boolean; error?: string };
  /** The rows behind the last click (the derivation list), or null. */
  scope: ReactNode;
  /** Everything about the selected identity (the object panel), or null. */
  detail: ReactNode;
  /** The floor sidebar: the config floors (or null) against every loaded
   *  model, this one first; with no config, the file's own storeys. */
  census: Census;
  /** The census over the filter's elements, when the floor sidebar isolates. */
  scopedCensus: Census | null;
  floors: FloorConfig[] | null;
  peers: FloorPeer[];
}

/** The list components read the bento's size variables; here they are fixed:
 *  a 32 px line, 13 / 11 px type. */
export const VARS = {
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
export function useModuleGrid() {
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
  const { model, lang } = props;
  const { ref, grid } = useModuleGrid();
  const reqs = useMemo(() => overviewRequirements(model), [model]);
  const counts = useMemo(() => boardCards(model, lang).countCards, [model, lang]);
  const trees = useMemo(() => generalTrees(model), [model]);
  const treeKey = trees.join(",");
  const layout = useMemo<MgLayout | null>(
    () => (grid ? layoutOverview(grid, { ifc: reqs.length, counts: counts.length, trees }) : null),
    // `trees` is keyed by its ids; the layout is a pure function of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, reqs.length, counts.length, treeKey],
  );

  // A dock that is a tab comes forward when it fills: a requirement click
  // fills Scope, a selection fills Detail.
  const [prefer, setPrefer] = useState<string | null>(null);
  const selectionKey = props.view.selection.join(",");
  useEffect(() => {
    if (props.selected) setPrefer("scope");
  }, [props.selected]);
  useEffect(() => {
    if (selectionKey) setPrefer("detail");
  }, [selectionKey]);

  // Antall / Volum / Areal per treemap. A measure still waiting on the
  // geometry pass draws as count (`CodeTreemap`), so the choice survives it.
  const [measure, setMeasure] = useState<{ system: Measure; function: Measure }>({ system: "count", function: "count" });
  const bodies = layout
    ? tileBodies(props, reqs, counts, layout, measure, (axis, m) => setMeasure((prev) => ({ ...prev, [axis]: m })))
    : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS}>
      {grid && layout && bodies ? (
        <div
          data-mg-grid
          data-mg-design="overview"
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

export interface TileBody {
  label?: string;
  sub?: string;
  /** Controls at the head's end (the treemaps' measure switch), in place of
   *  `sub`. */
  head?: ReactNode;
  body: ReactNode;
  /** Bare: no head, the body is the whole tile. */
  bare?: boolean;
  /** A dock with nothing in it yet (Scope, Detail): a tile whose own body is
   *  empty shows its first tab that is not, until a click brings it back. */
  empty?: boolean;
  /** The cross-filter: `origin` dims all but the chosen item; `whole` marks
   *  whole-model figures under a filter from another view, with `whole`'s
   *  text in the corner. */
  xf?: "origin" | "whole";
  wholeText?: string;
}

export type Bodies = (id: string) => TileBody | null;

/** One tile. Tiles moved into it (rule 8) are tabs in its head, after its
 *  own; the counts never are (they stay in the checks list). */
export function Tile({ place, bodies, prefer }: { place: MgPlace; bodies: Bodies; prefer: string | null }) {
  const own = bodies(place.id);
  const tabs = [place.id, ...place.tabs.filter((id) => !id.startsWith("count") && bodies(id))];
  // A tab the reader clicked stays; one a fill brought forward (`prefer`)
  // gives way again once it is empty.
  const [active, setActive] = useState<{ id: string; picked: boolean } | null>(null);
  useEffect(() => {
    if (prefer && tabs.includes(prefer)) setActive({ id: prefer, picked: false });
    // `tabs` is derived from the place; `prefer` is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefer]);
  // Unchosen, the first tab with something in it.
  const auto = tabs.find((id) => !bodies(id)?.empty) ?? place.id;
  const shown =
    active && tabs.includes(active.id) && (active.picked || !bodies(active.id)?.empty) ? active.id : auto;
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
        <div className="alt-head relative flex shrink-0 items-center gap-1 px-2" style={{ height: MG_HEAD }}>
          {tabs.map((id) => {
            const b = id === place.id ? own : bodies(id);
            return (
              <button
                key={id}
                type="button"
                data-mg-tab={id}
                aria-pressed={shown === id}
                onClick={() => setActive({ id, picked: true })}
                className="alt-tab shrink-0 px-2 py-0.5 whitespace-nowrap"
              >
                {b?.label ?? id}
              </button>
            );
          })}
        </div>
      ) : body.bare ? null : (
        <div className="alt-head relative flex shrink-0 items-center gap-2 px-3" style={{ height: MG_HEAD }}>
          {body.label ? <span className="alt-label whitespace-nowrap">{body.label}</span> : null}
          {body.head ?? null}
          {!body.head && body.sub ? (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{body.sub}</span>
          ) : null}
        </div>
      )}
      {tabbed && body.head ? (
        // A tab strip has no room left at its end: the head's controls get
        // their own thin row under it.
        <div className="relative flex h-7 shrink-0 items-center px-2">{body.head}</div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-xf={body.xf}>
        {body.body}
        {body.xf === "whole" && body.wholeText ? (
          <span data-xf-whole className="alt-label pointer-events-none absolute top-1 right-2 text-[9px] whitespace-nowrap">
            {body.wholeText}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/* ── bodies ─────────────────────────────────────────────────────────────── */

function tileBodies(
  props: AltBoardProps,
  reqs: Requirement[],
  counts: KpiCard[],
  layout: MgLayout,
  measure: { system: Measure; function: Measure },
  onMeasure: (axis: "system" | "function", m: Measure) => void,
): Bodies {
  const { lang, model, selected, onFocus, view, xf, onPick, onHover } = props;
  const door = (origin: Origin) => ({ lang, model, selected, onFocus: (focus: Focus) => onFocus(focus, origin) });
  const whole = (self: Origin) => ({ xf: xfMark(xf, self, true), wholeText: t("filter.wholeModel", lang) });
  const board = model.board;
  const placed = new Set(layout.tiles.map((t) => t.id));
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
        // The 3D is the origin of a canvas pick: it keeps the whole model and
        // highlights the pick. From any other view it isolates.
        matched={isoOf(xf, "viewer")}
        mode={view.mode}
        selection={view.selection}
        hover={view.hover}
        onPick={onPick}
        onHover={onHover}
      />
    ),
  };

  const tree = (id: string): TileBody | null => {
    const axis = id === "tree-system" ? "system" : "function";
    const code = board?.trees[axis];
    if (!code || code.by === "mapping") return null;
    return {
      xf: xfMark(xf, id),
      label: t(treeTitle(code), lang),
      head: (
        <MeasureSwitch
          tree={code}
          measures={board?.measures}
          progress={model.measureProgress}
          measure={measure[axis]}
          onMeasure={(m) => onMeasure(axis, m)}
          lang={lang}
        />
      ),
      body: (
        <CodeTreemap
          tree={code}
          measure={measure[axis]}
          measures={board?.measures}
          iso={isoOf(xf, id)}
          lit={xfMark(xf, id) === "origin" ? xf.matched : null}
          quantities={model.elementQuantities?.byGuid}
          {...door(id)}
        />
      ),
    };
  };

  // The tile the checks are drawn in: their own, or the one they are a tab of.
  const checksHost = layout.tiles.find((t) => t.id === "checks" || t.tabs.includes("checks"));
  const checksPx = checksHost ? checksHost.w * layout.u + (checksHost.w - 1) * MG_GAP : Infinity;
  const checks: TileBody = {
    ...whole("checks"),
    label: t("tile.verify", lang),
    body: (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Checks {...props} counts={countsInList} compact={checksPx < 400} />
      </div>
    ),
  };

  return (id: string): TileBody | null => {
    if (id === "viewer") return viewer;
    if (id === "scope")
      return {
        bare: true,
        empty: !props.scope,
        label: t("tile.scope", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="scope">{props.scope}</div>,
      };
    if (id === "detail")
      return {
        bare: true,
        empty: !props.detail,
        label: t("tile.detail", lang),
        body: <div className="alt-dock flex min-h-0 flex-1 flex-col" data-dock="detail">{props.detail}</div>,
      };
    if (id === "tree-system" || id === "tree-function") return tree(id);
    if (id === "checks") return checks;
    if (id === "floors") return floorsBody(props);
    const count = /^count(\d+)$/.exec(id);
    if (count) {
      const card = counts[Number(count[1])];
      return card ? { ...whole("counts"), bare: true, label: card.label, body: <CountTile card={card} /> } : null;
    }
    const kpi = /^ifc(\d+)$/.exec(id);
    if (kpi) {
      const req = reqs[Number(kpi[1])];
      return req ? { ...whole("reqs"), bare: true, label: t(req.label, lang), body: <ReqCard req={req} {...door("reqs")} /> } : null;
    }
    // The narrow fallback: the IFC-struktur requirements as one list.
    if (id === "reqs") {
      return {
        ...whole("reqs"),
        label: t("req.group.ifc", lang),
        body: (
          <div className="alt-list flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
            {reqs.map((req, i) => (
              <ReqBlock key={req.key} req={req} index={i + 1} {...door("reqs")} />
            ))}
          </div>
        ),
      };
    }
    return null;
  };
}

/** The floor sidebar: the config floors against every loaded model, or the
 *  file's own storeys when no config is loaded (the bento board's Etasjer
 *  tile, the same two components). */
function floorsBody({ lang, model, census, scopedCensus, floors, peers, selected, onFocus, xf }: AltBoardProps): TileBody {
  const configured = !!floors && floors.length > 0;
  const extra = configured
    ? peers.reduce(
        (sum, peer) =>
          sum +
          (peer.unitResolved ? matchStoreys(peer.storeys, peer.unitScale, floors!).filter((m) => m.config === null).length : 0),
        0,
      )
    : 0;
  const open = (focus: Focus) => onFocus(focus, "floors");
  // Isolating: only the storeys that hold a matching element.
  const keep = scopedCensus ? new Set(scopedCensus.storeys.filter((s) => s.elements > 0).map((s) => s.guid)) : null;
  return {
    xf: xfMark(xf, "floors"),
    label: t("tile.storeys", lang),
    sub: configured
      ? `${formatCount(floors!.length, lang)} × ${formatCount(peers.length, lang)}` + (extra > 0 ? ` · +${formatCount(extra, lang)}` : "")
      : formatCount(census.storeys.length, lang),
    body: configured ? (
      <FloorSetupMatrix lang={lang} config={floors!} peers={peers} selected={selected} onFocus={open} keep={keep} />
    ) : (
      <StoreyList
        lang={lang}
        storeys={scopedCensus ? scopedCensus.storeys.filter((s) => s.elements > 0) : census.storeys}
        summary={model.report!.summary}
        selected={selected}
        onFocus={open}
      />
    ),
  };
}

/** One neutral count, one fact, an S tile. */
function CountTile({ card }: { card: KpiCard }) {
  return (
    <div className="alt-stat alt-sized flex h-full min-h-0 min-w-0 flex-col gap-2 px-3 py-2.5">
      <span className="alt-label break-words" title={card.label}>
        {card.label}
      </span>
      <span data-essential className="alt-figure alt-figure-count my-auto font-mono leading-none font-semibold whitespace-nowrap tabular-nums">
        {card.value}
      </span>
    </div>
  );
}

/** The checks the engine runs on every model that no requirement already
 *  shows: the fundamentals, with their own verdicts. No project rule speaks
 *  for them here and none is listed (that is the project tab). Then the
 *  neutral counts that are not tiles of their own. */
function Checks(props: AltBoardProps & { counts: KpiCard[]; compact: boolean }) {
  const { lang, model, selected, onFocus, counts, compact } = props;
  const report = model.report!;
  // Every requirement's rows, Standardkrav's too: those are the project
  // tab's, so they are not repeated here as checks.
  const shown = requirementRowIds(requirements(model.board?.rows));
  const rest = report.checks.filter((c) => !shown.has(c.id));
  const none = useMemo(() => new Map(), []);
  return (
    <div className="flex shrink-0 flex-col">
      <div className="flex shrink-0 flex-col">
        <Verification
          lang={lang}
          checks={rest}
          claimed={none}
          selected={selected}
          onFocus={(focus) => onFocus(focus, "checks")}
          fill
          compact={compact}
        />
      </div>
      {counts.length > 0 ? <div className="alt-group-rule shrink-0" /> : null}
      {counts.map((card: KpiCard) => (
        <div key={card.key} className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
          <span className="alt-label whitespace-nowrap">{card.label}</span>
          <span data-essential className="ml-auto font-mono text-[13px] font-semibold whitespace-nowrap tabular-nums">
            {card.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── kept, off the main dash ───────────────────────────────────────────────
 *
 * The per-storey and per-class small multiple and the chain as a line of
 * lamps, which c and b drew until 2026-09-25. The storey and class views
 * left the main dash for the report's requirements (the owner: *"I dont
 * understand the obsession with floor vs ifcclass"*); Innhold keeps Klasser
 * and Etasje × klasse. */

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
