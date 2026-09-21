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
 *               property sets. These wait for the ruleset, in the rule strip
 *               below this canvas, and nothing here pre-empts them.
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
 */

import { useMemo } from "react";
import type { CheckResult } from "../engine/types";
import type { RuleResult } from "../ids/evaluate.ts";
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
import { FloorMatrix } from "./FloorMatrix";
import { Verification } from "./Verification";
import type { ModelView } from "./cross-filter";
import { ViewerTile } from "../viewer/ViewerTile";
import {
  ClassDistribution,
  KpiRow,
  type KpiCard,
  ReadoutList,
  SpatialGauge,
  StoreyRoster,
  type Readout,
} from "./forms";
import { formatBytes, formatCount, formatMs } from "./format";
import { aggregateTypes, meshIndex, TypeLedgerTile, type TypeLedger } from "./types";
import { verdictOf } from "../engine/fundamentals";
import { modelKpis } from "../engine/kpis";

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

function containment(checks: CheckResult[]): { good: number; total: number } {
  const check = checks.find((c) => c.id === "storey-containment");
  if (!check) return { good: 0, total: 0 };
  return { good: Math.max(0, check.applicable - check.findings.length), total: check.applicable };
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
}: DashboardProps) {
  const { ref, cols } = useBentoCols();
  const report = model.report;
  const profile = model.profile;
  const results = model.evaluation?.results;

  const claimed = useMemo(() => claimedChecks(claims, results), [claims, results]);

  // One pass over the products per (profile, geometry) change, not per render.
  // Triangles come from the STREAMED mesh, the only place a per-element count
  // exists; batches that have not arrived make the geometry columns UNKNOWN
  // rather than zero.
  const ledger = useMemo(
    () =>
      profile
        ? aggregateTypes(profile, {
            mesh: meshIndex(model.meshBatches),
            meshCapped: model.meshBudget?.capped ?? false,
          })
        : null,
    [profile, model.meshBatches, model.meshBudget],
  );

  // The grid needs its own box measured before it can choose a layout, so the
  // measured element renders on the first pass and the canvas on the second.
  // `useBentoCols` measures in a layout effect, so that happens before paint.
  const tiles: BentoTileSpec[] | null =
    report && profile && ledger && cols
      ? buildTiles({
          cols,
          lang,
          model,
          census,
          ledger,
          claimed,
          selected,
          onFocus,
          view,
          matched,
          onPick,
          onHover,
        })
      : null;

  return (
    // The bento canvas carries `container-type: size`, so it takes its height
    // from here and never from its content. This chain is what makes the grid
    // fit the box instead of running off the bottom of it.
    <div ref={ref} className="min-h-0 w-full min-w-0 flex-1">
      {tiles && cols ? (
        <BentoGrid definition={cols === 21 ? LAYOUT_21 : LAYOUT_13} tiles={tiles} />
      ) : null}
    </div>
  );
}

interface BuildArgs {
  cols: BentoCols;
  lang: Lang;
  model: ModelEntry;
  census: Census;
  ledger: TypeLedger;
  claimed: Map<string, RuleResult>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  view: ModelView;
  matched: Set<string> | null;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
}

/** One builder per tile, as the three sprucelab instances do it: the page owns
 *  what a click means, the tile only says which door it is. */
