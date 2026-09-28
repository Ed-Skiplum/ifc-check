/** One model's board — an instance of the house bento grid.
 *
 * The lead is a VERIFICATION block, not an info page. edkjo: *"the first page
 * needs to be a verification page, not an 'info page'. Showing a quantity
 * takeoff of how many elements there are of different types, great, but gives
 * no feedback."*
 *
 * ── What is judged here, and what is not ─────────────────────────────────
 * The line is universal vs project, not facts vs verdicts:
 *
 *   universal   judged on sight, no ruleset. Three storeys all at kote 0, a
 *               duplicate GlobalId, an unresolved length unit, elements
 *               outside the spatial tree, a broken Project→Site→Building→
 *               Storey chain. Wrong on any project, so the board says so.
 *   project     MMI, classification codes, naming conventions, required
 *               property sets. These wait for the ruleset; once one is
 *               loaded its rules are rows under "Regler" in the same focal.
 *
 * A universal verdict is still not a grade: there is no composite number, and
 * no verdict is rendered at element granularity. "851 elements have no name"
 * is ONE row reading `0 av 851`; the 851 rows live behind the drill-in.
 *
 * ── The grid ─────────────────────────────────────────────────────────────
 * `BentoGrid` + `bento-spec` + `useBentoCols`, mirrored from sprucelab —
 * *"every DASHBOARD is an instance of ONE grid"*, *"copy one, never a new
 * grid"*. Two authored layouts, chosen by the GRID's own inline size, so an
 * iframe on skiplum.com picks the layout its own box can carry. This module
 * authors tiles; it does not author tiling.
 *
 * This is the Kontroll tab (2026-09-21): lead values and outputs only. The
 * census and the type ledger are on the Innhold tab (`Contents.tsx`), and the
 * file's own facts are on the panel header.
 */

import { useMemo } from "react";
import type { ModelResult, RuleResult } from "../ids/evaluate.ts";
import type { BentoCols, BentoTileSpec } from "./bento-spec";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Census } from "./profile";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { BentoGrid } from "./BentoGrid";
import { LAYOUT_13, LAYOUT_21 } from "./bento-layouts";
import { boardCards, chainLevels, claimedChecks } from "./board-data";
import { useBentoCols } from "./useBentoCols";
import { Verification } from "./Verification";
import type { ModelView, Origin } from "./cross-filter";
import { isoOf, type Xf } from "./origins";
import { ViewerTile } from "../viewer/ViewerTile";
import { ClassDistribution, KpiRow, SpatialGauge } from "./forms";
import { formatCount } from "./format";
import { matchStoreys, type FloorConfig } from "../engine/storey-config";
import { FloorSetupMatrix, StoreyList, type FloorPeer } from "./FloorSetup";
import type { ReactNode } from "react";
import type { Design } from "./useHashView";
import { AltBoard } from "./alt/AltBoard";

interface DashboardProps {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  /** The census over the filter's elements, when the floor sidebar isolates. */
  scopedCensus?: Census | null;
  claims: KpiClaims;
  selected: string | null;
  /** A click on a board number, and the view it came from. */
  onFocus: (focus: Focus, origin: Origin) => void;
  /** Cross-filter and selection state for THIS model. The board does not own
   *  it — the same state drives the derivation band below the grid, which is
   *  what makes row and mesh two views of one selection. */
  view: ModelView;
  /** The one filter: its origin and the elements it resolves to. */
  xf: Xf;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  floors: FloorConfig[] | null;
  /** Every loaded model's storeys, this model first. */
  peers: FloorPeer[];
  /** Only when a ruleset is loaded; see `Verification`. */
  rules?: { evaluation?: ModelResult; evaluating?: boolean; error?: string };
  /** A design alternative (`#design=a|b|c`) replaces the bento board with its
   *  own layout on the module grid (`alt/AltBoard.tsx`). Absent: the bento
   *  board, untouched. */
  design?: Design | null;
  /** The design alternatives only: the Scope and Detail panels, docked on
   *  the board (`alt/AltBoard.tsx`). */
  scope?: ReactNode;
  detail?: ReactNode;
}

