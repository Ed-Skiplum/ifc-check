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
 * unset). A card is a door, as every row on the board is: it makes a Type chip
 * through the board's own click, so the 3D isolates that type.
 *
 * ── Instance mode (2026-09-28) ───────────────────────────────────────────
 * Owner: *"For types: Single instance selector like in lca_qto, with a toggle
 * for all instances of type. So either see them one by one with a navigation
 * "next/former" or see all."* The reference is the G55 QTO-LCA type viewer
 * (`10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/verify_app.html`,
 * worklog 2026-06-17-22-40): a `Per forekomst | Alle forekomster` toggle, ‹ ›
 * titled `Forrige (↑)` / `Neste (↓)`, ↑ ↓ step the instances and ← → the
 * types. Mirrored here, labels verbatim.
 *
 * Opening a card grows it to XL (3 × 2 cards, 6 × 4 modules) in place and
 * lends it the board's ONE 3D scene (`viewer/dock.ts`, as the Graf tab does).
 * Per forekomst selects one instance, and the viewer frames every new
 * selection; Alle forekomster selects all N. The order is `type-links.ts`'s:
 * by storey from the lowest, then GlobalId. The card lists the materials the
 * type's instances carry, each a link to that material's card.
 *
 * What the demo had that the engine here does not give:
 *   · m³ and m² per type. The demo summed ifcfast's MESHED take-off
 *     (`mesh_qto()`); the wasm build's `qtoJson()` is not read by this app, so
 *     the columns stand and say `ikke levert` rather than print a sum of
 *     nothing.
 *   · the model dots. The demo pooled several models on one page; this tab
 *     lives in one model's panel, so there is one model and no column for it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { Focus } from "./trace";
