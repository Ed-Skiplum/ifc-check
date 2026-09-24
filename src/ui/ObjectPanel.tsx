/** What the engine has for the selected element — all of it, in IFC's own order.
 *
 * edkjo, 2026-09-23, in four instructions that together fix the shape:
 *   *"keep psets and BIM data separate. The attributes and relationships that
 *   form structure and identity and constraints vs data that has been added."*
 *   *"I hate opinionated viewers that hide data."*
 *   *"the idea is to reveal and express what the IFC is saying to non-technical
 *   users."*
 *   *"I'd treat the core IFC attributes as KPIs, so an opinionated strong
 *   display vs getting drowned."*
 *
 * So: hierarchy, never curation. Five lead cards in the board's own KPI
 * vocabulary carry what IDENTIFIES the object; under them every single thing
 * the engine holds, grouped the way the standard itself is built:
 *
 *   1  Attributter   the schema's own attributes on the entity
 *   2  Relasjoner    the objectified `IfcRel*` — containment, type,
 *                    decomposition, voids, material, classification
 *   3  Egenskaper    `IfcRelDefinesByProperties`: one TAB per `IfcPropertySet`
 *                    and per `IfcElementQuantity`, plus the profile tab
 *   4  Beregnet      what THIS TOOL measured, never what the file says
 *
 * Group 4 is kept apart on purpose and is labelled as computed. Mixing a
 * derived number into the file's own rows would make the panel say "the IFC
 * states this" about an arithmetic result, which is the one thing this surface
 * must never do. Every value in it comes from `src/engine/placement.ts` and
 * `src/bcf/spaces.ts` — the same functions, with the same thresholds, that the
 * `mesh-placement` check and the BCF space split run, so a number beside an
 * element and the check's verdict on that element cannot disagree.
 *
 * ── Plain label, IFC term beside it ──────────────────────────────────────
 * Every row and group carries a domain label a coordinator reads, with the IFC
 * term under it as a dimmer token. That pairing is the teaching: after a
 * hundred selections "Etasje" and `IfcRelContainedInSpatialStructure` are the
 * same fact. Labels only — no sentences, no help text, no tooltips with prose.
 *
 * ── Three absences, kept apart ───────────────────────────────────────────
 *   `ikke levert`  the engine carries no such table at all. A fact about the
 *                  plumbing, and the reason a category that ifcfast does not
 *                  expose still gets a section rather than being left out: a
 *                  missing section reads as "the object has none".
 *   `—`            nothing is selected. This surface's own dash.
 *   `ingen`        the selected object declares none. A fact about the FILE.
 *
 * ── One element, several, none ───────────────────────────────────────────
 * One: its values. Several (Shift or Ctrl down the band): the SHARED values,
 * with `Ulike verdier` where they disagree and every variant in the `title`.
 * None: the labels with `—`.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import type {
  ClassificationRef,
  ModelProfile,
  ProductRowLite,
  PsetGroup,
  StoreyRowLite,
} from "./profile";
import type { ModelEntry } from "./useModels";
import {
  collectBoxes,
  placementContext,
  placementOf,
  unshiftBoxes,
  type ElementBox,
  type PlacementContext,
} from "../engine/placement";
import { buildSpaceLocator, countSpaces, type SpaceLocator } from "../bcf/spaces";

const LABEL_WIDTH = "14ch";

/** One row of the panel. `values` is the DISTINCT set over the selection, so
 *  the renderer decides between a value, a disagreement and an absence from the
 *  data rather than from a flag someone had to keep in step. */
interface Field {
  label: string;
  values: string[];
  /** The IFC term this row IS, rendered under the label as a dim token. */
  ifc?: string;
  /** A second, dimmer token after the value — the parser's own `type_source`
   *  beside the type name, a property's value type beside its value. Rendered
   *  only when the values agree. */
  note?: string | null;
}

interface Section {
  title: string;
  ifc?: string;
  fields: Field[];
  /** A section that has no rows because the data is not reachable says so
   *  here, verbatim, instead of rendering empty. */
  state?: string;
  /** Drawn under the rows: the spatial path, the elevation strip. */
  figure?: ReactNode;
}

/** The distinct renderings of one attribute across the selected rows, in
 *  first-seen order. An absent value is dropped rather than rendered as its own
 *  variant: "some of these have no Tag" is `—` plus the ones that do, and a
 *  selection where NONE has one is `—` alone. */
