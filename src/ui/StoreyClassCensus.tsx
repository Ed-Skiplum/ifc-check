/** Etasje × klasse: storeys down the side, IFC classes across the top,
 *  element counts in the cells — what is on each floor. It lives on the
 *  Innhold tab; how a file stacks up against the config floors is the Etasjer
 *  tile on Kontroll (2026-09-21).
 *
 * Headers are not rotated: the `Ifc` prefix is dropped and the name may wrap
 * at its word humps to two lines, with the full class name in the title. The
 * total column carries the storey's element count.
 *
 * Magnitude is a one-hue ramp from the palette's pale green to its green, on a
 * log scale because element counts per storey are heavily skewed and a linear
 * ramp leaves everything but the largest class flat. The count is printed in
 * every cell, so the colour is a second reading of a number that is already
 * there, never the only one.
 */

import type { ClassCount, MatrixRow, StoreyFact } from "./profile";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";

const LOW = [230, 239, 221] as const; // palegreen #E6EFDD
const HIGH = [44, 94, 63] as const; // green #2C5E3F

/** `IfcBuildingElementProxy` → `Building|Element|Proxy`: no prefix, and a
 *  zero-width break at each hump so a header can wrap to two lines. */
function header(entity: string): string {
  return entity.replace(/^Ifc/i, "").replace(/(?<=[a-z])(?=[A-Z])/g, "\u200B");
}

function ramp(count: number, peak: number): { background: string; color: string } {
  const share = peak <= 1 ? 1 : Math.log1p(count) / Math.log1p(peak);
  const mix = LOW.map((low, i) => Math.round(low + (HIGH[i] - low) * share));
  return {
    background: `rgb(${mix[0]} ${mix[1]} ${mix[2]})`,
    color: share > 0.55 ? "#F4EEDC" : "#23291E",
  };
}

interface StoreyClassCensusProps {
  lang: Lang;
  classes: ClassCount[];
  matrix: MatrixRow[];
  storeys: StoreyFact[];
  peak: number;
  selected: string | null;
  onOpen: (storeyGuid: string | null, entity: string) => void;
  /** The storey ROW: every element on that floor, whatever its class. The
   *  total column is the number, so the number is the door — a row with no
   *  elements has no set and stays inert, as an empty cell does. */
  onStorey: (storeyGuid: string | null) => void;
}

export function StoreyClassCensus({
  lang,
  classes,
  matrix,
  storeys,
  peak,
  selected,
  onOpen,
  onStorey,
}: StoreyClassCensusProps) {
  const names = new Map(storeys.map((s) => [s.guid, s.name]));

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 w-36 min-w-36 border-r border-b border-line bg-panel px-2 py-1 align-bottom text-[10px] font-semibold tracking-[0.12em] text-gold uppercase"
            >
              {t("tile.storeys", lang)}
            </th>
            <th
              scope="col"
              className="sticky top-0 left-36 z-30 w-14 min-w-14 border-r-2 border-b border-line bg-panel px-1 py-1 text-right align-bottom text-[10px] font-semibold tracking-[0.12em] text-gold uppercase"
            >
              {t("col.count", lang)}
            </th>
            {classes.map((klass) => (
              <th
                key={klass.entity}
                scope="col"
                title={klass.entity}
                className="sticky top-0 z-20 min-w-10 border-r border-b border-line bg-panel px-1 py-1 text-right align-bottom font-mono text-[10px] leading-tight font-medium text-ink"
              >
                <span className="line-clamp-2 break-words">{header(klass.entity)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => {
            const live = row.total > 0;
            const rowKey = `storey:${row.storeyGuid ?? "-"}`;
            const openRow = live ? () => onStorey(row.storeyGuid) : undefined;
            const lit = selected === rowKey ? " outline-2 -outline-offset-2 outline-ink" : "";
            return (
            <tr key={row.storeyGuid ?? "-"}>
              <th
                scope="row"
                onClick={openRow}
                // A storey with no name falls back to its GlobalId. That is
                // never truncated, so it renders mono and full width.
                className={
                  "sticky left-0 z-10 h-7 w-36 min-w-36 overflow-hidden border-r border-b border-line bg-panel px-2 text-left font-medium text-ink " +
                  (row.storeyGuid !== null && !names.get(row.storeyGuid)
                    ? "font-mono text-[11px]"
                    : "truncate text-[12px]") +
                  (live ? " cursor-pointer hover:bg-palegreen" : "") +
                  lit
                }
                title={row.storeyGuid === null ? undefined : (names.get(row.storeyGuid) ?? "")}
              >
                {row.storeyGuid === null
                  ? t("matrix.noStorey", lang)
                  : (names.get(row.storeyGuid) ?? row.storeyGuid)}
              </th>
              <td
                onClick={openRow}
                className={
                  "sticky left-36 z-10 h-7 border-r-2 border-b border-line bg-panel px-1 text-right font-mono text-[11px] tabular-nums text-ink" +
                  (live ? " cursor-pointer hover:bg-palegreen" : "") +
                  lit
                }
              >
                {formatCount(row.total, lang)}
              </td>
              {classes.map((klass) => {
                const count = row.counts.get(klass.entity) ?? 0;
                const key = `cell:${row.storeyGuid ?? "-"}|${klass.entity}`;
                if (count === 0) {
                  return (
                    <td
                      key={klass.entity}
                      className="h-7 border-r border-b border-line bg-input p-0"
                    />
                  );
                }
                return (
                  <td key={klass.entity} className="h-7 border-r border-b border-line p-0">
                    <button
                      type="button"
                      onClick={() => onOpen(row.storeyGuid, klass.entity)}
                      style={ramp(count, peak)}
                      className={
                        "h-7 w-full px-1 text-right font-mono text-[11px] tabular-nums " +
                        (selected === key ? "outline-2 -outline-offset-2 outline-ink" : "")
                      }
                    >
                      {formatCount(count, lang)}
                    </button>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
