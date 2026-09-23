/** What the engine has for the selected element, beside the derivation table.
 *
 * edkjo, 2026-09-23: *"It should also frame the object and show the properties
 * and attributes. There is plenty of space for an object information panel next
 * to the table view/spreadsheet at the bottom."* So the band splits at the
 * golden section — the table keeps 61.8 %, this takes 38.2 % — and the band's
 * own height rule is untouched.
 *
 * ── It shows what is REACHABLE, and says where that stops ─────────────────
 * The panel is a list of SECTIONS: the attributes `graphJson()` carries, the
 * object's classification references, then ONE SECTION PER PROPERTY SET, titled
 * with the set's own name. That last part is what ifcfast 0.5.3 made possible
 * (`psetsJson()` / `classificationsJson()`); the shape was designed for it while
 * the section still read `utilgjengelig · ifcfast#183`, and nothing else moved
 * when the data arrived.
 *
 * The set NAME is kept, and is the section header, because a property is
 * identified by set plus name: two sets both carrying `Status` are two
 * different facts and a flat list of property names hides that.
 *
 * Three absences, kept apart, because they are answers about different things:
 *   — no profile table at all   the board was built without one; the section
 *                               says `ikke levert`, never "none".
 *   — nothing selected          the panel's own `—`.
 *   — selected, declares none   `ingen`, which is about the FILE.
 *
 * ── One element, several, none ───────────────────────────────────────────
 * One: its values. Several (Shift or Ctrl down the band): the SHARED values —
 * a field every selected element agrees on shows that value, a field they
 * disagree on shows `Ulike verdier`, which is the mark the type ledger already
 * uses for the same fact. None: the labels with `—`, the dash this whole
 * surface uses for absent.
 */

