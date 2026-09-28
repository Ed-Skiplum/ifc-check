/** The Typer type page (2026-09-28): one type, type first.
 *
 * Owner: *"remember to isolate the per instance view, and also build a proper
 * type page, not this stripped down naked thing … almost all properties are
 * type properties. We want to know type properties, and also what
 * distribution the instances of the type has for instance properties: MMI,
 * QTO, IsReference etc"*, *"and what instances there are. GUID etc"*, and
 * *"see my QTO_LCA type view for inspiration"*.
 *
 * Carried over from the G55 QTO-LCA type viewer (`verify_app.html`): the head
 * line (`n / N` types, ‹ › `Forrige (←)` / `Neste (→)`, `Lukk (Esc)`), the
 * type form (`Type / navn`, `Diskret / sammensatt`, NS 3451), the layer panel
 * (`Materialsammensetning · N materiallag`, thickness per layer), the quantity
 * line (`Volum · Areal · Lengde · Antall`), `Mengde i QTO`, the navigator
 * (`Per forekomst | Alle forekomster`, ‹ › `Forrige (↑)` / `Neste (↓)`), the
 * MMI chips with their counts, and `Instanser (N)`: one row per GlobalId, a
 * row click moves the 3D to it and ↑ ↓ move the row. The per-GUID
 * corrections, weights, comments and dedup of G55 are editing, which this
 * checker does not do.
 *
 * All numbers are `type-page.ts`'s; this file only draws them. On the canon
 * grid (data-workspace.md, LAYOUT SYSTEM): the viewer the hero (8 × 5, else
 * 6 × 4), the list of instances under it, the sections as tiles beside it in
 * columns sized to their content, fitted to the tab. A tile scrolls inside.
 * The current instance (Per forekomst) is a column beside the type's values
 * in the property and quantity tiles, a difference marked ≠ (the 2026-06-12
 * canon: comparison lined up, one column per field).
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Lang, StringKey } from "./i18n";
import { hasString, t } from "./i18n";
import { formatCount } from "./format";
import type { MeshBatch } from "../viewer/mesh-stream";
import { LentViewer, useTabGrid } from "./BoardViewer";
import { MG_GAP } from "./alt/module-grid";
import { LinkChip } from "./Gallery";
import { LayerSection } from "./MaterialsTab";
import { layerSection, sectionFrame, sectionOrientation } from "./layer-section.ts";
import { typeObjectClass, type CodeLine, type Link } from "./type-links";
import type { Absent, InstanceRow, PropLine, QtoLine, TypePage as Page, ValueCount } from "./type-page";
import type { Focus } from "./trace";
import type { ReportState } from "../engine/report";

export interface Open {
  key: string;
  pos: number;
  all: boolean;
}

/* ── layout ───────────────────────────────────────────────────────────── */

type TileId = "identity" | "typeProps" | "instProps" | "qto" | "dist" | "reqs" | "layers";
/** The 1:20 layer section is there only when the type has a layer set. */
type Tiles = Record<Exclude<TileId, "layers">, Place> & { layers?: Place };
interface Place {
  c: number;
  r: number;
  w: number;
  h: number;
}

/** The page on the tab's grid: the hero at the top left, the instance list
 *  under it, the tiles in columns beside it (canon sizes, at most 2 : 1).
 *  Each column is the grid's height; a tile takes the rows its content wants,
 *  the column's rows left over go to its tile with the most content, and when
 *  the wants exceed the rows the heaviest tiles shrink first, to their
 *  minimum, and scroll inside. Pure. */
