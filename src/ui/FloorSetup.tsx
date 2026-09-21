/** The Etasjer tile: how each loaded file stacks up against the config floors.
 *
 * edkjo, 2026-09-21: the floor matrix "is supposed to show how a file is
 * stacking up vs the config floors, not what is on each floor". So this is
 * the ONE floor tile on the Kontroll tab, and what sits on each floor lives
 * in the storey × class census on the Innhold tab.
 *
 * Rows are the config floors in the config's own order (name · kote), then,
 * under a divider, one row per file storey that matches no floor. Columns are
 * the loaded models, this panel's model first. A cell says how that model's
 * storey relates to the floor, in the storey-cell vocabulary of sprucelab's
 * dash-b matrix:
 *
 *   match               ✓            green
 *   right kote, name    ✗ <name>     gold
 *   right name, kote    ✗ +0,350     gold (Δ m, file − config)
 *   whitespace only     ! ␣          gold
 *   several on a floor  ! ×2         gold
 *   not in the config   ✗            red, in its own row
 *   floor absent        —            idle, never a finding
 *
 * The full "name · kote" is in every cell's title. The matching is
 * `matchStoreys`, the function the `storey-config` check runs, so a cell and
 * the verification row cannot disagree.
 *
 * With no config loaded the tile keeps its place and lists the file's own
 * storeys (name · kote · shared-kote marker), with no verdict columns.
 */

import type { ReactNode } from "react";
import { matchStoreys, type FloorConfig, type StoreyMatch } from "../engine/storey-config";
import type { StoreyFact, StoreyRowLite } from "./profile";
import type { IfcSummary } from "../engine/types";
import type { Lang } from "./i18n";
import { locale, t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatElevation } from "./format";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";

export interface FloorPeer {
  id: string;
  fileName: string;
  storeys: StoreyRowLite[];
  unitScale: number;
  unitResolved: boolean;
}

