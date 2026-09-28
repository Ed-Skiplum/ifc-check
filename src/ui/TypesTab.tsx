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
 * through `viewer/dock.ts` as the Graf tab lends it).
 *
 * Owner, 2026-09-28, after two wrong rounds: *"the behaviour when
 * doubleclicking a type is open a type page"*, *"One type - doubleclick -
 * shows that one type with a viewer"*, *"the viewer of course needs to
 * filter on the type."* So a click on a card FILTERS the viewer to the
 * type's instances (a `typecard:` chip under Vis kun, the same chip bar as
 * every other filter), framed; the same card again takes it off. A
 * double-click opens the TYPE PAGE, its own route (`#…&type=<key>`, so Back,
 * Forward and a pasted link work): the gallery is gone, the viewer filtered
 * to that one type, the instance navigator of the G55 QTO-LCA type viewer
 * (`10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/verify_app.html`,
 * worklog 2026-06-17-22-40: `Per forekomst | Alle forekomster`, ‹ › titled
 * `Forrige (↑)` / `Neste (↓)`, ↑ ↓ step the instances and ← → the types), the
 * current instance, the type's facts, and its materials as links. ‹, Esc or
 * the browser's Back returns to the gallery, which stays mounted (unseen)
 * under it, so its scroll holds, and the gallery's filter is handed back.
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
import type { FilterChip, Mode } from "./cross-filter";

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

/** The gallery's filter and selection, handed back when the page closes. */
interface GalleryState {
  chips: FilterChip[];
  selection: string[];
  mode: Mode;
}

/** The filter chip a type card makes: its own instances, isolated. */
const TYPE_CHIP = "typecard:";
function typeChip(row: TypeCard, lang: Lang): FilterChip {
  return {
    key: TYPE_CHIP + row.key,
    kind: "type",
    label: row.typeName ?? t("type.untyped", lang),
    guids: row.guids,
  };
}

