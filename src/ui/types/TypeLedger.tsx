/** The type ledger's tile body: the disproportion first, then the rows.
 *
 * ── Why the ratio leads ──────────────────────────────────────────────────
 * The owner's ask was the DISPROPORTION, not the list: *"flag when types are
 * disproportionately single instance types"*. `65 of 84 · 77 %` is a different
 * statement from "here are 65 rows" — the first says the type structure is not
 * doing its job, the second says a lot of rows exist. So the head of the tile
 * carries the share, the SHAPE it came from (instances-per-type buckets, which
 * a single ratio flattens), and the boundary we judged it against, printed, and
 * labelled as ours. The rows sit behind it.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 * Nothing here is editable and nothing here is a verdict a user sets. The G55
 * type browser this is ported from assigned material and scope to a type; that
 * half is gone. No row is ever hidden — the untyped remainder is a row of its
 * own, and a type that disagrees with itself is marked in place, never dimmed
 * and never dropped.
 *
 * ── The property columns are a choice, not a boundary ────────────────────
 * `PredefinedType`, `Materials` and the three flattened common properties are
 * the values worth COMPARING across a type's instances — the ones where a
 * disagreement is a modelling fact. The full property table is reachable since
 * ifcfast 0.5.3 and is what the object panel prints per element; widening this
 * tile to it would make one column per property set on a model with hundreds.
 *
 * ── The foot reconciles the three "types" numbers ─────────────────────────
 * This table keys by type NAME. The file declares type OBJECTS, and elements
 * use a subset of those. All three differ on a real model (KNM_ARK: 398
 * declared, 339 used, 84 names), so the foot prints them together instead of
 * leaving the KPI row and this tile looking like they disagree.
 */

import type { ReactNode } from "react";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { copyOnDoubleClick } from "../copy";
import { formatCount, formatShare } from "../format";
import {
  TYPE_BUCKETS,
  TYPE_HEALTH_BANDS,
  type Declared,
  type TypeHealth,
  type TypeLedger as TypeLedgerData,
  type TypeRow,
} from "./aggregate";

/** Whole-element fills. The band is OURS, so it deliberately does not borrow
 *  the engine's verdict names — only the palette and the always-a-glyph rule. */
const HEALTH_FILL: Record<TypeHealth, string> = {
  sound: "bg-green text-cream",
  watch: "bg-gold text-ink",
  weak: "bg-bad text-cream",
};

const HEALTH_GLYPH: Record<TypeHealth, string> = {
  sound: "✓",
  watch: "!",
  weak: "✗",
};

/** The bucket ramp: ONE hue, stepped. A count is not a verdict, so it never
 *  rides the traffic-light alphabet. */
const BUCKET_TINT = ["bg-green/25", "bg-green/45", "bg-green/65", "bg-green/85"];
const BUCKET_INK = ["text-ink", "text-ink", "text-cream", "text-cream"];