export function pageLayout(
  cols: number,
  rows: number,
  want: Record<TileId, number>,
): { hero: Place; list: Place; tiles: Tiles; rows: number } {
  const [hw, hh] = cols >= 16 ? [8, 5] : cols >= 12 ? [6, 4] : cols >= 8 ? [4, 3] : [cols, Math.max(2, Math.round(cols * 0.6))];
  const right = cols - hw;
  const stacks: { w: number; ids: TileId[] }[] =
    right >= 14
      ? [
          { w: 4, ids: ["identity", "typeProps"] },
          { w: right - 8, ids: ["layers", "instProps"] },
          { w: 4, ids: ["dist", "qto", "reqs"] },
        ]
      : right >= 8
        ? [
            { w: 4, ids: ["identity", "typeProps", "dist", "qto"] },
            { w: right - 4, ids: ["layers", "instProps", "reqs"] },
          ]
        : right >= 6
          ? [
              { w: 3, ids: ["identity", "typeProps", "dist", "qto"] },
              { w: right - 3, ids: ["layers", "instProps", "reqs"] },
            ]
          : [];
  const minH = (w: number) => Math.max(1, Math.ceil(w / 2));
  const total = Math.max(rows, hh + 3);
  const tiles = {} as Tiles;
  const present = (id: TileId) => id !== "layers" || want.layers > 0;
  for (const stack of stacks) stack.ids = stack.ids.filter(present);
  let c = hw;
  let used = total;
  for (const stack of stacks) {
    const heights = new Map(stack.ids.map((id) => [id, Math.max(minH(stack.w), want[id])]));
    const heaviest = [...stack.ids].sort((a, b) => want[b] - want[a]);
    let sum = [...heights.values()].reduce((s, h) => s + h, 0);
    if (sum < total) heights.set(heaviest[0], heights.get(heaviest[0])! + total - sum);
    else {
      for (const id of heaviest) {
        if (sum <= total) break;
        const h = heights.get(id)!;
        const cut = Math.min(h - minH(stack.w), sum - total);
        heights.set(id, h - cut);
        sum -= cut;
      }
    }
    let r = 0;
    for (const id of stack.ids) {
      tiles[id] = { c, r, w: stack.w, h: heights.get(id)! };
      r += heights.get(id)!;
    }
    used = Math.max(used, r);
    c += stack.w;
  }
  if (stacks.length === 0) {
    // Narrow: every tile under the list, full width, in order.
    let r = total;
    for (const id of (["identity", "layers", "instProps", "typeProps", "qto", "dist", "reqs"] as TileId[]).filter(present)) {
      const h = Math.max(2, Math.min(want[id], 5));
      tiles[id] = { c: 0, r, w: cols, h };
      r += h;
    }
    used = r;
  }
  return { hero: { c: 0, r: 0, w: hw, h: hh }, list: { c: 0, r: hh, w: hw, h: total - hh }, tiles, rows: used };
}
/** Rows a tile wants for `lines` lines of 15 px under its 26 px head. */
function rowsFor(lines: number, u: number): number {
  const px = 26 + lines * 15 + 18;
  return Math.max(1, Math.ceil((px + MG_GAP) / (u + MG_GAP)));
}

/* ── pieces ───────────────────────────────────────────────────────────── */

const num = (v: number | null, lang: Lang, digits = 2) =>
  v === null ? "—" : v.toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: v < 10 ? digits : v < 100 ? 1 : 0 });

