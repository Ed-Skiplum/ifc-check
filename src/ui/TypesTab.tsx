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
 * unset).
 *
 * ── The viewer and the type view (2026-09-28) ────────────────────────────
 * Owner: *"you didnt add a viewer to my types and materials dash"*, then on
 * the card that grew in place: *"this doesnt work. Open a full page type view
 * on doubleclick rather than this inline card viewer."*
 *
 * The board's ONE 3D scene sits beside the gallery (`BoardViewer.tsx`, lent
 * through `viewer/dock.ts` as the Graf tab lends it). A click on a card
 * selects the type's instances there, and the viewer frames every new
 * selection. A double-click opens the TYPE VIEW over the tab: the viewer as
 * the hero, the instance navigator of the G55 QTO-LCA type viewer
 * (`10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/verify_app.html`,
 * worklog 2026-06-17-22-40: `Per forekomst | Alle forekomster`, ‹ › titled
 * `Forrige (↑)` / `Neste (↓)`, ↑ ↓ step the instances and ← → the types), the
 * current instance, the type's facts, and its materials as links. Back or Esc
 * returns to the gallery, which stays mounted under it, so its scroll holds.
 * The instance order is `type-links.ts`'s: by storey from the lowest, then
 * GlobalId.
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
import type { KeyboardEvent, ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { MeshBatch } from "../viewer/mesh-stream";
import { cachedThumb, requestThumb } from "../viewer/thumbnails";
import { Gallery, GalleryCard, LinkChip, NoGeometryMark } from "./Gallery";
import { LentViewer, WithViewer, useTabGrid, viewerSpan } from "./BoardViewer";
import { MG_GAP } from "./alt/module-grid";
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
  selection,
  reveal,
  onSelect,
  onOpenMaterial,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The streamed geometry, for the card renders and the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** The panel's `view.selection`, to mark the picked card and for scripts. */
  selection: string[];
  reveal: Reveal | null;
  onSelect: (guids: string[]) => void;
  onOpenMaterial: (name: string) => void;
}) {
  const rows = useMemo(() => catalogue?.types ?? [], [catalogue]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const card = open ? (byKey.get(open.key) ?? null) : null;
  const storeyName = useMemo(
    () => new Map((profile?.storeys ?? []).map((s) => [s.guid, s.name])),
    [profile],
  );
  const rowOf = useMemo(() => new Map((profile?.rows ?? []).map((r) => [r.guid, r])), [profile]);

  // A selection cleared elsewhere unmarks the card.
  useEffect(() => {
    if (selection.length === 0) setPicked(null);
  }, [selection.length]);

  const pick = useCallback(
    (row: TypeCard) => {
      setPicked(row.key);
      onSelect(row.guids);
    },
    [onSelect],
  );

  const openView = useCallback(
    (row: TypeCard) => {
      setPicked(row.key);
      setOpen({ key: row.key, pos: 0, all: false });
      onSelect(row.guids.slice(0, 1));
    },
    [onSelect],
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
      if (next) openView(next);
    },
    [open, rows, openView],
  );

  // Another tab asked for a type (a material's type link): its view opens.
  const handled = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    const row = byKey.get(reveal.key);
    if (row) openView(row);
  }, [reveal, byKey, openView]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "ArrowRight") stepType(1);
    else if (e.key === "ArrowLeft") stepType(-1);
    else if (e.key === "Escape") setOpen(null);
    else return;
    e.preventDefault();
  };

  // The picked card back in view when the gallery returns.
  const pickedRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) pickedRef.current?.focus({ preventScroll: true });
    wasOpen.current = open !== null;
  }, [open]);

  return (
    <section
      ref={fillRef}
      style={{ height: fillHeight ?? undefined }}
      onKeyDown={onKeyDown}
      className="relative flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
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
        <WithViewer meshBatches={meshBatches} active={open === null}>
          <Gallery unit={[2, 2]} label="types">
            {rows.map((row) => {
              const name = row.typeName ?? t("type.untyped", lang);
              return (
                <GalleryCard
                  key={row.key}
                  active={picked === row.key}
                  title={`${row.entity} · ${name}`}
                  onClick={() => pick(row)}
                  onDoubleClick={() => openView(row)}
                  cardRef={picked === row.key ? pickedRef : undefined}
                  data={{ "data-type-card": row.key, "data-type-count": row.count }}
                >
                  <Thumb batches={meshBatches} row={row} />
                  <CardFoot lang={lang} row={row} name={name} />
                </GalleryCard>
              );
            })}
          </Gallery>
        </WithViewer>
      )}
      {card && open ? (
        <TypeView
          lang={lang}
          row={card}
          name={card.typeName ?? t("type.untyped", lang)}
          open={open}
          meshBatches={meshBatches}
          selection={selection}
          materials={catalogue?.typeMaterials.get(card.key) ?? []}
          storeyOf={(guid) => {
            const r = rowOf.get(guid);
            return r?.storeyGuid ? (storeyName.get(r.storeyGuid) ?? r.storeyGuid) : null;
          }}
          nameOf={(guid) => rowOf.get(guid)?.name ?? null}
          onClose={() => setOpen(null)}
          onStep={step}
          onAll={setAll}
          onOpenMaterial={onOpenMaterial}
        />
      ) : null}
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