import { serialiseFocus } from "./trace";
import type { FilterChip } from "./cross-filter";
import type { MeshBatch } from "../viewer/mesh-stream";
import { cachedThumb, requestThumb } from "../viewer/thumbnails";
import { findDock, onDocksChanged } from "../viewer/dock";
import { Gallery, GalleryCard, LinkChip, NoGeometryMark } from "./Gallery";
import { useFillHeight } from "./useFillHeight";
import type { Catalogue, TypeCard } from "./type-links";

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
function Thumb({ batches, row }: { batches: MeshBatch[] | undefined; row: TypeCard }) {
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

/** A request from another tab to open a card, e.g. a material's type link.
 *  `seq` makes the same request twice two requests. */
export interface Reveal {
  key: string;
  seq: number;
}

interface Open {
  key: string;
  pos: number;
  all: boolean;
}

export function TypesTab({
  lang,
  profile,
  catalogue,
  meshBatches,
  selected,
  chips,
  selection,
  reveal,
  onFocus,
  onRemoveChip,
  onSelect,
  onOpenMaterial,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The streamed geometry, for the card renders and the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** `serialiseFocus` key of the open derivation, to mark its card. */
  selected: string | null;
  chips: FilterChip[];
  /** The panel's `view.selection`, printed on the open card for scripts. */
  selection: string[];
  reveal: Reveal | null;
  onFocus: (focus: Focus) => void;
  onRemoveChip: (key: string) => void;
  onSelect: (guids: string[]) => void;
  onOpenMaterial: (name: string) => void;
}) {
  const rows = useMemo(() => catalogue?.types ?? [], [catalogue]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  const [open, setOpen] = useState<Open | null>(null);
  const card = open ? (byKey.get(open.key) ?? null) : null;
  const storeyName = useMemo(
    () => new Map((profile?.storeys ?? []).map((s) => [s.guid, s.name])),
    [profile],
  );
  const rowOf = useMemo(() => new Map((profile?.rows ?? []).map((r) => [r.guid, r])), [profile]);

  const focusOf = (row: TypeCard): Focus => ({ kind: "type", typeName: row.typeName });

  /** Open a card, or close the open one (`row` null). The Type chip and the
   *  derivation follow as they did before the mode existed: opening is the
   *  card's old click, closing undoes it. */
  const openCard = useCallback(
    (row: TypeCard | null) => {
      const prev = open ? byKey.get(open.key) : undefined;
      const prevKey = prev ? serialiseFocus(focusOf(prev)) : null;
      const nextKey = row ? serialiseFocus(focusOf(row)) : null;
      const has = (key: string) => chips.some((c) => c.key === key);
      if (prevKey && prevKey !== nextKey && has(prevKey)) {
        if (row) onRemoveChip(prevKey);
        else onFocus(focusOf(prev!));
      }
      if (row && nextKey && !has(nextKey)) onFocus(focusOf(row));
      if (!row) {
        setOpen(null);
        onSelect([]);
        return;
      }
      setOpen({ key: row.key, pos: 0, all: false });
      onSelect(row.guids.slice(0, 1));
    },
    [open, byKey, chips, onFocus, onRemoveChip, onSelect],
  );

  const step = useCallback(
    (delta: number) => {
      if (!open || !card || open.all) return;
      const pos = Math.min(card.guids.length - 1, Math.max(0, open.pos + delta));
      if (pos === open.pos) return;
      setOpen({ ...open, pos });
      onSelect([card.guids[pos]]);
    },
    [open, card, onSelect],
  );

  const setAll = useCallback(
    (all: boolean) => {
      if (!open || !card || open.all === all) return;
      setOpen({ ...open, all });
      onSelect(all ? card.guids : [card.guids[open.pos]]);
    },
    [open, card, onSelect],
  );

  const stepType = useCallback(
    (delta: number) => {
      if (!open) return;
      const at = rows.findIndex((r) => r.key === open.key);
      const next = rows[at + delta];
      if (next) openCard(next);
    },
    [open, rows, openCard],
  );

  const openRef = useRef<HTMLDivElement>(null);

  // Another tab asked for a card (a material's type link).
  const handled = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    const row = byKey.get(reveal.key);
    if (row && open?.key !== row.key) openCard(row);
    // Already open: bring it back into view and give it the keys.
    else if (row) {
      openRef.current?.scrollIntoView({ block: "nearest" });
      openRef.current?.querySelector<HTMLElement>("[tabindex='-1']")?.focus({ preventScroll: true });
    }
  }, [reveal, byKey, open, openCard]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "ArrowRight") stepType(1);
    else if (e.key === "ArrowLeft") stepType(-1);
    else if (e.key === "Escape") openCard(null);
    else return;
    e.preventDefault();
  };

  // The open card keeps its place in view as it grows or as ← → move it.
  useLayoutEffect(() => {
    openRef.current?.scrollIntoView({ block: "nearest" });
    openRef.current?.querySelector<HTMLElement>("[tabindex='-1']")?.focus({ preventScroll: true });
  }, [open?.key]);

  return (
    <section
      ref={fillRef}
      style={{ height: fillHeight ?? undefined }}
      onKeyDown={onKeyDown}
      className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
    >
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
          {(across) =>
            rows.map((row) => {
              const name = row.typeName ?? t("type.untyped", lang);
              if (card && open && row.key === card.key) {
                return (
                  <OpenCard
                    key={row.key}
                    cardRef={openRef}
                    lang={lang}
                    row={card}
                    name={name}
                    open={open}
                    across={across}
                    meshBatches={meshBatches}
                    selection={selection}
                    materials={catalogue?.typeMaterials.get(card.key) ?? []}
                    storeyOf={(guid) => {
                      const r = rowOf.get(guid);
                      return r?.storeyGuid ? (storeyName.get(r.storeyGuid) ?? r.storeyGuid) : null;
                    }}
                    nameOf={(guid) => rowOf.get(guid)?.name ?? null}
                    onClose={() => openCard(null)}
                    onStep={step}
                    onAll={setAll}
                    onOpenMaterial={onOpenMaterial}
                  />
                );
              }
              const active = selected === serialiseFocus(focusOf(row));
              return (
                <GalleryCard
                  key={row.key}
                  active={active}
                  title={`${row.entity} · ${name}`}
                  onClick={() => openCard(row)}
                  data={{ "data-type-card": row.key, "data-type-count": row.count }}
                >
                  <Thumb batches={meshBatches} row={row} />
                  <CardFoot lang={lang} row={row} name={name} />
                </GalleryCard>
              );
            })
          }
        </Gallery>
      )}
    </section>
  );
}

function CardFoot({ lang, row, name }: { lang: Lang; row: TypeCard; name: string }) {
  return (
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
  );
}

/** The open type: XL in place, the lent 3D on the left, the instance controls,
 *  the current instance and the material links on the right. */
