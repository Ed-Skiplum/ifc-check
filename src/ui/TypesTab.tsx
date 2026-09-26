/** Typer: the type extraction, one CARD per IFC class × type name.
 *
 * A gallery since 2026-09-26 (owner: "the types and materials tabs need to be
 * galleries, not rows"). Each card shows a small render of a representative
 * element of the type (`viewer/thumbnails.ts`: one element's triangles from
 * the streamed batches, one shared offscreen context, lazy and cached), then
 * class, type name, instances, and IsExternal / LoadBearing as the row did.
 *
 * The ifcfast demo's Types view (`ifc-fast-demo/components/views/
 * types-view.tsx`), on this model's profile: how many elements carry each
 * type, and whether they agree on IsExternal and LoadBearing (true · false ·
 * unset). A row is a door, as every row on the board is: it makes a Type chip
 * through the board's own click, so the 3D isolates that type.
 *
 * What the demo had that the engine here does not give:
 *   · m³ and m² per type. The demo summed ifcfast's MESHED take-off
 *     (`mesh_qto()`); the wasm build's `qtoJson()` is not read by this app, so
 *     the columns stand and say `ikke levert` rather than print a sum of
 *     nothing.
 *   · the model dots. The demo pooled several models on one page; this tab
 *     lives in one model's panel, so there is one model and no column for it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { Focus } from "./trace";
import { serialiseFocus } from "./trace";
import type { MeshBatch } from "../viewer/mesh-stream";
import { cachedThumb, requestThumb } from "../viewer/thumbnails";
import { Gallery, GalleryCard, NoGeometryMark } from "./Gallery";
import { useFillHeight } from "./useFillHeight";

interface TypeRow {
  key: string;
  entity: string;
  typeName: string | null;
  source: string | null;
  count: number;
  guids: string[];
  ext: [number, number, number];
  lb: [number, number, number];
}

function bump(tally: [number, number, number], value: boolean | null | undefined) {
  if (value === true) tally[0] += 1;
  else if (value === false) tally[1] += 1;
  else tally[2] += 1;
}

function typeRows(profile: ModelProfile): TypeRow[] {
  const rows = new Map<string, TypeRow>();
  for (const product of profile.rows) {
    if (product.isOpening) continue;
    const typeName = product.typeName ?? null;
    const key = `${product.entity}::${typeName ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        entity: product.entity,
        typeName,
        source: product.typeSource ?? null,
        count: 0,
        guids: [],
        ext: [0, 0, 0],
        lb: [0, 0, 0],
      };
      rows.set(key, row);
    }
    row.count += 1;
    row.guids.push(product.guid);
    bump(row.ext, product.isExternal);
    bump(row.lb, product.loadBearing);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}

/** true · false · unset, the demo's badge: one number when the whole type
 *  agrees, the three counts when it does not. */
function Tri({ value }: { value: [number, number, number] }) {
  const [yes, no, unset] = value;
  if (yes > 0 && no === 0 && unset === 0) return <span className="text-ink">{`${yes} ✓`}</span>;
  if (no > 0 && yes === 0 && unset === 0) return <span className="text-ink">{`${no} ✗`}</span>;
  if (unset > 0 && yes === 0 && no === 0) return <span className="text-muted">{`${unset} —`}</span>;
  return <span title={`${yes} ✓ · ${no} ✗ · ${unset} —`}>{`${yes}·${no}·${unset}`}</span>;
}

/** The render of a representative element, asked for when the card scrolls
 *  into view; the dashed cube when the type has no streamed geometry. */
function Thumb({ batches, row }: { batches: MeshBatch[] | undefined; row: TypeRow }) {
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(() =>
    batches ? cachedThumb(batches, row.key) : undefined,
  );

  useEffect(() => {
    const el = box.current;
    if (!batches || !el || url !== undefined) return;
    let cancel: (() => void) | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || cancel) return;
        cancel = requestThumb(batches, row.key, row.guids, setUrl);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancel?.();
    };
  }, [batches, row, url]);

  return (
    <div ref={box} data-thumb={url ? "render" : url === null ? "none" : "pending"} className="flex min-h-0 flex-1 items-center justify-center">
      {url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
      ) : url === null ? (
        <NoGeometryMark />
      ) : null}
    </div>
  );
}

export function TypesTab({
  lang,
  profile,
  meshBatches,
  selected,
  onFocus,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** The streamed geometry, for the card renders. */
  meshBatches: MeshBatch[] | undefined;
  /** `serialiseFocus` key of the open derivation, to mark its card. */
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const rows = useMemo(() => (profile ? typeRows(profile) : []), [profile]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();

  return (
    <section ref={fillRef} style={{ height: fillHeight ?? undefined }} className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-1 font-mono text-[10px] text-muted tabular-nums">
        <span>{`${formatCount(rows.length, lang)} · ${t("col.instances", lang)} ${formatCount(
          rows.reduce((sum, r) => sum + r.count, 0),
          lang,
        )}`}</span>
        <span className="ml-auto">{`m³ · m² ${notSupplied}`}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">
          {profile ? t("type.none", lang) : notSupplied}
        </div>
      ) : (
        <Gallery unit={[2, 2]} label="types">
          {rows.map((row) => {
            const focus: Focus = { kind: "type", typeName: row.typeName };
            const active = selected === serialiseFocus(focus);
            const name = row.typeName ?? t("type.untyped", lang);
            return (
              <GalleryCard
                key={row.key}
                active={active}
                title={`${row.entity} · ${name}`}
                onClick={() => onFocus(focus)}
              >
                <Thumb batches={meshBatches} row={row} />
                <div className="flex shrink-0 flex-col gap-0.5 px-2.5 pt-1 pb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">{row.entity}</span>
                    <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums">
                      {formatCount(row.count, lang)}
                    </span>
                  </div>
                  <div className="line-clamp-2 font-mono text-[11.5px] leading-snug break-all text-ink">
                    {name}
                    {row.source && row.source !== "ifctype" && row.typeName ? (
                      <span className="ml-1.5 text-[9px] text-muted uppercase">{row.source}</span>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[10px] leading-[14px] text-muted tabular-nums">
                    <dt>IsExternal</dt>
                    <dd className="text-right">
                      <Tri value={row.ext} />
                    </dd>
                    <dt>LoadBearing</dt>
                    <dd className="text-right">
                      <Tri value={row.lb} />
                    </dd>
                  </dl>
                </div>
              </GalleryCard>
            );
          })}
        </Gallery>
      )}
    </section>
  );
}
