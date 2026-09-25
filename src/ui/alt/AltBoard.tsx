/** The Kontroll tab in the three design alternatives (`#design=a|b|c`),
 * 2026-09-25. Three LAYOUTS on one module grid (`module-grid.ts`), each after
 * a named reference from the data-dense research:
 *
 *   a  Linear work surface   one list pane (the verdict numbers, the checks
 *                            and rules, the floors, the chain, the counts)
 *                            and a docked inspector holding the model and,
 *                            once a number is open, its derivation
 *   b  Stripe summary        the seven numbers first, then the report down
 *                            one column (checks, floors) with the model
 *                            beside it as the evidence
 *   c  Grafana / Datadog     titled groups of panels: a stat block beside the
 *                            checks and the model, then one panel per storey
 *                            and one per IFC class; every panel drills down
 *
 * Same data, same doors, same strings as the bento board: every tile body is
 * an existing component or the same numbers from `boardCards`. Nothing here
 * decides what a click means; `onFocus` does, as on the bento board.
 */

import { cloneElement, isValidElement, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ModelResult } from "../../ids/evaluate.ts";
import type { KpiClaims } from "../claims";
import type { ModelEntry } from "../useModels";
import type { Census } from "../profile";
import type { Focus } from "../trace";
import type { Lang } from "../i18n";
import type { Design } from "../useHashView";
import type { ModelView } from "../cross-filter";
import type { KpiCard } from "../forms";
import type { FloorConfig } from "../../engine/storey-config";
import { matchStoreys } from "../../engine/storey-config";
import { t } from "../i18n";
import { serialiseFocus } from "../trace";
import { formatCount, formatElevation } from "../format";
import { Verification } from "../Verification";
import { SpatialGauge } from "../forms";
import { FloorSetupMatrix, StoreyList, type FloorPeer } from "../FloorSetup";
import { ViewerTile } from "../../viewer/ViewerTile";
import { VERDICT_GLYPH } from "../state-visuals";
import { boardCards, chainLevels, claimedChecks } from "../board-data";
import {
  MG_GUTTER,
  MG_MAX_WIDTH,
  MG_ROW,
  layoutA,
  layoutB,
  layoutC,
  mgHeight,
  mgRowsIn,
  mgWidth,
  type MgLayout,
  type MgNeeds,
  type MgPlace,
} from "./module-grid";

export interface AltBoardProps {
  design: Design;
  lang: Lang;
  model: ModelEntry;
  census: Census;
  claims: KpiClaims;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  view: ModelView;
  matched: Set<string> | null;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
  floors: FloorConfig[] | null;
  peers: FloorPeer[];
  rules?: { evaluation?: ModelResult; evaluating?: boolean; error?: string };
  /** `a` only: the derivation band, docked in the inspector. */
  inspector?: ReactNode;
}

/** The list components read the bento's size variables; here they are fixed
 *  at the module's own values: a 32 px line, 13 / 11 px type. */
const VARS = {
  "--bento-line": `${MG_ROW}px`,
  "--bento-fs": "13px",
  "--bento-fs-sm": "11px",
  "--bento-pad": "12px",
  "--bento-label": "11px",
  "--bento-text": "13px",
  "--bento-value": "30px",
  "--bento-row": `${MG_ROW}px`,
} as CSSProperties;

/** The grid's box: its width (capped) and the rows the viewport leaves under
 *  it. Measured, because the column count and the fill rows are both
 *  functions of real px. */
function useModuleBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; rows: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    const measure = () => {
      const width = Math.min(el.clientWidth, MG_MAX_WIDTH);
      let rows = 12;
      if (main) {
        // A screen per model panel: the page height less what sits above
        // the grid INSIDE its own panel (name line, tabs), so a second model
        // further down the page gets the same board as the first.
        const panel = el.closest("section") ?? el;
        const above = el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        const style = getComputedStyle(main);
        const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        rows = mgRowsIn(main.clientHeight - above - pad);
      }
      setBox((prev) => (prev && prev.width === width && prev.rows === rows ? prev : { width, rows }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, box };
}

export function AltBoard(props: AltBoardProps) {
  const { design, lang, model, census, claims, floors, peers, rules, inspector } = props;
  const { ref, box } = useModuleBox();
  const report = model.report!;
  const results = model.evaluation?.results;
  const claimed = useMemo(() => claimedChecks(claims, results), [claims, results]);
  const { verdictCards, countCards } = boardCards(model, lang);
  const configured = !!floors && floors.length > 0;

  const extra = configured
    ? peers.reduce(
        (sum, peer) =>
          sum +
          (peer.unitResolved
            ? matchStoreys(peer.storeys, peer.unitScale, floors!).filter((m) => m.config === null).length
            : 0),
        0,
      )
    : 0;
  const ruleLines = rules
    ? 1 + (rules.error ? 3 : results ? results.length : rules.evaluating ? 1 : 0)
    : 0;
  const lampLine = design === "b" || (design === "c" && configured) ? 1 : 0;
  const needs: MgNeeds = {
    checkLines: 1 + report.checks.length + ruleLines,
    floorLines: lampLine + (configured ? 2 + floors!.length + extra : 1 + census.storeys.length),
    floorPx: configured ? 230 + 96 * peers.length : 300,
    storeys: census.storeys.length,
    classes: census.classes.length,
    rowsAvail: box?.rows ?? 12,
    bandOpen: !!inspector,
  };

  let layout: MgLayout | null = null;
  if (box) {
    if (design === "a") layout = layoutA(box.width, needs);
    else if (design === "b") layout = layoutB(box.width, needs);
    else layout = layoutC(box.width, { ...needs, matrix: configured });
  }

  const bodies = layout ? tileBodies({ ...props, verdictCards, countCards, claimed, configured, extra }) : null;

  return (
    <div ref={ref} className="w-full min-w-0" style={VARS}>
      {layout && bodies ? (
        <div
          data-mg-grid
          data-mg-design={design}
          data-mg-cols={layout.cols}
          data-mg-pitch={layout.pitch.toFixed(4)}
          className="mx-auto grid"
          style={{
            width: Math.min(box!.width, MG_MAX_WIDTH),
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, ${MG_ROW}px)`,
            gap: MG_GUTTER,
          }}
        >
          {layout.titles.map((title) => (
            <div
              key={title.id}
              data-mg-row={title.id}
              className="alt-group flex min-w-0 items-end gap-3"
              style={{ gridColumn: "1 / -1", gridRow: `${title.y + 1} / span 1` }}
            >
              {groupTitle(title.id, props)}
            </div>
          ))}
          {layout.tiles.map((place) => (
            <Tile key={place.id} place={place} body={bodies(place.id, mgHeight(place.h) > mgWidth(place.w, layout.pitch) || mgWidth(place.w, layout.pitch) < 1000)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function groupTitle(id: string, { lang, census, model }: AltBoardProps): ReactNode {
  const [label, sub] =
    id === "g-verify"
      ? [t("tile.verify", lang), formatCount(model.report!.summary.products, lang)]
      : id === "g-storeys"
        ? [t("tile.storeys", lang), formatCount(census.storeys.length, lang)]
        : [t("tile.classes", lang), formatCount(census.classes.length, lang)];
  return (
    <>
      <span className="alt-group-title">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-muted">{sub}</span>
    </>
  );
}

/* ── the tile frame ─────────────────────────────────────────────────────── */

interface TileBody {
  label?: string;
  sub?: string;
  drill?: { label: string; run: () => void };
  /** A line under the head, inside the frame (b's floors: the chain lamps). */
  lead?: ReactNode;
  body: ReactNode;
  /** Bare: no head, the body is the whole tile (stats, multiples, viewer). */
  bare?: boolean;
  tone?: "plain" | "inset";
}

function Tile({ place, body }: { place: MgPlace; body: TileBody | null }) {
  if (!body) return null;
  return (
    <section
      data-mg-tile={place.id}
      data-mg-kind={place.kind}
      data-mg-at={`${place.x},${place.y},${place.w},${place.h}`}
      className="alt-card flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ gridColumn: `${place.x + 1} / span ${place.w}`, gridRow: `${place.y + 1} / span ${place.h}` }}
    >
      {body.bare ? null : (
        <div className="alt-head flex h-8 shrink-0 items-center gap-2 px-3">
          {body.label ? <span className="alt-label truncate">{body.label}</span> : null}
          {body.sub ? (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{body.sub}</span>
          ) : null}
          {body.drill ? (
            <button
              type="button"
              onClick={body.drill.run}
              title={body.drill.label}
              aria-label={body.drill.label}
              className={
                "alt-drill inline-flex h-6 w-6 shrink-0 items-center justify-center text-[13px] font-semibold text-muted hover:text-ink " +
                (body.sub ? "" : "ml-auto")
              }
            >
              <span aria-hidden>→</span>
            </button>
          ) : null}
        </div>
      )}
      {body.lead}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body.body}</div>
    </section>
  );
}

/* ── bodies ─────────────────────────────────────────────────────────────── */

interface BodyArgs extends AltBoardProps {
  verdictCards: KpiCard[];
  countCards: KpiCard[];
  claimed: ReturnType<typeof claimedChecks>;
  configured: boolean;
  extra: number;
}

function tileBodies(a: BodyArgs): (id: string, tall: boolean) => TileBody | null {
  const { design, lang, model, census, selected, onFocus, view, matched, onPick, onHover } = a;
  const report = model.report!;
  const profile = model.profile!;
  const summary = report.summary;
  const levels = chainLevels(profile);
  const peak = {
    storey: census.storeys.reduce((m, s) => Math.max(m, s.elements), 0),
    klass: census.classes.reduce((m, c) => Math.max(m, c.count), 0),
  };

  const verification = (
    <Verification
      lang={lang}
      checks={report.checks}
      claimed={a.claimed}
      selected={selected}
      onFocus={onFocus}
      rules={a.rules}
      fill
    />
  );
  const floorsBody = a.configured ? (
    <FloorSetupMatrix lang={lang} config={a.floors!} peers={a.peers} selected={selected} onFocus={onFocus} />
  ) : (
    <StoreyList lang={lang} storeys={census.storeys} summary={summary} selected={selected} onFocus={onFocus} />
  );
  const floorsSub = a.configured
    ? `${formatCount(a.floors!.length, lang)} × ${formatCount(a.peers.length, lang)}` +
      (a.extra > 0 ? ` · +${formatCount(a.extra, lang)}` : "")
    : formatCount(census.storeys.length, lang);
  const floorsDrill = { label: t("kpi.storeys", lang), run: () => onFocus({ kind: "kpi", kpi: "storeys" }) };
  const spatialDrill = {
    label: t("check.spatial-chain", lang),
    run: () => onFocus({ kind: "check", checkId: "spatial-chain" }),
  };
  const viewer: TileBody = {
    label: t("tile.viewer", lang),
    sub: model.meshBudget ? `${formatCount(model.meshBudget.triangles, lang)} tri` : undefined,
    body: (
      <ViewerTile
        lang={lang}
        batches={model.meshBatches}
        shift={model.meshShift}
        budget={model.meshBudget}
        meshError={model.meshError}
        matched={matched}
        mode={view.mode}
        selection={view.selection}
        hover={view.hover}
        frameSeq={view.frameSeq}
        onPick={onPick}
        onHover={onHover}
      />
    ),
  };

  return (id: string, tall: boolean): TileBody | null => {
    if (id === "viewer") return viewer;
    if (id === "band") {
      const node = a.inspector;
      const stacked = isValidElement(node)
        ? cloneElement(node as ReactElement<{ stack?: boolean }>, { stack: tall })
        : node;
      // Tall (beside the viewer) or under 1000 px wide, the band puts its
      // list OVER the object panel, so the four columns keep their widths;
      // otherwise beside it, as it always was.
      return { bare: true, body: <div className="alt-band flex min-h-0 flex-1 flex-col">{stacked}</div> };
    }
    if (id === "list") return { bare: true, body: <ListPane {...a} verification={verification} floorsBody={floorsBody} floorsSub={floorsSub} /> };
    if (id === "checks")
      return { label: t("tile.verify", lang), sub: formatCount(summary.products, lang), body: verification };
    if (id === "floors")
      return {
        label: t("tile.storeys", lang),
        sub: floorsSub,
        drill: floorsDrill,
        lead: design === "b" ? <Lamps lang={lang} levels={levels} onOpen={spatialDrill.run} /> : undefined,
        body: floorsBody,
      };
    if (id === "matrix")
      return { label: t("tile.storeys", lang), sub: floorsSub, drill: floorsDrill, lead: <Lamps lang={lang} levels={levels} onOpen={spatialDrill.run} />, body: floorsBody };
    if (id === "spatial")
      return {
        label: t("tile.spatial", lang),
        drill: spatialDrill,
        body: <SpatialGauge lang={lang} levels={levels} />,
      };
    const vMatch = /^v(\d)$/.exec(id);
    if (vMatch) {
      const card = a.verdictCards[Number(vMatch[1])];
      return card ? { bare: true, body: <Stat card={card} lang={lang} selected={selected} onFocus={onFocus} lead /> } : null;
    }
    const nMatch = /^n(\d)$/.exec(id);
    if (nMatch) {
      const card = a.countCards[Number(nMatch[1])];
      return card ? { bare: true, body: <Stat card={card} lang={lang} selected={selected} onFocus={onFocus} /> } : null;
    }
    const sMatch = /^storey(\d+)$/.exec(id);
    if (sMatch) {
      const storey = census.storeys[Number(sMatch[1])];
      if (!storey) return null;
      const focus: Focus = { kind: "storey", storeyGuids: [storey.guid] };
      const live = storey.elements > 0;
      return {
        bare: true,
        body: (
          <Multiple
            name={storey.name ?? storey.guid}
            mono={storey.name === null}
            note={formatElevation(storey.elevation, summary.unit_scale, summary.unit_resolved, lang)}
            value={formatCount(storey.elements, lang)}
            share={peak.storey > 0 ? storey.elements / peak.storey : 0}
            chosen={selected === serialiseFocus(focus)}
            onOpen={live ? () => onFocus(focus) : undefined}
          />
        ),
      };
    }
    const cMatch = /^class(\d+)$/.exec(id);
    if (cMatch) {
      const klass = census.classes[Number(cMatch[1])];
      if (!klass) return null;
      return {
        bare: true,
        body: (
          <Multiple
            name={klass.entity}
            mono
            value={formatCount(klass.count, lang)}
            share={peak.klass > 0 ? klass.count / peak.klass : 0}
            chosen={selected === `class:${klass.entity}`}
            onOpen={() => onFocus({ kind: "class", entity: klass.entity })}
          />
        ),
      };
    }
    return null;
  };
}

/* ── a: the list pane ───────────────────────────────────────────────────── */

function ListPane(
  a: BodyArgs & { verification: ReactNode; floorsBody: ReactNode; floorsSub: string },
) {
  const { lang, model, selected, onFocus } = a;
  const levels = chainLevels(model.profile!);
  return (
    <div className="alt-list flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
      {/* The three finding counts, as the list's own head: the numbers the
          rows below add up to. */}
      <div className="grid shrink-0 grid-cols-3 gap-px border-b border-line">
        {a.verdictCards.map((card) => (
          <Stat key={card.key} card={card} lang={lang} selected={selected} onFocus={onFocus} lead compact />
        ))}
      </div>
      <GroupHead label={t("tile.verify", lang)} sub={formatCount(model.report!.summary.products, lang)} />
      <div className="flex shrink-0 flex-col">{a.verification}</div>
      <GroupHead
        label={t("tile.storeys", lang)}
        sub={a.floorsSub}
        onOpen={() => onFocus({ kind: "kpi", kpi: "storeys" })}
        openLabel={t("kpi.storeys", lang)}
      />
      <div className="flex shrink-0 flex-col">{a.floorsBody}</div>
      <GroupHead
        label={t("tile.spatial", lang)}
        onOpen={() => onFocus({ kind: "check", checkId: "spatial-chain" })}
        openLabel={t("check.spatial-chain", lang)}
      />
      <div className="flex h-32 shrink-0 flex-col">
        <SpatialGauge lang={lang} levels={levels} />
      </div>
      <div className="alt-group-rule shrink-0" />
      <div className="flex shrink-0 flex-col">
        {a.countCards.map((card) => (
          <div key={card.key} className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
            <span className="alt-label truncate">{card.label}</span>
            <span data-essential className="ml-auto font-mono text-[13px] font-semibold whitespace-nowrap tabular-nums">
              {card.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupHead({
  label,
  sub,
  onOpen,
  openLabel,
}: {
  label: string;
  sub?: string;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <div className="alt-group-head sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 px-3">
      <span className="alt-label truncate">{label}</span>
      {sub ? <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{sub}</span> : null}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title={openLabel}
          aria-label={openLabel}
          className={"alt-drill inline-flex h-6 w-6 items-center justify-center text-[13px] font-semibold text-muted hover:text-ink " + (sub ? "" : "ml-auto")}
        >
          <span aria-hidden>→</span>
        </button>
      ) : null}
    </div>
  );
}

/* ── the stat panel ─────────────────────────────────────────────────────── */

/** One number. `lead`: a verdict count, its figure in the verdict's own
 *  colour with the glyph and the verdict's word; otherwise a neutral count in
 *  ink. Colour means status and nothing else. */
function Stat({
  card,
  lang,
  selected,
  onFocus,
  lead = false,
  compact = false,
}: {
  card: KpiCard;
  lang: Lang;
  selected: string | null;
  onFocus: (focus: Focus) => void;
  lead?: boolean;
  compact?: boolean;
}) {
  const verdict = card.verdict;
  const clickable = !!card.checkId && (card.findings ?? 0) > 0;
  const key = card.checkId ? `check:${card.checkId}` : null;
  const chosen = key !== null && selected === key;
  const inner = (
    <>
      <span data-essential className="alt-label truncate">
        {card.label}
      </span>
      <span className="flex min-w-0 items-end gap-2">
        <span
          data-essential
          data-verdict={lead ? verdict : undefined}
          className={
            "alt-figure min-w-0 truncate font-mono leading-none font-semibold tabular-nums " +
            (compact ? "text-[26px]" : lead ? "alt-figure-lead" : "alt-figure-count")
          }
          title={card.value}
        >
          {card.value}
        </span>
        {verdict ? (
          <span data-verdict={verdict} className="alt-badge ml-auto shrink-0">
            <span aria-hidden>{VERDICT_GLYPH[verdict]}</span> {t(`verdict.${verdict}`, lang)}
          </span>
        ) : null}
      </span>
    </>
  );
  const cls =
    "alt-stat flex h-full min-h-0 min-w-0 flex-1 flex-col justify-center gap-2.5 px-3 py-2.5 text-left " + (compact ? "" : "alt-sized ") +
    (chosen ? "alt-chosen" : "");
  return clickable ? (
    <button
      type="button"
      aria-label={`${card.label} ${card.value}`}
      onClick={() => onFocus({ kind: "check", checkId: card.checkId! })}
      className={`${cls} alt-hover`}
    >
      {inner}
    </button>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

/* ── the chain as one line of lamps (b's floor tile) ────────────────────── */

function Lamps({
  lang,
  levels,
  onOpen,
}: {
  lang: Lang;
  levels: { level: string; size: number }[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("tile.spatial", lang)}
      className="alt-lamps alt-hover flex h-8 shrink-0 items-center gap-3 overflow-hidden border-b border-line px-3 text-left"
    >
      {levels.map((level) => {
        const ok = level.size > 0;
        return (
          <span key={level.level} className="flex min-w-0 shrink items-center gap-1.5">
            <span data-verdict={ok ? "pass" : "fail"} className="alt-lamp">
              {ok ? VERDICT_GLYPH.pass : VERDICT_GLYPH.fail}
            </span>
            <span className="truncate font-mono text-[11px]">{level.level}</span>
            <span data-essential className="font-mono text-[12px] font-semibold tabular-nums">
              {formatCount(level.size, lang)}
            </span>
          </span>
        );
      })}
    </button>
  );
}

/* ── one small multiple (c: a storey, a class) ──────────────────────────── */

function Multiple({
  name,
  mono = false,
  note,
  value,
  share,
  chosen,
  onOpen,
}: {
  name: string;
  mono?: boolean;
  note?: string;
  value: string;
  share: number;
  chosen: boolean;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          title={name}
          className={"truncate text-ink " + (mono ? "font-mono text-[12px]" : "text-[13px] font-medium")}
        >
          {name}
        </span>
        {note ? <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">{note}</span> : null}
      </span>
      <span data-essential className="alt-figure alt-figure-count font-mono leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span aria-hidden className="alt-meter block h-1.5 w-full overflow-hidden">
        <span className="block h-full" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </>
  );
  const cls =
    "alt-stat alt-sized flex h-full min-h-0 min-w-0 flex-1 flex-col justify-between gap-1.5 px-3 py-2.5 text-left " +
    (chosen ? "alt-chosen" : "");
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} alt-hover`}>
      {inner}
    </button>
  ) : (
    <span className={cls}>{inner}</span>
  );
}