function distinctOf<T>(items: T[], read: (item: T) => string | null): string[] {
  const seen: string[] = [];
  for (const item of items) {
    const value = read(item);
    if (value === null || value === "") continue;
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

function distinct(
  rows: ProductRowLite[],
  read: (row: ProductRowLite) => string | null,
): string[] {
  return distinctOf(rows, read);
}

function bool(value: boolean | null | undefined): string | null {
  // `true` / `false` is how this tool renders an IFC BOOLEAN everywhere else
  // (the type ledger, the copy-object mapping, the xs:boolean lexical form).
  return value === null || value === undefined ? null : String(value);
}

/** Metres, three decimals — the millimetre the source models are drawn in.
 *  Never rounded further, and the unrounded number rides in the row's title. */
function metres(value: number): string {
  return `${value.toFixed(3)} m`;
}

/* ------------------------------------------------------------- group 1 */

function attributeSection(rows: ProductRowLite[], lang: Lang): Section {
  return {
    title: t("object.attributes", lang),
    ifc: "IfcRoot · IfcObject",
    fields: [
      { label: t("col.guid", lang), ifc: "GlobalId", values: distinct(rows, (r) => r.guid) },
      { label: t("col.class", lang), ifc: "entity", values: distinct(rows, (r) => r.entity) },
      { label: t("col.name", lang), ifc: "Name", values: distinct(rows, (r) => r.name) },
      {
        label: t("col.objectType", lang),
        ifc: "ObjectType",
        values: distinct(rows, (r) => r.objectType ?? null),
      },
      { label: t("col.tag", lang), ifc: "Tag", values: distinct(rows, (r) => r.tag ?? null) },
      {
        label: t("col.predefinedType", lang),
        ifc: "PredefinedType",
        values: distinct(rows, (r) => r.predefinedType ?? null),
      },
      // Flattened out of Pset_*Common by the parser, which is why they sit
      // here rather than in a set of their own; the owning set still carries
      // them in group 3, under its own name.
      { label: "IsExternal", ifc: "Pset_*Common", values: distinct(rows, (r) => bool(r.isExternal)) },
      {
        label: "FireRating",
        ifc: "Pset_*Common",
        values: distinct(rows, (r) => r.fireRating ?? null),
      },
      {
        label: "LoadBearing",
        ifc: "Pset_*Common",
        values: distinct(rows, (r) => bool(r.loadBearing)),
      },
    ],
  };
}

/* ------------------------------------------------------------- group 2 */

function storeyOf(profile: ModelProfile | null, guid: string | null): StoreyRowLite | null {
  if (guid === null) return null;
  return profile?.storeys.find((s) => s.guid === guid) ?? null;
}

function nameOfGuid(profile: ModelProfile | null, guid: string | null): string | null {
  if (!guid) return null;
  const row = profile?.rows.find((r) => r.guid === guid);
  if (row) return row.name ? `${row.name} · ${row.entity}` : row.entity;
  const storey = storeyOf(profile, guid);
  if (storey) return storey.name ?? storey.guid;
  const building = profile?.buildings?.find((b) => b.guid === guid);
  if (building) return building.name ?? building.guid;
  return guid;
}

function relationSection(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): Section {
  const storeyName = (row: ProductRowLite): string | null => {
    const storey = storeyOf(profile, row.storeyGuid);
    if (!storey) return t("matrix.noStorey", lang);
    return storey.name ?? storey.guid;
  };
  const buildingName = (row: ProductRowLite): string | null => {
    const storey = storeyOf(profile, row.storeyGuid);
    const guid = storey?.buildingGuid ?? null;
    if (!guid) return null;
    const building = profile?.buildings?.find((b) => b.guid === guid);
    return building ? (building.name ?? building.guid) : guid;
  };
  const sources = distinct(rows, (row) => row.typeSource ?? null);
  const siteNames = (profile?.sites ?? []).map((s) => s.name ?? s.guid);

  const fields: Field[] = [
    {
      label: t("object.site", lang),
      // The graph lists sites but carries no element -> site edge, so this is
      // the file's site roster, not a claim about THIS element's parent.
      ifc: "IfcSite",
      values: siteNames,
    },
    {
      label: t("object.building", lang),
      ifc: "IfcRelAggregates",
      values: distinct(rows, buildingName),
    },
    {
      label: t("col.storey", lang),
      ifc: "IfcRelContainedInSpatialStructure",
      values: distinct(rows, storeyName),
    },
    {
      label: t("col.type", lang),
      ifc: "IfcRelDefinesByType",
      values: distinct(rows, (r) => r.typeName ?? null),
      // Verbatim from the parser (`ifctype` / `none`), not a word of ours.
      note: sources.length === 1 ? sources[0] : null,
    },
    {
      label: t("object.typeObject", lang),
      ifc: "IfcTypeObject.GlobalId",
      values: distinct(rows, (r) => r.typeGuid ?? null),
    },
    {
      label: t("object.partOf", lang),
      ifc: "IfcRelAggregates · IfcRelNests",
      values: distinct(rows, (r) => nameOfGuid(profile, r.parentGuid ?? null)),
      note: distinct(rows, (r) => r.parentKind ?? null)[0] ?? null,
    },
    {
      label: t("object.openings", lang),
      ifc: "IfcRelVoidsElement",
      values: distinct(rows, (r) =>
        r.openingGuids && r.openingGuids.length > 0 ? formatCount(r.openingGuids.length, lang) : null,
      ),
    },
    {
      label: t("object.opening", lang),
      ifc: "IfcRelVoidsElement.RelatingBuildingElement",
      values: distinct(rows, (r) => nameOfGuid(profile, r.hostGuid ?? null)),
    },
    {
      label: t("col.materials", lang),
      ifc: "IfcRelAssociatesMaterial",
      values: distinct(rows, (r) => (r.materials?.length ? r.materials.join(" · ") : null)),
    },
    {
      label: "IfcMaterialLayerSet",
      ifc: "IfcMaterialLayerSetUsage",
      values: distinct(rows, (r) => r.layerSet ?? null),
    },
  ];

  return {
    title: t("object.relations", lang),
    ifc: "IfcRelationship",
    fields: [...fields, ...classificationFields(rows, profile, lang)],
  };
}

/** One row per classification SYSTEM. Everything the reference carries is on
 *  the line — code, name, edition, location, publisher — because dropping a
 *  column would be this panel hiding data, and the whole line is copyable. */
function classificationFields(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): Field[] {
  const table = profile?.classifications;
  if (table === undefined) {
    return [
      {
        label: t("type.classifications", lang),
        ifc: "IfcRelAssociatesClassification",
        values: [],
        note: t("type.notSupplied", lang),
      },
    ];
  }
  const refs = rows.flatMap((row) => table.get(row.guid) ?? []);
  if (refs.length === 0) {
    return [
      {
        label: t("type.classifications", lang),
        ifc: "IfcRelAssociatesClassification",
        values: rows.length === 0 ? [] : [t("type.none", lang)],
      },
    ];
  }
  const systems: string[] = [];
  for (const ref of refs) {
    const system = ref.system ?? "—";
    if (!systems.includes(system)) systems.push(system);
  }
  const render = (ref: ClassificationRef): string | null =>
    [ref.code, ref.name, ref.edition, ref.location, ref.publisher]
      .filter((part) => part)
      .join(" · ") || null;
  return systems.map((system) => {
    const mine = refs.filter((ref) => (ref.system ?? "—") === system);
    const assignments = distinctOf(mine, (ref) => ref.assignmentSource ?? null);
    return {
      label: system,
      ifc: "IfcClassificationReference",
      values: distinctOf(mine, render),
      note: assignments.length === 1 ? assignments[0] : null,
    };
  });
}

/* ------------------------------------------------------------- group 3 */

/** A tab: one property set, one quantity set, or the profile. */
interface DataTab {
  name: string;
  /** `IfcPropertySet` / `IfcElementQuantity` / `IfcProfileDef`. */
  ifc: string;
  /** buildingSMART's own namespace (`Pset_`, `Qto_`) vs the project's. */
  standard: boolean;
  fields: Field[];
  state?: string;
}

const STANDARD = /^(pset|qto)_/i;

/** The tabs, and — when there are no SET tabs at all — which of the three
 *  absences that is. The two are one answer: a strip carrying only the profile
 *  tab says nothing about whether this element has property sets, so the group
 *  says it in its own line above the strip. */
function dataTabs(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): { tabs: DataTab[]; absence: string | null } {
  const tabs: DataTab[] = [];
  const add = (
    table: Map<string, PsetGroup[]> | undefined,
    ifcOf: (group: PsetGroup) => string,
  ) => {
    if (table === undefined) return;
    const sets = rows.flatMap((row) => table.get(row.guid) ?? []);
    const names: string[] = [];
    for (const set of sets) if (!names.includes(set.name)) names.push(set.name);
    for (const name of names) {
      const mine = sets.filter((set) => set.name === name);
      const properties = mine.flatMap((set) => set.properties);
      const propertyNames: string[] = [];
      for (const property of properties) {
        if (!propertyNames.includes(property.name)) propertyNames.push(property.name);
      }
      tabs.push({
        name,
        ifc: ifcOf(mine[0]),
        standard: STANDARD.test(name),
        fields: propertyNames.map((propertyName) => {
          const own = properties.filter((property) => property.name === propertyName);
          const types = distinctOf(own, (property) => property.valueType ?? null);
          const sources = distinctOf(own, (property) => property.source ?? null);
          return {
            label: propertyName,
            ifc: types.length === 1 ? types[0] : undefined,
            values: distinctOf(own, (property) => property.value),
            note: sources.length === 1 ? sources[0] : null,
          };
        }),
      });
    }
  };
  add(profile?.psets, () => "IfcPropertySet");
  add(profile?.quantities, () => "IfcElementQuantity");

  // Standard namespace first, the project's own after: an ordering, not a
  // filter. Within each half the file's own order is kept.
  tabs.sort((a, b) => Number(b.standard) - Number(a.standard));

  // The profile is a tab that exists to state its own absence. ifcfast's wasm
  // build exposes no `IfcProfileDef` accessor at all, so leaving the tab out
  // would read as "this element has no profile" — a claim about the FILE made
  // out of a gap in the plumbing.
  tabs.push({
    name: t("object.profile", lang),
    ifc: "IfcProfileDef",
    standard: true,
    fields: [],
    state: t("type.notSupplied", lang),
  });

  const supplied = profile?.psets !== undefined || profile?.quantities !== undefined;
  const absence =
    tabs.length > 1
      ? null
      : !supplied
        ? t("type.notSupplied", lang)
        : rows.length === 0
          ? "—"
          : t("type.none", lang);
  return { tabs, absence };
}

/* ------------------------------------------------------------- group 4 */

interface Derived {
  context: PlacementContext | null;
  locator: SpaceLocator | null;
  /** Why no context could be built. */
  reason: string | null;
  capped: boolean;
  /** Triangles per element, summed over the batches it arrived in. */
  triangles?: Map<string, number>;
}

function derivedSection(rows: ProductRowLite[], derived: Derived, lang: Lang): Section {
  const title = t("object.derived", lang);
  if (!derived.context) {
    return {
      title,
      fields: [],
      state: derived.reason ?? t("object.notComputed", lang),
    };
  }
  const ctx = derived.context;
  const places = rows.map((row) => placementOf(row.guid, ctx));
  const boxed = places.filter((place) => place.box !== null);

  const fields: Field[] = [
    {
      label: t("object.storeyByMesh", lang),
      values: distinctOf(places, (place) =>
        place.expected ? (place.expected.name ?? place.expected.guid) : null,
      ),
      note: distinctOf(places, (place) => place.storeyReason)[0] ?? null,
    },
    {
      label: t("object.bottom", lang),
      values: distinctOf(places, (place) => (place.bottom === null ? null : metres(place.bottom))),
    },
    {
      label: t("object.overStorey", lang),
      values: distinctOf(places, (place) =>
        place.delta === null ? null : `${place.delta >= 0 ? "+" : ""}${place.delta.toFixed(3)} m`,
      ),
    },
    {
      label: t("object.dimensions", lang),
      values:
        boxed.length === 0
          ? []
          : distinctOf(boxed, (place) =>
              [0, 1, 2]
                .map((a) => (place.box!.max[a] - place.box!.min[a]).toFixed(3))
                .join(" × ") + " m",
            ),
      note: "x × y × z",
    },
    {
      label: t("object.min", lang),
      values: distinctOf(boxed, (place) => place.box!.min.map((v) => v.toFixed(3)).join(", ")),
    },
    {
      label: t("object.max", lang),
      values: distinctOf(boxed, (place) => place.box!.max.map((v) => v.toFixed(3)).join(", ")),
    },
    {
      label: t("object.centre", lang),
      values: distinctOf(boxed, (place) => place.centre!.map((v) => v.toFixed(3)).join(", ")),
    },
    {
      label: t("object.fromBody", lang),
      values: distinctOf(places, (place) => (place.distance === null ? null : metres(place.distance))),
      note: `${t("object.cutoff", lang)} ${ctx.cutoff.toFixed(1)} m`,
    },
    {
      label: t("col.triangles", lang),
      values: distinctOf(rows, (row) => {
        const tri = triangleCount(row.guid, derived);
        return tri === null ? null : formatCount(tri, lang);
      }),
      note: derived.capped ? t("type.geometryCapped", lang) : null,
    },
    {
      label: t("object.room", lang),
      // No IFC token: this row is MEASURED, not read. The note says whether
      // the model carries any IfcSpace to be inside of in the first place.
      values: derived.locator
        ? distinctOf(boxed, (place) => derived.locator!.discreteSpace(place.box!)?.name ?? null)
        : [],
      note: derived.locator ? null : t("type.none", lang),
    },
  ];

  return {
    title,
    fields,
    state: boxed.length === 0 && rows.length > 0 ? t("object.noGeometry", lang) : undefined,
    figure:
      boxed.length > 0 && ctx.levels.length > 0 ? (
        <ElevationStrip
          levels={ctx.levels}
          bottom={Math.min(...boxed.map((p) => p.box!.min[2]))}
          top={Math.max(...boxed.map((p) => p.box!.max[2]))}
          stated={places.find((p) => p.stated)?.stated ?? null}
        />
      ) : undefined,
  };
}

function triangleCount(guid: string, derived: Derived): number | null {
  return derived.triangles?.get(guid) ?? null;
}

/* --------------------------------------------------------------- figures */

/**
 * The storey bands with this element's mesh extents marked against them.
 *
 * The one drawing that makes "its lowest point is on another floor" obvious
 * without reading a number: the bands are the file's storey elevations, the bar
 * is the element, and a bar whose foot sits in a band other than the stated one
 * shows it. Both come from `PlacementContext`, i.e. from the same arithmetic
 * `mesh-placement` judges with.
 */
function ElevationStrip({
  levels,
  bottom,
  top,
  stated,
}: {
  levels: { guid: string; name: string | null; elevation: number }[];
  bottom: number;
  top: number;
  stated: { guid: string; name: string | null; elevation: number } | null;
}) {
  const height = Math.max(52, Math.min(132, 13 * levels.length + 22));
  const width = 320;
  const lo = Math.min(bottom, levels[0].elevation) - 0.5;
  const hi = Math.max(top, levels[levels.length - 1].elevation) + 0.5;
  const span = Math.max(hi - lo, 1e-6);
  const y = (value: number) => 9 + ((hi - value) / span) * (height - 18);

  // Labels are pushed apart where two storeys sit close together; the LINES
  // stay at their true elevation, so nothing about the drawing lies — only the
  // text moves, and it moves down, never up past its own line.
  const labelled = [...levels]
    .sort((a, b) => b.elevation - a.elevation)
    .reduce<{ level: (typeof levels)[number]; line: number; text: number }[]>((rows, level) => {
      const last = rows.length ? rows[rows.length - 1].text : -Infinity;
      rows.push({
        level,
        line: y(level.elevation),
        text: Math.max(y(level.elevation) - 1.5, last + 8),
      });
      return rows;
    }, []);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      preserveAspectRatio="xMinYMin meet"
      role="img"
    >
      {labelled.map(({ level, line, text }) => {
        const own = stated?.guid === level.guid;
        return (
          <g key={level.guid}>
            <line
              x1={0}
              x2={width - 46}
              y1={line}
              y2={line}
              stroke={own ? "var(--color-gold)" : "var(--color-line)"}
              strokeWidth={own ? 1.4 : 0.7}
            />
            <text
              x={2}
              y={text}
              fill={own ? "var(--color-ink)" : "var(--color-muted)"}
              style={{ fontSize: 6.5, fontFamily: "var(--font-mono, monospace)" }}
            >
              {`${level.elevation.toFixed(2)}  ${level.name ?? level.guid}`.slice(0, 40)}
            </text>
          </g>
        );
      })}
      <rect
        x={width - 40}
        y={y(top)}
        width={22}
        height={Math.max(1.2, y(bottom) - y(top))}
        fill="var(--color-green)"
      />
      <text
        x={width - 16}
        y={y(bottom) + 2}
        fill="var(--color-ink)"
        style={{ fontSize: 6.5, fontFamily: "var(--font-mono, monospace)" }}
      >
        {bottom.toFixed(2)}
      </text>
    </svg>
  );
}

/**
 * The element's place in the spatial tree, drawn as a path.
 *
 * `IfcSite → IfcBuilding → IfcBuildingStorey → this element` is the chain the
 * fundamentals check for, and seeing it as four boxes is what makes "this one
 * is in no storey" a picture rather than a dash in a list. A link the engine
 * cannot supply is drawn dashed and empty rather than omitted.
 */
function SpatialPath({
  site,
  building,
  storey,
  element,
}: {
  site: string | null;
  building: string | null;
  storey: string | null;
  element: string;
}) {
  const nodes = [
    { label: "IfcSite", value: site },
    { label: "IfcBuilding", value: building },
    { label: "IfcBuildingStorey", value: storey },
    { label: "element", value: element },
  ];
  const width = 320;
  const cell = width / nodes.length;
  return (
    <svg
      viewBox={`0 0 ${width} 30`}
      className="h-auto w-full"
      preserveAspectRatio="xMinYMin meet"
      role="img"
    >
      {nodes.map((node, index) => {
        const x = index * cell;
        return (
          <g key={node.label}>
            <rect
              x={x + 2}
              y={3}
              width={cell - 8}
              height={22}
              fill={node.value ? "var(--color-panel)" : "none"}
              stroke={node.value ? "var(--color-line)" : "var(--color-line)"}
              strokeDasharray={node.value ? undefined : "3 2"}
            />
            <text
              x={x + 5}
              y={11}
              fill="var(--color-gold)"
              style={{ fontSize: 5.5, letterSpacing: 0.3 }}
            >
              {node.label.toUpperCase()}
            </text>
            <text
              x={x + 5}
              y={21}
              fill="var(--color-ink)"
              style={{ fontSize: 7, fontFamily: "var(--font-mono, monospace)" }}
            >
              {(node.value ?? "—").slice(0, 14)}
            </text>
            {index < nodes.length - 1 ? (
              <path
                d={`M${x + cell - 5} 14 l4 0`}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ----------------------------------------------------------------- panel */

interface ObjectPanelProps {
  lang: Lang;
  /** The whole model entry: the profile is the file's data, the streamed mesh
   *  is what the derived group measures. */
  model: ModelEntry;
  /** GUIDs selected in this model, whichever side selected them. */
  selection: string[];
}

export function ObjectPanel({ lang, model, selection }: ObjectPanelProps) {
  const profile = model.profile ?? null;
  const chosen = new Set(selection);
  const rows = profile ? profile.rows.filter((row) => chosen.has(row.guid)) : [];

  // One pass over the streamed geometry per model, not per selection: boxes,
  // the placement context and the space locator are all model-wide.
  const derived = useMemo<Derived>(() => {
    const batches = model.meshBatches;
    if (!batches || !profile || !model.report) {
      return { context: null, locator: null, reason: t("object.noGeometry", lang), capped: false };
    }
    const boxes = new Map<string, ElementBox>();
    const triangles = new Map<string, number>();
    for (const batch of batches) {
      collectBoxes(boxes, batch.meta, batch.positions);
      for (const row of batch.meta) triangles.set(row.guid, (triangles.get(row.guid) ?? 0) + row.tri);
    }
    const shift = model.meshShift ?? [0, 0, 0];
    unshiftBoxes(boxes, shift);
    const context = placementContext(
      {
        products: profile.rows.map((r) => ({ guid: r.guid, storeyGuid: r.storeyGuid })),
        storeys: profile.storeys,
        unitScale: model.report.summary.unit_scale,
        unitResolved: model.report.summary.unit_resolved,
      },
      boxes,
    );
    const locator =
      countSpaces(batches) > 0
        ? buildSpaceLocator(
            batches,
            shift as [number, number, number],
            (guid) => profile.rows.find((r) => r.guid === guid)?.name ?? null,
          )
        : null;
    return {
      context,
      locator,
      reason: null,
      capped: model.meshBudget?.capped ?? false,
      triangles,
    };
  }, [model.meshBatches, model.meshShift, model.meshBudget, model.report, profile, lang]);

  const sections: Section[] = [
    attributeSection(rows, lang),
    {
      ...relationSection(rows, profile, lang),
      figure:
        rows.length === 1 ? (
          <SpatialPath
            site={profile?.sites?.[0]?.name ?? profile?.sites?.[0]?.guid ?? null}
            building={
              (() => {
                const storey = storeyOf(profile, rows[0].storeyGuid);
                const guid = storey?.buildingGuid ?? null;
                const building = profile?.buildings?.find((b) => b.guid === guid);
                return building ? (building.name ?? building.guid) : null;
              })()
            }
            storey={(() => {
              const storey = storeyOf(profile, rows[0].storeyGuid);
              return storey ? (storey.name ?? storey.guid) : null;
            })()}
            element={rows[0].name ?? rows[0].entity}
          />
        ) : undefined,
    },
  ];
  const derivedSectionValue = derivedSection(rows, derived, lang);
  const data = dataTabs(rows, profile, lang);

  return (
    // `data-object-panel` / `data-field` are how `isolate-gate.mjs` reads this
    // surface, the same way `data-tile-id` marks a board tile.
    <section
      data-object-panel=""
      className="flex h-full min-h-0 min-w-0 flex-col border-l border-line bg-panel"
    >
      <div className="flex shrink-0 items-baseline gap-2 border-b border-line px-3 py-1">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {t("tile.object", lang)}
        </span>
        {rows.length > 1 ? (
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {`${formatCount(rows.length, lang)} ${t("trace.elements", lang).toLowerCase()}`}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-input">
        <LeadCards lang={lang} rows={rows} profile={profile} />
        {sections.map((section) => (
          <SectionBlock key={section.title} lang={lang} section={section} />
        ))}
        <DataGroup lang={lang} tabs={data.tabs} absence={data.absence} />
        <SectionBlock lang={lang} section={derivedSectionValue} derived />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ lead cards */

/** The five facts that IDENTIFY the object, in the board's KPI vocabulary:
 *  micro gold label, big mono value, one card per cell of a line-coloured
 *  grid. Nothing is curated away by this — every value is also a row in the
 *  list below. The IFC term stays on the card because that pairing is the
 *  teaching. */
function LeadCards({
  lang,
  rows,
  profile,
}: {
  lang: Lang;
  rows: ProductRowLite[];
  profile: ModelProfile | null;
}) {
  const one = rows.length === 1 ? rows[0] : null;
  const many = rows.length > 1;
  const value = (read: (row: ProductRowLite) => string | null): string => {
    if (rows.length === 0) return "—";
    const values = distinct(rows, read);
    if (values.length === 0) return "—";
    return values.length === 1 ? values[0] : t("type.disagree", lang);
  };
  const storeyName = (row: ProductRowLite): string | null => {
    const storey = storeyOf(profile, row.storeyGuid);
    if (!storey) return t("matrix.noStorey", lang);
    return storey.name ?? storey.guid;
  };
  const cards = [
    { key: "class", label: t("col.class", lang), ifc: "entity", value: value((r) => r.entity) },
    {
      key: "type",
      label: t("col.type", lang),
      ifc: "IfcRelDefinesByType",
      value: value((r) => r.typeName ?? null),
    },
    { key: "name", label: t("col.name", lang), ifc: "Name", value: value((r) => r.name) },
    {
      key: "storey",
      label: t("col.storey", lang),
      ifc: "IfcRelContainedInSpatialStructure",
      value: value(storeyName),
    },
  ];
  const guid = one ? one.guid : many ? t("type.disagree", lang) : "—";

  return (
    <div className="grid grid-cols-2 gap-px border-b-2 border-line bg-line">
      {cards.map((card) => (
        <div key={card.key} className="flex min-w-0 flex-col justify-center bg-panel px-3 py-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              data-lead={card.key}
              className="shrink-0 text-[9px] leading-tight font-semibold tracking-[0.12em] text-gold uppercase"
            >
              {card.label}
            </span>
            <span title={card.ifc} className="truncate text-[8px] leading-tight text-muted">
              {card.ifc}
            </span>
          </span>
          <span
            onDoubleClick={copyOnDoubleClick(card.value)}
            title={card.value}
            className="cursor-copy truncate font-mono text-[15px] leading-tight font-semibold text-ink"
          >
            {card.value}
          </span>
        </div>
      ))}
      <div className="col-span-2 flex min-w-0 flex-col justify-center bg-panel px-3 py-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            data-lead="guid"
            className="shrink-0 text-[9px] leading-tight font-semibold tracking-[0.12em] text-gold uppercase"
          >
            {t("col.guid", lang)}
          </span>
          <span className="truncate text-[8px] leading-tight text-muted">IfcRoot.GlobalId</span>
        </span>
        <span
          onDoubleClick={copyOnDoubleClick(guid)}
          title={guid}
          className="cursor-copy font-mono text-[12px] leading-tight font-semibold text-ink"
        >
          {guid}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sections */

function SectionBlock({
  lang,
  section,
  derived = false,
}: {
  lang: Lang;
  section: Section;
  derived?: boolean;
}) {
  return (
    <div data-section={section.title} className={derived ? "border-t-2 border-line" : ""}>
      <GroupHeader title={section.title} ifc={section.ifc} derived={derived} />
      {section.state ? (
        <div data-section-state="" className="px-3 py-1 font-mono text-[11px] text-muted">
          {section.state}
        </div>
      ) : null}
      {section.fields.map((field) => (
        <FieldRow key={field.label} lang={lang} field={field} />
      ))}
      {section.figure ? <div className="px-3 py-2">{section.figure}</div> : null}
    </div>
  );
}

function GroupHeader({
  title,
  ifc,
  derived = false,
  right,
}: {
  title: string;
  ifc?: string;
  derived?: boolean;
  right?: ReactNode;
}) {
  return (
    <div
      className={
        "flex items-baseline gap-2 border-b border-line px-3 py-1 " +
        (derived ? "bg-palegreen" : "bg-panel")
      }
    >
      <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
        {title}
      </span>
      {ifc ? <span className="truncate text-[9px] text-muted">{ifc}</span> : null}
      {right ? <span className="ml-auto shrink-0">{right}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------ the data tabs */

/** One tab per property set and per quantity set.
 *
 * edkjo: *"I prefer each pset as a tab rather than a sorting group."* The strip
 * scrolls sideways rather than wrapping — a model can carry a dozen sets on one
 * element — and no label is ever cut: a tab is sized to its own name and the
 * strip moves under it.
 *
 * The selected tab is remembered by NAME across selections, so stepping down a
 * list of walls keeps `Pset_WallCommon` open instead of resetting to the first
 * set on every click. A name the next element does not carry falls back to the
 * first tab. */
function DataGroup({
  lang,
  tabs,
  absence,
}: {
  lang: Lang;
  tabs: DataTab[];
  absence: string | null;
}) {
  const [remembered, setRemembered] = useState<string | null>(null);
  const names = tabs.map((tab) => tab.name);
  const active = remembered && names.includes(remembered) ? remembered : names[0];
  const tab = tabs.find((candidate) => candidate.name === active) ?? null;
  const firstCustom = tabs.findIndex((candidate) => !candidate.standard);

  return (
    <div data-section={t("object.data", lang)} className="border-t-2 border-line">
      <GroupHeader
        title={t("object.data", lang)}
        ifc="IfcRelDefinesByProperties"
        right={
          tab && tab.fields.length > 0 ? (
            <span className="font-mono text-[10px] text-muted">{tab.ifc}</span>
          ) : null
        }
      />
      {absence !== null ? (
        <div data-section-state="" className="px-3 py-1 font-mono text-[11px] text-muted">
          {absence}
        </div>
      ) : null}
      <div
        data-pset-tabs=""
        className="flex shrink-0 gap-px overflow-x-auto border-b border-line bg-line"
      >
        {tabs.map((candidate, index) => (
          <button
            key={candidate.name}
            type="button"
            data-pset-tab={candidate.name}
            aria-selected={candidate.name === active}
            onClick={() => setRemembered(candidate.name)}
            className={
              "shrink-0 px-2 py-1 font-mono text-[11px] whitespace-nowrap " +
              (index === firstCustom && firstCustom > 0 ? "border-l-2 border-l-gold " : "") +
              (candidate.name === active
                ? "bg-input font-semibold text-ink"
                : "bg-panel text-muted hover:text-green")
            }
          >
            {candidate.name}
          </button>
        ))}
      </div>
      {tab?.state ? (
        <div data-section-state="" className="px-3 py-1 font-mono text-[11px] text-muted">
          {tab.state}
        </div>
      ) : null}
      {tab?.fields.map((field) => (
        <FieldRow key={field.label} lang={lang} field={field} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- rows */

function FieldRow({ lang, field }: { lang: Lang; field: Field }) {
  const differs = field.values.length > 1;
  const value = differs ? t("type.disagree", lang) : (field.values[0] ?? "—");
  const title = field.values.length > 0 ? field.values.join(" · ") : undefined;
  return (
    <div
      data-field={field.label}
      data-value={title ?? ""}
      className="grid items-baseline gap-x-2 border-b border-line px-3 py-0.5"
      style={{ gridTemplateColumns: `${LABEL_WIDTH} minmax(0, 1fr)` }}
    >
      <span className="flex min-w-0 flex-col">
        <span
          title={field.label}
          className="truncate text-[10px] leading-tight font-semibold tracking-[0.12em] text-muted uppercase"
        >
          {field.label}
        </span>
        {field.ifc ? (
          <span title={field.ifc} className="truncate text-[8px] leading-tight text-muted/70">
            {field.ifc}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          onDoubleClick={copyOnDoubleClick(title ?? "")}
          title={title}
          className={
            "min-w-0 cursor-copy truncate font-mono text-[12px] " +
            (differs ? "bg-gold px-1 text-ink" : field.values.length === 0 ? "text-muted" : "text-ink")
          }
        >
          {value}
        </span>
        {!differs && field.note ? (
          <span className="shrink-0 font-mono text-[10px] text-muted">{field.note}</span>
        ) : null}
      </span>
    </div>
  );
}