export function Dashboard({
  lang,
  model,
  census,
  scopedCensus,
  claims,
  selected,
  onFocus,
  view,
  xf,
  onPick,
  onHover,
  floors,
  peers,
  rules,
  design,
  scope,
  detail,
}: DashboardProps) {
  // The bento board (no design) is not mounted since b became the only
  // version; it reads the filter as one origin all the same.
  const matched = isoOf(xf, "viewer");
  const bentoFocus = (focus: Focus) => onFocus(focus, "checks");
  const { ref, cols, space } = useBentoCols();
  const report = model.report;
  const profile = model.profile;
  const results = model.evaluation?.results;

  const claimed = useMemo(() => claimedChecks(claims, results), [claims, results]);

  // The grid needs its own box measured before it can choose a layout, so the
  // measured element renders on the first pass and the canvas on the second.
  // `useBentoCols` measures in a layout effect, so that happens before paint.
  const tiles: BentoTileSpec[] | null =
    report && profile && cols
      ? buildTiles({
          cols,
          lang,
          model,
          census,
          claimed,
          selected,
          onFocus: bentoFocus,
          view,
          matched,
          onPick,
          onHover,
          floors,
          peers,
          rules,
        })
      : null;

  if (design && report && profile) {
    return (
      <AltBoard
        design={design}
        lang={lang}
        model={model}
        claims={claims}
        selected={selected}
        onFocus={onFocus}
        view={view}
        xf={xf}
        onPick={onPick}
        onHover={onHover}
        rules={rules}
        scope={scope ?? null}
        detail={detail ?? null}
        census={census}
        scopedCensus={scopedCensus ?? null}
        floors={floors}
        peers={peers}
      />
    );
  }

  return (
    // The bento canvas measures its own width (`container-type: inline-size`)
    // and takes its height from its rows; the page scrolls, the tiles do not
    // shrink to fit the screen. `space` is the one thing measured in JS: how
    // much page is left under this board, which the grid may spend on taller
    // rows but never on shorter ones.
    <div ref={ref} className="w-full min-w-0">
      {tiles && cols ? (
        <BentoGrid definition={cols === 21 ? LAYOUT_21 : LAYOUT_13} tiles={tiles} space={space} />
      ) : null}
    </div>
  );
}

interface BuildArgs {
  cols: BentoCols;
  lang: Lang;
  model: ModelEntry;
  census: Census;
  claimed: Map<string, RuleResult>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  view: ModelView;
  matched: Set<string> | null;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  floors: FloorConfig[] | null;
  peers: FloorPeer[];
  rules?: DashboardProps["rules"];
}

/** One builder per tile, as the three sprucelab instances do it: the page owns
 *  what a click means, the tile only says which door it is. */
