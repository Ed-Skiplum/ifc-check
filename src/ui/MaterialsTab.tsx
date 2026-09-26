/** Materialer: the material extraction, in the ifcfast demo's two views
 * (`ifc-fast-demo/components/views/materials-view.tsx`), as galleries since
 * 2026-09-26 (owner: "the types and materials tabs need to be galleries, not
 * rows"):
 *
 *   Materialer   one card per material name: a swatch, the name, the classes
 *                that carry it and how many elements. A card makes a chip,
 *                so the 3D isolates what is made of it.
 *   Layer sets   one S card per material layer set: its layers as a strip in
 *                proportion to their thickness (`materialsJson()`, role
 *                `layer`), each layer's thickness and material, and how many
 *                elements use it.
 *
 * The swatch is neutral: the engine gives no IfcMaterial surface colour (the
 * mesh colour is per PRODUCT and falls back to a per-class palette, so it is
 * not the material's), and a colour that is not the file's would be made up.
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
import { Gallery, GalleryCard } from "./Gallery";
import { useFillHeight } from "./useFillHeight";

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
  const materials = useMemo(() => (profile ? materialLines(profile) : []), [profile]);
  const sets = useMemo(() => (profile ? layerSetLines(profile) : null), [profile]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  const active = new Set(chips.map((c) => c.key));

  return (
    <section ref={fillRef} style={{ height: fillHeight ?? undefined }} className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-1">
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
      {view === "materials" ? (
        materials.length === 0 ? (
          <Empty>{profile ? t("type.none", lang) : notSupplied}</Empty>
        ) : (
          <Gallery unit={[2, 2]} label="materials">
            {materials.map((line) => {
              const key = `material:${line.name}`;
              return (
                <GalleryCard
                  key={line.name}
                  title={line.name}
                  active={active.has(key)}
                  onClick={() => onToggleChip({ key, kind: "material", label: line.name, guids: line.guids })}
                >
                  <div className="gallery-swatch m-2.5 mb-0 h-16 shrink-0 rounded-[8px]" />
                  <div className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 pt-1.5 pb-2">
                    <div className="flex items-baseline gap-2">
                      <span className="line-clamp-2 min-w-0 flex-1 font-mono text-[11.5px] leading-snug break-all text-ink">
                        {line.name}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums"
                        title={t("col.elements", lang)}
                      >
                        {formatCount(line.guids.length, lang)}
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden font-mono text-[10px] leading-[14px] text-muted" title={line.entities.join(", ")}>
                      {line.entities.map((entity) => (
                        <div key={entity} className="truncate">
                          {entity}
                        </div>
                      ))}
                    </div>
                  </div>
                </GalleryCard>
              );
            })}
          </Gallery>
        )
      ) : sets === null ? (
        <Empty>{`materialsJson() · ${notSupplied}`}</Empty>
      ) : sets.length === 0 ? (
        <Empty>{t("type.none", lang)}</Empty>
      ) : (
        <Gallery unit={[2, 2]} label="sets">
          {sets.map((set) => (
            <GalleryCard key={set.key} title={set.name ?? undefined}>
              <div data-layer-set className="flex min-h-0 flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                    {set.name ?? set.layers.map((l) => l.material ?? "—").join(" · ")}
                  </span>
                  <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums">
                    {formatCount(set.count, lang)}
                  </span>
                </div>
                <LayerStrip layers={set.layers} lang={lang} />
                <div className="font-mono text-[10px] text-muted tabular-nums">
                  {`${formatCount(set.layers.length, lang)} · ${set.total === null ? "—" : mm(set.total, lang)}`}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {set.layers.map((layer, i) => (
                    <div key={i} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[15px] text-muted">
                      <span className="w-14 shrink-0 text-right text-ink tabular-nums">
                        {layer.thickness === null ? "—" : mm(layer.thickness, lang)}
                      </span>
                      <span className="min-w-0 truncate">{layer.material ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GalleryCard>
          ))}
        </Gallery>
      )}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">{children}</div>;
}

/** The layers, side by side in the order of the set, each as wide as its
 *  thickness is of the total. A layer with no thickness takes an equal share
 *  and is hatched, so it cannot pass for a measure. */
function LayerStrip({ layers, lang }: { layers: LayerSetLine["layers"]; lang: Lang }) {
  const known = layers.filter((l) => l.thickness !== null && l.thickness > 0);
  const sum = known.reduce((s, l) => s + (l.thickness ?? 0), 0);
  const unknownShare = layers.length > 0 ? (layers.length - known.length) / layers.length : 0;
  return (
    <div className="flex h-7 shrink-0 overflow-hidden rounded-[6px] border border-line">
      {layers.map((layer, i) => {
        const has = layer.thickness !== null && layer.thickness > 0;
        const share = has ? ((layer.thickness ?? 0) / sum) * (1 - unknownShare) : 1 / layers.length;
        return (
          <span
            key={i}
            title={`${layer.thickness === null ? "—" : mm(layer.thickness, lang)} · ${layer.material ?? "—"}`}
            className={"gallery-layer h-full min-w-[3px]" + (has ? "" : " gallery-layer-unknown")}
            data-shade={i % 3}
            style={{ flex: `${Math.max(share, 0.0001)} 1 0` }}
          />
        );
      })}
    </div>
  );
}
