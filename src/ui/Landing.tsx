/** The entrance. What the app can be handed, and what it already holds.
 *
 *   IFC        the drop target, the largest thing on the page
 *   ruleset    IDS or ruleset.json, dropped or picked; the loaded name once set
 *   setup      the four project mappings, marked by whether the ruleset sets them
 *   recent     models the cache can put back on the board without the file
 *
 * Tiles in the board's own chrome (panel fill, hairline, gold micro-label) on
 * the golden split the board uses, so the door reads as the same product as the
 * room. Nothing here shows a result: the recent list is what the cache stores
 * about each model, not a verdict from a previous run.
 *
 * Every tile is a real entrance. There is no copy on this page beyond labels.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Ruleset } from "../ids/types.ts";
import { SwitchGlyph } from "./Switch";
import { MAPPING_ROLES } from "../ids/lint.ts";
import { listCached, type CachedListing } from "../storage/model-cache.ts";
import { MicroLabel } from "./BentoGrid";
import { formatBytes, formatCount } from "./format";
import type { Lang } from "./i18n";
import { locale, t } from "./i18n";

interface LandingProps {
  lang: Lang;
  dragging: boolean;
  onFiles: (files: File[]) => void;
  ruleset: Ruleset | null;
  rulesetName: string | null;
  rulesetError: string | null;
  onRulesetFile: (file: File) => void;
  onClearRuleset: () => void;
  onSetup: () => void;
  onOpenCached: (cacheKey: string) => Promise<boolean>;
}

export function Landing(props: LandingProps) {
  const { lang } = props;
  const recent = useRecent();

  return (
    <main className="@container flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto my-auto flex w-full max-w-[1180px] flex-col gap-3 px-4 py-4 @3xl:gap-[13px] @3xl:px-8 @3xl:py-8">
        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-[1.618fr_1fr] @3xl:gap-[13px]">
          <IfcTile {...props} />
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-1 @3xl:gap-[13px]">
            <RulesetTile {...props} />
            <SetupTile lang={lang} ruleset={props.ruleset} onSetup={props.onSetup} />
          </div>
        </div>
        {recent.length > 0 ? (
          <RecentTile lang={lang} entries={recent} onOpen={props.onOpenCached} />
        ) : null}
      </div>
    </main>
  );
}

/** The cache listing, read once on mount. Empty when storage is unavailable:
 *  the tile is then simply absent, never an empty frame. */
