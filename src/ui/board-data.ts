/** The board's numbers, shared by the bento board (`Dashboard.tsx`) and the
 *  design alternatives (`alt/AltBoard.tsx`), so the two cannot drift. */

import type { RuleResult } from "../ids/evaluate.ts";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Lang, StringKey } from "./i18n";
import type { KpiCard } from "./forms";
import { t } from "./i18n";
import { formatBytes, formatCount } from "./format";
import { verdictOf } from "../engine/fundamentals";
import { modelKpis } from "../engine/kpis";

/** A project rule that speaks for a universal check. The same number reads
 *  differently once something states what right looks like: `0 / 851 typed` is
 *  a fact about the file until a rule claims it, and then it is that rule's
 *  verdict and drills into that rule's derivation. */
export function claimedChecks(
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
export function chainLevels(profile: NonNullable<ModelEntry["profile"]>) {
  return [
    { level: "IfcProject", size: profile.spatial.projects },
    { level: "IfcSite", size: profile.spatial.sites },
    { level: "IfcBuilding", size: profile.spatial.buildings },
    { level: "IfcBuildingStorey", size: profile.spatial.storeys },
  ];
}

/** The seven KPI numbers as cards, in the two kinds the board shows them as:
 *  the three FINDING counts (verdict-coloured, cross-filter to their check)
 *  and the four NEUTRAL counts. Shared by the bento board and the design
 *  alternatives (`AltBoard.tsx`), so the numbers cannot drift between them. */
export function boardCards(
  model: ModelEntry,
  lang: Lang,
): { verdictCards: KpiCard[]; countCards: KpiCard[] } {
  const report = model.report!;
  const profile = model.profile!;
  const summary = report.summary;
  // THE KPI NUMBERS. Seven, one each, asked for by name. Three carry the
  // verdict of the check they count and cross-filter to its findings on click;
  // the other four are counts and stay neutral. Since 2026-09-24 the two kinds
  // sit apart: the three verdicts inside the focal, beside the rows they
  // count, as the board's only large coloured numerals; the four counts in the
  // quiet strip on the last row (`bento-layouts.ts`).
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
  // In the focal, in the order the focal lists the checks they count, so the
  // eye reads the rows and the numbers top to bottom in one direction.
  const verdictCards: KpiCard[] = [
    counted("orphans", "kpi.orphans", "storey-containment", kpis.orphans),
    counted("untyped", "kpi.untyped", "element-typed", kpis.untyped),
    counted("placement", "kpi.placement", "mesh-placement", kpis.placement),
  ];
  const countCards: KpiCard[] = [
    // USED of DECLARED, and the label says which is which. One number here was
    // the declared count while the type ledger counted distinct type NAMES, so
    // the board carried two "types" figures that could not be reconciled from
    // the screen. The ledger's foot now prints all three against each other.
    plain(
      "types",
      "kpi.types",
      kpis.typesDeclared === null
        ? "—"
        : `${kpis.typesUsed === null ? "—" : formatCount(kpis.typesUsed, lang)} / ${formatCount(kpis.typesDeclared, lang)}`,
    ),
    plain("floors", "kpi.storeys", formatCount(kpis.floors, lang)),
    plain("size", "kpi.size", formatBytes(kpis.sizeBytes, lang)),
    plain("materials", "kpi.materials", formatCount(kpis.materials, lang)),
  ];

  return { verdictCards, countCards };
}

