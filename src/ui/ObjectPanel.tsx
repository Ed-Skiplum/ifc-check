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
 * the engine holds, grouped the way the standard itself is built, one theme
 * tab per group (2026-09-30, OBJECT PANEL IS TABBED):
 *
 *   1  Attributter   the schema's own attributes on the entity, then its type's
 *   2  Relasjoner    the objectified `IfcRel*` — containment, type,
 *                    decomposition, voids, material, classification
 *   3  Egenskaper    `IfcRelDefinesByProperties`: one EAR per `IfcPropertySet`
 *                    and per `IfcElementQuantity`, grouped Forekomst / Type,
 *                    plus the profile ear
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
 * None: the same frame, the lead cards with `—` and Attributter alone.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { tablistKeys } from "./keys";
import type { Lang, StringKey } from "./i18n";
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
import { useIfcosRun, type IfcosRun } from "./ifcos-verify";

const LABEL_WIDTH = "14ch";

/** One row of the panel. `values` is the DISTINCT set over the selection, so
 *  the renderer decides between a value, a disagreement and an absence from the
 *  data rather than from a flag someone had to keep in step. */
interface Field {
  label: string;
  /** `data-field` when the label repeats inside one panel (the type's Name
   *  beside the instance's). */
  key?: string;
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
    title: t("inst.this", lang),
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
      // ifcfast carries no Description on a product row.
      { label: "Description", ifc: "Description", values: [], note: rows.length ? t("type.notSupplied", lang) : null },
    ],
  };
}

