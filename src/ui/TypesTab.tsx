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
 * through `viewer/dock.ts` as the Graf tab lends it). A click on a card
 * FILTERS the viewer to the type's instances (a `typecard:` chip under Vis
 * kun), framed; the same card again takes it off. Under the viewer, the
 * filtered type's material cards and layer set cards (owner: *"there is an
 * unused space below the viewer. Would be cool to show the material cards
 * tied to the selected type"*), the Materialer tab's own cards; a click does
 * what it does there. No type filtered, the space stays empty.
 *
 * A double-click opens the TYPE PAGE (`TypePage.tsx`, data `type-page.ts`),
 * its own route (`#…&type=<key>`, so Back, Forward and a pasted link work).
 * Per forekomst ISOLATES the current instance: the type chip and an element
 * chip, so the viewer draws that one element, framed (owner: *"remember to
 * isolate the per instance view"*). Alle forekomster draws the type's
 * instances. ‹ › and ↑ ↓ step the instance and re-isolate; ← → step the
 * type. ‹, Esc or the browser's Back returns to the gallery, which stays
 * mounted (unseen) under it, so its scroll holds, and the gallery's filter is
 * handed back. The instance order is `type-links.ts`'s: by storey from the
 * lowest, then GlobalId.
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
import { elementChip, type FilterChip, type Mode } from "./cross-filter";
import { typePage, type TypePageInput } from "./type-page";
import { CodeLineView, TypePage, type Open } from "./TypePage";
import { MaterialCardView, SetCardView } from "./MaterialsTab";
import type { Focus } from "./trace";

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
  codes,
  meshBatches,
  selection,
  chips,
  mode,
  page,
  pageInput,
  onSelect,
  onChips,
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
  /** Each card's system and function line (`typeCodes`), per board. */
  codes: Map<string, TypeCodes> | null;
  /** The streamed geometry, for the card renders and the lent 3D. */
  meshBatches: MeshBatch[] | undefined;
  /** The panel's `view.selection`, for scripts. */
  selection: string[];
  /** The panel's filter chips and mode: a type card filters the viewer. */
  chips: FilterChip[];
  mode: Mode;
  /** The type page's key from the URL hash (`type=`), or null. */
  page: string | null;
  /** What the type page reads beside the card (`type-page.ts`). */
  pageInput: Omit<TypePageInput, "profile" | "card" | "codes">;
  onSelect: (guids: string[]) => void;
  onChips: (chips: FilterChip[]) => void;
  onMode: (mode: Mode) => void;
  /** Open (a key) or leave (null) the type page. `replace` for a step from
   *  one type to the next, so Back still returns to the gallery. */
  onPage: (key: string | null, replace?: boolean) => void;
  onOpenMaterial: (name: string) => void;
  /** A layer set card's type link. */
  onOpenType: (key: string) => void;
  /** A requirement or IDS line of the page: its Scope, on its tab. */
  onScope: (focus: Focus, tab: "checks" | "project") => void;
}) {
  const rows = useMemo(() => catalogue?.types ?? [], [catalogue]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const notSupplied = t("type.notSupplied", lang);
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLElement>();

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

  // Entering the page saves the gallery's filter; leaving hands it back.
  // Driven by the route, so a direct link, Back and Forward all take this path.
  const saved = useRef<GalleryState | null>(null);
  const live = useRef({ chips, selection, mode });
  live.current = { chips, selection, mode };
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
      onChips(back.chips);
      onSelect(back.selection);
      onMode(back.mode);
    }
    // Only a change of page moves the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  // Per forekomst isolates the current instance (the type chip AND its
  // element chip: one element drawn, framed); Alle forekomster draws the
  // type. The current instance, or all of them, is the selection.
  const openPos = open?.pos ?? 0;
  const openAll = open?.all ?? false;
  useEffect(() => {
    if (!card) return;
    const guid = card.guids[openPos];
    const rowOf = profile?.rows.find((r) => r.guid === guid);
    onChips(openAll || !guid ? [typeChip(card, lang)] : [typeChip(card, lang), elementChip(guid, rowOf?.name ?? null)]);
    onSelect(openAll ? card.guids : [guid]);
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

  const typeAt = open ? rows.findIndex((r) => r.key === open.key) : -1;
  const stepType = useCallback(
    (delta: number) => {
      if (!open) return;
      const at = rows.findIndex((r) => r.key === open.key);
      const next = rows[at + delta];
      if (next) onPage(next.key, true);
    },
    [open, rows, onPage],
  );

  /** A requirement line leaves the page for its Scope with the type still
   *  the filter: the page's saved gallery state is dropped, not restored. */
  const scope = useCallback(
    (focus: Focus, tab: "checks" | "project") => {
      if (card) {
        saved.current = null;
        openedHere.current = false;
        onChips([typeChip(card, lang)]);
      }
      onScope(focus, tab);
    },
    [card, lang, onChips, onScope],
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

  // Under the viewer: the filtered type's material and layer set cards.
  const types = byKey;
  const [pickedMat, setPickedMat] = useState<string | null>(null);
  useEffect(() => {
    if (selection.length === 0) setPickedMat(null);
  }, [selection.length]);
  const pickMat = (key: string, guids: string[]) => {
    setPickedMat(key);
    onSelect(guids);
  };
  const under = useMemo(() => {
    if (!filtered || !catalogue) return null;
    const matNames = new Set((catalogue.typeMaterials.get(filtered) ?? []).map((l) => l.key));
    const setKeys = new Set((catalogue.typeSets.get(filtered) ?? []).map((l) => l.key));
    const mats = catalogue.materials.filter((m) => matNames.has(m.name));
    const sets = (catalogue.sets ?? []).filter((s) => setKeys.has(s.key));
    if (mats.length === 0 && sets.length === 0) return null;
    return { mats, sets };
  }, [filtered, catalogue]);

  return (
    <section
      ref={fillRef}
      style={{ height: fillHeight ?? undefined }}
      onKeyDown={onKeyDown}
      className="relative flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
    >
      <div className={"flex shrink-0 items-center gap-3 px-4 pt-1 font-mono text-[10px] text-muted tabular-nums" + (open ? " invisible" : "")}>
        <span>{`${formatCount(rows.length, lang)} · ${t("col.instances", lang)} ${formatCount(
          rows.reduce((sum, r) => sum + r.count, 0),
          lang,
        )}`}</span>
      </div>
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
              <Gallery unit={[2, 2]} label="type-materials">
                {under.mats.map((line) => (
                  <MaterialCardView
                    key={`m:${line.name}`}
                    lang={lang}
                    line={line}
                    links={catalogue?.materialTypes.get(line.name) ?? []}
                    types={types}
                    active={pickedMat === `material:${line.name}`}
                    onClick={() => pickMat(`material:${line.name}`, line.guids)}
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
                    onClick={() => pickMat(`set:${set.key}`, set.guids)}
                    onOpenType={onOpenType}
                  />
                ))}
              </Gallery>
            ) : null
          }
        >
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
                  <CardFoot lang={lang} row={row} name={name} codes={codes?.get(row.key) ?? null} />
                </GalleryCard>
              );
            })}
          </Gallery>
        </WithViewer>
        </div>
      )}
      {card && open && data ? (
        <TypePage
          lang={lang}
          page={data}
          open={open}
          typeAt={typeAt}
          typeCount={rows.length}
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
