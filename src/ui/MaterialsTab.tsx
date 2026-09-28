/** Materialer: the material extraction, in the ifcfast demo's two views
 * (`ifc-fast-demo/components/views/materials-view.tsx`), as galleries since
 * 2026-09-26 (owner: "the types and materials tabs need to be galleries, not
 * rows"):
 *
 *   Materialer   one card per material name: a swatch, the name, how many
 *                elements, and the types that carry it (a class's untyped
 *                elements by the class name), each a link to its Typer
 *                card. A card makes a chip, so the 3D isolates what is made
 *                of it.
 *   Layer sets   one S card per material layer set: its layers as a strip in
 *                proportion to their thickness (`materialsJson()`, role
 *                `layer`), each layer's thickness and material, how many
 *                elements use it, and the types that do, as links.
 *
 * The collections and the links are `type-links.ts`'s, computed once per
 * profile by the panel (2026-09-28); this file only draws them.
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { FilterChip } from "./cross-filter";
import { Gallery, GalleryCard, LinkChip } from "./Gallery";
import { useFillHeight } from "./useFillHeight";
import type { Catalogue, LayerSetCard, Link, TypeCard } from "./type-links";
import type { Reveal } from "./TypesTab";

const mm = (value: number, lang: Lang) =>
  `${value.toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: 0 })} mm`;

/** The types behind a material or a layer set, as links to their cards
 *  (2026-09-28, "what goes with what"). An untyped card is named by its
 *  class, since that is what it is. */
function TypeLinks({
  links,
  types,
  onOpenType,
}: {
  links: Link[];
  types: Map<string, TypeCard>;
  onOpenType: (key: string) => void;
}) {
  if (links.length === 0) return <span className="font-mono text-[10px] text-muted">—</span>;
  return (
    <>
      {links.map((link) => {
        const card = types.get(link.key);
        const label = card ? (card.typeName ?? card.entity) : link.key;
        return (
          <LinkChip
            key={link.key}
            label={label}
            n={link.n}
            title={card ? `${card.entity} · ${label} · ${link.n}` : link.key}
            onOpen={() => onOpenType(link.key)}
            data={{ "data-link-type": link.key }}
          />
        );
      })}
    </>
  );
}

export function MaterialsTab({
  lang,
  profile,
  catalogue,
  chips,
  reveal,
  onToggleChip,
  onOpenType,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The panel's chips, to mark the rows that are filtering. */
  chips: FilterChip[];
  /** A material card another tab asked for (a type's material link). */
  reveal: Reveal | null;
  onToggleChip: (chip: FilterChip) => void;
  onOpenType: (key: string) => void;
}) {
  const [view, setView] = useState<"materials" | "sets">("materials");
  const materials = catalogue?.materials ?? [];
  const sets = catalogue ? catalogue.sets : null;
  const types = useMemo(() => new Map((catalogue?.types ?? []).map((c) => [c.key, c])), [catalogue]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  const active = new Set(chips.map((c) => c.key));

  // A type's material link lands here: the Materialer view, that card in
  // view and marked until the next request.
  const [revealed, setRevealed] = useState<string | null>(null);
  const handled = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    setView("materials");
    setRevealed(reveal.key);
  }, [reveal]);
  const revealRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    revealRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealed, view]);

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
                  title={`${line.name} · ${line.entities.join(", ")}`}
                  active={active.has(key)}
                  onClick={() => onToggleChip({ key, kind: "material", label: line.name, guids: line.guids })}
                  cardRef={revealed === line.name ? revealRef : undefined}
                  data={{ "data-material-card": line.name, "data-revealed": revealed === line.name ? "" : undefined }}
                >
                  <div className="gallery-swatch m-2.5 mb-0 h-10 shrink-0 rounded-[8px]" />
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
                    <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-auto" data-material-types>
                      <TypeLinks links={catalogue?.materialTypes.get(line.name) ?? []} types={types} onOpenType={onOpenType} />
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
                <div className="min-h-0 flex-[3_1_0] overflow-auto">
                  {set.layers.map((layer, i) => (
                    <div key={i} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[15px] text-muted">
                      <span className="w-14 shrink-0 text-right text-ink tabular-nums">
                        {layer.thickness === null ? "—" : mm(layer.thickness, lang)}
                      </span>
                      <span className="min-w-0 truncate">{layer.material ?? "—"}</span>
                    </div>
                  ))}
                </div>
                <div className="flex min-h-0 flex-[2_1_0] flex-wrap content-start gap-1 overflow-auto" data-set-types>
                  <TypeLinks links={catalogue?.setTypes.get(set.key) ?? []} types={types} onOpenType={onOpenType} />
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
function LayerStrip({ layers, lang }: { layers: LayerSetCard["layers"]; lang: Lang }) {
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