function Th({
  children,
  right,
  title,
  model,
}: {
  children: ReactNode;
  right?: boolean;
  title?: string;
  /** A model column: fixed ~10ch so four or more models fit an 8×3 tile. */
  model?: boolean;
}) {
  return (
    <th
      title={title}
      className={
        (model ? "w-[10ch] max-w-[10ch] min-w-[10ch] font-mono normal-case tracking-normal " : "tracking-[0.08em] uppercase ") +
        "sticky top-0 z-10 truncate border-b border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-gold " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

const metres = (m: number, lang: Lang, sign = false) =>
  m.toLocaleString(locale(lang), {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    signDisplay: sign ? "exceptZero" : "auto",
  });

/** The file name without its extension: the column header has ~8ch. */
const stem = (fileName: string) => fileName.replace(/\.(ifc|ifczip)$/i, "");

const describe = (m: StoreyMatch, lang: Lang) =>
  `${m.storey.name ?? m.storey.guid} · ${m.elevationM === null ? "—" : metres(m.elevationM, lang)}`;

const CELL = "h-6 w-[10ch] max-w-[10ch] border-b border-line p-0";
const MARK = "flex h-6 items-center gap-1 px-1.5 font-mono text-[11px] whitespace-nowrap";

function Cell({
  found,
  floor,
  lang,
}: {
  found: StoreyMatch[];
  floor: FloorConfig | null;
  lang: Lang;
}) {
  if (found.length === 0) {
    return <td className={`${CELL} px-1.5 font-mono text-[11px] text-muted`}>—</td>;
  }
  const title = found.map((m) => describe(m, lang)).join(" | ");
  let fill: string;
  let text: string;
  if (found.length > 1 || found[0].state === "duplicate") {
    fill = VERDICT_FILL.warn;
    text = `${VERDICT_GLYPH.warn} ×${Math.max(2, found.length)}`;
  } else {
    const m = found[0];
    switch (m.state) {
      case "match":
        fill = VERDICT_FILL.pass;
        text = VERDICT_GLYPH.pass;
        break;
      case "name-mismatch":
        fill = VERDICT_FILL.warn;
        text = `${VERDICT_GLYPH.fail} ${m.storey.name ?? m.storey.guid}`;
        break;
      case "elevation-mismatch":
        fill = VERDICT_FILL.warn;
        text =
          m.elevationM === null || floor === null
            ? `${VERDICT_GLYPH.fail} —`
            : `${VERDICT_GLYPH.fail} ${metres(m.elevationM - floor.elevation, lang, true)}`;
        break;
      case "whitespace":
        fill = VERDICT_FILL.warn;
        text = `${VERDICT_GLYPH.warn} ␣`;
        break;
      default:
        fill = VERDICT_FILL.fail;
        text = VERDICT_GLYPH.fail;
    }
  }
  return (
    <td className={CELL}>
      <span title={title} className={`${MARK} max-w-[10ch] ${fill}`}>
        <span className="truncate">{text}</span>
      </span>
    </td>
  );
}

/** The config floors against every loaded model. */
export function FloorSetupMatrix({
  lang,
  config,
  peers,
}: {
  lang: Lang;
  config: FloorConfig[];
  /** This panel's model first. */
  peers: FloorPeer[];
}) {
  const perModel = peers.map((peer) =>
    peer.unitResolved ? matchStoreys(peer.storeys, peer.unitScale, config) : [],
  );
  const extras = perModel.flatMap((matches, col) =>
    matches.filter((m) => m.config === null).map((m) => ({ col, match: m })),
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <Th>{t("col.name", lang)}</Th>
            <Th right>{t("col.elevation", lang)}</Th>
            {peers.map((peer) => (
              <Th key={peer.id} title={peer.fileName} model>
                {stem(peer.fileName)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.map((floor, row) => (
            <tr key={`cfg-${row}`}>
              <td
                title={floor.name}
                className="h-6 w-full max-w-0 truncate border-b border-line px-1.5 text-[12px] text-ink"
              >
                {floor.name}
              </td>
              <td className="h-6 w-[9ch] border-b border-line px-1.5 text-right font-mono text-[11px] tabular-nums whitespace-nowrap text-ink">
                {Number.isFinite(floor.elevation) ? metres(floor.elevation, lang) : "—"}
              </td>
              {perModel.map((matches, col) => (
                <Cell
                  key={peers[col].id}
                  lang={lang}
                  floor={floor}
                  found={matches.filter((m) => m.config === row)}
                />
              ))}
            </tr>
          ))}
          {extras.map(({ col, match }, index) => (
            <tr key={`extra-${peers[col].id}-${match.storey.guid}`}>
              <td
                title={match.storey.name ?? match.storey.guid}
                className={
                  "h-6 max-w-0 truncate border-b border-line px-1.5 text-[12px] text-ink " +
                  (index === 0 ? "border-t-2 border-t-ink" : "")
                }
              >
                {match.storey.name ?? match.storey.guid}
              </td>
              <td
                className={
                  "h-6 border-b border-line px-1.5 text-right font-mono text-[11px] tabular-nums whitespace-nowrap text-ink " +
                  (index === 0 ? "border-t-2 border-t-ink" : "")
                }
              >
                {match.elevationM === null ? "—" : metres(match.elevationM, lang)}
              </td>
              {peers.map((peer, c) => (
                <Cell key={peer.id} lang={lang} floor={null} found={c === col ? [match] : []} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** No config: the file's own storeys, by identity. The gold marker on a
 *  shared kote is the same fact the `storey-elevation` verdict carries; the
 *  verdict says THAT storeys collide and this says WHICH. */
export function StoreyList({
  lang,
  storeys,
  summary,
}: {
  lang: Lang;
  storeys: StoreyFact[];
  summary: IfcSummary;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-input">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <Th>{t("col.name", lang)}</Th>
            <Th right>{t("col.elevation", lang)}</Th>
          </tr>
        </thead>
        <tbody>
          {storeys.map((storey) => {
            const kote = formatElevation(
              storey.elevation,
              summary.unit_scale,
              summary.unit_resolved,
              lang,
            );
            return (
              <tr key={storey.guid}>
                {/* A storey with no name falls back to its GlobalId, which is
                    never truncated — so it renders mono and full. */}
                <td
                  onDoubleClick={copyOnDoubleClick(storey.name ?? storey.guid)}
                  title={storey.name ?? undefined}
                  className={
                    "h-6 cursor-copy border-b border-line px-1.5 text-[12px] text-ink " +
                    (storey.name === null ? "font-mono text-[11px]" : "max-w-0 truncate")
                  }
                >
                  {storey.name ?? storey.guid}
                </td>
                <td className="h-6 w-[14ch] border-b border-line p-0 text-right">
                  {storey.sharedWith > 1 ? (
                    <span
                      title={t("storey.shared", lang)}
                      className={`${MARK} justify-end tabular-nums ${VERDICT_FILL.warn}`}
                    >
                      <span className="font-bold">{VERDICT_GLYPH.warn}</span>
                      {kote}
                      <span className="font-semibold">×{storey.sharedWith}</span>
                    </span>
                  ) : (
                    <span className="block px-1.5 font-mono text-[11px] tabular-nums text-ink">
                      {kote}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
