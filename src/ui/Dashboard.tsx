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
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { BentoGrid } from "./BentoGrid";
import { LAYOUT_13, LAYOUT_21 } from "./bento-layouts";
import { useBentoCols } from "./useBentoCols";
import { FloorMatrix } from "./FloorMatrix";
import { Verification } from "./Verification";
import {
  ClassDistribution,
  ReadoutList,
  ReadoutStrip,
  SpatialGauge,
  StoreyRoster,
  type Readout,
} from "./forms";
import { formatBytes, formatCount, formatMs } from "./format";

interface DashboardProps {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
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

export function Dashboard({ lang, model, census, claims, selected, onFocus }: DashboardProps) {
  const { ref, cols } = useBentoCols();
  const report = model.report;
  const profile = model.profile;
  const results = model.evaluation?.results;

  const claimed = useMemo(() => claimedChecks(claims, results), [claims, results]);

  // The grid needs its own box measured before it can choose a layout, so the
  // measured element renders on the first pass and the canvas on the second.
  // `useBentoCols` measures in a layout effect, so that happens before paint.
  const tiles: BentoTileSpec[] | null =
    report && profile && cols ? buildTiles({ cols, lang, model, census, claimed, selected, onFocus }) : null;

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
  claimed: Map<string, RuleResult>;
  selected: string | null;
  onFocus: (focus: Focus) => void;
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
}: BuildArgs): BentoTileSpec[] {
  const report = model.report!;
  const profile = model.profile!;
  const summary = report.summary;
  const wide = cols === 21;

  const fileItems: Readout[] = [
    { label: t("kpi.products", lang), value: formatCount(summary.products, lang) },
    { label: t("kpi.schema", lang), value: summary.schema },
    { label: t("kpi.unit", lang), value: summary.length_unit || "—" },
    { label: t("kpi.size", lang), value: formatBytes(report.sizeBytes, lang) },
    { label: t("kpi.parseTime", lang), value: formatMs(report.parseMs, lang) },
  ];

  const projectItems: Readout[] = [
    { label: t("kpi.project", lang), value: summary.project_name ?? "—", text: true },
    { label: t("kpi.application", lang), value: summary.authoring_app ?? "—", text: true },
  ];

  return [
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
      id: "spatial",
      kind: "gauge",
      priority: "P0",
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
      priority: "P1",
      span: { w: 5, h: 2 },
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
      id: "project",
      kind: "readout",
      priority: "P1",
      // A 1-row strip has no header rule, so on 13 tracks the label rides
      // inline and the pairs go on one line. Same content, the shape the span
      // can actually carry.
      span: wide ? { w: 8, h: 2 } : { w: 5, h: 1 },
      label: t("kpi.project", lang),
      body: wide ? <ReadoutList items={projectItems} /> : <ReadoutStrip items={projectItems} />,
    },
    {
      id: "classes",
      kind: "distribution",
      priority: "P1",
      span: { w: 8, h: 3 },
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
      priority: "P1",
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
      id: "matrix",
      kind: "matrix",
      priority: "P2",
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
