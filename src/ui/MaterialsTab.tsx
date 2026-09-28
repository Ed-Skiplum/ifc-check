/** Materialer: the material extraction, in the ifcfast demo's two views
 * (`ifc-fast-demo/components/views/materials-view.tsx`), as galleries since
 * 2026-09-26 (owner: "the types and materials tabs need to be galleries, not
 * rows"):
 *
 *   Materialer   one card per material name: a swatch, the name, how many
 *                elements, and the types that carry it (a class's untyped
 *                elements by the class name), each a link to its Typer
 *                card. A click makes what is made of it THE filter (origin
 *                `materials`, one origin, 2026-09-28): this gallery dims
 *                all but the chosen card, the board's 3D beside it
 *                (`BoardViewer.tsx`) and every other view isolate.
 *   Layer sets   one S card per material layer set: its layers as a strip in
 *                proportion to their thickness (`materialsJson()`, role
 *                `layer`), each layer's thickness and material, how many
 *                elements use it, and the types that do, as links. A click
 *                makes those elements the filter, as above.
 *
 * The facets (2026-09-28, `FacetBar.tsx` over `facets.ts`): IFC class,
 * Systemkode, Funksjonskode, IsExternal, LoadBearing and FireRating, read
 * through the elements that carry the material or the layer set. They narrow
 * the cards shown and nothing else; a card click is still the one filter.
 *
 * A filter from another view isolates the gallery: the panel hands it the
 * catalogue over the matching rows, so only materials and sets with matching
 * elements show, their counts recomputed.
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

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FilterAction, ModelView } from "./cross-filter";
import type { Ref } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { MeshBatch } from "../viewer/mesh-stream";
import { Gallery, GalleryCard, LinkChip } from "./Gallery";
import { WithViewer } from "./BoardViewer";
import { useFillHeight } from "./useFillHeight";
import type { Catalogue, LayerSetCard, Link, MaterialCard, TypeCard } from "./type-links";
import type { Reveal } from "./TypesTab";
import { css } from "./chart-colors.ts";
import { FacetBar } from "./FacetBar";
import { elementItems, narrow, type ElementFacets, type FacetId, type FacetSelection } from "./facets";
import { BAR_MM, layerFill, layerSection, materialCategory, sectionFrame, sectionOrientation, type LayerCategory } from "./layer-section.ts";

const MATERIAL_FACETS: readonly FacetId[] = ["entity", "system", "function", "ext", "lb", "fire"];

export const mm = (value: number, lang: Lang) =>
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
  scopedCatalogue = null,
  facetIndex,
  meshBatches,
  view: xview,
  reveal,
  onDispatch,
  onOpenType,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The same over the cross-filter's matching rows, when another view is
   *  its origin: the gallery then shows only these. */
  scopedCatalogue?: Catalogue | null;
  /** Each element's facet values (`elementFacets`), per profile and board. */
  facetIndex: ElementFacets | null;
  /** The streamed geometry, for the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** The panel's one filter: the card it is on, when this tab is its origin. */
  view: ModelView;
  /** A material card another tab asked for (a type's material link). */
  reveal: Reveal | null;
  onDispatch: (action: FilterAction) => void;
  onOpenType: (key: string) => void;
}) {
  const [view, setView] = useState<"materials" | "sets">("materials");
  // Shown: the isolated collections under a filter from elsewhere. Picked:
  // always the whole card, so a click replaces the filter rather than
  // intersecting with it.
  const shown = scopedCatalogue ?? catalogue;
  const allMaterials = shown?.materials;
  const allSets = shown ? shown.sets : null;
  // The facets narrow the cards shown, through each card's elements.
  const [facetSel, setFacetSel] = useState<FacetSelection>({});
  const materialItems = useMemo(
    () => elementItems((allMaterials ?? []).map((m) => ({ key: m.name, guids: m.guids })), facetIndex ?? new Map()),
    [allMaterials, facetIndex],
  );
  const setItems = useMemo(
    () => elementItems((allSets ?? []).map((x) => ({ key: x.key, guids: x.guids })), facetIndex ?? new Map()),
    [allSets, facetIndex],
  );
  const materials = useMemo(() => {
    const keep = narrow(materialItems.items, facetSel);
    return (allMaterials ?? []).filter((m) => keep.has(m.name));
  }, [allMaterials, materialItems, facetSel]);
  const sets = useMemo(() => {
    if (!allSets) return null;
    const keep = narrow(setItems.items, facetSel);
    return allSets.filter((x) => keep.has(x.key));
  }, [allSets, setItems, facetSel]);
  const fullMaterial = (name: string) => catalogue?.materials.find((m) => m.name === name)?.guids ?? [];
  const fullSet = (key: string) => catalogue?.sets?.find((x) => x.key === key)?.guids ?? [];
  const types = useMemo(() => new Map((catalogue?.types ?? []).map((c) => [c.key, c])), [catalogue]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  // A card click makes its elements the one filter; the card is marked
  // while it is (read off the filter, never a copy of it).
  const origin = xview.origin === "materials";
  const picked = origin ? xview.key : null;
  const pick = (key: string, label: string, guids: string[]) =>
    onDispatch({
      type: "choose",
      origin: "materials",
      key,
      filter: { kind: "material", label, guids },
      scope: { kind: "element", guids },
    });

  // A type's material link lands here: the Materialer view, that card in
  // view and marked until the next request.
  const [revealed, setRevealed] = useState<string | null>(null);
  const handled = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    setView("materials");
    setRevealed(reveal.key);
    // The asked-for card is shown even if a facet had hidden it.
    setFacetSel({});
  }, [reveal]);
  const revealRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    revealRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealed, view]);

  return (
    <section ref={fillRef} style={{ height: fillHeight ?? undefined }} className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden">
      <FacetBar
        lang={lang}
        facets={MATERIAL_FACETS}
        items={view === "materials" ? materialItems : setItems}
        sel={facetSel}
        onChange={setFacetSel}
        lead={
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
        }
        trail={
          <span className="font-mono text-[10px] tabular-nums text-muted">
            {view === "materials"
              ? formatCount(materials.length, lang)
              : sets
                ? `${sets.some((set) => set.name === null) ? `IfcMaterialLayerSet.Name ${notSupplied} · ` : ""}${formatCount(sets.length, lang)}`
                : notSupplied}
          </span>
        }
      />
      <WithViewer meshBatches={meshBatches} active>
      <div className="contents" data-xf={origin ? "origin" : undefined}>
      {view === "materials" ? (
        (allMaterials ?? []).length === 0 ? (
          <Empty>{profile ? t("type.none", lang) : notSupplied}</Empty>
        ) : (
          <Gallery unit={[2, 2]} label="materials">
            {materials.map((line) => (
              <MaterialCardView
                key={line.name}
                lang={lang}
                line={line}
                links={catalogue?.materialTypes.get(line.name) ?? []}
                types={types}
                active={picked === `material:${line.name}`}
                revealed={revealed === line.name}
                cardRef={revealed === line.name ? revealRef : undefined}
                onClick={() => pick(`material:${line.name}`, line.name, fullMaterial(line.name))}
                onOpenType={onOpenType}
              />
            ))}
          </Gallery>
        )
      ) : sets === null ? (
        <Empty>{`materialsJson() · ${notSupplied}`}</Empty>
      ) : (allSets ?? []).length === 0 ? (
        <Empty>{t("type.none", lang)}</Empty>
      ) : (
        <Gallery unit={[2, 2]} label="sets">
          {sets.map((set) => (
            <SetCardView
              key={set.key}
              lang={lang}
              set={set}
              links={catalogue?.setTypes.get(set.key) ?? []}
              types={types}
              active={picked === `set:${set.key}`}
              onClick={() => pick(`set:${set.key}`, set.name ?? set.key, fullSet(set.key))}
              onOpenType={onOpenType}
            />
          ))}
        </Gallery>
      )}
      </div>
      </WithViewer>
    </section>
  );
}

