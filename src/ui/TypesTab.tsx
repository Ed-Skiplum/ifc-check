/** Typer: the type extraction, one CARD per IFC class × type name.
 *
 * A gallery since 2026-09-26 (owner: "the types and materials tabs need to be
 * galleries, not rows"). Each card shows a small render of a representative
 * element of the type (`viewer/thumbnails.ts`: one element's triangles from
 * the streamed batches, one shared offscreen context, lazy and cached), then
 * class, type name, instances, its system and function classification, and
 * IsExternal / LoadBearing as the row did.
 *
 * The ifcfast demo's Types view (`ifc-fast-demo/components/views/
 * types-view.tsx`), on this model's profile: how many elements carry each
 * type, and whether they agree on IsExternal and LoadBearing (true · false ·
 * unset).
 *
 * ── The classification lines (2026-09-28) ────────────────────────────────
 * Owner: *"the type cards need to show the system classification and
 * function classification: ns3451 vs ns3457-8 (or their fallback values
 * ifctypeobject and predefined type)"*. `typeCodes` (`type-links.ts`), read
 * off the board's code trees, the path the Systemkode and Funksjonskode
 * requirements count by. A fallback is in italics, other values as +n.
 *
 * ── The viewer and the type page (2026-09-28) ────────────────────────────
 * The board's ONE 3D scene sits beside the gallery (`BoardViewer.tsx`, lent
 * through `viewer/dock.ts` as the Graf tab lends it). A click on a card makes
 * the type's instances THE filter (origin `types`, one origin, 2026-09-28):
 * the gallery keeps every card and dims all but the chosen one, the viewer
 * and every other view isolate to the instances; the same card again clears
 * it. A filter from any other view isolates the gallery instead: only the
 * types with matching instances, their counts recomputed. A click on an
 * object in the viewer only selects it: the card's filter stays
 * (`filter-state.ts`, 2026-09-29). Under the viewer,
 * the chosen type's material cards and layer set cards (owner: *"there is an
 * unused space below the viewer. Would be cool to show the material cards
 * tied to the selected type"*); a click there makes that material the filter
 * (origin `type-materials`). No type chosen, the space stays empty.
 *
 * A double-click opens the TYPE PAGE (`TypePage.tsx`, data `type-page.ts`),
 * its own route (`#…&type=<key>`, so Back, Forward and a pasted link work).
 * Per forekomst ISOLATES the current instance: the filter is that one
 * element (origin `typepage`), so the viewer draws it alone, framed (owner:
 * *"remember to isolate the per instance view"*). Alle forekomster: the
 * filter is the type's instances, all of them selected. This is the page's
 * own view-local mode; it sets the one filter outright (`set`), and leaving
 * the page hands the gallery's filter back. ‹ › and ↑ ↓ step the instance and re-isolate; ← → step the
 * type. ‹, Esc or the browser's Back returns to the gallery, which stays
 * mounted (unseen) under it, so its scroll holds, and the gallery's filter is
 * handed back. The instance order is `type-links.ts`'s: by storey from the
 * lowest, then GlobalId.
 *
 * ── The facets (2026-09-28) ──────────────────────────────────────────────
 * Owner: *"we need filtering in the types and materials list. By ifcentities
 * and by classification and the main type properties"* … *"also, by unused
 * type and single instance types"*. `FacetBar.tsx` over `facets.ts`: IFC
 * class, Systemkode, Funksjonskode, IsExternal, LoadBearing, FireRating, and
 * the pills Ubrukt and Én forekomst. They narrow the cards shown and nothing
 * else; a card click is still the one filter. The unused types (declared, no
 * instance, `Catalogue.unused`) show only under Ubrukt, and not while another
 * view's filter isolates the gallery, since they have no instance to match
 * it. An unused card is not a door: it has no instances to filter to and no
 * page to open.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { MeshBatch } from "../viewer/mesh-stream";
import { cachedThumb, requestThumb } from "../viewer/thumbnails";
import { Gallery, GalleryCard, NoGeometryMark } from "./Gallery";
import { WithViewer } from "./BoardViewer";
import { useFillHeight } from "./useFillHeight";
import type { Catalogue, TypeCard, TypeCodes } from "./type-links";
import type { FilterAction, FilterState, Mode, ModelView } from "./cross-filter";
import { typePage, type TypePageInput } from "./type-page";
import { CodeLineView, TypePage, type Open } from "./TypePage";
import { MaterialCardView, SetCardView } from "./MaterialsTab";
import type { Focus } from "./trace";
import { FacetBar } from "./FacetBar";
import { narrow, typeItems, type ElementFacets, type FacetId, type FacetSelection } from "./facets";

const TYPE_FACETS: readonly FacetId[] = ["entity", "system", "function", "ext", "lb", "fire", "use"];

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

/** The gallery's filter, handed back when the page closes. */
interface GalleryState {
  state: FilterState;
  mode: Mode;
}