/** The type object's own attributes, under the instance's. */
function typeSection(rows: ProductRowLite[], lang: Lang): Section {
  const untyped = rows.length > 0 && rows.every((r) => r.typeGuid == null && r.typed !== true);
  return {
    title: t("col.type", lang),
    ifc: "IfcTypeObject",
    state: untyped ? t("type.none", lang) : undefined,
    fields: untyped
      ? []
      : [
          { key: "type.class", label: t("col.class", lang), ifc: "entity", values: distinct(rows, (r) => r.typeEntity ?? null) },
          { key: "type.name", label: t("col.name", lang), ifc: "Name", values: distinct(rows, (r) => r.typeName ?? null) },
          { key: "type.guid", label: t("col.guid", lang), ifc: "GlobalId", values: distinct(rows, (r) => r.typeGuid ?? null) },
          // `TypeObjectRow` is guid, entity and name only.
          {
            key: "type.predefinedType",
            label: t("col.predefinedType", lang),
            ifc: "PredefinedType",
            values: [],
            note: rows.length ? t("type.notSupplied", lang) : null,
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

type Level = "instance" | "type";

/** An ear: one property set or quantity set from one source, or the profile. */
interface DataTab {
  /** Unique within the panel: level, entity and name. */
  key: string;
  name: string;
  /** Whose set it is. ifcfast folds the type's sets onto the occurrence with
   *  `source: "type"` (AGENTS.md "Pset inventory"); a set carrying rows of
   *  both sources is two ears. Null: the profile, which is neither. */
  level: Level | null;
  /** `IfcPropertySet` / `IfcElementQuantity` / `IfcProfileDef`. */
  ifc: string;
  /** buildingSMART's own namespace (`Pset_`, `Qto_`) vs the project's. */
  standard: boolean;
  fields: Field[];
  state?: string;
}

const STANDARD = /^(pset|qto)_/i;
const PROFILE = "profile";

/** The ears, and — when there are no SET ears at all — which of the three
 *  absences that is. The two are one answer: a strip carrying only the profile
 *  ear says nothing about whether this element has property sets, so the theme
 *  says it in its own line beside the strip. */
function dataTabs(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): { tabs: DataTab[]; absence: string | null } {
  const tabs: DataTab[] = [];
  const add = (table: Map<string, PsetGroup[]> | undefined, ifc: string) => {
    if (table === undefined) return;
    const sets = rows.flatMap((row) => table.get(row.guid) ?? []);
    const names: string[] = [];
    for (const set of sets) if (!names.includes(set.name)) names.push(set.name);
    for (const level of ["instance", "type"] as const) {
      for (const name of names) {
        const properties = sets
          .filter((set) => set.name === name)
          .flatMap((set) => set.properties)
          .filter((p) => (p.source === "type" ? "type" : "instance") === level);
        if (properties.length === 0) continue;
        const propertyNames: string[] = [];
        for (const property of properties) {
          if (!propertyNames.includes(property.name)) propertyNames.push(property.name);
        }
        tabs.push({
          key: `${level}\u0000${ifc}\u0000${name}`,
          name,
          level,
          ifc,
          standard: STANDARD.test(name),
          fields: propertyNames.map((propertyName) => {
            const own = properties.filter((property) => property.name === propertyName);
            const types = distinctOf(own, (property) => property.valueType ?? null);
            return {
              label: propertyName,
              ifc: types.length === 1 ? types[0] : undefined,
              values: distinctOf(own, (property) => property.value),
            };
          }),
        });
      }
    }
  };
  add(profile?.psets, "IfcPropertySet");
  add(profile?.quantities, "IfcElementQuantity");

  // Instance before type; within each, the standard namespace first and the
  // project's own after: an ordering, not a filter. The file's own order is
  // kept inside each half (the sort is stable).
  const rank = (tab: DataTab) => (tab.level === "type" ? 2 : 0) + (tab.standard ? 0 : 1);
  tabs.sort((a, b) => rank(a) - rank(b));

  // The profile is an ear that exists to state its own absence. ifcfast's wasm
  // build exposes no `IfcProfileDef` accessor at all, so leaving the ear out
  // would read as "this element has no profile" — a claim about the FILE made
  // out of a gap in the plumbing.
  tabs.push({
    key: PROFILE,
    name: t("object.profile", lang),
    level: null,
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

/** «ingen geometri» for a selection with no mesh, as the second check
 *  (`ifcos-verify.ts`) reads it: marked unverified until ifcopenshell has
 *  answered for every selected element; an ifcfast miss said as one. */
function noGeometryState(rows: ProductRowLite[], run: IfcosRun | undefined, lang: Lang): string {
  const verdicts = rows.map((row) => run?.verdicts?.[row.guid]);
  if (verdicts.some((v) => v?.kind === "geometry")) return `${t("nomesh.miss", lang)} · ${t("ifcos.geometry", lang)}`;
  if (verdicts.some((v) => v?.kind === "error")) return `${t("object.noGeometry", lang)} (${t("ifcos.error", lang)})`;
  if (verdicts.every((v) => v?.kind === "none")) return t("object.noGeometry", lang);
  const mark = run?.status === "failed" ? t("ifcos.failed", lang) : t("nomesh.unverified", lang);
  return `${t("object.noGeometry", lang)} (${mark})`;
}

function derivedSection(rows: ProductRowLite[], derived: Derived, lang: Lang, run?: IfcosRun): Section {
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
    state: boxed.length === 0 && rows.length > 0 ? noGeometryState(rows, run, lang) : undefined,
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

/** The themes, the panel's first tab level: the four groups above. */
type Theme = "attributes" | "relations" | "data" | "derived";

const THEME_LABEL: Record<Theme, StringKey> = {
  attributes: "object.attributes",
  relations: "object.relations",
  data: "object.data",
  derived: "object.derived",
};

/**
 * Two levels of tabs (edkjo 2026-09-30: *"i prefer a tabbed pset layout than
 * scrolling"* … *"and that we tab the 'themes'"*): the themes, and inside
 * Egenskaper one ear per set, grouped Forekomst / Type. The lead cards stay
 * pinned above both; the open tab's content is the one scroller.
 *
 * The chosen theme and the chosen ear are remembered across selections, so
 * stepping from wall to wall keeps `Pset_WallCommon` open. One the next object
 * does not carry falls back (theme → Attributter, ear → the first ear) while
 * the choice itself is kept for the object after. Nothing else changes them.
 * The panel's size is its slot's, whatever is selected or open.
 */
export function ObjectPanel({ lang, model, selection }: ObjectPanelProps) {
  const profile = model.profile ?? null;
  const chosen = new Set(selection);
  const rows = profile ? profile.rows.filter((row) => chosen.has(row.guid)) : [];
  const any = rows.length > 0;
  const uid = useId();

  const second = useIfcosRun(model.id);
  // One pass over the streamed geometry per model, not per selection: boxes,
  // the placement context and the space locator are all model-wide. Not run
  // while nothing is selected: the panel stays mounted empty.
  const derived = useMemo<Derived>(() => {
    const batches = model.meshBatches;
    if (!any) return { context: null, locator: null, reason: null, capped: false };
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
  }, [any, model.meshBatches, model.meshShift, model.meshBudget, model.report, profile, lang]);

  const [wantedTheme, setTheme] = useState<Theme>("attributes");
  const [wantedEar, setEar] = useState<string | null>(null);

  // Nothing selected: Attributter alone, as for an object with nothing else.
  const themes: Theme[] = any ? ["attributes", "relations", "data", "derived"] : ["attributes"];
  const theme = themes.includes(wantedTheme) ? wantedTheme : "attributes";

  const data = dataTabs(rows, profile, lang);
  const ear = data.tabs.find((tab) => tab.key === wantedEar) ?? data.tabs[0] ?? null;

  let body: ReactNode;
  if (!any) {
    body = (
      <div data-object-empty="" className="flex min-h-0 flex-1 items-center justify-center px-3 text-center text-[12px] text-muted">
        {t("object.pick", lang)}
      </div>
    );
  } else if (theme === "attributes") {
    body = (
      <Scroller>
        <SectionBlock lang={lang} section={attributeSection(rows, lang)} />
        <SectionBlock lang={lang} section={typeSection(rows, lang)} />
      </Scroller>
    );
  } else if (theme === "relations") {
    const storey = storeyOf(profile, rows[0].storeyGuid);
    const building = profile?.buildings?.find((b) => b.guid === (storey?.buildingGuid ?? null));
    body = (
      <Scroller>
        <SectionBlock
          lang={lang}
          section={{
            ...relationSection(rows, profile, lang),
            figure:
              rows.length === 1 ? (
                <SpatialPath
                  site={profile?.sites?.[0]?.name ?? profile?.sites?.[0]?.guid ?? null}
                  building={building ? (building.name ?? building.guid) : null}
                  storey={storey ? (storey.name ?? storey.guid) : null}
                  element={rows[0].name ?? rows[0].entity}
                />
              ) : undefined,
          }}
        />
      </Scroller>
    );
  } else if (theme === "data") {
    body = (
      <DataTheme lang={lang} uid={uid} tabs={data.tabs} absence={data.absence} open={ear} onOpen={setEar} />
    );
  } else {
    body = (
      <Scroller>
        <SectionBlock lang={lang} section={derivedSection(rows, derived, lang, second)} derived />
      </Scroller>
    );
  }

  return (
    // `data-object-panel` / `data-field` are how `isolate-gate.mjs` reads this
    // surface, the same way `data-tile-id` marks a board tile.
    <section
      data-object-panel=""
      data-object-theme={theme}
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

      <div className="shrink-0">
        <LeadCards lang={lang} rows={rows} profile={profile} />
      </div>

      <div
        role="tablist"
        data-object-themes=""
        onKeyDown={tablistKeys}
        className="obj-tabs flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1"
      >
        {themes.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${uid}-theme-${id}`}
            data-theme={id}
            aria-selected={theme === id}
            aria-controls={`${uid}-theme-panel`}
            tabIndex={theme === id ? 0 : -1}
            onClick={() => setTheme(id)}
            className="obj-tab shrink-0 px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase"
          >
            {t(THEME_LABEL[id], lang)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${uid}-theme-panel`}
        aria-labelledby={`${uid}-theme-${theme}`}
        data-object-body=""
        className="flex min-h-0 flex-1 flex-col bg-input"
      >
        {body}
      </div>
    </section>
  );
}

/** The open tab's content: the panel's one scroller. */
function Scroller({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>;
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
            <span title={card.ifc} className="truncate text-[9px] leading-tight text-muted">
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
          <span className="truncate text-[9px] leading-tight text-muted">IfcRoot.GlobalId</span>
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
    <div data-section={section.title}>
      <GroupHeader title={section.title} ifc={section.ifc} derived={derived} />
      {section.state ? (
        <div data-section-state="" className="px-3 py-1 font-mono text-[11px] text-muted">
          {section.state}
        </div>
      ) : null}
      {section.fields.map((field) => (
        <FieldRow key={field.key ?? field.label} lang={lang} field={field} />
      ))}
      {section.figure ? <div className="px-3 py-2">{section.figure}</div> : null}
    </div>
  );
}

function GroupHeader({
  title,
  ifc,
  derived = false,
}: {
  title: string;
  ifc?: string;
  derived?: boolean;
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
    </div>
  );
}

/* ------------------------------------------------------------ the data ears */

/** Egenskaper: one ear per property set and per quantity set, grouped by
 *  whose set it is (Forekomst / Type), then the profile.
 *
 * edkjo: *"I prefer each pset as a tab rather than a sorting group."* A model
 * can carry a dozen sets on one element, and no label is ever cut: an ear is
 * sized to its own name. The strip wraps onto more lines rather than scrolling
 * sideways (2026-09-29); only the open ear's rows scroll. */
function DataTheme({
  lang,
  uid,
  tabs,
  absence,
  open,
  onOpen,
}: {
  lang: Lang;
  uid: string;
  tabs: DataTab[];
  absence: string | null;
  open: DataTab | null;
  onOpen: (key: string) => void;
}) {
  const groups: { level: Level | null; tabs: DataTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last.level === tab.level) last.tabs.push(tab);
    else groups.push({ level: tab.level, tabs: [tab] });
  }
  const earId = (tab: DataTab) => `${uid}-ear-${tabs.indexOf(tab)}`;

  return (
    <div data-section={t("object.data", lang)} className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        data-pset-tabs=""
        onKeyDown={tablistKeys}
        className="obj-tabs flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-2 py-1"
      >
        {groups.map((group, index) => (
          <span key={index} data-ear-group={group.level ?? ""} className="flex min-w-0 flex-wrap items-center gap-1">
            {group.level ? (
              <span className="shrink-0 text-[9px] font-semibold tracking-[0.12em] text-gold uppercase">
                {t(group.level === "instance" ? "inst.this" : "col.type", lang)}
              </span>
            ) : null}
            {group.tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={earId(tab)}
                data-pset-tab={tab.name}
                data-ear-level={tab.level ?? ""}
                aria-selected={tab === open}
                aria-controls={`${uid}-ear-panel`}
                tabIndex={tab === open ? 0 : -1}
                title={tab.ifc}
                onClick={() => onOpen(tab.key)}
                className="obj-tab shrink-0 px-2 py-0.5 font-mono text-[11px] whitespace-nowrap"
              >
                {tab.name}
              </button>
            ))}
          </span>
        ))}
        {absence !== null ? (
          <span data-section-state="" className="font-mono text-[11px] text-muted">
            {absence}
          </span>
        ) : null}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-ear-panel`}
        aria-labelledby={open ? earId(open) : undefined}
        className="min-h-0 flex-1 overflow-auto"
      >
        {open ? (
          <>
            <GroupHeader title={open.name} ifc={open.ifc} />
            {open.state ? (
              <div data-section-state="" className="px-3 py-1 font-mono text-[11px] text-muted">
                {open.state}
              </div>
            ) : null}
            {open.fields.map((field) => (
              <FieldRow key={field.label} lang={lang} field={field} />
            ))}
          </>
        ) : null}
      </div>
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
      data-field={field.key ?? field.label}
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
          <span title={field.ifc} className="truncate text-[9px] leading-tight text-muted/70">
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