function Tile({
  place,
  head,
  figure,
  children,
  data,
}: {
  place: Place;
  head: ReactNode;
  figure?: ReactNode;
  children: ReactNode;
  data?: Record<`data-${string}`, string | number | undefined>;
}) {
  return (
    <section
      className="gallery-card flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ gridColumn: `${place.c + 1} / span ${place.w}`, gridRow: `${place.r + 1} / span ${place.h}` }}
      data-type-tile=""
      data-tile-span={`${place.w}x${place.h}`}
      {...data}
    >
      <div className="flex shrink-0 items-baseline gap-2 px-2.5 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-wide text-muted uppercase">{head}</span>
        {figure !== undefined ? <span className="shrink-0 font-mono text-[11px] text-ink tabular-nums">{figure}</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-2 font-mono text-[10.5px] leading-[15px]">{children}</div>
    </section>
  );
}

function AbsentLine({ absent, lang }: { absent: Absent; lang: Lang }) {
  const text =
    absent.absent === "untyped"
      ? t("type.untyped", lang)
      : absent.absent === "table-absent"
        ? `psetsJson() · ${t("type.notSupplied", lang)}`
        : absent.absent === "quantities-not-received"
          ? t("inst.pending", lang)
          : `${t("type.notSupplied", lang)} · ${absent.absent}`;
  return (
    <div className="text-muted" data-absent={absent.absent}>
      {text}
    </div>
  );
}

/** Values with their counts, the largest first; `max` shown, the rest +k. */
function Dist({ values, lang, max = 4 }: { values: ValueCount[]; lang: Lang; max?: number }) {
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2">
      {shown.map((v, i) => (
        <span key={i} className="min-w-0 truncate" title={`${v.value ?? "—"} · ${v.n}`}>
          <span className={v.value === null ? "text-muted" : "text-ink"}>{v.value ?? "—"}</span>
          <span className="text-muted tabular-nums">{` ${formatCount(v.n, lang)}`}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-muted" title={values.slice(max).map((v) => `${v.value ?? "—"} · ${v.n}`).join("\n")}>{`+${rest}`}</span>
      ) : null}
    </span>
  );
}

/** A code line of the card and the page: the code and its list name, or the
 *  fallback in italics; the other values as +n. */
export function CodeLineView({ line, lang }: { line: CodeLine; lang: Lang }) {
  const others = line.others.length;
  const title = [line, ...line.others].map((v) => `${v.value ?? "—"}${v.name ? ` ${v.name}` : ""} · ${v.n}${v.kind === "fallback" ? " (fallback)" : ""}`).join("\n");
  return (
    <span className="flex min-w-0 items-baseline gap-1" title={title} data-code-kind={line.kind}>
      <span className={"min-w-0 truncate " + (line.kind === "fallback" ? "text-muted italic" : line.kind === "missing" ? "text-muted" : line.kind === "deviating" ? "text-bad" : "text-ink")}>
        {line.value === null ? "—" : line.name ? `${line.value} ${line.name}` : line.value}
      </span>
      {others > 0 ? <span className="shrink-0 text-muted tabular-nums">{`+${formatCount(others, lang)}`}</span> : null}
      <span className="sr-only">{formatCount(line.n, lang)}</span>
    </span>
  );
}

const STATE_DOT: Record<string, string> = {
  pass: "bg-green",
  warn: "bg-gold",
  fail: "bg-bad",
};

function Dot({ state }: { state: ReportState | string }) {
  return <span className={"inline-block h-2 w-2 shrink-0 rounded-full " + (STATE_DOT[state] ?? "border border-muted")} title={state} />;
}

/** One property table: pset headers, then Egenskap · Verdi (distribution) ·
 *  the current instance's value, ≠ where it differs from the type's. */
function PropTable({
  lines,
  lang,
  guid,
  count,
}: {
  lines: PropLine[];
  lang: Lang;
  guid: string | null;
  count: number;
}) {
  let pset: string | null = null;
  const out: ReactNode[] = [];
  lines.forEach((l, i) => {
    if (l.pset !== pset) {
      pset = l.pset;
      out.push(
        <tr key={`h${i}`}>
          <td colSpan={guid ? 4 : 3} className="pt-1.5 text-[9.5px] break-all text-muted">
            {l.pset}
          </td>
        </tr>,
      );
    }
    const mine = guid ? l.byGuid.get(guid) : undefined;
    const differs = guid !== null && (mine === undefined ? l.withValue > 0 : (mine.trim() === "" ? null : mine) !== l.typical);
    out.push(
      <tr key={i} data-prop={`${l.pset}.${l.name}`} data-disagree={l.disagree ? "" : undefined} className="align-top">
        <td className="max-w-0 truncate pr-2 text-ink" title={`${l.pset}.${l.name}`}>
          {l.name}
          {l.requiredBy.length ? (
            <span className="ml-1 text-[9px] text-gold" title={l.requiredBy.join("\n")}>
              {t("inst.required", lang)}
            </span>
          ) : null}
        </td>
        <td className="pr-2">
          <Dist values={l.values} lang={lang} max={3} />
          {l.blank + l.absent > 0 ? (
            <span className="text-muted tabular-nums" title={`${t("req.mangler", lang)} ${l.blank + l.absent} / ${count}`}>
              {` · — ${formatCount(l.blank + l.absent, lang)}`}
            </span>
          ) : null}
        </td>
        <td className="w-4 text-center">
          {l.disagree ? (
            <span className="font-semibold text-bad" title={t("type.disagree", lang)}>
              ≠
            </span>
          ) : null}
        </td>
        {guid ? (
          <td className={"max-w-[9rem] truncate " + (differs ? "font-semibold text-bad" : "text-ink")} title={`${mine ?? "—"}${differs ? ` ≠ ${l.typical ?? "—"}` : ""}`} data-this-value="" data-differs={differs ? "" : undefined}>
            {mine === undefined || mine.trim() === "" ? "—" : mine}
          </td>
        ) : null}
      </tr>,
    );
  });
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[38%]" />
        <col />
        <col className="w-4" />
        {guid ? <col className="w-[24%]" /> : null}
      </colgroup>
      <thead>
        <tr className="text-[9.5px] text-muted">
          <th className="text-left font-normal">{t("inst.property", lang)}</th>
          <th className="text-left font-normal">{t("inst.value", lang)}</th>
          <th />
          {guid ? <th className="text-left font-normal">{t("inst.this", lang)}</th> : null}
        </tr>
      </thead>
      <tbody>{out}</tbody>
    </table>
  );
}

/* ── the page ─────────────────────────────────────────────────────────── */

type SortKey = "order" | "guid" | "name" | "storey" | "mmi" | "copy" | "status" | "v" | "a" | "l";