function useRecent(): CachedListing[] {
  const [entries, setEntries] = useState<CachedListing[]>([]);
  useEffect(() => {
    let alive = true;
    listCached()
      .then((listed) => {
        if (alive) setEntries(listed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return entries;
}

/* ------------------------------------------------------------------ chrome */

function Tile({
  label,
  sub,
  className = "",
  children,
}: {
  label: string;
  sub?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={"flex min-w-0 flex-col border border-line bg-panel " + className}>
      <div className="flex shrink-0 items-baseline gap-2 px-4 pt-3 pb-2">
        <MicroLabel>{label}</MicroLabel>
        {sub !== undefined ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tracking-wide text-muted">
            {sub}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------- IFC */

function IfcTile({ lang, dragging, onFiles }: LandingProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Tile label={t("label.models", lang)} sub={t("accept.ifc", lang)} className="@3xl:min-h-[26rem]">
      <div className="flex flex-1 flex-col px-4 pb-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={
            "group flex min-h-[15rem] flex-1 flex-col items-center justify-center gap-5 border-2 border-dashed px-4 py-8 transition-colors " +
            (dragging
              ? "border-green bg-palegreen text-green"
              : "border-line bg-input text-ink hover:border-green")
          }
        >
          <IfcGlyph active={dragging} />
          <span className="text-center text-[22px] leading-tight font-medium tracking-tight @3xl:text-[28px]">
            {t("drop.ifc", lang)}
          </span>
          <span className="flex items-center gap-3 bg-green px-4 py-1.5 text-sm font-medium text-cream group-hover:bg-ink">
            {t("action.openIfc", lang)}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".ifc,.ifczip"
          className="hidden"
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
    </Tile>
  );
}

/** A file with a folded corner and the extension on it. Structure, drawn in
 *  the palette: the thing you are about to hand over. */
function IfcGlyph({ active }: { active: boolean }) {
  const stroke = active ? "var(--color-green)" : "var(--color-muted)";
  return (
    <svg width="56" height="68" viewBox="0 0 56 68" aria-hidden="true" className="shrink-0">
      <path
        d="M1 1h38l16 16v50H1z"
        fill="var(--color-cream)"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <path d="M39 1v16h16" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="1" y="38" width="40" height="16" fill={active ? "var(--color-green)" : "var(--color-ink)"} />
      <text
        x="21"
        y="50"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fontWeight="600"
        letterSpacing="1.2"
        fill="var(--color-cream)"
      >
        IFC
      </text>
    </svg>
  );
}

/* ----------------------------------------------------------------- ruleset */

function RulesetTile({
  lang,
  dragging,
  ruleset,
  rulesetName,
  rulesetError,
  onRulesetFile,
  onClearRuleset,
}: LandingProps) {
  const input = useRef<HTMLInputElement>(null);
  const loaded = rulesetName !== null && ruleset !== null;

  return (
    <Tile label={t("label.ruleset", lang)} sub={t("accept.ruleset", lang)}>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
        {loaded ? (
          <div className="flex flex-1 flex-col justify-between gap-3 border border-line bg-input px-3 py-3">
            <span className="font-mono text-[13px] break-all text-ink">{rulesetName}</span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                {t("label.rules", lang)}
              </span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {formatCount(ruleset.rules.length, lang)}
              </span>
              <button
                type="button"
                onClick={onClearRuleset}
                className="ml-auto border border-line bg-cream px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
              >
                {t("action.remove", lang)}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={
              "flex min-h-[5.5rem] flex-1 flex-col items-center justify-center gap-2 border border-dashed px-3 py-3 " +
              (dragging
                ? "border-green bg-palegreen text-green"
                : "border-line bg-input text-ink hover:border-green hover:text-green")
            }
          >
            <span className="text-[15px] font-medium">{t("drop.ruleset", lang)}</span>
            <span className="text-[12px] text-muted underline decoration-line underline-offset-4">
              {t("action.openRuleset", lang)}
            </span>
          </button>
        )}
        {rulesetError !== null ? (
          <div className="bg-bad px-3 py-2 text-cream">
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase">
              {t("error.ruleset", lang)}
            </div>
            <pre className="m-0 mt-1 font-mono text-[11px] leading-snug whitespace-pre-wrap">
              {rulesetError}
            </pre>
          </div>
        ) : null}
        <input
          ref={input}
          type="file"
          accept=".ids,.xml,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onRulesetFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------- setup */

/** Set = the ruleset carries an enabled rule with that mapping role, the same
 *  test the setup page uses to draw its switch, and drawn as the same switch. */
function mappingSet(ruleset: Ruleset | null, role: string): boolean {
  if (ruleset === null) return false;
  return ruleset.rules.some(
    (rule) => rule.kind === "extended" && rule.mapping === role && rule.enabled !== false,
  );
}

function SetupTile({
  lang,
  ruleset,
  onSetup,
}: {
  lang: Lang;
  ruleset: Ruleset | null;
  onSetup: () => void;
}) {
  return (
    <Tile label={t("action.setup", lang)}>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <button
          type="button"
          onClick={onSetup}
          className="group flex flex-1 flex-col border border-line bg-input text-left hover:border-green"
        >
          <ul className="m-0 flex flex-1 list-none flex-col p-0">
            {MAPPING_ROLES.map((role) => {
              const set = mappingSet(ruleset, role);
              return (
                <li
                  key={role}
                  className="flex flex-1 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <SwitchGlyph on={set} />
                  <span className="truncate text-[13px] text-ink">{t(`mapping.${role}`, lang)}</span>
                </li>
              );
            })}
          </ul>
          <span className="flex items-center justify-end gap-2 border-t border-line px-3 py-2 text-[12px] font-medium text-green group-hover:text-ink">
            {t("action.setup", lang)}
            <span aria-hidden="true">→</span>
          </span>
        </button>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ recent */

function formatUsed(at: number, lang: Lang): string {
  return new Date(at).toLocaleString(locale(lang), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RecentTile({
  lang,
  entries,
  onOpen,
}: {
  lang: Lang;
  entries: CachedListing[];
  onOpen: (cacheKey: string) => Promise<boolean>;
}) {
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [opening, setOpening] = useState<string | null>(null);

  const open = (cacheKey: string) => {
    if (opening !== null) return;
    setOpening(cacheKey);
    void onOpen(cacheKey).then((ok) => {
      setOpening(null);
      if (!ok) setGone((current) => new Set(current).add(cacheKey));
    });
  };

  const head = "text-[10px] font-semibold tracking-[0.12em] text-gold uppercase";

  return (
    <Tile label={t("label.recent", lang)} sub={formatCount(entries.length, lang)}>
      <div className="px-4 pb-4">
        <div className="border border-line bg-input">
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_6rem_9rem_5rem] items-baseline gap-4 border-b border-line px-3 py-1.5 @3xl:grid">
            <span className={head}>{t("col.name", lang)}</span>
            <span className={head}>{t("kpi.schema", lang)}</span>
            <span className={head + " text-right"}>{t("kpi.products", lang)}</span>
            <span className={head + " text-right"}>{t("kpi.size", lang)}</span>
            <span className={head}>{t("col.used", lang)}</span>
            <span />
          </div>
          <ul className="m-0 list-none p-0">
            {entries.map((entry) => {
              const missing = gone.has(entry.cacheKey);
              const action = missing ? (
                <span className="text-bad">{t("recent.gone", lang)}</span>
              ) : (
                <span className="text-green group-hover:text-ink">{t("action.open", lang)} →</span>
              );
              return (
                <li key={entry.cacheKey} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    disabled={missing || opening !== null}
                    onClick={() => open(entry.cacheKey)}
                    className="group block w-full px-3 py-2 text-left enabled:hover:bg-palegreen disabled:cursor-default"
                  >
                    {/* Wide: one aligned row per model. */}
                    <span className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_6rem_9rem_5rem] items-baseline gap-4 font-mono text-[12px] tabular-nums @3xl:grid">
                      <span className="truncate text-[13px] text-ink" title={entry.fileName}>
                        {entry.fileName}
                      </span>
                      <span className="text-muted">{entry.schema}</span>
                      <span className="text-right text-ink">{formatCount(entry.products, lang)}</span>
                      <span className="text-right text-ink">{formatBytes(entry.sizeBytes, lang)}</span>
                      <span className="text-muted">{formatUsed(entry.usedAt, lang)}</span>
                      <span className="text-right font-sans font-medium">{action}</span>
                    </span>
                    {/* Narrow: name and action, the figures under them. */}
                    <span className="flex flex-col gap-1 @3xl:hidden">
                      <span className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink" title={entry.fileName}>
                          {entry.fileName}
                        </span>
                        <span className="shrink-0 text-[12px] font-medium">{action}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 font-mono text-[11px] text-muted tabular-nums">
                        <span>{entry.schema}</span>
                        <span>
                          {formatCount(entry.products, lang)} {t("kpi.products", lang).toLowerCase()}
                        </span>
                        <span>{formatBytes(entry.sizeBytes, lang)}</span>
                        <span>{formatUsed(entry.usedAt, lang)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Tile>
  );
}