const BUCKET_LABEL = ["1", "2–4", "5–9", "10+"];

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={
        "sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[length:var(--bento-label)] font-semibold tracking-[0.12em] text-gold uppercase whitespace-nowrap " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

/** A cell whose instances DISAGREE is filled whole, carries `!` and prints how
 *  many distinct values it is hiding. The aggregate would otherwise show one
 *  of them and look tidy, which is the fault. */
function Disagree({
  variants,
  label,
  children,
}: {
  variants: number;
  label: string;
  children: ReactNode;
}) {
  return (
    // The fill is the state; the glyph and the title are what make it readable
    // in monochrome and to a colour-blind reader. Same primitive the storey
    // roster uses for a shared elevation.
    <span title={label} className="flex items-center gap-1.5 bg-gold px-2 py-0.5 text-ink">
      <span className="font-mono text-[length:var(--bento-label)] font-bold">!</span>
      <span className="truncate font-mono text-[length:var(--bento-label)]">{children}</span>
      <span className="ml-auto shrink-0 font-mono text-[length:var(--bento-label)] font-semibold tabular-nums">
        {variants}
      </span>
    </span>
  );
}

/** One declared attribute. Agreement prints the value; disagreement prints the
 *  count of values it would otherwise have picked one of; nothing declared
 *  prints an em dash, which is a state and not a zero. */
function DeclaredCell({ declared, flag, label }: { declared: Declared; flag: boolean; label: string }) {
  const joined = declared.values.join(" · ");
  // `flag` is off on the UNTYPED row. Elements that share no type are not
  // expected to share a PredefinedType or a material, so marking that spread as
  // a fault would be a finding invented by the grouping — the first run of
  // `scripts/types-gate.mjs` printed exactly that against KNM_RIB, where all
  // 851 untyped elements came back "! 2 variants". The spread is still shown.
  if (declared.variants > 1 && flag) {
    return (
      <Disagree variants={declared.variants} label={label}>
        {joined || "—"}
      </Disagree>
    );
  }
  if (declared.values.length === 0) {
    return <span className="px-2 font-mono text-[length:var(--bento-label)] text-muted">{"—"}</span>;
  }
  return (
    <span
      title={joined}
      className="block max-w-[26ch] truncate px-2 font-mono text-[length:var(--bento-label)] text-ink"
    >
      {joined}
    </span>
  );
}

/** The three flattened common properties, side by side. Each carries its IFC
 *  attribute NAME, because that is what it is called. */
function CommonCell({ row, flag, label }: { row: TypeRow; flag: boolean; label: string }) {
  const fields: { name: string; declared: Declared }[] = [
    { name: "IsExternal", declared: row.isExternal },
    { name: "FireRating", declared: row.fireRating },
    { name: "LoadBearing", declared: row.loadBearing },
  ];
  const present = fields.filter((f) => f.declared.values.length > 0 || f.declared.variants > 1);
  if (present.length === 0) {
    return <span className="px-2 font-mono text-[length:var(--bento-label)] text-muted">{"—"}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 px-2">
      {present.map((field) =>
        field.declared.variants > 1 && flag ? (
          <span
            key={field.name}
            title={`${label} · ${field.declared.values.join(" · ")}`}
            className="flex items-center gap-1 bg-gold px-1.5 font-mono text-[length:var(--bento-label)] text-ink"
          >
            <span className="font-bold">!</span>
            {field.name}
            <span className="font-semibold tabular-nums">{field.declared.variants}</span>
          </span>
        ) : (
          <span
            key={field.name}
            className="flex items-center gap-1 border border-line bg-input px-1.5 font-mono text-[length:var(--bento-label)] text-ink"
          >
            <span className="text-muted">{field.name}</span>
            {field.declared.values.join(" · ")}
          </span>
        ),
      )}
    </span>
  );
}

interface TypeLedgerProps {
  lang: Lang;
  ledger: TypeLedgerData;
  /** `serialiseFocus` key of the open derivation, so the row that produced it
   *  is outlined. Never a dimming of the others. */
  selected: string | null;
  onFocus: (focus: Focus) => void;
}

export function TypeLedger({ lang, ledger, selected, onFocus }: TypeLedgerProps) {
  const peak = ledger.rows.reduce((max, row) => Math.max(max, row.instances), 0);
  const bucketTotal = ledger.buckets.reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-input">
      <Headline lang={lang} ledger={ledger} bucketTotal={bucketTotal} />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <Th>{t("col.type", lang)}</Th>
              <Th>{t("col.class", lang)}</Th>
              <Th right>{t("col.instances", lang)}</Th>
              <Th right>{t("col.geometry", lang)}</Th>
              <Th right>{t("col.triangles", lang)}</Th>
              <Th>PredefinedType</Th>
              <Th>{t("col.materials", lang)}</Th>
              <Th>{t("col.properties", lang)}</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => (
              <LedgerRow
                key={row.typeName === null ? "!untyped" : `=${row.typeName}`}
                lang={lang}
                row={row}
                peak={peak}
                capped={ledger.meshCapped}
                selected={selected}
                onFocus={onFocus}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Foot lang={lang} ledger={ledger} />
    </div>
  );
}

/** The disproportion, the shape behind it, and the boundary it was read
 *  against — in that order, all at label scale. No hero. */
function Headline({
  lang,
  ledger,
  bucketTotal,
}: {
  lang: Lang;
  ledger: TypeLedgerData;
  bucketTotal: number;
}) {
  const health = ledger.health;
  return (
    <div className="shrink-0 border-b border-line bg-panel px-[var(--bento-pad)] py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={
            "flex items-center gap-2 px-2 py-0.5 " +
            (health ? HEALTH_FILL[health] : "bg-muted text-cream")
          }
        >
          <span className="font-mono text-[length:var(--bento-text)] font-bold">
            {health ? HEALTH_GLYPH[health] : "–"}
          </span>
          <span className="shrink-0 text-[length:var(--bento-label)] font-semibold tracking-[0.1em] uppercase">
            {health ? t(`type.health.${health}`, lang) : t("verdict.na", lang)}
          </span>
          <span className="font-mono text-[length:var(--bento-text)] font-semibold tabular-nums">
            {formatCount(ledger.singles, lang)} / {formatCount(ledger.types, lang)}
          </span>
          <span className="font-mono text-[length:var(--bento-text)] tabular-nums">
            {ledger.singleShare === null
              ? "—"
              : formatShare(ledger.singles, ledger.types, lang)}
          </span>
        </span>

        <Pair label={t("check.single-instance-types", lang)} value={t("type.single", lang)} />
        <Pair
          label={t("type.threshold", lang)}
          value={`≥ ${Math.round(TYPE_HEALTH_BANDS.watch * 100)} % · ≥ ${Math.round(
            TYPE_HEALTH_BANDS.weak * 100,
          )} %`}
        />
        <Pair
          label={t("type.median", lang)}
          value={ledger.median === null ? "—" : formatCount(ledger.median, lang)}
        />
      </div>

      {/* The SHAPE. A ratio says how many types carry one instance; this says
          how the rest are spread, which is what "disproportionate" is about. */}
      <div className="mt-1 flex items-center gap-1">
        <span className="shrink-0 text-[length:var(--bento-label)] font-semibold tracking-[0.12em] text-gold uppercase">
          {t("type.perType", lang)}
        </span>
        <span className="flex min-w-0 flex-1">
          {TYPE_BUCKETS.map((_bucket, index) => (
            <span
              key={BUCKET_LABEL[index]}
              title={BUCKET_LABEL[index]}
              className={`flex h-[1.5em] min-w-[3.5ch] items-center justify-center gap-1 overflow-hidden px-1 font-mono text-[length:var(--bento-label)] tabular-nums ${BUCKET_TINT[index]} ${BUCKET_INK[index]}`}
              style={{
                flexGrow: bucketTotal > 0 ? Math.max(ledger.buckets[index], 0.001) : 1,
                flexBasis: 0,
              }}
            >
              <span className="opacity-70">{BUCKET_LABEL[index]}</span>
              <span className="font-semibold">{formatCount(ledger.buckets[index], lang)}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[length:var(--bento-label)] font-semibold tracking-[0.12em] text-gold uppercase">
        {label}
      </span>
      <span className="font-mono text-[length:var(--bento-label)] tabular-nums text-ink">
        {value}
      </span>
    </span>
  );
}

function LedgerRow({
  lang,
  row,
  peak,
  capped,
  selected,
  onFocus,
}: {
  lang: Lang;
  row: TypeRow;
  peak: number;
  capped: boolean;
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const key = row.typeName === null ? "type:-" : `type:=${row.typeName}`;
  const chosen = selected === key;
  const cell = "h-6 border-b border-line p-0 align-middle";
  // No geometry at all, on a pass that withheld nothing, is a fact about the
  // type. On a CAPPED pass it is not — the geometry may simply have been
  // dropped — so the mark is withheld and the foot says the pass was capped.
  const noGeometry = !capped && row.meshed === 0 && row.instances > 0;
  // Disagreement is a claim about ONE type. The untyped row is a remainder, not
  // a type, so its cells print the spread without claiming it is a fault.
  const flag = row.typeName !== null;
  const disagreeLabel = t("type.disagree", lang);

  return (
    <tr
      onClick={() =>
        onFocus({ kind: "type", typeName: row.typeName })
      }
      className={
        "cursor-pointer hover:bg-palegreen " +
        (chosen ? "outline-2 -outline-offset-2 outline-ink" : "")
      }
    >
      <td className={cell}>
        {row.typeName === null ? (
          <span className="flex items-center gap-2 bg-muted px-2 py-0.5 text-cream">
            <span className="font-mono text-[length:var(--bento-label)] font-bold">{"–"}</span>
            <span className="text-[length:var(--bento-text)]">{t("type.untyped", lang)}</span>
          </span>
        ) : (
          <span
            onDoubleClick={copyOnDoubleClick(row.typeName)}
            title={row.typeName}
            className="block max-w-[32ch] cursor-copy truncate px-2 text-[length:var(--bento-text)] text-ink"
          >
            {row.typeName}
          </span>
        )}
      </td>

      <td className={cell}>
        {row.classes.length > 1 && flag ? (
          <Disagree variants={row.classes.length} label={disagreeLabel}>
            {row.classes.map((c) => c.entity).join(" · ")}
          </Disagree>
        ) : row.classes.length > 1 ? (
          <span
            title={row.classes.map((c) => `${c.entity} ${c.count}`).join(" · ")}
            className="block max-w-[22ch] truncate px-2 font-mono text-[length:var(--bento-label)] text-ink"
          >
            {row.classes.map((c) => c.entity).join(" · ")}
          </span>
        ) : (
          <span className="block px-2 font-mono text-[length:var(--bento-label)] text-ink">
            {row.classes[0]?.entity ?? "—"}
          </span>
        )}
      </td>

      <td className={`${cell} relative text-right`}>
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 bg-green/15"
          style={{ width: peak > 0 ? `${(row.instances / peak) * 100}%` : "0%" }}
        />
        <span className="relative block px-2 font-mono text-[length:var(--bento-text)] tabular-nums text-ink">
          {formatCount(row.instances, lang)}
        </span>
      </td>

      <td className={`${cell} text-right`}>
        {row.meshed === null ? (
          <span className="block px-2 font-mono text-[length:var(--bento-label)] text-muted">
            {"—"}
          </span>
        ) : noGeometry ? (
          <span className="flex items-center justify-end gap-1.5 bg-gold px-2 py-0.5 font-mono text-[length:var(--bento-label)] tabular-nums text-ink">
            <span className="font-bold">!</span>
            {formatCount(0, lang)} / {formatCount(row.instances, lang)}
          </span>
        ) : (
          <span className="block px-2 font-mono text-[length:var(--bento-label)] tabular-nums text-ink">
            {formatCount(row.meshed, lang)} / {formatCount(row.instances, lang)}
          </span>
        )}
      </td>

      <td className={`${cell} text-right`}>
        <span
          title={
            row.triangles !== null && row.meshed
              ? `${formatCount(Math.round(row.triangles / row.meshed), lang)} / ${t("col.instances", lang)}`
              : undefined
          }
          className="block px-2 font-mono text-[length:var(--bento-label)] tabular-nums text-ink"
        >
          {row.triangles === null ? "—" : formatCount(row.triangles, lang)}
        </span>
      </td>

      <td className={cell}>
        <DeclaredCell declared={row.predefined} flag={flag} label={disagreeLabel} />
      </td>
      <td className={cell}>
        <DeclaredCell declared={row.materials} flag={flag} label={disagreeLabel} />
      </td>
      <td className={cell}>
        <CommonCell row={row} flag={flag} label={disagreeLabel} />
      </td>
    </tr>
  );
}

/** The three "types" numbers against each other, then what could not be seen.
 *
 * `339 brukt av 398 · 84 navn` is the whole reconciliation: the file DECLARES
 * 398 type objects, elements are defined by 339 of them, and those 339 carry 84
 * distinct names — which is the row count of this table. Before the roster was
 * readable the KPI printed 398, this table listed 84, and nothing on screen
 * said why. A number that cannot be told from the two others is left out rather
 * than guessed: `typeObjectsUsed`/`Declared` are null when not supplied. */
function Foot({ lang, ledger }: { lang: Lang; ledger: TypeLedgerData }) {
  const objects =
    ledger.typeObjectsUsed !== null && ledger.typeObjectsDeclared !== null
      ? `${formatCount(ledger.typeObjectsUsed, lang)} ${t("type.usedOfDeclared", lang)} ` +
        `${formatCount(ledger.typeObjectsDeclared, lang)} · ` +
        `${formatCount(ledger.types, lang)} ${t("type.names", lang)}`
      : null;
  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 border-t border-line bg-panel px-[var(--bento-pad)] py-1">
      {objects ? <Pair label={t("type.objects", lang)} value={objects} /> : null}
      {ledger.meshUnknown ? (
        <Pair label={t("col.geometry", lang)} value={t("type.geometryUnread", lang)} />
      ) : null}
      {ledger.meshCapped ? (
        <Pair label={t("col.geometry", lang)} value={t("type.geometryCapped", lang)} />
      ) : null}
    </div>
  );
}
