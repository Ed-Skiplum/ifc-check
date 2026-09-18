/** What the file IS, as a tile grid.
 *
 * Facts, not verdicts. `typed 0 / 851` is a number about the model here, and it
 * stays neutral until a loaded ruleset claims it — a work model has no types
 * because it is a work model, not because it failed a requirement nobody
 * stated. The only red on this grid is a parse fault the file carries in
 * itself: an unresolved length unit, duplicate STEP ids.
 *
 * Every number with rows behind it opens them in the band below. The tile does
 * not expand.
 */

import type { CheckResult } from "../engine/types";
import type { RuleResult } from "../ids/evaluate.ts";
import type { KpiClaims } from "./claims";
import type { ModelEntry } from "./useModels";
import type { Census } from "./profile";
import type { Focus } from "./trace";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatBytes, formatCount, formatElevation, formatMs, formatShare } from "./format";
import { FloorMatrix } from "./FloorMatrix";
import { KpiTile, Tile, WideTile } from "./Tiles";

/** The grid module. Column and row are fixed; a tile spans whole modules, so
 *  tile sizes stand in golden-section-ish relation instead of halves. */
const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, 12rem)",
  gridAutoRows: "4.5rem",
  gap: "0.75rem",
  justifyContent: "start",
} as const;

interface DashboardProps {
  lang: Lang;
  model: ModelEntry;
  census: Census;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}

/** A claimed KPI shows the claiming rule's own arithmetic and verdict, not the
 *  parser's count: the number now belongs to the rule, and drilling it opens
 *  that rule's derivation rather than a bare element list. */
function verdictValue(result: RuleResult, lang: Lang): { value: string; note: string } {
  return {
    value: `${formatCount(Math.max(0, result.applicable - result.failed), lang)} / ${formatCount(result.applicable, lang)}`,
    note: t(`result.${result.state}`, lang),
  };
}

function share(check: CheckResult | undefined, lang: Lang): { value: string; note: string } {
  if (!check) return { value: "—", note: "" };
  const good = Math.max(0, check.applicable - check.findings.length);
  return {
    value: `${formatCount(good, lang)} / ${formatCount(check.applicable, lang)}`,
    note: formatShare(good, check.applicable, lang),
  };
}