/** One material card (the Materialer tab, and under the Typer viewer). */
export function MaterialCardView({
  lang,
  line,
  links,
  types,
  active,
  revealed,
  cardRef,
  onClick,
  onOpenType,
}: {
  lang: Lang;
  line: MaterialCard;
  links: Link[];
  types: Map<string, TypeCard>;
  active: boolean;
  revealed?: boolean;
  cardRef?: Ref<HTMLDivElement>;
  onClick: () => void;
  onOpenType: (key: string) => void;
}) {
  return (
    <GalleryCard
      title={`${line.name} · ${line.entities.join(", ")}`}
      active={active}
      onClick={onClick}
      cardRef={cardRef}
      data={{ "data-material-card": line.name, "data-revealed": revealed ? "" : undefined }}
    >
      <div className="gallery-swatch m-2.5 mb-0 h-10 shrink-0 rounded-[8px]" />
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 pt-1.5 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 font-mono text-[11.5px] leading-snug break-all text-ink">
            {line.name}
          </span>
          <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums" title={t("col.elements", lang)}>
            {formatCount(line.guids.length, lang)}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-auto" data-material-types>
          <TypeLinks links={links} types={types} onOpenType={onOpenType} />
        </div>
      </div>
    </GalleryCard>
  );
}

/** One layer set card: the layers as a strip in proportion to thickness. */
export function SetCardView({
  lang,
  set,
  links,
  types,
  active,
  onClick,
  onOpenType,
}: {
  lang: Lang;
  set: LayerSetCard;
  links: Link[];
  types: Map<string, TypeCard>;
  active: boolean;
  onClick: () => void;
  onOpenType: (key: string) => void;
}) {
  return (
    <GalleryCard title={set.name ?? undefined} active={active} onClick={onClick} data={{ "data-set-card": set.key }}>
      <div data-layer-set className="flex min-h-0 flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
            {set.name ?? set.layers.map((l) => l.material ?? "—").join(" · ")}
          </span>
          <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums">{formatCount(set.count, lang)}</span>
        </div>
        <LayerStrip layers={set.layers} lang={lang} />
        <div className="font-mono text-[10px] text-muted tabular-nums">
          {`${formatCount(set.layers.length, lang)} · ${set.total === null ? "—" : mm(set.total, lang)}`}
        </div>
        <div className="min-h-0 flex-[3_1_0] overflow-auto">
          {set.layers.map((layer, i) => (
            <div key={i} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[15px] text-muted">
              <LayerSwatch material={layer.material} thickness={layer.thickness} />
              <span className="w-14 shrink-0 text-right text-ink tabular-nums">{layer.thickness === null ? "—" : mm(layer.thickness, lang)}</span>
              <span className="min-w-0 truncate">{layer.material ?? "—"}</span>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-[2_1_0] flex-wrap content-start gap-1 overflow-auto" data-set-types>
          <TypeLinks links={links} types={types} onOpenType={onOpenType} />
        </div>
      </div>
    </GalleryCard>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">{children}</div>;
}

/** A layer's CSS background: the category's hatch over its fill (the cards'
 *  strip and swatches; the 1:20 section draws the same in SVG). */
const INKA = (a: number) => `rgb(20 26 34 / ${a})`;
const HATCH_CSS: Partial<Record<LayerCategory, string>> = {
  insulation: `repeating-linear-gradient(60deg, ${INKA(0.4)} 0 1px, transparent 1px 6px), repeating-linear-gradient(-60deg, ${INKA(0.4)} 0 1px, transparent 1px 6px)`,
  concrete: `radial-gradient(${INKA(0.55)} 0.8px, transparent 1.3px) 0 0 / 5px 5px`,
  gypsum: `repeating-linear-gradient(45deg, ${INKA(0.35)} 0 1px, transparent 1px 3px)`,
  wood: `repeating-linear-gradient(90deg, ${INKA(0.35)} 0 1px, transparent 1px 4px)`,
  masonry: `repeating-linear-gradient(45deg, ${INKA(0.45)} 0 1px, transparent 1px 5px)`,
};
function layerBackground(material: string | null, category: LayerCategory): string {
  const fill = layerFill(material, category);
  const hatch = HATCH_CSS[category];
  const base = fill ? css(fill) : "var(--color-panel)";
  return hatch ? `${hatch}, ${base}` : base;
}

/** A small swatch in the layer's colour and hatch, for the layer lists. */
export function LayerSwatch({ material, thickness }: { material: string | null; thickness: number | null }) {
  const unknown = thickness === null || !(thickness > 0);
  return (
    <span
      className={"inline-block h-2.5 w-3.5 shrink-0 self-center rounded-[2px] border border-line" + (unknown ? " gallery-layer-unknown" : "")}
      style={unknown ? undefined : { background: layerBackground(material, materialCategory(material)) }}
      data-layer-category={materialCategory(material)}
    />
  );
}

/** The layers, side by side in the order of the set, each as wide as its
 *  thickness is of the total, in the material's colour and hatch, the mm on
 *  a layer wide enough to hold it. A layer with no thickness takes an equal
 *  share and is hatched, so it cannot pass for a measure. */
export function LayerStrip({ layers, lang }: { layers: LayerSetCard["layers"]; lang: Lang }) {
  const known = layers.filter((l) => l.thickness !== null && l.thickness > 0);
  const sum = known.reduce((s, l) => s + (l.thickness ?? 0), 0);
  const unknownShare = layers.length > 0 ? (layers.length - known.length) / layers.length : 0;
  return (
    <div className="flex h-11 shrink-0 overflow-hidden rounded-[6px] border border-ink/40" data-layer-strip>
      {layers.map((layer, i) => {
        const has = layer.thickness !== null && layer.thickness > 0;
        const share = has ? ((layer.thickness ?? 0) / sum) * (1 - unknownShare) : 1 / layers.length;
        const category = materialCategory(layer.material);
        return (
          <span
            key={i}
            title={`${layer.thickness === null ? "—" : mm(layer.thickness, lang)} · ${layer.material ?? "—"}`}
            className={"gallery-layer flex h-full min-w-[3px] items-end justify-center overflow-hidden" + (has ? "" : " gallery-layer-unknown")}
            data-layer-category={category}
            style={{ flex: `${Math.max(share, 0.0001)} 1 0`, background: has ? layerBackground(layer.material, category) : undefined }}
          >
            {has && share >= 0.16 ? (
              <span className="mb-0.5 rounded-[3px] bg-panel/85 px-0.5 font-mono text-[9.5px] leading-[12px] text-ink tabular-nums">
                {Math.round(layer.thickness ?? 0)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** The type page's section: a piece of the element cut through its
 *  thickness at an honest 1:20 (`layer-section.ts`), break lines at the open
 *  ends, the dimension chain with the total, each layer's thickness and
 *  material on a leader, and a scale bar. Too thick for its tile, it scrolls
 *  there; it never rescales. */
export function LayerSection({ layers, entity, lang }: { layers: LayerSetCard["layers"]; entity: string; lang: Lang }) {
  const id = useId().replace(/:/g, "");
  const section = layerSection(layers);
  const orientation = sectionOrientation(entity);
  const notSupplied = t("type.notSupplied", lang);
  const texts = section.bands.map((b) => `${b.unknown ? notSupplied : mm(b.thickness ?? 0, lang)}  ${b.material ?? "—"}`);
  const f = sectionFrame(section, orientation, texts.map((s) => s.length));
  const p = f.piece;
  const vertical = orientation === "vertical";
  const ink = "var(--color-ink)";
  // A break line across an open end: straight, with the Z in the middle.
  const brk = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return vertical
      ? `M${x1 - 5} ${y1}H${mx - 3}L${mx - 1} ${my - 4}L${mx + 1} ${my + 4}L${mx + 3} ${my}H${x2 + 5}`
      : `M${x1} ${y1 - 5}V${my - 3}L${mx + 4} ${my - 1}L${mx - 4} ${my + 1}L${mx} ${my + 3}V${y2 + 5}`;
  };
  const pat = (c: LayerCategory, unknown: boolean) => (unknown ? `${id}-unknown` : HATCH_CSS[c] ? `${id}-${c}` : null);
  const total = section.totalMm === null ? `— (${notSupplied})` : mm(section.totalMm, lang);
  const tick = (v: number) => (vertical ? `M${v - 2.5} ${f.dim.y1 + 2.5}L${v + 2.5} ${f.dim.y1 - 2.5}` : `M${f.dim.x1 - 2.5} ${v + 2.5}L${f.dim.x1 + 2.5} ${v - 2.5}`);
  const steps = BAR_MM / 100;
  return (
    <svg
      width={f.width}
      height={f.height}
      className="block font-mono text-[10px]"
      data-layer-section={orientation}
      data-px-per-mm={section.pxPerMm.toFixed(4)}
      role="img"
      aria-label={`1:20 · ${texts.join(" · ")} · ${total}`}
    >
      <defs>
        {/* Wood grain runs along the element: across the cut's thickness. */}
        <pattern id={`${id}-insulation`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 0L6 6M6 0L0 6" stroke={ink} strokeOpacity="0.45" strokeWidth="0.6" />
        </pattern>
        <pattern id={`${id}-concrete`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.7" fill={ink} fillOpacity="0.55" />
          <circle cx="4.5" cy="4.2" r="0.5" fill={ink} fillOpacity="0.55" />
        </pattern>
        <pattern id={`${id}-gypsum`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V3" stroke={ink} strokeOpacity="0.35" strokeWidth="0.6" />
        </pattern>
        <pattern id={`${id}-wood`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={vertical ? "rotate(90)" : undefined}>
          <path d="M0 2H4" stroke={ink} strokeOpacity="0.4" strokeWidth="0.6" />
        </pattern>
        <pattern id={`${id}-masonry`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V5" stroke={ink} strokeOpacity="0.5" strokeWidth="0.6" />
        </pattern>
        <pattern id={`${id}-unknown`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
          <rect width="6" height="6" fill="var(--color-panel)" />
          <path d="M0 0V6" stroke="var(--color-line)" strokeWidth="3" />
        </pattern>
      </defs>

      {section.bands.map((b) => {
        const r = vertical ? { x: p.x + b.at, y: p.y, width: b.size, height: p.h } : { x: p.x, y: p.y + b.at, width: p.w, height: b.size };
        const fill = layerFill(b.material, b.category);
        const hatch = pat(b.category, b.unknown);
        return (
          <g key={b.index} data-section-layer={b.index} data-layer-category={b.category} data-unknown={b.unknown ? "" : undefined}>
            <title>{texts[b.index]}</title>
            {!b.unknown ? <rect {...r} fill={fill ? css(fill) : "var(--color-panel)"} /> : null}
            {hatch ? <rect {...r} fill={`url(#${hatch})`} /> : null}
            {b.index > 0 ? (
              <path d={vertical ? `M${r.x} ${p.y}V${p.y + p.h}` : `M${p.x} ${r.y}H${p.x + p.w}`} stroke={ink} strokeOpacity="0.55" strokeWidth="0.5" />
            ) : null}
          </g>
        );
      })}
      {/* The cut faces, solid; the open ends, break lines. */}
      <path
        d={vertical ? `M${p.x} ${p.y}V${p.y + p.h}M${p.x + p.w} ${p.y}V${p.y + p.h}` : `M${p.x} ${p.y}H${p.x + p.w}M${p.x} ${p.y + p.h}H${p.x + p.w}`}
        stroke={ink}
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d={
          vertical
            ? `${brk(p.x, p.y, p.x + p.w, p.y)}${brk(p.x, p.y + p.h, p.x + p.w, p.y + p.h)}`
            : `${brk(p.x, p.y, p.x, p.y + p.h)}${brk(p.x + p.w, p.y, p.x + p.w, p.y + p.h)}`
        }
        stroke={ink}
        strokeWidth="0.8"
        fill="none"
      />

      {/* The dimension chain: a tick per layer face, the total on it. */}
      <g data-section-dim="" stroke={ink} strokeWidth="0.7" fill="none">
        <path d={`M${f.dim.x1} ${f.dim.y1}L${f.dim.x2} ${f.dim.y2}`} />
        {f.dim.ticks.map((v, i) => (
          <path key={i} d={tick(v)} strokeWidth="1" />
        ))}
      </g>
      <text
        x={f.dim.tx}
        y={f.dim.ty}
        fill={ink}
        textAnchor={vertical ? "start" : "middle"}
        transform={vertical ? undefined : `rotate(-90 ${f.dim.tx} ${f.dim.ty})`}
        className="tabular-nums"
        data-section-total={section.totalMm ?? ""}
      >
        {total}
      </text>

      {/* Leaders: a dot in the layer, the line out, thickness and material. */}
      {f.labels.map((l, i) => (
        <g key={i}>
          <circle cx={l.points[0][0]} cy={l.points[0][1]} r="1.4" fill={ink} />
          <polyline points={l.points.map((q) => q.join(",")).join(" ")} stroke={ink} strokeWidth="0.6" fill="none" />
          <text x={l.tx} y={l.ty} fill={ink} className="tabular-nums" data-section-label={i}>
            <tspan fontWeight="600">{section.bands[i].unknown ? notSupplied : mm(section.bands[i].thickness ?? 0, lang)}</tspan>
            <tspan fill="var(--color-muted)">{`  ${section.bands[i].material ?? "—"}`}</tspan>
          </text>
        </g>
      ))}

      {/* Scale bar, 0 to 500 mm in 100 mm steps, and the scale. */}
      <g data-section-bar="">
        {Array.from({ length: steps }, (_, i) => (
          <rect
            key={i}
            x={f.bar.x + (i * f.bar.len) / steps}
            y={f.bar.y}
            width={f.bar.len / steps}
            height="3"
            fill={i % 2 ? "var(--color-panel)" : ink}
            stroke={ink}
            strokeWidth="0.5"
          />
        ))}
        <text x={f.bar.x} y={f.bar.y + 13} fill="var(--color-muted)">0</text>
        <text x={f.bar.x + f.bar.len} y={f.bar.y + 13} fill="var(--color-muted)" textAnchor="middle">{`${BAR_MM} mm`}</text>
        <text x={f.bar.x + f.bar.len + 24} y={f.bar.y + 13} fill={ink} fontWeight="600" data-section-scale="1:20">1:20</text>
      </g>
    </svg>
  );
}
