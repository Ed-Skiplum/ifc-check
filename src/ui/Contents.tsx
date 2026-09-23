/** The Innhold tab: what the file carries, in detail.
 *
 * A flow surface, not a bento (sprucelab ModelWorkspace: one bento overview
 * tab, then working tabs). Two bands, each a card with a FIXED,
 * viewport-derived height, so a long class list or ledger costs rows inside
 * its card and never page height (DESIGN.md §1, TableViewport):
 *
 *   band 1   Klasser (38.2 %) | Etasje × klasse (61.8 %)
 *   band 2   Typer, full width
 *
 * Every click cross-filters exactly as it did on the board: a chip, and the
 * derivation band under the tab.
 */

import type { CSSProperties, ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Census } from "./profile";
import type { Focus } from "./trace";
import { formatCount } from "./format";
import { MicroLabel } from "./BentoGrid";
import { ClassDistribution } from "./forms";
import { StoreyClassCensus } from "./StoreyClassCensus";
import { TypeLedgerTile, type TypeLedger } from "./types";

/** The type scale the board derives from its track, fixed here: the ledger
 *  and the tables read the same custom properties on both tabs. */
const SCALE = {
  "--bento-pad": "8px",
  "--bento-label": "10px",
  "--bento-text": "12px",
} as CSSProperties;

function Card({
  label,
  sub,
  className,
  children,
}: {
  label: string;
  sub?: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel ${className}`}>
      <div className="flex shrink-0 items-baseline gap-2 px-2 pt-1.5 pb-1">
        <MicroLabel>{label}</MicroLabel>
        {sub ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">{sub}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Contents({
  lang,
  census,
  ledger,
  selected,
  onFocus,
}: {
  lang: Lang;
  census: Census;
  ledger: TypeLedger;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto" style={SCALE}>
      <div className="grid shrink-0 gap-3 [grid-template-columns:minmax(0,38.2fr)_minmax(0,61.8fr)]">
        <Card
          label={t("tile.classes", lang)}
          sub={formatCount(census.classes.length, lang)}
          className="h-[clamp(15rem,40vh,34rem)]"
        >
          <ClassDistribution
            lang={lang}
            classes={census.classes}
            selected={selected}
            onFocus={onFocus}
          />
        </Card>
        <Card
          label={t("tile.census", lang)}
          sub={`${formatCount(census.storeys.length, lang)} × ${formatCount(census.classes.length, lang)}`}
          className="h-[clamp(15rem,40vh,34rem)]"
        >
          <StoreyClassCensus
            lang={lang}
            classes={census.classes}
            matrix={census.matrix}
            storeys={census.storeys}
            peak={census.matrixPeak}
            selected={selected}
            onOpen={(storeyGuid, entity) => onFocus({ kind: "cell", storeyGuid, entity })}
            onStorey={(storeyGuid) => onFocus({ kind: "storey", storeyGuids: [storeyGuid] })}
          />
        </Card>
      </div>

      <Card
        label={t("tile.types", lang)}
        sub={`${formatCount(ledger.singles, lang)} / ${formatCount(ledger.types, lang)}`}
        className="h-[clamp(18rem,55vh,48rem)] shrink-0"
      >
        {ledger.factsPresent ? (
          <TypeLedgerTile lang={lang} ledger={ledger} selected={selected} onFocus={onFocus} />
        ) : (
          // A profile that never carried the type facts says so in its own
          // slot: "no types" and "nobody supplied the type facts" differ.
          <div className="flex flex-1 items-center px-2 font-mono text-[11px] text-muted">
            {`${t("type.facts", lang)} · ${t("type.unavailable", lang)}`}
          </div>
        )}
      </Card>
    </div>
  );
}