export function TypePage({
  lang,
  page,
  open,
  typeAt,
  typeCount,
  meshBatches,
  materials,
  selection,
  onClose,
  onStep,
  onStepType,
  onAll,
  onGo,
  onOpenMaterial,
  onScope,
}: {
  lang: Lang;
  page: Page;
  open: Open;
  /** This type's place among the gallery's cards, for the head's `n / N`. */
  typeAt: number;
  typeCount: number;
  meshBatches: MeshBatch[] | undefined;
  materials: Link[];
  selection: string[];
  onClose: () => void;
  onStep: (delta: number) => void;
  onStepType: (delta: number) => void;
  onAll: (all: boolean) => void;
  /** Per forekomst on this instance (a row of the list). */
  onGo: (pos: number) => void;
  onOpenMaterial: (name: string) => void;
  onScope: (focus: Focus, tab: "checks" | "project") => void;
}) {
  const n = page.count;
  const guid = open.all ? null : (page.instances[open.pos]?.guid ?? null);
  const current = open.all ? null : (page.instances[open.pos] ?? null);
  const { ref: gridRef, grid } = useTabGrid<HTMLDivElement>();

  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [page.key]);

  // Content-aware sizing: the rows each tile's content wants.
  const u = grid?.u ?? 100;
  const tp = "lines" in page.typeProps ? page.typeProps.lines : null;
  const ip = "lines" in page.instanceProps ? page.instanceProps.lines : null;
  const psetCount = (lines: PropLine[] | null) => (lines ? new Set(lines.map((l) => l.pset)).size : 0);
  const stack = page.stacks?.[0] ?? null;
  const sectionPx = stack ? sectionFrame(layerSection(stack.layers), sectionOrientation(page.entity), []).height : 0;
  const want: Record<TileId, number> = {
    identity: rowsFor(9 + Math.min(4, "absent" in page.classifications ? 1 : page.classifications.length) + 2, u),
    layers: stack ? Math.max(2, Math.ceil((26 + sectionPx + 12 + MG_GAP) / (u + MG_GAP))) : 0,
    typeProps: rowsFor(tp ? tp.length + psetCount(tp) + 1 : 2, u),
    instProps: rowsFor((ip ? ip.length + psetCount(ip) : 1) + page.readings.length + page.required.length + 3, u),
    qto: rowsFor(6, u),
    dist: rowsFor(page.storeys.length + 3, u),
    reqs: rowsFor(page.reqs.length + (page.ids?.length ?? 0) + 3, u),
  };
  const layout = grid ? pageLayout(grid.cols, grid.rows, want) : null;

  // The instance list, sortable; the navigator's order is `order`.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "order", dir: 1 });
  const sorted = useMemo(() => {
    const rows = page.instances.map((r, i) => ({ r, i }));
    if (sort.key === "order") return sort.dir === 1 ? rows : rows.reverse();
    const val = (x: { r: InstanceRow }): string | number | null => {
      const r = x.r;
      switch (sort.key) {
        case "guid": return r.guid;
        case "name": return r.name;
        case "storey": return r.storey;
        case "mmi": return r.mmi;
        case "copy": return r.copy;
        case "status": return r.status;
        case "v": return r.q?.[0] ?? null;
        case "a": return r.q?.[2] ?? null;
        case "l": return r.q?.[4] ?? null;
        default: return null;
      }
    };
    return rows.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return a.i - b.i;
      if (va === null) return 1;
      if (vb === null) return -1;
      const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return d * sort.dir || a.i - b.i;
    });
  }, [page.instances, sort]);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector("[data-current]")?.scrollIntoView({ block: "nearest" });
  }, [open.pos, open.all, page.key]);

  const pill = (on: boolean) => "px-2 py-0.5 text-[11px] " + (on ? "bg-ink text-panel" : "bg-input text-muted hover:text-ink");
  const nav = "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-line bg-input text-[13px] text-ink disabled:opacity-40";

  const qtoLines = Array.isArray(page.qto) ? (page.qto as QtoLine[]) : null;
  const sumOf = (kind: QtoLine["kind"]) => qtoLines?.find((l) => l.kind === kind)?.sum ?? null;

  const typeName = page.typeName ?? t("type.untyped", lang);
  const typeClass = page.typeClass[0]?.value ? typeObjectClass(page.typeClass[0].value, page.entity) : null;

  const head = (
    <div className="flex shrink-0 items-center gap-2 px-4 pt-1 font-mono text-[11px]" data-type-head>
      <button type="button" title={t("inst.close", lang)} onClick={onClose} data-type-back className={nav + " hover:border-ink"}>
        ‹
      </button>
      <span className="shrink-0 text-muted tabular-nums">{`${typeAt + 1} / ${typeCount}`}</span>
      <button type="button" title="← →" disabled={typeAt <= 0} onClick={() => onStepType(-1)} className={nav}>
        ←
      </button>
      <button type="button" title="← →" disabled={typeAt >= typeCount - 1} onClick={() => onStepType(1)} className={nav}>
        →
      </button>
      <span className="shrink-0 text-[10px] text-muted">{page.entity}</span>
      <span className="min-w-0 max-w-[28rem] truncate text-[12.5px] font-semibold text-ink" title={typeName}>
        {typeName}
      </span>
      <div role="group" className="ml-3 flex shrink-0 overflow-hidden rounded-[6px] border border-line">
        <button type="button" aria-pressed={!open.all} data-instance-one onClick={() => onAll(false)} className={pill(!open.all)}>
          {t("inst.one", lang)}
        </button>
        <button type="button" aria-pressed={open.all} data-instance-all onClick={() => onAll(true)} className={pill(open.all)}>
          {t("inst.all", lang)}
        </button>
      </div>
      {open.all ? (
        <span className="shrink-0 text-ink tabular-nums" data-instance-counter>{`${formatCount(n, lang)} / ${formatCount(n, lang)}`}</span>
      ) : (
        <>
          <button type="button" title={t("inst.prev", lang)} data-instance-prev disabled={open.pos === 0} onClick={() => onStep(-1)} className={nav}>
            ‹
          </button>
          <span className="min-w-[4.5rem] shrink-0 text-center text-ink tabular-nums" data-instance-counter>{`${open.pos + 1} / ${n}`}</span>
          <button type="button" title={t("inst.next", lang)} data-instance-next disabled={open.pos >= n - 1} onClick={() => onStep(1)} className={nav}>
            ›
          </button>
          {current ? (
            <span className="flex min-w-0 items-baseline gap-2 text-[10.5px]">
              <span className="min-w-0 truncate text-ink" title={current.name ?? ""}>{current.name ?? "—"}</span>
              <span className="shrink-0 text-muted">{current.guid}</span>
              <span className="shrink-0 text-muted">{current.storey ?? t("matrix.noStorey", lang)}</span>
            </span>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div
      ref={root}
      tabIndex={-1}
      className="absolute inset-0 z-10 flex flex-col bg-ground outline-none"
      data-type-view={page.key}
      data-type-page={page.key}
      data-type-card={page.key}
      data-type-open=""
      data-instance-mode={open.all ? "all" : "one"}
      data-instance-pos={`${open.pos + 1}/${n}`}
      data-instance-guid={guid ?? ""}
      data-selection-count={selection.length}
      data-selection-first={selection[0] ?? ""}
    >
      {head}
      <div ref={gridRef} className="min-h-0 flex-1 overflow-auto">
        {grid && layout ? (
          <div
            className="grid justify-center"
            data-type-view-grid={`${grid.cols},${grid.rows},${layout.hero.w}x${layout.hero.h}`}
            data-type-layout-rows={layout.rows}
            style={{
              padding: MG_GAP,
              gap: MG_GAP,
              gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
              gridTemplateRows: `repeat(${layout.rows}, ${grid.u}px)`,
            }}
          >
            <LentViewer
              meshBatches={meshBatches}
              active
              style={{ gridColumn: `1 / span ${layout.hero.w}`, gridRow: `1 / span ${layout.hero.h}` }}
              data={{ "data-type-viewer": "", "data-viewer-span": `${layout.hero.w}x${layout.hero.h}` }}
            />

            {/* Instanser (N): one row per GlobalId, the navigator's order. */}
            <Tile place={layout.list} head={`${t("inst.instances", lang)} (${formatCount(n, lang)})`} data={{ "data-type-instances": "" }}>
              <div ref={listRef}>
                <InstanceTable
                  lang={lang}
                  rows={sorted}
                  current={guid}
                  sort={sort}
                  onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                  onGo={onGo}
                  mmi={page.readings[0].configured}
                  copy={page.readings[1].configured}
                />
              </div>
            </Tile>

            <Tile place={layout.tiles.identity} head={t("type.facts", lang)} figure={formatCount(n, lang)} data={{ "data-type-facts": "" }}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                <dt className="text-muted">{t("inst.typeName", lang)}</dt>
                <dd className="min-w-0 break-all text-ink">
                  {typeName}
                  {page.source && page.source !== "ifctype" && page.typeName ? <span className="ml-1 text-[9px] text-muted uppercase">{page.source}</span> : null}
                </dd>
                <dt className="text-muted">{t("col.class", lang)}</dt>
                <dd className="truncate text-ink">{page.entity}</dd>
                <dt className="text-muted">{t("object.typeObject", lang)}</dt>
                <dd className="truncate text-ink" title={page.typeGuids.join("\n")}>
                  {typeClass ?? "—"}
                  {page.typeGuids.length > 0 ? (
                    <span className="ml-1 text-muted">{page.typeGuids.length > 1 ? `${page.typeGuids[0]} +${page.typeGuids.length - 1}` : page.typeGuids[0]}</span>
                  ) : null}
                </dd>
                <dt className="text-muted">{t("col.predefinedType", lang)}</dt>
                <dd className="min-w-0"><Dist values={page.predefined} lang={lang} max={2} /></dd>
                <dt className="text-muted">{t("col.objectType", lang)}</dt>
                <dd className="min-w-0"><Dist values={page.objectType} lang={lang} max={2} /></dd>
                {page.codes ? (
                  <>
                    <dt className="text-muted">{t("req.systemkode", lang)}</dt>
                    <dd className="min-w-0" data-type-system><CodeLineView line={page.codes.system} lang={lang} /></dd>
                    <dt className="text-muted">{t("req.funksjonskode", lang)}</dt>
                    <dd className="min-w-0" data-type-function><CodeLineView line={page.codes.function} lang={lang} /></dd>
                  </>
                ) : null}
                <dt className="text-muted">{t("type.classifications", lang)}</dt>
                <dd className="min-w-0">
                  {"absent" in page.classifications ? (
                    <AbsentLine absent={page.classifications} lang={lang} />
                  ) : page.classifications.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    page.classifications.slice(0, 4).map((c, i) => (
                      <div key={i} className="truncate" title={`${c.system ?? ""} ${c.code ?? ""} ${c.name ?? c.listName ?? ""} · ${c.source} · ${c.n}`}>
                        <span className="text-muted">{c.system ?? "—"} </span>
                        <span className="text-ink">{c.code ?? "—"}</span>
                        <span className="text-ink">{c.name ?? c.listName ? ` ${c.name ?? c.listName}` : ""}</span>
                        <span className="text-muted">{` · ${c.source} ${formatCount(c.n, lang)}`}</span>
                      </div>
                    ))
                  )}
                </dd>
                <dt className="text-muted">{t("inst.discreteComposite", lang)}</dt>
                <dd className="text-ink">
                  {page.nmat === null ? "—" : `${t(page.nmat > 1 ? "inst.composite" : "inst.discrete", lang)} (${page.nmat})`}
                </dd>
              </dl>
              <div className="mt-1.5 text-[9.5px] text-muted">
                {`${t("inst.composition", lang)} · ${formatCount(page.stacks?.[0]?.layers.length ?? 0, lang)} ${t("inst.layers", lang)}`}
              </div>
              {page.stacks === null ? (
                <div className="text-muted">{`materialsJson() · ${t("type.notSupplied", lang)}`}</div>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1" data-type-materials>
                {materials.map((m) => (
                  <LinkChip key={m.key} label={m.key} n={m.n} onOpen={() => onOpenMaterial(m.key)} data={{ "data-link-material": m.key }} />
                ))}
              </div>
            </Tile>

            {/* The layer set cut at 1:20, the most used stack among the
                instances; it scrolls in its tile rather than rescale. */}
            {stack && layout.tiles.layers ? (
              <Tile
                place={layout.tiles.layers}
                head={`${t("inst.composition", lang)} · ${formatCount(stack.layers.length, lang)} ${t("inst.layers", lang)} · ${formatCount(stack.n, lang)} / ${formatCount(n, lang)}${page.stacks && page.stacks.length > 1 ? ` · +${page.stacks.length - 1}` : ""}`}
                figure="1:20"
                data={{ "data-type-layers": "" }}
              >
                <LayerSection layers={stack.layers} entity={page.entity} lang={lang} />
              </Tile>
            ) : null}

            <Tile
              place={layout.tiles.typeProps}
              head={`${t("object.data", lang)} · ${t("object.typeObject", lang)}`}
              figure={tp ? formatCount(tp.length, lang) : undefined}
              data={{ "data-type-props": "absent" in page.typeProps ? page.typeProps.absent : "lines" }}
            >
              {tp ? <PropTable lines={tp} lang={lang} guid={guid} count={n} /> : <AbsentLine absent={page.typeProps as Absent} lang={lang} />}
            </Tile>

            <Tile
              place={layout.tiles.instProps}
              head={`${t("object.data", lang)} · ${t("col.instances", lang)}`}
              figure={ip ? formatCount(ip.length, lang) : undefined}
              data={{ "data-instance-props": "" }}
            >
              <table className="mb-1 w-full table-fixed border-collapse" data-type-readings>
                <tbody>
                  {page.readings.map((r) => (
                    <tr key={r.role} className="align-top" data-reading={r.role}>
                      <td className="w-[38%] truncate pr-2 text-ink">{t(r.role === "progress-code" ? "req.mmi" : "req.kopiobjekt", lang)}</td>
                      <td className="pr-2">
                        {r.configured ? (
                          <>
                            <Dist values={r.values} lang={lang} max={5} />
                            {r.unread > 0 ? <span className="text-muted">{` · ${t("req.gjelderIkke", lang)} ${formatCount(r.unread, lang)}`}</span> : null}
                          </>
                        ) : (
                          <span className="text-muted">{t("req.state.not_configured", lang)}</span>
                        )}
                      </td>
                      {guid ? (
                        <td className="w-[24%] truncate text-ink">
                          {r.configured ? ((r.role === "progress-code" ? current?.mmi : current?.copy) ?? "—") : ""}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {page.required
                    .filter((r) => r.missing > 0)
                    .map((r, i) => (
                      <tr key={`q${i}`} className="align-top" data-required={`${r.pset}.${r.prop}`}>
                        <td className="truncate pr-2 text-ink" title={`${r.pset}.${r.prop}\n${r.by}`}>
                          {r.prop}
                          <span className="ml-1 text-[9px] text-gold">{t("inst.required", lang)}</span>
                        </td>
                        <td className="pr-2 text-muted" colSpan={guid ? 2 : 1}>
                          <span className="text-bad">{`${t("req.mangler", lang)} ${formatCount(r.missing, lang)}`}</span>
                          {` / ${formatCount(n, lang)} · ${r.pset}`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {ip ? <PropTable lines={ip} lang={lang} guid={guid} count={n} /> : <AbsentLine absent={page.instanceProps as Absent} lang={lang} />}
            </Tile>

            <Tile
              place={layout.tiles.qto}
              head={t("inst.qto", lang)}
              figure={page.qtoComplete || !qtoLines ? undefined : t("inst.pending", lang)}
              data={{ "data-type-qto": qtoLines ? "lines" : "absent" }}
            >
              {/* The G55 quantity line: Volum · Areal · Lengde · Antall. */}
              <div className="mb-1 text-ink tabular-nums">
                {`${t("measure.volume", lang)} ${num(sumOf("volume"), lang)} m³ · ${t("measure.area", lang)} ${num(sumOf("area"), lang)} m² · ${t("inst.length", lang)} ${num(sumOf("length"), lang)} m · ${t("inst.count", lang)} ${formatCount(n, lang)}`}
              </div>
              {qtoLines ? (
                <table className="w-full border-collapse tabular-nums">
                  <thead>
                    <tr className="text-[9.5px] text-muted">
                      <th />
                      <th className="text-right font-normal">{t("inst.sum", lang)}</th>
                      <th className="text-right font-normal">{t("object.min", lang)}</th>
                      <th className="text-right font-normal">{t("type.median", lang)}</th>
                      <th className="text-right font-normal">{t("object.max", lang)}</th>
                      {guid ? <th className="text-right font-normal">{t("inst.this", lang)}</th> : null}
                      <th className="pl-2 text-left font-normal">Qto · {t("object.derived", lang).toLowerCase()} · {t("req.mangler", lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qtoLines.map((l, i) => {
                      const mine = current?.q ? current.q[i * 2] : null;
                      return (
                        <tr key={l.kind} data-qto={l.kind}>
                          <td className="text-muted">{`${t(l.kind === "volume" ? "measure.volume" : l.kind === "area" ? "measure.area" : "inst.length", lang)} ${l.unit}`}</td>
                          <td className="text-right text-ink">{num(l.sum, lang)}</td>
                          <td className="text-right">{num(l.min, lang)}</td>
                          <td className="text-right">{num(l.median, lang)}</td>
                          <td className="text-right">{num(l.max, lang)}</td>
                          {guid ? <td className="text-right text-ink" data-this-value="">{num(mine as number | null, lang)}</td> : null}
                          <td className="pl-2 whitespace-nowrap text-muted">
                            {`${l.split.qto} · ${l.split.computed} · `}
                            <span className={l.split.missing ? "text-bad" : ""}>{l.split.missing}</span>
                            {l.split.pending ? ` · ${t("inst.pending", lang)} ${l.split.pending}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <AbsentLine absent={page.qto as Absent} lang={lang} />
              )}
            </Tile>

            <Tile place={layout.tiles.dist} head={t("col.instances", lang)} figure={formatCount(n, lang)} data={{ "data-type-dist": "" }}>
              <div className="text-[9.5px] text-muted">{t("col.storey", lang)}</div>
              {[...page.storeys].reverse().map((s) => (
                <div key={s.guid ?? "-"} className="flex items-center gap-2" data-dist-storey={s.name ?? ""}>
                  <span className="w-20 shrink-0 truncate text-ink" title={s.name ?? s.guid ?? ""}>{s.guid === null ? t("matrix.noStorey", lang) : (s.name ?? s.guid)}</span>
                  <span className="h-2 min-w-[2px] rounded-[2px] bg-muted/60" style={{ width: `${Math.max(2, (s.n / n) * 100)}%`, maxWidth: "60%" }} />
                  <span className="shrink-0 text-muted tabular-nums">{formatCount(s.n, lang)}</span>
                </div>
              ))}
              <div className="mt-1 text-[9.5px] text-muted">{t("label.models", lang)}</div>
              {page.models.map((m) => (
                <div key={m.value ?? "-"} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink">{m.value}</span>
                  <span className="shrink-0 text-muted tabular-nums">{formatCount(m.n, lang)}</span>
                </div>
              ))}
            </Tile>

            <Tile place={layout.tiles.reqs} head={`${t("req.group.ifc", lang)} · ${t("req.group.std", lang)}`} data={{ "data-type-reqs": "" }}>
              {page.reqs.length === 0 ? <div className="text-muted">—</div> : null}
              {page.reqs.map((r, i) => {
                const prev = page.reqs[i - 1];
                const label = r.label ? t(r.label, lang) : hasString(`check.${r.id}`) ? t(`check.${r.id}` as StringKey, lang) : r.id;
                return (
                  <div key={`${r.id}${i}`}>
                    {r.group !== (prev?.group ?? undefined) && r.group ? (
                      <div className="pt-1 text-[9.5px] text-muted">{t(r.group === "ifc" ? "req.group.ifc" : "req.group.std", lang)}</div>
                    ) : null}
                    {r.group === null && prev?.group !== null ? <div className="pt-1 text-[9.5px] text-muted">{t("col.check", lang)}</div> : null}
                    <button
                      type="button"
                      disabled={!r.focus}
                      onClick={() => r.focus && onScope(r.focus, r.group === "std" ? "project" : "checks")}
                      className="flex w-full items-center gap-2 text-left enabled:hover:text-green disabled:cursor-default"
                      data-type-req={r.id}
                    >
                      <Dot state={r.state} />
                      <span className="min-w-0 flex-1 truncate text-ink" title={`${label}\n${r.grunn.map((g) => `${g.value} · ${g.n}`).join("\n")}`}>{label}</span>
                      <span className={"shrink-0 tabular-nums " + (r.failed ? "text-bad" : "text-muted")}>
                        {r.state === "not_configured" ? t("req.state.not_configured", lang) : `${formatCount(r.failed, lang)} / ${formatCount(n, lang)}`}
                      </span>
                    </button>
                  </div>
                );
              })}
              {page.ids ? (
                <>
                  <div className="pt-1 text-[9.5px] text-muted">{t("ids.heading", lang)}</div>
                  {page.ids.map((s) => (
                    <button
                      key={s.index}
                      type="button"
                      onClick={() => onScope(s.focus, "project")}
                      className="flex w-full items-center gap-2 text-left hover:text-green"
                      data-type-ids={s.index}
                    >
                      <Dot state={s.state} />
                      <span className="min-w-0 flex-1 truncate text-ink" title={s.name}>{s.name}</span>
                      <span className={"shrink-0 tabular-nums " + (s.failed ? "text-bad" : "text-muted")}>{`${formatCount(s.failed, lang)} / ${formatCount(n, lang)}`}</span>
                    </button>
                  ))}
                </>
              ) : null}
            </Tile>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InstanceTable({
  lang,
  rows,
  current,
  sort,
  onSort,
  onGo,
  mmi,
  copy,
}: {
  lang: Lang;
  rows: { r: InstanceRow; i: number }[];
  current: string | null;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  onGo: (pos: number) => void;
  mmi: boolean;
  copy: boolean;
}) {
  const cols: { key: SortKey; label: string; right?: boolean }[] = [
    { key: "order", label: "#", right: true },
    { key: "guid", label: t("col.guid", lang) },
    { key: "name", label: t("col.name", lang) },
    { key: "storey", label: t("col.storey", lang) },
    ...(mmi ? [{ key: "mmi" as SortKey, label: t("req.mmi", lang) }] : []),
    ...(copy ? [{ key: "copy" as SortKey, label: t("req.kopiobjekt", lang) }] : []),
    { key: "status", label: t("req.fase", lang) },
    { key: "v", label: "m³", right: true },
    { key: "a", label: "m²", right: true },
    { key: "l", label: "m", right: true },
  ];
  const q = (v: number | null | undefined, src: number | undefined) =>
    v === null || v === undefined ? (src === 3 ? "…" : "—") : v.toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: v < 10 ? 2 : 1 });
  return (
    <table className="w-full border-collapse tabular-nums">
      <thead className="sticky top-0 bg-input/95">
        <tr className="text-[9.5px] text-muted">
          {cols.map((c) => (
            <th key={c.key} className={"cursor-pointer font-normal whitespace-nowrap select-none hover:text-ink " + (c.right ? "text-right" : "text-left")} onClick={() => onSort(c.key)} data-sort={c.key}>
              {c.label}
              {sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ r, i }) => (
          <tr
            key={r.guid}
            onClick={() => onGo(i)}
            className={"cursor-pointer " + (current === r.guid ? "bg-ink/10" : "hover:bg-ink/5")}
            data-instance-row={r.guid}
            data-current={current === r.guid ? "" : undefined}
          >
            <td className="pr-2 text-right text-muted">{i + 1}</td>
            <td className="pr-2 whitespace-nowrap text-ink">{r.guid}</td>
            <td className="max-w-[14rem] truncate pr-2 text-ink" title={r.name ?? ""}>{r.name ?? "—"}</td>
            <td className="max-w-[8rem] truncate pr-2">{r.storey ?? "—"}</td>
            {mmi ? <td className="pr-2">{r.mmi ?? "—"}</td> : null}
            {copy ? <td className="pr-2">{r.copy ?? "—"}</td> : null}
            <td className="pr-2">{r.status ?? "—"}</td>
            <td className={"pr-2 text-right " + (r.q?.[1] === 1 ? "italic" : "")}>{q(r.q?.[0], r.q?.[1])}</td>
            <td className={"pr-2 text-right " + (r.q?.[3] === 1 ? "italic" : "")}>{q(r.q?.[2], r.q?.[3])}</td>
            <td className="text-right">{q(r.q?.[4], r.q?.[5])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
