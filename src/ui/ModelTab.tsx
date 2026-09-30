/** Modell: the board's one 3D viewer and one panel for the selected object
 *  (edkjo 2026-09-30: *"a tab with a pure viewer with only a side panel for
 *  type and instance data of the selected objects. Psets as tabbed 'ears' and
 *  main IFC attributes in the default view"*).
 *
 * The viewer is the board's own scene, lent through `viewer/dock.ts` as the
 * other tabs lend it, so picking, Esc, double-click framing and the teal mark
 * are the scene's own and the selection is the panel's one selection.
 *
 * ── Layout ───────────────────────────────────────────────────────────────
 * Two tiles on the window's module grid (`useModuleGrid`, rule 6), both the
 * full height: the viewer left, the panel right. The panel's width in modules
 * is a function of the grid alone (`modelTiles`), never of the selection
 * (STABLE LAYOUT): the smallest width from a floor of about a quarter of the
 * columns at which the viewer is at most 16 : 9 and the panel at least 1 : 2.
 * Where no width gets the viewer inside 9 : 16 to 16 : 9 (a narrow window),
 * the canvas takes the largest in-bound box inside its area, centred.
 *
 * ── The ears ─────────────────────────────────────────────────────────────
 * The first ear is the IFC attributes: the instance's, then its type's. Then
 * one ear per property set and quantity set, grouped by where the set comes
 * from: the instance's own (`source: "instance"`) and the type's
 * (`source: "type"`, which ifcfast folds onto the occurrence, AGENTS.md "Pset
 * inventory"). A set carrying rows of both sources is two ears. Nothing here
 * says which of two same-named values wins: the codebase has no such rule.
 *
 * Several selected: the first in selection order, with the count.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { ModelEntry } from "./useModels";
import type { ModelView } from "./cross-filter";
import type { ProductRowLite, PsetGroup } from "./profile";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { LentViewer } from "./BoardViewer";
import { useModuleGrid, VARS } from "./alt/AltBoard";
import { MG_GAP, MG_HEAD, mgRow, mgSpanPx, type MgGrid } from "./alt/module-grid";
import { CANVAS_ASPECT } from "./canvas-aspect";

/* ── layout ───────────────────────────────────────────────────────────── */

export interface ModelTiles {
  /** Modules. */
  viewerCols: number;
  panelCols: number;
  /** The canvas box inside the viewer's area, px, relative to the area. */
  canvas: { left: number; top: number; width: number; height: number };
}

