/** Rom: the model's spaces, apart from the treemaps (edkjo 2026-09-28:
 * *"spaces should be kept separate from the treemap. I think it could be cool
 * to add a tab for spaces in fact. Spacial with an aggregated room/space
 * schedule"*).
 *
 * Two tiles on the module grid (`roomTiles`):
 *
 *   Romskjema  the spaces grouped by room name (LongName, else Name) or by
 *              storey: count, area, volume (`rooms.ts`, the quantities the
 *              treemaps resolve: BaseQuantities first, the closed-mesh
 *              estimate second). A group opens to its rooms.
 *   3D · Plan  the board's one scene, lent, under a lens that draws only the
 *              spaces in their group's colour (`SceneLens`); or the spaces of
 *              one storey as a plan (`room-plan.ts`), coloured the same.
 *
 * The one filter, one origin: a group row is origin `rooms` with the group's
 * rooms as the filter. A room row, a room in the plan or a room in the 3D
 * only SELECTS it; the filter stays (`filter-state.ts`, 2026-09-29). The
 * origin keeps its items and dims all but the chosen; the other surfaces
 * isolate (the plan by `Vis kun / Uthev`, as the 3D). Every
 * choice is framed: the scene by its own rule, the plan by its box, on the
 * storey that holds it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { ModelEntry } from "./useModels";
import type { FilterAction, ModelView } from "./cross-filter";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount, formatQuantity } from "./format";
import { isoOf, xfMark, type Xf } from "./origins";
import { LentViewer } from "./BoardViewer";
import { NoGeometryMark } from "./Gallery";
import { useModuleGrid, VARS } from "./alt/AltBoard";
import { MG_GAP, MG_HEAD, roomTiles, type MgPlace } from "./alt/module-grid";
import { SourceLine } from "./alt/Charts";
import { CATEGORICAL, css, type Rgb } from "./chart-colors";
import { findDock, onDocksChanged } from "../viewer/dock";
import type { SceneLens } from "../viewer/scene";
import { planBounds, planShapes, type PlanShape } from "./room-plan";
import { roomLabel, roomSchedule, totalOf, type RoomGroup, type RoomGrouping, type RoomRow, type RoomSum } from "../engine/rooms";
import type { ElementQuantity } from "../engine/quantities";

const NUM = "px-2 text-right font-mono text-[11.5px] tabular-nums";
const NO_STOREY = "";

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function RoomsTab({
  lang,
  model,
  view,
  xf,
  active,
  onDispatch,
}: {
  lang: Lang;
  model: ModelEntry;
  /** The panel's one filter and selection. */
  view: ModelView;
  xf: Xf;
  /** The tab is on screen: the viewer is lent and the lens held only then. */
  active: boolean;
  onDispatch: (action: FilterAction) => void;
}) {
  const { ref, grid } = useModuleGrid();
  const profile = model.profile;
  const [grouping, setGrouping] = useState<RoomGrouping>("name");
  const [spatial, setSpatial] = useState<"3d" | "plan">("3d");

  const rooms = useMemo<RoomRow[]>(
    () =>
      (profile?.rows ?? [])
        .filter((r) => r.entity === "IfcSpace")
        .map((r) => ({ guid: r.guid, name: r.name, longName: r.longName, storeyGuid: r.storeyGuid })),
    [profile],
  );
  const storeys = useMemo(() => profile?.storeys ?? [], [profile]);
  const quantities = model.elementQuantities?.byGuid;
  // The whole schedule: the colours, and what a click takes (the whole group,
  // so a click replaces the filter and never intersects it).
  const full = useMemo(() => roomSchedule(rooms, grouping, quantities, storeys), [rooms, grouping, quantities, storeys]);
  const colourOf = useMemo(() => {
    const byGuid = new Map<string, Rgb>();
    full.forEach((g, i) => {
      for (const guid of g.guids) byGuid.set(guid, CATEGORICAL[i % CATEGORICAL.length]);
    });
    return byGuid;
  }, [full]);
  const groupColour = useMemo(() => new Map(full.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]])), [full]);

  // Isolated by a filter from another view: only the matching rooms.
  const scheduleIso = isoOf(xf, "rooms");
  const shownRooms = useMemo(() => (scheduleIso ? rooms.filter((r) => scheduleIso.has(r.guid)) : rooms), [rooms, scheduleIso]);
  const groups = useMemo(
    () => (scheduleIso ? roomSchedule(shownRooms, grouping, quantities, storeys) : full),
    [scheduleIso, shownRooms, grouping, quantities, storeys, full],
  );

  const pickGroup = (group: RoomGroup) => {
    const whole = full.find((g) => g.key === group.key) ?? group;
    onDispatch({
      type: "choose",
      origin: "rooms",
      key: `room:${grouping}:${group.key}`,
      filter: { kind: "room", label: group.label ?? "—", guids: whole.guids },
      scope: { kind: "element", guids: whole.guids },
    });
  };
  const labelOf = useMemo(() => new Map(rooms.map((r) => [r.guid, roomLabel(r)])), [rooms]);
  // A room row or a room in the plan selects it; the filter stays.
  const pickRoom = (guid: string | null, event: MouseEvent) =>
    onDispatch({ type: "select", guid, additive: event.shiftKey || event.ctrlKey || event.metaKey });

  const tiles = grid ? roomTiles(grid) : null;
  const scheduleBody = (
    <Schedule
      lang={lang}
      groups={groups}
      grouping={grouping}
      colour={(key) => groupColour.get(key) ?? CATEGORICAL[0]}
      labelOf={(guid) => labelOf.get(guid) ?? null}
      rooms={rooms}
      storeys={storeys}
      quantities={quantities}
      view={view}
      notRead={rooms.length > 0 && !profile?.longNames}
      onGroup={pickGroup}
      onRoom={pickRoom}
    />
  );

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS} data-rooms-tab>
      {grid && tiles ? (
        <div
          data-mg-grid
          data-mg-design="rooms"
          data-mg-cols={grid.cols}
          data-mg-rows={grid.rows}
          data-mg-u={grid.u.toFixed(4)}
          className="alt-board mx-auto grid"
          style={{
            width: grid.cols * grid.u + (grid.cols - 1) * MG_GAP,
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.u}px)`,
            gridTemplateRows: `repeat(${Math.max(grid.rows, tiles.schedule.y + tiles.schedule.h)}, ${grid.u}px)`,
            gap: MG_GAP,
          }}
        >
          <Frame
            place={tiles.spatial}
            head={
              <Toggle
                value={spatial}
                options={[
                  ["3d", t("rooms.3d", lang)],
                  ["plan", t("rooms.plan", lang)],
                ]}
                onChange={setSpatial}
                data="spatial"
              />
            }
            xf={spatial === "plan" ? xfMark(xf, "room-plan") : undefined}
          >
            {spatial === "3d" ? (
              <Lensed model={model} active={active} colourOf={colourOf} />
            ) : (
              <Plan
                lang={lang}
                model={model}
                rooms={rooms}
                storeys={storeys}
                colourOf={colourOf}
                labelOf={labelOf}
                view={view}
                iso={isoOf(xf, "room-plan")}
                onPick={pickRoom}
              />
            )}
          </Frame>
          <Frame
            place={tiles.schedule}
            label={t("rooms.schedule", lang)}
            head={
              <Toggle
                value={grouping}
                options={[
                  ["name", t("col.name", lang)],
                  ["storey", t("col.storey", lang)],
                ]}
                onChange={setGrouping}
                data="grouping"
              />
            }
            xf={xfMark(xf, "rooms")}
          >
            {scheduleBody}
          </Frame>
        </div>
      ) : null}
    </div>
  );
}

/* ── the tile frame and the head toggle ───────────────────────────────── */

function Frame({
  place,
  label,
  head,
  xf,
  children,
}: {
  place: MgPlace;
  label?: string;
  head?: ReactNode;
  xf?: "origin" | "whole";
  children: ReactNode;
}) {
  return (
    <section
      data-mg-tile={place.id}
      data-mg-kind={place.kind}
      data-mg-at={`${place.x},${place.y},${place.w},${place.h}`}
      className="alt-card flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ gridColumn: `${place.x + 1} / span ${place.w}`, gridRow: `${place.y + 1} / span ${place.h}` }}
    >
      <div className="alt-head relative flex shrink-0 items-center gap-2 px-3" style={{ height: MG_HEAD }}>
        {label ? <span className="alt-label whitespace-nowrap">{label}</span> : null}
        {head}
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-xf={xf}>
        {children}
      </div>
    </section>
  );
}

function Toggle<T extends string>({
  value,
  options,
  onChange,
  data,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  data: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" data-toggle={data}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-option={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className="alt-tab alt-measure shrink-0 px-1.5 py-0.5"
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/* ── the schedule ─────────────────────────────────────────────────────── */

function sumCell(sum: RoomSum, unit: "m²" | "m³", lang: Lang): string {
  if (sum.pending > 0) return "…";
  if (sum.qto + sum.computed === 0) return "—";
  return formatQuantity(sum.value, unit, lang);
}

function sumTitle(sum: RoomSum, lang: Lang): string {
  const parts: string[] = [];
  if (sum.qto) parts.push(`Qto ${formatCount(sum.qto, lang)}`);
  if (sum.computed) parts.push(`${t("object.derived", lang)} ${formatCount(sum.computed, lang)}`);
  if (sum.missing) parts.push(`${t("req.mangler", lang)} ${formatCount(sum.missing, lang)}`);
  if (sum.pending) parts.push(`… ${formatCount(sum.pending, lang)}`);
  return parts.join(" · ");
}

function Schedule({
  lang,
  groups,
  grouping,
  colour,
  labelOf,
  rooms,
  storeys,
  quantities,
  view,
  notRead,
  onGroup,
  onRoom,
}: {
  lang: Lang;
  groups: RoomGroup[];
  grouping: RoomGrouping;
  colour: (key: string) => Rgb;
  labelOf: (guid: string) => string | null;
  rooms: RoomRow[];
  storeys: { guid: string; name: string | null }[];
  quantities: Record<string, ElementQuantity> | undefined;
  view: ModelView;
  notRead: boolean;
  onGroup: (group: RoomGroup) => void;
  onRoom: (guid: string | null, event: MouseEvent) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const byGuid = useMemo(() => new Map(rooms.map((r) => [r.guid, r])), [rooms]);
  const storeyName = useMemo(() => new Map(storeys.map((s) => [s.guid, s.name ?? s.guid])), [storeys]);
  const chosenKey = view.origin === "rooms" ? view.key : null;
  const selected = useMemo(() => new Set(view.selection), [view.selection]);

  // A selected room opens its group and comes into view (the list's framing).
  const selectionKey = view.selection.join(",");
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!selectionKey) return;
    const keys = groups.filter((g) => g.guids.some((guid) => selected.has(guid))).map((g) => g.key);
    if (keys.length === 0) return;
    setOpen((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])));
    // `groups` changes with the filter; the selection is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, grouping]);
  useLayoutEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectionKey, open]);

  if (rooms.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-[12px] text-muted">{t("bcf.noSpaces", lang)}</div>;
  }
  const total = { area: totalOf(groups, (g) => g.area), volume: totalOf(groups, (g) => g.volume) };
  const n = groups.reduce((s, g) => s + g.guids.length, 0);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  let firstSelected = true;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-room-schedule={grouping}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-24" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-[11px] text-muted">
              <th className="px-3 py-1.5 text-left font-medium">{t(grouping === "name" ? "col.name" : "col.storey", lang)}</th>
              <th className={`${NUM} py-1.5 font-medium`}>{t("col.count", lang)}</th>
              <th className={`${NUM} py-1.5 font-medium`}>{`${t("measure.area", lang)} m²`}</th>
              <th className={`${NUM} py-1.5 font-medium`}>{`${t("measure.volume", lang)} m³`}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const isOpen = open.has(group.key);
              const chosen = chosenKey === `room:${grouping}:${group.key}`;
              const holds = view.origin === "rooms" && group.guids.some((guid) => selected.has(guid));
              const holdsSel = group.guids.some((guid) => selected.has(guid));
              return [
                <tr
                  key={group.key}
                  data-room-group={group.key}
                  data-chosen={chosen ? "" : undefined}
                  data-xf-in={holds ? "" : undefined}
                  data-sel={holdsSel ? "" : undefined}
                  onClick={() => onGroup(group)}
                  className={"cursor-pointer border-b border-line/60 hover:bg-ink/5 " + (chosen ? "alt-chosen" : "")}
                >
                  <td className="truncate px-2 py-1 text-ink" title={group.label ?? undefined}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      data-room-open={group.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(group.key);
                      }}
                      className="mr-1 inline-block w-4 text-center font-mono text-[10px] text-muted hover:text-ink"
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-[-1px]"
                      style={{ background: css(colour(group.key)) }}
                    />
                    {group.label ?? (grouping === "storey" ? t("matrix.noStorey", lang) : "—")}
                  </td>
                  <td className={NUM}>{formatCount(group.guids.length, lang)}</td>
                  <td className={NUM} title={sumTitle(group.area, lang)}>{sumCell(group.area, "m²", lang)}</td>
                  <td className={NUM} title={sumTitle(group.volume, lang)}>{sumCell(group.volume, "m³", lang)}</td>
                </tr>,
                ...(isOpen
                  ? group.guids.map((guid) => {
                      const room = byGuid.get(guid);
                      const q = quantities?.[guid];
                      const on = selected.has(guid);
                      const ref = on && firstSelected ? rowRef : undefined;
                      if (on) firstSelected = false;
                      const own = labelOf(guid);
                      const sub =
                        grouping === "name"
                          ? room?.storeyGuid
                            ? (storeyName.get(room.storeyGuid) ?? null)
                            : t("matrix.noStorey", lang)
                          : null;
                      const number = room?.longName && room.name?.trim() ? room.name.trim() : null;
                      const one = (value: number | null | undefined, source: number | undefined, unit: "m²" | "m³") =>
                        source === undefined || source === 3 ? "…" : value === null || value === undefined || source === 2 ? "—" : formatQuantity(value, unit, lang);
                      return (
                        <tr
                          key={`${group.key}/${guid}`}
                          ref={ref}
                          data-room={guid}
                          data-chosen={on ? "" : undefined}
                          data-xf-in={chosen ? "" : undefined}
                          data-sel={on ? "" : undefined}
                          aria-current={on ? "true" : undefined}
                          onClick={(event) => onRoom(guid, event)}
                          className="cursor-pointer border-b border-line/30 text-[11.5px] hover:bg-ink/5"
                        >
                          <td className="truncate py-0.5 pr-2 pl-9 text-ink" title={guid}>
                            {grouping === "name" ? (number ?? own ?? "—") : (own ?? "—")}
                            {grouping === "storey" && number ? <span className="ml-1.5 font-mono text-[10px] text-muted">{number}</span> : null}
                            {sub ? <span className="ml-1.5 text-[10px] text-muted">{sub}</span> : null}
                          </td>
                          <td className={NUM} />
                          <td className={NUM + (q?.[3] === 1 ? " text-muted" : "")}>{one(q?.[2], q?.[3], "m²")}</td>
                          <td className={NUM + (q?.[1] === 1 ? " text-muted" : "")}>{one(q?.[0], q?.[1], "m³")}</td>
                        </tr>
                      );
                    })
                  : []),
              ];
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-panel">
            <tr className="border-t border-line text-[11.5px] font-semibold">
              <td className="px-3 py-1 text-ink">{t("inst.sum", lang)}</td>
              <td className={NUM}>{formatCount(n, lang)}</td>
              <td className={NUM} title={sumTitle(total.area, lang)}>{sumCell(total.area, "m²", lang)}</td>
              <td className={NUM} title={sumTitle(total.volume, lang)}>{sumCell(total.volume, "m³", lang)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex shrink-0 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 pl-2 font-mono text-[10px] text-muted">{t("measure.area", lang)}</span>
          <SourceLine split={total.area} lang={lang} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 pl-2 font-mono text-[10px] text-muted">{t("measure.volume", lang)}</span>
          <SourceLine split={total.volume} lang={lang} />
        </div>
        {notRead ? (
          <div data-longname-unread className="px-2 pb-1 font-mono text-[10px] text-muted">{`LongName · ${t("type.notSupplied", lang)}`}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ── 3D: the board's scene under the rooms lens ───────────────────────── */

function Lensed({ model, active, colourOf }: { model: ModelEntry; active: boolean; colourOf: Map<string, Rgb> }) {
  const [, bump] = useState(0);
  useEffect(() => onDocksChanged(() => bump((k) => k + 1)), []);
  const dock = findDock(model.meshBatches);
  const lens = useMemo<SceneLens>(
    () => ({ only: new Set(colourOf.keys()), colours: new Map([...colourOf].map(([g, c]) => [g, hex(c)])) }),
    [colourOf],
  );
  // Declared after the slot (a child) has taken the canvas, so the lens and
  // its framing see the tile's own viewport.
  useLayoutEffect(() => {
    if (!dock || !active) return;
    dock.scene.setLens(lens);
    return () => dock.scene.setLens(null);
  }, [dock, active, lens]);
  return <LentViewer meshBatches={model.meshBatches} active={active} className="flex-1" data={{ "data-rooms-3d": "" }} />;
}

/* ── the plan ─────────────────────────────────────────────────────────── */

function Plan({
  lang,
  model,
  rooms,
  storeys,
  colourOf,
  labelOf,
  view,
  iso,
  onPick,
}: {
  lang: Lang;
  model: ModelEntry;
  rooms: RoomRow[];
  storeys: { guid: string; name: string | null; elevation: number | null }[];
  colourOf: Map<string, Rgb>;
  labelOf: Map<string, string | null>;
  view: ModelView;
  /** The filter's rooms when another view is the origin, else null. */
  iso: Set<string> | null;
  onPick: (guid: string | null, event: MouseEvent) => void;
}) {
  const guids = useMemo(() => new Set(rooms.map((r) => r.guid)), [rooms]);
  const shapes = useMemo(() => planShapes(model.meshBatches, guids), [model.meshBatches, guids]);
  const storeyOf = useMemo(() => new Map(rooms.map((r) => [r.guid, r.storeyGuid ?? NO_STOREY])), [rooms]);
  // The storeys that hold a space with a floor, top floor first.
  const levels = useMemo(() => {
    const count = new Map<string, number>();
    for (const [guid] of shapes) {
      const s = storeyOf.get(guid) ?? NO_STOREY;
      count.set(s, (count.get(s) ?? 0) + 1);
    }
    const byGuid = new Map(storeys.map((s) => [s.guid, s]));
    return [...count.entries()]
      .map(([guid, n]) => ({ guid, n, name: guid ? (byGuid.get(guid)?.name ?? guid) : null, elevation: byGuid.get(guid)?.elevation ?? null }))
      .sort((a, b) => (a.guid === NO_STOREY ? 1 : 0) - (b.guid === NO_STOREY ? 1 : 0) || (b.elevation ?? -Infinity) - (a.elevation ?? -Infinity));
  }, [shapes, storeyOf, storeys]);
  const [storey, setStorey] = useState<string | null>(null);
  const most = levels.reduce<(typeof levels)[number] | null>((best, l) => (!best || l.n > best.n ? l : best), null);
  const current = storey !== null && levels.some((l) => l.guid === storey) ? storey : (most?.guid ?? null);

  // A choice on another storey brings that storey up (the plan's framing).
  const target = view.selection.length > 0 ? view.selection : iso ? [...iso] : [];
  const targetKey = target.join(",");
  useEffect(() => {
    const on = target.filter((g) => shapes.has(g));
    if (on.length === 0 || on.some((g) => storeyOf.get(g) === current)) return;
    setStorey(storeyOf.get(on[0]) ?? null);
    // The choice is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const here = useMemo(
    () => [...shapes.values()].filter((s) => (storeyOf.get(s.guid) ?? NO_STOREY) === current),
    [shapes, storeyOf, current],
  );
  const isolating = iso !== null;
  const drawn = isolating && view.mode === "filter" ? here.filter((s) => iso.has(s.guid)) : here;
  const selected = new Set(view.selection);
  const framedOn = (() => {
    const chosen = here.filter((s) => selected.has(s.guid));
    if (chosen.length > 0) return { shapes: chosen, pad: 0.4 };
    if (isolating) {
      const matched = here.filter((s) => iso.has(s.guid));
      if (matched.length > 0) return { shapes: matched, pad: 0.12 };
    }
    return { shapes: here, pad: 0.05 };
  })();
  const bounds = planBounds(framedOn.shapes);

  const picker =
    levels.length > 0 ? (
      <select
        value={current ?? ""}
        onChange={(event) => setStorey(event.target.value)}
        data-plan-storey
        className="absolute top-2 left-2 z-10 max-w-[60%] rounded-[6px] border border-line bg-input px-1.5 py-0.5 text-[11px] text-ink"
      >
        {levels.map((l) => (
          <option key={l.guid} value={l.guid}>
            {`${l.name ?? t("matrix.noStorey", lang)} · ${formatCount(l.n, lang)}`}
          </option>
        ))}
      </select>
    ) : null;

  if (shapes.size === 0 || !bounds || !size) {
    return (
      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center" data-rooms-plan="">
        {picker}
        {size ? <NoGeometryMark /> : null}
      </div>
    );
  }

  const w = bounds.max[0] - bounds.min[0];
  const h = bounds.max[1] - bounds.min[1];
  const pad = Math.max(Math.max(w, h) * framedOn.pad, 0.5);
  const vb = { x: bounds.min[0] - pad, y: -(bounds.max[1] + pad), w: w + 2 * pad, h: h + 2 * pad };
  const scale = Math.min(size.w / vb.w, size.h / vb.h);
  const font = 10 / scale;

  const pathOf = (s: PlanShape) => {
    let d = "";
    for (let i = 0; i < s.tris.length; i += 6) {
      d += `M${s.tris[i].toFixed(3)} ${(-s.tris[i + 1]).toFixed(3)}L${s.tris[i + 2].toFixed(3)} ${(-s.tris[i + 3]).toFixed(3)}L${s.tris[i + 4].toFixed(3)} ${(-s.tris[i + 5]).toFixed(3)}Z`;
    }
    return d;
  };
  const lineOf = (s: PlanShape) => {
    let d = "";
    for (let i = 0; i < s.outline.length; i += 4) {
      d += `M${s.outline[i].toFixed(3)} ${(-s.outline[i + 1]).toFixed(3)}L${s.outline[i + 2].toFixed(3)} ${(-s.outline[i + 3]).toFixed(3)}`;
    }
    return d;
  };

  return (
    <div ref={box} className="relative flex min-h-0 flex-1" data-rooms-plan={current ?? ""}>
      {picker}
      <svg
        width={size.w}
        height={size.h}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0"
        onClick={(event) => onPick(null, event)}
      >
        {drawn.map((s) => {
          const fill = css(colourOf.get(s.guid) ?? CATEGORICAL[0]);
          const ghost = isolating && !iso.has(s.guid);
          const on = selected.has(s.guid);
          return (
            <g
              key={s.guid}
              data-room={s.guid}
              data-chosen={on ? "" : undefined}
              data-sel={on ? "ring" : undefined}
              className="cursor-pointer"
              opacity={ghost ? 0.22 : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onPick(s.guid, event);
              }}
            >
              <path d={pathOf(s)} fill={fill} stroke={fill} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              <path
                d={lineOf(s)}
                fill="none"
                stroke={on ? "var(--sel)" : "var(--color-ink)"}
                strokeWidth={on ? 2.6 : 0.8}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
        {drawn.map((s) => {
          const label = labelOf.get(s.guid);
          if (!label) return null;
          const wide = (s.max[0] - s.min[0]) * scale;
          const tall = (s.max[1] - s.min[1]) * scale;
          if (tall < 14 || wide < Math.min(label.length, 14) * 5.6) return null;
          return (
            <text
              key={`t${s.guid}`}
              x={s.centre[0]}
              y={-s.centre[1]}
              fontSize={font}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
              fill="var(--color-ink)"
              opacity={isolating && !iso.has(s.guid) ? 0.3 : undefined}
            >
              {label.length > 18 ? `${label.slice(0, 17)}…` : label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
