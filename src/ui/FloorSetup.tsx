/** The floor config against every loaded model's storeys.
 *
 * Rows are the config floors in the config's own order; one column per loaded
 * model shows the file storey that lands on that floor (name and elevation).
 * A storey that matches exactly is Bestått; one that sits on the floor's name
 * or elevation but not both is Avvik, in that floor's row; a storey that
 * matches nothing gets a row of its own under the config floors. A config
 * floor a model does not carry is ABSENT, a dash, never a failure. The
 * matching is `matchStoreys`, the same function the `storey-config` check
 * runs, so the cells and the verification row cannot disagree.
 *
 * With no config this tile keeps rendering `StoreyRoster`; see `Dashboard`.
 */

import type { ReactNode } from "react";
import { matchStoreys, type FloorConfig, type StoreyMatch } from "../engine/storey-config";
import type { StoreyRowLite } from "./profile";
import type { Lang } from "./i18n";
import { locale, t } from "./i18n";
import { VERDICT_FILL, VERDICT_GLYPH } from "./state-visuals";

export interface FloorPeer {
  id: string;
  fileName: string;
  storeys: StoreyRowLite[];
  unitScale: number;
  unitResolved: boolean;
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={
        "sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap text-gold uppercase " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

const metres = (m: number, lang: Lang) =>
  m.toLocaleString(locale(lang), {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

function Cell({ found, lang }: { found: StoreyMatch[]; lang: Lang }) {
  if (found.length === 0) {
    return <td className="h-6 border-b border-line px-2 font-mono text-[11px] text-muted">—</td>;
  }
  const ok = found.every((m) => m.state === "match");
  const verdict = ok ? "pass" : "fail";
  return (
    <td className="h-6 border-b border-line p-0">
      <span
        className={`flex h-6 items-center gap-1.5 px-2 font-mono text-[11px] whitespace-nowrap ${VERDICT_FILL[verdict]}`}
        title={found.map((m) => m.state).join(", ")}
      >
        <span className="font-bold">{VERDICT_GLYPH[verdict]}</span>
        {found
          .map(
            (m) =>
              `${m.storey.name ?? m.storey.guid} · ${m.elevationM === null ? "—" : metres(m.elevationM, lang)}`,
          )
          .join(" | ")}
      </span>
    </td>
  );
}

export function FloorSetupMatrix({
  lang,
  config,
  peers,
}: {
  lang: Lang;
  config: FloorConfig[];
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
            <Th>{t("setup.storeys", lang)}</Th>
            <Th right>{t("col.elevation", lang)}</Th>
            {peers.map((peer) => (
              <Th key={peer.id}>{peer.fileName}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.map((floor, row) => (
            <tr key={`cfg-${row}`}>
              <td className="h-6 border-b border-line px-2 text-[12px] whitespace-nowrap text-ink">
                {floor.name}
              </td>
              <td className="h-6 border-b border-line px-2 text-right font-mono text-[11px] tabular-nums text-ink">
                {Number.isFinite(floor.elevation) ? metres(floor.elevation, lang) : "—"}
              </td>
              {perModel.map((matches, col) => (
                <Cell key={peers[col].id} lang={lang} found={matches.filter((m) => m.config === row)} />
              ))}
            </tr>
          ))}
          {extras.map(({ col, match }) => (
            <tr key={`extra-${peers[col].id}-${match.storey.guid}`}>
              <td className="h-6 border-b border-line px-2 font-mono text-[11px] text-muted">—</td>
              <td className="h-6 border-b border-line px-2 text-right font-mono text-[11px] text-muted">—</td>
              {peers.map((peer, c) => (
                <Cell key={peer.id} lang={lang} found={c === col ? [match] : []} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