function buildTiles({
  cols,
  lang,
  model,
  census,
  ledger,
  claimed,
  selected,
  onFocus,
  view,
  matched,
  onPick,
  onHover,
}: BuildArgs): BentoTileSpec[] {
  const report = model.report!;
  const profile = model.profile!;
  const summary = report.summary;
  const wide = cols === 21;

  // ONE tile answers "what is this file". It was two — `file` and `project`,
  // each an 8×2 readout carrying between two and five short values, and
  // `project` repeated its own header, `kpi.project`, as its first row. A tile
  // header is a NAME, so the row went and the two strings the file names
  // itself by moved in here beside the file's own facts. Seven short values
  // earn ONE compact tile; harmonic size is earned by content, and 8×2 for
  // this is 4:1 against `readout`'s own 3.0 ceiling twice over.
  const fileItems: Readout[] = [
    { label: t("kpi.products", lang), value: formatCount(summary.products, lang) },
    { label: t("kpi.schema", lang), value: summary.schema },
    { label: t("kpi.unit", lang), value: summary.length_unit || "—" },
    { label: t("kpi.size", lang), value: formatBytes(report.sizeBytes, lang) },
    { label: t("kpi.parseTime", lang), value: formatMs(report.parseMs, lang) },
    { label: t("kpi.project", lang), value: summary.project_name ?? "—", text: true },
    { label: t("kpi.application", lang), value: summary.authoring_app ?? "—", text: true },
  ];

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

  return [
    {
      // A 1-row strip across the whole canvas, above the focal. `tellTales`
      // is the registry's strip kind (13×1 / 21×1 upstream too); the grid has
      // no KPI-row kind, and seven tiles cannot share one band (at most four
      // band cuts per row), so the seven cards are cells of this one tile.
      id: "kpis",
      kind: "tellTales",
      priority: "P0",
      span: { w: wide ? 21 : 13, h: 1 },
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
      // P2 on 13 tracks: the KPI row took the first row, and the gauge now
      // ends on row 9, past that canvas's 8-row fold, where only P2 may sit.
      priority: wide ? "P0" : "P2",
      span: { w: 5, h: 3 },
      label: t("tile.spatial", lang),
      body: (
        <SpatialGauge
          lang={lang}
          levels={chainLevels(profile)}
          contained={containment(report.checks)}
          onFocus={onFocus}
        />
      ),
      click: {
        drill: {
          label: t("check.spatial-chain", lang),
          run: () => onFocus({ kind: "check", checkId: "spatial-chain" }),
        },
      },
    },
    {
      id: "file",
      kind: "readout",
      // Below the fold on 13 tracks: the fold there is 8 rows, and the focal,
      // the model and the gauge fill it. The file's own facts are context, and
      // context is what goes under the line.
      //
      // COMPACT, and now 3×2 on BOTH canvases. `ReadoutList` flows its pairs
      // into `auto-fit` columns of 9ch, so seven values fill a 3×2 in two or
      // three columns at 1.5:1 / 1.58:1 against `readout`'s 0.8..3.0. On 13
      // tracks it took the 5 tracks beside the storeys and left a 3×2 notch of
      // air at the left edge; it now sits IN that notch and the 5 tracks it
      // vacated carry the type ledger. Same tile, same content, no new rows.
      priority: "P2",
      span: { w: 3, h: 2 },
      label: t("tile.file", lang),
      body: <ReadoutList items={fileItems} />,
      click: {
        drill: {
          label: t("kpi.products", lang),
          run: () => onFocus({ kind: "kpi", kpi: "products" }),
        },
      },
    },
    {
      id: "classes",
      kind: "distribution",
      // Same as the gauge: past the 13-track fold once the KPI row is on top.
      priority: wide ? "P1" : "P2",
      // 8×3 on 13 tracks, where it is the whole left column of the second
      // band. 3×3 on 21, in the narrow column the re-cut top region opened:
      // a bar list is the one form here that degrades into a shorter scroll
      // rather than into an unreadable shape, and 3×3 renders 1.0:1 where the
      // 8×2 it replaces rendered 4.0:1 — inside `distribution`'s own bound for
      // the first time on that canvas.
      span: wide ? { w: 3, h: 3 } : { w: 8, h: 3 },
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
    {
      id: "storeys",
      kind: "roster",
      priority: "P2",
      span: wide ? { w: 8, h: 3 } : { w: 5, h: 2 },
      label: t("tile.storeys", lang),
      sub: formatCount(census.storeys.length, lang),
      body: <StoreyRoster lang={lang} storeys={census.storeys} summary={summary} />,
      click: {
        drill: {
          label: t("kpi.storeys", lang),
          run: () => onFocus({ kind: "kpi", kpi: "storeys" }),
        },
      },
    },
    {
      // THE TYPE LEDGER. Review, not mapping: one row per type, the instances
      // it carries, whether they have geometry, and what they declare — with
      // the single-instance DISPROPORTION at the head, because that is the
      // reading the owner asked for and a count of rows is not it.
      //
      // The tile header's `sub` is the same `singles / types` the focal's
      // `single-instance-types` row prints, by the same arithmetic over the
      // same product set, so the two can never disagree.
      id: "types",
      kind: "roster",
      priority: "P2",
      span: { w: 5, h: 2 },
      label: t("tile.types", lang),
      sub: `${formatCount(ledger.singles, lang)} / ${formatCount(ledger.types, lang)}`,
      body: (
        <TypeLedgerTile
          lang={lang}
          ledger={ledger}
          selected={selected}
          onFocus={onFocus}
        />
      ),
      // A profile that never carried the type facts says so IN ITS OWN SLOT.
      // "This model has no types" and "nobody supplied the type facts" are
      // different answers and only one of them is about the file.
      ...(ledger.factsPresent
        ? {}
        : {
            status: {
              kind: "empty" as const,
              message: `${t("type.facts", lang)} · ${t("type.unavailable", lang)}`,
            },
          }),
    },
    {
      id: "matrix",
      kind: "matrix",
      priority: "P2",
      // 13 tracks wide on both canvases — the full width of the narrow board,
      // and the 13+8 cut of the wide one, where it now runs cols 9..21 with
      // the gauge and the file readout beside it instead of eight tracks of
      // nothing. It renders 4.56:1 / 4.33:1 against `matrix`'s bound, which is
      // why that bound moved to 4.6; see the note at the kind's entry.
      span: { w: 13, h: 3 },
      label: t("tile.floorMatrix", lang),
      sub: `${formatCount(census.storeys.length, lang)} × ${formatCount(census.classes.length, lang)}`,
      body: (
        <FloorMatrix
          lang={lang}
          classes={census.classes}
          matrix={census.matrix}
          storeys={census.storeys}
          peak={census.matrixPeak}
          selected={selected}
          onOpen={(storeyGuid, entity) => onFocus({ kind: "cell", storeyGuid, entity })}
        />
      ),
    },
  ];
}
