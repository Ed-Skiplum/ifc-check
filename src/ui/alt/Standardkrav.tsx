/** What left the Overview for the project tab (2026-09-28, owner: "We have a
 *  dash for general model health and a separate tab for project specifics
 *  and IDS"): the Standardkrav requirements (Systemkode, Funksjonskode,
 *  Materiale/Produkt, Kopiobjekt, MMI, Fase), the MMI bars, and the treemaps
 *  read through a project mapping. Nothing here is new: each export is an
 *  existing component, and the filters over the report contract are in
 *  `req-view.ts` (`standardRequirements`, `mmiRequirement`, `projectTrees`).
 *
 *  To mount on another tab, with the same door props the Overview uses
 *  (`{ lang, model, selected, onFocus }`, see `DoorProps`):
 *
 *    <StandardkravList reqs={standardRequirements(model)} {...door} />
 *    <MmiChart req={mmiRequirement(model)!} {...door} />
 *    {projectTrees(model).map((tree) =>
 *      <CodeTreemap key={tree.axis} tree={tree} measures={model.board?.measures} {...door} />)}
 *
 *  `MeasureSwitch` (Antall / Volum / Areal) sits in a treemap's head, as
 *  `AltBoard.tsx` does it. The door behind every click is the same
 *  `onFocus`, so a click there fills the Scope dock wherever that is. */

import type { Requirement } from "../requirements";
import { ReqBlock, type DoorProps } from "./Requirements";

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