/** A tile of the type view: M, 3 × 2 modules. */
function Tile({ children, data }: { children: ReactNode; data?: Record<`data-${string}`, string | number | undefined> }) {
  return (
    <div className="gallery-card flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden p-2.5" style={{ gridColumn: "span 3", gridRow: "span 2" }} {...data}>
      {children}
    </div>
  );
}

/** The type view: over the whole tab, on the tab's grid. The lent 3D is the
 *  hero (XL); the instance navigator, the type's facts and its materials are
 *  M tiles beside it, or under it where the tab is too narrow. */
function TypeView({
  lang,
  row,
  name,
  open,
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
  lang: Lang;
  row: TypeCard;
  name: string;
  open: Open;
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
  const guid = row.guids[open.pos];
  const n = row.guids.length;
  const { ref: gridRef, grid } = useTabGrid<HTMLDivElement>();
  // The hero keeps one M tile beside it; under 9 columns it spans the row and
  // the tiles go under it.
  const [hw, hh] = grid ? (grid.cols >= 9 ? viewerSpan(grid, 3) : viewerSpan({ ...grid, rows: 99 }, 0)) : [0, 0];

  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [row.key]);

  const pill = (on: boolean) =>
    "px-2 py-0.5 text-[11px] " + (on ? "bg-ink text-panel" : "bg-input text-muted hover:text-ink");
  const nav =
    "flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-input text-[13px] text-ink disabled:opacity-40";
  const facts = "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] leading-[14px] tabular-nums";

  return (
    <div
      ref={root}
      tabIndex={-1}
      className="absolute inset-0 z-10 flex flex-col bg-ground outline-none"
      data-type-view={row.key}
      data-type-card={row.key}
      data-type-open=""
      data-instance-mode={open.all ? "all" : "one"}
      data-instance-pos={`${open.pos + 1}/${n}`}
      data-instance-guid={open.all ? "" : guid}
      data-selection-count={selection.length}
      data-selection-first={selection[0] ?? ""}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pt-1">
        <button
          type="button"
          title={t("inst.close", lang)}
          onClick={onClose}
          data-type-back
          className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-input text-[13px] text-ink hover:border-ink"
        >
          ‹
        </button>
        <span className="shrink-0 font-mono text-[10px] text-muted">{row.entity}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-ink">{name}</span>
      </div>
      <div ref={gridRef} className="min-h-0 flex-1 overflow-auto">
        {grid ? (
          <div
            className="grid justify-center"
            data-type-view-grid={`${grid.cols},${grid.rows},${hw}x${hh}`}
            style={{
              padding: MG_GAP,
              gap: MG_GAP,
              gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
              gridAutoRows: `${grid.u}px`,
              gridAutoFlow: "row dense",
            }}
          >
            <LentViewer
              meshBatches={meshBatches}
              active
              style={{ gridColumn: `1 / span ${hw}`, gridRow: `1 / span ${hh}` }}
              data={{ "data-type-viewer": "", "data-viewer-span": `${hw}x${hh}` }}
            />

            <Tile data={{ "data-type-instance": "" }}>
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
                <>
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
                  <dl className={facts}>
                    <dt className="text-muted">{t("col.name", lang)}</dt>
                    <dd className="truncate text-ink" title={nameOf(guid) ?? ""}>{nameOf(guid) ?? "—"}</dd>
                    <dt className="text-muted">{t("col.guid", lang)}</dt>
                    <dd className="truncate text-ink" title={guid}>{guid}</dd>
                    <dt className="text-muted">{t("col.storey", lang)}</dt>
                    <dd className="truncate text-ink">{storeyOf(guid) ?? t("matrix.noStorey", lang)}</dd>
                  </dl>
                </>
              )}
            </Tile>

            <Tile data={{ "data-type-facts": "" }}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">{row.entity}</span>
                <span className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums">{formatCount(n, lang)}</span>
              </div>
              <div className="line-clamp-2 font-mono text-[12px] leading-snug break-all text-ink">
                {name}
                {row.source && row.source !== "ifctype" && row.typeName ? (
                  <span className="ml-1.5 text-[9px] text-muted uppercase">{row.source}</span>
                ) : null}
              </div>
              <dl className={facts}>
                {row.typeGuids.length > 0 ? (
                  <>
                    <dt className="text-muted">{t("col.guid", lang)}</dt>
                    <dd className="truncate text-ink" title={row.typeGuids.join("\n")}>
                      {row.typeGuids.length > 1 ? `${row.typeGuids[0]} +${row.typeGuids.length - 1}` : row.typeGuids[0]}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted">IsExternal</dt>
                <dd className="text-right">
                  <Tri value={row.ext} />
                </dd>
                <dt className="text-muted">LoadBearing</dt>
                <dd className="text-right">
                  <Tri value={row.lb} />
                </dd>
              </dl>
            </Tile>

            <Tile data={{ "data-type-materials-tile": "" }}>
              <div className="font-mono text-[10px] text-muted">{t("col.materials", lang)}</div>
              <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-auto" data-type-materials>
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
            </Tile>
          </div>
        ) : null}
      </div>
    </div>
  );
}
