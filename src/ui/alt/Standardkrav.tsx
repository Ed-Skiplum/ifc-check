/** The Standardkrav requirements (Systemkode, Funksjonskode,
 *  Materiale/Produkt, Kopiobjekt, MMI, Fase) as they read on the IDS tab
 *  (2026-10-01, edkjo: "IDS is a report. No nonsense"): `StandardkravRows`,
 *  the report's first group, one row per requirement, what it asks and what
 *  the model gave. The filters over the report contract are in `req-view.ts`
 *  (`standardRequirements`, `stdAsk`, `stdCounts`).
 *
 *  The charts that left the tab (the MMI bars, the treemaps read through a
 *  project mapping) are still exported from here, with the same door props
 *  the Overview uses (`{ lang, model, selected, onFocus }`, see
 *  `DoorProps`), for whichever tab mounts them:
 *
 *    <StandardkravList reqs={standardRequirements(model)} {...door} />
 *    <MmiChart req={mmiRequirement(model)!} {...door} />
 *    {projectTrees(model).map((tree) =>
 *      <CodeTreemap key={tree.axis} tree={tree} measures={model.board?.measures} {...door} />)}
 *
 *  `MeasureSwitch` (Antall / Volum / Areal / Lengde) sits in a treemap's head, as
 *  `AltBoard.tsx` does it. The door behind every click is the same
 *  `onFocus`, so a click there fills the Scope dock wherever that is. */

import type { Requirement } from "../requirements";
import type { Ruleset } from "../../ids/types.ts";
import { t } from "../i18n";
import { AskPart, ReportLine, ReqBlock, type DoorProps } from "./Requirements";
import { stateLook, stdAsk, stdCounts } from "./req-view";

export { MmiChart, CodeTreemap, MeasureSwitch } from "./Charts";
export { ReqBlock, ReqCard } from "./Requirements";

/** The Standardkrav requirements as the report's blocks, one under the
 *  other; the host tile scrolls. `first` is the report's number of the
 *  first block (the Standardkrav section follows IFC-struktur's five). */
export function StandardkravList({ reqs, first = 6, ...door }: DoorProps & { reqs: Requirement[]; first?: number }) {
  return (
    <div className="alt-list flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
      {reqs.map((req, i) => (
        <ReqBlock key={req.key} req={req} index={first + i} {...door} />
      ))}
    </div>
  );
}

/** What one Standardkrav requirement asks: «fra» its sources (the IFC
 *  standard's or the project's), the code list, the Uttrekk, the accepted
 *  or copy values. Unconfigured: MMI says «Statuskode ikke konfigurert»,
 *  the rest nothing (the status says it); not evaluable: the engine's
 *  reason. */
function StdAsk({ req, ruleset, lang }: { req: Requirement; ruleset: Ruleset | null; lang: DoorProps["lang"] }) {
  if (req.state === "not_configured") {
    return req.distribution ? <span className="text-[11px] text-muted">{t("mmi.notConfigured", lang)}</span> : null;
  }
  const ask = stdAsk(req, ruleset);
  return (
    <>
      {ask && ask.sources.length > 0 ? (
        <AskPart label={t("req.fra", lang)}>
          {ask.sources.map((s, i) => (
            <span key={`${s.gren ?? ""}${s.navn}`}>
              {i > 0 ? " · " : ""}
              <span className="alt-src">{t(`req.lag.${s.lag}`, lang)}</span> {s.navn}
            </span>
          ))}
        </AskPart>
      ) : null}
      {ask?.list ? <AskPart label={t("field.list", lang)}>{ask.list}</AskPart> : null}
      {ask?.extract ? <AskPart label={t("field.extract", lang)}>{ask.extract}</AskPart> : null}
      {ask?.values ? <AskPart label={t(ask.values.label, lang)}>{ask.values.values.join(" · ")}</AskPart> : null}
      {req.row?.grunn && req.state === "not_evaluable" ? (
        <span className="font-mono text-[11px] break-words text-muted">{req.row.grunn}</span>
      ) : null}
    </>
  );
}

/** The report's Standardkrav group: one row per requirement, in the
 *  report's order. */
export function StandardkravRows({ reqs, ruleset, ...door }: DoorProps & { reqs: Requirement[]; ruleset: Ruleset | null }) {
  const { lang } = door;
  return (
    <>
      {reqs.map((req) => (
        <ReportLine
          key={req.key}
          name={t(req.label, lang)}
          ask={<StdAsk req={req} ruleset={ruleset} lang={lang} />}
          counts={stdCounts(req, door.model)}
          look={{ ...stateLook(req.state, lang), state: req.state }}
          focus={req.focus}
          title={req.row?.grunn}
          lang={lang}
          selected={door.selected}
          onFocus={door.onFocus}
          data={{ "data-req": req.key }}
        />
      ))}
    </>
  );
}
