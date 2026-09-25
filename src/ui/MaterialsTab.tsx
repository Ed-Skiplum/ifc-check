/** Materialer: the material extraction, in the ifcfast demo's two views
 * (`ifc-fast-demo/components/views/materials-view.tsx`):
 *
 *   Materialer   every material name, the classes that carry it and how many
 *                elements. A row makes a chip, so the 3D isolates what is
 *                made of it.
 *   Layer sets   every material layer set, its layers and their thickness
 *                (`materialsJson()`, role `layer`), and how many elements use
 *                it. A row opens its layers.
 *
 * The names are the engine's (`ProductRowLite.materials`: layer-set materials
 * plus a direct `IfcMaterial`, the same set `element-material` judges). The
 * layers are the engine's rows as they are, grouped per element.
 *
 * What the demo had that is not here:
 *   · the layer set's NAME. The wasm graph's `layer_set` is null, so a row is
 *     the layer stack, and the header says `ikke levert` (see below).
 *   · the model dots (one model per panel).
 */

import { useMemo, useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { FilterChip } from "./cross-filter";
import { Th } from "./TypesTab";

interface MaterialLine {
  name: string;
  entities: string[];
  guids: string[];
}

interface LayerSetLine {
  key: string;
  /** `IfcMaterialLayerSet.Name`, or null when the engine does not give it. */
  name: string | null;
  layers: { material: string | null; thickness: number | null }[];
  total: number | null;
  count: number;
}

function materialLines(profile: ModelProfile): MaterialLine[] {
  const lines = new Map<string, { entities: Set<string>; guids: string[] }>();
  for (const row of profile.rows) {
    for (const name of row.materials ?? []) {
      let line = lines.get(name);
      if (!line) lines.set(name, (line = { entities: new Set(), guids: [] }));
      line.entities.add(row.entity);
      line.guids.push(row.guid);
    }
  }
  return [...lines.entries()]
    .map(([name, line]) => ({ name, entities: [...line.entities].sort(), guids: line.guids }))
    .sort((a, b) => b.guids.length - a.guids.length);
}

function layerSetLines(profile: ModelProfile): LayerSetLine[] | null {
  const table = profile.materialRows;
  if (!table) return null;
  const layersOf = new Map<string, { index: number; material: string | null; thickness: number | null }[]>();
  for (const row of table) {
    if (row.role !== "layer") continue;
    let list = layersOf.get(row.guid);
    if (!list) layersOf.set(row.guid, (list = []));
    list.push({ index: row.layer_index, material: row.material_name, thickness: row.layer_thickness_mm });
  }
  // A set is keyed by its NAME when the engine gives one. The wasm build does
  // not (`layer_set` is null on every HI90_ARK product, 2026-09-25), so then
  // the key is the layer stack itself and the header says `ikke levert`:
  // two differently named sets with the same layers read as one row, and the
  // row claims the stack, never a name.
  const sets = new Map<string, LayerSetLine>();
  for (const product of profile.rows) {
    const rows = layersOf.get(product.guid);
    if (!rows || rows.length === 0) continue;
    const layers = rows
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((l) => ({ material: l.material, thickness: l.thickness }));
    const name = product.layerSet ?? null;
    const key = name ?? `stack:${layers.map((l) => `${l.material}|${l.thickness}`).join("/")}`;
    let set = sets.get(key);
    if (!set) {
      const known = layers.every((l) => l.thickness !== null);
      set = {
        key,
        name,
        layers,
        total: known ? layers.reduce((sum, l) => sum + (l.thickness ?? 0), 0) : null,
        count: 0,
      };
      sets.set(key, set);
    }
    set.count += 1;
  }
  return [...sets.values()].sort((a, b) => b.count - a.count);
}

const mm = (value: number, lang: Lang) =>
  `${value.toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: 0 })} mm`;

export function MaterialsTab({
  lang,
  profile,
  chips,
  onToggleChip,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** The panel's chips, to mark the rows that are filtering. */
  chips: FilterChip[];
  onToggleChip: (chip: FilterChip) => void;
}) {
  const [view, setView] = useState<"materials" | "sets">("materials");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const materials = useMemo(() => (profile ? materialLines(profile) : []), [profile]);
  const sets = useMemo(() => (profile ? layerSetLines(profile) : null), [profile]);
  const notSupplied = t("type.notSupplied", lang);
  const active = new Set(chips.map((c) => c.key));

  return (
    <section className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border border-line bg-panel">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5 pb-1">
        <div role="group" className="flex shrink-0 overflow-hidden rounded-[6px] border border-line">
          {(
            [
              ["materials", t("col.materials", lang)],
              ["sets", "Layer sets"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={
                "px-2 py-0.5 text-[11px] " +
                (view === id ? "bg-ink text-panel" : "bg-input text-muted hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">
          {view === "materials"
            ? formatCount(materials.length, lang)
            : sets
              ? `${sets.some((set) => set.name === null) ? `IfcMaterialLayerSet.Name ${notSupplied} · ` : ""}${formatCount(sets.length, lang)}`
              : notSupplied}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-input">
        {view === "materials" ? (
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <Th>{t("col.materials", lang)}</Th>
                <Th>{t("col.class", lang)}</Th>
                <Th right>{t("col.elements", lang)}</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((line) => {
                const key = `material:${line.name}`;
                const on = active.has(key);
                return (
                  <tr
                    key={line.name}
                    aria-selected={on}
                    onClick={() =>
                      onToggleChip({ key, kind: "material", label: line.name, guids: line.guids })
                    }
                    className={"cursor-pointer " + (on ? "bg-palegreen" : "hover:bg-panel")}
                  >
                    <td className="max-w-[28rem] truncate border-b border-line px-2 py-1.5 font-mono text-[12px] text-ink">
                      {line.name}
                    </td>
                    <td className="max-w-[24rem] truncate border-b border-line px-2 py-1.5 font-mono text-[10px] text-muted">
                      {line.entities.join(", ")}
                    </td>
                    <td className="border-b border-line px-2 py-1.5 text-right font-mono text-[12px] tabular-nums">
                      {formatCount(line.guids.length, lang)}
                    </td>
                  </tr>
                );
              })}
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center font-mono text-[11px] text-muted">
                    {profile ? t("type.none", lang) : notSupplied}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : sets === null ? (
          <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">
            {`materialsJson() · ${notSupplied}`}
          </div>
        ) : (
          <div>
            {sets.map((set) => {
              const isOpen = open.has(set.key);
              return (
                <div key={set.key} className="border-b border-line">
                  <button
                    type="button"
                    data-layer-set
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(set.key)) next.delete(set.key);
                        else next.add(set.key);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-3 px-2 py-1.5 text-left hover:bg-panel"
                  >
                    <span className="w-3 text-center text-muted">{isOpen ? "▾" : "▸"}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                      {set.name ?? set.layers.map((l) => l.material ?? "—").join(" · ")}
                    </span>
                    <span className="w-40 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
                      {`${formatCount(set.layers.length, lang)} · ${set.total === null ? "—" : mm(set.total, lang)}`}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums">
                      {formatCount(set.count, lang)}
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="pb-2">
                      {set.layers.map((layer, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 py-0.5 pr-2 pl-9 font-mono text-[11px] text-muted"
                        >
                          <span className="w-16 text-right tabular-nums text-ink">
                            {layer.thickness === null ? "—" : mm(layer.thickness, lang)}
                          </span>
                          <span className="truncate">{layer.material ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {sets.length === 0 ? (
              <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">{t("type.none", lang)}</div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
