/** Typer: the type extraction, one row per IFC class × type name.
 *
 * The ifcfast demo's Types view (`ifc-fast-demo/components/views/
 * types-view.tsx`), on this model's profile: how many elements carry each
 * type, and whether they agree on IsExternal and LoadBearing (true · false ·
 * unset). A row is a door, as every row on the board is: it makes a Type chip
 * through the board's own click, so the 3D isolates that type.
 *
 * What the demo had that the engine here does not give:
 *   · m³ and m² per type. The demo summed ifcfast's MESHED take-off
 *     (`mesh_qto()`); the wasm build's `qtoJson()` is not read by this app, so
 *     the columns stand and say `ikke levert` rather than print a sum of
 *     nothing.
 *   · the model dots. The demo pooled several models on one page; this tab
 *     lives in one model's panel, so there is one model and no column for it.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { formatCount } from "./format";
import type { ModelProfile } from "./profile";
import type { Focus } from "./trace";
import { serialiseFocus } from "./trace";

interface TypeRow {
  key: string;
  entity: string;
  typeName: string | null;
  source: string | null;
  count: number;
  ext: [number, number, number];
  lb: [number, number, number];
}

function bump(tally: [number, number, number], value: boolean | null | undefined) {
  if (value === true) tally[0] += 1;
  else if (value === false) tally[1] += 1;
  else tally[2] += 1;
}

function typeRows(profile: ModelProfile): TypeRow[] {
  const rows = new Map<string, TypeRow>();
  for (const product of profile.rows) {
    if (product.isOpening) continue;
    const typeName = product.typeName ?? null;
    const key = `${product.entity}::${typeName ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        entity: product.entity,
        typeName,
        source: product.typeSource ?? null,
        count: 0,
        ext: [0, 0, 0],
        lb: [0, 0, 0],
      };
      rows.set(key, row);
    }
    row.count += 1;
    bump(row.ext, product.isExternal);
    bump(row.lb, product.loadBearing);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}

export function Th({
  children,
  right,
  center,
  title,
}: {
  children: ReactNode;
  right?: boolean;
  center?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={
        "sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 align-bottom text-[length:var(--bento-label,10px)] font-semibold tracking-[0.12em] whitespace-nowrap text-gold uppercase " +
        (right ? "text-right" : center ? "text-center" : "text-left")
      }
    >
      {children}
    </th>
  );
}

/** true · false · unset, the demo's badge: one number when the whole row
 *  agrees, the three counts when it does not. */
function Tri({ value }: { value: [number, number, number] }) {
  const [yes, no, unset] = value;
  if (yes > 0 && no === 0 && unset === 0) return <span className="text-ink">{`${yes} ✓`}</span>;
  if (no > 0 && yes === 0 && unset === 0) return <span className="text-ink">{`${no} ✗`}</span>;
  if (unset > 0 && yes === 0 && no === 0) return <span className="text-muted">{`${unset} —`}</span>;
  return <span title={`${yes} ✓ · ${no} ✗ · ${unset} —`}>{`${yes}·${no}·${unset}`}</span>;
}

export function TypesTab({
  lang,
  profile,
  selected,
  onFocus,
}: {
  lang: Lang;
  profile: ModelProfile | null;
  /** `serialiseFocus` key of the open derivation, to mark its row. */
  selected: string | null;
  onFocus: (focus: Focus) => void;
}) {
  const rows = useMemo(() => (profile ? typeRows(profile) : []), [profile]);
  const notSupplied = t("type.notSupplied", lang);

  return (
    <section className="flex h-[clamp(22rem,62vh,54rem)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border border-line bg-panel">
      <div className="min-h-0 flex-1 overflow-auto bg-input">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <Th>{t("col.class", lang)}</Th>
              <Th>{t("col.type", lang)}</Th>
              <Th right>{t("col.instances", lang)}</Th>
              <Th right>
                m³<div className="font-normal tracking-normal normal-case text-muted">{notSupplied}</div>
              </Th>
              <Th right>
                m²<div className="font-normal tracking-normal normal-case text-muted">{notSupplied}</div>
              </Th>
              <Th center title="IsExternal ✓ · ✗ · —">IsExternal</Th>
              <Th center title="LoadBearing ✓ · ✗ · —">LoadBearing</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const focus: Focus = { kind: "type", typeName: row.typeName };
              const active = selected === serialiseFocus(focus);
              return (
                <tr
                  key={row.key}
                  onClick={() => onFocus(focus)}
                  aria-selected={active}
                  className={
                    "cursor-pointer " + (active ? "bg-palegreen" : "hover:bg-panel")
                  }
                >
                  <td className="border-b border-line px-2 py-1.5 font-mono text-[12px] text-muted">
                    {row.entity}
                  </td>
                  <td className="max-w-[28rem] truncate border-b border-line px-2 py-1.5 font-mono text-[12px] text-ink">
                    {row.typeName ?? t("type.untyped", lang)}
                    {row.source && row.source !== "ifctype" && row.typeName ? (
                      <span className="ml-2 text-[9px] text-muted uppercase">{row.source}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-line px-2 py-1.5 text-right font-mono text-[12px] tabular-nums">
                    {formatCount(row.count, lang)}
                  </td>
                  <td className="border-b border-line px-2 py-1.5" />
                  <td className="border-b border-line px-2 py-1.5" />
                  <td className="border-b border-line px-2 py-1.5 text-center font-mono text-[11px] tabular-nums">
                    <Tri value={row.ext} />
                  </td>
                  <td className="border-b border-line px-2 py-1.5 text-center font-mono text-[11px] tabular-nums">
                    <Tri value={row.lb} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center font-mono text-[11px] text-muted">
                  {profile ? t("type.none", lang) : notSupplied}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
