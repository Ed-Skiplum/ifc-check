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
import type { Lang, StringKey } from "./i18n";
import { t } from "./i18n";
import { BentoGrid } from "./BentoGrid";
import { LAYOUT_13, LAYOUT_21 } from "./bento-layouts";
import { useBentoCols } from "./useBentoCols";
import { Verification } from "./Verification";
import type { ModelView } from "./cross-filter";
import { ViewerTile } from "../viewer/ViewerTile";
import { ClassDistribution, KpiRow, type KpiCard, SpatialGauge } from "./forms";
import { formatBytes, formatCount } from "./format";
import { verdictOf } from "../engine/fundamentals";
import { modelKpis } from "../engine/kpis";
import { matchStoreys, type FloorConfig } from "../engine/storey-config";
import { FloorSetupMatrix, StoreyList, type FloorPeer } from "./FloorSetup";

interface DashboardProps {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  /** Cross-filter and selection state for THIS model. The board does not own
   *  it — the same state drives the derivation band below the grid, which is
   *  what makes row and mesh two views of one selection. */
  view: ModelView;
  /** The elements the active chips resolve to. `null` = no filter; an EMPTY
   *  set is a filter that matched nothing and draws an empty scene. */
  matched: Set<string> | null;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  floors: FloorConfig[] | null;
  /** Every loaded model's storeys, this model first. */
  peers: FloorPeer[];
  /** Only when a ruleset is loaded; see `Verification`. */
  rules?: { evaluation?: ModelResult; evaluating?: boolean; error?: string };
}

/** A project rule that speaks for a universal check. The same number reads
 *  differently once something states what right looks like: `0 / 851 typed` is
 *  a fact about the file until a rule claims it, and then it is that rule's
 *  verdict and drills into that rule's derivation. */
function claimedChecks(
  claims: KpiClaims,
  results: RuleResult[] | undefined,
): Map<string, RuleResult> {
  const map = new Map<string, RuleResult>();
  const find = (id: string | undefined) => (id ? results?.find((r) => r.ruleId === id) : undefined);
  const typed = find(claims.typed);
  if (typed) map.set("element-typed", typed);
  const material = find(claims.material);
  if (material) map.set("element-material", material);
  return map;
}

/** The four levels of the chain, in decomposition order. */
function chainLevels(profile: NonNullable<ModelEntry["profile"]>) {
  return [
    { level: "IfcProject", size: profile.spatial.projects },
    { level: "IfcSite", size: profile.spatial.sites },
    { level: "IfcBuilding", size: profile.spatial.buildings },
    { level: "IfcBuildingStorey", size: profile.spatial.storeys },
  ];
}

export function Dashboard({
  lang,
  model,
  census,
  claims,
  selected,
  onFocus,
  view,
  matched,
  onPick,
  onHover,
  floors,
  peers,
  rules,
}: DashboardProps) {
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
          onFocus,
          view,
          matched,
          onPick,
          onHover,
          floors,
          peers,
          rules,
        })
      : null;

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

  // THE KPI ROW. Seven numbers, one each, asked for by name. Three carry the
  // verdict of the check they count and cross-filter to its findings on click;
  // the other four are counts and stay neutral.
  const excluded = model.evaluation?.excludedGuids;
  const kpis = modelKpis({
    summary,
    checks: report.checks,
    sizeBytes: report.sizeBytes,
    storeys: profile.storeys.length,
    products: profile.rows,
    excluded: excluded?.length ? new Set(excluded) : undefined,
  });
  const checkOf = (id: string) => report.checks.find((c) => c.id === id);
  const counted = (key: string, labelKey: StringKey, checkId: string, n: number | null): KpiCard => {
    const check = checkOf(checkId);
    return {
      key,
      label: t(labelKey, lang),
      value: n === null ? "—" : formatCount(n, lang),
      verdict: check ? verdictOf(check) : "na",
      checkId,
      findings: n ?? 0,
    };
  };
  const plain = (key: string, labelKey: StringKey, value: string): KpiCard => ({
    key,
    label: t(labelKey, lang),
    value,
  });
  const kpiCards: KpiCard[] = [
    plain("types", "kpi.types", kpis.types === null ? "—" : formatCount(kpis.types, lang)),
    counted("untyped", "kpi.untyped", "element-typed", kpis.untyped),
    plain("floors", "kpi.storeys", formatCount(kpis.floors, lang)),
    plain("size", "kpi.size", formatBytes(kpis.sizeBytes, lang)),
    plain("materials", "kpi.materials", formatCount(kpis.materials, lang)),
    counted("orphans", "kpi.orphans", "storey-containment", kpis.orphans),
    counted("placement", "kpi.placement", "mesh-placement", kpis.placement),
  ];

  // 21 tracks only: the class bars. Beside a 5-wide model and a 5-wide gauge
  // the only legal cut left is 3 tracks, and a board with a 3×5 hole in it
  // reads as a void (edkjo, "bento box, not a matrix": the tiles close). The
  // Klasser distribution is the tile whose kind owns 3×3; it is on the
  // Innhold tab as well, as upstream scales up by making more tiles visible.
  const classes: BentoTileSpec[] = wide
    ? [
        {
          id: "classes",
          kind: "distribution",
          priority: "P1",
          span: { w: 3, h: 3 },
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
      // A 1-row strip, 13 tracks on BOTH boards. `tellTales` is the registry's
      // strip kind (13×1 upstream too); the grid has no KPI-row kind, and
      // seven tiles cannot share one band (at most four band cuts per row), so
      // the seven cards are cells of this one tile. On 21 tracks the strip
      // gives up the other eight tracks of row 1 to the Etasjer tile, which is
      // what buys that tile its third row — see `bento-layouts.ts`.
      id: "kpis",
      kind: "tellTales",
      priority: "P0",
      span: { w: 13, h: 1 },
      body: <KpiRow cards={kpiCards} selected={selected} onFocus={onFocus} />,
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
      // P2 on 13 tracks: that board is 9 rows against an 8-row fold and the
      // gauge ends on row 9, where only P2 may sit.
      priority: wide ? "P0" : "P2",
      span: { w: 5, h: 3 },
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
      priority: wide ? "P1" : "P2",
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