function OpenCard({
  cardRef,
  lang,
  row,
  name,
  open,
  across,
  meshBatches,
  selection,
  materials,
  storeyOf,
  nameOf,
  onClose,
  onStep,
  onAll,
  onOpenMaterial,
}: {
  cardRef: Ref<HTMLDivElement>;
  lang: Lang;
  row: TypeCard;
  name: string;
  open: Open;
  across: number;
  meshBatches: MeshBatch[] | undefined;
  selection: string[];
  materials: { key: string; n: number }[];
  storeyOf: (guid: string) => string | null;
  nameOf: (guid: string) => string | null;
  onClose: () => void;
  onStep: (delta: number) => void;
  onAll: (all: boolean) => void;
  onOpenMaterial: (name: string) => void;
}) {
  const wide = Math.min(3, across);
  const guid = row.guids[open.pos];
  const n = row.guids.length;

  /* ── The viewer, borrowed (as GraphTab borrows it) ─────────────────────── */
  const slot = useRef<HTMLDivElement>(null);
  const [, bumpDocks] = useState(0);
  useEffect(() => onDocksChanged(() => bumpDocks((k) => k + 1)), []);
  const dock = findDock(meshBatches);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setShown(r.width > 0 && r.height > 0);
    };
    // The observer reports once on observe, so no synchronous first call.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!dock || !el || !shown) return;
    el.appendChild(dock.canvas);
    const size = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) dock.scene.resize(r.width, r.height);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);
    return () => {
      observer.disconnect();
      dock.restore();
    };
  }, [dock, shown]);

  const pill = (on: boolean) =>
    "px-2 py-0.5 text-[11px] " + (on ? "bg-ink text-panel" : "bg-input text-muted hover:text-ink");
  const nav =
    "flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-input text-[13px] text-ink disabled:opacity-40";

  return (
    <GalleryCard
      cardRef={cardRef}
      span={[wide, 2]}
      title={`${row.entity} · ${name}`}
      data={{
        "data-type-card": row.key,
        "data-type-open": "",
        "data-instance-mode": open.all ? "all" : "one",
        "data-instance-pos": `${open.pos + 1}/${n}`,
        "data-instance-guid": open.all ? "" : guid,
        "data-selection-count": selection.length,
        "data-selection-first": selection[0] ?? "",
      }}
    >
      <div tabIndex={-1} className={"flex min-h-0 flex-1 outline-none " + (wide >= 2 ? "flex-row" : "flex-col")}>
        <div
          ref={slot}
          data-type-viewer
          className={"relative min-h-0 min-w-0 overflow-hidden rounded-[10px] bg-panel " + (wide >= 2 ? "m-2 mr-0 flex-[2_1_0]" : "m-2 mb-0 flex-1")}
        >
          {dock ? null : (
            <div className="flex h-full items-center justify-center">
              <NoGeometryMark />
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col gap-2 p-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[10px] text-muted">{row.entity}</div>
              <div className="line-clamp-2 font-mono text-[12px] leading-snug break-all text-ink">{name}</div>
            </div>
            <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums">
              {formatCount(n, lang)}
            </span>
            <button
              type="button"
              title={t("inst.close", lang)}
              onClick={onClose}
              className="shrink-0 rounded-[6px] px-1 text-[12px] text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>

          <div role="group" className="flex shrink-0 self-start overflow-hidden rounded-[6px] border border-line">
            <button type="button" aria-pressed={!open.all} data-instance-one onClick={() => onAll(false)} className={pill(!open.all)}>
              {t("inst.one", lang)}
            </button>
            <button type="button" aria-pressed={open.all} data-instance-all onClick={() => onAll(true)} className={pill(open.all)}>
              {t("inst.all", lang)}
            </button>
          </div>

          {open.all ? (
            <div className="font-mono text-[11px] text-ink tabular-nums" data-instance-counter>
              {`${formatCount(n, lang)} / ${formatCount(n, lang)}`}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" title={t("inst.prev", lang)} data-instance-prev disabled={open.pos === 0} onClick={() => onStep(-1)} className={nav}>
                ‹
              </button>
              <span className="min-w-[4.5rem] text-center font-mono text-[11px] text-ink tabular-nums" data-instance-counter>
                {`${open.pos + 1} / ${n}`}
              </span>
              <button type="button" title={t("inst.next", lang)} data-instance-next disabled={open.pos >= n - 1} onClick={() => onStep(1)} className={nav}>
                ›
              </button>
            </div>
          )}

          {open.all ? null : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] leading-[14px] tabular-nums">
              <dt className="text-muted">{t("col.name", lang)}</dt>
              <dd className="truncate text-ink" title={nameOf(guid) ?? ""}>{nameOf(guid) ?? "—"}</dd>
              <dt className="text-muted">{t("col.guid", lang)}</dt>
              <dd className="truncate text-ink" title={guid}>{guid}</dd>
              <dt className="text-muted">{t("col.storey", lang)}</dt>
              <dd className="truncate text-ink">{storeyOf(guid) ?? t("matrix.noStorey", lang)}</dd>
            </dl>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <div className="font-mono text-[10px] text-muted">{t("col.materials", lang)}</div>
            <div className="flex min-h-0 flex-wrap content-start gap-1 overflow-auto" data-type-materials>
              {materials.length === 0 ? (
                <span className="font-mono text-[10px] text-muted">—</span>
              ) : (
                materials.map((m) => (
                  <LinkChip
                    key={m.key}
                    label={m.key}
                    n={m.n}
                    onOpen={() => onOpenMaterial(m.key)}
                    data={{ "data-link-material": m.key }}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </GalleryCard>
  );
}
