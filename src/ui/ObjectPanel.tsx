/** What the engine has for the selected element, beside the derivation table.
 *
 * edkjo, 2026-09-23: *"It should also frame the object and show the properties
 * and attributes. There is plenty of space for an object information panel next
 * to the table view/spreadsheet at the bottom."* So the band splits at the
 * golden section — the table keeps 61.8 %, this takes 38.2 % — and the band's
 * own height rule is untouched.
 *
 * ── It shows what is REACHABLE, and says where that stops ─────────────────
 * The attributes here are the whole of what a product declares in the browser:
 * `ProductRowLite`, i.e. the columns `graphJson()` carries. Arbitrary property
 * sets ARE parsed by ifcfast — `summaryJson().tables` reports them loaded, with
 * counts — but the wasm build exposes no accessor
 * ([ifcfast#183](https://github.com/EdvardGK/ifcfast/issues/183)). That is a
 * labelled state on this panel, in the same words the type ledger's foot uses,
 * never an empty section and never a blank value that would read as "this
 * element declares nothing".
 *
 * The panel is a list of SECTIONS for exactly that reason: when #183 lands, a
 * pset becomes one more section with its own rows, and nothing else moves.
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
function distinct(
  rows: ProductRowLite[],
  read: (row: ProductRowLite) => string | null,
): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const value = read(row);
    if (value === null || value === "") continue;
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
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
    {
      // Parsed, counted, and with no JS accessor. Said the way the type
      // ledger's foot says it, so one fact reads the same on both surfaces.
      title: t("type.psets", lang),
      fields: [],
      state: `${t("type.unavailable", lang)} · ifcfast#183`,
    },
  ];
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
          <div key={section.title}>
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