/** A pure function of the grid: the same window gives the same tiles. */
export function modelTiles(grid: MgGrid): ModelTiles {
  const { cols, rows, u } = grid;
  const height = rows * mgRow(grid) + (rows - 1) * MG_GAP;
  const floor = Math.min(cols - 1, Math.max(4, Math.round(cols * 0.26)));
  let panelCols = floor;
  for (let p = floor; p <= cols - 2; p += 1) {
    const viewer = mgSpanPx(cols - p, u) / height;
    const panel = mgSpanPx(p, u) / height;
    if (viewer < CANVAS_ASPECT.min) break;
    if (viewer <= CANVAS_ASPECT.max + 1e-9 && panel >= 0.5 - 1e-9) {
      panelCols = p;
      break;
    }
  }
  const viewerCols = Math.max(1, cols - panelCols);
  const areaW = mgSpanPx(viewerCols, u);
  let w = areaW;
  let h = height;
  if (w / h > CANVAS_ASPECT.max) w = Math.floor(h * CANVAS_ASPECT.max);
  else if (w / h < CANVAS_ASPECT.min) h = Math.floor(w / CANVAS_ASPECT.min);
  return {
    viewerCols,
    panelCols,
    canvas: { left: Math.floor((areaW - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h },
  };
}

/* ── data ─────────────────────────────────────────────────────────────── */

type Level = "instance" | "type";

interface Row {
  label: string;
  /** null: nothing to show; the row prints `—`. */
  value: string | null;
  /** A dim token after the value: a property's value type. */
  note?: string | null;
  /** Rendered muted: an absence word, not a value from the file. */
  absent?: boolean;
}

interface Ear {
  key: string;
  level: Level;
  name: string;
  /** `IfcPropertySet` / `IfcElementQuantity`. */
  ifc: string;
  rows: Row[];
}

const ATTRIBUTES = "attributes";

function earsOf(guid: string, psets: Map<string, PsetGroup[]> | undefined, quantities: Map<string, PsetGroup[]> | undefined): Ear[] {
  const ears: Ear[] = [];
  const add = (table: Map<string, PsetGroup[]> | undefined, ifc: string) => {
    for (const set of table?.get(guid) ?? []) {
      for (const level of ["instance", "type"] as const) {
        const own = set.properties.filter((p) => (p.source === "type" ? "type" : "instance") === level);
        if (own.length === 0) continue;
        ears.push({
          key: `${level}\u0000${ifc}\u0000${set.name}`,
          level,
          name: set.name,
          ifc,
          rows: own.map((p) => ({ label: p.name, value: p.value, note: p.valueType ?? null })),
        });
      }
    }
  };
  add(psets, "IfcPropertySet");
  add(quantities, "IfcElementQuantity");
  return ears;
}

/* ── the tab ──────────────────────────────────────────────────────────── */

export function ModelTab({
  lang,
  model,
  view,
  active,
}: {
  lang: Lang;
  model: ModelEntry;
  view: ModelView;
  /** The tab is on screen: the viewer is lent only then. */
  active: boolean;
}) {
  const { ref, grid } = useModuleGrid();
  const tiles = grid ? modelTiles(grid) : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS} data-model-tab>
      {grid && tiles ? (
        <div
          data-mg-grid
          data-mg-design="model"
          data-mg-cols={grid.cols}
          data-mg-rows={grid.rows}
          data-mg-u={grid.u.toFixed(4)}
          className="alt-board mx-auto grid"
          style={{
            width: grid.cols * grid.u + (grid.cols - 1) * MG_GAP,
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
            gridTemplateRows: `repeat(${grid.rows}, ${mgRow(grid)}px)`,
            gap: MG_GAP,
          }}
        >
          <div
            className="relative min-h-0 min-w-0"
            style={{ gridColumn: `1 / span ${tiles.viewerCols}`, gridRow: `1 / span ${grid.rows}` }}
          >
            <LentViewer
              meshBatches={model.meshBatches}
              active={active}
              className="absolute"
              style={tiles.canvas}
              data={{ "data-model-viewer": "" }}
            />
          </div>
          <div
            className="min-h-0 min-w-0"
            style={{ gridColumn: `${tiles.viewerCols + 1} / span ${tiles.panelCols}`, gridRow: `1 / span ${grid.rows}` }}
          >
            <SelectedPanel lang={lang} model={model} selection={view.selection} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── the panel ────────────────────────────────────────────────────────── */

function SelectedPanel({ lang, model, selection }: { lang: Lang; model: ModelEntry; selection: string[] }) {
  const profile = model.profile ?? null;
  const rowOf = useMemo(() => new Map((profile?.rows ?? []).map((r) => [r.guid, r])), [profile]);
  const chosen = selection.map((g) => rowOf.get(g)).filter((r): r is ProductRowLite => r !== undefined);
  const row = chosen[0] ?? null;

  const ears = useMemo(
    () => (row ? earsOf(row.guid, profile?.psets, profile?.quantities) : []),
    [row, profile],
  );
  const notSupplied = profile !== null && profile.psets === undefined && profile.quantities === undefined;

  // The open ear is remembered by key across selections, so stepping from
  // wall to wall keeps `Pset_WallCommon` open; a key the next object does not
  // carry falls back to the attributes.
  const [remembered, setRemembered] = useState<string>(ATTRIBUTES);
  const open = ears.find((e) => e.key === remembered) ?? null;
  const openKey = open ? open.key : ATTRIBUTES;

  const storeyName = (r: ProductRowLite): string => {
    const storey = profile?.storeys.find((s) => s.guid === r.storeyGuid);
    return storey ? (storey.name ?? storey.guid) : t("matrix.noStorey", lang);
  };
  const notSup = t("type.notSupplied", lang);
  const instanceRows: Row[] = [
    { label: t("col.class", lang), value: row?.entity ?? null },
    { label: "GlobalId", value: row?.guid ?? null },
    { label: "Name", value: row?.name ?? null },
    // ifcfast carries no Description on a product row.
    { label: "Description", value: row ? notSup : null, absent: true },
    { label: "ObjectType", value: row?.objectType ?? null },
    { label: "PredefinedType", value: row?.predefinedType ?? null },
    { label: "Tag", value: row?.tag ?? null },
    { label: t("col.storey", lang), value: row ? storeyName(row) : null, note: "IfcRelContainedInSpatialStructure" },
    { label: t("col.type", lang), value: row?.typeName ?? null, note: "IfcRelDefinesByType" },
  ];
  const typed = !!row && (row.typeGuid != null || row.typed === true);
  const typeRows: Row[] = [
    { label: t("col.class", lang), value: row?.typeEntity ?? null },
    { label: "Name", value: row?.typeName ?? null },
    { label: "GlobalId", value: row?.typeGuid ?? null },
    // `TypeObjectRow` is guid, entity and name only.
    { label: "PredefinedType", value: row ? notSup : null, absent: true },
  ];

  const byLevel = (level: Level) => ears.filter((e) => e.level === level);

  return (
    <section data-model-panel="" className="alt-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="alt-head flex shrink-0 items-center gap-2 px-3" style={{ height: MG_HEAD }}>
        <span className="alt-label whitespace-nowrap">{t("tile.object", lang)}</span>
        {chosen.length > 1 ? (
          <span data-model-count={chosen.length} className="font-mono text-[12px] tabular-nums text-ink">
            {`${formatCount(chosen.length, lang)} ${t("trace.elements", lang).toLowerCase()}`}
          </span>
        ) : null}
      </div>

      {/* The ears: one row that wraps, never scrolls sideways. */}
      <div data-ears="" className="flex shrink-0 flex-wrap items-end gap-x-1 gap-y-1 px-2 pt-2">
        <EarButton
          label={t("object.attributes", lang)}
          level="attributes"
          open={openKey === ATTRIBUTES}
          onClick={() => setRemembered(ATTRIBUTES)}
        />
        {(["instance", "type"] as const).map((level) =>
          byLevel(level).length > 0 ? (
            <EarGroup key={level} label={t(level === "instance" ? "inst.this" : "col.type", lang)}>
              {byLevel(level).map((ear) => (
                <EarButton
                  key={ear.key}
                  label={ear.name}
                  level={level}
                  title={ear.ifc}
                  open={ear.key === openKey}
                  onClick={() => setRemembered(ear.key)}
                />
              ))}
            </EarGroup>
          ) : null,
        )}
        {notSupplied ? <span className="px-1 pb-1 font-mono text-[10px] text-muted">{notSup}</span> : null}
      </div>

      {/* The one scroller. */}
      <div data-ear-body={openKey === ATTRIBUTES ? ATTRIBUTES : open!.name} className="min-h-0 flex-1 overflow-auto border-t border-line">
        {open ? (
          <Rows rows={open.rows} />
        ) : (
          <>
            <Head title={t("inst.this", lang)} ifc={row?.entity ?? "IfcObject"} />
            <Rows rows={instanceRows} />
            <Head title={t("col.type", lang)} ifc="IfcTypeObject" />
            {row && !typed ? (
              <div className="px-3 py-1 font-mono text-[11px] text-muted">{t("type.none", lang)}</div>
            ) : (
              <Rows rows={typeRows} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span data-ear-group="" className="contents">
      <span className="ml-2 self-center pb-0.5 text-[9px] font-semibold tracking-[0.12em] text-gold uppercase">{label}</span>
      {children}
    </span>
  );
}

function EarButton({
  label,
  level,
  title,
  open,
  onClick,
}: {
  label: string;
  level: Level | "attributes";
  title?: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-ear={label}
      data-ear-level={level}
      aria-selected={open}
      title={title}
      onClick={onClick}
      className={
        "-mb-px shrink-0 rounded-t-[8px] border border-b-0 px-2 py-1 font-mono text-[11px] whitespace-nowrap " +
        (open ? "border-line bg-input font-semibold text-ink" : "border-transparent text-muted hover:text-green")
      }
    >
      {label}
    </button>
  );
}

function Head({ title, ifc }: { title: string; ifc: string }) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-2 pb-1">
      <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">{title}</span>
      <span className="truncate font-mono text-[9px] text-muted">{ifc}</span>
    </div>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.label}
          data-field={r.label}
          data-value={r.value ?? ""}
          className="grid items-baseline gap-x-3 border-b border-line px-3 py-1"
          style={{ gridTemplateColumns: "minmax(9ch, 38%) minmax(0, 1fr)" }}
        >
          <span title={r.label} className="truncate font-mono text-[11px] text-muted">
            {r.label}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              onDoubleClick={copyOnDoubleClick(r.value ?? "")}
              title={r.value ?? undefined}
              className={
                // The value keeps its width; the note takes what is left.
                "max-w-full min-w-0 shrink-0 cursor-copy truncate font-mono text-[12px] " +
                (r.value === null || r.absent ? "text-muted" : "text-ink")
              }
            >
              {r.value ?? "—"}
            </span>
            {r.note && r.value !== null ? (
              <span title={r.note} className="min-w-0 shrink truncate font-mono text-[9px] text-muted">
                {r.note}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