export function Dashboard({
  lang,
  model,
  census,
  claims,
  selected,
  onFocus,
}: DashboardProps) {
  const report = model.report;
  const profile = model.profile;
  if (!report || !profile) return null;
  const summary = report.summary;

  const results = model.evaluation?.results;
  const typedRule = claims.typed
    ? results?.find((r) => r.ruleId === claims.typed)
    : undefined;
  const materialRule = claims.material
    ? results?.find((r) => r.ruleId === claims.material)
    : undefined;

  const typed = typedRule
    ? verdictValue(typedRule, lang)
    : share(report.checks.find((c) => c.id === "element-typed"), lang);
  const material = materialRule
    ? verdictValue(materialRule, lang)
    : share(report.checks.find((c) => c.id === "element-material"), lang);

  return (
    <div style={GRID}>
      <KpiTile
        label={t("kpi.products", lang)}
        value={formatCount(summary.products, lang)}
        onOpen={() => onFocus({ kind: "kpi", kpi: "products" })}
        selected={selected === "kpi:products"}
      />
      <KpiTile
        label={t("kpi.storeys", lang)}
        value={formatCount(census.storeys.length, lang)}
        onOpen={() => onFocus({ kind: "kpi", kpi: "storeys" })}
        selected={selected === "kpi:storeys"}
      />
      <KpiTile
        label={t("kpi.classes", lang)}
        value={formatCount(census.classes.length, lang)}
      />
      <KpiTile
        label={t("kpi.typed", lang)}
        value={typed.value}
        note={typed.note}
        verdict={typedRule?.state}
        onOpen={() =>
          onFocus(
            typedRule
              ? { kind: "rule", ruleId: typedRule.ruleId }
              : { kind: "kpi", kpi: "typed" },
          )
        }
        selected={selected === (typedRule ? `rule:${typedRule.ruleId}` : "kpi:typed")}
      />
      <KpiTile
        label={t("kpi.material", lang)}
        value={material.value}
        note={material.note}
        verdict={materialRule?.state}
        onOpen={() =>
          onFocus(
            materialRule
              ? { kind: "rule", ruleId: materialRule.ruleId }
              : { kind: "kpi", kpi: "material" },
          )
        }
        selected={selected === (materialRule ? `rule:${materialRule.ruleId}` : "kpi:material")}
      />
      <KpiTile label={t("kpi.schema", lang)} value={summary.schema} />
      <KpiTile
        label={t("kpi.unit", lang)}
        value={summary.length_unit}
        note={summary.unit_resolved ? undefined : t("kpi.unresolved", lang)}
        alarm={!summary.unit_resolved}
      />
      <KpiTile
        label={t("kpi.duplicateStepIds", lang)}
        value={formatCount(summary.duplicate_step_ids, lang)}
        alarm={summary.duplicate_step_ids > 0}
      />
      <KpiTile label={t("kpi.size", lang)} value={formatBytes(report.sizeBytes, lang)} />
      <KpiTile label={t("kpi.parseTime", lang)} value={formatMs(report.parseMs, lang)} />
      <KpiTile
        label={t("kpi.application", lang)}
        value={summary.authoring_app ?? "—"}
        span={[2, 1]}
        text
      />
      <KpiTile
        label={t("kpi.project", lang)}
        value={summary.project_name ?? "—"}
        span={[2, 1]}
        text
      />

      <Tile
        label={t("tile.classes", lang)}
        span={[2, 3]}
        aside={formatCount(census.classes.length, lang)}
      >
        <div className="min-h-0 flex-1 overflow-auto bg-input">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                  {t("col.class", lang)}
                </th>
                <th className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-right text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                  {t("col.count", lang)}
                </th>
              </tr>
            </thead>
            <tbody>
              {census.classes.map((klass) => (
                <tr key={klass.entity}>
                  <td colSpan={2} className="p-0">
                    <button
                      type="button"
                      onClick={() => onFocus({ kind: "class", entity: klass.entity })}
                      className={
                        "flex h-6 w-full items-center justify-between gap-2 border-b border-line px-2 text-left hover:bg-palegreen " +
                        (selected === `class:${klass.entity}`
                          ? "outline-2 -outline-offset-2 outline-ink"
                          : "")
                      }
                    >
                      <span className="truncate font-mono text-[11px] text-ink">
                        {klass.entity}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">
                        {formatCount(klass.count, lang)}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile
        label={t("tile.storeys", lang)}
        span={[3, 3]}
        aside={formatCount(census.storeys.length, lang)}
      >
        <div className="min-h-0 flex-1 overflow-auto bg-input">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                  {t("col.name", lang)}
                </th>
                <th className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-right text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                  {t("col.elevation", lang)}
                </th>
                <th className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-right text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                  {t("col.elements", lang)}
                </th>
              </tr>
            </thead>
            <tbody>
              {census.storeys.map((storey) => (
                <tr key={storey.guid}>
                  {/* A storey with no name falls back to its GlobalId, which
                      is never truncated — so it renders mono and full. */}
                  <td
                    onDoubleClick={copyOnDoubleClick(storey.name ?? storey.guid)}
                    title={storey.name ?? undefined}
                    className={
                      "h-6 cursor-copy border-b border-line px-2 text-[12px] text-ink " +
                      (storey.name === null ? "font-mono text-[11px]" : "max-w-0 truncate")
                    }
                  >
                    {storey.name ?? storey.guid}
                  </td>
                  <td className="h-6 border-b border-line p-0 text-right">
                    {storey.sharedWith > 1 ? (
                      // Several storeys at one elevation: the storeys carry no
                      // height information. Whole cell, a glyph, and the count.
                      <span
                        title={t("storey.shared", lang)}
                        className="flex h-6 items-center justify-end gap-1.5 bg-gold px-2 font-mono text-[11px] tabular-nums text-ink"
                      >
                        <span className="font-bold">!</span>
                        {formatElevation(
                          storey.elevation,
                          summary.unit_scale,
                          summary.unit_resolved,
                          lang,
                        )}
                        <span className="font-semibold">×{storey.sharedWith}</span>
                      </span>
                    ) : (
                      <span className="block px-2 font-mono text-[11px] tabular-nums text-ink">
                        {formatElevation(
                          storey.elevation,
                          summary.unit_scale,
                          summary.unit_resolved,
                          lang,
                        )}
                      </span>
                    )}
                  </td>
                  <td className="h-6 border-b border-line px-2 text-right font-mono text-[11px] tabular-nums text-ink">
                    {formatCount(storey.elements, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <WideTile
        label={t("tile.floorMatrix", lang)}
        rows={5}
        aside={`${formatCount(census.storeys.length, lang)} × ${formatCount(census.classes.length, lang)}`}
      >
        <FloorMatrix
          lang={lang}
          classes={census.classes}
          matrix={census.matrix}
          storeys={census.storeys}
          peak={census.matrixPeak}
          selected={selected}
          onOpen={(storeyGuid, entity) => onFocus({ kind: "cell", storeyGuid, entity })}
        />
      </WideTile>
    </div>
  );
}