function buildTiles({
  cols,
  lang,
  model,
  census,
  claimed,
  selected,
  onFocus,
  view,
  matched,
  onPick,
  onHover,
  floors,
  peers,
  rules,
}: BuildArgs): BentoTileSpec[] {
  const report = model.report!;
  const profile = model.profile!;
  const summary = report.summary;
  const wide = cols === 21;
  const configured = !!floors && floors.length > 0;
  // File storeys, over every loaded model, that match no config floor: the
  // rows under the floor tile's divider.
  const extra = configured
    ? peers.reduce(
        (sum, peer) =>
          sum +
          (peer.unitResolved
            ? matchStoreys(peer.storeys, peer.unitScale, floors!).filter((m) => m.config === null)
                .length
            : 0),
        0,
      )
    : 0;

  const { verdictCards, countCards } = boardCards(model, lang);

  // 21 tracks only: the class bars, 5×2 beside the 3×2 spatial lamps under
  // the floor tile (2026-09-25; it was 3×3 beside a 5×3 gauge). A board with a
  // hole in it reads as a void (edkjo, "bento box, not a matrix": the tiles
  // close), and this is the tile whose kind owns the span. It is on the
  // Innhold tab as well, as upstream scales up by making more tiles visible.
  const classes: BentoTileSpec[] = wide
    ? [
        {
          id: "classes",
          kind: "distribution",
          priority: "P1",
          span: { w: 5, h: 2 },
          label: t("tile.classes", lang),
          sub: formatCount(census.classes.length, lang),
          body: (
            <ClassDistribution
              lang={lang}
              classes={census.classes}
              selected={selected}
              onFocus={onFocus}
            />
          ),
        },
      ]
    : [];

  return [
    ...classes,
    {
      // A 1-row strip on the LAST row, 13 tracks (21 on the wide board): the four
      // neutral counts. `tellTales` is the registry's strip kind (13×1
      // upstream too); the grid has no KPI-row kind, so the cards are cells of
      // this one tile. Quiet: no verdict colour and a small numeral, because a
      // file size or a material count is reference, not a finding. P2, and on
      // 13 tracks the one row past the fold.
      id: "kpis",
      kind: "tellTales",
      priority: "P2",
      span: { w: wide ? 21 : 13, h: 1 },
      body: <KpiRow cards={countCards} selected={selected} onFocus={onFocus} quiet />,
    },
    {
      id: "verify",
      kind: "tellTales",
      priority: "P0",
      span: { w: 8, h: 5 },
      label: t("tile.verify", lang),
      sub: formatCount(summary.products, lang),
      body: (
        <Verification
          lang={lang}
          checks={report.checks}
          claimed={claimed}
          selected={selected}
          onFocus={onFocus}
          rules={rules}
          readouts={
            <KpiRow cards={verdictCards} selected={selected} onFocus={onFocus} stacked />
          }
        />
      ),
    },
    {
      // The MODEL, beside the focal. A tile, never a mode: 3D is folded into
      // the board that already exists, and what narrows the tables narrows it
      // too. It is P0 because it is the second thing read, not because it is
      // the second-largest — the span is what makes it the latter.
      id: "viewer",
      kind: "viewer",
      priority: "P0",
      span: { w: 5, h: 5 },
      label: t("tile.viewer", lang),
      sub: model.meshBudget
        ? `${formatCount(model.meshBudget.triangles, lang)} tri`
        : undefined,
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
    },
    {
      id: "spatial",
      kind: "gauge",
      // edkjo 2026-09-25: "this does not deserve this much space". Compact
      // 3×2 on 21 tracks (about 1.5 : 1, not a strip). 13 tracks has no
      // closed board with it smaller than 5×3; see `bento-layouts.ts`.
      // Rows 6–8 on 13 tracks, 4–5 on 21: inside the fold on both boards.
      priority: "P1",
      span: wide ? { w: 3, h: 2 } : { w: 5, h: 3 },
      label: t("tile.spatial", lang),
      body: <SpatialGauge lang={lang} levels={chainLevels(profile)} />,
      click: {
        drill: {
          label: t("check.spatial-chain", lang),
          run: () => onFocus({ kind: "check", checkId: "spatial-chain" }),
        },
      },
    },
    {
      // THE floor tile: the config floors against every loaded model, or the
      // file's own storeys when no config is loaded. It replaced both the
      // storey roster and the storey × class matrix on this tab; the census
      // is "Etasje × klasse" on Innhold.
      id: "floors",
      kind: "roster",
      priority: "P1",
      span: { w: 8, h: 3 },
      label: t("tile.storeys", lang),
      sub: configured
        ? `${formatCount(floors!.length, lang)} × ${formatCount(peers.length, lang)}` +
          (extra > 0 ? ` · +${formatCount(extra, lang)}` : "")
        : formatCount(census.storeys.length, lang),
      body: configured ? (
        <FloorSetupMatrix
          lang={lang}
          config={floors!}
          peers={peers}
          selected={selected}
          onFocus={onFocus}
        />
      ) : (
        <StoreyList
          lang={lang}
          storeys={census.storeys}
          summary={summary}
          selected={selected}
          onFocus={onFocus}
        />
      ),
      click: {
        drill: {
          label: t("kpi.storeys", lang),
          run: () => onFocus({ kind: "kpi", kpi: "storeys" }),
        },
      },
    },
  ];
}