import type { Lang } from "./i18n";
import { t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import type { ModelProfile, ProductRowLite } from "./profile";

const LABEL_WIDTH = "13ch";

/** One row of the panel. `values` is the DISTINCT set over the selection, so
 *  the renderer decides between a value, a disagreement and an absence from the
 *  data rather than from a flag someone had to keep in step. */
interface Field {
  label: string;
  values: string[];
  /** A second, dimmer token after the value — the parser's own `type_source`
   *  beside the type name. Rendered only when the values agree. */
  note?: string | null;
}

interface Section {
  title: string;
  fields: Field[];
  /** A section that has no rows because the data is not reachable says so
   *  here, verbatim, instead of rendering empty. */
  state?: string;
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

function objectSections(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): Section[] {
  const storeyName = (row: ProductRowLite): string | null => {
    if (row.storeyGuid === null) return t("matrix.noStorey", lang);
    const storey = profile?.storeys.find((s) => s.guid === row.storeyGuid);
    if (!storey) return t("matrix.noStorey", lang);
    return storey.name ?? storey.guid;
  };
  const sources = distinct(rows, (row) => row.typeSource ?? null);

  return [
    {
      title: t("object.attributes", lang),
      fields: [
        { label: t("col.guid", lang), values: distinct(rows, (r) => r.guid) },
        { label: t("col.class", lang), values: distinct(rows, (r) => r.entity) },
        { label: t("col.name", lang), values: distinct(rows, (r) => r.name) },
        {
          label: t("col.objectType", lang),
          values: distinct(rows, (r) => r.objectType ?? null),
        },
        { label: t("col.tag", lang), values: distinct(rows, (r) => r.tag ?? null) },
        {
          label: t("col.predefinedType", lang),
          values: distinct(rows, (r) => r.predefinedType ?? null),
        },
        {
          label: t("col.type", lang),
          values: distinct(rows, (r) => r.typeName ?? null),
          // Verbatim from the parser (`ifctype` / `none`), not a word of ours.
          note: sources.length === 1 ? sources[0] : null,
        },
        { label: t("col.storey", lang), values: distinct(rows, storeyName) },
        {
          label: t("col.materials", lang),
          values: distinct(rows, (r) => (r.materials?.length ? r.materials.join(" · ") : null)),
        },
        { label: "IsExternal", values: distinct(rows, (r) => bool(r.isExternal)) },
        { label: "FireRating", values: distinct(rows, (r) => r.fireRating ?? null) },
        { label: "LoadBearing", values: distinct(rows, (r) => bool(r.loadBearing)) },
      ],
    },
    classificationSection(rows, profile, lang),
    ...psetSections(rows, profile, lang),
  ];
}

/** The absent-state word for a table, or null when there is something to show.
 *
 * Three different absences and one of them is not about the file at all, so
 * they never share a rendering: a table the profile never carried says so, an
 * empty selection uses this surface's own dash, and an object that genuinely
 * declares nothing says `ingen`. */
function absence<T>(
  table: Map<string, T[]> | undefined,
  rows: ProductRowLite[],
  found: number,
  lang: Lang,
): string | null {
  if (table === undefined) return t("type.notSupplied", lang);
  if (rows.length === 0) return "—";
  return found === 0 ? t("type.none", lang) : null;
}

/** One row per classification SYSTEM, value `code · name`. A selection whose
 *  elements disagree gets the panel's own `Ulike verdier`, exactly as an
 *  attribute does — the sections differ in where the data comes from, never in
 *  how a disagreement reads. */
function classificationSection(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): Section {
  const table = profile?.classifications;
  const refs = rows.flatMap((row) => table?.get(row.guid) ?? []);
  const state = absence(table, rows, refs.length, lang);
  if (state !== null) return { title: t("type.classifications", lang), fields: [], state };

  const systems: string[] = [];
  for (const ref of refs) {
    const system = ref.system ?? "—";
    if (!systems.includes(system)) systems.push(system);
  }
  return {
    title: t("type.classifications", lang),
    fields: systems.map((system) => ({
      label: system,
      values: distinctOf(
        refs.filter((ref) => (ref.system ?? "—") === system),
        (ref) => [ref.code, ref.name].filter((part) => part).join(" · ") || null,
      ),
    })),
  };
}

/** One section per property set, in the order the file wrote them. */
function psetSections(
  rows: ProductRowLite[],
  profile: ModelProfile | null,
  lang: Lang,
): Section[] {
  const table = profile?.psets;
  const sets = rows.flatMap((row) => table?.get(row.guid) ?? []);
  const state = absence(table, rows, sets.length, lang);
  if (state !== null) return [{ title: t("type.psets", lang), fields: [], state }];

  const names: string[] = [];
  for (const set of sets) if (!names.includes(set.name)) names.push(set.name);

  return names.map((name) => {
    const mine = sets.filter((set) => set.name === name);
    const properties = mine.flatMap((set) => set.properties);
    const propertyNames: string[] = [];
    for (const property of properties) {
      if (!propertyNames.includes(property.name)) propertyNames.push(property.name);
    }
    return {
      title: name,
      fields: propertyNames.map((propertyName) => ({
        label: propertyName,
        values: distinctOf(
          properties.filter((property) => property.name === propertyName),
          (property) => property.value,
        ),
      })),
    };
  });
}

interface ObjectPanelProps {
  lang: Lang;
  /** This model's profile — the storey names come from it. */
  profile: ModelProfile | null;
  /** GUIDs selected in this model, whichever side selected them. */
  selection: string[];
}

export function ObjectPanel({ lang, profile, selection }: ObjectPanelProps) {
  const chosen = new Set(selection);
  const rows = profile ? profile.rows.filter((row) => chosen.has(row.guid)) : [];
  const sections = objectSections(rows, profile, lang);

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
        {sections.map((section) => (
          <div key={section.title} data-section={section.title}>
            <div className="border-b border-line bg-panel px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              {section.title}
            </div>
            {section.state ? (
              <div
                data-section-state=""
                className="px-3 py-1 font-mono text-[11px] text-muted"
              >
                {section.state}
              </div>
            ) : null}
            {section.fields.map((field) => (
              <FieldRow key={field.label} lang={lang} field={field} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

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
      <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
        {field.label}
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
        {!differs && field.note && field.values.length > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-muted">{field.note}</span>
        ) : null}
      </span>
    </div>
  );
}