export function TypesTab({
  lang,
  profile,
  catalogue,
  meshBatches,
  selection,
  chips,
  mode,
  page,
  onSelect,
  onChips,
  onMode,
  onPage,
  onOpenMaterial,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The streamed geometry, for the card renders and the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** The panel's `view.selection`, for scripts. */
  selection: string[];
  /** The panel's filter chips and mode: a type card filters the viewer. */
  chips: FilterChip[];
  mode: Mode;
  /** The type page's key from the URL hash (`type=`), or null. */
  page: string | null;
  onSelect: (guids: string[]) => void;
  onChips: (chips: FilterChip[]) => void;
  onMode: (mode: Mode) => void;
  /** Open (a key) or leave (null) the type page. `replace` for a step from
   *  one type to the next, so Back still returns to the gallery. */
  onPage: (key: string | null, replace?: boolean) => void;
  onOpenMaterial: (name: string) => void;
}) {
  const rows = useMemo(() => catalogue?.types ?? [], [catalogue]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();
  const storeyName = useMemo(
    () => new Map((profile?.storeys ?? []).map((s) => [s.guid, s.name])),
    [profile],
  );
  const rowOf = useMemo(() => new Map((profile?.rows ?? []).map((r) => [r.guid, r])), [profile]);

  // The card the gallery's filter is on: its chip is in the bar.
  const filtered = chips.find((c) => c.key.startsWith(TYPE_CHIP))?.key.slice(TYPE_CHIP.length) ?? null;

  // The type page: the route's key, once the catalogue has it.
  const card = page ? (byKey.get(page) ?? null) : null;
  const [inst, setInst] = useState<Open | null>(null);
  const open: Open | null = card
    ? inst && inst.key === card.key
      ? inst
      : { key: card.key, pos: 0, all: false }
    : null;

  /** A click filters the viewer to the card's instances (Vis kun), framed;
   *  the same card again takes the filter off. The type facet is replaced,
   *  other facets stay. The second click of a double-click is not a click. */
  const pick = useCallback(
    (row: TypeCard) => {
      prePick.current = { key: row.key, at: performance.now(), state: { chips, selection, mode } };
      const others = chips.filter((c) => c.kind !== "type" && c.kind !== "element");
      if (filtered === row.key) {
        onChips(others);
        return;
      }
      if (mode !== "filter") onMode("filter");
      onSelect([]);
      onChips([...others, typeChip(row, lang)]);
    },
    [chips, filtered, lang, mode, onChips, onMode, onSelect, selection],
  );

  // Opened from the gallery by this tab: Back is the browser's own.
  const openedHere = useRef(false);
  const [lastOpen, setLastOpen] = useState<string | null>(null);
  // A double-click's first click filtered the gallery; what the gallery had
  // is the state before it, and that is what the page hands back.
  const prePick = useRef<{ key: string; at: number; state: GalleryState } | null>(null);
  const openPage = useCallback(
    (row: TypeCard) => {
      openedHere.current = true;
      const pre = prePick.current;
      if (!saved.current && pre && pre.key === row.key && performance.now() - pre.at < 800) saved.current = pre.state;
      onPage(row.key);
    },
    [onPage],
  );
  const closePage = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else onPage(null);
  }, [onPage]);

  // Entering the page saves the gallery's filter and filters to this type
  // alone; leaving hands the gallery's filter back. Driven by the route, so a
  // direct link, Back and Forward all take this path.
  const saved = useRef<GalleryState | null>(null);
  const live = useRef({ chips, selection, mode });
  live.current = { chips, selection, mode };
  const cardKey = card?.key ?? null;
  useEffect(() => {
    if (cardKey && card) {
      if (!saved.current) saved.current = { ...live.current };
      setLastOpen(cardKey);
      onMode("filter");
      onChips([typeChip(card, lang)]);
    } else if (saved.current) {
      const back = saved.current;
      saved.current = null;
      openedHere.current = false;
      onChips(back.chips);
      onSelect(back.selection);
      onMode(back.mode);
    }
    // Only a change of page moves the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  // The current instance, or all of them, is the selection: highlighted and
  // framed inside the filtered viewer.
  const openPos = open?.pos ?? 0;
  const openAll = open?.all ?? false;
  useEffect(() => {
    if (!card) return;
    onSelect(openAll ? card.guids : [card.guids[openPos]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, openPos, openAll]);

  const step = useCallback(
    (delta: number) => {
      if (!open || !card || open.all) return;
      const pos = Math.min(card.guids.length - 1, Math.max(0, open.pos + delta));
      if (pos === open.pos) return;
      setInst({ ...open, pos });
    },
    [open, card],
  );

  const setAll = useCallback(
    (all: boolean) => {
      if (!open || open.all === all) return;
      setInst({ ...open, all });
    },
    [open],
  );

  const stepType = useCallback(
    (delta: number) => {
      if (!open) return;
      const at = rows.findIndex((r) => r.key === open.key);
      const next = rows[at + delta];
      if (next) onPage(next.key, true);
    },
    [open, rows, onPage],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "ArrowRight") stepType(1);
    else if (e.key === "ArrowLeft") stepType(-1);
    else if (e.key === "Escape") closePage();
    else return;
    e.preventDefault();
  };

  // The card the page was on gets focus back when the gallery returns.
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
        // Under the page the gallery stays mounted but unseen, so its scroll
        // is where it was when the page closes.
        <div className={"flex min-h-0 min-w-0 flex-1" + (open ? " invisible" : "")} aria-hidden={open ? true : undefined}>
        <WithViewer meshBatches={meshBatches} active={open === null}>
          <Gallery unit={[2, 2]} label="types">
            {rows.map((row) => {
              const name = row.typeName ?? t("type.untyped", lang);
              return (
                <GalleryCard
                  key={row.key}
                  active={filtered === row.key}
                  title={`${row.entity} · ${name}`}
                  onClick={(e?: { detail?: number }) => {
                    if ((e?.detail ?? 1) > 1) return;
                    pick(row);
                  }}
                  onDoubleClick={() => openPage(row)}
                  cardRef={(lastOpen ?? filtered) === row.key ? pickedRef : undefined}
                  data={{ "data-type-card": row.key, "data-type-count": row.count }}
                >
                  <Thumb batches={meshBatches} row={row} />
                  <CardFoot lang={lang} row={row} name={name} />
                </GalleryCard>
              );
            })}
          </Gallery>
        </WithViewer>
        </div>
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
          onClose={closePage}
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
      data-type-page={row.key}
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
