/** Oppsett's project-layer steps (Fase, Materiale / Produkt, Mengdetype):
 *  each edits one cascade of the ruleset's `projectLayer`, the sources read
 *  after the standard layer's (`src/engine/standard-sources.ts`).
 *
 * Pure. What a step writes is exactly the ruleset shape lint accepts: an
 * empty list is left out, an entry with nothing left in it is left out, and
 * a `projectLayer` with no entry is left out, so a step never writes a
 * `cascade-sources-empty` or an empty `projectLayer` the workbook refuses.
 */

import {
  phaseAccepted,
  projectMengdetype,
  usableMaterial,
  type LayerSlot,
} from "../engine/standard-sources.ts";
import type { CodeSource, PhaseSource, ProjectLayer, Ruleset } from "../ids/types.ts";
import type { ExtractPreview, ExtractState } from "./extract-preview.ts";
import type { PsetValue } from "./pset-choices.ts";

/** A slot's sources as the ruleset holds them, in cascade order. */
export function layerSources(ruleset: Ruleset, slot: LayerSlot): PhaseSource[] {
  const layer = ruleset.projectLayer;
  if (slot === "phase") return layer?.phase?.sources ?? [];
  return layer?.["material-product"]?.[slot] ?? [];
}

/** `ruleset` with this slot's sources. A `progressCode` source belongs to
 *  `phase` alone; lint refuses it anywhere else. */
export function withLayerSources(ruleset: Ruleset, slot: LayerSlot, sources: PhaseSource[]): Ruleset {
  const layer: ProjectLayer = { ...(ruleset.projectLayer ?? {}) };
  if (slot === "phase") {
    const entry: NonNullable<ProjectLayer["phase"]> = { ...(layer.phase ?? {}) };
    if (sources.length > 0) entry.sources = sources;
    else delete entry.sources;
    if (Object.keys(entry).length > 0) layer.phase = entry;
    else delete layer.phase;
  } else {
    const entry: NonNullable<ProjectLayer["material-product"]> = { ...(layer["material-product"] ?? {}) };
    if (sources.length > 0) entry[slot] = sources as CodeSource[];
    else delete entry[slot];
    if (Object.keys(entry).length > 0) layer["material-product"] = entry;
    else delete layer["material-product"];
  }
  const next: Ruleset = { ...ruleset, projectLayer: layer };
  if (Object.keys(layer).length === 0) delete next.projectLayer;
  return next;
}

/** Where lint reports a slot's issues: `<path>[i]...` for its i-th source. */
export function layerPath(slot: LayerSlot): string {
  return slot === "phase" ? "projectLayer.phase.sources" : `projectLayer.material-product.${slot}`;
}

/** Whether the standard layer takes a value read from one of this slot's
 *  project sources, judged as `standard-layer.ts` judges it: phase against
 *  the accepted phases (the MMI table's included when a `progressCode`
 *  source is listed), mengdetype when it decides, a product when it is
 *  there, a material when it is a usable name. */
export function layerJudge(slot: LayerSlot, ruleset: Ruleset): (value: string) => boolean {
  switch (slot) {
    case "phase": {
      const accepted = new Set(phaseAccepted(ruleset).map((v) => v.toUpperCase()));
      return (v) => accepted.has(v.trim().toUpperCase());
    }
    case "mengdetype":
      return (v) => projectMengdetype(v) !== null;
    case "product":
      return (v) => v.trim() !== "";
    case "material":
      return usableMaterial;
  }
}

/** The values list's live check for a project-layer source: a taken value
 *  is `ok`, any other carried value `not-in-list` (the report's avvik, or a
 *  mengdetype that decides nothing). No code column: the value is read whole. */
export function previewLayer(values: PsetValue[], ok: (value: string) => boolean): ExtractPreview {
  const totals: Record<ExtractState, number> = { ok: 0, "no-match": 0, "not-in-list": 0 };
  const rows = values.map((value) => {
    const state: ExtractState = ok(value.v) ? "ok" : "not-in-list";
    totals[state] += value.n;
    return { ...value, code: null, state };
  });
  return { rows, totals };
}