/** The filter a type card makes: its own instances. */
const TYPE_KEY = "typecard:";
function chooseType(row: TypeCard, lang: Lang): FilterAction {
  return {
    type: "choose",
    origin: "types",
    key: TYPE_KEY + row.key,
    filter: { kind: "type", label: row.typeName ?? t("type.untyped", lang), guids: row.guids },
    scope: { kind: "element", guids: row.guids },
  };
}

const own = (v: FilterState): FilterState => ({
  origin: v.origin,
  key: v.key,
  filter: v.filter,
  scope: v.scope,
  selection: v.selection,
});

export function TypesTab({
  lang,
  profile,
  catalogue,
  scopedCatalogue = null,
  codes,
  facetIndex,
  meshBatches,
  selection,
  view,
  page,
  pageInput,
  onDispatch,
  onMode,
  onPage,
  onOpenMaterial,
  onOpenType,
  onScope,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `type-links.ts`, computed once per profile by the panel. */
  catalogue: Catalogue | null;
  /** The same over the cross-filter's matching rows, when another view is
   *  its origin: the gallery then shows only these. */
  scopedCatalogue?: Catalogue | null;
  /** Each card's system and function line (`typeCodes`), per board. */
  codes: Map<string, TypeCodes> | null;
  /** Each element's facet values (`elementFacets`), per profile and board. */
  facetIndex: ElementFacets | null;
  /** The streamed geometry, for the card renders and the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** The panel's `view.selection`, for scripts. */
  selection: string[];
  /** The panel's one filter and the 3D's mode. */
  view: ModelView;
  /** The type page's key from the URL hash (`type=`), or null. */
  page: string | null;
  /** What the type page reads beside the card (`type-page.ts`). */
  pageInput: Omit<TypePageInput, "profile" | "card" | "codes">;
  onDispatch: (action: FilterAction) => void;
  onMode: (mode: Mode) => void;
  /** Open (a key) or leave (null) the type page. `replace` for a step from
   *  one type to the next, so Back still returns to the gallery. */
  onPage: (key: string | null, replace?: boolean) => void;
  onOpenMaterial: (name: string) => void;
  /** A layer set card's type link. */
  onOpenType: (key: string) => void;
  /** A requirement or IDS line of the page: its Scope, on its tab, within
   *  the type's instances. */
  onScope: (focus: Focus, tab: "checks" | "project", within: string[]) => void;
}) {
  const { mode } = view;
  // The page and the links always read the whole catalogue; the gallery
  // shows the isolated one when another view is the origin.
  const allRows = useMemo(() => catalogue?.types ?? [], [catalogue]);
  const byKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows]);
  const rows = scopedCatalogue?.types ?? allRows;
  // The facets narrow the cards shown; the unused types join only under
  // Ubrukt, and never while another view isolates the gallery.
  const unusedRows = useMemo(() => (scopedCatalogue ? [] : (catalogue?.unused ?? [])), [scopedCatalogue, catalogue]);
  const [facetSel, setFacetSel] = useState<FacetSelection>({});
  const facetItems = useMemo(() => typeItems(rows, unusedRows, facetIndex ?? new Map()), [rows, unusedRows, facetIndex]);
  const shown = useMemo(() => {
    const keep = narrow(facetItems.items, facetSel);
    return [...rows, ...unusedRows].filter((r) => keep.has(r.key));
  }, [facetItems, facetSel, rows, unusedRows]);
  const shownTotal = shown.reduce((sum, r) => sum + r.count, 0);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();

  // The card the one filter is on, when this gallery is its origin.
  const filtered =
    view.filter?.origin === "types" && view.filter.key.startsWith(TYPE_KEY) ? view.filter.key.slice(TYPE_KEY.length) : null;
  // The type whose materials sit under the viewer: the chosen card, kept
  // while one of those material cards is the filter.
  const [underType, setUnderType] = useState<string | null>(null);
  useEffect(() => {
    if (filtered) setUnderType(filtered);
    else if (view.filter?.origin !== "type-materials") setUnderType(null);
  }, [filtered, view.filter]);

  // The type page: the route's key, once the catalogue has it.
  const card = page ? (byKey.get(page) ?? null) : null;
  const [inst, setInst] = useState<Open | null>(null);
  const open: Open | null = card
    ? inst && inst.key === card.key
      ? inst
      : { key: card.key, pos: 0, all: false }
    : null;

  /** A click makes the card's instances THE filter, replacing whatever was
   *  on; the same card again clears it. The second click of a double-click
   *  is not a click. */
  const pick = useCallback(
    (row: TypeCard) => {
      prePick.current = { key: row.key, at: performance.now(), state: { state: own(view), mode } };
      if (filtered !== row.key && mode !== "filter") onMode("filter");
      // The WHOLE type, never the isolated card's instances: a click
      // replaces the filter, it does not intersect with it.
      onDispatch(chooseType(byKey.get(row.key) ?? row, lang));
    },
    [byKey, filtered, lang, mode, onDispatch, onMode, view],
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

  // Entering the page saves the gallery's filter; leaving hands it back.
  // Driven by the route, so a direct link, Back and Forward all take this path.
  const saved = useRef<GalleryState | null>(null);
  const live = useRef<GalleryState>({ state: own(view), mode });
  live.current = { state: own(view), mode };
  const cardKey = card?.key ?? null;
  useEffect(() => {
    if (cardKey && card) {
      if (!saved.current) saved.current = { ...live.current };
      setLastOpen(cardKey);
      onMode("filter");
    } else if (saved.current) {
      const back = saved.current;
      saved.current = null;
      openedHere.current = false;
      onDispatch({ type: "set", state: back.state });
      onMode(back.mode);
    }
    // Only a change of page moves the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  // Per forekomst isolates the current instance (the filter is that one
  // element: drawn alone, framed); Alle forekomster, the type's instances.
  // The current instance, or all of them, is the selection.
  const openPos = open?.pos ?? 0;
  const openAll = open?.all ?? false;
  useEffect(() => {
    if (!card) return;
    const guid = card.guids[openPos];
    const rowOf = profile?.rows.find((r) => r.guid === guid);
    const name = card.typeName ?? t("type.untyped", lang);
    const one = !openAll && guid;
    const guids = one ? [guid] : card.guids;
    onDispatch({
      type: "set",
      state: {
        origin: "typepage",
        key: one ? `element:${guid}` : TYPE_KEY + card.key,
        filter: {
          origin: "typepage",
          key: one ? `element:${guid}` : TYPE_KEY + card.key,
          kind: one ? "element" : "type",
          label: one ? (rowOf?.name ?? guid) : name,
          guids,
        },
        scope: null,
        selection: guids,
      },
    });
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

  const go = useCallback(
    (pos: number) => {
      if (!open) return;
      setInst({ ...open, pos, all: false });
    },
    [open],
  );

  const setAll = useCallback(
    (all: boolean) => {
      if (!open || open.all === all) return;
      setInst({ ...open, all });
    },
    [open],
  );

  const typeAt = open ? allRows.findIndex((r) => r.key === open.key) : -1;
  const stepType = useCallback(
    (delta: number) => {
      if (!open) return;
      const at = allRows.findIndex((r) => r.key === open.key);
      const next = allRows[at + delta];
      if (next) onPage(next.key, true);
    },
    [open, allRows, onPage],
  );

  /** A requirement line leaves the page for its Scope: the filter is that
   *  requirement's findings among this type's instances (one filter, not a
   *  type AND a requirement). The page's saved gallery state is dropped. */
  const scope = useCallback(
    (focus: Focus, tab: "checks" | "project") => {
      if (card) {
        saved.current = null;
        openedHere.current = false;
      }
      onScope(focus, tab, card?.guids ?? []);
    },
    [card, onScope],
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

  // The page's data, once per (card, what it reads).
  const data = useMemo(
    () => (card && profile ? typePage({ ...pageInput, profile, card, codes: codes?.get(card.key) ?? null }) : null),
    [card, profile, pageInput, codes],
  );

  // Under the viewer: the chosen type's material and layer set cards. A
  // click makes that material the filter (origin `type-materials`).
  const types = byKey;
  const pickedMat = view.filter?.origin === "type-materials" ? view.filter.key : null;
  const pickMat = (key: string, label: string, guids: string[]) =>
    onDispatch({
      type: "choose",
      origin: "type-materials",
      key,
      filter: { kind: "material", label, guids },
      scope: { kind: "element", guids },
    });
  const under = useMemo(() => {
    if (!underType || !catalogue) return null;
    const matNames = new Set((catalogue.typeMaterials.get(underType) ?? []).map((l) => l.key));
    const setKeys = new Set((catalogue.typeSets.get(underType) ?? []).map((l) => l.key));
    const mats = catalogue.materials.filter((m) => matNames.has(m.name));
    const sets = (catalogue.sets ?? []).filter((s) => setKeys.has(s.key));
    if (mats.length === 0 && sets.length === 0) return null;
    return { mats, sets };
  }, [underType, catalogue]);

  return (
    <section
      ref={fillRef}
      style={{ height: fillHeight ?? undefined }}
      onKeyDown={onKeyDown}
      className="relative flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
    >
      <FacetBar
        lang={lang}
        facets={TYPE_FACETS}
        items={facetItems}
        sel={facetSel}
        onChange={setFacetSel}
        className={open ? "invisible" : ""}
        trail={
          <span data-type-total={shownTotal} className="font-mono text-[10px] text-muted tabular-nums">
            {`${formatCount(shown.length, lang)} · ${t("col.instances", lang)} ${formatCount(shownTotal, lang)}`}
          </span>
        }
      />
      {rows.length === 0 ? (
        <div className="px-2 py-6 text-center font-mono text-[11px] text-muted">
          {profile ? t("type.none", lang) : notSupplied}
        </div>
      ) : (
        // Under the page the gallery stays mounted but unseen, so its scroll
        // is where it was when the page closes.
        <div className={"flex min-h-0 min-w-0 flex-1" + (open ? " invisible" : "")} aria-hidden={open ? true : undefined}>
        <WithViewer
          meshBatches={meshBatches}
          active={open === null}
          under={
            under ? (
              <div className="contents" data-xf={view.origin === "type-materials" ? "origin" : undefined}>
              <Gallery unit={[2, 2]} label="type-materials">
                {under.mats.map((line) => (
                  <MaterialCardView
                    key={`m:${line.name}`}
                    lang={lang}
                    line={line}
                    links={catalogue?.materialTypes.get(line.name) ?? []}
                    types={types}
                    active={pickedMat === `material:${line.name}`}
                    onClick={() => pickMat(`material:${line.name}`, line.name, line.guids)}
                    onOpenType={onOpenType}
                  />
                ))}
                {under.sets.map((set) => (
                  <SetCardView
                    key={`s:${set.key}`}
                    lang={lang}
                    set={set}
                    links={catalogue?.setTypes.get(set.key) ?? []}
                    types={types}
                    active={pickedMat === `set:${set.key}`}
                    onClick={() => pickMat(`set:${set.key}`, set.name ?? set.key, set.guids)}
                    onOpenType={onOpenType}
                  />
                ))}
              </Gallery>
              </div>
            ) : null
          }
        >
          <div className="contents" data-xf={view.origin === "types" ? "origin" : undefined}>
          <Gallery unit={[2, 2]} label="types">
            {shown.map((row) => {
              const name = row.typeName ?? t("type.untyped", lang);
              if (row.count === 0)
                return (
                  <GalleryCard key={row.key} title={`${row.entity} · ${name}`} data={{ "data-type-card": row.key, "data-type-count": 0, "data-type-unused": "" }}>
                    <div className="flex min-h-0 flex-1 items-center justify-center" data-thumb="none">
                      <NoGeometryMark />
                    </div>
                    <CardFoot lang={lang} row={row} name={name} codes={null} />
                  </GalleryCard>
                );
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
                  holds={row.guids}
                >
                  <Thumb batches={meshBatches} row={row} />
                  <CardFoot lang={lang} row={row} name={name} codes={codes?.get(row.key) ?? null} />
                </GalleryCard>
              );
            })}
          </Gallery>
          </div>
        </WithViewer>
        </div>
      )}
      {card && open && data ? (
        <TypePage
          lang={lang}
          page={data}
          open={open}
          typeAt={typeAt}
          typeCount={allRows.length}
          meshBatches={meshBatches}
          materials={catalogue?.typeMaterials.get(card.key) ?? []}
          selection={selection}
          onClose={closePage}
          onStep={step}
          onStepType={stepType}
          onAll={setAll}
          onGo={go}
          onOpenMaterial={onOpenMaterial}
          onScope={scope}
        />
      ) : null}
    </section>
  );
}

function CardFoot({ lang, row, name, codes }: { lang: Lang; row: TypeCard; name: string; codes: TypeCodes | null }) {
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
        {codes ? (
          <>
            <dt title={t("req.systemkode", lang)}>{t("inst.system", lang)}</dt>
            <dd className="flex min-w-0 justify-end" data-card-system>
              <CodeLineView line={codes.system} lang={lang} />
            </dd>
            <dt title={t("req.funksjonskode", lang)}>{t("inst.function", lang)}</dt>
            <dd className="flex min-w-0 justify-end" data-card-function>
              <CodeLineView line={codes.function} lang={lang} />
            </dd>
          </>
        ) : null}
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
